// © 2026 Sébastien Reyt — licence GPLv3 (code) : réutilisation et modification libres, en citant l'auteur, tout dérivé restant sous la même licence. https://www.gnu.org/licenses/gpl-3.0.html — textes, figures et pages : CC BY-NC-SA 4.0.
// Code écrit par Claude (Anthropic), un assistant d'IA, à partir des choix physiques et pédagogiques de l'auteur.
/* Cœur du banc d'optique, sans DOM ; `module.exports = { Coeur }` pour node. Il REJOUE
 * la référence Python opération pour opération (concordance à 1e-9) : toute retouche
 * du calcul se fait des deux côtés (puis régénérer les valeurs de contrôle) ET dans le shader de tracé (partie
 * carte graphique, après le `return` node ; shader ↔ cœur : test GPU). Couleur, spectres et verre :
 * module du cœur Michelson ; plage d'accommodation des yeux : cœur goniomètre.
 * Les deux sont chargés AVANT ce fichier.
 *
 * UNITÉS : longueurs en mm, longueurs d'onde en nm, angles en radians.
 * REPÈRE DU BANC : z le long du rail, sens de la lumière issue de la source ; y vertical vers le haut ; x = y × z
 * horizontal (vu de dessus, z vers la droite, x vers le haut du dessin ; vu de profil, x s'éloigne de l'observateur).
 *
 * BANC = { elements: [{type, id, z, x, y, rot, incl: [ax, ay], params}], optique: "parfaite" | "reelle", longueur,
 *          tirage: "source" (force le tirage direct depuis la source : tests) }
 *  - z = index du cavalier, plan de référence de l'élément : centre d'une lentille, plaque d'un objet, pupille de l'œil,
 *    objectif d'un viseur ou d'une lunette (le viseur vise à z − 100), face de sortie d'une lanterne (son condenseur ;
 *    le filament est à z − tirage ; en optique réelle, z est le plan principal objet du condenseur, sommet de sa face
 *    bombée : `primsCondenseur`), ampoule d'une lampe spectrale, sortie du laser.
 *  - Repère propre : origine (x, y, z), axes = colonnes de R = Ry(ay)·Rx(ax)·Rz(rot). Les primitives d'un élément sont
 *    à dz sur son axe propre. rot = rotation autour de l'axe propre (fentes, réseau, polariseurs, lames, couteau).
 *
 * CATALOGUE (TYPES) : un type d'élément = une entrée, décrite en PRIMITIVES (`prims(params, o, el)`) : dioptre conique
 * (SURF), lentille idéale (IDEALE), masque (MASQUE, formes F.*), diffuseur lambertien, réseau, miroir plan, Jones,
 * filtre, objet de phase, détecteur ; la déviation d'Airy (AIRY) est insérée par la séquence. Les quatre faces en
 * dérivent : `rayon` = `etape` primitive par primitive, `abcd` = `abcdPrim`, `transmission`, `jones`.
 * Ajouter un élément = ajouter une entrée : les moteurs ne connaissent que les primitives.
 *  - Monture : chaque primitive a une ouverture utile R (ronde) et une monture carrée de demi-côté Sm. Dans R :
 *    l'élément agit ; entre R et la monture : arrêté ; hors monture : le rayon passe à côté, intact. Un masque a
 *    R = GRAND : sa forme décide (1 transmis, 0 opaque) dans toute la plaque.
 *
 * SÉQUENCE (`sequence(banc)`) : les traversées dans l'ordre de la lumière, chacune avec son sens (+1 : vers +z).
 * Le tracé est fait dans le repère du labo (un miroir renvoie le rayon vers −z) ; un élément traversé vers −z
 * présente ses primitives dans l'ordre inverse (dioptres : verres d'entrée et de sortie échangés). Après un miroir,
 * la séquence repasse les éléments en sens inverse jusqu'à la première plaque (objet F : sa face blanche côté
 * lentille sert d'écran ; écran) ; sinon la lumière retourne à la source. Un seul détecteur : le premier écran ou
 * capteur, sinon l'œil (posé, ou implicite : derrière un viseur ou une lunette, sinon en bout de banc).
 *
 * TRACÉ DIRECT (moteur géométrique) : un rayon = un tirage (graine, passe, k) : λ (stratifiée sur la passe pour
 * un continu, selon Planck·(ȳ + 0,3 x̄ + z̄) par table inverse, `TIRAGE_L` ; raie tirée sinon), point de la source, direction visée dans l'ouverture utile du premier élément
 * (disques tirés par l'application concentrique `disque`), élargie au-delà de la monture (cible élargie :
 * `elargir`, `vise` ; anneau de 15/64 des tirages jusqu'à Rl, qui couvre tout ce que la lumière atteint en ligne droite ;
 * source dans un boîtier, `boitier` du type : pas d'anneau ; le guide reprend presque tout son coût) ;
 * poids = étendue du tirage × luminance (L·A_s·A_c·cos θ cos θ' / r²) : Σ poids / (rayons × aire du pixel) = éclairement.
 * UNITÉS ABSOLUES : L = luminance typique de la source (cd/m², `luminanceSource`
 * du module couleur), d'où l'éclairement en lux et un poids en lux × mm² = 1e-6 lm ; laser : em.L = son flux (1 mW) dans
 * ces unités. Le moteur ondulatoire rend les mêmes lux (vérifié : chambre noire et laser).
 * Couleur : facteur XYZ du spectre, normalisé pour Y = 1 (Y = L). Vecteur de Jones porté par le rayon
 * quand un élément polarisant est sur le trajet, intensité repliée dans le poids ; lumière naturelle = J nul, sans tirage :
 * une lame la laisse naturelle, le premier polariseur la rend polarisée selon son axe avec le poids ½. Hasard : `Alea` (hash 32 bits, 24 bits utiles), identique dans le shader et la référence : à graine égale,
 * le processeur, la carte graphique et Python tracent LES MÊMES rayons.
 *  - Tirage depuis l'objet éclairé (seq.mode = 1) : petit objet (trou, fente source) que seules des lentilles séparent
 *    de la source : point tiré dans l'objet, direction visée dans la pupille d'entrée (sinon l'ouverture suivante),
 *    rayon remonté à rebours jusqu'au plan d'émission ; hors de la source il est « mort » (poids nul, arrêté en −1).
 *    Même flux que le tirage direct (vérifié), des milliers de fois plus de rayons utiles derrière un trou de 0,1 mm.
 *  - Optique réelle : déviation d'Airy tirée au diaphragme d'ouverture (inverse de l'énergie encerclée, table AIRY
 *    précalculée, tronquée à 97 %), diaphragme trouvé au paraxial depuis le plan objet (dernier objet du trajet, sinon
 *    la source) ; un rayon passé hors de la monture du diaphragme n'est pas dévié. Dans le verre, angle divisé par n.
 *  - Lentille idéale (optique parfaite) : tan θ' = tan θ − h/f' sur les deux axes (stigmatique pour tous les plans).
 *    Chemin optique ajouté : −h²/2f' (paraxial ; les surfaces d'onde de l'optique parfaite se construisent autrement).
 *
 *  - Visée guidée (`guidePaire`, `guideTables`, `guideCPU`) : `seq.guide`, quand il est
 *    posé, tire le point de la source, la direction et la visée de chaque dépoli selon un histogramme appris (passe
 *    pilote) mélangé à 1/8 d'uniforme, poids × 1/densité (sans biais) ; tables en texture (unité 5) pour le shader,
 *    rechargées quand `version` change (un guide retouché en place n'est pas rechargé). Sans guide : rayons inchangés.
 *    Appris par le moteur : passe pilote sur la carte (`histoGuide` du traceur, un tracé par site de
 *    `sitesGuide`, poids par zone de l'aperçu) au début de chaque image fine, gardé pour les aperçus tant que `cleGuide`
 *    ne change pas (détail : « Visée guidée » dans `creerMoteurBanc`).
 *
 * L'ORDRE DES TIRAGES du hasard (λ, point, direction, puis diffuseur, réseau, Airy dans l'ordre du trajet ; un site
 * guidé en consomme quatre au lieu de deux) est le même ici, dans le shader et dans la référence : en changer un seul
 * fait diverger les rayons, sans erreur.
 *
 * PARAXIAL : matrices (y, n·u) primitive par primitive le long du trajet déplié (abscisse s = Σ |Δz|) ; conjugaisons
 * (`images`), diaphragme d'ouverture (`ouverture`), enveloppe du faisceau (`enveloppe` : polygone des rayons (y, u)
 * de l'objet découpé par chaque ouverture, exact au paraxial dans le plan dessiné), faisceau gaussien (`gaussien`).
 *
 * MOTEUR ONDULATOIRE (processeur en double, rejoué à 1e-6 du maximum de l'image par la concordance ;
 * carte graphique : voir « Sur la carte » en fin de cette section).
 * Champ scalaire paraxial, propagé de plan diffractant en plan diffractant par les matrices du paraxial.
 *  - Choix (`ondeMoteur`, `ondePlan`) : « onde » s'il y a un plan diffractant éclairé avant le détecteur, ou le laser.
 *    Plan diffractant = élément des tiroirs Young et Fourier, objet de phase, dépoli sous le laser, toute forme autre
 *    qu'un disque ou un rectangle ; une ouverture ordinaire (iris, fente source, monture) seulement si elle diffracte
 *    vraiment : détail × angle sous lequel on voit la source < λ pour la première, bord atteint par la lumière
 *    diffractée pour les suivantes ; laser : ouverture < 2,5 w. Un objet ordinaire placé avant le premier plan
 *    (fente source, trou source) DEVIENT la source (`plan.src`), limitée à ce que la lampe éclaire (`eclaire`).
 *    Refusés, rendus au moteur géométrique (`raison`) : miroir, dépoli hors laser, source conjuguée du premier plan,
 *    deux réseaux ou un plan derrière le réseau, rien de diffractant. Ignorés : réticules, décentrement des lentilles.
 *  - Grille : celle du premier plan, tournée comme lui (`plan.ang`), pas et taille propres à chaque axe : 8 mailles
 *    par plus petit détail (`fin`), 16 fois la zone éclairée (`champ`), plafonds `maxN` par axe et `maxCellules` ;
 *    `plan.limite` quand un plafond a grossi le pas. Champ {re, im}, maille (i, j) à ((i − N/2) dx, (j − N/2) dy).
 *  - Masques (`couverture`) : part de la maille couverte, lissée par un triangle de deux mailles (spectre × sinc²,
 *    repliement négligeable) ; une transformée le compense (÷ sinc²). En champ proche le masque lissé perd 3 à 6 % de flux.
 *  - Propagation (`propAxe`) : intégrale de Collins AXE PAR AXE, la courbure c de la sphère de référence portée à part
 *    (jamais échantillonnée), A' = A + B c : plans conjugués (B = 0) : copie à l'échelle A' ; loin (N d² |A'| ≤ λ|B|) :
 *    une transformée, pas λ|B| / (N d), courbure D/B ; près : spectre angulaire, pas |A'| d, courbure (C + D c)/A'.
 *  - Source étendue et couleur (`ondePasse`, mêmes unités que le moteur géométrique : éclairement XYZ par pixel) :
 *    somme incohérente sur les longueurs d'onde (`lambdasOnde` : `nl` strates d'un continu, ou les raies ; filtres et
 *    polariseurs repliés dans le poids : éléments uniformes, facteur ½ Tr(J†J), pas de champ à deux composantes) et
 *    sur la source. Un seul plan : un point source ne fait que décaler la figure (κ = −B₂/B₁) : une propagation par
 *    λ, relue (`lireNatif`, bilinéaire) pour `ns` × `ns` strates de la source, tirées dans leur case dès la passe 1 ;
 *    le long d'un axe où l'image de la source est bien plus large que la figure, la figure est intégrée et étalée.
 *    Plusieurs plans : somme brute, une propagation par point source (`pointsOnde` : réseau de points à inclinaison
 *    entière sur la grille, au plus `maxPoints`) et par λ, `np` couples par passe dans un ordre battu à la graine.
 *    Laser : faisceau gaussien analytique au premier plan (sans plan : gaussienne ABCD au détecteur) ; dépoli :
 *    phase tirée par maille (`opt.graine`). Réseau : une copie décalée par ordre (sin θ = mλ/a, ETA_RESEAU).
 *  - À savoir : zéros d'une figure décalés de 1 à 2 % à la lecture bilinéaire (justes sur la grille native) ; fente
 *    source tournée par rapport aux fentes : strates visibles tant que les passes ne s'accumulent pas.
 *  - Sur la carte (`T.onde`, `T.ondeNatif` de `creerTraceurGL`) : le processeur décide, la carte exécute. `ondeProgramme`
 *    (lots : λ, inclinaison de la source, strates, ordres) est LE plan d'une passe, déroulé tel quel par `ondePasse` et
 *    par `T.onde` (mêmes tirages, même ordre). La propagation d'un axe est une liste d'étapes (`ondeEtapes`, copie « en
 *    données » de `propAxe` : × pre, transformée, retournement, × ech · post ; facteurs calculés en double) ; une
 *    transformée = `tableTF` (étages de `fft1` fusionnés deux à deux, 4 termes par sortie, centrage et renversement des
 *    bits repliés dans les indices). Passes : départ (éclairage × racines de l'unité en indices entiers), étages,
 *    natif (|u|² par blocs, `natifGeom` commun), marges, lecture (`lireNatif` recopié, sans filtrage du matériel) ;
 *    accumulation par va-et-vient, sans mélange flottant. Masques (`eclairageBase`, `tPlan`) sur le processeur, en
 *    texture ; tout l'état d'un plan dans `plan.gl`, libéré au plan suivant. Accord carte ↔ processeur : 2e-4 du
 *    maximum (obtenu : 1e-5). Moteur progressif : `creerMoteurBanc(…, {onde: true})`.
 */
(function (root) {
  "use strict";
  var M = root && root.VITRINE_MICHELSON;
  if (!M && typeof require === "function") M = require("./_app-michelson-coeur.js").Coeur;
  var G = root && root.VITRINE_GONIOMETRE;
  if (!G && typeof require === "function") G = require("./_app-goniometre-coeur.js").Coeur;

  var K = { SURF: 1, IDEALE: 2, MASQUE: 3, DIFFUSEUR: 4, RESEAU: 5, MIROIR: 6, JONES: 7, FILTRE: 8, PHASE: 9, AIRY: 10, DET: 11 };
  var F = { DISQUE: 1, RECT: 2, FENTES: 3, TROUS: 4, LETTRE: 5, GRILLE: 6, REGLE: 7, DEMIPLAN: 8, PASTILLE: 9, FIL: 10, BIFENTES: 11, RETICULE: 12, DIAPO: 13 };
  var NP = 15, GRAND = 1e6, EPS_T = 1e-6, TMAX = 1e7;
  var ETA_RESEAU = [1, 0.45, 0.2, 0.08].map(function (e) { return e / 2.46; });   // ordres 0..3 (le goniomètre)
  // Filament spiralé de la lanterne, vu de côté dans le rectangle a × b : n spires (impair : une spire sur l'axe, le
  // centre émet), fil plein sur la fraction `plein` du pas, spires penchées de `pente` (dx par dy). Luminance L sur le
  // fil : flux = L · a · b · plein. Moteur géométrique seulement (le moteur ondulatoire garde le rectangle).
  var FILAMENT = { n: 7, plein: 0.6, pente: 0.25 };
  function xFilament(em, u, ys) {
    var f = em.fil, p = em.a / f.n, k = Math.min(f.n - 1, Math.floor(u * f.n));
    return (k - 0.5 * (f.n - 1)) * p + f.pente * ys + (u * f.n - k - 0.5) * f.plein * p;
  }
  function dansFilament(em, x, y) {
    var f = em.fil, p = em.a / f.n, xc = x - f.pente * y, k = Math.round(xc / p + 0.5 * (f.n - 1));
    return Math.abs(y) < 0.5 * em.b && k >= 0 && k < f.n && Math.abs(xc - (k - 0.5 * (f.n - 1)) * p) < 0.5 * f.plein * p;
  }
  function aireSource(em) { return em.forme === "rect" ? em.a * em.b * (em.fil ? em.fil.plein : 1) : Math.PI * em.a * em.a; }
  var FILTRES = { rouge: 1, vert: 2, bleu: 3, interferentiel: 4 };
  var VERRES = [null, "bk7"];          // 0 : air ; indice : loi de Cauchy du cœur Michelson
  // Diapos : images de _app-banc-diapos.js, n × n pixels, transmission en intensité
  // sur un octet, ligne 0 en haut (y > 0), côté `taille` mm. Rayons : texel le plus proche, poids × T ; moteur
  // ondulatoire : amplitude √T moyennée par maille (`couvDiapo`). Avant chargement (`chargerDiapos`) : diapo vierge.
  var DIAPO_NOMS = ["siemens", "usaf", "fourier", "lune"];
  var DIAPOS = { n: 0, taille: 20, t: [], a: [], octets: null, version: 0 };
  function chargerDiapos(d) {
    var n = d.n, k, i, tout = new Uint8Array(n * n * DIAPO_NOMS.length);
    for (k = 0; k < DIAPO_NOMS.length; k++) {
      var j = d.noms.indexOf(DIAPO_NOMS[k]), b64 = d.data[j], oct;
      if (typeof atob === "function") { var bin = atob(b64); oct = new Uint8Array(bin.length); for (i = 0; i < bin.length; i++) oct[i] = bin.charCodeAt(i); }
      else oct = new Uint8Array(Buffer.from(b64, "base64"));
      var t = new Float64Array(n * n), a = new Float64Array(n * n);
      for (i = 0; i < n * n; i++) { t[i] = oct[i] / 255; a[i] = Math.sqrt(t[i]); }
      DIAPOS.t[k] = t; DIAPOS.a[k] = a; tout.set(oct, k * n * n);
    }
    DIAPOS.n = n; DIAPOS.taille = d.taille; DIAPOS.octets = tout; DIAPOS.version++;
    return DIAPOS;
  }
  // node : le fichier à côté ; navigateur : s'il est déjà chargé (tests) ; sinon l'instrument l'injecte à la demande.
  try {
    if (root && root.VITRINE_BANC_DIAPOS) chargerDiapos(root.VITRINE_BANC_DIAPOS);
    else if (typeof module !== "undefined" && module.exports && typeof require === "function") chargerDiapos(require("./_app-banc-diapos.js"));
  } catch (e) { /* diapos vierges */ }

  // ================= hasard à graine =================
  var hash32 = M.hash32;
  function graineRayon(g, p, k) { return hash32(hash32(hash32(g) ^ p) ^ k); }
  function Alea(s) { this.s = s >>> 0; }
  Alea.prototype.u = function () { this.s = hash32(this.s); return (this.s >>> 8) / 16777216; };
  // Point uniforme du disque unité depuis (u, v) ∈ [0, 1)² : application concentrique de Shirley et Chiu (aire conservée,
  // cases du carré presque carrées sur le disque : la visée guidée garde sa finesse au centre, où tombe la pupille d'un
  // œil dans l'axe ; le tirage polaire en faisait des secteurs). Source en disque, cibles, dépoli, aux trois endroits.
  function disque(u, v) {
    var a = 2 * u - 1, b = 2 * v - 1, r, ph;
    if (a === 0 && b === 0) return [0, 0];
    if (Math.abs(a) > Math.abs(b)) { r = a; ph = Math.PI / 4 * (b / a); } else { r = b; ph = Math.PI / 2 - Math.PI / 4 * (a / b); }
    return [r * Math.cos(ph), r * Math.sin(ph)];
  }
  // Cible élargie : point visé depuis (u, v) dans une cible de rayon utile R prolongée
  // jusqu'à Rl (0 : pas d'élargissement, disque uniforme comme avant). Rayon de l'application concentrique
  // r = max(|2u − 1|, |2v − 1|) (exact en float32 : même branche sur la carte) : r < VISE_R0, le disque utile, uniforme
  // (part VISE_R0² = 49/64 des tirages sans guide) ; au-delà, l'anneau R → Rl, uniforme lui aussi (ρ² affine en r²).
  // Pas en logarithme du rayon : derrière un trou de 0,1 mm (R = 0,05, monture à 35 mm), 94 % de l'anneau tombaient sur
  // la plaque et la lumière qui la contourne était tirée avec des poids énormes. Renvoie [x, y, a] : a = aire / π de la
  // densité au point (R² pour le disque seul ; poids × π a, sans biais). Bord r0 = 7/8 : aligné sur les cases 16² et 32²
  // du guide (deux cases de 32² en travers de l'anneau, chacune la moitié de son aire).
  var VISE_R0 = 0.875;
  function vise(u, v, R, Rl) {
    var dq = disque(u, v), s;
    if (!(Rl > R)) return [R * dq[0], R * dq[1], R * R];
    var r = Math.max(Math.abs(2 * u - 1), Math.abs(2 * v - 1));
    if (r < VISE_R0) { s = R / VISE_R0; return [s * dq[0], s * dq[1], s * s]; }
    var a = (Rl * Rl - R * R) / (1 - VISE_R0 * VISE_R0);
    s = Math.sqrt(R * R + a * (r * r - VISE_R0 * VISE_R0)) / r;
    return [s * dq[0], s * dq[1], a];
  }

  // ================= visée guidée =================
  // SITE = une paire de tirages (u, v) ∈ [0, 1)² qu'une application change en point : 0, le point de la source (ou de
  // l'objet éclairé, seq.mode = 1) ; 1, la direction (point visé dans la cible, ou angles du laser) ; 2 + j, le point
  // visé par le j-ième dépoli du trajet (pr.p[4] = j). Le guide (seq.guide, fait par guideTables) tient pour un site une
  // table de m × m cases de cette paire (m puissance de 2) : probabilité H de chaque case, alias (Vose : prob arrondie en
  // float32, alias) et iq = 1 / q. Tirage d'un site guidé : quatre tirages b, c, u, v ; b < alpha : (u, v) tel quel ;
  // sinon case choisie par c (alias), (u, v) placé dans la case. Densité du mélange q = alpha + (1 − alpha) m² H : poids
  // × iq, sans biais. Site sans table : deux tirages u, v, exactement comme sans guide. Le choix de case est le même au
  // bit près dans le shader (b et c·m² exacts en float32 ; alpha et prob arrondis en float32 des deux côtés).
  // L'espace des tirages rend le guide générique : toute application (filament, disque, gaussienne) y est uniforme.
  var GUIDE = { n: 32, alpha: 0.125, compte: 10, gain: 1.25 }, GUIDE_SITES = 4, VERSION_GUIDE = 0;
  function guidePaire(G, site, a, uv) {
    var T = G && site < GUIDE_SITES ? G.t[site] : null, u, v, f;
    if (!T) { u = a.u(); v = a.u(); f = 1; }
    else {
      var b = a.u(), c = a.u(), n = T.n, i;
      u = a.u(); v = a.u();
      if (b < G.alpha) i = Math.floor(u * n) + n * Math.floor(v * n);
      else { var x = c * n * n, j = Math.floor(x); i = x - j < T.prob[j] ? j : T.alias[j]; u = (i % n + u) / n; v = (Math.floor(i / n) + v) / n; }
      f = T.iq[i];
    }
    if (uv) uv[site] = [u, v];
    return [u, v, f];
  }
  function agreger(h, n, m) {
    var f = n / m, hm = new Float64Array(m * m);
    for (var j = 0; j < n; j++) for (var i = 0; i < n; i++) hm[Math.floor(i / f) + m * Math.floor(j / f)] += h[i + n * j];
    return hm;
  }
  // Guide à partir d'histogrammes bruts (un par site, n × n cases, ou null). carres[s] = Σ y² des rayons pilotes du site s
  // (y = w·Y) : nombre utile de rayons neff = (Σ y)² / Σ y² ; résolution m = la plus fine (≥ 4) où chaque case occupée en
  // reçoit au moins `compte` ; site guidé seulement si la concentration débiaisée du bruit de comptage, m² (Σ p² − 1/neff)
  // / (1 − 1/neff), promet un gain ≥ `gain` (sinon le bruit de la passe pilote passerait dans les poids : laser, ×3 sur la
  // variance). Sans carres : résolution n, tous les sites non vides (contrôles).
  // info[s] (renseignement, hors des tables) : {neff, m, gain (concentration débiaisée), court : m < n faute de rayons
  // utiles} ; une passe pilote de plus (guidée par ce guide) affinerait un site `court` (moteur de la carte).
  function guideTables(histos, n, alpha, carres) {
    var al = Math.fround(alpha), t = [], info = [];
    for (var s = 0; s < GUIDE_SITES; s++) {
      var h0 = histos[s], tot = 0, i, h = null;
      info.push(null);
      if (h0) { h = new Float64Array(n * n); for (i = 0; i < n * n; i++) { h[i] = Math.max(0, h0[i]); tot += h[i]; } }
      if (!(tot > 0)) { t.push(null); continue; }
      var m = n;
      if (carres) {
        var neff = carres[s] > 0 ? tot * tot / carres[s] : 0, occ = function (hm) { var o = 0; for (var q = 0; q < hm.length; q++) if (hm[q] > 0) o++; return o; };
        while (m > 4 && neff < GUIDE.compte * occ(agreger(h, n, m))) m /= 2;
        h = agreger(h, n, m);
        var S = 0;
        for (i = 0; i < h.length; i++) S += (h[i] / tot) * (h[i] / tot);
        var gn = neff > 1 ? m * m * (S - 1 / neff) / (1 - 1 / neff) : 0;
        info[s] = { neff: neff, m: m, gain: gn, court: m < n };
        if (!(gn >= GUIDE.gain)) { t.push(null); continue; }
      }
      var N = m * m, H = new Float64Array(N), q = new Float64Array(N), iq = new Float64Array(N), prob = new Float64Array(N), alias = new Int32Array(N), pt = [], gd = [];
      for (i = 0; i < N; i++) { H[i] = h[i] / tot; q[i] = H[i] * N; iq[i] = 1 / (al + (1 - al) * q[i]); prob[i] = 1; alias[i] = i; }
      for (i = 0; i < N; i++) (q[i] < 1 ? pt : gd).push(i);
      while (pt.length && gd.length) {
        var lo = pt.pop(), g = gd.pop();
        prob[lo] = q[lo]; alias[lo] = g; q[g] = q[g] + q[lo] - 1;
        (q[g] < 1 ? pt : gd).push(g);
      }
      for (i = 0; i < N; i++) prob[i] = Math.fround(prob[i]);
      t.push({ n: m, H: H, prob: prob, alias: alias, iq: iq });
    }
    return { n: n, alpha: al, t: t, info: info, version: ++VERSION_GUIDE };
  }
  // Sites qu'un rayon de la séquence consomme : 0 et 1, plus un par dépoli du trajet (au plus GUIDE_SITES).
  function sitesGuide(seq) {
    var n = 2;
    seq.prims.forEach(function (p) { if (p.k === K.DIFFUSEUR) n++; });
    return Math.min(n, GUIDE_SITES);
  }
  // Passe pilote sur le processeur : Σ w·Y (et Σ (w·Y)²) des rayons détectés dans la fenêtre (cx ± W, cy ± W), par case
  // de chaque site ({histos, carres, n, utiles}, comme `histoGuide` du traceur de la carte), puis guideTables (guideCPU).
  // Les rayons suivent le guide déjà posé (seq.guide) : poids compris, sans biais.
  function guideHistos(seq, rendu, o) {
    o = o || {};
    var n = o.n || GUIDE.n, W = rendu.W, cx = rendu.cx || 0, cy = rendu.cy || 0, histos = [], carres = [], s, utiles = 0;
    for (s = 0; s < GUIDE_SITES; s++) { histos.push(new Float64Array(n * n)); carres.push(0); }
    if (seq.det && seq.prims.length) for (var k = 0; k < rendu.Nr; k++) {
      var r = tirer(seq, rendu.graine || 1, rendu.passe || 0, k, rendu.Nr), st = suivre(seq, r, r.alea);
      if (st.etat !== "detecte" || !(Math.abs(r.x - cx) < W && Math.abs(r.y - cy) < W)) continue;
      var y = r.w * r.f[1];
      utiles++;
      for (s = 0; s < GUIDE_SITES; s++) {
        var p = r.uv[s];
        if (!p) continue;
        histos[s][Math.floor(p[0] * n) + n * Math.floor(p[1] * n)] += y; carres[s] += y * y;
      }
    }
    return { histos: histos, carres: carres, n: n, utiles: utiles };
  }
  function guideCPU(seq, rendu, o) {
    o = o || {};
    var H = guideHistos(seq, rendu, o);
    return guideTables(H.histos, H.n, o.alpha == null ? GUIDE.alpha : o.alpha, H.carres);
  }

  // ================= couleur, verre, spectres =================
  function planckU(l, T) { var u = l * 1e-3; return 1 / (u * u * u * u * u * (Math.exp(14388 / (u * T)) - 1)); }
  function nVerre(v, l) { return v ? M.indice(VERRES[v], l) : 1; }
  var SP_CACHE = {};
  // Lumière blanche : λ tirée selon Planck·(ȳ + x·x̄ + z·z̄), table inverse de nq
  // quantiles (aussi dans le shader, uSpQ, et la référence). ȳ seul rend Y parfait mais Z 28 fois plus bruité (bleu
  // granuleux) ; ce mélange fait mieux que l'uniforme sur X, Y et Z (efficacités 0,61, 0,76, 0,30 contre 0,44, 0,49, 0,28).
  var TIRAGE_L = { x: 0.3, z: 1, nq: 128 };
  // Tirage d'une longueur d'onde : continu (type 0) uniforme et stratifié sur la passe, facteur XYZ = cie·Planck/normP
  // (normP = moyenne de Planck·ȳ) ; raies (type 1) tirées selon leurs poids, facteur XYZ = cie(λ)/Σ p ȳ. Y moyen = 1.
  function spectreTirage(nom) {
    if (SP_CACHE[nom]) return SP_CACHE[nom];
    var sp = M.spectreDe(nom), out, i;
    if (sp.continu) {
      var a = sp.continu[0], b = sp.continu[1], n = 4096, s = 0, g = [], G = 0;
      for (i = 0; i < n; i++) {
        var l = a + (b - a) * (i + 0.5) / n, pl = planckU(l, sp.T), c = M.cie(l);
        s += pl * c[1]; g.push(pl * (c[1] + TIRAGE_L.x * c[0] + TIRAGE_L.z * c[2])); G += g[i];
      }
      out = { type: 0, a: a, b: b, T: sp.T, normP: s / n, Q: quantilesTirage(g, G, a, b) };
    } else {
      var tot = 0, Y = 0, c = 0, cum = [], ls = [];
      for (i = 0; i < sp.raies.length; i++) tot += sp.raies[i].poids;
      for (i = 0; i < sp.raies.length; i++) {
        var r = sp.raies[i]; c += r.poids / tot; cum.push(c); ls.push(r.l); Y += r.poids / tot * M.cie(r.l)[1];
      }
      cum[cum.length - 1] = 1;
      out = { type: 1, l: ls, cum: cum, norm: 1 / Y, n: ls.length };
    }
    SP_CACHE[nom] = out;
    return out;
  }
  // Quantiles de la densité de tirage g (cases de [a, b]) : NQ valeurs, Q[0] = a, Q[NQ − 1] = b, interpolées dans la case.
  function quantilesTirage(g, G, a, b) {
    var n = g.length, h = (b - a) / n, Q = [a], i = 0, cum = 0, j;
    for (j = 1; j < TIRAGE_L.nq - 1; j++) {
      var cible = G * j / (TIRAGE_L.nq - 1);
      while (i < n - 1 && cum + g[i] < cible) { cum += g[i]; i++; }
      Q.push(a + h * (i + (g[i] > 0 ? Math.min(Math.max((cible - cum) / g[i], 0), 1) : 0)));
    }
    Q.push(b);
    return Q;
  }
  // Tirage d'une longueur d'onde du continu à u ∈ [0, 1[ (stratifié sur la passe) : interpolée dans la table Q ;
  // k = Planck / normP × (b − a) × densité de la table au point tiré (sans biais, quelle que soit la table).
  function lambdaContinu(sp, u) {
    var Q = sp.Q, m = Q.length - 1, t = u * m, i = Math.min(Math.floor(t), m - 1), dq = Q[i + 1] - Q[i], l = Q[i] + (t - i) * dq;
    return [l, planckU(l, sp.T) / sp.normP * dq * m / (sp.b - sp.a)];
  }
  function facteurXYZ(sp, l) {
    var c = M.cie(l), k = sp.type === 0 ? planckU(l, sp.T) / sp.normP : sp.norm;
    return [c[0] * k, c[1] * k, c[2] * k];
  }
  // Filtres colorés (larges) et interférentiel vert (546 nm, 10 nm à mi-hauteur) ; kind ≥ 10 : densité neutre
  // d = kind − 10 (transmission 10^−d, la même à toutes les longueurs d'onde).
  function transFiltre(kind, l) {
    if (kind >= 10) return Math.pow(10, 10 - kind);
    if (kind === 1) return 0.85 / (1 + Math.exp(-(l - 600) / 8));
    var mu = kind === 2 ? 530 : kind === 3 ? 450 : 546, fw = kind === 4 ? 10 : 80, t = (l - mu) / (fw / 2.3548200450309493);
    return (kind === 4 ? 0.6 : 0.75) * Math.exp(-0.5 * t * t);
  }

  // ================= tache d'Airy : v(EE), inverse de l'énergie encerclée 1 − J0² − J1², v = π D θ / λ =================
  function besselJ(n, v) { var s = 0, Kq = 400; for (var i = 0; i < Kq; i++) { var t = Math.PI * (i + 0.5) / Kq; s += Math.cos(n * t - v * Math.sin(t)); } return s / Kq; }
  var AIRY = (function () {
    var vs = [], ee = [], v;
    for (v = 0; v <= 60; v += 0.02) { var j0 = besselJ(0, v), j1 = besselJ(1, v); vs.push(v); ee.push(1 - j0 * j0 - j1 * j1); }
    var out = [], k = 0;
    for (var i = 0; i < 128; i++) {
      var cible = 0.97 * i / 127;
      while (k < ee.length - 2 && ee[k + 1] < cible) k++;
      var a = ee[k], b = ee[k + 1];
      out.push(vs[k] + (b > a ? (cible - a) / (b - a) : 0) * (vs[k + 1] - vs[k]));
    }
    return out;
  })();

  // ================= lentilles (BK7, focale effective à 587,6 nm) =================
  function sag(c, k, h) { var x = 1 - (1 + k) * c * c * h * h; return c * h * h / (1 + Math.sqrt(x > 0 ? x : 0)); }
  // Formes : bicv (biconvexe symétrique, bord 2 mm), bicc (biconcave, centre 2 mm), pcv (plan-convexe, face bombée
  // vers −z, bord 2 mm), asph (pcv à face hyperbolique k = −n² : stigmatique entre l'infini côté plan et son foyer).
  function concevoir(f, D, forme) {
    var n = M.indice("bk7", 587.6), h = D / 2, te = 2, c, t, a, b, c1 = 0, c2 = 0, k1 = 0, k2 = 0;
    if (forme === "bicv") {
      c = 1 / (2 * (n - 1) * f);
      for (var it = 0; it < 40; it++) {
        t = te + 2 * sag(c, 0, h); a = (n - 1) * (n - 1) * t / n; b = 2 * (n - 1);
        c = (b - Math.sqrt(b * b - 4 * a / f)) / (2 * a);
      }
      c1 = c; c2 = -c; t = te + 2 * sag(c, 0, h);
    } else if (forme === "bicc") {
      t = te; a = (n - 1) * (n - 1) * t / n; b = 2 * (n - 1);
      c = (-b + Math.sqrt(b * b - 4 * a / f)) / (2 * a); c1 = -c; c2 = c;
    } else {
      c1 = 1 / ((n - 1) * f); if (forme === "asph") k1 = -n * n;
      t = te + sag(c1, k1, h);
    }
    return { f: f, D: D, h: h, c1: c1, k1: k1, c2: c2, k2: k2, t: t, forme: forme };
  }
  function retournerLentille(L) {
    return { f: L.f, D: L.D, h: L.h, c1: -L.c2, k1: L.k2, c2: -L.c1, k2: L.k1, t: L.t, forme: L.forme };
  }
  var LENT_CACHE = {};
  function lentille(f, D, forme, retournee) {
    forme = forme || (f > 0 ? "bicv" : "bicc");
    var cle = [f, D, forme, !!retournee].join("|");
    if (!LENT_CACHE[cle]) { var L = concevoir(f, D, forme); LENT_CACHE[cle] = retournee ? retournerLentille(L) : L; }
    return LENT_CACHE[cle];
  }
  // Catalogue (focales nominales et diamètres) ; 10 et 20 mm (microscope), −500 mm (œil myope de 2 δ).
  var LENTILLES = [[10, 8], [20, 16], [50, 25], [100, 40], [125, 40], [200, 40], [300, 40], [500, 50], [1000, 50], [-100, 40], [-200, 40], [-500, 40]];

  // ================= primitives =================
  function prim(k, dz, R, Sm, p, ap) {
    var q = []; for (var i = 0; i < NP; i++) q.push(p && p[i] != null ? p[i] : 0);
    return { k: k, dz: dz, R: R, Sm: Sm, p: q, ap: ap || [R, R] };
  }
  // Rayon du disque utile (visé par la source ou un diffuseur) et demi-ouvertures paraxiales d'un masque.
  function rayonForme(f, a) {
    switch (f) {
      case F.DISQUE: return a[0];
      case F.RECT: return 0.5 * Math.sqrt(a[0] * a[0] + a[1] * a[1]);
      case F.FENTES: { var lx = (a[0] - 1) * a[2] + a[1]; return 0.5 * Math.sqrt(lx * lx + a[3] * a[3]); }
      case F.TROUS: return 0.5 * ((a[0] - 1) * a[2] + a[1]);
      case F.LETTRE: return Math.sqrt(136) * a[0];
      case F.GRILLE: return a[2] * Math.SQRT2;
      case F.REGLE: return Math.sqrt((a[0] + 2) * (a[0] + 2) + a[2] * a[2]);
      case F.PASTILLE: case F.FIL: return a[1];
      case F.BIFENTES: { var am = 2 * Math.max(a[7], 2 - a[7]) * a[5] + Math.max(a[0], a[1], a[2]) + a[3]; return 0.5 * Math.sqrt(am * am + a[4] * a[4]); }
      case F.RETICULE: return a[3];
      case F.DIAPO: return a[1] * Math.SQRT2;
    }
    return GRAND;
  }
  function apRect(hx, hy, rot) {       // demi-étendue d'un rectangle tourné le long des axes x et y du labo
    var c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
    return [Math.min(c > 1e-12 ? hx / c : GRAND, s > 1e-12 ? hy / s : GRAND), Math.min(s > 1e-12 ? hx / s : GRAND, c > 1e-12 ? hy / c : GRAND)];
  }
  function masque(forme, a, Sm, dz, rot) {
    var r = Math.min(rayonForme(forme, a), Sm * Math.SQRT2), ap;
    if (forme === F.DISQUE || forme === F.RETICULE) ap = [r, r];
    else if (forme === F.RECT) ap = apRect(a[0] / 2, a[1] / 2, rot || 0);
    else if (forme === F.FENTES && a[0] <= 1) ap = apRect(a[1] / 2, a[3] / 2, rot || 0);
    else if (forme === F.PASTILLE || forme === F.FIL || forme === F.DEMIPLAN) ap = [Sm, Sm];
    else if (forme === F.DIAPO) ap = apRect(a[1], a[1], rot || 0);      // carré de demi-côté a[1] (le rayon circonscrit élargissait le faisceau de √2)
    else ap = [r, r];
    var P = prim(K.MASQUE, dz || 0, GRAND, Sm, [forme].concat(a), ap);
    P.rc = r;
    return P;
  }
  function primsLentille(L, o, dz, Sm) {
    dz = dz || 0; Sm = Sm || L.h + 8;
    if (o.optique !== "reelle") return [prim(K.IDEALE, dz, L.h, Sm, [L.f])];
    return [prim(K.SURF, dz - L.t / 2, L.h, Sm, [L.c1, L.k1, 0, 1]), prim(K.SURF, dz + L.t / 2, L.h, Sm, [L.c2, L.k2, 1, 0])];
  }
  // Condenseur de la lanterne : le tirage est compté depuis son plan principal objet, dans les deux optiques. La
  // plan-convexe asphérique (face bombée vers le filament) l'a au sommet de sa face bombée : en optique réelle, centrée
  // en z, elle laissait le filament à tirage − t/2 (5,3 mm de moins) de ce plan, et la conjugaison filament → cible de
  // `tirageVers` (paillasse) ratait de loin (appareil photo : filament imagé sur le capteur au lieu de l'objectif).
  function primsCondenseur(o) {
    var L = lentille(60, 50, "asph");
    return primsLentille(L, o, o.optique === "reelle" ? L.t / 2 : 0, 32);
  }
  // Objectif de la lunette (plan-convexe de 200 mm, face bombée vers l'objet) : en optique réelle, décalé pour que son
  // foyer image à 587,6 nm (à f − t/n de la face plane) tombe sur le réticule (200 mm) : la lunette reste réglée à
  // l'infini. Centrée en 0, son foyer était 0,5 mm avant le réticule.
  function primsObjectifLunette(o) {
    var L = lentille(200, 30, "pcv"), n = M.indice("bk7", 587.6);
    return primsLentille(L, o, o.optique === "reelle" ? L.t / n - L.t / 2 : 0, 22);
  }
  function detecteur(dz, Sm, hy, forme, a) {
    var p = [forme || 0].concat(a || [0, 0, 0, 0, 0, 0, 0, 0]); while (p.length < 9) p.push(0); p.push(hy);
    return prim(K.DET, dz, GRAND, Sm, p, [Sm, hy]);
  }
  // Bifentes : les trois côte à côte le long de x (pas a[5]), centrées en hauteur ; la bifente utilisée (la seule
  // découverte) est sur l'axe du banc, rang a[7] ; plusieurs découvertes : celle du milieu sur l'axe.
  function axeBifentes(t) { var n = 0, r = 1; for (var i = 0; i < 3; i++) if (!(t && t[i])) { n++; r = i; } return n === 1 ? r : 1; }
  function bits(t) { var b = 0; for (var i = 0; i < 3; i++) if (t && t[i]) b |= 1 << i; return b; }
  // Œil : pupille, lentille idéale de vergence 1/17 mm + proximité vue nette (cœur goniomètre), rétine à 17 mm.
  // Diamètre de la pupille : banc.pupille (pupille stationnaire de l'œil, posée par l'instrument),
  // sinon le paramètre de l'œil, sinon 4 mm.
  function primsOeil(p, o) {
    var Pf = G.foyer({ type: p.type || "normal", mode: p.mode || "curseur", acc: p.acc || 0, mi: p.mi || 0 }, p.cible || 0);
    var V = 1 / 17 + Pf / 1000, pup = o.pupille || p.pupille || 4;
    return [masque(F.DISQUE, [pup / 2], 30), prim(K.IDEALE, 0, 6, 30, [1 / V]), detecteur(o.sens * 17, 12, 12)];
  }

  // ================= catalogue =================
  // Champs : tiroir ; source (emission) ; objet (plan objet des conjugaisons) ; plaque (face blanche, a : liste ou fonction des paramètres : détecteur au
  // retour d'un miroir, forme du trou) ; miroir ; detecteur + oriente (géométrie selon le sens) + vue (axes affichés) ;
  // instrument (+ oeilApres : pupille de sortie, où se place l'œil implicite) ; polarisant ; orientable.
  var TYPES = {
    // cond : « cond » (condenseur f = 60 mm), « rien » (filament nu) ou « depoli » (dépoli devant le filament)
    // emet : « filament » (spirale, défaut) ou « carre » (rectangle 4 × 2 uniforme, source idéale)
    lanterne: { tiroir: "sources", source: true, boitier: true, defaut: { tirage: 70, cond: "cond", emet: "filament" },
      emission: function (p) { var em = { forme: "rect", a: 4, b: 2, dz: -p.tirage, spectre: "bl", L: M.luminanceSource("bl") }; if (p.emet !== "carre") em.fil = FILAMENT; return em; },
      prims: function (p, o) { return p.cond === "rien" ? [] : p.cond === "depoli" ? [prim(K.DIFFUSEUR, 0, 25, 32, [])] : primsCondenseur(o); } },
    spectrale: { tiroir: "sources", source: true, defaut: { gaz: "na", filtre: false },
      emission: function (p) { var nom = p.gaz === "na" ? "na" : (p.filtre ? "hg" : "hgc"); return { forme: "disque", a: 7.5, b: 0, dz: 0, spectre: nom, L: M.luminanceSource(nom) }; },
      prims: function () { return []; } },
    laser: { tiroir: "sources", source: true, defaut: { vert: false },
      // He-Ne 632,8 nm, faisceau de 0,8 mm ; vert (p.vert) : 532 nm, 1 mm ; tous deux 1 mW.
      emission: function (p) {
        var l = p.vert ? 532 : 632.8, a = p.vert ? 0.5 : 0.4;
        return { forme: "gauss", a: a, b: l * 1e-6 / (Math.PI * a), dz: 0, spectre: p.vert ? "laserVert" : "laser", L: 1e6 * M.fluxLaser(l) }; },
      prims: function () { return []; } },
    lettreF: { tiroir: "objets", objet: true, plaque: { forme: F.LETTRE, a: [1], Sm: 30 }, defaut: {},
      prims: function () { return [masque(F.LETTRE, [1], 30)]; } },
    quadrillage: { tiroir: "objets", objet: true, defaut: {},
      prims: function () { return [masque(F.GRILLE, [1, 0.1, 20, 5, 0.2], 30)]; } },
    regle: { tiroir: "objets", objet: true, defaut: {},
      prims: function () { return [masque(F.REGLE, [25, 0.01, 5, 0.1], 30)]; } },
    depoli: { tiroir: "objets", objet: true, defaut: {},
      prims: function () { return [prim(K.DIFFUSEUR, 0, 25, 32, [])]; } },
    fenteSource: { tiroir: "objets", objet: true, orientable: true, defaut: { b: 0.1 },
      prims: function (p, o, el) { return [masque(F.RECT, [p.b, 10], 25, 0, el.rot)]; } },
    trouSource: { tiroir: "objets", objet: true, plaque: { forme: F.DISQUE, a: function (p) { return [p.d / 2]; }, Sm: 25 }, defaut: { d: 0.1 },
      prims: function (p) { return [masque(F.DISQUE, [p.d / 2], 25)]; } },
    iris: { tiroir: "objets", defaut: { D: 20 },
      prims: function (p) { return [masque(F.DISQUE, [p.D / 2], 35)]; } },
    // diapo : image de 20 mm, `eclairee` = lumière diffuse derrière (un dépoli dans la même pièce)
    diapo: { tiroir: "objets", objet: true, defaut: { image: "siemens", eclairee: false },
      prims: function (p) {
        var L = [masque(F.DIAPO, [Math.max(0, DIAPO_NOMS.indexOf(p.image)), 10], 25)];
        return p.eclairee ? [prim(K.DIFFUSEUR, -1, 15, 25, [])].concat(L) : L;
      } },
    couteau: { tiroir: "objets", orientable: true, defaut: { xc: 0 },
      prims: function (p) { return [masque(F.DEMIPLAN, [p.xc], 30)]; } },
    lentille: { tiroir: "lentilles", defaut: { f: 200, D: 40, forme: "bicv", retournee: false },
      prims: function (p, o) {
        // objectif de microscope (forme « objectif ») : lentilles collées corrigées, idéal dans les deux optiques
        // (ni aberration ni chromatisme ; en optique réelle, la diffraction par sa monture reste)
        if (p.forme === "objectif") return [prim(K.IDEALE, 0, p.D / 2, p.D / 2 + 8, [p.f])];
        return primsLentille(lentille(p.f, p.D, p.forme, p.retournee), o);
      } },
    condenseur: { tiroir: "lentilles", defaut: { retournee: false },
      prims: function (p, o) { return primsLentille(lentille(60, 50, "asph", p.retournee), o, 0, 32); } },
    miroir: { tiroir: "lentilles", miroir: true, defaut: {},
      prims: function () { return [prim(K.MIROIR, 0, 25, 32, [])]; } },
    fente: { tiroir: "young", orientable: true, defaut: { e: 0.1 },
      prims: function (p, o, el) { return [masque(F.FENTES, [1, p.e, 0, 10], 25, 0, el.rot)]; } },
    trou: { tiroir: "young", defaut: { d: 0.2 },
      prims: function (p) { return [masque(F.DISQUE, [p.d / 2], 25)]; } },
    bifentes: { tiroir: "young", orientable: true, defaut: { a: [0.2, 0.25, 0.3], e: 0.06, h: 5, pas: 7, caches: [false, false, false] },
      prims: function (p) { return [masque(F.BIFENTES, [p.a[0], p.a[1], p.a[2], p.e, p.h, p.pas, bits(p.caches), axeBifentes(p.caches)], 25)]; } },
    trousYoung: { tiroir: "young", defaut: { a: 0.5, d: 0.1 },
      prims: function (p) { return [masque(F.TROUS, [2, p.d, p.a], 25)]; } },
    fentesMultiples: { tiroir: "young", orientable: true, defaut: { n: 2, e: 0.04, pas: 0.2 },
      prims: function (p) { return [masque(F.FENTES, [p.n, p.e, p.pas, 5], 25)]; } },
    reseau: { tiroir: "young", orientable: true, defaut: { n: 300 },
      prims: function (p) { return [prim(K.RESEAU, 0, 12.5, 25, [1 / p.n])]; } },
    fil: { tiroir: "young", orientable: true, defaut: { w: 0.07 },
      prims: function (p) { return [masque(F.FIL, [p.w, 15], 25)]; } },
    filtre: { tiroir: "filtres", defaut: { couleur: "vert" },
      prims: function (p) { return [prim(K.FILTRE, 0, 20, 30, [FILTRES[p.couleur] || 2])]; } },
    densite: { tiroir: "filtres", defaut: { d: 2 },
      prims: function (p) { return [prim(K.FILTRE, 0, 20, 30, [10 + (p.d | 0)])]; } },
    polariseur: { tiroir: "polarisation", orientable: true, polarisant: true, defaut: {},
      prims: function (p, o, el) { return [prim(K.JONES, 0, 20, 30, [1, el.rot || 0])]; } },
    lame: { tiroir: "polarisation", orientable: true, polarisant: true, defaut: { ordre: "quart" },
      prims: function (p, o, el) { return [prim(K.JONES, 0, 12.5, 25, [2, el.rot || 0, p.ordre === "demi" ? Math.PI : Math.PI / 2, 546.07])]; } },
    grilleCroisee: { tiroir: "fourier", objet: true, defaut: { pas: 0.25, w: 0.05 },
      prims: function (p) { return [masque(F.GRILLE, [p.pas, p.w, 10, 0, 0], 25)]; } },
    objetPhase: { tiroir: "fourier", objet: true, defaut: { forme: "goutte", phi: 1 },
      prims: function (p) { return [prim(K.PHASE, 0, 10, 25, [p.forme === "lettre" ? 2 : 1, p.phi, 1.2])]; } },
    pastille: { tiroir: "fourier", defaut: { d: 0.5 },
      prims: function (p) { return [masque(F.PASTILLE, [p.d / 2, 15], 25)]; } },
    ecran: { tiroir: "observer", detecteur: true, oriente: true, plaque: { forme: 0, a: [], Sm: 100 }, defaut: {},
      prims: function () { return [detecteur(0, 100, 100)]; }, vue: function (s) { return [-s, 1]; } },
    capteur: { tiroir: "observer", detecteur: true, oriente: true, defaut: {},
      prims: function () { return [detecteur(0, 3.2, 2.4)]; }, vue: function (s) { return [-s, -1]; } },
    oeil: { tiroir: "observer", detecteur: true, oriente: true, defaut: { type: "normal", mode: "curseur", acc: 0, pupille: 4 },
      prims: primsOeil, vue: function (s) { return [-s, -1]; } },
    // oeil : « integre » (l'œil implicite derrière l'oculaire, décalé de ox, oy mm) ou « aucun » (l'instrument seul : on pose l'œil à la main)
    viseur: { tiroir: "observer", instrument: true, oeilApres: 156.25, frontale: 100, defaut: { oeil: "integre", ox: 0, oy: 0 },
      prims: function (p, o) {
        return [].concat(primsLentille(lentille(50, 20, "bicv"), o, 0, 15), [masque(F.RETICULE, [0, 0.01, 0.1, 6], 10, 100)],
          primsLentille(lentille(25, 15, "pcv", true), o, 125, 12));
      } },
    lunette: { tiroir: "observer", instrument: true, oeilApres: 242, defaut: { bonnette: false, oeil: "integre", ox: 0, oy: 0 },
      prims: function (p, o) {
        return [].concat(p.bonnette ? primsLentille(lentille(100, 30, "pcv"), o, -15, 20) : [], primsObjectifLunette(o),
          [masque(F.RETICULE, [1, 0.01, 0.1, 6], 10, 200)], primsLentille(lentille(20, 15, "pcv", true), o, 220, 12));
      } }
  };
  function params(el) {
    var T = TYPES[el.type], p = {}, k;
    for (k in T.defaut) p[k] = T.defaut[k];
    if (el.params) for (k in el.params) p[k] = el.params[k];
    return p;
  }
  // Repère propre : colonnes de R = Ry(ay)·Rx(ax)·Rz(rot).
  function repere(el) {
    var r = el.rot || 0, ax = (el.incl && el.incl[0]) || 0, ay = (el.incl && el.incl[1]) || 0;
    var cr = Math.cos(r), sr = Math.sin(r), ca = Math.cos(ax), sa = Math.sin(ax), cb = Math.cos(ay), sb = Math.sin(ay);
    function rxy(v) { var w = [v[0], ca * v[1] - sa * v[2], sa * v[1] + ca * v[2]]; return [cb * w[0] + sb * w[2], w[1], -sb * w[0] + cb * w[2]]; }
    return { O: [el.x || 0, el.y || 0, el.z], ex: rxy([cr, sr, 0]), ey: rxy([-sr, cr, 0]), ez: rxy([0, 0, 1]) };
  }

  // ================= séquence =================
  function retournerPrim(pr) {
    var q = { k: pr.k, dz: pr.dz, R: pr.R, Sm: pr.Sm, p: pr.p.slice(), ap: pr.ap, rc: pr.rc };
    if (q.k === K.SURF) { q.p[2] = pr.p[3]; q.p[3] = pr.p[2]; }
    return q;
  }
  function rayonUtile(pr) {
    if (pr.k === K.MASQUE) return pr.rc;
    if (pr.k === K.DET) return Math.max(pr.Sm, pr.p[9]) * Math.SQRT2;
    return pr.R;
  }
  function centrePlan(pr) { return [pr.O[0] + pr.dz * pr.ez[0], pr.O[1] + pr.dz * pr.ez[1], pr.O[2] + pr.dz * pr.ez[2]]; }
  // Rayon Rl de la cible élargie (0 : rien à élargir) pour un émetteur (centre S0, rayon
  // as : source ou dépoli) qui vise le disque C = [cx, cy, cz, R] du plan z = cz. La lumière qui passe entre R et la
  // monture est arrêtée, mais celle qui passe À CÔTÉ de la monture continue (écran éclairé directement, autre lentille,
  // œil) : jamais tirée avec la seule ouverture utile. Un rayon va en ligne droite jusqu'à la première monture où il
  // entre ; un masque, un filtre, un Jones ne le dévient pas (traversés, il est dans le cône de la monture suivante) :
  // Rl couvre, dans le plan de la cible, les cônes émetteur → monture des primitives qui dévient ou détectent (et du
  // diaphragme suivi d'Airy), de j0 au détecteur ou au premier miroir. Monture = disque circonscrit (Sm √2 ; détecteur :
  // rayonUtile), plan avancé de Rk sin(inclinaison) ; marge 2 %. Cible traversée à rebours (après un miroir) : rien.
  // pc : la primitive dont C est le plan (null : pupille d'entrée) ; masque plan droit : sa plaque, opaque de R à Sm,
  // arrête tout l'anneau si Rl ≤ Sm (trou source devant la lampe : rien à élargir).
  function elargir(P, iDet, j0, S0, as, C, pc) {
    var Rl = 0;
    for (var m = j0; m < P.length; m++) {
      var pk = P[m];
      if (pk.sens < 0) break;
      var airy = m + 1 < P.length && P[m + 1].k === K.AIRY;
      if (pk.k === K.AIRY || ((pk.k === K.MASQUE || pk.k === K.FILTRE || pk.k === K.JONES) && !airy)) continue;
      var Pk = centrePlan(pk), Rk = pk.k === K.DET ? rayonUtile(pk) : pk.Sm * Math.SQRT2;
      var L = Pk[2] - Rk * Math.sqrt(pk.ez[0] * pk.ez[0] + pk.ez[1] * pk.ez[1]) - S0[2];
      if (L > 1e-6) {
        var t = (C[2] - S0[2]) / L, ox = S0[0] + t * (Pk[0] - S0[0]) - C[0], oy = S0[1] + t * (Pk[1] - S0[1]) - C[1];
        Rl = Math.max(Rl, Math.sqrt(ox * ox + oy * oy) + as * Math.abs(1 - t) + Math.abs(t) * Rk);      // t < 0 : cible virtuelle, derrière l'émetteur
      }
      if (m === iDet || pk.k === K.MIROIR) break;
    }
    if (pc && pc.k === K.MASQUE && !pc.ez[0] && !pc.ez[1] && 1.02 * Rl <= pc.Sm) return 0;
    return Rl > 1.001 * Math.abs(C[3]) ? 1.02 * Rl : 0;
  }

  function sequence(banc) {
    var optique = banc.optique === "reelle" ? "reelle" : "parfaite", i, e, T;
    var els = (banc.elements || []).map(function (x, j) { return { e: x, j: j }; }).filter(function (o) { return TYPES[o.e.type]; })
      .sort(function (a, b) { return a.e.z - b.e.z || a.j - b.j; }).map(function (o) { return o.e; });
    var src = null;
    for (i = 0; i < els.length; i++) if (TYPES[els[i].type].source) { src = els[i]; break; }
    if (!src) return { vide: "source", prims: [] };
    var etapes = [{ el: src, sens: 1 }], det = null, mir = null, implicite = null;
    for (i = 0; i < els.length; i++) {
      e = els[i]; T = TYPES[e.type];
      if (e === src || !(e.z > src.z)) continue;
      if (T.source) break;
      etapes.push({ el: e, sens: 1 });
      if (T.detecteur) { det = e; break; }
      if (T.miroir) { mir = e; break; }
    }
    if (mir) {
      for (i = els.length - 1; i >= 0; i--) {
        e = els[i]; T = TYPES[e.type];
        if (e === mir || !(e.z < mir.z) || !(e.z > src.z)) continue;
        if (T.source) break;
        if (T.plaque) { etapes.push({ el: e, sens: -1, plaque: true }); det = e; break; }
        etapes.push({ el: e, sens: -1 });
      }
    } else if (!det) {
      var der = etapes[etapes.length - 1].el, Td = TYPES[der.type];
      var pd = params(der), integre = Td.instrument && pd.oeil !== "aucun";       // « aucun » : l'œil implicite part en bout de banc, comme derrière toute autre pièce
      implicite = { type: "oeil", id: "oeil", z: integre ? der.z + Td.oeilApres : Math.max(banc.longueur || 2000, der.z + 250), x: (der.x || 0) + (integre ? pd.ox || 0 : 0),
        y: (der.y || 0) + (integre ? pd.oy || 0 : 0), params: { type: "normal", mode: "repos" } };
      etapes.push({ el: implicite, sens: 1 }); det = implicite;
    }
    var prims = [], jones = false, objet = -1, iDet = -1;
    etapes.forEach(function (et) {
      var el = et.el, Ty = TYPES[el.type], p = params(el), fr = repere(el), o = { optique: optique, sens: et.sens, pupille: banc.pupille }, L;
      if (et.plaque) L = [detecteur(0, Ty.plaque.Sm, Ty.plaque.Sm, Ty.plaque.forme, typeof Ty.plaque.a === "function" ? Ty.plaque.a(p) : Ty.plaque.a)];
      else {
        L = Ty.prims(p, o, el) || [];
        if (et.sens < 0 && !Ty.oriente) L = L.slice().reverse().map(retournerPrim);
      }
      L.forEach(function (pr) {
        pr.O = fr.O; pr.ex = fr.ex; pr.ey = fr.ey; pr.ez = fr.ez; pr.sens = et.sens; pr.el = el.id; pr.type = el.type;
        prims.push(pr);
      });
      if (Ty.polarisant) jones = true;
      if (Ty.objet && !et.plaque && L.length) objet = prims.length - 1;
      if (det === el && L.length) iDet = prims.length - 1;
    });
    var Ts = TYPES[src.type], em = Ts.emission(params(src)), frs = repere(src);
    var seq = { optique: optique, prims: prims, jones: jones, objet: objet, det: iDet >= 0 ? prims[iDet] : null, iDet: iDet,
      detEl: det, implicite: implicite, miroir: mir ? mir.id : null, etapes: etapes.map(function (et) { return { id: et.el.id, sens: et.sens }; }),
      source: { el: src.id, em: em, fr: frs, sp: spectreTirage(em.spectre), nomSpectre: em.spectre } };
    seq.vue = det ? (etapes[etapes.length - 1].plaque ? [1, 1] : TYPES[det.type].vue(etapes[etapes.length - 1].sens)) : [1, 1];
    // abscisses le long du trajet déplié (plan d'une primitive : sur l'axe, sans inclinaison ni décentrement)
    var zPrec = src.z + em.dz, s = 0;
    prims.forEach(function (pr) { pr.zp = pr.O[2] + pr.dz; s += Math.abs(pr.zp - zPrec); pr.s = s; zPrec = pr.zp; });
    seq.zEm = src.z + em.dz;
    // diaphragme d'ouverture (au paraxial, depuis le plan objet) et déviation d'Airy en optique réelle
    if (iDet >= 0) {
      var ouv = ouverture(seq, 587.6, objet);
      seq.stop = ouv;
      if (optique === "reelle" && ouv) {
        var ps = prims[ouv.i], A = prim(K.AIRY, ps.dz, GRAND, GRAND, [ouv.D]);
        A.O = ps.O; A.ex = ps.ex; A.ey = ps.ey; A.ez = ps.ez; A.sens = ps.sens; A.el = ps.el; A.type = "airy"; A.zp = ps.zp; A.s = ps.s;
        prims.splice(ouv.i + 1, 0, A);
        if (objet > ouv.i) seq.objet = ++objet;
        seq.iDet = iDet = iDet + 1;
      }
    }
    // cibles : disque utile du premier élément (source) et de l'élément qui suit chaque diffuseur. Un dépoli vise
    // AU-DELÀ d'un objet étendu (lettre, quadrillage, règle), dont le motif est testé au passage : visant la plaque
    // posée contre lui, il n'enverrait dans la lentille qui suit qu'un rayon sur quelques milliers.
    // Marge de la pupille d'entrée vue d'un dépoli (rayon × MARGE_PUPILLE : aberrations de la pupille hors d'axe). Mesuré
    // (2^21 rayons, neuf montages à l'œil) : flux inchangé à toute marge (sans biais) ; ×3 → ×2 : 2,2 fois plus de rayons
    // sur la rétine, poids toujours égaux (le plus lourd à 2,5 fois la moyenne) ; ×1,75 (lentille de champ, lunette
    // terrestre), ×1,5 (lunette astronomique) : rayons 130 à 180 fois plus lourds que la moyenne (lumière des bords du
    // champ tirée dans la cible élargie : points brillants qui s'effacent lentement).
    var MARGE_PUPILLE = 2;
    function suivant(j) { for (var m = j + 1; m < prims.length; m++) if (prims[m].k !== K.AIRY) return prims[m]; return null; }
    function apresDiffuseur(j) {
      for (var m = j + 1; m < prims.length; m++) {
        var q = prims[m], f = q.p[0];
        if (q.k === K.AIRY || (q.k === K.MASQUE && (f === F.LETTRE || f === F.GRILLE || f === F.REGLE || f === F.DIAPO))) continue;
        return q;
      }
      return suivant(j);
    }
    // Champ vu (dépoli contre un objet étendu, que l'instrument ne voit qu'en partie : microscope, ±0,4 mm de la règle
    // éclairée sur ±8 mm) : disque [0, 0, z, X] du plan de l'objet étendu qui suit le dépoli j, hors duquel aucun rayon
    // n'atteint le détecteur au paraxial. Toute ouverture m jusqu'au détecteur (lentilles, iris, fentes, pupille de
    // l'œil, détecteur ; rayon utile R_m) impose |A_m x + B_m u| ≤ R_m (chaine de l'objet à m) : d'où |u| ≤ uM =
    // min (R_m + |A_m| X) / |B_m|, puis |x| ≤ X = min (R_m + |B_m| uM) / |A_m|, quatre fois en partant de X0 (demi-taille
    // de l'objet : avec elle seule, l'objectif laisse passer « 2,8 rad » et le champ sort à ±1,8 mm au lieu de ±0,4) ; marge
    // ×1,3 + 0,05 mm (aberrations, chromatisme). null si rien d'étendu ne suit, si un élément dévie hors du paraxial
    // (réseau, miroir, autre dépoli) ou est décentré ou incliné, ou si le champ couvre l'objet. Sans biais quoi qu'il
    // arrive : la cible élargie (p[5], `elargir` sur la cible retenue) tire encore vers tout ce qui passe les montures.
    // Pourquoi : visé sur l'objectif, le dépoli envoyait 39 % de ses rayons hors de l'oculaire (0,6 % sur la rétine).
    function champVu(j) {
      var io = -1, m, q, f;
      for (m = j + 1; m < prims.length; m++) {
        q = prims[m]; f = q.p[0];
        if (q.k === K.AIRY) continue;
        if (q.k === K.MASQUE && (f === F.LETTRE || f === F.GRILLE || f === F.REGLE || f === F.DIAPO)) io = m;
        break;
      }
      if (io < 0 || iDet <= io) return null;
      var ap = [];
      for (m = io + 1; m <= iDet; m++) {
        q = prims[m];
        if (q.O[0] !== 0 || q.O[1] !== 0 || q.ez[0] !== 0 || q.ez[1] !== 0 || q.sens < 0) return null;
        if (q.k === K.AIRY || q.k === K.FILTRE || q.k === K.JONES || q.k === K.PHASE) continue;
        if (q.k === K.MASQUE && (q.p[0] === F.LETTRE || q.p[0] === F.GRILLE || q.p[0] === F.REGLE || q.p[0] === F.DIAPO)) continue;
        if (q.k !== K.SURF && q.k !== K.IDEALE && q.k !== K.MASQUE && q.k !== K.DET) return null;
        var M = chaine(seq, 587.6, io, m); ap.push([M[0], M[1], rayonUtile(q)]);
      }
      var X0 = prims[io].rc, X = X0, it, uM;
      for (it = 0; it < 4; it++) {      // chaque borne resserre l'autre, toutes deux restent vraies
        uM = Infinity;
        ap.forEach(function (a) { if (Math.abs(a[1]) > 1e-9) uM = Math.min(uM, (a[2] + Math.abs(a[0]) * X) / Math.abs(a[1])); });
        if (!isFinite(uM)) return null;
        ap.forEach(function (a) { if (Math.abs(a[0]) > 1e-9) X = Math.min(X, (a[2] + Math.abs(a[1]) * uM) / Math.abs(a[0])); });
      }
      X = 1.3 * X + 0.05;
      return X < X0 ? [0, 0, prims[io].zp, X] : null;
    }
    var p0 = suivant(-1);
    seq.cible = p0 ? centrePlan(p0).concat([rayonUtile(p0)]) : null;
    var nDep = 0;
    prims.forEach(function (pr, j) {
      if (pr.k !== K.DIFFUSEUR) return;
      pr.p[4] = nDep++;            // numéro du dépoli sur le trajet : site 2 + p[4] de la visée guidée
      var nx = apresDiffuseur(j), c = nx ? centrePlan(nx).concat([rayonUtile(nx)]) : [0, 0, 0, 0];
      // mieux, quand le diaphragme d'ouverture est loin derrière (pupille d'un œil, iris fermé) : la pupille d'entrée
      // vue du dépoli (image paraxiale du diaphragme, à s = B/A, rayon R/|A|, marge MARGE_PUPILLE : aberrations hors d'axe), si
      // elle est réelle, plus étroite vue du dépoli que l'ouverture suivante, et si rien n'est décentré, incliné ni
      // replié jusqu'au diaphragme. Sans cela un œil derrière une loupe ne reçoit qu'un rayon sur mille.
      var sd = seq.stop, dr = !!sd && sd.i > j;
      for (var m = j; dr && m <= sd.i; m++) {
        var pm = prims[m];
        if (pm.k === K.MIROIR || pm.O[0] !== 0 || pm.O[1] !== 0 || pm.ez[0] !== 0 || pm.ez[1] !== 0 || pm.sens < 0) dr = false;
      }
      if (dr && nx) {
        var Md = chaine(seq, 587.6, j, sd.i), sdp = Math.abs(Md[0]) > 1e-9 ? Md[1] / Md[0] : 0, Rd = MARGE_PUPILLE * sd.D / 2 / Math.abs(Md[0]);
        // pupille virtuelle (s < −1 : derrière le dépoli, oculaire ou lentille divergente devant l'œil : lunette de Galilée,
        // œil myope corrigé) : rayon négatif, le dépoli tire T dans ce disque et émet de T vers lui (même jacobien)
        if (Math.abs(sdp) > 1 && Rd / Math.abs(sdp) < Math.abs(c[3]) / Math.max(Math.abs(c[2] - pr.zp), 1e-9)) c = [0, 0, pr.zp + sdp, sdp > 0 ? Rd : -Rd];
      }
      var cf = champVu(j);
      if (cf && cf[3] / Math.max(Math.abs(cf[2] - pr.zp), 1e-9) < Math.abs(c[3]) / Math.max(Math.abs(c[2] - pr.zp), 1e-9)) c = cf;
      pr.p[0] = c[0]; pr.p[1] = c[1]; pr.p[2] = c[2]; pr.p[3] = c[3];
      pr.p[5] = nx ? elargir(prims, seq.iDet, j + 1, centrePlan(pr), pr.R, c, c[3] === rayonUtile(nx) ? nx : null) : 0;     // cible élargie
    });
    // cible élargie de la source : pas dans un boîtier (lanterne : seule sort la lumière de sa face avant) ;
    // émetteur = disque circonscrit à la source
    var Rs = em.forme === "rect" ? 0.5 * Math.sqrt(Math.pow(em.a + (em.fil ? Math.abs(em.fil.pente) * em.b : 0), 2) + em.b * em.b) : em.a;
    if (seq.cible) seq.cible.push(Ts.boitier || em.forme === "gauss" ? 0 : elargir(prims, seq.iDet, 0, [frs.O[0] + em.dz * frs.ez[0],
      frs.O[1] + em.dz * frs.ez[1], frs.O[2] + em.dz * frs.ez[2]], Rs, seq.cible, p0));
    // Tirage depuis l'objet éclairé : petit objet (trou, fente source : rayon utile ≤ 6 mm) que seules des
    // lentilles séparent de la source (lampe à incandescence ou spectrale) : point tiré dans l'objet, direction visée
    // dans l'ouverture suivante, rayon remonté À REBOURS à travers ces lentilles (`arriere`, verres échangés) jusqu'au
    // plan d'émission : il compte (luminance L, conservée) s'il y tombe dans la source, sinon il est perdu (mort).
    // Sans cela, un trou de 0,1 mm éclairé par une lampe n'enverrait vers l'objectif qu'un rayon sur quelques milliers.
    seq.mode = 0; seq.de = 0; seq.arriere = [];
    var o = seq.objet, ns = o >= 0 ? suivant(o) : null;
    if (o >= 0 && em.forme !== "gauss" && prims[o].k === K.MASQUE && prims[o].rc <= 6 && ns && banc.tirage !== "source") {
      var lent = true;
      for (var j = 0; j < o; j++) if (prims[j].k !== K.SURF && prims[j].k !== K.IDEALE) lent = false;
      if (lent) {
        seq.mode = 1; seq.de = o;
        seq.cibleObj = centrePlan(prims[o]).concat([prims[o].rc]);
        seq.cibleSuiv = centrePlan(ns).concat([rayonUtile(ns)]);
        // mieux : la pupille d'entrée (image paraxiale du diaphragme d'ouverture vue de l'objet, à s = B/A, rayon
        // R/|A|, marge de 30 %), si rien n'est décentré, incliné ni replié entre l'objet et le diaphragme
        var sto = seq.stop, droit = !!sto;
        for (j = o; droit && j <= sto.i; j++) {
          var pj = prims[j];
          if (pj.k === K.MIROIR || pj.O[0] !== 0 || pj.O[1] !== 0 || pj.ez[0] !== 0 || pj.ez[1] !== 0 || pj.sens < 0) droit = false;
        }
        if (droit) {
          var Mp = chaine(seq, 587.6, o, sto.i), sp = Math.abs(Mp[0]) > 1e-9 ? Mp[1] / Mp[0] : 0, Rp = 1.3 * sto.D / 2 / Math.abs(Mp[0]);
          if (sp > 1 && Rp < seq.cibleSuiv[3]) seq.cibleSuiv = [0, 0, prims[o].zp + sp, Rp];
        }
        seq.arriere = prims.slice(0, o).reverse().map(function (pr) {
          var q = retournerPrim(pr); q.O = pr.O; q.ex = pr.ex; q.ey = pr.ey; q.ez = pr.ez; q.sens = -pr.sens; q.el = pr.el; q.type = pr.type; return q;
        });
      }
    }
    return seq;
  }

  // ================= tirage d'un rayon =================
  function tirer(seq, g, passe, k, Nr) {
    var S = seq.source, em = S.em, sp = S.sp, fr = S.fr, G = seq.guide, uv = [], a = new Alea(graineRayon(g, passe, k)), u1 = a.u(), l, i, kl;
    if (sp.type === 0) { var lk = lambdaContinu(sp, (k + u1) / Nr); l = lk[0]; kl = lk[1]; }
    else { i = 0; while (i < sp.n - 1 && u1 >= sp.cum[i]) i++; l = sp.l[i]; kl = sp.norm; }
    var fx = M.cie(l); fx = [fx[0] * kl, fx[1] * kl, fx[2] * kl];
    var g0 = guidePaire(G, 0, a, uv), u2 = g0[0], u3 = g0[1], xs, ys, As, r, ph, J = null, d, w, v, d2, dn, g1, dq;
    if (seq.mode === 1) {
      var Co = seq.cibleObj, Cs = seq.cibleSuiv, qo = disque(u2, u3);
      var Q = [Co[0] + Co[3] * qo[0], Co[1] + Co[3] * qo[1], Co[2]];
      g1 = guidePaire(G, 1, a, uv); dq = disque(g1[0], g1[1]);
      v = [Cs[0] + Cs[3] * dq[0] - Q[0], Cs[1] + Cs[3] * dq[1] - Q[1], Cs[2] - Q[2]]; d2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2]; dn = Math.sqrt(d2);
      d = [v[0] / dn, v[1] / dn, v[2] / dn];
      var vient = depuisSource(seq, Q, d, l, a);
      w = vient ? em.L * Math.PI * Co[3] * Co[3] * Math.PI * Cs[3] * Cs[3] * d[2] * d[2] / d2 * g0[2] * g1[2] : 0;
      if (seq.jones) J = [0, 0, 0, 0];
      return { p: Q, d: d, l: l, w: w, f: fx, k: kl, J: J, L: 0, n: 1, alea: a, x: 0, y: 0, hors: false, de: seq.de, mort: !vient, uv: uv };
    }
    if (em.forme === "rect") { ys = (u3 - 0.5) * em.b; xs = em.fil ? xFilament(em, u2, ys) : (u2 - 0.5) * em.a; As = aireSource(em); }
    else if (em.forme === "disque") { dq = disque(u2, u3); xs = em.a * dq[0]; ys = em.a * dq[1]; As = Math.PI * em.a * em.a; }
    else { r = Math.sqrt(-2 * Math.log(1 - u2)); ph = 2 * Math.PI * u3; xs = 0.5 * em.a * r * Math.cos(ph); ys = 0.5 * em.a * r * Math.sin(ph); }
    var P = [fr.O[0] + xs * fr.ex[0] + ys * fr.ey[0] + em.dz * fr.ez[0], fr.O[1] + xs * fr.ex[1] + ys * fr.ey[1] + em.dz * fr.ez[1],
      fr.O[2] + xs * fr.ex[2] + ys * fr.ey[2] + em.dz * fr.ez[2]];
    g1 = guidePaire(G, 1, a, uv); var u4 = g1[0], u5 = g1[1];
    if (em.forme === "gauss") {
      r = Math.sqrt(-2 * Math.log(1 - u4)); ph = 2 * Math.PI * u5;
      var tx = 0.5 * em.b * r * Math.cos(ph), ty = 0.5 * em.b * r * Math.sin(ph), nl = Math.sqrt(tx * tx + ty * ty + 1);
      tx /= nl; ty /= nl; var tz = 1 / nl;
      d = [tx * fr.ex[0] + ty * fr.ey[0] + tz * fr.ez[0], tx * fr.ex[1] + ty * fr.ey[1] + tz * fr.ez[1], tx * fr.ex[2] + ty * fr.ey[2] + tz * fr.ez[2]];
      w = em.L * g0[2] * g1[2];
    } else {
      var C = seq.cible;
      dq = vise(u4, u5, C[3], C[4]);
      v = [C[0] + dq[0] - P[0], C[1] + dq[1] - P[1], C[2] - P[2]]; d2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2]; dn = Math.sqrt(d2);
      d = [v[0] / dn, v[1] / dn, v[2] / dn];
      w = em.L * As * Math.PI * dq[2] * d[2] * d[2] / d2 * g0[2] * g1[2];
    }
    if (seq.jones) J = [0, 0, 0, 0];
    return { p: P, d: d, l: l, w: w, f: fx, k: kl, J: J, L: 0, n: 1, alea: a, x: 0, y: 0, hors: false, de: 0, mort: false, uv: uv };
  }
  // Le rayon qui part de Q dans la direction d vient-il de la source ? (à rebours à travers `seq.arriere`, puis plan
  // d'émission dans le repère de la source : filament rectangulaire ou ampoule en disque). pts (dessin seulement,
  // `rejouer`) : reçoit les points de passage à rebours, de la première primitive après Q au plan d'émission.
  function depuisSource(seq, Q, d, l, a, pts) {
    var S = seq.source, em = S.em, fr = S.fr, rb = { p: Q.slice(), d: [-d[0], -d[1], -d[2]], l: l, w: 1, f: [0, 0, 0], J: seq.jones ? [0, 0, 0, 0] : null, L: 0, n: 1, x: 0, y: 0, hors: false };
    for (var j = 0; j < seq.arriere.length; j++) { if (etape(seq.arriere[j], rb, a, seq) !== 0) return false; if (pts) pts.push(rb.p.slice()); }
    var vx = rb.p[0] - fr.O[0], vy = rb.p[1] - fr.O[1], vz = rb.p[2] - fr.O[2], ez = fr.ez, ex = fr.ex, ey = fr.ey;
    var qz = vx * ez[0] + vy * ez[1] + vz * ez[2], dz = rb.d[0] * ez[0] + rb.d[1] * ez[1] + rb.d[2] * ez[2];
    if (dz === 0) return false;
    var t = (em.dz - qz) / dz;
    if (!(t > 0)) return false;
    var px = vx + t * rb.d[0], py = vy + t * rb.d[1], pz = vz + t * rb.d[2];
    if (pts) pts.push([fr.O[0] + px, fr.O[1] + py, fr.O[2] + pz]);
    var x = px * ex[0] + py * ex[1] + pz * ex[2], y = px * ey[0] + py * ey[1] + pz * ey[2];
    if (em.forme === "rect") return em.fil ? dansFilament(em, x, y) : Math.abs(x) < 0.5 * em.a && Math.abs(y) < 0.5 * em.b;
    return x * x + y * y < em.a * em.a;
  }

  // Aide au dessin (pinceau de l'instrument), hors du calcul de l'image : le rayon qui part du point Q de l'OBJET dans
  // la direction d, remonté à rebours (comme le tirage depuis l'objet, `depuisSource`) jusqu'au plan d'émission, pour
  // tout objet que seules des lentilles séparent de la source (lampe, pas le laser). Renvoie null quand on ne sait pas
  // dire (pas d'objet, autre chose qu'une lentille avant lui : l'appelant garde son estimation paraxiale), false si le
  // rayon n'atteint pas ce plan, sinon { x, y } (repère de la source, centre de l'émetteur en 0) et `dans` (il tombe
  // dans l'émetteur : le point est éclairé dans cette direction).
  var ARR_OBJ = typeof WeakMap === "function" ? new WeakMap() : null;      // cache hors de seq (seq est comparé, copié)
  function versSource(seq, Q, d, l) {
    var arr = ARR_OBJ ? ARR_OBJ.get(seq) : undefined;
    if (arr === undefined) {
      var o = seq.objet, P = seq.prims, em0 = seq.source && seq.source.em, ok = o >= 0 && em0 && em0.forme !== "gauss", j;
      for (j = 0; ok && j < o; j++) if (P[j].k !== K.SURF && P[j].k !== K.IDEALE) ok = false;
      arr = ok ? P.slice(0, o).reverse().map(function (pr) {
        var q = retournerPrim(pr); q.O = pr.O; q.ex = pr.ex; q.ey = pr.ey; q.ez = pr.ez; q.sens = -pr.sens; q.el = pr.el; q.type = pr.type; return q;
      }) : null;
      if (ARR_OBJ) ARR_OBJ.set(seq, arr);
    }
    if (!arr) return null;
    var S = seq.source, em = S.em, fr = S.fr, a = new Alea(1), rb = { p: Q.slice(), d: [-d[0], -d[1], -d[2]], l: l, w: 1, f: [0, 0, 0], J: seq.jones ? [0, 0, 0, 0] : null, L: 0, n: 1, x: 0, y: 0, hors: false };
    for (var k = 0; k < arr.length; k++) if (etape(arr[k], rb, a, seq) !== 0) return false;
    var vx = rb.p[0] - fr.O[0], vy = rb.p[1] - fr.O[1], vz = rb.p[2] - fr.O[2], ez = fr.ez, ex = fr.ex, ey = fr.ey;
    var qz = vx * ez[0] + vy * ez[1] + vz * ez[2], dz = rb.d[0] * ez[0] + rb.d[1] * ez[1] + rb.d[2] * ez[2];
    if (dz === 0) return false;
    var t = (em.dz - qz) / dz;
    if (!(t > 0)) return false;
    var px = vx + t * rb.d[0], py = vy + t * rb.d[1], pz = vz + t * rb.d[2];
    var x = px * ex[0] + py * ex[1] + pz * ex[2], y = px * ey[0] + py * ey[1] + pz * ey[2];
    var dans = em.forme === "rect" ? (em.fil ? dansFilament(em, x, y) : Math.abs(x) < 0.5 * em.a && Math.abs(y) < 0.5 * em.b) : x * x + y * y < em.a * em.a;
    return { x: x, y: y, dans: !!dans };
  }

  // ================= formes des masques (1 transmis, 0 opaque) =================
  function forme(f, a, x, y) {
    var m, xm, n;
    switch (f) {
      case F.DISQUE: return x * x + y * y < a[0] * a[0] ? 1 : 0;
      case F.RECT: return Math.abs(x) < 0.5 * a[0] && Math.abs(y) < 0.5 * a[1] ? 1 : 0;
      case F.FENTES:
        if (Math.abs(y) >= 0.5 * a[3]) return 0;
        n = a[0]; xm = 0;
        if (n > 1.5) { m = Math.min(Math.max(Math.floor(x / a[2] + 0.5 * (n - 1) + 0.5), 0), n - 1); xm = (m - 0.5 * (n - 1)) * a[2]; }
        return Math.abs(x - xm) < 0.5 * a[1] ? 1 : 0;
      case F.TROUS: {
        n = a[0]; xm = 0;
        if (n > 1.5) { m = Math.min(Math.max(Math.floor(x / a[2] + 0.5 * (n - 1) + 0.5), 0), n - 1); xm = (m - 0.5 * (n - 1)) * a[2]; }
        var dx = x - xm; return dx * dx + y * y < 0.25 * a[1] * a[1] ? 1 : 0;
      }
      case F.LETTRE: {
        var u = x / a[0], v = y / a[0];
        return (u > -6 && u < -3 && v > -10 && v < 10) || (u > -6 && u < 6 && v > 7 && v < 10) || (u > -6 && u < 3 && v > -1.5 && v < 1.5) ? 1 : 0;
      }
      case F.GRILLE: {
        if (Math.abs(x) >= a[2] || Math.abs(y) >= a[2]) return 0;
        var gx = Math.abs(x - a[0] * Math.floor(x / a[0] + 0.5)), gy = Math.abs(y - a[0] * Math.floor(y / a[0] + 0.5));
        if (gx < 0.5 * a[1] || gy < 0.5 * a[1]) return 0;
        if (a[3] > 0) {
          gx = Math.abs(x - a[3] * Math.floor(x / a[3] + 0.5)); gy = Math.abs(y - a[3] * Math.floor(y / a[3] + 0.5));
          if (gx < 0.5 * a[4] || gy < 0.5 * a[4]) return 0;
        }
        return 1;
      }
      case F.REGLE: {
        if (Math.abs(x) >= a[0] + 2 || Math.abs(y) >= a[2]) return 0;
        var j = Math.floor(x / a[3] + 0.5);
        if (Math.abs(j * a[3]) <= a[0] && Math.abs(x - j * a[3]) < 0.5 * a[1]) {
          var aj = Math.abs(j), len = aj % 10 === 0 ? 2.5 : aj % 5 === 0 ? 1.6 : 1.0;
          if (y + a[2] < len) return 0;
        }
        return 1;
      }
      case F.DEMIPLAN: return x > a[0] ? 1 : 0;
      case F.PASTILLE: { var r2 = x * x + y * y; return r2 > a[0] * a[0] && r2 < a[1] * a[1] ? 1 : 0; }
      case F.FIL: return Math.abs(x) >= 0.5 * a[0] && x * x + y * y < a[1] * a[1] ? 1 : 0;
      case F.BIFENTES: {
        var ib = Math.floor(x / a[5] + a[7] + 0.5);
        if (ib < 0 || ib > 2) return 0;
        if (Math.abs(y) >= 0.5 * a[4]) return 0;
        if ((Math.round(a[6]) >> ib) & 1) return 0;
        return Math.abs(Math.abs(x - (ib - a[7]) * a[5]) - 0.5 * a[ib]) < 0.5 * a[3] ? 1 : 0;
      }
      case F.DIAPO: {                    // transmission en intensité au texel le plus proche (pas 0/1)
        var nD = DIAPOS.n;
        if (!nD) return Math.abs(x) < a[1] && Math.abs(y) < a[1] ? 1 : 0;
        var iD = Math.floor((x / a[1] + 1) * 0.5 * nD), jD = Math.floor((1 - y / a[1]) * 0.5 * nD);
        return iD < 0 || iD >= nD || jD < 0 || jD >= nD ? 0 : DIAPOS.t[a[0]][jD * nD + iD];
      }
      case F.RETICULE: {
        if (x * x + y * y >= a[3] * a[3]) return 0;
        if (Math.abs(x) < 0.5 * a[1] || Math.abs(y) < 0.5 * a[1]) return 0;
        if (a[0] > 0.5) {
          var jr = Math.floor(x / a[2] + 0.5);
          if (Math.abs(jr * a[2]) <= 5 && Math.abs(x - jr * a[2]) < 0.5 * a[1]) {
            var ar = Math.abs(jr), lr = ar % 10 === 0 ? 0.6 : ar % 5 === 0 ? 0.4 : 0.25;
            if (y > 0 && y < lr) return 0;
          }
        }
        return 1;
      }
    }
    return 1;
  }
  // Face « transmission » : amplitude complexe [re, im] au point (x, y) du plan de l'élément (repère propre),
  // échantillonnée sans anticrénelage (le moteur ondulatoire la reprend par maille).
  function transmission(el, x, y, l) {
    var T = TYPES[el.type], L = T.prims(params(el), { optique: "parfaite", sens: 1 }, el) || [], re = 1, im = 0;
    L.forEach(function (pr) {
      var t = 1, ph = 0;
      if (pr.k === K.MASQUE) t = Math.abs(x) <= pr.Sm && Math.abs(y) <= pr.Sm ? forme(pr.p[0], pr.p.slice(1), x, y) : 1;
      if (pr.k === K.MASQUE && pr.p[0] === F.DIAPO) t = Math.sqrt(t);
      else if (pr.k === K.PHASE) ph = phase(pr.p, x, y);
      else if (pr.k === K.FILTRE) t = Math.sqrt(transFiltre(pr.p[0], l));
      var c = t * Math.cos(ph), s = t * Math.sin(ph), r2 = re * c - im * s; im = re * s + im * c; re = r2;
    });
    return [re, im];
  }
  function phase(p, x, y) {
    if (p[0] === 2) return forme(F.LETTRE, [0.25], x, y) ? p[1] : 0;
    return p[1] * Math.exp(-(x * x + y * y) / (p[2] * p[2]));
  }
  // Face « jones » : matrice 2 × 2 complexe [[a, b], [c, d]] en [re, im], dans les axes x, y du labo.
  function jonesPrim(p, l) {
    var c = Math.cos(p[1]), s = Math.sin(p[1]);
    if (p[0] === 1) return [[c * c, 0], [c * s, 0], [c * s, 0], [s * s, 0]];
    var g = p[2] * p[3] / l, er = Math.cos(g), ei = Math.sin(g);
    return [[c * c + s * s * er, s * s * ei], [c * s * (1 - er), -c * s * ei], [c * s * (1 - er), -c * s * ei], [s * s + c * c * er, c * c * ei]];
  }
  function jones(el, l) {
    var L = TYPES[el.type].prims(params(el), { optique: "parfaite", sens: 1 }, el) || [];
    for (var i = 0; i < L.length; i++) if (L[i].k === K.JONES) return jonesPrim(L[i].p, l);
    return [[1, 0], [0, 0], [0, 0], [1, 0]];
  }

  // ================= une primitive : face « rayon » =================
  // r = {p, d (labo), l, w, f, J, L (chemin optique), n (indice du milieu), x, y (impact au détecteur)}.
  // Renvoie 0 : continue ; 1 : arrêté ; 2 : détecté.
  function monture(pr, x, y) {
    if (Math.abs(x) > pr.Sm || Math.abs(y) > pr.Sm) return 2;
    return x * x + y * y > pr.R * pr.R ? 1 : 0;
  }
  function interConique(q, d, zv, c, k) {
    var qx = q[0], qy = q[1], qz = q[2] - zv, e = 1 + k;
    var A = c * (d[0] * d[0] + d[1] * d[1] + e * d[2] * d[2]), B = d[2] - c * (qx * d[0] + qy * d[1] + e * qz * d[2]);
    var C = c * (qx * qx + qy * qy + e * qz * qz) - 2 * qz, disc = B * B - A * C;
    if (disc < 0) return NaN;
    var s = Math.sqrt(disc), den = B + (B >= 0 ? s : -s), t1 = den !== 0 ? C / den : NaN, t2 = A !== 0 ? den / A : NaN;
    // Deux racines ; on garde la plus proche sur la nappe du dioptre (c(1+k)Z < 1 : demi-sphère côté sommet, nappe
    // de l'hyperboloïde qui porte le sommet), en avant du rayon.
    var o1 = t1 > -EPS_T && t1 < TMAX && c * e * (qz + t1 * d[2]) < 1, o2 = t2 > -EPS_T && t2 < TMAX && c * e * (qz + t2 * d[2]) < 1;
    if (o1 && o2) return t1 < t2 ? t1 : t2;
    return o1 ? t1 : o2 ? t2 : NaN;
  }
  function etape(pr, r, alea, seq) {
    var P = pr.p, u, i;
    if (pr.k === K.AIRY) {
      if (r.hors) return 0;            // passé à côté du diaphragme (hors de sa monture) : pas diffracté par lui
      u = alea.u() * 127; i = Math.floor(u);
      var vA = AIRY[i] + (u - i) * (AIRY[Math.min(i + 1, 127)] - AIRY[i]), al = vA * r.l * 1e-6 / (Math.PI * P[0] * r.n), ps = 2 * Math.PI * alea.u();
      var az = Math.abs(r.d[2]), dx = r.d[0] + al * az * Math.cos(ps), dy = r.d[1] + al * az * Math.sin(ps), na = Math.sqrt(dx * dx + dy * dy + r.d[2] * r.d[2]);
      r.d = [dx / na, dy / na, r.d[2] / na];
      return 0;
    }
    var O = pr.O, ex = pr.ex, ey = pr.ey, ez = pr.ez;
    var vx = r.p[0] - O[0], vy = r.p[1] - O[1], vz = r.p[2] - O[2];
    var q = [vx * ex[0] + vy * ex[1] + vz * ex[2], vx * ey[0] + vy * ey[1] + vz * ey[2], vx * ez[0] + vy * ez[1] + vz * ez[2]];
    var d = [r.d[0] * ex[0] + r.d[1] * ex[1] + r.d[2] * ex[2], r.d[0] * ey[0] + r.d[1] * ey[1] + r.d[2] * ey[2], r.d[0] * ez[0] + r.d[1] * ez[1] + r.d[2] * ez[2]];
    var t, m, dLab = null;
    if (pr.k === K.SURF) {
      t = interConique(q, d, pr.dz, P[0], P[1]);
      var touche = t > -EPS_T && t < TMAX;
      if (!touche) t = (pr.dz - q[2]) / d[2];
      if (!(t > -EPS_T && t < TMAX)) return 1;
      q = [q[0] + t * d[0], q[1] + t * d[1], q[2] + t * d[2]]; r.L += r.n * t;
      m = monture(pr, q[0], q[1]); r.hors = m === 2;
      if (m === 1 || (m === 0 && !touche)) return 1;
      if (m === 0) {
        var Z = q[2] - pr.dz, nx = P[0] * q[0], ny = P[0] * q[1], nz = P[0] * (1 + P[1]) * Z - 1, nn = Math.sqrt(nx * nx + ny * ny + nz * nz);
        nx /= nn; ny /= nn; nz /= nn;
        var n1 = nVerre(P[2], r.l), n2 = nVerre(P[3], r.l), eta = n1 / n2, ci = -(d[0] * nx + d[1] * ny + d[2] * nz);
        if (ci < 0) { nx = -nx; ny = -ny; nz = -nz; ci = -ci; }
        var kk = 1 - eta * eta * (1 - ci * ci);
        if (kk < 0) return 1;
        var co = eta * ci - Math.sqrt(kk);
        d = [eta * d[0] + co * nx, eta * d[1] + co * ny, eta * d[2] + co * nz]; r.n = n2;
      }
    } else {
      t = (pr.dz - q[2]) / d[2];
      if (!(t > -EPS_T && t < TMAX)) return 1;
      q = [q[0] + t * d[0], q[1] + t * d[1], q[2] + t * d[2]]; r.L += r.n * t;
      if (pr.k === K.DET) {
        if (Math.abs(q[0]) < pr.Sm && Math.abs(q[1]) < P[9] && (P[0] === 0 || forme(P[0], P.slice(1), q[0], q[1]) === 0)) {
          r.x = q[0]; r.y = q[1];
          r.p = [O[0] + q[0] * ex[0] + q[1] * ey[0] + q[2] * ez[0], O[1] + q[0] * ex[1] + q[1] * ey[1] + q[2] * ez[1], O[2] + q[0] * ex[2] + q[1] * ey[2] + q[2] * ez[2]];
          return 2;
        }
        return 1;
      }
      m = monture(pr, q[0], q[1]); r.hors = m === 2;
      if (m === 1) return 1;
      if (m === 0) {
        if (pr.k === K.IDEALE) {
          var sg = d[2] >= 0 ? 1 : -1, ad = Math.abs(d[2]), mx = d[0] / ad - q[0] / P[0], my = d[1] / ad - q[1] / P[0], nm = Math.sqrt(mx * mx + my * my + 1);
          d = [mx / nm, my / nm, sg / nm]; r.L -= (q[0] * q[0] + q[1] * q[1]) / (2 * P[0]);
        } else if (pr.k === K.MASQUE) {
          var tm = forme(P[0], P.slice(1), q[0], q[1]);
          if (tm === 0) return 1;
          if (tm !== 1) r.w *= tm;           // diapo : niveaux de gris
        } else if (pr.k === K.DIFFUSEUR) {
          var pl = [O[0] + q[0] * ex[0] + q[1] * ey[0] + q[2] * ez[0], O[1] + q[0] * ex[1] + q[1] * ey[1] + q[2] * ez[1], O[2] + q[0] * ex[2] + q[1] * ey[2] + q[2] * ez[2]];
          var gd = guidePaire(seq && seq.guide, 2 + P[4], alea, r.uv), dd = vise(gd[0], gd[1], Math.abs(P[3]), P[5]);
          var v = [P[0] + dd[0] - pl[0], P[1] + dd[1] - pl[1], P[2] - pl[2]], d2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2], dn = Math.sqrt(d2);
          if (P[3] < 0) { v[0] = -v[0]; v[1] = -v[1]; v[2] = -v[2]; }      // cible virtuelle (pupille d'entrée derrière le dépoli) : le rayon part de T vers le dépoli et continue
          dLab = [v[0] / dn, v[1] / dn, v[2] / dn];
          var co2 = Math.abs(dLab[0] * ez[0] + dLab[1] * ez[1] + dLab[2] * ez[2]);
          r.w *= co2 * Math.abs(dLab[2]) * dd[2] / d2 * gd[2];
        } else if (pr.k === K.RESEAU) {
          var gl = r.l * 1e-6 / P[0], Ssum = 0, o, s2;
          for (o = -3; o <= 3; o++) { s2 = (d[0] + o * gl) * (d[0] + o * gl) + d[1] * d[1]; if (s2 < 1) Ssum += ETA_RESEAU[Math.abs(o)]; }
          if (!(Ssum > 0)) return 1;
          var ur, cumr = 0, ordre = 0;
          // r.ordre : ordre imposé (pinceau de l'instrument, un faisceau par ordre ; jamais dans le tracé ni la
          // référence : aucun tirage consommé), poids de cet ordre seul
          if (r.ordre != null) { ordre = r.ordre; Ssum = ETA_RESEAU[Math.min(3, Math.abs(ordre))]; }
          else {
            ur = alea.u() * Ssum;
            for (o = -3; o <= 3; o++) {
              s2 = (d[0] + o * gl) * (d[0] + o * gl) + d[1] * d[1];
              if (s2 < 1) { cumr += ETA_RESEAU[Math.abs(o)]; ordre = o; if (ur < cumr) break; }
            }
          }
          var dxr = d[0] + ordre * gl, s2r = dxr * dxr + d[1] * d[1];
          if (!(s2r < 1)) return 1;
          d = [dxr, d[1], (d[2] >= 0 ? 1 : -1) * Math.sqrt(1 - s2r)]; r.w *= Ssum;
        } else if (pr.k === K.MIROIR) {
          d = [d[0], d[1], -d[2]];
        } else if (pr.k === K.JONES) {
          if (seq.jones && r.J && !(r.J[0] || r.J[1] || r.J[2] || r.J[3])) {
            // lumière naturelle (J nul) : une lame la laisse naturelle ; le polariseur la rend polarisée selon son axe, ½
            if (P[0] === 1) { r.J = [Math.cos(P[1]), 0, Math.sin(P[1]), 0]; r.w *= 0.5; }
          } else if (seq.jones && r.J) {
            var Mj = jonesPrim(P, r.l), J = r.J;
            var ar = Mj[0][0] * J[0] - Mj[0][1] * J[1] + Mj[1][0] * J[2] - Mj[1][1] * J[3], ai = Mj[0][0] * J[1] + Mj[0][1] * J[0] + Mj[1][0] * J[3] + Mj[1][1] * J[2];
            var br = Mj[2][0] * J[0] - Mj[2][1] * J[1] + Mj[3][0] * J[2] - Mj[3][1] * J[3], bi = Mj[2][0] * J[1] + Mj[2][1] * J[0] + Mj[3][0] * J[3] + Mj[3][1] * J[2];
            var I = ar * ar + ai * ai + br * br + bi * bi;
            if (!(I > 0)) return 1;
            var nj = Math.sqrt(I); r.J = [ar / nj, ai / nj, br / nj, bi / nj]; r.w *= I;
          }
        } else if (pr.k === K.FILTRE) {
          r.w *= transFiltre(P[0], r.l);
        } else if (pr.k === K.PHASE) {
          if (P[0] === 1) {
            var gk = r.l * 1e-6 / (2 * Math.PI) * P[1] * Math.exp(-(q[0] * q[0] + q[1] * q[1]) / (P[2] * P[2])) * (-2 / (P[2] * P[2]));
            var px = d[0] + gk * q[0], py = d[1] + gk * q[1], np = Math.sqrt(px * px + py * py + d[2] * d[2]);
            d = [px / np, py / np, d[2] / np];
          }
        }
      }
    }
    r.p = [O[0] + q[0] * ex[0] + q[1] * ey[0] + q[2] * ez[0], O[1] + q[0] * ex[1] + q[1] * ey[1] + q[2] * ez[1], O[2] + q[0] * ex[2] + q[1] * ey[2] + q[2] * ez[2]];
    r.d = dLab || [d[0] * ex[0] + d[1] * ey[0] + d[2] * ez[0], d[0] * ex[1] + d[1] * ey[1] + d[2] * ez[1], d[0] * ex[2] + d[1] * ey[2] + d[2] * ez[2]];
    return 0;
  }
  // Suit le rayon de la primitive `de` (0 par défaut) au détecteur. o.pts : points de passage (labo) ; o.sansAiry.
  function suivre(seq, r, alea, o) {
    var P = seq.prims, pts = o && o.pts ? [r.p.slice()] : null, de = o && o.de != null ? o.de : (r.de || 0);
    if (r.mort) return { etat: "arrete", i: -1, pts: pts };
    for (var i = de; i < P.length; i++) {
      if (P[i].k === K.AIRY && o && o.sansAiry) continue;
      var c = etape(P[i], r, alea, seq);
      if (pts && P[i].k !== K.AIRY) pts.push(r.p.slice());
      if (c === 1) return { etat: "arrete", i: i, pts: pts };
      if (c === 2) return { etat: "detecte", i: i, pts: pts };
    }
    return { etat: "perdu", i: P.length, pts: pts };
  }
  // Une passe sur le processeur : Σ poids × XYZ par pixel de la fenêtre (cx ± W, cy ± W) du détecteur ; ligne 0 en BAS
  // (comme la carte graphique). rendu = {res, W, cx, cy, Nr, graine, passe}.
  function passeCPU(seq, rendu) {
    var res = rendu.res, W = rendu.W, h = 2 * W / res, x0 = (rendu.cx || 0) - W, y0 = (rendu.cy || 0) - W, img = new Float64Array(res * res * 3), n = 0;
    if (!seq.det || !seq.prims.length) return { xyz: img, n: 0 };
    for (var k = 0; k < rendu.Nr; k++) {
      var r = tirer(seq, rendu.graine || 1, rendu.passe || 0, k, rendu.Nr), s = suivre(seq, r, r.alea);
      if (s.etat !== "detecte") continue;
      var ix = Math.floor((r.x - x0) / h), iy = Math.floor((r.y - y0) / h);
      if (ix < 0 || iy < 0 || ix >= res || iy >= res) continue;
      var q = 3 * (iy * res + ix); img[q] += r.w * r.f[0]; img[q + 1] += r.w * r.f[1]; img[q + 2] += r.w * r.f[2]; n++;
    }
    return { xyz: img, n: n };
  }
  // ================= rayons qui arrivent en un point =================
  // Sélection en avant puis rejeu, pas de tracé à rebours (il demanderait l'inverse de chaque primitive ; ainsi tout est
  // traversé : dépoli, réseau, Airy, monture contournée). Le traceur de la carte rend les impacts rayon par rayon
  // (`rayons` : x, y, poids × Y, 1000 si détecté ; 4 nombres par rayon) ; `retenir` garde les rayons détectés dans le
  // disque zone = {x, y, r} du détecteur ({p: passe, k, w : poids × Y}, ajoutés à out) ; `choisir` en tire n ; `rejouer`
  // refait chacun sur le processeur avec ses points de passage.
  function retenir(imp, zone, passe, out) {
    var n = imp.length >> 2, r2 = zone.r * zone.r;
    for (var k = 0; k < n; k++) {
      if (imp[4 * k + 3] !== 1000) continue;
      var dx = imp[4 * k] - zone.x, dy = imp[4 * k + 1] - zone.y, w = imp[4 * k + 2];
      if (dx * dx + dy * dy < r2 && w > 0) out.push({ p: passe, k: k, w: w });
    }
    return out;
  }
  // n candidats tirés sans remise, chacun avec une probabilité proportionnelle à son poids (clés −ln u / w, Efraimidis
  // et Spirakis) : la lumière qui arrive au point, pas les rayons tels que la visée (guidée, élargie) les a tirés.
  function choisir(cands, n, graine) {
    var a = new Alea(graineRayon(graine || 1, 0, cands.length));
    return cands.map(function (c) { return { c: c, cle: -Math.log(1 - a.u()) / c.w }; })
      .sort(function (x, y) { return x.cle - y.cle; }).slice(0, n).map(function (x) { return x.c; });
  }
  // Le rayon k de la passe (graine g, passe, Nr rayons) : mêmes tirages que `passeCPU` (et que le shader, au flottant
  // près : le test GPU), points de passage dans le repère du labo depuis le point d'émission ; tirage depuis
  // l'objet (mode 1) : le chemin remonté jusqu'au plan d'émission en tête. {etat, i, pts, x, y, w (poids × Y), l}.
  function rejouer(seq, g, passe, k, Nr) {
    var r = tirer(seq, g, passe, k, Nr), avant = null;
    if (seq.mode === 1 && !r.mort) { avant = []; depuisSource(seq, r.p, r.d, r.l, new Alea(1), avant); avant.reverse(); }
    var s = suivre(seq, r, r.alea, { pts: true });
    return { etat: s.etat, i: s.i, pts: avant ? avant.concat(s.pts) : s.pts, x: r.x, y: r.y, w: r.w * r.f[1], l: r.l };
  }

  // ================= spectromètre à fibre =================
  // Fibre de rayon r (mm) posée en (x, y) du plan du détecteur. Densité spectrale = éclairement par nm, dans les unités du
  // moteur : la pondération du facteur Y sans la sensibilité de l'œil, k(λ) = planck / normP (continu), norm (raies).
  // spe = {x, y, r, la, lb, nb} : continu, nb cases de [la, lb] ; raies, une case par raie (nb ignoré).
  function kSpectre(sp, l) { return sp.type === 0 ? planckU(l, sp.T) / sp.normP : sp.norm; }
  function casesSpectre(seq, spe) { var sp = seq.source.sp; return sp.type === 0 ? spe.nb : sp.n; }
  // Rayons : Σ w·k(λ) des rayons détectés dans la fibre, par case (mêmes rayons que passeCPU ; le shader de tracé fait
  // le même tri quand rendu.spe est donné). Densité = case / (rayons × π r² × largeur de la case) ; raie = case / (rayons × π r²).
  function spectreCPU(seq, rendu) {
    var spe = rendu.spe, sp = seq.source.sp, nb = casesSpectre(seq, spe), out = new Float64Array(nb), r2 = spe.r * spe.r;
    if (!seq.det || !seq.prims.length) return out;
    for (var k = 0; k < rendu.Nr; k++) {
      var r = tirer(seq, rendu.graine || 1, rendu.passe || 0, k, rendu.Nr), s = suivre(seq, r, r.alea);
      if (s.etat !== "detecte") continue;
      var dx = r.x - spe.x, dy = r.y - spe.y;
      if (dx * dx + dy * dy >= r2) continue;
      var b = sp.type === 0 ? Math.floor((r.l - spe.la) / (spe.lb - spe.la) * nb) : sp.l.indexOf(r.l);
      if (b < 0 || b >= nb) continue;
      out[b] += r.w * r.k;
    }
    return out;
  }
  // Poids spectral d'une longueur d'onde pour le moteur ondulatoire (figure nue × poids = densité, mêmes unités que
  // spectreCPU) : continu k(λ) / (b − a) par nm ; raie j, sa part × norm ; × filtres et polariseurs (facteurOnde).
  function poidsSpectre(seq, l, j) {
    var sp = seq.source.sp, t = facteurOnde(seq, l);
    return sp.type === 0 ? t * kSpectre(sp, l) / (sp.b - sp.a) : t * sp.norm * (sp.cum[j] - (j ? sp.cum[j - 1] : 0));
  }
  // Pinceau (aide « pinceau de rayons exacts ») : n rayons depuis le point (x, y) du plan de la primitive `de` − 1
  // (l'objet : o.de = seq.objet + 1 ; la source : 0), dans le plan dessiné (o.axe : 1 = profil, y ; 0 = dessus, x),
  // visant l'ouverture utile de la primitive suivante ; une liste par longueur d'onde (o.l).
  function pinceau(seq, pt, o) {
    var P = seq.prims, de = o.de || 0, n = o.n || 15, axe = o.axe == null ? 1 : o.axe, out = [];
    var j = de; while (j < P.length && P[j].k === K.AIRY) j++;
    if (j >= P.length) return out;
    var C = centrePlan(P[j]), Rc = rayonUtile(P[j]) * 0.97, z0 = pt.z;
    (o.l || [550]).forEach(function (l) {
      for (var i = 0; i < n; i++) {
        var h = n > 1 ? -Rc + 2 * Rc * i / (n - 1) : 0, Q = [C[0] + (axe === 0 ? h : 0), C[1] + (axe === 1 ? h : 0), C[2]];
        var v = [Q[0] - pt.x, Q[1] - pt.y, Q[2] - z0], dn = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
        var r = { p: [pt.x, pt.y, z0], d: [v[0] / dn, v[1] / dn, v[2] / dn], l: l, w: 1, f: [0, 0, 0], J: null, L: 0, n: 1, x: 0, y: 0, hors: false };
        var s = suivre(seq, r, new Alea(graineRayon(7, 0, i)), { pts: true, de: j, sansAiry: true });
        out.push({ l: l, pts: s.pts, etat: s.etat, L: r.L, x: r.x, y: r.y });
      }
    });
    return out;
  }

  // ================= paraxial =================
  // Matrices (y, n·u) ; « après i » comprend l'action de la primitive i ; i = −1 : plan d'émission de la source.
  function abcdPrim(pr, l) {
    if (pr.k === K.SURF) { var n1 = nVerre(pr.p[2], l), n2 = nVerre(pr.p[3], l); return [1, 0, -(n2 - n1) * pr.p[0] * pr.sens, 1]; }
    if (pr.k === K.IDEALE) return [1, 0, -1 / pr.p[0], 1];
    return [1, 0, 0, 1];
  }
  function mul(B, A) { return [B[0] * A[0] + B[1] * A[2], B[0] * A[1] + B[1] * A[3], B[2] * A[0] + B[3] * A[2], B[2] * A[1] + B[3] * A[3]]; }
  function milieu(seq, i, l) {          // indice du milieu après la primitive i (la déviation d'Airy est sans épaisseur)
    while (i >= 0 && seq.prims[i].k === K.AIRY) i--;
    return i >= 0 && seq.prims[i].k === K.SURF ? nVerre(seq.prims[i].p[3], l) : 1;
  }
  function sDe(seq, i) { return i < 0 ? 0 : seq.prims[i].s; }
  // Après la primitive i → avant la primitive j (j ≤ nombre de primitives ; j = n : rien après).
  function chaine(seq, l, i, j) {
    var P = seq.prims, Mt = [1, 0, 0, 1], s = sDe(seq, i), n;
    for (var m = i + 1; m <= j && m < P.length; m++) {
      n = milieu(seq, m - 1, l); Mt = mul([1, (P[m].s - s) / n, 0, 1], Mt); s = P[m].s;
      if (m < j) Mt = mul(abcdPrim(P[m], l), Mt);
    }
    return Mt;
  }
  // z du labo d'une abscisse s du trajet déplié.
  function zDeS(seq, s) {
    var P = seq.prims, za = seq.zEm, sa = 0;
    for (var m = 0; m < P.length; m++) {
      if (s <= P[m].s) { var dz = P[m].zp - za, ds = P[m].s - sa; return ds > 0 ? za + dz * (s - sa) / ds : za; }
      za = P[m].zp; sa = P[m].s;
    }
    var der = P.length ? P[P.length - 1] : null;
    return za + (der && der.sens < 0 ? -1 : 1) * (s - sa);
  }
  // Images réelles de l'objet au plan « après i » (gamma = grandissement transversal) et image finale (avant le
  // détecteur, d = −B/D après la dernière primitive : réelle si d ≥ 0, virtuelle sinon ; infini si D = 0).
  function images(seq, l, i) {
    var P = seq.prims, nd = seq.iDet, out = [], Mt = [1, 0, 0, 1], s = sDe(seq, i), m, n;
    if (nd < 0) return null;
    for (m = i + 1; m <= nd; m++) {
      n = milieu(seq, m - 1, l);
      var gap = P[m].s - s;
      if (n === 1 && Math.abs(Mt[3]) > 1e-15) {
        var d = -Mt[1] / Mt[3];
        if (d > 1e-9 && d <= gap && !(out.length && Math.abs(out[out.length - 1].s - (s + d)) < 1e-9))
          out.push({ s: s + d, z: zDeS(seq, s + d), gamma: Mt[0] + d * Mt[2], apres: m - 1 });
      }
      Mt = mul([1, gap / n, 0, 1], Mt); s = P[m].s;
      if (m < nd) Mt = mul(abcdPrim(P[m], l), Mt);
    }
    var last = nd - 1, Mf, sl, fin;
    if (last > i) { Mf = mul(abcdPrim(P[last], l), chaine(seq, l, i, last)); sl = P[last].s; } else { Mf = [1, 0, 0, 1]; sl = sDe(seq, i); }
    if (Math.abs(Mf[3]) < 1e-12) fin = { infini: true, s: Infinity, gamma: Infinity, angle: Mf[2] };
    else { var df = -Mf[1] / Mf[3]; fin = { infini: false, s: sl + df, z: zDeS(seq, sl + df), gamma: 1 / Mf[3], reelle: df >= 0 }; }
    return { reelles: out, finale: fin, M: Mf };
  }
  // Diaphragme d'ouverture vu de l'objet (au plan « après i ») : primitive j dont l'ouverture limite le plus l'angle
  // des rayons issus du point axial ; D = diamètre (deux fois la plus petite demi-ouverture).
  function ouverture(seq, l, i) {
    var P = seq.prims, nd = seq.iDet < 0 ? P.length : seq.iDet, best = null;
    for (var j = i + 1; j < nd; j++) {
      if (P[j].k === K.AIRY) continue;
      var a = Math.min(P[j].ap[0], P[j].ap[1]);
      if (!(a < GRAND / 2)) continue;
      var B = chaine(seq, l, i, j)[1];
      if (Math.abs(B) < 1e-9) continue;
      var u = a / Math.abs(B);
      if (!best || u < best.u) best = { i: j, u: u, D: 2 * a, el: P[j].el };
    }
    return best;
  }
  function couper(poly, a, b, c) {         // garde a·y + b·u ≤ c (Sutherland-Hodgman)
    var out = [], n = poly.length;
    for (var k = 0; k < n; k++) {
      var Pk = poly[k], Q = poly[(k + 1) % n], fp = a * Pk[0] + b * Pk[1] - c, fq = a * Q[0] + b * Q[1] - c;
      if (fp <= 0) out.push(Pk);
      if ((fp < 0 && fq > 0) || (fp > 0 && fq < 0)) { var t = fp / (fp - fq); out.push([Pk[0] + t * (Q[0] - Pk[0]), Pk[1] + t * (Q[1] - Pk[1])]); }
    }
    return out;
  }
  // Enveloppe paraxiale du faisceau dans le plan dessiné (axe 1 : y, profil ; 0 : x, dessus) : rayons (y, n·u) issus de
  // l'objet au plan « après i », y ∈ [y0, y1], |u| ≤ U, découpés par chaque ouverture jusqu'au détecteur. Renvoie
  // {poly, pts: [{s, z, lo, hi}]} (nsub points par intervalle) ; vide si rien ne passe.
  function enveloppe(seq, l, i, y0, y1, axe, U, nsub) {
    var P = seq.prims, nd = seq.iDet < 0 ? P.length - 1 : seq.iDet, poly = [[y0, -U], [y1, -U], [y1, U], [y0, U]], j, Mt;
    axe = axe == null ? 1 : axe; nsub = nsub || 8;
    for (j = i + 1; j <= nd && poly.length; j++) {
      if (P[j].k === K.AIRY) continue;
      var a = P[j].ap[axe];
      if (!(a < GRAND / 2)) continue;
      Mt = chaine(seq, l, i, j);
      poly = couper(couper(poly, Mt[0], Mt[1], a), -Mt[0], -Mt[1], a);
    }
    var pts = [];
    if (!poly.length) return { poly: poly, pts: pts };
    function bornes(Mx, s) {
      var lo = Infinity, hi = -Infinity;
      poly.forEach(function (v) { var y = Mx[0] * v[0] + Mx[1] * v[1]; if (y < lo) lo = y; if (y > hi) hi = y; });
      pts.push({ s: s, z: zDeS(seq, s), lo: lo, hi: hi });
    }
    Mt = [1, 0, 0, 1]; var s = sDe(seq, i);
    bornes(Mt, s);
    for (j = i + 1; j <= nd; j++) {
      var n = milieu(seq, j - 1, l), gap = P[j].s - s;
      for (var k = 1; k <= nsub; k++) bornes(mul([1, gap * k / nsub / n, 0, 1], Mt), s + gap * k / nsub);
      Mt = mul([1, gap / n, 0, 1], Mt); s = P[j].s;
      if (j < nd) Mt = mul(abcdPrim(P[j], l), Mt);
    }
    return { poly: poly, pts: pts };
  }
  // Faisceau gaussien (laser) : col w0 au plan d'émission ; rayon w(s) à 1/e² aux abscisses données (dans l'air).
  function gaussien(seq, l, w0, liste) {
    var lm = l * 1e-6, zr = Math.PI * w0 * w0 / lm, P = seq.prims;
    return liste.map(function (s) {
      var j = 0; while (j < P.length && P[j].s < s) j++;
      var Mt = j > 0 ? mul(abcdPrim(P[j - 1], l), chaine(seq, l, -1, j - 1)) : [1, 0, 0, 1];
      Mt = mul([1, (s - sDe(seq, j - 1)) / milieu(seq, j - 1, l), 0, 1], Mt);
      // q' = (A q + B) / (C q + D), q = i zr ; Im(1/q') = −λ/(π w²)
      var A = Mt[0], B = Mt[1], C = Mt[2], D = Mt[3], nr = B * D + A * C * zr * zr, ni = zr * (A * D - B * C), den = D * D + C * C * zr * zr;
      var qr = nr / den, qi = ni / den, im = -qi / (qr * qr + qi * qi);
      return { s: s, z: zDeS(seq, s), w: Math.sqrt(-lm / (Math.PI * im)) };
    });
  }

  // ================= emballage pour la carte graphique =================
  // Une primitive = 8 texels RGBA32F : (k, dz, R, Sm), (O, sens), (ex, p0), (ey, p1), (ez, p2), p3..p14.
  function emballer(seq) {
    var P = seq.prims.concat(seq.arriere || []), n = seq.prims.length, D = new Float32Array(Math.max(1, P.length) * 32);
    P.forEach(function (pr, i) {
      var o = i * 32, p = pr.p;
      D.set([pr.k, pr.dz, pr.R, pr.Sm, pr.O[0], pr.O[1], pr.O[2], pr.sens, pr.ex[0], pr.ex[1], pr.ex[2], p[0],
        pr.ey[0], pr.ey[1], pr.ey[2], p[1], pr.ez[0], pr.ez[1], pr.ez[2], p[2]], o);
      D.set(p.slice(3, 15), o + 20);
    });
    return { donnees: D, n: n, nb: P.length - n };
  }
  // Uniformes de la source pour le shader.
  function sourceGPU(seq) {
    var S = seq.source, em = S.em, sp = S.sp, ls = [0, 0, 0, 0, 0, 0, 0, 0], cum = [1, 1, 1, 1, 1, 1, 1, 1];
    if (sp.type === 1) for (var i = 0; i < sp.n && i < 8; i++) { ls[i] = sp.l[i]; cum[i] = sp.cum[i]; }
    return { forme: em.forme === "rect" ? 0 : em.forme === "disque" ? 1 : 2, O: S.fr.O, X: S.fr.ex, Y: S.fr.ey, Z: S.fr.ez,
      dim: [em.a, em.b, em.dz, aireSource(em)], fil: em.fil ? [em.fil.n, em.fil.plein, em.fil.pente] : [0, 0, 0], cible: seq.cible ? seq.cible.slice(0, 4) : [0, 0, 0, 0], cibleL: seq.cible ? seq.cible[4] : 0, L: em.L,
      spType: sp.type, spC: sp.type === 0 ? [sp.a, sp.b, sp.T, 1 / sp.normP] : [0, 0, 0, sp.norm], Q: sp.type === 0 ? sp.Q : new Array(TIRAGE_L.nq).fill(0), nl: sp.type === 1 ? Math.min(sp.n, 8) : 0, l: ls, cum: cum,
      verre: [M.VERRES.bk7.A, M.VERRES.bk7.B * 1e18], mode: seq.mode || 0, de: seq.de || 0,
      obj: seq.mode === 1 ? seq.cibleObj : [0, 0, 0, 0], suiv: seq.mode === 1 ? seq.cibleSuiv : [0, 0, 0, 0] };
  }
  // Poids type d'un rayon (point central vers le centre de la cible) : échelle du repli sans mélange en flottant 32 bits.
  function poidsType(seq) {
    var S = seq.source, em = S.em, C = seq.cible;
    if (seq.mode === 1) { var Co = seq.cibleObj, Cs = seq.cibleSuiv, dd = Math.max(Math.abs(Cs[2] - Co[2]), 1); return em.L * Math.PI * Co[3] * Co[3] * Math.PI * Cs[3] * Cs[3] / (dd * dd); }
    if (em.forme === "gauss" || !C) return em.L;
    var dz = C[2] - (S.fr.O[2] + em.dz), As = aireSource(em);
    return em.L * As * Math.PI * C[3] * C[3] / Math.max(dz * dz, 1);
  }

  // ================= moteur ondulatoire (processeur) =================
  // Champs : {re, im} en Float64Array, ligne j, colonne i : j * Nx + i ;
  // abscisse de la maille i : (i − N/2) × pas.
  var PLANS_TF = {};
  function planTF(n) {
    if (PLANS_TF[n]) return PLANS_TF[n];
    var lev = Math.round(Math.log(n) / Math.LN2), rev = new Uint32Array(n), cs = new Float64Array(n / 2), sn = new Float64Array(n / 2), i;
    for (i = 0; i < n; i++) { var r = 0, x = i; for (var b = 0; b < lev; b++) { r = (r << 1) | (x & 1); x >>= 1; } rev[i] = r; }
    for (i = 0; i < n / 2; i++) { cs[i] = Math.cos(2 * Math.PI * i / n); sn[i] = Math.sin(2 * Math.PI * i / n); }
    return (PLANS_TF[n] = { rev: rev, cs: cs, sn: sn });
  }
  function fft1(re, im, inv) {           // en place ; directe : exp(−2iπ jk/n) ; inverse : exp(+2iπ jk/n) / n
    var n = re.length, p = planTF(n), i, j, k, t;
    for (i = 0; i < n; i++) { j = p.rev[i]; if (j > i) { t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (var size = 2; size <= n; size <<= 1) {
      var half = size >> 1, step = n / size;
      for (i = 0; i < n; i += size) {
        for (j = 0, k = 0; j < half; j++, k += step) {
          var wr = p.cs[k], wi = inv ? p.sn[k] : -p.sn[k], a = i + j, b2 = a + half;
          var xr = re[b2] * wr - im[b2] * wi, xi = re[b2] * wi + im[b2] * wr;
          re[b2] = re[a] - xr; im[b2] = im[a] - xi; re[a] += xr; im[a] += xi;
        }
      }
    }
    if (inv) for (i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
  // Transformée centrée (fréquence nulle et origine à l'indice N/2) le long d'un axe (1 : x, 0 : y), en place.
  function tfAxe(u, Nx, Ny, axe, inv) {
    var N = axe === 1 ? Nx : Ny, M2 = axe === 1 ? Ny : Nx, pas = axe === 1 ? 1 : Nx, h = N >> 1, tr = new Float64Array(N), ti = new Float64Array(N);
    for (var m = 0; m < M2; m++) {
      var o = axe === 1 ? m * Nx : m, i;
      for (i = 0; i < N; i++) { var s = o + ((i + h) % N) * pas; tr[i] = u.re[s]; ti[i] = u.im[s]; }
      fft1(tr, ti, inv);
      for (i = 0; i < N; i++) { var q = o + ((i + h) % N) * pas; u.re[q] = tr[i]; u.im[q] = ti[i]; }
    }
  }
  function sinc(x) { return x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x); }
  // Part de l'intervalle [c − w/2, c + w/2] vue de la maille centrée en x, pondérée par un triangle de base 2d (deux
  // moyennes glissantes de largeur d) : le spectre du masque est multiplié par sinc²(f d), repliements négligeables ;
  // une transformée le compense (division par sinc²).
  function rampe(t) { t = t < -1 ? -1 : t > 1 ? 1 : t; return t < 0 ? 0.5 * (1 + t) * (1 + t) : 1 - 0.5 * (1 - t) * (1 - t); }
  function c1(c, w, x, d) { return rampe((c + w / 2 - x) / d) - rampe((c - w / 2 - x) / d); }
  function disqueC(r, x, y, dx, dy) {     // triangle le long de x, huit lignes pondérées le long de y
    var s = 0;
    for (var k = 0; k < 8; k++) { var ys = y + (k - 3.5) * dy / 4, v = r * r - ys * ys; s += (1 - Math.abs(k - 3.5) / 4) / 4 * c1(0, 2 * Math.sqrt(v > 0 ? v : 0), x, dx); }
    return s;
  }
  function aireDisque(r, x, y, dx, dy) {  // part de la maille dans le disque (strates de la source)
    var s = 0;
    for (var k = 0; k < 4; k++) {
      var ys = y + (k - 1.5) * dy / 4, v = r * r - ys * ys, w = 2 * Math.sqrt(v > 0 ? v : 0), a = Math.min(x + dx / 2, w / 2) - Math.max(x - dx / 2, -w / 2);
      s += (a > 0 ? a : 0) / dx;
    }
    return s / 4;
  }
  function fils(pas, w, x, d) {
    if (d >= 4 * pas) return w / pas;
    var k0 = Math.floor(x / pas + 0.5), s = 0;
    for (var k = -2; k <= 2; k++) s += c1((k0 + k) * pas, w, x, d);
    return s < 1 ? s : 1;
  }
  // Diapo sur la maille : pixels (constants par morceaux) pondérés par le même triangle de base 2d que `c1`, en unités
  // de pixel ; amplitude √T, ou intensité T (`intens` : poids d'une source étendue).
  function couvDiapo(a, x, y, dx, dy, intens) {
    var nD = DIAPOS.n, h = a[1];
    if (!nD) return c1(0, 2 * h, x, dx) * c1(0, 2 * h, y, dy);
    var p = 2 * h / nD, u = (x + h) / p, v = (h - y) / p, du = dx / p, dv = dy / p, A = intens ? DIAPOS.t[a[0]] : DIAPOS.a[a[0]], s = 0;
    var i0 = Math.max(0, Math.floor(u - du)), i1 = Math.min(nD - 1, Math.floor(u + du)), j0 = Math.max(0, Math.floor(v - dv)), j1 = Math.min(nD - 1, Math.floor(v + dv));
    for (var j = j0; j <= j1; j++) {
      var wy = c1(j + 0.5, 1, v, dv), sx = 0;
      if (wy === 0) continue;
      for (var i = i0; i <= i1; i++) sx += A[j * nD + i] * c1(i + 0.5, 1, u, du);
      s += wy * sx;
    }
    return s;
  }
  // Transmission moyenne d'un masque sur la maille dx × dy centrée en (x, y), repère du masque.
  function couverture(f, a, x, y, dx, dy, intens) {
    var s = 0, n, m, xm;
    switch (f) {
      case F.DIAPO: return couvDiapo(a, x, y, dx, dy, intens);
      case F.DISQUE: return disqueC(a[0], x, y, dx, dy);
      case F.RECT: return c1(0, a[0], x, dx) * c1(0, a[1], y, dy);
      case F.FENTES: case F.TROUS:
        n = Math.max(1, Math.round(a[0]));
        for (m = 0; m < n; m++) { xm = (m - 0.5 * (n - 1)) * a[2]; s += f === F.FENTES ? c1(xm, a[1], x, dx) : disqueC(a[1] / 2, x - xm, y, dx, dy); }
        return f === F.FENTES ? s * c1(0, a[3], y, dy) : s;
      case F.LETTRE:
        s = a[0];
        return c1(-4.5 * s, 3 * s, x, dx) * c1(0, 20 * s, y, dy) + c1(1.5 * s, 9 * s, x, dx) * c1(8.5 * s, 3 * s, y, dy) + c1(0, 6 * s, x, dx) * c1(0, 3 * s, y, dy);
      case F.GRILLE: {
        var fx = fils(a[0], a[1], x, dx), fy = fils(a[0], a[1], y, dy);
        if (a[3] > 0) { fx = Math.max(fx, fils(a[3], a[4], x, dx)); fy = Math.max(fy, fils(a[3], a[4], y, dy)); }
        return c1(0, 2 * a[2], x, dx) * c1(0, 2 * a[2], y, dy) * (1 - fx) * (1 - fy);
      }
      case F.DEMIPLAN: return c1(a[0] + GRAND, 2 * GRAND, x, dx);
      case F.PASTILLE: return disqueC(a[1], x, y, dx, dy) - disqueC(a[0], x, y, dx, dy);
      case F.FIL: return disqueC(a[1], x, y, dx, dy) * (1 - c1(0, a[0], x, dx));
      case F.BIFENTES:
        for (m = 0; m < 3; m++) if (!((Math.round(a[6]) >> m) & 1)) s += c1(0, a[4], y, dy) * (c1((m - a[7]) * a[5] + 0.5 * a[m], a[3], x, dx) + c1((m - a[7]) * a[5] - 0.5 * a[m], a[3], x, dx));
        return s;
    }
    return forme(f, a, x, y);            // règle : au centre de la maille
  }
  // [cx, cy, hx, hy, détail x, détail y] : boîte de la partie transparente (repère du masque) et plus petit détail.
  function geomForme(f, a) {
    var n;
    switch (f) {
      case F.DISQUE: return [0, 0, a[0], a[0], 2 * a[0], 2 * a[0]];
      case F.RECT: return [0, 0, a[0] / 2, a[1] / 2, a[0], a[1]];
      case F.FENTES: n = Math.max(1, Math.round(a[0])); return [0, 0, ((n - 1) * a[2] + a[1]) / 2, a[3] / 2, n > 1 ? Math.min(a[1], a[2] - a[1]) : a[1], a[3]];
      case F.TROUS: n = Math.max(1, Math.round(a[0])); return [0, 0, ((n - 1) * a[2] + a[1]) / 2, a[1] / 2, n > 1 ? Math.min(a[1], a[2] - a[1]) : a[1], a[1]];
      case F.LETTRE: return [0, 0, 6 * a[0], 10 * a[0], 3 * a[0], 3 * a[0]];
      case F.GRILLE: { var dg = Math.min(a[1], a[0] - a[1]); return [0, 0, a[2], a[2], dg, dg]; }
      case F.REGLE: return [0, 0, a[0] + 2, a[2], a[1], a[2]];
      case F.DIAPO: { var pd = 2 * a[1] / (DIAPOS.n || 512); return [0, 0, a[1], a[1], 2 * pd, 2 * pd]; }
      case F.PASTILLE: return [0, 0, a[1], a[1], 2 * a[0], 2 * a[0]];
      case F.FIL: return [0, 0, a[1], a[1], a[0], GRAND];
      case F.BIFENTES: {
        var rangs = [], am = [], ib;
        for (ib = 0; ib < 3; ib++) if (!((Math.round(a[6]) >> ib) & 1)) { rangs.push(ib); am.push(a[ib]); }
        if (!rangs.length) return [0, 0, 1, 1, 1, 1];
        var x0 = GRAND, x1 = -GRAND;
        for (ib = 0; ib < rangs.length; ib++) { var xc = (rangs[ib] - a[7]) * a[5]; x0 = Math.min(x0, xc - (am[ib] + a[3]) / 2); x1 = Math.max(x1, xc + (am[ib] + a[3]) / 2); }
        return [(x0 + x1) / 2, 0, (x1 - x0) / 2, a[4] / 2, Math.min(a[3], Math.min.apply(null, am) - a[3]), a[4]];
      }
    }
    return [0, 0, GRAND, GRAND, GRAND, GRAND];
  }
  function angRepere(fr) { return Math.atan2(fr.ex[1], fr.ex[0]); }
  // Boîte g (repère propre) vue d'un repère tourné de −ph : [Hx, Hy, détail x, détail y, cx, cy].
  function boiteVue(g, ph) {
    var c = Math.cos(ph), s = Math.sin(ph), dx = g[4], dy = g[5];
    if (Math.abs(c) < 1e-9) { dx = g[5]; dy = g[4]; } else if (Math.abs(s) >= 1e-9) dx = dy = Math.min(dx, dy);
    return [Math.abs(g[2] * c) + Math.abs(g[3] * s), Math.abs(g[2] * s) + Math.abs(g[3] * c), dx, dy, g[0] * c - g[1] * s, g[0] * s + g[1] * c];
  }
  function planOnde(pr, i) {
    var pl = { i: i, O: [pr.O[0], pr.O[1]], ang: angRepere(pr), R: pr.R, Sm: pr.Sm }, g;
    if (pr.k === K.MASQUE) {
      g = geomForme(pr.p[0], pr.p.slice(1));
      pl.genre = "masque"; pl.f = pr.p[0]; pl.a = pr.p.slice(1); pl.g = [g[0], g[1], Math.min(g[2], pr.Sm), Math.min(g[3], pr.Sm), g[4], g[5]];
    } else if (pr.k === K.PHASE) { var dd = pr.p[0] === 2 ? 0.75 : pr.p[2]; pl.genre = "phase"; pl.p = pr.p; pl.g = [0, 0, pr.R, pr.R, dd, dd]; }
    else if (pr.k === K.DIFFUSEUR) { pl.genre = "speckle"; pl.g = [0, 0, pr.R, pr.R, GRAND, GRAND]; }
    else { pl.genre = "monture"; pl.g = [0, 0, pr.R, pr.R, 2 * pr.R, 2 * pr.R]; }
    return pl;
  }
  function demiOuverture(pr) {
    if (pr.k !== K.MASQUE) return pr.R;
    return pr.p[0] === F.DISQUE ? pr.p[1] : pr.p[0] === F.RECT ? Math.min(pr.p[1], pr.p[2]) / 2 : GRAND;
  }
  // 1/q du faisceau gaussien après la matrice Mt (col de rayon w0 au départ : q = −i zR) : [1/R, λ/(π w²)].
  function invQ(Mt, zr) { var den = Mt[1] * Mt[1] + Mt[0] * Mt[0] * zr * zr; return [(Mt[3] * Mt[1] + Mt[0] * Mt[2] * zr * zr) / den, zr * (Mt[0] * Mt[3] - Mt[1] * Mt[2]) / den]; }
  // Primitive qui diffracte par sa structure (phase, dépoli, masque autre qu'un disque ou un rectangle, ou tiroir
  // Young / Fourier) ; les autres (lentille, monture, iris, trou ou fente simples) ne diffractent que par leur bord.
  function structurante(pr) {
    var T = TYPES[pr.type] || {}, office = T.tiroir === "young" || T.tiroir === "fourier";
    return pr.k === K.PHASE || pr.k === K.DIFFUSEUR || (pr.k === K.MASQUE && (office || (pr.p[0] !== F.DISQUE && pr.p[0] !== F.RECT)));
  }
  // ouvertures : false = une ouverture ordinaire (iris, trou ou fente source, monture) n'ouvre jamais le calcul
  // ondulatoire, même si elle diffracte (optique parfaite de l'instrument) ; elle peut encore couper la
  // lumière diffractée par un plan précédent.
  var ONDE_OPTIONS = { maxN: 4096, maxCellules: 1 << 20, nl: 16, champ: 16, fin: 8, maxPoints: 400, graine: 7, ouvertures: true };
  // Plan du calcul ondulatoire : source (lampe, ou dernier objet éclairé avant le premier plan diffractant), plans
  // diffractants, grille du premier plan. {ok: false, raison} quand le moteur géométrique doit servir.
  function ondePlan(seq, o) {
    var opt = {}, kk;
    for (kk in ONDE_OPTIONS) opt[kk] = ONDE_OPTIONS[kk];
    if (o) for (kk in o) opt[kk] = o[kk];
    function non(r) { return { ok: false, raison: r }; }
    if (seq.vide || !(seq.iDet >= 0)) return non("detecteur");
    if (seq.miroir) return non("miroir");
    var P = seq.prims, nd = seq.iDet, S = seq.source, em = S.em, sp = S.sp, Oe = S.fr.O, laser = em.forme === "gauss", lref = 0, i, j;
    if (sp.type === 0) lref = 0.5 * (sp.a + sp.b);
    else for (i = 0; i < sp.n; i++) lref += sp.l[i] * (sp.cum[i] - (i ? sp.cum[i - 1] : 0));
    var lm = lref * 1e-6;
    var src = { i: -1, forme: em.forme, O: [Oe[0], Oe[1]], ang: angRepere(S.fr), g: em.forme === "rect" ? [0, 0, em.a / 2, em.b / 2] : [0, 0, em.a, em.a] };
    function wLaser(q) { return Math.sqrt(lm / (Math.PI * invQ(chaine(seq, lref, -1, q), Math.PI * em.a * em.a / lm)[1])); }
    var planes = [], ouv = [], reseau = null, i1 = -1, z1 = 0, th = 0, rw = GRAND, ang0 = 0, N = [0, 0], d = [0, 0], limite = false, pl;
    for (i = 0; i < nd; i++) {
      var pr = P[i], k = pr.k;
      if (k === K.AIRY || (k === K.MASQUE && pr.p[0] === F.RETICULE)) continue;
      var T = TYPES[pr.type] || {}, office = T.tiroir === "young" || T.tiroir === "fourier";
      if (k === K.DIFFUSEUR && !laser) return non("depoli");
      if (k === K.RESEAU) { if (reseau !== null) return non("reseau"); reseau = i; }
      var structure = structurante(pr);
      var a = demiOuverture(pr), oui;
      if (i1 < 0) {
        if (laser) oui = structure || a < 2.5 * wLaser(i);
        else if (k === K.MASQUE && !office) {
          pl = planOnde(pr, i);
          var Bi = chaine(seq, lref, src.i, i)[1], b = boiteVue(pl.g, pl.ang), bs = boiteVue(src.g.concat([GRAND, GRAND]), src.ang);
          // une diapo n'est pas une ouverture ordinaire : seul le critère de cohérence compte, même en optique parfaite
          oui = (opt.ouvertures !== false || pl.f === F.DIAPO) && Math.abs(Bi) >= 1e-9 && ((b[2] < GRAND / 2 && b[2] * 2 * bs[0] / Math.abs(Bi) < lm) || (b[3] < GRAND / 2 && b[3] * 2 * bs[1] / Math.abs(Bi) < lm));
          if (!oui && T.objet) { src = { i: i, forme: "masque", f: pl.f, a: pl.a, g: pl.g.slice(0, 4), O: pl.O, ang: pl.ang }; ouv = []; continue; }
        } else oui = structure;
        if (!oui) { if (a < GRAND / 2) ouv.push([i, a]); continue; }
        pl = planOnde(pr, i);
        if (laser) rw = 2.5 * wLaser(i) + Math.max(Math.abs(Oe[0]), Math.abs(Oe[1]));
        else {
          var Bs = chaine(seq, lref, src.i, i)[1];
          if (Math.abs(Bs) < 1e-9) return non("conjugue");
          for (j = 0; j < ouv.length; j++) { var Bj = chaine(seq, lref, src.i, ouv[j][0])[1]; if (Math.abs(Bj) > 1e-9) rw = Math.min(rw, ouv[j][1] / Math.abs(Bj) * Math.abs(Bs)); }
          th = Math.max(src.g[2], src.g[3]) / Math.abs(Bs);
        }
        i1 = i; ang0 = pl.ang;
        var g = pl.g, ca = Math.cos(ang0), sa = Math.sin(ang0);
        var off = [ca * pl.O[0] + sa * pl.O[1] + g[0], -sa * pl.O[0] + ca * pl.O[1] + g[1]];
        var zone = [Math.min(Math.abs(off[0]) + g[2], rw), Math.min(Math.abs(off[1]) + g[3], rw)];
        for (var ax = 0; ax < 2; ax++) {
          // diapo au premier plan : un pixel par maille (le pas est fixé par l'image)
          var Wd = 2 * zone[ax], dt = pl.f === F.DIAPO ? 2 * pl.a[1] / (DIAPOS.n || 512) : Math.min(g[4 + ax] / opt.fin, Wd / 16), n = 16;
          while (n < opt.maxN && n * dt < opt.champ * Wd) n *= 2;
          if (n * dt < 1.5 * Wd) { dt = 1.5 * Wd / n; limite = true; }
          N[ax] = n; d[ax] = dt;
        }
        while (N[0] * N[1] > opt.maxCellules) {
          var m0 = N[0] * d[0] / zone[0], m1 = N[1] * d[1] / zone[1];      // marge de champ ; à égalité, l'axe le plus fin
          var axr = Math.abs(m0 - m1) <= 1e-9 * m0 ? (N[0] >= N[1] ? 0 : 1) : m0 > m1 ? 0 : 1;
          N[axr] /= 2;
          if (N[axr] * d[axr] < 3 * zone[axr]) { d[axr] = 3 * zone[axr] / N[axr]; limite = true; }
        }
        z1 = Math.max(zone[0], zone[1]);
        th += 2 * lm / Math.min(g[4], g[5], z1 / 4);
        planes.push(pl);
      } else {
        var Mt = mul(chaine(seq, lref, i1, i), abcdPrim(P[i1], lref));
        if (structure || a < Math.abs(Mt[0]) * z1 + Math.abs(Mt[1]) * th) planes.push(planOnde(pr, i));
      }
    }
    if (reseau !== null && planes.length && planes[planes.length - 1].i > reseau) return non("reseau");
    if (!planes.length && !laser) return non("geometrique");
    var plan = { ok: true, seq: seq, laser: laser, src: src, planes: planes, reseau: reseau, lref: lref, opt: opt, ang: planes.length ? ang0 : 0,
      N: N, d: d, rw: rw, limite: planes.length ? limite : false, pasSource: 1, cache: {} };
    if (planes.length > 1 && !laser) {
      var Ba = Math.abs(chaine(seq, lref, src.i, i1)[1]), bb = boiteVue(src.g.concat([GRAND, GRAND]), src.ang - ang0);
      var np = (2 * bb[0] * N[0] * d[0] / (lm * Ba) + 1) * (2 * bb[1] * N[1] * d[1] / (lm * Ba) + 1);
      plan.pasSource = Math.max(1, Math.ceil(Math.sqrt(np / opt.maxPoints)));
    }
    plan.lambdas = lambdasOnde(seq, opt.nl);
    return plan;
  }
  // Choix du moteur : « onde » si un élément diffractant éclairé est sur le trajet (ou le laser), sinon « rayons ».
  function ondeMoteur(seq, o) { var pl = ondePlan(seq, o); return { moteur: pl.ok ? "onde" : "rayons", raison: pl.raison || null, plan: pl.ok ? pl : null }; }
  // Filtres et polarisation : éléments uniformes dans leur ouverture, le champ se factorise U(x, y)·J ; lumière
  // naturelle : ½ Tr(J†J).
  function facteurOnde(seq, l) {
    var t = 1, J = null;
    for (var i = 0; i < seq.iDet; i++) {
      var pr = seq.prims[i];
      if (pr.k === K.FILTRE) t *= transFiltre(pr.p[0], l);
      else if (pr.k === K.JONES) {
        var m = jonesPrim(pr.p, l);
        if (!J) J = m;
        else {
          var cm = function (x, y) { return [x[0] * y[0] - x[1] * y[1], x[0] * y[1] + x[1] * y[0]]; }, ad = function (x, y) { return [x[0] + y[0], x[1] + y[1]]; };
          J = [ad(cm(m[0], J[0]), cm(m[1], J[2])), ad(cm(m[0], J[1]), cm(m[1], J[3])), ad(cm(m[2], J[0]), cm(m[3], J[2])), ad(cm(m[2], J[1]), cm(m[3], J[3]))];
        }
      }
    }
    if (J) { var s = 0; for (var q = 0; q < 4; q++) s += J[q][0] * J[q][0] + J[q][1] * J[q][1]; t *= 0.5 * s; }
    return t;
  }
  // Longueurs d'onde [λ, poids XYZ] : continu = nl strates (milieux), raies = chacune avec son poids ; filtres compris.
  function lambdasOnde(seq, nl) {
    var sp = seq.source.sp, out = [], ls = [], i;
    if (sp.type === 0) for (i = 0; i < nl; i++) ls.push([sp.a + (sp.b - sp.a) * (i + 0.5) / nl, 1 / nl]);
    else for (i = 0; i < sp.n; i++) ls.push([sp.l[i], sp.cum[i] - (i ? sp.cum[i - 1] : 0)]);
    ls.forEach(function (x) {
      var t = x[1] * facteurOnde(seq, x[0]), f = facteurXYZ(sp, x[0]);
      if (t > 0) out.push([x[0], [f[0] * t, f[1] * t, f[2] * t]]);
    });
    return out;
  }
  // Transmission complexe d'un plan sur la grille (pas d, repère de la grille tourné de plan.ang).
  function tPlan(plan, pl, d) {
    var Nx = plan.N[0], Ny = plan.N[1], re = new Float64Array(Nx * Ny), im = new Float64Array(Nx * Ny);
    var c0 = Math.cos(plan.ang), s0 = Math.sin(plan.ang), ca = Math.cos(pl.ang), sa = Math.sin(pl.ang);
    var cp = Math.abs(Math.cos(pl.ang - plan.ang)), sp = Math.abs(Math.sin(pl.ang - plan.ang)), ex = d[0] * cp + d[1] * sp, ey = d[0] * sp + d[1] * cp;
    for (var j = 0; j < Ny; j++) for (var i = 0; i < Nx; i++) {
      var X = (i - Nx / 2) * d[0], Y = (j - Ny / 2) * d[1], xl = c0 * X - s0 * Y - pl.O[0], yl = s0 * X + c0 * Y - pl.O[1];
      var xm = ca * xl + sa * yl, ym = -sa * xl + ca * yl, q = j * Nx + i, t, ph;
      if (pl.genre === "masque") { re[q] = couverture(pl.f, pl.a, xm, ym, ex, ey) * c1(0, 2 * pl.Sm, xm, ex) * c1(0, 2 * pl.Sm, ym, ey); continue; }
      t = disqueC(pl.R, xm, ym, ex, ey);
      if (pl.genre === "phase") ph = phase(pl.p, xm, ym);
      else if (pl.genre === "speckle") ph = 2 * Math.PI * new Alea(graineRayon(plan.opt.graine, j, i)).u();
      else { re[q] = t; continue; }
      re[q] = t * Math.cos(ph); im[q] = t * Math.sin(ph);
    }
    return { re: re, im: im };
  }
  // Intégrale de Collins le long d'un axe (1 : x, 0 : y), en place ; sphère de référence de courbure c portée à part.
  // Renvoie [pas, courbure]. comp : compense le lissage des masques (÷ sinc² de la maille) après une transformée.
  function propAxe(u, Nx, Ny, axe, lm, d, c, Mt, comp) {
    var A = Mt[0], B = Mt[1], C = Mt[2], D = Mt[3], N = axe === 1 ? Nx : Ny, h = N / 2, Ap = A + B * c, n = Nx * Ny, i, j, q, t;
    function facteur(fr, fi) {             // multiplie chaque maille par le nombre complexe de son rang le long de l'axe
      for (j = 0; j < Ny; j++) for (i = 0; i < Nx; i++) {
        var m = axe === 1 ? i : j; q = j * Nx + i; t = u.re[q] * fr[m] - u.im[q] * fi[m]; u.im[q] = u.re[q] * fi[m] + u.im[q] * fr[m]; u.re[q] = t;
      }
    }
    function retourner() {                 // x → −x : indice m → (N − m) mod N
      for (var o = 0; o < (axe === 1 ? Ny : Nx); o++) for (var m = 1; m < h; m++) {
        var p1 = axe === 1 ? o * Nx + m : m * Nx + o, p2 = axe === 1 ? o * Nx + N - m : (N - m) * Nx + o;
        t = u.re[p1]; u.re[p1] = u.re[p2]; u.re[p2] = t; t = u.im[p1]; u.im[p1] = u.im[p2]; u.im[p2] = t;
      }
    }
    function echelle(k) { for (q = 0; q < n; q++) { u.re[q] *= k; u.im[q] *= k; } }
    var fr = new Float64Array(N), fi = new Float64Array(N), m2, ph;
    if (Math.abs(B) < 1e-9) {              // plans conjugués : copie à l'échelle
      if (Ap < 0) retourner();
      echelle(1 / Math.sqrt(Math.abs(Ap)));
      return [Math.abs(Ap) * d, (C + D * c) / Ap];
    }
    if (N * d * d * Math.abs(Ap) <= lm * Math.abs(B)) {      // loin : une transformée (Fresnel ; Fraunhofer si A' = 0)
      for (m2 = 0; m2 < N; m2++) { ph = Math.PI * Ap * (m2 - h) * d * (m2 - h) * d / (lm * B); fr[m2] = Math.cos(ph); fi[m2] = Math.sin(ph); }
      facteur(fr, fi); tfAxe(u, Nx, Ny, axe, false);
      if (B < 0) retourner();
      var ke = d / Math.sqrt(lm * Math.abs(B));
      for (m2 = 0; m2 < N; m2++) { var sc = sinc((m2 - h) / N); fr[m2] = comp ? ke / (sc * sc) : ke; fi[m2] = 0; }
      facteur(fr, fi);
      return [lm * Math.abs(B) / (N * d), D / B];
    }
    tfAxe(u, Nx, Ny, axe, false);          // près : spectre angulaire, grille à l'échelle A'
    for (m2 = 0; m2 < N; m2++) { var f = (m2 - h) / (N * d); ph = -Math.PI * lm * (B / Ap) * f * f; fr[m2] = Math.cos(ph); fi[m2] = Math.sin(ph); }
    facteur(fr, fi); tfAxe(u, Nx, Ny, axe, true);
    if (Ap < 0) retourner();
    echelle(1 / Math.sqrt(Math.abs(Ap)));
    return [Math.abs(Ap) * d, (C + D * c) / Ap];
  }
  // propAxe « en données », pour la carte graphique (toute retouche de propAxe se fait ici aussi ; rejoué contre lui
  // par un test). Une étape agit sur chaque ligne le long de l'axe : × pre[m] ; transformée
  // centrée (tf : 1 directe, −1 inverse, 0 aucune) ; retournement p → (N − p) mod N si flip ; × ech · post[p].
  // pre, post : Float64Array(2N) (re, im) ou null. Renvoie {pas, courbure, etapes}.
  function ondeEtapes(N, lm, d, c, Mt, comp) {
    var A = Mt[0], B = Mt[1], C = Mt[2], D = Mt[3], h = N / 2, Ap = A + B * c, m, ph, pre, post = null;
    if (Math.abs(B) < 1e-9) return { pas: Math.abs(Ap) * d, courbure: (C + D * c) / Ap, etapes: [{ tf: 0, pre: null, post: null, flip: Ap < 0, ech: 1 / Math.sqrt(Math.abs(Ap)) }] };
    if (N * d * d * Math.abs(Ap) <= lm * Math.abs(B)) {
      pre = new Float64Array(2 * N);
      for (m = 0; m < N; m++) { ph = Math.PI * Ap * (m - h) * d * (m - h) * d / (lm * B); pre[2 * m] = Math.cos(ph); pre[2 * m + 1] = Math.sin(ph); }
      var ke = d / Math.sqrt(lm * Math.abs(B));
      if (comp) { post = new Float64Array(2 * N); for (m = 0; m < N; m++) { var sc = sinc((m - h) / N); post[2 * m] = ke / (sc * sc); } }
      return { pas: lm * Math.abs(B) / (N * d), courbure: D / B, etapes: [{ tf: 1, pre: pre, post: post, flip: B < 0, ech: comp ? 1 : ke }] };
    }
    post = new Float64Array(2 * N);
    for (m = 0; m < N; m++) { var f = (m - h) / (N * d); ph = -Math.PI * lm * (B / Ap) * f * f; post[2 * m] = Math.cos(ph); post[2 * m + 1] = Math.sin(ph); }
    return { pas: Math.abs(Ap) * d, courbure: (C + D * c) / Ap, etapes: [{ tf: 1, pre: null, post: post, flip: false, ech: 1 },
      { tf: -1, pre: null, post: null, flip: Ap < 0, ech: 1 / Math.sqrt(Math.abs(Ap)) }] };
  }
  // Interprète processeur des étapes (en place) : ce que la carte graphique doit refaire.
  function ondeJouer(u, Nx, Ny, axe, etapes) {
    var N = axe === 1 ? Nx : Ny, M2 = axe === 1 ? Ny : Nx, pas = axe === 1 ? 1 : Nx, tr = new Float64Array(N), ti = new Float64Array(N);
    etapes.forEach(function (e) {
      var o, m, q, a, b, base;
      if (e.pre) for (o = 0; o < M2; o++) for (base = axe === 1 ? o * Nx : o, m = 0; m < N; m++) {
        q = base + m * pas; a = u.re[q]; b = u.im[q]; u.re[q] = a * e.pre[2 * m] - b * e.pre[2 * m + 1]; u.im[q] = a * e.pre[2 * m + 1] + b * e.pre[2 * m];
      }
      if (e.tf) tfAxe(u, Nx, Ny, axe, e.tf < 0);
      for (o = 0; o < M2; o++) {
        base = axe === 1 ? o * Nx : o;
        for (m = 0; m < N; m++) { q = base + (e.flip ? (N - m) % N : m) * pas; tr[m] = u.re[q]; ti[m] = u.im[q]; }
        for (m = 0; m < N; m++) {
          var pr = e.post ? e.post[2 * m] : 1, pi = e.post ? e.post[2 * m + 1] : 0; q = base + m * pas;
          u.re[q] = e.ech * (tr[m] * pr - ti[m] * pi); u.im[q] = e.ech * (tr[m] * pi + ti[m] * pr);
        }
      }
    });
  }
  // Table de la transformée centrée (tfAxe) pour la carte graphique : S étages « sortie[p] = Σ_k C_k · entrée[a_k] »,
  // k < 4 (étages de fft1 fusionnés deux à deux ; centrage et renversement des bits repliés dans les indices du
  // premier étage et dans l'ordre des texels du dernier ; 1/N de l'inverse dans le dernier). data : texture RGBA32F de
  // largeur N et de hauteur 3S ; ligne 3s : indices a0..a3 ; 3s + 1 : (C0, C1) ; 3s + 2 : (C2, C3). d64 : la même en double.
  var TABLES_TF = {};
  function tableTF(N, inv) {
    var key = N + (inv ? "i" : "d");
    if (TABLES_TF[key]) return TABLES_TF[key];
    var p = planTF(N), L = Math.round(Math.log(N) / Math.LN2), h = N >> 1, et = [], fus = [], s, i, k, t;
    for (s = 0; s < L; s++) {
      var half = 1 << s, size = half << 1, step = N / size, ix = new Int32Array(2 * N), co = new Float64Array(4 * N);
      for (i = 0; i < N; i++) {
        var j = i % size, bas = j < half, kk = (bas ? j : j - half) * step, sg = bas ? 1 : -1;
        ix[2 * i] = bas ? i : i - half; ix[2 * i + 1] = bas ? i + half : i;
        co[4 * i] = 1; co[4 * i + 2] = sg * p.cs[kk]; co[4 * i + 3] = sg * (inv ? p.sn[kk] : -p.sn[kk]);
      }
      et.push({ K: 2, ix: ix, co: co });
    }
    for (s = 0; s < L; s += 2) {           // composition de deux étages : 4 termes
      if (s + 1 >= L) { fus.push(et[s]); break; }
      var e1 = et[s], e2 = et[s + 1], fx = new Int32Array(4 * N), fc = new Float64Array(8 * N);
      for (i = 0; i < N; i++) for (k = 0; k < 2; k++) {
        var a = e2.ix[2 * i + k], cr = e2.co[4 * i + 2 * k], ci = e2.co[4 * i + 2 * k + 1];
        for (t = 0; t < 2; t++) {
          var q = 2 * k + t, dr = e1.co[4 * a + 2 * t], di = e1.co[4 * a + 2 * t + 1];
          fx[4 * i + q] = e1.ix[2 * a + t]; fc[8 * i + 2 * q] = cr * dr - ci * di; fc[8 * i + 2 * q + 1] = cr * di + ci * dr;
        }
      }
      fus.push({ K: 4, ix: fx, co: fc });
    }
    var S = fus.length, d64 = new Float64Array(N * 3 * S * 4);
    for (s = 0; s < S; s++) {
      var e = fus[s], ech = inv && s === S - 1 ? 1 / N : 1;
      for (var pp = 0; pp < N; pp++) {
        i = s === S - 1 ? (pp + h) % N : pp;
        for (k = 0; k < e.K; k++) {
          var src = e.ix[e.K * i + k], row = 3 * s + 1 + (k >> 1);
          d64[(3 * s * N + pp) * 4 + k] = s === 0 ? (p.rev[src] + h) % N : src;
          d64[(row * N + pp) * 4 + 2 * (k & 1)] = e.co[2 * (e.K * i + k)] * ech; d64[(row * N + pp) * 4 + 2 * (k & 1) + 1] = e.co[2 * (e.K * i + k) + 1] * ech;
        }
      }
    }
    return (TABLES_TF[key] = { N: N, S: S, d64: d64, data: new Float32Array(d64) });
  }
  // Déroule la table sur un vecteur (positions) : contrôle processeur de tableTF. Renvoie {re, im}.
  function jouerTF(tab, re, im) {
    var N = tab.N, D = tab.d64;
    for (var s = 0; s < tab.S; s++) {
      var or = new Float64Array(N), oi = new Float64Array(N);
      for (var p = 0; p < N; p++) for (var k = 0; k < 4; k++) {
        var a = D[(3 * s * N + p) * 4 + k], o = ((3 * s + 1 + (k >> 1)) * N + p) * 4 + 2 * (k & 1), cr = D[o], ci = D[o + 1];
        or[p] += cr * re[a] - ci * im[a]; oi[p] += cr * im[a] + ci * re[a];
      }
      re = or; im = oi;
    }
    return { re: re, im: im };
  }
  // Champ au premier plan (source ponctuelle sur l'axe, d'aire et de luminance unité, ou faisceau du laser), fois la
  // transmission du plan ; c : courbure de la sphère de référence.
  // Scindé pour la carte graphique : eclairageBase = la partie sur les mailles (fenêtre disqueC(rw) × T0, la même pour
  // toutes les λ ; laser : gaussienne × T0, par λ), gardée sous la clé `cle` ; k (a0, ou 1 au laser) et c, scalaires.
  function eclairageBase(plan, l) {
    var K0 = plan.cache, seq = plan.seq, pl = plan.planes[0], lm = l * 1e-6, em = seq.source.em, Nx = plan.N[0], Ny = plan.N[1], d = plan.d;
    var Ms = chaine(seq, l, plan.src.i, pl.i), c, k, cle, i, j, q;
    if (!K0.T0) K0.T0 = tPlan(plan, pl, d);
    var T0 = K0.T0;
    if (plan.laser) {
      var Oe = seq.source.fr.O, iq = invQ(Ms, Math.PI * em.a * em.a / lm), w2 = lm / (Math.PI * iq[1]), c0 = Math.cos(plan.ang), s0 = Math.sin(plan.ang), k0 = Math.sqrt(2 / (Math.PI * w2));
      c = iq[0]; k = 1; cle = "B" + l;
      if (!K0[cle]) {
        var re = new Float64Array(Nx * Ny), im = new Float64Array(Nx * Ny);
        for (j = 0; j < Ny; j++) for (i = 0; i < Nx; i++) {
          var X = (i - Nx / 2) * d[0], Y = (j - Ny / 2) * d[1], xl = c0 * X - s0 * Y - Ms[0] * Oe[0], yl = s0 * X + c0 * Y - Ms[0] * Oe[1], a = k0 * Math.exp(-(xl * xl + yl * yl) / w2);
          q = j * Nx + i; re[q] = a * T0.re[q]; im[q] = a * T0.im[q];
        }
        K0[cle] = { re: re, im: im };
      }
    } else {
      k = 1 / Math.max(Math.abs(Ms[1]), 1e-9); cle = "B";
      c = Math.abs(Ms[1]) > 1e-9 ? Ms[3] / Ms[1] : 0;
      if (!K0[cle]) {
        if (plan.rw < GRAND / 2) {
          var br = new Float64Array(Nx * Ny), bi = new Float64Array(Nx * Ny);
          for (j = 0; j < Ny; j++) for (i = 0; i < Nx; i++) {
            var w = disqueC(plan.rw, (i - Nx / 2) * d[0], (j - Ny / 2) * d[1], d[0], d[1]);
            q = j * Nx + i; br[q] = w * T0.re[q]; bi[q] = w * T0.im[q];
          }
          K0[cle] = { re: br, im: bi };
        } else K0[cle] = T0;
      }
    }
    return { B: K0[cle], cle: cle, k: k, c: c };
  }
  function eclairage(plan, l) {
    var key = "E" + l, K0 = plan.cache;
    if (K0[key]) return K0[key];
    var e = eclairageBase(plan, l), n = plan.N[0] * plan.N[1], re = new Float64Array(n), im = new Float64Array(n);
    for (var q = 0; q < n; q++) { re[q] = e.k * e.B.re[q]; im[q] = e.k * e.B.im[q]; }
    return (K0[key] = { re: re, im: im, c: e.c });
  }
  // Intensité au détecteur sur la grille native, pour une longueur d'onde et un point source (inclinaison mx, my en
  // périodes de la grille au premier plan). Renvoie {I, Nx, Ny, d: [dx, dy]}.
  function ondeChamp(plan, l, mx, my) {
    var seq = plan.seq, P = seq.prims, nd = seq.iDet, lm = l * 1e-6, pls = plan.planes, E0 = eclairage(plan, l), Nx = plan.N[0], Ny = plan.N[1], n = Nx * Ny;
    var u = { re: new Float64Array(E0.re), im: new Float64Array(E0.im) }, i, j, q, t;
    if (mx || my) for (j = 0; j < Ny; j++) for (i = 0; i < Nx; i++) {
      var ph = 2 * Math.PI * ((mx || 0) * (i - Nx / 2) / Nx + (my || 0) * (j - Ny / 2) / Ny), cr = Math.cos(ph), ci = Math.sin(ph);
      q = j * Nx + i; t = u.re[q] * cr - u.im[q] * ci; u.im[q] = u.re[q] * ci + u.im[q] * cr; u.re[q] = t;
    }
    var d = [plan.d[0], plan.d[1]], cs = [E0.c, E0.c], r;
    for (var k = 0; k < pls.length; k++) {
      var pl = pls[k], der = k === pls.length - 1, Mt = mul(chaine(seq, l, pl.i, der ? nd : pls[k + 1].i), abcdPrim(P[pl.i], l)), comp = pl.genre !== "speckle";
      r = propAxe(u, Nx, Ny, 1, lm, d[0], cs[0], Mt, comp); d[0] = r[0]; cs[0] = r[1];
      r = propAxe(u, Nx, Ny, 0, lm, d[1], cs[1], Mt, comp); d[1] = r[0]; cs[1] = r[1];
      if (!der) {
        var key = "T" + (k + 1) + "|" + l;
        if (!plan.cache[key]) plan.cache[key] = tPlan(plan, pls[k + 1], d);
        var T = plan.cache[key];
        for (q = 0; q < n; q++) { t = u.re[q] * T.re[q] - u.im[q] * T.im[q]; u.im[q] = u.re[q] * T.im[q] + u.im[q] * T.re[q]; u.re[q] = t; }
      }
    }
    var I = new Float64Array(n);
    for (q = 0; q < n; q++) I[q] = u.re[q] * u.re[q] + u.im[q] * u.im[q];
    return { I: I, Nx: Nx, Ny: Ny, d: d };
  }
  // Grille native prête à lire : moyenne par blocs (puissance de 2) tant que le pas reste sous le demi-pixel h/2, ou
  // sous cible[a] (taille de l'image d'une strate de la source : la somme sur les strates reste lisse).
  // Facteurs de réduction r (puissances de 2) de natif, et la grille réduite : commun au processeur et à la carte.
  function natifGeom(Nx, Ny, d0, h, cible) {
    var r = [1, 1], d = [d0[0], d0[1]], off = [0, 0], n = [Nx, Ny];
    cible = cible || [0, 0];
    for (var a = 0; a < 2; a++) {
      while (2 * r[a] * d[a] <= Math.max(h / 2, cible[a]) && 2 * r[a] <= n[a]) r[a] *= 2;
      if (r[a] > 1) { off[a] = (r[a] - 1) / 2 * d[a]; d[a] *= r[a]; n[a] /= r[a]; }
    }
    return { r: r, d: d, off: off, Nx: n[0], Ny: n[1] };
  }
  function natif(ch, h, cible) {
    var I = ch.I, Nx = ch.Nx, Ny = ch.Ny, gm = natifGeom(Nx, Ny, ch.d, h, cible), d = gm.d, off = gm.off, i, j, k, r, J, s;
    r = gm.r[0];
    if (r > 1) {
      J = new Float64Array(Nx / r * Ny);
      for (j = 0; j < Ny; j++) for (i = 0; i < Nx / r; i++) { s = 0; for (k = 0; k < r; k++) s += I[j * Nx + i * r + k]; J[j * (Nx / r) + i] = s / r; }
      Nx /= r; I = J;
    }
    r = gm.r[1];
    if (r > 1) {
      J = new Float64Array(Nx * Ny / r);
      for (j = 0; j < Ny / r; j++) for (i = 0; i < Nx; i++) { s = 0; for (k = 0; k < r; k++) s += I[(j * r + k) * Nx + i]; J[j * Nx + i] = s / r; }
      Ny /= r; I = J;
    }
    var mx = new Float64Array(Ny), my = new Float64Array(Nx), tot = 0;
    for (j = 0; j < Ny; j++) for (i = 0; i < Nx; i++) { var v = I[j * Nx + i]; mx[j] += v * d[0]; my[i] += v * d[1]; tot += v; }
    return { I: I, Nx: Nx, Ny: Ny, d: d, off: off, L: [Nx * d[0], Ny * d[1]], mx: mx, my: my, tot: tot * d[0] * d[1] };
  }
  // Intensité au point (gx, gy) du repère de la grille : bilinéaire, nulle hors de la grille (l'intégrale de la figure
  // est conservée). boite[a] > 0 : figure intégrée le long de l'axe a et étalée sur cette largeur (part du pixel h).
  function lireNatif(nat, gx, gy, boite, h) {
    if (nat.w2) { var ddx = gx - nat.c[0], ddy = gy - nat.c[1]; return 2 / (Math.PI * nat.w2) * Math.exp(-2 * (ddx * ddx + ddy * ddy) / nat.w2); }
    var Nx = nat.Nx, Ny = nat.Ny, I = nat.I, bx = boite && boite[0] ? c1(0, boite[0], gx, h) / boite[0] : 0, by = boite && boite[1] ? c1(0, boite[1], gy, h) / boite[1] : 0;
    if (boite && boite[0] && boite[1]) return nat.tot * bx * by;
    var tx = (gx - nat.off[0]) / nat.d[0] + (Nx >> 1), x0 = Math.floor(tx), fx = tx - x0, ty = (gy - nat.off[1]) / nat.d[1] + (Ny >> 1), y0 = Math.floor(ty), fy = ty - y0;
    var a0 = x0 >= 0 && x0 < Nx ? 1 - fx : 0, a1 = x0 + 1 >= 0 && x0 + 1 < Nx ? fx : 0, b0 = y0 >= 0 && y0 < Ny ? 1 - fy : 0, b1 = y0 + 1 >= 0 && y0 + 1 < Ny ? fy : 0;
    if (boite && boite[1]) return ((a0 ? nat.my[x0] * a0 : 0) + (a1 ? nat.my[x0 + 1] * a1 : 0)) * by;
    if (boite && boite[0]) return ((b0 ? nat.mx[y0] * b0 : 0) + (b1 ? nat.mx[y0 + 1] * b1 : 0)) * bx;
    var v = 0;
    if (b0) v += ((a0 ? I[y0 * Nx + x0] * a0 : 0) + (a1 ? I[y0 * Nx + x0 + 1] * a1 : 0)) * b0;
    if (b1) v += ((a0 ? I[(y0 + 1) * Nx + x0] * a0 : 0) + (a1 ? I[(y0 + 1) * Nx + x0 + 1] * a1 : 0)) * b1;
    return v;
  }
  // Le point (xl, yl) du plan source (labo) est-il éclairé par la lampe, vu du centre du premier plan ? (paraxial)
  function eclaire(plan, l, xl, yl) {
    var seq = plan.seq, src = plan.src, em = seq.source.em;
    if (src.i < 0) return 1;
    var Me = chaine(seq, l, -1, src.i), Ms = chaine(seq, l, src.i, plan.planes[0].i), Oe = seq.source.fr.O, g = Me[3] + Me[1] * Ms[0] / Ms[1];
    var xe = g * xl - Oe[0], ye = g * yl - Oe[1];
    if (em.forme === "rect") return Math.abs(xe) < 0.5 * em.a && Math.abs(ye) < 0.5 * em.b ? 1 : 0;
    return xe * xe + ye * ye < em.a * em.a ? 1 : 0;
  }
  // Réseau : copies décalées, une par ordre (sin θ = mλ/a, décalage B tan θ le long de l'axe du réseau).
  function ordresOnde(plan, l) {
    if (plan.reseau === null) return [[0, 0, 1]];
    var seq = plan.seq, pr = seq.prims[plan.reseau], out = [], Bg = chaine(seq, l, plan.reseau, seq.iDet)[1], c0 = Math.cos(plan.ang), s0 = Math.sin(plan.ang);
    var gx = c0 * pr.ex[0] + s0 * pr.ex[1], gy = -s0 * pr.ex[0] + c0 * pr.ex[1];
    for (var m = -3; m <= 3; m++) {
      var s = m * l * 1e-6 / pr.p[0];
      if (Math.abs(s) < 1) { var t = Bg * s / Math.sqrt(1 - s * s); out.push([t * gx, t * gy, ETA_RESEAU[Math.abs(m)]]); }
    }
    return out;
  }
  // Points de la source pour la somme brute : réseau dont le pas donne une inclinaison entière sur la grille. [mx, my, poids]
  function pointsOnde(plan, l) {
    if (plan.laser) return [[0, 0, 1]];
    var seq = plan.seq, src = plan.src, s = plan.pasSource, Bs = chaine(seq, l, src.i, plan.planes[0].i)[1], Nx = plan.N[0], Ny = plan.N[1], d = plan.d;
    var sx = s * l * 1e-6 * Math.abs(Bs) / (Nx * d[0]), sy = s * l * 1e-6 * Math.abs(Bs) / (Ny * d[1]), sg = Bs > 0 ? 1 : -1;
    var c0 = Math.cos(plan.ang), s0 = Math.sin(plan.ang), ca = Math.cos(src.ang), sa = Math.sin(src.ang), b = boiteVue(src.g.concat([GRAND, GRAND]), src.ang - plan.ang);
    var cx = c0 * src.O[0] + s0 * src.O[1] + b[4], cy = -s0 * src.O[0] + c0 * src.O[1] + b[5];
    var cp = Math.abs(Math.cos(src.ang - plan.ang)), sp = Math.abs(Math.sin(src.ang - plan.ang)), ex = sx * cp + sy * sp, ey = sx * sp + sy * cp, g = src.g, out = [];
    for (var ky = Math.ceil((cy - b[1]) / sy - 1); ky <= Math.floor((cy + b[1]) / sy + 1); ky++)
      for (var kx = Math.ceil((cx - b[0]) / sx - 1); kx <= Math.floor((cx + b[0]) / sx + 1); kx++) {
        var xl = c0 * kx * sx - s0 * ky * sy, yl = s0 * kx * sx + c0 * ky * sy;
        var xs = ca * (xl - src.O[0]) + sa * (yl - src.O[1]), ys = -sa * (xl - src.O[0]) + ca * (yl - src.O[1]), w;
        if (src.forme === "masque") w = couverture(src.f, src.a, xs, ys, ex, ey, true);
        else if (src.forme === "rect") w = c1(0, 2 * g[2], xs, ex) * c1(0, 2 * g[3], ys, ey);
        else w = disqueC(g[2], xs, ys, ex, ey);
        w = w * eclaire(plan, l, xl, yl) * sx * sy;
        if (w > 0) out.push([-kx * s * sg, -ky * s * sg, w]);
      }
    return out;
  }
  // Éclairement XYZ par pixel de la fenêtre (cx ± W, cy ± W) du détecteur, ligne 0 en bas : mêmes unités que le moteur
  // géométrique (Σ poids × XYZ / (rayons × aire du pixel)). rendu = {res, W, cx, cy, ns (strates de la source par axe),
  // passe, graine (strates décalées au hasard dès la passe 1), np (somme brute : couples point source × λ par passe)}.
  function ondePasse(plan, rendu) {
    var seq = plan.seq, res = rendu.res, W = rendu.W, det = seq.prims[seq.iDet], prog = ondeProgramme(plan, rendu), h = prog.h;
    var c0 = Math.cos(plan.ang), s0 = Math.sin(plan.ang), img = new Float64Array(res * res * 3), GX = new Float64Array(res * res), GY = new Float64Array(res * res), i, j, q;
    for (j = 0; j < res; j++) for (i = 0; i < res; i++) {
      var X = (rendu.cx || 0) - W + (i + 0.5) * h, Y = (rendu.cy || 0) - W + (j + 0.5) * h;
      var xl = det.O[0] + X * det.ex[0] + Y * det.ey[0], yl = det.O[1] + X * det.ex[1] + Y * det.ey[1];
      GX[j * res + i] = c0 * xl + s0 * yl; GY[j * res + i] = -s0 * xl + c0 * yl;
    }
    prog.lots.forEach(function (lot) {
      var nat, key, ord = lot.ordres, f = lot.f;
      if (lot.gauss) nat = lot.gauss;
      else if (lot.cache) {
        key = "I" + lot.l;
        if (!plan.cache[key]) plan.cache[key] = ondeChamp(plan, lot.l);
        var ch = plan.cache[key];
        key = "N" + lot.l + "|" + h + "|" + lot.cible[0] + "|" + lot.cible[1];
        if (!plan.cache[key]) plan.cache[key] = natif(ch, h, lot.cible);
        nat = plan.cache[key];
      } else nat = natif(ondeChamp(plan, lot.l, lot.mx, lot.my), h);
      lot.strates.forEach(function (st) {
        for (q = 0; q < res * res; q++) {
          var s = 0;
          for (var m = 0; m < ord.length; m++) s += ord[m][2] * lireNatif(nat, GX[q] - st[0] - ord[m][0], GY[q] - st[1] - ord[m][1], lot.boite, h);
          s *= st[2]; img[3 * q] += f[0] * s; img[3 * q + 1] += f[1] * s; img[3 * q + 2] += f[2] * s;
        }
      });
    });
    return img;
  }
  // Programme d'une passe, commun au processeur (ondePasse) et à la carte graphique : {h, G, lots, paires}.
  // G = {o, u, v} : (GX, GY) du centre du pixel (i, j) = o + (i + 0.5) u + (j + 0.5) v (repère de la grille).
  // Un lot = {l, f (XYZ), mx, my (inclinaison de la source), cache (champ gardé par λ), gauss ({w2, c}) ou null,
  // cible, boite (arguments de natif et de lireNatif), ordres ([[ox, oy, eta]]), strates ([[dx, dy, k]] : la figure
  // est ajoutée décalée de (dx, dy), fois k)}. paires : couples point source × λ de la somme brute (0 ailleurs).
  function ondeProgramme(plan, rendu) {
    var seq = plan.seq, res = rendu.res, W = rendu.W, P = seq.prims, nd = seq.iDet, det = P[nd], em = seq.source.em, h = 2 * W / res;
    var c0 = Math.cos(plan.ang), s0 = Math.sin(plan.ang), pls = plan.planes, src = plan.src, lams = plan.lambdas;
    var passe = rendu.passe || 0, graine = rendu.graine == null ? 1 : rendu.graine, lots = [], npaires = 0;
    function gr(xl, yl) { return [c0 * xl + s0 * yl, -s0 * xl + c0 * yl]; }
    var X0 = (rendu.cx || 0) - W, Y0 = (rendu.cy || 0) - W;
    var G = { o: gr(det.O[0] + X0 * det.ex[0] + Y0 * det.ey[0], det.O[1] + X0 * det.ex[1] + Y0 * det.ey[1]), u: gr(h * det.ex[0], h * det.ex[1]), v: gr(h * det.ey[0], h * det.ey[1]) };
    function lot(wl, o) {
      var r = { l: wl[0], f: wl[1], mx: 0, my: 0, cache: false, gauss: null, cible: [0, 0], boite: null, ordres: ordresOnde(plan, wl[0]), strates: [] };
      for (var k in o) r[k] = o[k];
      lots.push(r); return r;
    }
    if (!pls.length) {                     // laser sans plan diffractant : faisceau gaussien (ABCD)
      lams.forEach(function (wl) {
        var lm = wl[0] * 1e-6, Md = chaine(seq, wl[0], -1, nd), Oe = seq.source.fr.O;
        lot(wl, { gauss: { w2: lm / (Math.PI * invQ(Md, Math.PI * em.a * em.a / lm)[1]), c: [Md[0] * Oe[0], Md[0] * Oe[1]] }, strates: [[0, 0, em.L]] });
      });
    } else if (!plan.laser && pls.length === 1) {      // raccourci : un point source ne fait que décaler la figure
      var i1 = pls[0].i, g = src.g, ca = Math.cos(src.ang), sa = Math.sin(src.ang), ns = rendu.ns || 16, ph = src.ang - plan.ang;
      var al = Math.abs(Math.sin(ph)) < 1e-9 ? 0 : Math.abs(Math.cos(ph)) < 1e-9 ? 1 : -1;      // axes de la source ↔ grille
      var sep = src.forme === "rect" || (src.forme === "masque" && (src.f === F.RECT || (src.f === F.FENTES && src.a[0] <= 1)));
      lams.forEach(function (wl) {
        var l = wl[0], kp = -mul(chaine(seq, l, i1, nd), abcdPrim(P[i1], l))[1] / chaine(seq, l, src.i, i1)[1];
        var dn = ondePas(plan, l), Lg = [plan.N[0] * dn[0], plan.N[1] * dn[1]];
        var T = [2 * g[2] * Math.abs(kp), 2 * g[3] * Math.abs(kp)];
        var nn = [Math.min(ns, Math.max(1, Math.ceil(T[0] / h))), Math.min(ns, Math.max(1, Math.ceil(T[1] / h)))], boite = [0, 0], cible = [0, 0], pr;
        for (pr = 0; pr < 2; pr++) {       // source bien plus étendue que la figure le long d'un axe
          var ga = al === 0 ? pr : 1 - pr;
          if (al >= 0 && sep && T[pr] >= 2 * Lg[ga]) nn[pr] = 1;
          if (al >= 0) { cible[ga] = T[pr] / nn[pr]; if (cible[ga] >= 2 * Lg[ga]) boite[ga] = cible[ga]; }
        }
        var bo = al === 0 ? boite : [boite[1], boite[0]], L = lot(wl, { cache: true, cible: cible, boite: boite });      // bo : par axe propre de la source
        for (var b = 0; b < nn[1]; b++) for (var a = 0; a < nn[0]; a++) {
          var u1 = 0.5, u2 = 0.5;
          if (passe) { var al2 = new Alea(graineRayon(graine, passe, a + nn[0] * b)); u1 = al2.u(); u2 = al2.u(); if (bo[0]) u1 = 0.5; if (bo[1]) u2 = 0.5; }
          var xs = g[0] - g[2] + (a + u1) * 2 * g[2] / nn[0], ys = g[1] - g[3] + (b + u2) * 2 * g[3] / nn[1], w;
          if (src.forme === "rect") w = 1;
          else if (src.forme === "disque" || src.f === F.DISQUE) w = aireDisque(g[2], xs, ys, 2 * g[2] / nn[0], 2 * g[3] / nn[1]);
          else w = forme(src.f, src.a, xs, ys);
          var px = src.O[0] + ca * xs - sa * ys, py = src.O[1] + sa * xs + ca * ys;
          w = w * eclaire(plan, l, px, py) * (2 * g[2] / nn[0]) * (2 * g[3] / nn[1]);
          if (w > 0) L.strates.push([kp * (c0 * px + s0 * py), kp * (-s0 * px + c0 * py), w * em.L]);
        }
      });
    } else {                               // somme brute : une propagation par point source et par λ
      var paires = [];
      lams.forEach(function (wl, il) { pointsOnde(plan, wl[0]).forEach(function (pt) { paires.push([il, pt]); }); });
      var ordre = paires.map(function (x, q2) { return [hash32((graine ^ hash32(q2)) >>> 0), q2]; }).sort(function (x, y) { return x[0] - y[0] || x[1] - y[1]; });
      var n = Math.min(rendu.np || paires.length, paires.length);
      npaires = paires.length;
      for (var q3 = 0; q3 < n; q3++) {
        var pa = paires[ordre[(passe * (rendu.np || paires.length) + q3) % paires.length][1]];
        lot(lams[pa[0]], { mx: pa[1][0], my: pa[1][1], strates: [[0, 0, pa[1][2] * em.L * paires.length / n]] });
      }
    }
    return { h: h, G: G, lots: lots, paires: npaires };
  }
  // Pas [dx, dy] de la grille au détecteur pour la longueur d'onde l : ceux que rend ondeChamp, sans propager le champ.
  function ondePas(plan, l) {
    var key = "P" + l;
    if (plan.cache[key]) return plan.cache[key];
    var seq = plan.seq, pls = plan.planes, lm = l * 1e-6, Ms = chaine(seq, l, plan.src.i, pls[0].i), c, d = [plan.d[0], plan.d[1]], cs;
    if (plan.laser) c = invQ(Ms, Math.PI * seq.source.em.a * seq.source.em.a / lm)[0];
    else c = Math.abs(Ms[1]) > 1e-9 ? Ms[3] / Ms[1] : 0;
    cs = [c, c];
    for (var k = 0; k < pls.length; k++) {
      var Mt = mul(chaine(seq, l, pls[k].i, k === pls.length - 1 ? seq.iDet : pls[k + 1].i), abcdPrim(seq.prims[pls[k].i], l));
      for (var ax = 0; ax < 2; ax++) { var e = ondeEtapes(plan.N[ax], lm, d[ax], cs[ax], Mt, false); d[ax] = e.pas; cs[ax] = e.courbure; }
    }
    return (plan.cache[key] = d);
  }
  // Spectromètre sur le moteur ondulatoire : la passe d'ondePasse réduite à une longueur d'onde de poids 1 (figure nue),
  // sur 4 × 4 pixels de même aire que la fibre. planSpectre : copie légère du plan (même cache des masques, lambdas et
  // état de la carte graphique propres) ; une seule par plan suffit, la longueur d'onde change à chaque appel.
  function planSpectre(plan) { var p = Object.create(plan); p.gl = null; p.lambdas = []; return p; }
  function rendreSpectre(o) { return { res: 4, W: 0.8862269254527579 * o.r, cx: o.x, cy: o.y, ns: o.ns, np: o.np, graine: o.graine, passe: o.passe }; }
  // o = {x, y, r, l, ns, np, graine, passe} ; renvoie l'éclairement moyen sur la fibre (une passe : somme brute,
  // estimation sur np couples).
  function ondeSpectre(plan, o, ps) {
    ps = ps || planSpectre(plan); ps.lambdas = [[o.l, [1, 1, 1]]];
    var img = ondePasse(ps, rendreSpectre(o)), s = 0;
    for (var q = 0; q < 16; q++) s += img[3 * q];
    return s / 16;
  }

  var Coeur = {
    K: K, F: F, NP: NP, GRAND: GRAND, AIRY: AIRY, TYPES: TYPES, LENTILLES: LENTILLES, FILTRES: FILTRES, ETA_RESEAU: ETA_RESEAU,
    hash32: hash32, graineRayon: graineRayon, Alea: Alea, planckU: planckU, nVerre: nVerre, spectreTirage: spectreTirage,
    facteurXYZ: facteurXYZ, transFiltre: transFiltre, besselJ: besselJ, sag: sag, concevoir: concevoir, lentille: lentille,
    retournerLentille: retournerLentille, params: params, repere: repere, sequence: sequence, tirer: tirer, versSource: versSource, forme: forme,
    transmission: transmission, phase: phase, jonesPrim: jonesPrim, jones: jones, interConique: interConique, etape: etape,
    suivre: suivre, passeCPU: passeCPU, pinceau: pinceau, retenir: retenir, choisir: choisir, rejouer: rejouer, abcdPrim: abcdPrim, chaine: chaine, zDeS: zDeS, images: images,
    ouverture: ouverture, enveloppe: enveloppe, gaussien: gaussien, emballer: emballer, sourceGPU: sourceGPU, poidsType: poidsType,
    rayonUtile: rayonUtile, centrePlan: centrePlan, disque: disque, GUIDE: GUIDE, GUIDE_SITES: GUIDE_SITES, guidePaire: guidePaire,
    guideTables: guideTables, guideCPU: guideCPU, guideHistos: guideHistos, sitesGuide: sitesGuide,
    ONDE_OPTIONS: ONDE_OPTIONS, fft1: fft1, couverture: couverture, geomForme: geomForme, ondePlan: ondePlan, structurante: structurante, demiOuverture: demiOuverture, ondeMoteur: ondeMoteur,
    lambdasOnde: lambdasOnde, propAxe: propAxe, tfAxe: tfAxe, ondeEtapes: ondeEtapes, ondeJouer: ondeJouer, tableTF: tableTF, jouerTF: jouerTF, ondeChamp: ondeChamp, pointsOnde: pointsOnde, ondePasse: ondePasse, ondeProgramme: ondeProgramme, ondePas: ondePas,
    kSpectre: kSpectre, casesSpectre: casesSpectre, spectreCPU: spectreCPU, poidsSpectre: poidsSpectre, facteurOnde: facteurOnde,
    planSpectre: planSpectre, rendreSpectre: rendreSpectre, ondeSpectre: ondeSpectre,
    DIAPO_NOMS: DIAPO_NOMS, DIAPOS: DIAPOS, chargerDiapos: chargerDiapos, couvDiapo: couvDiapo
  };
  if (typeof module !== "undefined" && module.exports) { module.exports = { Coeur: Coeur }; return; }

  // ================= carte graphique (WebGL2) : tracé direct =================
  // Un sommet = un rayon (gl.POINTS, gl_VertexID + uBase) : le shader REPREND tirer + suivre + etape opération pour
  // opération, en float32, sur la séquence emballée (texture 8 × n RGBA32F) ; l'impact au détecteur est cumulé par
  // mélange additif dans une texture RGBA32F (EXT_float_blend). Sans mélange en flottant 32 bits : paquets de 16 384
  // rayons rendus en RGBA16F (poids divisés par le poids type), ajoutés un à un à l'accumulateur 32 bits.
  var GLSL_COMMUN = [
    "uint hsh(uint x){ x ^= x >> 16; x *= 0x7feb352dU; x ^= x >> 15; x *= 0x846ca68bU; x ^= x >> 16; return x; }",
    "float rnd(inout uint s){ s = hsh(s); return float(s >> 8) / 16777216.0; }",
    "float g1(float l, float mu, float s1, float s2){ float t = (l - mu) / (l < mu ? s1 : s2); return exp(-0.5*t*t); }",
    "vec3 cieFit(float l){ return vec3(1.056*g1(l,599.8,37.9,31.0)+0.362*g1(l,442.0,16.0,26.7)-0.065*g1(l,501.1,20.4,26.2),",
    "  0.821*g1(l,568.8,46.9,40.5)+0.286*g1(l,530.9,16.3,31.1), 1.217*g1(l,437.0,11.8,36.0)+0.681*g1(l,459.0,26.0,13.8)); }",
    // cie du cœur Michelson (queues rouge et violette corrigées ; constantes CIE_Y425, CIE_V410, CIE_R650 de ce cœur)
    "float cieLisse(float t){ t = clamp(t, 0.0, 1.0); return t*t*(3.0-2.0*t); }",
    "vec3 cie(float l){ vec3 c = cieFit(l);",
    "  if (l < 425.0) c.y = c.z * (" + M.CIE[1] + " + (0.0059 - " + M.CIE[1] + ") * cieLisse((425.0 - l) / 15.0));",
    "  if (l < 410.0) c.x = c.z * (" + M.CIE[0] + " + (0.21 - " + M.CIE[0] + ") * cieLisse((410.0 - l) / 30.0));",
    "  else if (l > 650.0) c.x = c.y * (" + M.CIE[2] + " + (2.77 - " + M.CIE[2] + ") * cieLisse((l - 650.0) / 40.0));",
    "  return c; }"
  ].join("\n");
  var VS_TRACE = "#version 300 es\nprecision highp float; precision highp int;\n" + [
    "uniform highp sampler2D uSeq; uniform int uNp; uniform int uNr; uniform int uBase; uniform uint uGraine; uniform uint uPasse;",
    "uniform int uSrc; uniform vec3 uSO; uniform vec3 uSX; uniform vec3 uSY; uniform vec3 uSZ; uniform vec4 uSdim; uniform vec3 uFil; uniform vec4 uCible; uniform float uCibleL; uniform float uLum;",
    "uniform int uSpT; uniform vec4 uSpC; uniform int uNl; uniform vec4 uSpL[2]; uniform vec4 uSpCum[2]; uniform vec2 uVerre; uniform vec4 uSpQ[" + TIRAGE_L.nq / 4 + "];",
    "uniform int uJones; uniform vec4 uAiry[32]; uniform vec4 uEta; uniform vec4 uFen;",
    "uniform int uMode; uniform int uDe; uniform int uNb; uniform vec4 uObj; uniform vec4 uSuiv; uniform vec4 uSpe; uniform vec3 uSpeL;",
    "uniform highp sampler2D uDia; uniform int uDiaN;",          // diapos empilées (n × 4n, R8) ; uDiaN = 0 : vierges
    // visée guidée (guidePaire) : uGn[site] = côté m de sa table (0 : sans table) ; texture (prob, alias, iq), un bloc de
    // uGb lignes par site, case i en (i % m, i / m + site · uGb) ; uGa = alpha arrondi en float32
    "uniform highp sampler2D uGd; uniform ivec4 uGn; uniform int uGb; uniform float uGa;",
    // passe pilote (`histoGuide`) : uHs = site dont la paire (u, v) est notée (gUV) ; un rayon détecté dans la
    // fenêtre va dans la case de gUV d'une cible uHn × uHn, couleur (y, y², 0), alpha = 1 (y = poids × Y) ; −1 : image
    "uniform int uHs; uniform int uHn; uniform highp sampler2D uHg; uniform int uHgN;",
    "out vec3 vC; out vec4 vImp;",          // vImp : relu rayon par rayon par le test (transform feedback)
    GLSL_COMMUN,
    "const float EPS = " + EPS_T.toExponential() + ", TMAX = " + TMAX.toExponential() + ", DPI = 6.283185307179586, PI = 3.141592653589793;",
    "float planckU(float l, float T){ float u = l * 1e-3; return 1.0 / (u*u*u*u*u * (exp(14388.0 / (u * T)) - 1.0)); }",
    "float nVerre(float v, float l){ return v < 0.5 ? 1.0 : uVerre.x + uVerre.y / (l * l); }",
    "float airy(int i){ return uAiry[i / 4][i % 4]; }",
    "float trFiltre(int k, float l){",
    "  if (k >= 10) return pow(10.0, float(10 - k));",
    "  if (k == 1) return 0.85 / (1.0 + exp(-(l - 600.0) / 8.0));",
    "  float mu = k == 2 ? 530.0 : (k == 3 ? 450.0 : 546.0), fw = k == 4 ? 10.0 : 80.0, t = (l - mu) / (fw / 2.3548200450309493);",
    "  return (k == 4 ? 0.6 : 0.75) * exp(-0.5 * t * t); }",
    "int forme(int f, vec4 a, vec4 b, vec2 q){",
    "  float x = q.x, y = q.y;",
    "  if (f == 1) return x*x + y*y < a.x*a.x ? 1 : 0;",
    "  if (f == 2) return (abs(x) < 0.5*a.x && abs(y) < 0.5*a.y) ? 1 : 0;",
    "  if (f == 3 || f == 4) {",
    "    if (f == 3 && abs(y) >= 0.5*a.w) return 0;",
    "    float xm = 0.0;",
    "    if (a.x > 1.5) { float m = min(max(floor(x / a.z + 0.5*(a.x - 1.0) + 0.5), 0.0), a.x - 1.0); xm = (m - 0.5*(a.x - 1.0)) * a.z; }",
    "    if (f == 3) return abs(x - xm) < 0.5*a.y ? 1 : 0;",
    "    float dx = x - xm; return dx*dx + y*y < 0.25*a.y*a.y ? 1 : 0; }",
    "  if (f == 5) { float u = x / a.x, v = y / a.x;",
    "    return ((u > -6.0 && u < -3.0 && v > -10.0 && v < 10.0) || (u > -6.0 && u < 6.0 && v > 7.0 && v < 10.0) || (u > -6.0 && u < 3.0 && v > -1.5 && v < 1.5)) ? 1 : 0; }",
    "  if (f == 6) {",
    "    if (abs(x) >= a.z || abs(y) >= a.z) return 0;",
    "    float gx = abs(x - a.x*floor(x/a.x + 0.5)), gy = abs(y - a.x*floor(y/a.x + 0.5));",
    "    if (gx < 0.5*a.y || gy < 0.5*a.y) return 0;",
    "    if (a.w > 0.0) { gx = abs(x - a.w*floor(x/a.w + 0.5)); gy = abs(y - a.w*floor(y/a.w + 0.5)); if (gx < 0.5*b.x || gy < 0.5*b.x) return 0; }",
    "    return 1; }",
    "  if (f == 7) {",
    "    if (abs(x) >= a.x + 2.0 || abs(y) >= a.z) return 0;",
    "    float j = floor(x / a.w + 0.5);",
    "    if (abs(j*a.w) <= a.x && abs(x - j*a.w) < 0.5*a.y) { float aj = abs(j), len = mod(aj, 10.0) == 0.0 ? 2.5 : (mod(aj, 5.0) == 0.0 ? 1.6 : 1.0); if (y + a.z < len) return 0; }",
    "    return 1; }",
    "  if (f == 8) return x > a.x ? 1 : 0;",
    "  if (f == 9) { float r2 = x*x + y*y; return (r2 > a.x*a.x && r2 < a.y*a.y) ? 1 : 0; }",
    "  if (f == 10) return (abs(x) >= 0.5*a.x && x*x + y*y < a.y*a.y) ? 1 : 0;",
    "  if (f == 11) {",
    "    int ib = int(floor(x / b.y + b.w + 0.5));",
    "    if (ib < 0 || ib > 2) return 0;",
    "    if (abs(y) >= 0.5*b.x) return 0;",
    "    if (((int(floor(b.z + 0.5)) >> ib) & 1) == 1) return 0;",
    "    float ai = ib == 0 ? a.x : (ib == 1 ? a.y : a.z);",
    "    return abs(abs(x - (float(ib) - b.w)*b.y) - 0.5*ai) < 0.5*a.w ? 1 : 0; }",
    "  if (f == 12) {",
    "    if (x*x + y*y >= a.w*a.w) return 0;",
    "    if (abs(x) < 0.5*a.y || abs(y) < 0.5*a.y) return 0;",
    "    if (a.x > 0.5) { float jr = floor(x / a.z + 0.5);",
    "      if (abs(jr*a.z) <= 5.0 && abs(x - jr*a.z) < 0.5*a.y) { float ar = abs(jr), lr = mod(ar, 10.0) == 0.0 ? 0.6 : (mod(ar, 5.0) == 0.0 ? 0.4 : 0.25); if (y > 0.0 && y < lr) return 0; } }",
    "    return 1; }",
    "  return 1; }",
    "float diapo(vec4 a, vec2 q){",
    "  if (uDiaN == 0) return (abs(q.x) < a.y && abs(q.y) < a.y) ? 1.0 : 0.0;",
    "  float nD = float(uDiaN); int i = int(floor((q.x / a.y + 1.0) * 0.5 * nD)), j = int(floor((1.0 - q.y / a.y) * 0.5 * nD));",
    "  if (i < 0 || i >= uDiaN || j < 0 || j >= uDiaN) return 0.0;",
    "  return texelFetch(uDia, ivec2(i, j + int(a.x + 0.5) * uDiaN), 0).r; }",
    "float interConique(vec3 q, vec3 d, float zv, float c, float k){",
    "  float qx = q.x, qy = q.y, qz = q.z - zv, e = 1.0 + k;",
    "  float A = c * (d.x*d.x + d.y*d.y + e*d.z*d.z), B = d.z - c * (qx*d.x + qy*d.y + e*qz*d.z);",
    "  float C = c * (qx*qx + qy*qy + e*qz*qz) - 2.0*qz, disc = B*B - A*C;",
    "  if (disc < 0.0) return -1e30;",
    "  float s = sqrt(disc), den = B + (B >= 0.0 ? s : -s);",
    "  float t1 = den != 0.0 ? C / den : -1e30, t2 = A != 0.0 ? den / A : -1e30;",
    "  bool o1 = t1 > -EPS && t1 < TMAX && c*e*(qz + t1*d.z) < 1.0, o2 = t2 > -EPS && t2 < TMAX && c*e*(qz + t2*d.z) < 1.0;",
    "  if (o1 && o2) return min(t1, t2);",
    "  return o1 ? t1 : (o2 ? t2 : -1e30); }",
    "int monture(vec2 q, float R, float Sm){ if (abs(q.x) > Sm || abs(q.y) > Sm) return 2; return q.x*q.x + q.y*q.y > R*R ? 1 : 0; }",
    "vec2 cmul(vec2 a, vec2 b){ return vec2(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x); }",
    // `disque` et `guidePaire` du processeur : (u, v, iq) d'un site
    "vec2 disque(float u, float v){ float a = 2.0 * u - 1.0, b = 2.0 * v - 1.0, r, ph;",
    "  if (a == 0.0 && b == 0.0) return vec2(0.0);",
    "  if (abs(a) > abs(b)) { r = a; ph = 0.7853981633974483 * (b / a); } else { r = b; ph = 1.5707963267948966 - 0.7853981633974483 * (a / b); }",
    "  return r * vec2(cos(ph), sin(ph)); }",
    // `vise` du processeur : (x, y, aire / π) dans la cible de rayon utile R élargie à Rl
    "vec3 vise(float u, float v, float R, float Rl){ vec2 dq = disque(u, v);",
    "  if (!(Rl > R)) return vec3(R * dq, R * R);",
    "  float r = max(abs(2.0 * u - 1.0), abs(2.0 * v - 1.0)), r0 = " + VISE_R0.toFixed(6) + ";",
    "  if (r < r0) { float s = R / r0; return vec3(s * dq, s * s); }",
    "  float a = (Rl * Rl - R * R) / (1.0 - r0 * r0);",
    "  return vec3(sqrt(R * R + a * (r * r - r0 * r0)) / r * dq, a); }",
    "vec2 gUV = vec2(0.0); bool gOk = false;",
    "vec3 guide(int site, inout uint s){",
    "  int n = site < " + GUIDE_SITES + " ? uGn[site] : 0;",
    "  if (n == 0) { float u = rnd(s); float v = rnd(s); if (site == uHs) { gUV = vec2(u, v); gOk = true; } return vec3(u, v, 1.0); }",
    "  float b = rnd(s); float c = rnd(s); float u = rnd(s); float v = rnd(s); int i;",
    "  if (b < uGa) i = int(floor(u * float(n))) + n * int(floor(v * float(n)));",
    "  else { float x = c * float(n * n); int j = int(floor(x)); vec4 t = texelFetch(uGd, ivec2(j % n, j / n + site * uGb), 0);",
    // en float32 un point de la dernière case peut s'arrondir à 1 (log(0) du laser) : ramené sous 1
    "    i = x - float(j) < t.x ? j : int(t.y + 0.5); u = min((float(i % n) + u) / float(n), 0.99999994); v = min((float(i / n) + v) / float(n), 0.99999994); }",
    "  if (site == uHs) { gUV = vec2(u, v); gOk = true; }",
    "  return vec3(u, v, texelFetch(uGd, ivec2(i % n, i / n + site * uGb), 0).z); }",
    // Une primitive (ligne i de la texture), comme `etape` du processeur : 0 continue, 1 arrêté, 2 détecté (imp).
    "int etape(int i, inout vec3 p, inout vec3 d, inout float w, inout float n, inout vec4 J, inout uint s, inout bool hors, inout vec2 imp, float l){",
    "  vec4 t0 = texelFetch(uSeq, ivec2(0, i), 0), t1 = texelFetch(uSeq, ivec2(1, i), 0), t2 = texelFetch(uSeq, ivec2(2, i), 0), t3 = texelFetch(uSeq, ivec2(3, i), 0);",
    "  vec4 t4 = texelFetch(uSeq, ivec2(4, i), 0), t5 = texelFetch(uSeq, ivec2(5, i), 0), t6 = texelFetch(uSeq, ivec2(6, i), 0);",
    "  int kind = int(t0.x + 0.5);",
    "  float P0 = t2.w, P1 = t3.w, P2 = t4.w;",
    "  vec4 Pa = vec4(P1, P2, t5.x, t5.y), Pb = vec4(t5.z, t5.w, t6.x, t6.y);",          // paramètres 1-4 et 5-8 d'une forme
    "  if (kind == 10) {",
    "    if (hors) return 0;",
    "    float u = rnd(s) * 127.0; int ia = int(floor(u)); float vA = airy(ia) + (u - float(ia)) * (airy(min(ia + 1, 127)) - airy(ia));",
    "    float al = vA * l * 1e-6 / (PI * P0 * n), ps = DPI * rnd(s), az = abs(d.z);",
    "    d = normalize(vec3(d.x + al * az * cos(ps), d.y + al * az * sin(ps), d.z));",
    "    return 0; }",
    "  vec3 O = t1.xyz, ex = t2.xyz, ey = t3.xyz, ez = t4.xyz; float dzp = t0.y, R = t0.z, Sm = t0.w;",
    "  vec3 v = p - O, q = vec3(dot(v, ex), dot(v, ey), dot(v, ez)), dl = vec3(dot(d, ex), dot(d, ey), dot(d, ez));",
    "  float t; int m; bool dLab = false;",
    "  if (kind == 1) {",
    "    t = interConique(q, dl, dzp, P0, P1);",
    "    bool touche = t > -EPS && t < TMAX;",
    "    if (!touche) { if (dl.z == 0.0) return 1; t = (dzp - q.z) / dl.z; }",
    "    if (!(t > -EPS && t < TMAX)) return 1;",
    "    q += t * dl;",
    "    m = monture(q.xy, R, Sm); hors = m == 2;",
    "    if (m == 1 || (m == 0 && !touche)) return 1;",
    "    if (m == 0) {",
    "      float Z = q.z - dzp; vec3 nr = normalize(vec3(P0 * q.x, P0 * q.y, P0 * (1.0 + P1) * Z - 1.0));",
    "      float n2 = nVerre(t5.x, l), eta = nVerre(P2, l) / n2, ci = -dot(dl, nr);",
    "      if (ci < 0.0) { nr = -nr; ci = -ci; }",
    "      float kk = 1.0 - eta * eta * (1.0 - ci * ci);",
    "      if (kk < 0.0) return 1;",
    "      dl = eta * dl + (eta * ci - sqrt(kk)) * nr; n = n2; }",
    "  } else {",
    "    if (dl.z == 0.0) return 1;",
    "    t = (dzp - q.z) / dl.z;",
    "    if (!(t > -EPS && t < TMAX)) return 1;",
    "    q += t * dl;",
    "    if (kind == 11) {",
    "      if (abs(q.x) < Sm && abs(q.y) < t6.z && (P0 < 0.5 || forme(int(P0 + 0.5), Pa, Pb, q.xy) == 0)) { imp = q.xy; return 2; }",
    "      return 1; }",
    "    m = monture(q.xy, R, Sm); hors = m == 2;",
    "    if (m == 1) return 1;",
    "    if (m == 0) {",
    "      if (kind == 2) {",
    "        float sg = dl.z >= 0.0 ? 1.0 : -1.0, ad = abs(dl.z);",
    "        dl = normalize(vec3(dl.x / ad - q.x / P0, dl.y / ad - q.y / P0, sg));",
    "      } else if (kind == 3) {",
    "        int fm = int(P0 + 0.5);",
    "        if (fm == 13) { float tm = diapo(Pa, q.xy); if (tm == 0.0) return 1; w *= tm; }",
    "        else if (forme(fm, Pa, Pb, q.xy) == 0) return 1;",
    "      } else if (kind == 4) {",
    "        vec3 pl = O + q.x * ex + q.y * ey + q.z * ez;",
    "        vec3 gd = guide(2 + int(t5.y + 0.5), s);",          // t5.y = p[4] : numéro du dépoli
    "        vec3 dv = vise(gd.x, gd.y, abs(t5.x), t5.z), vv = vec3(vec2(P0, P1) + dv.xy, P2) - pl; float d2 = dot(vv, vv); if (t5.x < 0.0) vv = -vv;",          // t5.z = p[5] : Rl
    "        d = vv / sqrt(d2); dLab = true;",
    "        w *= abs(dot(d, ez)) * abs(d.z) * dv.z / d2 * gd.z;",
    "      } else if (kind == 5) {",
    "        float gr = l * 1e-6 / P0, Ssum = 0.0;",
    "        for (int o = -3; o <= 3; o++) { float sx = dl.x + float(o) * gr; if (sx * sx + dl.y * dl.y < 1.0) Ssum += uEta[abs(o)]; }",
    "        if (!(Ssum > 0.0)) return 1;",
    "        float ur = rnd(s) * Ssum, cumr = 0.0; int ordre = 0;",
    "        for (int o = -3; o <= 3; o++) { float sx = dl.x + float(o) * gr; if (sx * sx + dl.y * dl.y < 1.0) { cumr += uEta[abs(o)]; ordre = o; if (ur < cumr) break; } }",
    "        float dxr = dl.x + float(ordre) * gr, s2r = dxr * dxr + dl.y * dl.y;",
    "        if (!(s2r < 1.0)) return 1;",
    "        dl = vec3(dxr, dl.y, (dl.z >= 0.0 ? 1.0 : -1.0) * sqrt(1.0 - s2r)); w *= Ssum;",
    "      } else if (kind == 6) {",
    "        dl.z = -dl.z;",
    "      } else if (kind == 7) {",
    "        if (uJones == 1 && J == vec4(0.0)) { if (P0 < 1.5) { J = vec4(cos(P1), 0.0, sin(P1), 0.0); w *= 0.5; } }",   // lumière naturelle
    "        else if (uJones == 1) {",
    "          float c = cos(P1), sn = sin(P1); vec2 ma, mb, md;",
    "          if (P0 < 1.5) { ma = vec2(c * c, 0.0); mb = vec2(c * sn, 0.0); md = vec2(sn * sn, 0.0); }",
    "          else { float g = P2 * t5.x / l, er = cos(g), ei = sin(g); ma = vec2(c * c + sn * sn * er, sn * sn * ei); mb = vec2(c * sn * (1.0 - er), -c * sn * ei); md = vec2(sn * sn + c * c * er, c * c * ei); }",
    "          vec2 nx = cmul(ma, J.xy) + cmul(mb, J.zw), ny = cmul(mb, J.xy) + cmul(md, J.zw);",
    "          float I = dot(nx, nx) + dot(ny, ny);",
    "          if (!(I > 0.0)) return 1;",
    "          J = vec4(nx, ny) / sqrt(I); w *= I; }",
    "      } else if (kind == 8) {",
    "        w *= trFiltre(int(P0 + 0.5), l);",
    "      } else if (kind == 9) {",
    "        if (P0 < 1.5) { float gk = l * 1e-6 / DPI * P1 * exp(-(q.x * q.x + q.y * q.y) / (P2 * P2)) * (-2.0 / (P2 * P2));",
    "          dl = normalize(vec3(dl.x + gk * q.x, dl.y + gk * q.y, dl.z)); }",
    "      }",
    "    }",
    "  }",
    "  p = O + q.x * ex + q.y * ey + q.z * ez;",
    "  if (!dLab) d = dl.x * ex + dl.y * ey + dl.z * ez;",
    "  return 0; }",
    // Tirage depuis l'objet : le rayon (Q, d) vient-il de la source ? À rebours à travers les lentilles (lignes uNp…),
    // puis plan d'émission dans le repère de la source.
    "bool depuisSource(vec3 Q, vec3 dd, float l, inout uint s){",
    "  vec3 p = Q, d = -dd; float w = 1.0, n = 1.0; vec4 J = vec4(0.0); bool hors = false; vec2 imp = vec2(0.0);",
    "  for (int j = 0; j < 16; j++) { if (j >= uNb) break; if (etape(uNp + j, p, d, w, n, J, s, hors, imp, l) != 0) return false; }",
    "  vec3 v = p - uSO; float qz = dot(v, uSZ), dz = dot(d, uSZ);",
    "  if (dz == 0.0) return false;",
    "  float t = (uSdim.z - qz) / dz;",
    "  if (!(t > 0.0)) return false;",
    "  vec3 e = v + t * d; float x = dot(e, uSX), y = dot(e, uSY);",
    "  if (uSrc == 0 && uFil.x > 0.5) { float pf = uSdim.x / uFil.x, xc = x - uFil.z * y, k = floor(xc / pf + 0.5 * (uFil.x - 1.0) + 0.5);",
    "    return abs(y) < 0.5 * uSdim.y && k >= 0.0 && k < uFil.x && abs(xc - (k - 0.5 * (uFil.x - 1.0)) * pf) < 0.5 * uFil.y * pf; }",
    "  if (uSrc == 0) return abs(x) < 0.5 * uSdim.x && abs(y) < 0.5 * uSdim.y;",
    "  return x * x + y * y < uSdim.x * uSdim.x; }",
    "void main(){",
    "  gl_PointSize = 1.0; gl_Position = vec4(2.0, 2.0, 0.0, 1.0); vC = vec3(0.0); vImp = vec4(0.0, 0.0, 0.0, -1.0);",
    "  int k = gl_VertexID + uBase;",
    "  uint s = hsh(hsh(hsh(uGraine) ^ uPasse) ^ uint(k));",
    "  float u1 = rnd(s), l;",
    "  int il = 0;",
    "  float kl = uSpC.w;",
    "  if (uSpT == 0) { int m = " + (TIRAGE_L.nq - 1) + "; float t = (float(k) + u1) / float(uNr) * float(m); int i = min(int(floor(t)), m - 1);",
    "    float q0 = uSpQ[i / 4][i % 4], q1 = uSpQ[(i + 1) / 4][(i + 1) % 4]; l = q0 + (t - float(i)) * (q1 - q0);",
    "    kl = planckU(l, uSpC.z) * uSpC.w * (q1 - q0) * float(m) / (uSpC.y - uSpC.x); }",
    "  if (uSpT != 0) { int i = 0; for (int j = 0; j < 8; j++) { if (i < uNl - 1 && u1 >= uSpCum[i / 4][i % 4]) i++; else break; } l = uSpL[i / 4][i % 4]; il = i; }",
    "  vec3 fx = cie(l) * kl;",
    "  vec3 g0 = guide(0, s); float u2 = g0.x, u3 = g0.y, r, ph, w; vec3 p, d; vec4 J = vec4(0.0);",
    "  if (uMode == 1) {",
    "    vec3 Q = vec3(uObj.xy + uObj.w * disque(u2, u3), uObj.z);",
    "    vec3 g1 = guide(1, s); vec3 v = vec3(uSuiv.xy + uSuiv.w * disque(g1.x, g1.y), uSuiv.z) - Q; float d2 = dot(v, v);",
    "    d = v / sqrt(d2); p = Q;",
    "    if (!depuisSource(Q, d, l, s)) return;",
    "    w = uLum * PI * uObj.w * uObj.w * PI * uSuiv.w * uSuiv.w * d.z * d.z / d2 * g0.z * g1.z;",
    "  } else {",
    "    float xs, ys;",
    "    if (uSrc == 0) { ys = (u3 - 0.5) * uSdim.y;",
    "      if (uFil.x > 0.5) { float pf = uSdim.x / uFil.x, k = min(uFil.x - 1.0, floor(u2 * uFil.x)); xs = (k - 0.5 * (uFil.x - 1.0)) * pf + uFil.z * ys + (u2 * uFil.x - k - 0.5) * uFil.y * pf; }",
    "      else xs = (u2 - 0.5) * uSdim.x; }",
    "    else if (uSrc == 1) { vec2 dq = uSdim.x * disque(u2, u3); xs = dq.x; ys = dq.y; }",
    "    else { r = sqrt(-2.0 * log(1.0 - u2)); ph = DPI * u3; xs = 0.5 * uSdim.x * r * cos(ph); ys = 0.5 * uSdim.x * r * sin(ph); }",
    "    p = uSO + xs * uSX + ys * uSY + uSdim.z * uSZ;",
    "    vec3 g1 = guide(1, s); float u4 = g1.x, u5 = g1.y;",
    "    if (uSrc == 2) { r = sqrt(-2.0 * log(1.0 - u4)); ph = DPI * u5; d = normalize(0.5 * uSdim.y * r * cos(ph) * uSX + 0.5 * uSdim.y * r * sin(ph) * uSY + uSZ); w = uLum * g0.z * g1.z; }",
    "    else { vec3 cv = vise(u4, u5, uCible.w, uCibleL), v = vec3(uCible.xy + cv.xy, uCible.z) - p; float d2 = dot(v, v);",
    "      d = v / sqrt(d2); w = uLum * uSdim.w * PI * cv.z * d.z * d.z / d2 * g0.z * g1.z; }",
    "  }",
    "  float n = 1.0; bool det = false, hors = false; vec2 imp = vec2(0.0);",
    "  for (int i = 0; i < 64; i++) {",
    "    int ii = i + uDe;",
    "    if (ii >= uNp) break;",
    "    vImp.w = float(ii);",
    "    int c = etape(ii, p, d, w, n, J, s, hors, imp, l);",
    "    if (c == 1) return;",
    "    if (c == 2) { det = true; break; }",
    "  }",
    "  if (!det) return;",
    "  vImp = vec4(imp, w * fx.y, 1000.0);",
    // spectromètre (spectreCPU) : rayon détecté dans la fibre (centre uSpe.xy, r² = uSpe.z), rangé dans la case de sa
    // longueur d'onde (uSpe.w cases de [uSpeL.x, uSpeL.y], une par raie pour des raies), ligne 0 ; uSpeL.z = 2 / res
    "  if (uSpe.w > 0.5) {",
    "    vec2 df = imp - uSpe.xy; if (dot(df, df) >= uSpe.z) return;",
    "    float b = uSpT == 0 ? floor((l - uSpeL.x) / (uSpeL.y - uSpeL.x) * uSpe.w) : float(il);",
    "    if (b < 0.0 || b >= uSpe.w) return;",
    "    gl_Position = vec4((b + 0.5) * uSpeL.z - 1.0, 0.5 * uSpeL.z - 1.0, 0.0, 1.0);",
    "    vC = vec3(w * kl * uFen.w, 0.0, 0.0); return; }",
    "  vec2 ndc = (imp - uFen.xy) / uFen.z;",
    "  if (abs(ndc.x) >= 1.0 || abs(ndc.y) >= 1.0) return;",
    "  if (uHs >= 0) { if (!gOk) return; float y = w * fx.y, hn = float(uHn);",
    "    if (uHgN > 0) y *= texelFetch(uHg, min(ivec2(floor((ndc * 0.5 + 0.5) * float(uHgN))), ivec2(uHgN - 1)), 0).x;",
    "    gl_Position = vec4((floor(min(gUV, vec2(0.99999994)) * hn) + 0.5) / hn * 2.0 - 1.0, 0.0, 1.0); vC = vec3(y, y * y, 0.0); return; }",
    "  gl_Position = vec4(ndc, 0.0, 1.0);",
    "  vC = w * fx * uFen.w;",
    "}"].join("\n");
  // Deux sorties identiques : la seconde (accumulateur B des passes impaires, `voieB`) n'est écrite que si le tampon
  // de dessin a deux attachements ; ailleurs (accumulateur seul, tampon du repli sans mélange) elle est ignorée.
  var FS_POINT = "#version 300 es\nprecision highp float;\nin vec3 vC; layout(location = 0) out vec4 o; layout(location = 1) out vec4 oB;\nvoid main(){ o = vec4(vC, 1.0); oB = o; }";
  var VS_QUAD = "#version 300 es\nin vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }";
  var FS_AJOUT = "#version 300 es\nprecision highp float;\nuniform highp sampler2D uAcc; uniform highp sampler2D uTmp; uniform float uInv; out vec4 o;\n" +
    "void main(){ ivec2 p = ivec2(gl_FragCoord.xy); vec4 t = texelFetch(uTmp, p, 0); o = texelFetch(uAcc, p, 0) + vec4(t.xyz * uInv, t.a); }";
  // Somme de l'accumulateur par blocs (cible uN × uN, blocs de ⌈uRes / uN⌉ texels de côté) : Σ XYZ et nombre de rayons
  // par bloc ; `sommes` (uN = 16, toute l'image) et `reduire` (image réduite pour le halo pendant un geste).
  var FS_MOY = "#version 300 es\nprecision highp float; precision highp int;\nuniform highp sampler2D uA; uniform int uRes; uniform int uN; out vec4 o;\n" +
    "void main(){ int b = (uRes + uN - 1) / uN; ivec2 p0 = ivec2(gl_FragCoord.xy) * b; vec4 s = vec4(0.0);\n" +
    "  for (int j = 0; j < b; j++) for (int i = 0; i < b; i++) { ivec2 p = p0 + ivec2(i, j); if (p.x < uRes && p.y < uRes) s += texelFetch(uA, p, 0); }\n  o = s; }";
  // Histogramme logarithmique de Y (un point par texel, gl_VertexID ; mélange additif) : NB_HISTO cases de 1/HISTO_OCT
  // d'octave à partir de 2^HISTO_LO, rangées sur une cible 64 × 64 ; Y ≤ 0 : rien. Sert au centile de l'exposition
  // automatique (`centile`) sans relire l'accumulateur ni trier sur le processeur (29 ms à 512², 200 ms à 2048²).
  var HISTO_OCT = 16, HISTO_LO = -128, NB_HISTO = 4096;
  var VS_HISTO = "#version 300 es\nprecision highp float; precision highp int;\nuniform highp sampler2D uA; uniform int uRes;\n" +
    "void main(){ gl_PointSize = 1.0; int i = gl_VertexID; float y = texelFetch(uA, ivec2(i % uRes, i / uRes), 0).y;\n" +
    "  gl_Position = vec4(2.0, 2.0, 0.0, 1.0); if (!(y > 0.0)) return;\n" +
    "  int b = clamp(int(floor((log2(y) - " + HISTO_LO.toFixed(1) + ") * " + HISTO_OCT.toFixed(1) + ")), 0, " + (NB_HISTO - 1) + ");\n" +
    "  gl_Position = vec4((float(b % 64) + 0.5) / 32.0 - 1.0, (float(b / 64) + 0.5) / 32.0 - 1.0, 0.0, 1.0); }";
  var FS_UN = "#version 300 es\nprecision highp float;\nout vec4 o;\nvoid main(){ o = vec4(1.0, 0.0, 0.0, 0.0); }";
  // Bruit mesuré : un point par texel éclairé, A = total − B (passes paires), B = passes
  // impaires ; r = 1,2533 |A − B| / (A + B) rangé en cases logarithmiques (BRUIT_OCT par octave depuis 2^BRUIT_LO,
  // BRUIT_NB cases par classe) ; classe 0 : texels clairs (Y > 0,3 × uHaut, 99e centile), 1 : faibles (0,03 à 0,3).
  var BRUIT_OCT = 16, BRUIT_LO = -28, BRUIT_NB = 512;
  var VS_BRUIT = "#version 300 es\nprecision highp float; precision highp int;\nuniform highp sampler2D uA; uniform highp sampler2D uB; uniform int uRes; uniform float uHaut;\n" +
    "void main(){ gl_PointSize = 1.0; int i = gl_VertexID; ivec2 p = ivec2(i % uRes, i / uRes); float t = texelFetch(uA, p, 0).y, b = texelFetch(uB, p, 0).y;\n" +
    "  gl_Position = vec4(2.0, 2.0, 0.0, 1.0); if (!(t > 0.03 * uHaut)) return;\n" +
    "  int c = t > 0.3 * uHaut ? 0 : 1; float r = 1.2533 * abs(t - 2.0 * b) / t;\n" +
    "  int k = r > 0.0 ? clamp(int(floor((log2(r) - " + BRUIT_LO.toFixed(1) + ") * " + BRUIT_OCT.toFixed(1) + ")), 0, " + (BRUIT_NB - 1) + ") : 0; k += c * " + BRUIT_NB + ";\n" +
    "  gl_Position = vec4((float(k % 64) + 0.5) / 32.0 - 1.0, (float(k / 64) + 0.5) / " + (BRUIT_NB / 64).toFixed(1) + " - 1.0, 0.0, 1.0); }";
  // Affichage : texels moyennés sur le pixel affiché (anti-repliement) ou interpolés (uNet = 1 : au plus proche, pour
  // voir les pixels d'un capteur quand un texel en vaut un), axes retournés selon la vue du
  // détecteur, teinte lissée (uLisse > 0 : la luminance Y reste celle du pixel, la chromaticité est celle de la somme
  // des texels voisins, carré élargi anneau après anneau jusqu'à réunir uSeuil rayons (alpha de l'accumulateur =
  // nombre de rayons reçus) ou atteindre le rayon uLisse : un rayon ne porte qu'une longueur d'onde, à peu de rayons
  // par pixel le bruit est surtout un bruit de couleur ; les bords et la netteté, portés par Y, ne bougent pas ; un
  // pixel qui a reçu assez de rayons garde sa propre teinte : l'image fine n'est pas lissée ; s'il en manque encore
  // au rayon maximal, les rayons manquants sont comptés à la teinte moyenne de toute l'image, uMoy = XYZ moyen par
  // rayon : une image faite de quelques rayons épars n'est plus un semis de points colorés), bruit de photons du capteur
  // (uBruit > 0 : par texel, sur la luminance, teinte gardée (un tirage par composante XYZ ferait un bruit de couleur
  // amplifié par le passage en sRGB) : σ = √(v · uBruit), v = Y × uK, 1 à la saturation ; uBruit = 1 / photoélectrons
  // d'un texel saturé ; tirage figé par texel), XYZ × uK → sRGB, balance, hors gamut côté bleu-vert (R < 0) ramené par ajout de blanc (BLANC_HG, comme versRGB du cœur Michelson ; rien côté G < 0, le rouge
  // virerait au rose), compression L^p (œil : 0,5) qui
  // désature d'autant que Y est faible (chroma × min(Y, 1)^(SAT_FAIBLE (1 − p)) : sans cela une zone faible remontée garde sa saturation de
  // pleine lumière, halo violet « calque »), fond ajouté (salle noire), compression douce, gamma.
  // uMode = 1 (vue « œil » en luminosité réelle) : XYZ × uK = luminance en cd/m²,
  // puis `vision` du module couleur (uVis = parametresVision : Ward, seuil, Hunt, rapport scotopique), ni fond ni
  // compression : le moniteur affiche ce que l'œil percevrait. Halo dans l'œil : voile uV (cd/m², XYZ, grille
  // uVn² du champ ENTIER, `voileHalo` du module couleur) ajouté à la luminance avant `vision`, lu en bilinéaire ;
  // uVg = (échelle, décalage) de la fenêtre affichée (0-1) vers la grille du voile ; uVn = 0 : pas de voile.
  // uMode = 2 (capteur, rendu photo) : XYZ × uK = signal rapporté à la saturation, balance fixe (halogène),
  // écrêté à 1 par composante (gam), courbe sRGB, sans compression douce. Dans `lire` (capteur, uBruit > 0) : voile
  // d'objectif uVo (XYZ, unités de l'accumulateur) ajouté avant le bruit de photons, puis bruit de lecture uLect (écart
  // type rapporté à la saturation, gris), écrêté à 0.
  // Blanc du capteur (XYZ de la lampe halogène, Y = 1 : neutre après la balance) : teinte du bruit de lecture.
  var BLANC_CAPTEUR = (function () { var w = M.xyzSpectre(M.SPECTRES.bl); return [w[0] / w[1], 1, w[2] / w[1]]; })();
  // Lissage de la luminance par densité à l'affichage (FS_AFF) : au plus r texels de rayon, n rayons à réunir, et seulement
  // si le voisinage 3 × 3 a moins de d rayons par texel en moyenne (lumière clairsemée ; bords nets gardés ailleurs).
  var LISSE_Y = { r: 8, n: 48, d: 3 };
  var FS_AFF = "#version 300 es\nprecision highp float; precision highp int;\n" + [
    "uniform highp sampler2D uA; uniform int uRes; uniform vec2 uTaille; uniform float uK; uniform vec3 uBal; uniform vec2 uVue; uniform float uComp; uniform vec3 uFond; uniform int uNet; uniform int uLisse; uniform float uSeuil; uniform vec3 uMoy; uniform float uBruit; uniform int uMode; uniform vec4 uVis; uniform float uLect; uniform vec3 uVo; uniform vec4 uCap;",
    "uniform highp sampler2D uV; uniform int uVn; uniform vec4 uVg; uniform int uLisseY; uniform float uSeuilY; uniform highp sampler2D uB; uniform int uBn;",
    "out vec4 o;",
    M.GLSL_VISION,
    "vec3 voile(vec2 f){ vec2 q = (f * uVg.xy + uVg.zw) * float(uVn) - 0.5; ivec2 i0 = ivec2(floor(q)); vec2 t = q - floor(q); ivec2 m = ivec2(uVn - 1);",
    "  vec3 a = texelFetch(uV, clamp(i0, ivec2(0), m), 0).xyz, b = texelFetch(uV, clamp(i0 + ivec2(1, 0), ivec2(0), m), 0).xyz;",
    "  vec3 c = texelFetch(uV, clamp(i0 + ivec2(0, 1), ivec2(0), m), 0).xyz, d = texelFetch(uV, clamp(i0 + ivec2(1, 1), ivec2(0), m), 0).xyz;",
    "  return mix(mix(a, b, t.x), mix(c, d, t.x), t.y); }",
    "const float SAT_FAIBLE = 0.25;",
    "uint hachis(uint x){ x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }",
    "float unif(inout uint s){ s = hachis(s + 0x9e3779b9u); return (float(s >> 8) + 0.5) / 16777216.0; }",
    "float gauss(inout uint s){ float u = unif(s), v = unif(s); return sqrt(-2.0 * log(u)) * cos(6.2831853 * v); }",
    "float gam(float x){ x = clamp(x, 0.0, 1.0); return x <= 0.0031308 ? 12.92 * x : 1.055 * pow(x, 1.0 / 2.4) - 0.055; }",
    "vec3 lire(ivec2 p){ p = clamp(p, ivec2(0), ivec2(uRes - 1)); vec3 c = texelFetch(uA, p, 0).xyz;",
    "  if (uBruit > 0.0 && uK > 0.0) { uint s = hachis(uint(p.x) * 7919u + uint(p.y) * 104729u); c += uVo; vec3 v = max(c * uK, vec3(0.0));",
    "    float y = max(v.y, 1e-12); c *= max(0.0, 1.0 + sqrt(uBruit / y) * gauss(s));",
    "    if (uLect > 0.0) c = max(c + vec3(" + BLANC_CAPTEUR.map(function (v) { return v.toFixed(5); }).join(", ") + ") * (uLect / uK) * gauss(s), vec3(0.0)); }",
    "  return c; }",
    "vec4 lire4(ivec2 p){ p = clamp(p, ivec2(0), ivec2(uRes - 1)); return texelFetch(uA, p, 0); }",
    "void main(){",
    "  vec2 f = gl_FragCoord.xy / uTaille;",
    "  if (uVue.x < 0.0) f.x = 1.0 - f.x;",
    "  if (uVue.y < 0.0) f.y = 1.0 - f.y;",
    "  float ech = float(uRes) / uTaille.x; vec3 c = vec3(0.0);",
    "  if (ech > 1.0) {",
    "    vec2 a = f * float(uRes) - 0.5 * ech; ivec2 i0 = ivec2(floor(a)), i1 = ivec2(ceil(a + ech)) - 1; float nb = 0.0;",
    "    for (int j = 0; j < 8; j++) for (int i = 0; i < 8; i++) { ivec2 p = i0 + ivec2(i, j); if (p.x > i1.x || p.y > i1.y) continue; c += lire(p); nb += 1.0; }",
    "    c /= max(nb, 1.0);",
    "  } else if (uNet == 1) {",
    "    c = lire(ivec2(floor(f * float(uRes))));",
    "  } else {",
    "    vec2 q = f * float(uRes) - 0.5; ivec2 i0 = ivec2(floor(q)); vec2 t = q - floor(q);",
    "    c = mix(mix(lire(i0), lire(i0 + ivec2(1, 0)), t.x), mix(lire(i0 + ivec2(0, 1)), lire(i0 + ivec2(1, 1)), t.x), t.y);",
    "  }",
    // Lissage par densité : là où le texel a reçu moins de uSeuilY rayons, XYZ = moyenne du
    // plus petit carré centré qui en réunit uSeuilY (au plus (2 uLisseY + 1)² texels), texels vides compris : l'aperçu
    // d'une lumière étalée n'est plus un semis de points ; il s'efface quand les rayons s'accumulent. Puis la teinte.
    "  ivec2 pc0 = ivec2(floor(f * float(uRes))); bool vide = false;",
    // carte des comptes par blocs de 8 × 8 texels (uB, uBn × uBn) : aucun rayon dans les 3 × 3 blocs voisins : noir, sans boucle
    "  if (uLisseY > 0) { ivec2 b0 = pc0 / 8; float nb = 0.0; for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) nb += texelFetch(uB, clamp(b0 + ivec2(i, j), ivec2(0), ivec2(uBn - 1)), 0).a; vide = nb == 0.0; }",
    "  if (!vide && (uLisseY > 0 || (uLisse > 0 && c.y > 0.0))) {",
    "    ivec2 pc = pc0; vec4 s = lire4(pc), sT = s; vec3 s1 = vec3(0.0), y0 = s.xyz, y1 = s1, z0 = y0, z1 = y1; float yA = s.a, yIn = 0.0, n0 = s.a, s9 = 0.0; int rY = 0, R = min(max(uLisse, uLisseY), 16);",
    "    bool okT = uLisse == 0 || s.a >= uSeuil, okY = uLisseY == 0 || s.a >= uSeuilY;",
    "    for (int r = 1; r <= 16; r++) {",
    "      if (r > R || (okT && okY)) break;",
    "      vec4 a = vec4(0.0);",
    "      for (int t = -r; t < r; t++) a += lire4(pc + ivec2(t, -r)) + lire4(pc + ivec2(r, t)) + lire4(pc + ivec2(-t, r)) + lire4(pc + ivec2(-r, -t));",
    "      vec3 p0 = s.xyz, p1 = s1; float pA = s.a;",
    "      s += a; s1 += float(r) * a.xyz;",
    "      if (!okT && r <= uLisse) { sT = s; okT = s.a >= uSeuil; }",
    // voisinage immédiat bien rempli (≥ LISSE_Y.d rayons par texel en moyenne sur 3 × 3) : le texel garde sa valeur, même
    // vide (bord net d'une image : sinon une lueur d'un texel) ; on ne lisse que la lumière vraiment clairsemée
    "      if (r == 1) s9 = s.a;",
    "      if (r == 1 && !okY && s.a >= " + (9 * LISSE_Y.d).toFixed(1) + ") okY = true;",
    "      if (!okY && r <= uLisseY) { rY = r; y0 = s.xyz; y1 = s1; yA = s.a; z0 = p0; z1 = p1; yIn = pA; okY = s.a >= uSeuilY; }",
    "    }",
    // noyau en tente sur le carré de rayon rY (poids rY + 1 − r à l'anneau r, qui a 8r texels) : Σ = (rY + 1) Σa − Σ r·a,
    // aire = (rY + 1)(2 rY + 1)² − 8 Σ r² ; sans marches entre deux rayons voisins
    // bord : l'intérieur du carré (rayon rY − 1) a bien moins de rayons que sa part de la densité moyenne (attendu ≥ 4,
    // observé < le quart) : les rayons trouvés sont ceux d'une zone claire voisine, pas un semis ; on lisse sur l'intérieur
    // seulement (noir s'il est vide). Un semis uniforme passe le test (faux bord : un carré un peu plus petit, pas un trou).
    // même test sur le texel lui-même : vide alors que la densité autour dépasse 6 rayons par texel (une chance sur 400 pour
    // une lumière uniforme) : c'est le dehors d'un bord, il reste noir (sinon une frange d'un texel autour d'une image nette)
    // et un carré 3 × 3 entièrement vide alors que la densité autour y prédit au moins 8 rayons : dehors d'un bord, gardé
    // tel quel (un test plus sensible, « vide à côté d'un texel d'au moins 6 rayons », semait des points noirs dans le
    // moyennement rempli : à ces densités, un bord ne se distingue pas du bruit texel par texel)
    "    if (rY > 0) { float A = (2.0 * float(rY) + 1.0) * (2.0 * float(rY) + 1.0);",
    "      if ((n0 == 0.0 && yA >= 6.0 * A) || (rY >= 2 && s9 == 0.0 && yA * 9.0 >= 8.0 * A)) rY = 0; }",
    "    if (rY > 0) { float q = float(rY), e = yA * (2.0 * q - 1.0) * (2.0 * q - 1.0) / ((2.0 * q + 1.0) * (2.0 * q + 1.0));",
    "      if (e >= 4.0 && yIn < 0.25 * e) { q -= 1.0; y0 = z0; y1 = z1; }",
    "      if (q > 0.0) { float m = 2.0 * q + 1.0; c = ((q + 1.0) * y0 - y1) / ((q + 1.0) * m * m - 4.0 * q * (q + 1.0) * m / 3.0); } }",
    "    vec3 t3 = sT.xyz + uMoy * max(uSeuil - sT.a, 0.0);",
    "    if (uLisse > 0 && c.y > 0.0 && t3.y > 0.0) c = t3 * (c.y / t3.y);",
    "  }",
    "  c *= uK;",
    "  if (uMode == 1) { if (uVn > 0) c += voile(f); vec3 v = vision(c, uVis, uBal); o = vec4(gam(v.x), gam(v.y), gam(v.z), 1.0); return; }",
    // photo : hors du capteur (fenêtre carrée, capteur 4:3), rien : ni lumière, ni voile, ni bruit
    "  if (uMode == 2 && (f.x < uCap.x || f.y < uCap.y || f.x > uCap.z || f.y > uCap.w)) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }",
    "  if (uMode == 2) { vec3 q = vec3(3.2406*c.x-1.5372*c.y-0.4986*c.z, -0.9689*c.x+1.8758*c.y+0.0415*c.z, 0.0557*c.x-0.2040*c.y+1.0570*c.z) / uBal;",
    "    q += " + M.BLANC_HG.toFixed(3) + " * max(-q.x, 0.0); o = vec4(gam(q.x), gam(q.y), gam(q.z), 1.0); return; }",
    "  vec3 r = vec3(3.2406*c.x-1.5372*c.y-0.4986*c.z, -0.9689*c.x+1.8758*c.y+0.0415*c.z, 0.0557*c.x-0.2040*c.y+1.0570*c.z) / uBal;",
    "  r += " + M.BLANC_HG.toFixed(3) + " * max(-r.x, 0.0); r = max(r, vec3(0.0));",
    "  if (uComp > 0.0 && uComp < 1.0) { float y = clamp(c.y, 1e-9, 1.0); r = mix(vec3(dot(r, vec3(0.2126, 0.7152, 0.0722))), r, pow(y, SAT_FAIBLE * (1.0 - uComp))) * pow(max(c.y, 1e-9), uComp - 1.0); }",
    "  r = 1.0 - exp(-(r + uFond));",
    "  o = vec4(gam(r.x), gam(r.y), gam(r.z), 1.0);",
    "}"].join("\n");

  // Renvoie null sans WebGL2 ou sans rendu en flottant (EXT_color_buffer_float). opts.sansMelange32 : force le repli.
  // ----- moteur ondulatoire sur la carte (T.onde de creerTraceurGL ; le test GPU). Champs RG32F,
  // intensités R32F. -----
  // Un étage d'une étape d'ondeEtapes le long de uAxe (1 : x, 0 : y). uTab : tableTF(N, inv).data (largeur N, hauteur
  // 3S), uEtage : s. uPremier / uDernier : premier / dernier étage de l'étape (pre lu au premier ; retournement, post,
  // uEch et masque du plan suivant au dernier). Étape sans transformée : uCopie = 1, uPremier = uDernier = 1.
  var FS_ONDE_ETAGE = "#version 300 es\nprecision highp float; precision highp int;\n" + [
    "uniform highp sampler2D uU; uniform highp sampler2D uTab; uniform highp sampler2D uPre; uniform highp sampler2D uPost; uniform highp sampler2D uMasque;",
    "uniform int uAxe, uN, uEtage, uPremier, uDernier, uFlip, uCopie, uAvecPre, uAvecPost, uAvecMasque; uniform float uEch; out vec4 o;",
    "vec2 cm(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }",
    "vec2 lu(ivec2 q, int a) {",
    "  vec2 v = texelFetch(uU, uAxe == 1 ? ivec2(a, q.y) : ivec2(q.x, a), 0).rg;",
    "  if (uPremier == 1 && uAvecPre == 1) v = cm(v, texelFetch(uPre, ivec2(a, 0), 0).rg);",
    "  return v;",
    "}",
    "void main() {",
    "  ivec2 q = ivec2(gl_FragCoord.xy); int p = uAxe == 1 ? q.x : q.y, pp = (uDernier == 1 && uFlip == 1) ? (uN - p) % uN : p; vec2 s;",
    "  if (uCopie == 1) s = lu(q, pp);",
    "  else {",
    "    vec4 ia = texelFetch(uTab, ivec2(pp, 3 * uEtage), 0), c01 = texelFetch(uTab, ivec2(pp, 3 * uEtage + 1), 0), c23 = texelFetch(uTab, ivec2(pp, 3 * uEtage + 2), 0);",
    "    s = cm(c01.xy, lu(q, int(ia.x + 0.5))) + cm(c01.zw, lu(q, int(ia.y + 0.5))) + cm(c23.xy, lu(q, int(ia.z + 0.5))) + cm(c23.zw, lu(q, int(ia.w + 0.5)));",
    "  }",
    "  if (uDernier == 1) {",
    "    if (uAvecPost == 1) s = cm(s, texelFetch(uPost, ivec2(p, 0), 0).rg);",
    "    s *= uEch;",
    "    if (uAvecMasque == 1) s = cm(s, texelFetch(uMasque, q, 0).rg);",
    "  }",
    "  o = vec4(s, 0.0, 1.0);",
    "}"].join("\n");
  // Un lot d'ondeProgramme ajouté à l'accumulateur (va-et-vient : uAcc = l'autre accumulateur). lire() = lireNatif.
  // uNat : grille native réduite (uDim texels, pas uD, décalage uOff) ; uMx : 1 × Ny (marge le long de x) ; uMy :
  // Nx × 1 ; uTot : 1 × 1 ; uStr : strates (n × 1 : dx, dy, k) ; uOrd : ordres (ox, oy, eta) ; uG* : G du programme.
  var FS_ONDE_LECTURE = "#version 300 es\nprecision highp float; precision highp int;\n" + [
    "uniform highp sampler2D uAcc; uniform highp sampler2D uNat; uniform highp sampler2D uMx; uniform highp sampler2D uMy; uniform highp sampler2D uTot; uniform highp sampler2D uStr;",
    "uniform vec2 uGo, uGu, uGv, uD, uOff, uBoite, uC; uniform ivec2 uDim; uniform int uNs, uNord, uGauss; uniform vec3 uOrd[7]; uniform vec3 uF; uniform float uH, uW2, uAlpha; out vec4 o;",
    "float rampe(float t) { t = clamp(t, -1.0, 1.0); return t < 0.0 ? 0.5 * (1.0 + t) * (1.0 + t) : 1.0 - 0.5 * (1.0 - t) * (1.0 - t); }",
    "float c1(float c, float w, float x, float d) { return rampe((c + w / 2.0 - x) / d) - rampe((c - w / 2.0 - x) / d); }",
    "float I(int x, int y) { return (x >= 0 && x < uDim.x && y >= 0 && y < uDim.y) ? texelFetch(uNat, ivec2(x, y), 0).r : 0.0; }",
    "float MX(int y) { return (y >= 0 && y < uDim.y) ? texelFetch(uMx, ivec2(0, y), 0).r : 0.0; }",
    "float MY(int x) { return (x >= 0 && x < uDim.x) ? texelFetch(uMy, ivec2(x, 0), 0).r : 0.0; }",
    "float lire(vec2 g) {",
    "  if (uGauss == 1) { vec2 dd = g - uC; return 2.0 / (3.14159265358979 * uW2) * exp(-2.0 * dot(dd, dd) / uW2); }",
    "  float bx = uBoite.x > 0.0 ? c1(0.0, uBoite.x, g.x, uH) / uBoite.x : 0.0, by = uBoite.y > 0.0 ? c1(0.0, uBoite.y, g.y, uH) / uBoite.y : 0.0;",
    "  if (uBoite.x > 0.0 && uBoite.y > 0.0) return texelFetch(uTot, ivec2(0, 0), 0).r * bx * by;",
    "  float tx = (g.x - uOff.x) / uD.x + float(uDim.x / 2), ty = (g.y - uOff.y) / uD.y + float(uDim.y / 2);",
    "  int x0 = int(floor(tx)), y0 = int(floor(ty)); float fx = tx - float(x0), fy = ty - float(y0);",
    "  if (uBoite.y > 0.0) return (MY(x0) * (1.0 - fx) + MY(x0 + 1) * fx) * by;",
    "  if (uBoite.x > 0.0) return (MX(y0) * (1.0 - fy) + MX(y0 + 1) * fy) * bx;",
    "  return (I(x0, y0) * (1.0 - fx) + I(x0 + 1, y0) * fx) * (1.0 - fy) + (I(x0, y0 + 1) * (1.0 - fx) + I(x0 + 1, y0 + 1) * fx) * fy;",
    "}",
    "void main() {",
    "  vec2 g = uGo + gl_FragCoord.x * uGu + gl_FragCoord.y * uGv; float s = 0.0;",
    "  for (int i = 0; i < uNs; i++) {",
    "    vec4 st = texelFetch(uStr, ivec2(i, 0), 0); float t = 0.0;",
    "    for (int m = 0; m < uNord; m++) t += uOrd[m].z * lire(g - st.xy - uOrd[m].xy);",
    "    s += st.z * t;",
    "  }",
    "  o = texelFetch(uAcc, ivec2(gl_FragCoord.xy), 0) + vec4(uF * s, uAlpha);",
    "}"].join("\n");
  // Départ d'une propagation : u = uK · E(p) · rx[(mx (i + Nx/2)) mod Nx] · ry[(my (j + Ny/2)) mod Ny] (inclinaison de la
  // source en entiers : (i − N/2) ≡ (i + N/2) mod N ; uMx, uMy déjà ramenés dans [0, N) : % de GLSL indéfini sur un négatif).
  var FS_ONDE_DEPART = "#version 300 es\nprecision highp float; precision highp int;\n" + [
    "uniform highp sampler2D uE; uniform highp sampler2D uRx; uniform highp sampler2D uRy; uniform int uMx, uMy, uNx, uNy; uniform float uK; out vec4 o;",
    "vec2 cm(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }",
    "void main() {",
    "  ivec2 q = ivec2(gl_FragCoord.xy); vec2 v = uK * texelFetch(uE, q, 0).rg;",
    "  if (uMx != 0) v = cm(v, texelFetch(uRx, ivec2((uMx * ((q.x + uNx / 2) % uNx)) % uNx, 0), 0).rg);",
    "  if (uMy != 0) v = cm(v, texelFetch(uRy, ivec2((uMy * ((q.y + uNy / 2) % uNy)) % uNy, 0), 0).rg);",
    "  o = vec4(v, 0.0, 1.0);",
    "}"].join("\n");
  // Intensité moyenne |u|² sur les blocs uR.x × uR.y (natif).
  var FS_ONDE_NATIF = "#version 300 es\nprecision highp float; precision highp int;\n" + [
    "uniform highp sampler2D uU; uniform ivec2 uR; out vec4 o;",
    "void main() {",
    "  ivec2 q = ivec2(gl_FragCoord.xy) * uR; float s = 0.0;",
    "  for (int j = 0; j < uR.y; j++) for (int i = 0; i < uR.x; i++) { vec2 v = texelFetch(uU, q + ivec2(i, j), 0).rg; s += dot(v, v); }",
    "  o = vec4(s / float(uR.x * uR.y), 0.0, 0.0, 1.0);",
    "}"].join("\n");
  // Somme le long d'un axe (uAxe 1 : x, sortie 1 × Ny ; 0 : y, sortie Nx × 1), fois uK : marges et total de natif.
  var FS_ONDE_SOMME = "#version 300 es\nprecision highp float; precision highp int;\n" + [
    "uniform highp sampler2D uI; uniform int uAxe, uN; uniform float uK; out vec4 o;",
    "void main() {",
    "  ivec2 q = ivec2(gl_FragCoord.xy); float s = 0.0;",
    "  for (int k = 0; k < uN; k++) s += texelFetch(uI, uAxe == 1 ? ivec2(k, q.y) : ivec2(q.x, k), 0).r;",
    "  o = vec4(s * uK, 0.0, 0.0, 1.0);",
    "}"].join("\n");

  function creerTraceurGL(canvas, opts) {
    opts = opts || {};
    var gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    if (!gl || !gl.getExtension("EXT_color_buffer_float")) return null;
    var blend32 = !opts.sansMelange32 && !!gl.getExtension("EXT_float_blend");
    function sh(t, src) {
      var x = gl.createShader(t); gl.shaderSource(x, src); gl.compileShader(x);
      if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x));
      return x;
    }
    function prog(vs, fs) {
      var p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(p, 0, "a"); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      var U = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (var i = 0; i < n; i++) { var nom = gl.getActiveUniform(p, i).name; U[nom.replace("[0]", "")] = gl.getUniformLocation(p, nom); }
      return { p: p, U: U };
    }
    var PT = prog(VS_TRACE, FS_POINT), PA = prog(VS_QUAD, FS_AFF), PC = prog(VS_QUAD, FS_AJOUT), PM = prog(VS_QUAD, FS_MOY), cMoy = null, cRed = null, PH = null, cHisto = null;
    var vaoPts = gl.createVertexArray(), vaoQuad = gl.createVertexArray();
    gl.bindVertexArray(vaoQuad);
    var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    function tex() {
      var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }
    function cible(fmt, r) {
      var t = tex(); gl.texImage2D(gl.TEXTURE_2D, 0, fmt, r, r, 0, gl.RGBA, fmt === gl.RGBA16F ? gl.HALF_FLOAT : gl.FLOAT, null);
      var fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      return { t: t, fb: fb };
    }
    var tSeq = tex(), acc = [], tmp = null, res = 0, cour = 0, npasses = 0, accB = null, fbAB = null, f32 = null, tDia = tex(), verDia = -1, tVoile = tex(), nVoile = 0;
    // voile du halo : n × n éléments XYZ en cd/m² (Float32Array de 3n²), unité de texture 3 ; null : aucun
    function voile(d, n) {
      if (!d) { nVoile = 0; return; }
      var b = new Float32Array(4 * n * n); for (var i = 0; i < n * n; i++) { b[4 * i] = d[3 * i]; b[4 * i + 1] = d[3 * i + 1]; b[4 * i + 2] = d[3 * i + 2]; }
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, tVoile);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, n, n, 0, gl.RGBA, gl.FLOAT, b); gl.activeTexture(gl.TEXTURE0); nVoile = n;
    }
    function texDiapos() {                 // images des diapos, unité de texture 2, rechargées quand le registre change
      if (verDia === DIAPOS.version) return;
      verDia = DIAPOS.version;
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tDia); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      if (DIAPOS.n) gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, DIAPOS.n, DIAPOS.n * DIAPO_NOMS.length, 0, gl.RED, gl.UNSIGNED_BYTE, DIAPOS.octets);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([255]));
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4); gl.activeTexture(gl.TEXTURE0);
    }
    // visée guidée : tables de seq.guide (prob, alias, iq), unité de texture 5, rechargées quand le guide change
    var tGuide = tex(), guideCharge = null, verGuide = -1;
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, tGuide);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array(4)); gl.activeTexture(gl.TEXTURE0);
    function texGuide(G) {
      if (!G || (G === guideCharge && G.version === verGuide)) return;
      guideCharge = G; verGuide = G.version;
      var nb = G.n, b = new Float32Array(4 * nb * nb * GUIDE_SITES);
      G.t.forEach(function (T, s) {
        if (!T || s >= GUIDE_SITES) return;
        for (var i = 0, m = T.n; i < m * m; i++) { var o = 4 * ((s * nb + Math.floor(i / m)) * nb + i % m); b[o] = T.prob[i]; b[o + 1] = T.alias[i]; b[o + 2] = T.iq[i]; }
      });
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, tGuide);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, nb, nb * GUIDE_SITES, 0, gl.RGBA, gl.FLOAT, b); gl.activeTexture(gl.TEXTURE0);
    }
    var airy4 = new Float32Array(AIRY), eta4 = new Float32Array([ETA_RESEAU[0], ETA_RESEAU[1], ETA_RESEAU[2], ETA_RESEAU[3]]);
    function liberer(c) { if (c) { gl.deleteTexture(c.t); gl.deleteFramebuffer(c.fb); } }
    function dimensionner(r) {
      if (r === res) return;
      res = r; acc.forEach(liberer); liberer(tmp); libererB();
      acc = [cible(gl.RGBA32F, r), cible(gl.RGBA32F, r)];
      tmp = blend32 ? null : cible(gl.RGBA16F, r);
      raz();
    }
    function raz() {
      for (var i = 0; i < acc.length; i++) { gl.bindFramebuffer(gl.FRAMEBUFFER, acc[i].fb); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
      if (accB) { gl.bindFramebuffer(gl.FRAMEBUFFER, accB.fb); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
      npasses = 0; cour = 0; npB = 0;
    }
    // Accumulateur B : une passe `voieB` y dépose AUSSI ses rayons (seconde sortie de
    // FS_POINT, tampon à deux attachements fbAB[cour]) ; total − B = les autres passes. Mélange 32 bits seulement.
    var npB = 0;
    function libererB() {
      if (!accB) return;
      liberer(accB); fbAB.forEach(function (f) { gl.deleteFramebuffer(f); }); accB = fbAB = null; npB = 0;
    }
    function preparerB() {
      if (accB) return;
      accB = cible(gl.RGBA32F, res); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      fbAB = acc.map(function (a) {
        var fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, a.t, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, accB.t, 0);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
        return fb;
      });
    }
    // Séquence en texture et uniformes du tracé (programme P).
    function regler(P, seq, emb, rendu, ech) {
      var n = emb.n;
      if (!f32 || f32.length < emb.donnees.length) f32 = new Float32Array(emb.donnees.length);
      f32.set(emb.donnees);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tSeq);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 8, Math.max(n + emb.nb, 1), 0, gl.RGBA, gl.FLOAT, f32, 0);
      var S = sourceGPU(seq), U = P.U;
      gl.useProgram(P.p); gl.bindVertexArray(vaoPts);
      gl.uniform1i(U.uSeq, 0); gl.uniform1i(U.uNp, n); gl.uniform1i(U.uNr, rendu.Nr);
      texDiapos(); gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tDia); gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(U.uDia, 2); gl.uniform1i(U.uDiaN, DIAPOS.n);
      var G = seq.guide, gn = [0, 0, 0, 0];
      if (G) for (var s = 0; s < GUIDE_SITES; s++) gn[s] = G.t[s] ? G.t[s].n : 0;
      texGuide(G); gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, tGuide); gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(U.uGd, 5); gl.uniform4iv(U.uGn, gn); gl.uniform1i(U.uGb, G ? G.n : 1); gl.uniform1f(U.uGa, G ? G.alpha : 0);
      gl.uniform1i(U.uHs, -1); gl.uniform1i(U.uHn, 1); gl.uniform1i(U.uHgN, 0); gl.uniform1i(U.uHg, 6);
      gl.uniform1ui(U.uGraine, (rendu.graine || 1) >>> 0); gl.uniform1ui(U.uPasse, (rendu.passe || 0) >>> 0);
      gl.uniform1i(U.uSrc, S.forme); gl.uniform3fv(U.uSO, S.O); gl.uniform3fv(U.uSX, S.X); gl.uniform3fv(U.uSY, S.Y); gl.uniform3fv(U.uSZ, S.Z);
      gl.uniform4fv(U.uSdim, S.dim); gl.uniform3fv(U.uFil, S.fil); gl.uniform4fv(U.uCible, S.cible); gl.uniform1f(U.uCibleL, S.cibleL); gl.uniform1f(U.uLum, S.L);
      gl.uniform1i(U.uSpT, S.spType); gl.uniform4fv(U.uSpC, S.spC); gl.uniform1i(U.uNl, S.nl);
      gl.uniform4fv(U.uSpL, S.l); gl.uniform4fv(U.uSpCum, S.cum); gl.uniform2fv(U.uVerre, S.verre); gl.uniform4fv(U.uSpQ, new Float32Array(S.Q));
      gl.uniform1i(U.uJones, seq.jones ? 1 : 0); gl.uniform4fv(U.uAiry, airy4); gl.uniform4fv(U.uEta, eta4);
      gl.uniform4f(U.uFen, rendu.cx || 0, rendu.cy || 0, rendu.W, ech);
      gl.uniform1i(U.uMode, S.mode); gl.uniform1i(U.uDe, S.de); gl.uniform1i(U.uNb, emb.nb || 0); gl.uniform4fv(U.uObj, S.obj); gl.uniform4fv(U.uSuiv, S.suiv);
      var sp = rendu.spe;
      if (sp) { gl.uniform4f(U.uSpe, sp.x, sp.y, sp.r * sp.r, casesSpectre(seq, sp)); gl.uniform3f(U.uSpeL, sp.la, sp.lb, 2 / rendu.res); }
      else { gl.uniform4f(U.uSpe, 0, 0, 0, 0); gl.uniform3f(U.uSpeL, 0, 1, 0); }
    }
    // Une passe de rendu.Nr rayons (graine, passe) cumulée dans l'accumulateur ; emb = emballer(seq).
    // L'accumulateur B est créé (preparerB) AVANT regler : créer une texture la lie à l'unité active, la 0, celle de
    // la séquence (tSeq) ; créé après, la passe lisait une séquence vide et ne déposait rien, ses rayons comptés quand
    // même : première passe fine perdue à chaque image (baisse brève de luminosité), moitié B de l'adaptation vide.
    function passe(seq, emb, rendu) {
      dimensionner(rendu.res);
      if (blend32 && rendu.voieB) preparerB();
      var U = PT.U, ech = blend32 ? 1 : 1 / poidsType(seq);
      regler(PT, seq, emb, rendu, ech);
      gl.viewport(0, 0, res, res);
      gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE);
      if (blend32) {
        var voieB = !!rendu.voieB;
        if (voieB) npB++;
        gl.bindFramebuffer(gl.FRAMEBUFFER, voieB ? fbAB[cour] : acc[cour].fb);
        // par tranches de 2^22 rayons (un seul dessin de 2^25 points dépasse le délai du pilote : écran noir, contexte réinitialisé)
        for (var c0 = 0; c0 < rendu.Nr; c0 += 4194304) {
          gl.uniform1i(U.uBase, c0); gl.drawArrays(gl.POINTS, 0, Math.min(4194304, rendu.Nr - c0));
          if (c0 + 4194304 < rendu.Nr) gl.flush();
        }
        gl.disable(gl.BLEND);
      } else {
        var CH = 16384;
        for (var b0 = 0; b0 < rendu.Nr; b0 += CH) {
          gl.useProgram(PT.p); gl.bindVertexArray(vaoPts);
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tSeq);
          gl.bindFramebuffer(gl.FRAMEBUFFER, tmp.fb); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
          gl.enable(gl.BLEND); gl.uniform1i(U.uBase, b0); gl.drawArrays(gl.POINTS, 0, Math.min(CH, rendu.Nr - b0)); gl.disable(gl.BLEND);
          gl.useProgram(PC.p); gl.bindVertexArray(vaoQuad);
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, acc[cour].t); gl.uniform1i(PC.U.uAcc, 0);
          gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tmp.t); gl.uniform1i(PC.U.uTmp, 1); gl.uniform1f(PC.U.uInv, 1 / ech);
          gl.bindFramebuffer(gl.FRAMEBUFFER, acc[1 - cour].fb); gl.drawArrays(gl.TRIANGLES, 0, 3);
          gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, null); gl.activeTexture(gl.TEXTURE0);
          cour = 1 - cour;
        }
      }
      gl.bindVertexArray(null);
      npasses++;
    }
    // Passe pilote de la visée guidée : pour chaque site de o.sites, un tracé des
    // rendu.Nr rayons (ceux de passe(), guide déjà posé dans seq compris) range Σ y, Σ y² et le nombre des rayons
    // détectés dans la fenêtre dans la case (u, v) du site, cible n × n par site (o.n, défaut GUIDE.n) ; o.efface : cible
    // remise à zéro d'abord. Un tracé par site (un sommet n'a qu'une position) : coût = sites × une passe. L'accumulateur
    // de l'image n'est pas touché. Relu par lireGuide. Mélange 32 bits seulement (false sinon).
    var cHg = null, tHg = null;
    function histoGuide(seq, emb, rendu, o) {
      if (!blend32) return false;
      o = o || {};
      var n = o.n || GUIDE.n, U = PT.U;
      if (!cHg || cHg.n !== n) {
        if (cHg) liberer(cHg);
        var t = tex(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, n, n * GUIDE_SITES, 0, gl.RGBA, gl.FLOAT, null);
        var fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
        cHg = { t: t, fb: fb, n: n }; o.efface = true;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, cHg.fb);
      if (o.efface) { gl.viewport(0, 0, n, n * GUIDE_SITES); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
      regler(PT, seq, emb, rendu, 1); gl.uniform1i(U.uHn, n);
      if (o.poids) {           // poids par zone de la fenêtre (o.poids : Float32Array m × m, ligne 0 en bas), unité 6
        var m = Math.round(Math.sqrt(o.poids.length));
        gl.activeTexture(gl.TEXTURE6);       // avant tex(), qui lie sur l'unité active (la 0 : la séquence)
        if (!tHg) tHg = tex();
        gl.bindTexture(gl.TEXTURE_2D, tHg); gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, m, m, 0, gl.RED, gl.FLOAT, o.poids);
        gl.activeTexture(gl.TEXTURE0); gl.uniform1i(U.uHgN, m);
      } else if (tHg) { gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, tHg); gl.activeTexture(gl.TEXTURE0); }
      gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE);
      (o.sites || [0, 1]).forEach(function (site) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, cHg.fb); gl.viewport(0, site * n, n, n); gl.uniform1i(U.uHs, site);
        for (var c0 = 0; c0 < rendu.Nr; c0 += 4194304) {
          gl.uniform1i(U.uBase, c0); gl.drawArrays(gl.POINTS, 0, Math.min(4194304, rendu.Nr - c0));
          if (c0 + 4194304 < rendu.Nr) gl.flush();
        }
      });
      gl.disable(gl.BLEND); gl.uniform1i(U.uHs, -1); gl.bindVertexArray(null);
      return true;
    }
    // {histos (Σ y par case et par site, null pour un site jamais tracé), carres (Σ y² par site), n, utiles (rayons
    // détectés dans la fenêtre au site 0, consommé par tous)} : même forme que guideHistos du processeur.
    function lireGuide(sites) {
      if (!cHg) return null;
      var n = cHg.n, b = new Float32Array(4 * n * n * GUIDE_SITES), H = { histos: [], carres: [], n: n, utiles: 0 };
      gl.bindFramebuffer(gl.FRAMEBUFFER, cHg.fb); gl.readPixels(0, 0, n, n * GUIDE_SITES, gl.RGBA, gl.FLOAT, b);
      for (var s = 0; s < GUIDE_SITES; s++) {
        var h = null, c = 0;
        if (!sites || sites.indexOf(s) >= 0) {
          h = new Float64Array(n * n);
          for (var i = 0; i < n * n; i++) { var o = 4 * (s * n * n + i); h[i] = b[o]; c += b[o + 1]; if (s === 0) H.utiles += b[o + 3]; }
        }
        H.histos.push(h); H.carres.push(c);
      }
      return H;
    }
    // Test : impacts rayon par rayon (x, y, poids × Y, 1000 si détecté sinon indice de la primitive d'arrêt), sans dessin.
    var PF = null;
    function rayons(seq, emb, rendu) {
      if (!PF) {
        var p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS_TRACE)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS_POINT));
        gl.transformFeedbackVaryings(p, ["vImp"], gl.INTERLEAVED_ATTRIBS); gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
        var U = {}, nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
        for (var i = 0; i < nu; i++) { var nom = gl.getActiveUniform(p, i).name; U[nom.replace("[0]", "")] = gl.getUniformLocation(p, nom); }
        PF = { p: p, U: U };
      }
      regler(PF, seq, emb, rendu, 1); gl.uniform1i(PF.U.uBase, 0);
      var buf = gl.createBuffer(), tf = gl.createTransformFeedback(), out = new Float32Array(rendu.Nr * 4);
      gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, buf); gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, out.byteLength, gl.STREAM_READ);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tf); gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, buf);
      gl.enable(gl.RASTERIZER_DISCARD); gl.beginTransformFeedback(gl.POINTS); gl.drawArrays(gl.POINTS, 0, rendu.Nr);
      gl.endTransformFeedback(); gl.disable(gl.RASTERIZER_DISCARD);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null); gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
      gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, buf); gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, out);
      gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, null); gl.deleteBuffer(buf); gl.deleteTransformFeedback(tf); gl.bindVertexArray(null);
      return out;
    }
    function finir() { var px = new Float32Array(4); gl.bindFramebuffer(gl.FRAMEBUFFER, acc[cour].fb); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, px); }
    // Sommes Σ poids × XYZ par pixel (toutes passes), ligne 0 en BAS (comme passeCPU). lire(j0, h) : les seules lignes
    // j0 à j0 + h − 1 (barrette de l'instrument), même disposition. cpt (tableau de res × h, facultatif) : y range le
    // nombre de rayons reçus par texel (alpha de l'accumulateur).
    function lire(j0, h, cpt) {
      j0 = j0 || 0; h = h || res;
      var b = new Float32Array(res * h * 4), out = new Float64Array(res * h * 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, acc[cour].fb); gl.readPixels(0, j0, res, h, gl.RGBA, gl.FLOAT, b);
      for (var i = 0; i < res * h; i++) { out[3 * i] = b[4 * i]; out[3 * i + 1] = b[4 * i + 1]; out[3 * i + 2] = b[4 * i + 2]; if (cpt) cpt[i] = b[4 * i + 3]; }
      return out;
    }
    // Même disposition que lire(), accumulateur B (passes `voieB`) ; null sans lui.
    function lireB() {
      if (!accB || !npB) return null;
      var b = new Float32Array(res * res * 4), out = new Float64Array(res * res * 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, accB.fb); gl.readPixels(0, 0, res, res, gl.RGBA, gl.FLOAT, b);
      for (var i = 0; i < res * res; i++) { out[3 * i] = b[4 * i]; out[3 * i + 1] = b[4 * i + 1]; out[3 * i + 2] = b[4 * i + 2]; }
      return out;
    }
    // Pixels du canevas tels qu'affichés (RGBA 8 bits), à lire juste après `afficher` (même tâche) : arrêt sur l'image
    // stable du moteur (`finVisible`).
    function lireEcran() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      var px = new Uint8Array(4 * canvas.width * canvas.height); gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px;
    }
    // Bruit relatif mesuré (A = total − B, B = passes `voieB` ; autant de passes de chaque côté) : médiane de
    // 1,2533 |A − B| / (A + B) sur les texels clairs (> 30 % du 99e centile) et faibles (3 à 30 %), comme
    // un script de mesure. Rend {clair, faible, nClair, nFaible} (médianes null sans texel) ; null sans B.
    var PB = null, cBr = null;
    function bruit() {
      if (!accB || !npB || !blend32) return null;
      var haut = centile(0.99), o = { clair: null, faible: null, nClair: 0, nFaible: 0, haut: haut };
      if (!(haut > 0)) return o;
      if (!PB) PB = prog(VS_BRUIT, FS_UN);
      var lignes = 2 * BRUIT_NB / 64;
      if (!cBr) { var t = tex(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 64, lignes, 0, gl.RGBA, gl.FLOAT, null); var fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); cBr = { t: t, fb: fb }; }
      gl.bindFramebuffer(gl.FRAMEBUFFER, cBr.fb); gl.viewport(0, 0, 64, lignes); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(PB.p); gl.bindVertexArray(vaoPts);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, acc[cour].t); gl.uniform1i(PB.U.uA, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, accB.t); gl.uniform1i(PB.U.uB, 1);
      gl.uniform1i(PB.U.uRes, res); gl.uniform1f(PB.U.uHaut, haut);
      gl.drawArrays(gl.POINTS, 0, res * res); gl.disable(gl.BLEND); gl.bindVertexArray(null);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, null); gl.activeTexture(gl.TEXTURE0);
      var b = new Float32Array(4 * 64 * lignes); gl.readPixels(0, 0, 64, lignes, gl.RGBA, gl.FLOAT, b);
      [0, 1].forEach(function (c) {
        var n = 0, i, k0 = c * BRUIT_NB;
        for (i = 0; i < BRUIT_NB; i++) n += b[4 * (k0 + i)];
        if (c) o.nFaible = n; else o.nClair = n;
        if (!(n > 0)) return;
        var r = 0.5 * (n - 1), cu = 0;
        for (i = 0; i < BRUIT_NB; i++) {
          var m = b[4 * (k0 + i)];
          if (m > 0 && cu + m > r) { var v = Math.pow(2, BRUIT_LO + (i + (r - cu + 0.5) / m) / BRUIT_OCT); if (c) o.faible = v; else o.clair = v; return; }
          cu += m;
        }
      });
      return o;
    }
    // Sommes par blocs de l'accumulateur sur une cible n × n (RGBA : Σ XYZ, nombre de rayons), lues d'un coup.
    function blocs(n) {
      if (!cRed || cRed.n !== n) { liberer(cRed); cRed = cible(gl.RGBA32F, n); cRed.n = n; }
      gl.bindFramebuffer(gl.FRAMEBUFFER, cRed.fb); gl.viewport(0, 0, n, n); gl.disable(gl.BLEND);
      gl.useProgram(PM.p); gl.bindVertexArray(vaoQuad);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, acc[cour].t); gl.uniform1i(PM.U.uA, 0); gl.uniform1i(PM.U.uRes, res); gl.uniform1i(PM.U.uN, n);
      gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindVertexArray(null);
      var b = new Float32Array(4 * n * n); gl.readPixels(0, 0, n, n, gl.RGBA, gl.FLOAT, b);
      return b;
    }
    // [Σ X, Σ Y, Σ Z, nombre de rayons] de tout l'accumulateur.
    function sommes() {
      var b = blocs(16), o = [0, 0, 0, 0];
      for (var i = 0; i < 1024; i++) o[i & 3] += b[i];
      return o;
    }
    // Carte des comptes par blocs de 8 × 8 texels pour le lissage de l'affichage (texture, sans relecture), unité 4.
    var cBl = null;
    function carteBlocs() {
      var n = Math.ceil(res / 8);
      if (!cBl || cBl.n !== n) { liberer(cBl); cBl = cible(gl.RGBA32F, n); cBl.n = n; }
      gl.bindFramebuffer(gl.FRAMEBUFFER, cBl.fb); gl.viewport(0, 0, n, n); gl.disable(gl.BLEND);
      gl.useProgram(PM.p); gl.bindVertexArray(vaoQuad);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, acc[cour].t); gl.uniform1i(PM.U.uA, 0); gl.uniform1i(PM.U.uRes, res); gl.uniform1i(PM.U.uN, n);
      gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindVertexArray(null);
      return n;
    }
    // Image réduite à n × n (n divise la résolution) : Σ XYZ par bloc de (res / n)² texels, ligne 0 en BAS (comme lire) ;
    // cpt (facultatif) : nombre de rayons par bloc.
    function reduire(n, cpt) {
      var b = blocs(n), out = new Float64Array(3 * n * n);
      for (var i = 0; i < n * n; i++) { out[3 * i] = b[4 * i]; out[3 * i + 1] = b[4 * i + 1]; out[3 * i + 2] = b[4 * i + 2]; if (cpt) cpt[i] = b[4 * i + 3]; }
      return out;
    }
    // Centile q de Y sur les texels éclairés (Y > 0), en unités de l'accumulateur, par l'histogramme logarithmique
    // (interpolé dans sa case : 4 % de largeur) ; même rang que le tri du processeur (⌊q (n − 1)⌋). Sans mélange en
    // flottant 32 bits : relecture et tri (les comptes d'une case dépassent la précision du demi-flottant).
    function centile(q) {
      if (!blend32) {
        var img = lire(), ys = [];
        for (var k = 1; k < img.length; k += 3) if (img[k] > 0) ys.push(img[k]);
        ys.sort(function (a, b) { return a - b; });
        return ys.length ? ys[Math.floor(q * (ys.length - 1))] : 0;
      }
      if (!PH) PH = prog(VS_HISTO, FS_UN);
      if (!cHisto) cHisto = cible(gl.RGBA32F, 64);
      gl.bindFramebuffer(gl.FRAMEBUFFER, cHisto.fb); gl.viewport(0, 0, 64, 64); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(PH.p); gl.bindVertexArray(vaoPts);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, acc[cour].t); gl.uniform1i(PH.U.uA, 0); gl.uniform1i(PH.U.uRes, res);
      gl.drawArrays(gl.POINTS, 0, res * res); gl.disable(gl.BLEND); gl.bindVertexArray(null);
      var b = new Float32Array(4 * NB_HISTO), n = 0, i; gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.FLOAT, b);
      for (i = 0; i < NB_HISTO; i++) n += b[4 * i];
      if (!(n > 0)) return 0;
      var r = Math.floor(q * (n - 1)), c = 0;
      for (i = 0; i < NB_HISTO; i++) {
        var m = b[4 * i];
        if (m > 0 && c + m > r) return Math.pow(2, HISTO_LO + (i + (r - c + 0.5) / m) / HISTO_OCT);
        c += m;
      }
      return 0;
    }
    // o = { moy (XYZ moyen par rayon, teinte de repli du lissage), lisse (rayon maximal du lissage de teinte, en texels), seuil (rayons à réunir, défaut 256), K (XYZ cumulé → affiché : exposition / (rayons × aire du pixel)), bal, vue: [su, sv], comp, fond: [r, g, b], net, vision (parametresVision : K donne alors des cd/m²) }
    function afficher(o) {
      var nBl = o.lisseY ? carteBlocs() : 0;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(PA.p); gl.bindVertexArray(vaoQuad);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, acc[cour].t);
      var U = PA.U, bal = o.bal || [1, 1, 1], fond = o.fond || [0, 0, 0], vue = o.vue || [1, 1];
      gl.uniform1i(U.uA, 0); gl.uniform1i(U.uRes, res); gl.uniform2f(U.uTaille, canvas.width, canvas.height); gl.uniform1f(U.uK, o.K);
      gl.uniform3f(U.uBal, bal[0], bal[1], bal[2]); gl.uniform2f(U.uVue, vue[0], vue[1]); gl.uniform1f(U.uComp, o.comp || 1);
      gl.uniform3f(U.uFond, fond[0], fond[1], fond[2]); gl.uniform1i(U.uNet, o.net ? 1 : 0); gl.uniform1i(U.uLisse, o.lisse | 0); gl.uniform1f(U.uSeuil, o.seuil || 256); gl.uniform1i(U.uLisseY, o.lisseY | 0); gl.uniform1f(U.uSeuilY, o.seuilY || 48);
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, nBl ? cBl.t : tVoile); gl.uniform1i(U.uB, 4); gl.uniform1i(U.uBn, Math.max(nBl, 1)); gl.activeTexture(gl.TEXTURE0); var moy = o.moy || [0, 0, 0]; gl.uniform3f(U.uMoy, moy[0], moy[1], moy[2]); gl.uniform1f(U.uBruit, o.bruit || 0);
      var ph = o.photo; gl.uniform1f(U.uLect, ph ? ph.lect || 0 : 0); gl.uniform3f(U.uVo, ph && ph.voile ? ph.voile[0] : 0, ph && ph.voile ? ph.voile[1] : 0, ph && ph.voile ? ph.voile[2] : 0); var cap = ph && ph.cap ? ph.cap : [0, 0, 1, 1]; gl.uniform4f(U.uCap, cap[0], cap[1], cap[2], cap[3]);
      var vis = o.vision; gl.uniform1i(U.uMode, vis ? 1 : ph ? 2 : 0); gl.uniform4f(U.uVis, vis ? vis[0] : 0, vis ? vis[1] : 1, vis ? vis[2] : 1, vis ? vis[3] : -1);
      var vg = vis && nVoile && o.voile ? o.voile : null;
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, tVoile); gl.uniform1i(U.uV, 3); gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(U.uVn, vg ? nVoile : 0); gl.uniform4f(U.uVg, vg ? vg[0] : 1, vg ? vg[1] : 1, vg ? vg[2] : 0, vg ? vg[3] : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
    }
    function effacer() { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }

    // ----- moteur ondulatoire : le processeur décide (ondeProgramme, ondeEtapes,
    // tableTF, eclairageBase, tPlan), la carte exécute les mêmes lots dans le même ordre. Textures d'un plan dans
    // plan.gl, libérées quand T.onde voit un autre plan ; accumulation par va-et-vient (pas de mélange en flottant).
    var PO = null, vide = null, TAB = {}, RAC = {}, planGL = null, pool = {}, FMT = null;
    function progO(fs) {
      var P = prog(VS_QUAD, fs), n = gl.getProgramParameter(P.p, gl.ACTIVE_UNIFORMS); P.S = [];
      for (var i = 0; i < n; i++) { var u = gl.getActiveUniform(P.p, i); if (u.type === gl.SAMPLER_2D) P.S.push(u.name); }
      return P;
    }
    function texF(nc, w, h, data) {        // nc composantes (1, 2 ou 4) en flottants 32 bits
      if (!FMT) FMT = { 1: [gl.R32F, gl.RED], 2: [gl.RG32F, gl.RG], 4: [gl.RGBA32F, gl.RGBA] };
      gl.activeTexture(gl.TEXTURE0); var t = tex();
      gl.texImage2D(gl.TEXTURE_2D, 0, FMT[nc][0], w, h, 0, FMT[nc][1], gl.FLOAT, data || null);
      return t;
    }
    function progsOnde() {
      if (PO) return PO;
      PO = { dep: progO(FS_ONDE_DEPART), et: progO(FS_ONDE_ETAGE), nat: progO(FS_ONDE_NATIF), som: progO(FS_ONDE_SOMME), lec: progO(FS_ONDE_LECTURE) };
      vide = texF(4, 1, 1, new Float32Array(4));
      return PO;
    }
    function cibleF(nc, w, h) {            // texture rendable ; les temporaires reviennent au pool (rendre)
      var cle = nc + "|" + w + "|" + h, l = pool[cle];
      if (l && l.length) return l.pop();
      var t = texF(nc, w, h, null), fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      return { t: t, fb: fb, w: w, h: h, cle: cle };
    }
    function rendre(c) { if (c) (pool[c.cle] || (pool[c.cle] = [])).push(c); }
    function rendreNat(n) { rendre(n.I); rendre(n.mx); rendre(n.my); rendre(n.tot); }
    function libererNat(n) { liberer(n.I); liberer(n.mx); liberer(n.my); liberer(n.tot); }
    function rg(re, im) { var n = re.length, o = new Float32Array(2 * n); for (var q = 0; q < n; q++) { o[2 * q] = re[q]; o[2 * q + 1] = im[q]; } return o; }
    // Une passe plein cadre du programme P vers la cible c ; tout échantillonneur du programme reçoit une texture (sinon
    // l'unité 0 par défaut pourrait être la cible elle-même : boucle de rétroaction refusée par WebGL).
    function dessiner(P, c, texs, unis) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, c.fb); gl.viewport(0, 0, c.w, c.h); gl.disable(gl.BLEND);
      gl.useProgram(P.p); gl.bindVertexArray(vaoQuad);
      var k;
      for (k = 0; k < P.S.length; k++) { gl.activeTexture(gl.TEXTURE0 + k); gl.bindTexture(gl.TEXTURE_2D, texs[P.S[k]] || vide); gl.uniform1i(P.U[P.S[k]], k); }
      unis(P.U);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      for (k = 0; k < P.S.length; k++) { gl.activeTexture(gl.TEXTURE0 + k); gl.bindTexture(gl.TEXTURE_2D, null); }
      gl.activeTexture(gl.TEXTURE0); gl.bindVertexArray(null);
    }
    function tableGL(N, inv) {
      var key = N + (inv ? "i" : "d");
      if (!TAB[key]) { var t = tableTF(N, inv); TAB[key] = { t: texF(4, N, 3 * t.S, t.data), S: t.S }; }
      return TAB[key];
    }
    function racines(N) {                  // exp(2iπ n / N), calculées en double
      if (!RAC[N]) { var r = new Float32Array(2 * N); for (var n = 0; n < N; n++) { r[2 * n] = Math.cos(2 * Math.PI * n / N); r[2 * n + 1] = Math.sin(2 * Math.PI * n / N); } RAC[N] = texF(2, N, 1, r); }
      return RAC[N];
    }
    function libererPlan(p) {
      var G = p.gl, k;
      if (!G) return;
      for (k in G.tex) gl.deleteTexture(G.tex[k]);
      for (k in G.nat) libererNat(G.nat[k]);
      if (G.champ) { liberer(G.champ[0]); liberer(G.champ[1]); }
      for (k in pool) pool[k].forEach(liberer);
      pool = {}; p.gl = null;
    }
    function etatPlan(plan) {
      progsOnde();
      if (planGL !== plan) { if (planGL) libererPlan(planGL); planGL = plan; }
      return plan.gl || (plan.gl = { tex: {}, nat: {}, champ: null });
    }
    function texPlan(G, cle, fab) { return G.tex[cle] || (G.tex[cle] = fab()); }
    // ondeChamp sur la carte, sans |u|² : {c (cible qui porte le champ au détecteur), d (pas)}.
    function champGL(plan, l, mx, my) {
      var G = plan.gl, seq = plan.seq, Pr = seq.prims, nd = seq.iDet, lm = l * 1e-6, pls = plan.planes, Nx = plan.N[0], Ny = plan.N[1];
      if (!G.champ) G.champ = [cibleF(2, Nx, Ny), cibleF(2, Nx, Ny)];
      var ch = G.champ, c = 0, e0 = eclairageBase(plan, l);
      var tE = texPlan(G, e0.cle, function () { return texF(2, Nx, Ny, rg(e0.B.re, e0.B.im)); });
      var mxr = (((mx || 0) % Nx) + Nx) % Nx, myr = (((my || 0) % Ny) + Ny) % Ny;
      dessiner(PO.dep, ch[0], { uE: tE, uRx: racines(Nx), uRy: racines(Ny) }, function (U) {
        gl.uniform1i(U.uMx, mxr); gl.uniform1i(U.uMy, myr); gl.uniform1i(U.uNx, Nx); gl.uniform1i(U.uNy, Ny); gl.uniform1f(U.uK, e0.k);
      });
      var d = [plan.d[0], plan.d[1]], cs = [e0.c, e0.c];
      for (var k = 0; k < pls.length; k++) {
        var pl = pls[k], der = k === pls.length - 1, Mt = mul(chaine(seq, l, pl.i, der ? nd : pls[k + 1].i), abcdPrim(Pr[pl.i], l)), comp = pl.genre !== "speckle";
        var E = [], ax, tM = null;
        for (ax = 0; ax < 2; ax++) { E[ax] = ondeEtapes(plan.N[ax], lm, d[ax], cs[ax], Mt, comp); d[ax] = E[ax].pas; cs[ax] = E[ax].courbure; }
        if (!der) {
          var key = "T" + (k + 1) + "|" + l;
          if (!plan.cache[key]) plan.cache[key] = tPlan(plan, pls[k + 1], d);
          tM = texPlan(G, key, function () { return texF(2, Nx, Ny, rg(plan.cache[key].re, plan.cache[key].im)); });
        }
        for (ax = 0; ax < 2; ax++) {       // x (propAxe axe 1) puis y (axe 0), comme ondeChamp
          var axe = ax === 0 ? 1 : 0, N = plan.N[ax], et = E[ax].etapes;
          for (var ie = 0; ie < et.length; ie++) {
            var e = et[ie], tab = e.tf ? tableGL(N, e.tf < 0) : null, S = tab ? tab.S : 1, cp = "|" + k + "|" + ax + "|" + ie + "|" + l;
            var tPre = e.pre ? texPlan(G, "pre" + cp, function () { return texF(2, N, 1, new Float32Array(e.pre)); }) : null;
            var tPost = e.post ? texPlan(G, "post" + cp, function () { return texF(2, N, 1, new Float32Array(e.post)); }) : null;
            for (var s = 0; s < S; s++) {
              var dernier = s === S - 1, masque = !!tM && ax === 1 && ie === et.length - 1 && dernier;
              dessiner(PO.et, ch[1 - c], { uU: ch[c].t, uTab: tab ? tab.t : null, uPre: tPre, uPost: tPost, uMasque: masque ? tM : null }, function (U) {
                gl.uniform1i(U.uAxe, axe); gl.uniform1i(U.uN, N); gl.uniform1i(U.uEtage, s); gl.uniform1i(U.uPremier, s === 0 ? 1 : 0); gl.uniform1i(U.uDernier, dernier ? 1 : 0);
                gl.uniform1i(U.uFlip, e.flip ? 1 : 0); gl.uniform1i(U.uCopie, tab ? 0 : 1); gl.uniform1i(U.uAvecPre, e.pre ? 1 : 0); gl.uniform1i(U.uAvecPost, e.post ? 1 : 0);
                gl.uniform1i(U.uAvecMasque, masque ? 1 : 0); gl.uniform1f(U.uEch, e.ech);
              });
              c = 1 - c;
            }
          }
        }
      }
      return { c: ch[c], d: d };
    }
    function somme(src, dst, axe, n, k) {
      dessiner(PO.som, dst, { uI: src.t }, function (U) { gl.uniform1i(U.uAxe, axe); gl.uniform1i(U.uN, n); gl.uniform1f(U.uK, k); });
    }
    // natif sur la carte : {g (natifGeom), I, et les marges mx (1 × Ny), my (Nx × 1), tot (1 × 1) si demandées}.
    function natifGL(plan, ch, h, cible, marges) {
      var gm = natifGeom(plan.N[0], plan.N[1], ch.d, h, cible), n = { g: gm, I: cibleF(1, gm.Nx, gm.Ny), mx: null, my: null, tot: null };
      dessiner(PO.nat, n.I, { uU: ch.c.t }, function (U) { gl.uniform2i(U.uR, gm.r[0], gm.r[1]); });
      if (marges) {
        n.mx = cibleF(1, 1, gm.Ny); n.my = cibleF(1, gm.Nx, 1); n.tot = cibleF(1, 1, 1);
        somme(n.I, n.mx, 1, gm.Nx, gm.d[0]); somme(n.I, n.my, 0, gm.Ny, gm.d[1]); somme(n.mx, n.tot, 0, gm.Ny, gm.d[1]);
      }
      return n;
    }
    function lecture(pr, lot, nat, alpha) {
      var n = lot.strates.length, st = new Float32Array(4 * n), od = new Float32Array(21), no = lot.ordres.length, i, gm = nat.g, ga = lot.gauss;
      for (i = 0; i < n; i++) { st[4 * i] = lot.strates[i][0]; st[4 * i + 1] = lot.strates[i][1]; st[4 * i + 2] = lot.strates[i][2]; }
      for (i = 0; i < no; i++) { od[3 * i] = lot.ordres[i][0]; od[3 * i + 1] = lot.ordres[i][1]; od[3 * i + 2] = lot.ordres[i][2]; }
      var tS = texF(4, n, 1, st), bo = lot.boite || [0, 0], G = pr.G;
      dessiner(PO.lec, { fb: acc[1 - cour].fb, w: res, h: res }, { uAcc: acc[cour].t, uNat: nat.I && nat.I.t, uMx: nat.mx && nat.mx.t, uMy: nat.my && nat.my.t, uTot: nat.tot && nat.tot.t, uStr: tS }, function (U) {
        gl.uniform2f(U.uGo, G.o[0], G.o[1]); gl.uniform2f(U.uGu, G.u[0], G.u[1]); gl.uniform2f(U.uGv, G.v[0], G.v[1]);
        gl.uniform2f(U.uD, gm ? gm.d[0] : 1, gm ? gm.d[1] : 1); gl.uniform2f(U.uOff, gm ? gm.off[0] : 0, gm ? gm.off[1] : 0); gl.uniform2f(U.uBoite, bo[0], bo[1]);
        gl.uniform2i(U.uDim, gm ? gm.Nx : 0, gm ? gm.Ny : 0); gl.uniform1i(U.uNs, n); gl.uniform1i(U.uNord, no); gl.uniform3fv(U.uOrd, od);
        gl.uniform1i(U.uGauss, ga ? 1 : 0); gl.uniform1f(U.uW2, ga ? ga.w2 : 1); gl.uniform2f(U.uC, ga ? ga.c[0] : 0, ga ? ga.c[1] : 0);
        gl.uniform3f(U.uF, lot.f[0], lot.f[1], lot.f[2]); gl.uniform1f(U.uH, pr.h); gl.uniform1f(U.uAlpha, alpha);
      });
      gl.deleteTexture(tS); cour = 1 - cour;
    }
    // Ajoute à l'accumulateur l'image d'une passe d'ondePasse(plan, rendu) (mêmes unités, ligne 0 en bas).
    // rendu.jetable : figures par longueur d'onde non gardées (spectromètre : une longueur d'onde par appel, des centaines).
    function onde(plan, rendu) {
      dimensionner(rendu.res); etatPlan(plan);
      var G = plan.gl, pr = ondeProgramme(plan, rendu), h = pr.h, premier = true;
      pr.lots.forEach(function (lot) {
        if (!lot.strates.length) return;
        var nat, temp = false, mg = !!(lot.boite && (lot.boite[0] || lot.boite[1]));
        if (lot.gauss) nat = { g: null };
        else if (lot.cache && !rendu.jetable) {
          var key = lot.l + "|" + h + "|" + lot.cible[0] + "|" + lot.cible[1] + "|" + mg;
          nat = G.nat[key] || (G.nat[key] = natifGL(plan, champGL(plan, lot.l, 0, 0), h, lot.cible, mg));
        } else { nat = natifGL(plan, champGL(plan, lot.l, lot.mx, lot.my), h, lot.cache ? lot.cible : null, mg); temp = true; }
        lecture(pr, lot, nat, premier ? 1e6 : 0); premier = false;
        if (temp) rendreNat(nat);
      });
      npasses++;
      return { paires: pr.paires };
    }
    // Contrôle : intensité au détecteur sur la grille native non réduite (comme ondeChamp, en float32).
    function ondeNatif(plan, l, mx, my) {
      etatPlan(plan);
      var ch = champGL(plan, l, mx, my), n = natifGL(plan, ch, 0, [0, 0], false), Nx = n.g.Nx, Ny = n.g.Ny, b = new Float32Array(4 * Nx * Ny), I = new Float32Array(Nx * Ny);
      gl.bindFramebuffer(gl.FRAMEBUFFER, n.I.fb); gl.readPixels(0, 0, Nx, Ny, gl.RGBA, gl.FLOAT, b);
      for (var q = 0; q < Nx * Ny; q++) I[q] = b[4 * q];
      rendreNat(n);
      return { I: I, Nx: Nx, Ny: Ny, d: ch.d };
    }
    return {
      onde: onde, ondeNatif: ondeNatif,
      // spectromètre : ondeSpectre sur la carte (ps = planSpectre(plan)) ; EFFACE l'accumulateur (traceur à part)
      ondeSpectre: function (ps, o) {
        ps.lambdas = [[o.l, [1, 1, 1]]];
        var r = rendreSpectre(o), g, s = 0; r.jetable = true;
        dimensionner(4); raz(); onde(ps, r); g = lire();
        for (var q = 0; q < 16; q++) s += g[3 * q];
        return s / 16;
      }, ondePropager: function (plan, l, mx, my) { etatPlan(plan); return champGL(plan, l, mx, my).d; }, libererOnde: function () { if (planGL) libererPlan(planGL); planGL = null; },
      gl: gl, passe: passe, rayons: rayons, histoGuide: histoGuide, lireGuide: lireGuide, raz: raz, finir: finir, lire: lire, lireB: lireB, lireEcran: lireEcran, bruit: bruit, sommes: sommes, reduire: reduire, centile: centile, afficher: afficher, voile: voile, effacer: effacer, dimensionner: dimensionner, blend32: blend32,
      get res() { return res; }, get npasses() { return npasses; }, get npassesB() { return npB; },
      info: function () { var d = gl.getExtension("WEBGL_debug_renderer_info"); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); }
    };
  }

  // Moteur progressif : aperçu pendant le geste (une passe, résolution et rayons réduits), puis, 150 ms après le
  // dernier changement, image fine accumulée passe après passe (plusieurs passes par image d'animation dans la limite
  // de opts.budget ms ; chaque passe est attendue, sauf opts.chrono === false). opts.qualite(seq) → {apercu: {res, Nr},
  // fin: {res, Nr, passes, bruit, plafond, visible}} (bruit : arrêt sur le bruit mesuré, `finBruit` ; stats.bruit ;
  // visible : arrêt sur l'image stable à l'écran, `finVisible` ; stats.visible). aff = {W, cx, cy, expo, auto (exposition : aperçu, puis image fine finie), comp, fond, vue
  // (défaut : le détecteur), bal, net (texels au plus proche), vision (vue « œil » en luminosité réelle :
  // {s (cd/m² par lux : ρ/π pour un écran, 289 / aire de la pupille tracée pour la
  // rétine), Wg (demi-largeur du champ ENTIER : l'adaptation ne suit pas le zoom), omega (deg² par mm² du détecteur),
  // M, Fsalle, salle (module couleur, `adaptation`), scot (rapport scotopique de la source, −1 : continu), halo
  // (voile de `voileHalo` calculé sur la même passe, ajouté par le shader ; sauté s'il reste partout sous le dixième
  // du seuil), affiche (false : vue « toujours visible », l'adaptation ne sert qu'à la pupille, stats.vision.D),
  // pup (pupille tracée, rendue dans stats.vision.pupTracee : l'instrument compare D à la pupille de CE tracé)}),
  // visible (vue « œil » en « toujours visible » : `vision` sans seuils ni bâtonnets sur l'exposition automatique)}.
  // En vision, l'exposition n'est pas automatique : K donne la luminance, le niveau d'adaptation La (moyenne
  // logarithmique pondérée sur le champ entier, salle comprise : `adaptation` du module couleur) est mesuré à chaque
  // changement sur une passe grossière du champ ENTIER (RES_ADAPT², texel ≈ 0,2° à l'œil comme à l'écran : échelle de
  // mise en commun de l'adaptation ; une raie ou une fente plus fine y est étalée et sa luminance sous-estimée : elle
  // sort au-delà du blanc, blanchie avec un halo, ce qui ressemble à l'observation (raie verte du mercure au réseau,
  // gardé à dessein ; à 512², la raie redevient verte, le halo disparaît, et la passe coûte 3 à 7 fois
  // plus), avant l'aperçu (stats.vision : La, F, pupille D, visible) ; `vision` fait le reste
  // dans le shader. Mesurer La sur l'image affichée le ferait dépendre du zoom (sa résolution change la pondération).
  // opts.onde === true : moteur ondulatoire quand ondePlan l'accepte, rayons sinon ; opts.qualiteOnde(seq) →
  // {apercu: {res, ns, np, opt (options d'ondePlan)}, fin: {res, ns, np, passes, opt}} ; somme brute : ⌈paires / np⌉
  // passes fines. En mode onde, une passe = une image d'éclairement (nRay compte les passes, aire du pixel 1).
  // 99e centile sans le biais du bruit (128², 20 à 90 rayons par texel, le tri le
  // surestimait de 1,1 à 3 fois à 2^19 rayons, jusqu'à 7 à 2^17 : le haut du classement est peuplé de texels tirés
  // vers le haut par le bruit). Deux moitiés indépendantes A et B (img = total, imgB = B ; luminance × k) : les m
  // texels les plus clairs selon A, valeur lue dans B (indépendante de la sélection), et inversement ; m = 2 (n − 1 − r)
  // + 1 autour du rang r = ⌊0,99 (n − 1)⌋ du tri : à sélection parfaite, leur médiane est le texel de rang r ; rend la
  // somme des deux médianes (moitiés). Lumière clairsemée (plus de 5 % de valeurs nulles dans les sélections : un ou
  // deux rayons par texel, la médiane tombe à 0) : texels réunis en blocs 2 × 2, puis 4 × 4, 8 × 8 (valeur moyenne
  // du bloc). Mesuré (script de mesure, 27 montages) : 0,54 à 1,29 fois la référence à 2^17 rayons (le tri :
  // 1,09 à 6,9), 0,69 à 1,14 à 2^19 (tri : 1,01 à 3,0) ; la sélection bruitée prend quelques texels moins clairs : léger
  // biais vers le bas (œil myope : le plus bas).
  function centileCroise(img, imgB, k) {
    var n0 = img.length / 3, r0 = Math.round(Math.sqrt(n0)), bloc, i;
    for (bloc = 1; ; bloc *= 2) {
      var r = Math.ceil(r0 / bloc), n = r * r, A = new Float64Array(n), B = new Float64Array(n), idx = [];
      for (i = 0; i < n0; i++) {
        var j = Math.floor(Math.floor(i / r0) / bloc) * r + Math.floor((i % r0) / bloc), b = imgB[3 * i + 1] * k;
        B[j] += b; A[j] += img[3 * i + 1] * k - b;
      }
      for (i = 0; i < n; i++) if (A[i] + B[i] > 0) idx.push(i);
      var nl = idx.length;
      if (!nl) return 0;
      var rg = Math.floor(0.99 * (nl - 1)), m = Math.min(nl, 2 * (nl - 1 - rg) + 1), vides = 0;
      var cote = function (X, Y) {
        var v = idx.slice().sort(function (u, w) { return X[w] - X[u]; }).slice(0, m).map(function (q) { return Y[q]; });
        v.forEach(function (x) { if (!(x > 0)) vides++; });
        v.sort(function (x, y) { return x - y; });
        return m & 1 ? v[m >> 1] : 0.5 * (v[(m >> 1) - 1] + v[m >> 1]);
      };
      var h = Math.max(0, cote(A, B) + cote(B, A)) / (bloc * bloc);
      if (vides <= 0.05 * 2 * m || bloc >= 8 || r <= 8) return h;
    }
  }
  var QUALITE_ONDE = { apercu: { res: 256, ns: 4, np: 8, opt: { nl: 6, maxCellules: 1 << 18 } }, fin: { res: 512, ns: 8, np: 16, passes: 8, opt: {} } };
  function creerMoteurBanc(canvas, opts) {
    opts = opts || {};
    var T = creerTraceurGL(canvas, opts);
    if (!T) return null;
    var seq = null, emb = null, aff = {}, sale = false, etat = "repos", fin = 0, tChange = 0, t0Fin = 0, nRay = 0, expoAuto = 1, graine = opts.graine || 1;
    var mode = "rayons", planA = null, planF = null, paires = 0;
    var stats = { apercuMs: 0, passeMs: 0, passes: 0, finMs: 0, objectif: 0, rayons: 0, eclairement: 0, moteur: "rayons", onde: null, vision: null, adaptMs: 0, bruit: null, bruitMs: 0, guide: null };
    var visP = null, geoVoile = 0, RES_ADAPT = 128, cleAdapt = null, seqAdapt = null, adaptAttente = false;
    // Le moteur ondulatoire lit le champ AU CENTRE des texels : un détail plus fin qu'un texel de la passe (laser
    // focalisé sur la rétine : tache de quelques µm, texels de 94 µm) y disparaît, et l'œil se croyait dans le noir
    // (« trop peu de lumière » devant un laser). Les rayons, eux, déposent leur flux dans le texel : en onde, une passe
    // de rayons d'abord ; si la passe ondulatoire en perd plus de la moitié du flux, l'adaptation (et le halo) se
    // mesure sur les rayons (à 0,2° près, la diffraction n'y change rien).
    function fluxPasse(rayons, W) { var img = T.lire(), s = 0, h = 2 * W / T.res; for (var i = 1; i < img.length; i += 3) s += img[i]; return s / Math.max(1, nRay) * (rayons ? 1 : h * h); }
    function adapterChamp() {
      var t0 = performance.now(), g = { res: RES_ADAPT, W: aff.vision.Wg }, ray = false;
      T.dimensionner(RES_ADAPT);
      if (mode === "onde") {
        T.raz(); nRay = 0; unePasse("apercu", 0, g, true); var Fr = fluxPasse(true, g.W);
        T.raz(); nRay = 0; unePasse("apercu", 0, g); var Fo = fluxPasse(false, g.W);
        if (Fo < 0.5 * Fr) { ray = true; T.raz(); nRay = 0; passesAdapt(g, true); }
      } else { T.raz(); nRay = 0; passesAdapt(g); }
      adapter(g.W, ray); stats.vision.rayons = ray;
      cleAdapt = JSON.stringify(aff.vision); seqAdapt = seq; adaptAttente = false; stats.adaptMs = performance.now() - t0;
    }
    // Passe d'adaptation aux rayons en deux moitiés indépendantes (la seconde aussi dans l'accumulateur B) : le 99e
    // centile s'y mesure sans le biais du bruit (`adapter`). Sans mélange 32 bits : une seule passe.
    function passesAdapt(g, rayons) {
      if (!T.blend32) { unePasse("apercu", 0, g, rayons); return; }
      unePasse("apercu", 1, g, rayons, { moitie: true }); unePasse("apercu", 2, g, rayons, { moitie: true, voieB: true });
    }
    var BAL = M.balance();
    function q() {
      if (mode === "onde") return opts.qualiteOnde ? opts.qualiteOnde(seq) : QUALITE_ONDE;
      return opts.qualite ? opts.qualite(seq) : { apercu: { res: 256, Nr: 1 << 19 }, fin: { res: 512, Nr: 1 << 21, passes: 40 } };
    }
    function infoOnde(pl, raison) {
      if (!pl || !pl.ok) return { raison: raison || null };
      return { raison: null, N: pl.N, d: pl.d, limite: pl.limite, lambdas: pl.lambdas.length, plans: pl.planes.length, paires: paires, laser: pl.laser };
    }
    function demander(s, a) {
      if (s !== seq) {
        seq = s; emb = s && s.det && s.prims.length ? emballer(s) : null; cleSeq = emb ? cleGuide(s) : null;
        mode = "rayons"; planA = planF = null; paires = 0;
        if (opts.onde && emb && !(opts.moteur && opts.moteur() === "rayons")) {      // opts.moteur() === "rayons" : géométrique imposé (réglage prof)
          mode = "onde";
          planA = ondePlan(s, q().apercu.opt);
          if (!planA.ok) { mode = "rayons"; stats.onde = infoOnde(null, planA.raison); planA = null; } else stats.onde = infoOnde(planA);
        } else stats.onde = null;
        stats.moteur = mode;
      }
      if (a) { aff = a; if (!a.vision) { stats.vision = null; visP = null; cleAdapt = null; geoVoile = 0; } }
      sale = true; tChange = performance.now();
    }
    // g : passe du champ entier pour l'adaptation (vision), {res, W} ; fenêtre centrée sur le détecteur.
    // rayons : passe de rayons même en mode onde (adaptation, `adapterChamp`), à la qualité d'aperçu des rayons.
    // o : {moitie (la moitié des rayons), voieB (aussi dans l'accumulateur B du traceur)}.
    function unePasse(niv, p, g, rayons, o) {
      var Q = q()[niv], t = performance.now(), res = g ? g.res : Q.res, W = g ? g.W : aff.W, cx = g ? 0 : aff.cx || 0, cy = g ? 0 : aff.cy || 0;
      if (rayons && mode === "onde") Q = (opts.qualite ? opts.qualite(seq) : { apercu: { Nr: 1 << 19 } }).apercu;
      if (mode === "onde" && !rayons) {
        var pl = niv === "apercu" ? planA : (planF || (planF = ondePlan(seq, Q.opt)));
        if (!pl.ok) pl = planA;
        var r = T.onde(pl, { res: res, W: W, cx: cx, cy: cy, ns: Q.ns, np: Q.np, graine: graine, passe: p });
        if (niv === "fin") { paires = r.paires; stats.onde = infoOnde(pl); }
        nRay += 1;
      } else {
        var nr = g ? Math.max(ADAPT_NR, Q.Nr >> 2) : Q.Nr;      // passe d'adaptation : au moins ADAPT_NR rayons (aperçu adaptatif descendu à 2^14 : La et plus clair faux au microscope)
        if (o && o.moitie) nr = Math.max(1 << 13, nr >> 1);
        T.passe(seqGuidee(W, cx, cy), emb, { res: res, W: W, cx: cx, cy: cy, Nr: nr, graine: graine, passe: p, voieB: !!(o && o.voieB) });
        nRay += nr;
      }
      if (opts.chrono !== false) T.finir();      // attendre la carte : temps vrais, et le budget par image tient
      stats.rayons = nRay;
      return performance.now() - t;
    }
    // ----- Visée guidée (tirage : `guidePaire`) -----
    // Le guide est sans biais quel qu'il soit (poids 1/q, 1/8 d'uniforme) : un guide appris avant un geste reste juste
    // pendant le geste, il n'y perd que de son gain (mesuré sur le processeur : gain gardé quand une lentille bouge de
    // 2 à 30 mm, au pire celui du tirage uniforme). D'où : passe pilote (`T.histoGuide`) au début de chaque image fine,
    // avant la première passe (l'aperçu reste affiché), guidée par le guide en place s'il vaut encore ; jusqu'à
    // GUIDE_TOURS tours quand un site manque de rayons utiles (`info[s].court` de guideTables : œil myope, microscope),
    // chacun guidé par le précédent, dans GUIDE_PART du plafond de temps. Le guide sert ensuite aux passes fines, aux
    // aperçus du geste suivant et à la passe d'adaptation de l'œil, tant que la STRUCTURE du tirage (`cleGuide` : mode,
    // forme de la source, élément visé, dépolis) ne change pas et que la fenêtre reste dans celle de la passe pilote
    // (zoom arrière : la lumière hors de l'ancienne fenêtre n'y serait tirée que par l'uniforme). Une passe guidée
    // coûte 10 à 25 % de plus (tirages et lectures de table, rayons qui vont plus loin ; mesuré sur l'UHD 620) : guide
    // gardé seulement si le produit des gains prévus de ses sites (`info[s].gain`) atteint GUIDE_MIN (projection 1,8,
    // stigmatisme 1,4, chromatisme 1,8 : rien gagné en temps ; image 3,4, loupe 27). Pilote sauté quand le précédent,
    // pour la même séquence et la même fenêtre, n'a rien trouvé (zoom avant compris : la fenêtre change, on refait).
    // Rayons et mélange 32 bits seulement ; opts.guide (booléen ou fonction) faux : jamais (réglage prof, mesures). La
    // séquence de l'appelant n'est pas touchée : copie (Object.create) qui porte le guide.
    var GD = null, cleSeq = null, PIL = null, GUIDE_TOURS = 3, GUIDE_PART = 0.1, GUIDE_MAX_MS = 400, GUIDE_MIN = 2;
    function cleGuide(s) {
      var p0 = s.prims[0], d = [];
      s.prims.forEach(function (p) { if (p.k === K.DIFFUSEUR) d.push(p.el + ":" + p.sens + (p.p[5] > 0 ? "+" : "")); });     // + : cible élargie
      return [s.mode || 0, s.source.em.forme, s.source.em.fil ? 1 : 0, p0 ? p0.el + ":" + p0.k : "", s.cible && s.cible[4] > 0 ? "+" : "",
        s.mode === 1 ? s.prims[s.de].el : "", d.join(",")].join("|");
    }
    function guideOui() { return typeof opts.guide === "function" ? !!opts.guide() : opts.guide !== false; }
    function guideVaut(W, cx, cy) {
      if (!GD || !GD.G || GD.cle !== cleSeq || mode === "onde" || !guideOui()) return false;
      var F = GD.fen, e = 1e-9 * F.W;
      return cx - W >= F.cx - F.W - e && cx + W <= F.cx + F.W + e && cy - W >= F.cy - F.W - e && cy + W <= F.cy + F.W + e;
    }
    function seqGuidee(W, cx, cy) {
      if (!guideVaut(W, cx, cy)) return seq;
      if (GD.pour !== seq) { GD.seqG = Object.create(seq); GD.seqG.guide = GD.G; GD.pour = seq; }
      return GD.seqG;
    }
    function memeFen(F) { return !!F && F.W === aff.W && F.cx === (aff.cx || 0) && F.cy === (aff.cy || 0); }
    function guideRien() { return !!(GD && !GD.G && GD.seq === seq && memeFen(GD.fen)); }
    function guideActif() { return guideOui() && mode !== "onde" && T.blend32 && !!emb && !guideRien(); }
    function debutPilote(Q) {
      var W = aff.W, cx = aff.cx || 0, cy = aff.cy || 0, base = guideVaut(W, cx, cy) ? GD.G : null, sites = [];
      for (var i = 0; i < sitesGuide(seq); i++) sites.push(i);
      PIL = { tour: 0, i: 0, sites: sites, base: base, fen: { W: W, cx: cx, cy: cy }, Nr: Q.Nr, t0: performance.now(), ms: 0, utiles: [], poids: poidsZones() };
    }
    // Poids des rayons pilotes selon la zone de la fenêtre où ils arrivent : 1 / (L / L99)^β, L luminance de la zone sur
    // l'aperçu encore dans l'accumulateur (blocs n × n, `T.reduire`), L99 le 99e centile des blocs éclairés, plancher
    // GUIDE_LUM.plancher. Un guide proportionnel au seul flux sert les zones claires et laisse les faibles (bords
    // flous, halos) plus bruitées qu'au tirage uniforme ; l'arrêt sur le bruit les attend (faibles ≤ 2 × objectif).
    // β = 0 : flux seul. null : pas d'aperçu utilisable (rien d'éclairé, résolution sans diviseur).
    var GUIDE_LUM = { beta: 0.5, plancher: 0.03 };
    function poidsZones() {
      var be = opts.guideBeta != null ? opts.guideBeta : GUIDE_LUM.beta;
      if (!(be > 0) || !nRay) return null;
      var n = [64, 48, 32].filter(function (m) { return T.res % m === 0; })[0];
      if (!n) return null;
      var img = T.reduire(n), Y = [], i;
      for (i = 0; i < n * n; i++) if (img[3 * i + 1] > 0) Y.push(img[3 * i + 1]);
      if (!Y.length) return null;
      Y.sort(function (a, b) { return a - b; });
      var h = Y[Math.floor(0.99 * (Y.length - 1))], P = new Float32Array(n * n);
      for (i = 0; i < n * n; i++) P[i] = Math.pow(Math.max(img[3 * i + 1] / h, GUIDE_LUM.plancher), -be);
      return P;
    }
    // Une unité de travail de la passe pilote (le tracé d'un site) ; rend true quand le pilote est fini.
    function unitePilote(Q) {
      var P = PIL, t = performance.now(), base = P.base ? Object.create(seq) : seq;
      if (P.base) base.guide = P.base;
      T.histoGuide(base, emb, { res: 1, W: P.fen.W, cx: P.fen.cx, cy: P.fen.cy, Nr: P.Nr, graine: graine, passe: 1000000 + P.tour }, { sites: [P.sites[P.i]], efface: P.i === 0, poids: P.poids });
      if (opts.chrono !== false) T.finir();
      P.i++;
      if (P.i < P.sites.length) { P.ms += performance.now() - t; return false; }
      var H = T.lireGuide(P.sites), G = guideTables(H.histos, H.n, GUIDE.alpha, H.carres), gain = 1;
      G.t.forEach(function (x, s) { if (x) gain *= G.info[s].gain; });
      var aTable = gain >= GUIDE_MIN;
      P.utiles.push(H.utiles / P.Nr); P.ms += performance.now() - t; P.tour++;
      var court = aTable && G.info.some(function (x, s) { return x && x.court && G.t[s]; }), lim = Q.plafond > 0 ? Math.min(GUIDE_MAX_MS, GUIDE_PART * Q.plafond) : GUIDE_MAX_MS;
      P.G = aTable ? G : null;
      // un tour de plus, guidé par ce guide, si un site guidé manque de rayons et que le temps le permet (tour ≈ P.ms / tours)
      if (court && P.tour < GUIDE_TOURS && P.ms * (P.tour + 1) / P.tour <= lim) { P.base = G; P.i = 0; return false; }
      GD = { G: P.G, cle: cleSeq, fen: P.fen, seq: seq, pour: null, seqG: null };
      stats.guide = { sites: P.G ? G.t.map(function (x) { return x ? x.n : 0; }) : [0, 0, 0, 0], gain: gain, info: G.info, tours: P.tour, ms: P.ms, utiles: P.utiles, Nr: P.Nr };
      PIL = null;
      return true;
    }
    // Arrêt sur le bruit mesuré quand la qualité le demande : fin.bruit (objectif,
    // bruit relatif des texels clairs ; les faibles visent le double), fin.plafond (ms depuis le début de l'image fine),
    // fin.passes devient un plafond de passes. Passes impaires aussi dans l'accumulateur B ; mesure toutes les
    // BRUIT_PAS passes (autant de paires que d'impaires). Rayons et mélange 32 bits seulement (sinon passes fixes).
    var BRUIT_PAS = 4;
    function mesureBruit(Q) { return !!(Q.bruit > 0 && mode !== "onde" && T.blend32); }
    function finBruit(Q) {
      var t = performance.now() - t0Fin, B = stats.bruit;
      if (fin % BRUIT_PAS === 0) {
        var tm = performance.now(); B = T.bruit(); stats.bruitMs = performance.now() - tm;
        if (B) { B.objectif = Q.bruit; B.passes = fin; B.raison = null; }
        stats.bruit = B;
      }
      if (B && B.passes === fin) {
        if (!(B.haut > 0) && fin >= 2 * BRUIT_PAS) { B.raison = "noir"; return true; }
        if (B.clair !== null && B.clair <= Q.bruit && (B.nFaible < 64 || B.faible === null || B.faible <= 2 * Q.bruit)) { B.raison = "bruit"; return true; }
      }
      if (Q.plafond > 0 && t >= Q.plafond) { if (B) B.raison = "plafond"; return true; }
      if (fin >= (Q.passes || Infinity)) { if (B) B.raison = "passes"; return true; }
      return false;
    }
    // Arrêt sur l'image stable À L'ÉCRAN (fin.visible : écart en niveaux sur 255) : aux passes 8, 12, 16, 24, 32, 48…,
    // l'image affichée (vision, lissages et exposition compris) est relue, et comparée à celle de la moitié des passes.
    // Le bruit baissant en 1/√n, l'image à 2m passes est la moyenne de celle à m et de m passes indépendantes : leur
    // écart vaut ce qui bouge encore à l'écran (bruit restant, lissage qui se resserre). Moyenne par blocs de
    // BLOC_VISIBLE pixels (le grain d'un pixel ne se voit pas comme un changement ; pixel par pixel, l'écart restait à
    // 4-6/255 avec 2 % de bruit par texel). Pourquoi : le bruit par texel (finBruit) n'atteint jamais l'objectif des
    // montages peu lumineux (microscope : 46 % au plafond de 3 s, pour 3 % visés), et la carte tournait jusqu'au
    // plafond. Mesuré (UHD 620, Normal, 3/255) : lunette et projection arrêtées vers 2 s au lieu de 3 ; Fin (2/255) :
    // 4 s au lieu de 8 ; microscope, encore 13/255 à 32 passes (grain de couleur qui bouge vraiment) : plafond.
    var ECR = {}, BLOC_VISIBLE = 4;
    function controleVisible(n) { var t = n % 3 ? n : n / 3; return n >= 8 && (t & (t - 1)) === 0; }      // 2^k et 3·2^k
    function finVisible(Q) {
      if (!(Q.visible > 0) || mode === "onde" || !controleVisible(fin)) return false;
      montrer(); var px = T.lireEcran(), e = ECR[fin / 2], k;
      for (k in ECR) if (+k < fin / 2) delete ECR[k];
      ECR[fin] = px;
      if (!e || e.length !== px.length) return false;
      var ec = ecartBlocs(e, px, canvas.width, canvas.height, BLOC_VISIBLE);
      stats.visible = { passes: fin, ecart: ec, objectif: Q.visible };
      return ec <= Q.visible;
    }
    // Écart quadratique moyen (niveaux sur 255, trois couleurs) entre deux images RGBA w × h moyennées par blocs b × b,
    // sur les blocs éclairés (> 2/255 dans l'une des deux).
    function ecartBlocs(a, c, w, h, b) {
      var s = 0, n = 0, nb = b * b;
      for (var y = 0; y + b <= h; y += b) for (var x = 0; x + b <= w; x += b) {
        var A = [0, 0, 0], B = [0, 0, 0], k, i, j;
        for (j = 0; j < b; j++) for (i = 0; i < b; i++) { var q = 4 * ((y + j) * w + x + i); for (k = 0; k < 3; k++) { A[k] += a[q + k]; B[k] += c[q + k]; } }
        if (Math.max(A[0], A[1], A[2], B[0], B[1], B[2]) <= 2 * nb) continue;
        for (k = 0; k < 3; k++) { var d = (A[k] - B[k]) / nb; s += d * d; } n += 3;
      }
      return n ? Math.sqrt(s / n) : 0;
    }
    function passesFin() { var Q = q().fin; return mode === "onde" && paires > 0 ? Math.max(1, Math.ceil(paires / Q.np)) : Q.passes; }
    function aire() { if (mode === "onde") return 1; var h = 2 * aff.W / T.res; return h * h; }
    // Sommes de l'accumulateur (teinte moyenne, voile du capteur) : refaites à l'aperçu, au repos et toutes les
    // SOMMES_PAS passes de l'image fine, entre-temps extrapolées au nombre de rayons (22 ms à 2048² à chaque image sinon).
    var smC = null, smN = 0, smFin = -1, SOMMES_PAS = 8;
    function sommesEspacees() {
      if (!smC || etat !== "fin" || smFin < 0 || fin - smFin >= SOMMES_PAS) { smC = T.sommes(); smN = nRay; smFin = etat === "fin" ? fin : -1; }
      var e = smN > 0 ? nRay / smN : 1;
      return [smC[0] * e, smC[1] * e, smC[2] * e, smC[3] * e];
    }
    function montrer() {
      // sans « auto » (écran, barrette) : l'exposition fixe aff.expo seule, jamais le gain d'une vue automatique précédente
      // (œil, moteur ondulatoire : autres unités) ; « absolu » (capteur) : la pose seule. Hérité, ce gain rendait l'écran
      // clair ou noir selon la vue regardée avant.
      // aff.visible (vue « œil » en « toujours visible ») : la chaîne de couleur de `vision` sans seuils, bâtonnets, Hunt
      // ni halo (`parametresVisible`), sur l'exposition automatique (99e centile de la fenêtre à 0,9 × expo, `exposer`).
      var vr = aff.vision && aff.vision.affiche !== false, vv = !vr && !!aff.visible && !aff.photo;
      var k = vr ? aff.vision.s / Math.max(1, nRay) / aire() : (aff.auto && !aff.absolu ? expoAuto : 1) * (aff.expo || 1) / Math.max(1, nRay) / aire();
      // teinte lissée là où un texel a reçu peu de rayons (aperçu, premières passes, image peu lumineuse) ; jamais en onde.
      // Luminance lissée par densité aussi (LISSE_Y), sauf au capteur (bruit de photons physique, histogramme en JS).
      var lis = opts.lissage !== false && mode !== "onde", sm = lis ? sommesEspacees() : null, lisY = lis && !aff.photo && !aff.bruit;
      // capteur (aff.photo) : voile d'objectif = part aff.photo.voile du flux reçu par la fenêtre, répartie sur
      // l'aire du capteur (aff.photo.aire, mm²) ; en unités de l'accumulateur par texel : part × Σ × h² / aire (le
      // nombre de passes et l'aire du texel du moteur se simplifient). La lumière hors de la fenêtre (zoom) n'y est pas.
      var ph = null;
      if (aff.photo) {
        var sv = sm || sommesEspacees(), hv = 2 * aff.W / T.res, kv = (aff.photo.voile || 0) * hv * hv / (aff.photo.aire || 1);
        ph = { lect: aff.photo.lect || 0, voile: [sv[0] * kv, sv[1] * kv, sv[2] * kv], cap: aff.photo.cap };
      }
      T.afficher({ lisse: lis ? 5 : 0, lisseY: lisY ? LISSE_Y.r : 0, seuilY: LISSE_Y.n, moy: sm && sm[3] > 0 ? [sm[0] / sm[3], sm[1] / sm[3], sm[2] / sm[3]] : null, K: k, bal: aff.bal || BAL, vue: aff.vue || (seq ? seq.vue : [1, 1]), comp: aff.comp || 1, fond: aff.fond, net: aff.net, bruit: aff.bruit || 0, photo: ph, vision: vr ? visP || [0, 1, 1, -1] : vv ? M.parametresVisible(0.9 * (aff.expo || 1)) : null,
        voile: vr && geoVoile ? [aff.W / geoVoile, aff.W / geoVoile, ((aff.cx || 0) - aff.W + geoVoile) / (2 * geoVoile), ((aff.cy || 0) - aff.W + geoVoile) / (2 * geoVoile)] : null });
    }
    // Vision : niveau d'adaptation et pupille d'après la passe du champ entier (demi-largeur W, centrée sur le détecteur).
    function adapter(W, rayons) {
      var cpt = new Float64Array(T.res * T.res), V = aff.vision, img = T.lire(0, T.res, cpt), n = img.length / 3, h = 2 * W / T.res, k = V.s / Math.max(1, nRay) / (mode === "onde" && !rayons ? 1 : h * h);
      var L = new Float64Array(n), i;
      for (i = 0; i < n; i++) L[i] = img[3 * i + 1] * k;
      // plus clair du champ (99e centile des texels éclairés) : plancher de `parametresVision`, et « visible » s'il
      // dépasse la moitié du seuil (visibilité 0,2 dans `vision`) ; débiaisé si la passe a deux moitiés (`centileCroise`)
      var imgB = (rayons || mode !== "onde") && T.blend32 ? T.lireB() : null;
      var a = imgB ? adaptationCroisee(L, imgB, k, h, V) : M.adaptation(L, (V.omega || 0) * h * h, { M: V.M, Fsalle: V.Fsalle, salle: V.salle });
      a.haut = imgB ? centileCroise(img, imgB, k) : centileTri(L);
      visP = M.parametresVision(a.La, V.scot, a.haut); a.seuil = visP[1]; a.visible = a.haut > 0.5 * visP[1];
      a.pupTracee = V.pup || 0; a.seq = seq;
      // halo : voile au plus Ψ(un élément) × angle solide × ΣL ; sauté s'il reste sous le dixième du seuil
      var c = new Float64Array(3 * n), t0 = performance.now();
      for (i = 0; i < 3 * n; i++) c[i] = img[i] * k;
      if (mode !== "onde" || rayons) teinteLissee(c, cpt, T.res);
      a.voile = halo(c, T.res, W, a.seuil);
      if (geoVoile) a.voileMs = performance.now() - t0;
      stats.vision = a;
    }
    // Niveau d'adaptation sur une passe en deux moitiés indépendantes (A = total − B) : poids croisés 4·A·B (`adaptation`,
    // o.LB). Lumière clairsemée (la part croisée Σ 4AB / Σ (A + B)² sous ADAPT_CROISE : le bruit pèse encore, et le log
    // du total bruité, corrélé au poids, biaise vers le haut) : texels réunis en blocs 2 × 2, 4 × 4… jusqu'à 16 × 16
    // (≈ 3° à l'œil), comme `centileCroise`. Le flux (pupille) ne dépend pas des blocs. Mesuré (UHD 620, 6 graines) :
    // microscope, La à ±10 % de 2^18 à 2^22 rayons (avant : 9e4 à 2^18, 8e3 à 2^22 pour 2,5e3) ; loupe et lunette à
    // ±25 % sur la même plage, à ±3 % d'une graine à l'autre à ADAPT_NR = 2^20 (temps de la passe inchangé, ≈ 50 ms :
    // la relecture et le halo y pèsent plus que les rayons).
    var ADAPT_CROISE = 0.8, ADAPT_NR = 1 << 20;
    function adaptationCroisee(L, imgB, k, h, V) {
      var n0 = L.length, r0 = Math.round(Math.sqrt(n0)), o = { M: V.M, Fsalle: V.Fsalle, salle: V.salle }, bloc, i, j;
      for (bloc = 1; ; bloc *= 2) {
        var r = Math.ceil(r0 / bloc), Lb = new Float64Array(r * r), Bb = new Float64Array(r * r), sx = 0, s2 = 0;
        for (i = 0; i < n0; i++) { j = Math.floor(Math.floor(i / r0) / bloc) * r + Math.floor((i % r0) / bloc); Lb[j] += L[i]; Bb[j] += imgB[3 * i + 1] * k; }
        for (j = 0; j < r * r; j++) { var b = Math.min(Math.max(Bb[j], 0), Lb[j]); sx += 4 * (Lb[j] - b) * b; s2 += Lb[j] * Lb[j]; }
        if (!(s2 > 0) || sx >= ADAPT_CROISE * s2 || bloc >= 16) {
          var c = 1 / (bloc * bloc);
          for (j = 0; j < r * r; j++) { Lb[j] *= c; Bb[j] *= c; }
          o.LB = Bb;
          var a = M.adaptation(Lb, (V.omega || 0) * h * h * bloc * bloc, o);
          a.blocAdapt = bloc;
          return a;
        }
      }
    }
    function centileTri(L) {
      var ys = []; for (var i = 0; i < L.length; i++) if (L[i] > 0) ys.push(L[i]);
      ys.sort(function (x, y) { return x - y; });
      return ys.length ? ys[Math.floor(0.99 * (ys.length - 1))] : 0;
    }
    // Teinte du halo, lissée comme celle de l'affichage (uLisse, uSeuil) : la passe d'adaptation est grossière (128²) et
    // un rayon ne porte qu'une longueur d'onde ; un détail fin (image d'une fente de 0,02 mm, raie) n'y couvre que
    // quelques texels de quelques dizaines de rayons, de teintes tirées au hasard (Z/Y de 0,27 à 0,57 sur les quatre
    // texels de l'ordre 0 du réseau en lumière blanche), et le voile, agrandi au zoom, en faisait des taches colorées.
    // Y reste celui du texel ; sa chromaticité est celle de la somme du plus petit carré centré qui réunit TEINTE_N
    // rayons (rayon TEINTE_R au plus), complétée au besoin par la teinte moyenne de la passe. c : XYZ (3 par texel),
    // cpt : rayons par texel, n × n ; modifié en place.
    var TEINTE_N = 256, TEINTE_R = 5;
    function teinteLissee(c, cpt, n) {
      var m = [0, 0, 0], nt = 0, i, j, r, x, y, q, t = new Float64Array(3 * n * n);
      for (i = 0; i < n * n; i++) { m[0] += c[3 * i]; m[1] += c[3 * i + 1]; m[2] += c[3 * i + 2]; nt += cpt[i]; }
      if (!(nt > 0)) return;
      for (j = 0; j < 3; j++) m[j] /= nt;
      for (y = 0; y < n; y++) for (x = 0; x < n; x++) {
        i = y * n + x;
        if (!(c[3 * i + 1] > 0) || cpt[i] >= TEINTE_N) continue;
        var s0 = 0, s1 = 0, s2 = 0, sn = 0;
        for (r = 0; r <= TEINTE_R && sn < TEINTE_N; r++) {
          for (var v = Math.max(0, y - r); v <= Math.min(n - 1, y + r); v++) for (var u = Math.max(0, x - r); u <= Math.min(n - 1, x + r); u++) {
            if (Math.max(Math.abs(u - x), Math.abs(v - y)) !== r) continue;      // anneau r seulement
            q = v * n + u; s0 += c[3 * q]; s1 += c[3 * q + 1]; s2 += c[3 * q + 2]; sn += cpt[q];
          }
        }
        if (sn < TEINTE_N) { var d = TEINTE_N - sn; s0 += m[0] * d; s1 += m[1] * d; s2 += m[2] * d; }
        if (!(s1 > 0)) continue;
        q = c[3 * i + 1] / s1; t[3 * i] = s0 * q; t[3 * i + 2] = s2 * q; t[3 * i + 1] = 1;
      }
      for (i = 0; i < n * n; i++) if (t[3 * i + 1]) { c[3 * i] = t[3 * i]; c[3 * i + 2] = t[3 * i + 2]; }
    }
    // Voile du halo sur une image n × n du champ entier (demi-largeur W) en luminances XYZ (cd/m²) : au plus
    // Ψ(un élément) × angle solide × ΣL ; sauté (geoVoile = 0) s'il reste sous le dixième du seuil. Rend son maximum.
    function halo(c, n, W, seuil) {
      var V = aff.vision, pas = 2 * W / n * Math.sqrt(V.omega || 0), om = Math.pow(pas * Math.PI / 180, 2), sY = 0, i;
      for (i = 0; i < n * n; i++) sY += c[3 * i + 1];
      geoVoile = 0;
      if (!(V.halo && V.affiche !== false && pas > 0 && M.psiHalo(pas) * om * sY > 0.1 * seuil)) return 0;
      var vo = M.voileHalo(c, n, pas), vm = 0;
      for (i = 0; i < n * n; i++) if (vo[3 * i + 1] > vm) vm = vo[3 * i + 1];
      T.voile(vo, n); geoVoile = W;
      return vm;
    }
    // Pendant un geste, l'œil garde l'adaptation d'avant (adaptAttente) mais le halo, optique, suit l'image : refait sur
    // l'aperçu réduit à 64² (≈ 5 ms) quand l'aperçu couvre le champ entier ; zoomé, retiré jusqu'à l'image fine (un voile
    // figé restait en surimpression de la pièce qu'on déplaçait). Pas en onde quand l'œil s'adapte sur les rayons.
    function haloApercu() {
      var V = aff.vision, sv = stats.vision;
      geoVoile = 0;
      if (!V || !V.halo || V.affiche === false || !sv || sv.rayons || Math.abs(aff.W - V.Wg) > 1e-9 * V.Wg || aff.cx || aff.cy) return;
      var n = [64, 48, 32].filter(function (m) { return T.res % m === 0; })[0];
      if (!n) return;
      var cpt = new Float64Array(n * n), img = T.reduire(n, cpt), b = T.res / n, h = 2 * aff.W / n, k = V.s / Math.max(1, nRay) / (mode === "onde" ? b * b : h * h), c = new Float64Array(3 * n * n);
      for (var i = 0; i < c.length; i++) c[i] = img[i] * k;
      if (mode !== "onde") teinteLissee(c, cpt, n);
      halo(c, n, aff.W, sv.seuil);
    }
    // Exposition automatique : 99e centile de l'éclairement des pixels éclairés (une tache d'un point n'en couvre que
    // quelques-uns : un centile sur toute l'image tomberait dans le noir).
    function eclairement() {
      if (!emb || !nRay) return 0;
      return T.centile(0.99) / Math.max(1, nRay) / aire();      // histogramme sur la carte (sans relecture ni tri)
    }
    function exposer() {
      var E = eclairement();
      if (!(E > 0)) return;
      stats.eclairement = E; expoAuto = 0.9 / E;
    }
    function tick() {
      if (!emb) { if (sale) { sale = false; T.effacer(); etat = "repos"; return true; } return false; }
      var now = performance.now();
      if (sale) {
        sale = false; PIL = null;
        // passe d'adaptation : seulement si le montage ou la vue « œil » a changé (zoomer, se déplacer : La inchangé).
        // Changement parti du repos (montage choisi, interrupteur) ou vue « œil » changée : tout de suite ; pendant un
        // geste (aperçus enchaînés) : l'œil garde son adaptation, remesurée au début de l'image fine (en onde, la passe
        // coûte autant qu'un aperçu). Son temps compte dans l'aperçu (qualité adaptative, « Mesurer les temps »).
        var cle = aff.vision ? JSON.stringify(aff.vision) : null;
        stats.adaptMs = 0;
        if (aff.vision && (cle !== cleAdapt || seq !== seqAdapt)) {
          if (!visP || cle !== cleAdapt || etat === "repos") adapterChamp(); else adaptAttente = true;
        }
        T.dimensionner(q().apercu.res); T.raz(); nRay = 0;
        stats.apercuMs = unePasse("apercu", 0) + stats.adaptMs; stats.passes = 0;
        if (adaptAttente && aff.vision) { var th = performance.now(); haloApercu(); stats.haloGeste = geoVoile > 0; stats.apercuMs += performance.now() - th; }
        if (aff.auto) exposer();
        // délai de l'image fine compté depuis la FIN de l'aperçu : un aperçu plus long que le délai (Fourier sur une
        // diapo : 150 à 300 ms) lançait l'image fine à l'image suivante, en plein geste, et le pas suivant l'attendait
        etat = "apercu"; montrer(); tChange = performance.now(); return true;
      }
      if (etat === "apercu" && now - tChange > (opts.delai ? opts.delai() : 150)) {
        etat = "fin"; fin = 0; t0Fin = now; stats.finMs = 0; stats.objectif = passesFin(); stats.bruit = null; PIL = null;
        if (guideActif()) debutPilote(q().fin); else stats.guide = guideOui() && mode !== "onde" && guideRien() ? { rien: true } : null;
      }
      if (etat === "fin") {
        var Q = q().fin, tb = performance.now(), mes = mesureBruit(Q), fini = false;
        // passe pilote d'abord, tracé par tracé dans le budget de l'image (l'aperçu reste affiché, l'accumulateur intact)
        if (PIL) { while (!unitePilote(Q) && performance.now() - tb < (opts.budget || 12)); if (PIL || performance.now() - tb >= (opts.budget || 12)) return false; }
        if (fin === 0) { if (adaptAttente && aff.vision) adapterChamp(); T.dimensionner(Q.res); T.raz(); nRay = 0; ECR = {}; stats.visible = null; }
        do {
          stats.passeMs = unePasse("fin", fin + 1, null, false, { voieB: mes && (fin & 1) === 0 }); fin++; stats.objectif = passesFin();
          fini = mes ? finBruit(Q) : fin >= stats.objectif;
          if (!fini && finVisible(Q)) { fini = true; if (stats.bruit) stats.bruit.raison = "visible"; }
        } while (!fini && performance.now() - tb < (opts.budget || 12));
        if (fini) { etat = "repos"; stats.finMs = performance.now() - t0Fin; if (aff.auto) exposer(); }
        stats.passes = fin; montrer();
        return true;
      }
      return false;
    }
    function reafficher(a) { if (a) aff = a; ECR = {}; if (emb && nRay) montrer(); }
    return { demander: demander, reinit: function () { seq = null; }, tick: tick, reafficher: reafficher, eclairement: eclairement, stats: stats, traceur: T, get etat() { return etat; }, get moteur() { return mode; },
      get plan() { return mode === "onde" ? (planF && planF.ok ? planF : planA) : null; }, get seq() { return seq; },
      // séquence telle que la carte la trace dans la fenêtre affichée (guide compris) et son emballage : un rayon rejoué
      // sur le processeur (`rejouer`) n'est le même que sur CET objet
      get seqTrace() { return emb ? seqGuidee(aff.W, aff.cx || 0, aff.cy || 0) : null; }, get emb() { return emb; } };
  }

  Coeur.VS_TRACE = VS_TRACE;
  Coeur.creerTraceurGL = creerTraceurGL;
  Coeur.creerMoteurBanc = creerMoteurBanc;
  Coeur.centileCroise = centileCroise;
  Coeur.QUALITE_ONDE = QUALITE_ONDE;
  Coeur.LISSE_Y = LISSE_Y;
  root.VITRINE_BANC = Coeur;
})(typeof window !== "undefined" ? window : this);
