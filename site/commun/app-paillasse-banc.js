// © 2026 Sébastien Reyt — licence GPLv3 (code) : réutilisation et modification libres, en citant l'auteur, tout dérivé restant sous la même licence. https://www.gnu.org/licenses/gpl-3.0.html — textes, figures et pages : CC BY-NC-SA 4.0.
// Code écrit par Claude (Anthropic), un assistant d'IA, à partir des choix physiques et pédagogiques de l'auteur.
/* Instrument « banc » de la coque paillasse (_app-paillasse.js).
 * Moteur : _app-banc-coeur.js, qui prend couleur et verre à _app-michelson-coeur.js et les yeux à
 * _app-goniometre-coeur.js : les trois chargés AVANT ce fichier.
 *
 * 1. Partie SANS DOM (module.exports pour node) : bacs (tiroirs, état de départ, montages types), état → banc du cœur
 *    (`banc`), et les aides, calculées dans le plan dessiné (axe 1 : profil, y ; axe 0 : dessus, x), en mm :
 *    - `enveloppe` : le faisceau, au paraxial AFFINE (décentrements des cavaliers compris, inclinaisons ignorées),
 *      découpé ouverture après ouverture : la lumière qu'un diaphragme arrête est dessinée jusqu'à lui ; un objet
 *      étendu (lettre, quadrillage) compte pour sa boîte ; un dépoli relance un faisceau ; la lumière qui passe à côté
 *      d'une monture n'est pas dessinée ; en optique réelle, mêmes règles mais bornes de rayons EXACTS (aberrations,
      chromatisme, inclinaisons) ;
 *    - `pinceau` : rayons EXACTS du cœur (`etape`) depuis un point de l'objet, vers l'ouverture utile de l'élément
 *      suivant ; un rayon arrêté est rendu jusqu'à l'obstacle (le cœur, lui, ne garde pas ce point) ;
 *    - `construction` : les trois rayons particuliers, lentille après lentille, images intermédiaires comprises
 *      (optique parfaite seulement ; hauteurs comptées depuis l'axe de CHAQUE lentille, décentrée ou non).
 *    État = { v, bac, optique, vue, elements: [{type, id, cle (pièce de la boîte), z, x, y, params}], sel,
 *    aides, pinceau: {h}, obs, pose, cahier } ; un état par bac dans la mémoire du navigateur ({v, bacs}).
 * 2. Interface : bandeau du haut de la coque
 *    (`K.bandeau`, comme menus, ligne des gestes, étagère et pastilles),
 *    banc dessiné en pixels (`viewBox` reposé à chaque redimensionnement),
 *    bandeau de la pièce choisie et étagère à onglets sous le banc (dans `K.boite`), observation à droite (tracé
 *    direct du cœur sur la carte graphique). Pas de zoom ni de vis de cavalier dans l'interface : le modèle garde x, y.
 *    Le dessin des pièces est le module `Dessin` (profil, miniature de face). Luminosité réelle (défaut) : écran,
 *    plaque, barrette et œil sont vus par un œil modélisé (`vision` du module couleur) ; « toujours visible » :
 *    exposition sur le champ regardé. Capteurs : capteur photo (pose, ISO, bruit, voile, histogramme),
 *    barrette en volts, photodiode à calibres, spectromètre réel en comptes, chacun avec sa propre physique.
 */
(function (root) {
  "use strict";
  // Traduction : sans le moteur i18n (node, jsdom des tests, et les pages qui ne le chargent
  // pas), TRAD rend le texte français tel quel — mais il substitue quand même {0}, {1}… :
  // un appel paramétré doit afficher « clic ou touche ? » en français, jamais son gabarit.
  var TRAD = root.VITRINE_I18N ? root.VITRINE_I18N.T : function (s, p) {
    return !p ? s : String(s).replace(/\{(\d+)\}/g, function (m, i) { return p[i] == null ? m : String(p[i]); });
  };
  // Nombres affichés : UN point de passage (piège n° 1 de la SPEC). Il délègue au moteur i18n
  // quand il est là (point décimal en anglais, virgule en français) et garde le français intact
  // hors moteur (node, jsdom) : « 0,85 » y reste « 0,85 ».
  var I18N = root.VITRINE_I18N;
  function nb(v, n) {
    var s = n == null ? String(v) : (+v).toFixed(n);
    return I18N && I18N.dec() === "." ? s : s.replace(".", ",");
  }
  // Entier avec séparateur de milliers de la langue (1 000 / 1,000).
  function nbEntier(v) { return Math.round(v).toLocaleString(I18N && I18N.dec() === "." ? "en-US" : "fr-FR"); }
  var C = root && root.VITRINE_BANC;
  if (!C && typeof require === "function") C = require("./_app-banc-coeur.js").Coeur;
  var K_ = C.K, F_ = C.F;
  var LONGUEUR = 2000, DEC_MAX = 10;                 // banc de 2 m ; vis de hauteur et de décalage latéral : ±10 mm
  var SEUIL_INFINI = 20000;                          // mm : un conjugué au-delà (dix bancs) est tenu pour à l'infini
  var F_COND = 60;                                   // focale du condenseur de la lanterne (cœur : lentille(60, 50, "asph"))
  var TIRAGE = [45, 120];
  // Capteur : 1280 × 960 pixels de 5 µm ; N = pixels affichés en largeur (au plus 640 texels : au-delà, 2 × 2 pixels
  // par texel, l'affichage ne les sépare pas de toute façon) ; « net » (un texel = un pixel, sans lissage) sous 320.
  var PIXEL = 0.005, CAPTEUR_N = [1280, 640, 320, 160, 80, 40];
  var POSES = [1 / 4000, 1 / 2000, 1 / 1000, 1 / 500, 1 / 250, 1 / 125, 1 / 60, 1 / 30, 1 / 15, 1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 8, 15, 30];
  // Exposition. Le cœur rend l'éclairement E en lux : chaque source a sa luminance typique (cd/m², table du module
  // couleur `luminanceSource` ; laser : flux de 1 mW). Vues « œil » (écran, plaque,
  // barrette, œil) : luminosité réelle = `vision` du module couleur (`visionDe`), ou « toujours visible » =
  // exposition automatique sur le champ regardé, rendue par la même chaîne de couleur (`vision` sans seuils, bâtonnets,
  // Hunt ni halo : `parametresVisible`). Capteur : luminance VRAIE de chaque
  // source ; saturation à H = 78 / ISO lx·s (ISO 12232), signal 1 = saturation : K = ISO / 78 par lx·s. Bruit de
  // photons : puits de PUITS photoélectrons (pixel de 5 µm) à ISO 100, PUITS·100/ISO à la saturation au-delà (le gain
  // amplifie, les photons manquent). Bruit de lecture LECTURE e⁻ par
  // pixel, voile d'objectif VOILE_OBJ du flux réparti sur le capteur (ISO 18844, ordre de grandeur), rendu photo
  // standard (balance fixe halogène, écrêtage net à la saturation, courbe sRGB) ; pose automatique : 99e centile des
  // pixels éclairés à CIBLE_POSE de la saturation.
  var COMP_VISIBLE = 0.5, K_CAPTEUR = 100 / 78, CIBLE_POSE = 0.8, PUITS = 20000, LECTURE = 2.5, VOILE_OBJ = 0.015, AIRE_CAPTEUR = 6.4 * 4.8;
  var ISOS = [100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600];
  function isoDe(st) { return ISOS[st && st.iso >= 0 && st.iso < ISOS.length ? st.iso : 0]; }
  var ZOOM_ECRAN_MAX = 100, W_PLAQUE = 30;           // plaque de l'objet (60 mm de côté), écran au retour d'un miroir
  // Œil : rétine à 17 mm (cœur) ; champ affiché ±W_OEIL mm de rétine (±19°), agrandi jusqu'à ZOOM_OEIL_MAX ; l'œil
  // s'adapte au niveau de TOUTE sa rétine (`vision`), comme celui qui regarde l'écran à celui de l'écran entier.
  // Oculaires du cœur : viseur 25 mm, lunette 20 mm.
  var RETINE = 17, W_OEIL = 6, ZOOM_OEIL_MAX = 40, OCULAIRE = { viseur: 25, lunette: 20 };
  // Barrette CCD posée sur l'écran (st.barr : centre en mm, angle en degrés, repère de l'écran) comme la photodiode ;
  // la courbe relit l'image calculée de l'écran le long de la barrette, interpolée : sa finesse est celle de l'image
  // (un texel = 2W/512), meilleure quand on agrandit l'écran. Deux appareils (st.barr.reel), comme les capteurs posés
  // du Michelson :
  //  - RÉELLE (défaut), type Caliens, capteur Sony ILX511 : 2048 pixels de 14 µm (28,672 mm), sensibilité S = 200 V/(lx·s)
  //    en lumière de 3200 K (convertie pour les autres spectres par la réponse du silicium, `sensBarrette`), saturation
  //    0,8 V (≈ 0,004 lx·s), non-uniformité des pixels (PRNU) 5 % ;
  //  - PARFAITE, pour montrer la physique : aussi longue qu'on veut (st.barr.L, 20 à 200 mm — l'écran fait 20 cm de côté),
  //    pixels deux fois plus fins (7 µm, 8192 points de courbe au plus), saturation douze fois et demi plus haute
  //    (10 V), sans PRNU : plus longue, plus fine, plus de dynamique.
  // Temps d'intégration réglable (INTEG, ms).
  var BARRETTE = { L: 28.672, n: 2048, pixel: 0.014, S: 200, Usat: 0.8, prnu: 0.05,
    nom: TRAD("barrette réelle (Sony ILX511) : 2048 pixels de 14 µm, 28,7 mm, saturation 0,8 V, PRNU 5 %") };
  var BARRETTE_PARFAITE = { pixel: 0.007, n: 8192, S: 200, Usat: 10, prnu: 0, Lmin: 20, Lmax: 200,
    nom: TRAD("barrette parfaite : aussi longue qu'on veut, pixels de 7 µm, saturation 10 V, sans PRNU") };
  var INTEG = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
  function nomInteg(i) { var t = INTEG[i]; return t < 1000 ? t + " ms" : t / 1000 + " s"; }
  // Transmission des filtres du trajet (colorés, interférentiel, densités) à la longueur d'onde l (nm).
  function transFiltres(seq) {
    var F = seq ? seq.prims.filter(function (p) { return p.k === K_.FILTRE; }) : [];
    return function (l) { var t = 1; F.forEach(function (p) { t *= C.transFiltre(p.p[0], l); }); return t; };
  }
  // Courant d'un détecteur au silicium par lumen de la lumière qui arrive (A/lm) : spectre de la source, filtres
  // compris (polariseurs et lames ignorés).
  function aParLumen(seq) { return seq && seq.source ? MI_.amperesParLumen(seq.source.nomSpectre, transFiltres(seq)) : 0; }
  function sensBarrette(seq) { return BARRETTE.S * aParLumen(seq) / MI_.amperesParLumen("bl"); }      // V/(lx·s)
  // Indice du temps d'intégration le plus long qui garde le maximum (signal par seconde `parS`) sous la cible ; -1 :
  // saturé même au plus court ; INTEG.length - 1 si rien n'arrive.
  function integVoulue(parS, cible) {
    if (!(parS > 0)) return INTEG.length - 1;
    var i = INTEG.length - 1; while (i >= 0 && INTEG[i] * 1e-3 * parS > cible) i--;
    return i;
  }
  // Spectromètre fibré réel (type Ocean Optics) : fibre de cœur 400 µm tournée vers la lumière (tout le flux qui
  // tombe sur son cœur entre), transmission de l'appareil SPEC_T (fente, réseau, miroirs), pixels de SPEC_DL nm,
  // réponse du silicium, un photoélectron par compte ; 16 bits (65 535), bruit d'obscurité SPEC_OBS comptes plus le
  // courant d'obscurité SPEC_NOIR comptes par seconde. Comptes d'un pixel par (lux/nm) de densité et par seconde à l.
  var SPEC_T = 0.1, SPEC_DL = 0.35, SPEC_SAT = 65535, SPEC_OBS = 6, SPEC_NOIR = 100;
  function comptesSpec(l, rFibre) { return SPEC_DL / 683 * Math.PI * rFibre * rFibre * 1e-6 * SPEC_T * MI_.reponseSilicium(l) / 1.602e-19; }
  // Photodiode : courant converti par une résistance (calibre) ; saturation de l'amplificateur U_SAT.
  var CALIBRES = [1e4, 1e5, 1e6];
  function nomCalibre(i) { return ["10 kΩ", "100 kΩ", "1 MΩ"][i]; }
  function gainPhotodiode(seq, cal) { return CALIBRES[cal >= 0 && cal < CALIBRES.length ? cal : 0] * aParLumen(seq) * 1e-6; }      // V par lux·mm²
  // photodiode : rayon sensible (mm) ; saturation (V). Tension par unité de flux du cœur (lux × mm² = 1e-6 lm,
  // les deux moteurs) : calibre × réponse du silicium pour le spectre reçu (`gainPhotodiode`).
  var MI_ = (root && root.VITRINE_MICHELSON) || (typeof require === "function" ? require("./_app-michelson-coeur.js").Coeur : null);
  var R_PD = 0.5, U_SAT = 10;
  var YEUX = [["normal", "normal"], ["myope", TRAD("myope")], ["hyper", TRAD("hypermétrope")], ["presbyte", TRAD("presbyte")]];
  function amplitude(type) { var G = root && root.VITRINE_GONIOMETRE; return G && G.YEUX && G.YEUX[type] ? G.YEUX[type] : { normal: [0, 8], myope: [2, 8], hyper: [-1, 8], presbyte: [0, 1] }[type] || [0, 8]; }
  // Proximité (dioptries) sur laquelle l'œil est réglé : mode « objet » = mise au point automatique sur la proximité
  // visée p.cible, dans la plage de l'œil (comme `foyer` du cœur goniomètre) ; mode « curseur » = accommodation p.acc.
  function puissance(p) {
    var a = amplitude(p.type || "normal");
    return p.mode === "objet" ? clamp(p.cible || 0, a[0], a[0] + a[1]) : a[0] + clamp(p.acc || 0, 0, a[1]);
  }
  // Distance (mm) à laquelle l'œil voit net (Infinity au-delà du repos d'un œil normal ou hypermétrope).
  function distanceNette(p) { var P = puissance(p); return P > 1e-9 ? 1000 / P : Infinity; }
  // Ce que vise un œil posé, et sa proximité vue de la pupille (dioptries ; > 0 : lumière divergente, point à 1/P m
  // devant l'œil ; ≤ 0 : à l'infini ou au-delà, lumière convergente) : le réticule si l'œil est derrière un viseur ou
  // une lunette, sinon l'objet (dernier objet du trajet), sinon la source. Au paraxial (matrice de la cible à la
  // pupille : un point de la cible donne y = Bθ, θ' = Dθ sur la pupille, donc vu à B/D devant elle).
  function visee(seq, oeil) {
    var P = seq.prims, ip = -1, i, it = seq.objet >= 0 ? seq.objet : -1, quoi = seq.objet >= 0 ? "objet" : "source";
    for (i = 0; i < P.length; i++) if (P[i].el === oeil.id) { ip = i; break; }
    if (ip < 0) return null;
    for (i = ip - 1; i >= 0; i--) if (P[i].k === K_.MASQUE && P[i].p[0] === F_.RETICULE) { it = i; quoi = "reticule"; break; }
    if (it >= ip) return null;
    var M = C.chaine(seq, lambdaMise(seq), it, ip);      // 550 nm en lumière blanche (sommet de la sensibilité), la raie sinon
    return { quoi: quoi, el: it >= 0 ? P[it].el : null, P: Math.abs(M[1]) > 1e-9 ? clamp(1000 * M[3] / M[1], -1e3, 1e3) : 1e3 };
  }
  // Séquence du cœur pour l'état ; un œil posé en mise au point automatique est d'abord réglé sur ce qu'il vise
  // (la matrice jusqu'à sa pupille ne dépend pas de son accommodation : un seul aller-retour). pup : diamètre de la
  // pupille de l'œil qui observe (mm ; pupille stationnaire suivie par l'instrument),
  // hors de l'état : ni sauvée ni annulable, elle se recalcule.
  // prof : profil du niveau (PROFILS ; optique imposée au niveau 1), hors de l'état comme la pupille.
  function sequence(st, pup, prof) {
    var seq = C.sequence(banc(st, pup, prof)), e = seq.detEl && !seq.implicite && seq.detEl.type === "oeil" ? trouver(st, seq.detEl.id) : null;
    if (!e || C.params(e).mode !== "objet") return seq;
    var v = visee(seq, e), Pc = v ? Math.round(1e4 * v.P) / 1e4 : 0;
    if (e.params.cible === Pc) return seq;
    e.params.cible = Pc;
    return C.sequence(banc(st, pup, prof));
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function arrondi(v, pas) { return Math.round(v / pas) * pas; }

  // ================= boîte à éléments =================
  // Une pièce = un type du cœur + ses paramètres ; max = nombre d'exemplaires dans le tiroir.
  var PIECES = {
    lanterne: { nom: TRAD("Lanterne"), court: TRAD("lanterne"), type: "lanterne", params: { tirage: 70 }, max: 1,
      titre: TRAD("Lampe halogène et son condenseur ; le tirage du condenseur se règle.") },
    lettreF: { nom: TRAD("Lettre F"), court: TRAD("lettre F"), type: "lettreF", max: 1, titre: TRAD("Lettre F transparente, haute de 20 mm, sur une plaque opaque.") },
    quadrillage: { nom: TRAD("Quadrillage"), court: TRAD("quadrillage"), type: "quadrillage", max: 1, titre: TRAD("Quadrillage millimétré sur verre (carré de 40 mm).") },
    depoli: { nom: TRAD("Dépoli"), court: TRAD("dépoli"), type: "depoli", max: 1, titre: TRAD("Verre dépoli : il diffuse la lumière dans toutes les directions.") },
    trouSource: { nom: TRAD("Trou source"), court: TRAD("trou source"), type: "trouSource", params: { d: 0.5 }, max: 1, titre: TRAD("Trou de 0,1 à 1 mm de diamètre : un objet presque ponctuel.") },
    iris: { nom: TRAD("Iris"), court: "iris", type: "iris", params: { D: 20 }, max: 2, titre: TRAD("Diaphragme à iris, de 1 à 40 mm de diamètre.") },
    ecran: { nom: TRAD("Écran"), court: TRAD("écran"), type: "ecran", params: { quadrille: false }, max: 1, titre: TRAD("Écran blanc de 20 cm de côté, regardé du côté de la lumière.") },
    capteur: { nom: TRAD("Capteur"), court: TRAD("capteur"), type: "capteur", max: 1, titre: TRAD("Capteur d'appareil photo : 6,4 × 4,8 mm, pixels de 5 µm, temps de pose réglable.") },
    oeil: { nom: TRAD("Œil"), court: TRAD("œil"), type: "oeil", params: { type: "normal", mode: "objet", acc: 0, pupille: 4 }, max: 1,
      titre: TRAD("Un œil (sa pupille s'ouvre ou se ferme selon la lumière, de 2 à 8 mm) : il regarde vers la source et met au point de lui-même sur l'objet, dans la limite de son accommodation.") },
    viseur: { nom: TRAD("Viseur"), court: TRAD("viseur"), type: "viseur", max: 1,
      titre: TRAD("Viseur à frontale fixe : il montre net ce qui se trouve 100 mm devant son objectif, sur un réticule en croix.") },
    lunette: { nom: TRAD("Lunette"), court: TRAD("lunette"), type: "lunette", params: { bonnette: false }, max: 1,
      titre: TRAD("Lunette réglée à l'infini, à réticule gradué au dixième de millimètre (objectif de 200 mm) ; une bonnette la fait viser à 100 mm.") }
  };
  // Young et diffraction (tiroir « Young et diffraction ») ; les variantes d'une pièce (largeur de
  // fente, écartement, nombre de fentes, traits du réseau) se choisissent au bandeau (VARIANTES).
  PIECES.sodium = { nom: TRAD("Lampe à sodium"), court: "sodium", type: "spectrale", params: { gaz: "na", filtre: false }, max: 1,
    titre: TRAD("Lampe spectrale à vapeur de sodium (doublet jaune 589,0 et 589,6 nm), ampoule de 15 mm.") };
  PIECES.laser = { nom: "Laser", court: "laser", type: "laser", max: 1,
    titre: TRAD("Laser hélium-néon (632,8 nm), faisceau fin de 0,8 mm, très peu divergent.") };
  PIECES.laserVert = { nom: TRAD("Laser vert"), court: TRAD("laser vert"), type: "laser", params: { vert: true }, max: 1,
    titre: TRAD("Laser vert (532 nm), 1 mW comme le rouge, faisceau de 1 mm, très peu divergent.") };
  PIECES.fenteSource = { nom: TRAD("Fente source"), court: TRAD("fente source"), type: "fenteSource", params: { b: 0.1 }, max: 1, orientable: true,
    titre: TRAD("Fente réglable de 0 à 2 mm, haute de 10 mm, orientable : on l'éclaire avec la lampe, elle sert de source.") };
  PIECES.bifentes = { nom: TRAD("Bifentes"), court: TRAD("bifentes"), type: "bifentes", params: { caches: [true, false, true] }, max: 1,
    titre: TRAD("Support de trois bifentes (fentes de 60 µm, écartements 0,20, 0,25 et 0,30 mm) : on masque les deux qu'on n'utilise pas.") };
  PIECES.fente = { nom: TRAD("Fente fine"), court: TRAD("fente"), type: "fente", params: { e: 0.1 }, max: 1, titre: TRAD("Fente fine calibrée : 40, 70, 100 ou 200 µm.") };
  PIECES.trousYoung = { nom: TRAD("Trous d'Young"), court: TRAD("trous d'Young"), type: "trousYoung", params: { a: 0.5, d: 0.1 }, max: 1,
    titre: TRAD("Deux trous de 0,1 mm, distants de 0,5 ou 1 mm.") };
  PIECES.fentesMultiples = { nom: TRAD("Fentes multiples"), court: TRAD("N fentes"), type: "fentesMultiples", params: { n: 4 }, max: 1,
    titre: TRAD("2, 3, 4, 5 ou 10 fentes de 40 µm au pas de 0,2 mm.") };
  PIECES.reseau = { nom: TRAD("Réseau"), court: TRAD("réseau"), type: "reseau", params: { n: 100 }, max: 1, titre: TRAD("Réseau de 100, 300 ou 600 traits par millimètre.") };
  PIECES.fente.orientable = true;
  // Optique de Fourier (tiroir « Fourier »), le cheveu, la lampe à mercure (nue : la raie verte seule s'obtient en
  // posant devant elle un filtre interférentiel, PIECES.filtre).
  PIECES.mercure = { nom: TRAD("Lampe à mercure"), court: TRAD("mercure"), type: "spectrale", params: { gaz: "hg", filtre: false }, max: 1,
    titre: TRAD("Lampe spectrale à vapeur de mercure, ampoule de 15 mm ; toutes ses raies, un filtre interférentiel posé devant elle isole la raie verte (546,1 nm).") };
  PIECES.fil = { nom: TRAD("Cheveu"), court: TRAD("cheveu"), type: "fil", params: { w: 0.07 }, max: 1, orientable: true,
    titre: TRAD("Un cheveu (environ 70 µm d'épaisseur) tendu sur un cadre, orientable.") };
  PIECES.grilleCroisee = { nom: TRAD("Grille croisée"), court: TRAD("grille"), type: "grilleCroisee", params: { pas: 0.25 }, max: 1,
    titre: TRAD("Grille de fils croisés de 50 µm, au pas de 0,2, 0,25 ou 0,5 mm, sur un champ de 20 mm.") };
  PIECES.objetPhase = { nom: TRAD("Objet de phase"), court: TRAD("objet de phase"), type: "objetPhase", params: { forme: "goutte" }, max: 1,
    titre: TRAD("Verre gravé, parfaitement transparent : une goutte ou une lettre qui retarde la lumière d'environ un radian, sans l'absorber.") };
  PIECES.pastille = { nom: TRAD("Pastille"), court: TRAD("pastille opaque"), type: "pastille", params: { d: 0.5 }, max: 1,
    titre: TRAD("Pastille opaque de 0,2, 0,5 ou 1 mm de diamètre sur un verre : placée au foyer, elle arrête la lumière qui n'a pas été diffractée.") };
  PIECES.couteau = { nom: TRAD("Couteau"), court: TRAD("couteau"), type: "couteau", params: { xc: 0 }, max: 1, orientable: true,
    titre: TRAD("Lame à bord droit qui arrête la lumière d'un côté de son bord ; une vis la translate, elle s'oriente autour de l'axe.") };
  // Filtres, règle transparente (la barrette CCD n'est plus une pièce : elle se pose sur l'écran, st.barr).
  PIECES.filtre = { nom: TRAD("Filtre"), court: TRAD("filtre"), type: "filtre", params: { couleur: "vert" }, max: 2,
    titre: TRAD("Filtre coloré rouge, vert ou bleu (bandes larges), ou filtre interférentiel vert (546 nm, 10 nm de large).") };
  // Densité neutre (transmission 10^−d, la même pour toutes les couleurs), pour un capteur, une
  // barrette ou un œil que la lumière éblouit.
  PIECES.densite = { nom: TRAD("Densité neutre"), court: TRAD("densité"), type: "densite", params: { d: 2 }, max: 2,
    titre: TRAD("Filtre gris de densité optique 1 à 4 : il divise la lumière par 10, 100, 1000 ou 10 000, sans changer sa couleur (devant un capteur saturé, par exemple).") };
  // Diapos (images en niveaux de gris, 20 mm, du cœur : C.DIAPO_NOMS), et la même éclairée par un dépoli.
  PIECES.diapo = { nom: TRAD("Diapo"), court: TRAD("diapo"), type: "diapo", params: { image: "siemens" }, max: 1,
    titre: TRAD("Diapositive de 20 mm de côté : mire de Siemens, mire USAF 1951, portrait de Fourier tramé ou photo de la Lune à lignes de balayage.") };
  PIECES.imageEclairee = { nom: TRAD("Image éclairée"), court: TRAD("image éclairée"), type: "diapo", params: { image: "lune", eclairee: true }, max: 1,
    titre: TRAD("La même diapositive avec un verre dépoli juste derrière : chaque point de l'image renvoie de la lumière dans toutes les directions.") };
  PIECES.regle = { nom: TRAD("Règle transparente"), court: TRAD("règle"), type: "regle", max: 1, titre: TRAD("Règle transparente graduée au dixième de millimètre, sur 5 cm.") };
  // Polarisation (types `polariseur` et `lame` du cœur, Jones). Orientation affichée = e.rot : 0° = axe du
  // polariseur (ou ligne neutre de la lame) VERTICAL sur les miniatures, alors que le cœur compte rot depuis son axe x.
  // Le repère du cœur est donc tourné de 90° par rapport au dessin, sans effet : rien d'autre sur le banc ne dépend de
  // la polarisation (lumière naturelle, laser compris), seuls les angles RELATIFS des pièces comptent.
  PIECES.polariseur = { nom: TRAD("Polariseur"), court: TRAD("polariseur"), type: "polariseur", max: 2, orientable: true,
    titre: TRAD("Polariseur (ou analyseur) gradué en degrés : il ne laisse passer que la vibration parallèle à son axe.") };
  PIECES.lameD = { nom: TRAD("Lame demi-onde"), court: "λ/2", type: "lame", params: { ordre: "demi" }, max: 1, orientable: true,
    titre: TRAD("Lame demi-onde d'ordre zéro pour 546 nm, orientable : elle retarde d'une demi-période la vibration parallèle à l'une de ses lignes neutres.") };
  PIECES.lameQ = { nom: TRAD("Lame quart d'onde"), court: "λ/4", type: "lame", params: { ordre: "quart" }, max: 1, orientable: true,
    titre: TRAD("Lame quart d'onde d'ordre zéro pour 546 nm, orientable : elle retarde d'un quart de période la vibration parallèle à l'une de ses lignes neutres.") };
  var TEINTES = { rouge: "#e5362b", vert: "#2fbf4a", bleu: "#2f6bff", interferentiel: "#7fe36a" };
  // [paramètre, valeurs, texte] : pastilles du bandeau et molette sur la miniature
  var VARIANTES = {
    filtre: ["couleur", ["rouge", "vert", "bleu", "interferentiel"], function (v) { return v === "interferentiel" ? TRAD("interférentiel 546 nm") : v === "rouge" ? TRAD("rouge") : v === "vert" ? TRAD("vert") : TRAD("bleu"); }],
    densite: ["d", [1, 2, 3, 4], function (v) { return TRAD("densité {0} (÷ {1})", [v, ["10", "100", "1000", "10 000"][v - 1]]); }],
    fente: ["e", [0.04, 0.07, 0.1, 0.2], function (v) { return fmtV(1000 * v) + " µm"; }],
    trousYoung: ["a", [0.5, 1], function (v) { return "a = " + fmtV(v) + " mm"; }],
    fentesMultiples: ["n", [2, 3, 4, 5, 10], function (v) { return TRAD("{0} fentes", [v]); }],
    reseau: ["n", [100, 300, 600], function (v) { return TRAD("{0} traits/mm", [v]); }],
    grilleCroisee: ["pas", [0.2, 0.25, 0.5], function (v) { return TRAD("pas {0} mm", [fmtV(v)]); }],
    objetPhase: ["forme", ["goutte", "lettre"], function (v) { return v === "goutte" ? TRAD("goutte") : TRAD("lettre"); }],
    pastille: ["d", [0.2, 0.5, 1], function (v) { return "Ø " + fmtV(v) + " mm"; }],
    diapo: ["image", C.DIAPO_NOMS, function (v) { return { siemens: TRAD("mire de Siemens"), usaf: TRAD("mire USAF 1951"), fourier: TRAD("portrait de Fourier"), lune: TRAD("Lune (Apollo 11)") }[v] || v; }]
  };
  // Nom d'un filtre : « filtre rouge » se dit « red filter », l'ordre des mots impose la table.
  var NOM_FILTRE = { rouge: TRAD("filtre rouge"), vert: TRAD("filtre vert"), bleu: TRAD("filtre bleu"), interferentiel: TRAD("filtre interférentiel 546 nm") };
  var ECARTS = [0.2, 0.25, 0.3];                      // bifentes du cœur (a), la découverte choisie au bandeau
  function fmtV(v) { return nb(Math.round(v * 1000) / 1000); }
  function signe(f) { return (f < 0 ? "−" : "") + Math.abs(f); }
  C.LENTILLES.forEach(function (L) {
    PIECES["l" + L[0]] = { nom: signe(L[0]) + " mm", court: signe(L[0]) + " mm", type: "lentille", max: 2,
      params: { f: L[0], D: L[1], forme: L[0] > 0 ? "bicv" : "bicc", retournee: false },
      titre: L[0] > 0 ? TRAD("Lentille convergente de focale {0} mm, de diamètre {1} mm.", [signe(L[0]), L[1]])
        : TRAD("Lentille divergente de focale {0} mm, de diamètre {1} mm.", [signe(L[0]), L[1]]) };
  });
  PIECES.l200.max = 3;                               // montage 4f : collimateur et deux lentilles de 200 mm
  // Grande lentille de démonstration : ses aberrations se voient sans zoomer.
  PIECES.l150d = { nom: "150 mm, Ø 100", court: "150 mm Ø 100", type: "lentille", max: 1,
    params: { f: 150, D: 100, forme: "bicv", retournee: false },
    titre: TRAD("Grande lentille de démonstration : focale 150 mm, diamètre 100 mm ; ses aberrations se voient bien en optique réelle.") };
  // Objectif de microscope ×20 (forme « objectif » du cœur : idéal dans les deux optiques, comme un objectif corrigé de
  // TP) ; la lentille simple de 10 mm reste dans la boîte, pour ses aberrations.
  PIECES.objectif = { nom: TRAD("Objectif ×20"), court: TRAD("objectif ×20"), type: "lentille", max: 1,
    params: { f: 10, D: 8, forme: "objectif", retournee: false },
    titre: TRAD("Objectif de microscope ×20, de focale 10 mm : plusieurs lentilles collées corrigent ses aberrations, il forme des images nettes même en optique réelle. Pour un microscope, ou pour élargir le faisceau d'un laser.") };
  PIECES.miroir = { nom: TRAD("Miroir plan"), court: TRAD("miroir"), type: "miroir", max: 1,
    titre: TRAD("Miroir plan, inclinable : il renvoie la lumière vers la source ; la face de la lettre F ou du trou source tournée vers lui est blanche et sert d'écran.") };
  var NOMS = { spectrale: TRAD("lampe à sodium"), laser: "laser", fenteSource: TRAD("fente source"), bifentes: TRAD("bifentes"), fente: TRAD("fente fine"), trousYoung: TRAD("trous d'Young"),
    fentesMultiples: TRAD("fentes multiples"), reseau: TRAD("réseau"), miroir: TRAD("miroir plan"), lanterne: TRAD("lanterne"), lettreF: TRAD("lettre F"), quadrillage: TRAD("quadrillage"), depoli: TRAD("dépoli"), trouSource: TRAD("trou source"),
    iris: "iris", ecran: TRAD("écran"), capteur: TRAD("capteur"), oeil: TRAD("œil"), viseur: TRAD("viseur"), lunette: TRAD("lunette"), regle: TRAD("règle transparente"),
    fil: TRAD("cheveu"), grilleCroisee: TRAD("grille croisée"), objetPhase: TRAD("objet de phase"), pastille: TRAD("pastille opaque"), couteau: TRAD("couteau"), polariseur: TRAD("polariseur") };
  function nomDe(e) {
    if (e.type === "lame") return C.params(e).ordre === "demi" ? TRAD("lame demi-onde") : TRAD("lame quart d'onde");
    if (e.type === "filtre") return NOM_FILTRE[C.params(e).couleur] || TRAD("filtre {0}", [VARIANTES.filtre[2](C.params(e).couleur)]);
    if (e.type === "densite") return VARIANTES.densite[2](C.params(e).d);
    if (e.type === "lentille") { var f = C.params(e).f; return TRAD("lentille {0} mm", [signe(f)]); }
    if (e.type === "spectrale" && C.params(e).gaz !== "na") return TRAD("lampe à mercure");
    if (e.type === "diapo") return (C.params(e).eclairee ? TRAD("image éclairée : ") : TRAD("diapo : ")) + VARIANTES.diapo[2](C.params(e).image);
    return NOMS[e.type] || e.type;
  }
  // Demi-hauteur dessinée d'un élément (mm) et, pour un objet, demi-étendue [dessus, profil] de sa partie utile.
  function demiHauteur(e) {
    var p = C.params(e);
    return { lanterne: 32, lettreF: 30, quadrillage: 30, depoli: 32, trouSource: 25, iris: 35, ecran: 100, capteur: 15, oeil: 15, viseur: 15, lunette: 15, miroir: 32 }[e.type] || (e.type === "lentille" ? p.D / 2 + 8 : 25);
  }
  var ETENDUE = { lettreF: [6, 10], quadrillage: [20, 20], regle: [25, 5], depoli: [25, 25], trouSource: [0, 0], fenteSource: [0, 5], diapo: [10, 10] };
  var HAUT_B = { lettreF: [6, 10], quadrillage: [10, 10], depoli: [10, 10], diapo: [10, 10], regle: [0.3, 0.3] };       // haut de l'objet AB des constructions
  // Règle : B trois graduations au-dessus de A (elle sert aux petits champs : microscope, γ = −20 → 6 mm), et A sur l'axe
  // du banc tant que la règle le couvre (au microscope elle est remontée de 4,2 mm : son centre est hors du champ).

  // ================= état =================
  function poser(st, cle, z, params, extra) {
    var P = PIECES[cle], e = { type: P.type, id: "e" + (++st.n), cle: cle, z: z, x: 0, y: 0, params: {} }, k;
    if (P.orientable) e.rot = 0;
    if (P.params) for (k in P.params) e.params[k] = P.params[k];
    if (params) for (k in params) e.params[k] = params[k];
    if (extra) for (k in extra) e[k] = extra[k];
    st.elements.push(e);
    return e;
  }
  function trouver(st, id) { for (var i = 0; i < st.elements.length; i++) if (st.elements[i].id === id) return st.elements[i]; return null; }
  // Sélection : st.selL = les pièces choisies, la dernière choisie au bout ; st.sel = celle-là.
  function ranger(st, id) {
    st.elements = st.elements.filter(function (e) { return e.id !== id; });
    if (Array.isArray(st.selL)) st.selL = st.selL.filter(function (q) { return q !== id; });
    if (st.faceFix === id) st.faceFix = null;
    if (st.sel === id) st.sel = st.selL && st.selL.length ? st.selL[st.selL.length - 1] : null;
  }
  // Remplacer une pièce par une autre (lâchée sur elle, ou menu du clic droit) : même place dans la liste, même position,
  // même décalage, orientation et réglages gardés quand le type est le même, sauf ce qui distingue les deux pièces au
  // catalogue (focale, diamètre, forme d'une divergente…) ; le récepteur choisi suit ; la nouvelle pièce est la seule choisie.
  function remplacerPiece(st, id, cle) {
    var v = trouver(st, id); if (!v || !PIECES[cle]) return null;
    var e = poser(st, cle, v.z), k, nv = PIECES[cle].params || {}, av = (PIECES[v.cle] && PIECES[v.cle].params) || {};
    e.x = v.x || 0; e.y = v.y || 0;
    if (v.verrou) e.verrou = true;
    if (e.type === v.type) for (k in v.params) if (k !== "cible" && !(k in nv && nv[k] !== av[k])) e.params[k] = v.params[k];
    if (v.rot != null && e.rot != null) e.rot = v.rot;
    st.elements.pop(); st.elements.splice(st.elements.indexOf(v), 1, e);
    if (st.recep === v.id) st.recep = e.id;
    st.selL = [e.id]; st.sel = e.id;
    return e;
  }
  function compte(st, cle) { var n = 0; st.elements.forEach(function (e) { if (e.cle === cle) n++; }); return n; }
  // Focale VRAIE d'une lentille hors du bac Révisions : l'étiquette à 1 à 4 % près, en plus ou en moins,
  // tirée à la graine du banc, la même pour tous les exemplaires d'une pièce. Bac « en clair » : l'étiquette.
  function ecartFocale(graine, cle) {
    var h = (graine | 0) * 2654435761 >>> 0, i;
    for (i = 0; i < cle.length; i++) h = Math.imul(h ^ cle.charCodeAt(i), 2246822519) >>> 0;
    h = Math.imul(h ^ h >>> 15, 3266489917) >>> 0; h ^= h >>> 13;
    return (h & 1 ? 1 : -1) * (0.01 + 0.03 * ((h >>> 1) % 1000) / 999);
  }
  function focaleVraie(st, e) {
    var f = C.params(e).f;
    return BACS[st.bac] && BACS[st.bac].clair ? f : Math.round(1e3 * f * (1 + ecartFocale(st.graine, e.cle))) / 1e3;
  }
  // Banc du cœur : les éléments de l'état, les lentilles avec leur focale vraie (copies : l'état garde l'étiquette).
  // Les pièces escamotées (`escamote` : relevées hors du faisceau) n'y entrent pas ; prof.optique impose l'optique.
  // Le profil (niveau) neutralise ce qu'il ne permet pas, au calcul et au dessin, sans l'effacer de l'état : sous le
  // niveau 3, le décentrement (x, y) des pièces, sauf le décalage latéral des pièces qui l'ont toujours eu (DECALABLE :
  // platine des fentes, du laser…) et la position de l'œil posé (glissée sur l'image) ; l'inclinaison des lentilles
  // (celle du miroir, ±3°, reste à tous les niveaux). Rend la pièce elle-même quand rien n'est neutralisé.
  function neutre(e, prof) {
    if (!prof) return e;
    var nx = !prof.decentrable && e.type !== "oeil" && e.x && !DECALABLE[e.type], ny = !prof.decentrable && e.type !== "oeil" && e.y;
    var ni = !prof.inclinable && e.type === "lentille" && e.incl && e.incl[0];
    if (!nx && !ny && !ni) return e;
    var c = {}, k; for (k in e) c[k] = e[k];
    if (nx) c.x = 0;
    if (ny) c.y = 0;
    if (ni) delete c.incl;
    return c;
  }
  function neutralisees(st, prof) { return st.elements.filter(function (e) { return neutre(e, prof) !== e; }); }
  function banc(st, pup, prof) {
    var clair = !BACS[st.bac] || BACS[st.bac].clair, els = st.elements.filter(function (e) { return !escamote(st, e); }).map(function (e) { return neutre(e, prof); });
    if (els.length === st.elements.length && els.every(function (e, i) { return e === st.elements[i]; })) els = st.elements;      // rien d'écarté : le tableau de l'état
    return { optique: (prof && prof.optique) || st.optique, longueur: LONGUEUR, pupille: pup || undefined, elements: clair ? els : els.map(function (e) {
      if (e.type !== "lentille") return e;
      var c = {}, k; for (k in e) c[k] = e[k];
      c.params = {}; for (k in e.params) c.params[k] = e.params[k];
      c.params.f = focaleVraie(st, e);
      return c;
    }) };
  }
  // Tirage qui forme l'image du filament à la distance d du condenseur (sur la lentille de projection, ou sur un trou).
  function tirageVers(d) { return d > F_COND + 1 ? clamp(Math.round(10 * F_COND * d / (d - F_COND)) / 10, TIRAGE[0], TIRAGE[1]) : TIRAGE[1]; }

  // ================= montages types =================
  // m.f(st) pose les éléments ; optique, vue et aides reviennent à celles du bac sauf mention ; le cahier est gardé.
  function eclaire(st, zL, zLent) { return poser(st, "lanterne", zL, { tirage: tirageVers(zLent - zL) }); }
  // Lampe au mercure avec le filtre interférentiel qui isole sa raie verte : la pièce `filtre` 10 mm devant elle (la
  // lampe sort par sa face avant, la pièce suivante est à 20 mm au moins). Même geste pour un état sauvé d'avant la
  // lampe nue (`migrerMercure`).
  var Z_FILTRE_MERCURE = 10;
  function lampeMercure(st, z) { poser(st, "mercure", z); return poser(st, "filtre", z + Z_FILTRE_MERCURE, { couleur: "interferentiel" }); }
  var MONTAGES = {
    depart: { nom: TRAD("Montage de départ"), titre: TRAD("La lanterne, la lettre F, une lentille de 200 mm et l'écran : chercher l'image."),
      aides: { faisceau: true }, f: function (st) { eclaire(st, 150, 700); poser(st, "lettreF", 300); poser(st, "l200", 700); poser(st, "ecran", 1400); } },
    image: { nom: TRAD("Image sur un écran"), titre: TRAD("Une lentille de 200 mm forme l'image de la lettre F sur l'écran : conjugaison et grandissement."),
      aides: { construction: true }, zoom: 2,
      f: function (st) { eclaire(st, 150, 600); poser(st, "lettreF", 300); poser(st, "l200", 600); poser(st, "ecran", 1200); } },
    quatref: { nom: TRAD("Écran trop proche"), titre: TRAD("L'écran est à 70 cm de l'objet, la lentille a une focale de 20 cm : chercher une image nette en déplaçant la lentille, puis reculer l'écran."),
      aides: { construction: true }, zoom: 2,
      f: function (st) { eclaire(st, 150, 650); poser(st, "lettreF", 300); poser(st, "l200", 650); poser(st, "ecran", 1000); } },
    infini: { nom: TRAD("Objet au foyer"), titre: TRAD("L'objet est dans le plan focal objet de la lentille : son image est à l'infini."),
      aides: { pinceau: true }, f: function (st) { eclaire(st, 150, 500); poser(st, "lettreF", 300); poser(st, "l200", 500); poser(st, "ecran", 1500); } },
    bessel: { nom: TRAD("Méthode de Bessel"), titre: TRAD("Objet et écran fixes, distants de 1 m : deux positions de la lentille donnent une image nette."),
      aides: { faisceau: true }, zoom: 2,
      f: function (st) { eclaire(st, 150, 576.4); poser(st, "lettreF", 300); poser(st, "l200", 576.4); poser(st, "ecran", 1300); } },
    silbermann: { nom: TRAD("Méthode de Silbermann"), titre: TRAD("Objet et image symétriques par rapport à la lentille : même taille, image renversée."),
      aides: { construction: true }, zoom: 4,
      f: function (st) { eclaire(st, 150, 700); poser(st, "lettreF", 300); poser(st, "l200", 700); poser(st, "ecran", 1100); } },
    // Trou source des trois montages d'aberrations (stigmatisme, aberration, chromatisme) éclairé par la lanterne en
    // SOURCE IDÉALE (`emet: "carre"`) : avec le filament, le condenseur image ses 7 spires sur le trou avec ses propres
    // aberrations, chaque zone de la lentille voit par le trou une spire ou un intervalle différent, et la tache prend la
    // forme d'un os ou d'un nœud papillon colorés (selon le tirage) au lieu d'un disque. Pas de dépoli : il ferait perdre
    // le tirage depuis le trou (seq.mode = 1 du cœur), 50 à 100 fois moins de rayons utiles, et 75 à 250 fois moins de lumière.
    stigmatisme: { nom: TRAD("Stigmatisme approché"), titre: TRAD("Un trou source, une lentille plan-convexe, un iris et un capteur, en optique réelle : fermer l'iris resserre la tache."),
      seule: "reelle", aides: { pinceau: true }, poseAuto: true,
      f: function (st) {
        poser(st, "lanterne", 150, { tirage: tirageVers(150), emet: "carre" }); poser(st, "trouSource", 300, { d: 0.1 });
        poser(st, "l100", 700, { forme: "pcv" }); poser(st, "iris", 712, { D: 40 });
        var c = poser(st, "capteur", 833), im = C.images(C.sequence(banc(st)), 587.6, C.sequence(banc(st)).objet);
        if (im && !im.finale.infini) c.z = Math.round(10 * im.finale.z) / 10;
      } },
    photo: { nom: TRAD("Appareil photo"), titre: TRAD("Un objectif de 50 mm, un diaphragme et un capteur : mise au point, profondeur de champ, temps de pose. La lettre éclairée par la lanterne est si lumineuse qu'une densité de 3 devant l'objectif est nécessaire."),
      aides: { faisceau: true }, poseAuto: true,
      f: function (st) { eclaire(st, 150, 1500); poser(st, "lettreF", 300); poser(st, "densite", 1480, { d: 3 }); poser(st, "l50", 1500); poser(st, "iris", 1506, { D: 8 }); poser(st, "capteur", 1552.2); } }
  };
  // Montages : l'œil, le viseur, la lunette. Un dépoli devant l'objet quand c'est l'œil qui regarde : sans
  // lui, chaque point de l'objet n'envoie sa lumière que dans le cône étroit qui vient du filament, et la pupille de
  // 4 mm n'en reçoit que d'une petite partie de l'objet.
  MONTAGES.loupe = { nom: TRAD("Loupe"), titre: TRAD("La lettre F est dans le plan focal objet d'une lentille de 100 mm : l'œil, placé derrière, la voit nette sans accommoder. Rapprocher la lentille de l'objet : l'œil accommode."),
    aides: { pinceau: true },
    f: function (st) { poser(st, "lanterne", 150, { tirage: 70 }); poser(st, "depoli", 290); poser(st, "lettreF", 300); poser(st, "l100", 400); poser(st, "oeil", 430); } };
  MONTAGES.astro = { nom: TRAD("Lunette astronomique"), titre: TRAD("Un objet à l'infini (la lettre F au foyer d'une lentille de 300 mm), un objectif de 200 mm, un oculaire de 50 mm dont le foyer objet est au foyer image de l'objectif : l'œil voit l'image à l'infini, renversée et agrandie."),
    aides: { pinceau: true },
    f: function (st) { poser(st, "lanterne", 60, { tirage: 70 }); poser(st, "depoli", 190); poser(st, "lettreF", 200); poser(st, "l300", 500); poser(st, "l200", 700); poser(st, "l50", 950); poser(st, "oeil", 1012.5); } };
  MONTAGES.viseur = { nom: TRAD("Viseur"), titre: TRAD("Le viseur montre net ce qui se trouve 100 mm devant son objectif : sa position sur le banc donne celle de l'image, sans écran."),
    aides: { faisceau: true },
    f: function (st) { eclaire(st, 150, 900); poser(st, "lettreF", 300); poser(st, "l200", 900); poser(st, "viseur", 1300); } };
  MONTAGES.lunette = { nom: TRAD("Lunette et objet à l'infini"), titre: TRAD("La lunette est réglée à l'infini : elle montre nette, sur son réticule, l'image d'un objet placé dans le plan focal objet de la lentille. Déplacer la lentille."),
    aides: { pinceau: true },
    f: function (st) { poser(st, "lanterne", 60, { tirage: 70 }); poser(st, "depoli", 190); poser(st, "lettreF", 200); poser(st, "l500", 700); poser(st, "lunette", 900); } };
  // Le miroir replie le banc ; la lumière revient jusqu'à la plaque de la lettre F, dont la face blanche sert d'écran.
  MONTAGES.autocollimation = { nom: "Autocollimation", titre: TRAD("Un miroir plan derrière la lentille renvoie la lumière : quand la lettre F est dans le plan focal objet de la lentille, son image revient nette dans son propre plan, renversée, où que soit le miroir. Déplacer la lentille, puis le miroir."),
    aides: { pinceau: true }, zoom: 2,
    f: function (st) { eclaire(st, 150, 500); poser(st, "lettreF", 300); poser(st, "l200", 500); incliner(poser(st, "miroir", 600), 1); } };
  // Inclinaison du miroir (degrés, dans le plan vertical ; > 0 : le retour monte de 2 f′ θ dans le plan focal de la
  // lentille) : sans elle, l'image d'un trou source revient sur le trou.
  // Scène Young, vue de dessus (fentes verticales : les interférences se jouent dans le plan horizontal).
  // Fente source au foyer de la première lentille, bifentes dans le faisceau parallèle, écran au foyer de la seconde :
  // franges à l'infini, interfrange λf′/a (589 nm, 200 mm, a = 0,25 mm : 0,47 mm).
  function young(st, lampe, b) {
    if (lampe === "lanterne") poser(st, "lanterne", 80, { tirage: tirageVers(150) });
    else if (lampe === "mercure") lampeMercure(st, 200);
    else poser(st, lampe || "sodium", 200);
    poser(st, "fenteSource", 230, { b: b }); poser(st, "l200", 430); poser(st, "bifentes", 480); poser(st, "l200", 530); poser(st, "ecran", 730);
  }
  MONTAGES.young = { nom: TRAD("Young au sodium"), titre: TRAD("Lampe à sodium, fente source au foyer d'une lentille de 200 mm, bifentes dans le faisceau parallèle, écran au foyer d'une seconde lentille : les franges sont celles de l'infini. Élargir la fente source : elles se brouillent."),
    vue: "dessus", aides: { faisceau: true }, zoom: 32, f: function (st) { young(st, "sodium", 0.1); } };
  MONTAGES.youngBlanc = { nom: TRAD("Young en lumière blanche"), titre: TRAD("Le même montage éclairé par la lanterne : une frange centrale blanche, quelques franges irisées, puis le blanc d'ordre supérieur."),
    vue: "dessus", aides: { faisceau: true }, zoom: 32, f: function (st) { young(st, "lanterne", 0.05); } };
  MONTAGES.youngLaser = { nom: TRAD("Laser sur les bifentes"), titre: TRAD("Le laser éclaire directement les bifentes ; l'écran est à 1,65 m : des franges larges, dans la tache de diffraction de chaque fente."),
    vue: "dessus", aides: { faisceau: true }, zoom: 3, f: function (st) { poser(st, "laser", 250); poser(st, "bifentes", 350); poser(st, "ecran", 2000); } };
  // La barrette sur l'écran à 1,65 m des bifentes (a = 0,25 mm) : interfrange 4,2 mm, six ou sept franges sur 28,7 mm.
  MONTAGES.barretteLaser = { nom: TRAD("Franges sur la barrette"), titre: TRAD("Le laser sur les bifentes, une barrette CCD posée sur l'écran à 1,65 m : la courbe de l'éclairement le long de la barrette, ses franges et l'enveloppe de diffraction. La glisser et la tourner sur l'écran. Une densité de 3 devant le laser : sans elle, la barrette sature même à 1 ms."),
    vue: "dessus", aides: {}, zoom: 4, barrette: true, f: function (st) { poser(st, "laser", 250); poser(st, "densite", 300, { d: 3 }); poser(st, "bifentes", 350); poser(st, "ecran", 2000); st.integ = 1; } };
  MONTAGES.multiples = { nom: TRAD("Fentes multiples"), titre: TRAD("Le laser sur quatre fentes au pas de 0,2 mm : des pics fins aux mêmes endroits que les franges de deux fentes, et des maximums secondaires entre eux. Changer le nombre de fentes."),
    vue: "dessus", aides: {}, zoom: 3, f: function (st) { poser(st, "laser", 250); poser(st, "fentesMultiples", 350, { n: 4 }); poser(st, "ecran", 2000); } };
  MONTAGES.reseauLaser = { nom: TRAD("Réseau au laser"), titre: TRAD("Un réseau de 100 traits par millimètre éclairé par le laser, l'écran à 50 cm : les ordres de diffraction, de plus en plus écartés."),
    vue: "dessus", aides: {}, f: function (st) { poser(st, "laser", 250); poser(st, "reseau", 350, { n: 100 }); poser(st, "ecran", 850); } };
  // Filtrage en montage 4f (bancs de contrôle du cœur, objet et filtre décalés de 10 cm, collimateur écarté
  // pour que les pièces ne se chevauchent pas). Trou source au foyer d'un collimateur de 200 mm, iris de champ dans le
  // faisceau parallèle, objet au foyer objet de la deuxième lentille ; le plan focal commun (750 mm) reçoit l'image du
  // trou et la figure de diffraction de l'objet, l'écran (1150 mm) l'image de l'objet, renversée.
  function quatreF(st, D, objet, filtre) {
    lampeMercure(st, 40); poser(st, "trouSource", 70, { d: 0.1 }); poser(st, "l200", 270); poser(st, "iris", 310, { D: D });
    poser(st, objet[0], 350, objet[1]); poser(st, "l200", 550); poser(st, filtre[0], 750, filtre[1]); poser(st, "l200", 950); poser(st, "ecran", 1150);
  }
  MONTAGES.abbe = { nom: "Abbe-Porter", titre: TRAD("Une grille croisée éclairée en lumière parallèle, son image sur l'écran par deux lentilles de 200 mm. Une fente fine est placée dans leur plan focal commun, où se forme la figure de diffraction de la grille : elle ne laisse passer que les taches alignées avec elle, et l'image ne garde que les traits perpendiculaires à la fente. Tourner la fente."),
    vue: "dessus", aides: { faisceau: true }, zoom: 50, f: function (st) { quatreF(st, 3, ["grilleCroisee"], ["fente", { e: 0.2 }]); } };
  // Couteau à 45 µm de l'axe (l'image du trou a 50 µm de rayon), sur la lettre gravée et non sur la goutte : la goutte
  // (1 rad sur 1,2 mm, phase douce) ne donnait qu'une tache claire et floue, sans bord ni relief lisible.
  // Les bords nets de la lettre diffractent au-delà du couteau : seuls les bords perpendiculaires à son arête
  // (verticaux) ressortent en clair, le fond reste sombre ; couteau sur l'axe (xc = 0) : relief, un côté de chaque
  // bord vertical clair, l'autre sombre (vérifié sur le processeur).
  MONTAGES.strioscopie = { nom: TRAD("Strioscopie"), titre: TRAD("Une lettre gravée dans le verre (objet de phase) en montage 4f : sans filtrage, l'écran est uniformément éclairé et la lettre ne se voit pas. Un couteau dans le plan focal arrête presque toute l'image du trou source : seuls les bords de la lettre perpendiculaires à l'arête du couteau apparaissent, en clair sur un fond sombre. Reculer le couteau jusqu'à couper cette image en deux : la lettre paraît en relief, chaque bord clair d'un côté, sombre de l'autre ; tourner le couteau d'un quart de tour fait ressortir les autres bords."),
    vue: "dessus", aides: { faisceau: true }, zoom: 25, f: function (st) { quatreF(st, 26, ["objetPhase", { forme: "lettre" }], ["couteau", { xc: 0.045 }]); } };
  // Fond noir sur la lettre gravée, pas sur la goutte : le spectre de la goutte (1,2 mm) tient presque entier sous la
  // pastille (0,1 mm de rayon), qui l'arrête avec le fond (contraste ~2) ; les bords nets de la lettre diffractent
  // au-delà (bords à ~1400 fois le fond, vérifié sur le processeur à 1024²).
  MONTAGES.fondNoir = { nom: TRAD("Fond noir"), titre: TRAD("Une pastille opaque dans le plan focal arrête la lumière que l'objet de phase, une lettre gravée dans le verre, n'a pas diffractée : le fond de l'écran devient noir et les bords de la lettre y apparaissent en clair."),
    vue: "dessus", aides: { faisceau: true }, zoom: 25, f: function (st) { quatreF(st, 26, ["objetPhase", { forme: "lettre" }], ["pastille", { d: 0.2 }]); } };
  // Élargisseur : foyer image de l'objectif ×20 (10 mm) confondu avec le foyer objet de la lentille de 100 mm : afocal,
  // grandissement 10 (0,8 → 8 mm), divergence divisée par 10. Pas la lentille de 200 mm : faisceau de 16 mm dans une
  // monture de 40, que le moteur ondulatoire compte comme une ouverture (rayon < 2,5 w : `ondePlan`).
  MONTAGES.elargir = { nom: TRAD("Élargir le faisceau du laser"), titre: TRAD("Un objectif de microscope ×20 fait converger le faisceau du laser en un point, d'où il diverge ; une lentille de 100 mm, dont le foyer est sur ce point, le rend parallèle, dix fois plus large : 8 mm au lieu de 0,8 mm. Reculer l'écran : la tache garde sa taille. Déplacer la lentille : le faisceau converge ou diverge."),
    vue: "dessus", aides: { faisceau: true }, zoom: 3, f: function (st) { poser(st, "laser", 250); poser(st, "objectif", 350); poser(st, "l100", 460); poser(st, "ecran", 1500); } };
  MONTAGES.cheveu = { nom: TRAD("Cheveu au laser"), titre: TRAD("Le laser éclaire un cheveu, l'écran est à 1,65 m : autour de la tache du faisceau, la même figure de diffraction que celle d'une fente fine de même largeur."),
    vue: "dessus", aides: {}, zoom: 2.5, f: function (st) { poser(st, "laser", 250); poser(st, "fil", 350); poser(st, "ecran", 2000); } };
  // Diapos. Projection : la lanterne et son condenseur (filament imagé sur la lentille), diapo à 30 cm, lentille
  // de 200 mm à 60 cm (image à 60 cm de la lentille, γ = −2 : 40 mm sur l'écran).
  MONTAGES.projection = { nom: TRAD("Projeter une diapo"), titre: TRAD("La lanterne éclaire une diapo, une lentille de 200 mm en forme l'image agrandie sur l'écran. Changer de diapo, déplacer la lentille."),
    aides: { faisceau: true }, zoom: 3, f: function (st) { eclaire(st, 150, 600); poser(st, "diapo", 300, { image: "fourier" }); poser(st, "l200", 600); poser(st, "ecran", 1200); } };
  // Lentille inclinée de 15° (niveau 3, optique réelle) : foyers tangentiel et sagittal séparés, lignes focales FIXES
  // (horizontale, puis verticale ~9 cm plus loin : vers 1,07 m et 1,16 m) ; sur la mire de
  // Siemens, nets tour à tour les rayons horizontaux puis verticaux, jamais « les rayons puis le cercle » (ça, c'est
  // l'astigmatisme de champ d'une lentille droite, centré sur l'axe).
  MONTAGES.astigmatisme = { nom: TRAD("Astigmatisme"), titre: TRAD("La mire de Siemens projetée par une lentille inclinée de 15° : il n'y a plus d'image nette. En avançant l'écran vers la lentille, les rayons verticaux de la mire deviennent nets (et les côtés du cercle qui la borde), puis, 9 cm plus près, les rayons horizontaux (et le haut et le bas du cercle) : deux lignes focales perpendiculaires, jamais une image nette."),
    seule: "reelle", niveau: 3, aides: { pinceau: true, face: true }, pres: "lentille", zoom: 3,
    f: function (st) { eclaire(st, 150, 600); poser(st, "diapo", 300, { image: "siemens" }); incliner(poser(st, "l200", 600), 15); poser(st, "ecran", 1200); } };
  // Filtrage d'une diapo en montage 4f (comme quatreF, sans iris de champ : la diapo fait 20 mm). Trame du portrait et
  // lignes de la Lune au pas de 4 pixels (156 µm) : au plan focal, leurs taches à λf/p = 0,70 mm de l'axe (546 nm,
  // f = 200 mm) ; un iris de 1 mm, une fente horizontale de 0,6 mm les arrêtent. USAF : coupure à r/λf (iris de 1,2 mm :
  // 5,5 traits/mm, les derniers éléments du groupe 2 disparaissent).
  function diapo4F(st, image, filtre) {
    lampeMercure(st, 40); poser(st, "trouSource", 70, { d: 0.1 }); poser(st, "l200", 270); poser(st, "diapo", 350, { image: image });
    poser(st, "l200", 550); var e = poser(st, filtre[0], 750, filtre[1]); if (filtre[2] != null) e.rot = filtre[2];
    poser(st, "l200", 950); poser(st, "ecran", 1150);
  }
  MONTAGES.trame = { nom: TRAD("Effacer une trame"), titre: TRAD("Le portrait de Fourier, imprimé sous une trame fine, en montage 4f. Un iris de 1 mm dans le plan focal commun ne laisse passer que la tache centrale : la trame disparaît de l'image, le portrait reste. Ouvrir l'iris."),
    vue: "dessus", aides: { faisceau: true }, zoom: 8, f: function (st) { diapo4F(st, "fourier", ["iris", { D: 1 }]); } };
  MONTAGES.lignes = { nom: TRAD("Effacer des lignes"), titre: TRAD("Une photo de la Lune prise par Apollo 11, rayée de lignes horizontales. Une fente horizontale dans le plan focal arrête les taches que les lignes y diffractent, au-dessus et au-dessous de l'axe : les lignes disparaissent. Tourner la fente."),
    vue: "dessus", aides: { faisceau: true }, zoom: 8, f: function (st) { diapo4F(st, "lune", ["fenteSource", { b: 0.6 }, Math.PI / 2]); } };
  MONTAGES.passeBas = { nom: TRAD("Filtre passe-bas"), titre: TRAD("La mire USAF 1951 en montage 4f, un iris de 1,2 mm dans le plan focal : les traits les plus fins ne passent plus. Fermer l'iris, l'ouvrir."),
    vue: "dessus", aides: { faisceau: true }, zoom: 8, f: function (st) { diapo4F(st, "usaf", ["iris", { D: 1.2 }]); } };
  // Voir le spectre (l'écran au plan focal de la deuxième lentille, à la place du
  // filtre du montage 4f). Mesuré sur le cœur (ondulatoire, 546 nm) : grille de pas 0,25 mm, taches tous les 0,437 mm
  // (λf/a) ; trame du portrait (pas 156 µm), taches à ±0,70 mm. Spectre de la mire de Siemens écarté : une tache saturée
  // et la croix du cadre carré de la diapo, pas l'étoile attendue.
  function spectre(st, objet, D) {
    lampeMercure(st, 40); poser(st, "trouSource", 70, { d: 0.1 }); poser(st, "l200", 270);
    if (D) poser(st, "iris", 310, { D: D });
    poser(st, objet[0], 350, objet[1]); poser(st, "l200", 550); poser(st, "ecran", 750);
  }
  MONTAGES.spectreGrille = { nom: TRAD("Spectre d'une grille"), titre: TRAD("Une grille croisée de pas 0,25 mm éclairée en lumière parallèle, l'écran au plan focal de la lentille qui suit : sa figure de diffraction, un quadrillage de taches espacées de λf/a = 0,44 mm, bien plus vives sur les deux axes qu'en diagonale. Changer le pas de la grille : plus elle est fine, plus les taches s'écartent."),
    vue: "dessus", aides: { faisceau: true }, zoom: 50, f: function (st) { spectre(st, ["grilleCroisee"], 3); } };
  MONTAGES.spectreTrame = { nom: TRAD("Spectre d'une trame"), titre: TRAD("Le portrait de Fourier imprimé sous une trame fine, l'écran au plan focal de la lentille qui suit : autour de la tache centrale, où se trouve le portrait, les taches que la trame diffracte, aux nœuds d'un quadrillage de pas 0,70 mm : quatre nettes sur les axes, quatre bien plus faibles en diagonale. Ce sont elles qu'arrête l'iris du montage « Effacer une trame »."),
    // Optique réelle seule : en parfaite, la passe d'adaptation aux rayons (l'onde rate la tache, `adapterChamp`) met
    // quelques texels très clairs dans ~1 700 texels faibles, le 99e centile tombe dans ce fond et l'œil se dit dans le
    // noir alors que les taches se voient.
    seule: "reelle", vue: "dessus", aides: { faisceau: true }, zoom: 50, f: function (st) { spectre(st, ["diapo", { image: "fourier" }]); } };
  // Orientation (fente de 0,1 mm, mesuré sur le cœur) : contraste des rayons perpendiculaires à la fente 0,92, des
  // rayons parallèles 0,04 ; fente tournée de 90° : l'inverse. 40 µm : figure plus étroite mais bords de la diapo
  // brouillés ; 0,2 mm : les rayons parallèles restent nets loin du centre.
  MONTAGES.orientation = { nom: TRAD("Filtrer une orientation"), titre: TRAD("La mire de Siemens en montage 4f, une fente verticale de 0,1 mm dans le plan focal commun : seuls passent les points du spectre alignés avec elle. Sur l'écran, les rayons de la mire perpendiculaires à la fente restent nets, les autres se brouillent en gris. Tourner la fente : les rayons nets tournent avec elle."),
    vue: "dessus", aides: { faisceau: true }, zoom: 8, f: function (st) { diapo4F(st, "siemens", ["fente", { e: 0.1 }]); } };
  // Contours (passe-haut) : la pastille de 0,2 mm couvre l'image du trou source (0,1 mm) et les plus basses fréquences ;
  // 0,5 et 1 mm : contours plus fins et plus faibles.
  MONTAGES.contours = { nom: TRAD("Détecter les contours"), titre: TRAD("La mire USAF 1951 en montage 4f, une pastille opaque de 0,2 mm au centre du plan focal commun : elle arrête la lumière non diffractée et les plus basses fréquences. Les plages uniformes s'éteignent, seuls les bords des traits restent éclairés. Prendre une pastille plus grande : les contours s'affinent et pâlissent."),
    vue: "dessus", aides: { faisceau: true }, zoom: 8, f: function (st) { diapo4F(st, "usaf", ["pastille", { d: 0.2 }]); } };
  // Montages d'instruments (optique parfaite des Révisions, sauf le chromatisme). Un dépoli devant l'objet
  // quand c'est l'œil qui regarde (comme la loupe). Positions calculées au paraxial, vérifiées par `images` du cœur.
  // Microscope : règle à 10,5 mm d'un objectif de 10 mm → image intermédiaire 210 mm derrière (γ = −20), au foyer objet
  // d'un oculaire de 20 mm (×12,5) : grossissement commercial 250 ; cercle oculaire (image de l'objectif) 22 mm
  // derrière l'oculaire, où est l'œil ; champ ±0,4 mm de règle (oculaire de 16 mm). Le condenseur forme le filament sur
  // le dépoli (6 × 3 mm) : étalée sur tout le dépoli, la lumière n'éclairerait presque pas ce champ (un rayon sur 4 000).
  // Règle remontée de 4,2 mm sur son cavalier : ses traits partent de son bord bas (cœur, F.REGLE), 5 mm sous son milieu ;
  // ainsi le bord est hors du champ et les petits traits finissent 0,2 mm au-dessus de l'axe. Pinceau parti de l'axe du banc.
  MONTAGES.microscope = { nom: "Microscope", titre: TRAD("Un objectif de microscope ×20, de focale 10 mm, forme, 21 cm plus loin, une image agrandie vingt fois de la règle graduée au dixième de millimètre ; un oculaire de 20 mm, dont le foyer objet est sur cette image, la renvoie à l'infini. L'œil est au cercle oculaire, là où le faisceau se resserre derrière l'oculaire."),
    aides: { faisceau: true },
    f: function (st) { poser(st, "lanterne", 150, { tirage: tirageVers(145) }); poser(st, "depoli", 295); poser(st, "regle", 300, null, { y: 4.2 }); poser(st, "objectif", 310.5); poser(st, "l20", 540.5); poser(st, "oeil", 562.5); st.pinceau.h = -4.2; st.pinceau.hx = 0.06; } };   // hx hors du trait central de la règle (x = 0 opaque)
  // Objet à l'infini des lunettes : la lettre F (ou le quadrillage) au foyer d'une lentille de 300 mm, comme `astro`.
  function infiniPour(st, objet) { poser(st, "lanterne", 60, { tirage: 70 }); poser(st, "depoli", 190); poser(st, objet, 200); poser(st, "l300", 500); }
  // Galilée : objectif 200 mm, oculaire −100 mm à 100 mm derrière (foyers confondus) : G = +2, image droite.
  MONTAGES.galilee = { nom: TRAD("Lunette de Galilée"), titre: TRAD("Un objectif de 200 mm et un oculaire divergent de −100 mm, placé avant le foyer image de l'objectif, à 100 mm de lui : les foyers sont confondus, l'œil voit l'objet à l'infini agrandi deux fois, et à l'endroit. Comparer avec la lunette astronomique."),
    aides: { pinceau: true },
    f: function (st) { infiniPour(st, "lettreF"); poser(st, "l200", 700); poser(st, "l-100", 800); poser(st, "oeil", 812); } };
  // Lunette terrestre : objectif 200 mm (image en 900), véhicule de 100 mm à 2f (900 → 1300, γ = −1), oculaire 50 mm
  // (foyer en 1300) ; cercle oculaire 62,5 mm derrière lui. Quadrillage de 40 mm (±66 mrad) : sans lentille de champ,
  // un point du bord de l'image intermédiaire (13 mm) envoie son faisceau à côté du véhicule. Lentille de champ de
  // 100 mm dans le plan de cette image : elle conjugue l'objectif (200 mm devant) avec le véhicule (200 mm derrière).
  function terrestre(st, champ) {
    infiniPour(st, "quadrillage"); poser(st, "l200", 700); if (champ) poser(st, "l100", 900);
    poser(st, "l100", 1100); poser(st, "l50", 1350); poser(st, "oeil", 1412.5);
  }
  MONTAGES.terrestre = { nom: TRAD("Lunette terrestre"), titre: TRAD("Une lentille de 100 mm, à deux focales de l'image que donne l'objectif, en forme une seconde image de même taille, renversée : l'oculaire montre le quadrillage à l'endroit. Les bords du champ sont sombres : leur lumière passe à côté de cette lentille."),
    aides: { faisceau: true }, f: function (st) { terrestre(st, false); } };
  MONTAGES.champ = { nom: TRAD("Lentille de champ"), titre: TRAD("La même lunette terrestre, avec une lentille de 100 mm de plus dans le plan de la première image : elle ne change pas l'image, mais rabat vers l'axe la lumière des bords du champ, qui passe maintenant par la lentille suivante. Le champ s'agrandit. La ranger, la remettre."),
    aides: { faisceau: true }, f: function (st) { terrestre(st, true); } };
  // Projecteur : diapo juste après le condenseur (160), objectif de 200 mm en 410 (image en 1410, γ = −4) ; tirage
  // réglé pour que le filament se forme sur l'objectif. Dépoli à la place : la lumière part dans tous les sens, une
  // petite part seulement entre dans l'objectif. Lanterne à 148 : en optique réelle, la face de sortie de son condenseur
  // (épais) est à 10,5 mm devant elle ; à 150, elle passait derrière la diapo et arrêtait toute la lumière.
  // « Diapo sur un dépoli » (imageEclairee à la place de la diapo, ~130 fois plus sombre) n'est plus un montage à part :
  // une phrase du texte (en luminosité réelle, l'œil s'adapte et la différence ne se voyait guère).
  // Iris de 15 mm contre l'objectif : l'image du filament (~13 × 7 mm) y passe entière au bon tirage, rien n'est perdu ;
  // sans lui (objectif de 40 mm, diapo de 20 mm), le faisceau de chaque point de la diapo entre dans l'objectif quel que
  // soit le tirage et les bords ne s'assombrissent jamais (coins/centre ≥ 1,1 de 45 à 120 mm).
  function projecteur(st, cle) { poser(st, "lanterne", 148, { tirage: tirageVers(262) }); poser(st, cle, 160, { image: "usaf" }); poser(st, "l200", 410); poser(st, "iris", 422, { D: 15 }); poser(st, "ecran", 1410); }
  MONTAGES.condenseur = { nom: TRAD("Projecteur à condenseur"), titre: TRAD("La diapo est juste après le condenseur, qui forme l'image du filament sur l'objectif, diaphragmé à 15 mm : toute la lumière qui traverse la diapo passe l'iris, l'écran est éclairé fort et uniformément. Dérégler le tirage du condenseur : l'image du filament s'éloigne de l'objectif, les bords de l'image s'assombrissent puis s'éteignent. Ouvrir l'iris en grand : plus rien ne s'assombrit, l'objectif reçoit tout de toute façon. Remplacer la diapo par l'image éclairée (une diapo sur un dépoli) : chaque point renvoie sa lumière dans toutes les directions, l'objectif n'en reçoit qu'une petite part, l'image est une centaine de fois plus sombre."),
    aides: { faisceau: true }, zoom: 1.5, f: function (st) { projecteur(st, "diapo"); } };
  // Diaphragmes : image de la lettre F à γ = −2 (lentille de 200 mm à 300 mm de l'objet, écran à 600 mm derrière) ;
  // iris contre la lentille (ouverture) ou 30 mm avant l'écran (champ : le cône de chaque point y a ~1 mm de rayon).
  function diaphragme(st, zI, D) { eclaire(st, 150, 600); poser(st, "lettreF", 300); poser(st, "l200", 600); poser(st, "iris", zI, { D: D }); poser(st, "ecran", 1200); }
  MONTAGES.ouverture = { nom: TRAD("Diaphragme d'ouverture"), titre: TRAD("Un iris contre la lentille : le fermer assombrit toute l'image, sans la couper. Il limite l'ouverture des faisceaux, pas le champ."),
    aides: { faisceau: true }, zoom: 2, f: function (st) { diaphragme(st, 610, 10); } };
  MONTAGES.champIris = { nom: TRAD("Diaphragme de champ"), titre: TRAD("Le même iris près de l'image, à 3 cm de l'écran : le fermer coupe l'image de la lettre, dont le reste garde son éclat. Il limite le champ."),
    aides: { faisceau: true }, zoom: 2, f: function (st) { diaphragme(st, 1170, 12); } };
  // Œil myope de 2 δ (cœur goniomètre : il ne voit net qu'entre 6 cm et 50 cm) devant un objet à l'infini ; la lentille
  // de −500 mm, 10 mm devant l'œil, en donne une image virtuelle à 51 cm.
  MONTAGES.myope = { nom: TRAD("Corriger un œil myope"), titre: TRAD("Un œil myope ne voit net que jusqu'à 50 cm. Une lentille divergente de −500 mm juste devant lui donne, de l'objet à l'infini, une image à 50 cm : il la voit nette. Ranger la lentille : l'image se brouille."),
    aides: { pinceau: true },
    f: function (st) { infiniPour(st, "lettreF"); poser(st, "l-500", 990); poser(st, "oeil", 1000, { type: "myope" }); } };
  // Chromatisme : trou source à 2f d'une lentille de 100 mm (BK7, V ≈ 64 : foyers bleu et rouge distants de 4f/V ≈ 6 mm
  // à ce grandissement), capteur au foyer paraxial vert. Iris de 10 mm : à 20 mm, l'aberration sphérique déplace la
  // meilleure mise au point de 3 mm vers la lentille et le bord reste bleu partout sauf 6 mm avant (rayons rms par
  // composante, processeur) ; à 10 mm, bord rouge 3 à 6 mm avant le capteur, bleu après.
  MONTAGES.chromatisme = { nom: TRAD("Chromatisme"), titre: TRAD("Un trou en lumière blanche, son image par une lentille de 100 mm, en optique réelle : le verre dévie plus le bleu que le rouge, le bleu converge plus près de la lentille. Avancer le capteur : la tache se borde de rouge ; le reculer : de bleu."),
    seule: "reelle", aides: { pinceau: true }, poseAuto: true,
    f: function (st) {
      poser(st, "lanterne", 150, { tirage: tirageVers(150), emet: "carre" }); poser(st, "trouSource", 300, { d: 0.1 });
      poser(st, "densite", 400, { d: 2 }); poser(st, "l100", 500); poser(st, "iris", 506, { D: 10 });
      var c = poser(st, "capteur", 700), sq = C.sequence(banc(st)), im = C.images(sq, 546.1, sq.objet);
      if (im && !im.finale.infini) c.z = Math.round(10 * im.finale.z) / 10;
      st.obs.capteur.N = 160;
    } };
  // Inclinaison dans le plan vertical (degrés) : miroir ±3° ; lentille ±30° au niveau 3 (astigmatisme, coma).
  // Polarisation. Lanterne (lumière naturelle), polariseurs, lames ; la photodiode posée au centre de l'écran
  // (`photodiode: true` : `monter` la pose). Filtre interférentiel devant les lames : elles ne sont demi-onde ou quart
  // d'onde qu'à 546 nm (ordre zéro, retard ∝ 1/λ).
  function deg(v) { return v * Math.PI / 180; }
  function polar(st, pieces) {
    poser(st, "lanterne", 100, { tirage: tirageVers(500) });      // filament imagé entre les polariseurs : tout le faisceau passe dedans
    pieces.forEach(function (q) { var e = poser(st, q[0], q[1], q[3]); if (q[2] != null) e.rot = deg(q[2]); });
    poser(st, "ecran", 1300);
  }
  MONTAGES.malus = { nom: TRAD("Loi de Malus"), titre: TRAD("La lumière naturelle de la lanterne traverse un polariseur, puis un second, l'analyseur, tourné de 30° : la photodiode posée sur l'écran mesure ce qui passe. Tourner l'analyseur : le flux suit cos²θ ; polariseurs croisés, plus rien."),
    photodiode: true, aides: { pola: true }, f: function (st) { polar(st, [["polariseur", 450, 0], ["polariseur", 750, 30]]); } };
  MONTAGES.croises = { nom: TRAD("Polariseurs croisés"), titre: TRAD("Deux polariseurs croisés : l'écran est noir. Un troisième entre eux, à 45°, et la lumière revient (le quart de ce qui sortait du premier). Le tourner : elle s'éteint quand il est parallèle à l'un des deux."),
    photodiode: true, aides: { pola: true }, f: function (st) { polar(st, [["polariseur", 450, 0], ["polariseur", 600, 45], ["polariseur", 750, 90]]); } };
  MONTAGES.demiOnde = { nom: TRAD("Lame demi-onde"), titre: TRAD("Un filtre interférentiel vert, un polariseur, une lame demi-onde dont une ligne neutre fait 20° avec lui : la vibration ressort rectiligne, tournée de 40°. L'analyseur croisé avec le polariseur ne l'éteint plus ; le tourner de 40° : elle s'éteint."),
    photodiode: true, aides: { pola: true }, f: function (st) { polar(st, [["filtre", 300, null, { couleur: "interferentiel" }], ["polariseur", 450, 0], ["lameD", 600, 20], ["polariseur", 750, 90]]); } };
  MONTAGES.quartOnde = { nom: TRAD("Lame quart d'onde"), titre: TRAD("Un filtre interférentiel vert, un polariseur, une lame quart d'onde à 45° : la vibration ressort circulaire. Tourner l'analyseur : la photodiode ne bouge plus. Tourner la lame : la vibration devient elliptique, l'analyseur retrouve un maximum et un minimum."),
    photodiode: true, aides: { pola: true }, f: function (st) { polar(st, [["filtre", 300, null, { couleur: "interferentiel" }], ["polariseur", 450, 0], ["lameQ", 600, 45], ["polariseur", 750, 30]]); } };
  MONTAGES.lameBlanc = { nom: TRAD("Lame en lumière blanche"), titre: TRAD("La même lame quart d'onde à 45° entre polariseurs croisés, sans le filtre : elle n'est quart d'onde qu'à 546 nm. Le bleu passe mieux que le rouge : l'écran se teinte. Remettre le filtre, tourner la lame."),
    aides: { pola: true }, f: function (st) { polar(st, [["polariseur", 450, 0], ["lameQ", 600, 45], ["polariseur", 750, 90]]); } };
  // ---- Optique géométrique ----
  // Badal : objet à l'infini (lettre F au foyer d'une lentille de 300 mm), lentille de Badal de 200 mm en 800 (image en
  // 1000) ; la divergente de −200 mm à son foyer objet (600) fait partir le faisceau de son foyer image virtuel (400),
  // que la lentille de 200 mm image 400 mm derrière elle : 1200, recul f₁²/|f′| = 200 mm.
  MONTAGES.badal = { nom: TRAD("Focale d'une divergente (Badal)"), titre: TRAD("La lettre F est à l'infini (au foyer d'une lentille de 300 mm) ; seule, la lentille de 200 mm en formerait l'image dans son plan focal, à 1 m. La lentille divergente, posée au foyer objet de la lentille de 200 mm, recule cette image de f′₁²/|f′| sans changer sa taille : l'écran est à 1,2 m, d'où f′ = −(200 mm)²/(200 mm) = −200 mm. Ranger la divergente : l'image revient à 1 m."),
    aides: { faisceau: true }, zoom: 6, f: function (st) { eclaire(st, 60, 500); poser(st, "lettreF", 200); poser(st, "l300", 500); poser(st, "l-200", 600); poser(st, "l200", 800); poser(st, "ecran", 1200); } };
  // Image virtuelle : quadrillage (lettre F : le champ du viseur, ±6 mm, n'en montrerait qu'une jambe) à 40 mm d'une lentille de 100 mm (entre le foyer et la lentille) : image droite, virtuelle,
  // à 66,7 mm devant la lentille (1/p′ = 1/100 − 1/40), γ = +5/3 ; le viseur (frontale 100 mm) la voit nette 33,3 mm
  // derrière la lentille.
  MONTAGES.virtuelle = { nom: TRAD("Image virtuelle au viseur"), titre: TRAD("Un quadrillage millimétré est à 4 cm d'une lentille de 100 mm, entre son foyer et elle : aucun écran n'en recueille l'image. Le viseur, qui voit net à 10 cm devant lui, la montre nette à 3,3 cm derrière la lentille : l'image est virtuelle, droite, agrandie 1,7 fois, à 6,7 cm devant la lentille, plus loin que l'objet. Viser la lentille puis l'image : l'écart des deux positions du viseur donne p′."),
    aides: { construction: true }, f: function (st) { eclaire(st, 150, 400); poser(st, "quadrillage", 360); poser(st, "l100", 400); poser(st, "viseur", 433.3); } };
  // Aberration sphérique en lumière parallèle : trou source au foyer d'une lentille de 500 mm, plan-convexe de 200 mm
  // présentée face plane à la lumière (retournée), capteur au foyer paraxial (optique réelle). Filtre interférentiel :
  // en lumière blanche, le chromatisme de la lentille (f′/V ≈ 3 mm) noie la différence entre les deux sens.
  MONTAGES.aberration = { nom: TRAD("Aberration sphérique"), titre: TRAD("Lumière parallèle (un trou au foyer d'une lentille de 500 mm, filtre vert) sur une lentille plan-convexe de 200 mm, face plane vers la lumière : les rayons du bord convergent 8 mm avant ceux du centre, et font un halo autour du point au foyer paraxial, où est le capteur. Retourner la lentille, face bombée vers la lumière : l'écart tombe à 2 mm, quatre fois moins (le foyer s'est rapproché de 2,6 mm : remettre le capteur au point). Fermer l'iris : le halo disparaît."),
    seule: "reelle", aides: { pinceau: true }, poseAuto: true,
    f: function (st) {
      poser(st, "lanterne", 150, { tirage: tirageVers(150), emet: "carre" }); poser(st, "trouSource", 300, { d: 0.1 }); poser(st, "filtre", 320, { couleur: "interferentiel" });
      poser(st, "l500", 800); poser(st, "l200", 1000, { forme: "pcv", retournee: true }); poser(st, "iris", 1012, { D: 40 });
      var c = poser(st, "capteur", 1200), sq = C.sequence(banc(st)), im = C.images(sq, 546.1, sq.objet);
      if (im && !im.finale.infini) c.z = Math.round(10 * im.finale.z) / 10;
    } };
  // ---- Interférences et diffraction ----
  // Laser seul sur une pièce, écran à 1,65 m (comme les bifentes et le cheveu).
  function auLaser(st, cle, params) { poser(st, "laser", 250); poser(st, cle, 350, params); poser(st, "ecran", 2000); }
  MONTAGES.fenteLaser = { nom: TRAD("Fente fine au laser"), titre: TRAD("Le laser éclaire une fente fine de 100 µm ; l'écran est à 1,65 m : une tache centrale de largeur 2λD/e ≈ 21 mm, et de part et d'autre des taches deux fois moins larges et bien plus faibles (la première à 5 % du centre). Changer de fente : la figure s'élargit comme 1/e."),
    vue: "dessus", aides: {}, zoom: 3, f: function (st) { auLaser(st, "fente", { e: 0.1 }); } };
  MONTAGES.trousLaser = { nom: TRAD("Trous d'Young au laser"), titre: TRAD("Le laser éclaire deux trous de 0,1 mm distants de 0,5 mm ; l'écran est à 1,65 m : des franges rectilignes, perpendiculaires à la droite des trous, d'interfrange λD/a ≈ 2,1 mm, dans la tache d'Airy de chaque trou (13 mm de rayon). Passer à a = 1 mm : les franges se resserrent, la tache reste."),
    vue: "dessus", aides: {}, zoom: 4, f: function (st) { auLaser(st, "trousYoung", { a: 0.5 }); } };
  MONTAGES.airy = { nom: TRAD("Tache d'Airy"), titre: TRAD("Le laser éclaire un trou de 0,1 mm de diamètre ; l'écran est à 1,65 m : une tache d'Airy, dont le premier anneau sombre a pour rayon 1,22 λD/d ≈ 13 mm, entourée d'anneaux bien plus faibles (1,7 % du centre pour le premier). Agrandir le trou : la tache rétrécit, tant que le trou reste plus petit que le faisceau (0,8 mm)."),
    vue: "dessus", aides: {}, zoom: 3, f: function (st) { auLaser(st, "trouSource", { d: 0.1 }); } };
  // Fraunhofer à deux lentilles : fente source au foyer d'une lentille de 200 mm, fente fine dans le faisceau parallèle,
  // écran au foyer d'une lentille de 300 mm (tache centrale de demi-largeur λf′/e). Au sodium, les fentes sont ouvertes
  // (0,5 mm et 200 µm) pour avoir assez de lumière en luminosité réelle — l'image de la fente source (0,75 mm) reste
  // plus petite que la demi-largeur de la tache (0,9 mm) ; en lumière blanche (lanterne, bien plus vive) on garde les
  // fentes fermées (0,1 mm) pour préserver le contraste des irisations.
  function fraunhofer(st, lampe, b, e) {
    if (lampe === "lanterne") poser(st, "lanterne", 80, { tirage: tirageVers(150) }); else poser(st, lampe, 200);
    poser(st, "fenteSource", 230, { b: b }); poser(st, "l200", 430); poser(st, "fente", 480, { e: e }); poser(st, "l300", 530); poser(st, "ecran", 830);
  }
  MONTAGES.fraunhofer = { nom: TRAD("Fraunhofer à deux lentilles"), titre: TRAD("La lampe à sodium éclaire une fente source ouverte à 0,5 mm au foyer d'une lentille de 200 mm ; une fente fine de 200 µm dans le faisceau parallèle, l'écran au foyer d'une lentille de 300 mm : la figure de diffraction à l'infini, tache centrale de demi-largeur λf′/e ≈ 0,9 mm. Élargir la fente source au-delà de 1 mm : son image recouvre la tache, les taches latérales se fondent."),
    vue: "dessus", aides: { faisceau: true }, zoom: 15, f: function (st) { fraunhofer(st, "sodium", 0.5, 0.2); } };
  MONTAGES.fenteBlanc = { nom: TRAD("Fente en lumière blanche"), titre: TRAD("Le même montage éclairé par la lanterne, fentes plus fermées (0,1 mm) : chaque couleur diffracte à sa propre échelle λf′/e. La tache centrale est blanche, bordée de rouge ; les taches latérales sont irisées, bleues vers le centre, rouges vers l'extérieur."),
    vue: "dessus", aides: { faisceau: true }, zoom: 15, f: function (st) { fraunhofer(st, "lanterne", 0.1, 0.1); } };
  // De Fresnel à Fraunhofer : faisceau élargi à 8 mm (comme `elargir`, presque plan sur 1 mm), trou de 1 mm, écran à
  // D : nombre de Fresnel N = a²/λD (a = 0,5 mm : 395 mm / D). En optique réelle, la lentille de 100 mm est mise au
  // point AVANT de poser le trou (sans lui : `mettreAuPoint` vise l'image de la source, le trou en serait l'objet).
  MONTAGES.fresnel = { nom: TRAD("De Fresnel à Fraunhofer"), titre: TRAD("Le faisceau du laser, élargi à 8 mm, éclaire un trou de 1 mm ; l'écran est à 1,65 m : une tache d'Airy de 1,3 mm de rayon, plus large que le trou (diffraction de Fraunhofer). Rapprocher l'écran : la tache se resserre jusqu'à la taille du trou vers 40 cm, puis son centre s'assombrit et devient noir à 20 cm, entouré d'un anneau brillant (diffraction de Fresnel)."),
    vue: "dessus", aides: {}, zoom: 30,
    f: function (st) {
      poser(st, "laser", 100); poser(st, "objectif", 200); var L = poser(st, "l100", 310); poser(st, "ecran", 2000);
      mettreAuPoint(st, [L]); poser(st, "trouSource", 350, { d: 1 });
    } };
  // Réseau de 100 traits/mm dans le faisceau parallèle, écran au foyer d'une lentille de 200 mm : ordre p d'une raie λ
  // en x = f′ tan(arcsin(p λ n)) (546,1 nm, ordre 1 : 10,94 mm). Fibre du spectromètre posée sur cette raie.
  function reseau(st, lampe) {
    if (lampe === "lanterne") poser(st, "lanterne", 80, { tirage: tirageVers(150) }); else poser(st, "mercure", 200);
    poser(st, "fenteSource", 230, { b: 0.1 }); poser(st, "l200", 430); poser(st, "reseau", 480, { n: 100 }); poser(st, "l200", 530); poser(st, "ecran", 730);
  }
  MONTAGES.reseauMercure = { nom: TRAD("Réseau à la lampe à mercure"), titre: TRAD("La lampe à mercure nue, toutes raies, éclaire une fente source au foyer d'une lentille de 200 mm ; un réseau de 100 traits par millimètre dans le faisceau parallèle, l'écran au foyer d'une seconde lentille de 200 mm : de part et d'autre de l'ordre 0, où toutes les raies se superposent, chaque raie donne une image de la fente, d'autant plus déviée que sa longueur d'onde est grande (sin θ = pnλ). La fibre du spectromètre est posée sur la raie verte d'ordre 1, à 10,9 mm : la glisser sur les autres."),
    vue: "dessus", aides: { faisceau: true }, zoom: 3, fibre: [10.94, 0], f: function (st) { reseau(st, "mercure"); } };
  MONTAGES.reseauBlanc = { nom: TRAD("Réseau en lumière blanche"), titre: TRAD("La lanterne à la place de la lampe : chaque ordre étale tout le spectre, du violet, le moins dévié, au rouge. Le spectre d'ordre 2 est deux fois plus large que celui d'ordre 1, et son rouge se mêle au violet de l'ordre 3."),
    vue: "dessus", aides: { faisceau: true }, zoom: 3, f: function (st) { reseau(st, "lanterne"); } };
  MONTAGES.youngMercure = { nom: TRAD("Young au mercure"), titre: TRAD("La lampe à mercure et un filtre interférentiel vert (546,1 nm) dans le montage de Young : des franges vertes d'interfrange λf′/a ≈ 0,44 mm, un peu plus serrées qu'au sodium. Élargir la fente source : elles disparaissent quand sa largeur atteint λf′/a, 0,44 mm, puis reviennent, inversées."),
    vue: "dessus", aides: { faisceau: true }, zoom: 32, f: function (st) { young(st, "mercure", 0.1); } };
  var INCL_MAX = 3, INCL_LENTILLE = 30;
  // Pièces qu'on décale latéralement (x) à tous les niveaux : vis de translation sur le cavalier (vue de dessus), réglette
  // au bandeau. Au niveau 3, toutes les pièces se décentrent, en hauteur et sur le côté (neutre).
  var DECALABLE = { laser: 1, fenteSource: 1, fente: 1, bifentes: 1, trousYoung: 1, fentesMultiples: 1, reseau: 1 };
  function inclinaison(e) { return e.incl ? e.incl[0] * 180 / Math.PI : 0; }
  function incliner(e, deg) { var m = e.type === "lentille" ? INCL_LENTILLE : INCL_MAX; deg = clamp(Math.round(deg * 100) / 100, -m, m); e.incl = [deg * Math.PI / 180, 0]; return e; }
  // Tiroirs communs à TOUS les matériels, une seule définition ; un matériel n'y ajoute
  // que son tiroir de spécialité (`special`), et les niveaux 2 et 3 un tiroir « Autres » (les spécialités des autres
  // matériels). Le niveau 1 garde l'étagère réduite d'avant (`etagere1`). Tiroirs du profil : `tiroirsDe`.
  // La grande lentille (l150d) n'est plus à l'étagère : gardée dans PIECES pour les bancs sauvés qui l'ont.
  var LENTILLES_ETAGERE = C.LENTILLES.map(function (L) { return "l" + L[0]; }).concat("objectif", "miroir");
  var TIROIRS_COMMUNS = [{ nom: "Sources", pieces: ["lanterne", "sodium", "mercure", "laser", "laserVert"] },
    { nom: "Objets et diaphragmes", pieces: ["lettreF", "quadrillage", "regle", "depoli", "diapo", "imageEclairee", "fenteSource", "trouSource", "iris"] },
    { nom: "Lentilles et miroirs", pieces: LENTILLES_ETAGERE }, { nom: "Filtres", pieces: ["filtre", "densite"] },
    { nom: "Observer", pieces: ["ecran", "capteur", "oeil", "viseur", "lunette"] }];
  var T_FENTES = { nom: "Fentes et réseaux", pieces: ["bifentes", "trousYoung", "fentesMultiples", "fente", "reseau", "fil"] },
    T_FOURIER = { nom: "Fourier", pieces: ["grilleCroisee", "objetPhase", "pastille", "couteau", "fente"] },
    T_POLA = { nom: "Polarisation", pieces: ["polariseur", "lameD", "lameQ"] };
  var BACS = {
    // Les clés (revisions, young) sont celles du méta `bac:` et de la mémoire du navigateur : ne pas les renommer ; les
    // noms montrés sont libres. `optique` : celle de la première ouverture du matériel seulement (ensuite, l'optique en
    // cours passe d'un montage et d'un matériel à l'autre) ; `ouvert` : le tiroir ouvert au départ.
    revisions: { nom: TRAD("Optique géométrique"), quoi: TRAD("lanterne, objets, lentilles, miroir, écran, œil, viseur, lunette."), optique: "parfaite", vue: "profil", clair: true, depart: "depart",
      special: [], ouvert: "Lentilles et miroirs", autres: false,
      etagere1: [{ nom: "Sources", pieces: ["lanterne"] }, { nom: "Objets et diaphragmes", pieces: ["lettreF", "quadrillage", "regle", "depoli", "trouSource", "iris", "diapo", "imageEclairee"] },
        { nom: "Lentilles et miroirs", pieces: LENTILLES_ETAGERE }, { nom: "Observer", pieces: ["ecran", "capteur", "oeil", "viseur", "lunette", "densite"] }],
      montages: ["image", "quatref", "infini", "projection", "bessel", "silbermann", "stigmatisme", "photo", "loupe", "astro", "viseur", "lunette", "autocollimation",
        "microscope", "galilee", "terrestre", "champ", "condenseur", "ouverture", "champIris", "myope", "chromatisme", "astigmatisme", "badal", "virtuelle",
        "aberration"] },
    // Interférences et diffraction (fusionnés ; la clé `diffraction` a
    // disparu : une clé de bac inconnue ouvre le matériel par défaut). Valeurs encore en clair (lecture à la règle et
    // valeurs vraies tirées).
    young: { nom: TRAD("Interférences et diffraction"), quoi: TRAD("lampes, laser, fente source, bifentes, trous d'Young, fentes multiples, fente fine, réseau, cheveu, dépoli."), optique: "reelle", vue: "dessus", clair: true, depart: "young",
      special: [T_FENTES], ouvert: "Fentes et réseaux",
      etagere1: [{ nom: "Sources", pieces: ["sodium", "mercure", "lanterne", "laser"] }, { nom: "Objets et diaphragmes", pieces: ["fenteSource", "trouSource", "iris", "depoli"] },
        { nom: "Lentilles et miroirs", pieces: ["objectif", "l100", "l200", "l300", "l500", "miroir"] }, T_FENTES,
        { nom: "Filtres", pieces: ["filtre"] },     // le filtre interférentiel de la lampe au mercure (montages de niveau 1)
        { nom: "Observer", pieces: ["ecran", "capteur", "oeil", "lunette", "densite"] }],
      montages: ["youngBlanc", "youngMercure", "youngLaser", "trousLaser", "barretteLaser", "multiples", "fenteLaser", "fraunhofer", "fenteBlanc", "airy", "fresnel",
        "reseauLaser", "reseauMercure", "reseauBlanc", "cheveu", "elargir"] },
    // Optique de Fourier : montage 4f, filtrage au plan focal.
    fourier: { nom: TRAD("Optique de Fourier"), quoi: TRAD("montage 4f : objets (grille, objet de phase), filtres (fente, pastille, couteau, iris)."), optique: "reelle", vue: "dessus", clair: true, depart: "abbe",
      special: [T_FOURIER], ouvert: "Fourier",
      etagere1: [{ nom: "Sources", pieces: ["mercure", "laser", "lanterne"] }, { nom: "Objets et diaphragmes", pieces: ["trouSource", "fenteSource", "iris", "lettreF", "diapo"] },
        { nom: "Lentilles et miroirs", pieces: ["objectif", "l100", "l200", "l300", "l500", "miroir"] }, T_FOURIER,
        { nom: "Filtres", pieces: ["filtre"] },     // le filtre interférentiel de la lampe au mercure (montages de niveau 1)
        { nom: "Observer", pieces: ["ecran", "capteur", "densite"] }],
      montages: ["spectreGrille", "spectreTrame", "strioscopie", "fondNoir", "trame", "lignes", "passeBas", "orientation", "contours"] },
    // Polarisation (lumière naturelle de la lanterne ou du laser, polariseurs, lames ; photodiode sur l'écran).
    polarisation: { nom: TRAD("Polarisation"), quoi: TRAD("lanterne, laser, polariseurs, lames demi-onde et quart d'onde, filtres, photodiode."), optique: "parfaite", vue: "profil", clair: true, depart: "malus",
      special: [T_POLA], ouvert: "Polarisation",
      etagere1: [{ nom: "Sources", pieces: ["lanterne", "laser", "sodium", "mercure"] }, { nom: "Objets et diaphragmes", pieces: ["trouSource", "iris", "lettreF"] },
        { nom: "Lentilles et miroirs", pieces: ["l100", "l200", "l300", "l500"] }, { nom: "Polarisation", pieces: ["polariseur", "lameD", "lameQ", "filtre"] },
        { nom: "Observer", pieces: ["ecran", "capteur", "oeil", "densite"] }],
      montages: ["croises", "demiOnde", "quartOnde", "lameBlanc"] }
  };
  // Tiroirs de l'étagère d'un matériel selon le profil (pièces filtrées par `piecePermise`, tiroirs vides retirés) :
  // niveau 1, l'étagère réduite ; sinon les tiroirs communs, la spécialité avant « Observer », puis « Autres ».
  // `autres: false` (Optique géométrique) : pas de tiroir « Autres », ni à l'étagère ni au clic droit (Remplacer par,
  // Poser ici) : ni fentes, ni Fourier, ni polarisation dans ce matériel.
  function tiroirsDe(bac, prof) {
    var B = BACS[bac] || BACS.revisions, T;
    if (prof && prof.n === 1 && B.etagere1) T = B.etagere1;
    else {
      T = TIROIRS_COMMUNS.slice(0, 4).concat(B.special, TIROIRS_COMMUNS.slice(4));
      var la = {}, autres = [];
      T.forEach(function (t) { t.pieces.forEach(function (c) { la[c] = 1; }); });
      Object.keys(BACS).forEach(function (b) { BACS[b].special.forEach(function (t) { t.pieces.forEach(function (c) { if (!la[c]) { la[c] = 1; autres.push(c); } }); }); });
      if (autres.length && B.autres !== false) T = T.concat({ nom: "Autres", pieces: autres });   // « Autres » : clé de tiroir, traduite au libellé (ongletsEtagere)
    }
    return T.map(function (t) { return { nom: t.nom, pieces: t.pieces.filter(function (c) { return piecePermise(c, prof); }) }; }).filter(function (t) { return t.pieces.length; });
  }
  // Montages rangés par thème (menu en colonnes, mode prof) ; un bac ne montre que les thèmes qui ont de ses montages.
  var THEMES = [[TRAD("Former une image"), ["image", "quatref", "infini", "virtuelle", "projection"]], [TRAD("Mesurer une focale"), ["bessel", "silbermann", "autocollimation", "badal"]],
    ["Instruments", ["loupe", "microscope", "astro", "galilee", "terrestre", "champ", "viseur", "lunette", "photo", "condenseur"]],
    [TRAD("Diaphragmes et œil"), ["ouverture", "champIris", "myope"]], ["Aberrations", ["stigmatisme", "aberration", "chromatisme", "astigmatisme"]],
    [TRAD("Interférences"), ["young", "youngBlanc", "youngMercure", "youngLaser", "trousLaser", "barretteLaser", "multiples"]],
    ["Diffraction", ["fenteLaser", "fraunhofer", "fenteBlanc", "airy", "fresnel", "cheveu", "elargir"]], [TRAD("Réseaux"), ["reseauLaser", "reseauMercure", "reseauBlanc"]],
    [TRAD("Voir le spectre"), ["spectreGrille", "spectreTrame"]], [TRAD("Filtrer"), ["abbe", "strioscopie", "fondNoir", "trame", "lignes", "passeBas", "orientation", "contours"]],
    [TRAD("Polarisation"), ["malus", "croises", "demiOnde", "quartOnde", "lameBlanc"]]];
  // Matériel d'origine de chaque montage (pièces d'un montage lues hors de son matériel : montagePermis).
  var ORIGINE = {};
  Object.keys(BACS).forEach(function (b) { [BACS[b].depart].concat(BACS[b].montages).forEach(function (id) { if (!ORIGINE[id]) ORIGINE[id] = b; }); });
  function groupesDe(B) {
    var ids = [B.depart].concat(B.montages);
    return THEMES.map(function (t) { return { nom: t[0], liste: t[1].filter(function (id) { return ids.indexOf(id) >= 0; }) }; }).filter(function (g) { return g.liste.length; });
  }
  // Montages du menu selon le profil : `niveau` du montage (Astigmatisme : 3, l'inclinaison des lentilles) ; au niveau
  // 1, ni ceux qui exigent l'optique réelle (`seule: "reelle"`) ou posent une mesure, ni ceux qui posent une pièce que
  // le profil n'offre pas (le capteur de l'appareil photo) ; pièces lues une fois par montage.
  var PIECES_DE = {};
  function montagePermis(id, prof) {
    var m = MONTAGES[id];
    if (!prof) return true;
    if (m.niveau && prof.n < m.niveau) return false;
    if (prof.mesures && !prof.observer) return true;
    if (!prof.mesures && (m.seule === "reelle" || m.barrette || m.photodiode || m.fibre)) return false;
    if (!PIECES_DE[id]) PIECES_DE[id] = monter({ v: 1, bac: ORIGINE[id] || "revisions", graine: 1, n: 0, elements: [], cahier: [] }, id).elements.map(function (e) { return e.cle; });
    return PIECES_DE[id].every(function (c) { return piecePermise(c, prof); });
  }

  // ================= niveaux =================
  // Un PROFIL dit ce que l'interface offre : toute commande passe par lui, jamais un `hidden` décidé ailleurs. Le niveau
  // est hors de l'état (mémoire `niveaux` du navigateur, par matériel ; défaut : méta `niveau` de la carte, sinon 2).
  // Descendre ne détruit rien : ce que le profil impose (optique) est appliqué au calcul et à l'affichage,
  // l'état garde ses valeurs (decentrable / inclinable : `neutre`).
  var PROFILS = {
    1: { n: 1, optique: "parfaite", luminosite: null, lumDefaut: "reelle", interOptique: false, reglages: true, mesures: false,
      observer: ["ecran", "oeil", "viseur", "lunette"], decentrable: false, inclinable: false, positions: true },
    2: { n: 2, optique: null, luminosite: null, interOptique: true, reglages: true, mesures: true, observer: null, decentrable: false, inclinable: false, positions: true },
    3: { n: 3, optique: null, luminosite: null, interOptique: true, reglages: true, mesures: true, observer: null, decentrable: true, inclinable: true, positions: true }
  };
  function niveauDepart(meta) { var n = Math.round(+(meta && meta.niveau)); return PROFILS[n] ? n : 2; }
  // Pièce permise par le profil : le tiroir « Observer » du niveau 1 n'a qu'écran, œil, viseur et lunette.
  function piecePermise(cle, prof) { var t = PIECES[cle].type; return !prof || !prof.observer || !TYPES_OBSERVER[t] || prof.observer.indexOf(t) >= 0; }
  var TYPES_OBSERVER = { ecran: 1, capteur: 1, oeil: 1, viseur: 1, lunette: 1, densite: 1 };

  // ================= récepteurs =================
  // Récepteur : écran, capteur, œil posés, viseur ou lunette avec leur œil intégré. Celui qui observe est `st.recep`
  // (pastilles au-dessus de l'image) ; ceux qui sont devant lui sont escamotés d'office (hors de la séquence, dessinés
  // relevés), rien n'est stocké pour eux : ils reviennent dès qu'on en choisit un autre ou qu'on retire le choisi.
  // Rien de choisi : le premier sur le trajet observe, comme le cœur l'a toujours fait.
  function estRecepteur(e) { return e.type === "ecran" || e.type === "capteur" || e.type === "oeil" || ((e.type === "viseur" || e.type === "lunette") && C.params(e).oeil !== "aucun"); }
  function recepteurs(st) { return st.elements.filter(estRecepteur).sort(function (a, b) { return a.z - b.z; }); }
  function recepChoisi(st) { var c = st.recep ? trouver(st, st.recep) : null; return c && estRecepteur(c) && !c.esc ? c : null; }
  // "main" : escamotée à la main (`e.esc`) ; "auto" : récepteur devant celui qui observe ; "" : en place.
  function escamote(st, e) {
    if (e.esc) return "main";
    var c = recepChoisi(st);
    return c && e !== c && estRecepteur(e) && e.z < c.z ? "auto" : "";
  }

  // ================= mise au point des montages types en optique réelle =================
  // Les positions des montages sont calculées en optique parfaite (lentilles minces). En optique réelle, l'épaisseur
  // des lentilles (plans principaux écartés de ~t/3) et le chromatisme (focales exactes à 587,6 nm, lumière blanche
  // regardée vers 550) décalent les images de quelques millimètres (γ = −2 : 3 mm ; microscope : image finale devant
  // l'œil). `mise` (table MISE) désigne la pièce que l'expérimentateur règle (écran, capteur, lentille, oculaire, règle
  // du microscope, viseur) et celles qui la suivent (l'œil derrière l'oculaire) ; `mettreAuPoint` la déplace jusqu'à
  // retrouver, en optique réelle, la conjugaison de l'optique parfaite : même écart entre l'image finale et le détecteur
  // (rétine comprise), ou image à l'infini. Critère sur la matrice objet → détecteur (images du cœur) :
  // (image − détecteur − écart) × D (D = 0 : infini), affine pour un détecteur déplacé, résolu par la sécante.
  function lambdaMise(sq) { var sp = sq && sq.source ? sq.source.sp : null; return !sp || sp.type === 0 ? 550 : sp.l[0]; }
  // Matrice objet → dernière primitive avant le détecteur (images du cœur) et distance h de celle-ci au détecteur.
  function matriceMise(st) {
    var sq = C.sequence(banc(st));
    if (!sq || !sq.prims || !sq.prims.length || !(sq.iDet > 0)) return null;
    var im = C.images(sq, lambdaMise(sq), sq.objet >= 0 ? sq.objet : -1);      // sans objet (laser) : depuis la source
    return im ? { M: im.M, h: sq.prims[sq.iDet].s - sq.prims[sq.iDet - 1].s } : null;
  }
  function mettreAuPoint(st, quoi) {
    if (st.optique !== "reelle" || !quoi || !quoi[0]) return;
    var e = quoi[0], suit = quoi.slice(1), z0 = e.z, opt = st.optique;
    st.optique = "parfaite"; var R = matriceMise(st); st.optique = opt;
    if (!R) return;
    // écart = image finale − détecteur en optique parfaite ; g = (image − détecteur − écart) × D, sans pôle en D = 0
    var infini = Math.abs(R.M[3]) < 1e-12, ecart = infini ? 0 : -R.M[1] / R.M[3] - R.h;
    var z0s = suit.map(function (q) { return q.z; });
    function placer(z) { e.z = z; suit.forEach(function (q, i) { q.z = z0s[i] + z - z0; }); }
    function g(z) { placer(z); var N = matriceMise(st); return N ? (infini ? N.M[3] : -N.M[1] - (N.h + ecart) * N.M[3]) : NaN; }
    var za = z0, ga = g(za), zb = z0 + 0.5, gb = g(zb), k, sansEffet = !(gb !== ga);      // la pièce n'agit pas sur l'image visée : on la laisse
    for (k = 0; k < 40 && isFinite(ga) && isFinite(gb) && gb !== ga; k++) {
      var zc = zb - gb * (zb - za) / (gb - ga);
      za = zb; ga = gb; zb = zc; gb = g(zb);
      if (Math.abs(zb - za) < 1e-5) break;
    }
    var z = Math.round(1e6 * zb) / 1e6;      // pas d'arrondi au centième : au microscope (γ = −20), 0,01 mm de la règle = 10 δ à l'oculaire
    if (sansEffet || !isFinite(gb) || !isFinite(z) || Math.abs(z - z0) > 50) z = z0;      // pas de solution proche : on laisse
    placer(z);
    suit.forEach(function (q) { q.z = Math.round(1e6 * q.z) / 1e6; });
  }
  function dernier(st, types) { var r = null; st.elements.forEach(function (e) { if (types.indexOf(e.type) >= 0) r = e; }); return r; }
  function premier(st, type) { for (var i = 0; i < st.elements.length; i++) if (st.elements[i].type === type) return st.elements[i]; return null; }
  var MISE_DET = function (st) { return [dernier(st, ["ecran", "capteur"])]; },
    MISE_LENT = function (st) { return [premier(st, "lentille")]; },
    MISE_OCUL = function (st) { return [dernier(st, ["lentille"]), dernier(st, ["oeil"])]; };
  // « Écran trop proche », « Montage de départ » : pas d'image nette au départ, voulu ; Stigmatisme et Chromatisme
  // posent leur capteur eux-mêmes ; l'œil myope (lentille de −500 mm) ne bouge pas ; « Lunette et objet à l'infini »
  // garde sa lentille dans son plan focal (titre), la lunette elle-même est réglée à l'infini en optique réelle (cœur).
  var MISE = { image: MISE_DET, projection: MISE_DET, silbermann: MISE_DET, photo: MISE_DET, ouverture: MISE_DET,
    champIris: MISE_DET, condenseur: MISE_DET,
    bessel: MISE_LENT, infini: MISE_LENT, loupe: MISE_LENT, autocollimation: MISE_LENT,
    astro: MISE_OCUL, galilee: MISE_OCUL, terrestre: MISE_OCUL, champ: MISE_OCUL, badal: MISE_DET,
    microscope: function (st) { return [premier(st, "regle")]; }, elargir: function (st) { return [dernier(st, ["lentille"])]; }, viseur: function (st) { return [premier(st, "viseur")]; },
    virtuelle: function (st) { return [premier(st, "viseur")]; } };
  // Montage resté tel qu'il a été posé (rien déplacé ni réglé) : changer d'optique le repose, réglé pour la nouvelle.
  // `st.montage` = son identifiant, `st.montageSig` = l'empreinte des pièces après la pose.
  function signature(st) {
    return JSON.stringify(st.elements.map(function (e) { return [e.cle, e.z, e.x, e.y, e.rot, e.incl, e.params, e.esc]; }));
  }
  function intact(st) { return !!(st.montage && MONTAGES[st.montage] && st.montageSig === signature(st)); }
  // Mêmes pièces que le montage posé (réglages, positions, décentrements libres ; une pièce ajoutée, rangée ou remplacée
  // le défait) : la note du montage (nom et description) reste affichée sous l'observation tant que c'est vrai.
  // État sauvé avant `montageCles` : repli sur `intact`.
  function clesDe(st) { return JSON.stringify(st.elements.map(function (e) { return e.cle; }).sort()); }
  function memesPieces(st) {
    if (!st.montage || !MONTAGES[st.montage]) return false;
    return st.montageCles != null ? st.montageCles === clesDe(st) : intact(st);
  }
  // Change l'optique ; repose le montage s'il est intact (positions seulement : aides, observation, pose gardées).
  // Rend vrai si des pièces ont bougé.
  function changerOptique(st, optique) {
    var etait = intact(st);
    st.optique = optique;
    if (!etait) return false;
    var t = monter({ v: 1, bac: st.bac, graine: st.graine, n: 0, elements: [], cahier: [] }, st.montage, optique), bouge = false;
    if (t.elements.length !== st.elements.length) return false;
    t.elements.forEach(function (q, i) { var e = st.elements[i]; if (e.cle === q.cle && e.z !== q.z) { e.z = q.z; bouge = true; } });
    st.montageSig = signature(st);
    return bouge;
  }

  function obsDepart() { return { ecran: { zoom: 1, cx: 0, cy: 0 }, capteur: { N: CAPTEUR_N[0], cx: 0, cy: 0 }, oeil: { zoom: 1, cx: 0, cy: 0 } }; }
  function monter(st, id, optique) {
    var m = MONTAGES[id], B = BACS[st.bac], k;
    st.elements = []; st.sel = null; st.selL = []; st.faceFix = null; delete st.cam; delete st.recep;
    // Optique : celle qu'impose le montage (`seule`), sinon celle demandée, sinon celle en
    // cours (l'état), sinon (première ouverture du matériel) celle du matériel.
    st.optique = m.seule || optique || st.optique || B.optique; st.vue = m.vue || B.vue;
    st.aides = { faisceau: false, pinceau: false, spot: false, construction: false, rebours: false, pola: false };
    st.photo = { on: !!m.photodiode, x: 0, y: 0, cal: 0 };
    // Réglages de la barrette gardés d'un montage à l'autre (comme ceux de la fibre) : réel/parfait et sa longueur.
    st.barr = { on: !!m.barrette, x: 0, y: 0, ang: 0, reel: st.barr && st.barr.reel != null ? !!st.barr.reel : true, L: st.barr && st.barr.L || 150 };
    if (st.fibre) st.fibre.on = false;      // comme la photodiode et la barrette : la fibre est posée par le montage (`fibre: [x, y]`) ou retirée
    if (m.fibre) { var fb = st.fibre || { reel: false, zoom: false }; fb.on = true; fb.x = m.fibre[0]; fb.y = m.fibre[1]; st.fibre = fb; }
    st.integ = 3;
    st.pointObs = { x: 0, y: 0 };
    for (k in m.aides || {}) st.aides[k] = m.aides[k];
    st.pinceau = { h: 0 }; st.obs = obsDepart(); if (m.zoom) st.obs.ecran.zoom = m.zoom;
    st.pose = 6; st.poseAuto = !!m.poseAuto;
    m.f(st);
    if (MISE[id]) mettreAuPoint(st, MISE[id](st));
    st.montage = id; st.montageSig = signature(st); st.montageCles = clesDe(st);
    return st;
  }
  function etatDepart(bac) {
    bac = BACS[bac] ? bac : "revisions";
    return monter({ v: 1, bac: bac, graine: 1, n: 0, elements: [], cahier: [] }, BACS[bac].depart);
  }
  // États gardés d'avant la barrette posée sur l'écran : la pièce « barrette » du rail redevient un écran, barrette posée.
  function migrerBarrette(st) {
    if (!st || !Array.isArray(st.elements)) return st;
    st.elements.forEach(function (e) {
      if (e.cle !== "barrette") return;
      e.cle = "ecran"; if (e.params) delete e.params.barrette;
      st.barr = { on: true, x: 0, y: 0, ang: 0 }; if (st.photo) st.photo.on = false; if (st.fibre) st.fibre.on = false;
    });
    return st;
  }
  // États gardés d'avant la lampe au mercure nue : une lampe dont le paramètre `filtre` n'était pas `false` (défaut
  // d'autrefois, `true`, ou clé absente) portait sa propre raie verte ; elle redevient nue, et le filtre interférentiel
  // se pose devant elle, comme le fait `lampeMercure` pour les montages. Un état qui a déjà le maximum de filtres
  // (`PIECES.filtre.max`) garde sa lampe filtrée : la pièce de plus serait refusée à l'étagère.
  function migrerMercure(st) {
    if (!st || !Array.isArray(st.elements)) return st;
    var n = 0;
    st.elements.forEach(function (e) { if (e.type === "filtre") n++; });
    st.elements.forEach(function (e) {
      if (e.type !== "spectrale" || !e.params || e.params.gaz === "na" || e.params.filtre === false) return;
      if (n >= PIECES.filtre.max) return;
      e.params.filtre = false; n++;
      st.n = (st.n || 0) + 1;
      st.elements.push({ type: "filtre", id: "e" + st.n, cle: "filtre", z: e.z + Z_FILTRE_MERCURE, x: 0, y: 0, params: { couleur: "interferentiel" } });
    });
    return st;
  }
  function valide(st) {
    return !!(st && st.v === 1 && BACS[st.bac] && Array.isArray(st.elements) && st.aides && st.obs && st.obs.ecran && st.obs.capteur &&
      st.elements.every(function (e) { return C.TYPES[e.type] && PIECES[e.cle] && isFinite(e.z); }));
  }
  // ================= observation =================
  // Instrument (viseur, lunette) juste devant l'œil qui observe, posé ou implicite ; null sinon.
  function instrumentDe(seq, st) {
    if (!seq || !seq.detEl || seq.detEl.type !== "oeil" || !seq.etapes || seq.etapes.length < 2) return null;
    var e = trouver(st, seq.etapes[seq.etapes.length - 2].id);
    return e && C.TYPES[e.type].instrument && !(seq.implicite && C.params(e).oeil === "aucun") ? e : null;
  }
  // Détecteur : écran, capteur ou œil posés ; sans eux, l'œil que le cœur place derrière un viseur ou une lunette.
  // Rien n'est observé sinon (l'œil implicite en bout de banc du cœur ne sert pas ici).
  function detecteur(seq, st) {
    if (!seq || !seq.det || !seq.detEl) return null;
    var t = seq.detEl.type;
    if (seq.implicite) return st && instrumentDe(seq, st) ? "oeil" : null;
    if (seq.miroir) return C.TYPES[t].plaque ? "plaque" : null;      // retour d'un miroir : la face blanche de l'objet
    return t === "ecran" || t === "capteur" || t === "oeil" ? t : null;
  }
  // Fenêtre observée sur le détecteur (demi-largeur W, centre) et affichage ; borne le centre dans l'état.
  function fenetre(st, det) {
    var o = st.obs[det] || (st.obs[det] = { zoom: 1, cx: 0, cy: 0 });
    if (det === "oeil") {
      o.zoom = clamp(o.zoom, 1, ZOOM_OEIL_MAX);
      var Wo = W_OEIL / o.zoom;
      o.cx = clamp(o.cx, -(W_OEIL - Wo), W_OEIL - Wo); o.cy = clamp(o.cy, -(W_OEIL - Wo), W_OEIL - Wo);
      return { W: Wo, cx: o.cx, cy: o.cy, res: 512, expo: 1, auto: true, comp: COMP_VISIBLE, fond: [0, 0, 0], net: false, vue: { Wg: W_OEIL, retine: true } };
    }
    if (det === "capteur") {
      var W = o.N * PIXEL / 2;
      o.cx = arrondi(clamp(o.cx, -(3.2 - W), 3.2 - W), 2 * PIXEL); o.cy = W >= 2.4 ? 0 : arrondi(clamp(o.cy, -(2.4 - W), 2.4 - W), 2 * PIXEL);
      var res = Math.min(o.N, 640), ppt = o.N / res, iso = isoDe(st);      // pixels par texel (de côté)
      var Ne = PUITS * 100 / iso;      // photoélectrons d'un pixel saturé
      return { W: W, cx: o.cx, cy: o.cy, res: res, expo: K_CAPTEUR * iso / 100 * POSES[st.pose], absolu: true, comp: 1, fond: [0, 0, 0], net: o.N <= 320,
        bruit: 1 / (Ne * ppt * ppt), photo: { lect: LECTURE / (Ne * ppt), voile: VOILE_OBJ, aire: AIRE_CAPTEUR,
          // bords du capteur (±3,2 × ±2,4 mm) en fraction de la fenêtre : le shader n'affiche rien au-delà
          cap: [(-3.2 - o.cx + W) / (2 * W), (-2.4 - o.cy + W) / (2 * W), (3.2 - o.cx + W) / (2 * W), (2.4 - o.cy + W) / (2 * W)] } };
    }
    o.zoom = clamp(o.zoom, 1, ZOOM_ECRAN_MAX);
    var W0 = det === "plaque" ? W_PLAQUE : 100, We = W0 / o.zoom;
    o.cx = clamp(o.cx, -(W0 - We), W0 - We); o.cy = clamp(o.cy, -(W0 - We), W0 - We);
    return { W: We, cx: o.cx, cy: o.cy, res: 512, expo: 1, auto: true, comp: COMP_VISIBLE, fond: [0, 0, 0], net: false, vue: { Wg: W0 } };
  }
  // Consigne de sécurité : le laser arrive dans un œil (posé, ou derrière un viseur ou une lunette) sans être passé
  // par un dépoli ni une diapo éclairée (lumière diffusée : on regarde une tache, plus le faisceau).
  function laserDansOeil(seq, st, det) {
    if (det !== "oeil" || !seq || !seq.source || seq.source.em.forme !== "gauss") return false;
    return !seq.etapes.some(function (et) { var e = trouver(st, et.id); return e && (e.type === "depoli" || (e.type === "diapo" && C.params(e).eclairee)); });
  }
  // Vue « œil » en luminosité réelle : réglages de `vision` pour le moteur.
  // Écran (et plaque) : L = ρE/π, regardé des deux yeux à VISION.dObs ; rétine : luminance équivalente
  // 289 E / aire de la pupille TRACÉE (pup, celle passée à `sequence` ; défaut : paramètre de l'œil, 4 mm), un œil,
  // champ = la rétine entière. Rapport scotopique : spectre de raies de la source (filtres ignorés), −1 pour un continu
  // (approximation XYZ dans `vision`). Halo de la CIE sur les deux vues. visible : vue « toujours visible »,
  // l'adaptation ne sert plus qu'à la pupille (affiche: false).
  function visionDe(fen, seq, pup, visible) {
    var V = MI_.VISION, sc = seq && seq.source ? MI_.rapportScotopique(seq.source.nomSpectre) : null, o;
    if (fen.vue.retine) {
      pup = pup || (seq && seq.detEl && C.params(seq.detEl).pupille) || 4;
      o = { s: 289 / (Math.PI * pup * pup / 4), omega: 3283 / (V.retine * V.retine), M: 0.1, pup: pup };
    } else o = { s: V.rho / Math.PI, omega: 3283 / (V.dObs * V.dObs), M: 1 };
    o.Wg = fen.vue.Wg; o.Fsalle = 3283 * V.Esalle; o.salle = V.Lsalle; o.scot = sc == null ? -1 : sc; o.halo = true;
    if (visible) o.affiche = false;
    return o;
  }
  // Pose (indice de POSES) qui amène l'éclairement E (99e centile du capteur) vers la cible.
  function poseVoulue(E, iso) {
    if (!(E > 0)) return POSES.length - 1;
    var t = CIBLE_POSE / (K_CAPTEUR * (iso || 100) / 100 * E), best = 0;      // la plus longue qui ne dépasse pas la cible
    POSES.forEach(function (p, i) { if (p <= t * 1.001) best = i; });
    return best;
  }
  function nomPose(i) { var p = POSES[i]; return p < 1 ? "1/" + Math.round(1 / p) + " s" : p + " s"; }

  // ================= faisceau : enveloppe au paraxial affine =================
  function couper(poly, a, b, c) {         // garde a·y + b·v ≤ c (Sutherland-Hodgman)
    var out = [], n = poly.length;
    for (var k = 0; k < n; k++) {
      var P = poly[k], Q = poly[(k + 1) % n], fp = a * P[0] + b * P[1] - c, fq = a * Q[0] + b * Q[1] - c;
      if (fp <= 0) out.push(P);
      if ((fp < 0 && fq > 0) || (fp > 0 && fq < 0)) { var t = fp / (fp - fq); out.push([P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])]); }
    }
    return out;
  }
  // Demi-ouverture d'une primitive dans le plan dessiné (objets étendus : leur boîte, pas le détail du motif).
  function demiOuverture(pr, axe) {
    if (pr.k === K_.MASQUE) {
      var f = pr.p[0];
      if (f === F_.LETTRE) return (axe === 0 ? 6 : 10) * pr.p[1];
      if (f === F_.GRILLE) return pr.p[3];
      if (f === F_.REGLE) return axe === 0 ? pr.p[1] + 2 : pr.p[3];
    }
    return pr.ap[axe];
  }
  // Rayons (y, v = n·u) du plan de départ : y_j = A·y0 + B·v0 + ty, v_j = Cc·y0 + D·v0 + tv (un élément décentré de c
  // dévie de m·(y − c), m = −vergence). Renvoie des tronçons [{s, z, lo, hi}] : un par source ou par dépoli. Le cône
  // d'émission d'une source (ou d'un dépoli) est celui que découpe la première ouverture rencontrée.
  function etendueU(poly) { var lo = Infinity, hi = -Infinity; poly.forEach(function (v) { lo = Math.min(lo, v[1]); hi = Math.max(hi, v[1]); }); return hi - lo; }
  // arrivee = {j} : y pose {lo, hi}, la lumière qui ARRIVE sur la primitive j (avant la coupe par son ouverture ; vue de
  // face de la pièce choisie : une fente source montre la lampe qui l'inonde, pas sa seule fente).
  // ----- bords exacts (optique réelle) -----
  // Éventail d'un tronçon : ny points du départ (source ou dépoli) × nv pentes par polygone de découpe relevé (pentes
  // éclairées à cette hauteur, élargies de dil de part et d'autre : le passage exact n'est pas le paraxial) ; entre deux
  // pentes voisines qui ne vont pas aussi loin (arrêtées ou passées à côté à des endroits différents), le bord est
  // cherché par bis dichotomies. Une ouverture découpe un rayon dans le plan dessiné comme `enveloppe` (demi-ouverture,
  // boîte d'un objet étendu ; monture) ; un dioptre, une lentille, un miroir, un réseau (ordre 0) le dévient par `C.etape`.
  var BORD = { ny: 4, nv: 13, nt: 7, dil: 0.2, bis: 6, nsub: 16 }, BORD_LEGER = { ny: 3, nv: 9, nt: 5, dil: 0.2, bis: 4, nsub: 8 }, BD = BORD;
  var DEVIE = {};
  [K_.SURF, K_.IDEALE, K_.MIROIR, K_.RESEAU, K_.PHASE].forEach(function (k) { DEVIE[k] = 1; });
  // Longueurs d'onde des bords : la plus courte, la plus longue et la plus proche de 587,6 nm que la source envoie à
  // travers les filtres du trajet (2 % au moins de la mieux transmise ; continu : quantiles 1,6 à 98,4 % du tirage) ; une seule s'il n'y a pas de verre.
  function lambdasBord(seq) {
    var sp = seq.source.sp, P = seq.prims, nd = seq.iDet >= 0 ? seq.iDet : P.length - 1, cand = [], verre = false, i;
    if (!sp) return [587.6];
    if (sp.type === 0) { for (i = 2; i < sp.Q.length - 2; i += 6) cand.push(sp.Q[i]); cand.push(sp.Q[sp.Q.length - 3]); }
    else cand = sp.l.slice();
    var tr = cand.map(function (l) {
      var t = 1;
      for (var j = 0; j <= nd; j++) if (P[j].k === K_.FILTRE) t *= C.transFiltre(P[j].p[0], l);
      return t;
    }), tm = Math.max.apply(null, tr);
    cand = cand.filter(function (l, k) { return tr[k] > 0.02 * tm; });
    if (!cand.length) return [587.6];
    for (i = 0; i <= nd; i++) if (P[i].k === K_.SURF) verre = true;
    var mi = Math.min.apply(null, cand), ma = Math.max.apply(null, cand), pr = cand[0];
    cand.forEach(function (l) { if (Math.abs(l - 587.6) < Math.abs(pr - 587.6)) pr = l; });
    if (!verre) return [pr];
    return [mi, pr, ma].filter(function (l, k, t) { return t.indexOf(l) === k; });
  }
  function planBord(p0, d0, pr) {         // comme surPlan, mais un plan confondu avec le départ (t = 0) est atteint
    var Cp = C.centrePlan(pr), ez = pr.ez, den = d0[0] * ez[0] + d0[1] * ez[1] + d0[2] * ez[2];
    if (!den) return null;
    var t = ((Cp[0] - p0[0]) * ez[0] + (Cp[1] - p0[1]) * ez[1] + (Cp[2] - p0[2]) * ez[2]) / den;
    if (!(t > -1e-9) || t > 1e7) return null;
    return [p0[0] + t * d0[0], p0[1] + t * d0[1], p0[2] + t * d0[2]];
  }
  // Rayon exact du départ jd (−1 : la source) à pente v (dans le plan dessiné, le long du trajet) : abscisses s et points
  // de passage, état à chaque primitive (st[j] : 0 passe, 1 arrêté à son plan, 2 passé à côté ou perdu, non dessiné).
  function rayonBord(seq, axe, jd, p0, v, l, nd) {
    var P = seq.prims, sg = (jd >= 0 ? P[jd].sens : P[0].sens) < 0 ? -1 : 1, d = [0, 0, sg], al = new C.Alea(1), j;
    d[axe] = v;
    var dn = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
    var r = { p: p0.slice(), d: [d[0] / dn, d[1] / dn, d[2] / dn], l: l, w: 1, f: [0, 0, 0], J: null, L: 0, n: 1, x: 0, y: 0, hors: false, ordre: 0 };
    var R = { v: v, s: [jd >= 0 ? P[jd].s : 0], p: [p0.slice()], st: {}, fin: jd, cle: 0 };
    for (j = jd + 1; j <= nd; j++) {
      var pr = P[j];
      if (pr.k === K_.AIRY) continue;
      var a = demiOuverture(pr, axe), Sm = Math.max(a, pr.Sm || 0), q = null, etat = 0;
      if (DEVIE[pr.k]) {
        var p1 = r.p, d1 = r.d, c = C.etape(pr, r, al, seq);
        if (c === 1) { q = planBord(p1, d1, pr); etat = q ? 1 : 2; }
        else if (r.hors) etat = 2;
        else q = r.p.slice();
      } else {
        q = planBord(r.p, r.d, pr);
        if (!q) etat = 2;
        else if (a < C.GRAND / 2) { var hh = Math.abs(q[axe] - pr.O[axe]); etat = hh <= a ? 0 : hh <= Sm ? 1 : 2; }
        if (q) r.p = q;
      }
      R.st[j] = etat; R.fin = j; R.cle = 4 * j + etat;
      if (etat === 2) break;
      R.s.push(pr.s); R.p.push(q);
      if (etat === 1 || pr.k === K_.DIFFUSEUR || pr.k === K_.DET) break;
    }
    return R;
  }
  // Bornes des rayons vivants à l'abscisse s (z = zDeS(s)). Entre deux primitives, un rayon est une droite h = a + b z
  // (interpolée en z : un dioptre courbe ou incliné est atteint hors du plan de sa primitive) ; tous les rayons d'un
  // tronçon traversent les mêmes primitives, donc le même segment k. Seules les droites de l'enveloppe supérieure (et
  // inférieure) peuvent faire un bord, y compris au col d'un faisceau aberrant (caustique) : calculées une fois par
  // segment et par liste de rayons (`viv.env`), quelques dizaines au lieu de milliers.
  function droitesSegment(viv, k, axe) {
    var cache = viv.env || (viv.env = {});
    if (cache[k] !== undefined) return cache[k];
    var L = [], i;
    for (i = 0; i < viv.length; i++) {
      var R = viv[i];
      if (R.p.length < k + 2) continue;
      var za = R.p[k][2], dz = R.p[k + 1][2] - za, ha = R.p[k][axe];
      if (!(Math.abs(dz) > 1e-9)) { cache[k] = null; return null; }
      var bb = (R.p[k + 1][axe] - ha) / dz;
      L.push([bb, ha - bb * za]);
    }
    function haut(T) {                    // enveloppe supérieure de max(a + b z) : pentes croissantes, droites inutiles ôtées
      T.sort(function (x, y) { return x[0] - y[0] || x[1] - y[1]; });
      var H = [];
      for (var j = 0; j < T.length; j++) {
        var l3 = T[j];
        if (H.length && H[H.length - 1][0] === l3[0]) H.pop();
        while (H.length >= 2) {
          var l1 = H[H.length - 2], l2 = H[H.length - 1];
          if ((l3[1] - l1[1]) * (l2[0] - l1[0]) >= (l2[1] - l1[1]) * (l3[0] - l1[0])) H.pop(); else break;
        }
        H.push(l3);
      }
      return H;
    }
    var hi = haut(L.slice()), lo = haut(L.map(function (l) { return [-l[0], -l[1]]; }));
    cache[k] = L.length ? { hi: hi, lo: lo } : null;
    return cache[k];
  }
  function garder(viv, f) { var g = viv.filter(f); return g.length === viv.length ? viv : g; }   // même liste : enveloppes gardées
  function bornesBord(viv, s, z, axe) {
    var S = viv[0].s, k = 0, n = S.length;
    while (k < n - 2 && S[k + 1] < s) k++;
    var D = n > 1 ? droitesSegment(viv, k, axe) : null, lo = Infinity, hi = -Infinity, i, y;
    if (D) {
      for (i = 0; i < D.hi.length; i++) { y = D.hi[i][1] + D.hi[i][0] * z; if (y > hi) hi = y; }
      for (i = 0; i < D.lo.length; i++) { y = -(D.lo[i][1] + D.lo[i][0] * z); if (y < lo) lo = y; }
      return [lo, hi];
    }
    for (i = 0; i < viv.length; i++) { y = hauteurBord(viv[i], s, z, axe); if (y < lo) lo = y; if (y > hi) hi = y; }
    return [lo, hi];
  }
  function hauteurBord(R, s, z, axe) {    // un rayon, segment cherché (repli d'un segment sans longueur en z)
    var S = R.s, n = S.length, k = 0;
    if (n === 1) return R.p[0][axe];
    while (k < n - 2 && S[k + 1] < s) k++;
    var a = R.p[k], b = R.p[k + 1], dz = b[2] - a[2], ds = S[k + 1] - S[k];
    var t = Math.abs(dz) > 1e-9 ? (z - a[2]) / dz : ds > 0 ? (s - S[k]) / ds : 1;
    return a[axe] + t * (b[axe] - a[axe]);
  }
  // Éventail d'un polygone de découpe (pg, plan de départ du tronçon, coordonnées réduites par sa boîte) : ny droites
  // parallèles à sa plus grande corde, réparties sur sa largeur, nv points chacune, le tout dilaté de dil (le passage
  // exact n'est pas le paraxial) ; hauteur ramenée dans la zone qui émet [y0, y1]. Le faisceau utile est souvent une
  // bande oblique (trou source : chaque point de la lampe ne passe que dans une pente) : une droite à hauteur fixe la
  // traverse sans voir ses bords.
  function droitesPoly(pg, y0, y1) {
    var ylo = Infinity, yhi = -Infinity, vlo = Infinity, vhi = -Infinity, i, j, out = [];
    pg.forEach(function (q) { ylo = Math.min(ylo, q[0]); yhi = Math.max(yhi, q[0]); vlo = Math.min(vlo, q[1]); vhi = Math.max(vhi, q[1]); });
    var dy = Math.max(yhi - ylo, 1e-9), dv = Math.max(vhi - vlo, 1e-9), N = pg.map(function (q) { return [(q[0] - ylo) / dy, (q[1] - vlo) / dv]; });
    var e = [1, 0], best = -1;
    for (i = 0; i < N.length; i++) for (j = i + 1; j < N.length; j++) {
      var ex = N[j][0] - N[i][0], ev = N[j][1] - N[i][1], d2 = ex * ex + ev * ev;
      if (d2 > best) { best = d2; e = [ex, ev]; }
    }
    var ne = Math.sqrt(best) || 1; e = [e[0] / ne, e[1] / ne];
    var nr = [-e[1], e[0]], t0 = Infinity, t1 = -Infinity, w0 = Infinity, w1 = -Infinity;
    N.forEach(function (q) { var t = q[0] * e[0] + q[1] * e[1], w = q[0] * nr[0] + q[1] * nr[1]; t0 = Math.min(t0, t); t1 = Math.max(t1, t); w0 = Math.min(w0, w); w1 = Math.max(w1, w); });
    var mt = BD.dil * (t1 - t0) + 1e-6, mw = BD.dil * (w1 - w0) + 1e-6, ny = w1 - w0 > 1e-6 ? BD.ny : 1;
    t0 -= mt; t1 += mt; w0 -= mw; w1 += mw;
    function point(t, w) { return [Math.min(y1, Math.max(y0, ylo + dy * (t * e[0] + w * nr[0]))), vlo + dv * (t * e[1] + w * nr[1])]; }
    // le long de la corde, puis en travers (les coins de la région qui passe : un bord croisé par un autre)
    for (i = 0; i < ny; i++) {
      var w = ny > 1 ? w0 + (w1 - w0) * i / (ny - 1) : 0.5 * (w0 + w1), ligne = [];
      for (j = 0; j < BD.nv; j++) ligne.push(point(t0 + (t1 - t0) * j / (BD.nv - 1), w));
      out.push(ligne);
    }
    if (ny > 1) for (i = 0; i < BD.ny; i++) {
      var t = t0 + (t1 - t0) * (i + 0.5) / BD.ny, tr = [];
      for (j = 0; j < BD.nt; j++) tr.push(point(t, w0 + (w1 - w0) * j / (BD.nt - 1)));
      out.push(tr);
    }
    return out;
  }
  function aire(pg) { var s = 0; for (var i = 0; i < pg.length; i++) { var a = pg[i], b = pg[(i + 1) % pg.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; }
  // Ouverture PIVOT : celle qui réduit le plus la lumière du tronçon (trou source, fente, pupille : moins de 1/20 de ce
  // qui y arrive). Derrière un condenseur, les rayons qui la passent forment dans le plan de départ une bande mince que
  // les aberrations COURBENT : un éventail tiré dans le polygone paraxial (droit) n'en touche pas les bouts, où sont
  // les rayons marginaux. On les paramètre donc par la hauteur où ils la traversent : pente retrouvée par tir exact
  // (sécante, montures ignorées), au départ de la pente paraxiale.
  function sansMonture(pr) { return pr.libre || (pr.libre = Object.assign({}, pr, { R: C.GRAND, Sm: C.GRAND })); }
  function hauteurPivot(seq, axe, jd, p0, v, l, k) {
    var P = seq.prims, sg = (jd >= 0 ? P[jd].sens : P[0].sens) < 0 ? -1 : 1, d = [0, 0, sg], al = new C.Alea(1);
    d[axe] = v;
    var dn = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
    var r = { p: p0.slice(), d: [d[0] / dn, d[1] / dn, d[2] / dn], l: l, w: 1, f: [0, 0, 0], J: null, L: 0, n: 1, x: 0, y: 0, hors: false, ordre: 0 };
    for (var j = jd + 1; j <= k; j++) {
      var pr = P[j];
      if (pr.k === K_.AIRY) continue;
      if (DEVIE[pr.k]) { if (C.etape(sansMonture(pr), r, al, seq) === 1) return NaN; }
      else { var q = planBord(r.p, r.d, pr); if (!q) return NaN; r.p = q; }
    }
    return r.p[axe];
  }
  function viserPivot(seq, axe, jd, p0, h, l, pv, v0) {
    var y = p0[axe], v = v0 != null ? v0 : (h - pv.A * y - pv.ty) / pv.B, f = hauteurPivot(seq, axe, jd, p0, v, l, pv.j) - h, tol = 1e-4 * pv.a + 1e-7;
    if (!isFinite(f)) return null;
    var vp = v, fp = f;
    v = v - f / pv.B;
    for (var it = 0; it < 8; it++) {
      f = hauteurPivot(seq, axe, jd, p0, v, l, pv.j) - h;
      if (!isFinite(f)) return null;
      if (Math.abs(f) < tol) return v;
      var der = Math.abs(f - fp) > 1e-15 && Math.abs(v - vp) > 1e-15 ? (f - fp) / (v - vp) : pv.B;
      vp = v; fp = f; v = v - f / der;
    }
    return null;
  }
  // Éventail du pivot : nv hauteurs de son ouverture (dilatée de dil) × ny points du départ, dans les deux sens.
  function eventailPivot(seq, axe, jd, base, y0, y1, pv, ls, nd, out) {
    var ny = y1 - y0 > 1e-6 ? BD.ny : 1, h0 = pv.c - pv.a * (1 + BD.dil), h1 = pv.c + pv.a * (1 + BD.dil), lignes = [], i, j;
    for (i = 0; i < ny; i++) { var y = ny > 1 ? y0 + (y1 - y0) * i / (ny - 1) : 0.5 * (y0 + y1), L = []; for (j = 0; j < BD.nv; j++) L.push([y, h0 + (h1 - h0) * j / (BD.nv - 1)]); lignes.push(L); }
    if (ny > 1) for (j = 0; j < BD.ny; j++) { var hh = h0 + (h1 - h0) * (j + 0.5) / BD.ny, T = []; for (i = 0; i < BD.nt; i++) T.push([y0 + (y1 - y0) * i / (BD.nt - 1), hh]); lignes.push(T); }
    ls.forEach(function (l) {
      lignes.forEach(function (L) {
        function rayon(q, vi) {
          var p0 = base.slice(); p0[axe] = q[0];
          var v = viserPivot(seq, axe, jd, p0, q[1], l, pv, vi);
          if (v === null) return null;
          var R = rayonBord(seq, axe, jd, p0, v, l, nd); R.u = v;
          return R;
        }
        // du milieu vers les bouts, chaque point parti de la pente de son voisin (la paraxiale s'égare près des bords)
        var R = new Array(L.length), mi = L.length >> 1, k;
        R[mi] = rayon(L[mi], null);
        for (k = mi + 1; k < L.length; k++) R[k] = rayon(L[k], R[k - 1] ? R[k - 1].u : null);
        for (k = mi - 1; k >= 0; k--) R[k] = rayon(L[k], R[k + 1] ? R[k + 1].u : null);
        // transitions, dont « pas de rayon » ↔ rayon (la hauteur au pivot se replie : au-delà, aucune pente n'y mène)
        function cle(x) { return x ? x.cle : -1; }
        for (k = 0; k + 1 < R.length; k++) {
          var a = R[k], b = R[k + 1];
          if (cle(a) === cle(b)) continue;
          var qa = L[k], qb = L[k + 1];
          for (var it = 0; it < BD.bis; it++) {
            var qm = [0.5 * (qa[0] + qb[0]), 0.5 * (qa[1] + qb[1])], m = rayon(qm, a ? (b ? 0.5 * (a.u + b.u) : a.u) : b.u);
            if (cle(m) === cle(a)) { a = m; qa = qm; } else { b = m; qb = qm; }
          }
          if (a) out.push(a);
          if (b) out.push(b);
        }
        R.forEach(function (x) { if (x) out.push(x); });
      });
    });
  }
  function bordsExacts(seq, axe, jd, y0, y1, boites, ls, nd) {
    var polys = boites.map(function (b) { return b.pg; }), pv = null;
    boites.forEach(function (b) { if (b.r < 0.05 && Math.abs(b.B) > 1e-9 && (!pv || b.r < pv.r)) pv = b; });
    var P = seq.prims, out = [], vus = [];
    var base = jd >= 0 ? C.centrePlan(P[jd]) : [seq.source.fr.O[0], seq.source.fr.O[1], seq.zEm];
    if (pv) eventailPivot(seq, axe, jd, base, y0, y1, pv, ls, nd, out);
    function rayon(q, l) { var p0 = base.slice(); p0[axe] = q[0]; return rayonBord(seq, axe, jd, p0, q[1], l, nd); }
    // Polygones de découpe voisins (les deux faces d'une lentille, une monture après l'autre) : un seul éventail ; un
    // polygone bien plus petit que ceux déjà pris (iris derrière une lentille) a le sien, sinon aucun rayon n'y tombe.
    polys.forEach(function (pg) {
      var b = [Infinity, -Infinity, Infinity, -Infinity];
      pg.forEach(function (q) { b[0] = Math.min(b[0], q[0]); b[1] = Math.max(b[1], q[0]); b[2] = Math.min(b[2], q[1]); b[3] = Math.max(b[3], q[1]); });
      if (vus.some(function (o) {
        var ty = 0.1 * Math.max(b[1] - b[0], o[1] - o[0]) + 1e-9, tv = 0.1 * Math.max(b[3] - b[2], o[3] - o[2]) + 1e-12;
        return Math.abs(b[0] - o[0]) <= ty && Math.abs(b[1] - o[1]) <= ty && Math.abs(b[2] - o[2]) <= tv && Math.abs(b[3] - o[3]) <= tv;
      })) return;
      vus.push(b);
      droitesPoly(pg, y0, y1).forEach(function (ligne) {
        ls.forEach(function (l) {
          var R = ligne.map(function (q) { return rayon(q, l); }), k;
          for (k = 0; k + 1 < R.length; k++) {
            if (R[k].cle === R[k + 1].cle) continue;
            var qa = ligne[k], qb = ligne[k + 1], a = R[k], b = R[k + 1];
            for (var it = 0; it < BD.bis; it++) {
              var qm = [0.5 * (qa[0] + qb[0]), 0.5 * (qa[1] + qb[1])], m = rayon(qm, l);
              if (m.cle === a.cle) { a = m; qa = qm; } else { b = m; qb = qm; }
            }
            out.push(a, b);
          }
          Array.prototype.push.apply(out, R);
        });
      });
    });
    return out;
  }
  // Optique réelle : même découpage, mêmes règles de dessin, mais bornes mesurées sur des
  // rayons EXACTS (`bordsExacts`) : sans eux, la tache d'un trou par une plan-convexe ouverte (aberration sphérique)
  // était dessinée 100 fois trop petite (±0,02 mm pour ±2 mm), et le chromatisme deux fois. `arrivee` et `cap` (vue de
  // face, pinceau) restent paraxiaux : ils lisent le polygone, pas les bornes.
  // o.leger : éventail allégé (BORD_LEGER, 2 à 3 fois moins cher), pour suivre un geste ; o.paraxial : l'ancien faisceau.
  function enveloppe(seq, axe, nsub, arrivee, cap, o) {
    if (!seq || !seq.source || !seq.prims || !seq.prims.length || seq.optique !== "reelle" || arrivee || cap || (o && o.paraxial)) return enveloppeAux(seq, axe, nsub, arrivee, cap, null);
    var col = { boites: [] }, sv = BD;
    BD = o && o.leger ? BORD_LEGER : BORD;
    try {
      enveloppeAux(seq, axe, 1, null, null, col);
      return enveloppeAux(seq, axe, Math.max(nsub || 6, BD.nsub), null, null, { boites: col.boites, ls: lambdasBord(seq) });
    } finally { BD = sv; }
  }
  // EX = null (paraxial), {boites: []} (relevé : polygone de chaque découpe, par tronçon, dans le plan de départ du
  // tronçon) ou {boites, ls} (bornes exactes : éventail tiré dans ces polygones, suivi par `rayonBord`, aux λ de `ls`).
  // La liste `viv` des rayons exacts suit le polygone pas à pas : coupée là où il l'est, échangée là où il l'est.
  function enveloppeAux(seq, axe, nsub, arrivee, cap, EX) {
    var out = [];
    if (!seq || !seq.source || !seq.prims || !seq.prims.length) return out;
    var em = seq.source.em;
    if (em.forme === "gauss") return out;
    var P = seq.prims, nd = seq.iDet >= 0 ? seq.iDet : P.length - 1, l = 587.6, U = 3, NS = nsub || 6;
    var cs = seq.source.fr.O[axe], h = em.forme === "rect" ? (axe === 0 ? em.a : em.b) / 2 : em.a;
    var poly = [[cs - h, -U], [cs + h, -U], [cs + h, U], [cs - h, U]];
    var A = 1, B = 0, Cc = 0, D = 1, ty = 0, tv = 0, s = 0, n = 1, pts = [], attente = [], tron = [], decoupe = false;
    var exact = !!(EX && EX.ls), tr = 0, viv = null;
    if (EX && !exact) EX.boites[0] = [];
    if (exact) viv = bordsExacts(seq, axe, -1, cs - h, cs + h, EX.boites[0] || [], EX.ls, nd);
    function mesure(c) {
      var lo = Infinity, hi = -Infinity, z = C.zDeS(seq, c[3]);
      if (viv && viv.length) { var bb = bornesBord(viv, c[3], z, axe); lo = bb[0]; hi = bb[1]; }
      else poly.forEach(function (v) { var y = c[0] * v[0] + c[1] * v[1] + c[2]; if (y < lo) lo = y; if (y > hi) hi = y; });
      pts.push({ s: c[3], z: z, lo: lo, hi: hi });
    }
    function bornes(a, b, t, sa) { if (decoupe) tron.push([a, b, t, sa]); else attente.push([a, b, t, sa]); }
    function vider() { decoupe = true; attente.forEach(mesure); attente = []; }
    // Un tronçon (depuis la dernière ouverture) n'est mesuré qu'en arrivant à la suivante, avec les seuls rayons qui
    // tombent sur sa plaque ou sa monture (`pl`) : ceux qui passent à côté ne sont pas dessinés (sinon, derrière une fente
    // source collée à l'ampoule, un éventail plus large que la lentille suivante) ; ceux qu'elle arrête vont jusqu'à elle.
    function solder(pl, vpl) {
      var sv = poly, sw = viv;
      if (pl) { poly = pl; viv = vpl; }
      if (poly.length) tron.forEach(mesure);
      tron = []; poly = sv; viv = sw;
    }
    // cap.j < 0 : plan de la source elle-même (pinceau d'une source sans objet)
    if (cap && cap.j < 0) cap.M = { A: 1, B: 0, C: 0, D: 1, ty: 0, tv: 0, poly: poly.slice() };
    bornes(1, 0, 0, 0);
    for (var j = 0; j <= nd; j++) {
      var pr = P[j];
      if (pr.k === K_.AIRY) continue;
      if (viv) viv = garder(viv, function (R) { return R.st[j] === 0 || R.st[j] === 1; });
      var gap = pr.s - s;
      if (gap > 0) {
        // Bord du faisceau = max (ou min) des droites des sommets du polygone : anguleux là où deux droites se croisent
        // (col d'un faisceau qui converge). Points réguliers + ces croisements exacts, sinon le col tombe entre deux
        // points et le faisceau dessiné converge puis diverge en segments cassés.
        var gm = gap / n, gs = [], k, i2, j2;
        for (k = 1; k <= NS; k++) gs.push(gm * k / NS);
        var y0 = poly.map(function (v) { return A * v[0] + B * v[1] + ty; }), pe = poly.map(function (v) { return Cc * v[0] + D * v[1] + tv; });
        for (i2 = 0; i2 < poly.length; i2++) for (j2 = i2 + 1; j2 < poly.length; j2++) {
          var dp = pe[j2] - pe[i2];
          if (Math.abs(dp) < 1e-15) continue;
          var gx = (y0[i2] - y0[j2]) / dp;
          if (gx > 1e-9 * gm && gx < gm * (1 - 1e-9)) gs.push(gx);
        }
        gs.sort(function (x, y) { return x - y; });
        gs.forEach(function (g) { bornes(A + g * Cc, B + g * D, ty + g * tv, s + g * n); });
      }
      A += gap / n * Cc; B += gap / n * D; ty += gap / n * tv; s = pr.s;
      var a = demiOuverture(pr, axe), c = pr.O[axe];
      if (arrivee && j === arrivee.j && poly.length) {
        arrivee.lo = Infinity; arrivee.hi = -Infinity;
        poly.forEach(function (v) { var y = A * v[0] + B * v[1] + ty; arrivee.lo = Math.min(arrivee.lo, y); arrivee.hi = Math.max(arrivee.hi, y); });
      }
      // `cap` : l'application affine du plan source (ys, us) au plan de la primitive cap.j, et le polygone de lumière qui y ARRIVE
      // (avant sa propre coupe) : de quoi dire si un rayon donné (y, pente) vient de la source (cf. `pinceau`).
      if (cap && j === cap.j) cap.M = { A: A, B: B, C: Cc, D: D, ty: ty, tv: tv, poly: poly.slice() };
      if (a < C.GRAND / 2) {
        // Le faisceau n'est dessiné qu'à partir de la première ouverture qui limite vraiment les ANGLES (éventail
        // réduit de moitié au moins) : une plaque juste derrière un dépoli ne coupe qu'en hauteur, et l'éventail de
        // ±U rad s'affichait sur toute la hauteur jusqu'à la lentille suivante ; avant elle, les points attendent.
        var Sm = Math.max(a, pr.Sm || 0);
        solder(couper(couper(poly, A, B, Sm + c - ty), -A, -B, Sm - c + ty), viv && garder(viv, function (R) { return R.st[j] === 0 || R.st[j] === 1; }));
        var av = EX && !exact ? aire(poly) : 0;
        poly = couper(couper(poly, A, B, a + c - ty), -A, -B, a - c + ty);
        if (viv) viv = garder(viv, function (R) { return R.st[j] === 0; });
        if (EX && !exact && poly.length) EX.boites[tr].push({ pg: poly.slice(), j: j, A: A, B: B, ty: ty, c: c, a: a, r: av > 0 ? aire(poly) / av : 1 });
        if (!decoupe && (!poly.length || etendueU(poly) < U)) vider();
        if (!poly.length) break;
        bornes(A, B, ty, s);
      }
      if (j === nd) break;
      if (pr.k === K_.DIFFUSEUR) {
        // cap.polyFin : ce qui passe TOUTES les ouvertures jusqu'au premier dépoli après le plan de cap (sinon jusqu'au détecteur)
        if (cap && cap.M && cap.polyFin === undefined && j > cap.j) cap.polyFin = poly.slice();
        if (!decoupe) vider();
        solder();
        var der = pts[pts.length - 1];
        out.push(pts);
        poly = [[der.lo, -U], [der.hi, -U], [der.hi, U], [der.lo, U]];
        A = 1; B = 0; Cc = 0; D = 1; ty = 0; tv = 0; n = 1; decoupe = false; tr++;
        if (EX && !exact) EX.boites[tr] = [];
        if (exact) viv = bordsExacts(seq, axe, j, der.lo, der.hi, EX.boites[tr] || [], EX.ls, nd);
        pts = []; bornes(1, 0, 0, s);
        continue;
      }
      var m = C.abcdPrim(pr, l)[2];
      if (m) { Cc += m * A; D += m * B; tv += m * (ty - c); }
      n = pr.k === K_.SURF ? C.nVerre(pr.p[3], l) : 1;
    }
    if (cap && cap.M && cap.polyFin === undefined) cap.polyFin = poly.slice();
    if (!decoupe && poly.length) vider();
    solder();
    if (pts.length) out.push(pts);
    // Lanterne à condenseur (ou dépoli) : le filament est DANS le boîtier, le faisceau ne se dessine qu'à partir de la face de sortie.
    if (out.length && P[0].el === seq.source.el) {
      var vis = out[0].filter(function (q) { return q.s >= P[0].s - 1e-9; });
      if (vis.length > 1) out[0] = vis;
    }
    return out;
  }

  // ================= faisceau du laser =================
  // Rayons paraxiaux [[h, u]…] suivis de la primitive j0 (exclue ; −1 : depuis l'émission) à j1 (incluse), ns points par
  // intervalle : [{s, z, h: [...]}] (les bords d'un faisceau qui converge se croisent entre deux primitives).
  function suivreParax(seq, axe, j0, rays, j1, l, ns) {
    var P = seq.prims, s = j0 >= 0 ? P[j0].s : 0, n = j0 >= 0 && P[j0].k === K_.SURF ? C.nVerre(P[j0].p[3], l) : 1, out = [];
    var R = rays.map(function (r) { return [r[0], n * r[1]]; });
    function noter() { out.push({ s: s, z: C.zDeS(seq, s), h: R.map(function (r) { return r[0]; }) }); }
    noter();
    for (var j = j0 + 1; j <= j1 && j < P.length; j++) {
      var pr = P[j];
      if (pr.k === K_.AIRY) continue;
      var gap = pr.s - s, s0 = s, nn = n, k;
      if (gap > 0) for (k = 1; k <= ns; k++) { R.forEach(function (r) { r[0] += gap / ns / nn * r[1]; }); s = s0 + gap * k / ns; noter(); }
      s = pr.s;
      if (j === j1) break;
      var m = C.abcdPrim(pr, l)[2];
      if (m) R.forEach(function (r) { r[1] += m * (r[0] - pr.O[axe]); });
      n = pr.k === K_.SURF ? C.nVerre(pr.p[3], l) : 1;
    }
    return out;
  }
  // Largeur qui diffracte, dans le plan dessiné (mm) : la fente vue de travers selon son orientation ; null = isotrope.
  function largeurDiffractante(e, axe) {
    var p = C.params(e), r = e.rot || 0, cs = Math.abs(axe === 0 ? Math.cos(r) : Math.sin(r));
    var w = { fente: p.e, bifentes: p.e, fentesMultiples: p.e, fil: p.w, fenteSource: p.b }[e.type];
    if (w) return cs > 1e-3 ? w / cs : 1e9;
    return { trousYoung: p.d, grilleCroisee: p.w, trouSource: p.d }[e.type] || 0.05;
  }
  // Aide « faisceau » au laser : rayon w(z) du faisceau gaussien (ABCD du cœur : col arrondi derrière une
  // lentille) autour de son axe paraxial, jusqu'au premier plan diffractant (celui du moteur ondulatoire, ou un réseau) ;
  // après lui, l'éventail du lobe central (demi-angle λ/e), un par ordre derrière un réseau, suivi au paraxial jusqu'au
  // détecteur (une lentille le refocalise). {gauss: [{z, c, w}], jd, eventails: [{pts: [{z, lo, hi}]}]} ; null hors laser.
  // λ (nm) du laser de la séquence (632,8 He-Ne ou 532 vert), lue sur son spectre.
  function lLaser(seq) { var sp = seq && seq.source && MI_.spectreDe(seq.source.nomSpectre); return sp && sp.lmoy || 632.8; }
  // Couleur dessinée du faisceau : rouge (He-Ne) ou vert ; `clair` = la teinte claire des bords et de l'axe.
  function cLaser(seq, op, clair) { var v = lLaser(seq) < 600; return "rgba(" + (v ? (clair ? "120,255,130" : "60,235,85") : (clair ? "255,115,95" : "255,58,46")) + "," + op + ")"; }
  function faisceauLaser(seq, axe, st) {
    if (!seq || !seq.source || !seq.source.em || seq.source.em.forme !== "gauss" || !(seq.iDet >= 0)) return null;
    var P = seq.prims, l = lLaser(seq), jd = -1, i, pl = null;
    try { pl = C.ondePlan(seq, { ouvertures: seq.optique !== "parfaite" }); } catch (e0) { pl = null; }
    // Une ouverture qui ne diffracte que par son bord (lentille, monture, iris) et que le faisceau passe (demi-ouverture
    // ≥ w) n'arrête pas le dessin : le moteur la calcule en ondulatoire dès a < 2,5 w, mais le faisceau gaussien
    // continué en est la bonne image (coupure ≤ e⁻² de la puissance) ; sinon le dessin basculait d'un coup.
    if (pl && pl.ok) for (i = 0; i < pl.planes.length; i++) {
      var ip = pl.planes[i].i;
      if (C.structurante(P[ip]) || C.demiOuverture(P[ip]) < C.gaussien(seq, l, seq.source.em.a, [P[ip].s])[0].w) { jd = ip; break; }
    }
    for (i = 0; i < seq.iDet; i++) if (P[i].k === K_.RESEAU) { if (jd < 0 || i < jd) jd = i; break; }
    var c = suivreParax(seq, axe, -1, [[seq.source.fr.O[axe], 0]], jd >= 0 ? jd : seq.iDet, l, 40);
    var G = C.gaussien(seq, l, seq.source.em.a, c.map(function (q) { return q.s; }));
    // col : 40 points de plus de part et d'autre de chaque minimum de w (sinon un col de 50 µm se dessine en pointe)
    for (i = c.length - 2; i > 0; i--) if (G[i].w < G[i - 1].w && G[i].w <= G[i + 1].w) {
      var a = c[i - 1], b = c[i + 1], plus = [], k;
      for (k = 1; k < 40; k++) if (k !== 20) { var t = k / 40; plus.push({ s: a.s + t * (b.s - a.s), z: a.z + t * (b.z - a.z), h: [a.h[0] + t * (b.h[0] - a.h[0])] }); }
      var gp = C.gaussien(seq, l, seq.source.em.a, plus.map(function (q) { return q.s; }));
      c.splice.apply(c, [i - 1, 3, a].concat(plus.slice(0, 19), [c[i]], plus.slice(19), [b]));
      G.splice.apply(G, [i - 1, 3, G[i - 1]].concat(gp.slice(0, 19), [G[i]], gp.slice(19), [G[i + 1]]));
    }
    var out = { gauss: c.map(function (q, k) { return { z: q.z, c: q.h[0], w: G[k].w }; }), jd: jd, eventails: [] };
    if (jd < 0) return out;
    var n = c.length, fin = c[n - 1], av = n > 1 ? c[n - 2] : fin, u0 = fin.s > av.s ? (fin.h[0] - av.h[0]) / (fin.s - av.s) : 0;
    var w0 = G[n - 1].w, c0 = fin.h[0], pr = P[jd], e = st ? trouver(st, pr.el) : null, us = [];
    // ouverture simple plus étroite que le faisceau : l'éventail part de son bord et diffracte sur sa largeur
    var pure = !C.structurante(pr) && pr.k !== K_.RESEAU, h0 = pure ? Math.min(w0, C.demiOuverture(pr)) : w0;
    // pente géométrique du bord (courbure du front d'onde : dw/ds = w/R), puis la puissance du plan s'il en a une
    var dw = n > 1 && fin.s > av.s ? (G[n - 1].w - G[n - 2].w) / (fin.s - av.s) : 0, g = h0 * dw / w0;
    var nb = jd > 0 && P[jd - 1].k === K_.SURF ? C.nVerre(P[jd - 1].p[3], l) : 1, na = pr.k === K_.SURF ? C.nVerre(pr.p[3], l) : 1, pm = C.abcdPrim(pr, l)[2] || 0;
    function apres(h, u) { return [h, (nb * u + pm * (h - pr.O[axe])) / na]; }
    if (pr.k === K_.RESEAU && e) {
      var nt = C.params(e).n * 1e-3 * l * 1e-3, r = e.rot || 0, cs = axe === 0 ? Math.cos(r) : Math.sin(r);
      for (var m = -2; m <= 2; m++) if (Math.abs(m * nt) < 0.9) us.push([u0 + Math.tan(Math.asin(m * nt)) * cs, 1e-3]);
    } else us.push([u0, pure ? l * 1e-6 / (2 * h0) : e ? Math.max(1e-3, l * 1e-6 / largeurDiffractante(e, axe)) : 0.0127]);
    us.forEach(function (q) {
      var rays = [apres(c0 - h0, q[0] - g - q[1]), apres(c0 - h0, q[0] - g + q[1]), apres(c0 + h0, q[0] + g - q[1]), apres(c0 + h0, q[0] + g + q[1])];
      out.eventails.push({ pts: suivreParax(seq, axe, jd, rays, seq.iDet, l, 8).map(function (p) { return { z: p.z, lo: Math.min.apply(null, p.h), hi: Math.max.apply(null, p.h) }; }) });
    });
    return out;
  }

  // ================= pinceau de rayons exacts =================
  function surPlan(p0, d0, pr) {
    var Cp = C.centrePlan(pr), ez = pr.ez, den = d0[0] * ez[0] + d0[1] * ez[1] + d0[2] * ez[2];
    if (!den) return null;
    var t = ((Cp[0] - p0[0]) * ez[0] + (Cp[1] - p0[1]) * ez[1] + (Cp[2] - p0[2]) * ez[2]) / den;
    if (!(t > 1e-9) || t > 1e7) return null;
    return [p0[0] + t * d0[0], p0[1] + t * d0[1], p0[2] + t * d0[2]];
  }
  // Suit r à partir de la primitive `de` : points de passage (labo), état « detecte », « arrete » (dernier point : sur
  // le plan de l'obstacle) ou « diffuse » (arrivé sur un dépoli, qui renvoie la lumière dans toutes les directions).
  function suivre(seq, r, de) {
    var P = seq.prims, pts = [r.p.slice()], alea = new C.Alea(1), etat = "perdu", q;
    for (var i = de; i < P.length; i++) {
      var pr = P[i];
      if (pr.k === K_.AIRY) continue;
      var p0 = r.p, d0 = r.d;
      if (pr.k === K_.DIFFUSEUR) { q = surPlan(p0, d0, pr); if (q) pts.push(q); etat = "diffuse"; break; }
      var c = C.etape(pr, r, alea, seq);
      if (c === 1) { q = surPlan(p0, d0, pr); if (q) pts.push(q); etat = "arrete"; break; }
      pts.push(r.p.slice());
      if (c === 2) { etat = "detecte"; break; }
    }
    return { pts: pts, etat: etat, x: r.x, y: r.y };     // x, y : impact dans le repère du détecteur (si « detecte »)
  }
  // Point de départ : le point de l'objet à la hauteur h (comptée depuis son centre, dans le plan dessiné) ; sans
  // objet, le centre de la source. Renvoie [{l, etat, pts: [[z, hauteur]…]}], n rayons par longueur d'onde.
  // Point de départ du pinceau : h le long de l'axe du plan dessiné, ho dans l'autre direction (point 2D de l'objet : il
  // vaut pour les deux vues, profil = hauteur h, dessus = abscisse hx).
  function departPinceau(seq, axe, h, ho) {
    if (!seq || !seq.source || !seq.prims || !seq.prims.length) return null;
    var P = seq.prims, o = seq.objet, de = o >= 0 ? o + 1 : 0, p;
    while (de < P.length && P[de].k === K_.AIRY) de++;
    if (de >= P.length) return null;
    if (o >= 0) { p = C.centrePlan(P[o]); p[axe] += h || 0; p[1 - axe] += ho || 0; }
    else { var fr = seq.source.fr; p = [fr.O[0], fr.O[1], seq.zEm]; }
    return { p: p, de: de, objet: o >= 0 ? P[o] : null };
  }
  function penteEclairee(M, y0) {
    if (!M || !M.poly.length) return null;
    var P = M.poly, lo = Infinity, hi = -Infinity, i, j;
    var V = P.map(function (v) { return [M.A * v[0] + M.B * v[1] + M.ty, M.C * v[0] + M.D * v[1] + M.tv]; });
    for (i = 0; i < V.length; i++) {
      j = (i + 1) % V.length;
      var a = V[i], b = V[j], da = a[0] - y0, db = b[0] - y0;
      if (da * db > 0) continue;
      var th = Math.abs(a[0] - b[0]) < 1e-12 ? null : a[1] + (b[1] - a[1]) * (y0 - a[0]) / (b[0] - a[0]);
      if (th === null) { lo = Math.min(lo, a[1], b[1]); hi = Math.max(hi, a[1], b[1]); } else { lo = Math.min(lo, th); hi = Math.max(hi, th); }
    }
    return lo <= hi ? { lo: lo, hi: hi } : null;
  }
  // Point de départ 2D du pinceau : h = hauteur (profil), hx = abscisse (dessus) ; le point vaut pour les deux vues.
  function hAxe(pin, axe) { return axe === 1 ? (pin.h || 0) : (pin.hx || 0); }
  function hAutre(pin, axe) { return axe === 1 ? (pin.hx || 0) : (pin.h || 0); }
  // Le point de départ doit être DANS la partie transparente de l'objet (pas seulement dans sa boîte) : un point sur un
  // trait du quadrillage est noir, aucune lumière n'en part. x, y = coordonnées dans le repère du masque (les objets à
  // motif ne sont ni orientables ni décentrés : leur repère est centré sur la plaque, confondu avec hx/h).
  // Déplacement minimal pour sortir des traits en v : traits = bandes centrées sur pas·k (largeurs w1, w2), boîte |v| < lim.
  function procheHorsTraits(v, p1, w1, p2, w2, lim) {
    var ints = [[p1 * Math.floor(v / p1 + 0.5), w1]];
    if (p2 > 0 && w2 > 0) ints.push([p2 * Math.floor(v / p2 + 0.5), w2]);
    var dedans = ints.some(function (jw) { return Math.abs(v - jw[0]) < jw[1] / 2; });
    if (!dedans && Math.abs(v) < lim) return 0;      // déjà hors des traits et dans la boîte
    var cand = [lim - 1e-6, -lim + 1e-6];
    ints.forEach(function (iv) { cand.push(iv[0] - iv[1] / 2 - 1e-6, iv[0] + iv[1] / 2 + 1e-6); });   // 1e-6 au-delà : hors trait malgré les arrondis
    var best = null;
    cand.forEach(function (b) {
      if (Math.abs(b) >= lim) return;
      var ok = ints.every(function (jw) { return Math.abs(b - jw[0]) >= jw[1] / 2; });
      if (ok) { var d = Math.abs(b - v); if (!best || d < best.d) best = { d: d, dv: b - v }; }
    });
    return best ? best.dv : 0;
  }
  function ramenerDansObjet(pr, x, y) {
    if (!pr || pr.k !== K_.MASQUE) return [x, y];
    var f = pr.p[0], a = pr.p.slice(1);
    if (C.forme(f, a, x, y) > 0) return [x, y];
    if (f === F_.GRILLE) {       // quadrillage : calcul exact (traits horizontaux et verticaux indépendants)
      var dx = procheHorsTraits(x, a[0], a[1], a[3] || 0, a[4] || 0, a[2]), dy = procheHorsTraits(y, a[0], a[1], a[3] || 0, a[4] || 0, a[2]);
      if (dx === 0 && dy === 0) return [x, y];
      return [x + dx, y + dy];
    }
    if (f === F_.LETTRE) {
      var best = null, dmin = Infinity, i, j, X, Y, d;
      for (i = -14; i <= 14; i++) for (j = -20; j <= 20; j++) {
        X = i * 0.5; Y = j * 0.5;
        if (C.forme(f, a, X, Y) > 0) { d = (X - x) * (X - x) + (Y - y) * (Y - y); if (d < dmin) { dmin = d; best = [X, Y]; } }
      }
      return best || [x, y];
    }
    if (f === F_.REGLE || f === F_.DIAPO) {   // recherche au pas du détail du motif, bornée à ~150 points par côté
      var g = C.geomForme(f, a), pas = Math.max(Math.min(g[4], g[5]) / 2, Math.max(2 * g[2], 2 * g[3]) / 150, 0.02);
      var b2 = null, d2 = Infinity, m, n, U, V, dd;
      for (m = -Math.ceil(g[2] / pas); m <= Math.ceil(g[2] / pas); m++) for (n = -Math.ceil(g[3] / pas); n <= Math.ceil(g[3] / pas); n++) {
        U = m * pas; V = n * pas;
        if (C.forme(f, a, U, V) > 0) { dd = (U - x) * (U - x) + (V - y) * (V - y); if (dd < d2) { d2 = dd; b2 = [U, V]; } }
      }
      return b2 || [x, y];
    }
    return [x, y];
  }
  // Le point p (repère du banc) tombe-t-il sur une partie opaque du masque pr ? Coordonnées locales comme dans `etape`.
  function formeOpaque(pr, p) {
    var vx = p[0] - pr.O[0], vy = p[1] - pr.O[1], vz = p[2] - pr.O[2];
    var qx = vx * pr.ex[0] + vy * pr.ex[1] + vz * pr.ex[2], qy = vx * pr.ey[0] + vy * pr.ey[1] + vz * pr.ey[2];
    return C.forme(pr.p[0], pr.p.slice(1), qx, qy) <= 0;
  }
  function poserH(pin, axe, v) { if (axe === 1) pin.h = v; else pin.hx = v; }
  // Bord exact de la région qui passe, depuis un rayon qui passe (ok(u) vrai en u0) : on s'éloigne dans le sens sg (pas
  // doublé) jusqu'à un rayon arrêté, puis dichotomie ; borné par lim (le cône de la source : hors de lui le point n'émet rien).
  function bordExact(ok, u0, sg, pas, lim) {
    var a = u0, b = null, k;
    for (k = 0; k < 12 && b === null; k++) {
      var c = a + sg * pas;
      if (sg * (c - lim) >= 0) { if (ok(lim)) return lim; b = lim; }
      else if (!ok(c)) b = c;
      else { a = c; pas *= 2; }
    }
    if (b === null) return a;
    for (k = 0; k < 18; k++) { var m = (a + b) / 2; if (ok(m)) a = m; else b = m; }
    return a;
  }
  // Pinceau. Hors laser, hors réseau et hors objet dépoli, les rayons couvrent TOUTE l'ouverture utile de la chaîne
  // (`pentesExactes`) : le cône paraxial qui passe toutes les ouvertures jusqu'au détecteur (`enveloppe`, `cap.polyFin`)
  // sert de graine, ses bords sont précisés par le tracé exact (expansion puis dichotomie), la lumière qui passe à côté
  // de la monture d'une lentille et arrive quand même sur l'écran est gardée (une bande de rayons par côté). Quelques
  // rayons gris encadrent l'ouverture : ils montrent où la lumière est arrêtée. Sinon : visée de l'élément suivant.
  function pinceau(seq, axe, h, ls, n, ho) {
    var out = [], dep = departPinceau(seq, axe, h, ho);
    if (!dep) return out;
    if (dep.objet && dep.objet.k === K_.MASQUE && formeOpaque(dep.objet, dep.p)) return out;   // point sur un trait opaque : rien n'en part
    var P = seq.prims, pr = P[dep.de], Cn = C.centrePlan(pr), Rc = Math.min(C.rayonUtile(pr), 60) * 0.97;
    // Laser (sans objet devant) : rayons parallèles à l'axe sur la largeur du faisceau (±w₀), pas un point qui
    // s'ouvre sur toute l'ouverture suivante. Réseau sur le trajet : un faisceau par ordre (−2 à 2), sinon tous les
    // rayons du pinceau tireraient le même ordre (même graine).
    var em = seq.source.em, laser = !dep.objet && em && em.forme === "gauss", ordres = [null], j;
    for (j = dep.de; j < P.length; j++) if (P[j].k === K_.RESEAU) { ordres = [-2, -1, 0, 1, 2]; break; }
    // Le pinceau ne montre que ce qui part RÉELLEMENT de ce point : la lumière de la lampe n'y arrive que dans un cône
    // d'angles (le condenseur la ramène vers l'image du filament). On remonte le polygone de lumière de l'enveloppe au
    // plan de l'objet : à la hauteur du point, les pentes éclairées forment un intervalle [lo, hi]. Aucune pente
    // éclairée : le point n'envoie rien, pas de rayon.
    var cap = dep.objet ? { j: seq.objet } : null, cone = null, coneFin = null;
    if (cap) {
      enveloppe(seq, axe, 1, null, cap);
      cone = penteEclairee(cap.M, dep.p[axe]);
      if (!cone) return out;
    }
    var nouveau = !laser && ordres.length === 1 && !(dep.objet && dep.objet.k === K_.DIFFUSEUR);
    if (nouveau) {
      var capF = cap || { j: -1 };
      if (!cap) enveloppe(seq, axe, 1, null, capF);
      // même application affine (plan de l'objet, ou de la source), mais polygone de ce qui passe TOUTES les ouvertures
      if (capF.M && capF.polyFin && capF.polyFin.length) coneFin = penteEclairee({ A: capF.M.A, B: capF.M.B, C: capF.M.C, D: capF.M.D, ty: capF.M.ty, tv: capF.M.tv, poly: capF.polyFin }, dep.p[axe]);
    }
    // Cône éclairé par tracé EXACT (rayons remontés à rebours jusqu'au plan du filament, `C.versSource`), quand la chaîne
    // avant l'objet n'est faite que de lentilles : l'estimation paraxiale ci-dessus se trompe de cône derrière un
    // condenseur très ouvert en optique réelle (pinceau tout arrêté, ou parti à l'opposé, alors que l'image montre la
    // lettre entière). Ce cône est une petite tache à deux dimensions (l'image du filament vue du point) qu'une grille
    // rate : on VISE le centre du filament (Newton sur la direction, depuis la meilleure direction d'une grille
    // grossière), ce qui fixe aussi la pente dans l'autre direction que le plan dessiné (sinon l'éventail plan, qui
    // visait le centre de l'élément suivant, passe à côté pour un point décalé) ; puis les bords du cône dans le plan
    // dessiné, par dichotomie. Filament jamais atteint : le point n'envoie rien.
    var soL = 0;
    if (cone) {
      var lC = (ls && ls[0]) || 550, dzL = Cn[2] - dep.p[2], w0 = (Cn[1 - axe] - dep.p[1 - axe]) / dzL, emS = seq.source.em;
      var demiA = emS.forme === "rect" ? emS.a / 2 : emS.a, demiB = emS.forme === "rect" ? emS.b / 2 : emS.a;
      var vers = function (u, wv) { var v = [0, 0, 1]; v[axe] = u; v[1 - axe] = wv; var dn = Math.sqrt(1 + u * u + wv * wv); return C.versSource(seq, dep.p, [v[0] / dn, v[1] / dn, v[2] / dn], lC); };
      var ecartS = function (r) { return r ? Math.max(Math.abs(r.x) / demiA, Math.abs(r.y) / demiB) : Infinity; };
      var r0 = vers(0, w0);
      if (r0 !== null) {
        // recherche par zooms successifs (la correspondance direction → point du filament a des trous et des sauts à
        // travers un condenseur réel : pas de Newton) ; on garde la direction qui tombe le plus près du centre
        var best = null, pasU = 1.6 / 24, pasW = 0.8 / 24, cu = 0, cw = w0, N2 = 12, z, iG, jG;
        for (z = 0; z < 5; z++) {
          var nn = z ? 10 : N2, bz = null;
          for (iG = -nn; iG <= nn; iG++) for (jG = -nn; jG <= nn; jG++) {
            var uG = cu + iG * pasU, wG = cw + jG * pasW, eG = ecartS(vers(uG, wG));
            if (eG < Infinity && (!bz || eG < bz.e)) bz = { u: uG, w: wG, e: eG };
          }
          if (!bz) break;
          if (!best || bz.e <= best.e) best = bz;
          cu = best.u; cw = best.w; pasU /= 5; pasW /= 5;
          if (best.e < 0.05) break;
        }
        var vise = best && best.e <= 1 ? best : null;
        if (!vise) return out;
        soL = (vise.w - w0) * dzL;
        var eCl = function (uu) { return ecartS(vers(uu, vise.w)) <= 1; };
        cone = { lo: bordExact(eCl, vise.u, -1, 2e-3, -0.8), hi: bordExact(eCl, vise.u, 1, 2e-3, 0.8) };
        if (coneFin) coneFin = { lo: Math.max(coneFin.lo, cone.lo), hi: Math.min(coneFin.hi, cone.hi) };
        if (coneFin && coneFin.lo > coneFin.hi) coneFin = { lo: cone.lo, hi: cone.hi };
      }
    }
    n = n || 15;
    if (laser && ordres.length > 1) n = Math.min(n, 5);
    var fan = null;
    if (cone) {
      var dzp = Cn[2] - dep.p[2], a1 = (Cn[axe] - Rc - dep.p[axe]) / dzp, a2 = (Cn[axe] + Rc - dep.p[axe]) / dzp;
      var f1 = Math.max(cone.lo, Math.min(a1, a2)), f2 = Math.min(cone.hi, Math.max(a1, a2));
      fan = f1 <= f2 ? { lo: f1, hi: f2 } : cone;
    }
    var fanVise = coneFin || fan;     // pente moyenne visée pour trouver la direction qui entre dans l'œil
    // Visée dans l'autre direction que le plan dessiné : les rayons du pinceau visent le centre de l'élément suivant ; si
    // le point de départ est décalé dans cette direction (hx en vue de profil, h en vue de dessus), tout le plan de rayons
    // passe loin d'un œil sur l'axe et rien n'y entre. Avec un œil au bout du banc, on décale la visée (secante sur le
    // rayon central) pour que le plan dessiné passe par le centre de sa pupille.
    function direction(t, so, p0) {
      var Q = Cn.slice(); Q[axe] += t * Rc; Q[1 - axe] += so;
      var v = [Q[0] - p0[0], Q[1] - p0[1], Q[2] - p0[2]];
      if (fanVise) v[axe] = (fanVise.lo + (fanVise.hi - fanVise.lo) * 0.5) * v[2];
      var dn = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
      return dn > 0 ? [v[0] / dn, v[1] / dn, v[2] / dn] : null;
    }
    function viseOeil(l) {
      var de = seq.detEl, ip = -1, j;
      if (!de || de.type !== "oeil" || laser) return 0;
      for (j = 0; j < P.length; j++) if (P[j].el === de.id) { ip = j; break; }
      if (ip < 0) return 0;
      var z0 = P[ip].zp, c = C.centrePlan(P[ip])[1 - axe];
      function ecart(so) {
        var d0 = direction(0, so, dep.p);
        if (!d0) return null;
        var s0 = suivre(seq, { p: dep.p.slice(), d: d0, l: l, w: 1, f: [0, 0, 0], J: null, L: 0, n: 1, x: 0, y: 0, hors: false, ordre: null }, dep.de);
        for (var k = 0; k < s0.pts.length; k++) if (Math.abs(s0.pts[k][2] - z0) < 1e-6) return s0.pts[k][1 - axe] - c;
        return null;
      }
      var e0 = ecart(0);
      if (e0 === null || Math.abs(e0) < 1e-4) return 0;
      var e1 = ecart(1);
      if (e1 === null || Math.abs(e1 - e0) < 1e-9) return 0;
      var so = -e0 / (e1 - e0), e2 = ecart(so);
      if (e2 === null) return 0;
      if (Math.abs(e2) > 0.05) { var sl = (e2 - e0) / (so || 1); if (Math.abs(sl) > 1e-9) so = -e0 / sl; }   // un tour de plus (lentille inclinée…)
      return clamp(so, -Rc, Rc);
    }
    // Rayon de pente u (dans le plan dessiné) ; dans l'autre direction il vise le centre de l'élément suivant, décalé de so.
    function pente(u, so) {
      var Q = Cn.slice(); Q[1 - axe] += so;
      var v = [Q[0] - dep.p[0], Q[1] - dep.p[1], Q[2] - dep.p[2]];
      v[axe] = u * v[2];
      var dn = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
      return dn > 0 ? [v[0] / dn, v[1] / dn, v[2] / dn] : null;
    }
    // Pentes (dans le plan dessiné) des rayons du pinceau : null si la chaîne n'en laisse passer aucune (visée classique).
    // Un rayon « passe » s'il arrive au détecteur (ou au bout de la chaîne, sans détecteur) sans être arrêté.
    function pentesExactes(l, so) {
      var Lo = Math.max(cone ? cone.lo : -1.5, -1.5), Hi = Math.min(cone ? cone.hi : 1.5, 1.5), cache = {};
      function ok(u) {
        var k = u.toPrecision(14);
        if (k in cache) return cache[k];
        var d = pente(u, so), s, v = false;
        if (d) {
          s = suivre(seq, { p: dep.p.slice(), d: d, l: l, w: 1, f: [0, 0, 0], J: null, L: 0, n: 1, x: 0, y: 0, hors: false, ordre: null }, dep.de);
          v = s.etat === "detecte" || s.etat === "diffuse" || (seq.iDet < 0 && s.etat === "perdu");
        }
        return (cache[k] = v);
      }
      function bord(u0, sg, pas, dLo, dHi) { return bordExact(ok, u0, sg, pas, sg < 0 ? (dLo === undefined ? Lo : dLo) : (dHi === undefined ? Hi : dHi)); }
      var lo0 = clamp(coneFin.lo, Lo, Hi), hi0 = clamp(coneFin.hi, Lo, Hi), w = Math.max(hi0 - lo0, 1e-6), seed = (lo0 + hi0) / 2, k;
      if (!ok(seed)) {
        seed = null;
        var ordreK = [];
        for (k = 1; k < 24; k++) ordreK.push(k);
        ordreK.sort(function (x, y) { return Math.abs(x - 12) - Math.abs(y - 12); });
        for (k = 0; k < ordreK.length && seed === null; k++) { var uk = lo0 + w * ordreK[k] / 24; if (ok(uk)) seed = uk; }
        if (seed === null) return null;
      }
      var a = bord(seed, -1, w * 0.25), b = bord(seed, 1, w * 0.25), W = Math.max(b - a, 1e-6), us = [], i;
      for (i = 0; i < n; i++) us.push({ u: n > 1 ? a + W * i / (n - 1) : (a + b) / 2, ok: true });
      var dg = Math.max(0.12 * W, 1e-5);       // un rayon gris de chaque côté : là où la lumière est arrêtée
      if (a - dg >= Lo) us.push({ u: a - dg, ok: false });
      if (b + dg <= Hi) us.push({ u: b + dg, ok: false });
      // Lumière qui passe à côté d'une monture et arrive quand même au détecteur : on vise juste hors de chaque monture
      // (le rayon est ensuite essayé pour de bon), la région voisine la plus proche de chaque côté, 3 rayons.
      var cand = [];
      for (j = dep.de; j < P.length; j++) {
        var q = P[j], Cj = C.centrePlan(q), dz = Cj[2] - dep.p[2];
        if (q.k === K_.AIRY || !(q.Sm < C.GRAND / 2) || !(dz > 1e-6)) continue;
        [-1, 1].forEach(function (sg) { var u = (Cj[axe] + sg * (q.Sm * 1.03 + 0.2) - dep.p[axe]) / dz; if (u > Lo && u < Hi && (u < a - dg || u > b + dg)) cand.push(u); });
      }
      cand.sort(function (x, y) { return x - y; });
      [-1, 1].forEach(function (sg) {
        var c = cand.filter(function (u) { return sg < 0 ? u < a - dg : u > b + dg; });
        if (sg < 0) c.reverse();
        var s2 = null, m;
        for (m = 0; m < c.length && s2 === null; m++) if (ok(c[m])) s2 = c[m];
        if (s2 === null) return;
        // la bande ne déborde jamais sur la région principale (le pas doublé sauterait l'anneau arrêté entre ouverture et monture)
        var bl = sg < 0 ? Lo : b + dg, bh = sg < 0 ? a - dg : Hi;
        var e1 = bord(s2, -1, Math.max(W, 1e-3) * 0.25, bl, bh), e2 = bord(s2, 1, Math.max(W, 1e-3) * 0.25, bl, bh), t;
        for (t = 0; t < 3; t++) us.push({ u: e1 + (e2 - e1) * (t + 0.5) / 3, ok: true });
      });
      return us;
    }
    (ls || [550]).forEach(function (l) {
      var so = seq.detEl && seq.detEl.type === "oeil" ? viseOeil(l) : soL, us = coneFin ? pentesExactes(l, so) : null;
      if (us) {
        us.forEach(function (q) {
          var d = pente(q.u, so);
          if (!d) return;
          var r = { p: dep.p.slice(), d: d, l: l, w: 1, f: [0, 0, 0], J: null, L: 0, n: 1, x: 0, y: 0, hors: false, ordre: null };
          var s = suivre(seq, r, dep.de);
          out.push({ l: l, etat: s.etat, ordre: null, pts: s.pts.map(function (p) { return [p[2], p[axe]]; }) });
        });
        return;
      }
      ordres.forEach(function (ordre) {
        for (var i = 0; i < n; i++) {
          var t = n > 1 ? -1 + 2 * i / (n - 1) : 0, p0 = dep.p.slice(), dd;
          if (laser) { p0[axe] += t * em.a; dd = [0, 0, 1]; }
          else {
            var Q = Cn.slice(); Q[axe] += t * Rc; Q[1 - axe] += so;
            var v = [Q[0] - p0[0], Q[1] - p0[1], Q[2] - p0[2]];
            if (fan) v[axe] = (fan.lo + (fan.hi - fan.lo) * (n > 1 ? i / (n - 1) : 0.5)) * v[2];
            var dn = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
            if (!(dn > 0)) continue;
            dd = [v[0] / dn, v[1] / dn, v[2] / dn];
          }
          var r = { p: p0, d: dd, l: l, w: 1, f: [0, 0, 0], J: null, L: 0, n: 1, x: 0, y: 0, hors: false, ordre: ordre };
          var s = suivre(seq, r, dep.de);
          out.push({ l: l, etat: s.etat, ordre: ordre, pts: s.pts.map(function (q) { return [q[2], q[axe]]; }) });
        }
      });
    });
    return out;
  }

  // ================= couleur des rayons du pinceau et tache sur le détecteur =================
  // Rayons du pinceau : trois couleurs (460, 550, 640 nm) en lumière blanche en optique réelle, superposées sans aberration
  // chromatique et écartées avec elle. Tache : N_TACHE longueurs d'onde pondérées comme la source, pour un halo continu.
  var N_TACHE = 12;
  var MIC = root && root.VITRINE_MICHELSON;
  if (!MIC && typeof require === "function") MIC = require("./_app-michelson-coeur.js").Coeur;
  // Rayons du pinceau et de la vue dans l'œil : {ls, blanc, simple} ; `simple` : couleur CIE de chaque longueur d'onde telle quelle.
  function echantillonRayons(seq) {
    var sp = seq && seq.source ? seq.source.sp : null;
    if (!sp) return { ls: [550], blanc: true, simple: true };
    var bl = seq.source.nomSpectre === "bl";
    return { ls: seq.optique === "reelle" && bl ? [460, 550, 640] : [sp.type === 1 ? sp.l[0] : 550], blanc: false, simple: true, teinteBlanche: !(seq.optique === "reelle" && bl) && bl };
  }
  // {ls, w, blanc} : longueurs d'onde de la source et poids (somme 1). Optique parfaite (pas de dispersion) : une seule
  // couleur, blanche pour un spectre continu. Optique réelle : spectre continu = N longueurs d'onde stratifiées pondérées
  // par Planck, raies = leurs longueurs d'onde pondérées par leurs poids.
  function echantillonSpectre(seq, N) {
    var sp = seq && seq.source ? seq.source.sp : null;
    if (!sp) return { ls: [550], w: [1], blanc: true };
    var bl = sp.type === 0, ls = [], w = [], i, tot = 0;
    if (seq.optique !== "reelle") return bl ? { ls: [550], w: [1], blanc: true } : { ls: [sp.l[0]], w: [1], blanc: false };
    if (bl) {
      for (i = 0; i < N; i++) { var l = sp.a + (sp.b - sp.a) * (i + 0.5) / N, p = C.planckU(l, sp.T); ls.push(l); w.push(p); tot += p; }
    } else {
      for (i = 0; i < sp.l.length; i++) { var q = sp.cum[i] - (i ? sp.cum[i - 1] : 0); ls.push(sp.l[i]); w.push(q); tot += q; }
    }
    return { ls: ls, w: w.map(function (x) { return x / tot; }), blanc: false };
  }
  // Teinte (CSS) du rayon de longueur d'onde l : sa couleur CIE pondérée par son poids dans le spectre, normalisée pour
  // que la somme de toutes les longueurs d'onde superposées retombe sur la couleur de la source (blanc d'une lampe
  // halogène compris : balance des blancs du cœur) ; une seule longueur d'onde : sa couleur telle quelle.
  function couleurRayon(ech, l) {
    if (ech.blanc || ech.teinteBlanche) return "#ffe7ad";
    if (ech.simple) { var r0 = MIC.versRGB(MIC.cie(l), 1.6, MIC.balance(), 0); return "rgb(" + r0.map(Math.round).join(",") + ")"; }
    var k = 0, i, Y = 0, c, f = 1;
    for (i = 0; i < ech.ls.length; i++) if (Math.abs(ech.ls[i] - l) < Math.abs(ech.ls[k] - l)) k = i;
    if (ech.ls.length > 1) { for (i = 0; i < ech.ls.length; i++) Y += ech.w[i] * MIC.cie(ech.ls[i])[1]; f = ech.w[k] / Y; }
    c = MIC.cie(l);
    var rgb = MIC.versRGB([c[0] * f, c[1] * f, c[2] * f], 1.6, MIC.balance(), 0);
    return "rgb(" + rgb.map(Math.round).join(",") + ")";
  }
  // Longueur d'onde la plus proche de 550 nm : les normales aux dioptres ne se dessinent qu'avec elle.
  function lRef(ech) { var k = 0, i; for (i = 1; i < ech.ls.length; i++) if (Math.abs(ech.ls[i] - 550) < Math.abs(ech.ls[k] - 550)) k = i; return ech.ls[k]; }

  // Tache : où tombent, sur le détecteur, les rayons issus du point (hx, hy) de l'objet (de la source sans objet), sur
  // TOUTE l'ouverture utile de la chaîne dans les deux directions. Pour chaque longueur d'onde, le cône paraxial de
  // chaque axe (`enveloppe`) donne la graine, les bords sont précisés au tracé exact comme dans `pinceau`, puis une grille
  // n × n de pentes les couvre (le rayon passe s'il arrive au détecteur). Renvoie {raison} si la tache n'a pas de sens
  // (laser, réseau, dépoli comme objet, pas de détecteur, rien n'arrive), sinon {taches: [{l, w, pts: [[x, y]…], essais}],
  // centre: [x, y] ou null (barycentre à la longueur d'onde de référence)} ; (x, y) = repère du détecteur.
  function spotPinceau(seq, hx, hy, ech, n) {
    if (!seq || !seq.source || !seq.prims || !seq.prims.length) return { raison: TRAD("Poser la lanterne sur le banc.") };
    if (!(seq.iDet >= 0)) return { raison: TRAD("Pas de détecteur sur le banc.") };
    var dep = departPinceau(seq, 1, hy || 0, hx || 0), P = seq.prims, j, cones = [null, null], ax;
    if (!dep) return { raison: TRAD("Pas d'élément après la source.") };
    if (!dep.objet && seq.source.em && seq.source.em.forme === "gauss") return { raison: TRAD("Pas de tache pour un faisceau laser.") };
    if (dep.objet && dep.objet.k === K_.DIFFUSEUR) return { raison: TRAD("L'objet est un dépoli : la lumière en repart dans toutes les directions.") };
    if (dep.objet && dep.objet.k === K_.MASQUE && formeOpaque(dep.objet, dep.p)) return { raison: TRAD("Le point visé est sur un trait opaque de l'objet : aucune lumière n'en part.") };
    for (j = dep.de; j < P.length; j++) if (P[j].k === K_.RESEAU) return { raison: TRAD("Pas de tache derrière un réseau (un faisceau par ordre).") };
    var src = [{ lo: -1.5, hi: 1.5 }, { lo: -1.5, hi: 1.5 }];
    for (ax = 0; ax < 2; ax++) {
      var cap = dep.objet ? { j: seq.objet } : { j: -1 };
      enveloppe(seq, ax, 1, null, cap);
      if (dep.objet) { var cs = penteEclairee(cap.M, dep.p[ax]); if (!cs) return { raison: TRAD("Ce point de l'objet n'est pas éclairé.") }; src[ax] = { lo: Math.max(cs.lo, -1.5), hi: Math.min(cs.hi, 1.5) }; }
      if (cap.M && cap.polyFin && cap.polyFin.length) cones[ax] = penteEclairee({ A: cap.M.A, B: cap.M.B, C: cap.M.C, D: cap.M.D, ty: cap.M.ty, tv: cap.M.tv, poly: cap.polyFin }, dep.p[ax]);
      if (!cones[ax]) return { raison: TRAD("La lumière de ce point n'arrive pas jusqu'au détecteur.") };
    }
    n = n || 25;
    var out = [], centre = null, lr = lRef(ech);
    ech.ls.forEach(function (l, k) {
      function suit(u0, u1) {
        var d = [u0, u1, 1], dn = Math.sqrt(u0 * u0 + u1 * u1 + 1);
        return suivre(seq, { p: dep.p.slice(), d: [d[0] / dn, d[1] / dn, 1 / dn], l: l, w: 1, f: [0, 0, 0], J: null, L: 0, n: 1, x: 0, y: 0, hors: false, ordre: null }, dep.de);
      }
      function passe(u0, u1) { return suit(u0, u1).etat === "detecte"; }
      var lo = [clamp(cones[0].lo, src[0].lo, src[0].hi), clamp(cones[1].lo, src[1].lo, src[1].hi)], hi = [clamp(cones[0].hi, src[0].lo, src[0].hi), clamp(cones[1].hi, src[1].lo, src[1].hi)];
      var seed = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2], g, i;
      if (!passe(seed[0], seed[1])) {       // le centre du cône ne passe pas : une petite grille cherche un rayon qui passe
        seed = null;
        for (g = 0; g < 49 && !seed; g++) { var a0 = lo[0] + (hi[0] - lo[0]) * ((g % 7) + 0.5) / 7, a1 = lo[1] + (hi[1] - lo[1]) * (Math.floor(g / 7) + 0.5) / 7; if (passe(a0, a1)) seed = [a0, a1]; }
      }
      var rec = { l: l, w: ech.w[k], pts: [], essais: 0 };
      if (seed) {
        var w0 = Math.max(hi[0] - lo[0], 1e-6), w1 = Math.max(hi[1] - lo[1], 1e-6);
        var b0 = [bordExact(function (u) { return passe(u, seed[1]); }, seed[0], -1, w0 * 0.25, src[0].lo), bordExact(function (u) { return passe(u, seed[1]); }, seed[0], 1, w0 * 0.25, src[0].hi)];
        var b1 = [bordExact(function (u) { return passe(seed[0], u); }, seed[1], -1, w1 * 0.25, src[1].lo), bordExact(function (u) { return passe(seed[0], u); }, seed[1], 1, w1 * 0.25, src[1].hi)];
        // grille sur la boîte des deux bords, élargie de 6 % (la région de passage n'est pas un rectangle : rond, fente…)
        var m0 = 0.06 * (b0[1] - b0[0]), m1 = 0.06 * (b1[1] - b1[0]), A0 = b0[0] - m0, A1 = b1[0] - m1, S0 = b0[1] - b0[0] + 2 * m0, S1 = b1[1] - b1[0] + 2 * m1;
        for (i = 0; i < n; i++) for (g = 0; g < n; g++) {
          var s = suit(A0 + S0 * (i + 0.5) / n, A1 + S1 * (g + 0.5) / n);
          rec.essais++;
          if (s.etat === "detecte") rec.pts.push([s.x, s.y]);
        }
      }
      out.push(rec);
      if (l === lr && rec.pts.length) {
        var cx = 0, cy = 0; rec.pts.forEach(function (q) { cx += q[0]; cy += q[1]; });
        centre = [cx / rec.pts.length, cy / rec.pts.length];
      }
    });
    return { taches: out, centre: centre };
  }

  // ================= dans l'œil =================
  // Rayons du pinceau qui entrent dans un œil posé, dans son repère : u = distance le long de la lumière depuis la
  // pupille (le cristallin du modèle est la lentille idéale de la pupille, la rétine est à RETINE), v = hauteur dans le
  // plan dessiné. Le pinceau est tiré serré (n rayons sur l'ouverture qui suit l'objet) et seuls ceux qui atteignent
  // la rétine sont gardés (au plus `garde`, pris régulièrement). Croisement = u qui minimise la dispersion des hauteurs
  // des droites prolongées (moindres carrés : u* = −cov(v, pente) / var(pente)) ; u* < 0 : faisceau divergent.
  // Renvoie null si l'œil n'est pas dans la séquence, sinon {rayons: [{l, v0, pente, avant: [u, v] à U_AVANT}], croise}.
  var U_AVANT = -9;
  function dansOeil(seq, eId, axe, h, ls, n, garde, ho) {
    if (!seq || !seq.prims) return null;
    var P = seq.prims, ip = -1, i;
    for (i = 0; i < P.length; i++) if (P[i].el === eId) { ip = i; break; }
    if (ip < 0) return null;
    var z0 = P[ip].zp, sg = P[ip].sens || 1, res = { rayons: [], croise: null }, c0 = C.centrePlan(P[ip])[axe];      // hauteurs comptées depuis le centre de la pupille (œil décalé)
    var R = pinceau(seq, axe, h, ls, n || 161, ho).filter(function (r) { return r.etat === "detecte" && r.pts.length >= 3 && Math.abs(sg * (r.pts[r.pts.length - 1][0] - z0) - RETINE) < 1e-6; });
    garde = garde || 11;
    var pas = Math.max(1, R.length / garde);
    for (var j = 0; j < R.length && res.rayons.length < garde; j = Math.floor(res.rayons.length * pas + 1e-9)) {
      var r = R[j], q = r.pts, a = q[q.length - 2], b = q[q.length - 1], k = q.length - 3;
      while (k > 0 && Math.abs(q[k][0] - a[0]) < 1e-9) k--;             // point d'avant la pupille (masque et lentille au même plan)
      var c = q[k], du = sg * (a[0] - c[0]), pIn = du > 1e-9 ? (a[1] - c[1]) / du : 0;
      res.rayons.push({ l: r.l, v0: a[1] - c0, pente: (b[1] - a[1]) / RETINE, avant: [U_AVANT, a[1] - c0 + pIn * U_AVANT] });
      if (pas === 1 && res.rayons.length >= R.length) break;
    }
    var N = res.rayons.length;
    if (N >= 2) {
      var mv = 0, ms = 0, cv = 0, vs = 0;
      res.rayons.forEach(function (r) { mv += r.v0 / N; ms += r.pente / N; });
      res.rayons.forEach(function (r) { cv += (r.v0 - mv) * (r.pente - ms); vs += (r.pente - ms) * (r.pente - ms); });
      if (vs > 1e-14) { var u = -cv / vs; res.croise = { u: u, v: mv + ms * u }; }
    }
    return res;
  }

  // ================= rayons de construction =================
  // Renvoie {raison} si la construction n'a pas de sens, sinon {objet: {z, a, b}, lentilles: [{z, c, f, F, Fp,
  // image: {z, a, b, infini, virtuelle, formee, pente}, rayons: [{type, segs: [{z1, h1, z2, h2, tirets}]}]}], fin}.
  // Objet AB : A au centre de la plaque (règle : sur l'axe du banc), B à HAUT_B au-dessus, ou à hB du centre de la plaque
  // (point B choisi par l'élève, borné à l'objet ; confondu avec A : HAUT_B). Pour chaque lentille, trois rayons issus de (ou
  // dirigés vers) l'objet du moment : par le centre optique, parallèle à l'axe (émerge par F′), par F (émerge parallèle) ;
  // deux seulement quand l'image est à l'infini (le rayon par F n'existe plus, voir plus bas).
  // Trait plein : là où la lumière passe (entre la lentille précédente et la suivante, ou l'écran) ; tirets : les
  // prolongements vers un objet ou une image virtuels, ou vers l'image qui se formerait derrière l'écran.
  // Un conjugué au-delà de SEUIL_INFINI est tenu pour À L'INFINI. L'objet d'une lentille, alors, n'a plus de hauteur :
  // la gerbe qui lui arrive est parallèle (elle prolonge les rayons sortis de la lentille précédente, même pente, mêmes
  // hauteurs) et l'image tombe dans le plan focal — c'est cette pente, et non la taille d'un objet, qui porte
  // l'information. Les rayons sont donc repris de proche en proche au lieu d'être recalculés depuis une hauteur
  // d'objet devenue géante (le rayon « parallèle à l'axe » d'un objet sans hauteur partait à 300 m, quasi vertical).
  function construction(seq, axe, hB) {
    if (!seq || !seq.source || !seq.prims) return { raison: TRAD("Poser la lanterne et un objet sur le banc.") };
    if (seq.optique !== "parfaite") return { raison: TRAD("Les rayons de construction sont ceux d'une lentille mince idéale : passer en optique parfaite.") };
    var P = seq.prims, o = seq.objet;
    if (o < 0 || !HAUT_B[P[o].type]) return { raison: TRAD("Poser un objet étendu (lettre F, quadrillage, dépoli, règle) : la construction part du haut de l'objet.") };
    var nd = seq.iDet >= 0 ? seq.iDet : P.length, detId = seq.detEl ? seq.detEl.id : null, L = [], j;
    for (j = o + 1; j < nd; j++) {
      if (P[j].k === K_.MIROIR) break;
      // seules les lentilles POSÉES comptent : pas l'oculaire/la lunette d'un instrument ni l'œil (leurs prims
      // IDEALE sinon traverseraient la construction)
      if (P[j].k === K_.IDEALE && P[j].sens > 0 && P[j].el !== detId && (P[j].type === "lentille" || P[j].type === "condenseur")) L.push(P[j]);
    }
    if (!L.length) return { raison: TRAD("Poser une lentille après l'objet.") };
    // la construction s'arrête au premier observateur (écran, capteur, œil, viseur, lunette) ou au miroir
    var zFin = LONGUEUR;
    for (j = o + 1; j < P.length; j++) {
      var tj = P[j].type;
      if (P[j].k === K_.MIROIR || tj === "ecran" || tj === "capteur" || tj === "oeil" || tj === "viseur" || tj === "lunette") { zFin = P[j].zp; break; }
    }
    var Co = C.centrePlan(P[o]);
    var aA = Co[axe];
    if (P[o].type === "regle") aA = clamp(0, Co[axe] - ETENDUE.regle[axe] + 0.5, Co[axe] + ETENDUE.regle[axe] - 0.5);
    var bB = aA + HAUT_B[P[o].type][axe], mB = ETENDUE[P[o].type] ? ETENDUE[P[o].type][axe] : 0;
    if (hB != null && mB > 0) { var b2 = Co[axe] + clamp(hB, -mB, mB); if (Math.abs(b2 - aA) > 1e-6) bB = b2; }
    var res = { objet: { z: Co[2], a: aA, b: bB }, lentilles: [], fin: zFin };
    // objet du moment : réel ({z, a, b}) ou gerbe parallèle ({infini, pente, hauts} : la pente commune et la hauteur
    // de chaque rayon au plan de la lentille qui l'a produite, à reprendre telle quelle)
    var ob = { z: res.objet.z, a: res.objet.a, b: res.objet.b, infini: false, pente: 0, hauts: null }, zPrec = ob.z;
    L.forEach(function (pr, n) {
      var zL = pr.zp, c = pr.O[axe], f = pr.p[0], zo = ob.z, hb = ob.infini ? c : ob.b, dern = n === L.length - 1;
      var zSuiv = dern ? Math.max(zFin, zL) : L[n + 1].zp;
      // objet à l'infini : image dans le plan focal (p = −∞) ; image à l'infini : au-delà du seuil, ou |p + f| nul
      // (pp infini, jamais NaN)
      var p = ob.infini ? -Infinity : zo - zL, pp = ob.infini ? f : p * f / (p + f);
      var inf = !ob.infini && !(Math.abs(pp) < SEUIL_INFINI), zi = zL + pp, g = inf || !p ? 1 : pp / p;
      var pente = ob.infini ? ob.pente : (c - hb) / (zL - zo || 1e-12);        // rayon par le centre optique
      var im = inf ? { z: Infinity, a: c, b: c, infini: true, virtuelle: false, formee: false, pente: pente }
        : { z: zi, a: ob.infini ? c : c + g * (ob.a - c), b: ob.infini ? c + pente * f : c + g * (hb - c),
          infini: false, virtuelle: pp < 0, formee: pp > 0 && zi <= zSuiv + 1e-9 };
      var Lz = { z: zL, c: c, f: f, F: [zL - f, c], Fp: [zL + f, c], suiv: zSuiv, image: im, rayons: [] };
      // hauteurs des rayons au plan de la lentille : pour un objet réel, les rayons particuliers (par le centre
      // optique, parallèle à l'axe, par F) ; pour un objet à l'infini, la gerbe parallèle déjà tracée, reprise sans
      // invention (un objet sans hauteur n'a pas de rayon « parallèle à l'axe »)
      var hL;
      if (ob.infini) hL = ob.hauts.map(function (q) { return [q.type, q.h + ob.pente * (zL - ob.z)]; });
      else {
        hL = [["centre", c], ["parallele", hb]];
        var hF = c + (hb - c) * f / (p + f);
        // rayon par F : hors de la monture quand l'image s'éloigne (il part presque à la verticale) — pas tracé
        if (!inf && Math.abs(hF - c) <= demiOuverture(pr, axe)) hL.push(["foyer", hF]);
      }
      if (Math.abs(p) > 1e-9) hL.forEach(function (t) {
        var h0 = t[1], segs = [];
        function hin(z) { return h0 + (ob.infini ? pente : (hb - h0) / p) * (z - zL); }
        function hout(z) { return inf ? h0 + pente * (z - zL) : h0 + (im.b - h0) * (z - zL) / pp; }
        // gr = n : tout ce que trace une lentille forme UNE gerbe, de l'image qui la précède à celle qu'elle donne
        // (le V de part et d'autre du verre) — la couleur change donc au point B, pas sur la lentille
        function seg(z1, z2, f, tirets) { if (Math.abs(z2 - z1) > 1e-9) segs.push({ z1: z1, h1: f(z1), z2: z2, h2: f(z2), tirets: !!tirets, gr: n }); }
        if (ob.infini) ;                                                             // gerbe parallèle : la lentille précédente l'a tracée, même couleur
        else if (p < 0 && (zo >= zPrec - 1e-9)) seg(zo, zL, hin);                    // objet réel, devant la lentille
        else if (p < 0) { seg(zo, zPrec, hin, true); seg(zPrec, zL, hin); }          // image virtuelle de la lentille précédente
        else { seg(zPrec, zL, hin); seg(zL, zo, hin, true); }                        // objet virtuel
        if (inf) seg(zL, zSuiv, hout);
        else if (pp > 0) { seg(zL, Math.min(zi, zSuiv), hout); if (zi > zSuiv && dern) seg(zSuiv, zi, hout, true); }
        else { seg(zL, zSuiv, hout); seg(zi, zL, hout, true); }
        Lz.rayons.push({ type: t[0], segs: segs });
      });
      res.lentilles.push(Lz);
      // image à l'infini : la lentille suivante reçoit une gerbe parallèle, à la pente et aux hauteurs d'ici
      ob = inf ? { z: zL, a: im.a, b: im.b, infini: true, pente: pente, hauts: hL.map(function (t) { return { type: t[0], h: t[1] }; }) }
        : { z: im.z, a: im.a, b: im.b, infini: false, pente: 0, hauts: null };
      zPrec = zL;
    });
    return res;
  }

  // Champ vu par le détecteur (viseur, lunette, œil, écran, capteur) sur le plan de l'objet : disque paraxial, même
  // algorithme que `champVu` du cœur mais depuis l'objet jusqu'au détecteur, avec comme borne finale le champ visuel
  // de l'œil (±W_OEIL) ou la taille du détecteur (écran, capteur). null si tout l'objet tient dans ce champ, ou si la
  // chaîne est décentrée/inclinée/repliée.
  function champVuInstrument(seq) {
    if (!seq || seq.objet < 0 || !(seq.iDet >= 0)) return null;
    var P = seq.prims, o = seq.objet, iDet = seq.iDet, l = 587.6, ap = [], m;
    for (m = o + 1; m <= iDet; m++) {
      var q = P[m], f = q.p[0];
      if (q.k === K_.AIRY || q.k === K_.FILTRE || q.k === K_.JONES || q.k === K_.PHASE) continue;
      if (q.k === K_.MASQUE && (f === F_.LETTRE || f === F_.GRILLE || f === F_.REGLE || f === F_.DIAPO)) continue;   // objets : pas des diaphragmes
      if (q.k !== K_.SURF && q.k !== K_.IDEALE && q.k !== K_.MASQUE && q.k !== K_.DET) continue;
      if (q.O[0] !== 0 || q.O[1] !== 0 || q.ez[0] !== 0 || q.ez[1] !== 0 || (q.sens || 1) < 0) return null;
      var M = C.chaine(seq, l, o, m);
      ap.push([M[0], M[1], q.k === K_.DET ? (seq.det && seq.det.type === "oeil" ? W_OEIL : C.rayonUtile(q)) : C.rayonUtile(q)]);
    }
    if (!ap.length) return null;
    var X0 = P[o].rc || 20, X = X0, it, uM;
    for (it = 0; it < 4; it++) {      // chaque borne resserre l'autre, toutes deux restent vraies
      uM = Infinity;
      ap.forEach(function (a) { if (Math.abs(a[1]) > 1e-9) uM = Math.min(uM, (a[2] + Math.abs(a[0]) * X) / Math.abs(a[1])); });
      if (!isFinite(uM)) return null;
      ap.forEach(function (a) { if (Math.abs(a[0]) > 1e-9) X = Math.min(X, (a[2] + Math.abs(a[1]) * uM) / Math.abs(a[0])); });
    }
    return X < X0 ? X : null;        // null si tout l'objet tient dans le champ
  }

  // Aide « Polarisation » : l'état de polarisation entre les pièces, de la source au premier détecteur, à
  // une longueur d'onde de référence (raie de la lampe, laser, 546 nm derrière un filtre interférentiel, sinon 550 nm :
  // en lumière blanche, une lame donne un état différent à chaque longueur d'onde). Lumière naturelle tant qu'aucun
  // polariseur n'est passé (une lame la laisse naturelle). J = [Ex, Ey] en [re, im, re, im], axes du CŒUR, amplitude :
  // |J|² = intensité rapportée à celle de la source (½ derrière un polariseur). Rendu : [{z, nat} | {z, J, I}], z au
  // milieu de l'intervalle entre deux pièces ; vide sans pièce polarisante.
  function lambdaRef(els) {
    var l = 550;
    els.forEach(function (e) {
      var p = C.params(e);
      if (e.type === "laser") l = p.vert ? 532 : 632.8;
      else if (e.type === "spectrale") l = p.gaz === "na" ? 589.3 : 546.07;
      else if (e.type === "filtre" && p.couleur === "interferentiel") l = 546.07;
    });
    return l;
  }
  function polarisations(st) {
    var els = st.elements.slice().sort(function (a, b) { return a.z - b.z; }), i0 = -1, i;
    for (i = 0; i < els.length; i++) if (els[i].type === "lanterne" || els[i].type === "spectrale" || els[i].type === "laser") { i0 = i; break; }
    if (i0 < 0) return { l: 550, etats: [] };
    var fin = els.length;
    for (i = i0 + 1; i < els.length; i++) if (/^(ecran|capteur|oeil|miroir|viseur|lunette)$/.test(els[i].type)) { fin = i; break; }
    var trajet = els.slice(i0, fin + 1), l = lambdaRef(trajet), out = [], J = null, vu = false;
    function milieu(k) { return trajet[k + 1] ? (trajet[k].z + trajet[k + 1].z) / 2 : trajet[k].z + 40; }
    for (i = 1; i < trajet.length; i++) {
      var e = trajet[i];
      if (!C.TYPES[e.type].polarisant) continue;
      if (!vu) { out.push({ z: milieu(i - 1), nat: true }); vu = true; }
      var M = C.jones(e, l);
      if (!J) {
        if (e.type !== "polariseur") { out.push({ z: milieu(i), nat: true }); continue; }
        var c = Math.cos(e.rot || 0), s = Math.sin(e.rot || 0), a = Math.SQRT1_2;
        J = [a * c, 0, a * s, 0];
      } else {
        J = [M[0][0] * J[0] - M[0][1] * J[1] + M[1][0] * J[2] - M[1][1] * J[3], M[0][0] * J[1] + M[0][1] * J[0] + M[1][0] * J[3] + M[1][1] * J[2],
          M[2][0] * J[0] - M[2][1] * J[1] + M[3][0] * J[2] - M[3][1] * J[3], M[2][0] * J[1] + M[2][1] * J[0] + M[3][0] * J[3] + M[3][1] * J[2]];
      }
      out.push({ z: milieu(i), J: J.slice(), I: J[0] * J[0] + J[1] * J[1] + J[2] * J[2] + J[3] * J[3] });
    }
    return { l: l, etats: out };
  }
  // Niveaux de rendu, menu « Rendu » de la barre, hors mode prof. Rayons : aperçu
  // (résolution `ap`, temps visé d'une passe `ms`, rayons adaptatifs), image fine à la résolution de l'observation,
  // arrêtée quand le bruit mesuré atteint `bruit` ou au plafond `plafond` (ms). Ondes : préréglage prof `onde` (le 3
  // = le rendu d'origine, MAX_POINTS_FIN ; 2 pour Normal aurait dégradé ce défaut).
  // Ql.prof : le préréglage ou les réglages du panneau prof remplacent le niveau (rendu à passes fixes).
  var RENDUS = [null,
    { nom: TRAD("Rapide"), ap: 256, ms: 10, Nr: 20, bruit: 0.06, plafond: 1000, visible: 5, onde: 1, titre: TRAD("Image vite prête, encore un peu granuleuse (bruit 6 %, au plus 1 s).") },
    { nom: "Normal", ap: 384, ms: 16, Nr: 21, bruit: 0.03, plafond: 3000, visible: 3, onde: 3, titre: TRAD("Le rendu par défaut (bruit 3 %, au plus 3 s).") },
    { nom: TRAD("Fin"), ap: 512, ms: 25, Nr: 21, bruit: 0.02, plafond: 8000, visible: 2, onde: 4, titre: TRAD("Image plus propre (bruit 2 %, au plus 8 s).") },
    { nom: TRAD("Très fin"), ap: 512, ms: 33, Nr: 21, bruit: 0.01, plafond: 20000, visible: 1, onde: 5, titre: TRAD("Image très propre (bruit 1 %, au plus 20 s).") },
    { nom: TRAD("Maximal"), ap: 768, ms: 50, Nr: 21, bruit: 0.005, plafond: 60000, visible: 0, onde: 6, titre: TRAD("Le plus fin possible, quitte à attendre (bruit 0,5 %, au plus 1 min ; l'aperçu peut ramer).") }];
  var Banc = { RENDUS: RENDUS, LONGUEUR: LONGUEUR, polarisations: polarisations, DEC_MAX: DEC_MAX, PIECES: PIECES, MONTAGES: MONTAGES, BACS: BACS, POSES: POSES, CAPTEUR_N: CAPTEUR_N, PIXEL: PIXEL,
    K_CAPTEUR: K_CAPTEUR, ISOS: ISOS, PUITS: PUITS, CIBLE_POSE: CIBLE_POSE, BARRETTE: BARRETTE, BARRETTE_PARFAITE: BARRETTE_PARFAITE, INTEG: INTEG, integVoulue: integVoulue,
    sensBarrette: sensBarrette, migrerBarrette: migrerBarrette, migrerMercure: migrerMercure, aParLumen: aParLumen, gainPhotodiode: gainPhotodiode, CALIBRES: CALIBRES, comptesSpec: comptesSpec, SPEC_SAT: SPEC_SAT, COMP_VISIBLE: COMP_VISIBLE, TIRAGE: TIRAGE, visionDe: visionDe, laserDansOeil: laserDansOeil,
    PROFILS: PROFILS, niveauDepart: niveauDepart, montagePermis: montagePermis, tiroirsDe: tiroirsDe, TIROIRS_COMMUNS: TIROIRS_COMMUNS, piecePermise: piecePermise, estRecepteur: estRecepteur, recepteurs: recepteurs, recepChoisi: recepChoisi, escamote: escamote, neutre: neutre, neutralisees: neutralisees, DECALABLE: DECALABLE,
    poser: poser, trouver: trouver, ranger: ranger, remplacerPiece: remplacerPiece, compte: compte, banc: banc, tirageVers: tirageVers, monter: monter, changerOptique: changerOptique, intact: intact, memesPieces: memesPieces, etatDepart: etatDepart, groupesDe: groupesDe, THEMES: THEMES,
    valide: valide, dansOeil: dansOeil, detecteur: detecteur, instrumentDe: instrumentDe, distanceNette: distanceNette, puissance: puissance, visee: visee, sequence: sequence, amplitude: amplitude, W_OEIL: W_OEIL, RETINE: RETINE, OCULAIRE: OCULAIRE, fenetre: fenetre, focaleVraie: focaleVraie, inclinaison: inclinaison, incliner: incliner, W_PLAQUE: W_PLAQUE, poseVoulue: poseVoulue, nomPose: nomPose, nomDe: nomDe, demiHauteur: demiHauteur,
    enveloppe: enveloppe, faisceauLaser: faisceauLaser, suivreParax: suivreParax, pinceau: pinceau, spotPinceau: spotPinceau, echantillonSpectre: echantillonSpectre, echantillonRayons: echantillonRayons, couleurRayon: couleurRayon, lRef: lRef, N_TACHE: N_TACHE, VARIANTES: VARIANTES, departPinceau: departPinceau, construction: construction, demiOuverture: demiOuverture, ramenerDansObjet: ramenerDansObjet, formeOpaque: formeOpaque, champVuInstrument: champVuInstrument };
  if (typeof module !== "undefined" && module.exports) { module.exports = { Banc: Banc }; return; }

  // ======================================================================================================
  // ================= interface ==========================================================================
  // ======================================================================================================
  // ======================================================================================================
  // ================= dessin des pièces : le module `Dessin` de la coque, plus la figure de chaque pièce ===============
  // ======================================================================================================
  // Le dessin (profil, vue de dessus, miniature de face, dégradés `bc*`) est celui de la coque (`Dessin`,
  // _app-paillasse.js, chargée AVANT ce fichier) ; ici, ce qui lit le catalogue du banc : `figure` (pièce → figure) et
  // les vignettes des diapos. Une pièce ajoutée : une entrée de `figure` ici, un cas de `corps` et de `miniature` là-bas.
  var Dessin = (function () {
    var D0 = root.VITRINE_PAILLASSE.Dessin, D = {}, k;
    for (k in D0) D[k] = D0[k];
    // Figure d'un élément du banc : genre de dessin (profil), miniature (face) et ce qu'il faut pour les dessiner.
    function figure(e) {
      var p = C.params(e);
      switch (e.type) {
        case "lanterne": return { genre: "lanterne", med: "lanterne", tirage: p.tirage, cond: p.cond, tirages: TIRAGE };
        case "lettreF": return { genre: "plaque", med: "F", objet: 10 };
        case "quadrillage": return { genre: "plaque", med: "quadrillage", objet: 10, clair: 1 };
        case "depoli": return { genre: "plaque", med: "depoli", clair: 2 };
        case "trouSource": return { genre: "plaque", med: "trou", objet: p.d / 2 };
        case "iris": return { genre: "iris", med: "iris", d: p.D };
        case "lentille": return { genre: "lentille", med: p.f > 0 ? "conv" : "div", f: p.f, diam: p.D, forme: p.forme, retournee: !!p.retournee, mo: p.forme === "objectif" ? "×20" : signe(p.f), incl: inclinaison(e) };
        case "ecran": return { genre: "ecran", med: "ecran" };
        case "filtre": return { genre: "plaque", med: "filtre", clair: 1, teinte: TEINTES[p.couleur] || TEINTES.vert };
        case "densite": return { genre: "plaque", med: "filtre", clair: 1, teinte: ["#9aa0a8", "#6f747b", "#4a4e54", "#2e3136"][clamp((p.d | 0) - 1, 0, 3)] };
        case "regle": return { genre: "plaque", med: "regle", clair: 1 };
        case "capteur": return { genre: "capteur", med: "capteur" };
        case "oeil": return { genre: "oeil", med: "oeil" };
        case "viseur": return { genre: "viseur", med: "viseur" };
        case "lunette": return { genre: "viseur", med: "lunette", long: true };
        case "miroir": return { genre: "miroir", med: "miroir" };
        case "spectrale": return { genre: "lampe", med: p.gaz === "na" ? "sodium" : "mercure" };
        case "laser": return { genre: "laser", med: "laser", vert: !!p.vert };
        case "fenteSource": return { genre: "plaque", med: "fente", objet: 5, rot: e.rot || 0 };
        case "bifentes": return { genre: "plaque", med: "bifente", objet: 2.5 };
        case "trousYoung": return { genre: "plaque", med: "young", objet: 0.3 };
        case "fentesMultiples": return { genre: "plaque", med: "multi", objet: 2.5 };
        case "reseau": return { genre: "plaque", med: "reseau", clair: 1 };
        case "fente": return { genre: "plaque", med: "fente", objet: 5, rot: e.rot || 0 };
        case "fil": return { genre: "plaque", med: "fil", clair: 1, rot: e.rot || 0 };
        case "grilleCroisee": return { genre: "plaque", med: "grille", clair: 1, pas: p.pas };
        case "objetPhase": return { genre: "plaque", med: "phase", clair: 1, forme: p.forme };
        case "pastille": return { genre: "plaque", med: "pastille", clair: 1, d: p.d };
        case "couteau": return { genre: "plaque", med: "couteau", objet: 15, rot: e.rot || 0, xc: p.xc };
        case "diapo": return { genre: "plaque", med: "diapo", objet: 10, image: p.image, eclairee: !!p.eclairee };
        case "polariseur": return { genre: "plaque", med: "pola", clair: 1, rot: e.rot || 0 };
        case "lame": return { genre: "plaque", med: "lame", clair: 1, rot: e.rot || 0, mo: p.ordre === "demi" ? "λ/2" : "λ/4" };
      }
      return { genre: "plaque", med: "" };
    }
    // Images des diapos réduites (64 × 64, PNG en data URL), faites au chargement des diapos (`chargerDiapos` plus bas).
    function vignettes() {
      var DI = C.DIAPOS, n = DI.n, m = 64, b = n / m;
      if (!n || typeof document === "undefined") return;
      C.DIAPO_NOMS.forEach(function (nom, k) {
        var cv = document.createElement("canvas"); cv.width = cv.height = m;
        var cx = cv.getContext("2d"), im = cx.createImageData(m, m), t = DI.t[k];
        for (var j = 0; j < m; j++) for (var i = 0; i < m; i++) {
          var s = 0;
          for (var v = 0; v < b; v++) for (var u = 0; u < b; u++) s += t[(j * b + v) * n + i * b + u];
          var g = Math.round(255 * s / (b * b)), q = 4 * (j * m + i);
          im.data[q] = im.data[q + 1] = im.data[q + 2] = g; im.data[q + 3] = 255;
        }
        cx.putImageData(im, 0, 0);
        try { D.poserVignette(nom, cv.toDataURL("image/png")); } catch (e) { /* canevas indisponible : verre */ }
      });
    }
    D.figure = figure; D.vignettes = vignettes;
    return D;
  })();
  // Images des diapos : app-banc-diapos.js (1,4 Mo), injecté À LA DEMANDE (première diapo posée) à côté de ce script, avec
  // son ?v= (hash des images) ; un <script> plutôt qu'un fetch : marche aussi en file://.
  var SRC_DIAPOS = (function () {
    try { var cs = document.currentScript; if (cs && cs.src) return cs.src.replace(/(_?)app-paillasse-banc\.js/, "$1app-banc-diapos.js"); } catch (e) {}
    return "app-banc-diapos.js";
  })();
  var diaposDemandees = false, vignettesFaites = false, diaposPretes = [];
  function chargerDiapos(fait) {
    function pret() { if (!vignettesFaites) { vignettesFaites = true; Dessin.vignettes(); } fait(); }
    if (C.DIAPOS.n) { pret(); return; }
    diaposPretes.push(pret);
    if (diaposDemandees) return;
    diaposDemandees = true;
    var sc = document.createElement("script"); sc.src = SRC_DIAPOS; sc.async = true;
    sc.onload = function () { if (root.VITRINE_BANC_DIAPOS) C.chargerDiapos(root.VITRINE_BANC_DIAPOS); diaposPretes.splice(0).forEach(function (f) { f(); }); };
    sc.onerror = function () { diaposDemandees = false; diaposPretes.length = 0; };
    document.head.appendChild(sc);
  }

  var PL = root.VITRINE_PAILLASSE = root.VITRINE_PAILLASSE || { instruments: {} };
  // Rayons de construction : UNE COULEUR PAR TRONÇON, c'est-à-dire par intervalle entre deux plans conjugués (B → B₁,
  // B₁ → B′…), pour suivre du regard où va chaque gerbe et où se forme l'image ; celui d'un tronçon dont l'image part à
  // l'infini a sa couleur propre (la gerbe parallèle se reconnaît d'un coup d'œil).
  var COUL_TRONCON = ["#ffb27a", "#8ad6a0", "#8ab6ff", "#e6a3e0", "#ffe08a", "#93d8d8"];
  var COUL_INFINI = "#c9a8ff";
  var MARGE = 34;                                // marge horizontale du banc dessiné (px)
  function fmt(v, n) { return nb(v, n == null ? 0 : n).replace(/^-/, "−"); }
  function fmtFin(v, d) { var m = Math.pow(10, d); return fmt(v, Math.abs(v * m - Math.round(v * m)) < 1e-6 ? d : d + 1); }      // une décimale de plus en ultrafin
  function cm(z) { var d = Math.abs(z - Math.round(z)) < 1e-6 ? 1 : Math.abs(z * 10 - Math.round(z * 10)) < 1e-6 ? 2 : 3; return fmt(z / 10, d) + " cm"; }
  // Réglage principal d'une pièce, celui que la molette règle sur sa miniature.
  var REGLAGE = { iris: TRAD("ouverture"), lanterne: TRAD("tirage du condenseur"), trouSource: TRAD("diamètre"), oeil: "accommodation", miroir: TRAD("inclinaison"),
    fenteSource: TRAD("largeur"), bifentes: TRAD("bifente utilisée"), fente: TRAD("largeur"), trousYoung: TRAD("écartement"), fentesMultiples: TRAD("nombre de fentes"), reseau: TRAD("traits par mm"),
    grilleCroisee: TRAD("pas"), objetPhase: TRAD("forme"), pastille: TRAD("diamètre"), couteau: TRAD("position du bord"), fil: "orientation", diapo: "image",
    polariseur: "orientation", lame: "orientation" };
  function decouverte(p) { var i = (p.caches || []).indexOf(false); return i < 0 ? 1 : i; }
  function decouvrir(e, i) { e.params.caches = ECARTS.map(function (a, k) { return k !== i; }); }
  var TROUS = [0.1, 0.2, 0.5, 1], XC_MAX = 2;          // vis du couteau : ±2 mm
  // fin : 0 ou false = pas normal ; 1 ou true = fin (Maj, pas ÷ 10) ; 2 = ultrafin (Ctrl+Maj, pas ÷ 100). Les grilles
  // d'arrondi suivent (÷ 10 en ultrafin), sinon le pas ultrafin serait arrondi à zéro.
  function regler(e, sens, fin) {
    var p = C.params(e), u = fin === 2 ? 0.1 : 1, f = function (normal, fn) { return sens * (fin ? fn * u : normal); };
    if (e.type === "iris") e.params.D = clamp(arrondi(p.D + f(1, 0.1), 0.1 * u), 1, 40);
    else if (e.type === "lanterne") e.params.tirage = clamp(arrondi(p.tirage + f(1, 0.1), 0.1 * u), TIRAGE[0], TIRAGE[1]);
    else if (e.type === "trouSource") { var i = TROUS.indexOf(p.d); e.params.d = TROUS[clamp((i < 0 ? 2 : i) + sens, 0, TROUS.length - 1)]; }
    else if (e.type === "miroir") incliner(e, inclinaison(e) + f(0.1, 0.01));
    else if (e.type === "fenteSource") e.params.b = clamp(arrondi(p.b + f(0.01, 0.001), 0.001 * u), 0, 2);
    else if (e.type === "bifentes") decouvrir(e, clamp(decouverte(p) + sens, 0, ECARTS.length - 1));
    else if (e.type === "couteau") e.params.xc = clamp(arrondi(p.xc + f(0.01, 0.001), 0.001 * u), -XC_MAX, XC_MAX);
    else if (e.type === "polariseur" || e.type === "lame") {      // tour complet, revient à −180° après 180°
      var a0 = arrondi((e.rot || 0) * 180 / Math.PI + f(5, 0.5), 0.5 * u);
      e.rot = (a0 > 180 ? a0 - 360 : a0 <= -180 ? a0 + 360 : a0) * Math.PI / 180;
    }
    else if (e.type === "fil") e.rot = clamp(arrondi((e.rot || 0) * 180 / Math.PI + f(5, 0.5), 0.5 * u), -90, 90) * Math.PI / 180;
    else if (VARIANTES[e.type]) { var V = VARIANTES[e.type], j = V[1].indexOf(p[V[0]]); e.params[V[0]] = V[1][clamp((j < 0 ? 0 : j) + sens, 0, V[1].length - 1)]; }
    else if (e.type === "oeil") {      // la molette reprend la main : accommodation manuelle, depuis le réglage en cours
      var am = amplitude(p.type);
      e.params.acc = clamp(arrondi(puissance(p) - am[0] + f(0.25, 0.05), 0.05 * u), 0, am[1]); e.params.mode = "curseur";
    }
    else return false;
    return true;
  }
  // Finesse d'un geste pour `regler` : Ctrl+Maj = 2 (ultrafin), Maj = 1, sinon 0.
  function finesse(ev) { return ev.shiftKey ? ((ev.ctrlKey || ev.metaKey) ? 2 : 1) : 0; }
  var CADENAS = '<svg width="12" height="12" viewBox="0 0 12 12" x="-6" y="-6"><rect x="2" y="5.5" width="8" height="6" rx="1.2" fill="currentColor"/><path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
  var ZOOM_MAX = 64;

  function creer(K) {
    var MI = root.VITRINE_MICHELSON, svg = K.svg, el = K.el;
    // composants de la coque (sélecteur segmenté, menus déroulants, clic droit)
    var seg = K.seg, deroulant = K.deroulant, ouvrirCtx = K.ouvrirCtx, fermerCtx = K.fermerCtx;
    var bac = K.meta.bac;
    if (!BACS[bac]) bac = "revisions";
    // Mémoire du navigateur : v 2 = {bacs: {<bac>: {A, B, cour}}} (deux bancs par matériel,
    // `cour` : celui qui est affiché) ; v 1 = {bacs: {<bac>: état}}, repris comme banc A. `tous` : le banc affiché de
    // chaque matériel, tenu d'accord avec AB par deposer().
    var mem = K.memoire.lire(), AB = {}, tous = {};
    if (mem && mem.bacs && (mem.v === 1 || mem.v === 2)) Object.keys(mem.bacs).forEach(function (b) {
      var o = mem.bacs[b];
      AB[b] = mem.v === 2 && o ? { A: o.A || null, B: o.B || null, cour: o.cour === "B" ? "B" : "A" } : { A: o, B: null, cour: "A" };
      migrerBarrette(AB[b].A); migrerBarrette(AB[b].B); migrerMercure(AB[b].A); migrerMercure(AB[b].B);
      tous[b] = AB[b][AB[b].cour];
    });
    if (K.estProf() && mem && BACS[mem.actif]) bac = mem.actif;      // le prof retrouve le bac qu'il avait choisi (le menu des bacs n'est qu'à lui)
    var st = valide(tous[bac]) ? tous[bac] : etatDepart(bac);
    function deposer() { var ab = AB[st.bac] || (AB[st.bac] = { A: null, B: null, cour: "A" }); ab[ab.cour] = st; tous[st.bac] = st; }
    function bancCourant() { return AB[st.bac] ? AB[st.bac].cour : "A"; }
    var SANS_ANNULER = ["cahier", "sel", "selL", "obs", "faceFix"];
    function completer() {
      if (!st.cahier) st.cahier = [];
      if (!st.pinceau) st.pinceau = { h: 0 };
      if (!st.pointObs) st.pointObs = { x: 0, y: 0 };
      if (!st.fibre) st.fibre = { on: false, x: 0, y: 0, reel: false, zoom: false };
      if (!st.photo) st.photo = { on: false, x: 0, y: 0 };
      if (!st.barr) st.barr = { on: false, x: 0, y: 0, ang: 0 };
      if (st.barr.reel == null) st.barr.reel = true;                                                    // états gardés d'avant le choix réel/parfait
      if (!(st.barr.L >= BARRETTE_PARFAITE.Lmin && st.barr.L <= BARRETTE_PARFAITE.Lmax)) st.barr.L = 150;
      if (!(st.pose >= 0 && st.pose < POSES.length)) st.pose = 6;
      if (!(st.iso >= 0 && st.iso < ISOS.length)) st.iso = 0;
      if (!(st.integ >= 0 && st.integ < INTEG.length)) st.integ = 3;
      if (!(st.photo.cal >= 0 && st.photo.cal < CALIBRES.length)) st.photo.cal = 0;
      if (!(st.fibre.t >= 0 && st.fibre.t < INTEG.length)) st.fibre.t = 6;
      if (CAPTEUR_N.indexOf(st.obs.capteur.N) < 0) st.obs.capteur.N = CAPTEUR_N[0];
      if (!Array.isArray(st.selL) || st.selL[st.selL.length - 1] !== (st.sel || undefined)) st.selL = st.sel ? [st.sel] : [];      // st.sel fait foi (cf. sels())
      st.selL = st.selL.filter(function (id) { return trouver(st, id); });
      st.sel = st.selL.length ? st.selL[st.selL.length - 1] : null;
      if (typeof st.faceFix !== "string" || !trouver(st, st.faceFix)) st.faceFix = null;      // vue de face épinglée : la pièce doit encore être sur le banc
      delete st.cam;                              // ancien zoom, retiré
      st.elements.forEach(function (e) { if ((e.type === "viseur" || e.type === "lunette") && e.params) { delete e.params.ox; delete e.params.oy; } });   // œil intégré : plus de décalage à la main (états gardés d'avant)
      deposer();
    }
    completer();
    var BAC = BACS[st.bac];
    // Niveau : hors de l'état, mémoire `niveaux` par matériel ; défaut : méta `niveau` de
    // la carte (sinon 2), le prof part du niveau 3. P() : le profil ; optq() / lumq() : optique et luminosité en vigueur
    // (celles que le profil impose, sinon celles de l'état, qui les garde intactes pour un niveau plus haut).
    var NIVX = mem && mem.niveaux && typeof mem.niveaux === "object" ? mem.niveaux : {};
    function niveauDe(b) { return PROFILS[NIVX[b]] ? NIVX[b] : K.estProf() ? 3 : niveauDepart(K.meta); }
    var NIV = niveauDe(st.bac);
    function P() { return PROFILS[NIV]; }
    function optq() { return P().optique || st.optique; }
    function lumq() { return P().luminosite || (st.lumiere === "visible" || st.lumiere === "reelle" ? st.lumiere : P().lumDefaut || "reelle"); }   // niveau 1 : « sans » tant qu'on n'a pas choisi
    // Ce que le profil retire de l'état lui-même : les mesures posées sur l'écran (barrette, photodiode, fibre).
    function appliquerProfil() { if (!P().mesures) st.photo.on = st.barr.on = st.fibre.on = false; }
    appliquerProfil();
    var sale = { seq: true, dessin: true, etagere: true, bandeau: true, tete: true, obs: true };
    var vignettesDiapos = false;
    var SEQ = null, VIDE = { prims: [] }, geste = null;
    function maintenant() { return root.performance ? root.performance.now() : Date.now(); }
    function modifie(quoi) { (quoi || "seq").split(" ").forEach(function (q) { sale[q] = true; }); K.modifie(); }
    function axe() { return st.vue === "dessus" ? 0 : 1; }
    // Décalage de la pièce le long de l'axe dessiné, tel que le calcul le voit (neutralisé sous le niveau 3 : `neutre`).
    function dec(e) { var q = neutre(e, P()); return (axe() ? q.y : q.x) || 0; }
    function decentrable(e) { return P().decentrable && e.type !== "oeil"; }
    // Choisit le point 2D (hx, hy) d'où part le pinceau, ramené dans la lettre s'il en est une.
    function fixerPoint(hx, hy) {
      var r = ramenerDansObjet(SEQ && SEQ.objet >= 0 ? SEQ.prims[SEQ.objet] : null, hx, hy);
      st.pinceau.hx = r[0]; st.pinceau.h = r[1];
      spotInvalide();
    }
    // Point B des rayons de construction, à la hauteur h (repère du banc) : relatif au centre de l'objet, borné, au 0,1 mm.
    function fixerB(h) {
      var o = SEQ && SEQ.objet >= 0 ? SEQ.prims[SEQ.objet] : null, m = o && ETENDUE[o.type] ? ETENDUE[o.type][axe()] : 0;
      if (!(m > 0)) return false;
      var v = clamp(arrondi(h - C.centrePlan(o)[axe()], 0.1), -m, m);
      st.consB = st.consB || {};
      if (axe() === 1) st.consB.h = v; else st.consB.hx = v;
      return true;
    }
    function fixerSurAxe(v) { if (axe() === 1) fixerPoint(st.pinceau.hx || 0, v); else fixerPoint(v, st.pinceau.h || 0); }
    function selEl() { return st.sel ? trouver(st, st.sel) : null; }
    // Sélection multiple : st.selL = les pièces choisies, la dernière choisie au bout ;
    // st.sel = celle-là (bandeau, vue de face, De près, ↑ ↓ ne lisent qu'elle). Une affectation directe de st.sel vaut
    // « elle seule » : sels() remet la liste d'accord. Les gestes qui déplacent ou rangent passent par sels().
    function sels() {
      var L = st.selL;
      if (!Array.isArray(L) || L[L.length - 1] !== (st.sel || undefined)) L = st.selL = st.sel ? [st.sel] : [];
      return L.map(function (id) { return trouver(st, id); }).filter(Boolean);
    }
    function estSel(id) { sels(); return st.selL.indexOf(id) >= 0; }
    // mode "" : elle seule ; "ajout" (Ctrl+clic) : l'ajouter ou la retirer ; "plage" (Maj+clic) : toutes les pièces entre
    // la dernière choisie et elle ; "devant" : déjà choisie, elle passe au bout (la sélection reste).
    function choisir(id, mode) {
      var L = sels().map(function (e) { return e.id; }), i, prec = selEl();
      TAPE = null;
      if (!id) L = [];
      else if (mode === "ajout") { i = L.indexOf(id); if (i >= 0) L.splice(i, 1); else L.push(id); }
      else if (mode === "plage" && prec && trouver(st, id)) {
        var a = prec.z, b = trouver(st, id).z, lo = Math.min(a, b), hi = Math.max(a, b);
        st.elements.filter(function (e) { return e.z >= lo && e.z <= hi; }).sort(function (p, q) { return p.z - q.z; })
          .forEach(function (e) { if (L.indexOf(e.id) < 0) L.push(e.id); });
        L.splice(L.indexOf(id), 1); L.push(id);
      } else if (mode === "devant" && (i = L.indexOf(id)) >= 0) { L.splice(i, 1); L.push(id); }
      else L = [id];
      st.selL = L; st.sel = L.length ? L[L.length - 1] : null;
      sale.bandeau = sale.dessin = true;
    }
    // Déplacer toute la sélection d'un bloc (écarts gardés : arrêtée au bout du banc par la pièce la plus avancée).
    function bougerSel(dz) {
      var L = libres(); if (!L.length) return;
      var lo = Math.min.apply(null, L.map(function (e) { return e.z; })), hi = Math.max.apply(null, L.map(function (e) { return e.z; }));
      dz = clamp(dz, -lo, LONGUEUR - hi);
      L.forEach(function (e) { deplacer(e, arrondi(e.z + dz, 0.01)); });
      modifie("seq"); majBandeau();
    }
    function rangerSel() { libres().forEach(function (e) { ranger(st, e.id); }); modifie("seq etagere bandeau dessin"); }
    var TAPE = null;       // position en train d'être tapée au bandeau : { val }

    // ================= le banc =================
    K.racine.classList.add("pl-banc");
    var D = K.dessus; D.classList.add("bc-dessus"); D.setAttribute("tabindex", "0");
    D.setAttribute("aria-label", TRAD("Banc d'optique : glisser une pièce le long du rail"));
    svg("defs", {}, D).innerHTML = Dessin.DEFS;
    var gFond = svg("g", { "pointer-events": "none" }, D), gFaisceau = svg("g", { "pointer-events": "none" }, D), gElems = svg("g", {}, D);
    var gRayons = svg("g", { "pointer-events": "none", class: "bc-rayons" }, D), gPoignee = svg("g", {}, D), gNotes = svg("g", { "pointer-events": "none" }, D);
    var gCadre = svg("g", { "pointer-events": "none" }, D);      // rectangle de Cadrer (jamais effacé par le dessin du banc)
    // Le dessin dans une scène positionnée : boutons de zoom et vue de face de la pièce choisie par-dessus (HTML).
    var SC = el("div", "bc-scene"); D.parentNode.insertBefore(SC, D); SC.appendChild(D);
    var ZB = el("div", "bc-zoom", SC), FACE = el("div", "bc-face", SC); FACE.hidden = true;
    // Échelles : en vue d'ensemble, le banc entier en largeur ; en hauteur, ±118 mm autour de l'axe (l'écran de 20 cm
    // tient), d'où une dilatation des hauteurs (dite en clair en haut à gauche). Zoom (boutons seulement,
    // jamais la molette) : cam.k fois plus large autour de cam.zc ; la dilatation retombe à 1 (échelle vraie) quand
    // les longueurs rattrapent les hauteurs. Vue de dessus : le rail sous l'axe, ±104 mm de part et d'autre.
    // Cadrer en hauteur aussi : cam.dil (hauteurs dilatées dil fois, de 1 à DIL_MAX) et cam.hc (hauteur au milieu de la
    // zone utile) ; absents = hauteurs automatiques, axe à sa place. Les autres zooms les effacent (sauf + et −).
    var W = 820, H = 480, sx = 1, sy = 1, sx0 = 1, Y0 = 200, railY = 400, cam = { k: 1, zc: LONGUEUR / 2, pres: false };
    function echelles() {
      sx0 = (W - 2 * MARGE) / LONGUEUR;
      if (st.vue === "dessus") { railY = H - 60; Y0 = (H - 70) / 2 + 22; sy = Math.max(0.5, Math.min(Y0 - 40, H - 80 - Y0) / 104); }
      else { railY = H - 76; var A = Math.max(60, Math.min(230, (railY - 34) / 1.85)); sy = A / 118; Y0 = railY - A; }
      if (cam.k <= 1) { cam.k = 1; cam.zc = LONGUEUR / 2; }
      sx = sx0 * cam.k; sy = Math.max(sy, sx);
      if (cam.dil) { var zu = zoneUtile(); sy = sx * cam.dil; Y0 = (zu[0] + zu[1]) / 2 + (cam.hc || 0) * sy; }
    }
    var DIL_MAX = 20;
    function zoneUtile() { return [28, st.vue === "dessus" ? H - 74 : railY - 12]; }
    function X(z) { return W / 2 + (z - cam.zc) * sx; }
    function Z(x) { return cam.zc + (x - W / 2) / sx; }
    function Y(h) { return Y0 - h * sy; }
    function HdeY(y) { return (Y0 - y) / sy; }
    function txt(par, x, y, t, cls, anc) { var z = svg("text", { x: x, y: y, class: cls || "pl-lab", "text-anchor": anc || "start" }, par); z.textContent = t; return z; }
    function pf(v) { return (Math.round(v * 10) / 10).toString(); }

    function dessinerElements() {
      var els = st.elements.slice().sort(function (a, b) { return estSel(a.id) - estSel(b.id) || (a.id === st.sel) - (b.id === st.sel) || a.z - b.z; }), s = "";
      var dessus = st.vue === "dessus";
      var G = { sy: sy, railY: railY, parfaite: optq() === "parfaite", yAxe: Y0, yDecH: Y(DEC_MAX), yDecB: Y(-DEC_MAX) };
      els.forEach(function (e) {
        var pris = geste && (geste.el === e.id || (geste.ids && geste.ids.indexOf(e.id) >= 0)), hors = pris && geste.hors, x = X(e.z);
        if (x < -140 || x > W + 140) return;
        var o = { id: e.id, sel: estSel(e.id), regl: REGLAGE[e.type], dec: !!DECALABLE[e.type] || decentrable(e),
          cls: (pris ? "glisse" : "") + (hors ? " hors" : "") + (REMPL === e.id ? " cible" : ""),
          titre: PIECES[e.cle].titre + (BAC.clair ? TRAD(" Position : {0}.", [cm(e.z)]) : "") };
        var g = dessus ? Dessin.pieceDessus(figureVue(e), x, Y(dec(e)), G, o) : Dessin.piece(figureVue(e), x, Y(dec(e)), G, o), es = escamote(st, e);
        if (!dessus && decentrable(e)) g = g.replace(/<\/g>$/, visHauteur(e, x) + "</g>");
        if (e.verrou) g = g.replace(/<\/g>$/, '<g transform="translate(' + pf(x + 9) + " " + pf((dessus ? Y0 - 32 : railY - 27)) + ')" color="#e0b84c" pointer-events="none">' + CADENAS + "</g></g>");
        // escamotée : relevée hors du faisceau, grisée, et dite (« relevé d'office » pour un récepteur devant celui qui observe)
        if (es) g = '<g class="bc-esc" transform="translate(0 ' + pf(-Math.min(70, 0.22 * H)) + ')">' + g + "</g>" +
          '<text x="' + pf(x) + '" y="' + pf((dessus ? Y0 : railY) - 4) + '" class="bc-etiq bc-esc-l" text-anchor="middle">' + (es === "auto" ? TRAD("relevé d'office") : TRAD("relevé")) + "</text>";
        s += g;
      });
      if (!dessus) s += vraieForme();
      // étiquettes : deux rangs sous la règle, la pièce choisie d'abord ; une étiquette qui ne tient pas est omise
      // (la miniature au-dessus de la pièce suffit à la reconnaître)
      var pris = [[], []], yE = dessus ? H - 22 : railY + 56;
      els.slice().reverse().forEach(function (e) {
        var t = PIECES[e.cle].court, w = t.length * 6.2 + 12, x = X(e.z), a = x - w / 2, b = x + w / 2, r;
        if (x < -20 || x > W + 20) return;
        for (r = 0; r < 2; r++) if (pris[r].every(function (q) { return b < q[0] || a > q[1]; })) break;
        if (r === 2) return;
        pris[r].push([a, b]);
        s += '<text x="' + pf(x) + '" y="' + (yE + 14 * r) + '" class="bc-etiq' + (estSel(e.id) ? " sel" : "") + '" text-anchor="middle">' + t + "</text>";
      });
      gElems.innerHTML = s;
    }
    function dilat() { return sy / sx; }
    // Sommet d'un dioptre (primitive du cœur) : O + dz·ez, dans le repère du banc.
    function sommet(pr) { return [pr.O[0] + pr.dz * pr.ez[0], pr.O[1] + pr.dz * pr.ez[1], pr.O[2] + pr.dz * pr.ez[2]]; }
    // De près (échelle vraie), optique réelle, vue de profil : le vrai profil des lentilles, calottes du cœur (courbure,
    // conique, ouverture), par-dessus le dessin de la pièce (dont la flèche est exagérée pour se lire de loin).
    function vraieForme() {
      if (dilat() > 1.05 || optq() !== "reelle" || !SEQ || !SEQ.prims) return "";
      var par = {}, s = "", ax = axe();
      SEQ.prims.forEach(function (pr) { if (pr.k === K_.SURF && (pr.sens || 1) > 0) (par[pr.el] = par[pr.el] || []).push(pr); });
      Object.keys(par).forEach(function (id) {
        var S2 = par[id];
        if (S2.length !== 2) return;
        function fl(pr, hh) { var c = pr.p[0], k = pr.p[1] || 0; return c * hh * hh / (1 + Math.sqrt(Math.max(0, 1 - (1 + k) * c * c * hh * hh))); }
        var Rm = Math.min(S2[0].R, S2[1].R), a = [], b = [], i, hh;
        if (X(S2[0].zp) < -100 || X(S2[0].zp) > W + 100) return;
        // point du dioptre à la hauteur hh dans son propre repère (lentille inclinée ou décentrée), projeté sur la vue
        function pt(pr, hh) { var V = sommet(pr), t = ax ? pr.ey : pr.ex, f = fl(pr, hh); return pf(X(V[2] + hh * t[2] + f * pr.ez[2])) + " " + pf(Y(V[ax] + hh * t[ax] + f * pr.ez[ax])); }
        for (i = 0; i <= 40; i++) { hh = -Rm + 2 * Rm * i / 40; a.push(pt(S2[0], hh)); b.unshift(pt(S2[1], hh)); }
        s += '<path d="M' + a.join("L") + "L" + b.join("L") + 'Z" fill="#a9c7e0" fill-opacity=".22" stroke="#cfe2f2" stroke-width="1" pointer-events="none"/>';
      });
      return s;
    }

    // ----- aides -----
    function ligne(par, z1, h1, z2, h2, o) {
      // coupée au banc visible (une image très lointaine ne fait pas des coordonnées géantes)
      var za = Z(0) - 60, zb = Z(W) + 60, lo = Math.min(z1, z2), hi = Math.max(z1, z2);
      if (hi < za || lo > zb) return;
      function hDe(z) { return h1 + (h2 - h1) * (z - z1) / (z2 - z1 || 1e-12); }
      var a = clamp(z1, za, zb), b = clamp(z2, za, zb);
      svg("line", { x1: pf(X(a)), y1: pf(Y(hDe(a))), x2: pf(X(b)), y2: pf(Y(hDe(b))), stroke: o.coul, class: o.cls, "stroke-width": o.w || 1.3, "stroke-dasharray": o.tirets ? "5 4" : null, "stroke-opacity": o.op || 1, "stroke-linecap": "round", style: o.additif ? "mix-blend-mode:screen" : null }, par);
    }
    function fleche(par, z, a, b, o) {       // objet ou image : de A (pied) à B
      if (z < Z(0) - 60 || z > Z(W) + 60) return;
      var x = X(z), ya = Y(a), yb = Y(b), s = yb < ya ? 1 : -1;
      if (Math.abs(yb - ya) < 1) return;
      svg("path", { d: "M" + pf(x) + " " + pf(ya) + "V" + pf(yb) + "M" + pf(x - 4) + " " + pf(yb + 7 * s) + "L" + pf(x) + " " + pf(yb) + "L" + pf(x + 4) + " " + pf(yb + 7 * s),
        fill: "none", stroke: o.coul, "stroke-width": 2.2, "stroke-dasharray": o.tirets ? "4 3" : null, "stroke-linecap": "round", "stroke-linejoin": "round" }, par);
      txt(par, x + 6, ya + (s > 0 ? 12 : -4), o.A, "bc-lab"); txt(par, x + 6, yb + (s > 0 ? -2 : 10), o.B, "bc-lab");
    }
    // Une couleur par gerbe (une par lentille, du point qui la précède à celui qu'elle donne) ; celle dont l'image part
    // à l'infini est à part : la gerbe parallèle se reconnaît, et le zoom la montre là où la marque manque de place.
    function coulTroncon(gr) { return CONS.lentilles[gr] && CONS.lentilles[gr].image.infini ? COUL_INFINI : COUL_TRONCON[gr % COUL_TRONCON.length]; }
    // Conjugué à l'infini : rien à dessiner à sa place. Ce qui se lit, c'est la DIRECTION de la gerbe parallèle qui en
    // sort — l'angle θ, marqué au centre optique entre l'axe et le rayon non dévié (les deux traits existent, l'angle se
    // lit comme sur une figure de cours), et une flèche le long d'un rayon qui pointe vers l'infini et porte le nom du
    // point. L'arc est tracé à l'échelle de l'écran (hauteurs dilatées) : sa valeur est dans l'infobulle, pas à côté.
    function marqueInfini(par, Lz, lbl, gr) {
      var pente = Lz.image.pente, sorts = [], axe = null;
      Lz.rayons.forEach(function (r) {
        var s = null;
        r.segs.forEach(function (q) { if (q.gr === gr && !q.tirets) s = q; });
        if (!s) return;
        sorts.push(s);
        if (r.type === "centre") axe = s;              // le rayon non dévié : il passe par le centre optique
      });
      if (!sorts.length) return;
      // la place disponible après la lentille, en pixels : sans elle, rien n'est marqué (le zoom la donne, et la couleur
      // du tronçon dit déjà que la gerbe est parallèle)
      var dispo = Math.min(X(Lz.suiv), W - 12) - X(Lz.z);
      if (dispo < 20) return;
      function hDe(s, z) { return s.h1 + (s.h2 - s.h1) * (z - s.z1) / (s.z2 - s.z1 || 1e-12); }
      var g = svg("g", { class: "bc-inf" }, par), ref = sorts[0];
      sorts.forEach(function (s) { if (hDe(s, s.z2) > hDe(ref, ref.z2)) ref = s; });
      // 1. l'angle, au centre optique : entre l'axe et le rayon non dévié (à défaut, entre l'axe et la gerbe)
      var vx = X(Lz.z), vy = Y(Lz.c), R = Math.min(30, 0.5 * dispo), k, arc = "";
      var a1 = Math.atan2(Y(Lz.c + pente * (Lz.suiv - Lz.z)) - vy, X(Lz.suiv) - vx);
      if (axe) a1 = Math.atan2(Y(hDe(axe, axe.z2)) - vy, X(axe.z2) - vx);
      if (R >= 12 && Math.abs(a1) > 0.06 && vx > 6 && vx < W - 6 - R) {
        for (k = 0; k <= 10; k++) arc += (k ? "L" : "M") + pf(vx + R * Math.cos(a1 * k / 10)) + " " + pf(vy + R * Math.sin(a1 * k / 10));
        svg("path", { d: arc, fill: "none", stroke: COUL_INFINI, "stroke-width": 1.2, "stroke-opacity": 0.85 }, g);
        // la lettre θ seulement si elle ne tombe pas sur la pièce suivante (elle n'apprend rien de plus que l'arc)
        if (dispo >= R + 26) txt(g, vx + (R + 10) * Math.cos(a1 / 2) - 2, vy + (R + 10) * Math.sin(a1 / 2) + 4, "θ", "bc-lab", "middle");
      }
      // 2. la flèche, le long d'un rayon de la gerbe, au-dessus du plus haut
      var x0 = vx + 0.22 * dispo, x1 = vx + 0.78 * dispo, off = 12 / sy;
      if (x1 - x0 >= 12) {
        var y0 = Y(hDe(ref, Z(x0)) + off), y1 = Y(hDe(ref, Z(x1)) + off);
        var L = Math.hypot(x1 - x0, y1 - y0) || 1, u = [(x1 - x0) / L, (y1 - y0) / L], v = [-u[1], u[0]];
        svg("path", { d: "M" + pf(x0) + " " + pf(y0) + "L" + pf(x1) + " " + pf(y1) +
          "M" + pf(x1 - 9 * u[0] + 4.5 * v[0]) + " " + pf(y1 - 9 * u[1] + 4.5 * v[1]) + "L" + pf(x1) + " " + pf(y1) +
          "L" + pf(x1 - 9 * u[0] - 4.5 * v[0]) + " " + pf(y1 - 9 * u[1] - 4.5 * v[1]),
          fill: "none", stroke: COUL_INFINI, "stroke-width": 1.5, "stroke-linecap": "round", "stroke-linejoin": "round" }, g);
        txt(g, x1 - 3, y1 - 8, lbl, "bc-lab", "end");
      }
      svg("title", {}, g).textContent = TRAD("Le point {0} est à l'infini dans cette direction : seule l'inclinaison de la gerbe se lit, θ = {1}° avec l'axe.",
        [lbl, fmt(Math.atan(pente) * 180 / Math.PI, 1)]);
    }
    var CONS = null, FL = null, ENV = null;
    // Faisceau gardé tant que la séquence ne change pas (zoom, sélection, survol) ; en optique réelle, bords exacts
    // allégés pendant qu'un geste déplace ou pose une pièce, complets au relâchement (le dessin est refait, sans geste).
    // Mémoire par IDENTITÉ de SEQ : toute retouche qui change le faisceau doit refaire la séquence (sale.seq).
    function enveloppeVue(ax) {
      if (!st.aides.faisceau) return [];
      var leger = !!(geste && geste.bouge && (geste.type === "el" || geste.type === "pose"));
      if (!ENV || ENV.seq !== SEQ || ENV.ax !== ax || (ENV.leger && !leger)) ENV = { seq: SEQ, ax: ax, leger: leger, env: enveloppe(SEQ, ax, null, null, null, { leger: leger }) };
      return ENV.env;
    }
    function dessinerAides() {
      gFaisceau.innerHTML = ""; gRayons.innerHTML = ""; gPoignee.innerHTML = "";
      CONS = null; FL = null;
      if (!SEQ || !SEQ.source) return;
      var ax = axe();
      // Un tronçon par sens de parcours : au retour d'un miroir, z repart en arrière, et un seul polygone (bords haut
      // puis bas) se recoupait en nœuds papillon, bande sombre au milieu de l'aller-retour.
      var troncons = [];
      enveloppeVue(ax).forEach(function (pts) {
        var cur = [], sens = 0;
        pts.forEach(function (q) {
          var n = cur.length, dz = n ? q.z - cur[n - 1].z : 0, sg = dz > 1e-9 ? 1 : dz < -1e-9 ? -1 : 0;
          if (sg && sens && sg !== sens) { troncons.push(cur); cur = [cur[n - 1]]; }
          if (sg) sens = sg;
          cur.push(q);
        });
        troncons.push(cur);
      });
      FL = st.aides.faisceau ? faisceauLaser(SEQ, ax, st) : null;
      if (FL) {
        var limL = 400 / sy, cl = function (v) { return clamp(v, -limL, limL); };
        var hautL = FL.gauss.map(function (q) { return pf(X(q.z)) + " " + pf(Y(cl(q.c + q.w))); });
        var basL = FL.gauss.slice().reverse().map(function (q) { return pf(X(q.z)) + " " + pf(Y(cl(q.c - q.w))); });
        svg("path", { d: "M" + hautL.join("L") + "L" + basL.join("L") + "Z", fill: cLaser(SEQ, 0.32), stroke: cLaser(SEQ, 0.75, true), "stroke-width": 0.8 }, gFaisceau);
        svg("path", { d: "M" + FL.gauss.map(function (q) { return pf(X(q.z)) + " " + pf(Y(cl(q.c))); }).join("L"), fill: "none", stroke: cLaser(SEQ, 0.5, true), "stroke-width": 1 }, gFaisceau);
        // après le premier plan diffractant : l'éventail du lobe central (un par ordre d'un réseau), estompé
        FL.eventails.forEach(function (ev, k) {
          var p = ev.pts, z0 = p[0].z, z1 = p[p.length - 1].z, id = "bcEv" + k;
          var gr = svg("linearGradient", { id: id, gradientUnits: "userSpaceOnUse", x1: pf(X(z0)), x2: pf(X(z1)), y1: 0, y2: 0 }, gFaisceau);
          svg("stop", { offset: 0, "stop-color": cLaser(SEQ, 1), "stop-opacity": 0.42 }, gr); svg("stop", { offset: 1, "stop-color": cLaser(SEQ, 1), "stop-opacity": 0.1 }, gr);
          svg("path", { d: "M" + p.map(function (q) { return pf(X(q.z)) + " " + pf(Y(cl(q.hi))); }).join("L") + "L" + p.slice().reverse().map(function (q) { return pf(X(q.z)) + " " + pf(Y(cl(q.lo))); }).join("L") + "Z", fill: "url(#" + id + ")" }, gFaisceau);
        });
      }
      if (st.aides.faisceau && !FL) troncons.forEach(function (pts) {
        if (pts.length < 2) return;
        var lim = 400 / sy;
        var haut = pts.map(function (q) { return pf(X(q.z)) + " " + pf(Y(clamp(q.hi, -lim, lim))); });
        var basl = pts.slice().reverse().map(function (q) { return pf(X(q.z)) + " " + pf(Y(clamp(q.lo, -lim, lim))); });
        var retour = pts[pts.length - 1].z < pts[0].z;      // lumière revenue d'un miroir : bleutée, par-dessus l'aller
        svg("path", { d: "M" + haut.join("L") + "L" + basl.join("L") + "Z", fill: retour ? "rgba(130,190,255,0.16)" : "rgba(255,214,130,0.14)",
          stroke: retour ? "rgba(150,200,255,0.4)" : "rgba(255,214,130,0.32)", "stroke-width": 0.7, "stroke-linejoin": "round" }, gFaisceau);
      });
      if (st.aides.construction) {
        CONS = construction(SEQ, ax, st.consB ? (ax === 1 ? st.consB.h : st.consB.hx) : null);      // B non choisi : HAUT_B
        if (!CONS.raison) {
          var nL = CONS.lentilles.length, blanc = "#f0f3f6";
          fleche(gRayons, CONS.objet.z, CONS.objet.a, CONS.objet.b, { coul: blanc, A: "A", B: "B" });
          // poignée de B : la glisser le long de l'objet (un clic sur l'objet, pinceau éteint, fait de même)
          svg("title", {}, svg("circle", { cx: X(CONS.objet.z), cy: Y(CONS.objet.b), r: 5, class: "bc-poigneeB" }, gPoignee)).textContent = TRAD("Point B de l'objet : le glisser le long de l'objet.");
          CONS.lentilles.forEach(function (Lz, n) {
            var ind = nL > 1 ? ["₁", "₂", "₃", "₄", "₅"][n] || "" : "";
            [[Lz.F, "F" + ind], [Lz.Fp, "F′" + ind]].forEach(function (q) {
              var x = X(q[0][0]), y = Y(q[0][1]);
              if (x < -20 || x > W + 20) return;
              svg("line", { x1: x, x2: x, y1: y - 4, y2: y + 4, stroke: blanc, "stroke-width": 1.4 }, gRayons);
              txt(gRayons, x, y + 16, q[1], "bc-lab", "middle");
            });
            Lz.rayons.forEach(function (r) { r.segs.forEach(function (s) { ligne(gRayons, s.z1, s.h1, s.z2, s.h2, { coul: coulTroncon(s.gr), cls: "bc-cons", tirets: s.tirets, op: s.tirets ? 0.75 : 1 }); }); });
            var im = Lz.image, dern = n === nL - 1;
            if (!im.infini) fleche(gRayons, im.z, im.a, im.b, { coul: blanc, tirets: !im.formee, A: dern ? "A′" : "A" + ind, B: dern ? "B′" : "B" + ind });
            else marqueInfini(gRayons, Lz, (dern ? "B′" : "B" + ind) + "∞", n);
          });
        }
      }
      if (st.aides.pola) dessinerPola();
      if (st.aides.pinceau || st.aides.spot) {
        var dep = departPinceau(SEQ, ax, hAxe(st.pinceau, ax), hAutre(st.pinceau, ax));
        if (dep) {
          if (st.aides.pinceau) {
            // trois couleurs en lumière blanche : un groupe par longueur d'onde, mélangé en addition (écran) aux autres ;
            // elles se superposent (blanc) sans aberration chromatique et s'écartent avec elle
            var ech = echantillonRayons(SEQ), multi = ech.ls.length > 1;
            var RP = pinceau(SEQ, ax, hAxe(st.pinceau, ax), ech.ls, 15, hAutre(st.pinceau, ax)), gl = {};
            RP.forEach(function (r) {
              var g1 = gl[r.l];
              if (!g1) { g1 = gl[r.l] = svg("g", { style: multi ? "mix-blend-mode:screen" : null }, gRayons); g1._c = couleurRayon(ech, r.l); }
              var ok = r.etat === "detecte";
              for (var i = 1; i < r.pts.length; i++) ligne(g1, r.pts[i - 1][0], r.pts[i - 1][1], r.pts[i][0], r.pts[i][1], { coul: ok ? g1._c : "#737c88", w: 0.9, op: ok ? 0.9 : 0.6 });
            });
            if (dilat() < 1.05 && optq() === "reelle") normales(RP, lRef(ech), ax);
          }
          if (dep.objet && ETENDUE[dep.objet.type] && ETENDUE[dep.objet.type][ax] > 0) {
            var c = svg("circle", { cx: X(dep.p[2]), cy: Y(dep.p[ax]), r: 5.5, class: "bc-poignee" }, gPoignee);
            svg("title", {}, c).textContent = TRAD("Point de départ du pinceau : le glisser le long de l'objet.");
          }
        }
      }
    }

    // De près (échelle vraie), optique réelle : les normales aux dioptres sphériques aux points d'incidence du pinceau
    // (tirets courts ; en lumière blanche, celles des rayons verts seulement).
    function normales(R, lr, ax) {
      var d = "";
      SEQ.prims.forEach(function (pr) {
        if (pr.k !== K_.SURF || !pr.p[0]) return;
        // centre de courbure sur l'axe propre du dioptre (ez : la lentille peut être inclinée ou décentrée)
        var c = pr.p[0] * (pr.sens || 1), V = sommet(pr), zc = V[2] + pr.ez[2] / c, oc = V[ax] + pr.ez[ax] / c;
        R.forEach(function (r) {
          if (r.l !== lr) return;
          r.pts.forEach(function (q) {
            if (Math.abs(q[0] - V[2]) > 8) return;
            var dz = zc - q[0], dh = oc - q[1], L = Math.hypot(dz, dh);
            if (Math.abs(L - Math.abs(1 / c)) > 0.5) return;
            var u = [dz / L, dh / L], k = 15 / sx;
            d += "M" + pf(X(q[0] - u[0] * k)) + " " + pf(Y(q[1] - u[1] * k)) + "L" + pf(X(q[0] + u[0] * k)) + " " + pf(Y(q[1] + u[1] * k));
          });
        });
      });
      if (d) svg("path", { d: d, stroke: "#bfe2ff", "stroke-width": 1.1, "stroke-dasharray": "3 2.5", "stroke-opacity": 0.9, fill: "none" }, gRayons);
    }

    // Rayons vers un point : les rayons rejoués (`retourTick`), projetés dans le plan
    // dessiné, TOUS D'UNE MÊME COULEUR : chacun porte une longueur d'onde tirée au hasard dans le spectre de la source
    // (sinon très colorés, sans que la couleur dise rien) ; la couleur de la raie quand la source n'en a qu'une (ou un
    // doublet), sinon le blanc du pinceau. Ceux d'une autre séquence (pendant un geste) ne sont pas dessinés.
    function dessinerRetour() {
      if (!st.aides.rebours || !RET || RET.seq !== SEQ || !RET.rayons.length) return;
      var ax = axe(), sp = SEQ.source && SEQ.source.sp, g = svg("g", { style: "mix-blend-mode:screen" }, gRayons);
      var ls = sp && sp.type === 1 ? Array.prototype.slice.call(sp.l, 0, sp.n) : [];       // raies (doublet du sodium : une couleur)
      var c = ls.length && Math.max.apply(null, ls) - Math.min.apply(null, ls) < 5 ? couleurRayon({ simple: true }, ls[0]) : "#ffe7ad";
      RET.rayons.forEach(function (r) {
        var p = r.pts;
        for (var i = 1; i < p.length; i++) ligne(g, p[i - 1][2], p[i - 1][ax], p[i][2], p[i][ax], { coul: c, w: 0.9, op: 0.85 });
      });
    }
    // Aide « Polarisation » : un médaillon sur l'axe entre deux pièces, la vibration vue depuis la source dans
    // le repère des miniatures (axe du cœur x → vertical : (Ex, Ey) du cœur → (−Ey, Ex) à l'écran), rayon ∝ amplitude
    // (1 : derrière un premier polariseur). Lumière naturelle : des vibrations dans toutes les directions.
    function dessinerPola() {
      var P = polarisations(st), R = 11, g = svg("g", { class: "bc-pola" }, gRayons), y = Y(0);
      if (!P.etats.length) return;
      svg("title", {}, g).textContent = TRAD("La vibration de la lumière entre les pièces, vue depuis la source") + (P.l === 550 ? TRAD(" (lumière blanche : à 550 nm).") : TRAD(" (à {0} nm).", [fmt(P.l, 1)]));
      P.etats.forEach(function (q) {
        var x = X(q.z);
        if (x < -20 || x > W + 20) return;
        medaillon(g, x, y, R, q);
      });
    }
    // Un médaillon de l'aide « Polarisation » (aussi l'aperçu du matériel Polarisation) : q = { nat } ou { I, J }.
    function medaillon(g, x, y, R, q) {
        svg("circle", { cx: pf(x), cy: pf(y), r: R + 3, fill: "rgba(12,14,18,0.82)", stroke: "#5b6471", "stroke-width": 0.8 }, g);
        if (q.nat) {
          var d = ""; for (var k = 0; k < 4; k++) { var a = k * Math.PI / 4, c = Math.cos(a) * R * 0.85, s2 = Math.sin(a) * R * 0.85; d += "M" + pf(x - c) + " " + pf(y - s2) + "L" + pf(x + c) + " " + pf(y + s2); }
          svg("path", { d: d, stroke: "#e8e2ff", "stroke-width": 1, opacity: 0.75 }, g); return;
        }
        var A = Math.sqrt(2 * q.I);
        if (A < 0.04) { svg("path", { d: "M" + pf(x - 3) + " " + pf(y) + "H" + pf(x + 3), stroke: "#737c88", "stroke-width": 1 }, g); return; }
        var J = q.J, k1 = R * Math.SQRT2;      // |J| = √½ derrière un premier polariseur → rayon R ; E(t) = Re(J e^(−it))
        function pt(t) { var c = Math.cos(t), s3 = Math.sin(t), ex = J[0] * c + J[1] * s3, ey = J[2] * c + J[3] * s3; return [x - ey * k1, y - ex * k1]; }
        var pts = [], m = 0, t;
        for (t = 0; t < 48; t++) { var p = pt(2 * Math.PI * t / 48); pts.push(p); m = Math.max(m, Math.hypot(p[0] - x, p[1] - y)); }
        // ellipse aplatie : rectiligne, double flèche ; sinon l'ellipse et le sens de parcours (flèche en t = 0)
        var mi = Infinity; pts.forEach(function (p) { mi = Math.min(mi, Math.hypot(p[0] - x, p[1] - y)); });
        if (mi < 0.06 * m) {
          var p0 = pts[0], p1 = pts[24], ux = (p1[0] - p0[0]) / (2 * m || 1), uy = (p1[1] - p0[1]) / (2 * m || 1);
          if (Math.hypot(p0[0] - x, p0[1] - y) < 0.5 * m) { p0 = pts[12]; p1 = pts[36]; ux = (p1[0] - p0[0]) / (2 * m || 1); uy = (p1[1] - p0[1]) / (2 * m || 1); }
          var tete = function (p, sx) { return "M" + pf(p[0] - sx * (3 * ux - 2 * uy)) + " " + pf(p[1] - sx * (3 * uy + 2 * ux)) + "L" + pf(p[0]) + " " + pf(p[1]) + "L" + pf(p[0] - sx * (3 * ux + 2 * uy)) + " " + pf(p[1] - sx * (3 * uy - 2 * ux)); };
          svg("path", { d: "M" + pf(p0[0]) + " " + pf(p0[1]) + "L" + pf(p1[0]) + " " + pf(p1[1]) + tete(p1, 1) + tete(p0, -1), stroke: "#ffe7ad", "stroke-width": 1.5, fill: "none", "stroke-linejoin": "round" }, g);
        } else {
          svg("path", { d: "M" + pts.map(function (p) { return pf(p[0]) + " " + pf(p[1]); }).join("L") + "Z", stroke: "#ffe7ad", "stroke-width": 1.4, fill: "none" }, g);
          var a1 = pts[0], a2 = pts[2], vx = a2[0] - a1[0], vy = a2[1] - a1[1], vn = Math.hypot(vx, vy) || 1; vx /= vn; vy /= vn;
          svg("path", { d: "M" + pf(a1[0] - 3.5 * vx + 2.5 * vy) + " " + pf(a1[1] - 3.5 * vy - 2.5 * vx) + "L" + pf(a1[0] + 1.5 * vx) + " " + pf(a1[1] + 1.5 * vy) + "L" + pf(a1[0] - 3.5 * vx - 2.5 * vy) + " " + pf(a1[1] - 3.5 * vy + 2.5 * vx), stroke: "#ffe7ad", "stroke-width": 1.4, fill: "none" }, g);
        }
    }
    // Aperçu du matériel Polarisation : quatre cadrants, les quatre états que montre l'aide (médaillons de l'app).
    // J = [Re Ex, Im Ex, Re Ey, Im Ey] (axes du cœur), |J|² = ½ : le rayon plein du médaillon.
    function apercuPola(parent) {
      var r = Math.SQRT1_2, c35 = Math.cos(35 * Math.PI / 180), s35 = Math.sin(35 * Math.PI / 180), c60 = Math.cos(Math.PI / 3), s60 = Math.sin(Math.PI / 3);
      var Q = [[{ nat: true }, TRAD("naturelle")], [{ J: [r * Math.cos(Math.PI / 6), 0, r * Math.sin(Math.PI / 6), 0] }, TRAD("rectiligne")],
        [{ J: [r * c35, 0, r * s35 * c60, r * s35 * s60] }, TRAD("elliptique")], [{ J: [0.5, 0, 0, 0.5] }, TRAD("circulaire")]];
      var G = svg("svg", { viewBox: "0 0 72 72", width: "100%", height: "100%" }, parent);
      svg("path", { d: "M36 2V70M2 36H70", stroke: "#262d36", "stroke-width": 0.6 }, G);
      Q.forEach(function (t, i) {
        var q = t[0], cx = 18 + 36 * (i % 2), cy = 16 + 36 * Math.floor(i / 2);
        if (q.J) q.I = q.J.reduce(function (a, v) { return a + v * v; }, 0);
        medaillon(G, cx, cy, 11, q);
        var tx = svg("text", { x: cx, y: cy + 18.5, "text-anchor": "middle", "font-size": 5, fill: "#9aa4b0" }, G); tx.textContent = t[1];
      });
    }
    // Vis de hauteur sur la tige (vue de profil, niveau 3) : molette = décentrement vertical.
    function visHauteur(e, x) {
      var yb = railY - 31;
      return '<g class="bc-vis" data-id="' + e.id + '" data-axe="y"><rect x="' + pf(x + 3) + '" y="' + pf(yb) + '" width="11" height="9" rx="2" fill="url(#bcMolette)" stroke="' + (estSel(e.id) ? "#e0b84c" : "#8791a0") + '" stroke-width=".8"/>' +
        '<path d="M' + pf(x + 5.5) + " " + pf(yb + 2) + "v5M" + pf(x + 8.5) + " " + pf(yb + 2) + "v5M" + pf(x + 11.5) + " " + pf(yb + 2) + 'v5" stroke="#3b424c" stroke-width=".8"/>' +
        '<rect x="' + pf(x - 2) + '" y="' + pf(yb - 6) + '" width="21" height="21" fill="transparent"/></g>';
    }
    function dessinerNotes() {
      gNotes.innerHTML = "";
      var NE = neutralisees(st, P());
      if (NE.length) txt(gNotes, 12, 58, TRAD("Niveau {0} : {1} de {2} neutralisés, pas effacés : ils reviennent au niveau 3.", [NIV,
        P().decentrable ? TRAD("inclinaison") : TRAD("décentrement") + (P().inclinable ? "" : TRAD(" et inclinaison")),
        NE.map(function (q) { return PIECES[q.cle].court; }).join(", ")]), "bc-note");
      var dil = dilat(), dessus = st.vue === "dessus";
      txt(gNotes, 12, 18, (dessus ? TRAD("Vue de dessus") : TRAD("Vue de profil")) + " · " + (dil > 1.05 ? (dessus ? TRAD("largeurs dilatées {0} fois", [fmt(dil, dil < 2 ? 1 : 0)]) : TRAD("hauteurs dilatées {0} fois", [fmt(dil, dil < 2 ? 1 : 0)])) : TRAD("échelle vraie")), "bc-note");
      if (st.aides.construction && CONS && CONS.raison && optq() === "parfaite") txt(gNotes, 12, 72, CONS.raison, "bc-note bc-alerte");
      if (st.aides.rebours) {
        var yr = 90, rr = RET && RET.seq === SEQ && RET.fini ? RET.raison : null;
        if (rr) txt(gNotes, 12, yr, rr, "bc-note bc-alerte");
        else txt(gNotes, 12, yr, TRAD("Cliquer un point de l'observation : des rayons de la lumière qui y arrive."), "bc-note");
      }
    }
    function dessinerBanc() {
      echelles();
      gFond.innerHTML = st.vue === "dessus" ? Dessin.railDessus(X, Z, Y0, sx, LONGUEUR, W) : Dessin.rail(X, Y(0), railY, sx, LONGUEUR);
      dessinerAides(); dessinerRetour(); dessinerElements(); dessinerNotes(); majZoom(); dessinerFace();
    }

    // ----- zoom (boutons) et « De près » -----
    function zoomerBanc(f) {
      var e = selEl(), k = clamp(cam.k * f, 1, ZOOM_MAX);
      if (k === cam.k) return;
      var zf = e ? e.z : cam.zc;
      cam.zc = k === 1 ? LONGUEUR / 2 : zf + (cam.zc - zf) * cam.k / k;
      cam.k = k; cam.pres = false; cam.mont = false; if (k === 1) cam.dil = cam.hc = null;
      modifie("dessin");
    }
    // De près : la pièce choisie SEULE, de très près (elle remplit la hauteur utile),
    // à l'échelle vraie ; zoom seul : la vue de face ne s'ouvre que par son bouton (aides visuelles, touche X).
    function dePres() {
      var e = selEl();
      if (!e) return;
      var dh = Dessin.demiHaut(Dessin.figure(e)), place = st.vue === "dessus" ? Math.min(Y0, H - Y0) - 40 : railY - Y0 - 20;
      cam.k = clamp(0.8 * Math.max(40, place) / Math.max(dh, 1) / sx0, 1, ZOOM_MAX); cam.zc = e.z; cam.pres = true; cam.mont = false; cam.dil = cam.hc = null;
      modifie("dessin");
    }
    // Cadrer (banc ou image) : le bouton arme le mode, un rectangle glissé cadre la zone ; Échap l'annule.
    var CADRE = null;
    function armerCadre(z) {
      CADRE = CADRE === z ? null : z;
      SC.classList.toggle("bc-cadrer", CADRE === "banc"); cvWrap.classList.toggle("bc-cadrer", CADRE === "image");
      gCadre.innerHTML = ""; cadreImg.hidden = true;
      majZoom(); sale.tete = true; majL3();
    }
    // Le rectangle fixe l'étendue le long du rail ET en hauteur : un rectangle plat dilate les hauteurs (jamais au-delà
    // de DIL_MAX, jamais en dessous de l'échelle vraie) ; moins de 6 px de haut : hauteurs automatiques.
    function cadrerBanc(x0, x1, y0, y1) {
      var a = Z(Math.min(x0, x1)), b = Z(Math.max(x0, x1)), hb = HdeY(Math.max(y0, y1)), hh = HdeY(Math.min(y0, y1));
      if (b - a > 1) {
        var k = clamp(LONGUEUR / (b - a), 1, ZOOM_MAX), zu = zoneUtile();
        cam = { k: k, zc: clamp((a + b) / 2, 0, LONGUEUR), pres: false, mont: false };
        if (Math.abs(y1 - y0) > 6) { cam.dil = clamp((zu[1] - zu[0]) / (hh - hb) / (sx0 * k), 1, DIL_MAX); cam.hc = (hb + hh) / 2; }
      }
      armerCadre(null); modifie("dessin");
    }
    function vueEnsemble() { cam = { k: 1, zc: LONGUEUR / 2, pres: false }; }
    // Vue « Montage » : toutes les pièces posées dans le cadre, avec une marge (une lampe déborde vers l'arrière de son
    // cavalier) ; c'est la vue d'un montage qu'on ouvre ou qu'on reprend. Tout le banc si le montage le remplit presque.
    function vueMontage() {
      if (!st.elements.length) { vueEnsemble(); return; }
      var z0 = Infinity, z1 = -Infinity;
      st.elements.forEach(function (e) {
        var arr = { lanterne: 45, spectrale: 35, laser: 120 }[e.type] || 30;
        z0 = Math.min(z0, e.z - arr); z1 = Math.max(z1, e.z + 30);
      });
      // L'encart de face (en haut à droite, 190 px ; 280 dans l'œil) a sa place à droite tant qu'il est activé (menu Voir) :
      // le cadre ne bouge pas quand on choisit une pièce.
      var R = st.aides.face ? (st.elements.some(function (e) { return e.type === "oeil"; }) ? 280 : 190) + 14 : 0;
      var m = (z1 - z0) * 0.06; z0 -= m; z1 += m;
      var sxv = Math.max(40, W - 2 * MARGE - R) / (z1 - z0), k = clamp(sxv / sx0, 1, ZOOM_MAX);
      if (k < 1.15) { vueEnsemble(); cam.mont = true; return; }
      cam = { k: k, zc: z0 + (W / 2 - MARGE) / (sx0 * k), pres: false, mont: true };
    }
    var ZBt = {};
    [["ens", TRAD("Tout le banc"), TRAD("<b>Tout le banc</b>, ses 2 m · double-clic sur le fond · touche <span class=\"k\">0</span>"), function () { vueEnsemble(); modifie("dessin"); }],
      ["mont", TRAD("Montage"), TRAD("<b>Montage</b> — toutes les pièces posées, au plus près"), function () { vueMontage(); modifie("dessin"); }],
      ["moins", "−", TRAD("<b>Voir plus large</b> · touche <span class=\"k\">−</span>"), function () { zoomerBanc(0.5); }], ["k", "", ""],
      ["plus", "+", TRAD("<b>Agrandir</b> autour de la pièce choisie · touche <span class=\"k\">+</span>"), function () { zoomerBanc(2); }],
      ["cadrer", TRAD("Cadrer"), TRAD("<b>Cadrer</b> — puis glisser un rectangle sur le banc : il cadre cette zone · Échap : annuler"), function () { armerCadre("banc"); }],
      ["pres", TRAD("De près"), TRAD("<b>De près</b> — la pièce choisie seule, de très près, à l'échelle vraie · double-clic sur la pièce"), dePres]].forEach(function (q) {
      if (q[0] === "k") { ZBt.k = el("span", "bc-zoom-k", ZB); return; }
      ZBt[q[0]] = K.bouton(ZB, q[1], function () { q[3](); }, "pl-btn-p"); ZBt[q[0]].setAttribute("data-a3", q[2]);
    });
    function majZoom() {
      ZBt.ens.setAttribute("aria-pressed", cam.k === 1 && !cam.mont && !cam.dil ? "true" : "false");
      ZBt.mont.setAttribute("aria-pressed", cam.mont ? "true" : "false");
      ZBt.moins.disabled = cam.k === 1;
      ZBt.plus.disabled = cam.k >= ZOOM_MAX;
      ZBt.pres.disabled = !selEl(); ZBt.pres.setAttribute("aria-pressed", cam.pres ? "true" : "false");
      ZBt.cadrer.setAttribute("aria-pressed", CADRE === "banc" ? "true" : "false");
      ZBt.k.textContent = "×" + fmt(cam.k, cam.k < 10 && cam.k % 1 ? 1 : 0);
      SC.classList.toggle("zoome", cam.k > 1 || !!cam.dil);
    }

    // ----- vue de face de la pièce choisie (encart en haut à droite, masquable au menu Voir) -----
    // Pas d'encart pour une pièce où il n'apprend rien : écran, capteur, miroir, instrument, lampe (le laser garde sa tache).
    // Vue de face épinglée (`st.faceFix`, id d'une pièce) : elle reste sur sa pièce quand on en choisit une autre ; la pièce
    // retirée du banc lève l'épinglage. Bandeau, ↑ ↓, De près ne lisent que la sélection (`selEl`).
    function faceEl() {
      if (st.faceFix) { var f = trouver(st, st.faceFix); if (f) return f; st.faceFix = null; }
      return selEl();
    }
    function entete(e, sous) {
      var ep = st.faceFix === e.id;
      var nb = FACE.querySelector("b");
      nb.textContent = e.id === st.sel ? PIECES[e.cle].court : nomDe(e); nb.title = nomDe(e) + (ep && e.id !== st.sel ? TRAD(" (épinglée : ce n'est pas la pièce choisie)") : "");
      FACE.querySelector(".bc-face-t span").textContent = sous;
      var b = FACE.querySelector(".bc-face-pin");
      b.innerHTML = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M10.5 1.5l4 4-1.6.6-2.3 2.6.3 3-1.2 1.2-2.6-2.6-4.2 4.2-.7-.7 4.2-4.2L3.8 6.2 5 5l3 .3 2.6-2.3z" fill="currentColor"/></svg>';
      b.setAttribute("aria-pressed", ep ? "true" : "false"); b.setAttribute("aria-label", ep ? TRAD("Désépingler la vue de face") : TRAD("Épingler la vue de face"));
      b.title = ep ? TRAD("Épinglée sur {0} — désépingler : la vue de face redevient celle de la pièce choisie.", [nomDe(e)]) : TRAD("Épingler : la vue de face reste sur cette pièce quand on en choisit une autre.");
      b.addEventListener("click", function () { st.faceFix = ep ? null : e.id; modifie("dessin"); });
      FACE.querySelector(".bc-face-x").addEventListener("click", function () { st.aides.face = false; if (cam.mont) vueMontage(); modifie("dessin"); majAides(); });
    }
    function faceVue() {
      var e = faceEl(); if (!st.aides.face || !e) return false;
      var T = C.TYPES[e.type] || {};
      if (e.type === "oeil" || e.type === "laser" || decentrable(e)) return true;      // niveau 3 : la commande du décentrement
      return !(T.detecteur || T.instrument || T.miroir || T.source);
    }
    // Lumière dans le plan de la pièce : laser = tache gaussienne (rayon w, centre suivi au paraxial) ; sinon la lumière
    // qui y ARRIVE (enveloppe paraxiale dans les deux plans, avant la coupe par son ouverture), bornée à sa monture.
    function zoneEclairee(e) {
      if (!SEQ || !SEQ.source || !SEQ.prims) return null;
      var P = SEQ.prims, j = -1, em = SEQ.source.em, laser = em && em.forme === "gauss", O = SEQ.source.fr.O;
      P.forEach(function (pr, i) { if (j < 0 && pr.el === e.id && pr.k !== K_.AIRY) j = i; });
      if (e.type === "laser") return laser ? { laser: true, w: em.a, c: [O[0], O[1]] } : null;
      if (j < 0) return e.type === "lanterne" || e.type === "spectrale" ? { source: true } : null;
      if (laser) {
        var F0 = faisceauLaser(SEQ, 0, st);
        if (F0 && F0.jd >= 0 && j > F0.jd) return { diffus: true };
        var c = [0, 1].map(function (ax) { var t = suivreParax(SEQ, ax, -1, [[O[ax], 0]], j, lLaser(SEQ), 1); return t[t.length - 1].h[0]; });
        return { laser: true, w: C.gaussien(SEQ, lLaser(SEQ), em.a, [P[j].s])[0].w, c: c };
      }
      var lim = Math.min(P[j].Sm || P[j].R || 40, Dessin.demiHaut(Dessin.figure(e)) - 3), a = [0, 1].map(function (ax) {
        var r = { j: j }; enveloppe(SEQ, ax, 6, r);
        if (!(r.hi >= r.lo)) return null;
        var o = P[j].O[ax], L = lim < C.GRAND / 2 ? lim : 40;
        return [Math.max(r.lo, o - L), Math.min(r.hi, o + L)];
      });
      return a[0] && a[1] && a[0][1] > a[0][0] - 1e-9 && a[1][1] > a[1][0] - 1e-9 ? { x: a[0], y: a[1] } : null;
    }
    // Ce qu'on voit de la pièce, de face, à l'échelle (k pixels par mm, centre (cx, cy) = son centre).
    function ouverturesFace(e, p, cx, cy, k, S) {
      var s = "", jour = "#e9edf1", i;
      function fente(xc, w, hg) { return '<rect x="' + pf(cx + (xc - w / 2) * k) + '" y="' + pf(cy - hg / 2 * k) + '" width="' + pf(Math.max(0.8, w * k)) + '" height="' + pf(hg * k) + '" fill="' + jour + '" fill-opacity=".9"/>'; }
      if (e.type === "bifentes") {
        var r = decouverte(p);
        p.a.forEach(function (a, i2) {
          var xc = (i2 - r) * p.pas;
          if (p.caches && p.caches[i2]) s += '<rect x="' + pf(cx + (xc - 1.2) * k) + '" y="' + pf(cy - 4 * k) + '" width="' + pf(2.4 * k) + '" height="' + pf(8 * k) + '" fill="#2a3038" stroke="#4a535f"/>';
          else s += fente(xc - a / 2, p.e, p.h) + fente(xc + a / 2, p.e, p.h);
        });
      } else if (e.type === "fente" || e.type === "fenteSource") s += fente(0, e.type === "fente" ? p.e : p.b, 10);
      else if (e.type === "fentesMultiples") { for (i = 0; i < p.n; i++) s += fente((i - (p.n - 1) / 2) * p.pas, p.e, 5); }
      else if (e.type === "trousYoung") [-1, 1].forEach(function (sg) { s += '<circle cx="' + pf(cx + sg * p.a / 2 * k) + '" cy="' + pf(cy) + '" r="' + pf(Math.max(0.8, p.d / 2 * k)) + '" fill="' + jour + '"/>'; });
      else if (e.type === "trouSource") s += '<circle cx="' + pf(cx) + '" cy="' + pf(cy) + '" r="' + pf(Math.max(0.8, p.d / 2 * k)) + '" fill="' + jour + '"/>';
      else if (e.type === "iris") s += '<circle cx="' + pf(cx) + '" cy="' + pf(cy) + '" r="' + pf(Math.max(0.8, p.D / 2 * k)) + '" fill="' + jour + '" fill-opacity=".9"/>';
      else if (e.type === "lettreF") [[-6, -10, -3, 10], [-6, 7, 6, 10], [-6, -1.5, 3, 1.5]].forEach(function (q) {
        s += '<rect x="' + pf(cx + q[0] * k) + '" y="' + pf(cy - q[3] * k) + '" width="' + pf((q[2] - q[0]) * k) + '" height="' + pf((q[3] - q[1]) * k) + '" fill="' + jour + '" fill-opacity=".9"/>'; });
      else if (e.type === "diapo") {      // à l'échelle : l'image fait 20 mm (±10), le cadre déborde de 2,5 mm
        var vg = Dessin.vignette(p.image);
        s = '<rect x="' + pf(cx - 12.5 * k) + '" y="' + pf(cy - 12.5 * k) + '" width="' + pf(25 * k) + '" height="' + pf(25 * k) + '" rx="2" fill="' + (p.eclairee ? "#d9d6cc" : "#e8e3d4") + '" stroke="#8b877b"/>' +
          (vg ? '<image href="' + vg + '" x="' + pf(cx - 10 * k) + '" y="' + pf(cy - 10 * k) + '" width="' + pf(20 * k) + '" height="' + pf(20 * k) + '" preserveAspectRatio="none"/>' : '<rect x="' + pf(cx - 10 * k) + '" y="' + pf(cy - 10 * k) + '" width="' + pf(20 * k) + '" height="' + pf(20 * k) + '" fill="#8a9098"/>') +
          '<rect x="' + pf(cx - 10 * k) + '" y="' + pf(cy - 10 * k) + '" width="' + pf(20 * k) + '" height="' + pf(20 * k) + '" fill="none" stroke="#5d5a52" stroke-width=".8"/>';
      }
      else if (e.type === "reseau") {
        s = '<rect x="0" y="0" width="' + S + '" height="' + S + '" fill="#a9c7e0" fill-opacity=".12"/>';
        var pas = 1 / p.n;
        if (pas * k > 1.5) { for (var x = -S / k; x <= S / k; x += pas) s += '<path d="M' + pf(cx + x * k) + " 0v" + S + '" stroke="#0c1016" stroke-width=".6"/>'; }
        else s += '<rect x="0" y="0" width="' + S + '" height="' + S + '" fill="#6d7a88" fill-opacity=".25"/>';
      } else if (e.type === "quadrillage" || e.type === "grilleCroisee" || e.type === "regle") {
        // le vrai motif à l'échelle (cadre + traits du masque du cœur), quand le pas tient dans la vue ; sinon un voile
        var a = C.TYPES[e.type].prims(p)[0].p.slice(1), x, w2;
        if (e.type === "regle") {        // a = [demi-longueur, largeur trait, demi-hauteur, pas]
          s += '<rect x="' + pf(cx - (a[0] + 2) * k) + '" y="' + pf(cy - a[2] * k) + '" width="' + pf(2 * (a[0] + 2) * k) + '" height="' + pf(2 * a[2] * k) + '" fill="#101317" stroke="#5b6471"/>';
          if (a[3] * k > 0.8) for (x = -a[0]; x <= a[0] + 1e-9; x += a[3]) {
            var aj = Math.abs(Math.round(x / a[3])), len = aj % 10 === 0 ? 2.5 : aj % 5 === 0 ? 1.6 : 1.0;
            s += '<path d="M' + pf(cx + x * k) + " " + pf(cy + a[2] * k) + "v" + pf(-len * k) + '" stroke="#e9edf1" stroke-width="' + pf(Math.max(0.5, a[1] * k)) + '" stroke-opacity=".85"/>';
          } else s += '<rect x="' + pf(cx - a[0] * k) + '" y="' + pf(cy - a[2] * k) + '" width="' + pf(2 * a[0] * k) + '" height="' + pf(2 * a[2] * k) + '" fill="#6d7a88" fill-opacity=".25"/>';
        } else {                      // grille : a = [pas, largeur trait, demi-côté, pas2, largeur2]
          s += '<rect x="' + pf(cx - a[2] * k) + '" y="' + pf(cy - a[2] * k) + '" width="' + pf(2 * a[2] * k) + '" height="' + pf(2 * a[2] * k) + '" fill="#101317" stroke="#5b6471"/>';
          if (a[0] * k > 1.2) for (x = -a[2]; x <= a[2] + 1e-9; x += a[0]) {
            w2 = (a[3] > 0 && Math.abs(x / a[3] - Math.round(x / a[3])) < 1e-9) ? a[4] : a[1];
            s += '<path d="M' + pf(cx + x * k) + " " + pf(cy - a[2] * k) + "v" + pf(2 * a[2] * k) + " M" + pf(cx - a[2] * k) + " " + pf(cy + x * k) + "h" + pf(2 * a[2] * k) +
              '" stroke="#e9edf1" stroke-width="' + pf(Math.max(0.5, w2 * k)) + '" stroke-opacity=".85"/>';
          } else s += '<rect x="' + pf(cx - a[2] * k) + '" y="' + pf(cy - a[2] * k) + '" width="' + pf(2 * a[2] * k) + '" height="' + pf(2 * a[2] * k) + '" fill="#6d7a88" fill-opacity=".25"/>';
        }
      } else {
        // les autres : leur miniature, à la taille de la pièce (le détail n'est pas à l'échelle)
        var t = Dessin.demiHaut(Dessin.figure(e)) * k / 18;
        s += '<g transform="translate(' + pf(cx - 20 * t) + " " + pf(cy - 20 * t) + ") scale(" + pf(t * 100) / 100 + ')">' + Dessin.miniature(Dessin.figure(e)) + "</g>";
      }
      return s;
    }
    function dessinerFace() {
      var e = faceEl();
      if (!faceVue()) { FACE.hidden = true; return; }
      FACE.hidden = false;
      FACE.classList.toggle("bc-face-oeil", e.type === "oeil");
      if (e.type === "oeil") { FACE_CLIC = null; dessinerOeil(e); return; }
      var p = C.params(e), z = zoneEclairee(e), S = 190;
      var util = { bifentes: 0.9, trousYoung: p.a ? p.a * 1.3 : 1, fentesMultiples: (p.n || 2) * (p.pas || 0.2) * 0.9, fente: 1, fenteSource: 2.5, reseau: 2, laser: 3,
        iris: Math.max(3, (p.D || 10) * 0.75), trouSource: 1.5, lettreF: 14, diapo: 14 }[e.type];
      if (e.type === "lentille") util = p.D / 2 + 4;
      if (!util) util = Dessin.demiHaut(Dessin.figure(e)) * 0.8;
      // Niveau 3 : le dessin est centré sur l'axe du banc (la pièce bouge sous le pointeur qui la glisse ; échelle gelée
      // pendant le geste) ; sinon sur la pièce, la croix marquant l'axe.
      var q = neutre(e, P()), ox = q.x || 0, oy = q.y || 0, Wf = util, mob = decentrable(e), c0x = mob ? 0 : ox, c0y = mob ? 0 : oy;
      if (z && z.laser) Wf = Math.max(Wf, 1.6 * z.w + Math.max(Math.abs(z.c[0] - ox), Math.abs(z.c[1] - oy)));
      if (mob) Wf += Math.max(Math.abs(ox), Math.abs(oy));
      var k = geste && geste.type === "face" ? geste.k : (S / 2 - 12) / Wf, cx = S / 2, cy = S / 2 - 6;
      function PX(x) { return cx + (x - c0x) * k; }
      function PY(y) { return cy - (y - c0y) * k; }
      var pcx = PX(ox), pcy = PY(oy);
      var g = '<rect x="0" y="0" width="' + S + '" height="' + S + '" fill="#101317"/>';
      if (e.type === "lentille") g += '<circle cx="' + pf(pcx) + '" cy="' + pf(pcy) + '" r="' + pf((p.D / 2 + 4) * k) + '" fill="#191d23" stroke="#5b6471"/><circle cx="' + pf(pcx) + '" cy="' + pf(pcy) + '" r="' + pf(p.D / 2 * k) + '" fill="#a9c7e0" fill-opacity=".14" stroke="#7d93a8" stroke-width=".8"/>';
      else if (e.type === "laser") g += '<circle cx="' + pf(pcx) + '" cy="' + pf(pcy) + '" r="' + pf(Math.min(80, 15 * k)) + '" fill="#1d2127" stroke="#5b6471"/><circle cx="' + pf(pcx) + '" cy="' + pf(pcy) + '" r="' + pf(1.5 * k) + '" fill="#0b0d10" stroke="#8791a0"/>';
      else g += '<g transform="rotate(' + pf(-(e.rot || 0) * 180 / Math.PI) + " " + pf(pcx) + " " + pf(pcy) + ')">' + ouverturesFace(e, p, pcx, pcy, k, S) + "</g>";
      if (z && z.laser) g += '<circle cx="' + pf(PX(z.c[0])) + '" cy="' + pf(PY(z.c[1])) + '" r="' + pf(z.w * k * 1.6) + '" fill="url(#bcLaserF)" style="mix-blend-mode:screen"/>';
      else if (z && z.x) {
        var x0 = PX(z.x[0]), x1 = PX(z.x[1]), y0 = PY(z.y[1]), y1 = PY(z.y[0]);
        g += '<ellipse cx="' + pf((x0 + x1) / 2) + '" cy="' + pf((y0 + y1) / 2) + '" rx="' + pf(Math.max(1.5, (x1 - x0) / 2)) + '" ry="' + pf(Math.max(1.5, (y1 - y0) / 2)) + '" fill="rgba(255,214,130,.28)" stroke="rgba(255,214,130,.6)" stroke-width=".8" style="mix-blend-mode:screen"/>';
      }
      // champ vu par l'instrument (viseur/lunette/œil) : disque ambré sur l'objet, centré sur l'axe de l'instrument
      var tChamp = "";
      var ch = (SEQ && SEQ.objet >= 0 && SEQ.prims[SEQ.objet].el === e.id) ? champVuInstrument(SEQ) : null;
      if (ch) {
        var elI = instrumentDe(SEQ, st) || (SEQ.detEl && /^(oeil|capteur|ecran)$/.test(SEQ.detEl.type) ? SEQ.detEl : null);
        var qI = elI ? neutre(elI, P()) : { x: 0, y: 0 };
        g += '<circle cx="' + pf(PX(qI.x || 0)) + '" cy="' + pf(PY(qI.y || 0)) + '" r="' + pf(Math.max(2, ch * k)) + '" fill="rgba(224,184,76,.07)" stroke="#e0b84c" stroke-width="1.2" stroke-dasharray="4 3"/>';
        tChamp = TRAD(" Cercle ambré : champ vu par {0} (±{1} mm sur cette pièce).", [elI ? nomP(elI) : TRAD("le détecteur"), fmt(ch)]);
      }
      // axe du banc (croix ambre) et échelle
      g += '<path d="M' + pf(PX(0) - 7) + " " + pf(PY(0)) + "h14M" + pf(PX(0)) + " " + pf(PY(0) - 7) + 'v14" stroke="#e0b84c" stroke-width="1.1"/>';
      var bar = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20].filter(function (b) { return b * k <= 70; }).pop() || 0.1;
      g += '<rect x="6" y="' + (S - 24) + '" width="' + pf(bar * k + 52) + '" height="18" rx="3" fill="#0c0f13" fill-opacity=".85"/><path d="M12 ' + (S - 12) + "h" + pf(bar * k) + '" stroke="#c9cfd8" stroke-width="2"/><text x="' + pf(16 + bar * k) + '" y="' + (S - 8.5) + '" font-size="10" fill="#c9cfd8">' + (bar < 1 ? fmt(bar * 1000) + " µm" : fmt(bar) + " mm") + "</text>";
      // Objet étendu choisi, pinceau affiché : un clic sur la vue de face désigne le point d'où part le pinceau (même
      // règle que le clic sur la pièce du banc : hauteur en profil, abscisse en dessus, arrondie à 0,5 mm).
      var cliquable = !!((st.aides.pinceau || st.aides.spot) && SEQ && SEQ.objet >= 0 && SEQ.prims[SEQ.objet].el === e.id && ETENDUE[e.type]);
      if (cliquable) {
        var mx = pcx + (st.pinceau.hx || 0) * k, my = pcy - (st.pinceau.h || 0) * k;
        g += '<circle cx="' + pf(mx) + '" cy="' + pf(my) + '" r="4.5" fill="none" stroke="#ff7a59" stroke-width="1.6"/><circle cx="' + pf(mx) + '" cy="' + pf(my) + '" r="1.4" fill="#ff7a59"/>';
      }
      var t = z && z.source ? TRAD("La lumière sort de cette pièce.") : z && z.diffus ? TRAD("Derrière la fente : la lumière est diffractée, on la voit sur l'observation.") : z && z.laser ? TRAD("La tache du laser sur la pièce.") : z && z.x ? TRAD("La zone qu'éclaire le faisceau.") : TRAD("Rien n'éclaire cette pièce.");
      t += tChamp;
      if (mob) t += e.verrou ? TRAD(" Pièce verrouillée.") : TRAD(" Glisser la pièce dans son plan pour la décentrer (Maj : fin · Ctrl+Maj : ultrafin) ; la croix marque l'axe du banc.");
      else if (Math.abs(ox) > 1e-9 || Math.abs(oy) > 1e-9) t += TRAD(" Pièce décalée : la croix marque l'axe du banc.");
      if (cliquable) t += TRAD(" Un clic ici choisit le point d'où part le pinceau (vues de profil et de dessus).");
      FACE.innerHTML = '<div class="bc-face-t"><b></b><span></span><button type="button" class="bc-face-pin"></button><button type="button" class="bc-face-x" title="Masquer (touche X)">×</button></div>' +
        '<svg class="bc-face-d" viewBox="0 0 ' + S + " " + S + '" aria-hidden="true"><defs><radialGradient id="bcLaserF"><stop offset="0" stop-color="' + cLaser(SEQ, 1, true) + '" stop-opacity=".95"/><stop offset=".5" stop-color="' + cLaser(SEQ, 1) + '" stop-opacity=".5"/><stop offset="1" stop-color="' + cLaser(SEQ, 1) + '" stop-opacity="0"/></radialGradient></defs>' + g + "</svg>" +
        '<div class="bc-face-p"></div>';
      FACE.querySelector(".bc-face-p").textContent = t; entete(e, TRAD("de face"));
      var sv = FACE.querySelector("svg.bc-face-d");      // pas le premier <svg> de l'encart : l'icône du bouton punaise
      if (mob && !e.verrou) {      // glisser : décentrer (le geste vit sur la page, le dessin est refait pendant qu'il dure)
        sv.style.cursor = "move";
        sv.setAttribute("data-a3", TRAD("<b>Vue de face</b> (niveau 3) — glisser la pièce dans son plan (Maj : fin · Ctrl+Maj : ultrafin) · croix ambre : l'axe du banc") + (cliquable ? TRAD(" · clic : le point d'où part le pinceau") : ""));
        sv.addEventListener("pointerdown", function (ev) {
          if (ev.button) return;
          var r = sv.getBoundingClientRect(); if (!r.width) return;
          ev.preventDefault(); fermerCtx();
          geste = { type: "face", el: e.id, k: k, r: r.width / S, x0: ev.clientX, y0: ev.clientY, dx: e.x || 0, dy: e.y || 0, bouge: false };
          K.racine.classList.add("pl-glisse");
        });
      }
      FACE_CLIC = null;
      if (cliquable) {
        sv.style.cursor = mob && !e.verrou ? "move" : "crosshair";
        FACE_CLIC = { pcx: pcx, pcy: pcy, k: k, m: ETENDUE[e.type] };
      }
    }
    // Clic sur la vue de face = point d'où part le pinceau. Écouté sur l'encart (permanent), pas sur son <svg> : l'encart
    // est refait à chaque dessin, et un dessin entre l'appui et le relâchement (fin d'un geste, image qui s'affine, vue
    // épinglée sur l'objet pendant qu'une autre pièce est choisie) remplace le <svg> ; le clic part alors au conteneur
    // et un écouteur posé sur l'ancien <svg> ne le reçoit pas.
    var FACE_CLIC = null;
    FACE.addEventListener("click", function (ev) {
      if (FACE_BOUGE) { FACE_BOUGE = false; return; }
      var c = FACE_CLIC, sv = FACE.querySelector("svg.bc-face-d");
      if (!c || !sv || (ev.target.closest && ev.target.closest(".bc-face-t"))) return;
      var r = sv.getBoundingClientRect(); if (!r.width) return;
      if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) return;
      var u = (ev.clientX - r.left) / r.width * 190, v = (ev.clientY - r.top) / r.height * 190;       // S de dessinerFace
      fixerPoint(clamp(arrondi((u - c.pcx) / c.k, 0.5), -c.m[0], c.m[0]), clamp(arrondi((c.pcy - v) / c.k, 0.5), -c.m[1], c.m[1]));     // point 2D : profil (h) et dessus (hx)
      modifie("dessin");
    });

    // Œil choisi : l'encart montre l'INTÉRIEUR de l'œil en coupe, à l'échelle (œil réduit du modèle : cristallin dans
    // le plan de la pupille, rétine à 17 mm), avec les rayons du pinceau (point de l'objet désigné) qui y entrent ;
    // prolongés en tirets au-delà de la rétine, ils montrent où ils se croiseraient. Le cristallin est dessiné plus
    // bombé quand l'œil accommode (dessin seulement : le modèle est une lentille mince de vergence variable).
    function dessinerOeil(e) {
      var W = 280, H = 190, k = W / 36, ax = axe(), p = C.params(e), u2x = function (u) { return (u + 10) * k; }, v2y = function (v) { return H / 2 - v * k; };
      var ech = echantillonRayons(SEQ), ls = ech.ls;
      // tous les rayons passent la pupille (le pinceau couvre l'ouverture limitante) : 41 par longueur d'onde suffisent
      var D = SEQ ? dansOeil(SEQ, e.id, ax, hAxe(st.pinceau, ax), ls, 41, undefined, hAutre(st.pinceau, ax)) : null;
      var a = amplitude(p.type || "normal"), acc = clamp((puissance(p) - a[0]) / 8, 0, 1), ep = 3.6 + 2.4 * acc, pup = (oeilObserve(e) ? PUP : p.pupille || 4) / 2;
      var g = '<rect width="' + W + '" height="' + H + '" fill="#101317"/>';
      g += '<ellipse cx="' + pf(u2x(7)) + '" cy="' + pf(v2y(0)) + '" rx="' + pf(10 * k) + '" ry="' + pf(11 * k) + '" fill="#161b21" stroke="#4a5360" stroke-width="1.2"/>';
      g += '<path d="M' + pf(u2x(-2.4)) + " " + pf(v2y(5.5)) + "Q" + pf(u2x(-4.6)) + " " + pf(v2y(0)) + " " + pf(u2x(-2.4)) + " " + pf(v2y(-5.5)) + '" fill="none" stroke="#6d7a89" stroke-width="1.2"/>';
      var th = 0.95, ang = function (t) { return [u2x(7 + 10 * Math.cos(t)), v2y(11 * Math.sin(t))]; }, r0 = ang(-th), r1 = ang(th);
      g += '<path d="M' + pf(r0[0]) + " " + pf(r0[1]) + "A" + pf(10 * k) + " " + pf(11 * k) + " 0 0 0 " + pf(r1[0]) + " " + pf(r1[1]) + '" fill="none" stroke="#c0606c" stroke-width="2.4"/>';
      g += '<ellipse cx="' + pf(u2x(0)) + '" cy="' + pf(v2y(0)) + '" rx="' + pf(ep / 2 * k) + '" ry="' + pf(4.6 * k) + '" fill="#a9c7e0" fill-opacity=".16" stroke="#7d93a8" stroke-width=".9"/>';
      g += '<path d="M' + pf(u2x(-0.6)) + " " + pf(v2y(pup)) + "V" + pf(v2y(6.4)) + "M" + pf(u2x(-0.6)) + " " + pf(v2y(-pup)) + "V" + pf(v2y(-6.4)) + '" stroke="#55606e" stroke-width="2.6"/>';
      g += '<path d="M0 ' + pf(v2y(0)) + "H" + W + '" stroke="#e0b84c" stroke-width=".6" stroke-dasharray="3 3" opacity=".55"/>';
      var Ufin = 25;
      if (D) D.rayons.forEach(function (r) {
        var coul = couleurRayon(ech, r.l);
        var vR = r.v0 + r.pente * RETINE, vF = r.v0 + r.pente * Ufin;
        g += '<path d="M' + pf(u2x(r.avant[0])) + " " + pf(v2y(r.avant[1])) + "L" + pf(u2x(0)) + " " + pf(v2y(r.v0)) + "L" + pf(u2x(RETINE)) + " " + pf(v2y(vR)) + '" fill="none" stroke="' + coul + '" stroke-width=".9" opacity=".9"' + (ls.length > 1 ? ' style="mix-blend-mode:screen"' : "") + "/>";
        g += '<path d="M' + pf(u2x(RETINE)) + " " + pf(v2y(vR)) + "L" + pf(u2x(Ufin)) + " " + pf(v2y(vF)) + '" fill="none" stroke="' + coul + '" stroke-width=".8" stroke-dasharray="2.5 2.5" opacity=".55"/>';
      });
      var t, cr = D && D.croise;
      if (!SEQ || !SEQ.source) t = TRAD("Pas de lumière sur le banc.");
      else if (!D || !D.rayons.length) t = TRAD("Aucun rayon du pinceau n'entre dans l'œil.");
      else if (!cr || cr.u < 0) t = TRAD("Les rayons s'écartent : ils ne se croiseraient que derrière la rétine. L'image est floue.");
      else if (Math.abs(cr.u - RETINE) < 0.05) t = TRAD("Les rayons se croisent sur la rétine : l'image est nette.");
      else t = cr.u < RETINE ? TRAD("Les rayons se croisent avant la rétine : l'image est floue.") : TRAD("Les rayons se croisent derrière la rétine : l'image est floue.");
      if (cr && cr.u > 0 && cr.u < Ufin) g += '<circle cx="' + pf(u2x(cr.u)) + '" cy="' + pf(v2y(cr.v)) + '" r="2.4" fill="none" stroke="#e0b84c" stroke-width="1.1"/>';
      // Loupe sur la rétine quand les rayons se croisent à moins de 2 mm d'elle (à l'échelle de l'encart, 0,5 mm = 4 px) :
      // rond agrandi en bas à droite, centré entre le croisement et la rétine (rétine droite à cette échelle).
      if (cr && Math.abs(cr.u - RETINE) < 2 && D.rayons.length) {
        var LR = 38, Lx = W - LR - 6, Ly = H - LR - 6, um = (cr.u + RETINE) / 2, vm = cr.v;
        var Z = clamp(LR * 0.55 / (Math.max(Math.abs(cr.u - RETINE) / 2, 0.06) * k), 3, 40), kz = k * Z;
        var LX = function (u) { return Lx + (u - um) * kz; }, LY = function (v) { return Ly - (v - vm) * kz; };
        var du = LR / kz * 1.2;
        g += '<path d="M' + pf(u2x(um)) + " " + pf(v2y(vm)) + "L" + pf(Lx - LR * 0.7) + " " + pf(Ly - LR * 0.7) + '" stroke="#5b6471" stroke-width=".8"/>';
        g += '<circle cx="' + pf(u2x(um)) + '" cy="' + pf(v2y(vm)) + '" r="5" fill="none" stroke="#8791a0" stroke-width=".8"/>';
        g += '<clipPath id="bcOeilLoupe"><circle cx="' + pf(Lx) + '" cy="' + pf(Ly) + '" r="' + LR + '"/></clipPath>';
        g += '<circle cx="' + pf(Lx) + '" cy="' + pf(Ly) + '" r="' + LR + '" fill="#0c0f13"/><g clip-path="url(#bcOeilLoupe)">';
        g += '<path d="M' + pf(LX(RETINE)) + " " + pf(Ly - LR) + "V" + pf(Ly + LR) + '" stroke="#c0606c" stroke-width="2.4"/>';
        D.rayons.forEach(function (r) {
          var coul = couleurRayon(ech, r.l);
          var u0 = um - du, u1 = um + du, v = function (u) { return r.v0 + r.pente * u; }, uR = Math.min(u1, RETINE);
          if (u0 < uR) g += '<path d="M' + pf(LX(u0)) + " " + pf(LY(v(u0))) + "L" + pf(LX(uR)) + " " + pf(LY(v(uR))) + '" stroke="' + coul + '" stroke-width=".9" opacity=".9"/>';
          if (u1 > RETINE) g += '<path d="M' + pf(LX(Math.max(u0, RETINE))) + " " + pf(LY(v(Math.max(u0, RETINE)))) + "L" + pf(LX(u1)) + " " + pf(LY(v(u1))) + '" stroke="' + coul + '" stroke-width=".8" stroke-dasharray="2.5 2.5" opacity=".55"/>';
        });
        g += '<circle cx="' + pf(LX(cr.u)) + '" cy="' + pf(LY(cr.v)) + '" r="2.4" fill="none" stroke="#e0b84c" stroke-width="1.1"/></g>';
        g += '<circle cx="' + pf(Lx) + '" cy="' + pf(Ly) + '" r="' + LR + '" fill="none" stroke="#8791a0" stroke-width="1.2"/>';
      }
      t += acc < 0.01 ? TRAD(" Le cristallin est au repos.") : acc > 0.99 ? TRAD(" Le cristallin accommode autant qu'il peut.") : TRAD(" Le cristallin accommode : il se bombe.");
      FACE.innerHTML = '<div class="bc-face-t"><b></b><span></span><button type="button" class="bc-face-pin"></button><button type="button" class="bc-face-x" title="Masquer (menu Voir)">×</button></div>' +
        '<svg viewBox="0 0 ' + W + " " + H + '" aria-hidden="true">' + g + "</svg>" + '<div class="bc-face-p"></div>';
      FACE.querySelector(".bc-face-p").textContent = t; entete(e, TRAD("dans l'œil"));
    }

    // ----- gestes sur le banc -----
    // Glisser une pièce le long du rail ; la ramener sous le banc (bandeau, étagère) la range. Molette : la pièce
    // choisie avance de 1 mm (Maj : 0,1 mm ; Ctrl+Maj : 0,01 mm ; Ctrl : 1 cm) où que soit le pointeur ; sur la miniature d'une pièce, son réglage
    // principal. Jamais de zoom.
    function elDe(cible) { var g = cible && cible.closest ? cible.closest("[data-id]") : null; return g ? trouver(st, g.getAttribute("data-id")) : null; }
    function placeLibre(cle) {
      var zs = st.elements.map(function (e) { return e.z; }).sort(function (a, b) { return a - b; }), z, i;
      function libre(q) { return !zs.some(function (y) { return Math.abs(y - q) < 60; }); }
      if (PIECES[cle].type === "lanterne" && libre(150)) return 150;
      z = zs.length ? arrondi(zs[zs.length - 1] + 150, 10) : 300;
      if (z <= LONGUEUR - 50) return z;
      var ecart = 0, mil = 100;                  // banc plein jusqu'au bout : au milieu du plus grand trou
      for (i = 0; i + 1 < zs.length; i++) if (zs[i + 1] - zs[i] > Math.max(160, ecart)) { ecart = zs[i + 1] - zs[i]; mil = arrondi((zs[i] + zs[i + 1]) / 2, 10); }
      return mil;
    }
    function deplacer(e, z) { e.z = clamp(z, 0, LONGUEUR); }
    // Le banc n'a qu'une source (le cœur prend la première) : une source posée REMPLACE la précédente, d'un clic à sa
    // place, d'un glisser là où on la lâche.
    function estSource(e) { return !!(C.TYPES[e.type] && C.TYPES[e.type].source); }
    function remplacerSource(e) {
      if (!estSource(e)) return null;
      var vieilles = st.elements.filter(function (q) { return q !== e && estSource(q); }), z = vieilles.length ? vieilles[0].z : null;
      vieilles.forEach(function (q) { ranger(st, q.id); });
      return z;
    }
    function poserPiece(cle) {
      var src = !!(C.TYPES[PIECES[cle].type] && C.TYPES[PIECES[cle].type].source), vieille = src ? st.elements.filter(estSource)[0] : null;
      var e = poser(st, cle, vieille ? vieille.z : placeLibre(cle));
      remplacerSource(e);
      return e;
    }
    // Pièce posée d'un clic (placeLibre) hors du cadre zoomé : on recadre sur le montage, sinon elle serait invisible.
    function voir(e) { var dz = LONGUEUR / (2 * cam.k) * 0.9; if (e && Math.abs(e.z - cam.zc) > dz) vueMontage(); }
    // Décalage d'une pièce : latéral (x : vis du cavalier vue de dessus, platine au bandeau, vue de face) ; en hauteur
    // (y, niveau 3 : vis de la tige vue de profil, vue de face). Pièce verrouillée : rien.
    function decaler(e, d, ax) { fixerDec(e, ax || "x", (e[ax || "x"] || 0) + d); }
    function fixerDec(e, ax, v) {
      if (e.verrou) return;
      e[ax] = clamp(Math.round(v * 1000) / 1000, -DEC_MAX, DEC_MAX);
      modifie("seq"); if (bdPlatine) bdPlatine();      // pas tout le bandeau : la platine glissée y tient la capture
    }
    function recentrer(e) { if (e.verrou || !(e.x || e.y)) return; e.x = 0; e.y = 0; modifie("seq bandeau dessin"); }
    // Escamoter (E) : relevée hors du faisceau, à sa place, absente du calcul ; E la rabaisse. Toute la sélection suit
    // la dernière choisie. Un récepteur escamoté qui observait cède la place (st.recep oublié).
    function escamoter() {
      var e = selEl(); if (!e) return;
      var rel = !e.esc;
      sels().forEach(function (q) { if (rel) { q.esc = true; if (st.recep === q.id) delete st.recep; } else delete q.esc; });
      modifie("seq dessin bandeau tete");
    }
    // Verrouiller (L) : ni glisser, ni molette, ni flèches, ni ranger, ni remplacer, ni décentrer ; réglages propres libres.
    function verrouiller() {
      var e = selEl(); if (!e) return;
      var v = !e.verrou;
      sels().forEach(function (q) { if (v) q.verrou = true; else delete q.verrou; });
      modifie("dessin bandeau");
    }
    function libres() { return sels().filter(function (q) { return !q.verrou; }); }
    // Clic : la choisir ; Ctrl+clic : l'ajouter ou la retirer ; Maj+clic : toutes celles entre la dernière choisie et elle.
    // Glisser une pièce choisie déplace toute la sélection (écarts gardés) ; un clic sans glisser sur une pièce déjà
    // choisie parmi plusieurs ne garde qu'elle.
    var REMPL = null;       // pièce visée par un lâcher-remplacer
    D.addEventListener("pointerdown", function (ev) {
      if (ev.button) return;
      var p = K.ptSvg(ev);
      try { D.focus({ preventScroll: true }); } catch (e0) {}
      ev.preventDefault();
      fermerCtx();
      if (CADRE === "banc") { geste = { type: "cadre", x0: p.x, x1: p.x, y0: p.y, y1: p.y }; K.racine.classList.add("pl-glisse"); return; }
      if (ev.target.classList && ev.target.classList.contains("bc-poignee")) { geste = { type: "poignee" }; K.racine.classList.add("pl-glisse"); return; }
      if (ev.target.classList && ev.target.classList.contains("bc-poigneeB")) { geste = { type: "poigneeB" }; K.racine.classList.add("pl-glisse"); return; }
      var e = elDe(ev.target);
      if (e) {
        var deja = estSel(e.id), mod = ev.ctrlKey || ev.metaKey ? "ajout" : ev.shiftKey ? "plage" : "";
        choisir(e.id, mod || (deja ? "devant" : ""));
        var mob = estSel(e.id) ? libres() : [];
        geste = { type: "el", el: e.id, ids: mob.map(function (q) { return q.id; }), z0: mob.map(function (q) { return q.z; }), ref: e.z, dz: e.z - Z(p.x), zp: Z(p.x), zv: Z(p.x),
          x0: ev.clientX, y0: ev.clientY, bouge: false, hors: false, hClic: HdeY(p.y), reduire: deja && !mod && sels().length > 1 };
      } else geste = { type: "fond", x0: ev.clientX, y0: ev.clientY, bouge: false, px0: p.x, zc: cam.zc, py0: p.y, hc: cam.hc || 0 };
      K.racine.classList.add("pl-glisse");
    });
    function nomsSel(n, un) { return n > 1 ? TRAD("{0} pièces", [n]) : un; }
    // Pièce que viserait un lâcher-remplacer en x (pixels du dessin) : la plus proche à moins de 12 px, hors `sauf` et hors
    // une pièce identique (la remplacer par elle-même ne change rien).
    function cibleRemplacer(px, sauf, cle) {
      var best = null, dmin = 12;
      st.elements.forEach(function (q) { var dd = Math.abs(X(q.z) - px); if (q.id !== sauf && q.cle !== cle && !q.verrou && dd < dmin) { dmin = dd; best = q; } });
      return best;
    }
    var FACE_BOUGE = false;
    function surMove(ev) {
      if (!geste || geste.type === "pose") return;      // carte de l'étagère : glissePose, appelé par la coque
      if (geste.type === "face") {
        var fe = trouver(st, geste.el); if (!fe) return;
        if (!geste.bouge && Math.hypot(ev.clientX - geste.x0, ev.clientY - geste.y0) < 3) return;
        geste.bouge = FACE_BOUGE = true;
        var fm = (ev.shiftKey ? ((ev.ctrlKey || ev.metaKey) ? 0.01 : 0.1) : 1) / (geste.k * geste.r);
        fixerDec(fe, "x", geste.dx + (ev.clientX - geste.x0) * fm); fixerDec(fe, "y", geste.dy - (ev.clientY - geste.y0) * fm);
        K.texteGeste(TRAD("<b>{0}</b> décentrée : côté {1} mm · hauteur {2} mm", [K.esc(nomP(fe)), fmt(fe.x || 0, 2), fmt(fe.y || 0, 2)]) + (ev.shiftKey ? ((ev.ctrlKey || ev.metaKey) ? TRAD(" · ultrafin") : TRAD(" · fin")) : TRAD(" · Maj : fin · Ctrl+Maj : ultrafin")));
        modifie("dessin"); return;
      }
      var p = K.ptSvg(ev), e;
      if (geste.type === "cadre") {
        geste.x1 = p.x; geste.y1 = p.y;
        gCadre.innerHTML = '<rect x="' + pf(Math.min(geste.x0, p.x)) + '" y="' + pf(Math.min(geste.y0, p.y)) + '" width="' + pf(Math.abs(p.x - geste.x0)) + '" height="' + pf(Math.abs(p.y - geste.y0)) +
          '" fill="rgba(224,184,76,.08)" stroke="#e0b84c" stroke-dasharray="4 3"/>';
        return;
      }
      if (geste.type !== "poignee" && geste.type !== "poigneeB" && !geste.bouge) {
        if (Math.hypot(ev.clientX - geste.x0, ev.clientY - geste.y0) < 4) return;
        geste.bouge = true;
      }
      if (geste.type === "el") {
        if (!geste.ids.length) { K.texteGeste(TRAD("<b>Verrouillée</b> — elle ne bouge pas · {0} : la déverrouiller", [k_("L")])); majL3(); return; }
        var lo = Math.min.apply(null, geste.z0), hi = Math.max.apply(null, geste.z0);
        // Démultiplié : le pointeur virtuel zv n'avance que de 1/10 (Maj) ou 1/100 (Ctrl+Maj) du mouvement réel, arrondi
        // au pas du mode ; relâcher Maj reprend le 1:1 depuis là où la pièce est (pas de saut vers le pointeur).
        var zr = Z(p.x), fz = ev.shiftKey ? ((ev.ctrlKey || ev.metaKey) ? 0.01 : 0.1) : 1; geste.zv += (zr - geste.zp) * fz; geste.zp = zr;
        var dz = clamp(arrondi(geste.zv + geste.dz, ev.shiftKey ? ((ev.ctrlKey || ev.metaKey) ? 0.01 : 0.1) : 1) - geste.ref, -lo, LONGUEUR - hi);
        geste.ids.forEach(function (id, i) { var q = trouver(st, id); if (q) deplacer(q, arrondi(geste.z0[i] + dz, 0.01)); });
        geste.hors = p.y > H;
        var un = trouver(st, geste.el), n = geste.ids.length;
        K.texteGeste(geste.hors ? TRAD("Lâcher : <b>ranger</b> {0}", [n > 1 ? TRAD("les {0} pièces", [n]) : TRAD("la pièce")])
          : "<b>" + nomsSel(n, un ? K.esc(nomP(un)) : "") + "</b>" + (BAC.clair && un ? " · " + cm(un.z) : "") + (ev.shiftKey ? ((ev.ctrlKey || ev.metaKey) ? TRAD(" · ultrafin, au 0,01 mm") : TRAD(" · fin, au 0,1 mm")) : TRAD(" · Maj : fin · Ctrl+Maj : ultrafin")) + TRAD(" · sous le banc : ranger"));
        modifie("seq"); majBandeau();
      } else if (geste.type === "fond") {          // zoomé : glisser le fond = se déplacer le long du banc
        if (cam.k <= 1 && !cam.dil) return;
        cam.zc = clamp(geste.zc - (p.x - geste.px0) / sx, 0, LONGUEUR); cam.pres = false; cam.mont = false;
        if (cam.dil) cam.hc = clamp(geste.hc + (p.y - geste.py0) / sy, -150, 150);      // cadré en hauteur : aussi de haut en bas
        modifie("dessin");
      } else if (geste.type === "poigneeB") {
        if (fixerB(HdeY(p.y))) modifie("dessin");
      } else if (geste.type === "poignee") {
        var dep = departPinceau(SEQ, axe(), 0, hAutre(st.pinceau, axe()));
        if (!dep || !dep.objet) return;
        var m = ETENDUE[dep.objet.type] ? ETENDUE[dep.objet.type][axe()] : 0;
        fixerSurAxe(clamp(arrondi(HdeY(p.y) - dep.p[axe()], 0.5), -m, m));
        modifie("dessin");
      }
    }
    function surUp(ev) {
      if (!geste || geste.type === "pose") return;
      var g = geste, e; geste = null; K.racine.classList.remove("pl-glisse"); K.texteGeste(null);
      if (g.type === "face") { if (!g.bouge) FACE_BOUGE = false; modifie("dessin"); return; }
      if (g.type === "cadre") { gCadre.innerHTML = ""; if (Math.abs(g.x1 - g.x0) > 6) cadrerBanc(g.x0, g.x1, g.y0, g.y1); return; }
      if (g.type === "el") {
        e = trouver(st, g.el);
        if (g.hors && g.ids.length) { g.ids.forEach(function (id) { ranger(st, id); }); modifie("seq etagere bandeau dessin"); return; }
        if (!g.bouge && g.reduire) choisir(g.el);
        // un clic (sans glisser) sur l'objet, pinceau affiché : le pinceau part de la hauteur cliquée
        if (e && !g.bouge && (st.aides.pinceau || st.aides.spot) && SEQ && SEQ.objet >= 0 && SEQ.prims[SEQ.objet].el === e.id && ETENDUE[e.type]) {
          var m = ETENDUE[e.type][axe()];
          fixerSurAxe(clamp(arrondi(g.hClic - dec(e), 0.5), -m, m));
        } else if (e && !g.bouge && st.aides.construction && SEQ && SEQ.objet >= 0 && SEQ.prims[SEQ.objet].el === e.id) fixerB(g.hClic);   // pinceau éteint : le clic choisit B
        modifie("dessin");
      } else if (g.type === "fond") {
        if (!g.bouge && st.sel) { choisir(null); modifie("dessin bandeau"); }
      }
    }
    // Glisser une carte de l'étagère (l'étagère de la coque mène le geste : seuil, fantôme, ligne des gestes) : la pièce
    // est posée dès qu'on entre sur le banc et suit le pointeur ; lâchée SUR une pièce, elle la remplacera ; ressortie,
    // elle est rangée. `geste` (type "pose") dit au reste du banc qu'un glisser est en cours (faisceau allégé…).
    function debutPose(cle, ev) { geste = { type: "pose", cle: cle, el: null, x0: ev.clientX, y0: ev.clientY, bouge: false }; }
    function glissePose(cle, ev) {
      if (!geste || geste.type !== "pose") return null;
      geste.bouge = true;
      var p = K.ptSvg(ev), e;
      var dedans = p.y >= 0 && p.y < H && p.x > 0 && p.x < W;
      e = geste.el ? trouver(st, geste.el) : null;
      var cib = dedans ? cibleRemplacer(p.x, geste.el, geste.cle) : null;
      if (cib) {          // lâchée SUR une pièce : elle la remplacera (la pièce en essai est retirée, la visée éclairée)
        if (e) { ranger(st, e.id); geste.el = null; sale.bandeau = sale.etagere = true; modifie("seq"); }
        if (REMPL !== cib.id) { REMPL = cib.id; sale.dessin = true; }
        var tx = TRAD("Lâcher : <b>remplacer {0}</b> par {1} (même position", [K.esc(nomDe(cib)), K.esc(PIECES[geste.cle].court)]) + (DECALABLE[cib.type] || cib.x || cib.y ? TRAD(", même décalage") : "") + ")";
        K.modifie(); return { fantome: true, texte: tx };
      }
      if (REMPL) { REMPL = null; sale.dessin = true; }
      if (dedans && !e) { e = poser(st, geste.cle, 0); geste.el = e.id; choisir(e.id); sale.etagere = true; }
      if (!dedans && e) { ranger(st, e.id); geste.el = null; sale.bandeau = sale.etagere = true; }
      if (dedans && e) deplacer(e, arrondi(Z(p.x), ev.shiftKey ? 0.1 : 1));
      var texte = dedans ? TRAD("Lâcher : poser {0}", [K.esc(PIECES[geste.cle].court)]) + (BAC.clair && e ? TRAD(" à {0}", [cm(e.z)]) : "") + TRAD(" · lâchée sur une pièce : la remplacer")
        : TRAD("Glisser sur le banc pour poser {0}", [K.esc(PIECES[geste.cle].court)]);
      modifie("seq"); majBandeau();
      return { fantome: !dedans, texte: texte };
    }
    function lachePose(cle, ev, bouge) {
      var g = geste, e; if (!g || g.type !== "pose") return;
      geste = null; g.bouge = bouge;
      var vise = REMPL && trouver(st, REMPL); REMPL = null;
      if (vise && ev && ev.type !== "pointercancel") { remplacerA(vise, g.cle); return; }
      if (!g.bouge && compte(st, g.cle) < PIECES[g.cle].max) { e = poserPiece(g.cle); choisir(e.id); voir(e); }
      else if (g.bouge && g.el && trouver(st, g.el)) remplacerSource(trouver(st, g.el));
      if (ev && ev.type === "pointercancel" && g.el) ranger(st, g.el);
      modifie("seq etagere bandeau dessin");
    }
    // Remplacer une pièce par une autre (lâcher-remplacer, menu) ; une source garde la règle « une seule source ».
    function remplacerA(vieux, cle) {
      var e = remplacerPiece(st, vieux.id, cle); if (!e) return;
      remplacerSource(e); choisir(e.id);
      modifie("seq etagere bandeau dessin tete");
    }
    // ----- clic droit sur le banc : menu de la pièce, ou du rail et du fond -----
    function sousPointeur(px) { return st.elements.filter(function (q) { return Math.abs(X(q.z) - px) < 16; }).sort(function (a, b) { return a.z - b.z; }); }
    function plein(cle) { return compte(st, cle) >= PIECES[cle].max; }
    function poserA(cle, z) {
      var e = poser(st, cle, clamp(arrondi(z, 1), 0, LONGUEUR));
      remplacerSource(e); choisir(e.id); modifie("seq etagere bandeau dessin");
    }
    function menuPiece(e, sous) {
      var L = [], multi = sels().length > 1 && estSel(e.id);
      if (sous.length > 1) {      // pièces collées : laquelle choisir
        L.push({ tit: TRAD("Pièces sous le pointeur") });
        sous.forEach(function (q) { L.push({ lab: nomP(q) + (BAC.clair ? " · " + cm(q.z) : ""), coche: q.id === e.id, act: function () { choisir(q.id); modifie("dessin bandeau"); } }); });
        L.push({ sep: 1 });
      }
      // Remplacer par : les pièces du même tiroir d'abord, puis les autres tiroirs en sous-menus (celles du profil)
      var TS = tiroirs(), mien = TS.filter(function (T) { return T.pieces.indexOf(e.cle) >= 0; })[0];
      function par(T) { return T.pieces.filter(function (c) { return c !== e.cle; }).map(function (c) { return { lab: PIECES[c].nom, dis: plein(c), act: function () { remplacerA(e, c); } }; }); }
      var sub = mien ? par(mien) : [];
      TS.forEach(function (T) { if (T !== mien) { var r = par(T); if (r.length) sub.push({ lab: TIROIR_LONG[T.nom] || T.nom, sub: r }); } });
      L.push({ lab: TRAD("Remplacer par"), sub: sub, dis: !!e.verrou });
      L.push({ lab: TRAD("Position…"), k: TRAD("clic sur le nombre"), dis: !positionsVues() || !!e.verrou, act: function () { choisir(e.id); taperPosition(); } });
      L.push({ lab: e.esc ? TRAD("Rabaisser") : TRAD("Escamoter"), k: "E", act: function () { if (!multi) choisir(e.id); escamoter(); } });
      L.push({ lab: e.verrou ? TRAD("Déverrouiller") : TRAD("Verrouiller"), k: "L", act: function () { if (!multi) choisir(e.id); verrouiller(); } });
      L.push({ lab: TRAD("De près"), k: "double-clic", act: function () { choisir(e.id); dePres(); } });
      if (decentrable(e)) L.push({ lab: TRAD("Recentrer"), dis: !(e.x || e.y) || !!e.verrou, act: function () { recentrer(e); } });
      L.push({ sep: 1 }, { lab: multi ? TRAD("Ranger les {0} pièces", [sels().length]) : TRAD("Ranger"), k: TRAD("Suppr"), dis: !libres().length, act: function () { if (!multi) choisir(e.id); rangerSel(); } });
      return L;
    }
    function menuFond(z) {
      var sub = tiroirs().map(function (T) { return { lab: TIROIR_LONG[T.nom] || T.nom, sub: T.pieces.map(function (c) { return { lab: PIECES[c].nom, dis: plein(c), act: function () { poserA(c, z); } }; }) }; });
      return [{ lab: TRAD("Poser ici") + (positionsVues() ? " (" + cm(arrondi(z, 1)) + ")" : ""), sub: sub },
        { lab: TRAD("Tout le banc"), k: TRAD("double-clic · 0"), act: function () { vueEnsemble(); modifie("dessin"); } },
        { lab: TRAD("Montage"), act: function () { vueMontage(); modifie("dessin"); } },
        { lab: TRAD("Cadrer…"), act: function () { armerCadre("banc"); } }];
    }
    D.addEventListener("contextmenu", function (ev) {
      ev.preventDefault();
      if (geste) return;
      var p = K.ptSvg(ev), e = elDe(ev.target);
      if (e) { if (!estSel(e.id)) choisir(e.id); modifie("dessin bandeau"); ouvrirCtx(ev.clientX, ev.clientY, menuPiece(e, sousPointeur(p.x))); }
      else ouvrirCtx(ev.clientX, ev.clientY, menuFond(clamp(Z(p.x), 0, LONGUEUR)));
    });
    root.addEventListener("pointermove", surMove);
    root.addEventListener("pointerup", surUp);
    root.addEventListener("pointercancel", surUp);
    // Double-clic : sur une pièce, De près ; sur le fond, tout le banc.
    D.addEventListener("dblclick", function (ev) {
      if (CADRE || (ev.target.closest && ev.target.closest(".bc-vis, .bc-mini, .bc-poignee, .bc-poigneeB"))) return;
      var e = elDe(ev.target);
      if (e) { choisir(e.id); dePres(); }
      else { vueEnsemble(); modifie("dessin"); }
    });
    // ----- molette : celle de la coque (`K.cibleMolette` : pas accumulés, cible figée
    // 0,4 s) ; aucun écouteur de molette dans l'instrument. Le banc couvre tout ce qu'il dessine (« sel » partout sur le
    // banc) : les zones et vis de la coque ne sont jamais atteintes. Maj : fin ; Ctrl+Maj : ultrafin ; Ctrl : gros.
    function cibleMolette(t) {
      if (!t || !t.closest) return null;
      if (st.barr.on && t.closest(".bc-barr, .bc-barr-p")) return { zone: "barrette" };      // la barrette (corps ou poignée) : elle tourne ; ailleurs sur l'image, la molette zoome
      if (cvWrap.contains(t)) return DET ? { zone: "image" } : { zone: "rien" };
      var pl = t.closest(".bc-platine"); if (pl && BD.contains(pl)) return { zone: "platine", id: st.sel };
      var rg = t.closest(".bc-reg"), inp = rg && rg.querySelector("input[type=range]"), hote = BD.contains(t) ? BD : K.obsPied.contains(t) ? K.obsPied : GR.ctl.contains(t) ? GR.ctl : null;
      if (inp && hote) return { zone: "curseur", el: inp, hote: hote, i: Array.prototype.indexOf.call(hote.querySelectorAll("input[type=range]"), inp) };
      if (!SC.contains(t)) return null;
      var v = t.closest(".bc-vis"), e;
      if (v && (e = elDe(v))) return { zone: "vis", id: e.id, axe: v.getAttribute("data-axe") || "x" };
      return { zone: "sel" };      // la miniature d'une pièce qui a un réglage : pastille de la coque (K.pastilles, plus bas)
    }
    function fois(ev, fin, normal, gros) { return ev.shiftKey ? ((ev.ctrlKey || ev.metaKey) ? fin / 10 : fin) : ev.ctrlKey ? gros : normal; }      // Ctrl+Maj : ultrafin
    function appliquerMolette(c, k, ev) {
      var e;
      if (c.zone === "sel") bougerSel(k * fois(ev, 0.1, 1, 10));
      else if (c.zone === "barrette") {      // 5° par cran, Maj 1°, Ctrl+Maj 0,1°, Ctrl 15° (comme au Michelson : vers le haut = sens des aiguilles d'une montre)
        st.barr.ang = Math.round(((st.barr.ang - k * fois(ev, 1, 5, 15)) % 360 + 360) % 360 * 10) / 10;
        modifie("barr"); if (ANG) ANG.sync();
      }
      else if (c.zone === "vis" || c.zone === "platine") { if ((e = trouver(st, c.id))) decaler(e, k * fois(ev, 0.01, 0.1, 1), c.axe); }
      else if (c.zone === "mini") {
        if (!(e = trouver(st, c.id))) return;
        var n = Math.abs(k) * (ev.ctrlKey && !ev.shiftKey ? 5 : 1), ok = false;
        for (var i = 0; i < n; i++) ok = regler(e, k > 0 ? 1 : -1, finesse(ev)) || ok;
        if (ok) modifie("seq bandeau");
      } else if (c.zone === "curseur") {
        var r = c.el.isConnected ? c.el : c.hote.querySelectorAll("input[type=range]")[c.i];      // bandeau refait pendant la rafale
        if (!r) return;
        r.value = +r.value + k * +r.step * fois(ev, 1, 2, 10);
        r.dispatchEvent(new root.Event("input", { bubbles: true }));
      }
    }
    // Miniature d'une pièce qui a un réglage = pastille réglable de la coque :
    // molette ET glisser vertical règlent (`regler`, comme ↑ ↓), un clic choisit la pièce ; une miniature sans réglage
    // (lentille, lettre F…) reste une partie de la pièce, qu'on déplace en la glissant.
    K.pastilles(function (t) {
      var m = t && t.closest ? t.closest(".bc-mini.regl") : null, e;
      if (!m || !SC.contains(m) || !(e = elDe(m))) return null;
      var id = e.id;
      return { regler: function (k, ev) { appliquerMolette({ zone: "mini", id: id }, k, ev); },
        clic: function (ev) { if (!trouver(st, id)) return; choisir(id, ev.ctrlKey || ev.metaKey ? "ajout" : ev.shiftKey ? "plage" : ""); modifie("dessin bandeau"); } };
    });
    // Zooms à la molette : gestionnaires stables et `fige: false` (la coque re-résout la cible à chaque événement : le
    // zoom ne vaut que tant que le pointeur est sur l'image — sinon il continuerait 1 s après avoir quitté le survol).
    var MOL_IMG_V = { continu: function (p, ev) { zoomer(p, ev); }, fige: false },
      MOL_IMG_C = function (k, ev) { zoomer(k, ev); };      // capteur : un cran de N par pas
    MOL_IMG_C.fige = false;
    K.cibleMolette(function (t) {
      var c = cibleMolette(t);
      if (!c) return null;
      if (c.zone === "rien") return function () {};
      // image : zoom proportionnel au défilement ; capteur : un cran de N par pas
      if (c.zone === "image") return DET !== "capteur" ? MOL_IMG_V : MOL_IMG_C;
      return function (k, ev) { appliquerMolette(c, k, ev); };
    });
    // Clavier sur toute la page tant que la paillasse est ouverte (la pièce se choisit aussi dans l'étagère ou le bandeau,
    // qui gardent le focus), sauf dans un champ ou sur un curseur (cahier, réglages : leurs flèches leur appartiennent).
    function surClavier(ev) {
      var e = selEl(), d = { ArrowLeft: -1, ArrowRight: 1 }[ev.key], t = ev.target, tag = t && t.tagName;
      if (!K.racine.isConnected || ev.altKey || ev.metaKey) return;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable)) return;
      // une lettre par aide (rappelée sur son bouton), « ? » : le panneau des raccourcis ; jamais avec Ctrl (Ctrl+C…)
      var lettre = !ev.ctrlKey && ev.key && ev.key.length === 1 ? ev.key.toLowerCase() : "";
      if (lettre === "?") { panneauRaccourcis(); ev.preventDefault(); ev.stopPropagation(); return; }
      if (LETTRES[lettre]) { basculerAide(LETTRES[lettre]); ev.preventDefault(); ev.stopPropagation(); return; }
      if (lettre === "a" || lettre === "b") { basculerBanc(lettre.toUpperCase()); ev.preventDefault(); ev.stopPropagation(); return; }
      if (lettre === "v") { st.vue = st.vue === "dessus" ? "profil" : "dessus"; modifie("dessin"); BOUT.vue.maj(); ev.preventDefault(); ev.stopPropagation(); return; }
      if (lettre === "+" || lettre === "=" || lettre === "-" || lettre === "0") {
        if (lettre === "0") { vueEnsemble(); modifie("dessin"); } else zoomerBanc(lettre === "-" ? 0.5 : 2);
        ev.preventDefault(); ev.stopPropagation(); return;
      }
      // Tab / Maj+Tab : pièce voisine le long du banc (pièces collées) ; sur un bouton ou un champ, Tab garde son rôle
      if (ev.key === "Tab" && !ev.ctrlKey && st.elements.length && (t === D || !t || !t.closest || !t.closest("button, a, [tabindex], label"))) { voisine(ev.shiftKey ? -1 : 1); ev.preventDefault(); ev.stopPropagation(); return; }
      if (!e) return;
      if (lettre === "e" && !ev.ctrlKey) escamoter();
      else if (lettre === "l" && !ev.ctrlKey) verrouiller();
      else if (ev.key === "Delete" || ev.key === "Backspace") rangerSel();
      else if (ev.key === "ArrowUp" || ev.key === "ArrowDown") {        // réglage principal, comme la molette sur sa miniature
        var nr = ev.ctrlKey && !ev.shiftKey ? 5 : 1, okr = false;
        for (var ir = 0; ir < nr; ir++) okr = regler(e, ev.key === "ArrowUp" ? 1 : -1, finesse(ev)) || okr;
        if (okr) modifie("seq bandeau");
      }
      else if (ev.key === "Escape") { choisir(null); modifie("dessin bandeau"); }
      else if (d) bougerSel(d * fois(ev, 0.1, 1, 10));
      else return;
      ev.preventDefault(); ev.stopPropagation();
    }
    root.addEventListener("keydown", surClavier);
    // Pièce voisine le long du banc (ordre des positions) ; De près suit la pièce, sinon on recadre si elle sort du cadre.
    function voisine(sens) {
      var L = st.elements.slice().sort(function (a, b) { return a.z - b.z || (a.id < b.id ? -1 : 1); }), e = selEl(), i = e ? L.indexOf(e) : -1;
      var q = L[i < 0 ? (sens > 0 ? 0 : L.length - 1) : (i + sens + L.length) % L.length];
      if (!q) return;
      choisir(q.id);
      if (cam.pres) dePres(); else voir(q);
      modifie("dessin bandeau");
    }

    // ================= sous le banc : bandeau de la pièce choisie, étagère =================
    var B = K.boite; B.classList.add("bc-bas");
    // Rangée des tiroirs : à gauche Montages, Nouveau banc et le matériel (RGG, remplie
    // avec la barre du haut), puis les onglets des tiroirs.
    // Étagère = celle de la coque (K.etagere, dans le flux) : onglets = tiroirs, cartes = pièces ; glisser une carte :
    // debutPose / glissePose / lachePose.
    var BD = el("div", "bc-bandeau", B), ETG = K.etagere(B, { onglets: ongletsEtagere, defaut: function () { return BAC.ouvert; },
      cartes: cartesEtagere, debut: debutPose, glisse: glissePose, lache: lachePose, clic: clicCarte }), RG = ETG.rangee, RGG = ETG.gauche;
    K.loupe.setAttribute("hidden", ""); K.lecture.setAttribute("hidden", ""); K.aide.setAttribute("hidden", "");
    // Figure de profil : l'inclinaison d'une lentille ne se voit pas de dessus (elle tourne dans le plan vertical).
    // Écran qui observe : f.fen = [bas, haut] de la zone affichée (mm, le long de l'axe dessiné, depuis le centre de la
    // pièce), seulement si elle n'en couvre pas toute la hauteur (pas sur le capteur) ; capteur : f.demi = sa demi-hauteur vraie
    // (3,2 × 2,4 mm : y en profil, x de dessus). La fenêtre est recalculée ici : FEN ne l'est qu'après le dessin du banc.
    function figureVue(e) {
      var f = Dessin.figure(neutre(e, P())), ax = axe();
      if (st.vue !== "profil") f.incl = 0;
      if (f.genre === "capteur") f.demi = ax ? 2.4 : 3.2;
      var det = SEQ && SEQ.detEl && SEQ.detEl.id === e.id ? detecteur(SEQ, st) : null;
      if (det === "ecran") {
        var fw = fenetre(st, det), c = ax ? fw.cy : fw.cx, plein = 100;
        if (fw.W < 0.99 * plein) f.fen = [Math.max(c - fw.W, -plein), Math.min(c + fw.W, plein)];
      }
      return f;
    }
    function figurePiece(cle) { var P = PIECES[cle]; return Dessin.figure({ type: P.type, params: P.params || {} }); }

    var bdPos = null, bdPlatine = null;
    function majBandeau() { var e = selEl(); if (e && bdPos) bdPos.textContent = cm(e.z); }
    // L'œil posé qui observe : ses réglages vont sous l'observation (bloc de l'œil), qu'il soit choisi ou non.
    function oeilObserve(e) { return !!(SEQ && SEQ.detEl && !SEQ.implicite && SEQ.detEl.type === "oeil" && (!e || SEQ.detEl.id === e.id)); }
    // Réglages de l'œil : type, mise au point automatique ou à la main ; quoi = ce qu'un changement redessine.
    function texteVise(e) {
      var p = C.params(e), vz = SEQ && SEQ.detEl && SEQ.detEl.id === e.id ? visee(SEQ, e) : null, am = amplitude(p.type);
      if (!vz) return "";
      var sur = vz.quoi === "reticule" ? TRAD("le réticule") : vz.quoi === "source" ? TRAD("la source") : "l'objet";
      return vz.P > am[0] + am[1] + 0.05 ? TRAD("{0} : trop près pour être vu net", [sur]) : vz.P < am[0] - 0.05 ? TRAD("{0} : trop loin pour être vu net", [sur]) : TRAD("sur {0}, {1}", [sur, netA(e)]);
    }
    function netA(e) { var d = distanceNette(C.params(e)); return d === Infinity ? TRAD("net à l'infini") : d >= 1000 ? TRAD("net à {0} m", [fmt(d / 1000, 2)]) : TRAD("net à {0} cm", [fmt(d / 10, 1)]); }
    function reglagesOeil(host, e, quoi) {
      var p = C.params(e);
      seg(host, YEUX.map(function (y) { return [y[0], y[1]]; }), p.type, function (v) { e.params.type = v; e.params.acc = clamp(C.params(e).acc || 0, 0, amplitude(v)[1]); modifie("seq " + quoi); });
      var rm = el("span", "bc-reg", host); el("span", "", rm, TRAD("Mise au point"));
      seg(rm, [["objet", TRAD("automatique"), TRAD("L'œil met au point de lui-même sur ce qu'il regarde, comme en vrai.")], ["curseur", TRAD("à la main"), TRAD("Régler soi-même l'accommodation.")]], p.mode === "objet" ? "objet" : "curseur",
        function (v) { if (v === "curseur") e.params.acc = clamp(puissance(C.params(e)) - amplitude(C.params(e).type)[0], 0, amplitude(C.params(e).type)[1]); e.params.mode = v; modifie("seq " + quoi); });
      if (p.mode === "objet") {
        var vs = el("span", "bc-reg bc-vise", host, texteVise(e));
        vs.title = TRAD("Ce que l'œil regarde, et la distance à laquelle il le voit (l'image que lui en donnent les lentilles).");
        return vs;
      } else curseur(host, "Accommodation", 0, amplitude(p.type)[1], 0.05, function () { return C.params(e).acc || 0; }, function (v) { e.params.acc = v; }, function () { return netA(e); })
        .title = TRAD("L'œil au repos voit net au plus loin ; en accommodant, il voit net de plus en plus près.");
    }
    // Réglette de platine (décalage latéral) : glissière ±10 mm graduée au mm, repère de l'axe au milieu, la miniature
    // de la pièce en curseur ; molette dessus 0,1 mm (Maj : 0,01 ; Ctrl+Maj : 0,001 ; Ctrl : 1), glisser le curseur, − et + aux bouts. Composant prévu
    // pour la hauteur le jour où elle revient.
    function platine(host, e) {
      var w = el("span", "bc-platine", host), Wd = 150, m = 12, kx = (Wd - 2 * m) / (2 * DEC_MAX);
      function xv(v) { return Wd / 2 + v * kx; }
      el("span", "", w, TRAD("Décalage"));
      var bm = K.bouton(w, "−", function (ev) { decaler(e, -fois(ev, 0.01, 0.1, 1)); }); bm.title = TRAD("Vers la gauche, vu depuis la source (Maj : 0,01 mm ; Ctrl+Maj : 1 µm ; Ctrl : 1 mm).");
      var sv = svg("svg", { viewBox: "0 0 " + Wd + " 30", "aria-hidden": "true" }, w);
      var bp = K.bouton(w, "+", function (ev) { decaler(e, fois(ev, 0.01, 0.1, 1)); }); bp.title = TRAD("Vers la droite (Maj : 0,01 mm ; Ctrl+Maj : 1 µm ; Ctrl : 1 mm).");
      var out = el("output", "", w);
      function rendu() {
        var s = '<rect x="' + (m - 4) + '" y="17" width="' + (Wd - 2 * m + 8) + '" height="6" rx="3" fill="#1b2027" stroke="#3a424d" stroke-width=".7"/>', v;
        for (v = -DEC_MAX; v <= DEC_MAX; v++) s += '<path d="M' + pf(xv(v)) + " " + (v % 5 ? 25 : 24) + "v" + (v % 5 ? 2.5 : 4.5) + '" stroke="' + (v ? "#566070" : "#e0b84c") + '" stroke-width="' + (v ? 0.7 : 1.3) + '"/>';
        s += '<path d="M' + pf(xv(0)) + ' 13v14" stroke="#e0b84c" stroke-width="1" stroke-dasharray="2 1.5"/>';
        var x = xv(e.x || 0);
        s += '<g transform="translate(' + pf(x - 9) + ' 1) scale(.45)">' + Dessin.miniature(Dessin.figure(e)) + '</g><path d="M' + pf(x) + ' 19.5l-3.2 4.5h6.4z" fill="#f3dc9a"/>';
        sv.innerHTML = s;
        out.textContent = Math.abs(e.x || 0) < 0.005 ? TRAD("sur l'axe") : fmt(e.x, 2) + " mm";
      }
      var g = false;
      function viserP(ev) { var R = sv.getBoundingClientRect(), v = ((ev.clientX - R.left) * Wd / (R.width || Wd) - Wd / 2) / kx; fixerDec(e, "x", Math.round(v * 10) / 10); rendu(); }
      sv.addEventListener("pointerdown", function (ev) { g = true; try { sv.setPointerCapture(ev.pointerId); } catch (e9) {} viserP(ev); });
      sv.addEventListener("pointermove", function (ev) { if (g) viserP(ev); });
      sv.addEventListener("pointerup", function () { g = false; });
      w.title = TRAD("Décalage latéral de la pièce (platine de translation) ; aussi à la molette sur la vis du cavalier, vue de dessus.");
      rendu(); bdPlatine = rendu;
    }
    // Liste déroulante libellée (temps d'intégration, calibre) : f(indice) ; rend le <select>.
    function selListe(host, lab, noms, actif, f, titre) {
      var w = el("label", "bc-cur", host); el("span", "bc-cur-l", w, lab);
      var s = el("select", "bc-sel", w);
      noms.forEach(function (n, i) { var o = el("option", "", s, n); o.value = String(i); });
      s.value = String(actif); if (titre) w.title = titre;
      s.addEventListener("change", function () { f(parseInt(s.value, 10)); });
      return s;
    }
    // curseur de la coque ; chaque réglage refait la séquence
    // `zero` (inclinaisons, orientations, bord du couteau) : double-clic = retour à cette valeur (coque).
    function curseur(host, lab, min, max, pas, get, set, f, zero) { return K.curseur(host, lab, min, max, pas, get, set, f, function () { modifie("seq"); }, zero); }
    // Position en clair (Révisions) quand le profil la montre ; un clic dessus : la taper (en cm ; Entrée valide, Échap annule).
    function positionsVues() { return !!(BAC.clair && P().positions); }
    function taperPosition() { if (!positionsVues() || !selEl() || selEl().verrou) return; TAPE = { val: fmt(selEl().z / 10, 1) }; dessinerBandeau(); }
    function taperDec(ax) { var e = selEl(); if (!e || e.verrou) return; TAPE = { ax: ax, val: fmt(e[ax] || 0, 2) }; dessinerBandeau(); }
    function lireNb(t) { var v = parseFloat(String(t).replace(",", ".").replace("−", "-").replace(/\s|cm/g, "")); return isFinite(v) ? v : null; }
    function validerPosition() {
      var e = selEl(), v = TAPE ? lireNb(TAPE.val) : null, ax = TAPE && TAPE.ax; TAPE = null;
      if (e && v != null && ax) fixerDec(e, ax, v);
      else if (e && v != null && !e.verrou) { deplacer(e, arrondi(10 * v, 0.1)); modifie("seq"); }
      sale.bandeau = true; K.modifie();
    }
    function annulerPosition() { TAPE = null; sale.bandeau = true; K.modifie(); }
    // Champ de saisie du bandeau (position, décentrement) : Entrée valide, Échap ou sortie du champ annule.
    function champTape(host, lab) {
      var i = el("input", "bc-bd-tape", host); i.type = "text"; i.value = TAPE.val; i.setAttribute("aria-label", lab);
      i.setAttribute("data-a3", TRAD("<b>{0}</b> — {1} : valider · {2} : annuler", [lab, k_(TRAD("Entrée")), k_(TRAD("Échap"))]));
      i.addEventListener("input", function () { if (TAPE) TAPE.val = i.value; });
      i.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); validerPosition(); } });
      i.addEventListener("blur", function () { if (TAPE) annulerPosition(); });
      setTimeout(function () { if (i.isConnected) { try { i.focus(); i.select(); } catch (e1) {} } }, 0);
      return i;
    }
    // Décentrement (niveau 3) : les deux valeurs (clic : les taper, en mm), Recentrer ; la vue de face et les vis aussi.
    function decentrement(host, e) {
      var w = el("span", "bc-reg bc-dec", host), vals = {}; el("span", "", w, TRAD("Décentrement"));
      [["x", TRAD("côté")], ["y", TRAD("hauteur")]].forEach(function (q) {
        el("span", "bc-dec-l", w, q[1]);
        if (TAPE && TAPE.ax === q[0]) { champTape(w, TRAD("Décentrement, {0} (mm)", [q[1]])).style.width = "4.5em"; return; }
        var b = vals[q[0]] = el("b", "bc-bd-n", w, fmt(e[q[0]] || 0, Math.abs((e[q[0]] || 0) * 100 - Math.round((e[q[0]] || 0) * 100)) < 1e-6 ? 2 : 3) + " mm");
        b.setAttribute("data-a3", e.verrou ? TRAD("<b>Décentrement</b> — pièce verrouillée")
          : TRAD("<b>Décentrement, {0}</b> — clic : le taper (mm, ±{1}) · aussi : glisser la pièce dans sa vue de face, molette sur la vis {2}",
            [q[1], DEC_MAX, q[0] === "y" ? TRAD("de la tige (vue de profil)") : TRAD("du cavalier (vue de dessus)")]));
        if (!e.verrou) b.addEventListener("click", function () { taperDec(q[0]); });
      });
      var rc = K.bouton(w, TRAD("Recentrer"), function () { recentrer(e); }, "pl-btn-p"); rc.disabled = !(e.x || e.y) || !!e.verrou;
      rc.setAttribute("data-a3", TRAD("<b>Recentrer</b> — la pièce revient sur l'axe du banc"));
      bdPlatine = function () { Object.keys(vals).forEach(function (a) { vals[a].textContent = fmt(e[a] || 0, 2) + " mm"; }); rc.disabled = !(e.x || e.y) || !!e.verrou; };
    }
    function flechesPos(pos, multi) {
      var bloque = !multi && selEl() && selEl().verrou;
      [[-1, "◂", TRAD("1 mm vers la source")], [1, "▸", TRAD("1 mm vers le bout du banc")]].forEach(function (q, k) {
        if (k === 1 && !multi && positionsVues()) {          // entre les flèches : le nombre (clic : le taper), ou le champ
          if (TAPE && !TAPE.ax) {
            champTape(pos, TRAD("Position en cm"));
          } else {
            bdPos = el("b", "bc-bd-n", pos);
            bdPos.setAttribute("data-a3", bloque ? TRAD("<b>Position</b> — pièce verrouillée ({0} : la déverrouiller)", [k_("L")])
          : TRAD("<b>Position</b> — clic : la taper (en cm ; {0} valide, {1} annule)", [k_(TRAD("Entrée")), k_(TRAD("Échap"))]));
            bdPos.addEventListener("click", taperPosition);
          }
        }
        var b = el("button", "", pos, q[1]); b.type = "button"; b.disabled = !!bloque;
        b.setAttribute("data-a3", "<b>" + q[2] + "</b>" + (multi ? TRAD(", toute la sélection") : "") + " · " + k_(q[0] < 0 ? "←" : "→") + " (Maj 0,1 mm · Ctrl+Maj 0,01 mm · Ctrl 1 cm)");
        b.addEventListener("click", function (ev) { bougerSel(q[0] * fois(ev, 0.1, 1, 10)); });
      });
    }
    // Escamoter et verrouiller la sélection (la dernière choisie donne le sens) ; cadenas allumé quand elle est verrouillée.
    function boutonsEscVerrou(e) {
      var be = K.bouton(BD, e.esc ? TRAD("Rabaisser") : TRAD("Escamoter"), escamoter, "pl-btn-p");
      be.setAttribute("data-a3", e.esc ? TRAD("<b>Rabaisser</b> — la pièce revient dans le faisceau · {0}", [k_("E")])
        : TRAD("<b>Escamoter</b> — la pièce reste à sa place, relevée hors du faisceau · {0}", [k_("E")]));
      var bv = K.bouton(BD, CADENAS.replace(' x="-6" y="-6"', "") + (e.verrou ? TRAD(" verrouillée") : ""), verrouiller, "pl-btn-p bc-verrou");
      bv.setAttribute("aria-pressed", e.verrou ? "true" : "false");
      bv.setAttribute("data-a3", "<b>" + (e.verrou ? TRAD("Déverrouiller") : TRAD("Verrouiller")) + "</b>"
        + TRAD(" — verrouillée, la pièce ne bouge plus : ni glisser, ni molette, ni flèches, ni ranger, ni remplacer, ni décentrer ; ses réglages restent libres · {0}", [k_("L")]));
    }
    function dessinerBandeau() {
      BD.innerHTML = ""; bdPos = null; bdPlatine = null;
      var e = selEl(), L = sels();
      if (!e) { TAPE = null; el("span", "bc-vide", BD, TRAD("Cliquer une pièce du banc pour la régler (Ctrl+clic : plusieurs), ou en prendre une dans l'étagère.")); return; }
      if (L.length > 1) {          // plusieurs pièces choisies : on les déplace ou les range d'un bloc ; régler = une seule
        TAPE = null;
        var mn = el("span", "bc-bd-nom bc-bd-multi", BD, TRAD("<b>{0} pièces choisies</b> <i></i>", [L.length]));
        mn.lastChild.textContent = L.slice().sort(function (a, b) { return a.z - b.z; }).map(function (q) { return PIECES[q.cle].court; }).join(" · ");
        flechesPos(el("span", "bc-bd-pos", BD), true);
        el("span", "bc-pousse", BD);
        boutonsEscVerrou(e);
        K.bouton(BD, TRAD("Une seule"), function () { choisir(e.id); modifie("dessin bandeau"); }, "pl-btn-p").setAttribute("data-a3", TRAD("<b>Une seule</b> — ne garder que la dernière choisie ({0}) pour la régler", [K.esc(PIECES[e.cle].court)]));
        K.bouton(BD, TRAD("Ranger les {0}", [L.length]), rangerSel, "pl-btn-p").setAttribute("data-a3", TRAD("<b>Ranger</b> les pièces choisies · {0}", [k_(TRAD("Suppr"))]));
        return;
      }
      var p = C.params(e), PC = PIECES[e.cle];
      var nom = el("span", "bc-bd-nom", BD, Dessin.svgMini(Dessin.figure(e)) + "<span></span>");
      nom.lastChild.textContent = e.type === "lentille" ? TRAD("Lentille {0} {1} mm, Ø {2} mm", [p.f > 0 ? TRAD("convergente") : TRAD("divergente"), signe(p.f), p.D]) : PC.nom;
      nom.title = PC.titre;
      flechesPos(el("span", "bc-bd-pos", BD), false);
      majBandeau();
      if (e.type === "lanterne") {
        var rc = el("span", "bc-reg", BD); el("span", "", rc, TRAD("Condenseur"));
        seg(rc, [["cond", TRAD("oui"), TRAD("Condenseur de {0} mm : il forme une image du filament.", [F_COND])], ["rien", TRAD("non"), TRAD("Filament nu : la lampe éclaire dans toutes les directions.")],
          ["depoli", TRAD("dépoli"), TRAD("Un dépoli devant le filament : source étendue qui éclaire dans toutes les directions.")]], p.cond || "cond", function (v) { e.params.cond = v; modifie("seq bandeau dessin"); });
        curseur(BD, p.cond === "cond" ? TRAD("Tirage du condenseur") : TRAD("Filament derrière la sortie"), TIRAGE[0], TIRAGE[1], 0.5, function () { return C.params(e).tirage; }, function (v) { e.params.tirage = v; }, function (v) { return fmtFin(v, 1) + " mm"; })
          .title = p.cond === "cond" ? TRAD("Distance du filament au condenseur (focale {0} mm) : elle fixe l'endroit où se forme l'image du filament.", [F_COND]) : TRAD("Distance du filament à la sortie de la lanterne.");
      }
      if (e.type === "lanterne") {
        // Forme de la source : le filament spiralé (4 × 2 mm) ou le rectangle uniforme de même taille (source idéale).
        var rs = el("span", "bc-reg", BD); el("span", "", rs, "Source");
        seg(rs, [["filament", "filament", TRAD("Filament spiralé de 4 × 2 mm : l'image de la source montre les spires.")], ["carre", TRAD("idéale"), TRAD("Source idéale : rectangle uniforme de 4 × 2 mm, sans structure.")]],
          p.emet || "filament", function (v) { e.params.emet = v; modifie("seq bandeau dessin"); });
      }
      if (e.type === "iris") curseur(BD, TRAD("Ouverture"), 1, 40, 0.5, function () { return C.params(e).D; }, function (v) { e.params.D = v; }, function (v) { return fmtFin(v, 1) + " mm"; });
      if (e.type === "miroir") curseur(BD, TRAD("Inclinaison"), -INCL_MAX, INCL_MAX, 0.05, function () { return inclinaison(e); }, function (v) { incliner(e, v); }, function (v) { return fmt(v, 2) + "°"; }, 0)
        .title = TRAD("Le miroir bascule vers le haut ou vers le bas : la lumière renvoyée revient plus haut ou plus bas dans le plan de l'objet. Double-clic : retour à 0°.");
      if (e.type === "trouSource") { var r = el("span", "bc-reg", BD); el("span", "", r, TRAD("Diamètre"));
        seg(r, TROUS.map(function (d) { return [d, fmt(d, 1) + " mm"]; }), p.d, function (d) { e.params.d = d; modifie("seq bandeau"); }); }
      if (e.type === "ecran") seg(BD, [[false, TRAD("blanc")], [true, TRAD("quadrillé"), TRAD("Écran quadrillé au centimètre (au millimètre, de près).")]], !!p.quadrille, function (v) { e.params.quadrille = v; modifie("seq bandeau"); });
      if (e.type === "lentille" && P().inclinable) curseur(BD, TRAD("Inclinaison"), -INCL_LENTILLE, INCL_LENTILLE, 0.5, function () { return inclinaison(e); }, function (v) { incliner(e, v); sale.dessin = true; }, function (v) { return fmt(v, 1) + "°"; }, 0)
        .title = TRAD("La lentille bascule autour d'un axe horizontal perpendiculaire au banc : en optique réelle, l'image d'un point devient deux petits traits (astigmatisme) et une virgule (coma). Double-clic : retour à 0°.");
      if (e.type === "lentille" && optq() === "reelle" && p.f > 0 && p.forme !== "objectif") {
        seg(BD, [["bicv", TRAD("biconvexe")], ["pcv", TRAD("plan-convexe")]], p.forme, function (v) { e.params.forme = v; if (v === "bicv") e.params.retournee = false; modifie("seq bandeau dessin"); });
        if (p.forme === "pcv") K.bouton(BD, TRAD("Retourner"), function () { e.params.retournee = !C.params(e).retournee; modifie("seq dessin"); }, "pl-btn-p").title = TRAD("Présenter l'autre face à la lumière.");
      }
      if (e.type === "oeil" && !oeilObserve(e)) reglagesOeil(BD, e, "bandeau");
      if (e.type === "fenteSource") {
        curseur(BD, TRAD("Largeur"), 0, 2, 0.005, function () { return C.params(e).b; }, function (v) { e.params.b = v; }, function (v) { return v < 0.995 ? fmt(1000 * v) + " µm" : fmt(v, 2) + " mm"; })
          .title = TRAD("Largeur de la fente, de 0 à 2 mm.");
        curseur(BD, "Orientation", -90, 90, 0.5, function () { return (e.rot || 0) * 180 / Math.PI; }, function (v) { e.rot = v * Math.PI / 180; sale.dessin = true; }, function (v) { return fmt(v, 1) + "°"; }, 0)
          .title = TRAD("Rotation de la fente autour de l'axe du banc (0° : verticale). Double-clic : retour à 0°.");
      }
      if (e.type === "couteau") curseur(BD, TRAD("Bord"), -XC_MAX, XC_MAX, 0.005, function () { return C.params(e).xc; }, function (v) { e.params.xc = v; sale.dessin = true; }, function (v) { return fmt(1000 * v) + " µm"; }, 0)
        .title = TRAD("Position du bord de la lame par rapport à l'axe du banc (vis de translation). Double-clic : retour sur l'axe.");
      var tour = e.type === "couteau" || e.type === "polariseur" || e.type === "lame";
      if (PC.orientable && e.type !== "fenteSource")
        curseur(BD, "Orientation", tour ? -180 : -90, tour ? 180 : 90, 0.5, function () { return (e.rot || 0) * 180 / Math.PI; }, function (v) { e.rot = v * Math.PI / 180; sale.dessin = true; }, function (v) { return fmt(v, 1) + "°"; }, 0)
          .title = (e.type === "couteau" ? TRAD("Rotation de la lame autour de l'axe du banc (à 180°, elle arrête l'autre côté).") : e.type === "polariseur" ? TRAD("Rotation du polariseur autour de l'axe du banc (0° : axe vertical), graduée en degrés.") :
            e.type === "lame" ? TRAD("Rotation de la lame autour de l'axe du banc (0° : une ligne neutre verticale), graduée en degrés.") : TRAD("Rotation autour de l'axe du banc (0° : verticale).")) + TRAD(" Double-clic : retour à 0°.");
      if (e.type === "bifentes") { var rb = el("span", "bc-reg", BD); el("span", "", rb, TRAD("Bifente utilisée"));
        seg(rb, ECARTS.map(function (a, i) { return [i, "a = " + fmtV(a) + " mm"]; }), decouverte(p), function (i) { decouvrir(e, i); modifie("seq bandeau"); })
          .title = TRAD("Les deux autres bifentes du support sont masquées."); }
      if (VARIANTES[e.type]) { var Vr = VARIANTES[e.type];
        seg(BD, Vr[1].map(function (v) { return [v, Vr[2](v)]; }), p[Vr[0]], function (v) { e.params[Vr[0]] = v; modifie("seq bandeau"); }); }
      if (decentrable(e)) decentrement(BD, e); else if (DECALABLE[e.type]) platine(BD, e);
      if (e.type === "viseur" || e.type === "lunette") {
        var ro = el("span", "bc-reg", BD); el("span", "", ro, TRAD("Œil"));
        seg(ro, [["integre", TRAD("intégré"), TRAD("Un œil est placé derrière l'oculaire ; on le déplace en glissant sur la vue (cercle oculaire).")],
          ["aucun", TRAD("aucun"), TRAD("L'instrument seul : poser l'œil de l'étagère derrière l'oculaire, à la main.")]], p.oeil || "integre", function (v) { e.params.oeil = v; modifie("seq bandeau"); });
      }
      if (e.type === "lunette") seg(BD, [[false, TRAD("à l'infini")], [true, TRAD("avec bonnette"), TRAD("Une lentille de 100 mm devant l'objectif : la lunette vise alors à 100 mm.")]], !!p.bonnette, function (v) { e.params.bonnette = v; modifie("seq bandeau"); });
      el("span", "bc-pousse", BD);
      boutonsEscVerrou(e);
      var bR = K.bouton(BD, TRAD("Ranger"), rangerSel, "pl-btn-p"); bR.disabled = !!e.verrou;
      bR.setAttribute("data-a3", TRAD("<b>Ranger</b> — remettre la pièce dans l'étagère (ou l'y ramener en la glissant) · {0}", [k_(TRAD("Suppr"))]));
    }

    // Tiroirs du profil (tiroirsDe : niveau 1, étagère réduite et « Observer » sans capteur ni densité) ; le tiroir
    // ouvert est gardé par son NOM (l'étagère de la coque), car les tiroirs changent avec le niveau.
    function tiroirs() { return tiroirsDe(st.bac, P()); }
    // Noms courts des onglets (la rangée porte aussi Montages, Nouveau banc et le matériel : tenir à 1366 px).
    var NOM_TIROIR = { "Objets et diaphragmes": TRAD("Objets"), "Lentilles et miroirs": TRAD("Lentilles"), "Fentes et réseaux": TRAD("Fentes"), "Young et diffraction": "Young", "Observer": TRAD("Observer"), "Autres": TRAD("Autres") };
    // Nom long du tiroir (a3 de l'onglet, sous-menus du clic droit) : ceux qui changent d'une langue à l'autre.
    var TIROIR_LONG = { "Objets et diaphragmes": TRAD("Objets et diaphragmes"), "Lentilles et miroirs": TRAD("Lentilles et miroirs"),
      "Fentes et réseaux": TRAD("Fentes et réseaux"), "Young et diffraction": TRAD("Young et diffraction") };
    function ongletsEtagere() {
      return tiroirs().map(function (T) {
        return { nom: T.nom, pieces: T.pieces, lab: K.esc(NOM_TIROIR[T.nom] || TRAD(T.nom)) + "<i>" + T.pieces.length + "</i>", a3: TIROIR_LONG[T.nom] ? "<b>" + K.esc(TIROIR_LONG[T.nom]) + "</b>" : null };
      });
    }
    function cartesEtagere(T) {
      return T.pieces.map(function (cle) {
        var Pc = PIECES[cle], plein = compte(st, cle) >= Pc.max;
        return { cle: cle, mini: Dessin.svgMini(figurePiece(cle)), nom: Pc.court, dis: plein, titre: Pc.titre + (plein ? TRAD(" Déjà sur le banc.") : ""), cls: "bc-piece" };
      });
    }
    // au clavier (ou sans pointeur) : Entrée ou Espace posent la pièce
    function clicCarte(cle) { if (compte(st, cle) < PIECES[cle].max) { var e = poserPiece(cle); choisir(e.id); voir(e); modifie("seq etagere bandeau"); } }
    function dessinerEtagere() { ETG.dessiner(); }

    // ================= observation =================
    var cvWrap = el("div", "pl-cv bc-cv", K.obs);
    cvWrap.tabIndex = 0; cvWrap.setAttribute("aria-label", TRAD("Observation : molette pour agrandir, glisser pour se déplacer, Maj ou Ctrl + glisser pour déplacer l'œil"));
    var cv = el("canvas", "", cvWrap), Wc = 480; cv.width = cv.height = Wc;
    var surc = svg("svg", { class: "pl-surc", viewBox: "0 0 100 100", preserveAspectRatio: "none" }, cvWrap), msg = el("div", "bc-msg", cvWrap), danger = el("div", "bc-danger", cvWrap);
    danger.hidden = true; danger.textContent = TRAD("Faisceau laser dans l'œil ! Au TP, on ne regarde jamais dans l'axe d'un laser : on observe sa lumière sur un écran.");
    // aperçu pendant un geste : 2^nivApercu rayons, ajusté au temps mesuré de la passe (rester fluide)
    // ----- Qualité du moteur (mode prof) : réglages libres + 6 préréglages globaux, 7 niveaux (le 3 = les valeurs d'origine). Valeurs
    // gardées dans la mémoire du navigateur (clé `qualite`), communes à tous les bacs. `rFinRes` 0 = la résolution de la fenêtre
    // (l'écran et l'œil seulement : un capteur garde la sienne, qui est celle de ses pixels).
    function puis(e) { return (1 << e).toString().replace(/\B(?=(\d{3})+(?!\d))/g, I18N && I18N.dec() === "." ? "," : "\u202f"); }
    function labExp(e) { return TRAD("2^{0} = {1} rayons", [e, puis(e)]); }
    function labPx(v) { return v ? v + " × " + v + " px" : TRAD("celle de la fenêtre"); }
    function labN(v) { return String(v); }
    function labCell(e) { return TRAD("2^{0} = {1} mailles", [e, puis(e)]); }
    var QP = [
      { g: TRAD("Rayons : aperçu pendant le réglage"), k: "rApRes", nom: TRAD("Résolution (au plus celle de l'observation)"), v: [96, 128, 192, 256, 384, 512, 768, 1024, 1536, 2048], lab: labPx, pre: [192, 256, 384, 512, 512, 768, 1024] },
      { g: TRAD("Rayons : aperçu pendant le réglage"), k: "rApExp", nom: TRAD("Rayons par passe (plafond)"), v: [14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26], lab: labExp, pre: [18, 19, 21, 22, 24, 24, 24] },
      { g: TRAD("Rayons : image fine"), k: "rFinRes", nom: TRAD("Résolution (au plus celle de l'observation)"), v: [0, 256, 384, 512, 768, 1024, 1536, 2048], lab: labPx, pre: [256, 384, 0, 1024, 2048, 2048, 2048] },
      { g: TRAD("Rayons : image fine"), k: "rFinExp", nom: TRAD("Rayons par passe"), v: [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26], lab: labExp, pre: [19, 20, 21, 22, 24, 24, 24] },
      { g: TRAD("Rayons : image fine"), k: "rFinPasses", nom: TRAD("Nombre de passes"), v: [2, 4, 8, 10, 16, 20, 40, 80, 160, 320, 640, 1280], lab: labN, pre: [10, 20, 40, 60, 80, 160, 320] },
      { g: TRAD("Ondes : aperçu pendant le réglage"), k: "oApRes", nom: TRAD("Résolution de l'image"), v: [64, 96, 128, 192, 256, 384, 512, 768, 1024, 1536, 2048], lab: labPx, pre: [128, 192, 256, 384, 512, 768, 768] },
      { g: TRAD("Ondes : aperçu pendant le réglage"), k: "oApNs", nom: TRAD("Strates de la source (par axe)"), v: [1, 2, 3, 4, 6, 8, 12, 16, 24, 32], lab: labN, pre: [2, 3, 4, 6, 8, 12, 12] },
      { g: TRAD("Ondes : aperçu pendant le réglage"), k: "oApNp", nom: TRAD("Couples source × λ par passe"), v: [1, 2, 4, 6, 8, 12, 16, 32, 64, 128], lab: labN, pre: [4, 6, 8, 12, 16, 24, 24] },
      { g: TRAD("Ondes : aperçu pendant le réglage"), k: "oApNl", nom: TRAD("Longueurs d'onde d'un continu"), v: [2, 3, 4, 6, 8, 12, 16, 32, 48, 64], lab: labN, pre: [3, 4, 6, 8, 12, 16, 16] },
      { g: TRAD("Ondes : aperçu pendant le réglage"), k: "oApCell", nom: TRAD("Grille de calcul (plafond)"), v: [14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24], lab: labCell, pre: [16, 17, 18, 19, 20, 21, 21] },
      { g: TRAD("Ondes : aperçu pendant le réglage"), k: "oApMail", nom: TRAD("Mailles par plus petit détail"), v: [2, 4, 6, 8, 10, 12, 16, 24, 32], lab: labN, pre: [4, 6, 8, 10, 12, 16, 16] },
      { g: TRAD("Ondes : image fine"), k: "oFinRes", nom: TRAD("Résolution de l'image"), v: [128, 192, 256, 384, 512, 768, 1024, 1536, 2048], lab: labPx, pre: [256, 384, 512, 768, 1024, 1536, 1536] },
      { g: TRAD("Ondes : image fine"), k: "oFinNs", nom: TRAD("Strates de la source (par axe)"), v: [1, 2, 4, 6, 8, 12, 16, 24, 32, 48, 64], lab: labN, pre: [4, 6, 8, 12, 16, 24, 24] },
      { g: TRAD("Ondes : image fine"), k: "oFinNp", nom: TRAD("Couples source × λ par passe"), v: [1, 2, 4, 8, 12, 16, 24, 32, 64, 128, 256], lab: labN, pre: [8, 12, 16, 24, 32, 48, 48] },
      { g: TRAD("Ondes : image fine"), k: "oFinPasses", nom: TRAD("Passes (sans somme brute)"), v: [1, 2, 4, 6, 8, 16, 32, 64, 128, 256], lab: labN, pre: [4, 6, 8, 16, 32, 32, 32] },
      { g: TRAD("Ondes : image fine"), k: "oFinPts", nom: TRAD("Points de source au plus (somme brute)"), v: [10, 20, 40, 60, 100, 200, 400, 800, 1600], lab: labN, pre: [20, 40, 60, 100, 200, 400, 400] },
      { g: TRAD("Ondes : image fine"), k: "oFinNl", nom: TRAD("Longueurs d'onde d'un continu"), v: [4, 8, 12, 16, 24, 32, 48, 64, 96, 128], lab: labN, pre: [8, 12, 16, 24, 32, 48, 48] },
      { g: TRAD("Ondes : image fine"), k: "oFinCell", nom: TRAD("Grille de calcul (plafond)"), v: [16, 17, 18, 19, 20, 21, 22, 23, 24, 25], lab: labCell, pre: [18, 19, 20, 21, 22, 23, 23] },
      { g: TRAD("Ondes : image fine"), k: "oFinMail", nom: TRAD("Mailles par plus petit détail"), v: [2, 4, 6, 8, 12, 16, 24, 32, 48], lab: labN, pre: [6, 8, 8, 12, 16, 24, 24] }
    ];
    var Ql = { niveau: 3, perso: false, moteur: "auto", delai: 150, adapt: true, rendu: 2, prof: false, guide: true };
    function niveauQ(n) { QP.forEach(function (q) { Ql[q.k] = q.pre[n - 1]; }); Ql.niveau = n; Ql.perso = false; }
    niveauQ(3);
    (function () {
      var m = mem && mem.qualite; if (!m || typeof m !== "object") return;
      QP.forEach(function (q) { if (q.v.indexOf(m[q.k]) >= 0) Ql[q.k] = m[q.k]; });
      if (["auto", "rayons", "ondes"].indexOf(m.moteur) >= 0) Ql.moteur = m.moteur;
      if ([0, 50, 150, 300, 600, 1200].indexOf(m.delai) >= 0) Ql.delai = m.delai;
      Ql.adapt = m.adapt !== false; Ql.guide = m.guide !== false; Ql.perso = !!m.perso; Ql.niveau = m.niveau >= 1 && m.niveau <= 7 ? m.niveau : 3;
      Ql.rendu = m.rendu >= 1 && m.rendu <= 5 ? m.rendu : 2;
      // mémoire ancienne (sans `prof`) : un préréglage autre que 3 ou des réglages à la main restent ceux du prof
      Ql.prof = typeof m.prof === "boolean" ? m.prof : !!(m.perso || (m.niveau && m.niveau !== 3));
    })();
    // Qualité changée (niveau de rendu de la barre ou panneau prof) : le moteur repart de zéro, la mémoire est sauvée.
    function changerQualite() {
      nivApercu = Ql.prof ? Ql.rApExp : 20;
      if (MOT) MOT.reinit();
      sale.obs = true; K.modifie();
      if (PR.majQ) PR.majQ();
      if (BOUT.rendu) BOUT.rendu.maj();
    }
    // réglage du panneau prof (Ql.prof) ou préréglage prof du niveau de rendu choisi (ondes)
    function vq(k) { if (Ql.prof) return Ql[k]; var n = RENDUS[Ql.rendu].onde; return QP.filter(function (q) { return q.k === k; })[0].pre[n - 1]; }
    var MOT = null, logiciel = false, nivApercu = Ql.prof ? Ql.rApExp : 20;
    try {
      // moteur ondulatoire quand le cœur l'accepte ; en optique parfaite, une ouverture ordinaire (iris,
      // trou ou fente source) n'y fait pas basculer (`ouvertures` d'`ondePlan`)
      MOT = C.creerMoteurBanc ? C.creerMoteurBanc(cv, { budget: 12, onde: true, guide: function () { return Ql.guide; }, moteur: function () { return Ql.moteur === "rayons" ? "rayons" : "auto"; }, delai: function () { return Ql.delai; }, qualite: function () {
        var f = FEN || { res: 512 }, r = f.res, libre = DET === "ecran" || DET === "oeil", R = RENDUS[Ql.rendu];
        if (logiciel && !Ql.prof) return { apercu: { res: Math.min(128, r), Nr: 1 << 15 }, fin: { res: Math.min(256, r), Nr: 1 << 17, passes: 8 } };
        // écran et œil : jamais plus fin que l'observation affichée (Wc pixels) : au-delà, même bruit par pixel affiché,
        // et lire(), sommes(), centile plus chers
        if (!Ql.prof) return { apercu: { res: Math.min(R.ap, libre ? Wc : r), Nr: 1 << nivApercu }, fin: { res: libre ? Math.min(r, Wc) : r, Nr: 1 << R.Nr, passes: 100000, bruit: R.bruit, plafond: R.plafond, visible: R.visible } };
        return { apercu: { res: libre ? Math.min(Ql.rApRes, Wc) : Math.min(384, r), Nr: 1 << nivApercu }, fin: { res: libre ? Math.min(Ql.rFinRes || r, Wc) : r, Nr: 1 << Ql.rFinExp, passes: Ql.rFinPasses } };
      }, qualiteOnde: function (s) {
        var dfltO = !Ql.prof && RENDUS[Ql.rendu].onde === 3;
        if (!(logiciel && !Ql.prof) && !dfltO) {
          var ouvQ = Ql.moteur === "ondes" || !s || s.optique !== "parfaite", libreO = DET === "ecran" || DET === "oeil", rf = vq("oFinRes");
          return { apercu: { res: vq("oApRes"), ns: vq("oApNs"), np: vq("oApNp"), opt: { nl: vq("oApNl"), maxCellules: 1 << vq("oApCell"), fin: vq("oApMail"), ouvertures: ouvQ } },
            fin: { res: libreO && !Ql.prof ? Math.min(rf, Wc) : rf, ns: vq("oFinNs"), np: vq("oFinNp"), passes: vq("oFinPasses"), opt: { nl: vq("oFinNl"), maxCellules: 1 << vq("oFinCell"), fin: vq("oFinMail"), ouvertures: ouvQ, maxPoints: vq("oFinPts") } } };
        }
        // image fine en somme brute : points de la source au plus selon la table du niveau (oFinPts), comme les autres
        // niveaux ; elle peut prendre plus de quelques secondes (l'aperçu, lui, reste à np couples par image), et un
        // montage lourd le dit (coutOnde, légende de l'observation)
        var Q = C.QUALITE_ONDE, ouv = !s || s.optique !== "parfaite";
        if (logiciel) return { apercu: { res: 128, ns: 2, np: 4, opt: { nl: 4, maxCellules: 1 << 15, ouvertures: ouv } }, fin: { res: 256, ns: 4, np: 8, passes: 2, opt: { nl: 8, maxCellules: 1 << 17, ouvertures: ouv } } };
        return { apercu: { res: Q.apercu.res, ns: Q.apercu.ns, np: Q.apercu.np, opt: { nl: Q.apercu.opt.nl, maxCellules: Q.apercu.opt.maxCellules, ouvertures: ouv } },
          fin: { res: Q.fin.res, ns: Q.fin.ns, np: Q.fin.np, passes: Q.fin.passes, opt: { ouvertures: ouv, maxPoints: vq("oFinPts") } } };
      } }) : null;
      if (MOT) logiciel = /swiftshader|llvmpipe|software/i.test(String(MOT.traceur.info()));
    } catch (e1) { MOT = null; }
    var DET = null, FEN = null, INS = null;
    // Tache (aide « Tache sur le détecteur ») : calculée quand plus rien ne bouge depuis 180 ms (relâchement du geste), en
    // repère du détecteur ; dessinée dans `dessinerSurc`, qui la replace à chaque zoom ou déplacement de la fenêtre.
    var SPOT = null, spotVoulu = false, tSpot = 0;
    function spotInvalide() { SPOT = null; spotVoulu = !!st.aides.spot; tSpot = maintenant(); sale.spotDessin = true; }
    function calculerSpot() {
      if (!st.aides.spot || !SEQ || !DET) { SPOT = null; sale.spotDessin = true; return; }
      var ech = echantillonSpectre(SEQ, N_TACHE);
      // point sur un trait opaque de l'objet (état repris tel quel) : ramené au transparent le plus proche, comme à la pose
      var dep0 = departPinceau(SEQ, 1, st.pinceau.h || 0, st.pinceau.hx || 0);
      if (dep0 && dep0.objet && dep0.objet.k === K_.MASQUE && formeOpaque(dep0.objet, dep0.p)) {
        var rp = ramenerDansObjet(dep0.objet, st.pinceau.hx || 0, st.pinceau.h || 0);
        st.pinceau.hx = rp[0]; st.pinceau.h = rp[1];
        modifie("dessin");
      }
      SPOT = spotPinceau(SEQ, st.pinceau.hx || 0, st.pinceau.h || 0, ech, 25);
      SPOT.ech = ech;
      dessinerSurc(); majPied();
    }
    // Affichage de la fenêtre : capteur tel quel (pose) ; vue « œil » (écran, plaque, œil) en luminosité
    // réelle (`vision`, le même calcul sous les deux moteurs) ou toujours visible (exposition automatique de la fenêtre).
    // Scène du banc, pour l'ancrage du niveau d'adaptation de l'œil (`aff.scene`, lu par le moteur) : l'ARRIVÉE dans un
    // montage (le charger, c'est refaire le banc, pas un réglage), la vue (écran ou rétine) et le mode de luminosité.
    // Tout ce que l'élève manipule SUR le banc FOND au contraire : poser ou retirer un dépoli, glisser une densité,
    // changer de filtre ou de lampe se fait en regardant l'écran, et la transition rétinienne y a un sens — c'est même
    // la variation qu'on veut montrer. Les positions, l'iris et la mise au point n'entrent pas dans la scène du tout.
    function sceneSig() {
      return [st.montage || "", FEN && FEN.vue ? (FEN.vue.retine ? "retine" : "ecran") : "", lumq()].join("|");
    }
    function affichage() {
      var a = { W: FEN.W, cx: FEN.cx, cy: FEN.cy, expo: FEN.expo, auto: !!FEN.auto, absolu: !!FEN.absolu, bruit: FEN.bruit || 0, photo: FEN.photo || null, comp: FEN.comp, fond: FEN.fond, net: FEN.net };
      if (FEN.vue && lumq() !== "visible") { a.vision = visionDe(FEN, SEQ, PUP); a.auto = false; }
      else if (FEN.vue) {      // toujours visible : couleurs de `vision` sur l'exposition automatique ; la pupille reste physique
        a.visible = true;
        if (FEN.vue.retine) a.vision = visionDe(FEN, SEQ, PUP, true);
      }
      a.scene = sceneSig();    // la cible mesurée s'en souvient : c'est elle qui ancre le niveau d'adaptation
      return a;
    }
    // Pupille stationnaire de l'œil qui observe : celle que le moteur mesure (stats.vision.D, adaptation du
    // champ entier) remplace la pupille tracée si elle s'en écarte de plus de 5 %, et le tracé repart (la luminance
    // rétinienne dépend de la pupille et la pupille de la luminance : quelques itérations, monotones). Au plus
    // PUP_ITER relances par changement venu de l'élève. PUP survit aux changements de montage : point de départ.
    var PUP = 4, nPup = 0, pupAuto = false, PUP_ITER = 6;
    function suivrePupille() {
      var VS = MOT && MOT.stats.vision;
      if (!VS || DET !== "oeil" || !(VS.D > 0) || VS.seq !== SEQ || VS.pupTracee !== PUP) return;
      if (Math.abs(VS.D - PUP) <= 0.05 * PUP || nPup >= PUP_ITER) return;
      PUP = Math.round(100 * VS.D) / 100; nPup++; pupAuto = true; sale.seq = sale.bandeau = true;
    }
    function demanderObs() {
      DET = detecteur(SEQ, st); INS = DET === "oeil" ? instrumentDe(SEQ, st) : null; FEN = DET ? fenetre(st, DET) : null;
      var t = !SEQ || !SEQ.source ? TRAD("Poser la lanterne sur le banc.") : !DET ? (SEQ.miroir ? TRAD("Le miroir renvoie la lumière vers la source : poser la lettre F entre la lanterne et le miroir, sa face blanche sert d'écran (celle du trou source aussi).") : TRAD("Poser un écran, un capteur, l'œil, le viseur ou la lunette sur le banc pour observer.")) :
        !MOT ? TRAD("Le tracé des rayons a besoin de la carte graphique (WebGL2), indisponible dans ce navigateur.") : "";
      msg.textContent = t; msg.hidden = !t;
      danger.hidden = !laserDansOeil(SEQ, st, DET);
      if (MOT) {
        var a = DET ? affichage() : null;
        MOT.demander(DET ? SEQ : VIDE, a);
      }
      dessinerSurc(); majPied();
    }
    function dessinerSurc() {
      surc.innerHTML = "";
      if (!DET || !FEN || !SEQ.detEl) return;
      var vue = SEQ.vue || [1, 1], Wf = FEN.W;
      function U(x) { return 50 + vue[0] * (x - FEN.cx) / Wf * 50; }
      function V(y) { return 50 - vue[1] * (y - FEN.cy) / Wf * 50; }
      if (DET === "ecran" && C.params(SEQ.detEl).quadrille) {
        var g = svg("g", { class: "bc-quad" }, surc), pas = Wf < 16 ? 1 : 10, d = "", dg = "", k;
        for (k = Math.ceil((FEN.cx - Wf) / pas); k * pas <= FEN.cx + Wf; k++) { if (pas === 1 && k % 10 === 0) dg += "M" + pf(U(k * pas)) + " 0V100"; else d += "M" + pf(U(k * pas)) + " 0V100"; }
        for (k = Math.ceil((FEN.cy - Wf) / pas); k * pas <= FEN.cy + Wf; k++) { if (pas === 1 && k % 10 === 0) dg += "M0 " + pf(V(k * pas)) + "H100"; else d += "M0 " + pf(V(k * pas)) + "H100"; }
        svg("path", { d: d, stroke: "#000", "stroke-opacity": 0.4, "stroke-width": 0.5, fill: "none", "vector-effect": "non-scaling-stroke" }, g);
        if (dg) svg("path", { d: dg, stroke: "#000", "stroke-opacity": 0.6, "stroke-width": 1, fill: "none", "vector-effect": "non-scaling-stroke" }, g);
      }
      // Réticule du viseur ou de la lunette, redessiné net pour l'œil que le cœur place derrière (au repos : il le voit
      // à l'infini ; un point (x, y) du réticule tombe en −(17 / f oculaire)(x, y) sur la rétine). Le masque tracé par
      // le moteur reste dessous, trop fin pour l'affichage. Derrière un œil posé (accommodation libre) : rien.
      if (DET === "oeil" && INS && SEQ.implicite) {
        var kr = RETINE / OCULAIRE[INS.type], gr = svg("g", { class: "bc-ret" }, surc), dr = "M" + pf(U(-6 * kr)) + " " + pf(V(0)) + "H" + pf(U(6 * kr)) + "M" + pf(U(0)) + " " + pf(V(-6 * kr)) + "V" + pf(V(6 * kr)), jr;
        if (INS.type === "lunette") for (jr = -50; jr <= 50; jr++) if (jr) dr += "M" + pf(U(-kr * jr * 0.1)) + " " + pf(V(0)) + "V" + pf(V(-kr * (jr % 10 === 0 ? 0.6 : jr % 5 === 0 ? 0.4 : 0.25)));
        svg("path", { d: dr, stroke: "#000", "stroke-width": 1, fill: "none", "vector-effect": "non-scaling-stroke" }, gr);
      }
      // Plaque de la lettre F vue du côté du miroir : la lettre découpée laisse voir la lumière de la lanterne (le
      // moteur ne trace que la lumière revenue sur la face blanche).
      if (DET === "plaque" && SEQ.detEl.type === "lettreF") {
        var gf = svg("g", { class: "bc-lettre" }, surc);
        [[-6, -10, -3, 10], [-6, 7, 6, 10], [-6, -1.5, 3, 1.5]].forEach(function (q) {
          svg("rect", { x: Math.min(U(q[0]), U(q[2])), y: Math.min(V(q[1]), V(q[3])), width: Math.abs(U(q[2]) - U(q[0])), height: Math.abs(V(q[3]) - V(q[1])), fill: "#fff3cf" }, gf);
        });
      }
      if (DET === "plaque" && SEQ.detEl.type === "trouSource")
        svg("circle", { class: "bc-lettre", cx: U(0), cy: V(0), r: Math.max(C.params(SEQ.detEl).d / 2 / Wf * 50, 0.6), fill: "#fff3cf" }, surc);
      if (st.aides.spot && SPOT && SPOT.taches) {
        // un point par rayon, une couleur par longueur d'onde ; fond sombre translucide : les couleurs s'additionnent
        // (écran) et se recomposent en blanc là où elles se superposent, même sur une image claire
        var gT = svg("g", { class: "bc-spot", "pointer-events": "none" }, surc), dT = "", ptsT = SPOT.taches;
        ptsT.forEach(function (t) { t.pts.forEach(function (q) { dT += "M" + pf(U(q[0])) + " " + pf(V(q[1])) + "h.001"; }); });
        if (dT) svg("path", { d: dT, stroke: "#000", "stroke-opacity": 0.3, "stroke-width": 6, "stroke-linecap": "round", "vector-effect": "non-scaling-stroke", fill: "none" }, gT);
        ptsT.forEach(function (t) {
          if (!t.pts.length) return;
          var d1 = "";
          t.pts.forEach(function (q) { d1 += "M" + pf(U(q[0])) + " " + pf(V(q[1])) + "h.001"; });
          svg("path", { d: d1, stroke: couleurRayon(SPOT.ech, t.l), "stroke-opacity": 0.8, "stroke-width": 3, "stroke-linecap": "round", "vector-effect": "non-scaling-stroke", fill: "none", style: "mix-blend-mode:screen" }, gT);
        });
        if (SPOT.centre) {
          var cc = SPOT.centre;
          svg("circle", { cx: pf(U(cc[0])), cy: pf(V(cc[1])), r: 2.4, fill: "none", stroke: "#fff", "stroke-opacity": 0.85, "stroke-width": 1, "vector-effect": "non-scaling-stroke" }, gT);
        }
      }
      if (st.aides.rebours && st.pointObs) {      // la zone où l'on cherche les rayons (RET_ZONE de la demi-largeur)
        // liseré sombre sous le cercle blanc : visible aussi sur une image claire
        [["#000", 3.2, 0.45], ["#fff", 1.2, 0.9]].forEach(function (c) {
          svg("circle", { cx: pf(U(st.pointObs.x)), cy: pf(V(st.pointObs.y)), r: RET_ZONE * 50, fill: "none", stroke: c[0], "stroke-opacity": c[2], "stroke-width": c[1], "vector-effect": "non-scaling-stroke", "pointer-events": "none" }, surc);
        });
      }
      if (DET === "ecran" && st.fibre.on && fibreOfferte()) {     // la fibre du spectromètre (au moins visible)
        var gs = svg("g", { class: "bc-fibre" }, surc), fx = U(st.fibre.x), fy = V(st.fibre.y), fr = Math.max(appareil().r / Wf * 50, 1.1);
        svg("circle", { cx: pf(fx), cy: pf(fy), r: fr, fill: "none", stroke: "#e8c36a", "stroke-width": 1.4, "vector-effect": "non-scaling-stroke" }, gs);
        svg("path", { d: "M" + pf(fx - fr - 2.5) + " " + pf(fy) + "H" + pf(fx - fr) + "M" + pf(fx + fr) + " " + pf(fy) + "H" + pf(fx + fr + 2.5), stroke: "#e8c36a", "stroke-width": 1, "vector-effect": "non-scaling-stroke" }, gs);
      }
      if (DET === "ecran" && st.photo.on) {     // la photodiode (carré de sa monture, disque sensible à l'échelle)
        var gq = svg("g", { class: "bc-photo" }, surc), qx = U(st.photo.x), qy = V(st.photo.y), qr = Math.max(R_PD / Wf * 50, 1);
        svg("rect", { x: pf(qx - qr - 1.6), y: pf(qy - qr - 1.6), width: pf(2 * qr + 3.2), height: pf(2 * qr + 3.2), rx: 0.6, fill: "none", stroke: "#63c59a", "stroke-width": 1.4, "vector-effect": "non-scaling-stroke" }, gq);
        svg("circle", { cx: pf(qx), cy: pf(qy), r: qr, fill: "none", stroke: "#63c59a", "stroke-width": 0.8, "vector-effect": "non-scaling-stroke" }, gq);
      }
      if (DET === "ecran" && st.barr.on) dessinerBarrette(U, V, Wf);
      if (DET === "capteur" && Wf > 2.4) {      // bords du capteur (4:3) dans la fenêtre carrée
        svg("rect", { x: U(vue[0] > 0 ? -3.2 : 3.2), y: V(vue[1] > 0 ? 2.4 : -2.4), width: 6.4 / Wf * 50, height: 4.8 / Wf * 50, fill: "none", stroke: "#3b424b", "stroke-width": 1, "vector-effect": "non-scaling-stroke" }, surc);
      }
    }
    // molette : agrandir autour du pointeur ; glisser : se déplacer ; double-clic : tout le détecteur
    function versDet(ev) {
      var r = cv.getBoundingClientRect(), u = (ev.clientX - r.left) / (r.width || 1), v = (ev.clientY - r.top) / (r.height || 1), vue = (SEQ && SEQ.vue) || [1, 1];
      return { x: FEN.cx + vue[0] * (2 * u - 1) * FEN.W, y: FEN.cy + vue[1] * (1 - 2 * v) * FEN.W, S: r.width || 1 };
    }
    // p : pas de molette, fractionnaire (×1,25 par pas, proportionnel au défilement) ; capteur : p entier, un cran de N.
    function wPlein() { return DET === "oeil" ? W_OEIL : DET === "plaque" ? Banc.W_PLAQUE : 100; }
    function zoomer(p, ev) {
      if (!DET || !FEN) return;
      var o = st.obs[DET], W0 = FEN.W, q = ev ? versDet(ev) : { x: FEN.cx, y: FEN.cy }, W1;
      if (DET === "capteur") { var i = clamp(CAPTEUR_N.indexOf(o.N) + p, 0, CAPTEUR_N.length - 1); o.N = CAPTEUR_N[i]; W1 = o.N * PIXEL / 2; }
      else { o.zoom = clamp(o.zoom * Math.pow(1.25, p), 1, DET === "oeil" ? ZOOM_OEIL_MAX : ZOOM_ECRAN_MAX); if (o.zoom < 1.02) o.zoom = 1; W1 = wPlein() / o.zoom; }
      var p_ = q;
      o.cx = p_.x - (p_.x - FEN.cx) * W1 / W0; o.cy = p_.y - (p_.y - FEN.cy) * W1 / W0;
      modifie("obs tete dessin");   // dessin : zone affichée sur l'écran ou le capteur du banc
    }
    // Cadrer sur l'image : le rectangle (dans les unités du détecteur) devient la zone affichée.
    var cadreImg = el("div", "bc-cadre-r", cvWrap); cadreImg.hidden = true;
    function cadrerImage(a, b) {
      var w = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / 2, o = st.obs[DET];
      armerCadre(null);
      if (!(w > 0) || !FEN || w < 0.01 * FEN.W) return;
      if (DET === "capteur") { var j = CAPTEUR_N.length - 1; while (j > 0 && CAPTEUR_N[j] * PIXEL / 2 < w) j--; o.N = CAPTEUR_N[j]; }
      else o.zoom = clamp(wPlein() / w, 1, DET === "oeil" ? ZOOM_OEIL_MAX : ZOOM_ECRAN_MAX);
      o.cx = (a.x + b.x) / 2; o.cy = (a.y + b.y) / 2;
      modifie("obs tete dessin");
    }
    var prO = null;
    // L'œil posé sur le banc : le glisser sur sa vue le déplace, comme on bouge la tête. L'œil intégré d'un instrument
    // (viseur, lunette) reste sur l'axe : pas de décalage à la main (le glisser déplace alors l'image).
    function oeilMobile() {
      var d = SEQ && SEQ.detEl; if (DET !== "oeil" || !d) return null;
      return trouver(st, d.id) || null;
    }
    // Glisser : se déplacer dans l'image ; Maj+glisser : l'œil posé, fin ; Ctrl+glisser : l'œil, vite (l'œil intégré d'un
    // viseur ou d'une lunette reste sur l'axe : Maj et Ctrl y déplacent l'image).
    cvWrap.addEventListener("pointerdown", function (ev) {
      if (ev.button || !DET) return;
      prO = { x: ev.clientX, y: ev.clientY, x0: ev.clientX, y0: ev.clientY, ev: ev, oeil: ev.shiftKey || ev.ctrlKey ? oeilMobile() : null, kO: ev.shiftKey ? 0.2 : 1 };
      if (CADRE === "image") prO = { cadre: versDet(ev), x0: ev.clientX, y0: ev.clientY };
      ev.preventDefault();
      try { cvWrap.setPointerCapture(ev.pointerId); } catch (e2) {}
    });
    var prB = null;      // barrette prise à la souris (dessinerBarrette)
    cvWrap.addEventListener("pointermove", function (ev) {
      if (prB && prB.tourne && FEN) {          // poignée : la barrette tourne autour de son centre (Maj : au degré)
        var rc = cv.getBoundingClientRect(), vt = (SEQ && SEQ.vue) || [1, 1], kc = 2 * FEN.W / (rc.width || Wc);
        var cxs = rc.left + (st.barr.x - FEN.cx) / kc * vt[0] + (rc.width || Wc) / 2, cys = rc.top - (st.barr.y - FEN.cy) / kc * vt[1] + (rc.height || Wc) / 2;
        var a = Math.atan2(-vt[1] * (ev.clientY - cys), vt[0] * (ev.clientX - cxs)) * 180 / Math.PI;
        a = ev.shiftKey ? Math.round(a) : Math.round(a * 10) / 10;
        st.barr.ang = (a % 360 + 360) % 360; modifie("barr"); if (ANG) ANG.sync(); return;
      }
      if (prB && FEN) {
        var kb = 2 * FEN.W / (cv.getBoundingClientRect().width || Wc), vb = (SEQ && SEQ.vue) || [1, 1];
        st.barr.x = Math.round(clamp(prB.bx + vb[0] * (ev.clientX - prB.x) * kb, -100, 100) * 1000) / 1000;
        st.barr.y = Math.round(clamp(prB.by - vb[1] * (ev.clientY - prB.y) * kb, -100, 100) * 1000) / 1000;
        modifie("barr"); return;
      }
      if (!prO || !DET || !FEN) return;
      if (prO.cadre) {
        var rr = cvWrap.getBoundingClientRect(), wr = rr.width || 1, hr = rr.height || 1;
        cadreImg.hidden = false;
        cadreImg.style.left = (Math.min(prO.x0, ev.clientX) - rr.left) / wr * 100 + "%"; cadreImg.style.top = (Math.min(prO.y0, ev.clientY) - rr.top) / hr * 100 + "%";
        cadreImg.style.width = Math.abs(ev.clientX - prO.x0) / wr * 100 + "%"; cadreImg.style.height = Math.abs(ev.clientY - prO.y0) / hr * 100 + "%";
        return;
      }
      if (prO.oeil) {      // Maj / Ctrl + glisser = déplacer l'œil (vers la droite, vers le haut, comme les flèches du bandeau) ; Maj : 5 fois plus fin
        var km = 2 * DEC_MAX / (cv.getBoundingClientRect().width || Wc) * prO.kO, oe = prO.oeil;
        oe.x = clamp(Math.round(((oe.x || 0) + (ev.clientX - prO.x) * km) * 1000) / 1000, -DEC_MAX, DEC_MAX);
        oe.y = clamp(Math.round(((oe.y || 0) - (ev.clientY - prO.y) * km) * 1000) / 1000, -DEC_MAX, DEC_MAX);
        prO.x = ev.clientX; prO.y = ev.clientY;
        modifie("seq"); if (bdPlatine) bdPlatine();
        return;
      }
      var o = st.obs[DET], vue = (SEQ && SEQ.vue) || [1, 1], k = 2 * FEN.W / (cv.getBoundingClientRect().width || Wc);
      o.cx -= vue[0] * (ev.clientX - prO.x) * k; o.cy += vue[1] * (ev.clientY - prO.y) * k;
      prO.x = ev.clientX; prO.y = ev.clientY;
      modifie("obs dessin");
    });
    // un clic sans glisser, aide « rayons vers un point » affichée : le point désigné
    function lacherO(ev) {
      if (prB) { prB = null; return; }
      var p0 = prO; prO = null;
      if (p0 && p0.cadre) { cadreImg.hidden = true; if (ev && ev.type === "pointerup" && Math.hypot(ev.clientX - p0.x0, ev.clientY - p0.y0) > 6) cadrerImage(p0.cadre, versDet(ev)); else armerCadre(null); return; }
      if (!p0 || !ev || ev.type !== "pointerup" || !FEN || Math.hypot(ev.clientX - p0.x0, ev.clientY - p0.y0) > 4) return;
      if (DET === "ecran" && st.barr.on) { var qb = versDet(ev); st.barr.x = Math.round(qb.x * 1000) / 1000; st.barr.y = Math.round(qb.y * 1000) / 1000; modifie("barr"); return; }
      if (DET === "ecran" && st.photo.on) { var qp = versDet(ev); st.photo.x = Math.round(qp.x * 1000) / 1000; st.photo.y = Math.round(qp.y * 1000) / 1000; modifie("photo"); return; }
      if (DET === "ecran" && st.fibre.on && fibreOfferte()) { var qf = versDet(ev); st.fibre.x = Math.round(qf.x * 1000) / 1000; st.fibre.y = Math.round(qf.y * 1000) / 1000; modifie("spec"); return; }
      if (!st.aides.rebours) return;
      // « spotDessin » (pas « obs ») : le point se redessine sans relancer l'image
      var q = versDet(ev); st.pointObs = { x: q.x, y: q.y }; modifie("dessin spotDessin");
    }
    cvWrap.addEventListener("pointerup", lacherO); cvWrap.addEventListener("pointercancel", lacherO);
    function toutVoir() { if (!DET) return; var oe = oeilMobile(); if (oe && (oe.x || oe.y)) { oe.x = oe.y = 0; modifie("seq"); if (bdPlatine) bdPlatine(); } var o = st.obs[DET]; o.cx = o.cy = 0; if (DET === "capteur") o.N = CAPTEUR_N[0]; else o.zoom = 1; modifie("obs tete dessin"); }
    cvWrap.addEventListener("dblclick", function () { if (!CADRE) toutVoir(); });
    // Clic droit sur l'image : tout voir, recentrer l'œil posé, le récepteur qui observe, poser ici une mesure (écran).
    function nomRecep(r, RS) { return { ecran: TRAD("Écran"), capteur: TRAD("Capteur"), oeil: TRAD("Œil"), viseur: TRAD("Viseur"), lunette: TRAD("Lunette") }[r.type] + (BAC.clair && RS.filter(function (q) { return q.type === r.type; }).length > 1 ? " " + fmt(r.z / 10, 0) + " cm" : ""); }
    function recepObserve(r) { return !!SEQ && (r.id === (SEQ.detEl && SEQ.detEl.id) || (SEQ.implicite && instrumentDe(SEQ, st) === r)); }
    cvWrap.addEventListener("contextmenu", function (ev) {
      ev.preventDefault();
      var L = [], oe = oeilMobile(), RS = recepteurs(st), q = DET && FEN ? versDet(ev) : null;
      if (DET) L.push({ lab: TRAD("Tout voir"), k: "double-clic", act: toutVoir });
      if (oe) L.push({ lab: TRAD("Recentrer l'œil"), dis: !(oe.x || oe.y), act: function () { oe.x = oe.y = 0; modifie("seq"); if (bdPlatine) bdPlatine(); } });
      if (RS.length > 1) L.push({ lab: TRAD("Récepteur"), sub: RS.map(function (r) { return { lab: nomRecep(r, RS), coche: recepObserve(r), act: function () { st.recep = r.id; modifie("seq dessin tete bandeau"); } }; }) });
      if (q && DET === "ecran" && MOT && P().mesures) {
        if (L.length) L.push({ sep: 1 });
        [["barr", TRAD("la barrette"), "barr"], ["photo", TRAD("la photodiode"), "photo"], ["fibre", TRAD("la fibre du spectromètre"), "spec"]].forEach(function (m) {
          L.push({ lab: TRAD("Poser ici {0}", [m[1]]), act: function () {
            st.barr.on = st.photo.on = st.fibre.on = false; st[m[0]].on = true;
            st[m[0]].x = Math.round(q.x * 1000) / 1000; st[m[0]].y = Math.round(q.y * 1000) / 1000;
            modifie("spec photo barr tete");
          } });
        });
      }
      ouvrirCtx(ev.clientX, ev.clientY, L);
    });

    // Image affichée en PNG : le canvas WebGL n'a pas preserveDrawingBuffer, on redessine puis on lit dans la même tâche
    // (sinon image noire). Nom : détecteur et heure (le montage choisi ne dit plus rien une fois les pièces bougées).
    function enregistrerImage() {
      if (!MOT || !DET) return;
      MOT.reafficher(affichage());
      var d = new Date(), z = function (n) { return (n < 10 ? "0" : "") + n; };
      var nom = "banc-" + (INS ? INS.type : DET) + "-" + d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + "-" + z(d.getHours()) + "h" + z(d.getMinutes()) + z(d.getSeconds()) + ".png";
      cv.toBlob(function (b) {
        if (!b) return;
        var a = document.createElement("a"), u = URL.createObjectURL(b);
        a.href = u; a.download = nom; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(u); }, 1000);
      }, "image/png");
    }
    var pied = null, selPose = null, selIso = null, blocOeil = { id: null, vise: null };
    function dessinerTete() {
      var T = K.obsTete, Pd = K.obsPied;
      T.innerHTML = ""; Pd.innerHTML = ""; selPose = null; selIso = null;
      el("span", "pl-obs-t", T, DET === "capteur" ? TRAD("Sur le capteur") : DET === "ecran" ? TRAD("Sur l'écran") : DET === "plaque" ? TRAD("Sur la plaque de l'objet") : DET === "oeil" ? (INS ? (INS.type === "viseur" ? TRAD("Dans le viseur") : TRAD("Dans la lunette")) : TRAD("À l'œil")) : "Observation");
      if (DET) {
        var zb = el("span", "pl-obs-b", T);
        K.bouton(zb, "−", function () { zoomer(-1); }, "pl-btn-p").setAttribute("data-a3", TRAD("<b>Voir plus large</b> · molette sur l'image"));
        K.bouton(zb, "+", function () { zoomer(1); }, "pl-btn-p").setAttribute("data-a3", TRAD("<b>Agrandir</b> · molette sur l'image, autour du pointeur"));
        K.bouton(zb, DET === "capteur" ? TRAD("Tout le capteur") : DET === "oeil" ? TRAD("Tout le champ") : DET === "plaque" ? TRAD("Toute la plaque") : TRAD("Tout l'écran"), toutVoir, "pl-btn-p").setAttribute("data-a3", TRAD("<b>Tout voir</b> · double-clic sur l'image"));
        var bcd = K.bouton(zb, TRAD("Cadrer"), function () { armerCadre("image"); }, "pl-btn-p");
        bcd.setAttribute("aria-pressed", CADRE === "image" ? "true" : "false");
        bcd.setAttribute("data-a3", TRAD("<b>Cadrer</b> — puis glisser un rectangle sur l'image : zoom sur la zone · Échap : annuler"));
        if (MOT) K.bouton(zb, TRAD("Enregistrer"), enregistrerImage, "pl-btn-p").setAttribute("data-a3", TRAD("<b>Enregistrer l'image</b> — l'image affichée, en fichier PNG (sans les tracés posés dessus : barrette, tache, quadrillage)"));
      }
      // Pastilles des récepteurs : une par récepteur posé, dès qu'il y en a deux ; celle
      // qui observe allumée ; en choisir une relève d'office ceux qui sont devant elle (`escamote`, rien de stocké).
      var RS = recepteurs(st);
      if (RS.length > 1) {
        var rc = el("span", "bc-recs", T);
        RS.forEach(function (r) {
          var b = el("button", "", rc); b.type = "button";
          b.textContent = nomRecep(r, RS);
          var on = recepObserve(r);
          b.setAttribute("aria-pressed", on ? "true" : "false");
          b.setAttribute("data-a3", TRAD("<b>Récepteur</b> — choisir celui qui observe ; ceux qui sont devant lui sont relevés d'office (rabaissés quand on en choisit un autre)"));
          b.addEventListener("click", function () { st.recep = r.id; modifie("seq dessin tete bandeau"); });
        });
      }
      pied = el("span", "pl-obs-n bc-pied", Pd);
      COURBE = null; ANG = null; PHOTO = null; blocOeil = { id: null, vise: null };
      if (oeilObserve(null)) {
        var eo = SEQ.detEl, bo = el("div", "bc-bloc", Pd), bt = el("div", "bc-bloc-t", bo, Dessin.svgMini(Dessin.figure(eo)) + TRAD("<b>Œil</b>"));
        if (BAC.clair) el("span", "", bt, TRAD("à {0}", [cm(eo.z)]));
        el("span", "bc-pousse", bt);
        if (eo.id !== st.sel) K.bouton(bt, TRAD("Choisir"), function () { choisir(eo.id); modifie("dessin bandeau"); }, "pl-btn-p").title = TRAD("Faire de l'œil la pièce choisie (sur le banc).");
        var lg = el("div", "bc-bloc-l", bo);
        blocOeil = { id: eo.id, vise: reglagesOeil(lg, eo, "tete") || null };
      }
      GSPEC = null; GR.ctl.innerHTML = "";
      // Mesurer ▾ (niveaux 2 et 3, sur l'écran) : barrette, photodiode, spectromètre, exclusifs entre eux.
      if (DET === "ecran" && MOT && P().mesures) {
        var MES = [["barr", TRAD("Barrette CCD"), TRAD("la barrette CCD"), TRAD("réelle (Sony ILX511 : 2048 pixels de 14 µm, 28,7 mm, saturée à 0,8 V) ou parfaite (jusqu'à 20 cm de long au choix, pixels de 7 µm, saturation à 10 V, sans défaut d'uniformité) : la tension des pixels le long de la barrette ; on la glisse et la tourne sur l'écran")],
          ["photo", "Photodiode", TRAD("la photodiode"), TRAD("surface sensible de 1 mm de diamètre : une tension proportionnelle au flux lumineux reçu")],
          ["fibre", TRAD("Spectromètre"), TRAD("la fibre du spectromètre"), TRAD("la fibre posée sur l'écran : le spectre de la lumière en ce point")]];
        if (st.bac !== "polarisation") MES = MES.filter(function (q) { return q[0] !== "photo"; });      // la photodiode ne sert qu'à la polarisation (loi de Malus)
        var mis = MES.filter(function (q) { return st[q[0]].on; })[0];
        var bm = K.bouton(zb, mis ? mis[1] + " ▾" : TRAD("Mesurer ▾"), function () {}, "pl-btn-p bc-dm-b");
        bm.setAttribute("data-a3", TRAD("<b>Mesurer</b> — poser sur l'écran une barrette CCD, une photodiode ou la fibre d'un spectromètre (une à la fois)"));
        deroulant(bm, function () {
          return MES.map(function (q) {
            return { lab: (st[q[0]].on ? "Retirer " : "Poser ") + q[2], coche: st[q[0]].on, a3: "<b>" + q[1] + "</b> — " + q[3],
              act: function () { var on = !st[q[0]].on; st.barr.on = st.photo.on = st.fibre.on = false; st[q[0]].on = on; GR.veut = on; modifie("spec photo barr tete"); } };
          });
        });
        if (st.barr.on) { COURBE = svg("svg", { class: "bc-courbe", viewBox: "0 0 400 130" }, Pd); tCourbe = 0; blocBarrette(GR.ctl); majCourbe(); }
        if (st.photo.on) blocPhoto(GR.ctl);
        if (st.fibre.on && fibreOfferte()) blocSpec(GR.ctl);
      }
      var tg = COURBE ? "barr" : PHOTO ? "photo" : GSPEC ? "fibre" : null;      // capteur posé : son panneau s'ouvre à la pose ; plus de capteur : il se ferme
      if (tg !== GR.type) { GR.type = tg; GR.fen = null; GR.px = null; if (!tg) GR.data = null; GR.pan.basculer(!!tg); }
      GR.veut = false;
      HISTO = null;
      if (DET === "capteur") {
        var w = el("label", "bc-cur", Pd); el("span", "bc-cur-l", w, TRAD("Temps de pose"));
        selPose = el("select", "bc-sel", w);
        POSES.forEach(function (p, i) { var o = el("option", "", selPose, nomPose(i)); o.value = String(i); });
        selPose.value = String(st.pose);
        selPose.addEventListener("change", function () { st.pose = parseInt(selPose.value, 10); st.poseAuto = false; notePose = ""; FEN = fenetre(st, DET); majPied(); if (MOT) MOT.reafficher(affichage()); majHisto(); K.modifie(); });
        var wi = el("label", "bc-cur", Pd); el("span", "bc-cur-l", wi, "ISO");
        selIso = el("select", "bc-sel", wi);
        ISOS.forEach(function (v, i) { var o = el("option", "", selIso, String(v)); o.value = String(i); });
        selIso.value = String(st.iso || 0);
        wi.title = TRAD("Sensibilité : monter l'ISO éclaircit l'image sans allonger la pose, mais chaque pixel compte moins de photons : le bruit apparaît.");
        selIso.addEventListener("change", function () { st.iso = parseInt(selIso.value, 10); notePose = ""; FEN = fenetre(st, DET); majPied(); if (MOT) MOT.reafficher(affichage()); majHisto(); K.modifie(); });
        K.bouton(Pd, TRAD("Pose automatique"), function () { st.poseAuto = true; poseAuto(); }, "pl-btn-p").title = TRAD("Choisir le temps de pose d'après la lumière reçue, à l'ISO choisi.");
        var bh = K.bouton(zb, TRAD("Histogramme"), function () { st.histo = !st.histo; modifie("tete"); }, "pl-btn-p");
        bh.title = st.histo ? TRAD("Retirer l'histogramme.") : TRAD("Histogramme de la photo : combien de pixels à chaque niveau, du noir (à gauche) au blanc (à droite), pour le rouge, le vert et le bleu.");
        bh.setAttribute("aria-pressed", st.histo ? "true" : "false");
        if (st.histo) { HISTO = el("canvas", "bc-histo", Pd); HISTO.width = 400; HISTO.height = 110; majHisto(); }
      }
      majPied();
      NOTE = el("div", "bc-note-montage", Pd); noteVue = null; majNote();
    }
    // Note du montage (nom + description), tant que les pièces sont celles du montage posé (`memesPieces`).
    var NOTE = null, noteVue = null;
    function majNote() {
      if (!NOTE) return;
      var id = memesPieces(st) ? st.montage : "";
      if (id === noteVue) return;
      noteVue = id; NOTE.hidden = !id;
      NOTE.innerHTML = id ? "<b>" + K.esc(MONTAGES[id].nom) + "</b> " + K.esc(MONTAGES[id].titre) : "";
    }
    // Appareil de la barrette en cours (st.barr.reel / st.barr.L) : la réelle, ou la parfaite à la longueur choisie.
    // Toute la barrette se lit ici (longueur, pas des pixels, saturation, PRNU, graduations) — jamais BARRETTE en dur :
    // une écriture directe ne vaut que pour la barrette réelle, sans erreur.
    function appaBarr() {
      return st.barr.reel ? BARRETTE : { L: clamp(Math.round(st.barr.L) || 150, BARRETTE_PARFAITE.Lmin, BARRETTE_PARFAITE.Lmax),
        pixel: BARRETTE_PARFAITE.pixel, n: BARRETTE_PARFAITE.n, S: BARRETTE_PARFAITE.S, Usat: BARRETTE_PARFAITE.Usat, prnu: 0 };
    }
    // Fenêtre calculée de l'écran assez large pour la barrette entière (sinon des trous dans la courbe) : au choix de
    // la parfaite ou en allongeant, élargir si nécessaire (jamais resserrer : le zoom en cours reste s'il suffit).
    function elargirFenetreBarr() {
      var A = appaBarr(), o = st.obs && st.obs.ecran, z = clamp(100 / (0.52 * A.L), 1, ZOOM_ECRAN_MAX);
      if (DET === "ecran" && o.zoom > z + 1e-9) { o.zoom = z; o.cx = o.cy = 0; modifie("obs tete dessin"); }
    }
    // Barrette posée sur l'écran : boîtier (28,7 mm en réelle, la longueur choisie en parfaite) à l'échelle de la
    // fenêtre, rangée de pixels au milieu, repère « 0 » au premier pixel, graduations. Glisser : la déplacer ; poignée
    // ronde au bout : la tourner (Maj : au degré). La molette sur la barrette la tourne (5° par cran, Maj 1°,
    // Ctrl+Maj 0,1°, Ctrl 15°) ; ailleurs elle zoome l'image.
    function bouts() {
      var b = st.barr, a = b.ang * Math.PI / 180, l = appaBarr().L / 2;
      return { ux: Math.cos(a), uy: Math.sin(a), x0: b.x - l * Math.cos(a), y0: b.y - l * Math.sin(a) };
    }
    function dessinerBarrette(U, V, Wf) {
      var B = bouts(), vue = (SEQ && SEQ.vue) || [1, 1], k = 50 / Wf, ex = vue[0] * B.ux, ey = -vue[1] * B.uy;      // direction affichée
      var LL = appaBarr().L, cx = U(st.barr.x), cy = V(st.barr.y), l = LL / 2 * k + 1.2, hb = Math.max(2 * k, 1.6), nx = -ey, ny = ex;
      function P(s, t) { return pf(cx + s * ex + t * nx) + " " + pf(cy + s * ey + t * ny); }
      var g = svg("g", { class: "bc-barr", style: "cursor:grab;touch-action:none" }, surc), d = "",
        pas = LL > 60 ? 10 : 5;      // graduations en mm (traits longs tous les deux)
      svg("path", { d: "M" + P(-l, -hb) + "L" + P(l, -hb) + "L" + P(l, hb) + "L" + P(-l, hb) + "Z", fill: "#1b1f25", "fill-opacity": 0.55, stroke: "#8f99a5", "stroke-opacity": 0.8, "stroke-width": 1, "vector-effect": "non-scaling-stroke" }, g);
      svg("path", { d: "M" + P(-l + 1.2, 0) + "L" + P(l - 1.2, 0), stroke: "#63c59a", "stroke-width": 1.4, "vector-effect": "non-scaling-stroke" }, g);
      for (var m = 0; m <= LL; m += pas) { var s0 = -l + 1.2 + m * k; d += "M" + P(s0, -hb) + "L" + P(s0, -hb * (m % (2 * pas) ? 0.55 : 0.3)); }
      svg("path", { d: d, stroke: "#c9d0d6", "stroke-opacity": 0.7, "stroke-width": 0.8, "vector-effect": "non-scaling-stroke" }, g);
      svg("circle", { cx: pf(cx - (l - 1.2) * ex), cy: pf(cy - (l - 1.2) * ey), r: 0.9, fill: "#e8c36a" }, g);      // le pixel « 0 »
      // le groupe est refait à chaque déplacement : le geste est suivi par le cadre de l'observation (prB)
      g.addEventListener("pointerdown", function (ev) {
        if (ev.button) return;
        ev.preventDefault(); ev.stopPropagation(); prB = { x: ev.clientX, y: ev.clientY, bx: st.barr.x, by: st.barr.y };
        try { cvWrap.setPointerCapture(ev.pointerId); } catch (e) {}
      });
      var hx = cx + (l + 3.4) * ex, hy = cy + (l + 3.4) * ey;
      var gp = svg("circle", { class: "bc-barr-p", cx: pf(hx), cy: pf(hy), r: 1.7, fill: "#0f1317", stroke: "#63c59a", "stroke-width": 1.4, "vector-effect": "non-scaling-stroke", style: "cursor:grab;touch-action:none" }, surc);
      gp.setAttribute("data-a3", TRAD("<b>Poignée</b> de la barrette — glisser : la tourner autour de son centre (Maj : au degré)"));
      gp.addEventListener("pointerdown", function (ev) {
        if (ev.button) return;
        ev.preventDefault(); ev.stopPropagation(); prB = { tourne: true };
        try { cvWrap.setPointerCapture(ev.pointerId); } catch (e) {}
      });
    }
    // Courbe : n points le long de la barrette (abscisse 0 → 28,7 mm depuis le premier pixel), éclairement interpolé
    // (bilinéaire) dans l'accumulateur de l'écran, hors de la fenêtre calculée : rien (trou dans la courbe).
    // Tension des pixels U = S × E × temps d'intégration × (1 + PRNU), écrêtée à la saturation (plateaux) ; S selon le
    // spectre reçu. n : deux points par texel au moins, au plus les 2048 pixels.
    var COURBE = null, tCourbe = 0, BARR = { parS: 0, note: "", hors: false }, ANG = null;
    function prnu(i) { var A = appaBarr(); return A.prnu * Math.sqrt(12) * (MI_.hash32((i + 1) * 2654435761 >>> 0) / 4294967296 - 0.5); }
    function profilBarrette() {
      if (!MOT || !FEN || !MOT.stats.rayons || !MOT.traceur) return null;
      var T = MOT.traceur, res = T.res, h = 2 * FEN.W / res, X0 = FEN.cx - FEN.W, Y0 = FEN.cy - FEN.W, B = bouts(), A = appaBarr(), L = A.L;
      var n = clamp(Math.ceil(2 * L / h), 256, Math.min(A.n, Math.round(L / A.pixel))), ya = (B.y0 - Y0) / h - 0.5, yb = (B.y0 + L * B.uy - Y0) / h - 0.5;
      var j0 = clamp(Math.floor(Math.min(ya, yb)), 0, res - 1), j1 = clamp(Math.floor(Math.max(ya, yb)) + 1, 0, res - 1);
      var img = T.lire(j0, j1 - j0 + 1), aire = MOT.moteur === "onde" ? 1 : h * h, out = [], i;
      function Y(ii, jj) { return img[3 * ((jj - j0) * res + ii) + 1]; }
      for (i = 0; i < n; i++) {
        var s = (i + 0.5) * L / n, fi = (B.x0 + s * B.ux - X0) / h - 0.5, fj = (B.y0 + s * B.uy - Y0) / h - 0.5;
        if (fi < -0.5 || fj < -0.5 || fi > res - 0.5 || fj > res - 0.5) { out.push([s, null]); continue; }
        var a = clamp(Math.floor(fi), 0, res - 2), b = clamp(Math.floor(fj), j0, Math.max(j0, j1 - 1)), tx = clamp(fi - a, 0, 1), ty = j1 > b ? clamp(fj - b, 0, 1) : 0, b1 = Math.min(b + 1, j1);
        var y = (1 - ty) * ((1 - tx) * Y(a, b) + tx * Y(a + 1, b)) + ty * ((1 - tx) * Y(a, b1) + tx * Y(a + 1, b1));
        out.push([s, y / MOT.stats.rayons / aire]);
      }
      return out;
    }
    function majCourbe() {
      if (!COURBE) return;
      COURBE.innerHTML = "";
      var r = COURBE.getBoundingClientRect ? COURBE.getBoundingClientRect() : null, Lw = Math.round(r && r.width ? r.width : 400), Hh = 130, bas = Hh - 16, g0 = 34;
      COURBE.setAttribute("viewBox", "0 0 " + Lw + " " + Hh);
      var A = appaBarr(), L = A.L, UMAX = 1, pas = L > 60 ? 10 : 5;
      function U(x) { return g0 + 6 + x / L * (Lw - g0 - 12); }
      function V(u) { return bas - 1 - (bas - 8) * u / UMAX; }
      function q(v) { return (Math.round(v * 100) / 100).toString(); }
      var d = "M" + g0 + " " + bas + "H" + Lw, k;
      for (k = 0; k <= L; k += pas) {
        d += "M" + q(U(k)) + " 4V" + bas;
        svg("text", { x: q(U(k)), y: Hh - 4, "text-anchor": "middle" }, COURBE).textContent = k + (k + pas > L + 1e-9 ? " mm" : "");
      }
      svg("path", { d: d, stroke: "#2a313a", "stroke-width": 1, fill: "none" }, COURBE);
      svg("path", { d: "M" + g0 + " " + q(V(A.Usat)) + "H" + Lw, stroke: "#8a5a3a", "stroke-width": 1, "stroke-dasharray": "4 3", fill: "none" }, COURBE);
      svg("text", { x: 2, y: q(V(A.Usat) + 4) }, COURBE).textContent = fmt(A.Usat, A.Usat < 1 ? 2 : 0) + " V";
      svg("text", { x: 2, y: bas }, COURBE).textContent = "0";
      svg("title", {}, COURBE).textContent = st.barr.reel
        ? TRAD("Tension des pixels le long de la barrette ({0}), depuis son premier pixel (point jaune) ; pointillés : saturation ({1} V) ; graduations en millimètres.", [BARRETTE.nom, fmt(A.Usat, A.Usat < 1 ? 2 : 0)])
        : TRAD("Tension des pixels le long de la barrette (parfaite, {0} mm, pixels de {1} µm), depuis son premier pixel (point jaune) ; pointillés : saturation ({2} V) ; graduations en millimètres.", [fmt(L, 0), fmt(1000 * A.pixel, 0), fmt(A.Usat, A.Usat < 1 ? 2 : 0)]);
      var D = donneesBarrette();
      if (!D) { donnerGrand(null); return; }
      var dd = "", lev = true;
      D.forEach(function (p) {
        if (p[1] == null) { lev = true; return; }
        dd += (lev ? "M" : "L") + q(U(p[0])) + " " + q(V(p[1])); lev = false;
      });
      if (dd) svg("path", { d: dd, stroke: "#7fd6a0", "stroke-width": 1.3, fill: "none", "stroke-linejoin": "round" }, COURBE);
      donnerGrand({ type: "barr", x: D.map(function (p) { return p[0]; }), y: D.map(function (p) { return p[1]; }), plein: [0, L], ymax: 1.05 * A.Usat, sat: A.Usat, satTxt: fmt(A.Usat, A.Usat < 1 ? 2 : 0) + " V",
        xlab: TRAD("position le long de la barrette (mm)"), xu: " mm", dx: 2, minw: 0.5, fmtY: function (v) { return fmt(v, 3) + " V"; }, couleur: "#7fd6a0",
        note: TRAD("Tension des pixels le long de la barrette.") + (st.barr.reel ? " " + BARRETTE.nom + "."
            : TRAD(" Barrette parfaite : {0} mm de long, pixels de {1} µm, saturation à {2} V, sans PRNU — bien plus longue, plus fine et plus de dynamique que la réelle.", [fmt(L, 0), fmt(1000 * A.pixel, 0), fmt(A.Usat, 0)]))
          + TRAD(" Molette sur le profil : resserrer ou élargir la fenêtre autour du pointeur ; le pointeur donne la position."),
        csv: { nom: "barrette.csv", entetes: ["position_mm", "eclairement_lux", "tension_V"], lignes: D.filter(function (p) { return p[1] != null; }).map(function (p) { return [p[0], p[2], p[1]]; }) } });
    }
    // Tension des pixels le long de la barrette : [position (mm), tension (V) ou null hors de l'image, éclairement (lx)].
    function donneesBarrette() {
      var pf_ = profilBarrette();
      if (!pf_) return null;
      var A = appaBarr(), S = sensBarrette(SEQ), t = INTEG[st.integ] * 1e-3, Em = 0, hors = false, out = [];
      pf_.forEach(function (p) {
        if (p[1] == null) { out.push([p[0], null, null]); hors = true; return; }
        var u = Math.min(A.Usat, Math.max(0, S * p[1] * t * (1 + prnu(Math.floor(p[0] / A.pixel)))));
        if (p[1] > Em) Em = p[1];
        out.push([p[0], u, p[1]]);
      });
      BARR.parS = S * Em; BARR.hors = hors;
      return out;
    }
    function blocBarrette(Pd) {
      var l = el("div", "bc-bloc-l", Pd);
      // Barrette réelle ou parfaite (comme le spectromètre du banc) : la parfaite est plus longue, plus fine, plus de
      // dynamique ; on en règle la longueur. Le panneau est refait par le seg (le slider n'existe qu'en parfaite).
      seg(l, [[true, TRAD("réel"), BARRETTE.nom], [false, TRAD("parfait"), BARRETTE_PARFAITE.nom]], !!st.barr.reel, function (v) {
        st.barr.reel = v; GR.fen = null;
        BARR.note = v ? "" : TRAD("saturation 12,5 fois plus haute (10 V) : « Intégration automatique » en profite");
        elargirFenetreBarr(); modifie("barr tete");
      });
      if (!st.barr.reel) {
        var rl = el("label", "bc-reg", l); el("span", "", rl, TRAD("Longueur"));
        var il = el("input", "", rl); il.type = "range"; il.min = BARRETTE_PARFAITE.Lmin; il.max = BARRETTE_PARFAITE.Lmax; il.step = 5;
        var ol = el("output", "", rl);
        rl.title = TRAD("Longueur de la barrette parfaite, posée sur un écran de 20 cm de côté.");
        il.value = String(Math.round(st.barr.L)); ol.textContent = fmt(st.barr.L, 0) + " mm";
        il.addEventListener("input", function () { st.barr.L = parseInt(il.value, 10); ol.textContent = il.value + " mm"; elargirFenetreBarr(); modifie("barr"); });
      }
      var ra = el("label", "bc-reg", l); el("span", "", ra, "Angle");
      var ia = el("input", "", ra); ia.type = "range"; ia.min = 0; ia.max = 359; ia.step = 1;
      var oa = el("output", "", ra);
      ra.title = TRAD("Orientation de la barrette sur l'écran (ou sa poignée ronde, sur l'image).");
      ANG = { sync: function () { ia.value = String(Math.round(st.barr.ang)); oa.textContent = fmt(st.barr.ang, st.barr.ang % 1 ? 1 : 0) + "°"; } };
      ANG.sync();
      ia.addEventListener("input", function () { st.barr.ang = parseFloat(ia.value); oa.textContent = ia.value + "°"; modifie("barr"); });
      var sel = selListe(l, TRAD("Intégration"), INTEG.map(function (v, i) { return nomInteg(i); }), st.integ, function (i) { st.integ = i; BARR.note = ""; majCourbe(); majPied(); K.modifie(); },
        TRAD("Durée pendant laquelle les pixels accumulent la lumière avant d'être lus : la tension est proportionnelle à l'éclairement × cette durée, jusqu'à la saturation."));
      K.bouton(l, TRAD("Intégration automatique"), function () {
        var i = integVoulue(BARR.parS, 0.75 * appaBarr().Usat);
        BARR.note = !(BARR.parS > 0) ? TRAD("aucune lumière sur la barrette") : i < 0 ? TRAD("trop de lumière, même à {0} : poser une densité neutre", [nomInteg(0)]) : "";
        st.integ = Math.max(0, i); sel.value = String(st.integ); majCourbe(); majPied(); K.modifie();
      }, "pl-btn-p").title = TRAD("Choisir la durée d'intégration qui amène le pixel le plus éclairé aux trois quarts de la saturation.");
    }
    // ================= photodiode =================
    // Posée sur l'écran d'un clic (exclusive de la fibre du spectromètre). Flux = éclairement moyen des texels de
    // l'accumulateur dont le centre est dans son disque (le texel le plus proche si le disque est plus petit qu'un
    // texel) × π r² ; éclairement d'un texel = Y / (nombre de passes ou de rayons) / aire, comme `eclairement()` du
    // moteur (aire du texel en rayons, 1 en onde : les deux en lux). Tension = calibre × réponse du silicium au spectre
    // reçu × flux (`gainPhotodiode`), écrêtée à U_SAT.
    var PHOTO = null, tPhoto = 0;
    function fluxPhoto() {
      if (!MOT || !FEN || !MOT.stats.rayons || !MOT.traceur) return null;
      var T = MOT.traceur, res = T.res, h = 2 * FEN.W / res, x0 = FEN.cx - FEN.W, y0 = FEN.cy - FEN.W, p = st.photo, r = R_PD;
      var i0 = clamp(Math.floor((p.x - r - x0) / h), 0, res - 1), i1 = clamp(Math.floor((p.x + r - x0) / h), 0, res - 1);
      var j0 = clamp(Math.floor((p.y - r - y0) / h), 0, res - 1), j1 = clamp(Math.floor((p.y + r - y0) / h), 0, res - 1);
      if ((p.x + r - x0) / h < 0 || (p.x - r - x0) / h > res || (p.y + r - y0) / h < 0 || (p.y - r - y0) / h > res) return 0;
      var img = T.lire(j0, j1 - j0 + 1), aire = MOT.moteur === "onde" ? 1 : h * h, s = 0, n = 0, i, j;
      for (j = j0; j <= j1; j++) for (i = i0; i <= i1; i++) {
        var dx = x0 + (i + 0.5) * h - p.x, dy = y0 + (j + 0.5) * h - p.y;
        if (dx * dx + dy * dy <= r * r) { s += img[3 * ((j - j0) * res + i) + 1]; n++; }
      }
      if (!n) { i = clamp(Math.floor((p.x - x0) / h), 0, res - 1); j = clamp(Math.floor((p.y - y0) / h), 0, res - 1); s = img[3 * ((j - j0) * res + i) + 1]; n = 1; }
      return s / n / MOT.stats.rayons / aire * Math.PI * r * r;
    }
    function texteTension(u) {
      if (u == null) return "…";
      var a = Math.abs(u);
      return a >= 1 ? fmt(u, a >= 10 ? 1 : 2) + " V" : a >= 1e-3 ? fmt(1e3 * u, a >= 0.1 ? 0 : a >= 0.01 ? 1 : 2) + " mV" : fmt(1e6 * u, a >= 1e-4 ? 0 : a >= 1e-5 ? 1 : 2) + " µV";
    }
    // Les orientations des pièces polarisantes du banc, dans l'ordre : le libellé d'une mesure notée au cahier.
    function orientations() {
      return st.elements.filter(function (e) { return C.TYPES[e.type].polarisant; }).sort(function (a, b) { return a.z - b.z; })
        .map(function (e) { return (e.type === "lame" ? PIECES[e.cle].court : "P") + " " + fmt((e.rot || 0) * 180 / Math.PI, 1) + "°"; }).join(", ");
    }
    // Courbe U(θ), θ = orientation de la pièce choisie (polariseur ou lame) : un point à chaque image au repos (le même
    // angle remplace son point) ; elle repart de zéro dès que change autre chose que cet angle (autre pièce choisie,
    // pièce déplacée, photodiode déplacée…). Hors de l'état : ni sauvée, ni annulée (Ctrl+Z).
    var SERIE = { cle: "", pts: [] };
    function cleSerie(e) {
      return JSON.stringify([st.bac, optq(), st.photo.x, st.photo.y, e.id, st.elements.map(function (q) { return [q.id, q.z, q.x, q.y, q.id === e.id ? 0 : q.rot, q.params, q.incl]; })]);
    }
    function tourneChoisie() { var e = selEl(); return e && (e.type === "polariseur" || e.type === "lame") ? e : null; }
    function majPhoto() {
      if (!PHOTO) return;
      var f = MOT && MOT.etat !== "repos" && !MOT.stats.rayons ? null : fluxPhoto(), sat = false;
      PHOTO.u = f == null ? null : gainPhotodiode(SEQ, st.photo.cal) * f;
      if (PHOTO.u > U_SAT) { PHOTO.u = U_SAT; sat = true; }
      PHOTO.val.textContent = sat ? TRAD("saturée ({0} V)", [U_SAT]) : texteTension(PHOTO.u) + (MOT && MOT.etat !== "repos" ? " …" : "");
      var e = tourneChoisie();
      if (e && PHOTO.u != null && MOT && MOT.etat === "repos") {
        var k = cleSerie(e), a = Math.round((e.rot || 0) * 1800 / Math.PI) / 10;
        if (k !== SERIE.cle) SERIE = { cle: k, pts: [], nom: nomDe(e) };
        SERIE.pts = SERIE.pts.filter(function (q) { return Math.abs(q[0] - a) > 0.05; }); SERIE.pts.push([a, PHOTO.u]);
        SERIE.pts.sort(function (p, q) { return p[0] - q[0]; });
      }
      courbePhoto(e);
    }
    function courbePhoto(e) {
      var G = PHOTO.svg; if (!G) return;
      G.innerHTML = "";
      var r = G.getBoundingClientRect ? G.getBoundingClientRect() : null, Lw = Math.round(r && r.width ? r.width : 400), Hh = 130, bas = Hh - 18, g0 = 30;
      G.setAttribute("viewBox", "0 0 " + Lw + " " + Hh);
      var pts = e && SERIE.cle === cleSerie(e) ? SERIE.pts : [];
      var lame = e && e.type === "lame";
      PHOTO.aide.textContent = !e ? TRAD("Choisir un polariseur ou une lame sur le banc, puis le tourner : la tension se trace en fonction de son angle.")
        : pts.length < 2 ? TRAD("Tourner {0} (molette sur sa miniature ou curseur du bandeau) : un point par angle.", [lame ? TRAD("la lame") : TRAD("le polariseur")])
        : lame ? TRAD("Tension en fonction de l'angle de la lame choisie ; « Noter » ajoute la valeur au cahier.")
          : TRAD("Tension en fonction de l'angle du polariseur choisi ; « Noter » ajoute la valeur au cahier.");
      var a0 = -180, a1 = 180;
      if (pts.length) { a0 = Math.floor(pts[0][0] / 30) * 30; a1 = Math.ceil(pts[pts.length - 1][0] / 30) * 30; if (a1 - a0 < 90) { var m = (a0 + a1) / 2; a0 = Math.floor((m - 45) / 30) * 30; a1 = a0 + 90; } }
      var um = 0; pts.forEach(function (q) { um = Math.max(um, q[1]); }); um = um > 0 ? um * 1.1 : 1;
      function U(a) { return g0 + 8 + (a - a0) / (a1 - a0) * (Lw - g0 - 24); }
      function V(u) { return bas - u / um * (bas - 8); }
      function q(v) { return (Math.round(v * 10) / 10).toString(); }
      var d = "M" + g0 + " " + bas + "H" + (Lw - 4) + "M" + g0 + " 4V" + bas, pas = a1 - a0 > 180 ? 60 : 30;
      for (var a = a0; a <= a1; a += pas) { d += "M" + q(U(a)) + " " + bas + "v3"; svg("text", { x: q(U(a)), y: Hh - 4, "text-anchor": "middle" }, G).textContent = fmt(a) + "°"; }
      svg("path", { d: d, stroke: "#2a313a", "stroke-width": 1, fill: "none" }, G);
      svg("text", { x: 4, y: 12 }, G).textContent = pts.length ? texteTension(um / 1.1) : "U";
      svg("text", { x: 4, y: bas }, G).textContent = "0";
      if (pts.length > 1) svg("path", { d: "M" + pts.map(function (p) { return q(U(p[0])) + " " + q(V(p[1])); }).join("L"), stroke: "#7fd6a0", "stroke-width": 1, fill: "none", opacity: 0.55 }, G);
      pts.forEach(function (p) { svg("circle", { cx: q(U(p[0])), cy: q(V(p[1])), r: 2.4, fill: "#7fd6a0" }, G); });
      donnerGrand(pts.length ? { type: "photo", x: pts.map(function (p) { return p[0]; }), y: pts.map(function (p) { return p[1]; }), plein: [a0, a1], ymax: um, xlab: "angle " + (lame ? TRAD("de la lame") : TRAD("du polariseur")) + " (°)", xu: "°", dx: 1, minw: 5,
        points: true, fmtY: texteTension, couleur: "#7fd6a0", note: PHOTO.aide.textContent,
        csv: { nom: "photodiode.csv", entetes: ["angle_deg", "tension_V"], lignes: pts.map(function (p) { return [p[0], p[1]]; }) } }
        : { type: "photo", vide: PHOTO.aide.textContent });
    }
    function blocPhoto(Pd) {
      var bo = el("div", "bc-bloc bc-photo-b", Pd), bt = el("div", "bc-bloc-t", bo, Dessin.svgMini({ med: "photodiode" }) + "<b>Photodiode</b>");
      var val = el("span", "bc-photo-v", bt, "…");
      el("span", "bc-pousse", bt);
      var bn = K.bouton(bt, TRAD("Noter"), function () {
        if (!PHOTO || PHOTO.u == null || (MOT && MOT.etat !== "repos")) return;
        var o = orientations(), mv = Math.abs(PHOTO.u) >= 1e-3, v = (mv ? 1e3 : 1e6) * PHOTO.u;
        st.cahier.push({ lib: "photodiode" + (o ? " (" + o + ")" : ""), val: nb(String(+v.toPrecision(3))), u: mv ? "mV" : "µV", inc: "" });
        K.modifie(); if (CA && CA.redessiner) CA.redessiner();
      }, "pl-btn-p");
      bn.title = TRAD("Ajouter la tension au cahier de mesures, avec l'orientation des polariseurs et des lames du banc.");
      var lc = el("div", "bc-bloc-l", bo);
      selListe(lc, TRAD("Résistance"), CALIBRES.map(function (v, i) { return nomCalibre(i); }), st.photo.cal, function (i) { st.photo.cal = i; SERIE = { cle: "", pts: [] }; majPhoto(); K.modifie(); },
        TRAD("Le courant de la photodiode traverse cette résistance : la tension lue est proportionnelle à la résistance, jusqu'à la saturation de l'amplificateur ({0} V).", [U_SAT]));
      var sv = svg("svg", { class: "bc-courbe", viewBox: "0 0 400 130" }, bo);
      svg("title", {}, sv).textContent = TRAD("Tension de la photodiode en fonction de l'angle de la pièce choisie.");
      var aide = el("div", "bc-bloc-l", bo, "");
      el("div", "bc-bloc-l", bo, TRAD("Cliquer sur l'écran pour y poser la photodiode."));
      PHOTO = { val: val, u: null, svg: sv, aide: aide }; tPhoto = 0; majPhoto();
    }
    // ================= spectromètre à fibre =================
    // Fibre posée sur l'écran (un clic sur l'observation la place), spectre sous l'observation. Calcul sur un traceur à
    // part (contexte WebGL2 et accumulateur à lui), quand l'image est au repos :
    //  - rayons : passes du tracé direct, chaque rayon détecté dans la fibre rangé dans la case de sa longueur d'onde
    //    (`spe` du cœur : spectreCPU, même tri dans le shader) ; le bruit s'efface passe après passe ;
    //  - ondes : éclairement à la fibre longueur d'onde par longueur d'onde (`ondeSpectre` sur la carte) ; continu, un
    //    seul plan diffractant : SPEC_NL longueurs d'onde de la fenêtre (ordre bit-inversé : la courbe se remplit du
    //    grossier au fin) ; somme brute (plusieurs plans) : les strates du plan seulement (une λ y coûte une propagation
    //    par point source) ; raies : les leurs. Plusieurs tours (strates de la source décalées, ou lots de points).
    // Affichage : raies = gaussiennes (largeur de la raie et résolution), continu = densité lissée par la résolution,
    // rapporté au maximum. Appareil PARFAIT ou RÉEL, comme les capteurs du Michelson (réel : le doublet du sodium n'est
    // pas séparé).
    var FIBRES = { parfait: { r: 0.025, res: 0.02, nom: TRAD("spectromètre parfait : fibre de 50 µm, résolution 0,02 nm") },
      reel: { r: 0.2, res: 1.5, nom: TRAD("spectromètre fibré réel (type Ocean Optics) : fibre de 400 µm, résolution 1,5 nm") } };
    var ZOOMS = { na: [587.6, 591.0], hg: [536, 556], laser: [631.8, 633.8], laserVert: [531, 533] };      // fenêtre resserrée sur les raies
    var SPEC_NB = 200, SPEC_NL = 120, SPEC_PASSES = 400, SPEC_TOURS = 4, SPEC_NP = 8;
    // ----- aide « Rayons vers un point » -----
    // Sélection en avant puis rejeu : passes de RET.Nr rayons sur le traceur de l'image (impacts relus rayon par rayon,
    // `rayons`), une tranche de 15 ms par image et jamais pendant un aperçu ; les rayons détectés dans un petit disque
    // autour du point cliqué (RET_ZONE de la demi-largeur affichée : un seul pixel n'en recevrait presque aucun) sont
    // gardés jusqu'à RET_CANDS ; RET_N d'entre eux, tirés au poids, sont rejoués sur le processeur (`C.rejouer`) sur le
    // MÊME objet séquence que la carte (`MOT.seqTrace`, guide compris : sinon d'autres rayons, sans erreur). Un rayon que
    // le processeur ne retrouve pas dans le disque (flottants : un rayon qui frôle un bord) est laissé.
    var RET = null, RET_N = 24, RET_ZONE = 0.03, RET_CANDS = 400, RET_GRAINE = 11;
    function cleRet() { return [st.pointObs.x, st.pointObs.y, DET, FEN.W, FEN.cx, FEN.cy].join("|"); }
    function retourTick() {
      if (!st.aides.rebours || !DET || !FEN || !SEQ || !SEQ.source || !st.pointObs) { if (RET) { RET = null; sale.dessin = true; } return; }
      var a = RET, neuf = !a || a.seq !== SEQ || a.cle !== cleRet();
      if (!neuf && a.fini) return;
      if (MOT.seq !== SEQ || MOT.etat === "apercu") return;
      if (neuf) {
        a = RET = { seq: SEQ, cle: cleRet(), fini: false, raison: null, rayons: [], cands: [], passe: 0, laisses: 0 };
        sale.dessin = true;
        if (MOT.moteur === "onde" || !MOT.seqTrace) {
          a.fini = true;
          a.raison = MOT.moteur === "onde" ? TRAD("Figure de diffraction ou d'interférences : la lumière n'y suit plus des rayons.") : TRAD("Pas de lumière tracée vers l'observation.");
          majPied(); return;
        }
        a.sq = MOT.seqTrace; a.emb = MOT.emb; a.zone = { x: st.pointObs.x, y: st.pointObs.y, r: RET_ZONE * FEN.W };
        a.fen = { W: FEN.W, cx: FEN.cx, cy: FEN.cy }; a.Nr = logiciel ? 1 << 14 : 1 << 18; a.max = logiciel ? 4 : 32;
        majPied();
      }
      var t0 = maintenant(), T = MOT.traceur;
      do {
        a.passe++;
        C.retenir(T.rayons(a.sq, a.emb, { Nr: a.Nr, graine: RET_GRAINE, passe: a.passe, W: a.fen.W, cx: a.fen.cx, cy: a.fen.cy }), a.zone, a.passe, a.cands);
      } while (a.cands.length < RET_CANDS && a.passe < a.max && maintenant() - t0 < 15);
      if (a.cands.length < RET_CANDS && a.passe < a.max) return;
      C.choisir(a.cands, RET_N, RET_GRAINE).forEach(function (c) {
        var r = C.rejouer(a.sq, RET_GRAINE, c.p, c.k, a.Nr);
        if (r.etat === "detecte" && Math.hypot(r.x - a.zone.x, r.y - a.zone.y) < 1.5 * a.zone.r) a.rayons.push(r); else a.laisses++;
      });
      a.fini = true; a.sq = a.emb = null;
      if (!a.rayons.length) a.raison = TRAD("Aucune lumière n'arrive en ce point.");
      sale.dessin = true; majPied();
    }
    var SPC = null, T2 = null, GSPEC = null, tSpec = 0, SPECR = { parS: 0, note: "" };
    function appareil() { return st.fibre.reel ? FIBRES.reel : FIBRES.parfait; }
    // Spectromètre offert dans les deux moteurs (en tracé des rayons, lumière blanche : lissage adapté au nombre de
    // rayons reçus, `lissageSpec`, dit au pied). Point d'entrée gardé pour le restreindre au besoin.
    function fibreOfferte() { return !!MOT; }
    function spectreVisible() { return !!(MOT && DET === "ecran" && st.fibre.on && fibreOfferte()); }
    function fenetreSpec(seq) { var z = st.fibre.zoom && ZOOMS[seq.source.nomSpectre]; return z ? z.slice() : [380, 780]; }
    function cleSpc() { var f = st.fibre; return [f.x, f.y, f.reel, f.zoom, MOT ? MOT.moteur : "", FEN ? [FEN.W, FEN.cx, FEN.cy].join(",") : ""].join("|"); }
    // Spectre continu en tracé des rayons : bruit relatif des cases estimé par l'écart entre cases voisines (médiane,
    // sur les cases éclairées ; la pente vraie du spectre y est négligeable à 200 cases), puis g = la plus petite
    // largeur de moyenne (puissance de 2, au plus 16 cases) qui le ramène sous 3 %. gRes : la largeur que lisse déjà
    // la résolution de l'appareil. g > gRes : le spectre affiché est plus lissé que l'appareil ne le ferait.
    function lissageSpec(s) {
      var nb = SPEC_NB, db = (s.fen[1] - s.fen[0]) / nb, gRes = Math.max(1, s.res / db), c = s.cases, d = [], som = 0, n = 0;
      for (var i = 0; i < nb; i++) if (c[i] > 0) { som += c[i]; n++; if (i + 1 < nb && c[i + 1] > 0) d.push(Math.abs(c[i + 1] - c[i])); }
      if (s.raies || n < 4 || !d.length) return { g: 1, gRes: gRes, nm: 0 };
      d.sort(function (a, b) { return a - b; });
      var r1 = d[d.length >> 1] / (0.954 * Math.SQRT2) / (som / n), g = 1;      // médiane |écart| = 0,954 σ√2 (gaussienne)
      while (g < 16 && r1 / Math.sqrt(g) > 0.03) g *= 2;
      return { g: g, gRes: gRes, nm: g * db };
    }
    function bitInverse(n) {
      var b = 1; while ((1 << b) < n) b++;
      var out = [];
      for (var i = 0; i < (1 << b); i++) { var r = 0; for (var k = 0; k < b; k++) if (i & (1 << k)) r |= 1 << (b - 1 - k); if (r < n) out.push(r); }
      return out;
    }
    function traceurSpec() {
      if (T2 === null) { try { T2 = C.creerTraceurGL(root.document.createElement("canvas"), {}) || false; } catch (e0) { T2 = false; } }
      return T2 || null;
    }
    function nouveauSpc() {
      var seq = SEQ, sp = seq.source.sp, ap = appareil(), fen = fenetreSpec(seq), onde = MOT.moteur === "onde", T = traceurSpec();
      if (!T) return null;
      var s = { seq: seq, cle: cleSpc(), onde: onde, raies: sp.type === 1, fen: fen, r: ap.r, res: ap.res, fini: false, tours: 1 };
      if (!onde) {
        // Tracé GUIDÉ par la fenêtre affichée quand le moteur en a un (MOT.seqTrace, appris pour l'image : rayons concentrés
        // vers ce qu'on regarde, poids corrigés, sans biais) : zoomer sur la fibre y fait arriver bien plus de rayons.
        s.sq = MOT.seq === seq && MOT.seqTrace ? MOT.seqTrace : seq; s.cases = new Float64Array(s.raies ? sp.n : SPEC_NB); s.passes = 0;
        s.emb = s.sq === seq ? C.emballer(seq) : MOT.emb; s.fenT = FEN ? { W: FEN.W, cx: FEN.cx, cy: FEN.cy } : { W: 1, cx: 0, cy: 0 };
        s.Nr = logiciel ? 1 << 15 : 1 << 19; s.max = logiciel ? 8 : SPEC_PASSES;
        T.dimensionner(256); T.raz();
        return s;
      }
      var pl = C.ondePlan(seq, { maxCellules: 1 << 18, maxPoints: vq("oFinPts"), ouvertures: seq.optique !== "parfaite" });
      if (!pl.ok) pl = MOT.plan;
      if (!pl || !pl.ok) return null;
      var brute = !pl.laser && pl.planes.length > 1, ls = [], i;
      if (s.raies) sp.l.forEach(function (l, j) { if (l >= fen[0] && l <= fen[1]) ls.push({ l: l, j: j }); });
      else if (brute) pl.lambdas.forEach(function (w) { if (w[0] >= fen[0] && w[0] <= fen[1]) ls.push({ l: w[0], j: 0 }); });
      else {
        var a = Math.max(fen[0], sp.a), b = Math.min(fen[1], sp.b), n = logiciel ? 40 : SPEC_NL;
        if (b > a) bitInverse(n).forEach(function (k) { ls.push({ l: a + (b - a) * (k + 0.5) / n, j: 0 }); });
      }
      s.pl = pl; s.ps = C.planSpectre(pl); s.ls = ls; s.somme = ls.map(function () { return 0; }); s.n = ls.map(function () { return 0; });
      s.i = 0; s.tour = 0; s.brute = brute;
      if (brute && ls.length) {
        s.ps.lambdas = [[ls[0].l, [1, 1, 1]]];
        var pr = C.ondeProgramme(s.ps, C.rendreSpectre({ x: st.fibre.x, y: st.fibre.y, r: s.r, np: SPEC_NP }));
        s.tours = Math.max(1, Math.ceil(pr.paires / SPEC_NP));
      } else s.tours = pl.laser ? 1 : (logiciel ? 2 : SPEC_TOURS);
      return s;
    }
    // Un peu de calcul à chaque image (budget en ms), l'image d'abord.
    function specTick() {
      if (!spectreVisible() || !SEQ || !SEQ.source) { SPC = null; return; }
      if (MOT.etat !== "repos") return;
      if (!SPC || SPC.seq !== SEQ || SPC.cle !== cleSpc()) { SPC = nouveauSpc(); tSpec = 0; majSpec(); }
      if (!SPC || SPC.fini) return;
      var t0 = maintenant(), T = T2, f = st.fibre;
      do {
        if (!SPC.onde) {
          T.passe(SPC.sq, SPC.emb, { res: 256, W: SPC.fenT.W, cx: SPC.fenT.cx, cy: SPC.fenT.cy, Nr: SPC.Nr, graine: 3, passe: SPC.passes + 1, spe: { x: f.x, y: f.y, r: SPC.r, la: SPC.fen[0], lb: SPC.fen[1], nb: SPEC_NB } });
          SPC.passes++;
          var g = T.lire(0, 1); for (var b = 0; b < SPC.cases.length; b++) SPC.cases[b] = g[3 * b];
          // arrêt : plafond de passes, ou (spectre continu) bruit sous 3 % à la résolution de l'appareil
          if (SPC.passes >= SPC.max || (!SPC.raies && SPC.passes % 16 === 0 && lissageSpec(SPC).g <= lissageSpec(SPC).gRes)) SPC.fini = true;
        } else {
          if (!SPC.ls.length) { SPC.fini = true; break; }
          var L = SPC.ls[SPC.i], o = { x: f.x, y: f.y, r: SPC.r, l: L.l, ns: 8, graine: 3, passe: SPC.brute ? SPC.tour : SPC.tour + 1, np: SPC.brute ? SPEC_NP : 0 };
          SPC.somme[SPC.i] += T.ondeSpectre(SPC.ps, o); SPC.n[SPC.i]++;
          if (++SPC.i >= SPC.ls.length) { SPC.i = 0; if (++SPC.tour >= SPC.tours) SPC.fini = true; }
        }
      } while (!SPC.fini && maintenant() - t0 < 10);
      if (SPC.fini || maintenant() - tSpec > 250) { tSpec = maintenant(); majSpec(); if (SPC.fini) majPied(); }
    }
    // Densité spectrale sur nx points de la fenêtre (unités du moteur, éclairement par nm), ou null.
    function profilSpec(nx) {
      var s = SPC, seq = s.seq, sp = seq.source.sp, f0 = s.fen[0], f1 = s.fen[1], px = (f1 - f0) / nx, out = new Float64Array(nx), i, k;
      var aire = Math.PI * s.r * s.r, sr = s.res / 2.3548200450309493;
      if (s.raies) {
        var Sd = MI.spectreDe(seq.source.nomSpectre) || {}, rs = Sd.raies || [], E = [];
        if (s.onde) s.ls.forEach(function (L, q) { if (s.n[q]) E.push([L.l, L.j, s.somme[q] / s.n[q] * C.poidsSpectre(seq, L.l, L.j)]); });
        else if (s.passes) for (k = 0; k < sp.n; k++) E.push([sp.l[k], k, s.cases[k] / (s.passes * s.Nr * aire)]);
        if (!E.length) return null;
        E.forEach(function (e) {
          var r = rs[e[1]] || {}, lw = Sd.profil === "mono" ? 0 : (r.largeur != null ? r.largeur : Sd.largeur || 0), sl = lw / 2.3548200450309493;
          var sg = Math.max(Math.sqrt(sr * sr + sl * sl), 0.6 * px);      // une raie plus fine qu'un point de la courbe reste visible
          for (i = 0; i < nx; i++) { var x = (f0 + (i + 0.5) * px - e[0]) / sg; if (x * x < 50) out[i] += e[2] * Math.exp(-0.5 * x * x) / (Math.sqrt(2 * Math.PI) * sg); }
        });
        return out;
      }
      var xs = [], ys = [];
      if (s.onde) {
        s.ls.forEach(function (L, q) { if (s.n[q]) xs.push([L.l, s.somme[q] / s.n[q] * C.poidsSpectre(seq, L.l, 0)]); });
        xs.sort(function (a, b) { return a[0] - b[0]; });
        ys = xs.map(function (x) { return x[1]; }); xs = xs.map(function (x) { return x[0]; });
      } else if (s.passes) {
        var db = (f1 - f0) / SPEC_NB, Lz = lissageSpec(s), cg = s.cases;
        if (Lz.g > 1) {                        // peu de rayons : moyenne glissante sur g cases (affichée au pied)
          cg = new Float64Array(SPEC_NB);
          for (k = 0; k < SPEC_NB; k++) { var a3 = 0, n3 = 0; for (var q3 = k - (Lz.g >> 1); q3 < k - (Lz.g >> 1) + Lz.g; q3++) if (q3 >= 0 && q3 < SPEC_NB) { a3 += s.cases[q3]; n3++; } cg[k] = a3 / n3; }
        }
        for (k = 0; k < SPEC_NB; k++) { xs.push(f0 + (k + 0.5) * db); ys.push(cg[k] / (s.passes * s.Nr * aire * db)); }
      }
      if (xs.length < 2) return null;
      var j = 0;
      for (i = 0; i < nx; i++) {               // interpolation linéaire (nulle hors des échantillons : hors de la source)
        var l = f0 + (i + 0.5) * px;
        while (j < xs.length - 2 && xs[j + 1] < l) j++;
        out[i] = l < xs[0] || l > xs[xs.length - 1] ? 0 : ys[j] + (ys[j + 1] - ys[j]) * (l - xs[j]) / (xs[j + 1] - xs[j]);
      }
      var sp2 = sr / px;                       // lissage par la résolution de l'appareil, quand elle dépasse un point
      if (sp2 > 0.5) {
        var lis = new Float64Array(nx), h = Math.ceil(3 * sp2);
        for (i = 0; i < nx; i++) { var a2 = 0, w2 = 0; for (k = -h; k <= h; k++) { var q2 = i + k; if (q2 < 0 || q2 >= nx) continue; var wk = Math.exp(-0.5 * k * k / (sp2 * sp2)); a2 += wk * out[q2]; w2 += wk; } lis[i] = a2 / w2; }
        out = lis;
      }
      return out;
    }
    function couleurL(l) {
      var c = MI.rgbLin(MI.cie(l)), m = Math.max(c[0], c[1], c[2], 1e-9), v = [0, 1, 2].map(function (q) { return Math.round(255 * Math.pow(Math.max(0, c[q] / m), 1 / 2.2)); });
      var k = l < 420 ? Math.max(0.25, (l - 380) / 40) : l > 680 ? Math.max(0.25, (780 - l) / 100) : 1;
      return "rgb(" + v.map(function (x) { return Math.round(x * k); }).join(",") + ")";
    }
    function majSpec() {
      if (!GSPEC) return;
      GSPEC.innerHTML = "";
      var r = GSPEC.getBoundingClientRect ? GSPEC.getBoundingClientRect() : null, Lw = Math.round(r && r.width ? r.width : 400), Hh = 130, bas = Hh - 22;
      GSPEC.setAttribute("viewBox", "0 0 " + Lw + " " + Hh);
      var fen = SEQ && SEQ.source ? fenetreSpec(SEQ) : [380, 780], f0 = fen[0], f1 = fen[1];
      function U(l) { return 6 + (l - f0) / (f1 - f0) * (Lw - 12); }
      function q(v) { return (Math.round(v * 100) / 100).toString(); }
      var n = 48, gr = "";
      for (var i = 0; i < n; i++) { var l0 = f0 + (f1 - f0) * i / n; gr += '<rect x="' + q(U(l0)) + '" y="' + (bas + 1) + '" width="' + q((Lw - 12) / n + 0.5) + '" height="4" fill="' + couleurL(l0 + (f1 - f0) / (2 * n)) + '"/>'; }
      GSPEC.insertAdjacentHTML("beforeend", gr);
      var w = f1 - f0, pas = w > 200 ? 50 : w > 60 ? 10 : w > 15 ? 2 : 0.5, d = "M0 " + bas + "H" + Lw;
      for (var g = Math.ceil(f0 / pas) * pas; g <= f1 + 1e-9; g += pas) {
        d += "M" + q(U(g)) + " 4V" + bas;
        var der = g + pas > f1 + 1e-9;           // la dernière graduation porte l'unité, calée à droite (sinon coupée au bord)
        svg("text", { x: q(der && U(g) > Lw - 30 ? Lw - 2 : U(g)), y: Hh - 4, "text-anchor": der && U(g) > Lw - 30 ? "end" : "middle" }, GSPEC).textContent = fmt(g, pas < 1 ? 1 : 0) + (der ? " nm" : "");
      }
      svg("path", { d: d, stroke: "#2a313a", "stroke-width": 1, fill: "none" }, GSPEC);
      svg("title", {}, GSPEC).textContent = st.fibre.reel ? TRAD("Spectre de la lumière reçue par la fibre : comptes des pixels du spectromètre (saturation à 65 535) ; graduations en nanomètres.")
        : TRAD("Spectre de la lumière reçue par la fibre : densité spectrale (par nanomètre), rapportée à son maximum ; graduations en nanomètres.");
      // réel : comptes = densité × comptesSpec × temps d'intégration + bruit (obscurité, photons), écrêtés à
      // 65 535 ; échelle fixe, ligne de saturation. Parfait : rapporté au maximum.
      var reel = !!st.fibre.reel, tI = INTEG[st.fibre.t] * 1e-3;
      if (reel) {
        var ys = bas - 1 - (bas - 8) / 1.08;
        svg("path", { d: "M0 " + q(ys) + "H" + Lw, stroke: "#8a5a3a", "stroke-width": 1, "stroke-dasharray": "4 3", fill: "none" }, GSPEC);
        svg("text", { x: 4, y: q(ys - 3) }, GSPEC).textContent = TRAD("65 535 comptes");
      }
      if (!SPC) {                              // le spectre attend que l'image soit au repos (image fine finie)
        var att = T2 === false ? "" : TRAD("le spectre se calcule une fois l'image finie…");
        if (att) svg("text", { x: Lw / 2, y: bas / 2, "text-anchor": "middle" }, GSPEC).textContent = att;
        donnerGrand(att ? { type: "fibre", vide: TRAD("Le spectre se calcule une fois l'image finie.") } : null); return;
      }
      var nx = GR.pan.ouvert() ? 1600 : Math.max(100, Math.min(800, Lw - 12)), D = donneesSpec(nx, f0, f1), Pf = D && D.Pf, m = D ? D.m : 0, k;
      if (!D) { donnerGrand(null); return; }
      if (D.vide) {
        svg("text", { x: Lw / 2, y: bas / 2, "text-anchor": "middle" }, GSPEC).textContent = SPC.fini ? TRAD("aucune lumière dans la fibre") : TRAD("en attente de rayons dans la fibre…");
        donnerGrand({ type: "fibre", vide: SPC.fini ? TRAD("Aucune lumière dans la fibre.") : TRAD("Calcul en cours…") }); return;
      }
      var pts = [];
      for (k = 0; k < nx; k++) pts.push(q(U(f0 + (k + 0.5) * (f1 - f0) / nx)) + " " + q(bas - 1 - (bas - 8) * Pf[k] / m));
      svg("path", { d: "M" + q(U(f0)) + " " + (bas - 1) + "L" + pts.join("L") + "L" + q(U(f1)) + " " + (bas - 1), stroke: "#e8c36a", "stroke-width": 1.3, fill: "rgba(232,195,106,0.12)", "stroke-linejoin": "round" }, GSPEC);
      var xv = [], yv = [];
      for (k = 0; k < nx; k++) { xv.push(f0 + (k + 0.5) * (f1 - f0) / nx); yv.push(reel ? Pf[k] : Pf[k] / m); }
      donnerGrand({ type: "fibre", x: xv, y: yv, plein: [f0, f1], ymax: reel ? 1.08 * SPEC_SAT : 1.05, sat: reel ? SPEC_SAT : null, satTxt: TRAD("65 535 comptes"),
        xlab: TRAD("longueur d'onde (nm)"), xu: " nm", dx: (f1 - f0) < 100 ? 2 : 1, minw: Math.max(0.2, (f1 - f0) / 400), aire: true, spectre: true, couleur: "#e8c36a",
        fmtY: function (v) { return reel ? fmt(v, 0) : fmt(v, 2); }, ylab: reel ? "comptes" : TRAD("intensité relative"),
        note: (reel ? TRAD("Comptes des pixels du spectromètre (saturation à 65 535).") : TRAD("Densité spectrale rapportée à son maximum."))
          + TRAD(" Molette sur le spectre : resserrer ou élargir la fenêtre autour du pointeur ; le pointeur donne la longueur d'onde."),
        csv: { nom: "spectre.csv", entetes: ["longueur_onde_nm", reel ? "comptes" : "intensite_relative"], lignes: xv.map(function (x, i) { return [x, yv[i]]; }) } });
    }
    // Spectre sur nx points de la fenêtre [f0, f1] : { Pf, m (le haut de l'échelle), vide }, ou null tant qu'il n'y a pas de profil.
    // Réel : comptes = densité × comptesSpec × temps d'intégration + bruit (obscurité, photons), écrêtés à 65 535.
    function donneesSpec(nx, f0, f1) {
      var reel = !!st.fibre.reel, tI = INTEG[st.fibre.t] * 1e-3, Pf = profilSpec(nx), m = 0, k;
      if (!Pf) return null;
      if (reel) {
        SPECR.parS = 0;
        for (k = 0; k < nx; k++) {
          var lk = f0 + (k + 0.5) * (f1 - f0) / nx, ps = Pf[k] * comptesSpec(lk, SPC.r), c = ps * tI;
          if (ps > SPECR.parS) SPECR.parS = ps;
          var gk = Math.sqrt(12) * (MI_.hash32((k + 7) * 2246822519 >>> 0) / 4294967296 - 0.5);
          Pf[k] = Math.min(SPEC_SAT, Math.max(0, c + gk * Math.sqrt(SPEC_OBS * SPEC_OBS + SPEC_NOIR * tI + c)));
        }
        m = 1.08 * SPEC_SAT;
      } else for (k = 0; k < nx; k++) if (Pf[k] > m) m = Pf[k];
      return { Pf: Pf, m: m, vide: !(m > 0) || (reel && !(SPECR.parS > 0)) };
    }

    function blocSpec(Pd) {
      var f = st.fibre, bo = el("div", "bc-spec", Pd), l = el("div", "bc-bloc-l", bo);
      seg(l, [[false, TRAD("parfait"), FIBRES.parfait.nom], [true, TRAD("réel"), FIBRES.reel.nom]], !!f.reel, function (v) { f.reel = v; modifie("spec tete"); });
      if (SEQ && SEQ.source && ZOOMS[SEQ.source.nomSpectre]) seg(l, [[false, "380 – 780 nm"], [true, TRAD("sur les raies"), TRAD("Fenêtre resserrée autour des raies de la source.")]], !!f.zoom, function (v) { f.zoom = v; modifie("spec tete"); });
      el("span", "bc-spec-n", l, TRAD("Cliquer sur l'écran pour y poser la fibre."));
      GSPEC = svg("svg", { class: "bc-courbe", viewBox: "0 0 400 130" }, bo);
      if (f.reel) {
        var li = el("div", "bc-bloc-l", bo), sel = selListe(li, TRAD("Intégration"), INTEG.map(function (v, i) { return nomInteg(i); }), f.t, function (i) { f.t = i; SPECR.note = ""; majSpec(); majPied(); K.modifie(); },
          TRAD("Durée pendant laquelle les pixels du spectromètre accumulent la lumière : les comptes lui sont proportionnels, jusqu'à 65 535."));
        K.bouton(li, TRAD("Intégration automatique"), function () {
          var i = integVoulue(SPECR.parS, 0.8 * SPEC_SAT);
          SPECR.note = !(SPECR.parS > 0) ? TRAD("aucune lumière dans la fibre") : i < 0 ? TRAD("trop de lumière, même à {0} : poser une densité neutre", [nomInteg(0)]) : "";
          f.t = Math.max(0, i); sel.value = String(f.t); majSpec(); majPied(); K.modifie();
        }, "pl-btn-p").title = TRAD("Choisir la durée d'intégration qui amène le pic le plus haut à 80 % de la saturation.");
      }
      majSpec();
    }
    // ================= capteur en grand =================
    // Panneau flottant « Capteur » de la coque, comme au Michelson : le graphe en grand de la barrette, de la photodiode ou
    // du spectromètre (la petite courbe du pied reste), pointeur = lecture de l'abscisse et de la valeur, molette sur le
    // graphe = resserrer ou élargir la fenêtre autour du pointeur, export CSV des valeurs calculées. Les petits dessins
    // (`majCourbe`, `courbePhoto`, `majSpec`) donnent leurs données par `donnerGrand` : un seul calcul. La fenêtre vit hors
    // de l'état (ni sauvée, ni annulée). Ouvert quand on pose un capteur ; × le ferme sans retirer le capteur.
    var GR = { pan: K.panneau("pl-capteur", TRAD("Capteur"), { libre: true }), data: null, fen: null, px: null, type: null, veut: false, geo: null };
    (function () {
      GR.pan.el.classList.add("pl-cap-grand", "bc-capteur");
      // Deux places : ANCRÉ sous l'écran, à sa largeur (défaut : on lit la courbe en regardant l'image), ou FLOTTANT sur toute la
      // paillasse (déplaçable par la barre de titre, redimensionnable par le coin) pour l'agrandir. Le bouton de la barre de titre bascule.
      GR.dock = true;
      GR.bPlace = el("button", "pl-pan-x pl-pan-b", GR.pan.el.querySelector(".pl-pan-t"));
      GR.bPlace.type = "button";
      GR.pan.el.querySelector(".pl-pan-t").insertBefore(GR.bPlace, GR.pan.el.querySelector(".pl-pan-x"));
      GR.placer = function () {
        var pe = GR.pan.el;
        pe.style.left = pe.style.top = pe.style.right = pe.style.bottom = pe.style.width = pe.style.height = "";      // position et taille du mode précédent
        pe.classList.toggle("pl-dock", GR.dock); pe.classList.toggle("pl-flot", !GR.dock);
        if (GR.dock) K.obsPied.parentNode.insertBefore(pe, K.obsPied); else K.racine.appendChild(pe);
        GR.bPlace.textContent = GR.dock ? TRAD("⇱ Flotter") : TRAD("⇲ Sous l'écran");
        GR.bPlace.title = GR.dock ? TRAD("Détacher la fenêtre : la placer où on veut sur la paillasse et l'agrandir par son coin.") : TRAD("Ranger la fenêtre sous l'écran, à sa largeur.");
        tracerGrand();
      };
      GR.bPlace.addEventListener("click", function () { GR.dock = !GR.dock; GR.placer(); });
      GR.svg = svg("svg", { class: "bc-grand", viewBox: "0 0 640 240" }, GR.pan.corps);
      GR.placer();
      if (root.ResizeObserver) new root.ResizeObserver(function () { tracerGrand(); }).observe(GR.svg);
      GR.pied = el("div", "pl-cap-pied", GR.pan.corps);
      GR.ctl = el("div", "pl-cap-ctl", GR.pan.corps);      // réglages du capteur posé (angle, intégration, résistance…) : sous la courbe, dans les deux positions
      GR.bFen = K.bouton(GR.pied, TRAD("Fenêtre entière"), function () { GR.fen = null; tracerGrand(); }, "pl-btn-p");
      GR.bCsv = K.bouton(GR.pied, TRAD("Exporter (CSV)"), function () {
        var o = csvGrand();
        if (!o) { GR.bCsv.title = TRAD("Pas encore de courbe à exporter."); return; }
        if (!K.exporterCsv(o.nom, o.entetes, o.lignes)) GR.bCsv.title = TRAD("Export impossible dans ce navigateur.");
      }, "pl-btn-p");
      GR.bCsv.title = TRAD("Les valeurs calculées de la courbe, en fichier .csv à lire avec Python (point décimal, séparateur virgule).");
      GR.note = el("span", "pl-cap-n", GR.pied, "");
      GR.pan.surBascule = function (ouv) { if (ouv) { if (COURBE) majCourbe(); if (PHOTO) majPhoto(); if (GSPEC) majSpec(); tracerGrand(); } };
      GR.svg.addEventListener("pointermove", function (ev) { GR.px = ev.clientX - GR.svg.getBoundingClientRect().left; tracerGrand(); });
      GR.svg.addEventListener("pointerleave", function () { GR.px = null; tracerGrand(); });
      // molette sur le graphe (coque : pas accumulés) : un cran = ×1,4 sur la largeur de la fenêtre, vers le haut = resserrer
      // (fige: false : le zoom du graphe ne vaut que sur le graphe, pas une seconde après l'avoir quitté)
      var MOL_GRAND = function (k, ev) { for (var n = Math.abs(k); n > 0; n--) molGrand(k > 0 ? -1 : 1, ev); };
      MOL_GRAND.fige = false;
      K.cibleMolette(function (t) { return t && GR.svg.contains(t) ? MOL_GRAND : null; });
    })();
    function donnerGrand(d) { GR.data = d; tracerGrand(); }
    function csvGrand() { var c = GR.data && GR.data.csv; return c && c.lignes.length ? c : null; }
    function molGrand(sg, ev) {
      var D = GR.data, G = GR.geo;
      if (!D || D.vide || !G) return;
      var f = GR.fen || D.plein, w0 = f[1] - f[0], pw = D.plein[1] - D.plein[0], r = GR.svg.getBoundingClientRect();
      var u = clamp((ev.clientX - r.left - G.x0) / (G.x1 - G.x0), 0, 1), w = clamp(w0 * (sg > 0 ? 1.4 : 1 / 1.4), Math.min(D.minw || pw, pw), pw);
      var a = clamp(f[0] + u * w0 - u * w, D.plein[0], D.plein[1] - w);
      GR.fen = w >= pw - 1e-9 ? null : [a, a + w];
      tracerGrand();
    }
    function pasBeau(etendue, n) {
      var p = Math.pow(10, Math.floor(Math.log10(etendue / n))), r = etendue / n / p;
      return p * (r < 1.5 ? 1 : r < 3.5 ? 2 : r < 7.5 ? 5 : 10);
    }
    function tracerGrand() {
      if (!GR.pan.ouvert()) return;
      var S = GR.svg, D = GR.data, rc = S.getBoundingClientRect ? S.getBoundingClientRect() : null, W = Math.round(rc && rc.width ? rc.width : 640), H = Math.round(rc && rc.height ? rc.height : 240);
      S.innerHTML = ""; S.setAttribute("viewBox", "0 0 " + W + " " + H);
      GR.note.textContent = D && D.note || "";
      if (!D || D.vide || !D.x) { svg("text", { x: W / 2, y: H / 2, "text-anchor": "middle", fill: "#7f8996", "font-size": 12 }, S).textContent = D && D.vide ? D.vide : "…"; GR.geo = null; return; }
      if (GR.fen && (GR.fen[0] < D.plein[0] - 1e-9 || GR.fen[1] > D.plein[1] + 1e-9)) GR.fen = null;
      var x0 = 62, x1 = W - 10, y1 = 12, y0 = H - 36, f = GR.fen || D.plein, a = f[0], b = f[1], i;
      GR.geo = { x0: x0, x1: x1 };
      function X(v) { return x0 + (v - a) / (b - a) * (x1 - x0); }
      function Y(v) { return y0 - clamp(v / D.ymax, 0, 1.02) * (y0 - y1); }
      function q(v) { return (Math.round(v * 10) / 10).toString(); }
      var T = { fill: "#8f99a5", "font-size": 10.5, "font-family": "system-ui, sans-serif" };
      var pas = pasBeau(b - a, Math.max(4, Math.round((x1 - x0) / 80))), dec = pas < 1 ? Math.min(3, Math.ceil(-Math.log10(pas) - 1e-9)) : 0, v, d = "M" + x0 + " " + y0 + "H" + x1 + "M" + x0 + " " + y1 + "V" + y0;
      for (v = Math.ceil(a / pas - 1e-9) * pas; v <= b + 1e-9 * pas; v += pas) {
        d += "M" + q(X(v)) + " " + y0 + "v3";
        svg("text", Object.assign({ x: q(X(v)), y: y0 + 15, "text-anchor": "middle" }, T), S).textContent = fmt(Math.abs(v) < 1e-9 * pas ? 0 : v, dec);
      }
      var py = pasBeau(D.ymax, 4);
      for (v = 0; v <= D.ymax + 1e-9 * py; v += py) {
        d += "M" + x0 + " " + q(Y(v)) + "h-3";
        svg("text", Object.assign({ x: x0 - 6, y: q(Y(v) + 3.5), "text-anchor": "end" }, T), S).textContent = D.fmtY(v);
      }
      svg("path", { d: d, stroke: "#3a414a", "stroke-width": 1, fill: "none" }, S);
      svg("text", Object.assign({ x: x1, y: H - 4, "text-anchor": "end" }, T), S).textContent = D.xlab;
      if (D.ylab) svg("text", Object.assign({ x: x0 + 4, y: y1 + 8 }, T), S).textContent = D.ylab;
      if (D.spectre) {      // la couleur de chaque longueur d'onde, sous l'axe
        var nb = 60; for (i = 0; i < nb; i++) svg("rect", { x: q(x0 + (x1 - x0) * i / nb), y: y0 + 1, width: q((x1 - x0) / nb + 0.5), height: 3, fill: couleurL(a + (b - a) * (i + 0.5) / nb) }, S);
      }
      if (D.sat != null) {
        svg("path", { d: "M" + x0 + " " + q(Y(D.sat)) + "H" + x1, stroke: "#8a5a3a", "stroke-width": 1, "stroke-dasharray": "4 3", fill: "none" }, S);
        svg("text", Object.assign({ x: x1 - 4, y: q(Y(D.sat) - 4), "text-anchor": "end" }, T), S).textContent = D.satTxt;
      }
      var dx = D.dx || 0, dd = "", lev = true, X0 = [];
      for (i = 0; i < D.x.length; i++) {
        if (D.x[i] < a - 1e-9 - (b - a) / 40 || D.x[i] > b + 1e-9 + (b - a) / 40) { lev = true; continue; }
        if (D.y[i] == null) { lev = true; continue; }
        dd += (lev ? "M" : "L") + q(X(D.x[i])) + " " + q(Y(D.y[i])); lev = false; X0.push(i);
      }
      if (dd) {
        if (D.aire && X0.length > 1) svg("path", { d: dd + "L" + q(X(D.x[X0[X0.length - 1]])) + " " + y0 + "L" + q(X(D.x[X0[0]])) + " " + y0 + "Z", fill: "rgba(232,195,106,0.12)", stroke: "none" }, S);
        svg("path", { d: dd, stroke: D.couleur, "stroke-width": 1.3, fill: "none", "stroke-linejoin": "round", opacity: D.points ? 0.55 : 1 }, S);
      }
      if (D.points) X0.forEach(function (j) { svg("circle", { cx: q(X(D.x[j])), cy: q(Y(D.y[j])), r: 3, fill: D.couleur }, S); });
      // lecture au pointeur : l'abscisse et la valeur au point le plus proche
      if (GR.px != null && GR.px >= x0 && GR.px <= x1) {
        var xv = a + (GR.px - x0) / (x1 - x0) * (b - a), best = -1, dm = Infinity;
        for (i = 0; i < D.x.length; i++) if (D.y[i] != null && Math.abs(D.x[i] - xv) < dm) { dm = Math.abs(D.x[i] - xv); best = i; }
        svg("path", { d: "M" + q(GR.px) + " " + y0 + "V" + y1, stroke: "#e8c45a", "stroke-opacity": 0.8, "stroke-dasharray": "3 3", fill: "none" }, S);
        var t = fmt(xv, dec + 1) + (D.xu || "") + (best >= 0 && !D.points || best >= 0 && dm < (b - a) / 20 ? " · " + D.fmtY(D.y[best]) : ""), bw = t.length * 6.4 + 10, bx = clamp(GR.px + 6, x0, x1 - bw);
        svg("rect", { x: q(bx), y: y1, width: q(bw), height: 17, fill: "rgba(13,16,19,.88)" }, S);
        svg("text", { x: q(bx + 5), y: y1 + 12, fill: "#e8c45a", "font-size": 11.5, "font-family": "system-ui, sans-serif" }, S).textContent = t;
      }
    }
    function fmtLum(L) {
      if (L >= 1e4 || L < 0.01) { var e = Math.floor(Math.log10(L)), m = L / Math.pow(10, e); if (m >= 9.95) { m = 1; e++; }
        return fmt(m, 1) + " × 10" + String(e).replace("-", "⁻").replace(/\d/g, function (c) { return "⁰¹²³⁴⁵⁶⁷⁸⁹"[c]; }) + " cd/m²"; }
      return (L >= 100 ? nbEntier(L) : fmt(L, L >= 1 ? 1 : 3)) + " cd/m²";
    }
    // Deux avis distincts. « Calcul lourd » : coût PRÉDIT par le plan de l'image fine (C.coutOnde, le même sur toute
    // machine), expliqué par ce qui le fait : plusieurs plans qui diffractent en lumière non laser, d'où une propagation
    // par point de la source et par couleur. « Aperçu lent » : temps MESURÉ de l'aperçu (stats.apercuMs) pendant un
    // geste, qui dépend de la machine ; il ne dit jamais que le montage est lourd.
    var APERCU_LENT = 120;
    function avisCalcul() {
      if (!MOT || MOT.moteur !== "onde") return "";
      var c = MOT.stats.cout, t = "";
      if (c && c.lourd) {
        var noms = [];
        c.plans.forEach(function (i) { var pr = SEQ && SEQ.prims[i], e = pr && trouver(st, pr.el), n = e && PIECES[e.type] ? PIECES[e.type].nom : ""; if (n && noms.indexOf(n) < 0) noms.push(n); });
        t += TRAD(" · calcul lourd : la lumière traverse {0} plans qui la diffractent{1} ; chaque point de la source, à chaque couleur, y demande alors sa propre propagation, {2} pour l'image fine, qui sera longue à venir",
          [c.plans.length, noms.length ? " (" + noms.join(", ").toLowerCase() + ")" : "", nbEntier(c.propagations)]);
      }
      if (MOT.etat !== "repos" && MOT.stats.apercuMs > APERCU_LENT) t += TRAD(" · aperçu lent sur cette machine : le menu Rendu (Rapide) l'allège");
      return t;
    }
    function majPied() {
      if (!pied) return;
      if (!DET || !FEN) { pied.textContent = ""; return; }
      var t = DET === "capteur" ? (FEN.W >= 0.5 ? TRAD("Largeur affichée : {0} mm ({1} pixels)", [fmt(2 * FEN.W, 1), st.obs.capteur.N])
          : TRAD("Largeur affichée : {0} µm ({1} pixels)", [fmt(2000 * FEN.W), st.obs.capteur.N]))
        : DET === "oeil" ? TRAD("Champ affiché : {0}°", [fmt(2 * Math.atan(FEN.W / RETINE) * 180 / Math.PI, FEN.W < 1.5 ? 1 : 0)]) + (INS ? "" : TRAD(" · image vue à l'endroit"))
        : (FEN.W >= 5 ? TRAD("Largeur affichée : {0} cm", [fmt(FEN.W / 5, FEN.W >= 50 ? 0 : 1)]) : TRAD("Largeur affichée : {0} mm", [fmt(2 * FEN.W, 1)]));
      if (DET === "ecran") t += TRAD(" · écran vu du côté de la lumière");
      if (DET === "ecran" && st.barr.on) t += " · " + (st.barr.reel ? TRAD("barrette réelle (28,7 mm, saturation 0,8 V)")
          : TRAD("barrette parfaite ({0} mm, saturation 10 V)", [fmt(appaBarr().L, 0)]))
        + TRAD(" : intégration {0}, courbe lue dans l'image (texel de {1} µm : agrandir l'écran l'affine)", [nomInteg(st.integ), Math.round(2000 * FEN.W / (MOT && MOT.traceur ? MOT.traceur.res : 512))])
        + (BARR.hors ? TRAD(" · une partie de la barrette est hors de l'image affichée") : "") + (BARR.note ? " · " + BARR.note : "");
      if (st.aides.spot && SPOT && SPOT.raison) t += TRAD(" · tache : {0}", [SPOT.raison]);
      else if (st.aides.spot && SPOT && SPOT.taches && !SPOT.centre) t += TRAD(" · tache : aucun rayon de ce point n'arrive sur le détecteur");
      if (DET === "plaque") t += TRAD(" · face blanche de la plaque, vue du côté du miroir");
      if (MOT) t += MOT.moteur === "onde" ? TRAD(" · calcul ondulatoire") : TRAD(" · tracé des rayons");
      // le calcul ondulatoire suit les lentilles au paraxial, sur l'axe : décentrement et inclinaison n'y entrent pas
      if (MOT && MOT.moteur === "onde" && st.elements.some(function (q) { var n = neutre(q, P()); return q.type === "lentille" && !escamote(st, q) && (n.x || n.y || (n.incl && n.incl[0])); }))
        t += TRAD(" · (lentille décentrée ou inclinée : le calcul ondulatoire la prend sur l'axe)");
      t += avisCalcul();
      if (MOT && MOT.etat !== "repos") t += TRAD(" · image en cours d'affinage");
      else if (MOT && MOT.stats.vision && DET !== "capteur") {
        var VS = MOT.stats.vision, laAff = lumq() !== "visible" && MOT.stats.adaptLa, relaxe = lumq() !== "visible" && MOT.relax;
        t += VS.visible ? TRAD(" · œil adapté à {0}", [fmtLum(laAff || VS.La)]) + (relaxe ? TRAD(" (vers {0})", [fmtLum(VS.La)]) : "") +
          TRAD(" (pupille {0} mm)", [fmt(VS.D, 1)]) : TRAD(" · trop peu de lumière pour l'œil");
      }
      if (DET === "capteur" && notePose) t += " · " + notePose;
      if (st.aides.rebours && RET && RET.seq === SEQ && !RET.fini) t += TRAD(" · rayons vers le point : recherche en cours");
      if (spectreVisible()) {
        t += TRAD(" · fibre en ({0} ; {1}) mm, {2}", [fmt(st.fibre.x, 2), fmt(st.fibre.y, 2), appareil().nom])
          + (st.fibre.reel ? TRAD(", intégration {0}", [nomInteg(st.fibre.t)]) + (SPECR.note ? " · " + SPECR.note : "") : "")
          + (SPC && !SPC.onde && !SPC.raies && SPC.passes ? (function (Lz) { return Lz.g > Lz.gRes ? TRAD(" · peu de rayons dans la fibre : spectre lissé sur {0} nm (zoomer sur la fibre en apporte plus)", [fmt(Lz.nm, 0)]) : ""; })(lissageSpec(SPC)) : "");
        if (SPC && !SPC.fini) t += TRAD(" · spectre en cours");
        if (T2 === false) t += TRAD(" · spectromètre indisponible (pas de seconde carte graphique WebGL2)");
      }
      pied.textContent = t;
    }
    // Histogramme du capteur : la photo telle que l'affiche le shader (mode 2 de FS_AFF : voile d'objectif,
    // bruit de photons et de lecture, balance halogène, écrêtage à la saturation, courbe sRGB), recalculée ici sur les
    // texels de la fenêtre qui tombent sur le capteur (6,4 × 4,8 mm), au repos seulement ; 128 niveaux par couleur,
    // rouge, vert et bleu superposés en addition (gris là où ils se recouvrent) ; échelle sur le plus haut pic hors des
    // deux extrêmes ; triangle allumé en haut à gauche ou à droite : pixels bouchés au noir ou saturés (> 0,5 %).
    var HISTO = null, BAL_H = MI_.balance();
    function majHisto() {
      if (!HISTO || !MOT || !FEN || DET !== "capteur" || MOT.etat !== "repos" || !MOT.stats.rayons) return;
      var T = MOT.traceur, res = T.res, img = T.lire(), h = 2 * FEN.W / res, nR = MOT.stats.rayons, aire = MOT.moteur === "onde" ? 1 : h * h;
      var k = FEN.expo / nR / aire, ph = FEN.photo, sX = 0, sY = 0, sZ = 0, i, j, c;
      for (i = 0; i < img.length; i += 3) { sX += img[i]; sY += img[i + 1]; sZ += img[i + 2]; }
      var kv = ph.voile * h * h / ph.aire, vo = [sX * kv * k, sY * kv * k, sZ * kv * k];
      var bl = MI_.xyzSpectre(MI_.SPECTRES.bl), blanc = [bl[0] / bl[1], 1, bl[2] / bl[1]], NB = 128, H = [new Float64Array(NB), new Float64Array(NB), new Float64Array(NB)], n = 0;
      var bas = [0, 0], g = 1;
      function gauss() { g = (g * 16807) % 2147483647; var u = (g + 0.5) / 2147483648; g = (g * 16807) % 2147483647; var v = (g + 0.5) / 2147483648; return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307 * v); }
      for (j = 0; j < res; j++) {
        var y = FEN.cy - FEN.W + (j + 0.5) * h; if (Math.abs(y) > 2.4) continue;
        for (i = 0; i < res; i++) {
          var x = FEN.cx - FEN.W + (i + 0.5) * h; if (Math.abs(x) > 3.2) continue;
          var q = 3 * (j * res + i), v = [img[q] * k + vo[0], img[q + 1] * k + vo[1], img[q + 2] * k + vo[2]];
          var f = Math.max(0, 1 + Math.sqrt(FEN.bruit / Math.max(v[1], 1e-12)) * gauss()), gl = ph.lect * gauss();
          for (c = 0; c < 3; c++) v[c] = Math.max(0, v[c] * f + blanc[c] * gl);
          var r = MI_.rgbLin(v); r = [r[0] / BAL_H[0], r[1] / BAL_H[1], r[2] / BAL_H[2]];
          if (r[0] < 0) { var ad = MI_.BLANC_HG * -r[0]; r = [r[0] + ad, r[1] + ad, r[2] + ad]; }
          var sat = false, noir = true;
          for (c = 0; c < 3; c++) { var s1 = MI_.gammaS(r[c]); if (r[c] >= 1) sat = true; if (s1 > 0.5 / 255) noir = false; H[c][Math.min(NB - 1, Math.floor(s1 * NB))]++; }
          if (noir) bas[0]++; if (sat) bas[1]++; n++;
        }
      }
      var ctx = HISTO.getContext("2d"), Wd = HISTO.width, Hd = HISTO.height, m = 0;
      ctx.clearRect(0, 0, Wd, Hd); ctx.fillStyle = "#14181d"; ctx.fillRect(0, 0, Wd, Hd);
      if (!n) return;
      for (c = 0; c < 3; c++) for (i = 1; i < NB - 1; i++) m = Math.max(m, H[c][i]);
      if (!(m > 0)) for (c = 0; c < 3; c++) m = Math.max(m, H[c][0], H[c][NB - 1]);
      ctx.globalCompositeOperation = "lighter";
      ["rgb(190,60,60)", "rgb(60,170,70)", "rgb(60,90,200)"].forEach(function (col, c2) {
        ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, Hd);
        for (var b = 0; b < NB; b++) { var yb = Hd - 2 - Math.min(1, H[c2][b] / m) * (Hd - 10); ctx.lineTo(b * Wd / NB, yb); ctx.lineTo((b + 1) * Wd / NB, yb); }
        ctx.lineTo(Wd, Hd); ctx.closePath(); ctx.fill();
      });
      ctx.globalCompositeOperation = "source-over";
      [[0, bas[0]], [1, bas[1]]].forEach(function (t) {
        var x0 = t[0] ? Wd - 4 : 4, s2 = t[0] ? -1 : 1, on = t[1] > 0.005 * n;
        ctx.fillStyle = on ? (t[0] ? "#fff" : "#6aa0ff") : "#3a4048"; ctx.beginPath(); ctx.moveTo(x0, 4); ctx.lineTo(x0 + 10 * s2, 4); ctx.lineTo(x0, 14); ctx.closePath(); ctx.fill();
      });
      HISTO.title = TRAD("Histogramme de la photo ({0} points) : {1} % de pixels saturés, {2} % au noir.", [nbEntier(n), Math.round(100 * bas[1] / n), Math.round(100 * bas[0] / n)]);
    }
    // Pose automatique (capteur) : une fois l'image fine accumulée, d'après le 99e centile de l'éclairement reçu.
    // notePose : ce que la pose automatique n'a pas pu faire (aucune lumière, ou trop peu même à la pose la plus longue).
    var notePose = "";
    // Trop de lumière à la pose la plus courte (tv : pose voulue à l'ISO choisi) : baisser l'ISO d'abord (le plus haut
    // qui ne sature plus à POSES[0]), une densité neutre ensuite.
    function remedeLumiere(tv) {
      var iso = isoDe(st), ok = ISOS.filter(function (v) { return v < iso && tv * iso / v >= POSES[0]; });
      if (ok.length) return TRAD("baisser l'ISO ({0} ou moins)", [ok[ok.length - 1]]);
      return iso > ISOS[0] ? TRAD("baisser l'ISO à {0} et poser une densité neutre devant le capteur", [ISOS[0]]) : TRAD("poser une densité neutre devant le capteur");
    }
    // provisoire : pendant l'aperçu et l'image fine (au plus toutes les 250 ms), la pose suit déjà l'éclairement mesuré
    // sans lever st.poseAuto ; sinon un montage posé reste à la pose de départ, surexposé, jusqu'à la fin de l'image fine
    // (plusieurs secondes sur une petite tache). Le réglage définitif (et la note du pied) se fait au repos.
    var tPoseProv = 0;
    function poseAuto(provisoire) {
      if (!st.poseAuto || DET !== "capteur" || !MOT) return;
      if (provisoire) {
        if (MOT.etat === "repos" || maintenant() - tPoseProv < 250) return;
        tPoseProv = maintenant();
        var Ep = MOT.eclairement(); if (!(Ep > 0)) return;
        var pv = poseVoulue(Ep, isoDe(st)); if (pv === st.pose) return;
        st.pose = pv; FEN = fenetre(st, DET); MOT.reafficher(affichage()); if (selPose) selPose.value = String(st.pose);
        return;
      }
      if (MOT.etat !== "repos") return;
      var E = MOT.eclairement();
      st.poseAuto = false;
      var tv = E > 0 ? CIBLE_POSE / (K_CAPTEUR * isoDe(st) / 100 * E) : 0;
      notePose = !(E > 0) ? TRAD("aucune lumière sur le capteur") : tv > 2 * POSES[POSES.length - 1] ? TRAD("trop sombre, même à {0} : monter l'ISO", [nomPose(POSES.length - 1)])
        : tv < POSES[0] / 2 ? TRAD("trop de lumière, même à {0} : {1}", [nomPose(0), remedeLumiere(tv)]) : "";
      majPied();
      if (!(E > 0)) return;
      st.pose = poseVoulue(E, isoDe(st)); FEN = fenetre(st, DET); MOT.reafficher(affichage()); majHisto();
      if (selPose) selPose.value = String(st.pose);
      K.modifie();
    }

    // ================= bandeau du haut : trois lignes fines =================
    // Ligne 1 : commandes ; ligne 2 : aides en bascules (seules celles qui ont un sens) ; ligne 3 : ce que font les gestes
    // sur ce que survole la souris (sans survol : la pièce choisie). Ce qui s'affiche passe par le profil P() (majProfil).
    // Bandeau, menus déroulants, clic droit, ligne des gestes et panneau « ? » : ceux de la coque (K.bandeau, K.deroulant,
    // K.ouvrirCtx, K.gestes, K.panneauGestes) ; ici, ce que le banc y met.
    var BOUT = {}, BH = K.bandeau(), L1 = BH.l1, L2 = BH.l2;
    // Deux panneaux ouverts vers le haut au-dessus du banc depuis la rangée des tiroirs,
    // de MÊME taille fixe (rien ne saute quand on passe de l'un à l'autre ou d'un onglet à l'autre) :
    // - Matériels (nom du matériel, quand on peut en changer : mode prof, site public) : une carte par matériel, aperçu
    //   d'une figure qu'on y obtient et ce qu'on peut y faire ; un clic change de matériel (son banc repris tel quel).
    // - Montages : matériels en onglets en tête (mêmes conditions), colonnes par thème, description du montage survolé
    //   en bas ; un montage d'un autre matériel change aussi l'étagère (changerBac puis appliquer). Au niveau 1, sans
    //   ceux qui exigent l'optique réelle ou posent une mesure (montagePermis, au niveau du matériel de l'onglet).
    // Aperçus : captures du banc (luminosité « toujours visible », 144 px), montage nommé par APERCU_DE.
    var APERCUS = {
    revisions: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBAUEBAYFBQUGBgYHCQ4JCQgICRINDQoOFRIWFhUSFBQXGiEcFxgfGRQUHScdHyIjJSUlFhwpLCgkKyEkJST/2wBDAQYGBgkICREJCREkGBQYJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCT/wAARCACQAJADASIAAhEBAxEB/8QAHQABAAICAwEBAAAAAAAAAAAAAAEIAwcEBgkCBf/EADkQAAEDAgIFBwoHAQAAAAAAAAABAgMEBQYRBwgSITElQXSRk7PSExYyUVJUYqHC0RQnNDVWZHGS/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKqAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABIGamo56tythikkVOKMaq5dRmntFbTsV8lNO1qb1VY3IifI3tqlRImIL07nWgZ3qG69M8W1osxK1c1zpPrYBRLgQZaluzM9PUqmIAAAAAAAAAAAAAAAAASnEglOIFidUpOXrz0Fneobq0yt/K7EnRPraaY1SU5dvPQGd6huvTI1V0XYjT+p9bQKH1qZVD/9U45zrhC5Kh65LxU4asVOZQPkEkAAAAAAAAAAAAAAAlvEglvECx2qT++3joDO9QsbiSwU2KLDW2arkljp6yPyb3RZI5EzRd2eacxXLVK3X28dAZ3qFjMR3+nwvYa281ccskFHH5R7YstpUzRN2e7nA1hJqu4QldtOuN5zX44/CYZNVbBqovKN6/7j8Bnk1ocIxOVHW68bvgj8Rgk1qMHNReTrzw9iPxgVp0q4TpMF43utkoJJpKakmSON0yor1TYau/JETnOnncNKuLKTGmN7re6COaKmq5kkjZMiI9E2GpvyVU4op08AAAAAAAAAAAAAAEt4kEpxAsbqlLy7eOgM71DdemN2Wi/EeXun1tNI6pbsr9eegs71De2k22Vl8wDe7dQU76iqqKfYjiZ6T122rkmf+AUPuErvLv3rxOE57l51No1egjHksrnJhm4b19TPEcZdAOP/AOM3DqZ4gNaKQbJdoC0gJwwzcOpniOqYrwTfsF1MNNfbbPQSzsWSNsuWbm55Zpkq84H4IAAAAAAAAAAAAAShAAsLqlSouIL01OKUDO9Qs+j803ovUecdLWz0bldDLJGq8dlypn1HObiS4tTL8VP2rvuB6H7Ser5DNMvR+R54+c1x96n7V33HnLcfep+1d9wPQxyp7PyKu62zm+cVkTLJVoH5dqppN2I7iqfqp+1d9zg1NZPVuR00skipwV7lXLrAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//Z",
    young: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBAUEBAYFBQUGBgYHCQ4JCQgICRINDQoOFRIWFhUSFBQXGiEcFxgfGRQUHScdHyIjJSUlFhwpLCgkKyEkJST/2wBDAQYGBgkICREJCREkGBQYJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCT/wAARCACQAJADASIAAhEBAxEB/8QAGQABAQEBAQEAAAAAAAAAAAAABgIABQEI/8QAJxAAAQEGBQUBAQAAAAAAAAAAAAECBQY0NnIHMTVxgQMzQXN0wTL/xAAXAQEBAQEAAAAAAAAAAAAAAAAEAAED/8QAIREAAQMEAgMBAAAAAAAAAAAAAAECcQMyM4EEQjRDgsH/2gAMAwEAAhEDEQA/APlxCVKJUkMIazMz/SGaMzmRqCZzS/AghbUl3OA5pfg78Laiu4dLXwIpZtCeLJTp3IP4bppbABFkr07kH8N00th2bbxZUG3x6shfCKqXv71PMWatdHvQ9wiql7+9TzFmrXR70Fe/6N6aFETU2lgChSTbuUexNTaWAKFJNu5QjrOVKE/BSkLRRqSbnAfPY4EEU6lyH3z2ODl1ZAurm0GWs1MzmZrMzIgOpaFKShRKYYlSiVIiGjM5maMzmRqCdzy534W1FdzgOeXO/CuoruHS18CKWbQniuV6dyD+G6aWwARXK9O5B/DdNLYdm28WVBt8erIYwiql7+9ScWatdHvQrCKqHv8AQpOLNWuj3oK9/wBG9Nfgoiam0sAUKSbe6j2JqbSz8AUKSbe6hXWcqUJ2ClIXinUuQ++exwIIo1LkPvnscHHqyBdXNoMtZmZM1mZkQHUtCiUKJTD3wQpfghSQiGjM5mazMzmSmoJ3PLiCFdRXcPubsCCFtRXcOlr4EUs2hNFcr07kH8N00tgBiuV6dyD6G6aWw7Nt4sqDZ49WQxhFVD3+hScWatdHvQrCKqHv9Ck4s1a6Pegr3fRvTX4KImptLPwBQpJt7qPYmptLPwBQpJt7qEdZypQn4KUheKNS5OA+exwd+KNS5OA+ewcurIF1c2gw1mZkzWZmRAdS0KJQslI3ghS/BCkhhDWZmczNZmZzJTUE7ml+BBC2oruH3NL8CCFtRXcMlr4EUs2hPFcr07kH0OU0tgBiuV6dyD6HKaWw7tt4sqDZ49WQxhFVD3+hScWatdHvQrCKqHv9Ck4s1a6Pegr3fRvTX4KImptLPwBQpJ9TdR7E1NpZ+AKFJPqbqEdZypQx+ClIXijUuTgPnsHfijUuTgPnsHLqyBlXNoMNZmZM1mZkQHLQvwQhfglI3ghS/BCkhhDWZmczNZmZzJTUE7ml+BBC2oruH3NL8CCFtRXcMlr4EUs2hPFcr07kH0OU0tgBiuV6dyD6HKaWw7tt4sqDZ49WQxhFVD3+hScWatdHvQrCKqHv9Ck4s1a6Pegr3fRvTX4KImptLPwBQpJ9TdR7E1NpZ+AKFJPqbqEdZypQx+ClIXijUuTgPnsHfijUuTgPnsHLqyBlXNoMNZmZM1mZkQHLQvwQhfglI3ghS/BCkhhDWZmczNZmZzJTUE7ml+BBC2oruH3NL8CCFtRXcMlr4EUs2hPFcr07kH0OU0tgBiuV6dyD6HKaWw7tt4sqDZ49WQxhFVD3+hScWatdHvQrCKqHv9Ck4s1a6Pegr3fRvTX4KImptLPwBQpJ9TdR7E1NpZ+AKFJPqbqEdZypQx+ClIXijUuTgPnsHfijUuTgPnsHLqyBlXNoMNZmZM1mZkQHLQvwQhfglI3ghS/BCkhhDWZmczNGZzJTUE7m7AghbUV3D7nlxBCuoruHS18CKWbQniuV6dyD6G6aWwARXK9O5B/DdNLYdm28WVBs8erIYwiqh7/QpOLNWuj3oVhFVD3+hScWatdHvQV7vo3pr8FETU2ln4AoUk291HsTU2ln4AoUk291COs5UoT8FKQvFGpcnAfPYO/FGpcnAfPY4OXVkC6ubQYazMyZrMzIgOpaFkIUSkYlSiVIwhozOZmjM5kagnc8ud+FdRXc4DnlzvwtqK7h0tfAilm0J4rlencg/humlsAEVyvTuQfw3TS2HZtvFlQbfHqyGMIqoe/0KTizVro96FYRVS9/epOLNWuj3oK9/wBG9Nfgoiam0s/AFCkm3uo9iam0sAUKSbe6hXWcqUJ2ClIXijUuQ++exwIIp1LkPvnscHHqyBdXNoMtZmZM1mZkQHUtCiUKJTDEqUhKkhENGZzM1mZn+kI1BO5pfg78Laiu4fc0vwIIW1Jdw6WvgRSzaE8WSvTuQfw3TS2ACLJTp3IP4bppbDs23iyoNvj1ZC+EVUvf3qeYs1a6Peh7hFVL396nmLNWuj3oK9/0b00KImptLAFCkm3co9iam0sAUKSbdyhHWcqUJ+ClIXinUuQ++exwd+KNSTc4D57HBy6sgXVzaDLWZmTNZqZnMQHUtCiUKUlMP//Z",
    fourier: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBAUEBAYFBQUGBgYHCQ4JCQgICRINDQoOFRIWFhUSFBQXGiEcFxgfGRQUHScdHyIjJSUlFhwpLCgkKyEkJST/2wBDAQYGBgkICREJCREkGBQYJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCT/wAARCACQAJADASIAAhEBAxEB/8QAHQAAAQUBAQEBAAAAAAAAAAAACAIDBAUGBwABCf/EAEYQAAIBAwICBAsFBQQLAQAAAAECAwAEEQUhEjETQVFzBhQVIlRhgZOxstE0NXGSoTJCkcHwRFNi4QcWIyQzQ1JjZHKCg//EABsBAAMAAwEBAAAAAAAAAAAAAAQFBgECAwAH/8QANhEAAQMCAwYEBAUEAwAAAAAAAQACAwQRBhIxBSEyQcHhE1GBoSJhcYIVFiMzUhRCcpKiwuL/2gAMAwEAAhEDEQA/ABV50/4hd+iz+7P0pNn9rh7xfjRD3D78Stsx/kaU7S2kaMtAbe9+flZI9r7XNA5gDM2a/O2lvkh68RuvRp/dmk+J3I/s835DXfZn6gB1/wBfqahSw8RI42LnmaAbt8nVnv2SxmKHHWP37Lh5tLgc4JR/8GvgtZ2JAhlOBnZDXa5wqKwY/wCxj3c53Y9S1HjYwiWZxiSXAK9Sgch7K6jbZIvk9+y7txE4i/h+/Zcc8Wn/ALmT8pr3i0/9zJ+U11vcgEZxnl2UpWwd+vc1v+MH+Hv2XT8fd/D37LkYtLhjgQSknsQ0pbC7bOLac47IzXabJGGZMDZSVyce2pttdSW74iZApQcIYnc/XnXF+3nDRnv2Q0mJXC4bH79lwnyfd5I8VnyP+2fpSvJl76Hc+6b6UR1gXurnik34dmIGMMR/IVawsXPCCeFfN59QoKTFLmG3h+/ZL5cZvYbeCP8Abshc8m3vodz7pvpXjpt6Odncj/8AJvpRPl3EzEZO/Ftzr5eSCW3JUkYifl1bGtRip9x+l79lqMavuB4I/wBuyF7xK59Hm/Ia+eKXH9xL+Q13CCQHT7luPO56/ZUGMu8yr1Jhj68jGKYt2443+DT59k1biNxv+np8+y5AmnXkjcK2twxPUI2P8qjkFSQQQRzBos/9F1n02ti5cHht42OT/wBRGKFjWPvW97+T5jRmzdpGrLgW2t80fsnaxri4FtrfO6asBxXtuO2VR+ooidVhNrcPCykMhIIz10O+n/brfvU+IonPCy1Pjb3QBKkkH8aUYkcBJED8+iRYteBLADzzdFmnLcTD1vtTDkKgJz2bUuQ4B2JPCR+OajzSEDzCTjkKTMCQMbdM3T9KVUYxGckevG1RJCWGTy7eylyN0QK4wSTn1nPOmGcFgu46zRjG2CPjbYbktMlTkYPYKXHAZMnOBjOa9H56k+aMeun0kWHgLklAeI4P7VecTyXnOI0XkaO1xxcKrnDnOx9X1qwsFV5NxmOEZGMEHOwH9dtIsmtuidZmRcktknDEnsqdp8EUBWFIwFQ9KVB5ZPmg/qfZQcz9x80BPJYHdvVraK1tEVX/AIjkjHrO5PsqdEPF4wg3PxqPECJOkYb42A6qcL+dg7n4Uof8RSKT4ilxsqSEyNljvn6U1dYhsLqc7ERMB2V9ePppVbiOVHspjXpUGlzw8YV5F4VHbWGC7wPNYY272jzssSbjFiExhi2frUzR7ZriYADLOwUZ/hUKaJIGii57EkVrvBPTwo8ZcbDZPx6zTuqlEcZcOaoayZsUJcOa23g0q6Yogi5FcMetj20IGr/el538nzGi7sHxOnZmhD1b7zvO/k+Y0bhF5cZb/LqmGBXuc6bMfLqkaf8AbbfvU+IotbvDyOCAQSdqErT/ALbb96nxFFpd4EjY7axi7ii9ei9jrig+7os3q2kEqz2yrjrQ8/ZWcnQxjLAjFbpzk1Ra1pnTRPJCvnYOV7aRUlRYhrlNUVWQQx6xkzniwxOOWaQnCWA4gueZJ2FTLa0ZmV1OJc4IkXalXK2gJR95BzRD8c8qd5xfKFRCQXyhJhtnL8LSLwE4yckMP6+FLARVMbAuV3VG5E5qIuoykmGPHEzrgjkgGakohRZeElpmXjDHc861c0jiWr2uHEvsCqZFedGLGTAjXmz9h7BWit+isGdGbidm43I3wcbD2CqzT4MXBuJjlbZMnPMuf8sVaW444eJ1Bdt/28E0DUuvu5JdVvzG3JTlvY+QOPWa8b6EusKOHkfkoqokVkbIZ8g/ssd/86Vp8SLqImUbsBQxgbYlBmnZYuV7JKtrbyyk7IpYk+oVjFuri4ja6nYyykFsA/wArQeElwYtLeNT50rBB/Oong9bLJK8pUEIMDbrrentHEZCF0pbRQulcOah6T4PXt3L4xcjowxyS3P2CtxaxpBEscY4UUYAphKkxUFVVDpj8WiXVlU+c3dp5KfaHEqH/EKEjVfvO879/mNFpA3CynsNCXqv3led+/zGqPCHFL6dVWYD45/t6pGn/bbfvU+IosrnznY+uhNsPttv3q/EUWEhrbF3FF69Fvjrjg+7oo0lRnNSnqO6ipRhUSwqk1ixLf7xChLDmq9frrHtE0UR6UeczFm6uvlXRmUVmPCC1iW8WR1ZukGV4ephTihqP7Cnuzqog+GVmrRWVyUG7ZGOtRV8zxRBpGVR0YPXzqLHFHbZXzg0gO4GcdlWFtpst4uZlMULFSVPNgDnHqBoyeQE3OiYVErScztwU/T7dYrKJZMtkcb7bsx3r7c6hEq4WAkdrKaflmjiTDEAD90VEmu7hxiFMA9dLWgudmKUtBe7M4KHNdmRfMVQRzA5UuyueguQ7KeHi/Sm3W7bPGznHb536GkJOk0ZQjhlTJ2Gzjrx6/VRWUEWRmQFtrblJ8JJxJLaxqw4cF8/pVvo0HQ2MeRhn84+2qXTtOn1WUXd2phjUcMadfD/AF11p4wFAAGwGAKEqXBrBEOWqBq3BkbYQdNU+lSI6jpTyGlrkoepUZ3FCfqv3ld98/zGiujO4oUdV+8rvvn+Y1V4Q45fTqrbAn7k/wBG9Uiw+22/er8RRYSUJ9h9tt+9X4iiwkrOLuKL16LbHXHB93/VRnplqffnTLVKNUQxMtVB4Tho4YpweHoyct2DFX7VW63bx3OnyxytwqRz7KLpnZZASj6R4bK0lUeiL4xENQuOHzhmNSdo1HWe01a+MtMo4CQp/e6z9Ko9Ms7mW3MLycFsp83bdwP5VdQjKjHVtR9QBnJTKqDc5N79Ak8Kg70oyHoiUA22pUkBYeuobW8AaSR9jzfc7esYrk2x1XFtnar0mpYjPHBIhO2WUgVCxhkuATwMc5HVUfWnsYbeGSOKWaN22kRiw/A719t5R5PChsxjHBnsoxsYDcwGqPZEGsDmjVbOLHCuOWKfWoOmSdLZQt/hqctJXixIU9KLOITq08lMrTyUO5DPUmPqoUdV+8rvvn+Y0VsfMUKWq/eV33z/ADGqvCPHL6dVbYF/cn+jeqRYfbbfvV+IosZRgkUJ2n/bbfvU+IotbhcSOPWazi7ii9eizjrig+7oobimWFSHFMuKkmlQzCo7Cs14R3LyXEdouQrMFJ7M8600p4VLdgzXP9QvJb69lYjIBOMjqFNKCPM/N5JzsyLO8u8lb3V/DABArjiYBVCncfjU2xYNEG9VY5IiZ+lZuHOM8XP8BWp0/jFoFJ4SRkeqi6iEMaLFHVVO2NgAKsGkAGTjA7aaCxSMJUPqNVd34x0RC3SwSA5PS8mHqb+VP6fdGbCgAqTniUbeyuHhENzAobwCG5gV81kxRWHRlFAkbhG3LPXUWW1RrdIkwiouy5wa9rt8E1K0gJRQoZlZ+XFyH8Kr7uS7JR5kAdTgtG4Pt2oqGN2Vu/XejYInZG77X3q90XVlQLZld05t+taNNwDWB0aRmvp85O/CMDJIre254olI3yBvQNfEGO3c0t2nCI33HNPoKeQU2op5BStxSZ5T8Y3FChqv3ld98/zGiwjHKhP1X7yu++f5jVZhDjl9Oqt8CfuT/RvVI0/7db96nxFF1driaT/2NCNp/wButu9T4ii/v4+G4f1nNZxfrF69FnHmsJ+vRVrimXFS3WmHWo9pUGxyhzbIx6sVz/UYmkvuitwVZuePXXRZEBBB5ViNWtjZ3rNGxLcwR1Cm+zn2cQnuyZAHEc1AtLMxTxxMwJOTxDfAHV+NaOzSLh6EMrHG4zWbtpnSUIqli+Tkfujtq1sZTJMkZfo41UHzTgt20bUtc7eSmNWxzt5KsLnSRKhCzyIDzGx+NRoNINm5dLhyeyl3GvQRsyA4AOA2edM+WYpfOSYMg5kEEg9hodrZrW5IRjajLY6JOqaRHqADSthhyPZVQ6CwBt/GjIR+6EyQPxq1vdSUwtjkwIBrLTznxiVnzxO24J50bSse4WcdyY0Ucjm5XHcOSm6ZI4nPAccbcW/b210LTmaS1jZtz1ntrFaHbrNMilcnI2Fb62RREoVQBjlQO1Hi4CW7YkGYAJ5RT6CkItPItJHFTr3J2FOJlHacUJeq/ed537/MaLyzj4pkHrBoQ9W+87zv3+Y1XYP4pT9OqusB8cx/x6pOnfb7bvU+YUaOvWbRSK/DsRzFBfpv2+171PmFH7qWmLPAoK5BQfCjsS0xna0DUX6Jli+kNQxoGov0XN3SmXWrjUtMks5DkEp1HsqudK+fkFhyu1Xy8h0bsrhYqE6VmPCS0lU9IicQY7HHLqrXMlRbq2E8TIcjI6qKp5/DeHIylqPCeHLnEpS0tHfDCVH24TgocfCoUU1zMOMEq644WzgGtNe6NIzSgRHpDzbeqS6tjFbtGqgvnIwOuqSGZjhu1VZTzseN2pUW3tLi+u34nZOHzmbspiceJ379DJxqRg8uXrFWUcMkNpxpNh5Fw3b+BH86r5IZuToSTzI5UQx9yfLRFxvu4792ll6W6aTZznII6v0FJjsTPcBtgTyBFJazlyCwwoOwG+/sq80TRruSeOZgQoOQOyvSSNjbcFelmbCzMDZWWg6ZMrKQrEHcsRt/GthFEFUAcgKRZ25ihVSMEdVS1SpWpqDK65UVWVRmfcr4q0+iV5Uqz0zS3u5ASpEY5ntoQAvOVuqBAdI7K0b0/pGntKjTEbAbUGOr/el538nzGj907TRFCVC7AbUAesDGq3vfyfMav8N0vgB1+YC+oYRov6YOvqQEjTN9Rte+T5hX6PS2JMEYxuEA/SvzYBIORsal+Vr/ANOuvet9af1NL4xuqero/HN1+gGo6J0wIKZH4VktQ8G7iFyY42K9mDQV+Vb70259631r3lS+9Nufet9aRVOGmT781ipuswjHU7y6xRfS6ZcocGCT2KajtZTD/lP+U0JB1O9PO8ufet9a+eUbz0u49431oH8oHlL7d0s/IZ5Te3dFhJZEnLRnszis/feCplcvH1fsjFDf5Ru/Srj3h+te8oXfpVx7w/WukeF5Yzds3t3XaHBk0Ruyf/j3XfH0G9MgRrdiQcZC7VNTwTlCcTcPFzxvQ7eULv0q494frXvKF36Vce8P1oh2H5jpKB9vdFOwvUHcJwPt/wDSIv8A1T4yJFBV8+cDy9eK0FjphtogiIxx6qFTyhd+lXHvD9a95Qu/Srj3h+tcZMMTSCzpvbuh5cHTyiz6jd/j3RcJZTHlE/5TUmLTLpiMQSD8VNB95RvPS7j3jfWvo1O9H9sufet9a4/lA85fbuhxgM85vbujWsPBm4mZTIrBescNa7T9GMQACY9lfn55UvvTbn3rfWveVb70259631o+mw2yDeHXKaUeEY6beHXK/R+3siqEY6q/OPWhjV74f+RJ8xpPla/9Ouvet9aiEkkknJNPKam8IqjpKPwDdf/Z"
    };
    var APERCU_DE = { revisions: "image", young: "youngBlanc", fourier: "trame" };      // Polarisation : apercuPola
    var FAIT = {
      revisions: TRAD("Former des images sur un écran ou au viseur, mesurer des focales (Bessel, Silbermann, autocollimation, Badal), monter loupe, microscope, lunettes et appareil photo, régler diaphragmes et œil ; aux niveaux 2 et 3, les aberrations des vraies lentilles."),
      young: TRAD("Franges d'Young au sodium, au mercure, en lumière blanche ou au laser, trous d'Young, fentes multiples, franges mesurées à la barrette ; diffraction par une fente, un trou (tache d'Airy, de Fresnel à Fraunhofer), un cheveu, un dépoli ; spectres d'un réseau."),
      fourier: TRAD("Montage 4f : le spectre de l'objet se forme au plan focal, on l'y filtre et l'image change (Abbe-Porter, strioscopie, fond noir, trame ou lignes effacées, passe-bas)."),
      polarisation: TRAD("Loi de Malus mesurée à la photodiode, polariseurs croisés, lames demi-onde et quart d'onde, teinte d'une lame entre polariseurs en lumière blanche.")
    };
    var mWrap = el("span", "bc-menu", RGG), MB = st.bac, MODE = "montages";
    var bMont = K.bouton(mWrap, TRAD("Montages ▴"), function (ev) { basculerMenu(bMont, "montages"); ev.stopPropagation(); });
    bMont.setAttribute("data-a3", TRAD("<b>Montages</b> — les montages types, rangés par thème ; un montage posé remplace le banc affiché"));
    var menu = el("div", "bc-menu-l bc-menu-haut", K.racine); menu.hidden = true;
    function basculerMenu(src, mode) {
      var ouvrir = menu.hidden || MODE !== mode; K.fermerMenus();
      if (!ouvrir) return;
      MODE = mode; menu.hidden = false; remplirMenu(); placerMenu(); src.setAttribute("aria-pressed", "true");
    }
    function bacsChoix() { return K.estProf() ? Object.keys(BACS) : []; }
    var SEULE = { reelle: [TRAD("réelle seulement"), TRAD("il montre un effet des vraies lentilles (aberrations, épaisseur) : il s'ouvre toujours en optique réelle")],
      parfaite: [TRAD("parfaite seulement"), TRAD("il s'ouvre toujours en optique parfaite")] };
    function remplirMenu() {
      menu.innerHTML = "";
      if (menu.hidden || !BACS[MB]) MB = st.bac;      // fermé : il suit le matériel de l'étagère
      var choix = bacsChoix();
      menu.classList.toggle("bc-menu-mat", MODE === "materiels");
      if (MODE === "materiels") { remplirMateriels(choix); return; }
      if (choix.length > 1) {
        var og = el("div", "bc-menu-bacs", menu); og.setAttribute("role", "tablist");
        choix.forEach(function (b) {
          var t = el("button", "", og); t.type = "button"; t.textContent = BACS[b].nom; t.setAttribute("role", "tab");
          t.setAttribute("aria-selected", b === MB ? "true" : "false");
          t.setAttribute("data-a3", "<b>" + K.esc(BACS[b].nom) + "</b> — " + K.esc(BACS[b].quoi) + (b === st.bac ? TRAD(" (sur l'étagère)") : TRAD(" Un montage de ce matériel en remplit l'étagère ; chaque matériel garde son banc.")));
          t.addEventListener("click", function (ev) { ev.stopPropagation(); MB = b; remplirMenu(); placerMenu(); });
        });
      }
      var cols = el("div", "bc-menu-cols", menu), desc = el("p", "bc-menu-d", menu, TRAD("Survoler un montage pour le décrire."));
      var Bm = BACS[MB], prof = PROFILS[MB === st.bac ? NIV : niveauDe(MB)];
      groupesDe(Bm).forEach(function (g) {
        var L = g.liste.filter(function (id) { return montagePermis(id, prof); });
        if (!L.length) return;
        var c = el("div", "bc-menu-th" + (L.length > 6 ? " bc-menu-th-2" : ""), cols);      // thème long : sur deux colonnes
        el("p", "bc-menu-g", c).textContent = g.nom;
        L.forEach(function (id) {
          var m = MONTAGES[id], sg = SEULE[m.seule], b = el("button", "", c); b.type = "button"; b.textContent = m.nom;
          if (sg) { var mq = el("span", "bc-seule", b); mq.textContent = sg[0]; }
          var d = K.esc(m.titre) + (sg ? '<span class="bc-menu-ds">Optique ' + sg[0] + " : " + sg[1] + ".</span>" : "");
          b.setAttribute("data-a3", TRAD("<b>{0}</b> — clic : le poser sur le banc {1}", [K.esc(m.nom), bancCourant()])
            + (sg ? TRAD(" · <b>optique {0}</b> : {1}", [sg[0], sg[1]]) : MB === st.bac && P().interOptique ? TRAD(" (dans l'optique en cours)") : ""));
          b.addEventListener("mouseenter", function () { desc.innerHTML = d; });
          b.addEventListener("focus", function () { desc.innerHTML = d; });
          b.addEventListener("click", function () {
            var bac = MB; fermerMenu();
            if (bac !== st.bac) { changerBac(bac); if (PR.maj) PR.maj(); }
            appliquer(id);
          });
        });
      });
    }
    function remplirMateriels(choix) {
      el("p", "bc-menu-t", menu, TRAD("Matériel de l'étagère — chacun garde son banc, repris tel que tu l'as laissé"));
      var g = el("div", "bc-mats", menu);
      choix.forEach(function (b) {
        var B = BACS[b], ici = b === st.bac, c = el("button", "bc-mat" + (ici ? " ici" : ""), g); c.type = "button";
        if (b === "polarisation") { var ip = el("span", "bc-mat-im", c); apercuPola(ip); ip.title = TRAD("Les états de polarisation que montre l'aide « Polarisation »"); }
        else if (APERCUS[b]) { var im = el("span", "bc-mat-im", c), i = el("img", "", im); i.src = APERCUS[b]; i.alt = ""; im.title = TRAD("Aperçu : {0}", [MONTAGES[APERCU_DE[b]].nom]); }
        var tx = el("span", "bc-mat-tx", c);
        el("b", "", tx).textContent = B.nom;
        if (ici) el("i", "", tx).textContent = TRAD("sur l'étagère");
        el("span", "", tx).textContent = FAIT[b] || B.quoi;
        c.setAttribute("data-a3", "<b>" + K.esc(B.nom) + "</b> — " + (ici ? TRAD("le matériel de l'étagère") : TRAD("clic : passer à ce matériel (étagère et montages) ; son banc est repris tel que tu l'as laissé")));
        c.addEventListener("click", function () { fermerMenu(); if (!ici) { changerBac(b); if (PR.maj) PR.maj(); } });
      });
    }
    // Au-dessus de la rangée des tiroirs, aligné sur elle ; taille FIXE (la même pour les deux panneaux et tous les
    // onglets), réduite seulement si la place manque au-dessus de la rangée.
    var MENU_L = 780, MENU_H = 430;
    function placerMenu() {
      if (menu.hidden) return;
      var R = K.racine.getBoundingClientRect(), r = RG.getBoundingClientRect();
      menu.style.left = Math.max(4, r.left - R.left + 6) + "px";
      menu.style.bottom = Math.max(4, R.bottom - r.top + 4) + "px";
      menu.style.height = Math.max(160, Math.min(MENU_H, r.top - R.top - 10)) + "px";
      menu.style.width = Math.max(260, Math.min(MENU_L, R.width - 16)) + "px";
    }
    remplirMenu();      // rempli d'avance (tests, clavier) ; refait à chaque ouverture
    function fermerMenu() { menu.hidden = true; MB = st.bac; MODE = "montages"; bMont.setAttribute("aria-pressed", "false"); if (BOUT.bac) BOUT.bac.b.setAttribute("aria-pressed", "false"); }
    function horsMenu(ev) {
      if (!menu.hidden && !menu.contains(ev.target) && !mWrap.contains(ev.target) && !BOUT.bac.g.contains(ev.target)) fermerMenu();
    }
    K.surFermerMenus(fermerMenu);      // un déroulant ou un clic droit ouvert ferme le panneau des montages
    // « Nouveau banc » : le banc affiché repart du montage de départ, en deux clics (pas d'entrée au menu des montages).
    var bNouv = K.bouton(RGG, TRAD("Nouveau banc"), function () {
      if (!bNouv.classList.contains("confirme")) {
        bNouv.classList.add("confirme"); bNouv.innerHTML = TRAD("Confirmer : repartir du départ");
        setTimeout(function () { bNouv.classList.remove("confirme"); bNouv.innerHTML = TRAD("Nouveau banc"); }, 3500);
        return;
      }
      bNouv.classList.remove("confirme"); bNouv.innerHTML = TRAD("Nouveau banc");
      appliquer(BAC.depart);
    }, "bc-discret");
    bNouv.setAttribute("data-a3", TRAD("<b>Nouveau banc</b> — le banc affiché (A ou B) repart du montage de départ (deux clics) ; le cahier de mesures est gardé"));
    // Nom du matériel (le bac, terme interne) devant les tiroirs : ouvre le panneau sur ses onglets quand on peut en
    // changer ; pour un élève, simple étiquette. Changer de matériel garde l'état de chacun (mémoire du navigateur).
    BOUT.bac = (function () {
      var g = el("span", "bc-materiel", RGG), b = el("button", "bc-materiel-b", g), lab = el("span", "bc-materiel-l", g);
      b.type = "button";
      b.addEventListener("click", function (ev) { ev.stopPropagation(); basculerMenu(b, "materiels"); });
      function maj() {
        var peut = bacsChoix().length > 1;
        b.hidden = !peut; lab.hidden = peut;
        b.textContent = BAC.nom + " ▴"; lab.textContent = BAC.nom;
        var a3 = TRAD("<b>Matériel : {0}</b> — {1}", [K.esc(BAC.nom), K.esc(BAC.quoi)]);
        b.setAttribute("data-a3", a3 + TRAD(" Clic : changer de matériel ; chacun garde son banc.")); lab.setAttribute("data-a3", a3);
      }
      maj();
      RGG.insertBefore(g, RGG.firstChild);      // en tête de la rangée : c'est lui qui décide de l'étagère et des montages
      return { g: g, b: b, maj: maj, majDebug: maj };
    })();
    root.addEventListener("pointerdown", horsMenu);
    function groupe(lab, opts, get, set, a3) { return K.groupe(L1, lab, opts, get, set, a3); }
    BOUT.niveau = groupe(TRAD("Niveau"), [[1, "1", TRAD("<b>Niveau 1</b> — l'essentiel : optique parfaite, image sans œil simulé par défaut, ni capteur ni mesures")],
      [2, "2", TRAD("<b>Niveau 2</b> — optique réelle au choix, luminosité réelle, capteur photo, densités, barrette, photodiode, spectromètre")],
      [3, "3", TRAD("<b>Niveau 3</b> — tout le niveau 2, et les pièces décentrables (vue de face, vis), les lentilles inclinables")]],
      function () { return NIV; }, function (v) { changerNiveau(v); });
    BOUT.optique = groupe(TRAD("Optique"), [["parfaite", TRAD("parfaite"), TRAD("<b>Optique parfaite</b> — lentilles minces idéales : ni aberration, ni dispersion, ni diffraction")],
      ["reelle", TRAD("réelle"), TRAD("<b>Optique réelle</b> — vraies lentilles en verre : aberrations, dispersion, diffraction par les montures")]],
      function () { return optq(); }, function (v) { if (changerOptique(st, v)) { rafraichir(); majAides(); return; } modifie("seq bandeau"); majAides(); });
    BOUT.vue = groupe(TRAD("Vue"), [["profil", TRAD("profil"), TRAD("<b>Vue de profil</b> — le banc vu de côté")], ["dessus", TRAD("dessus"), TRAD("<b>Vue de dessus</b> — le banc vu d'en haut : décalages latéraux, fentes")]],
      function () { return st.vue; }, function (v) { st.vue = v; modifie("dessin"); });
    // Œil simulé [avec|sans] (tous niveaux ; au niveau 1, « sans » par défaut) : luminosité des vues « œil » (avec = réelle, sans = toujours visible ;
    // sans effet sur le capteur, la photodiode et le spectromètre ; gardée d'un montage à l'autre).
    BOUT.lum = groupe(TRAD("Œil simulé"), [
      ["reelle", TRAD("avec"), TRAD("<b>Œil simulé : avec</b> — luminosité réelle : réponse à la luminance du champ regardé, pupille, vision de nuit, halo de l'éblouissement, sans fond de salle ajouté : le noir reste noir ; une figure faible paraît faible, ou ne se voit pas")],
      ["visible", TRAD("sans"), TRAD("<b>Œil simulé : sans</b> — l'image est exposée pour être bien visible, quelle que soit la lumière reçue")]],
      lumq, function (v) { st.lumiere = v; modifie("obs"); });
    // Rendu [Rapide … Maximal] (tous niveaux) : niveau de rendu (hors de l'état, mémoire `qualite` commune aux bacs ;
    // choisir un niveau reprend la main sur un préréglage du panneau prof, Ql.prof : alors aucun n'est enfoncé).
    BOUT.rendu = groupe(TRAD("Rendu"), RENDUS.map(function (R, i) { return R && [i, R.nom, TRAD("<b>Rendu {0}</b> — {1}", [R.nom.toLowerCase(), R.titre])]; }).filter(Boolean),
      function () { return Ql.prof ? null : Ql.rendu; }, function (i) { Ql.rendu = i; Ql.prof = false; changerQualite(); });
    el("span", "bc-pousse", L1);
    BOUT.ab = groupe(TRAD("Banc"), [["A", "A", TRAD("<b>Banc A</b> — deux bancs pour comparer deux réglages · touche <span class=\"k\">A</span>")],
      ["B", "B", TRAD("<b>Banc B</b> — la première fois, une copie du banc A · touche <span class=\"k\">B</span>")]], bancCourant, basculerBanc);
    // Banc dans un fichier (.json) : l'état entier sans le cahier, le même texte que « Copier le banc » du panneau
    // Debug (« banc-etat {…} »), relu par les deux chemins. Un banc d'un autre matériel ne s'ouvre que si on peut en
    // changer (mode prof) ; sinon refusé, sans toucher au banc affiché.
    BOUT.fichier = K.bouton(L1, TRAD("Fichier ▾"), function () {}, "bc-dm-b");
    BOUT.fichier.setAttribute("data-a3", TRAD("<b>Fichier</b> — enregistrer le banc affiché dans un fichier, ou rouvrir un banc enregistré"));
    var choixF = el("input", "", K.racine); choixF.type = "file"; choixF.accept = ".json,.txt,application/json,text/plain"; choixF.hidden = true;
    choixF.addEventListener("change", function () {
      var f = choixF.files && choixF.files[0]; choixF.value = "";
      if (!f) return;
      var lec = new FileReader();
      lec.onload = function () { var err = lireBanc(lec.result); K.annoncer(err ? TRAD("<b>Banc non ouvert</b> — {0}", [K.esc(err)]) : TRAD("<b>Banc ouvert</b> — {0}", [K.esc(f.name)])); };
      lec.readAsText(f);
    });
    deroulant(BOUT.fichier, function () {
      return [{ lab: TRAD("Enregistrer le banc…"), a3: TRAD("<b>Enregistrer le banc</b> — pièces, réglages, aides et vue, dans un fichier .json (le cahier de mesures a son propre export)"), act: enregistrerBanc },
        { lab: TRAD("Ouvrir un banc…"), a3: TRAD("<b>Ouvrir un banc</b> — remplace le banc affiché (A ou B) par celui du fichier"), act: function () { choixF.click(); } }];
    });
    var CA = K.cahier({ fichier: "cahier-banc.csv", lire: function () { return st.cahier; }, ecrire: function (L) { st.cahier = L; K.modifie(); } });
    var bProf = K.boutonsFin(L1, { cahier: CA, prof: { lab: "Debug", f: function () { PR.panneau.basculer(); }, visible: K.estDebug() },
      gestes: function () { return gestesZones(); } }).prof;

    // ----- ligne 2 : les aides, une bascule chacune (picto, nom, lettre du raccourci) -----
    // Seules celles qui ont un sens apparaissent ; une aide allumée qui perd son sens reste allumée, sans effet dessiné
    // (elle revient quand il revient). La vue de face est éteinte par défaut (st.aides.face vrai seulement si demandé).
    var AIDES = [["faisceau", TRAD("Faisceau"), "F", TRAD("Toute la lumière, de la source au détecteur.")],
      ["construction", TRAD("Construction"), "C", TRAD("Les trois rayons particuliers issus du haut de l'objet, une couleur par tronçon (B → B₁, B₁ → B′) ; pour un point parti à l'infini, la gerbe violette, sa flèche et l'angle avec l'axe (optique parfaite)."), function () { return optq() === "parfaite"; }],
      ["pinceau", TRAD("Pinceau"), "P", TRAD("Des rayons exacts issus d'un point de l'objet ; ceux qu'une monture arrête sont grisés. Clic sur l'objet, ou glisser la poignée : le point de départ.")],
      ["spot", TRAD("Tache"), "T", TRAD("Où tombent, sur l'écran, le capteur ou la rétine, tous les rayons du pinceau : une couleur par longueur d'onde (calculée quand le geste s'arrête).")],
      ["rebours", TRAD("Rayons vers un point"), "R", TRAD("Cliquer un point de l'image : des rayons de la lumière qui y arrive, suivis depuis la source."), function () { return !(MOT && MOT.moteur === "onde"); }],
      ["pola", TRAD("Polarisation"), "O", TRAD("Entre les pièces, la vibration de la lumière vue depuis la source : naturelle, rectiligne, elliptique ou circulaire."), function () { return posee(/^(polariseur|lame)$/); }],
      ["face", TRAD("De face"), "X", TRAD("La pièce choisie vue depuis la source, et où tombe la lumière (encart en haut à droite du banc). Si c'est l'objet et que Tache ou Pinceau est coché, un clic dans la vue désigne le point d'où part le pinceau.")]];
    var LETTRES = {}; AIDES.forEach(function (a) { LETTRES[a[2].toLowerCase()] = a[0]; });
    function posee(re) { return st.elements.some(function (e) { return re.test(e.type) && !escamote(st, e); }); }
    function aideOfferte(a) { return !a[4] || a[4](); }
    function basculerAide(k) {
      var a = AIDES.filter(function (q) { return q[0] === k; })[0];
      if (!a || !aideOfferte(a)) return;
      st.aides[k] = !st.aides[k];
      if (k === "face" && cam.mont) vueMontage();
      if (k === "spot") spotInvalide();
      modifie("dessin"); majAides();
    }
    var LA = K.ligneAides(L2, basculerAide);
    function majAides() {
      var rs = SEQ && st.aides.construction && optq() === "parfaite" ? construction(SEQ, axe()).raison : null;
      LA.maj(AIDES.filter(aideOfferte).map(function (a) {
        var on = !!st.aides[a[0]], so = a[0] === "construction" && on && rs;
        return { cle: a[0], nom: a[1], lettre: a[2], titre: so ? rs : a[3], on: on, cls: so ? "bc-sans-objet" : "" };
      }));
    }

    // ----- ligne 3 : ce que font les gestes sur ce que survole la souris -----
    // Mêmes textes que le panneau « ? » (GESTES) : un geste ajouté s'écrit aux deux endroits. La ligne est celle de la
    // coque (K.gestes : le `data-a3` d'un ancêtre d'abord, puis `survol`, puis la pièce choisie) ; un glisser y écrit
    // par K.texteGeste.
    function k_(t) { return "<span class=\"k\">" + t + "</span>"; }
    function nomP(e) { var t = nomDe(e); return t.charAt(0).toUpperCase() + t.slice(1); }
    function textePiece(e) {
      var n = estSel(e.id) ? sels().length : 1;
      var s = "<b>" + K.esc(nomP(e)) + "</b>" + (positionsVues() ? TRAD(" à {0}", [cm(e.z)]) : "") + TRAD(" — glisser : déplacer") + (n > 1 ? TRAD(" les {0} pièces", [n]) : "")
        + TRAD(" (Maj : fin · Ctrl+Maj : ultrafin ; sous le banc : ranger) · molette, {0} : 1 mm (Maj 0,1 · Ctrl+Maj 0,01 · Ctrl 1 cm)", [k_("← →")]) +
        (REGLAGE[e.type] && n === 1 ? TRAD(" · {0} : {1}", [k_("↑ ↓"), REGLAGE[e.type]]) : "")
        + TRAD(" · clic droit : menu · double-clic : de près · {0}+clic : plusieurs · {1}+clic : jusqu'à elle · {2} : la voisine", [k_("Ctrl"), k_(TRAD("Maj")), k_("Tab")]);
      var es = escamote(st, e);
      if (e.verrou) s = TRAD("<b>{0}</b> verrouillée — ni glisser, ni molette, ni flèches, ni ranger, ni décentrer ; ses réglages restent libres · {1} : la déverrouiller · clic droit : menu", [K.esc(nomP(e)), k_("L")])
        + (REGLAGE[e.type] && n === 1 ? TRAD(" · {0} : {1}", [k_("↑ ↓"), REGLAGE[e.type]]) : "");
      else s += TRAD(" · {0} : escamoter · {1} : verrouiller", [k_("E"), k_("L")]);
      if (es === "auto") s = TRAD("<b>{0}</b> relevé d'office : un récepteur plus loin observe (pastilles au-dessus de l'image) · {1}", [K.esc(nomP(e)), s.split(" — ")[1]]);
      else if (es) s = TRAD("<b>{0}</b> escamotée, relevée hors du faisceau — {1} : la rabaisser · {2}", [K.esc(nomP(e)), k_("E"), s.split(" — ")[1]]);
      return s;
    }
    function survolBanc(t) {
      var v = t.closest(".bc-vis"), m = t.closest(".bc-mini"), p = t.closest(".bc-el"), e;
      if (CADRE === "banc") return TRAD("<b>Cadrer</b> — glisser un rectangle sur le banc : il cadre cette zone · {0} : annuler", [k_(TRAD("Échap"))]);
      if (v && (e = elDe(v))) return TRAD("<b>Vis {0}</b> de la {1} — molette : {2}, 0,1 mm (Maj 0,01 · Ctrl+Maj 0,001 · Ctrl 1 mm)",
        [v.getAttribute("data-axe") === "y" ? TRAD("de hauteur") : TRAD("de translation"), K.esc(PIECES[e.cle].court), v.getAttribute("data-axe") === "y" ? TRAD("décentrement vertical") : TRAD("décalage latéral")])
        + (e.verrou ? TRAD(" · pièce verrouillée") : "");
      if (m && (e = elDe(m)) && REGLAGE[e.type]) return TRAD("Miniature de la <b>{0}</b> — molette ou glisser : {1} (Maj : fin · Ctrl+Maj : ultrafin · Ctrl : gros) · clic : la choisir · {2} : pareil quand elle est choisie", [K.esc(PIECES[e.cle].court), REGLAGE[e.type], k_("↑ ↓")]);
      if (t.closest(".bc-poignee")) return TRAD("<b>Poignée du pinceau</b> — glisser : le point de l'objet d'où part le pinceau");
      if (t.closest(".bc-poigneeB")) return TRAD("<b>Point B</b> des rayons de construction — glisser le long de l'objet (au 0,1 mm) ; pinceau éteint, un clic sur l'objet le pose aussi");
      if (p && (e = elDe(p))) return textePiece(e);
      return TRAD("<b>Banc</b> — clic : plus rien de choisi · ") + (cam.k > 1 ? TRAD("glisser : se déplacer le long du banc · ") : "")
        + TRAD("double-clic : tout le banc · clic droit : poser ici · molette : la sélection, 1 mm · zoom : boutons, {0}, double-clic sur une pièce — jamais la molette", [k_(TRAD("Cadrer"))]);
    }
    function survolImage(t) {
      if (CADRE === "image") return TRAD("<b>Cadrer</b> — glisser un rectangle sur l'image : zoom sur la zone · {0} : annuler", [k_(TRAD("Échap"))]);
      if (t.closest(".bc-barr")) return TRAD("<b>Barrette CCD</b> — glisser : la déplacer sur l'écran · poignée ronde au bout : la tourner (Maj : au degré) · molette : la tourner (5° par cran ; Maj : 1° ; Ctrl+Maj : 0,1° ; Ctrl : 15°)");
      var oe = oeilMobile(), clic = st.aides.rebours ? TRAD("le point des aides") : st.fibre.on && fibreOfferte() ? TRAD("poser la fibre") : st.photo.on ? TRAD("poser la photodiode") : st.barr.on ? TRAD("centrer la barrette") : "";
      return TRAD("<b>Image</b> — glisser : se déplacer · ") + (oe ? TRAD("Maj+glisser : l'œil, fin · Ctrl+glisser : l'œil, vite · ") : "")
        + TRAD("molette : zoom autour du pointeur · double-clic : tout voir") + (clic ? TRAD(" · clic : {0}", [clic]) : "") + TRAD(" · clic droit : menu");
    }
    function survol(t) {
      if (D.contains(t)) return survolBanc(t);
      if (cvWrap.contains(t)) return survolImage(t);
      var c = t.closest(".bc-carte"); if (c && c.getAttribute("data-piece")) { var Pc = PIECES[c.getAttribute("data-piece")]; return TRAD("<b>{0}</b> — clic : la poser sur le banc · glisser : la poser où on la lâche ; lâchée SUR une pièce : la remplacer (même position)", [K.esc(Pc.nom)]) + (c.disabled ? TRAD(" · déjà sur le banc") : ""); }
      if (t.closest("input[type=range]") && BD.contains(t)) return TRAD("<b>Curseur</b> — glisser, ou molette dessus (Maj : fin · Ctrl+Maj : ultrafin · Ctrl : gros)");
      return null;
    }
    function texteDefaut() {
      var e = selEl();
      return e ? textePiece(e) : TRAD("Rien de choisi — cliquer une pièce ({0}+clic : plusieurs ; {1} : l'une après l'autre), ou en poser une depuis l'étagère · {2} : tous les gestes et raccourcis", [k_("Ctrl"), k_("Tab"), k_("?")]);
    }
    K.gestes({ survol: survol, defaut: texteDefaut, suivre: function (t) { return D.contains(t) && !geste; } });
    function majL3() { K.majGestes(); }

    // ----- panneau « ? » : tous les gestes et raccourcis, par zone (mêmes textes que la ligne 3) -----
    var GESTES = {
      "Banc": [[TRAD("clic"), TRAD("choisir la pièce ; sur le fond : plus rien de choisi")], [TRAD("Ctrl+clic"), TRAD("ajouter la pièce à la sélection, ou l'en retirer")], [TRAD("Maj+clic"), TRAD("choisir toutes les pièces entre la dernière choisie et elle")],
        [TRAD("glisser une pièce"), TRAD("déplacer toute la sélection, écarts gardés (Maj : dix fois plus lent, au 0,1 mm · Ctrl+Maj : cent fois, au 0,01 mm) ; sous le banc : la ranger")],
        [TRAD("glisser une carte"), TRAD("poser la pièce où on la lâche ; lâchée SUR une pièce : la remplacer (même position, même décalage) ; un clic : la poser à une place libre ; une source remplace l'ancienne")],
        [TRAD("molette"), TRAD("la sélection, 1 mm (Maj 0,1 · Ctrl+Maj 0,01 · Ctrl 1 cm), où que soit le pointeur ; sur une miniature : son réglage ; sur une vis : le décalage (vis du cavalier, vue de dessus : sur le côté ; niveau 3, vis de la tige, vue de profil : en hauteur) ; sur un curseur : ce curseur. Gardée sur ce qu'elle a pris tant qu'on tourne. Jamais de zoom")],
        [TRAD("miniature d'une pièce"), TRAD("molette ou glisser (vers le haut = molette vers le haut) : son réglage principal (Maj : fin · Ctrl+Maj : ultrafin · Ctrl : gros) ; clic : choisir la pièce ; une miniature sans réglage se glisse avec sa pièce")],
        [TRAD("clic droit sur une pièce"), TRAD("pièces sous le pointeur (pièces collées) · Remplacer par · Position… · Escamoter · Verrouiller · De près · Recentrer (niveau 3) · Ranger")], [TRAD("clic droit sur le fond"), TRAD("Poser ici · Tout le banc · Montage · Cadrer")],
        [TRAD("clic sur la position"), TRAD("au bandeau : la taper, en cm (Entrée valide, Échap annule)")],
        [TRAD("double-clic"), TRAD("sur une pièce : de près (la pièce seule, à l'échelle vraie, et sa vue de face) ; sur le fond : tout le banc")],
        [TRAD("Cadrer + glisser"), TRAD("rectangle : le banc cadre cette zone")],
        ["zoom", TRAD("boutons en haut à gauche du banc : tout le banc, le montage, −, +, Cadrer, de près ; zoomé, glisser le fond : se déplacer")],
        [TRAD("clic sur l'objet"), TRAD("pinceau affiché : le point d'où part le pinceau (ou glisser sa poignée)")],
        [TRAD("vue de face (niveau 3)"), TRAD("glisser la pièce dans son plan : la décentrer (Maj : fin · Ctrl+Maj : ultrafin) ; au bandeau, ses deux valeurs (clic : les taper) et Recentrer")]],
      "Image observée": [[TRAD("glisser"), TRAD("se déplacer dans l'image")], [TRAD("Maj+glisser, Ctrl+glisser"), TRAD("déplacer l'œil posé, fin ou vite (l'œil d'un viseur ou d'une lunette reste sur l'axe)")],
        [TRAD("molette"), TRAD("zoom autour du pointeur, proportionnel au défilement ; sur la barrette : la tourne (5° par cran, Maj 1°, Ctrl+Maj 0,1°, Ctrl 15°)")], [TRAD("double-clic"), TRAD("tout voir")], [TRAD("Cadrer + glisser"), TRAD("zoom sur la zone")],
        [TRAD("clic"), TRAD("le point de l'aide « Rayons vers un point » ; poser la photodiode ou la fibre ; centrer la barrette")],
        [TRAD("barrette"), TRAD("glisser : la déplacer ; poignée ronde au bout : la tourner (Maj : au degré)")], [TRAD("pastilles"), TRAD("le récepteur qui observe ; ceux qui sont devant lui sont relevés d'office")],
        [TRAD("Mesurer ▾"), TRAD("barrette, photodiode, spectromètre (niveaux 2 et 3, sur l'écran)")], [TRAD("clic droit"), TRAD("Tout voir · Recentrer l'œil · Récepteur · Poser ici la barrette, la photodiode, la fibre")]],
      "Clavier": [["← →", TRAD("la sélection, 1 mm (Maj 0,1 mm · Ctrl+Maj 0,01 mm · Ctrl 1 cm)")], ["↑ ↓", TRAD("réglage principal de la pièce choisie (Maj : fin · Ctrl+Maj : ultrafin · Ctrl : gros)")],
        [TRAD("Tab, Maj+Tab"), TRAD("la pièce voisine le long du banc (pièces collées)")], [TRAD("Suppr"), TRAD("ranger la sélection")],
        ["E", TRAD("escamoter la sélection (relevée hors du faisceau, à sa place), ou la rabaisser")], ["L", TRAD("verrouiller la sélection, ou la déverrouiller")],
        ["A, B", TRAD("banc A, banc B : deux bancs pour comparer deux réglages (B part d'une copie de A)")],
        [TRAD("Échap"), TRAD("fermer ce panneau ou un menu, annuler Cadrer ou la position tapée, puis plus rien de choisi")],
        [TRAD("Ctrl+Z, Ctrl+Maj+Z"), TRAD("annuler, rétablir (un glisser ou un tour de molette d'un coup ; le cahier n'est jamais annulé)")]]
        .concat(AIDES.map(function (a) { return [a[2], TRAD("aide « {0} »", [a[1]])]; })).concat([["V", TRAD("vue de profil, de dessus")], ["+ − 0", TRAD("zoom du banc, tout le banc")], ["?", TRAD("ce panneau")]])
    };
    // Zones du panneau « ? » : leurs clés restent françaises (ordre du panneau), le titre s'affiche traduit.
    var ZONES_GESTES = { "Banc": TRAD("Banc"), "Image observée": TRAD("Image observée"), "Clavier": TRAD("Clavier") };
    // Les mêmes zones pour le panneau de la coque (ligne 1) et pour le panneau « ? » : les clés restent françaises.
    function gestesZones() {
      var G = {}, z;
      for (z in GESTES) G[ZONES_GESTES[z] || z] = GESTES[z];
      return G;
    }
    function panneauRaccourcis() { K.panneauGestes(gestesZones()); }
    // Échap (coque : clic droit, panneau « ? », déroulant) : d'abord la position tapée ; après eux, le panneau des
    // montages, puis Cadrer.
    K.surEchap({ avant: function () { if (!TAPE) return false; annulerPosition(); return true; },
      apres: function () { if (!menu.hidden) { fermerMenu(); return true; } if (CADRE) { armerCadre(null); return true; } return false; } });

    // ----- niveau : profil appliqué -----
    function majProfil() {
      BOUT.optique.g.hidden = !P().interOptique;
      BOUT.rendu.g.hidden = BOUT.lum.g.hidden = !P().reglages;
      BOUT.niveau.maj(); BOUT.optique.maj(); BOUT.lum.maj(); BOUT.rendu.maj();
    }
    function changerNiveau(n) {
      if (!PROFILS[n] || n === NIV) return;
      NIV = n; NIVX[st.bac] = n;
      if (P().optique && P().optique !== st.optique && intact(st) && !MONTAGES[st.montage].seule) changerOptique(st, P().optique);      // montage intact : reposé pour l'optique imposée
      appliquerProfil(); remplirMenu(); majProfil();
      modifie("seq dessin etagere bandeau tete obs"); majAides(); K.sauverMaintenant();
    }
    majProfil();

    function rafraichir() {
      completer(); BAC = BACS[st.bac]; vueMontage();
      Object.keys(sale).forEach(function (k) { sale[k] = true; });
      appliquerProfil(); majProfil(); BOUT.vue.maj(); BOUT.bac.maj(); BOUT.ab.maj(); majAides(); K.modifie();
    }
    // Un montage s'ouvre dans l'optique en cours, ou celle que le profil impose (niveau 1 : parfaite, sinon ses pièces
    // seraient mises au point pour l'optique réelle et l'image floue au calcul). `pres` : il s'ouvre en De près sur la
    // première pièce de ce type (Astigmatisme : la lentille inclinée).
    function appliquer(id) {
      monter(st, id, P().optique || undefined); rafraichir();
      var m = MONTAGES[id], e = m.pres ? st.elements.filter(function (q) { return q.type === m.pres; })[0] : null;
      if (e) { choisir(e.id); dePres(); }
      K.sauverMaintenant();
    }
    // Bancs A et B : deux bancs par matériel ; le premier passage à B le fait partir d'une
    // copie de A. Le cahier de mesures suit (un seul cahier par matériel) ; les piles d'annulation sont vidées (sinon
    // Ctrl+Z ramènerait l'autre banc).
    function basculerBanc(b) {
      if ((b !== "A" && b !== "B") || b === bancCourant()) return;
      deposer();
      var ab = AB[st.bac], cah = st.cahier, neuf = !valide(ab[b]);
      if (neuf) ab[b] = JSON.parse(JSON.stringify(st));
      ab.cour = b; st = ab[b]; st.cahier = cah; tous[st.bac] = st;
      rafraichir(); K.sauverMaintenant(); if (K.oublierAnnulations) K.oublierAnnulations();
      K.annoncer(TRAD("<b>Banc {0}</b>", [b]) + (neuf ? TRAD(" — copie du banc {0}, pour comparer deux réglages", [b === "A" ? "B" : "A"]) : "")
        + TRAD(" · {0} / {1} : passer de l'un à l'autre", [k_("A"), k_("B")]));
    }
    // Autre bac (mode prof) : son état gardé dans la mémoire du navigateur, sinon son montage de départ.
    function texteBanc() { var o = {}; Object.keys(st).forEach(function (k) { if (k !== "cahier") o[k] = st[k]; }); return "banc-etat " + JSON.stringify(o); }
    // Relit un banc (texte copié ou fichier) ; null si ouvert, sinon la raison du refus (le banc affiché n'a pas bougé).
    function lireBanc(t) {
      var o = null;
      try { o = JSON.parse(String(t || "").trim().replace(/^banc-etat\s*/, "")); } catch (e3) {}
      if (!valide(o)) return TRAD("fichier illisible, ou pas un banc d'optique");
      if (o.bac !== st.bac) {
        if (bacsChoix().indexOf(o.bac) < 0) return TRAD("ce banc est fait pour un autre matériel ({0})", [BACS[o.bac] ? BACS[o.bac].nom : o.bac]);
        changerBac(o.bac);
      }
      o.cahier = st.cahier; st = o; rafraichir(); K.sauverMaintenant();
      return null;
    }
    function enregistrerBanc() {
      var d = new Date(), z = function (n) { return (n < 10 ? "0" : "") + n; };
      var nom = "banc-" + st.bac + "-" + d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + "-" + z(d.getHours()) + "h" + z(d.getMinutes()) + ".json";
      var b = new Blob([texteBanc().replace(/^banc-etat\s*/, "")], { type: "application/json" }), a = document.createElement("a"), u = URL.createObjectURL(b);
      a.href = u; a.download = nom; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(u); }, 1000);
    }
    function changerBac(id) {
      if (!BACS[id] || id === st.bac) return;
      deposer();
      // L'optique en cours suit : un montage intact y est reposé, sauf s'il en exige une.
      var opt = st.optique;
      st = valide(tous[id]) ? tous[id] : etatDepart(id);
      if (st.optique !== opt && !(intact(st) && MONTAGES[st.montage].seule)) changerOptique(st, opt);
      BAC = BACS[id]; NIV = niveauDe(id); ETG.ouvrir(BAC.ouvert);
      remplirMenu(); if (PR.remplir) PR.remplir();
      rafraichir(); K.sauverMaintenant(); if (K.oublierAnnulations) K.oublierAnnulations();
    }

    // ================= panneau Debug (l'auteur seul, `K.estDebug`) : ce que l'élève doit trouver, banc copié =================
    var PR = { panneau: K.panneau("pl-prof", "Debug", { coin: "bas-droite" }) };
    (function () {
      var Cp = PR.panneau.corps, vals = el("div", "pl-prof-v", Cp);
      // Montages et matériel sont dans la barre du haut : le panneau ne garde que ce qu'elle n'a pas (valeurs à
      // trouver, copier ou charger un banc). PR.liste : les montages du matériel.
      PR.remplir = function () { PR.liste = []; groupesDe(BAC).forEach(function (g) { g.liste.forEach(function (id) { PR.liste.push(id); }); }); };
      PR.remplir();
      var ef = el("div", "pl-prof-cf", Cp);
      var rg = el("div", "pl-prof-cf", Cp), zone = null, msgP = null;
      function montrerZone(t) {
        if (!zone) { zone = el("textarea", "pl-prof-etat", Cp); zone.spellcheck = false; zone.placeholder = TRAD("Coller ici un banc copié, puis « Charger »."); }
        zone.hidden = false; zone.value = t == null ? "" : t; zone.focus(); if (t != null) zone.select();
      }
      var tMsg = null;
      function dire(t) {   // le message s'efface seul au bout de 2 s
        if (!msgP) msgP = el("span", "pl-prof-msg", rg); msgP.textContent = t;
        clearTimeout(tMsg); tMsg = setTimeout(function () { msgP.textContent = ""; }, 2000);
      }
      PR.texteEtat = texteBanc;
      PR.charger = function (t) { return !lireBanc(t); };
      K.bouton(rg, TRAD("Copier le banc actuel"), function () {
        var t = PR.texteEtat(), ok = function () { dire(TRAD("copié dans le presse-papier")); }, ko = function () { montrerZone(t); dire(TRAD("Ctrl+C pour copier")); };
        try { if (root.navigator && root.navigator.clipboard && root.isSecureContext) root.navigator.clipboard.writeText(t).then(ok, ko); else ko(); } catch (e4) { ko(); }
      }, "pl-btn-p");
      K.bouton(rg, TRAD("Coller un banc…"), function () { montrerZone(null); dire(""); }, "pl-btn-p");
      K.bouton(rg, TRAD("Charger"), function () {
        if (!PR.charger(zone ? zone.value : "")) { dire(TRAD("banc illisible")); return; }
        zone.hidden = true; dire(TRAD("banc chargé")); PR.maj();
      }, "pl-btn-p");
      // « Mesurer les temps » : chaque montage du matériel affiché, puis le banc tel qu'il était. Pour chacun : moteur,
      // première image (aperçu), image fine (de la fin de l'aperçu au repos, rendu compris), temps total du clic au repos,
      // grille ondulatoire. Tableau en texte, à copier (zone du panneau). Le banc en cours est remis à la fin.
      var mesure = null, bMes = null;
      bMes = K.bouton(ef, TRAD("Mesurer les temps"), function () {
        if (mesure) return;
        if (!MOT) { montrerZone(""); dire(TRAD("pas de carte graphique")); return; }
        var avant = JSON.parse(JSON.stringify(st)), ids = PR.liste.slice(), L = [], i = 0;
        mesure = { b: bMes }; mesure.b.disabled = true;
        var tete = TRAD("Banc d'optique, matériel « {0} » ; {1} ; {2}", [BAC.nom, MOT.traceur && MOT.traceur.info ? MOT.traceur.info() : "?", root.navigator ? root.navigator.userAgent : ""]);
        function ligne(nom, t0) {
          var S = MOT.stats, o = S.onde && S.onde.N ? " grille " + S.onde.N[0] + " × " + S.onde.N[1] + (S.onde.paires ? ", " + S.onde.paires + " couples" : "") : "";
          return nom + TRAD(" | {0} | aperçu {1} ms{2} | image fine {3} ms ({4} passes) | total {5} ms |{6}",
            [MOT.moteur === "onde" ? TRAD("ondes") : TRAD("rayons"), Math.round(S.apercuMs || 0),
              S.adaptMs ? TRAD(" (adaptation de l'œil {0})", [Math.round(S.adaptMs)]) : "",
              Math.round(S.finMs || 0), S.passes || 0, Math.round(maintenant() - t0), o]);
        }
        function suivant() {
          if (i >= ids.length) {
            avant.cahier = st.cahier; st = avant; rafraichir(); K.sauverMaintenant();
            mesure.b.disabled = false; mesure = null;
            var t = tete + "\n" + L.join("\n");
            montrerZone(t); dire(TRAD("mesures prêtes : Ctrl+C pour copier"));
            try { if (root.navigator && root.navigator.clipboard && root.isSecureContext) root.navigator.clipboard.writeText(t).then(function () { dire(TRAD("mesures copiées dans le presse-papier")); }, function () {}); } catch (e5) {}
            return;
          }
          var id = ids[i++], t0 = maintenant(), vu = false;
          mesure.b.textContent = TRAD("Mesure {0} / {1}…", [i, ids.length]);
          monter(st, id); rafraichir();
          (function attendre() {
            if (MOT.etat !== "repos") vu = true;
            var dt = maintenant() - t0;
            if ((vu && MOT.etat === "repos") || (!vu && dt > 1500) || dt > 60000) {
              L.push(ligne(MONTAGES[id].nom, t0) + (dt > 60000 ? TRAD(" | arrêté à 60 s") : ""));
              mesure.b.textContent = TRAD("Mesurer les temps"); setTimeout(suivant, 200);
            } else setTimeout(attendre, 30);
          })();
        }
        // les images des diapos d'abord (sinon la première diapo serait mesurée vierge, puis recalculée)
        chargerDiapos(function () { vignettesDiapos = true; suivant(); });
      }, "pl-btn-p");
      bMes.title = TRAD("Monte un à un les montages du matériel affiché, chronomètre l'aperçu et l'image fine, puis remet le banc en cours. Tableau à copier.");
      PR.lignes = function () {
        var L = [[TRAD("Matériel"), TRAD("{0}, optique {1}", [BAC.nom, optq() === "reelle" ? TRAD("réelle") : TRAD("parfaite")])]];
        st.elements.slice().sort(function (a, b) { return a.z - b.z; }).forEach(function (e) {
          L.push([nomDe(e), cm(e.z) + (e.x || e.y ? TRAD(" ; décalé de {0} mm (hauteur), {1} mm (latéral)", [fmt(e.y || 0, 1), fmt(e.x || 0, 1)]) : "")]);
        });
        if (!SEQ || !SEQ.source) return L;
        var im = SEQ.iDet >= 0 ? C.images(SEQ, 587.6, SEQ.objet) : null, d = SEQ.detEl;
        if (im) {
          var f = im.finale;
          L.push([TRAD("Image paraxiale"), f.infini ? TRAD("à l'infini") : TRAD("{0} à {1}, grandissement {2}", [f.reelle ? TRAD("réelle") : TRAD("virtuelle"), cm(f.z), fmt(f.gamma, 3)])]);
          if (!f.infini && d && !SEQ.implicite) L.push([TRAD("Détecteur − image"), fmt(d.z - f.z, 1) + " mm"]);
          var inter = im.reelles.filter(function (x) { return f.infini || Math.abs(x.z - f.z) > 1e-6; });
          if (inter.length) L.push([TRAD("Images intermédiaires"), inter.map(function (x) { return cm(x.z); }).join(", ")]);
        }
        if (SEQ.stop) {
          var es = trouver(st, SEQ.stop.el);
          L.push([TRAD("Diaphragme d'ouverture"), (es ? nomDe(es) : SEQ.stop.el) + " (Ø " + fmt(SEQ.stop.D, 1) + " mm)"]);
        }
        if (DET === "capteur") L.push([TRAD("Temps de pose"), nomPose(st.pose)]);
        return L;
      };
      PR.maj = function () {
        if (PR.qualStat) PR.qualStat();
        vals.innerHTML = "";
        PR.lignes().forEach(function (x) { var r = el("div", "pl-prof-l", vals); el("span", "pl-prof-k", r, x[0]); el("span", "pl-prof-x", r).textContent = x[1]; });
      };
      // ----- Qualité du moteur : préréglage global (5 niveaux) + chaque réglage à part, en menus déroulants -----
      var QS = {}, qStat;
      function menu(parent, nom, valeurs, courant, lab, quand) {
        var r = el("div", "pl-prof-qr", parent); el("span", "pl-prof-k", r, nom);
        var sl = el("select", "pl-prof-sel", r);
        valeurs.forEach(function (v) { var o = el("option", "", sl, lab(v)); o.value = String(v); });
        sl.value = String(courant); sl.addEventListener("change", function () { quand(sl.value); });
        return sl;
      }
      function appliquerQ(perso) {
        if (perso) Ql.perso = true;
        changerQualite();
      }
      function majQ() {
        QP.forEach(function (q) { QS[q.k].value = String(Ql[q.k]); });
        QS.niveau.value = !Ql.prof ? "r" : Ql.perso ? "0" : String(Ql.niveau); QS.moteur.value = Ql.moteur; QS.delai.value = String(Ql.delai); QS.adapt.value = Ql.adapt ? "1" : "0"; QS.guide.value = Ql.guide ? "1" : "0";
        QS.niveau.options[0].textContent = TRAD("Niveau de rendu de la barre ({0})", [RENDUS[Ql.rendu].nom]);
      }
      PR.majQ = majQ;
      PR.qualStat = function () {
        if (!qStat) return;
        if (!MOT) { qStat.textContent = TRAD("pas de carte graphique"); return; }
        var S = MOT.stats, o = S.onde;
        qStat.textContent = TRAD("Dernier rendu : {0}", [MOT.moteur === "onde" ? TRAD("ondes") : TRAD("rayons")]) + (Ql.moteur === "ondes" && MOT.moteur !== "onde" ? TRAD(" (ondes refusées : {0})", [o && o.raison || "?"]) : "") +
          TRAD(" ; aperçu {0} ms (2^{1} rayons{2}) ; image fine {3} ms, {4}", [Math.round(S.apercuMs || 0), nivApercu,
            S.adaptMs ? TRAD(", dont adaptation de l'œil {0} ms", [Math.round(S.adaptMs)]) : "", Math.round(S.finMs || 0),
            (S.passes || 0) + (S.bruit ? " passes" : " / " + (S.objectif || 0) + " passes")]) +
          (S.bruit ? TRAD(", bruit {0}{1} pour {2} % visés", [S.bruit.clair === null ? "?" : fmt(100 * S.bruit.clair, 1) + " %",
            S.bruit.faible === null ? "" : TRAD(" (faibles {0} %)", [fmt(100 * S.bruit.faible, 1)]), fmt(100 * S.bruit.objectif, 1)])
            + ({ bruit: TRAD(", atteint"), plafond: TRAD(", arrêt au plafond de temps"), noir: TRAD(", rien d'éclairé"), passes: TRAD(", plafond de passes"), visible: TRAD(", image stable à l'écran") }[S.bruit.raison] || "") : "") +
          (S.visible ? TRAD(" ; écart à l'écran {0}/255 à {1} passes ({2} visé)", [fmt(S.visible.ecart, 2), S.visible.passes, fmt(S.visible.objectif, 1)]) : "") +
          (o && o.N ? TRAD(" ; grille {0} × {1}{2}", [o.N[0], o.N[1], o.paires ? TRAD(", {0} couples", [o.paires]) : ""]) : "") + qGuide(S.guide);
      };
      function qGuide(g) {
        if (!g) return "";
        if (g.rien) return TRAD(" ; visée guidée : rien à guider (pilote sauté)");
        var t = g.sites.map(function (n, s) { return n ? [TRAD("point de la source"), "direction", TRAD("dépoli 1"), TRAD("dépoli 2")][s] + " " + n + "²" : ""; }).filter(String);
        return TRAD(" ; visée guidée : {0} (pilote : {1} tour{2}, {3} ms, rayons utiles {4})", [t.length ? t.join(", ") : TRAD("rien à guider"),
          g.tours, g.tours > 1 ? "s" : "", Math.round(g.ms), g.utiles.map(function (u) { return fmt(100 * u, 2) + " %"; }).join(TRAD(" puis "))]);
      }
      (function () {
        var D = el("details", "pl-prof-qual", Cp); el("summary", "", D, TRAD("Qualité du moteur (aperçu et image fine)"));
        var T1 = el("div", "pl-prof-qg", D);
        QS.niveau = menu(T1, TRAD("Préréglage global"), ["r", 0, 1, 2, 3, 4, 5, 6, 7], !Ql.prof ? "r" : Ql.perso ? 0 : Ql.niveau, function (v) { return v === "r" ? TRAD("Niveau de rendu de la barre ({0})", [RENDUS[Ql.rendu].nom]) : v === 0 ? TRAD("Personnalisé (réglages à la main)")
          : TRAD("{0} / 7 : {1}, passes fixes", [v, [TRAD("très basse"), TRAD("basse"), TRAD("normale (origine, d'avant les niveaux de rendu)"), TRAD("moyenne"), TRAD("haute"), TRAD("très haute"), TRAD("extrême (peut ramer)")][v - 1]]); },
          function (v) { if (v === "r") { Ql.prof = false; changerQualite(); return; } v = parseInt(v, 10); Ql.prof = true; if (v) { niveauQ(v); appliquerQ(false); } else appliquerQ(true); });
        QS.moteur = menu(T1, TRAD("Modèle"), ["auto", "rayons", "ondes"], Ql.moteur, function (v) { return { auto: TRAD("Automatique (ondes si le montage l'exige)"), rayons: TRAD("Optique géométrique (rayons) seulement"), ondes: TRAD("Ondes dès que possible (même en optique parfaite)") }[v]; },
          function (v) { Ql.moteur = v; appliquerQ(false); });
        QS.delai = menu(T1, TRAD("Délai avant l'image fine"), [0, 50, 150, 300, 600, 1200], Ql.delai, function (v) { return TRAD("{0} ms après le dernier geste", [v]); }, function (v) { Ql.delai = parseInt(v, 10); appliquerQ(false); });
        QS.adapt = menu(T1, TRAD("Rayons de l'aperçu"), [1, 0], Ql.adapt ? 1 : 0, function (v) { return v ? TRAD("adaptatifs (suivent le temps de passe, 3 crans sous le plafond)") : TRAD("fixes, au plafond"); }, function (v) { Ql.adapt = v === "1"; appliquerQ(false); });
        // visée guidée : vaut aussi hors préréglage prof (comparaison à l'œil)
        QS.guide = menu(T1, TRAD("Visée guidée des rayons"), [1, 0], Ql.guide ? 1 : 0, function (v) { return v ? TRAD("oui (passe pilote au début de l'image fine)") : TRAD("non (tirage uniforme, pour comparer)"); }, function (v) { Ql.guide = v === "1"; changerQualite(); });
        var g0 = null, G = null;
        QP.forEach(function (q) {
          if (q.g !== g0) { g0 = q.g; G = el("details", "pl-prof-qd", D); el("summary", "", G, q.g); }
          QS[q.k] = menu(G, q.nom, q.v, Ql[q.k], q.lab, function (v) { Ql[q.k] = parseInt(v, 10); Ql.prof = true; appliquerQ(true); });
        });
        qStat = el("div", "pl-prof-qs", D);
        PR.qualStat();
      })();
      PR.panneau.surBascule = function (o) { bProf.setAttribute("aria-pressed", o ? "true" : "false"); if (o) PR.maj(); };
    })();

    // ================= dimensions, boucle =================
    function mesurer() {
      var r = D.getBoundingClientRect ? D.getBoundingClientRect() : null, nW = Math.round(r && r.width ? r.width : 820), nH = Math.round(r && r.height ? r.height : 480);
      nH = Math.max(220, nH);
      if (nW === W && nH === H) return;
      W = nW; H = nH;
      D.setAttribute("viewBox", "0 0 " + W + " " + H);
      sale.dessin = true;
    }
    var nTick = 0, etatMot = "", cleRecs = "", motVu = "";
    function tick() {
      if (++nTick % 60 === 0) { bProf.hidden = !K.estDebug(); BOUT.bac.majDebug(); mesurer(); }
      if (sale.seq) {
        sale.seq = false; if (!pupAuto) nPup = 0; pupAuto = false;
        SEQ = sequence(st, PUP, P()); sale.dessin = sale.obs = true; majAides(); spotInvalide(); majNote();
        var RS = recepteurs(st), cr = (RS.length > 1 ? RS.map(function (r) { return r.id + "@" + Math.round(r.z / 10); }).join() : "") + "|" + (SEQ.detEl ? SEQ.detEl.id : "");
        if (cr !== cleRecs) { cleRecs = cr; sale.tete = true; }
        // une diapo posée : ses images (à la demande), puis tout est recalculé et les miniatures refaites
        if (!vignettesDiapos && st.elements.some(function (e) { return e.type === "diapo"; })) {
          vignettesDiapos = true;
          chargerDiapos(function () { sale.seq = sale.etagere = sale.bandeau = sale.dessin = true; });
        }
        // l'œil qui observe : son bloc sous l'observation (refait s'il change d'œil, sinon le texte « sur l'objet, net à… »)
        var io = oeilObserve(null) ? SEQ.detEl.id : null;
        if (io !== blocOeil.id) { sale.tete = true; var es = selEl(); if (es && es.type === "oeil") sale.bandeau = true; }
        else if (blocOeil.vise && io) blocOeil.vise.textContent = texteVise(SEQ.detEl);
      }
      if (sale.etagere) { sale.etagere = false; dessinerEtagere(); }
      if (sale.dessin) { sale.dessin = false; dessinerBanc(); }
      if (sale.bandeau) { sale.bandeau = false; dessinerBandeau(); if (PHOTO) courbePhoto(tourneChoisie()); }
      if (sale.obs) { sale.obs = false; var d0 = DET; demanderObs(); if (d0 !== DET) sale.tete = true; }
      if (sale.tete) { sale.tete = false; dessinerTete(); }
      if (sale.spotDessin) { sale.spotDessin = false; dessinerSurc(); majPied(); }
      if (spotVoulu && maintenant() - tSpot > 180) { spotVoulu = false; calculerSpot(); }
      if (sale.spec) { sale.spec = false; SPC = null; dessinerSurc(); majSpec(); majPied(); }
      if (sale.photo) { sale.photo = false; dessinerSurc(); majPhoto(); }
      if (sale.barr) { sale.barr = false; dessinerSurc(); majCourbe(); majPied(); }
      if (MOT && MOT.tick()) {
        // Repeinte du seul niveau d'adaptation (fondu au repos, 25 im/s) : rien du champ n'a bougé — ni histogramme,
        // ni courbe, ni pose à relire (la relecture de la carte coûterait plus que la repeinte). Seule la ligne d'état
        // suit ; le passage à « repos » garde son tick complet (etatMot le dit).
        if (MOT.relax && MOT.etat === "repos" && etatMot === "repos") majPied();
        else {
          suivrePupille();
          if (MOT.etat === "apercu") {
            // préréglage prof : 3 crans sous son plafond, entre 9 et 24 ms ; niveau de rendu : autour de son temps visé
            // temps de la passe de rayons seule (`apercuPasseMs`) : l'adaptation et le halo du geste n'y sont pas, ils ne
            // baissent pas avec le nombre de rayons
            var ta = MOT.stats.apercuPasseMs != null ? MOT.stats.apercuPasseMs : MOT.stats.apercuMs, vise = Ql.prof ? 0 : RENDUS[Ql.rendu].ms, hautA = Ql.prof ? Ql.rApExp : 24, basA = Ql.prof ? Math.max(14, hautA - 3) : 14;
            var tHaut = vise ? 1.45 * vise : 24, tBas = vise ? 0.6 * vise : 9;
            if ((Ql.prof && !Ql.adapt) || nivApercu > hautA) nivApercu = hautA;
            else if (ta > tHaut && nivApercu > basA) nivApercu--; else if (ta < tBas && nivApercu < hautA) nivApercu++;
          }
          if (MOT.etat !== etatMot) { etatMot = MOT.etat; if (COURBE) majCourbe(); majPied(); }      // la courbe relit l'image finale
          if (COURBE && (MOT.etat === "repos" || maintenant() - tCourbe > 250)) { tCourbe = maintenant(); majCourbe(); }
          if (PHOTO && (MOT.etat === "repos" || maintenant() - tPhoto > 250)) { tPhoto = maintenant(); majPhoto(); }
          if (MOT.etat !== "repos") poseAuto(true);
          if (MOT.etat === "repos") { poseAuto(); majHisto(); if (PR.panneau.ouvert()) PR.maj(); }
        }
      }
      if (MOT) { specTick(); retourTick(); if (MOT.moteur !== motVu) { motVu = MOT.moteur; majAides(); } }
      majL3();
    }
    function redim(S) {
      cvWrap.style.width = cvWrap.style.height = S + "px";
      var n = Math.max(240, Math.min(720, Math.round(S / 16) * 16));      // par pas de 16 px : un léger flottement de S ne refait pas l'image
      if (n !== Wc) { Wc = n; cv.width = cv.height = n; sale.obs = true; }
      mesurer();
    }
    return {
      reservePied: 90,      // place gardée au pied (texte, lecture) pour calculer la taille de l'image : voir `redim` de la coque
      tick: tick, redim: redim,
      capturer: function () { deposer(); return { v: 2, bacs: AB, actif: st.bac, qualite: Ql, niveaux: NIVX }; },
      // Annuler (coque) : le banc du matériel affiché, sans ce qui ne s'annule pas (cahier de mesures, pièce choisie,
      // zoom de l'observation). Restaurer garde ces trois-là et la vue du banc (une lentille rangée revient là où elle
      // était, sans que le cadre bouge).
      // `params.cible` d'un œil (ce qu'il vise, recalculé par `sequence` au tick suivant) est dérivée : gardée, elle ferait
      // une fausse étape (instantané pris entre un geste et le tick).
      etatAnnulable: function () {
        var o = {}, k; for (k in st) if (SANS_ANNULER.indexOf(k) < 0) o[k] = st[k];
        o.elements = st.elements.map(function (e) {
          if (!e.params || e.params.cible === undefined) return e;
          var c = {}, q; for (q in e) c[q] = e[q];
          c.params = {}; for (q in e.params) if (q !== "cible") c.params[q] = e.params[q];
          return c;
        });
        return o;
      },
      restaurer: function (o) {
        if (!o || o.bac !== st.bac) return;
        var k; for (k in st) if (SANS_ANNULER.indexOf(k) < 0) delete st[k];
        for (k in o) if (SANS_ANNULER.indexOf(k) < 0) st[k] = JSON.parse(JSON.stringify(o[k]));
        completer();
        Object.keys(sale).forEach(function (q) { sale[q] = true; });
        majProfil(); BOUT.vue.maj(); majAides(); K.modifie();
      },
      stop: function () {
        root.removeEventListener("keydown", surClavier);
        root.removeEventListener("pointermove", surMove); root.removeEventListener("pointerup", surUp); root.removeEventListener("pointercancel", surUp);
        root.removeEventListener("pointerdown", horsMenu);
        if (T2) { try { T2.libererOnde(); var lx = T2.gl.getExtension("WEBGL_lose_context"); if (lx) lx.loseContext(); } catch (e9) {} T2 = null; }
      },
      _etat: function () { return st; }, _pupille: function () { return PUP; }, _seq: function () { if (sale.seq) { sale.seq = false; SEQ = sequence(st, PUP, P()); sale.dessin = sale.obs = true; } return SEQ; },
      _rafraichir: rafraichir, _appliquer: appliquer, _niveau: function (n) { if (n) changerNiveau(n); return NIV; }, _changerBac: changerBac, _retour: function () { return RET; }, _spot: function () { return SPOT; }, _prof: PR, _cahier: CA, _moteur: function () { return MOT; }, _spectre: function () { return SPC; }, _profilBarrette: function () { return profilBarrette(); }, _profilSpectre: function (n) { return SPC ? profilSpec(n || 200) : null; },
      _poser: function (cle, z) { var e = poser(st, cle, z); voir(e); modifie("seq etagere bandeau"); return e; },
      _ranger: function (id) { ranger(st, id); modifie("seq etagere bandeau"); },
      _grand: function () { return GR; }, _donnerGrand: donnerGrand, _appaBarr: appaBarr
    };
  }

  PL.instruments.banc = { creer: creer, modele: Banc, Dessin: Dessin };
})(typeof window !== "undefined" ? window : this);
