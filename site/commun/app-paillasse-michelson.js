// © 2026 Sébastien Reyt — licence GPLv3 (code) : réutilisation et modification libres, en citant l'auteur, tout dérivé restant sous la même licence. https://www.gnu.org/licenses/gpl-3.0.html — textes, figures et pages : CC BY-NC-SA 4.0.
// Code écrit par Claude (Anthropic), un assistant d'IA, à partir des choix physiques et pédagogiques de l'auteur.
/* Instrument « michelson » de la coque paillasse (_app-paillasse.js).
 * Moteur optique : _app-michelson-coeur.js, chargé avant.
 *
 * 1. Partie SANS DOM (module.exports pour node) : état, dérèglement à graine, état → configuration du moteur
 *    (`configOptique`, `feuilleGeom` : la feuille posée sur un miroir), affichage (`affichage`), positions des éléments sur les bancs.
 *    Repère du dessin = vue de dessus, en mm, séparatrice au centre : entrée par le bas (+y), M1 à gauche (−x),
 *    M2 en haut (−y), sortie à droite (+x). Positions sur les bancs en m depuis la séparatrice ; le moteur compte
 *    depuis le plan de M1 le long du trajet (d = ARM + position).
 *    Vis : C3 0,5 mm par tour, le chariotage (lecture du contact tirée et cachée ; au glisser elle suit la vitesse de
 *    la main : ÷3 tout doucement, ×25 lancée, donc 0,5 mm par tour au rythme de la main) ; C1, C2 0,15 mrad par tour (un glisser rapide
 *    accélère), A1, A2 0,02 mrad par tour, selon des axes à 45° de l'horizontale et de la verticale ; B1, B2 :
 *    compensatrice, 2,5 mrad par tour (B1 : axe horizontal, B2 : axe vertical). Lames réelles (séparatrice et
 *    compensatrice BK7 de 6 mm, image fantôme de 5 %) et lamelle couvre-objet : modélisées dans le moteur (cfg.lames,
 *    cfg.lamelle). Le chariot suit la vis C3 en douceur et l'image se brouille pendant un chariotage rapide (rendu.pose) :
 *    jamais d'effet stroboscopique qui ferait paraître les anneaux sortir quand ils rentrent.
 * 2. Interface : dessin semi-réaliste (platine, lames, miroirs, chariot, bancs comprimés gradués en vraies distances),
 *    organes, étagère, observation (écran avec règle, œil avec accommodation, feuille posée sur un miroir),
 *    loupe de C3 et lecture vérifiée.
 */
(function (root) {
  "use strict";
  // Traduction : sans le moteur i18n (node, jsdom des tests, et les pages qui ne le chargent
  // pas), TRAD rend le texte français tel quel — mais il substitue quand même {0}, {1}… :
  // un appel paramétré doit afficher « clic ou touche ? » en français, jamais son gabarit.
  var TRAD = root.VITRINE_I18N ? root.VITRINE_I18N.T : function (s, p) {
    return !p ? s : String(s).replace(/\{(\d+)\}/g, function (m, i) { return p[i] == null ? m : String(p[i]); });
  };
  // Nombres affichés : un seul point de passage, le séparateur décimal de la langue (virgule en
  // français, point en anglais). Hors moteur, I18N est absent : la virgule reste.
  var I18N = root.VITRINE_I18N;
  function nb(v, n) {
    var s = n == null ? String(v) : (+v).toFixed(n);
    return I18N && I18N.dec() === "." ? s : s.replace(".", ",");
  }
  // Pupille de l'œil (diamètre, mm) : st.pupille, pupille STATIONNAIRE que
  // l'instrument tient de l'adaptation mesurée sur l'image (`stats.vision.D` du moteur) ; absente (partie sans DOM,
  // tests) : PUPILLE_DEFAUT. Elle règle la profondeur de champ sur les franges localisées et l'éclairement rétinien.
  var ARM = 0.130, Q_OEIL = 0.017, PUPILLE_DEFAUT = 4;
  // Œil posé (départ, passage de l'écran à l'œil) à 30 cm du plan des miroirs : 3,3 δ pour y accommoder (à 23 cm, il en
  // manquait 0,35 au-delà des 4 δ) ; plus loin, le petit champ de l'œil perd les anneaux (un tiers d'anneau à 43 cm,
  // e = 0,87 mm, contre 0,44 à 30 cm).
  var OEIL_DEPART = 0.17;
  function pupilleDe(st) { return st.pupille > 0 ? st.pupille : PUPILLE_DEFAUT; }
  var KC = 0.15e-3, KA = 0.02e-3, KB = 2.5e-3, C3_MAX = 25, PAS_C3 = 0.5;
  // fantôme : une face de verre nu à 45° en lumière naturelle, (Rs + Rp)/2 = (9,6 % + 0,9 %)/2 ≈ 5 % ; lamelle couvre-objet
  // en verre D 263 M (Schott), pas en BK7.
  var VERRES_LAMES = { t: 0.006, verre: "bk7", fantome: 0.05 }, EP_LAMELLE = 1.7e-4, VERRE_LAMELLE = "d263";
  var S2 = Math.SQRT1_2;
  // Le mercure est toujours la lampe NUE : le filtre vert d'autrefois (« Mercure + filtre vert ») est le filtre
  // interférentiel posé devant elle (st.filtre, `hgVert`).
  var LAMPES = {
    na: { nom: TRAD("lampe à vapeur de sodium"), court: "Sodium", spectre: "na", type: "spectrale", coul: "#ffc23a" },
    hgc: { nom: TRAD("lampe à vapeur de mercure"), court: TRAD("Mercure"), spectre: "hgc", type: "spectrale", coul: "#c3ccff" },
    hgcb: { nom: TRAD("lampe spectrale au mercure basse pression"), court: TRAD("Mercure basse pression"), spectre: "hgcb", type: "spectrale", coul: "#c3ccff" },
    bl: { nom: TRAD("lanterne"), court: TRAD("Lanterne"), spectre: "bl", type: "filament", coul: "#fff1d2" },
    laser: { nom: TRAD("laser He-Ne"), court: "Laser", spectre: "laser", type: "point", coul: "#ff3b2f" }
  };
  var ORDRE_LAMPES = ["na", "hgc", "bl", "laser"];
  // Forme lumineuse vue sans dépoli (plan de la source, x horizontal, y vertical, m) : brûleur d'une lampe spectrale
  // (fenêtre Ø 32 mm) — corps droit de 9 mm de large aux calottes arrondies, centré SUR l'axe (le centre du champ doit
  // rester éclairé), deux cols étroits terminés par la boule de chaque électrode (20 mm de bout en bout) et, à droite au-dessus
  // de l'axe, le queusot (le bout de tube du scellement du verre) : il montre si l'image est renversée. Petite exprès :
  // l'image au condenseur (×2,3 au plus près, ×4,5 par défaut) doit tenir sur la feuille posée sur un miroir ; à ×4,5
  // le corps couvre encore le miroir (Ø 30 mm) en largeur. Plus petite, la lampe éclaire moins le dépoli (`kDepoli`).
  // Filament spiralé d'une halogène : celui du banc (FILAMENT de _app-banc-coeur.js,
  // rectangle 4 × 2 mm, 7 spires, fil plein sur 60 % du pas, penchées de 0,25), le moteur ne prenant que des
  // rectangles droits : chaque spire en 4 marches. Luminance sur le fil : flux = L × 4 × 2 × 0,6 mm².
  function spiralee(a, b, n, plein, pente, m) {
    var p = a / n, w = plein * p, out = [];
    for (var k = 0; k < n; k++) for (var j = 0; j < m; j++) {
      var y0 = -b / 2 + j * b / m, y1 = y0 + b / m, x = (k - 0.5 * (n - 1)) * p + pente * (y0 + y1) / 2;
      out.push({ t: "rect", x0: x - w / 2, y0: y0, x1: x + w / 2, y1: y1 });
    }
    return out;
  }
  var FORMES = {
    spectrale: { rayon: 0.016, forme: [{ t: "rect", x0: -0.0045, y0: -0.005, x1: 0.0045, y1: 0.005 },
      { t: "ell", cx: 0, cy: 0.005, a: 0.0045, b: 0.002 }, { t: "ell", cx: 0, cy: -0.005, a: 0.0045, b: 0.002 },
      { t: "rect", x0: -0.001, y0: 0.0065, x1: 0.001, y1: 0.009 }, { t: "rect", x0: -0.001, y0: -0.009, x1: 0.001, y1: -0.0065 },
      { t: "ell", cx: 0, cy: 0.009, a: 0.0019, b: 0.0012 }, { t: "ell", cx: 0, cy: -0.009, a: 0.0019, b: 0.0012 },
      { t: "rect", x0: 0.004, y0: 0.002, x1: 0.007, y1: 0.0038 }, { t: "ell", cx: 0.007, cy: 0.0029, a: 0.0011, b: 0.001 }] },
    filament: { rayon: 0.0025, forme: spiralee(0.004, 0.002, 7, 0.6, 0.25, 4) }
  };
  var R_DEPOLI = 0.04, IRIS_MIN = 0.00025;
  var MI_ = (root && root.VITRINE_MICHELSON) || (typeof require === "function" ? require("./_app-michelson-coeur.js").Coeur : null);

  // ================= filtres devant la lampe =================
  // Un seul filtre à la fois, sur le porte-dépoli (`st.filtre`, null ou une clé de FILTRES) : il vaut pour TOUTES les
  // lampes, c'est la physique qui décide (laser rouge derrière le filtre vert : presque noir). Couleurs des pastilles et
  // des cartes : la teinte du verre, pas la couleur transmise.
  var FILTRES = {
    rouge: { kind: 1, nom: TRAD("filtre rouge"), court: TRAD("Rouge"), coul: "#e2503f" },
    vert: { kind: 2, nom: TRAD("filtre vert"), court: TRAD("Vert"), coul: "#3fa85a" },
    bleu: { kind: 3, nom: TRAD("filtre bleu"), court: TRAD("Bleu"), coul: "#3f6fd0" },
    interferentiel: { kind: 4, nom: TRAD("filtre interférentiel 546 nm"), court: TRAD("Interférentiel"), coul: "#7fe3a0" }
  };
  var CLES_FILTRE = ["rouge", "vert", "bleu", "interferentiel"], FILTRE_DEFAUT = "interferentiel";
  // Transmission d'un filtre à la longueur d'onde l (nm). Copie de transFiltre de _app-banc-coeur.js : garder les deux
  // identiques (kind 1 rouge, 2 vert, 3 bleu : bandes larges ; 4 : interférentiel vert, 546 nm, 10 nm à mi-hauteur).
  function transFiltre(kind, l) {
    if (kind >= 10) return Math.pow(10, 10 - kind);
    if (kind === 1) return 0.85 / (1 + Math.exp(-(l - 600) / 8));
    var mu = kind === 2 ? 530 : kind === 3 ? 450 : 546, fw = kind === 4 ? 10 : 80, t = (l - mu) / (fw / 2.3548200450309493);
    return (kind === 4 ? 0.6 : 0.75) * Math.exp(-0.5 * t * t);
  }
  function filtre(st) { return st.filtre && FILTRES[st.filtre] ? FILTRES[st.filtre] : null; }
  // « Mercure + filtre vert » n'est plus une lampe : c'est le mercure nu et le filtre interférentiel devant lui. Le
  // moteur le reçoit comme avant (spectres nommés hg / hgb, même luminance : `emission`), d'où l'équivalence exacte.
  function hgVert(st) { return (st.lampe === "hgc" || st.lampe === "hgcb") && st.filtre === "interferentiel"; }
  // Lampe de base d'un état : la pression (basse) est un réglage de l'ampoule au mercure, pas une autre lampe.
  function baseLampe(k) { return k === "hgcb" ? "hgc" : k; }
  // Ce que la lampe envoie à travers le filtre : { cle, lum, part, allumee }, mémorisé par couple (lampe, filtre).
  //  - cle : ce que reçoit le moteur — nom d'un SPECTRES (couleur exacte, bande sans filtre) ou OBJET spectre (mêmes
  //    raies, poids × T(λ), quand le filtre en décale le contenu ; `spectreDe` du cœur accepte les deux) ;
  //  - lum : luminance de la surface qui émet (cd/m²), filtre compris ; null pour une source ponctuelle (son
  //    intensité dépend de l'objectif, `part` la corrige) ;
  //  - part : part de Y transmise (1 sans filtre) ;
  //  - allumee : faux quand le filtre ne laisse rien passer (`lumSource` rend alors LUM_ETEINTE : le moteur calcule sur
  //    du noir, sans planter).
  // Les caches du cœur qui prennent un spectre en CLÉ (`xyzSpectre`, `bandes`, `BANDES`) sérialisent l'objet : rien à
  // faire ici. `luminanceSource` du cœur, elle, n'accepte que des NOMS : la luminance est donc calculée ici.
  var SEUIL_RAIE = 1e-4, N_RAIES_LANTERNE = 8, LUM_ETEINTE = 1e-12, EMIS = {};
  function emission(st) {
    var L = lampe(st), F = filtre(st), cle = st.lampe + "|" + (st.filtre || "");
    if (EMIS[cle]) return EMIS[cle];
    var E;
    if (!F) E = { cle: L.spectre, lum: null, nom: L.spectre, part: 1, allumee: true };
    else if (hgVert(st)) E = { cle: st.lampe === "hgcb" ? "hgb" : "hg", lum: null, nom: st.lampe === "hgcb" ? "hgb" : "hg", part: 1, allumee: true };
    else if (L.type === "point") E = { cle: { raies: [{ l: 632.8, poids: 1 }], profil: "mono", lmoy: 632.8 }, lum: null, nom: "laser",
      part: transFiltre(F.kind, 632.8), allumee: transFiltre(F.kind, 632.8) > 1e-6 };
    else E = spectreFiltre(MI_.spectreDe(L.spectre), F.kind, L.spectre);
    if (!(E.part > 1e-6)) { E.allumee = false; E.part = 0; }     // rien ne passe : la lampe est éteinte derrière le filtre
    EMIS[cle] = E;
    return E;
  }
  // Luminance (ou intensité) de la source, filtre compris. `luminanceSource` du cœur ne prend que des noms : on lui
  // donne celui du spectre NU, et `part` porte le filtre — sauf « mercure + filtre vert », qui garde la sienne.
  function lumSource(st) {
    var E = emission(st);
    if (!E.allumee) return LUM_ETEINTE;     // jamais 0 : le moteur prend `luminance || 1`, et 1 cd/m² n'est pas noir
    if (lampe(st).type === "point") return intensiteLaser(st) * E.part;
    return MI_.luminanceSource(E.nom) * E.part;
  }
  // Spectre d'une lampe à travers un filtre : mêmes raies, poids × T(λ), celles de poids négligeable (< 1e-4 du plus
  // fort) retirées ; continu (lanterne) : 8 raies gaussiennes au plus, de largeur égale à leur espacement, poids =
  // Planck × T aux centres — le filtre interférentiel n'en garde qu'une, à 546 nm sur 10 nm.
  function spectreFiltre(sp, kind, nomNu) {
    var raies = [], i, part, pt = 0, py = 0, pTot = 0, lm = 0, mx = 0, largeur = sp.largeur;
    if (sp.continu) {          // lanterne : Planck × T aux centres de 8 cases, largeur = leur espacement
      var a = sp.continu[0], b = sp.continu[1], pas = (b - a) / N_RAIES_LANTERNE;
      largeur = kind === 4 ? 10 : pas;
      if (kind === 4) raies.push({ l: 546.1, poids: 1 });     // une seule raie : celle du filtre
      else for (i = 0; i < N_RAIES_LANTERNE; i++) {
        var lc = a + (i + 0.5) * pas;
        raies.push({ l: lc, poids: MI_.planck(lc, sp.T) * transFiltre(kind, lc) });
      }
      part = partYContinu(kind);
    } else {
      for (i = 0; i < sp.raies.length; i++) {
        var r = sp.raies[i], w = r.poids * transFiltre(kind, r.l);
        raies.push({ l: r.l, poids: w, largeur: r.largeur });
        pt += r.poids * MI_.cie(r.l)[1]; py += w * MI_.cie(r.l)[1];
      }
      part = pt > 0 ? py / pt : 0;
    }
    for (i = 0; i < raies.length; i++) mx = Math.max(mx, raies[i].poids);
    var gardees = raies.filter(function (r) { return r.poids >= SEUIL_RAIE * mx; });
    if (!gardees.length) gardees = [raies[0]];
    gardees.forEach(function (r) { pTot += r.poids; lm += r.poids * r.l; });
    var out = { raies: gardees.map(function (r) { var o = { l: r.l, poids: r.poids / pTot }; if (r.largeur != null) o.largeur = r.largeur; return o; }),
      profil: sp.profil || "gauss", lmoy: pTot > 0 ? lm / pTot : raies[0].l };
    if (largeur != null) out.largeur = largeur;
    return { cle: out, lum: null, nom: nomNu, part: part, allumee: true };
  }
  // Part de Y d'un continu de Planck (fenêtre du spectre) qui traverse le filtre : quadrature sur la fenêtre.
  var PART_Y = {};
  function partYContinu(kind) {
    if (PART_Y[kind] != null) return PART_Y[kind];
    var sp = MI_.SPECTRES.bl, a = sp.continu[0], b = sp.continu[1], n = 600, s = 0, t = 0;
    for (var i = 0; i < n; i++) {
      var l = a + (i + 0.5) * (b - a) / n, w = MI_.planck(l, sp.T) * MI_.cie(l)[1];
      t += w; s += w * transFiltre(kind, l);
    }
    return (PART_Y[kind] = t > 0 ? s / t : 0);
  }
  // Luminances ABSOLUES (cd/m²) : lampe nue = luminance typique de la partie
  // qui émet (module couleur, `luminanceSource`). Dépoli (verre dépoli posé à D_DEPOLI devant le tube ou le filament,
  // transmission T_DEPOLI, diffusion lambertienne) : L = T E / π, E = L_lampe ∫ cos θ cos θ' dA / r² sur la forme
  // lumineuse (plans parallèles : d² / r⁴ dA). Brûleur à 2 cm : 0,050 L (sodium : 5e3 cd/m²) ; filament : 0,002 L
  // (halogène : 5e4 cd/m²).
  // Dépoli à D de la forme (défaut D_DEPOLI) : même calcul ; derrière le condenseur d'une lanterne, D = son tirage
  // (`source`) : chaque point du dépoli, collé au condenseur, voit le filament à travers lui sous l'angle solide A / t².
  var D_DEPOLI = 0.02, T_DEPOLI = 0.5, K_DEPOLI = {};
  function kDepoli(type, D) {
    D = D || D_DEPOLI;
    var cle = type + "|" + D.toFixed(5);
    if (K_DEPOLI[cle] != null) return K_DEPOLI[cle];
    var F = FORMES[type], n = 200, h = 2 * F.rayon / n, E = 0, d2 = D * D;
    for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) {
      var x = -F.rayon + (i + 0.5) * h, y = -F.rayon + (j + 0.5) * h, r2 = x * x + y * y + d2;
      if (x * x + y * y <= F.rayon * F.rayon && MI_.dansForme(F.forme, x, y)) E += d2 / (r2 * r2) * h * h;
    }
    return (K_DEPOLI[cle] = T_DEPOLI * E / Math.PI);
  }
  var ELEMENTS = {   // f (m), rayon de monture (m), banc
    cond: { banc: "ent", f: 0.06, R: 0.02, nom: "condenseur", defaut: 0.17 },
    coll: { banc: "ent", f: 0.20, R: 0.025, nom: TRAD("lentille 20 cm"), defaut: 0.15 },
    l20: { banc: "sor", f: 0.20, R: 0.025, nom: TRAD("lentille 20 cm"), defaut: 0.12 },
    l1: { banc: "sor", f: 1.0, R: 0.025, nom: TRAD("lentille 1 m"), defaut: 0.12 }
  };
  var BORNES = { ent: [0.07, 0.8], sor: [0.06, 2.5] }, ECART = { ent: 0.025, sor: 0.03 };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function hasardDe(graine) {   // mulberry32, comme le hasard de la coque (partie sans DOM : copie locale)
    var a = graine >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0; var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ================= état =================
  function bancDepart() {
    return { lampe: "na", filtre: null, ent: { lampe: 0.27, cond: null, coll: null, dep: null }, depoli: true, iris: 0.010, lanterne: { cond: true, tirage: TIRAGE_DEFAUT },
      sor: { l20: null, l1: 0.12, ecran: 1.12, oeil: OEIL_DEPART }, det: "ecran", acc: 0, accMode: "infini", feuille: null, vue: "det", porte: 1 };
  }
  // Dérèglement n° graine : contact de C3 dans 5-20 mm, |e| de 0,3 à 3 mm, inclinaison de 2 à 10 mrad (franche :
  // deux taches nettement séparées en autocollimation, deux ronds décalés sur un écran lointain),
  // compensatrice tournée de 5 à 12 mrad sur chaque axe (anneaux nettement elliptiques à la coïncidence
  // du doublet e ≈ 0,29 mm, vérifié au rendu ; à 2,5-7,5 mrad on ne les voyait qu'en deçà de 0,15 mm, sur
  // l'anticoïncidence et avec moins d'un anneau dans le champ ; image fantôme), lamelle de 150 à 180 µm. `doux` (toute première ouverture, écran au foyer de la lentille 1 m) : des anneaux
  // contrastés se voient déjà, ce qui demande (vérifié au rendu) une inclinaison ≤ 0,01 mrad (au-delà, chaque direction
  // reçoit la lumière de toute la largeur des miroirs et les anneaux à l'infini se brouillent) et e près d'une
  // coïncidence du doublet du sodium (e multiple de λ²/2Δλ ≈ 0,29 mm ; à 0,72 mm, anticoïncidence : rien).
  function dereglement(graine, doux) {
    var u = hasardDe(graine), Rc = Math.round((5 + 15 * u()) * 1000) / 1000;
    var e = (doux ? 0.84 + 0.05 * u() : 0.3 * Math.pow(10, u())) * (u() < 0.5 ? -1 : 1);
    var a = (doux ? 0.005 + 0.003 * u() : 2 * Math.pow(5, u())) * 1e-3, th = 2 * Math.PI * u();
    var b1 = (u() < 0.5 ? -1 : 1) * (2 + 2.8 * u()), b2 = (u() < 0.5 ? -1 : 1) * (2 + 2.8 * u());
    var ep = Math.round(150 + 30 * u()) * 1e-6;
    return { graine: graine >>> 0, C3: Math.round(clamp(Rc + e, 0, C3_MAX) * 1e4) / 1e4, c1: 0, c2: 0, a1: 0, a2: 0, b1: 0, b2: 0,
      cache: { Rc: Rc, ax0: a * Math.cos(th), ay0: a * Math.sin(th), b10: b1, b20: b2, ep: ep } };
  }
  function etatDepart(graine, doux) {
    var s = bancDepart(), d = dereglement(graine, doux);
    for (var k in d) s[k] = d[k];
    s.v = 1;
    return s;
  }
  // e (m) ; c3 : position du chariot à prendre (animation), sinon la vis.
  function epaisseur(st, c3) { return ((c3 != null ? c3 : st.C3) - st.cache.Rc) * 1e-3; }
  // Rotation de la compensatrice par rapport à la séparatrice (rad).
  function compensatrice(st) { return { b1: KB * (st.b1 + st.cache.b10), b2: KB * (st.b2 + st.cache.b20) }; }
  function epLamelle(st) { return st.cache.ep || EP_LAMELLE; }
  // Inclinaison de M2* par rapport à M1 : C1, C2 inclinent M2, A1, A2 inclinent M1, selon des axes à 45°.
  function inclinaison(st) {
    var c = st.cache;
    return { ax: c.ax0 + KC * S2 * (st.c1 + st.c2) - KA * S2 * (st.a1 + st.a2),
      ay: c.ay0 + KC * S2 * (st.c1 - st.c2) - KA * S2 * (st.a1 - st.a2) };
  }
  function lampe(st) { return LAMPES[st.lampe] || LAMPES.na; }
  // Lanterne : la lampe halogène dans son boîtier, condenseur
  // intégré (celui du banc : f = 60 mm, Ø 50) à `tirage` du filament, vers l'appareil ; st.lanterne = { cond, tirage (m) },
  // absent = condenseur posé, tirage 80 mm. Sans
  // condenseur : le filament nu d'avant. La position de la lampe (st.ent.lampe) reste celle du filament ; le condenseur
  // est une lentille d'entrée de plus (`entree`), qui suit la lampe. Dépoli et iris se posent alors devant lui :
  // - dépoli : il redevient la source (disque de Ø 50 au plan du condenseur, limité par l'iris), éclairé par le
  //   filament vu à travers le condenseur (`kDepoli` à la distance du tirage : ~15 fois moins qu'un dépoli à 2 cm du
  //   filament nu, mais uniforme), le condenseur en amont ne compte plus ;
  // - iris sans dépoli : c'est la monture du condenseur (rayon min(25 mm, iris)) ; la source reste le filament, que le
  //   condenseur image ; l'iris borne l'ouverture du faisceau et l'angle sous lequel chaque point des miroirs voit la
  //   lumière, comme le diaphragme d'aujourd'hui.
  // Tirage de départ 80 mm (coin d'air au contact en lumière blanche, sans dépoli) : la lampe à
  // 25, 40 ou 80 cm, franges blanches atteintes, plus lumineuses qu'avec le filament nu (×20 à 80 cm). Le moteur perd
  // le contraste quand l'image du filament tombe à quelques cm des miroirs que l'on observe (75 mm à 24,5 cm, 65 mm à
  // 80 cm : disque gris), comme avec le condenseur séparé ; vers 60 mm (filament au foyer), `geometrie` dit le faisceau
  // collimaté et l'étape ne se coche pas, comme avec la lentille de 20 cm.
  var F_COND_L = 0.06, R_COND_L = 0.025, TIRAGE_L = [0.045, 0.12], TIRAGE_DEFAUT = 0.08;
  function lanterne(st) {
    var l = st.lanterne || {};
    return { cond: l.cond !== false, tirage: clamp(l.tirage > 0 ? l.tirage : TIRAGE_DEFAUT, TIRAGE_L[0], TIRAGE_L[1]) };
  }
  function condLanterne(st) { return lampe(st).type === "filament" && lanterne(st).cond; }
  // Longueur de la lampe devant le filament, vers l'appareil (sortie de la lanterne : son condenseur).
  function avantLampe(st) { return condLanterne(st) ? lanterne(st).tirage : 0; }
  // Source vue par l'appareil : dépoli (disque Ø 80 mm) ou forme nue de la lampe, limitée par l'iris posé devant.
  // Sans dépoli, l'iris est à quelques centimètres devant le tube : un iris plus petit que B_FLOU ne découpe pas la
  // forme de la lampe (elle est floue vue de son plan, chaque point de l'iris voit à travers l'appareil une plage de
  // la lampe de cette taille) ; il est vu uniforme, de la luminance moyenne de la lampe sur B_FLOU. Sans cela, un iris
  // fermé tombait au bord de la forme : noir complet.
  var B_FLOU = 0.006, FRAC_FLOU = {};
  function fracForme(type) {   // part de la forme dans le disque de rayon B_FLOU centré sur l'axe
    if (FRAC_FLOU[type] != null) return FRAC_FLOU[type];
    var F = FORMES[type].forme, n = 60, h = 2 * B_FLOU / n, k = 0, t = 0, i, j;
    for (i = 0; i < n; i++) for (j = 0; j < n; j++) {
      var x = -B_FLOU + (i + 0.5) * h, y = -B_FLOU + (j + 0.5) * h;
      if (x * x + y * y > B_FLOU * B_FLOU) continue;
      t++;
      if (MI_.dansForme(F, x, y)) k++;
    }
    return (FRAC_FLOU[type] = k / t);
  }
  // Laser : avec son objectif de microscope (st.lc absent ou vrai), un point source au foyer de l'objectif, faisceau
  // ouvert ; nu (st.lc === false), un faisceau de 0,8 mm de diamètre et 0,5 mrad de divergence, rendu par un point
  // source juste en deçà du foyer d'une lentille fictive de 1 cm, de monture R_LASER (dans `entree`).
  var R_LASER = 0.0004, F_LASER = 0.01, P_LASER = 1 / (1 / F_LASER + 5e-4 / R_LASER), DIV_LASER = 5e-4;
  // Objectif de microscope vissé sur le laser, st.obj = 10, 20 (défaut, celui du
  // banc) ou 40 : le faisceau de 0,8 mm s'ouvre en un cône de demi-angle θ = R_LASER / f (0,025 ; 0,04 ; 0,089 rad).
  // Le moteur n'a pas de cône (un point source éclaire tout) : un diaphragme fictif de rayon θ·D_OBJ, à D_OBJ du point
  // source (`entree`), le borne. Les miroirs (Ø 30 mm) sont couverts en entier par le ×40 partout sur le banc, par le
  // ×20 au-delà de ~25 cm, par le ×10 au-delà de ~50 cm ; plus près, seul un disque central est éclairé. Sur l'écran
  // au foyer de la lentille 1 m, la tache a pour rayon f × min(θ, R_MIROIR / distance) : au ×10 elle reste petite
  // (peu d'anneaux) où que soit le laser ; seul un objectif plus fort l'agrandit. Intensité = Φ / (π θ²) (1 mW).
  // Bague de couleur du barillet : code des fabricants (×10 jaune, ×20 vert, ×40 bleu clair).
  var OBJECTIFS = { 10: { f: 0.016, bague: "#e3c13b" }, 20: { f: 0.010, bague: "#3fae5a" }, 40: { f: 0.0045, bague: "#5fb8e8" } }, D_OBJ = 0.01;
  function objectif(st) { return OBJECTIFS[st.obj] ? +st.obj : 20; }
  function thLaser(st) { return R_LASER / OBJECTIFS[objectif(st)].f; }
  function laserNu(st) { return lampe(st).type === "point" && st.lc === false; }
  // Laser : intensité (cd) = Φ / Ω, Ω = π θ² (θ : demi-angle du cône, celui de la lentille fictive pour le faisceau nu).
  function intensiteLaser(st) { return MI_.fluxLaser() / (Math.PI * Math.pow(laserNu(st) ? R_LASER / P_LASER : thLaser(st), 2)); }
  function source(st) {
    var L = lampe(st), d = ARM + st.ent.lampe;
    if (L.type === "point") return { src: { d: d, rayon: 0, intensite: 1 }, lum: lumSource(st) };
    var k = lumSource(st), F = FORMES[L.type], iris = st.iris != null ? Math.max(IRIS_MIN, st.iris) : Infinity;
    if (condLanterne(st)) {     // lanterne à condenseur : dépoli devant lui, ou le filament
      var t = lanterne(st).tirage;
      if (st.depoli) return { src: { d: d - t, rayon: Math.min(R_COND_L, iris) }, lum: k * kDepoli(L.type, t) };
      return { src: { d: d, rayon: F.rayon, forme: F.forme }, lum: k };
    }
    // lampe spectrale : dépoli et iris sur le porte-dépoli (`porte`), à posDep ; le dépoli éclairé par le tube à la
    // distance qui les sépare (arrondie au 0,1 mm : `kDepoli` garde ses intégrales). Iris seul détaché : un diaphragme
    // d'entrée (`entree`), la source est le tube entier.
    if (st.depoli) {
      if (L.type !== "spectrale") return { src: { d: d, rayon: Math.min(R_DEPOLI, iris) }, lum: k * kDepoli(L.type) };   // filament nu : vissé dessus
      return { src: { d: ARM + posDep(st), rayon: Math.min(R_DEPOLI, iris) },
        lum: k * kDepoli(L.type, Math.max(D_DEPOLI, Math.round((st.ent.lampe - posDep(st)) * 1e4) / 1e4)) };
    }
    if (st.ent.dep != null) return { src: { d: d, rayon: F.rayon, forme: F.forme }, lum: k };
    if (iris < B_FLOU) return { src: { d: d, rayon: iris }, lum: k * fracForme(L.type) };
    return { src: { d: d, rayon: Math.min(F.rayon, iris), forme: F.forme }, lum: k };
  }
  function entree(st) {
    var out = [];
    if (laserNu(st)) out.push({ d: ARM + st.ent.lampe - P_LASER, f: F_LASER, R: R_LASER, nom: "laser" });
    else if (lampe(st).type === "point") out.push({ d: ARM + st.ent.lampe - D_OBJ, R: thLaser(st) * D_OBJ, nom: "objectif" });   // diaphragme seul
    else if (condLanterne(st) && !st.depoli) out.push({ d: ARM + st.ent.lampe - lanterne(st).tirage, f: F_COND_L,
      R: st.iris != null ? Math.min(R_COND_L, Math.max(IRIS_MIN, st.iris)) : R_COND_L, nom: "lanterne" });
    else if (porte(st) && !st.depoli && st.ent.dep != null) out.push({ d: ARM + st.ent.dep, R: Math.max(IRIS_MIN, st.iris), nom: "iris" });   // iris seul, détaché
    ["cond", "coll"].forEach(function (k) {
      if (st.ent[k] != null) out.push({ d: ARM + st.ent[k], f: ELEMENTS[k].f, R: ELEMENTS[k].R, nom: k });
    });
    return out;
  }
  // Feuille posée sur un miroir (st.feuille = "M1" | "M2") : elle couvre le miroir au-delà de son bord `fbord(st)` (mm,
  // même sens que la lamelle ; −30 par défaut : la feuille, plus grande que le miroir, le couvre tout entier). Couvrant
  // tout le miroir, elle arrête son bras (pupille de rayon nul) ; glissée en partie dessus, c'est le demi-plan opaque du
  // moteur (cfg.cache) : derrière son bord, plus de franges et moitié moins de lumière, bord net quand le détecteur est
  // conjugué des miroirs (le petit bout de papier qui aide à faire le point sur eux).
  var R_MIROIR = 0.015, R_CACHE = 1e-9, FBORD_MIN = -30, FBORD_MAX = 16;
  function fbord(st) { return st.fbord != null ? st.fbord : FBORD_MIN; }
  function feuilleEntiere(st) { return fbord(st) <= -R_MIROIR * 1e3; }
  // Lamelle (st.lamelle = {miroir, bord (mm)}) : elle couvre le miroir au-delà de `bord`, compté le long du miroir dans
  // le dessin (M1 : vers la source, M2 : vers la sortie) ; c'est −x dans le repère déplié du moteur.
  // Séparatrice semi-réfléchissante 50/50 : chaque bras ne reçoit que R × T = 1/4 de la lumière (aller et retour) ;
  // le moteur ne le compte pas (séparatrice idéale) : appliqué ici à la luminance passée au moteur.
  var T_SEP = 0.25;
  function configOptique(st, c3) {
    var S = source(st), inc = inclinaison(st), B = compensatrice(st), VL = VERRES_LAMES, c = {
      spectre: emission(st).cle, luminance: S.lum * T_SEP, source: S.src, entree: entree(st),
      miroirs: { e: epaisseur(st, c3), ax: inc.ax, ay: inc.ay, R1: st.feuille === "M1" && feuilleEntiere(st) ? R_CACHE : R_MIROIR, R2: st.feuille === "M2" && feuilleEntiere(st) ? R_CACHE : R_MIROIR },
      lames: { t: VL.t, verre: VL.verre, b1: B.b1, b2: B.b2, d: ARM, fantome: VL.fantome },
      sortie: [], detecteur: {}
    };
    if (st.lamelle) c.lamelle = { bras: st.lamelle.miroir === "M1" ? 1 : 2, ep: epLamelle(st), verre: VERRE_LAMELLE, nx: -1, ny: 0, c: st.lamelle.bord * 1e-3 };
    if (st.feuille && !feuilleEntiere(st)) c.cache = { bras: st.feuille === "M1" ? 1 : 2, nx: -1, ny: 0, c: fbord(st) * 1e-3 };
    ["l20", "l1"].forEach(function (k) {
      if (st.sor[k] != null) c.sortie.push({ d: ARM + st.sor[k], f: ELEMENTS[k].f, R: ELEMENTS[k].R, nom: k });
    });
    if (st.det === "oeil") {
      // œil déplacé latéralement (glisser sur l'image) : pupille et cristallin décalés, la rétine suit
      c.sortie.push({ d: ARM + st.sor.oeil, f: 1 / (1 / Q_OEIL + accommodation(st)), R: pupilleDe(st) / 2000, nom: "oeil", ox: st.oeilX || 0, oy: st.oeilY || 0 });
      c.detecteur.d = ARM + st.sor.oeil + Q_OEIL;
    } else c.detecteur.d = ARM + st.sor.ecran;
    return c;
  }
  // Éclairement de la feuille, en optique géométrique (pas d'interférence : un seul bras). Matrice de transfert
  // (y, θ) de la source au plan des miroirs à travers les lentilles d'entrée : un point source y_s donne une tache de
  // centre A·y_s et de rayon |B|·θmax (θmax : demi-ouverture du faisceau, limitée par la plus petite monture). Au
  // point (B = 0), l'image de la lampe est nette, de grandissement A. Flux conservé : éclairement au point
  // E = L π θmax² / A², étalé par le flou (convolution) ; sans lentille, E = L × aire / d² (uniforme).
  // Iris d'une lampe spectrale nue (accolé au porte-dépoli ou détaché) : pour la feuille, il n'est PAS dans le plan de la
  // lampe (2 cm devant au moins) ; la lampe entière y est imagée et l'iris en assombrit les bords (vignettage : `vig`,
  // part du cône de chaque point source qui passe l'iris), au lieu de la découper d'un disque net. Le moteur, lui, garde
  // la lampe bornée à l'iris (source(st)) : approximation sans conséquence pour les anneaux.
  function feuilleGeom(st) {
    var S = source(st), src = S.src, L0 = lampe(st), vig = null, ent = entree(st);
    if (L0.type === "spectrale" && !st.depoli && st.iris != null) {
      var Fs = FORMES.spectrale;
      vig = { D: Math.max(D_DEPOLI, st.ent.lampe - posDep(st)), R: Math.max(IRIS_MIN, st.iris) };
      src = { d: ARM + st.ent.lampe, rayon: Fs.rayon, forme: Fs.forme };
      S = { src: src, lum: lumSource(st) };
      ent = ent.filter(function (o) { return o.nom !== "iris"; });
    }
    ent = ent.sort(function (a, b) { return b.d - a.d; });
    var A = 1, B = 0, C = 0, Dm = 1, z = src.d, th = Infinity, dl = Infinity;
    function prop(t) { A += t * C; B += t * Dm; }
    ent.forEach(function (o) {
      prop(z - o.d); z = o.d;
      if (o.R > 0 && o.R / Math.max(1e-9, Math.abs(B)) < th) { th = o.R / Math.max(1e-9, Math.abs(B)); dl = Math.abs(B); }
      if (o.f) { C -= A / o.f; Dm -= B / o.f; }
    });
    prop(z);
    // Éclairements en lux : lum = luminance de la forme (cd/m²), E = éclairement au point de l'image nette,
    // après une traversée de la séparatrice (× 0,5).
    // Faisceau nu : section de rayon R_LASER, E = Φ / (π R² A²) ; loin du point, intensité Φ / (π DIV²) = lum × aire.
    if (laserNu(st)) {   // faisceau nu : sa section (rayon R_LASER à la sortie du laser), divergence DIV_LASER
      var Mf = transfert(ent.filter(function (o) { return o.nom !== "laser"; }).map(function (o) { return { z: src.d - P_LASER - o.d, f: o.f }; }), 0, src.d - P_LASER);
      var Phi = MI_.fluxLaser(), Rl2 = R_LASER * R_LASER;
      return { A: Mf.A, B: Mf.B, th: DIV_LASER, rb: Math.abs(Mf.B) * DIV_LASER, forme: [{ t: "ell", cx: 0, cy: 0, a: R_LASER, b: R_LASER }],
        rayon: R_LASER, lum: 0.5 * Phi / (Math.PI * DIV_LASER * DIV_LASER * Math.PI * Rl2), E: 0.5 * Phi / (Math.PI * Rl2 * Math.max(1e-6, Mf.A * Mf.A)), spectre: emission(st).cle };
    }
    // Laser à objectif : point source d'intensité I, rendu comme un petit disque (rayon 0,1 mm) de luminance
    // I / aire, dans le cône de l'objectif (thLaser).
    var laser = !(src.rayon > 0), RL = 1e-4;
    if (!isFinite(th)) th = laser ? thLaser(st) : 0.5;      // sans lentille : la lampe éclaire largement ; laser : son cône
    if (laser) th = Math.min(th, thLaser(st));
    var forme = laser ? [{ t: "ell", cx: 0, cy: 0, a: RL, b: RL }] : src.forme || [{ t: "ell", cx: 0, cy: 0, a: src.rayon, b: src.rayon }];
    var lum = (laser ? S.lum / (Math.PI * RL * RL) : S.lum) * 0.5;      // une traversée de la séparatrice (50/50)
    if (vig) { vig.th = th; vig.dl = dl; }
    return { A: A, B: B, th: th, rb: Math.abs(B) * th, forme: forme, rayon: laser ? RL : src.rayon, lum: lum, vig: vig,
      E: lum * Math.PI * th * th / Math.max(1e-12, A * A), spectre: emission(st).cle };
  }
  // Inclinaison ABSOLUE de M1 (sa normale par rapport à l'axe du banc d'entrée) : sans effet sur les franges (seule
  // l'inclinaison relative compte), elle place le retour de M1 sur l'iris. Tirée de la graine (2 mrad, direction au
  // hasard), sans toucher la suite de `dereglement` ; A₁, A₂ la font varier comme l'inclinaison relative.
  function tiltM1(st) {
    var u = hasardDe((st.graine >>> 0) ^ 0x5bd1e995), a = 2e-3, th = 2 * Math.PI * u();
    return { x: a * Math.cos(th) + KA * S2 * (st.a1 + st.a2), y: a * Math.sin(th) + KA * S2 * (st.a1 - st.a2) };
  }
  // Retour par autocollimation sur la face de l'iris (« Regarder l'iris », réglage de la lentille d'entrée) : la
  // lumière renvoyée par chaque miroir retraverse les lentilles d'entrée et forme une image de l'iris dans son propre
  // plan. Optique géométrique paraxiale, matrice aller-retour (A, B) de l'iris à l'iris par le miroir : image de
  // grandissement A, flou de rayon |B| θmax (θmax : ouverture du faisceau, limitée par les montures et le miroir) ;
  // nette (B = 0) quand l'iris est au foyer de la lentille, quel que soit le bras (principe de l'autocollimation).
  // Images décalées de Bb × (déviation au miroir), Bb = B du miroir à l'iris : 2 θ(M1), 2 θ(M2). Poids : 1/4 par bras
  // (séparatrice 50/50). Pas d'image fantôme de la compensatrice ici : on ne la voit pas sur l'iris (elle se juge à l'œil
  // ou sur l'écran, en autocollimation).
  function irisRetour(st, CO, c3) {
    // plan de l'iris : celui de la source, sauf devant le condenseur d'une lanterne sans dépoli (sa monture)
    var S = source(st), src = { d: S.src.d, rayon: S.src.rayon }, ent;
    if (condLanterne(st) && !st.depoli) { var lc = entree(st).filter(function (o) { return o.nom === "lanterne"; })[0]; src.d = lc.d; src.rayon = lc.R; }
    var ir = entree(st).filter(function (o) { return o.nom === "iris"; })[0];      // iris seul, détaché de la lampe nue
    if (ir) { src.d = ir.d; src.rayon = ir.R; }
    ent = entree(st).filter(function (o) { return o.d < src.d - 1e-9 && o.f; });
    var go = ent.map(function (o) { return { z: src.d - o.d, f: o.f, R: o.R }; });
    var t1 = tiltM1(st), inc = inclinaison(st), B = compensatrice(st);
    function rt(L) {
      var back = go.map(function (o) { return { z: 2 * L - o.z, f: o.f }; });
      var T = transfert(go.concat(back), 0, 2 * L), Tb = transfert(back, L, 2 * L), th = R_MIROIR / Math.max(1e-9, Math.abs(transfert(go, 0, L).B));
      go.forEach(function (o) { th = Math.min(th, o.R / Math.max(1e-9, Math.abs(transfert(go, 0, o.z).B))); });
      return { A: T.A, B: T.B, Bb: Tb.B, th: th };
    }
    var R1 = rt(src.d), R2 = rt(src.d + epaisseur(st, c3)), im = [], VL = VERRES_LAMES;
    if (st.feuille !== "M1") {
      im.push({ x: R1.Bb * 2 * t1.x, y: R1.Bb * 2 * t1.y, w: 0.25, R: R1 });
    }
    if (st.feuille !== "M2") im.push({ x: R2.Bb * 2 * (t1.x + inc.ax), y: R2.Bb * 2 * (t1.y + inc.ay), w: 0.25, R: R2 });
    return { r: src.rayon, images: im, spectre: emission(st).cle };
  }
  var W_VUE = { ecran: 0.09, oeil: 0.07 * Q_OEIL, feuille: 0.045, iris: 0.004 };   // iris : demi-champ fixe (±4 mm), sans zoom : l'iris fermé (autocollimation) se voit bien, grand ouvert ses bords sortent du champ
  function irisVisible(st) { return st.iris != null && lampe(st).type !== "point"; }
  function vue(st) { return st.vue === "feuille" && st.feuille ? "feuille" : st.vue === "iris" && irisVisible(st) ? "iris" : st.det; }
  // Luminosité : st.luminosite = "reelle" (défaut) ou "visible". Réelle : écran
  // (L = ρE/π, regardé des deux yeux à VISION.dObs) et œil (luminance équivalente 289 E / aire de la pupille, un œil)
  // passent par `vision` du module couleur, adaptation mesurée par le moteur sur l'image entière ; une figure sous le
  // seuil de vision (le plus clair du champ sous la moitié du seuil, `adapterVision`) fait « Pas assez de lumière » à
  // l'écran, et aucune étape ne se coche (écran ou œil). Toujours visible : exposition sur le 99e centile du champ,
  // réponse LINÉAIRE (contraste des franges gardé) relevée dans les faibles lumières par un pied (PIED_VISIBLE, fraction
  // du blanc : `parametresVisible` du module couleur), et les étapes se cochent quelle que soit la lumière (la difficulté
  // est retirée). Une réponse en L^0,5 divisait par deux le contraste des franges peu contrastées, bien en dessous de la
  // vision réelle en faible lumière (dont le seuil l'amplifie) ; le pied garde visible une image fantôme de quelques %.
  var PIED_VISIBLE = 0.15;
  function reelle(st) { return st.luminosite !== "visible"; }
  // Réglages de `vision` pour le moteur (cf. creerMoteur du module couleur) : vue "ecran" ou "oeil" ; visible : vue
  // « toujours visible », l'adaptation ne sert plus qu'à la pupille.
  function visionDe(st, v, visible) {
    var V = MI_.VISION, sc = MI_.rapportScotopique(emission(st).cle), o;
    if (v === "oeil") { var p = pupilleDe(st); o = { s: 289 / (Math.PI * p * p / 4), omega: 3283 / (Q_OEIL * Q_OEIL), M: 0.1, pup: p }; }
    else o = { s: V.rho / Math.PI, omega: 3283 / Math.pow(V.dObs / 1000, 2), M: 1 };
    o.Fsalle = 3283 * V.Esalle; o.salle = V.Lsalle; o.scot = sc == null ? -1 : sc;
    if (visible) o.affiche = false;
    else if (lampe(st).type === "point") o.pied = PIED_VISIBLE;   // source ponctuelle (laser) : la tache saturée règle l'œil, son fantôme de ~1 % se perdrait ; même pied qu'en « toujours visible »
    return o;
  }
  // Centre du champ observé : celui de la rétine, qui suit l'œil déplacé latéralement (repère déplié du moteur :
  // x horizontal, vers la droite de l'observateur, c'est-à-dire du côté de M₂ ; y vertical).
  function centreChamp(cfg) {
    var o = (cfg.sortie || []).filter(function (q) { return q.nom === "oeil"; })[0];
    return o ? [o.ox || 0, o.oy || 0] : [0, 0];
  }
  // Scène du Michelson, pour l'ancrage du niveau d'adaptation de l'œil (`a.scene`, lu par le moteur) : repartir d'un
  // réglage déréglé (graine), la vue (écran, œil, iris, feuille) et le mode de luminosité. Tout ce qu'on manipule SUR
  // le banc FOND au contraire : changer de lampe (spectre et filtre), poser ou retirer le dépoli, l'avancer dans la
  // lanterne, glisser une feuille se fait en regardant le champ — la transition rétinienne y a un sens, c'est la
  // variation qu'on veut voir. L'iris, les positions, C₃, la compensatrice, l'œil (position, accommodation) et la
  // pupille n'entrent pas dans la scène du tout.
  function sceneSig(st) {
    return [st.graine, vue(st), reelle(st)].join("|");
  }
  // Affichage du moteur (vues écran et œil ; la feuille et l'iris sont dessinés en 2D) : luminosité réelle (`vision`)
  // ou toujours visible (exposition automatique, `auto`, salle noire comme en réelle, linéaire + pied : `visible`).
  function affichage(st, bal) {
    var v = vue(st), a;
    if (v === "oeil") a = { W: W_VUE.oeil, cx0: st.oeilX || 0, cy0: st.oeilY || 0, expo: 1, bal: bal, fond: [0, 0, 0], cadre: [0, 0, 0, 0], retourne: true };
    else a = { W: W_VUE.ecran, expo: 1, bal: bal, fond: [0, 0, 0], cadre: [8, 8, 432, 432], retourne: false };
    a.scene = sceneSig(st);   // la cible mesurée s'en souvient : c'est elle qui ancre le niveau d'adaptation
    if (v !== "oeil" && v !== "ecran") return a;
    if (reelle(st)) a.vision = visionDe(st, v);
    else { a.auto = true; a.visible = PIED_VISIBLE; if (v === "oeil") a.vision = visionDe(st, v, true); }
    return a;
  }
  // Éléments d'un banc dans l'ordre (position croissante) : [{cle, pos}].
  // Porte-dépoli des lampes spectrales (lampe nue, dépoli et iris sur un même support, posé devant elle sur le banc
  // d'entrée) : st.ent.dep = sa position (plan du dépoli et de l'iris), null = accolé à la lampe (D_DEPOLI devant le
  // tube : il la suit, et la pousse quand on l'éloigne de l'appareil ; le tirer vers l'appareil l'en détache, la lampe
  // ramenée contre lui l'y accole). La lanterne garde ses modules vissés sur le condenseur, le laser n'en a pas.
  function porte(st) { return lampe(st).type === "spectrale" && (!!st.depoli || st.iris != null); }
  function posDep(st) { return st.ent.dep != null ? st.ent.dep : st.ent.lampe - D_DEPOLI; }
  // Ce qui ne tient plus : support sans dépoli ni iris (ou lampe sans support) retiré, support revenu au contact accolé.
  function normaliserPorte(st) {
    if (!porte(st) || (st.ent.dep != null && st.ent.dep >= st.ent.lampe - D_DEPOLI - 2e-4)) st.ent.dep = null;
  }
  // États d'avant le porte-dépoli (st.porte absent) : la position de la lampe était celle du dépoli et de l'iris posés
  // sur elle ; la lampe recule de D_DEPOLI, le plan de la source ne bouge pas.
  // États sauvés : « Mercure + filtre vert » (lampes `hg` / `hgb`, retirées) devient la lampe au mercure nue et le filtre
  // interférentiel posé devant elle — le moteur en reçoit exactement la même chose (`hgVert`). `filtre` absent : aucun.
  function migrer(st) {
    if (st.lampe === "hg") { st.lampe = "hgc"; st.filtre = "interferentiel"; }
    else if (st.lampe === "hgb") { st.lampe = "hgcb"; st.filtre = "interferentiel"; }
    if (st.filtre === undefined) st.filtre = null;
    if (st.porte) return;
    if (porte(st)) st.ent.lampe = Math.min(BORNES.ent[1], Math.round((st.ent.lampe + D_DEPOLI) * 1e5) / 1e5);
    st.ent.dep = null; st.porte = 1;
  }
  function elementsBanc(st, banc) {
    var out = [];
    if (banc === "ent") {
      ["cond", "coll"].forEach(function (k) { if (st.ent[k] != null) out.push({ cle: k, pos: st.ent[k] }); });
      if (porte(st)) out.push({ cle: "dep", pos: posDep(st) });
      out.push({ cle: "lampe", pos: st.ent.lampe });
    } else {
      ["l20", "l1"].forEach(function (k) { if (st.sor[k] != null) out.push({ cle: k, pos: st.sor[k] }); });
      out.push({ cle: st.det, pos: st.sor[st.det] });
    }
    return out.sort(function (a, b) { return a.pos - b.pos; });
  }
  function lirePos(st, banc, cle) { return cle === "dep" ? posDep(st) : banc === "ent" ? st.ent[cle] : st.sor[cle]; }
  function ecrirePos(st, banc, cle, v) { if (banc === "ent") st.ent[cle] = v; else st.sor[cle] = v; }
  // Écart minimal entre deux voisins d'un banc (a plus près de l'appareil que b).
  function ecartMin(st, banc, a, b) {
    if (banc === "ent" && b === "lampe") return a === "dep" ? D_DEPOLI : Math.max(ECART.ent, 0.03 + avantLampe(st));
    return ECART[banc];
  }
  // Déplace d'un bloc les éléments `cles` d'un banc de dv (m), écarts gardés, sans traverser les autres : bloqué par le
  // premier obstacle (voisin, bout du banc). Le porte-dépoli accolé suit la lampe ; poussé loin de l'appareil, il pousse
  // la lampe ; tiré vers l'appareil seul, il s'en détache.
  function deplacerGroupe(st, banc, cles, dv) {
    var L = elementsBanc(st, banc), mem = {}, i;
    cles.forEach(function (k) { mem[k] = true; });
    var acc = banc === "ent" && porte(st) && st.ent.dep == null;
    if (acc && mem.lampe) mem.dep = true;
    if (acc && mem.dep && dv > 0) mem.lampe = true;
    var lo = -Infinity, hi = Infinity, n = 0;
    for (i = 0; i < L.length; i++) {
      var a = L[i];
      if (!mem[a.cle]) continue;
      n++;
      lo = Math.max(lo, BORNES[banc][0] + (a.cle === "lampe" ? avantLampe(st) : 0) - a.pos);
      hi = Math.min(hi, BORNES[banc][1] - a.pos);
      if (i > 0 && !mem[L[i - 1].cle]) lo = Math.max(lo, L[i - 1].pos + ecartMin(st, banc, L[i - 1].cle, a.cle) - a.pos);
      if (i < L.length - 1 && !mem[L[i + 1].cle]) hi = Math.min(hi, L[i + 1].pos - ecartMin(st, banc, a.cle, L[i + 1].cle) - a.pos);
    }
    if (!n) return;
    var d = clamp(dv, lo, Math.max(lo, hi));
    L.forEach(function (a) {
      if (!mem[a.cle]) return;
      if (a.cle === "dep" && acc && mem.lampe) return;           // accolé : il suit la lampe
      ecrirePos(st, banc, a.cle, Math.round((a.pos + d) * 1e5) / 1e5);
    });
    if (banc === "ent") normaliserPorte(st);
  }
  // Déplace un élément sans qu'il traverse ses voisins.
  function deplacer(st, banc, cle, v) { deplacerGroupe(st, banc, [cle], v - lirePos(st, banc, cle)); }
  // Pose un élément à sa place habituelle, ou à la première place libre à côté.
  function poser(st, cle) {
    var E = ELEMENTS[cle], banc = E.banc, L = elementsBanc(st, banc), g = ECART[banc];
    function libre(p) { return L.every(function (x) { return Math.abs(x.pos - p) >= g; }); }
    var p = E.defaut, essais = [];
    for (var k = 0; k < 60; k++) essais.push(E.defaut + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.01);
    for (k = 0; k < essais.length; k++) { p = essais[k]; if (p >= BORNES[banc][0] && p <= BORNES[banc][1] && libre(p)) break; }
    var av = avantLampe(st);
    if (banc === "ent") {
      st.ent[cle] = p;
      if (porte(st)) {        // le porte-dépoli (et la lampe derrière lui) recule derrière la lentille
        if (posDep(st) < p + ECART.ent) {
          if (st.ent.dep == null) st.ent.lampe = Math.min(BORNES.ent[1], p + 0.08 + D_DEPOLI);
          else { st.ent.dep = Math.min(BORNES.ent[1] - D_DEPOLI, p + 0.08); st.ent.lampe = Math.max(st.ent.lampe, st.ent.dep + D_DEPOLI); }
        }
        normaliserPorte(st);
      } else if (st.ent.lampe < p + 0.03 + av) st.ent.lampe = Math.min(BORNES.ent[1], p + 0.08 + av);
    }
    else { st.sor[cle] = p; if (st.sor[st.det] < p + g) st.sor[st.det] = Math.min(BORNES.sor[1], p + 0.08); }
  }

  // Tirage du condenseur de la lanterne (m), borné par l'élément d'entrée qui le précède ; cond : posé ou non. La lampe
  // recule si le condenseur ne tient plus devant elle (lanterne posée, condenseur remis).
  function reglerLanterne(st, tirage, cond) {
    var l = lanterne(st);
    if (cond != null) l.cond = !!cond;
    if (tirage != null) {
      var av = elementsBanc(st, "ent").filter(function (x) { return x.cle !== "lampe" && x.pos < st.ent.lampe; }), base = BORNES.ent[0];
      av.forEach(function (x) { base = Math.max(base, x.pos + 0.03); });
      l.tirage = Math.round(clamp(tirage, TIRAGE_L[0], Math.max(TIRAGE_L[0], Math.min(TIRAGE_L[1], st.ent.lampe - base))) * 1e5) / 1e5;
    }
    st.lanterne = l;
    deplacer(st, "ent", "lampe", st.ent.lampe);
  }
  // Change de détecteur (écran ou œil) : il se place après la dernière lentille de sortie (rien ne sert derrière lui) ;
  // l'œil, jamais plus près que OEIL_DEPART.
  function detecteur(st, d) {
    st.det = d;
    if (d === "oeil" && st.sor.oeil < OEIL_DEPART) st.sor.oeil = OEIL_DEPART;
    var der = 0;
    ["l20", "l1"].forEach(function (k) { if (st.sor[k] != null) der = Math.max(der, st.sor[k]); });
    if (der && st.sor[d] < der + ECART.sor) st.sor[d] = Math.min(BORNES.sor[1], der + (d === "oeil" ? 0.06 : 0.3));
  }

  // ================= mesure de l'observation : étapes détectées, indices =================
  // Tout est MESURÉ sur l'état physique et sur l'image calculée (visibilité des franges, nombre et forme), jamais
  // déclaré par l'élève. CO = le cœur optique (global du cœur, ou require sous node).
  //
  // Matrice de transfert (ρ, θ) le long du trajet, entre z0 et z1, à travers des lentilles [{z, f}] (z croissants).
  function transfert(lent, z0, z1) {
    var A = 1, B = 0, C = 0, D = 1, z = z0;
    function prop(t) { A += t * C; B += t * D; }
    lent.slice().sort(function (a, b) { return a.z - b.z; }).forEach(function (o) {
      if (!(o.z > z0 && o.z < z1)) return;
      prop(o.z - z); z = o.z;
      if (o.f) { C -= A / o.f; D -= B / o.f; }
    });
    prop(z1 - z);
    return { A: A, B: B, C: C, D: D };
  }
  // Géométrie de l'observation : plan objet conjugué du détecteur (zo, m, compté depuis le plan des miroirs vers la
  // sortie ; ±∞ : infini), faisceau d'entrée (image de la source à `ti` m au-delà des miroirs, ±∞ : collimaté ; dépliée
  // par les miroirs, vue de la sortie, elle est en z = ti, comme zo), rayon angulaire de la source vu du centre des
  // miroirs (θs = r / |B| du rayon principal ; collimatée : rayon de son image à l'infini, r / f), déviations des
  // images en autocollimation (2α, fantôme).
  var TOL_MIROIRS = 0.04, TOL_INFINI = 2;
  function geometrie(st, CO, c3) {
    var cfg = configOptique(st, c3), src = cfg.source;
    var Ms = transfert(cfg.sortie.map(function (q) { return { z: q.d, f: q.f }; }), 0, cfg.detecteur.d);
    var Me = transfert(cfg.entree.map(function (o) { return { z: src.d - o.d, f: o.f }; }), 0, src.d);
    var zo = Ms.A !== 0 ? Ms.B / Ms.A : Infinity, ti = Me.D !== 0 ? -Me.B / Me.D : Infinity;
    var inc = inclinaison(st), B = compensatrice(st), g = CO.deviationFantome(CO.normaleCompensatrice(B.b1, B.b2));
    var plan = Math.abs(zo) < TOL_MIROIRS ? "miroirs" : !(Math.abs(zo) < TOL_INFINI) ? "infini" : "autre";
    return { cfg: cfg, Ms: Ms, Me: Me, zo: zo, plan: plan, ti: ti, collimate: !(Math.abs(ti) < 3) && cfg.entree.length > 0,
      thetaS: (src.rayon || 0) / Math.max(1e-9, Math.abs(Me.B)), sep: 2 * Math.hypot(inc.ax, inc.ay), fantome: Math.hypot(g[0], g[1]),
      e: epaisseur(st, c3), alpha: Math.hypot(inc.ax, inc.ay) };
  }
  // Visibilité des franges dans le champ observé, sommée sur la source (o.K points par bras et par pixel, un tirage
  // déterministe) et sur le spectre : grille n × n du détecteur (demi-côté W) ; par point, éclairement I et module du
  // terme d'interférence |Γ| (mêmes échantillons que le rendu : `contributions` du cœur, anti-repliement au pixel de
  // l'image fine) ; V = |Γ| / I. Forme des franges : polynôme de δ du point source central, sur la partie éclairée du champ.
  function mesure(cfg, W, CO, o) {
    o = o || {};
    var n = o.n || 21, res = o.res || 440, sp = CO.spectreDe(cfg.spectre), lm = sp.lmoy * 1e-9, C0 = centreChamp(cfg);
    var prep = CO.preparer(cfg, { res: res, W: W, cx0: C0[0], cy0: C0[1], K: o.K || 16, M: sp.continu ? 24 : 1, graine: 7 }, 0);
    var lam = prep.lam, M = lam.length, SY = prep.somme[1], sig2 = 2 * Math.PI * Math.PI * prep.sigma * prep.sigma, f = [0, 0, 0, 0], ix, iy;
    // Grille recadrée sur la partie éclairée (`boiteEclairee` du cœur, bornée au champ) : un petit iris vu à l'œil
    // n'occupe que quelques % du champ, et une grille du champ entier le manquait (mesure vide).
    var bo = CO.boiteEclairee(prep);
    var x0 = Math.max(C0[0] - W, bo[0]), x1 = Math.min(C0[0] + W, bo[1]), y0 = Math.max(C0[1] - W, bo[2]), y1 = Math.min(C0[1] + W, bo[3]);
    if (!(x1 > x0 && y1 > y0)) { x0 = C0[0] - W; x1 = C0[0] + W; y0 = C0[1] - W; y1 = C0[1] + W; }
    var I = new Float64Array(n * n), G = new Float64Array(n * n), hx = (x1 - x0) / n, hy = (y1 - y0) / n;
    for (iy = 0; iy < n; iy++) for (ix = 0; ix < n; ix++) {
      var X = x0 + (ix + 0.5) * hx, Y = y0 + (iy + 0.5) * hy, It = 0, re = 0, im = 0;
      CO.contributions(prep, X, Y, function (sI, amp, dd, dt, gx, gy, t) {
        It += SY * sI;
        if (!(amp > 0)) return;
        var g2 = (gx * gx + gy * gy) * sig2;
        for (var j = 0; j < M; j++) {
          var L = lam[j]; CO.terme(L, dd, dt, t, g2, f);
          re += amp * (L.W[1] * f[0] - L.V[1] * f[1]); im += amp * (L.W[1] * f[2] + L.V[1] * f[3]);
        }
      });
      I[iy * n + ix] = It; G[iy * n + ix] = Math.hypot(re, im);
    }
    var Imax = 0, p;
    for (p = 0; p < n * n; p++) Imax = Math.max(Imax, I[p]);
    var lit = [], sI = 0, sG = 0, Vmax = 0, mx = 0, my = 0;
    for (p = 0; p < n * n; p++) if (Imax > 0 && I[p] > 0.25 * Imax) {
      var Xp = x0 + (p % n + 0.5) * hx, Yp = y0 + (Math.floor(p / n) + 0.5) * hy;
      lit.push([Xp, Yp, G[p] / I[p]]); sI += I[p]; sG += G[p]; mx += Xp; my += Yp; Vmax = Math.max(Vmax, G[p] / I[p]);
    }
    // part : fraction du CHAMP éclairée (indicative) ; posVmax : distance au centre de la partie éclairée du centre
    // de la zone la plus contrastée (V ≥ 0,85 Vmax : la frange achromatique en lumière blanche), en rayons de cette
    // partie (le seul point le plus contrasté ne convient pas : V sature sur plusieurs franges)
    var nl = lit.length, out = { n: n, W: W, I: I, G: G, cellule: hx * hy, Imax: Imax, Imoy: nl ? sI / nl : 0, part: nl * hx * hy / (4 * W * W), V: sI > 0 ? sG / sI : 0, Vmax: Vmax,
      nfr: 0, quad: 0, centreDedans: false, ratio: 0, P0: null, nl: nl, posVmax: 1 };
    if (!nl) return out;
    mx /= nl; my /= nl;
    var Rl = Math.sqrt(nl * hx * hy / Math.PI);
    var zx = 0, zy = 0, zn = 0;
    lit.forEach(function (c) { if (c[2] >= 0.85 * Vmax) { zx += c[0]; zy += c[1]; zn++; } });
    out.posVmax = Math.hypot(zx / zn - mx, zy / zn - my) / Rl;
    var P0 = CO.pointSource(cfg, { pixel: 2 * W / res, patch: 0, lmoy: sp.lmoy, diffraction: true }, 0, 0);
    var dmin = Infinity, dmax = -Infinity, qmin = Infinity, qmax = -Infinity;
    lit.forEach(function (c) {
      var X = c[0], Y = c[1], d = P0.c0 + P0.cx * X + P0.cy * Y + P0.cxx * X * X + P0.cyy * Y * Y + P0.cxy * X * Y;
      var u = X - mx, w = Y - my, qq = P0.cxx * u * u + P0.cyy * w * w + P0.cxy * u * w;
      dmin = Math.min(dmin, d); dmax = Math.max(dmax, d); qmin = Math.min(qmin, qq); qmax = Math.max(qmax, qq);
    });
    // δ = c0 + g·X + Xᵀ Q X : centre des anneaux −½ Q⁻¹ g, valeurs propres de Q (circularité)
    var a = P0.cxx, c2 = P0.cyy, bb = P0.cxy / 2, det = a * c2 - bb * bb, tr = (a + c2) / 2, dis = Math.sqrt(Math.max(0, tr * tr - det));
    var l1 = tr + dis, l2 = tr - dis;
    out.ratio = l1 * l2 > 0 ? Math.min(Math.abs(l1), Math.abs(l2)) / Math.max(Math.abs(l1), Math.abs(l2)) : 0;
    if (det !== 0) {
      var xc = -(c2 * P0.cx - bb * P0.cy) / (2 * det), yc = -(a * P0.cy - bb * P0.cx) / (2 * det);
      out.centre = [xc, yc]; out.centreDedans = Math.hypot(xc - mx, yc - my) < 0.75 * Rl;
    }
    out.nfr = (dmax - dmin) / lm; out.quad = (qmax - qmin) / lm; out.P0 = P0; out.Rl = Rl;
    return out;
  }
  // Assez de lumière pour voir la figure sur l'écran ? (mesure grossière : 1 à 2 ms, refaite à chaque geste)
  // δ du point source central au CENTRE du champ affiché (base du flou de pose : son balayage entre deux images). À l'œil
  // déplacé, X = 0 n'est plus ce centre : δ y sautait de quelques µm par image quand l'œil bougeait, et toute la figure
  // était floutée pendant le geste.
  function deltaCentre(cfg, aff, CO) {
    var P = CO.pointSource(cfg, {}, 0, 0), X = aff.cx0 || 0, Y = aff.cy0 || 0;
    return P.c0 + P.cx * X + P.cy * Y + P.cxx * X * X + P.cyy * Y * Y + P.cxy * X * Y;
  }
  // Ce que l'œil voit du champ mesuré (`mesure`, lux) en luminosité réelle : adaptation sur la grille (éclairement
  // moyen I) et le reste du champ, noir ; plus clair = franges claires (I + |Γ|). Renvoie `adapterVision` (visible, La,
  // D, seuil…), ou null hors des vues écran et œil.
  function visionMesure(st, m) {
    var v = vue(st);
    if (v !== "ecran" && v !== "oeil") return null;
    var V = visionDe(st, v), nn = m.n * m.n, L = new Float64Array(nn), H = new Float64Array(nn);
    for (var p = 0; p < nn; p++) { L[p] = m.I[p] * V.s; H[p] = (m.I[p] + m.G[p]) * V.s; }
    var a = MI_.adapterVision(L, V.omega * m.cellule, { M: V.M, Fsalle: V.Fsalle, salle: V.salle, scot: V.scot, haut: H,
      noir: Math.max(0, 4 * m.W * m.W / m.cellule - nn) });
    // Source ponctuelle : la tache (une ou deux cases de la grille) peut tomber ENTRE les cases d'une grille de 25 × 25
    // — éclairement mesuré nul, « Pas assez de lumière » à tort devant un point laser bien visible. Le plus clair de la
    // grille fait foi alors (un point lumineux se voit, aussi petit soit-il). Le centile n'est plus en cause : `visible`
    // se lit sur `plusClairDrapeau` (max de blocs 4 × 4), qui garde la tache quelle que soit sa taille.
    if (!a.visible && ponctuelle(st)) {
      var mx = 0; for (p = 0; p < nn; p++) mx = Math.max(mx, H[p]);
      a.visible = mx > 0.5 * a.seuil;
    }
    return a;
  }
  function assezDeLumiere(st, CO, c3) {
    var v = vue(st);
    if ((v !== "ecran" && v !== "oeil") || !reelle(st)) return true;
    // Source ponctuelle (laser élargi par l'objectif) : la tache n'occupe que quelques cases d'une grille de 11 × 11 et
    // peut passer entre elles (éclairement mesuré nul, « Pas assez de lumière » qui saute avec un réglage) ; 25 × 25
    // donne le verdict d'une grille de 41 × 41 sur toutes les positions d'écran et de chariot essayées.
    var V = visionMesure(st, mesure(configOptique(st, c3), v === "oeil" ? W_VUE.oeil : W_VUE.ecran, CO, { n: ponctuelle(st) ? 25 : 11, K: 8 }));
    return !V || V.visible;
  }
  // ================= capteurs posés sur l'écran : barrette, photodiode, fibre du spectromètre =================
  // Calcul exact sur le processeur, à partir d'une passe (`preparer`), sans toucher au moteur : les échantillons utiles
  // en un point (`contributions` du cœur : éclairement, amplitude d'interférence, δ, longueurs d'onde), même lecture
  // que `evaluer` et `mesure`.
  // Deux jeux (st.capReels) : PARFAITS pour montrer la physique (barrette de 15 cm, spectromètre qui résout les
  // cannelures dans une raie), RÉELS comme en TP : barrette Caliens, 2048 pixels de 14 µm (28,7 mm) ; spectromètre
  // fibré à fente de 25 µm (type Ocean Optics USB), ~1,5 nm de résolution : le doublet du sodium n'y est pas séparé.
  var CAPTEURS = {
    parfaits: { L: 0.15, n: 500, res: 0.02, rf: 25e-6, barrette: TRAD("barrette parfaite : 15 cm, 500 points"), fibre: TRAD("spectromètre parfait : fibre de 50 µm, résolution 0,02 nm") },
    reels: { L: 0.02867, n: 2048, res: 1.5, rf: 200e-6, barrette: TRAD("barrette réelle (type Caliens) : 2048 pixels de 14 µm, 28,7 mm"), fibre: TRAD("spectromètre fibré réel : fibre de 400 µm, résolution 1,5 nm") }
  };
  function capteurs(st) { return st && st.capReels ? CAPTEURS.reels : CAPTEURS.parfaits; }
  var L_BARRETTE = CAPTEURS.parfaits.L, N_BARRETTE = CAPTEURS.parfaits.n, RES_SPECTRO = CAPTEURS.parfaits.res;   // m, points, nm (largeur à mi-hauteur)
  // Passe d'un capteur ponctuel : champ de l'écran, pixel réduit (aucune moyenne sur un pixel), graine fixe.
  function passeCapteur(cfg, CO, o) {
    var sp = CO.spectreDe(cfg.spectre);
    return CO.preparer(cfg, { res: 4000, W: W_VUE.ecran, K: o.K || 24, M: sp.continu ? (o.M || 24) : 1, graine: o.graine || 11 }, o.passe || 0);
  }
  // Photodiode (sensibilité photopique Y) au point (X, Y), la différence de marche de toutes les lignes décalée de
  // dc (m) : un petit chariotage depuis la position de la passe (δ varie comme 2e, au terme en i² près, soit moins
  // d'un nm sur les quelques µm parcourus entre deux images). Renvoie [I, I sans interférences].
  function photodiode(prep, CO, X, Y, dc) {
    var lam = prep.lam, M = lam.length, SY = prep.somme[1], I = 0, I0 = 0, f = [0, 0, 0, 0];
    CO.contributions(prep, X, Y, function (s, amp, dd, dt, gx, gy, t) {
      I0 += SY * s;
      if (!(amp > 0)) return;
      dd += dc || 0; dt += dc || 0;
      for (var j = 0; j < M; j++) { var L = lam[j]; CO.terme(L, dd, dt, t, 0, f); I += amp * (L.W[1] * f[0] - L.V[1] * f[1]); }
    });
    return [I0 + I, I0];
  }
  // Barrette : n points sur la portion [a, b] (m, depuis l'extrémité « 0 ») d'un segment de longueur L centré en
  // (x, y), d'angle ang (degrés, sens trigonométrique) ; pixel de la passe = pas des points (des franges plus fines
  // qu'un point donnent un éclairement uniforme). Renvoie l'XYZ de chaque point, moyenné sur `passes` passes.
  function barrette(cfg, CO, c, o) {
    o = o || {};
    var n = o.n || N_BARRETTE, L = o.L || L_BARRETTE, a = (c.ang || 0) * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a);
    var s0 = o.a != null ? o.a : 0, s1 = o.b != null ? o.b : L;
    var sp = CO.spectreDe(cfg.spectre), P = o.passes || 1, out = new Float64Array(3 * n), h = (s1 - s0) / n;
    for (var p = 0; p < P; p++) {
      var prep = CO.preparer(cfg, { res: Math.round(2 * W_VUE.ecran / h), W: W_VUE.ecran, K: o.K || 16, M: sp.continu ? (o.M || 12) : 1, graine: 5 }, p);
      for (var i = 0; i < n; i++) {
        var s = -L / 2 + s0 + (i + 0.5) * h, v = CO.evaluer(prep, c.x + s * ux, c.y + s * uy);
        out[3 * i] += v[0] / P; out[3 * i + 1] += v[1] / P; out[3 * i + 2] += v[2] / P;
      }
    }
    return out;
  }
  // Spectromètre (fibre au point (X, Y)) : densité spectrale par unité de λ (unité arbitraire) sur n colonnes de
  // [la, lb] nm, et la même sans interférences (I0). Chaque colonne lisse sur une gaussienne d'écart-type
  // s = √((res/2,3548)² + pas²/12) (résolution de l'appareil et largeur de la colonne). Tout est intégré sans
  // tirage : une raie gaussienne (écart-type sl en nombre d'onde) × (1 + cos 2πδσ), lissée par une gaussienne
  // d'écart-type sr, donne G(σ − σ0 ; sl² + sr²) [1 + exp(−2π²δ² sl² sr² / (sl² + sr²)) cos 2π(δ σm + φ)], σm =
  // (σ0 sr² + σ sl²) / (sl² + sr²) : les cannelures DANS une raie (δ > ℓc) que l'appareil résout. Continu : Planck ×
  // [1 + exp(−2π²δ² sr²) cos 2πδσ], le cos (avec le retard de phase des lames) lu dans des passes
  // « monochromatiques » de 24 colonnes ; leurs XYZ entrent dans le cache de xyzSpectre (quelques dizaines de clés
  // par changement de fenêtre).
  // Fibre de rayon o.rf (m, mêmes fibres que le banc : 25 et 200 µm) : chaque ligne (un point source) y dessine des
  // franges de gradient ∇δ, moyennées sur le cœur de la fibre comme un pixel dans `evaluer` (gaussienne de même
  // variance qu'un disque uniforme, r²/4 par axe) : facteur exp(−π² σ² |∇δ|² rf² / 2) sur le terme d'interférence.
  // Sans elle (fibre ponctuelle), un point de l'écran loin du contact somme une poignée de lignes de δ très
  // différents (−50 à +75 µm au même point) : des cannelures parasites au pas de ~2 nm, que 1,5 nm ne lisse pas.
  function spectro(cfg, CO, X, Y, o) {
    var sp = CO.spectreDe(cfg.spectre), n = o.n || 240, la = o.la, lb = o.lb, pas = (lb - la) / n, P = o.passes || 1;
    var kf = Math.PI * Math.PI * (o.rf || 0) * (o.rf || 0) / 2;
    var sNm = Math.sqrt(Math.pow((o.res || RES_SPECTRO) / 2.3548200450309493, 2) + pas * pas / 12);
    var l = new Float64Array(n), I = new Float64Array(n), I0 = new Float64Array(n), c, p, k, j;
    for (c = 0; c < n; c++) l[c] = la + (c + 0.5) * pas;
    // f(i1 + i2, amplitude, dd, δ, |∇δ|², t) pour chaque échantillon utile en (X, Y) (`contributions` du cœur) ;
    // élément spectral j : prep.lam[j] (σ = inv, phase φ0 = ph[t])
    function lignes(prep, f) {
      CO.contributions(prep, X, Y, function (s, amp, dd, dt, gx, gy, t) { f(s, amp, dd, dt, gx * gx + gy * gy, t); });
    }
    if (sp.continu) {
      for (var c0 = 0; c0 < n; c0 += CO.MMAX) {
        var cols = [], ls = [];
        for (c = c0; c < Math.min(n, c0 + CO.MMAX); c++) { cols.push(c); ls.push({ l: l[c], poids: 1 }); }
        var spc = { raies: ls, profil: "mono", lmoy: sp.lmoy }, cfc = {};
        for (k in cfg) cfc[k] = cfg[k];
        cfc.spectre = spc;
        var Yc = CO.xyzSpectre(spc)[1];
        for (p = 0; p < P; p++) {
          var prep = CO.preparer(cfc, { res: 4000, W: W_VUE.ecran, K: o.K || 24, M: cols.length, graine: 13 }, p), LA = prep.lam;
          lignes(prep, function (s, amp, dd, dt, g2, t) {
            for (j = 0; j < cols.length; j++) {
              var cc = cols[j], inv = LA[j].inv, sr = sNm * 1e-9 * inv * inv;
              var w = CO.planck(l[cc], sp.T) * Yc / P;
              I0[cc] += w * s;
              I[cc] += w * (s + amp * Math.exp(-2 * Math.PI * Math.PI * dt * dt * sr * sr - kf * g2 * inv * inv) * Math.cos(2 * Math.PI * (LA[j].ph[t] + dd * inv)));
            }
          });
        }
      }
      return { l: l, I: I, I0: I0 };
    }
    var lam = CO.tirage(sp, sp.raies.length), nr = lam.length;
    for (p = 0; p < P; p++) {
      var pr = CO.preparer(cfg, { res: 4000, W: W_VUE.ecran, K: o.K || 24, M: nr, graine: 13 }, p), L2 = pr.lam;
      lignes(pr, function (s, amp, dd, dt, g2, t) {
        for (j = 0; j < nr; j++) {
          var s0 = L2[j].inv, r = sp.raies[j], larg = sp.profil === "mono" ? 0 : (r.largeur != null ? r.largeur : sp.largeur);
          var sl = (sp.profil === "rect" ? larg / Math.sqrt(12) : larg / 2.3548200450309493) * 1e-9 * s0 * s0, ph = L2[j].ph[t] + dd * s0, w = lam[j].w / P;
          for (c = 0; c < n; c++) {
            var sg = 1e9 / l[c], sr = sNm * 1e-9 * sg * sg, st2 = sl * sl + sr * sr, x = sg - s0;
            if (x * x > 50 * st2) continue;
            var G = Math.exp(-x * x / (2 * st2)) / Math.sqrt(2 * Math.PI * st2) * sg * sg * 1e-9, sm = (s0 * sr * sr + sg * sl * sl) / st2;
            I0[c] += w * s * G;
            I[c] += w * G * (s + amp * Math.exp(-2 * Math.PI * Math.PI * dt * dt * sl * sl * sr * sr / st2 - kf * g2 * sg * sg) * Math.cos(2 * Math.PI * (ph + dt * (sm - s0))));
          }
        }
      });
    }
    return { l: l, I: I, I0: I0 };
  }
  // Fenêtre par défaut du spectromètre selon la lampe (nm).
  function fenetreSpectro(lampeK, filtreK) {
    if (filtreK === "interferentiel" && lampeK !== "laser") return [540, 552];     // la seule bande qui passe
    return { na: [587.6, 591.0], hgc: [395, 595], hgcb: [395, 595], bl: [400, 700], laser: [631.8, 633.8] }[lampeK] || [380, 720];
  }

  // Réglages, dans l'ordre où on les fait : ils mènent au Michelson réglé (lame d'air au contact). Trois choses
  // séparées : l'ÉTAT DE L'APPAREIL (compensatrice B, inclinaison α des miroirs, écart e), seul juge des réglages
  // (`niveauReglage`, mesuré sur l'état caché, quels que soient la source et le montage) ; le MONTAGE
  // (éclairement, observation), jamais jugé contre une recette : l'indice mesure ce qu'il produit et essaie des gestes
  // (`diagMontage`). Un réglage se coche donc sans qu'on ait regardé :
  // assumé (validation « par chance » rare). regarde : ce qu'on regarde (bulle de la puce, sans jugement) ; titre et soin :
  // quand la case se coche, quand elle s'étoile.
  var ETAPES = [
    { id: "comp", nom: TRAD("Compensatrice"), regarde: TRAD("à l'œil les images d'un petit trou de lumière données par M₁ seul (feuille sur M₂) : la principale et, plus pâle, son fantôme (reflet sur la compensatrice), à superposer ; ou, près du contact, la rondeur des anneaux."),
      titre: TRAD("la compensatrice est à peu près parallèle à la séparatrice : les images données par M₁ se superposent."), soin: TRAD("parallèle : anneaux bien ronds près du contact.") },
    { id: "grossier", nom: TRAD("Parallélisme grossier"), regarde: TRAD("deux images d'un petit trou de lumière, une par miroir, à superposer (ou les deux taches du laser sans son objectif)."),
      titre: TRAD("les miroirs sont à peu près parallèles : les deux images d'un petit diaphragme se recouvrent."), soin: TRAD("images confondues, diaphragme presque fermé : assez parallèles pour voir des anneaux loin du contact.") },
    { id: "fin", nom: TRAD("Parallélisme fin"), regarde: TRAD("des anneaux à l'infini, dont la zone la plus contrastée gagne le centre ; ou, sur les miroirs, les franges d'un coin d'air, à écarter."),
      titre: TRAD("les miroirs sont parallèles : en lame d'air, la zone la mieux contrastée a gagné le centre, toute la figure est contrastée."), soin: TRAD("épaisseur uniforme à une fraction de longueur d'onde près : les anneaux restent fixes quand l'œil se déplace, dans toutes les directions.") },
    { id: "contact", nom: TRAD("Contact optique"), regarde: TRAD("des anneaux qui rentrent au centre, jusqu'à une teinte plate ; ou, en lumière blanche, les franges colorées."),
      titre: TRAD("la lame d'air est assez mince pour une teinte plate dans tout le champ."), soin: TRAD("au contact à quelques longueurs d'onde près : la lumière blanche y donne des franges (manipulation « Lumière blanche »).") }
  ];
  // Seuils des réglages, sur l'état seul : [atteint, soigné]. Mesurés dans le moteur : compensatrice
  // tournée de |B| = 0,7 mrad : image fantôme déviée de 1 mrad (les images de M₁ se recouvrent encore) ; 0,25 mrad :
  // anneaux ronds à 0,99 près (rapport des axes) à e = 0,1 mm (0,95 à 1 mrad). α = 0,5 mrad : deux taches qui se
  // recouvrent en autocollimation (2α = 1 mrad) ; 0,15 mrad : anneaux centrés sur l'écran dès e = 3 mm. Parallélisme
  // fin, anneaux au foyer de la lentille 1 m, presque sans dépendre de e (0,3 à 1,7 mm) : la zone la mieux contrastée
  // gagne le centre et tout le champ se contraste d'un coup, V 0,14 à 20 µrad, 0,6 à 10 µrad (une frange de coin d'air
  // sur le champ, atteignable aux vis grossières), 0,87 à 5 µrad ; 2 µrad : épaisseur uniforme à λ/10 près sur le
  // miroir, l'ordre au centre bouge de moins d'un sixième d'anneau quand l'œil se déplace de ±1 cm (à l'œil nu, la
  // pupille ne voit qu'une petite zone des miroirs : V 0,9 jusqu'à 20 µrad). |e| = 50 µm : teinte plate au sodium (un
  // sixième d'anneau sur le champ au foyer de la 1 m) ; 1 µm : la lumière blanche y garde un contraste de 0,3.
  var SEUILS = { comp: [0.7e-3, 0.25e-3], grossier: [0.5e-3, 0.15e-3], fin: [5e-6, 2e-6], contact: [50e-6, 1e-6] };
  function grandeurReglage(st, id) {
    if (id === "comp") { var B = compensatrice(st); return Math.hypot(B.b1, B.b2); }
    if (id === "contact") return Math.abs(epaisseur(st));
    var a = inclinaison(st); return Math.hypot(a.ax, a.ay);
  }
  // false, true (atteint) ou "soignee".
  function niveauReglage(st, id) {
    var g = grandeurReglage(st, id), s = SEUILS[id];
    return g < s[1] ? "soignee" : g < s[0];
  }
  // Manipulations : ce que montre un Michelson, sans ordre ni parcours, chacune un constat gardé une fois vu (dans
  // st.etapes, ids des anciennes applications et de l'ancienne étape « blanc » : états sauvés) et une situation qu'on
  // peut poser au mode prof (CONFIGS, manip: true, même id). observe : ce qu'on voit et pourquoi ; etapes : comment
  // faire, gestes seulement, jamais de valeur ; titre : quand la case se coche.
  var MANIPS = [
    { id: "localisation", nom: TRAD("Localisation des franges"),
      observe: TRAD("Avec une source étendue, les franges ne sont nettes que sur une surface, où l'on doit observer. Les anneaux de la lame d'air sont à l'infini : on éclaire avec une source étendue (dépoli et diaphragme ouvert, ou condenseur) et on observe sur l'écran au foyer de la lentille de 1 m, ou à l'œil accommodé à l'infini ; leur contraste ne dépend pas de l'étendue de la source. Les franges du coin d'air sont au voisinage des miroirs : on observe le plan des miroirs, par son image sur l'écran à travers la lentille de 20 cm, ou à l'œil accommodé sur eux ; hors de ce plan, une source étendue les brouille. Avec une source presque ponctuelle (diaphragme presque fermé, ou laser), les franges ne sont plus localisées : on les voit partout, mais un petit diaphragme laisse passer peu de lumière."),
      etapes: [TRAD("Coin d'air un peu à l'écart du contact (tout près du contact, les franges du coin d'air sont nettes partout), éclairé par le dépoli, diaphragme ouvert, l'image des miroirs sur l'écran par la lentille de 20 cm."),
        TRAD("Déplacer l'écran sur le banc de sortie : hors du plan conjugué des miroirs, les franges se brouillent."),
        TRAD("Fermer presque entièrement le diaphragme : les franges reviennent, l'écran hors de ce plan ; elles sont sombres (approcher l'écran de la lentille, ou observer à l'œil).")],
      titre: TRAD("les franges du coin d'air contrastées loin du plan des miroirs, avec une source presque ponctuelle.") },
    { id: "blanc", nom: TRAD("Lumière blanche"),
      observe: TRAD("La lumière blanche ne donne de franges qu'au voisinage immédiat du contact optique, à quelques longueurs d'onde près. Au centre, la frange achromatique, de différence de marche nulle, est commune à toutes les couleurs ; de part et d'autre, quelques franges colorées (les teintes de Newton), puis un blanc d'ordre supérieur, où toutes les couleurs se mêlent. Repérer la frange achromatique situe le contact bien plus précisément que la teinte plate au sodium."),
      etapes: [TRAD("Partir du Michelson réglé : lame d'air au voisinage du contact, teinte plate au sodium."),
        TRAD("Incliner un miroir avec C₁ ou C₂ pour former un coin d'air, et observer le plan des miroirs : leur image sur l'écran par la lentille de 20 cm, ou l'œil accommodé sur eux. Plus il y a de franges, plus le champ couvre d'épaisseurs : le contact s'y trouve plus vite, mais les franges colorées sont plus serrées."),
        TRAD("Remplacer la lampe au sodium par la lanterne, puis charioter très lentement (Ctrl et molette sur C₃), d'un côté puis de l'autre, jusqu'à voir les couleurs.")],
      titre: TRAD("des franges colorées dans le champ, en coin d'air, en lumière blanche (le contact optique devient soigné).") },
    { id: "cannele", nom: TRAD("Spectre cannelé"),
      observe: TRAD("Dans le blanc d'ordre supérieur, l'œil ne voit plus de franges. Pourtant, en un point de différence de marche δ, chaque longueur d'onde garde sa propre intensité, maximale quand δ est un multiple de λ, nulle à mi-chemin : le spectre de la lumière reçue en ce point est cannelé, de bandes sombres régulièrement espacées en 1/λ, distantes de λ²/δ en longueur d'onde. Plus δ est grand, plus elles sont serrées ; plus fines que la résolution du spectromètre, elles ne sont plus séparées."),
      etapes: [TRAD("Franges de lumière blanche dans le champ (manipulation « Lumière blanche »)."),
        TRAD("Poser la fibre du spectromètre sur l'écran (Mesurer ▾, au-dessus de l'image), dans la zone blanche, à quelques franges de la frange achromatique."),
        TRAD("L'éloigner peu à peu de la frange achromatique : les cannelures se resserrent, jusqu'à ce que le spectromètre ne les sépare plus.")],
      titre: TRAD("un spectre cannelé, au moins quatre cannelures bien contrastées, relevé par la fibre en lumière blanche.") },
    { id: "defilement", nom: TRAD("Défilement des anneaux"),
      observe: TRAD("Au centre des anneaux, la différence de marche vaut 2e. Quand le miroir mobile avance de λ/2, elle change d'une longueur d'onde : un anneau naît au centre quand e augmente, un anneau y disparaît quand e diminue. Une photodiode posée au centre suit ce défilement : le nombre de franges comptées sur un déplacement du chariot donne λ ; la longueur d'onde connue, il étalonne la vis."),
      etapes: [TRAD("Anneaux du sodium sur l'écran, au foyer de la lentille de 1 m, assez près du contact pour qu'ils soient larges."),
        TRAD("Poser la photodiode sur l'écran (Mesurer ▾, au-dessus de l'image) et la glisser au centre des anneaux."),
        TRAD("Charioter lentement, toujours dans le même sens : l'éclairement s'inscrit en fonction du déplacement du chariot ; compter les franges entre deux lectures de C₃.")],
      titre: TRAD("la photodiode posée au centre des anneaux.") },
    { id: "rayons", nom: TRAD("Anneaux et épaisseur"),
      observe: TRAD("Les anneaux d'une lame d'air sont d'égale inclinaison. Au foyer d'une lentille de focale f, le carré du rayon d'un anneau croît linéairement avec son numéro, avec une pente f²λ/e : plus la lame est épaisse, plus les anneaux sont serrés. Quand e diminue, ils rentrent au centre."),
      etapes: [TRAD("Anneaux du sodium sur l'écran, au foyer de la lentille de 1 m, plusieurs anneaux dans le champ."),
        TRAD("Poser la barrette sur l'écran (Mesurer ▾, au-dessus de l'image) et relever les rayons des anneaux."),
        TRAD("Charioter pour changer l'épaisseur, et recommencer : la pente change.")],
      titre: TRAD("au moins cinq anneaux du sodium sur l'écran, barrette posée.") },
    { id: "coherence", nom: TRAD("Longueur de cohérence"),
      observe: TRAD("Une raie n'est jamais parfaitement fine. Sa largeur limite les différences de marche qui donnent encore des franges : en s'éloignant du contact, le contraste diminue, puis s'annule au-delà de la longueur de cohérence, de l'ordre de λ²/Δλ. En lame d'air, l'étendue de la source n'y est pour rien ; en coin d'air, une source étendue brouille aussi les franges quand e grandit, et il faut fermer le diaphragme pour ne voir que l'effet de la raie."),
      etapes: [TRAD("Anneaux au voisinage du contact, en lame d'air, observés à l'infini, au mercure avec son filtre interférentiel devant elle (au sodium, le brouillage du doublet vient bien avant). Ou bien un coin d'air observé dans le plan des miroirs, la source peu étendue."),
        TRAD("Charioter toujours dans le même sens en suivant le contraste : les franges pâlissent, jusqu'à disparaître."),
        TRAD("Lire C₃ au contact et au brouillage : la différence de marche vaut le double du déplacement du miroir.")],
      titre: TRAD("franges ou anneaux brouillés par la largeur de la raie, à une épaisseur où la géométrie seule en donnerait encore.") },
    { id: "mercure", nom: TRAD("Mercure sans filtre"),
      observe: TRAD("Sans son filtre, la lampe au mercure donne plusieurs raies : la verte, le doublet jaune, des raies bleues et violettes. Chacune donne ses franges, d'interfrange propre : elles ne restent en phase qu'au voisinage immédiat du contact. Plus loin, celles de la raie verte et du doublet jaune, les plus lumineuses, se décalent puis se retrouvent : le contraste fluctue d'une région du champ à l'autre et reste en deçà de celui de la raie verte seule. Le filtre ne garde qu'une raie, et des franges régulières."),
      etapes: [TRAD("Coin d'air près du contact, observé dans le plan des miroirs, à la lampe au mercure sans filtre."),
        TRAD("Incliner davantage un miroir avec C₁ ou C₂ : beaucoup de franges dans le champ, dont le contraste varie le long du coin d'air."),
        TRAD("Comparer avec le filtre interférentiel devant la lampe (étagère, onglet Entrée, carte Filtre) : même figure, contraste régulier.")],
      titre: TRAD("franges ou anneaux du mercure sans filtre nettement moins contrastés que ceux de la raie verte seule, au même réglage.") },
    { id: "doublet", nom: TRAD("Doublet du sodium"),
      observe: TRAD("La lumière du sodium contient deux raies très proches, et chacune donne ses anneaux. Quand l'épaisseur change, les deux systèmes glissent l'un par rapport à l'autre : là où les anneaux brillants de l'un tombent sur les sombres de l'autre (anticoïncidence), le contraste s'annule ; il revient quand ils coïncident de nouveau. Le déplacement du miroir entre deux anticoïncidences donne l'écart entre les deux raies."),
      etapes: [TRAD("Anneaux du sodium bien contrastés, en lame d'air, observés à l'infini."),
        TRAD("Charioter lentement, toujours dans le même sens : le contraste diminue, s'annule, puis revient."),
        TRAD("Pour une mesure, lire C₃ à deux brouillages successifs, appareil au repos.")],
      titre: TRAD("les anneaux du sodium vus brouillés, puis de nouveau contrastés plus loin.") },
    { id: "laser", nom: "Laser",
      observe: TRAD("La raie d'un laser est si fine que sa longueur de cohérence dépasse de loin la course du chariot : ses anneaux restent contrastés à toute épaisseur, là où ceux du sodium se sont brouillés. Source ponctuelle, il donne des franges non localisées : sur l'écran, où qu'il soit."),
      etapes: [TRAD("Remplacer la lampe par le laser, objectif vissé : des anneaux sur l'écran."),
        TRAD("Charioter loin du contact, aussi loin que le permet la course du chariot : les anneaux se resserrent, mais restent contrastés.")],
      titre: TRAD("les anneaux du laser contrastés loin du contact, au-delà de la longueur de cohérence du sodium.") },
    { id: "rolecomp", nom: TRAD("Rôle de la compensatrice"),
      observe: TRAD("La lumière qui va vers M₂ traverse trois fois la séparatrice ; celle qui va vers M₁, une fois la séparatrice et deux fois la compensatrice, du même verre et de même épaisseur. Parallèle à la séparatrice, la compensatrice égalise les épaisseurs de verre traversées, pour toutes les directions et toutes les couleurs. Tournée, elle ajoute dans un bras une épaisseur de verre qui dépend de la direction : les anneaux deviennent elliptiques, et le contact optique (la frange achromatique) se déplace sur la course du chariot."),
      etapes: [TRAD("Anneaux du sodium près du contact, en lame d'air, observés à l'infini, compensatrice réglée : bien ronds."),
        TRAD("Tourner la compensatrice avec B₁ ou B₂ : les anneaux s'allongent en ellipses."),
        TRAD("La régler de nouveau (anneaux ronds) avant de passer à autre chose.")],
      titre: TRAD("des anneaux nettement elliptiques près du contact, compensatrice tournée.") },
    { id: "lamelle", nom: TRAD("Lamelle"),
      observe: TRAD("Une lamelle de verre d'épaisseur ε posée sur un miroir allonge l'aller-retour de la lumière dans ce bras : derrière elle, les franges de lumière blanche disparaissent. On les retrouve en déplaçant le miroir mobile de (n − 1)ε, n étant l'indice du verre (en lumière blanche, plus exactement, son indice de groupe) : de quoi mesurer l'épaisseur ou l'indice de la lamelle."),
      etapes: [TRAD("Franges de lumière blanche en coin d'air (manipulation « Lumière blanche »)."),
        TRAD("Poser la lamelle sur un miroir, sur une partie du faisceau seulement (étagère, onglet Accessoires) : les franges disparaissent derrière elle."),
        TRAD("Charioter lentement jusqu'à les faire réapparaître derrière la lamelle.")],
      titre: TRAD("les franges de lumière blanche retrouvées derrière la lamelle.") }
  ];
  function estManip(id) { return MANIPS.some(function (x) { return x.id === id; }); }
  // États sauvés d'avant les réglages sur l'état : « Deux taches » devient le parallélisme grossier,
  // « Franges rectilignes » et « Anneaux » le parallélisme fin (le mieux des deux) ; la coche « au laser » disparaît
  // (l'état de l'appareil est le même quelle que soit la source : l'analyse suivante recoche ce qui est atteint).
  function migrerEtapes(et) {
    var rang = function (f) { return f === "soignee" ? 2 : f === true ? 1 : 0; }, nom = ["", true, "soignee"];
    if ("taches" in et) { if (rang(et.taches)) et.grossier = nom[rang(et.taches)]; delete et.taches; }
    if ("rect" in et || "anneaux" in et) { var r = Math.max(rang(et.rect), rang(et.anneaux)); if (r) et.fin = nom[r]; delete et.rect; delete et.anneaux; }
    for (var k in et) if (et[k] === "laser") delete et[k];
    return et;
  }
  // Source presque ponctuelle : laser, ou diaphragme presque fermé (devant le dépoli ou la lampe nue ; devant la
  // lanterne sans dépoli, l'iris est la monture du condenseur et ne réduit pas la source, le filament).
  var IRIS_PONCT = 1.5e-3, E_LASER = 10e-3;
  function ponctuelle(st) {
    return lampe(st).type === "point" || (st.iris != null && st.iris <= IRIS_PONCT && (st.depoli || !condLanterne(st)));
  }
  // Cannelures d'un spectre (`spectro`) : nombre de périodes de I − I0 (changements de signe de l'écart relatif,
  // au-delà de 5 %, divisés par deux) et contraste maximal |I − I0| / I0.
  function cannelures(s) {
    var z = 0, amp = 0, prec = 0;
    for (var c = 0; c < s.l.length; c++) {
      var r = s.I0[c] > 0 ? (s.I[c] - s.I0[c]) / s.I0[c] : 0;
      amp = Math.max(amp, Math.abs(r));
      if (Math.abs(r) > 0.05) { if (prec && (r > 0) !== (prec > 0)) z++; prec = r; }
    }
    return { n: z / 2, amp: amp };
  }
  // Raie d'une lampe spectrale (enveloppe de cohérence) et version monochromatique (visibilité de la seule géométrie).
  function mono(sp) { return { raies: [{ l: sp.lmoy, poids: 1 }], profil: "mono", lmoy: sp.lmoy }; }
  // Analyse complète : géométrie, réglages, mesure dans le champ, puis les constats des manipulations.
  // Réglages (R.ok = atteint, R.top = soigné) : sur l'ÉTAT de l'appareil seul (`niveauReglage`), avant toute mesure.
  // R.vu : ce qu'on voit (figures utiles aux indices et aux constats : anneaux, franges du coin d'air) ; seuils
  // choisis pour qu'une figure nette à l'œil compte (anneaux à 0,87 mm, 51 franges de coin d'air, iris de 3 mm).
  function analyse(st, CO, o) {
    o = o || {};
    var G = geometrie(st, CO, o.c3), cfg = G.cfg, v = vue(st), L = lampe(st), sp = CO.spectreDe(cfg.spectre);
    var W = st.det === "oeil" ? W_VUE.oeil : W_VUE.ecran, R = { G: G, ok: {}, top: {}, vu: {}, laser: {} };
    ETAPES.forEach(function (d) { var n = niveauReglage(st, d.id); R.ok[d.id] = !!n; R.top[d.id] = n === "soignee"; });
    if (st.feuille || v === "feuille" || v === "iris") { R.m = null; return R; }
    var m = R.m = mesure(cfg, W, CO, o);
    R.vis = reelle(st) ? visionMesure(st, m) : null;
    R.sombre = !!R.vis && !R.vis.visible;
    if (R.sombre || !m.nl) return R;               // rien de visible : aucun constat mesuré sur l'image
    var etendue = !G.collimate && L.type !== "point";   // les franges localisées demandent une source étendue
    // au laser à objectif (source ponctuelle : anneaux non localisés, sur l'écran où qu'il soit) : mêmes critères de
    // figure que les anneaux à la lampe, sans condition de plan (manipulation « Laser »)
    if (L.type === "point" && !laserNu(st) && st.det === "ecran")
      R.laser.anneaux = m.V > 0.35 && m.nfr >= 0.35 && m.centreDedans && m.ratio > 0.8;
    var visible = m.V > 0.35;
    R.vu.coin = G.plan === "miroirs" && L.type !== "filament" && etendue && visible && m.nfr >= 1.5 && m.quad < 1;
    R.vu.anneaux = G.plan === "infini" && etendue && visible && m.nfr >= 0.35 && m.centreDedans && m.ratio > 0.8;
    R.ok.blanc = !!sp.continu && G.plan === "miroirs" && etendue && m.Vmax > 0.5 && m.nfr >= 1.5;
    if (!sp.continu && (st.lampe === "na" || hgVert(st) || st.lampe === "hgcb") && (G.plan === "infini" || G.plan === "miroirs") && etendue) {
      // brouillage : la géométrie seule donnerait des franges (raie fine), la vraie lumière non. En coin d'air (plan des
      // miroirs), le contraste tombe aussi avec e par l'étendue de la source : la même mesure en raie infiniment fine
      // (Vgeom) le démêle. Mercure au filtre interférentiel, coin d'air de CONFIGS (lampe nue loin) : V 0,97 au contact, 0,19 à
      // 0,1 mm, 0,03 à 0,15 mm, Vgeom 0,92 ; au dépoli grand ouvert, Vgeom baisse aussi (0,43 à 0,15 mm).
      var cm = {}; for (var k in cfg) cm[k] = cfg[k];
      cm.spectre = mono(sp);
      var mm = mesure(cm, W, CO, { n: 15, K: o.K });
      var lam = CO.tirage(sp, 1)[0], env = CO.enveloppe(lam.kappa, lam.rho, m.P0 ? m.P0.c0 : 0);
      R.Vgeom = mm.V; R.env = env;
      // seuil géométrique 0,25 : au sodium (ℓc ≈ 2,9 cm), le brouillage vient vers e ≈ 10 mm, où les anneaux du bord du
      // champ (foyer de la 1 m) approchent le pixel de la mesure : Vgeom 0,55 à 10 mm, 0,31 à 15,5 mm ; un brouillage
      // par les miroirs inclinés donne Vgeom ≈ 0.
      R.ok.coherence = mm.V > 0.25 && m.V < 0.12 && env < 0.2;
      R.anti = st.lampe === "na" && G.plan === "infini" && mm.V > 0.5 && m.V < 0.2 && env > 0.5;
    }
    // Mercure sans filtre : contraste comparé à celui de la raie verte seule, même géométrie. Les raies ont toutes la
    // largeur de la verte (cœur) : le brouillage final vient à la même épaisseur ; avant, la verte et le doublet jaune
    // battent (période ≈ 10 µm de δ), le contraste fluctue entre 0,6 et 0,95 du vert. Coin d'air au contact :
    // rapport 0,87 à 0,12 mrad (14 franges), 0,78 à 0,25 mrad (30 franges, contraste local de 0,52 à 0,92) ; lame
    // d'air : 0,62 à 1 µm, 0,64 à 22 µm, 0,71 à 50 µm. Seuil 0,82.
    // (au filtre interférentiel, c'est déjà la raie verte seule : rien à comparer)
    if (!hgVert(st) && (st.lampe === "hgc" || st.lampe === "hgcb") && etendue && (G.plan === "infini" || G.plan === "miroirs")) {
      var cv = {}; for (var kv in cfg) cv[kv] = cfg[kv];
      cv.spectre = st.lampe === "hgcb" ? "hgb" : "hg";     // noms de SPECTRES du moteur : la raie verte seule
      R.Vvert = mesure(cv, W, CO, { n: 15, K: 8 }).V;
      R.ok.mercure = R.Vvert > 0.5 && m.V < 0.82 * R.Vvert;
    }
    // Localisation : franges du coin d'air contrastées hors du plan des miroirs, source presque ponctuelle (laser, ou
    // diaphragme presque fermé). Au contact même, elles ne sont localisées nulle part (δ = 2αx quelle que soit
    // l'incidence) : il faut s'en écarter. Sodium, dépoli, coin d'air de 0,12 mrad à e = 0,05 mm : écran à 3 cm du plan
    // conjugué des miroirs, V 0,11 diaphragme ouvert, 0,82 à 1 mm ; à 9 cm, 0,05 et 0,75.
    R.ponctuelle = ponctuelle(st);
    R.ok.localisation = R.ponctuelle && G.plan !== "miroirs" && Math.abs(G.e) >= 0.02e-3 && m.V > 0.5 && m.nfr >= 1.5 && m.quad < 1;
    // Défilement : photodiode au centre des anneaux (à moins d'un quart d'ordre du centre : δ y diffère de celui du
    // centre de moins de λ/4).
    var cap = st.capteur;
    if (cap && cap.type === "photodiode" && v === "ecran" && G.plan === "infini" && etendue && visible && m.centreDedans && m.P0) {
      var P = m.P0, dq = function (X, Y) { return P.cx * X + P.cy * Y + P.cxx * X * X + P.cyy * Y * Y + P.cxy * X * Y; };
      R.pdCentre = Math.abs(dq(cap.x, cap.y) - dq(m.centre[0], m.centre[1])) < sp.lmoy * 1e-9 / 4;
      R.ok.defilement = R.pdCentre && (st.lampe === "na" || hgVert(st));
    }
    // Laser : anneaux contrastés loin du contact, au-delà de la longueur de cohérence du sodium (V du sodium 0,04 à
    // 10 mm ; celui du laser 0,60, limité par la seule finesse des anneaux sur la grille de la mesure).
    R.ok.laser = !!R.laser.anneaux && Math.abs(G.e) >= E_LASER;
    // Compensatrice tournée : anneaux elliptiques près du contact (sodium, e = 0,1 mm : rapport des axes 0,95 à
    // 1 mrad, 0,80 à 5 mrad, 0,63 à 10 mrad). En lumière blanche, le contact se déplace (4 µm par mrad selon B₂),
    // la frange achromatique reste contrastée (0,97 à 20 mrad, 0,92 à 40 mrad) : seule l'ellipse fait le constat.
    R.ok.rolecomp = G.plan === "infini" && etendue && visible && m.centreDedans && m.nfr >= 0.35 && Math.abs(G.e) < 0.35e-3 && m.ratio < 0.85;
    // Spectre cannelé : fibre posée en lumière blanche, au moins quatre cannelures (δ ≳ 4 µm : blanc d'ordre
    // supérieur) bien contrastées dans 400-700 nm. Spectromètre réel (1,5 nm, fibre de 400 µm), coin d'air : 5
    // cannelures à δ = 5 µm, 20 à 20 µm, contraste 0,83 à 50 µm, 0,51 à 100 µm, 0,08 à 200 µm (non résolues).
    if (cap && cap.type === "fibre" && sp.continu && v === "ecran") {
      var CA = capteurs(st), s = spectro(cfg, CO, cap.x, cap.y, { la: 400, lb: 700, n: 150, res: CA.res, rf: CA.rf, K: 12 });
      R.cannele = cannelures(s);
      R.ok.cannele = R.cannele.n >= 4 && R.cannele.amp > 0.3;
    }
    R.ok.rayons = st.lampe === "na" && v === "ecran" && !!st.capteur && st.capteur.type === "barrette" && G.plan === "infini" && etendue && visible && m.nfr >= 5 && m.centreDedans;
    if (st.lamelle && Math.abs(st.lamelle.bord) < 12 && !!sp.continu && G.plan === "miroirs") {
      var cl = {}; for (var kk in cfg) cl[kk] = cfg[kk];
      cl.lamelle = {}; for (var k2 in cfg.lamelle) cl.lamelle[k2] = cfg.lamelle[k2];
      cl.lamelle.c = -1;                         // la lamelle couvre tout le miroir : la partie du champ derrière elle
      var ml = mesure(cl, W, CO, o);
      R.Vlamelle = ml.Vmax;
      R.ok.lamelle = ml.Vmax > 0.5 && ml.nfr >= 1;
    }
    return R;
  }

  // ================= indice gradué =================
  // La première condition fausse de l'étape visée donne la phrase (niveau 1 : le TP, adapté à ce qu'on voit) ;
  // niveau 2 : l'organe et le sens du geste, jamais une valeur. Les sens se lisent sur l'état caché (signe de e, de α,
  // de la rotation de la compensatrice) : ils trahissent un signe, pas une grandeur.
  // Vis : axe « y » (C₁, C₂, C₃, B₂) : rouler vers la droite = tourner dans le sens +, molette vers le haut aussi ;
  // axe « x » (A₁, A₂, B₁) : rouler vers le haut = sens +.
  var AXE_VIS = { C1: "y", C2: "y", C3: "y", B2: "y", A1: "x", A2: "x", B1: "x" };
  var NOM_VIS = { C1: "C₁", C2: "C₂", C3: "C₃", A1: "A₁", A2: "A₂", B1: "B₁", B2: "B₂" };
  function geste(id, signe) {
    var s = signe > 0 ? (AXE_VIS[id] === "y" ? TRAD("vers la droite") : TRAD("vers le haut")) : (AXE_VIS[id] === "y" ? TRAD("vers la gauche") : TRAD("vers le bas"));
    return TRAD("Faire rouler {0} {1}{2}", [NOM_VIS[id], s, (id === "C3" ? TRAD(" (ou molette vers le {0}).", [signe > 0 ? TRAD("haut") : TRAD("bas")]) : ".")]);
  }
  // e (m) vers la cible : C₃ augmente e.
  function gesteC3(st, cible) { return geste("C3", (cible || 0) - epaisseur(st) > 0 ? 1 : -1); }
  // Annuler α : la vis (C, ou A si fin) qui demande le plus de tours, et son sens.
  function gesteAlpha(st, fin) {
    var a = inclinaison(st), u = (a.ax + a.ay) / Math.SQRT2, w = (a.ax - a.ay) / Math.SQRT2;
    if (fin) return Math.abs(u) >= Math.abs(w) ? geste("A1", u) : geste("A2", w);      // A incline M₁ : sens opposé
    return Math.abs(u) >= Math.abs(w) ? geste("C1", -u) : geste("C2", -w);
  }
  // Étape 1 : la régler à la main, ou la faire régler (bandeau de la compensatrice, choisie d'un clic sur ses lames).
  var POUR_MOI = TRAD(" Pour sauter l'étape : un clic sur la compensatrice, puis « Régler la compensatrice ».");
  function gesteComp(st) {
    var b1 = st.b1 + st.cache.b10, b2 = st.b2 + st.cache.b20;
    return Math.abs(b1) >= Math.abs(b2) ? geste("B1", -b1) : geste("B2", -b2);
  }
  // Image de la source par les lentilles d'entrée, vue de la sortie (dépliée par les miroirs) : z (m) compté depuis les
  // miroirs vers la sortie, négatif derrière eux ; ±∞ : source à l'infini (collimatée), comme `ti` de `geometrie`.
  function zSource(st) {
    var src = source(st).src, ent = entree(st);      // sans configOptique : celle-ci lit l'accommodation, qui lit zSource
    var Me = transfert(ent.map(function (o) { return { z: src.d - o.d, f: o.f }; }), 0, src.d);
    var ti = Me.D !== 0 ? -Me.B / Me.D : Infinity;
    return Math.abs(ti) < 3 || !ent.length ? ti : Infinity;
  }
  // Image par les lentilles de sortie du plan des miroirs (cible "miroirs"), de l'infini ("infini") ou de la source
  // (« source » : `zSource`) : t (m) au-delà de la dernière lentille, en zl (±∞ : à l'infini).
  function imageSortie(st, cible) {
    var lent = [], zl = 0, z0 = cible === "source" ? zSource(st) : cible === "miroirs" ? 0 : Infinity;
    ["l20", "l1"].forEach(function (k) { if (st.sor[k] != null) { lent.push({ z: ARM + st.sor[k], f: ELEMENTS[k].f }); zl = Math.max(zl, ARM + st.sor[k]); } });
    if (!isFinite(z0)) { var Mi = transfert(lent, 0, zl + 1e-9); return { lent: lent, zl: zl, t: Mi.C ? -Mi.A / Mi.C : Infinity }; }
    var M = transfert(lent, Math.min(z0, 0), zl + 1e-9);
    return { lent: lent, zl: zl, t: M.D ? -M.B / M.D : Infinity };
  }
  // Accommodation (δ) qui rend net, à l'œil, le plan des miroirs ou l'infini : { acc, u } (u : distance de l'objet de
  // l'œil, devant lui ; u ≤ 0 : le faisceau converge derrière l'œil). acc hors de 0-4 δ : hors de portée.
  function accPour(st, cible) {
    var I = imageSortie(st, cible), u = isFinite(I.t) ? ARM + st.sor.oeil - I.zl - I.t : Infinity;
    return { u: u, acc: isFinite(u) ? 1 / u : 0 };
  }
  // Accommodation de l'œil : st.accMode "infini" ou "miroirs" (l'œil accroche seul ce plan, comme un œil réel accroche
  // les franges : l'élève choisit OÙ regarder, pas la mise au point), ou "main" (st.acc, molette et curseur ; la
  // tolérance n'y est que de ±0,1 δ). Sans st.accMode (états sauvés d'avant) : "main" si l'œil accommodait, sinon
  // "infini". Hors de portée (plus près que 25 cm, ou faisceau convergent derrière l'œil) : la borne la plus proche (4 δ,
  // ou l'œil détendu),
  // l'image est floue (l'indice le dit : `gesteDetecteur`).
  var ACC_MAX = 4;
  function modeAcc(st) { return st.accMode || ((st.acc || 0) > 0 ? "main" : "infini"); }
  function accommodation(st) {
    var m = modeAcc(st);
    if (m === "main") return st.acc || 0;
    var a = accPour(st, m);
    return a.u > 0 ? clamp(a.acc, 0, ACC_MAX) : 0;      // convergent derrière l'œil : il faudrait moins que l'infini
  }
  // Molette de la pastille de l'œil (geste délibéré ; sur l'image, la molette ne fait rien hors de « À la main ») : passe
  // « à la main » en partant de l'accommodation du moment, puis k pas (k > 0 =
  // plus loin ; Maj : fin, Ctrl+Maj : ultrafin, Ctrl : gros).
  function accommoder(st, k, ev) {
    st.acc = accommodation(st); st.accMode = "main";
    st.acc = clamp(st.acc - k * (ev && ev.shiftKey ? ((ev.ctrlKey || ev.metaKey) ? 0.002 : 0.02) : ev && ev.ctrlKey ? 0.5 : 0.1), 0, ACC_MAX);
  }
  var NOM_ACC = { infini: TRAD("À l'infini"), miroirs: TRAD("Sur les miroirs"), main: TRAD("À la main") };
  // Où mettre le détecteur pour voir net le plan des miroirs (cible "miroirs") ou l'infini ("infini") : sens du
  // déplacement de l'écran, ou de l'accommodation de l'œil. Renvoie une phrase.
  function gesteDetecteur(st, cible) {
    var I = imageSortie(st, cible), lent = I.lent, zl = I.zl, t = I.t;
    if (st.det === "ecran") {
      if (!lent.length && cible === "source" && isFinite(zSource(st))) return TRAD("Poser une lentille sur le banc de sortie (étagère, onglet Sortie) : elle forme sur l'écran l'image du diaphragme.");
      if (!lent.length) return cible === "miroirs" ? TRAD("Poser la lentille 20 cm sur le banc de sortie (étagère, onglet Sortie), pour former l'image des miroirs sur l'écran.")
        : TRAD("Poser la lentille 1 m sur le banc de sortie (étagère, onglet Sortie) : l'écran se place dans son plan focal image.");
      if (!(t > 0) || zl + t > ARM + BORNES.sor[1]) return cible === "miroirs" ? TRAD("Avec cette lentille, l'image des miroirs ne se forme pas sur le banc : prendre la lentille 20 cm, assez loin des miroirs.")
        : TRAD("Prendre une autre lentille de sortie : son plan focal image doit tomber sur le banc.");
      return TRAD("{0} l'écran de la lentille.", [zl + t > ARM + st.sor.ecran ? TRAD("Éloigner") : TRAD("Rapprocher")]);
    }
    var ze = ARM + st.sor.oeil, u = isFinite(t) ? ze - zl - t : Infinity;   // objet de l'œil, devant lui
    if (!(u > 0)) return TRAD("Le faisceau converge derrière l'œil : reculer l'œil, ou retirer la lentille de sortie.");
    var acc = isFinite(u) ? 1 / u : 0;
    if (acc > ACC_MAX) return TRAD("Reculer l'œil sur le banc : on n'accommode pas à moins de 25 cm.");
    if (modeAcc(st) !== "main") return TRAD("Regarder {0} : sous l'image, « {1} ».", [(cible === "miroirs" ? TRAD("sur les miroirs") : TRAD("à l'infini")), NOM_ACC[cible]]);
    return TRAD("{0} (curseur sous l'image, ou molette sur l'image ou sur la pastille de l'œil ; ou, sous l'image, « {1} »).", [(acc > (st.acc || 0) ? TRAD("Accommoder plus près") : TRAD("Accommoder plus loin")), NOM_ACC[cible]]);
  }
  // Mesure d'une variante de l'état (hypothèse : « et si α était nul ? ») : visibilité dans le champ.
  function variante(st, CO, f) {
    var s = JSON.parse(JSON.stringify(st)); f(s);
    var c = configOptique(s), m = mesure(c, s.det === "oeil" ? W_VUE.oeil : W_VUE.ecran, CO, { n: 13, K: 12 });
    return m;
  }
  function sansAlpha(s) { var a = inclinaison(s); viser(s, epaisseur(s), a.ax * 0.02, a.ay * 0.02); }
  function diagBrouille(st, CO, R, cle) {
    var e = epaisseur(st), a = inclinaison(st), al = Math.hypot(a.ax, a.ay);
    var mA = variante(st, CO, sansAlpha), mE = variante(st, CO, function (s) { viser(s, 0, inclinaison(s).ax, inclinaison(s).ay); });
    if (st.lampe === "na" && Math.abs(e) > 0.05e-3) {
      var mP = variante(st, CO, function (s) { var b = inclinaison(s); viser(s, epaisseur(s) + 0.145e-3, b.ax, b.ay); });
      var mM = variante(st, CO, function (s) { var b = inclinaison(s); viser(s, epaisseur(s) - 0.145e-3, b.ax, b.ay); });
      if (Math.max(mP.V, mM.V) > 0.35 && Math.max(mP.V, mM.V) > 2 * R.m.V + 0.15 && mA.V < 0.35)
        return { cle: cle + "-anti", t1: TRAD("Si le contraste n'est pas satisfaisant, on est peut-être sur une anticoïncidence du doublet : charioter légèrement."),
          t2: geste("C3", mP.V > mM.V ? 1 : -1) };
    }
    if (mA.V > 0.35 && mA.V >= mE.V) return { cle: cle + "-alpha", t1: TRAD("Un éclairement uniforme : le parallélisme des miroirs n'est pas satisfaisant ; revenir au parallélisme grossier (C₁, C₂)."),
      t2: gesteAlpha(st, al < 0.05e-3) };
    if (mE.V > 0.35) return { cle: cle + "-e", t1: TRAD("Le contraste se perd : la lame d'air est trop épaisse pour ce montage ; charioter vers le contact optique."), t2: gesteC3(st, 0) };
    return { cle: cle + "-tout", t1: TRAD("Un éclairement uniforme : le parallélisme des miroirs ou la longueur des bras n'est pas satisfaisant ; revenir aux réglages précédents (le parallélisme grossier)."),
      t2: al > 0.3e-3 ? gesteAlpha(st, false) : gesteC3(st, 0) };
  }
  function diagFeuille(st) {
    return st.feuille ? { cle: "feuille", t1: TRAD("Une feuille cache {0} : un seul faisceau, pas d'interférences.", [st.feuille === "M1" ? "M₁" : "M₂"]), t2: TRAD("Retirer la feuille : un clic sur sa carte (étagère, onglet Accessoires), ou la glisser hors du miroir.") } : null;
  }
  // Cible des indices = le réglage ou la manipulation que l'élève a choisi (clic sur sa puce, manipulation ouverte),
  // sinon le premier réglage non atteint. Un réglage atteint mais pas soigné ne retient pas la cible automatique.
  function cible(faits, vise) {
    if (vise && (estManip(vise) || ETAPES.some(function (x) { return x.id === vise; }))) return vise;
    for (var i = 0; i < ETAPES.length; i++) if (!faits[ETAPES[i].id]) return ETAPES[i].id;   // sautée ou au laser : passée
    return null;                                  // Michelson réglé : les indices attendent une manipulation ouverte
  }
  var APPLIS = {
    coherence: TRAD("En lame d'air (ou en coin d'air, dans le plan des miroirs), au mercure haute pression et son filtre interférentiel : partir du contact optique et charioter dans le même sens jusqu'à la disparition du contraste (lire C₃ aux deux bouts)."),
    doublet: TRAD("En lame d'air, au sodium : charioter lentement dans le même sens ; le contraste des anneaux s'annule, puis revient."),
    rayons: TRAD("Anneaux du sodium bien contrastés sur l'écran, au foyer de la lentille de 1 m (au moins cinq) : poser la barrette sur l'écran."),
    lamelle: TRAD("Coin d'air en lumière blanche, puis la lamelle devant un miroir, sur une partie du faisceau : charioter pour retrouver les franges derrière elle.")
  };
  function nomEtape(id) { return ETAPES.concat(MANIPS).filter(function (x) { return x.id === id; })[0].nom; }
  function aSoin(id) { return ETAPES.some(function (x) { return x.id === id && x.soin; }); }
  function atteinte(f) { return f === true || f === "soignee"; }
  // ================= montage : symptômes et gestes essayés =================
  // On juge ce que le montage PRODUIT, jamais une recette (il y a trop de façons d'éclairer et d'observer pour qu'une
  // liste tienne). Au clic sur « Un indice », et seulement là : la figure du réglage visé est mesurée sur une copie de
  // l'état (`figureDe` : score q de 0 à 1, symptôme, assez bonne ou non pour juger l'appareil) ; si elle ne suffit pas,
  // chaque geste possible du catalogue (`GESTES`, légaux dans l'interface) est essayé sur une copie, puis par paires
  // si aucun ne suffit seul, et le meilleur est proposé s'il améliore nettement le score (`MARGE`). Sinon, ou si le
  // même symptôme revient après deux indices (`o.recours`, compté par l'interface), un montage de référence
  // (`RECOURS`, ceux de CONFIGS), sans prétendre que c'est le seul. Un réglage soigné ne passe pas par là.
  var SODIUM = TRAD("Étagère, onglet Sources : un clic sur la carte Sodium, elle remplace la lampe.");
  var FERMER_IRIS = TRAD("Fermer l'iris : molette vers le bas sur sa pastille, ou la glisser vers le bas.");
  var OUVRIR_IRIS = TRAD("Ouvrir l'iris : molette vers le haut sur sa pastille, ou la glisser vers le haut.");
  var POSER_IRIS = TRAD("Poser l'iris : étagère, onglet Entrée, un clic sur sa carte.");
  // Plan vu net ↔ source : vergences comparées au premier élément après les miroirs (lentille de sortie ou détecteur),
  // à TOL_CONJ près (celle de TOL_INFINI : un plan à plus de 2 m compte pour l'infini).
  var TOL_CONJ = 0.5;
  function vergence(G, z) {
    var d0 = G.cfg.detecteur.d;
    G.cfg.sortie.forEach(function (q) { d0 = Math.min(d0, q.d); });
    return isFinite(z) ? 1 / (d0 - z) : 0;
  }
  function netSurSource(G) { return Math.abs(vergence(G, G.zo) - vergence(G, G.collimate ? Infinity : G.ti)) < TOL_CONJ; }
  function sansLentille(st) { return st.sor.l20 == null && st.sor.l1 == null; }
  // Figure à juger pour un réglage, d'après le montage posé (plus de menu « Méthode ») : "images" (deux images d'un
  // petit trou de lumière, ou les deux taches du laser nu : parallélisme grossier, compensatrice par M₁ seul), "ronds"
  // (compensatrice sur la rondeur des anneaux, quand on en voit), "coin" (parallélisme fin en coin d'air, sur les
  // miroirs), "anneaux" (parallélisme fin en lame d'air), "plate" (contact, teinte plate), "blanc" (contact en lumière
  // blanche).
  function voie(st, R, c) {
    if (c === "grossier") return "images";
    if (c === "comp") return st.feuille !== "M2" && R.vu && R.vu.anneaux ? "ronds" : "images";
    if (c === "fin") return R.G.plan === "miroirs" ? "coin" : "anneaux";
    return lampe(st).type === "filament" ? "blanc" : "plate";
  }
  // Score d'une figure (0 à 1). Images : vues nettes (le plan observé est celui de la source : 1/2) et petites (rayon
  // angulaire de la source vu des miroirs sous SOURCE_PETITE, le seuil d'avant : 1/2) ; laser nu sur l'écran : 1.
  // Franges : contraste V (lumière blanche : celui de la zone la plus contrastée) × part du champ éclairé, rapportée
  // à PART_REF (mesuré : anneaux au foyer de la lentille 1 m, 0,19 ; à l'œil, 0,04 ; la lampe reculée au bout du banc,
  // 0,04 sur l'écran ; le faisceau nu du laser, 0). Rien de visible (luminosité réelle, ou aucun point éclairé) : 0.
  // Laser à l'œil : 0, toujours (on ne regarde jamais un laser). Franges jugées les miroirs supposés parallèles
  // (`sansAlpha`, e gardé) : on juge le MONTAGE, ce qu'il donnerait sur un appareil réglé ; sans cela, tout geste qui
  // rétrécit la source (retirer le dépoli, reculer la lampe) relevait le contraste en masquant l'inclinaison que le
  // parallélisme fin doit justement voir (α = 20 µrad, e = 0,58 mm : V 0,14 au dépoli, 0,44 sans lui). Ce que
  // l'appareil y ajoute (inclinaison, anticoïncidence du doublet) est l'affaire de l'indice sur l'appareil. Lumière
  // blanche : jugée au contact (e = 0, inclinaison gardée : le coin d'air), seul endroit où elle donne des franges ;
  // l'approche du contact est l'affaire de l'appareil (`sensBlanc`). Coin d'air (parallélisme fin sur les miroirs) :
  // jugé tel quel, ses franges SONT l'inclinaison (miroirs parallèles, il n'en resterait rien). Feuille retirée : elle cache un bras (affaire de
  // `diagFeuille`, ou voulue sur M₂ pour la compensatrice), et la boîte éclairée du cœur n'est plus bornée quand un
  // bras est caché (mesure vide pour un petit trou : rien de visible, à tort).
  var SOURCE_PETITE = 4e-3, PART_REF = { ecran: 0.08, oeil: 0.02 }, MARGE = 0.15, IRIS_TROU = 0.0005;
  function figureDe(st, CO, vo, c) {
    var s = JSON.parse(JSON.stringify(st)); s.vue = "det"; s.feuille = null;
    if (lampe(s).type === "point" && s.det === "oeil") return { q: 0, sym: "laser-oeil", ok: false };
    if (vo === "blanc") { var a = inclinaison(s); viser(s, 0, a.ax, a.ay); }
    else if (vo !== "images" && vo !== "coin") sansAlpha(s);
    var G = geometrie(s, CO), m = mesure(G.cfg, s.det === "oeil" ? W_VUE.oeil : W_VUE.ecran, CO, { n: 13, K: 12 });
    var vis = reelle(s) ? visionMesure(s, m) : null;
    if (!m.nl || (vis && !vis.visible)) return { q: 0, sym: "sombre", ok: false };
    if (vo === "images") {
      if (lampe(s).type === "point") return laserNu(s) ? { q: 1, sym: "la", ok: true } : { q: 0.2, sym: "laser-obj", ok: false };
      var net = netSurSource(G) ? 1 : 0, petit = Math.min(1, SOURCE_PETITE / Math.max(1e-9, G.thetaS));
      // compensatrice : le fantôme (reflet sur une face de la compensatrice, VERRES_LAMES.fantome de la tache) doit
      // lui aussi passer le seuil de vision (critère de `adapterVision`) ; sinon il ne reste qu'une tache à regarder
      // (écran conjugué de la source par une lentille : tache à peine visible, fantôme perdu)
      if (c === "comp" && net && petit >= 1 && vis && VERRES_LAMES.fantome * vis.haut < 0.5 * vis.seuil) return { q: 0.75, sym: "fantome", ok: false };
      return { q: 0.5 * net + 0.5 * petit, sym: !net ? "flou" : petit < 1 ? "grande" : "la", ok: !!net && petit >= 1 };
    }
    var V = vo === "blanc" ? m.Vmax : m.V, gp = Math.min(1, m.part / PART_REF[s.det]);
    return { q: V * gp, sym: gp < 0.5 ? "minuscule" : V >= 0.35 ? "la" : m.nfr < 0.35 ? "uniforme" : "brouillee", ok: V >= 0.35 && gp >= 0.5 };
  }
  var SYMPTOMES = {
    sombre: TRAD("Trop peu de lumière pour y voir une figure"),
    minuscule: TRAD("Le champ éclairé est minuscule"),
    uniforme: TRAD("Un éclairement uniforme, sans figure"),
    brouillee: TRAD("Une figure peu contrastée"),
    flou: TRAD("Les images de la source ne se forment pas là où l'on regarde"),
    grande: TRAD("Les images de la source sont trop grandes pour qu'on juge de leur écart"),
    "laser-obj": TRAD("Ouvert par son objectif, le laser ne donne pas une tache par miroir"),
    "laser-oeil": TRAD("Au laser, on n'observe jamais à l'œil"),
    fantome: TRAD("L'image fantôme de la compensatrice, bien plus pâle que l'image principale, est trop sombre pour être vue ici")
  };
  // Catalogue des gestes de montage. voies : "images" ou "franges" (toutes les autres) ; possible(st, G) : légal dans
  // l'interface et utile à essayer ; f(s, vo) : le geste appliqué à une copie (mêmes fonctions que l'interface :
  // `deplacer`, `poser`, `detecteur`) ; quoi : ce qu'on fait et pourquoi (niveau 1) ; comment : l'organe et le geste
  // (niveau 2). Rangés du plus simple au plus lourd (ordre de préférence à égalité). Le plan des
  // miroirs n'est proposé qu'en lumière blanche : le parallélisme fin s'y fait en coin d'air, mais son indice renvoie
  // ensuite à la lame d'air (« Franges écartées »), et l'un défaisait l'autre. Pas de geste qui ferme l'iris pour les franges : une source presque ponctuelle les rend contrastées
  // partout, ce qui masque les défauts que les réglages fins doivent voir ; sauf en coin d'air, où un iris un peu
  // fermé ou une lampe reculée (source vue sous un plus petit angle) gardent nettes ses franges quand e grandit.
  // (état d'essai seulement : l'interface n'a plus de bouton « Sur la source », l'élève accommode à la main)
  function oeilSource(s) { if (s.det !== "oeil") detecteur(s, "oeil"); s.sor.l20 = s.sor.l1 = null; s.accMode = "source"; }
  function ecranInfini(s) { s.sor.l20 = null; s.sor.l1 = ELEMENTS.l1.defaut; deplacer(s, "sor", s.det, ELEMENTS.l1.defaut + ELEMENTS.l1.f); }
  function ecranMiroirs(s) { s.sor.l1 = null; s.sor.l20 = ELEMENTS.l20.defaut; deplacer(s, "sor", s.det, 1.12); }
  var GESTES = [
    { id: "det-ecran", voies: ["images", "franges"],
      possible: function (st) { return lampe(st).type === "point" && st.det === "oeil"; },
      f: function (s) { detecteur(s, "ecran"); },
      quoi: function () { return TRAD("observer sur l'écran"); },
      comment: function () { return TRAD("Étagère, onglet Sortie : un clic sur la carte Écran."); } },
    { id: "oeil-source", voies: ["images"],
      possible: function (st, G) { return lampe(st).type !== "point" && (!netSurSource(G) || st.det === "ecran"); },
      f: oeilSource,
      quoi: function () { return TRAD("regarder la source à l'œil, sans lentille de sortie : chaque miroir en donne une image"); },
      comment: function (st) { return (st.det === "ecran" ? TRAD("Étagère, onglet Sortie : un clic sur la carte Œil, il remplace l'écran ; ") : "") +
        (sansLentille(st) ? "" : TRAD("retirer les lentilles de sortie ; ")) + TRAD("sous l'image, « À la main » : accommoder sur la source, au curseur ou à la molette."); } },
    { id: "iris-fermer", voies: ["images"],
      possible: function (st) { return lampe(st).type !== "point" && !(st.iris != null && st.iris <= 2 * IRIS_TROU); },
      f: function (s) { s.iris = IRIS_TROU; },
      quoi: function (st) { return TRAD("{0} : la source devient un petit trou de lumière, dont chaque miroir donne une petite image", [(st.iris == null ? TRAD("poser l'iris devant la lampe et le fermer presque entièrement") : TRAD("fermer presque entièrement l'iris"))]); },
      comment: function (st) { return (st.iris == null ? POSER_IRIS + TRAD(" Puis : ") : "") + FERMER_IRIS; } },
    { id: "objectif-devisser", voies: ["images"],
      possible: function (st) { return lampe(st).type === "point" && st.lc !== false; },
      f: function (s) { s.lc = false; if (s.det === "oeil") detecteur(s, "ecran"); },
      quoi: function () { return TRAD("dévisser l'objectif du laser : son faisceau nu, étroit, donne une tache par miroir sur l'écran"); },
      comment: function () { return TRAD("Un clic sur la carte Objectif (étagère, onglet Entrée), ou « faisceau nu » au bandeau du laser."); } },
    { id: "objectif-visser", voies: ["franges"],
      possible: function (st) { return laserNu(st); },
      f: function (s) { s.lc = true; },
      quoi: function () { return TRAD("visser l'objectif sur le laser : le faisceau s'ouvre en un cône, qui éclaire tout le champ"); },
      comment: function () { return TRAD("Un clic sur la carte Objectif (étagère, onglet Entrée), ou ×20 au bandeau du laser."); } },
    { id: "iris-ouvrir", voies: ["images", "franges"],
      possible: function (st, G, vo) { return lampe(st).type !== "point" && st.iris != null && st.iris < (vo === "images" ? 4 * IRIS_TROU : 0.009); },
      f: function (s, vo) { s.iris = vo === "images" ? 2.5 * s.iris : Math.max(s.iris, 0.010); },
      quoi: function (st, vo) { return vo === "images" ? TRAD("ouvrir un peu l'iris : plus de lumière, des images encore petites") : TRAD("ouvrir l'iris : une source étendue éclaire tout le champ, et donne plus de lumière"); },
      comment: function () { return OUVRIR_IRIS; } },
    { id: "det-infini", voies: ["franges"],
      possible: function (st, G, vo) { return vo !== "blanc" && G.plan !== "infini" && lampe(st).type !== "point"; },
      f: function (s) { if (s.det === "oeil") s.accMode = "infini"; else ecranInfini(s); },
      quoi: function () { return TRAD("observer à l'infini, où sont les anneaux d'une lame d'air"); },
      comment: function (st) { return gesteDetecteur(st, "infini"); } },
    { id: "det-miroirs", voies: ["franges"],
      possible: function (st, G, vo) { return vo === "blanc" && G.plan !== "miroirs"; },
      f: function (s) { if (s.det === "oeil") s.accMode = "miroirs"; else ecranMiroirs(s); },
      quoi: function () { return TRAD("observer le plan des miroirs, où sont les franges d'un coin d'air"); },
      comment: function (st) { return gesteDetecteur(st, "miroirs"); } },
    { id: "iris-reduire", voies: ["franges"],
      possible: function (st, G, vo) { return vo === "coin" && lampe(st).type !== "point" && !(st.iris != null && st.iris <= 0.0035); },
      f: function (s) { s.iris = 0.003; },
      quoi: function (st) { return TRAD("{0} : une source moins étendue brouille moins les franges du coin d'air", [(st.iris == null ? TRAD("poser l'iris et le fermer un peu") : TRAD("fermer un peu l'iris"))]); },
      comment: function (st) { return (st.iris == null ? POSER_IRIS + TRAD(" Puis : ") : "") + FERMER_IRIS; } },
    { id: "lampe-eloigner", voies: ["franges"],
      possible: function (st, G, vo) { if (vo !== "coin") return false; var s = JSON.parse(JSON.stringify(st)); deplacer(s, "ent", "lampe", BORNES.ent[1]); return s.ent.lampe > st.ent.lampe + 0.1; },
      f: function (s) { deplacer(s, "ent", "lampe", BORNES.ent[1]); },
      quoi: function () { return TRAD("reculer la lampe au bout du banc : vue sous un plus petit angle, elle brouille moins les franges du coin d'air"); },
      comment: function () { return TRAD("Glisser la lampe sur le banc d'entrée, loin de l'appareil (ou ↓ quand elle est choisie)."); } },
    { id: "lampe-approcher", voies: ["images", "franges"],
      possible: function (st) { var s = JSON.parse(JSON.stringify(st)); deplacer(s, "ent", "lampe", BORNES.ent[0]); return s.ent.lampe < st.ent.lampe - 0.03; },
      f: function (s) { deplacer(s, "ent", "lampe", BORNES.ent[0]); },
      quoi: function (st, vo) { return vo === "images" ? TRAD("approcher la lampe de l'appareil : plus de lumière") : TRAD("approcher la lampe de l'appareil : plus de lumière, et une source vue sous un plus grand angle, qui éclaire tout le champ"); },
      comment: function () { return TRAD("Glisser la lampe sur le banc d'entrée, vers l'appareil (ou ↑ quand elle est choisie)."); } },
    { id: "entree-retirer", voies: ["franges"],
      possible: function (st) { return st.ent.coll != null; },
      f: function (s) { s.ent.coll = null; },
      quoi: function () { return TRAD("retirer la lentille d'entrée : la lumière arrive alors sur les miroirs sous toutes les inclinaisons, et chacune donne son anneau"); },
      comment: function () { return TRAD("Un clic sur sa carte (étagère, onglet Entrée), ou Suppr."); } },
    { id: "lampe-sodium", voies: ["franges"],
      possible: function (st) { return lampe(st).type === "filament"; },
      f: function (s) { s.lampe = "na"; normaliserPorte(s); },
      quoi: function () { return TRAD("prendre la lampe au sodium : la lumière blanche ne donne de franges qu'au voisinage immédiat du contact optique"); },
      comment: function () { return SODIUM; } },
    { id: "depoli-poser", voies: ["images", "franges"],
      possible: function (st) { return !st.depoli && lampe(st).type !== "point"; },
      f: function (s) { s.depoli = true; },
      quoi: function (st, vo) { return vo === "images" && condLanterne(st) ? TRAD("poser le dépoli sur la lanterne : l'iris borne alors la source (sans lui, l'iris n'est que la monture du condenseur)") : TRAD("poser le dépoli devant la lampe : une source étendue et uniforme"); },
      comment: function () { return TRAD("Étagère, onglet Entrée : un clic sur la carte Dépoli."); } },
    { id: "depoli-retirer", voies: ["images", "franges"],
      possible: function (st) { return !!st.depoli && lampe(st).type !== "point"; },
      f: function (s) { s.depoli = false; },
      quoi: function () { return TRAD("retirer le dépoli : la lampe nue éclaire bien davantage"); },
      comment: function () { return TRAD("Un clic sur la carte Dépoli (étagère, onglet Entrée)."); } },
    { id: "cond-poser", voies: ["franges"],
      possible: function (st) { return lampe(st).type === "spectrale" && !st.depoli && st.ent.cond == null && st.ent.coll == null; },
      f: function (s) { poser(s, "cond"); deplacer(s, "ent", "lampe", s.ent.cond + 1 / (1 / ELEMENTS.cond.f - 1 / (ARM + s.ent.cond))); },
      quoi: function () { return TRAD("poser le condenseur, la lampe derrière lui : il forme l'image de la lampe sur les miroirs, beaucoup de lumière dans tout le champ"); },
      comment: function () { return TRAD("Étagère, onglet Entrée : la carte Condenseur ; puis glisser la lampe jusqu'à ce que son image se forme sur les miroirs."); } }
  ];
  // Montages de référence (ceux de CONFIGS : autocollimation, anneaux, lumière blanche), en dernier recours.
  var UN_MONTAGE = TRAD("Un montage qui marche (il y en a d'autres) : ");
  var RECOURS = {
    images: { t1: TRAD("{0}l'autocollimation. Sur le banc d'entrée, l'iris presque fermé sur le dépoli, au foyer de la lentille 20 cm ; en sortie, l'œil sans lentille, accommodé à l'infini : chaque miroir donne une petite image de l'iris.", [UN_MONTAGE]),
      t2: TRAD("Étagère, onglet Entrée : la lentille 20 cm, puis glisser la lampe jusqu'à ce que l'iris soit à son foyer (vue de la face de l'iris : la lumière revenue y forme une image nette) ; onglet Sortie : la carte Œil, les lentilles retirées ; sous l'image, « À l'infini ».") },
    franges: { t1: TRAD("{0}la lampe au sodium près de l'appareil, dépoli posé, iris grand ouvert, sans lentille d'entrée ; en sortie, la lentille 1 m et l'écran dans son plan focal image (ou l'œil sans lentille, accommodé à l'infini) : des anneaux à l'infini.", [UN_MONTAGE]),
      t2: TRAD("Étagère, onglet Sources : Sodium ; onglet Entrée : le dépoli, les lentilles retirées ; onglet Sortie : la lentille 1 m, puis l'écran glissé à un mètre d'elle.") },
    blanc: { t1: TRAD("{0}le contact trouvé d'abord au sodium (teinte plate), puis un coin d'air : la lanterne au bout du banc d'entrée, sans dépoli, et l'image des miroirs sur l'écran par la lentille 20 cm ; charioter alors très lentement.", [UN_MONTAGE]),
      t2: TRAD("Étagère, onglet Sources : Lanterne ; onglet Sortie : la lentille 20 cm, l'écran à un mètre d'elle ; C₁ ou C₂ pour incliner un miroir, puis Ctrl et molette sur C₃.") }
  };
  function recours(c, vo, sym) {
    var r = RECOURS[vo === "images" ? "images" : vo === "blanc" ? "blanc" : "franges"];
    return { cle: "rec-" + c + "-" + vo, sym: sym, recours: true,
      t1: r.t1 + (c === "comp" && vo === "images" ? TRAD(" Puis la feuille sur M₂ : seules restent les images données par M₁, à travers la compensatrice.") : ""), t2: r.t2 };
  }
  function appliquerGeste(st, id, vo) { var g = GESTES.filter(function (x) { return x.id === id; })[0]; g.f(st, vo); return st; }
  // Diagnostic du montage pour le réglage c (voie vo) : null si sa figure suffit (ou si aucun geste de montage n'y
  // change rien et que l'appareil peut en être la cause : l'indice passe alors à l'appareil), sinon l'indice.
  function diagMontage(st, CO, R, c, vo, o) {
    var F0 = figureDe(st, CO, vo, c);
    if (F0.ok) return null;
    var sym = c + ":" + F0.sym, fam = vo === "images" ? "images" : "franges";
    if (o && o.recours) return recours(c, vo, sym);
    var L = GESTES.filter(function (g) { return g.voies.indexOf(fam) >= 0 && g.possible(st, R.G, vo); });
    // meilleur essai : une figure qui suffit l'emporte, à égalité le premier geste du catalogue (rangé du plus simple au
    // plus lourd : à saturation, « ouvrir l'iris » et « retirer le dépoli » valent autant), sinon le meilleur score
    var best = null;
    function essai(gs) {
      var s = JSON.parse(JSON.stringify(st));
      gs.forEach(function (g) { g.f(s, vo); });
      var F = figureDe(s, CO, vo, c);
      if (F.q < F0.q + MARGE) return;
      if (!best || (F.ok && !best.ok) || (F.ok === best.ok && !F.ok && F.q > best.q + 0.02)) best = { gs: gs, q: F.q, ok: F.ok };
    }
    L.forEach(function (g) { essai([g]); });
    if (!best)        // aucun geste seul n'améliore : par paires (une trentaine d'essais au plus)
      for (var i = 0; i < L.length; i++) for (var j = i + 1; j < L.length; j++) if (!best || !best.ok) essai([L[i], L[j]]);
    if (best) {
      var g1 = best.gs[0], g2 = best.gs[1];
      return { cle: "m-" + c + "-" + best.gs.map(function (g) { return g.id; }).join("+"), sym: sym, gestes: best.gs.map(function (g) { return g.id; }),
        t1: TRAD("{0} : {1}{2}.", [SYMPTOMES[F0.sym], g1.quoi(st, vo), (g2 ? TRAD(", et {0}", [g2.quoi(st, vo)]) : "")]),
        t2: g1.comment(st, vo) + (g2 ? TRAD(" Puis : {0}", [g2.comment(st, vo)]) : "") };
    }
    if (F0.sym === "sombre" || fam === "images" || F0.sym === "laser-oeil" || F0.sym === "minuscule") return recours(c, vo, sym);
    return null;
  }

  function alphaFin(st) { var a = inclinaison(st); return Math.hypot(a.ax, a.ay) < 0.05e-3; }
  // Réglage c : la feuille, puis le montage (`diagMontage`, réglage pas encore atteint), puis le geste sur l'appareil ;
  // atteint : ce qui le soigne (la figure doit déjà se voir). o.recours : montage de référence (même symptôme après
  // deux indices).
  function indiceReglage(st, CO, R, c, o) {
    var vo = voie(st, R, c), m = R.m, G = R.G, d, at = R.ok[c];
    if (R.top[c]) return { cle: c + "-ok", t1: TRAD("Réglage « {0} » soigné.", [nomEtape(c)]), t2: "" };
    var soin = function (o) { return { cle: o.cle, t1: TRAD("Réglage « {0} » atteint ; pour le soigner : {1}", [nomEtape(c), o.t1]), t2: o.t2 }; };
    // compensatrice, sur les images d'un petit trou : M₂ caché (la lumière qui va vers M₁ traverse la compensatrice), on
    // ne voit plus que les images données par M₁, l'image principale et ses fantômes
    var parM1 = c === "comp" && vo === "images";
    if (!parM1 && (d = diagFeuille(st))) return d;
    if (!parM1 && !m) return { cle: "vue", t1: TRAD("Revenir à l'observation (écran ou œil)."), t2: "" };
    if ((d = diagMontage(st, CO, R, c, vo, o))) return d;
    if (parM1 && st.feuille !== "M2") return { cle: "c-feuille", t1: TRAD("Cacher M₂ avec une feuille de papier : il ne reste que l'image donnée par M₁ et, à côté, plus pâle, son fantôme (le reflet sur une face de la compensatrice, que traverse la lumière qui va vers M₁). Sans la feuille, on ne sait pas laquelle des deux taches amener sur le fantôme."),
      t2: TRAD("Étagère, onglet Accessoires : glisser la feuille sur M₂ (un clic sur sa carte la pose aussi sur M₂).") + POUR_MOI };
    if (R.sombre) return { cle: "sombre", t1: vue(st) === "oeil" ? TRAD("Trop peu de lumière pour y voir une figure à l'œil.") : TRAD("Pas assez de lumière sur l'écran pour y voir une figure."),
      t2: st.iris != null && st.iris < R_DEPOLI ? TRAD("Ouvrir un peu l'iris (molette ou glisser vers le haut, sur sa pastille), ou approcher l'écran, ou observer à l'œil.") : TRAD("Approcher l'écran ou la lampe, ou observer à l'œil.") };
    if (c === "comp") {
      if (parM1) return at ? soin({ cle: "cs", t1: TRAD("confondre exactement le fantôme et l'image principale avec B₁ et B₂ ; puis rendre les anneaux bien ronds près du contact optique."), t2: gesteComp(st) })
        : { cle: "c-B", t1: TRAD("L'image principale et, plus pâle, son fantôme sont séparés : la compensatrice n'est pas parallèle à la séparatrice ; amener le fantôme sur l'image principale avec B₁ et B₂."), t2: gesteComp(st) + POUR_MOI };
      if (m.V < 0.35 || !R.vu.anneaux) return { cle: "cr-anneaux", t1: TRAD("Pas d'anneaux nets à juger : la rondeur ne se voit que miroirs parallèles, près du contact. Régler la compensatrice sur les images d'un petit trou de lumière, ou passer d'abord aux réglages suivants (clic sur leur puce)."),
        t2: TRAD("Le diaphragme presque fermé, regardé à l'œil sur la source, puis la feuille sur M₂.") + POUR_MOI };
      if (Math.abs(G.e) >= 0.35e-3) return { cle: "cr-loin", t1: TRAD("Se rapprocher du contact optique pour juger de la rondeur des anneaux : charioter, les anneaux rentrent et grossissent."), t2: gesteC3(st, 0) };
      d = { cle: "cr-ell", t1: TRAD("anneaux encore un peu elliptiques : B₁ place le grand axe suivant la verticale ou l'horizontale, B₂ diminue l'excentricité."), t2: gesteComp(st) };
      return at ? soin(d) : { cle: d.cle, t1: TRAD("Anneaux elliptiques : la compensatrice n'est pas parallèle à la séparatrice ; B₁ place le grand axe suivant la verticale ou l'horizontale, B₂ diminue l'excentricité."), t2: d.t2 };
    }
    if (c === "grossier") {
      if (lampe(st).type === "point") return at ? soin({ cle: "gs-laser", t1: TRAD("confondre exactement les deux taches avec C₁ et C₂."), t2: gesteAlpha(st, false) })
        : { cle: "g-laser", t1: TRAD("Superposer les deux taches sur l'écran avec C₁ et C₂ : M₂* devient à peu près parallèle à M₁."), t2: gesteAlpha(st, false) };
      if (!at) return { cle: "g-C", t1: TRAD("Superposer au mieux les deux images du diaphragme avec C₁ et C₂, réglage grossier de M₂ : M₁ et M₂* deviennent à peu près parallèles."), t2: gesteAlpha(st, false) };
      return soin(G.thetaS >= 2.5e-3 ? { cle: "gs-iris", t1: TRAD("fermer l'iris au plus petit : les taches rétrécissent, leur écart se juge mieux."), t2: FERMER_IRIS }
        : { cle: "gs-C", t1: TRAD("confondre exactement les deux images avec C₁ et C₂."), t2: gesteAlpha(st, false) });
    }
    if (c === "fin") {
      if (vo === "coin") {
        if (m.V < 0.35) return diagBrouille(st, CO, R, "r");
        if (m.quad >= 1 / 3) return { cle: "r-courbe", t1: TRAD("Des portions d'anneaux : il subsiste une lame d'air ; charioter pour diminuer leur courbure, les franges deviennent rectilignes."), t2: gesteC3(st, 0) };
        if (m.nfr > 1.5) return { cle: "r-ecart", t1: TRAD("Écarter les franges au maximum, jusqu'à n'en voir presque plus qu'une sur le champ : les vis grossières C₁ et C₂ y suffisent, en douceur."), t2: gesteAlpha(st, false) };
        d = { cle: "r-lame", t1: TRAD("Franges écartées : passer en lame d'air (dépoli près de la lampe, observation à l'infini), puis y amener le contraste au centre avec les vis fines."),
          t2: TRAD("Étagère, onglet Sortie : la lentille 1 m, l'écran dans son plan focal (ou l'œil accommodé à l'infini) ; puis A₁ et A₂.") };
        return at ? soin(d) : d;
      }
      if (m.V < 0.35 && !(Math.hypot(inclinaison(st).ax, inclinaison(st).ay) < 30e-6)) {
        // Parallélisme grossier atteint (α sous 0,5 mrad) ne suffit pas aux anneaux à l'infini (il y faut quelques
        // dizaines de µrad : sodium à une coïncidence, α = 0,15 à 0,45 mrad, V 0,1 à 0,2 au foyer de la lentille 1 m),
        // mais les franges du coin d'air se voient sur les miroirs (dépoli, œil accommodé sur eux : V 0,7 à 0,9 jusqu'à
        // e ≈ 1 mm, une zone encore contrastée à 3 mm) : la méthode du TP, les observer là et les écarter aux vis
        // grossières (voie « coin »). Variante mesurée sur l'appareil tel quel, sinon `diagBrouille` (doublet, etc.).
        // à l'œil (sur l'écran, par la lentille 20 cm, la grande ouverture les brouille dès e ≈ 0,5 mm) ; à une
        // anticoïncidence du doublet, à une demi-période près
        var coin = function (de) { return variante(st, CO, function (s) { if (s.det !== "oeil") detecteur(s, "oeil"); s.sor.l20 = s.sor.l1 = null; s.accMode = "miroirs";
          if (de) { var b = inclinaison(s); viser(s, epaisseur(s) + de, b.ax, b.ay); } }); };
        var vu = function (x) { return x.V > 0.35 || x.Vmax > 0.6; }, mc = coin(0), anti = !vu(mc) && st.lampe === "na" && (vu(coin(EP_DOUBLET / 2)) || vu(coin(-EP_DOUBLET / 2)));
        if (lampe(st).type !== "point" && (vu(mc) || anti)) return { cle: "n-coin", t1: TRAD("Les miroirs sont encore trop inclinés pour des anneaux à l'infini, mais assez peu pour voir les franges du coin d'air : les regarder à l'œil, accommodé sur les miroirs, puis les écarter avec C₁ et C₂ jusqu'à n'en voir presque plus qu'une.{0}",
            [(anti ? TRAD(" Si elles restent pâles, charioter un peu : anticoïncidence du doublet.") : "")]),
          t2: st.det === "oeil" ? TRAD("{0}sous l'image, « Sur les miroirs ».", [(sansLentille(st) ? "" : TRAD("Retirer les lentilles de sortie ; "))]) : TRAD("Étagère, onglet Sortie : un clic sur la carte Œil, il remplace l'écran ; retirer les lentilles de sortie ; sous l'image, « Sur les miroirs ».") };
        return diagBrouille(st, CO, R, "n");
      }
      if (!at) return { cle: "n-centre", t1: TRAD("Amener au centre de la figure la zone la mieux contrastée, avec les vis fines A₁ et A₂ : quand elle l'atteint, toute la figure gagne en contraste d'un coup."),
        t2: gesteAlpha(st, true) };
      // test de la tête : en se déplaçant de ±1 cm, la pupille regarde des zones des miroirs d'épaisseurs e ± α·1 cm
      return soin(st.det === "oeil" && sansLentille(st) ? { cle: "n-oeil", t1: TRAD("déplacer l'œil latéralement, puis verticalement ; si l'éclairement du centre change, l'épaisseur de la lame d'air n'est pas uniforme : affiner avec A₁ et A₂."),
        t2: TRAD("Glisser sur l'image pour déplacer l'œil, dans les deux directions ; puis ") + gesteAlpha(st, true).charAt(0).toLowerCase() + gesteAlpha(st, true).slice(1) }
        : { cle: "n-oeil-pose", t1: TRAD("observer à l'œil accommodé à l'infini et déplacer la tête dans toutes les directions : l'éclairement du centre ne doit pas changer."),
          t2: TRAD("Étagère, onglet Sortie : un clic sur la carte Œil, et retirer les lentilles de sortie ; puis glisser sur l'image pour déplacer l'œil, et A₁, A₂.") });
    }
    // contact
    if (vo === "blanc") {
      if (m.Vmax > 0.5 && m.nfr < 1.5) return { cle: "b-coin", t1: TRAD("Incliner un miroir pour former un coin d'air : plus il y a de franges, plus le champ couvre d'épaisseurs, et plus vite on y trouve le contact en lumière blanche."), t2: TRAD("Faire rouler C₁ ou C₂, dans un sens ou dans l'autre.") };
      if (R.ok.blanc) return soin({ cle: "os-centre", t1: TRAD("amener la frange achromatique au centre du champ, en chariotant très lentement."), t2: gesteC3(st, 0) });
      if (!at && !sensBlancSigne(st, CO)) return { cle: "b-sodium", t1: TRAD("Aucune frange de lumière blanche à portée de chariot : trouver d'abord le contact au sodium (teinte plate), puis revenir à la lanterne."), t2: SODIUM };
      return { cle: "b-C3", t1: TRAD("Modifier très légèrement C₃ : en lumière blanche, on ne voit de franges qu'au voisinage immédiat du contact optique."), t2: sensBlanc(st, CO) };
    }
    if (at) return soin({ cle: "os-blanc", t1: TRAD("préciser le contact en lumière blanche, en coin d'air : des couleurs n'apparaissent qu'au voisinage immédiat du contact (manipulation « Lumière blanche »)."),
      t2: TRAD("Incliner un miroir avec C₁ ou C₂ et observer le plan des miroirs ; puis étagère, onglet Sources : un clic sur la carte Lanterne, et charioter très lentement (Ctrl et molette sur C₃).") });
    if (m.V < 0.35) {
      d = diagBrouille(st, CO, R, "n");
      if (/-alpha$/.test(d.cle)) d.t1 = TRAD("Le champ reste brouillé : faire tendre α vers 0 en affinant C₁ et C₂ tout en chariotant ; A₁ et A₂ pour finir.");
      return d;
    }
    if (!m.centreDedans) return { cle: "o-alpha", t1: TRAD("Faire tendre α vers 0 en affinant C₁ et C₂ tout en chariotant ; A₁ et A₂ pour finir."), t2: gesteAlpha(st, alphaFin(st)) };
    return { cle: "o-C3", t1: TRAD("Charioter : les anneaux rentrent quand e diminue ; on atteint le contact optique quand la teinte devient uniforme."), t2: gesteC3(st, 0) };
  }
  // Lumière blanche : le sens du chariotage qui fait apparaître des franges (variantes de l'état), sinon les deux.
  function sensBlanc(st, CO) {
    var sens = sensBlancSigne(st, CO);
    return sens ? geste("C3", sens) : TRAD("Charioter très lentement, d'un côté puis de l'autre (Ctrl et molette sur C₃ : un dixième de micromètre par cran).");
  }
  function sensBlancSigne(st, CO) {
    var best = 0, sens = 0;
    [4, 8, 14, 22, 32, 45].forEach(function (de) {
      [1, -1].forEach(function (sg) {
        var mv = variante(st, CO, function (s) { var b = inclinaison(s); viser(s, epaisseur(s) + sg * de * 1e-6, b.ax, b.ay); });
        if (mv.Vmax > best + 0.05) { best = mv.Vmax; sens = sg; }
      });
    });
    return sens;
  }
  // Indice : cible `vise` (choisie par l'élève) ou le premier réglage non atteint. Sans choix, un réglage atteint non
  // soigné est signalé en fin de phrase (on peut le soigner en cliquant sa puce).
  function indice(st, CO, R, faits, vise, o) {
    faits = faits || {};
    var I = indiceBrut(st, CO, R, faits, vise, o);
    // images de M₁, face de l'iris affichée : on n'y voit pas l'image fantôme
    if (vue(st) === "iris" && /^(cs|c-)/.test(I.cle || "")) I = { cle: I.cle, t1: I.t1 + TRAD(" Ne pas regarder la face de l'iris pour cela : on n'y voit pas l'image de la compensatrice ; observer à l'œil."), t2: I.t2 };
    if (!vise && I.cle !== "fini") {
      var aS = ETAPES.filter(function (x) { return faits[x.id] === true && R.ok[x.id] && !R.top[x.id]; })[0];
      if (aS && aS.id !== cible(faits, vise)) I = { cle: I.cle, t1: I.t1 + TRAD(" (« {0} » peut encore être soigné : cliquer sa puce, en bas.)", [aS.nom]), t2: I.t2 };
    }
    return I;
  }
  // Manipulation « Laser » : anneaux à l'objectif, puis loin du contact, du côté où la course du chariot le permet.
  function indiceLaserLoin(st, R) {
    if (lampe(st).type !== "point") return { cle: "e-laser", t1: TRAD("Prendre le laser."), t2: TRAD("Étagère, onglet Sources : un clic sur la carte Laser, il remplace la lampe.") };
    if (laserNu(st)) return { cle: "e-obj", t1: TRAD("Visser l'objectif sur le laser : le faisceau s'ouvre en un cône, des anneaux apparaissent sur l'écran."), t2: TRAD("Un clic sur la carte Objectif (étagère, onglet Entrée), ou ×20 au bandeau du laser.") };
    if (st.det !== "ecran") return { cle: "o-ecran", t1: TRAD("Au laser, on observe sur l'écran, jamais à l'œil."), t2: TRAD("Étagère, onglet Sortie : un clic sur la carte Écran.") };
    if (!R.laser.anneaux) {
      if (R.m && R.m.nl && !R.m.centreDedans) return { cle: "z-centre", t1: TRAD("Les anneaux ne sont pas centrés : M₁ et M₂* sont encore inclinés ; corriger avec C₁ et C₂."), t2: gesteAlpha(st, false) };
      return { cle: "z-anneaux", t1: TRAD("Des anneaux complets et centrés : affiner le parallélisme avec C₁ et C₂, ou prendre un objectif plus fort pour éclairer tout le champ."), t2: gesteAlpha(st, false) };
    }
    var c = st.cache, e = epaisseur(st), haut = C3_MAX - c.Rc, bas = c.Rc, E = 1.2 * E_LASER;
    var sg = e > 0 && haut > E ? 1 : e < 0 && bas > E ? -1 : haut > bas ? 1 : -1;
    return { cle: "z-loin", t1: TRAD("Charioter loin du contact, aussi loin que le permet la course du chariot : les anneaux se resserrent, mais restent contrastés."), t2: gesteC3(st, sg * E) };
  }
  var LANTERNE = TRAD("Étagère, onglet Sources : un clic sur la carte Lanterne, elle remplace la lampe.");
  function indiceBrut(st, CO, R, faits, vise, o) {
    var c = cible(faits, vise), m = R.m, G = R.G, d, L = lampe(st);
    if (!c) return { cle: "fini", t1: TRAD("Le Michelson est réglé : lame d'air au contact optique. Ouvrir une manipulation (bouton « Manipulations », en bas) : les indices aident alors sur elle."), t2: "" };
    if (!estManip(c)) return indiceReglage(st, CO, R, c, o);
    if (R.ok[c]) return { cle: c + "-ok", t1: TRAD("Manipulation « {0} » : le phénomène est dans le champ.", [nomEtape(c)]), t2: "" };
    if (c === "laser") return indiceLaserLoin(st, R);
    if (L.type === "point" && c !== "localisation") return { cle: "l-lampe", t1: TRAD("Cette manipulation se fait à la lampe : le laser éclaire par un point."),
      t2: c === "blanc" || c === "cannele" || c === "lamelle" ? LANTERNE : SODIUM };
    if ((d = diagFeuille(st))) return d;
    if (!m) return { cle: "vue", t1: TRAD("Revenir à l'observation (écran ou œil)."), t2: "" };
    if (c === "localisation" && R.sombre && ponctuelle(st)) return { cle: "z-sombre", t1: TRAD("Source presque ponctuelle : les franges sont partout, mais peu lumineuses."),
      t2: st.det === "ecran" ? TRAD("Approcher l'écran de la lentille, ou observer à l'œil (étagère, onglet Sortie : un clic sur la carte Œil).") : TRAD("Ouvrir un peu le diaphragme, juste assez pour y voir.") };
    if (R.sombre) return { cle: "sombre", t1: vue(st) === "oeil" ? TRAD("Trop peu de lumière pour y voir une figure à l'œil.") : TRAD("Pas assez de lumière sur l'écran pour y voir une figure."),
      t2: st.iris != null && st.iris < R_DEPOLI ? TRAD("Ouvrir l'iris (molette ou glisser vers le haut, sur sa pastille), ou approcher l'écran, ou observer à l'œil.") : TRAD("Approcher l'écran ou la lampe, ou observer à l'œil.") };
    if (c === "localisation") {
      if (L.type === "filament") return { cle: "z-lampe", t1: TRAD("Travailler avec une lampe spectrale : ses franges se voient loin du contact."), t2: SODIUM };
      if (m.nfr < 1.5 || m.quad >= 1) return { cle: "z-coin", t1: TRAD("Former un coin d'air : incliner un miroir, des franges rectilignes dans le champ."), t2: TRAD("Faire rouler C₁ ou C₂, dans un sens ou dans l'autre.") };
      if (Math.abs(G.e) < 0.02e-3) return { cle: "z-contact", t1: TRAD("Tout près du contact, les franges du coin d'air sont nettes partout : s'en écarter un peu en chariotant."), t2: geste("C3", G.e >= 0 ? 1 : -1) };
      if (G.plan === "miroirs") return { cle: "z-plan", t1: TRAD("Les franges sont dans le plan des miroirs : quitter ce plan, et voir ce qu'elles deviennent."),
        t2: st.det === "ecran" ? TRAD("Glisser l'écran sur le banc de sortie.") : TRAD("Accommoder plus près ou plus loin (molette sur l'image).") };
      if (!ponctuelle(st)) return { cle: "z-iris", t1: TRAD("Hors du plan des miroirs, une source étendue brouille les franges du coin d'air : fermer presque entièrement le diaphragme, la source devient presque ponctuelle."),
        t2: st.iris == null ? TRAD("Poser l'iris : étagère, onglet Entrée, un clic sur sa carte.") : !st.depoli && condLanterne(st) ? TRAD("Poser le dépoli devant la lanterne (étagère, onglet Entrée) : l'iris borne alors la source.") : TRAD("Fermer l'iris : molette vers le bas sur sa pastille, ou la glisser vers le bas.") };
      return { cle: "z-V", t1: TRAD("Contraste encore faible : fermer davantage le diaphragme."), t2: TRAD("Fermer l'iris : molette vers le bas sur sa pastille, ou la glisser vers le bas.") };
    }
    if (c === "cannele") {
      if (L.type !== "filament") return { cle: "k-lampe", t1: TRAD("Le spectre cannelé se voit en lumière blanche, dans le blanc d'ordre supérieur."), t2: TRAD("Étagère, onglet Sources : un clic sur la carte Lanterne, elle remplace la lampe.") };
      if (vue(st) !== "ecran") return { cle: "k-ecran", t1: TRAD("La fibre du spectromètre se pose sur l'écran."), t2: TRAD("Étagère, onglet Sortie : un clic sur la carte Écran.") };
      if (!(st.capteur && st.capteur.type === "fibre")) return { cle: "k-fibre", t1: TRAD("Poser la fibre du spectromètre sur l'écran, dans le blanc d'ordre supérieur, à quelques franges de la frange achromatique."),
        t2: TRAD("Mesurer ▾, au-dessus de l'image : Fibre (spectromètre) ; puis la glisser sur l'écran.") };
      if (!(R.cannele && R.cannele.amp > 0.3)) return { cle: "k-serre", t1: TRAD("Les cannelures, trop serrées, ne sont plus séparées par le spectromètre : rapprocher la fibre de la frange achromatique, ou trouver d'abord les franges de lumière blanche (manipulation « Lumière blanche »)."),
        t2: TRAD("Glisser la fibre sur l'écran, vers la frange achromatique.") };
      return { cle: "k-newton", t1: TRAD("Trop près de la frange achromatique, dans les teintes de Newton : le spectre n'a qu'une ou deux cannelures ; éloigner la fibre dans le blanc d'ordre supérieur."),
        t2: TRAD("Glisser la fibre sur l'écran, en s'éloignant de la frange achromatique.") };
    }
    if (c === "mercure") {
      if (st.lampe !== "hgc" && st.lampe !== "hgcb") return { cle: "m-lampe", t1: TRAD("Prendre la lampe au mercure sans son filtre : plusieurs raies, de la verte au violet."), t2: TRAD("Étagère, onglet Sources : un clic sur la carte Mercure, elle remplace la lampe.") };
      if (hgVert(st)) return { cle: "m-filtre", t1: TRAD("Retirer le filtre interférentiel posé devant la lampe : c'est lui qui ne garde qu'une raie."),
        t2: TRAD("Un clic sur la carte Filtre (étagère, onglet Entrée), ou Suppr quand le filtre est choisi.") };
      if (G.plan !== "miroirs" && G.plan !== "infini") return { cle: "m-plan", t1: TRAD("Observer un coin d'air dans le plan des miroirs : beaucoup de franges, d'épaisseurs différentes, dans le même champ."), t2: gesteDetecteur(st, "miroirs") };
      if (R.Vvert == null) return { cle: "m-conv", t1: TRAD("Éclairer les miroirs par une source étendue : dépoli près de la lampe, sans lentille d'entrée."),
        t2: !st.depoli ? TRAD("Poser le dépoli : étagère, onglet Entrée.") : TRAD("Retirer la lentille d'entrée : un clic sur sa carte (étagère, onglet Entrée), ou Suppr.") };
      if (!(R.Vvert > 0.5)) return { cle: "m-loin", t1: TRAD("Même la raie verte seule n'y donnerait plus de franges contrastées : charioter vers le contact optique."), t2: gesteC3(st, 0) };
      if (G.plan === "miroirs" && m.nfr < 20) return { cle: "m-coin", t1: TRAD("Incliner davantage un miroir : beaucoup de franges dans le champ, dont le contraste varie le long du coin d'air."), t2: TRAD("Faire rouler C₁ ou C₂, dans un sens ou dans l'autre.") };
      return { cle: "m-C3", t1: TRAD("Les franges des différentes raies sont encore presque en phase : charioter lentement, leur contraste fluctue."), t2: TRAD("Faire rouler C₃ lentement, dans un sens ou dans l'autre.") };
    }
    if (c === "blanc" || c === "lamelle") {
      if (G.plan !== "miroirs") return { cle: "r-plan", t1: TRAD("Les franges du coin d'air sont localisées au voisinage des miroirs : l'œil y accommode (dépoli près de la lampe, diaphragme grand ouvert), ou on forme sur l'écran l'image des miroirs avec la lentille de 20 cm."),
        t2: gesteDetecteur(st, "miroirs") };
      if (!m.nl) return { cle: "r-champ", t1: TRAD("Le champ est presque noir : ouvrir largement le diaphragme, ou approcher la lampe."), t2: st.iris != null ? TRAD("Ouvrir l'iris : molette vers le haut sur sa pastille, ou la glisser vers le haut.") : TRAD("Approcher la lampe des miroirs.") };
      if (L.type === "spectrale" && m.nfr < 1.5 && !(c === "blanc" && m.V < 0.35))
        return { cle: "b-coin", t1: TRAD("Incliner un miroir pour former un coin d'air : plus il y a de franges, plus le champ couvre d'épaisseurs, et plus vite on y trouve le contact en lumière blanche."), t2: TRAD("Faire rouler C₁ ou C₂, dans un sens ou dans l'autre.") };
      if (c === "blanc" && L.type === "spectrale") return { cle: "b-lampe", t1: TRAD("Au voisinage du contact optique, en coin d'air, remplacer la lampe à sodium par une source de lumière blanche."), t2: TRAD("Étagère, onglet Sources : un clic sur la carte Lanterne, elle remplace la lampe.") };
      if (c === "lamelle" && !st.lamelle) return { cle: "l-pose", t1: APPLIS.lamelle, t2: TRAD("Étagère, onglet Accessoires : glisser la lamelle sur M₁ ou sur M₂.") };
      if (c === "lamelle" && L.type !== "filament") return { cle: "l-blanc", t1: TRAD("Travailler en lumière blanche : les franges ne reviennent qu'au bon chariotage."), t2: TRAD("Étagère, onglet Sources : un clic sur la carte Lanterne, elle remplace la lampe.") };
      if (c === "lamelle") return { cle: "l-C3", t1: TRAD("Derrière la lamelle, la différence de marche a changé : charioter pour y retrouver les franges."),
        t2: geste("C3", st.lamelle.miroir === "M2" ? -1 : 1) };
      if (m.Vmax > 0.5 && m.nfr < 1.5) return { cle: "b-coin", t1: TRAD("Incliner un miroir pour former un coin d'air : plus il y a de franges, plus le champ couvre d'épaisseurs, et plus vite on y trouve le contact en lumière blanche."), t2: TRAD("Faire rouler C₁ ou C₂, dans un sens ou dans l'autre.") };
      return { cle: "b-C3", t1: TRAD("Modifier très légèrement C₃ : en lumière blanche, on ne voit de franges qu'au voisinage immédiat du contact optique."), t2: sensBlanc(st, CO) };
    }
    if (c === "coherence" || c === "doublet" || c === "rayons" || c === "defilement" || c === "rolecomp") {
      if (c === "coherence" && st.lampe === "hgcb") return { cle: "h-pression", t1: TRAD("Repasser la lampe au mercure en haute pression : basse pression, la raie est si fine que les anneaux gardent leur contraste sur toute la course de C₃, le brouillage ne vient jamais."),
        t2: TRAD("Lampe choisie (bandeau des réglages) : Pression, haute.") };
      if (c === "coherence" && !hgVert(st) && st.lampe !== "na") return { cle: "h-lampe", t1: TRAD("Observer les anneaux avec la lampe au mercure et le filtre interférentiel devant elle : une seule raie, assez fine pour des anneaux loin du contact, assez large pour qu'ils finissent par se brouiller."),
        t2: TRAD("Étagère, onglet Sources : la carte Mercure ; onglet Entrée : la carte Filtre, puis « Interférentiel » au bandeau du filtre.") };
      if ((c === "doublet" || c === "rayons" || c === "rolecomp" || (c === "defilement" && !hgVert(st)) || L.type !== "spectrale") && st.lampe !== "na") return { cle: "n-lampe", t1: TRAD("Observer les anneaux avec la lampe au sodium."), t2: SODIUM };
      if (G.plan !== "infini" && !((c === "coherence" || c === "mercure") && G.plan === "miroirs")) return { cle: "n-infini", t1: TRAD("Les anneaux sont localisés à l'infini : l'œil accommode à l'infini (dépoli près de la lampe), ou on les recueille sur un écran dans le plan focal image de la lentille de 1 m."),
        t2: gesteDetecteur(st, "infini") };
      if (G.collimate || !m.nl) return { cle: "n-conv", t1: TRAD("Pour voir les anneaux, il faut un faisceau convergent vers les miroirs : dépoli près de la lampe, ou le condenseur, qui forme l'image de la lampe sur les miroirs."),
        t2: !st.depoli && st.ent.cond == null ? TRAD("Poser le dépoli ou le condenseur : étagère, onglet Entrée.") : st.iris != null ? TRAD("Ouvrir l'iris : molette vers le haut sur sa pastille, ou la glisser vers le haut.") : TRAD("Retirer la lentille d'entrée : un clic sur sa carte (étagère, onglet Entrée), ou Suppr.") };
      if (c === "defilement" && st.det !== "ecran") return { cle: "p-ecran", t1: TRAD("La photodiode se pose sur l'écran, au foyer de la lentille de 1 m."), t2: TRAD("Étagère, onglet Sortie : un clic sur la carte Écran, puis le placer au foyer de la lentille 1 m.") };
      if (c === "rayons" && st.det !== "ecran") return { cle: "y-ecran", t1: APPLIS.rayons, t2: TRAD("Étagère, onglet Sortie : un clic sur la carte Écran, puis le placer au foyer de la lentille 1 m.") };
      if (c !== "coherence" && m.V < 0.35) {
        return diagBrouille(st, CO, R, "n");
      }
      if (c === "coherence" && G.plan === "miroirs" && R.Vgeom != null && R.Vgeom <= 0.25) return { cle: "h-iris", t1: TRAD("En coin d'air, la source étendue brouille aussi les franges quand l'épaisseur grandit : fermer le diaphragme, pour ne voir que l'effet de la largeur de la raie."),
        t2: st.iris == null ? TRAD("Poser l'iris : étagère, onglet Entrée, un clic sur sa carte.") : TRAD("Fermer l'iris : molette vers le bas sur sa pastille, ou la glisser vers le bas.") };
      if (c === "coherence") return { cle: "h", t1: APPLIS.coherence, t2: Math.abs(epaisseur(st)) < 0.3e-3 ? TRAD("Partir du contact et faire rouler C₃ toujours dans le même sens.") : TRAD("Continuer de charioter dans le même sens, jusqu'au brouillage.") };
      if (c === "doublet") return { cle: "d", t1: APPLIS.doublet, t2: ((st.anti || []).length ? TRAD("Un brouillage est repéré : continuer de charioter dans le même sens, le contraste revient.") : TRAD("Charioter lentement, et s'arrêter quand les anneaux disparaissent.")) };
      if (!m.centreDedans) return { cle: "n-centre", t1: TRAD("Les anneaux ne sont pas centrés : M₁ et M₂* sont encore inclinés l'un par rapport à l'autre ; corriger avec C₁ et C₂, puis A₁ et A₂."),
        t2: gesteAlpha(st, Math.hypot(inclinaison(st).ax, inclinaison(st).ay) < 0.03e-3) };
      if (c === "defilement") return !(st.capteur && st.capteur.type === "photodiode")
        ? { cle: "p-pose", t1: TRAD("Poser la photodiode sur l'écran, au centre des anneaux : elle y suit leur défilement quand on chariote."), t2: TRAD("Mesurer ▾, au-dessus de l'image : Photodiode ; puis la glisser au centre des anneaux.") }
        : { cle: "p-centre", t1: TRAD("La photodiode n'est pas au centre des anneaux : là seulement, un anneau naît ou disparaît à chaque frange."), t2: TRAD("Glisser la photodiode jusqu'au centre des anneaux.") };
      if (c === "rolecomp") {
        if (Math.abs(G.e) >= 0.35e-3) return { cle: "q-loin", t1: TRAD("Se rapprocher du contact optique : c'est là que la forme des anneaux se juge le mieux."), t2: gesteC3(st, 0) };
        if (m.nfr < 0.35) return { cle: "q-peu", t1: TRAD("Trop près du contact pour juger de la forme des anneaux : s'en éloigner un peu."), t2: geste("C3", epaisseur(st) >= 0 ? 1 : -1) };
        return { cle: "q-B", t1: TRAD("Tourner la compensatrice : elle n'est plus parallèle à la séparatrice, les anneaux s'allongent en ellipses."), t2: TRAD("Faire rouler B₁ ou B₂, dans un sens ou dans l'autre.") };
      }
      if (c === "rayons") return { cle: "y", t1: APPLIS.rayons, t2: !(st.capteur && st.capteur.type === "barrette") ? TRAD("Poser la barrette sur l'écran : Mesurer ▾, au-dessus de l'image.") : m.nfr < 5 ? TRAD("Charioter pour éloigner du contact : plus d'anneaux dans le champ.") : "" };
    }
    return { cle: "?", t1: "", t2: "" };
  }

  // ================= configurations types (mode prof) =================
  // Pose les vis pour obtenir e (m) et l'inclinaison (ax, ay) (rad) du dérèglement courant, A₁, A₂ au milieu.
  function viser(st, e, ax, ay) {
    var c = st.cache, s = (ax - c.ax0) / (KC * S2), d = (ay - c.ay0) / (KC * S2);
    st.C3 = Math.round(clamp(c.Rc + e * 1e3, 0, C3_MAX) * 1e5) / 1e5;
    st.a1 = st.a2 = 0; st.c1 = (s + d) / 2; st.c2 = (s - d) / 2;
  }
  function compReglee(st) { st.b1 = -st.cache.b10; st.b2 = -st.cache.b20; }
  // Bouton « Compensatrice réglée » : à peu près parallèle, comme après l'autocollimation (écart de 0,25 à 0,6 mrad par
  // axe, tiré avec le numéro du dérèglement) ; il reste à affiner B₁, B₂ sur les anneaux près du contact (rapport des
  // axes ≈ 0,98 à e = 0,1 mm) ou en lumière blanche (contact décalé de 2 µm environ par 0,5 mrad).
  function compApeuPres(st) {
    var u = hasardDe((st.graine ^ 0x5bd1e995) >>> 0), r = function () { return (u() < 0.5 ? -1 : 1) * (0.25 + 0.35 * u()) * 1e-3 / KB; };
    st.b1 = -st.cache.b10 + r(); st.b2 = -st.cache.b20 + r();
  }
  // Bancs : projection du coin d'air (lampe nue loin, image des miroirs par la lentille 20 cm sur l'écran ; la lanterne
  // y garde son condenseur, tiré au maximum : même figure, mêmes étapes qu'avec le filament nu, deux fois plus de
  // lumière ; au tirage de départ, faisceau plus ouvert : 20 fois plus de lumière, mais derrière la lamelle le
  // contraste tombe de 0,57 à 0,50, au seuil de l'application) ;
  // anneaux (dépoli, écran au foyer de la lentille 1 m) ; autocollimation (iris presque fermé au foyer de la
  // lentille 20 cm, œil accommodé à l'infini).
  function banc(st, quoi, lampeK, filtreK) {
    var b = bancDepart();
    if (quoi === "coin") { b.depoli = false; b.iris = null; b.ent.lampe = 0.8; b.sor = { l20: 0.12, l1: null, ecran: 1.12, oeil: OEIL_DEPART }; }
    if (quoi === "auto") { b.iris = 0.0005; b.ent = { lampe: 0.35 + D_DEPOLI, cond: null, coll: 0.15, dep: null }; b.sor = { l20: null, l1: null, ecran: 1.12, oeil: OEIL_DEPART }; b.det = "oeil"; }
    if (lampeK) b.lampe = lampeK;
    if (filtreK) b.filtre = filtreK;
    if (lampeK === "bl") b.lanterne.tirage = TIRAGE_L[1];
    for (var k in b) st[k] = b[k];
    st.lamelle = null;
  }
  var EP_DOUBLET = 0.2894e-3;   // coïncidence du doublet du sodium : λ²/2Δλ
  var CONFIGS = [
    { id: "auto", nom: TRAD("Autocollimation"), f: function (st) { banc(st, "auto"); viser(st, epaisseur(st), 1.2e-3, 0.4e-3); } },
    { id: "coin", nom: TRAD("Coin d'air"), f: function (st) { banc(st, "coin"); compReglee(st); viser(st, 0, 0.06e-3, 0); } },
    { id: "anneaux", nom: TRAD("Anneaux"), f: function (st) { banc(st, "anneaux"); compReglee(st); viser(st, EP_DOUBLET, 0, 0); } },
    // projection du TP : le condenseur (f = 6 cm, à 17 cm) forme l'image de la lampe nue sur les miroirs
    { id: "condenseur", nom: TRAD("Anneaux au condenseur"), f: function (st) {
      banc(st, "anneaux"); st.depoli = false; st.iris = null; st.ent.cond = 0.17;
      st.ent.lampe = Math.round((0.17 + 1 / (1 / ELEMENTS.cond.f - 1 / (ARM + 0.17))) * 1e4) / 1e4;
      compReglee(st); viser(st, 2 * EP_DOUBLET, 0, 0); } },
    { id: "contact", nom: TRAD("Contact"), f: function (st) { banc(st, "anneaux"); compReglee(st); viser(st, 0, 0, 0); } },
    // ----- situations des manipulations (manip: true, id = celui de MANIPS ; nom posé d'après MANIPS) : mode prof -----
    { id: "blanc", manip: true, f: function (st) { banc(st, "coin", "bl"); compReglee(st); viser(st, 0, 0.06e-3, 0); } },
    // mercure nu et son filtre interférentiel (raie de 1 nm du cœur, spectre nommé hg) : contraste perdu dès 0,15 mm
    // environ, géométrie encore bonne
    { id: "coherence", manip: true, f: function (st) { banc(st, "anneaux", "hgc", "interferentiel"); compReglee(st); viser(st, 0.2e-3, 0, 0); } },
    // doublet et lamelle : posés au point de départ (anticoïncidence ; lamelle sans chariotage), le constat vient en chariotant
    { id: "doublet", manip: true, f: function (st) { banc(st, "anneaux"); compReglee(st); viser(st, EP_DOUBLET / 2, 0, 0); } },
    { id: "rayons", manip: true, f: function (st) { banc(st, "anneaux"); compReglee(st); viser(st, 2e-3, 0, 0); st.capteur = { type: "barrette", x: 0, y: -0.05, ang: 0 }; } },
    { id: "lamelle", manip: true, f: function (st) { banc(st, "coin", "bl"); compReglee(st); viser(st, 0, 0.06e-3, 0); st.lamelle = { miroir: "M2", bord: 0 }; } },
    // coin d'air à l'écart du contact, dépoli derrière un diaphragme de 1 mm, écran à 9 cm du plan conjugué des miroirs
    { id: "localisation", manip: true, f: function (st) { banc(st, "coin"); compReglee(st); st.depoli = true; st.iris = 0.001; st.ent.lampe = 0.5 + D_DEPOLI; st.sor.ecran = 0.6; viser(st, 0.05e-3, 0.12e-3, 0); } },
    // fibre au centre du champ, δ = 8 µm : blanc d'ordre supérieur, huit cannelures
    { id: "cannele", manip: true, f: function (st) { banc(st, "coin", "bl"); compReglee(st); viser(st, 4e-6, 0.06e-3, 0); st.capteur = { type: "fibre", x: 0, y: 0, ang: 0 }; } },
    { id: "defilement", manip: true, f: function (st) { banc(st, "anneaux"); compReglee(st); viser(st, EP_DOUBLET, 0, 0); st.capteur = { type: "photodiode", x: 0, y: 0, ang: 0 }; } },
    { id: "mercure", manip: true, f: function (st) { banc(st, "coin", "hgc"); compReglee(st); viser(st, 0, 0.25e-3, 0); } },
    // laser à objectif, du côté du contact où la course est la plus longue
    { id: "laser", manip: true, f: function (st) { banc(st, "anneaux", "laser"); st.depoli = false; st.iris = null; st.lc = true; compReglee(st);
      viser(st, (C3_MAX - st.cache.Rc > st.cache.Rc ? 1 : -1) * 1.1 * E_LASER, 0, 0); } },
    // compensatrice tournée de 6 mrad (B₁), e = 0,1 mm : rapport des axes ≈ 0,76
    { id: "rolecomp", manip: true, f: function (st) { banc(st, "anneaux"); compReglee(st); st.b1 += 6e-3 / KB; viser(st, 0.1e-3, 0, 0); } }
  ];
  CONFIGS.forEach(function (c) { if (c.manip) c.nom = nomEtape(c.id); });

  var Michelson = {
    CONFIGS: CONFIGS, MANIPS: MANIPS, viser: viser, compApeuPres: compApeuPres,
    ARM: ARM, KC: KC, KA: KA, KB: KB, LAMPES: LAMPES, FORMES: FORMES, ELEMENTS: ELEMENTS, W_VUE: W_VUE,
    bancDepart: bancDepart, dereglement: dereglement, etatDepart: etatDepart, epaisseur: epaisseur, inclinaison: inclinaison,
    compensatrice: compensatrice, epLamelle: epLamelle,
    source: source, configOptique: configOptique, lanterne: lanterne, reglerLanterne: reglerLanterne, TIRAGE_L: TIRAGE_L, F_COND_L: F_COND_L, feuilleGeom: feuilleGeom, irisRetour: irisRetour, tiltM1: tiltM1, affichage: affichage, vue: vue,
    laserNu: laserNu, irisVisible: irisVisible,
    elementsBanc: elementsBanc, deplacer: deplacer, deplacerGroupe: deplacerGroupe, poser: poser, detecteur: detecteur,
    porte: porte, posDep: posDep, normaliserPorte: normaliserPorte, migrer: migrer, D_DEPOLI: D_DEPOLI, R_DEPOLI: R_DEPOLI,
    PUPILLE_DEFAUT: PUPILLE_DEFAUT, pupilleDe: pupilleDe, kDepoli: kDepoli, intensiteLaser: intensiteLaser, reelle: reelle, visionDe: visionDe, visionMesure: visionMesure,
    deltaCentre: deltaCentre, transfert: transfert, geometrie: geometrie, mesure: mesure, analyse: analyse, assezDeLumiere: assezDeLumiere,
    passeCapteur: passeCapteur, photodiode: photodiode, barrette: barrette, spectro: spectro, fenetreSpectro: fenetreSpectro,
    modeAcc: modeAcc, accommodation: accommodation, accPour: accPour, accommoder: accommoder,
    L_BARRETTE: L_BARRETTE, CAPTEURS: CAPTEURS, capteurs: capteurs, ETAPES: ETAPES, indice: indice, cible: cible, atteinte: atteinte,
    SEUILS: SEUILS, niveauReglage: niveauReglage, voie: voie, figureDe: figureDe, GESTES: GESTES,
    appliquerGeste: appliquerGeste, zSource: zSource, migrerEtapes: migrerEtapes
  };
  if (typeof module !== "undefined" && module.exports) { module.exports = { Michelson: Michelson }; return; }

  // ======================================================================================================
  // ================= interface ==========================================================================
  // ======================================================================================================
  var P = root.VITRINE_PAILLASSE = root.VITRINE_PAILLASSE || { instruments: {} };
  var CLE_GRAINE_DOUCE = 1;
  // Bancs comprimés (graduations en vraies distances) ; appareil à l'échelle (1 unité = 1 mm).
  var KE = 0.30, KS = 0.14;
  function yE(d) { return 52 + (d * 1000 - 52) * KE; }
  function dE(y) { return ((y - 52) / KE + 52) / 1000; }
  function xS(d) { return 52 + (d * 1000 - 52) * KS; }
  function dS(x) { return ((x - 52) / KS + 52) / 1000; }
  function fmtNb(v, n) { return nb(v, n); }

  function creer(K) {
    var CO = root.VITRINE_MICHELSON, svg = K.svg, el = K.el;
    var BAL = CO.balance();
    var mem = K.memoire.lire(), st;
    if (mem && mem.v === 1 && mem.cache && mem.ent && mem.sor) st = mem;
    else st = etatDepart(CLE_GRAINE_DOUCE, true);
    function completer() {
      if (!st.etapes) st.etapes = {}; if (!st.anti) st.anti = []; if (!st.cahier) st.cahier = []; delete st.meth;
      migrerEtapes(st.etapes);
      if ("regle" in st) { if (st.regle) st.capteur = { type: "barrette", x: st.regle.x, y: st.regle.y, ang: st.regle.ang }; delete st.regle; }   // règle d'avant la barrette
      migrer(st); normaliserPorte(st);
      if (st.accMode === "source") { st.acc = accommodation(st); st.accMode = "main"; }      // « Sur la source » n'existe plus : l'accommodation du moment, à la main
    }
    completer();
    // Chariot : il suit la vis C3 en douceur (τ = 0,12 s) ; un cran de molette (10 µm, 34 ordres) devient un
    // mouvement, dont la fin, lente, montre les anneaux rentrer ou sortir dans le bon sens.
    var c3Vu = st.C3, tC3 = 0, TAU_C3 = 0.12, c0Prec = null, tOpt = 0;
    var sale = { dessin: true, optique: true, loupe: true, etagere: true, obs: true };
    // analyse (étapes) : au repos, 300 ms après le dernier changement, chariot arrivé
    var aSale = true, tModif = 0;
    // luminosite : interrupteur de l'affichage ; pupille : suivie par l'instrument (adaptation), jamais un geste
    var nPup = 0;
    // sel, selL : l'élément choisi (et ceux choisis avec lui), hors annulation : sinon chaque clic est une étape de Ctrl+Z
    var SANS_ANNULER = ["cahier", "lumiere", "capReels", "etapes", "anti", "vise", "luminosite", "pupille", "sel", "selL"];
    function maintenant() { return root.performance ? root.performance.now() : Date.now(); }
    function modifie(quoi) {
      normaliserPorte(st);       // support vidé, ou revenu contre la lampe
      (quoi || "dessin optique loupe obs").split(" ").forEach(function (q) { sale[q] = true; });
      sale.band = true;          // bandeau de l'élément choisi : valeurs mises à jour en place
      nPup = 0;
      aSale = true; tModif = maintenant(); if (typeof CAP !== "undefined") CAP.sale = true;
      K.modifie();
    }

    // ================= vue de dessus =================
    var D = K.dessus;
    var defs = svg("defs", {}, D);
    defs.innerHTML =
      '<linearGradient id="plPlat" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4a5562"/><stop offset=".55" stop-color="#36404b"/><stop offset="1" stop-color="#272e36"/></linearGradient>' +
      '<linearGradient id="plCylY" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3a4048"/><stop offset=".35" stop-color="#9aa3ad"/><stop offset=".6" stop-color="#6c747e"/><stop offset="1" stop-color="#2c3137"/></linearGradient>' +
      '<linearGradient id="plCylX" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a4048"/><stop offset=".35" stop-color="#9aa3ad"/><stop offset=".6" stop-color="#6c747e"/><stop offset="1" stop-color="#2c3137"/></linearGradient>' +
      '<linearGradient id="plMetX" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#727b86"/><stop offset=".5" stop-color="#4b535d"/><stop offset="1" stop-color="#343a42"/></linearGradient>' +
      '<linearGradient id="plMetY" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#727b86"/><stop offset=".5" stop-color="#4b535d"/><stop offset="1" stop-color="#343a42"/></linearGradient>' +
      '<linearGradient id="plRail" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c3139"/><stop offset=".5" stop-color="#1c2026"/><stop offset="1" stop-color="#14171b"/></linearGradient>' +
      '<linearGradient id="plRailV" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2c3139"/><stop offset=".5" stop-color="#1c2026"/><stop offset="1" stop-color="#14171b"/></linearGradient>' +
      '<linearGradient id="plVerre" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#bfe6f5" stop-opacity=".55"/><stop offset=".5" stop-color="#7fb7cf" stop-opacity=".35"/><stop offset="1" stop-color="#bfe6f5" stop-opacity=".6"/></linearGradient>' +
      '<linearGradient id="plMiroir" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f4f7fa"/><stop offset=".5" stop-color="#b9c3cc"/><stop offset="1" stop-color="#eef2f5"/></linearGradient>' +
      '<radialGradient id="plReflecteur" cx=".35" cy=".5" r=".7"><stop offset="0" stop-color="#4a525c"/><stop offset=".7" stop-color="#1f242a"/><stop offset="1" stop-color="#121519"/></radialGradient>' +
      '<radialGradient id="plFilLueur"><stop offset="0" stop-color="#fff2c4" stop-opacity=".9"/><stop offset=".45" stop-color="#ffc56a" stop-opacity=".35"/><stop offset="1" stop-color="#ffb347" stop-opacity="0"/></radialGradient>' +
      '<radialGradient id="plLueur"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".25" id="plLueurC" stop-color="#ffc23a" stop-opacity=".55"/><stop offset="1" stop-color="#ffc23a" stop-opacity="0"/></radialGradient>' +
      '<radialGradient id="plTable" cx=".42" cy=".62" r=".75"><stop offset="0" stop-color="#191c21"/><stop offset="1" stop-color="#0a0b0d"/></radialGradient>' +
      '<filter id="plOmbre" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="1.6" dy="2.4" stdDeviation="2" flood-color="#000" flood-opacity=".75"/></filter>' +
      '<filter id="plFlou"><feGaussianBlur stdDeviation="3"/></filter>' +
      '<radialGradient id="plSclere" cx=".38" cy=".4" r=".7"><stop offset="0" stop-color="#eef1f4"/><stop offset=".7" stop-color="#c3cad2"/><stop offset="1" stop-color="#8d969f"/></radialGradient>' +
      K.Dessin.DEFS;   // dégradés bc* du module Dessin : bancs vus de dessus, pastilles (aussi lus par les miniatures HTML du bandeau)
    var VB = { x: -205, y: -292, w: 655, h: 590 };
    var gTable = svg("g", {}, D), gFixe = svg("g", {}, D), gFaisceau = svg("g", { class: "pl-faisceau", style: "mix-blend-mode:screen", "pointer-events": "none" }, D), gLueur = svg("g", { style: "mix-blend-mode:screen", "pointer-events": "none" }, D), gMobile = svg("g", {}, D), gVis = svg("g", {}, D), gPast = svg("g", {}, D);
    svg("rect", { x: VB.x - 200, y: VB.y - 200, width: VB.w + 400, height: VB.h + 400, fill: "url(#plTable)" }, gTable);

    function txt(par, x, y, t, cls, anc) { var z = svg("text", { x: x, y: y, class: cls || "pl-lab", "text-anchor": anc || "start" }, par); z.textContent = t; return z; }
    function dessinerFixe() {
      var g = gFixe;
      // ---- bancs d'optique vus de dessus (comme le banc d'optique : rail, règle sur le bord, vraies distances sur un
      // banc comprimé, yE / xS ; Dessin.railDessus suppose une échelle linéaire) ; data-banc : clic droit, lâcher ----
      var p = "", pg = "", d, ge = svg("g", { "data-banc": "ent" }, g), gs;
      svg("rect", { x: -26, y: 58, width: 52, height: yE(0.8) - 50, fill: "transparent" }, ge);
      svg("rect", { x: -9, y: 58, width: 18, height: yE(0.8) - 50, rx: 2, fill: "url(#bcRailD)", opacity: .85 }, ge);
      svg("path", { d: "M-3 58V" + (yE(0.8) + 8) + "M3 58V" + (yE(0.8) + 8), stroke: "#14171c", "stroke-width": 1.2 }, ge);
      svg("rect", { x: 9, y: 58, width: 11, height: yE(0.8) - 50, fill: "url(#bcRegle)", stroke: "#262c34", "stroke-width": .8 }, ge);
      for (d = 7; d <= 80; d++) { var y = yE(d / 100); if (d % 10) p += "M9 " + y.toFixed(1) + "h" + (d % 5 ? 3 : 5); else pg += "M9 " + y.toFixed(1) + "h7"; }
      svg("path", { d: p, stroke: "#7f8996", "stroke-width": .6 }, ge); svg("path", { d: pg, stroke: "#cfd6de", "stroke-width": 1 }, ge);
      for (d = 10; d <= 80; d += 10) txt(ge, 23, yE(d / 100) + 3, d + (d === 80 ? " cm" : ""), "bc-grad pl-grad-b");
      gs = svg("g", { "data-banc": "sor" }, g); p = ""; pg = "";
      svg("rect", { x: 56, y: -26, width: xS(2.5) - 46, height: 52, fill: "transparent" }, gs);
      svg("rect", { x: 56, y: -9, width: xS(2.5) - 46, height: 18, rx: 2, fill: "url(#bcRailD)", opacity: .85 }, gs);
      svg("path", { d: "M56 -3H" + (xS(2.5) + 10) + "M56 3H" + (xS(2.5) + 10), stroke: "#14171c", "stroke-width": 1.2 }, gs);
      svg("rect", { x: 56, y: 9, width: xS(2.5) - 46, height: 11, fill: "url(#bcRegle)", stroke: "#262c34", "stroke-width": .8 }, gs);
      for (d = 10; d <= 250; d += 5) { var x = xS(d / 100); if (d % 50) p += "M" + x.toFixed(1) + " 9v" + (d % 10 ? 3 : 5); else pg += "M" + x.toFixed(1) + " 9v7"; }
      svg("path", { d: p, stroke: "#7f8996", "stroke-width": .6 }, gs); svg("path", { d: pg, stroke: "#cfd6de", "stroke-width": 1 }, gs);
      for (d = 50; d <= 250; d += 50) txt(gs, xS(d / 100), 30, d % 100 ? fmtNb(d / 100, 1) + " m" : d / 100 + " m", "bc-grad pl-grad-b", "middle");
      // ---- platine en L (fonte peinte) ----
      var pl = "M -186 -40 Q -186 -48 -178 -48 L -48 -48 L -48 -222 Q -48 -230 -40 -230 L 40 -230 Q 48 -230 48 -222 L 48 40 Q 48 48 40 48 L -178 48 Q -186 48 -186 40 Z";
      svg("path", { d: pl, fill: "url(#plPlat)", stroke: "#1d2228", "stroke-width": 1.5, filter: "url(#plOmbre)" }, g);
      svg("path", { d: "M -180 -42 L -42 -42 L -42 -224 L 42 -224 L 42 42 L -180 42 Z", fill: "none", stroke: "#8a96a4", "stroke-opacity": .18 }, g);
      [[-176, -38], [-176, 38], [-38, -220], [38, -220], [38, 38]].forEach(function (p) {
        svg("circle", { cx: p[0], cy: p[1], r: 2.6, fill: "#1f252c", stroke: "#5c6672", "stroke-width": .6 }, g);
      });
      // ---- glissières du chariot de M2 ----
      [-27, 21].forEach(function (x0) {
        svg("rect", { x: x0, y: -214, width: 6, height: 112, rx: 1, fill: "url(#plMetY)", stroke: "#1d2228" }, g);
      });
      // ---- support et corps du micromètre C3 (manchon gradué) ----
      svg("rect", { x: -34, y: -232, width: 68, height: 12, rx: 2, fill: "url(#plMetX)", stroke: "#1d2228" }, g);
      svg("rect", { x: -7, y: -252, width: 14, height: 22, fill: "url(#plCylY)", stroke: "#1d2228" }, g);
      for (var t = 0; t < 8; t++) svg("line", { x1: -7, y1: -250 + 2.6 * t, x2: -3.5, y2: -250 + 2.6 * t, stroke: "#24282d", "stroke-width": .5 }, g);
      // ---- verre anticalorique ----
      svg("rect", { x: -24, y: 49, width: 48, height: 4, fill: "url(#plVerre)", stroke: "#9fd3e8", "stroke-opacity": .7 }, g);
      svg("rect", { x: -28, y: 48, width: 5, height: 7, fill: "#2a3037" }, g); svg("rect", { x: 23, y: 48, width: 5, height: 7, fill: "#2a3037" }, g);
      txt(g, -30, 58, TRAD("verre anticalorique"), "pl-lab", "end");      // à gauche : la droite du banc d'entrée porte les pastilles
      // ---- séparatrice et compensatrice (lames parallèles à 45°) ----
      lame(g, 0, 0, "url(#plVerre)", 54);
      lame(g, -8, 8, "url(#plVerre)", 50);
      // monture de la compensatrice (B1, B2)
      svg("path", { d: "M -40 22 L -27 22 L -19 30 L -19 34 L -40 34 Z", fill: "url(#plMetX)", stroke: "#1d2228" }, g);
      // étiquettes parallèles aux lames (rotation de 45°), chacune du côté opposé à l'autre lame
      txt(g, 0, 0, TRAD("séparatrice"), "pl-lab", "middle").setAttribute("transform", "translate(5.5 -5.5) rotate(45)");
      txt(g, 0, 0, TRAD("compensatrice"), "pl-lab", "middle").setAttribute("transform", "translate(-15 15) rotate(45)");
      // ---- M1 (fixe) et sa monture ----
      var gm = svg("g", { "data-mir": "M1" }, g);
      svg("rect", { x: -160, y: -38, width: 36, height: 76, fill: "transparent" }, gm);
      svg("rect", { x: -150, y: -30, width: 12, height: 60, rx: 2, fill: "url(#plMetY)", stroke: "#1d2228", filter: "url(#plOmbre)" }, gm);
      svg("rect", { x: -138, y: -22, width: 8, height: 44, fill: "#2b3138" }, gm);
      svg("rect", { x: -136, y: -19, width: 6, height: 38, fill: "url(#plMiroir)" }, gm);
      svg("rect", { x: -156, y: -36, width: 22, height: 6, rx: 1, fill: "url(#plMetX)", stroke: "#1d2228" }, gm);
      txt(gm, -128, -26, "M₁");
    }
    function lame(g, x, y, fill, L) {
      var q = svg("g", { transform: "translate(" + x + " " + y + ") rotate(45)" }, g);
      svg("rect", { x: -L / 2, y: -2.2, width: L, height: 4.4, fill: fill, stroke: "#a7dcef", "stroke-opacity": .8, "stroke-width": .6 }, q);
      svg("rect", { x: -L / 2 - 4, y: -4, width: 5, height: 8, rx: 1, fill: "#2a3037" }, q);
      svg("rect", { x: L / 2 - 1, y: -4, width: 5, height: 8, rx: 1, fill: "#2a3037" }, q);
    }

    // ---- vis ----
    var V = {};
    function vis(id, o) { V[id] = K.vis(gVis, o); V[id].g.setAttribute("data-vis", id); return V[id]; }
    function posM2() { return -130 - epaisseur(st, c3Vu) * 1000; }
    // C₃ : le chariot de M₂ suit la main (gainMin 0,3 : un glisser lent avance par pas plus fins que le pixel ; accel 25 :
    // lancée d'un coup de poignet, elle chariote vite, et le chariot lissé (τ) étale le mouvement).
    vis("C3", { x: 0, y: -266, long: 26, diam: 32, axe: "y", nom: "C₃", lx: 24, ly: 3, ancre: "start", stries: 28, repere: true,
      accel: 25, gainMin: 0.3,
      tours: function () { return c3Vu / PAS_C3; }, pasMolette: [0.01 / PAS_C3, 0.001 / PAS_C3, 0.0001 / PAS_C3],
      tourner: function (dt) { st.C3 = Math.round(clamp(st.C3 + dt * PAS_C3, 0, C3_MAX) * 1e5) / 1e5; modifie(); } });
    function visInc(id, cle, x, y, axe, lx, ly, anc) {
      return vis(id, { x: x, y: y, long: 15, diam: 13, axe: axe, nom: id.charAt(0) + "₁₂"[+id.charAt(1) - 1], lx: lx, ly: ly, ancre: anc,
        accel: id.charAt(0) === "C" ? 25 : 0, fin: id.charAt(0) !== "C",
        tours: function () { return st[cle]; }, tourner: function (dt) { st[cle] += dt; modifie(); } });
    }
    visInc("C1", "c1", -19, 0, "y", -12, 4, "end");
    visInc("C2", "c2", 19, 0, "y", 12, 4, "start");
    visInc("A1", "a1", -164, -17, "x", -11, 4, "end");
    visInc("A2", "a2", -164, 17, "x", -11, 4, "end");
    visInc("B1", "b1", -50, 28, "x", -11, 4, "end");
    visInc("B2", "b2", -30, 40, "y", 11, 4, "start");
    // tout le chariot vaut C3 pour la molette, sauf près de C₁ et C₂ (rayon 28 px : on y prend la vis la plus proche)
    K.zoneMolette(function (p) {
      var y2 = posM2();
      return Math.abs(p.x) < 34 && p.y > -285 && p.y < y2 + 4 && Math.hypot(Math.abs(p.x) - 19, p.y - (y2 - 23)) >= 28 ? V.C3.molette : null;   // à moins de 28 px de C₁ ou C₂ : la vis la plus proche
    });
    // Molette sur un élément des bancs : le long de son banc, dans le sens de
    // l'écran (entrée, vers le haut = vers l'appareil ; sortie, vers le haut = vers la droite), 1 mm par cran (Maj 0,1 ·
    // Ctrl+Maj 0,01 · Ctrl 1 cm) ; dépoli et iris emportent la lampe. Pastilles : `K.pastilles` (plus bas), avant ceci.
    K.cibleMolette(function (t) {
      var g = t && t.closest && D.contains(t) ? t.closest("[data-el]") : null, id = g && g.getAttribute("data-el");
      return id && bancDe(id) ? function (k, ev) { bouger(id, k, ev); modifie(); } : null;
    });

    function majVisMobiles() {   // C1, C2 suivent la monture de M2
      var y2 = posM2();
      [["C1", -19], ["C2", 19]].forEach(function (c) {
        var v = V[c[0]]; v.o.y = y2 - 25; v.dessiner();
        var t = v.g.querySelector("text"); if (t) { t.setAttribute("y", v.o.y + 4); t.setAttribute("x", c[1] + (c[1] < 0 ? -13 : 13)); }
      });
    }

    // ================= éléments des bancs : ids, déplacer, régler, retirer =================
    // Ids : lampe, filtre (sur le porte-dépoli, comme le dépoli et l'iris), depoli, iris (sur le porte-dépoli d'une lampe
    // spectrale, `porte` ; vissés sur la lanterne), cond, coll (entrée), l20, l1, det (l'écran ou l'œil posé), et
    // hors des bancs comp, feuille, lamelle. st.sel = l'élément choisi (un seul), hors annulation.
    var NOMS_EL = { filtre: TRAD("Filtre"), depoli: TRAD("Dépoli"), iris: TRAD("Iris"), cond: TRAD("Condenseur"), coll: TRAD("Lentille 20 cm"), l20: TRAD("Lentille 20 cm"), l1: TRAD("Lentille 1 m"),
      comp: TRAD("Compensatrice"), feuille: TRAD("Feuille"), lamelle: TRAD("Lamelle") };
    var MED_LAMPE = { na: "sodium", hgc: "mercure", hgcb: "mercure", bl: "lanterne", laser: "laser" };
    function nomEl(id) {
      if (id === "lampe") return lampe(st).court.replace(" (blanche)", "");
      if (id === "det") return st.det === "oeil" ? TRAD("Œil") : TRAD("Écran");
      return NOMS_EL[id] || id;
    }
    function figureEl(id) {
      if (id === "lampe") return { med: MED_LAMPE[st.lampe] || "sodium" };
      if (id === "filtre") return { med: "filtre", teinte: (filtre(st) || FILTRES[FILTRE_DEFAUT]).coul };
      if (id === "iris") return { med: "iris", d: Math.min(40, (st.iris || 0) * 1600) };
      if (id === "cond") return { med: "conv", mo: "60" };
      if (id === "coll" || id === "l20") return { med: "conv", mo: "200" };
      if (id === "l1") return { med: "conv", mo: "1000" };
      if (id === "det") return { med: st.det };
      return { med: id === "comp" ? "lamelle" : id };
    }
    function bancDe(id) { return /^(lampe|depoli|iris|cond|coll)$/.test(id) ? "ent" : /^(l20|l1|det)$/.test(id) ? "sor" : null; }
    function cleBanc(id) { return id === "depoli" || id === "iris" ? (porte(st) ? "dep" : "lampe") : id === "det" ? st.det : id; }
    function posEl(id) { return lirePos(st, bancDe(id), cleBanc(id)); }
    function present(id) {
      var pt = lampe(st).type === "point";
      if (id === "filtre") return !!filtre(st);
      if (id === "depoli") return !!st.depoli && !pt;
      if (id === "iris") return st.iris != null && !pt;
      if (id === "cond" || id === "coll") return st.ent[id] != null;
      if (id === "l20" || id === "l1") return st.sor[id] != null;
      if (id === "feuille") return !!st.feuille;
      if (id === "lamelle") return !!st.lamelle;
      return id === "lampe" || id === "det" || id === "comp";
    }
    // Pas d'un déplacement : 1 mm (Maj 0,1 · Ctrl+Maj 0,01 · Ctrl 1 cm), en m.
    function pasPos(ev) { return ev && ev.shiftKey ? ((ev.ctrlKey || ev.metaKey) ? 1e-5 : 1e-4) : ev && ev.ctrlKey ? 1e-2 : 1e-3; }
    // Le long du banc, dans le sens de l'écran : k > 0 = vers le haut (entrée : vers l'appareil) ou vers la droite (sortie).
    function bouger(id, k, ev) {
      var b = bancDe(id); if (!b) return;
      var dv = (b === "ent" ? -k : k) * pasPos(ev), G = groupeDe(id);
      if (G.length > 1) deplacerGroupe(st, b, G, dv); else deplacer(st, b, cleBanc(id), posEl(id) + dv);
    }
    // Réglage principal (pastille, molette, glisser vertical, flèches perpendiculaires au banc) : { lab, f(k, ev) } ou null.
    function reglage(id) {
      if (id === "lampe" && condLanterne(st)) return { lab: TRAD("tirage du condenseur"), f: function (k, ev) { reglerLanterne(st, lanterne(st).tirage + k * pasPos(ev)); } };
      if (id === "iris" && present("iris")) return { lab: TRAD("diamètre"), f: function (k, ev) {
        st.iris = clamp(st.iris * Math.pow(0.87, -k * (ev && ev.shiftKey ? ((ev.ctrlKey || ev.metaKey) ? 0.025 : 0.25) : ev && ev.ctrlKey ? 3 : 1)), IRIS_MIN, R_DEPOLI); } };
      if (id === "det" && st.det === "oeil") return { lab: "accommodation", f: function (k, ev) { accommoder(st, k, ev); sale.obs = true; } };   // comme la molette sur l'image
      if (/^(cond|coll|l20|l1|det)$/.test(id)) return { lab: id === "cond" ? TRAD("position (son tirage)") : "position", f: function (k, ev) { bouger(id, k, ev); } };
      return null;
    }
    // Retirer (ni la lampe, ni le détecteur, ni la compensatrice) : vrai si c'est fait.
    function retirer(id) {
      if (id === "depoli") st.depoli = false; else if (id === "iris") st.iris = null;
      else if (id === "cond" || id === "coll") st.ent[id] = null; else if (id === "l20" || id === "l1") st.sor[id] = null;
      else if (id === "feuille") { st.feuille = null; if (st.vue === "feuille") st.vue = "det"; }
      else if (id === "lamelle") st.lamelle = null;
      else if (id === "filtre") st.filtre = null;
      else return false;
      if (st.sel === id) st.sel = null;
      return true;
    }
    // Ordre de la lumière (Tab) : lampe, filtre, dépoli, iris, lentilles d'entrée vers l'appareil, lentilles de sortie,
    // détecteur.
    function ordreLumiere() {
      var ent = ["cond", "coll"].filter(present).sort(function (a, b) { return st.ent[b] - st.ent[a]; });
      var sor = ["l20", "l1"].filter(present).sort(function (a, b) { return st.sor[a] - st.sor[b]; });
      return ["lampe", "filtre", "depoli", "iris"].filter(present).concat(ent, sor, ["det"]);
    }
    // Sélection multiple (comme le banc d'optique), sur UN banc : st.selL = les éléments choisis, le dernier au bout ;
    // st.sel = celui-là (bandeau, réglages). Une affectation directe de st.sel vaut « lui seul » (sels() remet la liste).
    // mode "" : lui seul ; "ajout" (Ctrl+clic) : l'ajouter ou le retirer ; "plage" (Maj+clic) : tous ceux du banc entre le
    // dernier choisi et lui ; "devant" : déjà choisi, il passe au bout. Dépoli et iris : un seul support, comptés ensemble.
    function sels() {
      var L = st.selL;
      if (!Array.isArray(L) || L[L.length - 1] !== (st.sel || undefined)) L = st.selL = st.sel ? [st.sel] : [];
      return L.filter(present);
    }
    function estSel(id) { return sels().indexOf(id) >= 0; }
    function choisir(id, mode) {
      var L = sels(), i, b = id && bancDe(id), prec = st.sel;
      if (!id) L = [];
      else if (mode && b && L.length && bancDe(L[L.length - 1]) !== b) L = [id];        // un seul banc à la fois
      else if (mode === "ajout") { i = L.indexOf(id); if (i >= 0) L.splice(i, 1); else L.push(id); }
      else if (mode === "plage" && prec && b && bancDe(prec) === b) {
        var a = posEl(prec), z = posEl(id), lo = Math.min(a, z) - 1e-9, hi = Math.max(a, z) + 1e-9;
        ordreLumiere().filter(function (q) { return bancDe(q) === b && posEl(q) >= lo && posEl(q) <= hi; })
          .forEach(function (q) { if (L.indexOf(q) < 0) L.push(q); });
        L.splice(L.indexOf(id), 1); L.push(id);
      } else if (mode === "devant" && (i = L.indexOf(id)) >= 0) { L.splice(i, 1); L.push(id); }
      else L = [id];
      var s0 = JSON.stringify([st.sel, st.selL]);
      st.selL = L; st.sel = L.length ? L[L.length - 1] : null;
      if (JSON.stringify([st.sel, st.selL]) !== s0) { TAPE = null; modifie("dessin etagere"); }
    }
    // Clés de banc que déplace un geste sur `id` : la sélection entière s'il en fait partie (sur son banc), sinon lui.
    function groupeDe(id) {
      var b = bancDe(id), L = sels();
      if (L.length < 2 || L.indexOf(id) < 0) return [cleBanc(id)];
      var out = [];
      L.forEach(function (q) { if (bancDe(q) === b) { var c = cleBanc(q); if (out.indexOf(c) < 0) out.push(c); } });
      return out;
    }
    function modeClic(ev) { return ev && (ev.ctrlKey || ev.metaKey) ? "ajout" : ev && ev.shiftKey ? "plage" : ""; }
    function changerLampe(k) {
      // la pression choisie (basse) est retenue en passant d'une lampe mercure à l'autre ; hors lampes mercure, elle dort
      if (st.pression === "basse") k = { hgc: "hgcb" }[k] || k;
      st.lampe = k;          // même position : celle de la lampe (st.ent.lampe) ; filtre, dépoli et iris restent posés (ignorés avec le laser)
      if (condLanterne(st)) reglerLanterne(st, lanterne(st).tirage);   // son condenseur doit tenir devant elle
      if (LAMPES[k].type === "point" && (st.sel === "depoli" || st.sel === "iris")) st.sel = "lampe";
      modifie("dessin optique loupe obs etagere");
    }
    function changerDet(d) { if (st.det !== d) { detecteur(st, d); st.vue = "det"; modifie("dessin optique obs etagere"); } }
    // Filtre devant la lampe : un seul à la fois, sur le porte-dépoli (comme le dépoli et l'iris). `null` : aucun.
    function poserFiltre(v) {
      st.filtre = v || null;
      if (v) st.sel = "filtre";
      TAPE = null; modifie("dessin optique loupe obs etagere");
    }
    function itemsFiltre() {     // menu : les quatre filtres et « aucun », coché sur celui qui est posé
      return [null].concat(CLES_FILTRE).map(function (f) {
        return { lab: f ? FILTRES[f].nom : TRAD("aucun"), coche: (st.filtre || null) === f, act: function () { poserFiltre(f); } };
      });
    }

    // ---- éléments des bancs vus de dessus (cavalier, index doré, contour doré quand choisi) et leurs pastilles ----
    // Banc d'entrée tourné de 90° : repère local x le long du banc vers l'appareil. Pastilles : lampe, dépoli,
    // iris en rangée sous la lampe (filets en L), lentilles d'entrée à droite du banc, de sortie au-dessus.
    function dessinerBancs(g) {
      var Lp = lampe(st), pt = Lp.type === "point", yl = yE(st.ent.lampe), sel = st.sel;
      gPast.innerHTML = "";
      function cavalier(q, s) {
        svg("rect", { x: -11, y: -14, width: 22, height: 28, rx: 3, fill: "url(#bcCav)", stroke: s ? "#e0b84c" : "#636c78", "stroke-width": s ? 1.4 : 0.7 }, q);
        svg("path", { d: "M-3.5 14l3.5 5 3.5-5z", fill: "#e0b84c" }, q);
      }
      function lentille(q, R, ep) {
        svg("rect", { x: -3, y: -R - 5, width: 6, height: 2 * R + 10, rx: 2, fill: "#2b3138", stroke: "#15181c" }, q);
        svg("path", { d: "M0 " + (-R) + "Q" + 2 * ep + " 0 0 " + R + "Q" + (-2 * ep) + " 0 0 " + (-R) + "z", fill: "url(#bcVerre)", stroke: "#bfe2ff", "stroke-width": .8 }, q);
      }
      function groupe(id, tr, hit) {
        var q = svg("g", { class: "bc-el" + (estSel(id) ? " sel" : ""), "data-el": id, transform: tr }, g);
        svg("rect", { x: hit[0], y: hit[1], width: hit[2], height: hit[3], fill: "transparent" }, q);
        return q;
      }
      // ---- entrée : lampe (dépoli et iris collés devant), condenseur, lentille ----
      var py = -1e9, P = [];
      ["cond", "coll"].filter(present).sort(function (a, b) { return st.ent[a] - st.ent[b]; }).forEach(function (k) {
        var y = yE(st.ent[k]), q = groupe(k, "translate(0 " + y.toFixed(2) + ") rotate(-90)", [-14, -34, 28, 68]);
        cavalier(q, estSel(k)); lentille(q, ELEMENTS[k].R * 1000, k === "cond" ? 8 : 4);
        py = Math.max(y, py + 40);
        P.push({ id: k, cx: 70, cy: py, nom: "d", filet: [[27, y], [40, y], [52, py]] });
      });
      // lanterne : boîtier autour du filament (la position de la lampe), tube du condenseur jusqu'à lui, à
      // l'échelle du banc (tirage × KE) ; dépoli et iris se posent devant sa sortie (fr : décalage vers l'appareil)
      var lant = st.lampe === "bl", fr = avantLampe(st) * 1000 * KE, xs = lant ? Math.max(9, fr) : 0;
      var ql = groupe("lampe", "translate(0 " + yl.toFixed(2) + ") rotate(-90)", pt ? [-80, -30, 104, 60] : lant ? [-34, -30, xs + 40, 60] : [-58, -30, 62, 60]);
      cavalier(ql, estSel("lampe"));
      if (lant) {
        svg("rect", { x: -30, y: -23, width: 38, height: 46, rx: 5, fill: "url(#bcNoir)", stroke: "#5b6471", "stroke-width": .8 }, ql);
        // réflecteur, ampoule, filament spiralé en travers du banc (7 spires, comme FORMES.filament) sur ses deux fils d'amenée, lueur chaude
        svg("circle", { cx: -2, cy: 0, r: 12, fill: "url(#plReflecteur)", stroke: "#3a424d", "stroke-width": .7 }, ql);
        svg("circle", { cx: 0, cy: 0, r: 8, fill: "url(#plFilLueur)" }, ql);
        svg("ellipse", { cx: 0, cy: 0, rx: 4.2, ry: 7.2, fill: "#fff4d6", "fill-opacity": .08, stroke: "#d9d2c0", "stroke-opacity": .35, "stroke-width": .5 }, ql);
        svg("path", { d: "M-6 -4.6H-1.2M-6 4.6H-1.2", stroke: "#9aa3ad", "stroke-width": .6 }, ql);
        var spi = "M-1.2 -4.6"; for (var sp = 0; sp < 7; sp++) spi += "Q3.2 " + (-4.6 + 9.2 / 7 * (sp + 0.5)).toFixed(2) + " -1.2 " + (-4.6 + 9.2 / 7 * (sp + 1)).toFixed(2);   // spires vues de côté
        svg("path", { d: spi, fill: "none", stroke: "#ffe7a8", "stroke-width": .9, "stroke-linecap": "round" }, ql);
        if (fr > 0) {
          svg("rect", { x: 8, y: -14, width: Math.max(2, xs - 8), height: 28, fill: "url(#bcNoir)", stroke: "#5b6471", "stroke-width": .8 }, ql);
          svg("path", { d: "M" + xs + " -15Q" + (xs + 5) + " 0 " + xs + " 15z", fill: "url(#bcVerre)", stroke: "#bfe2ff", "stroke-width": .8 }, ql);
        }
      } else if (pt) {
        ql.insertAdjacentHTML("beforeend", K.Dessin.corps({ genre: "laser" }, 0, 0, 1, false));
        if (st.lc !== false) {     // objectif de microscope : filetage contre le laser, frontale vers l'appareil
          var ob = OBJECTIFS[objectif(st)];
          svg("g", { transform: "translate(21 0) scale(-.85 .85)" }, ql).innerHTML = K.Dessin.corps({ genre: "lentille", forme: "objectif", diam: 5 }, 0, 0, 1, false).replace("#3fae5a", ob.bague);
        }
      } else ql.insertAdjacentHTML("beforeend", K.Dessin.lampeDessus({ genre: "lampe", med: st.lampe === "na" ? "sodium" : "x", coul: Lp.coul }, 0, 0));
      document.getElementById("plLueurC") && document.getElementById("plLueurC").setAttribute("stop-color", Lp.coul);
      if (!pt) svg("ellipse", { cx: 0, cy: yl - (lant ? xs + 4 : 0), rx: lant ? 46 : 34, ry: lant ? 30 : 26, fill: "url(#plLueur)", opacity: st.depoli ? .45 : .6 }, gLueur);
      else svg("ellipse", { cx: 0, cy: yl - 6, rx: 10, ry: 8, fill: "url(#plLueur)", opacity: .5 }, gLueur);
      // lampe spectrale : dépoli (au plan de sa position) et iris juste devant, sur le porte-dépoli ; détaché de la lampe,
      // il a son cavalier, dont l'index doré marque le plan du dépoli sur la règle
      var pd = porte(st), yDe = pd ? yE(posDep(st)) : yl - (lant ? xs + 4 : 5), yIr = pd ? yDe - 8 : yl - (lant ? xs + 12 : 13);
      if (pd && st.ent.dep != null) {
        var qc = groupe(present("depoli") ? "depoli" : "iris", "translate(0 " + yDe.toFixed(2) + ") rotate(-90)", [-3, -14, 14, 34]);
        svg("rect", { x: -3, y: -9, width: 14, height: 18, rx: 2, fill: "url(#bcCav)", stroke: estSel("depoli") || estSel("iris") ? "#e0b84c" : "#636c78", "stroke-width": estSel("depoli") || estSel("iris") ? 1.4 : 0.7 }, qc);
        svg("rect", { x: -0.6, y: 9, width: 1.2, height: 5, fill: "#636c78" }, qc);
      }
      if (present("depoli")) groupe("depoli", "translate(0 " + yDe.toFixed(2) + ") rotate(-90)", [-3, -30, 6, 60])
        .insertAdjacentHTML("beforeend", K.Dessin.corps({ genre: "plaque", clair: 2 }, 0, 0, R_DEPOLI * 1000 / 30, false));
      if (present("iris")) groupe("iris", "translate(0 " + yIr.toFixed(2) + ") rotate(-90)", [-4, -32, 8, 64])
        .insertAdjacentHTML("beforeend", K.Dessin.corps({ genre: "iris", d: Math.min(R_DEPOLI, st.iris) * 2000 }, 0, 0, 1, false));
      if (pd && st.ent.dep != null)        // index doré du porte-dépoli, par-dessus le dépoli : le plan du dépoli sur la règle
        svg("path", { d: "M-3.5 14l3.5 5 3.5-5z", fill: "#e0b84c", transform: "translate(0 " + yDe.toFixed(2) + ") rotate(-90)", "pointer-events": "none" }, g);
      // filtre : devant le dépoli et l'iris, sur le même support — et devant toutes les lampes, lanterne et laser compris
      var yFi = yIr - 9;
      if (present("filtre")) groupe("filtre", "translate(0 " + yFi.toFixed(2) + ") rotate(-90)", [-4, -24, 8, 48])
        .insertAdjacentHTML("beforeend", K.Dessin.corps({ genre: "plaque", teinte: filtre(st).coul }, 0, 0, 1, false));
      // rangée sous la lampe (à hauteur de la lampe quand elle est au bout du banc : la place manque dessous)
      var grp = ["filtre", "iris", "depoli", "lampe"].filter(present), yr = yl + (pt ? 100 : 74);
      if (yr > VB.y + VB.h - 40) yr = yl + 6;
      var yel = { filtre: yFi, iris: yIr, depoli: yDe, lampe: yl + (pt ? 40 : lant ? 14 : 30) }, xel = { filtre: -8, iris: -31, depoli: -31, lampe: pt ? -15 : -27 };
      grp.forEach(function (id, i) { var cx = -62 - 36 * (grp.length - 1 - i); P.push({ id: id, cx: cx, cy: yr, nom: "b", filet: [[cx, yr - 17], [cx, yel[id]], [xel[id], yel[id]]] }); });
      // ---- sortie : lentilles, puis l'écran ou l'œil ----
      var px = -1e9;
      ["l20", "l1"].filter(present).sort(function (a, b) { return st.sor[a] - st.sor[b]; }).forEach(function (k) {
        var x = xS(st.sor[k]), q = groupe(k, "translate(" + x.toFixed(2) + " 0)", [-14, -34, 28, 68]);
        cavalier(q, estSel(k)); lentille(q, ELEMENTS[k].R * 1000, k === "l20" ? 4 : 1.6);
        px = Math.max(x, px + 74);
        P.push({ id: k, cx: px, cy: -64, nom: "h", filet: [[x, -31], [x, -38], [px, -46]] });
      });
      var xd = xS(st.sor[st.det]), oe = st.det === "oeil", pxd = oe ? Math.max(xd + 10, px + 74) : Math.max(xd, px + 74);
      if (!oe) {
        var qe = groupe("det", "translate(" + xd.toFixed(2) + " 0)", [-10, -66, 20, 132]);
        cavalier(qe, estSel("det"));
        qe.insertAdjacentHTML("beforeend", K.Dessin.corps({ genre: "ecran" }, -3, 0, 0.62, false));
      } else oeilCoupe(g, xd, estSel("det"));
      P.push({ id: "det", cx: pxd, cy: oe ? -56 : -98, nom: "h", filet: oe ? [[xd + 10, -16], [xd + 10, -26], [pxd, -38]] : [[xd, -63], [pxd, -80]] });
      P.forEach(function (q) { pastille(q.id, q.cx, q.cy, q.nom, q.filet); });
    }
    // œil en coupe, à l'échelle (globe de 24 mm, pupille stationnaire au plan du cristallin, sur le banc), tourné vers
    // l'appareil ; décalé de son déplacement latéral (vers M₂ = vers la droite de l'observateur) ; cavalier sur le rail
    function oeilCoupe(g, xd, sel) {
      var xo = xd - 1.4, yo = -(st.oeilX || 0) * 1000, go = svg("g", { class: "bc-el pl-oeil" + (sel ? " sel" : ""), "data-el": "det" }, g);
      var cxg = xo + 10.5, Rg = 12;
      svg("rect", { x: xo - 5, y: Math.min(yo, 0) - 16, width: 40, height: 32 + Math.abs(yo), fill: "transparent" }, go);   // prise
      var cav = svg("g", { transform: "translate(" + (xd + 10).toFixed(2) + " 0)" }, go);
      svg("rect", { x: -11, y: -14, width: 22, height: 28, rx: 3, fill: "url(#bcCav)", stroke: sel ? "#e0b84c" : "#636c78", "stroke-width": sel ? 1.4 : 0.7 }, cav);
      svg("path", { d: "M-3.5 14l3.5 5 3.5-5z", fill: "#e0b84c" }, cav);
      svg("path", { d: "M " + (cxg + 11.6) + " " + (yo + 1.4) + " Q " + (cxg + 16) + " " + (yo + 2.5) + " " + (cxg + 21) + " " + (yo + 1.5),
        fill: "none", stroke: "#7d5f55", "stroke-width": 3.2, "stroke-linecap": "round" }, go);                 // nerf optique
      svg("circle", { cx: cxg, cy: yo, r: Rg, fill: "url(#plSclere)", stroke: "#5d6670", "stroke-width": .8, filter: "url(#plOmbre)" }, go);
      var ar = function (a) { return [cxg + (Rg - 1) * Math.cos(a), yo + (Rg - 1) * Math.sin(a)]; }, r0 = ar(-1.05), r1 = ar(1.05);
      svg("path", { d: "M " + r0[0] + " " + r0[1] + " A " + (Rg - 1) + " " + (Rg - 1) + " 0 0 1 " + r1[0] + " " + r1[1],
        fill: "none", stroke: "#a4545c", "stroke-width": 1.1, opacity: .85 }, go);                               // rétine
      svg("path", { d: "M " + (xo + 1.6) + " " + (yo - 5.6) + " Q " + (xo - 3.2) + " " + yo + " " + (xo + 1.6) + " " + (yo + 5.6) + " Z",
        fill: "#a9d9ee", "fill-opacity": .35, stroke: "#c6ecfa", "stroke-width": .7 }, go);                      // cornée
      var rp = Math.min(5, pupilleDe(st) / 2);
      svg("line", { x1: xo + 1.4, y1: yo - 5.4, x2: xo + 1.4, y2: yo - rp, stroke: "#3d6b8f", "stroke-width": 1.6 }, go);  // iris
      svg("line", { x1: xo + 1.4, y1: yo + rp, x2: xo + 1.4, y2: yo + 5.4, stroke: "#3d6b8f", "stroke-width": 1.6 }, go);
      svg("ellipse", { cx: xo + 3.4, cy: yo, rx: 1.9, ry: 4.2, fill: "url(#plVerre)", stroke: "#c6ecfa", "stroke-width": .6 }, go); // cristallin
      svg("path", { d: "M " + (xo + 9) + " " + (yo - 12.6) + " Q " + (xo + 1) + " " + (yo - 11) + " " + (xo + 0.6) + " " + (yo - 6.4),
        fill: "none", stroke: "#8a7064", "stroke-width": 2.6, "stroke-linecap": "round" }, go);                 // paupières
      svg("path", { d: "M " + (xo + 9) + " " + (yo + 12.6) + " Q " + (xo + 1) + " " + (yo + 11) + " " + (xo + 0.6) + " " + (yo + 6.4),
        fill: "none", stroke: "#8a7064", "stroke-width": 2.6, "stroke-linecap": "round" }, go);
    }
    // Pastille : miniature de face (anneau doré quand l'élément est choisi), son nom, un filet jusqu'à l'élément ;
    // molette et glisser vertical : son réglage (`K.pastilles`, plus bas) ; clic : choisir l'élément.
    function pastille(id, cx, cy, posNom, filet) {
      var sel = estSel(id), R2 = reglage(id);
      svg("path", { class: "pl-filet" + (sel ? " sel" : ""), d: "M" + filet.map(function (q) { return q[0].toFixed(1) + " " + q[1].toFixed(1); }).join("L") }, gPast);
      var q = svg("g", { class: "pl-past" + (R2 ? " regl" : "") + (sel ? " sel" : ""), "data-past": id }, gPast);
      svg("circle", { cx: cx, cy: cy, r: 17, fill: "#0b0d10" }, q);
      svg("g", { transform: "translate(" + (cx - 15) + " " + (cy - 15) + ") scale(.75)" }, q).innerHTML = K.Dessin.miniature(figureEl(id));
      svg("circle", { class: "anneau", cx: cx, cy: cy, r: 17 }, q);
      var t = { g: [cx - 21, cy + 3, "end"], d: [cx + 21, cy + 3, "start"], h: [cx, cy - 21, "middle"], b: [cx, cy + 27, "middle"] }[posNom];
      // Nom sous la pastille : les pastilles voisines sont à 38 px ; un nom anglais de deux mots (« Ground glass »)
      // déborde sur les voisins, il passe donc sur deux lignes. Le français, plus court, reste sur une ligne.
      var nom = nomEl(id), mots = posNom === "b" && nom.length > 7 && /^en/.test(document.documentElement.lang || "") ? nom.split(" ") : [nom];
      if (mots.length > 2) mots = [mots[0], mots.slice(1).join(" ")];
      mots.forEach(function (m, i) { txt(gPast, t[0], t[1] + 10 * i, m, "pl-past-nom" + (sel ? " sel" : ""), t[2]); });
    }
    K.pastilles(function (t) {
      var q = t && t.closest && D.contains(t) ? t.closest("[data-past]") : null, id = q && q.getAttribute("data-past");
      if (!id) return null;
      return { regler: function (k, ev) { var R2 = reglage(id); if (R2) { R2.f(k, ev); modifie(); } }, clic: function () { choisir(id); } };
    });

    // ---- éléments mobiles ----
    function dessinerMobile() {
      var g = gMobile; g.innerHTML = ""; gLueur.innerHTML = "";
      // M2 sur son chariot (à l'échelle : 1 mm de chariotage = 1 mm sur le dessin)
      var y2 = posM2();
      svg("rect", { x: -3, y: -230, width: 6, height: Math.max(2, y2 - 44 + 230), fill: "url(#plCylY)", stroke: "#22272d", "stroke-width": .5 }, g);
      var gm2 = svg("g", { "data-mir": "M2" }, g);
      svg("rect", { x: -33, y: y2 - 46, width: 66, height: 40, rx: 3, fill: "url(#plMetX)", stroke: "#1d2228", filter: "url(#plOmbre)" }, gm2);
      svg("rect", { x: -30, y: y2 - 17, width: 60, height: 11, rx: 2, fill: "url(#plMetX)", stroke: "#1d2228" }, gm2);
      svg("rect", { x: -22, y: y2 - 7, width: 44, height: 7, fill: "#2b3138" }, gm2);
      svg("rect", { x: -19, y: y2 - 6, width: 38, height: 6, fill: "url(#plMiroir)" }, gm2);
      txt(gm2, 28, y2 + 1, "M₂");
      if (st.feuille === "M2") feuille(g, 0, y2 + 2.5, true);
      if (st.feuille === "M1") feuille(g, -128.5, 0, false);
      if (st.lamelle) lamelle(g, y2);
      dessinerBancs(g);
      // compensatrice : zone de clic sur ses lames (la choisir), contour doré quand elle l'est
      var gc = svg("g", { "data-el": "comp", transform: "translate(-8 8) rotate(45)" }, g);
      svg("rect", { x: -28, y: -6, width: 56, height: 12, fill: "transparent" }, gc);
      if (st.sel === "comp") svg("rect", { x: -28, y: -5, width: 56, height: 10, rx: 3, fill: "none", stroke: "#e0b84c", "stroke-width": 1.2 }, gc);
      majVisMobiles();
      dessinerFaisceaux();
    }
    // ---- « Voir la lumière » : enveloppe du faisceau utile (rayons de toute la source qui passent toutes
    // les montures jusqu'au détecteur), à l'échelle du banc, plus le pinceau issu du centre de la source. Optique
    // paraxiale dépliée, coordonnée s depuis la source ; transverse à l'échelle réelle, distances comprimées comme
    // les bancs. Ni e ni les inclinaisons : seules les franges les montrent.
    function coupe(P, a, b, R) {   // polygone (ρs, θ) ∩ {a ρs + b θ ≤ R}
      var out = [];
      for (var i = 0; i < P.length; i++) {
        var p = P[i], q = P[(i + 1) % P.length], fp = a * p[0] + b * p[1] - R, fq = a * q[0] + b * q[1] - R;
        if (fp <= 0) out.push(p);
        if (fp * fq < 0) { var t = fp / (fp - fq); out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]); }
      }
      return out;
    }
    function dessinerFaisceaux() {
      gFaisceau.innerHTML = "";
      if (!st.lumiere) return;
      var cfg = configOptique(st, c3Vu), sd = cfg.source.d, Rs = Math.max(1e-5, cfg.source.rayon || 0), coul = lampe(st).coul;
      var sSep = sd - ARM, sM = sd, sDet = sd + cfg.detecteur.d, e = epaisseur(st, c3Vu);
      var ent = cfg.entree.map(function (o) { return { s: sd - o.d, f: o.f, R: o.R }; });
      var tout = ent.concat([{ s: sM, R: R_MIROIR }], cfg.sortie.map(function (q) { return { s: sd + q.d, f: q.f, R: q.R }; }))
        .sort(function (a, b) { return a.s - b.s; });
      function ab(s) {
        var A = 1, B = 0, C = 0, Dm = 1, z = 0;
        for (var i = 0; i < tout.length && tout[i].s < s; i++) {
          var t = tout[i].s - z; A += t * C; B += t * Dm; z = tout[i].s;
          if (tout[i].f) { C -= A / tout[i].f; Dm -= B / tout[i].f; }
        }
        return [A + (s - z) * C, B + (s - z) * Dm];
      }
      function poly(R, smax) {
        var P = [[-R, -0.3], [R, -0.3], [R, 0.3], [-R, 0.3]];
        tout.forEach(function (o) { if (o.s > smax + 1e-9 || !(o.R > 0)) return; var m = ab(o.s); P = coupe(coupe(P, m[0], m[1], o.R), -m[0], -m[1], o.R); });
        return P;
      }
      function yAx(d) { return d * 1000 <= 52 ? d * 1000 : yE(d); }
      function xAx(d) { return d * 1000 <= 52 ? d * 1000 : xS(d); }
      function bande(P, s0, s1, pt, op) {
        if (P.length < 2 || !(s1 > s0)) return;
        var ss = [], k, haut = [], bas = [];
        for (k = 0; k <= 48; k++) ss.push(s0 + (s1 - s0) * k / 48);
        tout.forEach(function (o) { if (o.s > s0 && o.s < s1) ss.push(o.s); });
        ss.sort(function (a, b) { return a - b; }).forEach(function (s) {
          var m = ab(s), lo = Infinity, hi = -Infinity;
          P.forEach(function (v) { var r = m[0] * v[0] + m[1] * v[1]; lo = Math.min(lo, r); hi = Math.max(hi, r); });
          haut.push(pt(s, clamp(hi * 1000, -70, 70))); bas.push(pt(s, clamp(lo * 1000, -70, 70)));
        });
        var d = "M " + haut.map(function (q) { return q[0].toFixed(2) + " " + q[1].toFixed(2); }).join(" L ") + " L " +
          bas.reverse().map(function (q) { return q[0].toFixed(2) + " " + q[1].toFixed(2); }).join(" L ") + " Z";
        svg("path", { d: d, fill: coul, "fill-opacity": op, stroke: "none" }, gFaisceau);
      }
      var k2 = 1 + e / ARM;
      [[Rs, 0.13], [1e-6, 0.26]].forEach(function (c) {
        var P = poly(c[0], sDet), Pm = poly(c[0], sM), op = c[1];
        bande(st.feuille ? Pm : P, 0, sSep, function (s, t) { return [t, yAx(sSep - s)]; }, op);
        [1, 2].forEach(function (b) {
          var coupe1 = st.feuille === "M" + b, Q = coupe1 ? Pm : P;
          var aller = b === 1 ? function (s, t) { return [-(s - sSep) * 1000, t]; } : function (s, t) { return [t, -(s - sSep) * 1000 * k2]; };
          var retour = b === 1 ? function (s, t) { return [-(sM + ARM - s) * 1000, t]; } : function (s, t) { return [t, -(sM + ARM - s) * 1000 * k2]; };
          bande(Q, sSep, sM, aller, op);
          if (!coupe1) bande(P, sM, sM + ARM, retour, op);
        });
        bande(P, sM + ARM, sDet, function (s, t) { return [xAx(s - sM - ARM), t]; }, op);
      });
    }
    // Lamelle couvre-objet devant une partie du miroir (vue par la tranche) ; on fait glisser son bord le long du miroir.
    function lamelle(g, y2) {
      var L = st.lamelle, m1 = L.miroir === "M1", b = L.bord, gq = svg("g", { class: m1 ? "pl-glisse-v" : "pl-glisse-h", "data-el": "lamelle" }, g);
      if (m1) svg("rect", { x: -126.5, y: b, width: 1.6, height: 22 - b, fill: "#cfeaf5", "fill-opacity": .75, stroke: "#9fd3e8", "stroke-width": .4 }, gq);
      else svg("rect", { x: b, y: y2 + 3.2, width: 22 - b, height: 1.6, fill: "#cfeaf5", "fill-opacity": .75, stroke: "#9fd3e8", "stroke-width": .4 }, gq);
      txt(gq, m1 ? -121 : 25, m1 ? 28 : y2 + 12, TRAD("lamelle"), "pl-lab", m1 ? "middle" : "start");
      if (st.sel === "lamelle") svg("rect", m1 ? { x: -129, y: b - 2, width: 8, height: 26 - b, rx: 2, fill: "none", stroke: "#e0b84c" } : { x: b - 2, y: y2 + 1.5, width: 26 - b, height: 5, rx: 2, fill: "none", stroke: "#e0b84c" }, gq);
      // glisser : son bord le long du miroir ; la prendre la choisit (bandeau)
      K.glisser(gq, function (p, ev, G) {
        L.bord = Math.round(clamp(G.etat + (m1 ? p.y - G.p0.y : p.x - G.p0.x), -15, 15) * 100) / 100; modifie();
      }, function () { if (st.sel !== "lamelle") { st.sel = "lamelle"; modifie("dessin etagere"); } return L.bord; });
    }
    // Feuille de papier sur un miroir (60 mm, plus grande que lui), de son bord `fbord` vers l'extérieur ; on la fait
    // glisser le long du miroir (même sens que la lamelle) pour n'en couvrir qu'une partie.
    function feuille(g, x, y, horiz) {
      var b = fbord(st), gf = svg("g", { class: "bc-el", "data-el": "feuille" }, g), sel = st.sel === "feuille";
      svg("rect", horiz ? { x: x + b - 2, y: y - 5, width: 64, height: 10, fill: "transparent" } : { x: x - 5, y: y + b - 2, width: 10, height: 64, fill: "transparent" }, gf);
      if (horiz) svg("rect", { x: x + b, y: y - 1, width: 60, height: 2.2, fill: "#f2f2ee", stroke: "#b8b8b0", "stroke-width": .4, filter: "url(#plOmbre)" }, gf);
      else svg("rect", { x: x - 1, y: y + b, width: 2.2, height: 60, fill: "#f2f2ee", stroke: "#b8b8b0", "stroke-width": .4, filter: "url(#plOmbre)" }, gf);
      if (sel) svg("rect", horiz ? { x: x + b - 3, y: y - 4, width: 66, height: 8.5, rx: 3, fill: "none", stroke: "#e0b84c" } : { x: x - 4, y: y + b - 3, width: 8.5, height: 66, rx: 3, fill: "none", stroke: "#e0b84c" }, gf);
    }
    dessinerFixe();
    D.setAttribute("viewBox", VB.x + " " + VB.y + " " + VB.w + " " + VB.h);

    // ================= sélection, glisser, clic droit, clavier =================
    // Le dessin passe dans une scène (position relative : l'étagère flottante y vit) ; le bandeau de
    // l'élément choisi au pied du panneau de gauche.
    K.racine.classList.add("pl-mich");
    var SCENE = el("div", "pl-mi-scene"), GAUCHE = D.parentNode;
    GAUCHE.insertBefore(SCENE, D); SCENE.appendChild(D);
    var lic = GAUCHE.querySelector(".pl-licence"); if (lic) SCENE.appendChild(lic);
    var BD = el("div", "bc-bandeau pl-mi-bandeau", GAUCHE), TAPE = null;
    function surBanc(p, b) { return b === "ent" ? Math.abs(p.x) < 60 && p.y > 50 : Math.abs(p.y) < 60 && p.x > 50; }
    var PRISE = null;
    D.addEventListener("pointerdown", function (ev) {
      if (ev.button) return;
      var t = ev.target, g = t.closest ? t.closest("[data-el]") : null, id = g && g.getAttribute("data-el");
      if (!id) { if (st.sel) { choisir(null); } return; }          // fond, appareil, vis : plus rien de choisi
      ev.preventDefault();
      var p0 = K.ptSvg(ev), b = bancDe(id);
      PRISE = { id: id, b: b, x0: ev.clientX, y0: ev.clientY, prec: p0, p0: p0, bouge: false, hors: false, pos: b ? posEl(id) : 0 };
      K.racine.classList.add("pl-glisse");
    });
    function priseMove(ev) {
      var P = PRISE; if (!P) return;
      if (!P.bouge && Math.hypot(ev.clientX - P.x0, ev.clientY - P.y0) < 4) return;
      if (!P.bouge) {
        P.bouge = true;
        // un élément de la sélection emmène toute la sélection de son banc (écarts gardés) ; un autre : lui seul
        if (estSel(P.id)) { if (st.sel !== P.id) { choisir(P.id, "devant"); } }
        else { st.sel = P.id; st.selL = [P.id]; TAPE = null; sale.etagere = sale.dessin = true; }
        if (P.b) { P.G = groupeDe(P.id); if (P.G.length > 1) { P.snap = JSON.stringify(P.b === "ent" ? st.ent : st.sor); P.dv = 0; } }
      }
      var p = K.ptSvg(ev);
      if (P.b) {
        // glisser démultiplié : Maj ÷ 10, Ctrl+Maj ÷ 100 (pas de saut quand on presse Maj en route)
        var f = ev.shiftKey ? ((ev.ctrlKey || ev.metaKey) ? 0.01 : 0.1) : 1, dd = (P.b === "ent" ? dE(p.y) - dE(P.prec.y) : dS(p.x) - dS(P.prec.x)) * f;
        P.prec = p;
        if (P.snap) {          // groupe : rejoué depuis les positions de départ, jamais retiré du banc
          P.dv += dd;
          if (P.b === "ent") st.ent = JSON.parse(P.snap); else st.sor = JSON.parse(P.snap);
          deplacerGroupe(st, P.b, P.G, P.dv);
          K.texteGeste("<b>" + K.esc(nomEl(P.id)) + "</b> et " + (sels().length - 1) + " autre" + (sels().length > 2 ? "s" : "") + " — " + fmtNb(posEl(P.id) * 100, 1) + " cm");
          modifie("dessin optique obs"); return;
        }
        P.pos += dd;
        // lâché hors du banc : il reste où il est (au bout du banc) ; une erreur de manip ne retire jamais un élément
        deplacer(st, P.b, cleBanc(P.id), P.pos);
        K.texteGeste("<b>" + K.esc(nomEl(P.id)) + "</b> — " + fmtNb(posEl(P.id) * 100, 1) + " cm");
        modifie("dessin optique obs");
      } else if (P.id === "feuille") {
        // le long du miroir : son bord glisse (n'en couvrir qu'une partie) ; tirée loin du miroir : retirée
        var m1 = st.feuille === "M1", le = m1 ? p.y - P.p0.y : p.x - P.p0.x, tr = m1 ? p.x - P.p0.x : p.y - P.p0.y;
        if (P.fb0 == null) P.fb0 = fbord(st);
        P.hors = Math.abs(tr) > 40;
        if (!P.hors) { st.fbord = Math.round(clamp(P.fb0 + le, FBORD_MIN, FBORD_MAX) * 100) / 100; sale.dessin = sale.optique = sale.obs = true; modifie(); }
        K.texteGeste(P.hors ? TRAD("<b>Feuille</b> — lâchée ici : retirée du miroir") : null);
        var gf = D.querySelector('[data-el="feuille"]'); if (gf) gf.classList.toggle("hors", P.hors);
      }
      if (P.hors) { var gh = D.querySelector('[data-el="' + P.id + '"]'); if (gh) gh.classList.add("hors"); }
    }
    function priseUp(ev) {
      var P = PRISE; if (!P) return;
      PRISE = null; K.racine.classList.remove("pl-glisse"); K.texteGeste(null);
      if (ev.type !== "pointerup") { modifie(); return; }
      if (!P.bouge) { choisir(P.id, modeClic(ev)); return; }
      if (P.hors) retirer(P.id);
      modifie("dessin optique loupe obs etagere");
    }
    root.addEventListener("pointermove", priseMove);
    root.addEventListener("pointerup", priseUp);
    root.addEventListener("pointercancel", priseUp);
    // Clic droit : sur un élément (ou sa pastille), Remplacer par ▸, Position…, Retirer ; sur un banc vide, Poser ici ▸ ;
    // sur M₁ ou M₂, poser ou retirer la feuille, la lamelle.
    D.addEventListener("contextmenu", function (ev) {
      ev.preventDefault();
      var t = ev.target, q = t.closest("[data-past]") || t.closest("[data-el]"), id = q && (q.getAttribute("data-past") || q.getAttribute("data-el"));
      var mir = t.closest("[data-mir]"), bc = t.closest("[data-banc]"), it = [];
      if (id && id !== "comp") {
        choisir(id);
        if (id === "lampe") it.push({ lab: TRAD("Remplacer par"), sub: ORDRE_LAMPES.filter(function (k) { return k !== st.lampe; }).map(function (k) {
          return { lab: LAMPES[k].court.replace(" (blanche)", ""), act: function () { changerLampe(k); } }; }) });
        // poser ou retirer ce qui se visse sur la lampe : dépoli et iris (lampes), objectif (laser) ; coché = posé
        if (id === "lampe") (lampe(st).type === "point" ? [["lc", TRAD("Objectif de microscope"), st.lc !== false]]
          : [["depoli", TRAD("Dépoli"), !!st.depoli], ["iris", TRAD("Iris"), st.iris != null]]).forEach(function (q) {
          it.push({ lab: q[1], coche: q[2], act: function () { clicCarte(q[0]); } });
        });
        if (id === "lampe" || id === "filtre") it.push({ lab: TRAD("Filtre") + " ▸", sub: itemsFiltre() });
        if (id === "det") it.push({ lab: TRAD("Remplacer par"), sub: [{ lab: st.det === "ecran" ? TRAD("Œil") : TRAD("Écran"), act: function () { changerDet(st.det === "ecran" ? "oeil" : "ecran"); } }] });
        if (/^(cond|coll|l20|l1)$/.test(id)) {
          var bl = bancDe(id), lis = bl === "ent" ? ["cond", "coll"] : ["l20", "l1"];
          it.push({ lab: TRAD("Remplacer par"), sub: lis.filter(function (k) { return k !== id; }).map(function (k) {
            return { lab: nomEl(k), dis: present(k), act: function () {
              var pos = lirePos(st, bl, id); ecrirePos(st, bl, id, null); ecrirePos(st, bl, k, pos); deplacer(st, bl, k, pos);
              st.sel = k; TAPE = null; modifie("dessin optique loupe obs etagere"); } }; }) });
        }
        if (bancDe(id)) it.push({ lab: TRAD("Position…"), k: TRAD("clic sur le nombre"), act: function () { taperPosition(id); } });
        if (!/^(lampe|det)$/.test(id)) it.push({ lab: TRAD("Retirer"), k: TRAD("Suppr"), act: function () { retirer(id); modifie("dessin optique loupe obs etagere"); } });
      } else if (mir) {
        var m = mir.getAttribute("data-mir"), mn = m === "M1" ? "M₁" : "M₂";
        it.push({ tit: TRAD("Miroir {0}", [mn]) });
        it.push(st.feuille === m ? { lab: TRAD("Retirer la feuille"), act: function () { retirer("feuille"); modifie("dessin optique loupe obs etagere"); } }
          : { lab: TRAD("Poser la feuille"), act: function () { st.feuille = m; st.fbord = null; st.sel = "feuille"; modifie("dessin optique loupe obs etagere"); } });
        it.push(st.lamelle && st.lamelle.miroir === m ? { lab: TRAD("Retirer la lamelle"), act: function () { retirer("lamelle"); modifie("dessin optique loupe obs etagere"); } }
          : { lab: TRAD("Poser la lamelle"), act: function () { st.lamelle = { miroir: m, bord: 0 }; st.sel = "lamelle"; modifie("dessin optique loupe obs etagere"); } });
      } else if (bc) {
        var b = bc.getAttribute("data-banc"), p = K.ptSvg(ev), dd = b === "ent" ? dE(p.y) : dS(p.x);
        var libres = (b === "ent" ? ["cond", "coll"] : ["l20", "l1"]).filter(function (k) { return !present(k); });
        it.push({ tit: (b === "ent" ? TRAD("Banc d'entrée") : TRAD("Banc de sortie")) + " · " + fmtNb(dd * 100, 1) + " cm" });
        it.push({ lab: TRAD("Poser ici"), sub: libres.map(function (k) { return { lab: nomEl(k), act: function () {
          poser(st, k); deplacer(st, b, k, dd); st.sel = k; modifie("dessin optique loupe obs etagere"); } }; }) });
      }
      if (it.length) K.ouvrirCtx(ev.clientX, ev.clientY, it);
    });
    // Échap : d'abord la saisie de la position, puis (après menus et panneau) plus rien de choisi.
    K.surEchap({ avant: function () { if (!TAPE) return false; TAPE = null; sale.etagere = true; return true; },
      apres: function () { if (!st.sel) return false; choisir(null); return true; } });
    // Clavier (hors champ de saisie) : flèches selon le banc de l'élément choisi (∥ au banc : déplacer ; ⊥ : régler sa
    // pastille), rien de choisi et vue à l'œil : l'œil (flecheOeil) ; Tab / Maj+Tab : l'élément voisin dans l'ordre
    // de la lumière ; Suppr : retirer.
    function toucheElements(ev) {
      var t = ev.target;
      if (!K.racine.isConnected || ev.altKey || ev.metaKey || K.gestesOuvert()) return;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      if (ev.key === "Tab" && !ev.ctrlKey && (!t || !t.closest || t === document.body || !t.closest("button, a, [tabindex], label"))) {
        var O = ordreLumiere(), i = O.indexOf(st.sel);
        if (i < 0) i = ev.shiftKey ? 0 : -1;
        choisir(O[(i + (ev.shiftKey ? -1 : 1) + O.length) % O.length]);
        ev.preventDefault(); ev.stopPropagation(); return;
      }
      if ((ev.key === "Delete" || ev.key === "Backspace") && st.sel && !ev.ctrlKey) {
        if (retirer(st.sel)) modifie("dessin optique loupe obs etagere");
        ev.preventDefault(); return;
      }
      var dir = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[ev.key];
      if (!dir) return;
      var b = st.sel && bancDe(st.sel);
      if (!b) { if (!st.sel) flecheOeil(ev); return; }
      ev.preventDefault();
      var para = b === "ent" ? dir[1] : dir[0], perp = b === "ent" ? dir[0] : dir[1];
      if (para) bouger(st.sel, para, ev);
      else { var R2 = reglage(st.sel); if (!R2) return; R2.f(perp, ev); }
      modifie();
    }
    document.addEventListener("keydown", toucheElements);

    // ---- bandeau de l'élément choisi : refait quand ce qu'il montre change, valeurs mises à jour en place ----
    function taperPosition(id) { if (!bancDe(id)) return; if (st.sel !== id) st.sel = id; TAPE = { val: fmtNb(posEl(id) * 100, 1) }; sale.etagere = true; majBandeau(true); }
    function blocPos(id) {
      var w = el("span", "bc-bd-pos", BD), b = bancDe(id);
      [[1, "◂", TRAD("Vers l'appareil")], [-1, "▸", TRAD("Loin de l'appareil")]].forEach(function (q, k) {
        if (k === 1) {
          if (TAPE) {
            var i = el("input", "bc-bd-tape", w); i.type = "text"; i.value = TAPE.val; i.setAttribute("aria-label", TRAD("Position en cm"));
            i.setAttribute("data-a3", TRAD("<b>Position en cm</b> — <span class=\"k\">Entrée</span> : valider · <span class=\"k\">Échap</span> : annuler"));
            i.addEventListener("input", function () { if (TAPE) TAPE.val = i.value; });
            i.addEventListener("keydown", function (ev) {
              ev.stopPropagation();
              if (ev.key === "Enter") { var v = parseFloat(String(i.value).replace(",", ".").replace(/\s|cm/g, "")); TAPE = null;
                if (isFinite(v)) deplacerEl(id, v / 100 - posEl(id)); modifie("dessin optique loupe obs etagere"); }
              if (ev.key === "Escape") { TAPE = null; sale.etagere = true; majBandeau(true); }
            });
            i.addEventListener("blur", function () { if (TAPE) { TAPE = null; sale.etagere = true; } });
            setTimeout(function () { if (i.isConnected) { try { i.focus(); i.select(); } catch (e1) {} } }, 0);
          } else {
            var n = el("b", "bc-bd-n pl-mi-pos", w, fmtNb(posEl(id) * 100, 1) + " cm");
            n.setAttribute("data-a3", TRAD("<b>Position</b> sur le banc, comme sur sa règle — clic : la taper (en cm ; <span class=\"k\">Entrée</span> valide, <span class=\"k\">Échap</span> annule)"));
            n.addEventListener("click", function () { taperPosition(id); });
          }
        }
        var bt = el("button", "", w, q[1]); bt.type = "button";
        bt.setAttribute("data-a3", TRAD("<b>{0}</b> · 1 mm (Maj 0,1 mm · Ctrl+Maj 0,01 mm · Ctrl 1 cm) · {1}", [q[2], (b === "ent" ? k_("↑ ↓") : k_("← →"))]));
        bt.addEventListener("click", function (ev) { deplacerEl(id, -q[0] * pasPos(ev)); modifie(); });
      });
    }
    // Déplace l'élément (et la sélection dont il fait partie) de dv le long de son banc.
    function deplacerEl(id, dv) {
      var b = bancDe(id), G = groupeDe(id);
      if (G.length > 1) deplacerGroupe(st, b, G, dv); else deplacer(st, b, cleBanc(id), posEl(id) + dv);
    }
    function boutonBD(texte, a3, f, cls) { var x = K.bouton(BD, texte, f, cls || "pl-btn-p"); x.setAttribute("data-a3", a3); return x; }
    function retirerBtn(id) { boutonBD(TRAD("Retirer"), TRAD("<b>Retirer</b> — {0}", [k_(TRAD("Suppr"))]), function () { retirer(id); modifie("dessin optique loupe obs etagere"); }); }
    var cleBD = null, bdIris = null, bdLant = null;
    function majBandeau(force) {
      var id = st.sel && present(st.sel) ? st.sel : null;
      if (st.sel && !id) st.sel = null;
      var ecDep = porte(st) && st.ent.dep != null ? Math.round((st.ent.lampe - st.ent.dep) * 1000) : null;
      var cle = JSON.stringify([id, st.lampe, st.filtre, condLanterne(st), st.det, st.feuille, st.lamelle && st.lamelle.miroir, st.lc, st.obj, !!TAPE, porte(st), ecDep, sels()]);
      if (!force && cle === cleBD) {      // valeurs en place (un curseur qu'on tient n'est pas refait)
        var pz = BD.querySelector(".pl-mi-pos"); if (pz && id) pz.textContent = fmtNb(posEl(id) * 100, 1) + " cm";
        if (bdIris) bdIris();
        if (bdLant) bdLant();
        return;
      }
      cleBD = cle; BD.innerHTML = ""; bdIris = null; bdLant = null;
      if (!id) { el("span", "bc-vide", BD, TRAD("Cliquer un élément d'un banc pour le régler ({0} : l'un après l'autre), ou en poser un depuis l'étagère", [k_("Tab")])); return; }
      var nm = el("span", "bc-bd-nom", BD, K.Dessin.svgMini(figureEl(id)) + "<span></span>"); nm.lastChild.textContent = id === "lampe" ? lampe(st).nom.charAt(0).toUpperCase() + lampe(st).nom.slice(1) : nomEl(id);
      var nG = sels().filter(function (q) { return bancDe(q) === bancDe(id); }).length;
      if (nG > 1) el("span", "bc-vide", BD, TRAD("+ {0} autre{1} choisi{1} : ils bougent ensemble", [nG - 1, nG > 2 ? "s" : ""])).setAttribute("data-a3",
        TRAD("<b>Groupe</b> — glisser, molette, flèches, ◂ ▸ : tous ensemble, écarts gardés · {0}+clic : ajouter ou retirer un élément · {1}+clic : tous ceux d'entre les deux · {2} : plus rien de choisi", [k_("Ctrl"), k_(TRAD("Maj")), k_(TRAD("Échap"))]));
      if (id === "lampe") {
        blocPos("lampe");
        K.seg(BD, ORDRE_LAMPES.map(function (k) { return [k, LAMPES[k].court.replace(" (blanche)", ""), TRAD("Remplacer la lampe par : {0} (même position)", [LAMPES[k].nom])]; }), baseLampe(st.lampe), changerLampe);
        var baseL = baseLampe(st.lampe), basseL = baseL === "hgc" ? "hgcb" : null;
        if (basseL) {
          var a3P = hgVert(st) ? [
            TRAD("<b>Pression : haute</b> — l'arc dans une ampoule claire, à une trentaine de bar : les collisions élargissent la raie verte (∆λ ≈ 1 nm), d'où une longueur de cohérence ℓc ≈ 0,3 mm seulement : les anneaux finissent par se brouiller, à portée du tambour C₃ (c'est elle que demande la manipulation Longueur de cohérence)"),
            TRAD("<b>Pression : basse</b> — la décharge d'une vapeur rarefaite, la lampe spectrale des salles de TP : raie fine, presque limitée par l'effet Doppler (2 millièmes de nm), d'où ℓc ≈ 15 cm : les anneaux gardent leur contraste sur toute la course de C₃, le brouillage reste hors d'atteinte")] : [
            TRAD("<b>Pression : haute</b> — l'arc dans une ampoule claire, à une trentaine de bar : chaque raie y est élargie par les collisions (∆λ ≈ 1 nm sur la verte) ; sans le filtre, les franges superposées des raies ensemble ne tiennent qu'au voisinage immédiat du contact optique"),
            TRAD("<b>Pression : basse</b> — la lampe spectrale : raies fines, presque limitées par l'effet Doppler ; loin du contact, chacune garde ses franges, d'interfrange propre : les teintes se décalent d'une raie à l'autre, des irisations bien au-delà du voisinage du contact, comme sur la paillasse")];
          K.groupe(BD, TRAD("Pression"), [["haute", TRAD("haute"), a3P[0]], ["basse", TRAD("basse"), a3P[1]]],
            function () { return st.pression === "basse" ? "basse" : "haute"; },
            function (v) { st.pression = v; changerLampe(baseL); });   // la pression est retenue : elle vaut pour les deux lampes mercure
        }
        if (lampe(st).type === "point") K.seg(BD, [["nu", TRAD("faisceau nu"), TRAD("Sans objectif : le faisceau nu, de moins d'un millimètre (deux taches sur l'écran).")]].concat([10, 20, 40].map(function (g) {
          return [g, "×" + g, TRAD("Objectif de microscope ×{0} vissé sur le laser : le faisceau s'ouvre en un cône {1}.", [g, (g === 10 ? TRAD("étroit : une petite tache, peu d'anneaux") : g === 20 ? TRAD("moyen") : TRAD("large : il couvre toujours les miroirs, tous les anneaux"))])]; })),
          st.lc === false ? "nu" : objectif(st), function (v) { if (v === "nu") st.lc = false; else { st.lc = true; st.obj = v; } modifie("dessin optique loupe obs etagere"); });
        if (st.lampe === "bl") {      // lanterne : condenseur intégré, son tirage
          K.seg(BD, [["cond", TRAD("condenseur"), TRAD("Condenseur de {0} mm à la sortie : il forme une image du filament ; dépoli et iris se posent devant lui.", [F_COND_L * 1000])],
            ["nu", TRAD("filament nu"), TRAD("Sans condenseur : le filament éclaire dans toutes les directions ; dépoli et iris se posent devant lui.")]],
            condLanterne(st) ? "cond" : "nu", function (v) { reglerLanterne(st, lanterne(st).tirage, v === "cond"); modifie("dessin optique loupe obs etagere"); });
          if (condLanterne(st)) {
            var ct = K.curseur(BD, TRAD("Tirage"), TIRAGE_L[0] * 1000, TIRAGE_L[1] * 1000, 0.5, function () { return lanterne(st).tirage * 1000; },
              function (v) { reglerLanterne(st, v / 1000); }, function () { return fmtNb(lanterne(st).tirage * 1000, 1) + " mm"; }, function () { modifie(); });
            ct.setAttribute("data-a3", TRAD("<b>Tirage du condenseur</b> — distance du filament au condenseur (focale {0} mm) : elle fixe où se forme l'image du filament · aussi : molette ou glisser vertical sur la pastille de la lanterne, {1}", [F_COND_L * 1000, k_("← →")]));
            var cti = ct.querySelector("input"), cto = ct.querySelector("output");
            bdLant = function () { if (!condLanterne(st)) return; if (document.activeElement !== cti) cti.value = lanterne(st).tirage * 1000; cto.textContent = fmtNb(lanterne(st).tirage * 1000, 1) + " mm"; };
          }
        }
      } else if (id === "depoli" || id === "iris") {
        if (id === "iris") {
          var lmin = Math.log(IRIS_MIN), lmax = Math.log(R_DEPOLI);
          var c = K.curseur(BD, TRAD("Diamètre"), 0, 1000, 1, function () { return Math.round(1000 * (Math.log(st.iris) - lmin) / (lmax - lmin)); },
            function (v) { st.iris = Math.exp(lmin + v / 1000 * (lmax - lmin)); }, function () { return fmtNb(st.iris * 2000, st.iris < 0.005 ? 1 : 0) + " mm"; },
            function () { modifie(); });
          c.setAttribute("data-a3", TRAD("<b>Diamètre de l'iris</b> — aussi : molette ou glisser vertical sur sa pastille, {0}", [k_("← →")]));
          var ci = c.querySelector("input"), co = c.querySelector("output");
          bdIris = function () { if (st.iris == null) return; if (document.activeElement !== ci) ci.value = Math.round(1000 * (Math.log(st.iris) - lmin) / (lmax - lmin)); co.textContent = fmtNb(st.iris * 2000, st.iris < 0.005 ? 1 : 0) + " mm"; };
        }
        if (porte(st)) {     // porte-dépoli de la lampe spectrale : sa position, contre la lampe ou détaché
          blocPos(id);
          el("span", "bc-vide", BD, ecDep == null ? TRAD("dépoli et iris : contre la lampe") : TRAD("dépoli et iris : à {0} cm du tube de la lampe", [fmtNb(ecDep / 10, 1)]));
          // au bout du banc (lampe tout contre l'appareil), le support ne peut plus avancer : il reste et la lampe recule
          if (ecDep == null) boutonBD(TRAD("Détacher de la lampe"), TRAD("<b>Détacher de la lampe</b> — le support du dépoli et de l'iris avance de 5 cm vers l'appareil, ou, au bout du banc, la lampe recule de 5 cm (aussi : le glisser vers l'appareil sur le banc)"),
            function () {
              var p0 = posDep(st);
              if (p0 - 0.05 >= BORNES.ent[0] - 1e-9) deplacer(st, "ent", "dep", p0 - 0.05);
              else { st.ent.dep = p0; deplacer(st, "ent", "lampe", Math.min(BORNES.ent[1], st.ent.lampe + 0.05)); }
              modifie(TOUT);
            });
          if (ecDep != null) boutonBD(TRAD("Lampe contre eux"), TRAD("<b>Lampe contre eux</b> — la lampe avance jusqu'au support du dépoli et de l'iris, qui ne bouge pas ; elle l'emmène ensuite"),
            function () { deplacer(st, "ent", "lampe", posDep(st) + D_DEPOLI); modifie(TOUT); });
        } else el("span", "bc-vide", BD, TRAD("sur la lanterne"));
        retirerBtn(id);
      } else if (id === "filtre") {
        K.seg(BD, [[null, TRAD("aucun")]].concat(CLES_FILTRE.map(function (f) { return [f, FILTRES[f].court, majuscule(FILTRES[f].nom)]; })),
          st.filtre || null, function (v) { poserFiltre(v); });
        el("span", "bc-vide", BD, TRAD("devant la lampe, sur le porte-dépoli : il vaut pour toutes les lampes"));
        retirerBtn(id);
      } else if (/^(cond|coll|l20|l1)$/.test(id)) {
        blocPos(id); retirerBtn(id);
      } else if (id === "det") {
        blocPos("det");
        K.seg(BD, [["ecran", TRAD("Écran")], ["oeil", TRAD("Œil")]], st.det, changerDet);
        if (st.det === "oeil") el("span", "bc-vide", BD, TRAD("ses réglages : sous l'image"));
      } else if (id === "comp") {
        boutonBD(TRAD("Régler la compensatrice"), TRAD("<b>Régler la compensatrice</b> — elle est mise exactement parallèle à la séparatrice ; l'étape 1 est sautée"), function () {
          compReglee(st); V.B1.dessiner(); V.B2.dessiner();
          if (!atteinte(st.etapes.comp)) st.etapes.comp = "sautee";
          majEtapes(); modifie();
        }, "pl-btn");
        el("span", "bc-vide", BD, TRAD("B₁ l'oriente, B₂ règle son excentricité"));
      } else if (id === "feuille" || id === "lamelle") {
        var cur = id === "feuille" ? st.feuille : st.lamelle.miroir;
        K.seg(BD, [["M1", TRAD("sur M₁")], ["M2", TRAD("sur M₂")]], cur, function (v) { if (id === "feuille") { st.feuille = v; } else st.lamelle.miroir = v; modifie("dessin optique loupe obs etagere"); });
        if (id === "lamelle") el("span", "bc-vide", BD, TRAD("épaisseur au palmer : {0} mm", [fmtNb(epLamelle(st) * 1000, 3)]));
        else el("span", "bc-vide", BD, feuilleEntiere(st) ? TRAD("glisser la feuille le long du miroir pour n'en couvrir qu'une partie") : TRAD("en partie sur le miroir : son bord aide à faire le point sur les miroirs"));
        retirerBtn(id);
      }
    }

    // ================= étagère =================
    // Celle de la coque, flottante dans le coin bas droit du dessin et escamotable (« Éléments ▴ » ; repliée ou non et
    // l'onglet gardés dans le navigateur). Un exemplaire de chaque élément : la carte d'un élément posé est surlignée ;
    // clic = poser ou retirer (une source remplace la source, l'écran et l'œil se remplacent) ; glisser une carte sur
    // son banc = la poser où on la lâche (une source lâchée sur le banc d'entrée : remplace la lampe, même position) ;
    // feuille et lamelle : lâchées sur un miroir. K.boite (ancienne boîte à éléments) reste vide et cachée.
    K.boite.hidden = true;
    function miroirPres(p) {
      if (Math.abs(p.x + 140) < 40 && Math.abs(p.y) < 50) return "M1";
      if (Math.abs(p.x) < 50 && Math.abs(p.y - posM2() + 20) < 45) return "M2";
      return null;
    }
    function nomMir(m) { return m === "M1" ? "M₁" : "M₂"; }
    function carte(cle, nom, fig, pose, a3, dis) { return { cle: cle, nom: nom, mini: K.Dessin.svgMini(fig), pose: !!pose, a3: a3, dis: !!dis }; }
    function cartesEt(T) {
      var pt = lampe(st).type === "point", posez = TRAD("clic : le poser · glisser sur son banc : le poser où on le lâche"), retire = TRAD("clic : le retirer · glisser sur son banc : le déplacer");
      function el_(k) { var p = present(k); return carte(k, nomEl(k), figureEl(k), p, "<b>" + nomEl(k) + "</b> — " + (p ? retire : posez)); }
      if (T.nom === "Sources") return ORDRE_LAMPES.map(function (k) {
        var L = LAMPES[k], nm = L.court.replace(" (blanche)", ""), posee = baseLampe(st.lampe) === k;
        return carte("L" + k, nm, { med: MED_LAMPE[k] }, posee, "<b>" + K.esc(L.nom.charAt(0).toUpperCase() + L.nom.slice(1)) + "</b> — " +
          (posee ? TRAD("la lampe posée") : TRAD("clic : remplace la lampe, même position · glisser sur le banc d'entrée : idem")) +
          (k === "hgc" ? TRAD(" · haute ou basse pression dans l'ampoule : bandeau de la lampe") : ""));
      });
      if (T.nom === "Entrée") {
        var E = ["depoli", "iris"].map(function (k) {
          var c = el_(k); if (pt) { c.dis = true; c.pose = false; c.a3 = TRAD("<b>{0}</b> — pas avec le laser : il éclaire par un point", [nomEl(k)]); }
          else c.a3 = TRAD("<b>{0}</b> — {1} · clic : {2}", [nomEl(k), (lampe(st).type === "spectrale" ? TRAD("devant la lampe, sur le même support que {0} (glisser ce support vers l'appareil : il quitte la lampe)", [k === "iris" ? TRAD("le dépoli") : TRAD("l'iris")])
            : TRAD("vissé sur la lanterne")), (c.pose ? TRAD("le retirer") : TRAD("le poser"))]);
          return c;
        }).concat([el_("cond"), el_("coll")]);
        var cf = el_("filtre");
        cf.a3 = TRAD("<b>Filtre</b> — devant la lampe, sur le porte-dépoli, pour toutes les lampes (un seul à la fois) · clic : {0} · sa couleur : au bandeau, ou clic droit",
          [cf.pose ? TRAD("le retirer") : TRAD("poser le {0}", [FILTRES[FILTRE_DEFAUT].nom])]);
        E.splice(2, 0, cf);      // après le dépoli et l'iris, devant le condenseur et la lentille
        if (pt) E.push(carte("lc", TRAD("Objectif ×{0}", [objectif(st)]), { med: "conv", mo: "×" + objectif(st) }, st.lc !== false,
          TRAD("<b>Objectif de microscope ×{0}</b> vissé sur le laser — clic : {1} · ×10, ×20, ×40 : au bandeau du laser", [objectif(st),
            (st.lc !== false ? TRAD("le retirer (le faisceau nu, de moins d'un millimètre)") : TRAD("le visser (un cône de lumière)"))])));
        return E;
      }
      if (T.nom === "Sortie") return [el_("l20"), el_("l1"),
        carte("ecran", TRAD("Écran"), { med: "ecran" }, st.det === "ecran", TRAD("<b>Écran</b> — {0}", [st.det === "ecran" ? TRAD("le détecteur posé") : TRAD("clic : remplace l'œil · glisser sur le banc de sortie : le poser où on le lâche")])),
        carte("oeil", TRAD("Œil"), { med: "oeil" }, st.det === "oeil", TRAD("<b>Œil</b> — {0}", [st.det === "oeil" ? TRAD("le détecteur posé") : TRAD("clic : remplace l'écran · glisser sur le banc de sortie : le poser où on le lâche")]))];
      return [carte("feuille", TRAD("Feuille"), { med: "feuille" }, st.feuille, TRAD("<b>Feuille</b> de papier, elle cache un miroir — {0}", [st.feuille ? TRAD("clic : la retirer") : TRAD("clic : la poser sur M₂ (au bandeau : sur M₁ · sur M₂) · glisser sur un miroir : l'y poser")])),
        carte("lamelle", TRAD("Lamelle"), { med: "lamelle" }, st.lamelle, TRAD("<b>Lamelle</b> couvre-objet devant une partie d'un miroir — {0}", [st.lamelle ? TRAD("clic : la retirer") : TRAD("clic : la poser sur M₂ (au bandeau : sur M₁ · sur M₂) · glisser sur un miroir : l'y poser")]))];
    }
    var TOUT = "dessin optique loupe obs etagere";
    function clicCarte(k) {
      if (k.charAt(0) === "L" && LAMPES[k.slice(1)]) { if (baseLampe(st.lampe) !== k.slice(1)) { st.sel = "lampe"; changerLampe(k.slice(1)); } return; }
      if (k === "filtre") { if (filtre(st)) retirer("filtre"); else poserFiltre(FILTRE_DEFAUT); TAPE = null; modifie(TOUT); return; }
      if (k === "ecran" || k === "oeil") { if (st.det !== k) { changerDet(k); st.sel = "det"; } return; }
      if (k === "lc") st.lc = st.lc === false;
      else if (k === "depoli") { st.depoli = !st.depoli; st.sel = st.depoli ? "depoli" : st.sel === "depoli" ? null : st.sel; }
      else if (k === "iris") { if (st.iris == null) { st.iris = 0.010; st.sel = "iris"; } else retirer("iris"); }
      else if (k === "feuille") { if (st.feuille) retirer("feuille"); else { st.feuille = "M2"; st.fbord = null; st.sel = "feuille"; } }
      else if (k === "lamelle") { if (st.lamelle) retirer("lamelle"); else { st.lamelle = { miroir: "M2", bord: 0 }; st.sel = "lamelle"; } }
      else if (present(k)) retirer(k); else { poser(st, k); st.sel = k; }
      TAPE = null; modifie(TOUT);
    }
    // Ce que ferait la carte lâchée au point p du dessin : { texte, f } ou null (rien : elle retourne sur l'étagère).
    function poseCarte(k, p) {
      var src = k.charAt(0) === "L" && LAMPES[k.slice(1)], nm = src ? LAMPES[k.slice(1)].court.replace(" (blanche)", "") : k === "ecran" ? TRAD("Écran") : k === "oeil" ? TRAD("Œil") : nomEl(k);
      if (src) return surBanc(p, "ent") ? { texte: TRAD("<b>{0}</b> — lâchée ici : elle remplace la lampe, même position", [K.esc(nm)]), f: function () { clicCarte(k); } } : null;
      if (k === "feuille" || k === "lamelle") {
        var m = miroirPres(p); if (!m) return null;
        return { texte: TRAD("<b>{0}</b> — lâchée ici : sur {1}", [nm, nomMir(m)]), f: function () {
          if (k === "feuille") { if (st.feuille !== m) st.fbord = null; st.feuille = m; } else st.lamelle = { miroir: m, bord: st.lamelle ? st.lamelle.bord : 0 };
          st.sel = k; modifie(TOUT); } };
      }
      if (k === "depoli" || k === "iris" || k === "lc" || k === "filtre") {     // sur la lampe (l'objectif : sur le laser)
        var pose = k === "lc" ? st.lc !== false : present(k), ok = k === "filtre" ? true : (k === "lc") === (lampe(st).type === "point");
        return surBanc(p, "ent") && ok && !pose ? { texte: TRAD("<b>{0}</b> — lâché ici : posé sur la lampe", [nm]), f: function () { clicCarte(k); } } : null;
      }
      var b = k === "ecran" || k === "oeil" ? "sor" : ELEMENTS[k] && ELEMENTS[k].banc;
      if (!b || !surBanc(p, b)) return null;
      var d = b === "ent" ? dE(p.y) : dS(p.x);
      return { texte: TRAD("<b>{0}</b> — lâché ici : {1} cm", [nm, fmtNb(clamp(d, BORNES[b][0], BORNES[b][1]) * 100, 1)]), f: function () {
        if (k === "ecran" || k === "oeil") { if (st.det !== k) { detecteur(st, k); st.vue = "det"; } deplacer(st, "sor", k, d); st.sel = "det"; }
        else { if (!present(k)) poser(st, k); deplacer(st, b, k, d); st.sel = k; }
        TAPE = null; modifie(TOUT);
      } };
    }
    // L'onglet du banc d'entrée s'appelle « Entrée », comme la touche du clavier nommée dans les
    // infobulles : deux sens pour une même phrase française, et le dictionnaire n'en tient qu'un. Les
    // infobulles portent donc le nom de la touche dans leur propre phrase, et l'étiquette de l'onglet
    // passe par une clé propre — un span autour du mot, sans effet sur l'affichage : « Entrée ».
    var ETG = K.etagere(SCENE, { flottante: true, fixe: true, memoire: "paillasse-michelson-etagere", titre: TRAD("Éléments"), defaut: "Sources",
      onglets: function () { return [{ nom: "Sources", lab: TRAD("Sources"), a3: TRAD("<b>Sources</b> — sodium, mercure, lumière blanche, laser : une seule à la fois") },
        { nom: "Entrée", lab: TRAD("<span>Entrée</span>"), a3: TRAD("<b>Banc d'entrée</b> — dépoli et iris sur la lampe, condenseur, lentille") },
        { nom: "Sortie", lab: TRAD("Sortie"), a3: TRAD("<b>Banc de sortie</b> — lentilles, écran ou œil") },
        { nom: "Accessoires", lab: TRAD("Accessoires"), a3: TRAD("<b>Accessoires</b> — feuille et lamelle, posées sur un miroir") }]; },
      cartes: cartesEt,
      glisse: function (k, ev) { var q = poseCarte(k, K.ptSvg(ev)); return { fantome: true, texte: q ? q.texte : TRAD("Lâcher sur {0} pour poser ; ailleurs : rien", [k === "feuille" || k === "lamelle" ? TRAD("un miroir") : TRAD("son banc")]) }; },
      lache: function (k, ev, bouge) {
        if (ev.type === "pointercancel") return;
        if (!bouge) { clicCarte(k); return; }
        var q = poseCarte(k, K.ptSvg(ev)); if (q) q.f();
      },
      clic: clicCarte });

    // ================= observation =================
    var cvWrap = el("div", "pl-cv", K.obs); cvWrap.tabIndex = 0;
    var cv = el("canvas", "pl-cv-gl", cvWrap); cv.width = cv.height = 440;
    var cv2 = el("canvas", "pl-cv-cpu", cvWrap); cv2.width = cv2.height = 440; cv2.hidden = true;
    var surc = svg("svg", { class: "pl-surc", viewBox: "0 0 440 440" }, cvWrap);
    var MOT = null;
    // Qualité de l'aperçu calculé pendant un geste (une passe par image ; l'image fine suit 150 ms après le dernier
    // mouvement). Réglage du poste, pas de l'état : gardé dans le navigateur (mode prof), « normale » par défaut.
    var GESTE = { rapide: { res: 192, k: 0.6, nom: TRAD("Rapide") }, normale: { res: 256, k: 1, nom: TRAD("Normale") },
      fine: { res: 352, k: 1.6, nom: TRAD("Fine") }, tresfine: { res: 440, k: 2.5, nom: TRAD("Très fine") } };
    var CLE_GESTE = "paillasse-michelson-qualite-geste", gesteQ = "normale";
    try { var gq = root.localStorage.getItem(CLE_GESTE); if (GESTE[gq]) gesteQ = gq; } catch (e) { /* stockage absent */ }
    // cadence des aperçus pendant le dernier geste (images par seconde), affichée au mode prof pour régler GESTE
    var CAD = { t: 0, n: 0, dt: 0, ips: 0 };
    function noterApercu() {
      var now = maintenant();
      if (CAD.t && now - CAD.t < 400) { CAD.dt += now - CAD.t; CAD.n++; if (CAD.n >= 5) CAD.ips = 1000 * CAD.n / CAD.dt; }
      else { CAD.n = 0; CAD.dt = 0; }
      CAD.t = now;
    }
    function qualite(cfg) {
      var blanc = !!CO.spectreDe(cfg.spectre).continu, forme = !!cfg.source.forme;
      var pt = !(cfg.source.rayon > 0);
      // Lumière blanche : 16 bandes de nombre d'onde intégrées exactement (`bandes` du cœur), sans tirage : rien à
      // moyenner sur le spectre, l'image fine n'a pas plus de passes qu'en lumière monochromatique ; les mêmes à
      // l'aperçu (aucun changement de teinte quand l'image fine le remplace). Écart au spectre continu (amplitude d'un
      // canal) : 0,9 % au plus dans les teintes de Newton. UHD 620 : aperçu 6-7 ms, passe fine 20 ms (filament).
      var g = GESTE[gesteQ] || GESTE.normale;
      // K : points tirés par bras et par pixel (intégration par pixel du cœur, `preparer`).
      // Lampe nue : 24 points à l'aperçu (au condenseur, le miroir ne voit qu'une partie de la lampe : une part des
      // points n'éclaire pas, le bord du champ d'une passe en garde la trace).
      return { apercu: { res: g.res, K: Math.max(6, Math.round((forme ? 24 : 12) * g.k)), M: blanc ? 16 : 1 },
        fin: { res: 440, K: forme ? 24 : 16, M: blanc ? 16 : 1, passes: pt ? 1 : 12 } };
    }
    try { MOT = CO.creerMoteur ? CO.creerMoteur(cv, { qualite: qualite, graine: 1 }) : null; } catch (e) { MOT = null; }
    var CPU = null, ctx2 = null, img2 = document.createElement("canvas");
    try { ctx2 = cv2.getContext("2d"); } catch (e) { ctx2 = null; }
    if (!MOT) CPU = { res: 64, K: 8, acc: null, n: 0, max: 8 };
    // Vues dessinées en 2D (pas par le moteur) : la feuille, la face de l'iris, et l'œil devant un laser (refusé).
    function laserOeil() { return vue(st) === "oeil" && lampe(st).type === "point"; }
    var sombreVu = false;   // écran : pas assez de lumière (tout ou rien), réévalué à chaque changement optique
    function vue2D() { var v = vue(st); return v === "feuille" || v === "iris" || laserOeil() || (v === "ecran" && sombreVu); }
    function dessiner2D() {
      if (vue(st) === "feuille") dessinerFeuille();
      else if (vue(st) === "iris") dessinerIris();
      else if (ctx2 && vue(st) === "ecran") {
        ctx2.fillStyle = "#000"; ctx2.fillRect(0, 0, 440, 440);
        ctx2.fillStyle = "#020203"; ctx2.fillRect(8, 8, 424, 424);
        ctx2.fillStyle = "#7b848e"; ctx2.font = "15px sans-serif"; ctx2.textAlign = "center"; ctx2.fillText(TRAD("Pas assez de lumière"), 220, 224);
      }
      else if (ctx2) { ctx2.fillStyle = "#000"; ctx2.fillRect(0, 0, 440, 440); }
    }
    function montrerCanvas() { var f = vue2D() || !MOT; cv.hidden = f; cv2.hidden = !f; }
    // Repli sans carte graphique : une passe de rayons par image jusqu'à CPU.max, puis — le niveau d'adaptation
    // continuant de rejoindre sa cible — la seule conversion en couleurs, 25 fois par seconde au plus. Même loi de
    // fondu qu'au moteur (module couleur) et même ancrage par scène : les deux chemins ne divergent pas selon la machine.
    var SUIVI_CPU = CO.suiviAdaptation ? CO.suiviAdaptation() : null, sceneAncreCPU = null, tLissCPU = 0, tRelaxCPU = 0;
    function cpuPasse() {
      var cfg = configOptique(st, c3Vu), a = affichage(st, BAL), q = qualite(cfg).apercu;
      var im = CO.rendreCPU(cfg, { res: CPU.res, W: a.W, cx0: a.cx0 || 0, cy0: a.cy0 || 0, K: CPU.K, M: q.M, graine: 1 }, 1, CPU.n);
      for (var i = 0; i < im.length; i++) CPU.acc[i] += im[i];
      CPU.n++;
    }
    function cpuMontre() {
      if (!ctx2 || !CPU.acc || !(CPU.n > 0) || vue2D()) return;
      var a = affichage(st, BAL), n = CPU.res;
      img2.width = img2.height = n;
      var ic = img2.getContext("2d"), id = ic.createImageData(n, n), Dd = id.data, p, Y = new Float64Array(n * n);
      // luminosité (comme le moteur, `creerMoteur` du module couleur) : adaptation sur l'image accumulée
      for (p = 0; p < n * n; p++) Y[p] = Math.max(CPU.acc[3 * p + 1] / CPU.n, 0);
      var expo = a.expo, vis = null, sv = 1;
      if (a.auto) { var ys = Array.prototype.filter.call(Y, function (y) { return y > 0; }).sort(function (x, y) { return x - y; }); if (ys.length) { expo = 0.9 / ys[Math.floor(0.99 * (ys.length - 1))]; if (a.visible) vis = CO.parametresVisible(0.9 / expo, a.visible); } }
      if (a.vision) {
        var hh = 2 * a.W / n, LL = Y.map(function (y) { return y * a.vision.s; });
        CPU.vision = CO.adapterVision(LL, a.vision.omega * hh * hh, { M: a.vision.M, Fsalle: a.vision.Fsalle, salle: a.vision.salle, scot: a.vision.scot, pied: a.vision.pied });
        CPU.vision.pupTracee = a.vision.pup || 0;
        CPU.vision.scene = a.scene == null ? null : a.scene;
        if (a.vision.affiche !== false) {
          if (SUIVI_CPU) {
            var tn = maintenant(), neuf = CPU.vision.scene !== sceneAncreCPU;
            sceneAncreCPU = CPU.vision.scene;
            CPU.adaptLa = SUIVI_CPU.pas(CPU.vision.La, tLissCPU ? (tn - tLissCPU) / 1000 : 0, neuf || SUIVI_CPU.ancre);
            tLissCPU = tn;
          }
          vis = SUIVI_CPU ? CO.parametresLisses(CPU.adaptLa, a.vision.scot, CPU.vision.haut, CPU.vision.p[4]) : CPU.vision.p;
          sv = a.vision.s;
        }
      }
      for (p = 0; p < n * n; p++) {
        var xyz = [CPU.acc[3 * p] / CPU.n, CPU.acc[3 * p + 1] / CPU.n, CPU.acc[3 * p + 2] / CPU.n], c;
        if (vis) { var v3 = CO.vision([xyz[0] * sv, xyz[1] * sv, xyz[2] * sv], vis, BAL); c = [255 * CO.gammaS(v3[0]), 255 * CO.gammaS(v3[1]), 255 * CO.gammaS(v3[2])]; }
        else c = CO.versRGB(xyz, expo, BAL, a.comp);
        var qq = a.retourne ? n * n - 1 - p : p;
        Dd[4 * qq] = c[0]; Dd[4 * qq + 1] = c[1]; Dd[4 * qq + 2] = c[2]; Dd[4 * qq + 3] = 255;
      }
      ic.putImageData(id, 0, 0);
      ctx2.fillStyle = "#000"; ctx2.fillRect(0, 0, 440, 440);
      if (vue(st) === "ecran" && !a.vision) { ctx2.fillStyle = "#16181b"; ctx2.fillRect(8, 8, 424, 424); }
      ctx2.save(); ctx2.imageSmoothingEnabled = true; ctx2.globalCompositeOperation = "lighter"; ctx2.drawImage(img2, 0, 0, 440, 440); ctx2.restore();
    }
    function cpuPas() {
      if (!ctx2 || !CPU.acc || vue2D()) return;
      if (CPU.n < CPU.max) { cpuPasse(); cpuMontre(); return; }
      // plus de passe à ajouter : il ne reste que le fondu du niveau d'adaptation (l'accumulateur ne bouge pas)
      if (!SUIVI_CPU || !CPU.vision || !SUIVI_CPU.enRelax(CPU.vision.La) || maintenant() - tRelaxCPU < 40) return;
      tRelaxCPU = maintenant(); cpuMontre();
    }
    // ---- la feuille vue de face (rendu 2D, optique géométrique : feuilleGeom) ----
    var FA = document.createElement("canvas"), FB = document.createElement("canvas"), FEU = null;
    function aireForme(F) {   // aire de la forme dans le disque (iris, fenêtre), m²
      var n = 80, h = 2 * F.rayon / n, k = 0, i, j;
      for (i = 0; i < n; i++) for (j = 0; j < n; j++) {
        var x = -F.rayon + (i + 0.5) * h, y = -F.rayon + (j + 0.5) * h;
        if (x * x + y * y <= F.rayon * F.rayon && CO.dansForme(F.forme, x, y)) k++;
      }
      return k * h * h;
    }
    // Luminosité : feuille blanche (ρ = VISION.rho) regardée à VISION.dObs, des deux yeux ; réelle : `vision`,
    // adaptée à la vue entière ; toujours visible : exposition sur le 99e centile, fond de salle.
    // Flou gaussien d'écart-type sig (pixels) d'une image N × N en place, approché par trois flous en boîte (largeurs de
    // Kovesi, « Fast almost-Gaussian filtering »), bords à zéro ; coût indépendant de sig.
    function flouGauss(G, N, sig) {
      var nb = 3, wi = Math.floor(Math.sqrt(12 * sig * sig / nb + 1)), wl = wi % 2 ? wi : wi - 1, wu = wl + 2;
      var mm = Math.round((12 * sig * sig - nb * wl * wl - 4 * nb * wl - 3 * nb) / (-4 * wl - 4)), T = new Float32Array(N);
      function passe(o, pas, r) {          // une ligne (o : début, pas : 1 ou N), boîte de demi-largeur r
        var i, acc = 0, inv = 1 / (2 * r + 1);
        for (i = 0; i < N; i++) T[i] = G[o + i * pas];
        for (i = 0; i <= Math.min(r, N - 1); i++) acc += T[i];
        for (i = 0; i < N; i++) {
          G[o + i * pas] = acc * inv;
          if (i + r + 1 < N) acc += T[i + r + 1];
          if (i - r >= 0) acc -= T[i - r];
        }
      }
      for (var k = 0; k < nb; k++) {
        var r = ((k < mm ? wl : wu) - 1) / 2, j;
        if (r < 1) continue;
        for (j = 0; j < N; j++) passe(j * N, 1, r);
        for (j = 0; j < N; j++) passe(j, N, r);
      }
    }
    function dessinerFeuille() {
      if (!ctx2) return;
      var F = feuilleGeom(st), W = W_VUE.feuille, n = 220, k = n / (2 * W), rbp = F.rb * k, sig = rbp / 2;
      var xyz = CO.xyzSpectre(CO.spectreDe(F.spectre)), expo = 1, val;
      if (sig > n) {   // flou plus large que la vue : éclairement uniforme L × aire / B² (iris devant la lampe : la part de la lampe vue à travers lui depuis l'axe)
        var Fu = F.vig ? { forme: F.forme, rayon: Math.min(F.rayon, F.vig.R * Math.abs(F.B) / Math.max(1e-9, Math.abs(F.B) - F.vig.D)) } : F;
        var E = F.lum * aireForme(Fu) / Math.max(1e-12, F.B * F.B) * expo;
        val = function () { return E; };
      } else {
        // Forme dessinée au canvas (couverture de chaque pixel), puis flou gaussien calculé en flottants : trois flous en
        // boîte successifs (lignes puis colonnes). Pas de blur() du canvas : sa sortie est sur 8 bits, et un grand flou
        // (lampe sans lentille devant la feuille, plus de 100 px) étale la lumière en 0 à 3 niveaux sur 255 — marches
        // pixelisées, puis noir.
        var m = Math.ceil(Math.min(n, 3 * sig)) + 2, N = n + 2 * m;
        FA.width = FA.height = N;
        var a = FA.getContext("2d");
        a.clearRect(0, 0, N, N); a.save();
        // y vers le haut ; A < 0 : image renversée ; x de la vue = sens du dessin le long du miroir (−x du moteur,
        // comme le bord de la feuille et de la lamelle)
        a.translate(N / 2, N / 2); a.scale(-F.A * k, -F.A * k);
        a.beginPath(); a.arc(0, 0, F.rayon, 0, 2 * Math.PI); a.clip();
        a.fillStyle = "#fff";
        F.forme.forEach(function (f) {
          a.beginPath();
          if (f.t === "rect") a.rect(f.x0, f.y0, f.x1 - f.x0, f.y1 - f.y0);
          else if (f.t === "anneau") { a.arc(f.cx, f.cy, f.r1, f.a0, f.a1); a.arc(f.cx, f.cy, f.r0, f.a1, f.a0, true); a.closePath(); }
          else a.ellipse(f.cx, f.cy, f.a, f.b, 0, 0, 2 * Math.PI);
          a.fill();
        });
        a.restore();
        var A8 = a.getImageData(0, 0, N, N).data, G = new Float32Array(N * N), E0 = F.E * expo, V = F.vig;
        for (p = 0; p < N * N; p++) G[p] = A8[4 * p + 3] / 255;
        if (V) {     // iris devant la lampe : part du cône (demi-angle th, axé vers le centre de la pupille à dl) de chaque point source qui le passe
          var rc = Math.max(1e-6, V.th * V.D), ac = Math.PI * rc * rc, fc = isFinite(V.dl) ? 1 - V.D / V.dl : 1;
          for (p = 0; p < N * N; p++) if (G[p] > 0) {
            var xs = -((p % N) + 0.5 - N / 2) / (k * F.A), ys = -(Math.floor(p / N) + 0.5 - N / 2) / (k * F.A);   // point source (repère de la lampe)
            G[p] *= MI_.lentille(rc, V.R, Math.hypot(xs, ys) * Math.abs(fc)) / ac;
          }
        }
        if (sig > 0.35) flouGauss(G, N, sig);
        val = function (q) { return G[(Math.floor(q / n) + m) * N + (q % n) + m] * E0; };
      }
      img2.width = img2.height = n;
      var ic = img2.getContext("2d"), id = ic.createImageData(n, n), Dd = id.data, fond = 0.006, p, Ev = new Float64Array(n * n);
      for (p = 0; p < n * n; p++) Ev[p] = val(p);
      var VV = CO.VISION, sL = VV.rho / Math.PI, vis = null, ex = 0;
      if (reelle(st)) {
        var Lf = Ev.map(function (e) { return e * sL; }), om = 3283 * Math.pow(2 * W / n / (VV.dObs / 1000), 2);
        FEU = CO.adapterVision(Lf, om, { M: 1, scot: (function (r) { return r == null ? -1 : r; })(CO.rapportScotopique(F.spectre)) });
        vis = FEU.p;
      } else {
        FEU = null;
        var ys = Array.prototype.filter.call(Ev, function (y) { return y > 0; }).sort(function (x, y) { return x - y; });
        ex = ys.length ? 0.9 / ys[Math.floor(0.99 * (ys.length - 1))] : 0;
      }
      for (p = 0; p < n * n; p++) {
        var Y = Ev[p], c;
        if (vis) { var v3 = CO.vision([xyz[0] / xyz[1] * Y * sL, Y * sL, xyz[2] / xyz[1] * Y * sL], vis, BAL); c = [255 * CO.gammaS(v3[0]), 255 * CO.gammaS(v3[1]), 255 * CO.gammaS(v3[2])]; }
        else { Y *= ex; c = CO.versRGB([xyz[0] / xyz[1] * Y + fond, Y + fond, xyz[2] / xyz[1] * Y + fond * 1.08], 1, BAL); }
        Dd[4 * p] = c[0]; Dd[4 * p + 1] = c[1]; Dd[4 * p + 2] = c[2]; Dd[4 * p + 3] = 255;
      }
      ic.putImageData(id, 0, 0);
      ctx2.save(); ctx2.imageSmoothingEnabled = true; ctx2.drawImage(img2, 0, 0, 440, 440);
      // feuille en partie sur le miroir : elle s'étend de son bord vers la droite de la vue (sens du dessin) ; en deçà,
      // plus de papier, le miroir renvoie la lumière sans la diffuser vers l'observateur : noir
      if (!feuilleEntiere(st)) { var xb = 220 + fbord(st) * 1e-3 * 440 / (2 * W); ctx2.fillStyle = "#050607"; ctx2.fillRect(0, 0, Math.max(0, xb), 440); }
      // bord du miroir sous la feuille (plus grande que lui), en pointillés, centré sur l'axe
      ctx2.beginPath(); ctx2.arc(220, 220, R_MIROIR * 440 / (2 * W), 0, 2 * Math.PI);
      ctx2.setLineDash([7, 6]); ctx2.lineWidth = 1.3; ctx2.strokeStyle = "rgba(150, 170, 190, .75)"; ctx2.stroke();
      ctx2.restore();
    }

    // ---- la face de l'iris, côté appareil (rendu 2D, optique géométrique : irisRetour) ----
    // Trou : la lampe (ou le dépoli) vue au travers, éblouissante. Lames : les images de l'iris renvoyées par les miroirs,
    // disques de rayon |A| r flous de |B| θmax (profil erfc, flux conservé), luminance ρ E / π (lames mates ρ = 0,5)
    // rapportée à celle du trou ; réponse comprimée comme à l'œil (L^0,5) pour voir ensemble trou et taches.
    function erfc(x) {   // Abramowitz-Stegun 7.1.26
      var z = Math.abs(x), t = 1 / (1 + 0.3275911 * z);
      var y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-z * z);
      return x >= 0 ? y : 2 - y;
    }
    function dessinerIris() {
      if (!ctx2) return;
      var R = irisRetour(st, CO, c3Vu), r = R.r, W = W_VUE.iris, n = 220, k = n / (2 * W);
      var xyz = CO.xyzSpectre(CO.spectreDe(R.spectre)), xr = xyz[0] / xyz[1], zr = xyz[2] / xyz[1], RHO = 0.5, YREF = 0.003;
      var xb = CO.xyzSpectre(CO.spectreDe("bl")), AMB = 0.0012, trou = CO.versRGB([xr * 400, 400, zr * 400], 0.36, BAL, 0.5);   // lames grises dans le noir
      var IM = R.images.map(function (o) {
        var a = Math.abs(o.R.A) * r, sg = Math.max(0.35 / k, Math.abs(o.R.B) * o.R.th / 2), ae = Math.sqrt(a * a + sg * sg);
        return { x: o.x, y: o.y, ae: ae, sg: sg, pic: RHO * o.w * o.R.th * o.R.th / Math.max(1e-6, o.R.A * o.R.A) * (a * a) / (ae * ae) / YREF };
      });
      img2.width = img2.height = n;
      var ic = img2.getContext("2d"), id = ic.createImageData(n, n), Dd = id.data;
      for (var j = 0; j < n; j++) for (var i = 0; i < n; i++) {
        var X = -W + (i + 0.5) / k, Y = W - (j + 0.5) / k, p = j * n + i, Yn = 0, c, tr = clamp(0.5 - (Math.hypot(X, Y) - r) * k, 0, 1);
        for (var q = 0; q < IM.length && tr < 1; q++) { var o = IM[q]; Yn += o.pic * 0.5 * erfc((Math.hypot(X - o.x, Y - o.y) - o.ae) / (Math.SQRT2 * o.sg)); }
        c = CO.versRGB([xr * Yn + AMB * xb[0] / xb[1], Yn + AMB, zr * Yn + AMB * xb[2] / xb[1]], 0.36, BAL, 0.5);
        Dd[4 * p] = c[0] + tr * (trou[0] - c[0]); Dd[4 * p + 1] = c[1] + tr * (trou[1] - c[1]); Dd[4 * p + 2] = c[2] + tr * (trou[2] - c[2]); Dd[4 * p + 3] = 255;
      }
      ic.putImageData(id, 0, 0);
      ctx2.save(); ctx2.imageSmoothingEnabled = true; ctx2.drawImage(img2, 0, 0, 440, 440); ctx2.restore();
    }

    // ---- capteurs posés sur l'écran (barrette, photodiode, fibre), au-dessus de l'image ----
    var NOMS_CAPTEUR = { barrette: TRAD("Barrette CCD"), photodiode: "Photodiode", fibre: TRAD("Fibre du spectromètre") };
    function placerCapteur(g, c) {
      var k = 220 / W_VUE.ecran;
      g.setAttribute("transform", "translate(" + (220 + c.x * k) + " " + (220 - c.y * k) + ") rotate(" + (-(c.ang || 0)) + ")");
    }
    function dessinerSurc() {
      surc.innerHTML = "";
      var c = st.capteur;
      if (vue(st) !== "ecran" || !c) return;
      var W = W_VUE.ecran, k = 220 / W, g = svg("g", { class: "pl-capteur-t pl-capteur-" + c.type }, surc);
      if (c.type === "barrette") {
        var Lb = capteurs(st).L, L = Lb * k, H = 0.010 * k, pasG = Lb < 0.05 ? 0.001 : 0.01;   // graduations : mm ou cm
        svg("rect", { x: -L / 2 - 4, y: -H / 2, width: L + 8, height: H, rx: 2, fill: "#20252b", "fill-opacity": .55, stroke: "#8f99a5", "stroke-opacity": .6, "stroke-width": .8 }, g);
        svg("line", { x1: -L / 2, y1: 0, x2: L / 2, y2: 0, stroke: "#b9a6e8", "stroke-opacity": .9, "stroke-width": 1.1 }, g);
        for (var cm = 0; cm <= Lb / pasG + 1e-9; cm++) {
          var x = -L / 2 + cm * pasG * k;
          svg("line", { x1: x, y1: -H / 2, x2: x, y2: -H / 2 + (cm % 5 === 0 ? 4 : 2.2), stroke: "#c9d0d6", "stroke-opacity": .6, "stroke-width": .5 }, g);
        }
        var t0 = svg("text", { x: -L / 2 + 2, y: H / 2 - 2.5, class: "pl-regle-n" }, g); t0.textContent = "0";
      } else if (c.type === "photodiode") {
        svg("circle", { r: 0.005 * k, fill: "#1b1f24", "fill-opacity": .55, stroke: "#8f99a5", "stroke-opacity": .7, "stroke-width": .8 }, g);
        svg("rect", { x: -1.2, y: -1.2, width: 2.4, height: 2.4, fill: "#6a7cff", "fill-opacity": .9 }, g);
        [[-9, 0, -4, 0], [4, 0, 9, 0], [0, -9, 0, -4], [0, 4, 0, 9]].forEach(function (l) {
          svg("line", { x1: l[0], y1: l[1], x2: l[2], y2: l[3], stroke: "#c9d0d6", "stroke-opacity": .7, "stroke-width": .6 }, g);
        });
      } else {
        svg("path", { d: "M 3 3 C 14 14, 16 30, 40 44", fill: "none", stroke: "#e8a33a", "stroke-opacity": .7, "stroke-width": 2.2, "stroke-linecap": "round" }, g);
        svg("circle", { r: 4.2, fill: "#2a2f35", "fill-opacity": .7, stroke: "#c9d0d6", "stroke-opacity": .8, "stroke-width": .8 }, g);
        svg("circle", { r: 0.9, fill: "#f2f2ee" }, g);
      }
      placerCapteur(g, c);
      var prise = null;
      g.addEventListener("pointerdown", function (ev) { ev.preventDefault(); prise = { x: ev.clientX, y: ev.clientY, cx: c.x, cy: c.y }; try { g.setPointerCapture(ev.pointerId); } catch (e) {} });
      g.addEventListener("pointermove", function (ev) {
        if (!prise) return;
        var s = 440 / (surc.getBoundingClientRect().width || 440);
        c.x = clamp(prise.cx + (ev.clientX - prise.x) * s / k, -W, W); c.y = clamp(prise.cy - (ev.clientY - prise.y) * s / k, -W, W);
        placerCapteur(g, c); CAP.sale = true;
        K.modifie();
      });
      g.addEventListener("pointerup", function () { prise = null; });
    }
    function poserCapteur(type) {
      var c = st.capteur;
      if (c && c.type === type) st.capteur = null;
      else st.capteur = { type: type, x: type === "barrette" ? 0 : c ? c.x : 0, y: type === "barrette" ? -0.05 : c ? c.y : 0, ang: 0 };
      CAP.nouveau(); modifie("obs");
    }

    // ---- affichage du capteur : panneau flottant, gardé à côté du cahier ----
    var CAP = { sale: true, fin: false, t: 0, pd: null, echelle: 0, tDessin: 0, donnees: null };
    CAP.panneau = K.panneau("pl-capteur", TRAD("Capteur"), { libre: true });
    (function () {
      var C = CAP.panneau.corps;
      CAP.titre = CAP.panneau.el.querySelector(".pl-pan-t span");
      CAP.panneau.el.querySelector(".pl-pan-x").title = TRAD("Fermer : retire le capteur de l'écran");
      CAP.cv = el("canvas", "pl-cap-cv", C);
      CAP.pied = el("div", "pl-cap-pied", C);
      CAP.panneau.surBascule = function (o) { if (!o && st.capteur) { st.capteur = null; CAP.nouveau(); modifie("obs"); } };
      // molette sur le graphe (coque : pas accumulés) : un cran = une largeur de fenêtre (photodiode), ×1,4 (fibre, barrette)
      // molette sur le graphe du capteur : largeur de la fenêtre (pas accumulés) ; gestionnaire stable et `fige: false`
      // (le zoom ne vaut que tant que le pointeur est sur le graphe, pas une seconde après l'avoir quitté)
      var MOL_CAP_GRAPHE = function (k, ev) { for (var n = Math.abs(k); n > 0; n--) molGraphe(k > 0 ? -1 : 1, ev); };
      MOL_CAP_GRAPHE.fige = false;
      K.cibleMolette(function (t) { return t === CAP.cv ? MOL_CAP_GRAPHE : null; });
      function molGraphe(sg, ev) {
        var c = st.capteur;
        if (!c) return;
        if (c.type === "photodiode") {
          var i = FEN_PD.indexOf(c.fen || 10); c.fen = FEN_PD[clamp((i < 0 ? 3 : i) + sg, 0, FEN_PD.length - 1)]; CAP.tDessin = 0;
        } else if (c.type === "fibre") {
          var r = CAP.cv.getBoundingClientRect(), f = fenetre(), u = clamp((ev.clientX - r.left - GM.g) / (r.width - GM.g - GM.d), 0, 1);
          var lc = f[0] + u * (f[1] - f[0]), w = (f[1] - f[0]) * (sg > 0 ? 1.4 : 1 / 1.4);
          w = clamp(w, 0.1, 340);
          var a = clamp(lc - u * w, 380, 720 - w);
          c.fen = [a, a + w]; CAP.sale = true;
        } else {
          var rb = CAP.cv.getBoundingClientRect(), fb = fenBarrette(), ub = clamp((ev.clientX - rb.left - GM.g) / (rb.width - GM.g - GM.d), 0, 1), Lm = capteurs(st).L * 1000;
          var xc = fb[0] + ub * (fb[1] - fb[0]), wb = clamp((fb[1] - fb[0]) * (sg > 0 ? 1.4 : 1 / 1.4), 2, Lm), ab = clamp(xc - ub * wb, 0, Lm - wb);
          c.zb = [ab, ab + wb]; CAP.sale = true; CAP.donnees = null;
        }
        K.modifie();
      }
      // curseur de lecture : le pointeur sur le graphe donne l'abscisse
      CAP.cv.addEventListener("pointermove", function (ev) { CAP.px = ev.clientX - CAP.cv.getBoundingClientRect().left; CAP.redessiner(); });
      CAP.cv.addEventListener("pointerleave", function () { CAP.px = null; CAP.redessiner(); });
    })();
    function fenBarrette() { var c = st.capteur, Lm = capteurs(st).L * 1000; return c && c.zb && c.zb[1] <= Lm + 1e-9 ? c.zb : [0, Lm]; }
    CAP.redessiner = function () {
      var c = st.capteur;
      if (!c || !CAP.panneau.ouvert()) return;
      if (c.type === "barrette") dessinerBarrette(); else if (c.type === "fibre") dessinerSpectre(); else dessinerPhotodiode();
    };
    function grand(v) {
      CAP.grand = v; CAP.panneau.el.classList.toggle("pl-cap-grand", v);
      if (CAP.bGrand) CAP.bGrand.innerHTML = v ? TRAD("Réduire") : TRAD("Agrandir");
      CAP.tDessin = 0; CAP.redessiner();
    }
    var FEN_PD = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000];   // largeur de la fenêtre de la photodiode, µm de chariot
    var GM = { g: 34, d: 8, h: 8, b: 30 };                            // marges du graphe (px)
    function fenetre() {
      var c = st.capteur, cle = st.lampe + "|" + (st.filtre || "");
      if (!c.fen || c.fenLampe !== cle) { var f = fenetreSpectro(st.lampe, st.filtre); c.fen = [f[0], f[1]]; c.fenLampe = cle; }
      return c.fen;
    }
    // Panneau ouvert tant qu'un capteur est posé et l'écran observé ; un autre capteur repart de zéro.
    CAP.sync = function () {
      var c = st.capteur, t = c ? c.type : null;
      if (t !== CAP.type) { CAP.nouveau(); return; }
      var ouvert = !!c && vue(st) === "ecran";
      if (ouvert !== CAP.panneau.ouvert()) { var sb = CAP.panneau.surBascule; CAP.panneau.surBascule = null; CAP.panneau.basculer(ouvert); CAP.panneau.surBascule = sb; CAP.sale = true; CAP.tDessin = 0; }
    };
    CAP.nouveau = function () {
      CAP.type = st.capteur ? st.capteur.type : null;
      CAP.pd = null; CAP.echelle = 0; CAP.donnees = null; CAP.fenDonnees = null; CAP.sale = true; CAP.fin = false; CAP.tDessin = 0;
      var c = st.capteur, ouvert = !!c && vue(st) === "ecran";
      if (c) CAP.titre.textContent = NOMS_CAPTEUR[c.type];
      if (ouvert !== CAP.panneau.ouvert()) { var sb = CAP.panneau.surBascule; CAP.panneau.surBascule = null; CAP.panneau.basculer(ouvert); CAP.panneau.surBascule = sb; }
      CAP.pied.innerHTML = "";
      if (!c) return;
      CAP.bGrand = K.bouton(CAP.pied, TRAD("Agrandir"), function () { grand(!CAP.grand); }, "pl-btn-p");
      grand(c.type === "barrette");
      if (c.type === "photodiode") {
        K.bouton(CAP.pied, TRAD("Effacer la trace"), function () { CAP.pd = null; CAP.tDessin = 0; }, "pl-btn-p");
        el("span", "pl-cap-n", CAP.pied, TRAD("Charioter : l'éclairement s'inscrit selon le déplacement du chariot. Molette sur le graphe : largeur de la fenêtre."));
      } else if (c.type === "fibre") {
        K.bouton(CAP.pied, TRAD("Fenêtre de la lampe"), function () { c.fen = null; CAP.sale = true; K.modifie(); }, "pl-btn-p");
        K.bouton(CAP.pied, TRAD("Tout le visible"), function () { c.fen = [380, 720]; c.fenLampe = st.lampe + "|" + (st.filtre || ""); CAP.sale = true; K.modifie(); }, "pl-btn-p");
        boutonReel(c);
        el("span", "pl-cap-n", CAP.pied, TRAD("Molette sur le spectre : zoomer autour du pointeur. {0}.{1}", [majuscule(capteurs(st).fibre),
          (st.capReels ? TRAD(" Le spectromètre parfait (résolution 0,02 nm, fibre de 50 µm) sépare le doublet du sodium (0,6 nm), que celui-ci ne résout pas.") : "")]));
      } else {
        K.bouton(CAP.pied, TRAD("Barrette entière"), function () { c.zb = null; CAP.sale = true; CAP.donnees = null; K.modifie(); }, "pl-btn-p");
        boutonReel(c);
        el("span", "pl-cap-n", CAP.pied, TRAD("{0}.{1} Molette sur le profil : zoomer autour du pointeur, qui donne la position. Molette sur la barrette (écran) : la tourner.", [majuscule(capteurs(st).barrette),
          (st.capReels ? TRAD(" La barrette parfaite est bien plus longue (15 cm au lieu de 2,9 cm) : elle couvre beaucoup plus d'anneaux.") : "")]));
      }
      var bx = K.bouton(CAP.pied, TRAD("Exporter (CSV)"), function () {
        var o = CAP.csv();
        if (!o) { bx.title = TRAD("Pas encore de courbe à exporter."); return; }
        if (!K.exporterCsv(o.nom, o.entetes, o.lignes)) bx.title = TRAD("Export impossible dans ce navigateur.");
      }, "pl-btn-p");
      bx.title = TRAD("Les valeurs calculées de la courbe (fenêtre affichée), en fichier .csv à lire avec Python (point décimal, séparateur virgule).");
    };
    // Courbe du capteur en table : { nom, entetes, lignes } ; les valeurs calculées, pas le dessin. null s'il n'y a rien.
    CAP.csv = function () {
      var c = st.capteur, i, L = [];
      if (!c) return null;
      if (c.type === "barrette") {
        var d = CAP.donnees, f = CAP.fenDonnees || fenBarrette(), n = d ? d.length / 3 : 0;
        if (!n) return null;
        for (i = 0; i < n; i++) L.push([f[0] + (i + 0.5) * (f[1] - f[0]) / n, d[3 * i + 1]]);
        return { nom: "barrette.csv", entetes: ["position_mm", "eclairement_u_a"], lignes: L };
      }
      if (c.type === "fibre") {
        var g = CAP.donnees, m = g ? g.l.length : 0;
        if (!m) return null;
        for (i = 0; i < m; i++) L.push([g.l[i], g.I[i], g.I0[i]]);
        return { nom: "spectre.csv", entetes: ["longueur_onde_nm", "intensite_u_a", "intensite_sans_cannelures_u_a"], lignes: L };
      }
      var pd = CAP.pd;
      if (!pd || !pd.bins.size) return null;
      Array.from(pd.bins.keys()).sort(function (u, v) { return u - v; }).forEach(function (k) { L.push([(k * 1e-5 - pd.origine) * 1000, pd.bins.get(k)]); });
      return { nom: "photodiode.csv", entetes: ["deplacement_chariot_um", "I_sur_I_moyen"], lignes: L };
    };
    // Points calculés sur la fenêtre de la barrette : parfaite, 500 (300 en aperçu) quel que soit le zoom ; réelle, ses
    // pixels de 14 µm compris dans la fenêtre (un zoom ne crée pas de pixels).
    function pixelsBarrette(apercu) {
      var C = capteurs(st), f = CAP.fenDonnees || fenBarrette();
      if (!st.capReels) return apercu ? 300 : C.n;
      var n = Math.max(2, Math.round(C.n * (f[1] - f[0]) / (C.L * 1000)));
      return apercu ? Math.min(n, 300) : n;
    }
    function majuscule(t) { return t.charAt(0).toUpperCase() + t.slice(1); }
    // Capteur réel ou parfait (st.capReels, commun à la barrette et au spectromètre) : on repart de zéro.
    function boutonReel(c) {
      K.bouton(CAP.pied, st.capReels ? TRAD("Capteur parfait") : TRAD("Capteur réel"), function () {
        st.capReels = !st.capReels; c.zb = null; CAP.nouveau(); dessinerSurc(); K.modifie();
      }, "pl-btn-p");
    }
    // Mise à l'échelle du canvas (pixels de l'écran) ; renvoie le contexte et les dimensions en px CSS.
    function prepCv() {
      var cv = CAP.cv, r = cv.getBoundingClientRect(), dpr = root.devicePixelRatio || 1, w = Math.max(10, r.width || 260), h = Math.max(10, r.height || 150);
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      var x = null;
      try { x = cv.getContext("2d"); } catch (e) { x = null; }
      if (!x) return null;
      x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
      x.fillStyle = "#0d1013"; x.fillRect(0, 0, w, h);
      return { x: x, w: w, h: h, x0: GM.g, x1: w - GM.d, y0: h - GM.b, y1: GM.h };
    }
    function pasNet(etendue, n) {
      var p = Math.pow(10, Math.floor(Math.log10(etendue / n))), r = etendue / n / p;
      return p * (r < 1.5 ? 1 : r < 3.5 ? 2 : r < 7.5 ? 5 : 10);
    }
    function axes(G, xa, xb, titreX, ya, yb, titreY, fmtX) {
      var x = G.x, pas = pasNet(xb - xa, Math.max(4, Math.round((G.x1 - G.x0) / 70))), v;
      var sous = pas / (Math.round(pas / Math.pow(10, Math.floor(Math.log10(pas) + 1e-9))) === 2 ? 4 : 5);
      CAP.axe = { xa: xa, xb: xb, pas: pas, G: G };
      x.strokeStyle = "#3a414a"; x.lineWidth = 1; x.fillStyle = "#8f99a5"; x.font = "10px system-ui, sans-serif"; x.textAlign = "center";
      x.beginPath(); x.moveTo(G.x0, G.y0 + .5); x.lineTo(G.x1, G.y0 + .5); x.moveTo(G.x0 - .5, G.y0); x.lineTo(G.x0 - .5, G.y1); x.stroke();
      for (v = Math.ceil(xa / pas) * pas; v <= xb + 1e-9 * pas; v += pas) {
        var px = G.x0 + (v - xa) / (xb - xa) * (G.x1 - G.x0);
        x.beginPath(); x.moveTo(px, G.y0); x.lineTo(px, G.y0 + 3); x.stroke();
        x.fillText(fmtX ? fmtX(v, pas) : fmtNb(Math.abs(v) < 1e-9 * pas ? 0 : v, pas < 1 ? Math.min(3, Math.ceil(-Math.log10(pas) - 1e-9)) : 0), px, G.y0 + 12);
      }
      x.strokeStyle = "#2c323b";
      for (v = Math.ceil(xa / sous) * sous; v <= xb + 1e-9 * sous; v += sous) {
        var ps = G.x0 + (v - xa) / (xb - xa) * (G.x1 - G.x0);
        x.beginPath(); x.moveTo(ps, G.y0); x.lineTo(ps, G.y0 + 2); x.stroke();
      }
      x.textAlign = "right"; x.fillText(titreX, G.x1, G.y0 + 24);
      x.save(); x.translate(10, (G.y0 + G.y1) / 2); x.rotate(-Math.PI / 2); x.textAlign = "center"; x.fillText(titreY, 0, 0); x.restore();
      x.textAlign = "right";
      if (yb != null) [ya, (ya + yb) / 2, yb].forEach(function (u, i) {
        var py = G.y0 - (u - ya) / (yb - ya) * (G.y0 - G.y1);
        x.fillText(i === 0 ? "0" : fmtNb(u, 0 + (u % 1 ? 1 : 0)), G.x0 - 4, py + 3);
      });
    }
    function couleurCol(xyz) {   // teinte d'un point (pour colorer un profil) : sRGB normalisé au canal le plus fort
      var c = CO.rgbLin(xyz), m = Math.max(c[0], c[1], c[2], 1e-30);
      return "rgb(" + c.map(function (v) { return Math.round(255 * CO.gammaS(Math.max(0, v) / m)); }).join(",") + ")";
    }
    function echelle(max) {   // fixe tant que ça tient, refaite si dépassée ou devenue 4 fois trop grande
      if (!(max > 0)) return CAP.echelle || 1;
      if (!CAP.echelle || max > CAP.echelle || max < CAP.echelle / 4) CAP.echelle = max * 1.15;
      return CAP.echelle;
    }
    function dessinerBarrette() {
      var G = prepCv(), d = CAP.donnees;
      if (!G) return;
      var n = d ? d.length / 3 : 0, mx = 0, i;
      for (i = 0; i < n; i++) mx = Math.max(mx, d[3 * i + 1]);
      var E = echelle(mx), fb = CAP.fenDonnees || fenBarrette();
      axes(G, fb[0], fb[1], TRAD("position le long de la barrette (mm)"), 0, null, TRAD("éclairement"));
      if (!n) { curseur(" mm", 2); return; }
      var x = G.x, dx = (G.x1 - G.x0) / n;
      for (i = 0; i < n; i++) {
        var v = d[3 * i + 1] / E, py = G.y0 - Math.min(1, v) * (G.y0 - G.y1);
        x.fillStyle = couleurCol([d[3 * i], d[3 * i + 1], d[3 * i + 2]]); x.globalAlpha = .55;
        x.fillRect(G.x0 + i * dx, py, Math.max(1, dx + .3), G.y0 - py);
      }
      x.globalAlpha = 1; x.strokeStyle = "#e8ecef"; x.lineWidth = 1.2; x.beginPath();
      for (i = 0; i < n; i++) { var yy = G.y0 - Math.min(1, d[3 * i + 1] / E) * (G.y0 - G.y1), xx = G.x0 + (i + .5) * dx; if (i) x.lineTo(xx, yy); else x.moveTo(xx, yy); }
      x.stroke();
      curseur(" mm", 2);
    }
    // Trait vertical sous le pointeur et son abscisse, au chiffre près d'un dixième de graduation.
    function curseur(unite, plus) {
      var A = CAP.axe, px = CAP.px;
      if (!A || px == null || px < A.G.x0 || px > A.G.x1) return;
      var x = A.G.x, v = A.xa + (px - A.G.x0) / (A.G.x1 - A.G.x0) * (A.xb - A.xa), dec = Math.max(0, Math.ceil(-Math.log10(A.pas) - 1e-9) + plus);
      x.strokeStyle = "#e8c45a"; x.globalAlpha = .8; x.setLineDash([3, 3]); x.beginPath(); x.moveTo(px + .5, A.G.y0); x.lineTo(px + .5, A.G.y1); x.stroke();
      x.setLineDash([]); x.globalAlpha = 1;
      var t = fmtNb(v, dec) + unite; x.font = "11px system-ui, sans-serif";
      var w = x.measureText(t).width + 8, bx = clamp(px + 6, A.G.x0, A.G.x1 - w);
      x.fillStyle = "rgba(13,16,19,.85)"; x.fillRect(bx, A.G.y1, w, 16);
      x.fillStyle = "#e8c45a"; x.textAlign = "left"; x.fillText(t, bx + 4, A.G.y1 + 12);
    }
    function dessinerSpectre() { traceSpectre(); curseur(" nm", 2); }
    function traceSpectre() {
      var G = prepCv(), d = CAP.donnees, f = fenetre();
      if (!G) return;
      var n = d ? d.l.length : 0, mx = 0, i;
      for (i = 0; i < n; i++) mx = Math.max(mx, d.I0[i]);
      var E = 2 * (mx || 1);
      axes(G, f[0], f[1], TRAD("longueur d'onde (nm)"), 0, null, TRAD("densité spectrale"), function (v, pas) { return fmtNb(v, pas < 1 ? Math.min(3, Math.ceil(-Math.log10(pas) - 1e-9)) : 0); });
      if (!n || !(mx > 0)) { if (n) { G.x.fillStyle = "#7f8996"; G.x.textAlign = "center"; G.x.fillText(TRAD("pas de lumière sur la fibre"), (G.x0 + G.x1) / 2, (G.y0 + G.y1) / 2); } return; }
      var x = G.x, dx = (G.x1 - G.x0) / n;
      for (i = 0; i < n; i++) {
        var py = G.y0 - Math.min(1, Math.max(0, d.I[i]) / E) * (G.y0 - G.y1);
        x.fillStyle = couleurCol(CO.cie(d.l[i])); x.globalAlpha = .6;
        x.fillRect(G.x0 + i * dx, py, Math.max(1, dx + .3), G.y0 - py);
      }
      x.globalAlpha = 1; x.strokeStyle = "#e8ecef"; x.lineWidth = 1.1; x.beginPath();
      for (i = 0; i < n; i++) { var yy = G.y0 - Math.min(1, Math.max(0, d.I[i]) / E) * (G.y0 - G.y1), xx = G.x0 + (i + .5) * dx; if (i) x.lineTo(xx, yy); else x.moveTo(xx, yy); }
      x.stroke();
    }
    function dessinerPhotodiode() { tracePhotodiode(); curseur(" µm", 1); }
    function tracePhotodiode() {
      var G = prepCv(), pd = CAP.pd, c = st.capteur;
      if (!G) return;
      var fen = c.fen || 10, mil = c3Vu, demi = fen / 2000, xa = (mil - demi - (pd ? pd.origine : mil)) * 1000, xb = xa + fen;
      axes(G, xa, xb, TRAD("déplacement du chariot (µm)"), 0, 2, TRAD("I / I moyen"));
      var x = G.x;
      x.strokeStyle = "#2c323b"; x.setLineDash([3, 3]); x.beginPath(); var ym = (G.y0 + G.y1) / 2; x.moveTo(G.x0, ym); x.lineTo(G.x1, ym); x.stroke(); x.setLineDash([]);
      var xc = (G.x0 + G.x1) / 2; x.strokeStyle = "#e8c45a"; x.globalAlpha = .6; x.beginPath(); x.moveTo(xc + .5, G.y0); x.lineTo(xc + .5, G.y1); x.stroke(); x.globalAlpha = 1;
      if (!pd || !pd.bins.size) return;
      if (!(pd.I0 > 0)) { x.fillStyle = "#7f8996"; x.textAlign = "center"; x.fillText(TRAD("pas de lumière sur la photodiode"), xc, (G.y0 + G.y1) / 2); return; }
      var kA = Math.ceil((mil - demi) * 1e5), kB = Math.floor((mil + demi) * 1e5), nb = kB - kA + 1, w = G.x1 - G.x0;
      function Y(v) { return G.y0 - clamp(v / 2, 0, 1) * (G.y0 - G.y1); }
      function X(k) { return G.x0 + (k - kA) / Math.max(1, nb - 1) * w; }
      x.strokeStyle = "#9fb4ff"; x.lineWidth = 1.1;
      if (nb <= 8 * w) {   // assez peu de points : la courbe elle-même
        x.beginPath(); var dans = false;
        for (var k = kA; k <= kB; k++) {
          var v = pd.bins.get(k);
          if (v == null) { dans = false; continue; }
          if (dans) x.lineTo(X(k), Y(v)); else x.moveTo(X(k), Y(v));
          dans = true;
        }
        x.stroke();
      } else {             // sinon, l'enveloppe colonne par colonne (min, max), comme un oscilloscope
        var cols = Math.round(w), pas = Math.max(1, Math.floor(nb / 40000));
        var mn = new Float64Array(cols).fill(Infinity), mxx = new Float64Array(cols).fill(-Infinity);
        for (var kk = kA; kk <= kB; kk += pas) {
          var vv = pd.bins.get(kk);
          if (vv == null) continue;
          var cc = Math.min(cols - 1, Math.floor((kk - kA) / nb * cols));
          if (vv < mn[cc]) mn[cc] = vv; if (vv > mxx[cc]) mxx[cc] = vv;
        }
        x.beginPath();
        for (var q = 0; q < cols; q++) if (mxx[q] > -Infinity) { x.moveTo(G.x0 + q + .5, Y(mn[q]) + .5); x.lineTo(G.x0 + q + .5, Y(mxx[q]) - .5); }
        x.stroke();
      }
    }
    // Photodiode : à chaque image, l'éclairement aux positions du chariot parcourues depuis l'image précédente, une
    // tous les 10 nm (30 points par frange), calculé sur la passe de l'image précédente décalée de δ (au plus 3000
    // points par image : au-delà, un point sur plusieurs). Trace effacée quand autre chose que C₃ change.
    function suivrePhotodiode() {
      var c = st.capteur, cfg = configOptique(st, c3Vu);
      var sig = JSON.stringify(configOptique(st, st.cache.Rc)) + c.x.toFixed(6) + c.y.toFixed(6);
      var pd = CAP.pd;
      if (!pd || pd.sig !== sig) {
        var prep = passeCapteur(cfg, CO, { K: 24 }), v = photodiode(prep, CO, c.x, c.y, 0);
        pd = CAP.pd = { sig: sig, bins: new Map(), origine: c3Vu, I0: v[1], prev: { c3: c3Vu, prep: prep, c0: CO.pointSource(cfg, {}, 0, 0).c0 } };
        if (v[1] > 0) pd.bins.set(Math.round(c3Vu * 1e5), v[0] / v[1]);
        CAP.tDessin = 0; return;
      }
      if (c3Vu === pd.prev.c3) return;
      var c0 = CO.pointSource(cfg, {}, 0, 0).c0, pr = pd.prev, pente = (c0 - pr.c0) / (c3Vu - pr.c3);
      var k0 = Math.round(pr.c3 * 1e5), k1 = Math.round(c3Vu * 1e5), sg = k1 > k0 ? 1 : -1, nb = Math.abs(k1 - k0), pas = Math.max(1, Math.ceil(nb / 3000));
      if (pd.I0 > 0) for (var i = pas; i <= nb; i += pas) {
        var k = k0 + sg * i, w = photodiode(pr.prep, CO, c.x, c.y, (k * 1e-5 - pr.c3) * pente);
        pd.bins.set(k, w[0] / pd.I0);
      }
      pd.prev = { c3: c3Vu, prep: passeCapteur(cfg, CO, { K: 24 }), c0: c0 };
      CAP.tDessin = 0;
    }
    // Barrette, fibre : calcul rapide pendant les gestes (au plus toutes les 120 ms), puis un calcul fin au repos.
    function suivreCapteur() {
      var c = st.capteur;
      if (!c || vue(st) !== "ecran" || !CAP.panneau.ouvert()) return;
      var now = maintenant();
      if (c.type === "photodiode") {
        suivrePhotodiode();
        if (now - CAP.tDessin > 33) { CAP.tDessin = now; dessinerPhotodiode(); }
        return;
      }
      var repos = c3Vu === st.C3 && now - tModif > 300, cfg;
      if (CAP.sale && now - CAP.t > 120) {
        CAP.sale = false; CAP.fin = true; CAP.t = now; cfg = configOptique(st, c3Vu);
        CAP.fenDonnees = fenBarrette().slice();
        CAP.donnees = c.type === "barrette" ? barrette(cfg, CO, c, { K: 8, M: 8, n: pixelsBarrette(true), L: capteurs(st).L, a: CAP.fenDonnees[0] / 1000, b: CAP.fenDonnees[1] / 1000 }) : spectro(cfg, CO, c.x, c.y, { la: fenetre()[0], lb: fenetre()[1], K: 12, res: capteurs(st).res, rf: capteurs(st).rf });
      } else if (CAP.fin && repos && !CAP.sale) {
        CAP.fin = false; cfg = configOptique(st, c3Vu);
        CAP.fenDonnees = fenBarrette().slice();
        CAP.donnees = c.type === "barrette" ? barrette(cfg, CO, c, { K: 16, passes: 3, n: pixelsBarrette(false), L: capteurs(st).L, a: CAP.fenDonnees[0] / 1000, b: CAP.fenDonnees[1] / 1000 }) : spectro(cfg, CO, c.x, c.y, { la: fenetre()[0], lb: fenetre()[1], K: 24, passes: 2, res: capteurs(st).res, rf: capteurs(st).rf });
      } else return;
      if (c.type === "barrette") dessinerBarrette(); else dessinerSpectre();
    }
    // Molette sur l'image (coque : pas accumulés, cible figée) : l'image n'est pas zoomable (affichage du moteur à champ
    // fixe ; un zoom fausserait l'adaptation de l'œil, mesurée sur l'image affichée) ; elle garde donc ses réglages
    // propres. Barrette posée : la tourner, 5° par cran (Maj : 1° ; Ctrl+Maj : 0,1° ; Ctrl : 15°) ; à l'œil : accommoder, 0,1 δ par cran
    // (Maj : 0,02 ; Ctrl+Maj : 0,002 ; Ctrl : 0,5) ; ailleurs rien (la page ne défile pas).
    K.cibleMolette(function (t) {
      if (!t || !t.closest || !cvWrap.contains(t)) return null;
      var c = st.capteur;
      if (c && c.type === "barrette" && t.closest(".pl-capteur-t")) return function (k, ev) {
        var g = surc.querySelector(".pl-capteur-t");
        c.ang = ((c.ang || 0) - k * (ev.shiftKey ? ((ev.ctrlKey || ev.metaKey) ? 0.1 : 1) : ev.ctrlKey ? 15 : 5) + 3600) % 360; if (g) placerCapteur(g, c); CAP.sale = true; K.modifie();
      };
      return function (k, ev) {
        // en accommodation assistée, la molette ne fait rien (l'image ne se zoome pas : un essai de zoom par mégarde ne
        // doit pas faire passer « À la main ») ; l'événement est pris quand même (la page ne défile pas)
        if (vue(st) === "oeil" && modeAcc(st) === "main") { accommoder(st, k, ev); modifie("optique obs"); }
      };
    });

    // ---- œil déplacé latéralement : glisser sur l'image (comme le goniomètre), flèches, double-clic pour recentrer ----
    // Repère du moteur : x vers la droite de l'observateur (côté M₂), y vers le haut ; glisser vers la droite = œil vers la
    // droite. Le décalage reste discret : une ligne sous l'image, seulement quand l'œil n'est pas centré.
    var OE_MAX = 20, OE = { prise: null, info: null };   // mm
    function oeilActif() { return vue(st) === "oeil" && !laserOeil(); }
    function texteOeil() {
      var x = (st.oeilX || 0) * 1000, y = (st.oeilY || 0) * 1000, f = function (v) { return fmtNb(Math.abs(v), 1); }, t = [];
      if (Math.abs(x) >= 0.05) t.push(f(x) + " mm " + (x > 0 ? TRAD("à droite") : TRAD("à gauche")));
      if (Math.abs(y) >= 0.05) t.push(f(y) + " mm " + (y > 0 ? TRAD("vers le haut") : TRAD("vers le bas")));
      return t.length ? TRAD("Œil décalé de {0} (double-clic : recentrer)", [t.join(", ")]) : "";
    }
    function poserOeil(x, y) {
      var d = Math.hypot(x, y);
      if (d > OE_MAX) { x *= OE_MAX / d; y *= OE_MAX / d; }
      st.oeilX = Math.round(x * 100) / 1e5; st.oeilY = Math.round(y * 100) / 1e5;
      if (OE.info) OE.info.textContent = texteOeil();
      modifie("dessin optique");
    }
    cvWrap.addEventListener("pointerdown", function (ev) {
      if (ev.button || !oeilActif()) return;
      OE.prise = { cx: ev.clientX, cy: ev.clientY, bouge: false };
      try { cvWrap.setPointerCapture(ev.pointerId); } catch (e) { /* jsdom */ }
      cvWrap.focus({ preventScroll: true }); ev.preventDefault();
    });
    cvWrap.addEventListener("pointermove", function (ev) {
      var P = OE.prise;
      if (!P || !oeilActif()) return;
      var dx = ev.clientX - P.cx, dy = ev.clientY - P.cy;
      if (!P.bouge && Math.hypot(dx, dy) < 3) return;
      P.bouge = true; P.cx = ev.clientX; P.cy = ev.clientY;
      var k = ev.shiftKey ? ((ev.ctrlKey || ev.metaKey) ? 0.0008 : 0.008) : 0.04;                    // mm par pixel : l'image entière ≈ 18 mm (Maj : 3,5 mm)
      poserOeil((st.oeilX || 0) * 1000 + dx * k, (st.oeilY || 0) * 1000 - dy * k);
    });
    function lacherOeil() { OE.prise = null; }
    cvWrap.addEventListener("pointerup", lacherOeil);
    cvWrap.addEventListener("pointercancel", lacherOeil);
    cvWrap.addEventListener("dblclick", function () { if (oeilActif()) poserOeil(0, 0); });
    // Flèches : actives dans toute la vue à l'œil, quel que soit le focus (sauf saisie dans un champ), pour régler A₁, A₂ à
    // la molette d'une main et déplacer l'œil de l'autre ; un clic sur une vis ne les coupe pas.
    function flecheOeil(ev) {
      var d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[ev.key], t = ev.target;
      if (!d || !oeilActif() || !cvWrap.isConnected || ev.ctrlKey || ev.altKey || ev.metaKey) return;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      ev.preventDefault();
      var k = ev.shiftKey ? 0.1 : 0.5;
      poserOeil((st.oeilX || 0) * 1000 + k * d[0], (st.oeilY || 0) * 1000 + k * d[1]);
    }
    OE.sync = function () { cvWrap.classList.toggle("pl-cv-oeil", oeilActif()); };

    // ---- tête et pied de l'observation ----
    var NOMS_VUE = { ecran: TRAD("Sur l'écran"), oeil: TRAD("À l'œil, à travers l'appareil"), feuille: TRAD("La feuille posée sur M"), iris: TRAD("La face de l'iris, côté appareil") };
    function dessinerObs() {
      var T = K.obsTete, Pd = K.obsPied, v = vue(st);
      T.innerHTML = ""; Pd.innerHTML = "";
      el("span", "pl-obs-t", T, v === "feuille" ? TRAD("La feuille posée sur {0}", [st.feuille === "M1" ? "M₁" : "M₂"]) : NOMS_VUE[v]);
      // Vues en pastilles, comme les récepteurs du banc : le détecteur posé,
      // la face de l'iris, la feuille ; puis Mesurer ▾ (sur l'écran seulement).
      var vues = [["det", st.det === "oeil" ? TRAD("Œil") : TRAD("Écran"), TRAD("<b>{0}</b> — ce que reçoit le détecteur posé au bout du banc de sortie", [(st.det === "oeil" ? TRAD("À l'œil") : TRAD("Sur l'écran"))])]];
      if (irisVisible(st)) vues.push(["iris", TRAD("Face de l'iris"), TRAD("<b>Face de l'iris</b>, côté appareil — la lumière renvoyée par les miroirs revient sur l'iris : son image y est nette quand l'iris est au foyer de la lentille d'entrée (autocollimation)")]);
      if (st.feuille) vues.push(["feuille", TRAD("Feuille"), TRAD("<b>Feuille</b> — la feuille posée sur {0} et les taches de lumière qu'elle reçoit", [st.feuille === "M1" ? "M₁" : "M₂"])]);
      var rv = el("span", "bc-recs", T), vc = v === "feuille" || v === "iris" ? v : "det";
      vues.forEach(function (q) {
        var b = el("button", "", rv, q[1]); b.type = "button"; b.setAttribute("aria-pressed", q[0] === vc ? "true" : "false"); b.setAttribute("data-a3", q[2]);
        b.addEventListener("click", function () { if (st.vue !== q[0]) { st.vue = q[0]; modifie("optique obs"); } });
      });
      var bMes = K.bouton(T, TRAD("Mesurer ▾"), function () {}, "bc-dm-b pl-btn-p");
      bMes.disabled = v !== "ecran";
      bMes.setAttribute("data-a3", v === "ecran" ? TRAD("<b>Mesurer</b> — poser sur l'écran une barrette CCD, une photodiode, la fibre d'un spectromètre")
        : TRAD("<b>Mesurer</b> — sur l'écran seulement (vue « {0} » avec l'écran posé)", [(st.det === "oeil" ? TRAD("Œil") : TRAD("Écran"))]));
      K.deroulant(bMes, function () {
        var c = st.capteur;
        return [["barrette", TRAD("Barrette CCD"), TRAD("profil d'éclairement le long de la barrette")],
          ["photodiode", "Photodiode", TRAD("éclairement en fonction du déplacement du chariot")],
          ["fibre", TRAD("Fibre (spectromètre)"), TRAD("spectre de la lumière en ce point")]].map(function (q) {
          return { lab: q[1], coche: !!(c && c.type === q[0]), a3: "<b>" + q[1] + "</b> — " + q[2], act: function () { poserCapteur(q[0]); } };
        }).concat([{ sep: true }, { lab: TRAD("Retirer le capteur"), dis: !c, act: function () { st.capteur = null; CAP.nouveau(); modifie("obs"); } }]);
      });
      if (laserOeil()) el("span", "pl-alerte", Pd, TRAD("⚠ Laser : ne jamais regarder le faisceau, même à travers l'appareil. L'œil le concentre en un point de la rétine et la brûle, sans douleur et sans retour. Observer sur l'écran."));
      else if (v === "oeil") {
        var ma = modeAcc(st), sg = K.seg(Pd, [["infini", NOM_ACC.infini], ["miroirs", NOM_ACC.miroirs], ["main", NOM_ACC.main]], ma, function (m) {
          if (m === "main") st.acc = accommodation(st);
          st.accMode = m; modifie("optique obs");
        });
        sg.classList.add("pl-acc-mode");
        [["infini", TRAD("l'œil accommode à l'infini (ou sur son image par la lentille de sortie)")], ["miroirs", TRAD("l'œil accommode sur le plan des miroirs (ou sur son image par la lentille de sortie)")],
          ["main", TRAD("l'accommodation se règle au curseur ou à la molette sur l'image")]].forEach(function (q, i) {
          var b = sg.querySelectorAll("button")[i]; if (b) b.setAttribute("data-a3", "<b>" + NOM_ACC[q[0]] + "</b> — " + q[1]);
        });
        if (ma === "main") {
          el("span", "pl-acc-l", Pd, TRAD("près"));
          var s = el("input", "pl-acc", Pd); s.type = "range"; s.min = -ACC_MAX; s.max = 0; s.step = 0.01; s.value = -(st.acc || 0);
          s.setAttribute("aria-label", TRAD("Accommodation de l'œil, de 25 cm à l'infini"));
          s.setAttribute("data-a3", TRAD("<b>Accommodation</b> de l'œil, de 25 cm à l'infini — glisser, ou molette dessus ou sur l'image (Maj : fin · Ctrl+Maj : ultrafin · Ctrl : gros)"));
          s.addEventListener("input", function () { st.acc = -parseFloat(s.value); sale.optique = true; K.modifie(); });
          el("span", "pl-acc-l", Pd, TRAD("loin"));
        } else {
          var hp = accPour(st, ma);
          if (!(hp.u > 0) || hp.acc > ACC_MAX) el("span", "pl-obs-n", Pd, hp.u > 0 ? TRAD("Trop près pour l'œil (moins de 25 cm) : image floue.") : TRAD("Le faisceau converge derrière l'œil : image floue."));
        }
        OE.info = el("span", "pl-obs-n pl-oeil-info", Pd, texteOeil());
      } else if (v === "ecran") el("span", "pl-obs-n", Pd, st.capteur ? TRAD("Glisser le capteur à la souris{0}", [st.capteur.type === "barrette" ? TRAD(" ; molette sur la barrette : la tourner.") : "."]) : "");
      else if (v === "iris") el("span", "pl-obs-n", Pd, TRAD("Au centre, le trou de l'iris ; autour, sur ses lames, la lumière renvoyée par les miroirs."));
      else el("span", "pl-obs-n", Pd, feuilleEntiere(st) ? TRAD("La feuille cache ce miroir : un seul faisceau revient vers la sortie.")
        : TRAD("La feuille cache une partie de ce miroir : derrière son bord, un seul faisceau revient vers la sortie."));
      if (!MOT) el("span", "pl-alerte", Pd, TRAD("Ce navigateur n'a pas WebGL2 : calcul sur le processeur, image grossière."));
      dessinerSurc(); CAP.sync(); OE.sync();
    }

    // ================= loupe sur C3 =================
    var LP = K.loupe;
    LP.setAttribute("viewBox", "0 0 440 150");
    function dessinerLoupe() {
      LP.innerHTML = "";
      var Rr = c3Vu, PXMM = 64, xBord = 262, yRef = 72, s = 8.5;
      var dfs = svg("defs", {}, LP);
      dfs.innerHTML = '<linearGradient id="plTamb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".6"/><stop offset=".28" stop-color="#000" stop-opacity="0"/><stop offset=".72" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".6"/></linearGradient>' +
        '<clipPath id="plLoupeClip"><rect x="4" y="4" width="432" height="128" rx="10"/></clipPath>';
      var g = svg("g", { "clip-path": "url(#plLoupeClip)" }, LP);
      svg("rect", { x: 0, y: 0, width: 440, height: 150, fill: "#0c0e11" }, g);
      // manchon fixe : mm au-dessus de la ligne de référence, demi-mm au-dessous
      svg("rect", { x: 0, y: 30, width: xBord, height: 84, fill: "#a2abb4" }, g);
      svg("rect", { x: 0, y: 30, width: xBord, height: 84, fill: "url(#plTamb)" }, g);
      svg("line", { x1: 0, y1: yRef, x2: xBord, y2: yRef, stroke: "#111", "stroke-width": 1.2 }, g);
      for (var v = Math.floor(Rr - 5); v <= Rr + 1e-9; v += 0.5) {
        var x = xBord - (Rr - v) * PXMM; if (x < 0 || v < 0) continue;
        var entier = Math.abs(v - Math.round(v)) < 1e-6;
        svg("line", { x1: x, y1: yRef, x2: x, y2: entier ? yRef - 15 : yRef + 11, stroke: "#111", "stroke-width": 1.2 }, g);
        if (entier) svg("text", { x: x, y: yRef - 19, class: "pl-loupe-n", "text-anchor": "middle" }, g).textContent = Math.round(v);
      }
      // tambour (tourne) : 50 divisions par tour de 0,5 mm ; la division d est à y = yRef + (f − d) s
      svg("rect", { x: xBord, y: 6, width: 170, height: 132, fill: "#bcc4cc" }, g);
      svg("rect", { x: xBord, y: 6, width: 170, height: 132, fill: "url(#plTamb)" }, g);
      var f = ((Rr / PAS_C3) % 1 + 1) % 1 * 50;
      for (var dv = Math.floor(f) - 9; dv <= Math.floor(f) + 9; dv++) {
        var yy = yRef + (f - dv) * s; if (yy < 8 || yy > 136) continue;
        var dd = ((dv % 50) + 50) % 50, long = dd % 5 === 0;
        svg("line", { x1: xBord, y1: yy, x2: xBord + (long ? 22 : 13), y2: yy, stroke: "#111", "stroke-width": 1 }, g);
        if (long) svg("text", { x: xBord + 26, y: yy + 4, class: "pl-loupe-d" }, g).textContent = dd;
      }
      svg("rect", { x: xBord, y: 6, width: 3, height: 132, fill: "#6f7780" }, g);
      svg("rect", { x: 4, y: 4, width: 432, height: 128, rx: 10, fill: "none", stroke: "#3a414a", "stroke-width": 2 }, LP);
      svg("text", { x: 8, y: 146, class: "pl-loupe-l" }, LP).textContent = TRAD("Loupe sur C₃ : manchon en mm et demi-mm, tambour de 50 divisions (un tour = 0,5 mm)");
    }
    K.lectureVerif(K.lecture, {
      label: TRAD("Lecture de C₃ :"), unite: "mm", exemple: TRAD("ex. 7,385"), aideSaisie: TRAD("Taper une lecture en mm, par exemple 7,385."),
      verifier: function (v) {
        var ecart = Math.round((v - st.C3) * 1000);
        if (Math.abs(ecart) <= 3) return TRAD("Lecture juste.");
        return TRAD("Écart de {0} µm : lecture trop {1}", [Math.abs(ecart), (ecart > 0 ? TRAD("grande.") : TRAD("petite."))]);
      }
    });

    // ================= bandeau du haut, ligne des gestes, bas =================
    // Bandeau de la coque réduit à sa ligne 1 (Faisceau, Réglages ▾ … Cahier, Prof, ?, plein écran) et à la ligne des
    // gestes ; en bas : les étapes, puis « Un indice », son texte (indice ou annonce, deux lignes au plus), « Nouveau
    // dérèglement » et son numéro. Les textes des gestes vivent ici (GESTES, survol), un seul endroit à réécrire.
    var k_ = K.k, BH = K.bandeau(), L1 = BH.l1;
    BH.l2.hidden = true;        // pas d'autre aide en bascule que le faisceau, rangé en ligne 1
    var bLum = K.boutonAide(L1, { cle: "faisceau", nom: TRAD("Faisceau"), lettre: "F", on: st.lumiere,
      titre: TRAD("la lumière à travers l'appareil, à l'échelle des bancs : toute la lumière utile, et le pinceau issu du centre de la source") }, basculerFaisceau);
    function majFaisceau() { bLum.setAttribute("aria-pressed", st.lumiere ? "true" : "false"); }
    function basculerFaisceau() { st.lumiere = !st.lumiere; majFaisceau(); modifie("dessin"); }
    // Œil simulé (avec = luminosité réelle, sans = toujours visible) pour l'écran, l'œil et la feuille ;
    // gardé d'un dérèglement à l'autre, hors annulation.
    K.groupe(L1, TRAD("Œil simulé"), [
      ["reelle", TRAD("avec"), TRAD("<b>Œil simulé : avec</b> — luminosité réelle : réponse à la luminance du champ regardé, pupille, vision de nuit, sans fond de salle ajouté : le noir reste noir ; une figure faible paraît faible, ou ne se voit pas du tout")],
      ["visible", TRAD("sans"), TRAD("<b>Œil simulé : sans</b> — l'image est exposée pour être bien visible, quelle que soit la lumière reçue")]],
      function () { return reelle(st) ? "reelle" : "visible"; }, function (v) { st.luminosite = v; modifie("optique obs"); });
    el("span", "bc-pousse", L1);
    var CA = K.cahier({ fichier: "cahier-michelson.csv", lire: function () { return st.cahier; }, ecrire: function (L) { st.cahier = L; K.modifie(); } });
    var bProf = K.boutonsFin(L1, { cahier: CA, gestes: function () { return GESTES; },
      prof: { lab: TRAD("Prof"), f: function () { PR.panneau.basculer(); }, visible: K.estProf(), a3: TRAD("<b>Mode prof</b> — valeurs cachées, configurations types, projection, réglage à transmettre") } }).prof;

    // ----- ligne des gestes : ce que font la souris et le clavier sur ce que survole le pointeur -----
    var PT = null;      // dernier point du pointeur sur le dessin : zones sans élément (chariot, lames)
    D.addEventListener("mousemove", function (ev) { PT = K.ptSvg(ev); });
    var VIS_FINE = TRAD("glisser : la faire rouler (Maj : dix fois plus fin · Ctrl+Maj : cent fois) · molette : 1/40 de tour par cran (Maj 1/400 · Ctrl+Maj 1/4000 · Ctrl 1/4)");
    var TXT_VIS = {
      C3: TRAD("<b>C₃</b>, vis micrométrique du chariot de M₂ — glisser : la faire rouler (lancée, elle tourne plus vite ; tout doucement, moins vite que la main · Maj : dix fois plus fin · Ctrl+Maj : cent fois) · molette : une division (10 µm) par cran, Maj 1 µm, Ctrl+Maj 0,1 µm, Ctrl 0,1 mm · lecture : loupe sous l'image"),
      C1: TRAD("<b>C₁</b>, vis d'inclinaison de M₂, grossière — glisser : la faire rouler (lancée, elle tourne plus vite) · molette : 1/40 de tour par cran (Ctrl : un tour, pour amener vite les taches l'une sur l'autre) · on affine avec A₁, A₂"),
      A1: TRAD("<b>A₁</b>, vis d'inclinaison de M₁, fine — {0}", [VIS_FINE]),
      B1: TRAD("<b>B₁</b>, vis de la compensatrice : l'oriente — {0}", [VIS_FINE]),
      B2: TRAD("<b>B₂</b>, vis de la compensatrice : règle son excentricité — {0}", [VIS_FINE])
    };
    TXT_VIS.C2 = TXT_VIS.C1.replace("C₁", "C₂"); TXT_VIS.A2 = TXT_VIS.A1.replace("A₁", "A₂");
    // Élément des bancs : glisser, molette et flèches dans le sens de l'écran ; la paire de flèches parallèle au
    // banc déplace, l'autre règle la pastille.
    function texteEl(id) {
      var nm = K.esc(nomEl(id)), b = bancDe(id), R2 = reglage(id);
      if (id === "comp") return TRAD("<b>Compensatrice</b> — clic : la choisir (au bandeau, « Régler la compensatrice ») · B₁ l'oriente, B₂ règle son excentricité");
      if (id === "feuille") return TRAD("<b>Feuille</b> sur {0} — elle cache ce miroir · clic : la choisir (bandeau : sur M₁ · sur M₂, Retirer) · glisser le long du miroir : n'en couvrir qu'une partie · tirer loin du miroir, {1} : la retirer · sa vue : pastille « Feuille » au-dessus de l'image", [(st.feuille === "M1" ? "M₁" : "M₂"), k_(TRAD("Suppr"))]);
      if (id === "lamelle") return TRAD("<b>Lamelle</b> — glisser : son bord le long du miroir · clic : la choisir (bandeau : miroir, épaisseur au palmer, Retirer) · {0} : la retirer", [k_(TRAD("Suppr"))]);
      if (id === "filtre") return TRAD("<b>{0}</b> devant la lampe, sur le porte-dépoli (toutes les lampes) — clic : le choisir, sa couleur au bandeau · clic droit : le remplacer · {1} : le retirer",
        [K.esc(filtre(st) ? majuscule(filtre(st).nom) : TRAD("Filtre")), k_(TRAD("Suppr"))]);
      if (!b) return null;
      var dep = b === "ent" ? k_("↑ ↓") : k_("← →"), reg = b === "ent" ? k_("← →") : k_("↑ ↓");
      var avec = id === "depoli" || id === "iris" ? (porte(st) ? TRAD(" (avec {0} ; contre la lampe, vers l'appareil : il la quitte, loin de l'appareil : il la pousse)", [id === "iris" ? TRAD("le dépoli") : TRAD("l'iris")]) : TRAD(" (avec la lanterne)"))
        : id === "lampe" && porte(st) && st.ent.dep == null ? TRAD(" (avec dépoli et iris, contre elle)") : "";
      if (sels().length > 1 && estSel(id)) avec += sels().length > 2 ? TRAD(" — avec les {0} autres éléments choisis", [sels().length - 1]) : TRAD(" — avec l'autre élément choisi");
      var sens = b === "ent" ? TRAD("molette vers le haut : vers l'appareil") : TRAD("molette vers le haut : vers la droite");
      return TRAD("<b>{0}</b> — glisser, molette, {1} : le long du banc{2} ({3} ; 1 mm par cran, Maj 0,1 · Ctrl+Maj 0,01 · Ctrl 1 cm)", [nm, dep, avec, sens]) +
        (R2 && R2.lab !== "position" && R2.lab.indexOf("position") ? TRAD(" · {0} : {1}", [reg, R2.lab]) : "") +
        TRAD(" · clic droit : {0}", [id === "lampe" || id === "det" ? TRAD("remplacer, position") : TRAD("position, retirer")]) + (id === "det" && st.det === "oeil" ? TRAD(" · l'accommoder, le déplacer de côté : sur l'image") : "");
    }
    function textePast(id) {
      var R2 = reglage(id), nm = K.esc(nomEl(id));
      return R2 ? TRAD("Pastille de <b>{0}</b> — molette ou glisser vertical : {1} ({2} fin · {3} gros) · clic : le choisir", [nm, R2.lab, k_(TRAD("Maj")), k_("Ctrl")])
        : TRAD("Pastille de <b>{0}</b> — clic : le choisir{1} · pas de réglage", [nm, (id === "lampe" ? TRAD(" (au bandeau : changer de lampe)") : "")]);
    }
    function survolDessin(t) {
      var v = t.closest("[data-vis]"); if (v) return TXT_VIS[v.getAttribute("data-vis")];
      var pa = t.closest("[data-past]"); if (pa) return textePast(pa.getAttribute("data-past"));
      var e = t.closest("[data-el]"), s = e && texteEl(e.getAttribute("data-el")); if (s) return s;
      var mi = t.closest("[data-mir]");
      if (mi) return mi.getAttribute("data-mir") === "M1" ? TRAD("<b>Miroir {0}</b> (fixe) — clic droit : poser ou retirer la feuille, la lamelle", ["M₁"])
        : TRAD("<b>Miroir {0}</b> (sur le chariot ; molette : C₃) — clic droit : poser ou retirer la feuille, la lamelle", ["M₂"]);
      var bc = t.closest("[data-banc]");
      if (bc) return bc.getAttribute("data-banc") === "ent" ? TRAD("<b>Banc d'entrée</b> (vertical : lampe en bas, appareil en haut) — clic : plus rien de choisi · clic droit : poser ici")
        : TRAD("<b>Banc de sortie</b> (horizontal : appareil à gauche) — clic : plus rien de choisi · clic droit : poser ici");
      var p = PT;
      if (p) {
        if (Math.abs(p.x) < 34 && p.y > -285 && p.y < posM2() + 4) return TRAD("<b>Chariot de M₂</b> — molette : comme C₃, une division (10 µm) par cran (Maj 1 µm · Ctrl+Maj 0,1 µm · Ctrl 0,1 mm)");
        if (Math.abs(p.y - p.x - 16) / Math.SQRT2 < 5 && Math.abs(p.x + 8) < 24 || (p.x > -42 && p.x < -18 && p.y > 20 && p.y < 36))
          return texteEl("comp");
        if (Math.abs(p.y - p.x) / Math.SQRT2 < 4 && Math.abs(p.x) < 22) return TRAD("<b>Séparatrice</b> — fixe");
      }
      return TRAD("<b>Michelson</b> vu de dessus — clic : plus rien de choisi · vis : glisser ou molette · éléments des bancs : clic pour les choisir, glisser ou molette le long du banc · {0} : tous les gestes", [k_("?")]);
    }
    function survolImage(t) {
      var c = st.capteur, v = vue(st);
      if (t.closest(".pl-capteur-t") && c) return TRAD("<b>{0}</b> — glisser : la déplacer sur l'écran{1}", [{ barrette: TRAD("Barrette CCD"), photodiode: "Photodiode", fibre: TRAD("Fibre du spectromètre") }[c.type],
        (c.type === "barrette" ? TRAD(" · molette : la tourner, 5° par cran (Maj 1° · Ctrl+Maj 0,1° · Ctrl 15°)") : "")]);
      if (laserOeil()) return TRAD("<b>Laser</b> — ne jamais le regarder, même à travers l'appareil : observer sur l'écran");
      if (v === "oeil") return TRAD("<b>Image à l'œil</b> — glisser : déplacer l'œil (Maj : fin · Ctrl+Maj : ultrafin) · molette (« À la main ») : accommoder, vers le haut = plus loin (Maj : fin · Ctrl+Maj : ultrafin · Ctrl : gros) · double-clic : œil recentré · {0} : déplacer l'œil", [k_("← → ↑ ↓")]);
      if (v === "ecran") return TRAD("<b>Image sur l'écran</b> — {0}Mesurer ▾ : y poser une barrette, une photodiode, la fibre d'un spectromètre", [(c ? TRAD("glisser le capteur : le déplacer · ") : "")]);
      if (v === "iris") return TRAD("<b>Face de l'iris</b>, côté appareil — au centre, le trou ; autour, sur ses lames, la lumière renvoyée par les miroirs");
      return TRAD("<b>Feuille</b> — elle cache son miroir : un seul faisceau revient vers la sortie");
    }
    function survol(t) {
      if (D.contains(t)) return survolDessin(t);
      if (cvWrap.contains(t)) return survolImage(t);
      if (t === CAP.cv) return TRAD("<b>Graphe du capteur</b> — pointeur : lire une abscisse · molette : resserrer ou élargir la fenêtre");
      var et = t.closest(".pl-et[data-etape]");
      if (et) { var d = ETAPES.filter(function (x) { return x.id === et.getAttribute("data-etape"); })[0];
        if (d) return TRAD("<b>{0}</b> — coché quand {1} · clic : les indices visent ce réglage ; un second clic : choix automatique", [K.esc(d.nom), K.esc(d.titre || "")]); }
      return null;
    }
    K.gestes({ survol: survol, suivre: function (t) { return D.contains(t); }, defaut: function () {
      if (st.sel && present(st.sel)) return texteEl(st.sel);
      return TRAD("<b>Michelson</b> — rien de choisi : cliquer un élément d'un banc pour le régler ({0} : l'un après l'autre){1} · survoler un organe : ses gestes · {2} : tous les gestes et raccourcis · {3} : annuler",
        [k_("Tab"), (oeilActif() ? TRAD(" · {0} : déplacer l'œil", [k_("← → ↑ ↓")]) : ""), k_("?"), k_(TRAD("Ctrl+Z"))]);
    } });
    LP.setAttribute("data-a3", TRAD("<b>Loupe sur C₃</b> — manchon en mm et demi-mm, tambour de 50 divisions (un tour = 0,5 mm) : lire, taper la lecture, puis « Vérifier ma lecture »"));
    K.lecture.setAttribute("data-a3", TRAD("<b>Lecture de C₃</b> — taper la lecture en mm (ex. 7,385), puis Entrée ou « Vérifier ma lecture » : jamais la valeur, seulement l'écart"));
    // Panneau « ? » (bouton et touche), rangé par zone : les mêmes textes que la ligne des gestes.
    var GESTES = {
      [TRAD("Appareil")]: [[TRAD("vis : glisser"), TRAD("la faire rouler (Maj : dix fois plus fin · Ctrl+Maj : cent fois) ; C₁, C₂ grossières, sans Maj (lancées, elles tournent plus vite), A₁, A₂ fines")],
        [TRAD("vis : molette"), TRAD("1/40 de tour par cran (Maj 1/400 · Ctrl+Maj 1/4000 · Ctrl 1/4) (C₁, C₂ : Ctrl = un tour) ; C₃ et tout le chariot : une division (10 µm), Maj 1 µm, Ctrl+Maj 0,1 µm, Ctrl 0,1 mm")],
        [TRAD("lamelle"), TRAD("glisser : son bord le long du miroir")], [TRAD("clic sur la compensatrice"), TRAD("la choisir ; au bandeau, « Régler la compensatrice » : mise parallèle à la séparatrice, l'étape 1 sautée")],
        [TRAD("clic droit sur M₁, M₂"), TRAD("poser ou retirer la feuille, la lamelle")], [TRAD("clic ailleurs sur l'appareil, sur une vis"), TRAD("plus rien de choisi")]],
      [TRAD("Bancs")]: [[TRAD("clic"), TRAD("choisir l'élément (cavalier doré, bandeau sous les bancs) ; sur le fond : plus rien de choisi")],
        [TRAD("glisser un élément"), TRAD("le long de son banc (la lampe emporte dépoli et iris ; Maj : dix fois plus fin) ; lâché hors du banc, il reste au bout du banc")],
        [TRAD("molette sur un élément"), TRAD("1 mm par cran (Maj 0,1 mm · Ctrl+Maj 0,01 mm · Ctrl 1 cm), dans le sens de l'écran : entrée, vers le haut = vers l'appareil ; sortie, vers le haut = vers la droite")],
        [TRAD("pastille"), TRAD("molette ou glisser vertical : son réglage (iris : diamètre ; lanterne : tirage du condenseur ; lentilles, écran : position ; œil : accommodation ; Maj : fin · Ctrl : gros) ; clic : choisir l'élément")],
        [TRAD("bandeau"), TRAD("◂ ▸ : déplacer ; clic sur la position : la taper, en cm ; lampe, détecteur : en changer ; Retirer")],
        [TRAD("clic droit"), TRAD("sur un élément : Remplacer par, Position…, Retirer ; sur un banc : Poser ici")],
        [TRAD("Faisceau"), TRAD("la lumière à l'échelle des bancs")]],
      [TRAD("Étagère")]: [[TRAD("carte : clic"), TRAD("poser ou retirer l'élément (un seul de chaque ; carte surlignée : posé) ; une source remplace la source, l'écran et l'œil se remplacent ; feuille, lamelle : posées sur M₂ (au bandeau : sur M₁ · sur M₂)")],
        [TRAD("carte : glisser"), TRAD("sur son banc : la poser où on la lâche (une source sur le banc d'entrée : remplace la lampe) ; feuille, lamelle : sur un miroir ; ailleurs : rien")],
        [TRAD("onglets"), TRAD("Sources · Entrée · Sortie · Accessoires")], [TRAD("clic droit sur une lentille"), TRAD("Remplacer par l'autre lentille du banc (même position)")],
        [TRAD("carte Filtre"), TRAD("devant la lampe, sur le porte-dépoli : un seul à la fois, pour toutes les lampes ; sa couleur (rouge, vert, bleu, interférentiel) au bandeau ou par clic droit")]],
      [TRAD("Image")]: [[TRAD("vues"), TRAD("pastilles au-dessus de l'image : le détecteur, la face de l'iris, la feuille")], [TRAD("à l'œil : glisser"), TRAD("déplacer l'œil (Maj : fin · Ctrl+Maj : ultrafin)")],
        [TRAD("à l'œil : sous l'image"), TRAD("« À l'infini » ou « Sur les miroirs » : l'œil accommode seul sur ce plan ; « À la main » : curseur")],
        [TRAD("à l'œil : molette"), TRAD("« À la main » seulement : accommoder, vers le haut = plus loin (Maj : fin · Ctrl+Maj : ultrafin · Ctrl : gros)")], [TRAD("à l'œil : double-clic"), TRAD("œil recentré")],
        [TRAD("Mesurer ▾"), TRAD("sur l'écran : barrette, photodiode, fibre ; glisser le capteur : le déplacer ; molette sur la barrette : la tourner ; × de la fenêtre Capteur : retirer le capteur")],
        [TRAD("graphe du capteur"), TRAD("molette : resserrer ou élargir la fenêtre ; « Capteur réel » : barrette de 2,9 cm, spectromètre de 1,5 nm (le parfait est plus long, et sépare le doublet du sodium)")], [TRAD("loupe de C₃"), TRAD("lire le manchon et le tambour, taper la lecture, « Vérifier ma lecture »")],
        [TRAD("étapes"), TRAD("clic : les indices visent cette étape ; un second clic : choix automatique")], [TRAD("Un indice"), TRAD("ce qu'il faut regarder, et pourquoi ; un second clic : l'organe et le sens du geste ; jamais de valeur")]],
      [TRAD("Clavier")]: [[TRAD("↑ ↓ (entrée)"), TRAD("déplacer l'élément choisi (↑ = vers l'appareil) ; ← → : son réglage (→ = comme la molette vers le haut)")],
        [TRAD("← → (sortie)"), TRAD("déplacer l'élément choisi (→ = loin de l'appareil) ; ↑ ↓ : son réglage")],
        [TRAD("flèches, rien de choisi"), TRAD("à l'œil : déplacer l'œil (Maj : fin), même pendant la molette sur A₁, A₂")],
        [TRAD("Tab, Maj+Tab"), TRAD("l'élément suivant, précédent, dans l'ordre de la lumière")], [TRAD("Suppr"), TRAD("retirer l'élément choisi (ni la lampe, ni le détecteur)")],
        ["F", TRAD("aide « Faisceau »")], ["?", TRAD("ce panneau")], [TRAD("Échap"), TRAD("fermer ce panneau ou un menu, puis plus rien de choisi")], [TRAD("Ctrl+Z, Ctrl+Maj+Z"), TRAD("annuler, rétablir (un glisser ou un tour de molette d'un coup ; le cahier n'est jamais annulé)")]]
    };
    // Touches F (faisceau) et ? (panneau), où qu'en soit le focus, sauf dans un champ.
    function toucheBandeau(ev) {
      var t = ev.target;
      if (!K.racine.isConnected || ev.ctrlKey || ev.altKey || ev.metaKey) return;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      if (ev.key === "?") K.panneauGestes(GESTES);
      else if (ev.key === "f" || ev.key === "F") basculerFaisceau();
      else return;
      ev.preventDefault();
    }
    document.addEventListener("keydown", toucheBandeau);

    var aideIndice = null, tAnnonce = null;
    function montrerAide() {
      K.aide.innerHTML = "";
      if (!aideIndice) return;
      el("b", "", K.aide, TRAD("Indice : "));
      K.aide.appendChild(document.createTextNode(aideIndice.t1));
      if (aideIndice.niveau === 2 && aideIndice.t2) { K.aide.appendChild(document.createTextNode(" ")); el("span", "pl-ind2", K.aide).textContent = aideIndice.t2; }
    }
    function annoncer(t) {
      K.aide.innerHTML = ""; el("span", "pl-annonce", K.aide).textContent = t;
      if (tAnnonce) clearTimeout(tAnnonce);
      tAnnonce = setTimeout(function () { tAnnonce = null; montrerAide(); }, 4500);
    }
    montrerAide();
    // Étape choisie (st.vise) : clic sur sa puce, un second clic rend la main au choix automatique ; elle revient
    // aussi au choix automatique quand elle est soignée (atteinte, pour une étape sans niveau « soigné »).
    var RE = K.etapes(ETAPES, function (id) {
      st.vise = st.vise === id ? null : id;
      aideIndice = null; montrerAide(); bInd.innerHTML = TRAD("Un indice");
      majEtapes(); K.modifie();
    }), dernier = null;
    // Manipulations (panneau de la coque, bouton au bout de la rangée) : la manipulation ouverte est celle que visent les
    // indices (st.vise) ; constats dans st.etapes ; situations à poser au mode prof.
    var MP = K.manipulations(MANIPS, { choisir: function (id) {
        st.vise = st.vise === id ? null : id;
        aideIndice = null; montrerAide(); bInd.innerHTML = TRAD("Un indice");
        majEtapes(); K.modifie();
      },
      intro: TRAD("Ce qu'un Michelson réglé permet de voir, dans l'ordre qu'on veut. Ouvrir une manipulation : « Un indice » aide alors sur elle. La case se coche quand on a vu le phénomène."),
      a3: TRAD("<b>Manipulations</b> — ce que montre un Michelson, un phénomène à la fois : ce qu'on observe, comment faire ; la case se coche quand on l'a vu") });
    function majEtapes() {
      RE.maj(st.etapes, cible(st.etapes, st.vise), st.vise);
      var vus = {}; MANIPS.forEach(function (x) { vus[x.id] = atteinte(st.etapes[x.id]); });
      MP.maj(vus, st.vise);
    }
    // Une analyse : étapes atteintes cochées, soignées étoilées (jamais décochées, sauf la compensatrice déréglée), dans n'importe quel ordre ;
    // anticoïncidences du doublet gardées.
    function analyser() {
      var R;
      try { R = analyse(st, CO); } catch (e) { return null; }
      dernier = R;
      var neuf = [], soin = [], vus = [];
      // Compensatrice et parallélisme grossier perdus (état de nouveau hors du seuil « atteint ») : décochés ; le
      // parallélisme fin et le contact restent acquis (on incline exprès un miroir pour le coin d'air, la lumière blanche)
      ["comp", "grossier"].forEach(function (id) { if (!R.ok[id] && st.etapes[id]) delete st.etapes[id]; });
      ETAPES.forEach(function (d) {
        var f = st.etapes[d.id];
        if (R.top[d.id] && f !== "soignee") { st.etapes[d.id] = "soignee"; soin.push(d.nom); }
        else if (R.ok[d.id] && !atteinte(f)) { st.etapes[d.id] = true; neuf.push(d.nom); }
      });
      MANIPS.forEach(function (d) { if (R.ok[d.id] && !atteinte(st.etapes[d.id])) { st.etapes[d.id] = true; vus.push(d.nom); } });
      // doublet : une anticoïncidence vue (gardée), puis des anneaux du sodium de nouveau contrastés à au moins 0,1 mm de
      // chariot d'elle (coïncidence suivante à λ²/4Δλ ≈ 0,145 mm)
      var c = Math.round(st.C3 * 100) / 100;
      if (R.anti && !st.anti.some(function (a) { return Math.abs(a - c) < 0.1; })) st.anti.push(c);
      if (!atteinte(st.etapes.doublet) && st.lampe === "na" && R.vu.anneaux && R.m && R.m.V > 0.5 &&
          st.anti.some(function (a) { return Math.abs(a - st.C3) >= 0.1; })) { st.etapes.doublet = true; vus.push(nomEtape("doublet")); }
      var fini = st.vise && ETAPES.some(function (d) { return d.id === st.vise && (d.soin ? st.etapes[d.id] === "soignee" : atteinte(st.etapes[d.id])); });
      if (fini) st.vise = null;
      if (neuf.length || soin.length || vus.length) {
        annoncer([neuf.length ? TRAD("Réglage atteint : {0}.", [neuf.join(", ")]) : "", soin.length ? TRAD("Réglage soigné : {0}.", [soin.join(", ")]) : "",
          vus.length ? TRAD("Manipulation : {0}.", [vus.join(", ")]) : ""].filter(Boolean).join(" "));
        K.modifie();
      }
      majEtapes();
      if (PR.panneau.ouvert()) PR.maj();
      return R;
    }
    var A = K.actions;
    // Indice gradué (bouton « Un indice ») : un second clic sur le même indice donne l'organe et le sens du geste. Un
    // symptôme du montage (I.sym) revenu après deux indices : le montage de référence à la place (`o.recours`).
    var suivi = { sym: null, n: 0 };
    function donnerIndice() {
      var R = analyser() || dernier;
      if (!R) return;
      var I = indice(st, CO, R, st.etapes, st.vise);
      var deux = aideIndice && aideIndice.cle === I.cle && aideIndice.niveau === 1 && I.t2;
      if (!deux && I.sym && suivi.sym === I.sym && suivi.n >= 2) I = indice(st, CO, R, st.etapes, st.vise, { recours: true });
      deux = aideIndice && aideIndice.cle === I.cle && aideIndice.niveau === 1 && I.t2;
      if (!deux) suivi = I.sym ? { sym: I.sym, n: suivi.sym === I.sym ? suivi.n + 1 : 1 } : { sym: null, n: 0 };
      var n = deux ? 2 : 1;
      aideIndice = { cle: I.cle, t1: I.t1, t2: I.t2, niveau: n };
      if (tAnnonce) { clearTimeout(tAnnonce); tAnnonce = null; }
      montrerAide();
      bInd.innerHTML = n === 1 && I.t2 ? TRAD("Préciser l'indice") : TRAD("Un indice");
    }
    var bInd = K.bouton(K.aide.parentNode, TRAD("Un indice"), donnerIndice, "pl-btn-ind");
    K.aide.parentNode.insertBefore(bInd, K.aide);        // en tête de la ligne, devant son texte
    bInd.setAttribute("data-a3", TRAD("<b>Un indice</b> — ce qu'il faut regarder, et pourquoi, d'après ce qu'on voit ; un second clic : l'organe et le sens du geste · jamais de valeur"));
    var bNouv = K.bouton(A, TRAD("Nouveau dérèglement"), function () {
      if (!bNouv.classList.contains("confirme")) {
        bNouv.classList.add("confirme"); bNouv.innerHTML = TRAD("Confirmer : l'appareil et les étapes repartent de zéro");
        setTimeout(function () { bNouv.classList.remove("confirme"); bNouv.innerHTML = TRAD("Nouveau dérèglement"); }, 3500);
        return;
      }
      bNouv.classList.remove("confirme"); bNouv.innerHTML = TRAD("Nouveau dérèglement");
      nouveau(1 + Math.floor(Math.random() * 99998));
    });
    bNouv.setAttribute("data-a3", TRAD("<b>Nouveau dérèglement</b> — un autre appareil à régler (deux clics : on confirme) ; le cahier de mesures est gardé"));
    var gr = el("span", "pl-graine", A);
    function dessinerGraine() {
      gr.innerHTML = "";
      var b = el("button", "pl-graine-b", gr, TRAD("n° {0}", [st.graine])); b.type = "button";
      b.setAttribute("data-a3", TRAD("<b>Numéro du dérèglement</b> — à donner au professeur · clic : en taper un autre (Entrée)"));
      b.addEventListener("click", function () {
        gr.innerHTML = "";
        var i = el("input", "pl-graine-in", gr); i.type = "text"; i.inputMode = "numeric"; i.value = st.graine; i.setAttribute("aria-label", TRAD("Numéro du dérèglement"));
        i.addEventListener("keydown", function (ev) {
          ev.stopPropagation();
          if (ev.key === "Enter") { var n = parseInt(i.value, 10); if (n > 0) nouveau(n); else dessinerGraine(); }
          if (ev.key === "Escape") dessinerGraine();
        });
        i.addEventListener("blur", function () { setTimeout(dessinerGraine, 150); });
        i.focus(); i.select();
      });
    }
    function nouveau(graine) {
      var cah = st.cahier, lum = st.lumiere, cap = st.capteur, lu = st.luminosite, pu = st.pupille;
      st = etatDepart(graine, false); st.cahier = cah; st.lumiere = lum; st.capteur = cap; st.luminosite = lu; st.pupille = pu; completer();
      c3Vu = st.C3; c0Prec = null; aideIndice = null; montrerAide(); bInd.innerHTML = TRAD("Un indice");
      lecteur.effacer();
      Object.keys(V).forEach(function (k) { V[k].dessiner(); });
      dessinerGraine(); majEtapes();
      modifie("dessin optique loupe obs etagere");
      K.sauverMaintenant(); if (K.oublierAnnulations) K.oublierAnnulations();
    }
    var lecteur = { effacer: function () { var i = K.lecture.querySelector("input"), v = K.lecture.querySelector(".pl-lect-verdict"); if (i) i.value = ""; if (v) v.textContent = ""; } };
    dessinerGraine(); majEtapes();

    // ================= mode prof : valeurs cachées, configurations types =================
    var PR = { panneau: K.panneau("pl-prof", TRAD("Mode prof : valeurs cachées"), { coin: "bas-droite" }) };
    (function () {
      var C = PR.panneau.corps, vals = el("div", "pl-prof-v", C);
      el("p", "pl-prof-t", C, TRAD("Configurations types (le dérèglement caché est gardé) :"));
      var cf = el("div", "pl-prof-cf", C);
      CONFIGS.forEach(function (c) {
        if (!c.manip) K.bouton(cf, c.nom, function () { c.f(st); rafraichir(); }, "pl-btn-p");
      });
      el("p", "pl-prof-t", C, TRAD("Situations des manipulations (la manipulation s'ouvre) :"));
      var cm = el("div", "pl-prof-cf", C);
      CONFIGS.forEach(function (c) {
        if (c.manip) K.bouton(cm, c.nom, function () { c.f(st); st.vise = c.id; aideIndice = null; montrerAide(); bInd.innerHTML = TRAD("Un indice"); rafraichir(); majEtapes(); }, "pl-btn-p");
      });
      var ef = el("div", "pl-prof-cf", C);
      K.bouton(ef, TRAD("Effacer les étapes"), function () { st.etapes = {}; st.anti = []; st.vise = null; majEtapes(); K.modifie(); PR.maj(); }, "pl-btn-p");
      // qualité pendant les gestes (réglage du poste) et cadence mesurée
      el("p", "pl-prof-t", C, TRAD("Qualité de l'image pendant les gestes (ce poste) :"));
      var gq = el("div", "pl-prof-cf", C), bq = {};
      Object.keys(GESTE).forEach(function (q) {
        bq[q] = K.bouton(gq, GESTE[q].nom, function () {
          gesteQ = q; try { root.localStorage.setItem(CLE_GESTE, q); } catch (e) { /* stockage absent */ }
          Object.keys(bq).forEach(function (k) { bq[k].setAttribute("aria-pressed", k === q ? "true" : "false"); });
          CAD.ips = 0; modifie("optique"); PR.maj();
        }, "pl-btn-p");
        bq[q].setAttribute("aria-pressed", q === gesteQ ? "true" : "false");
        bq[q].title = TRAD("{0} × {0} pixels, points sources × {1}", [GESTE[q].res, fmtNb(GESTE[q].k, 1)]);
      });
      // réglage complet (état sans le cahier) en JSON, pour le transmettre tel quel et le recharger ailleurs
      var rg = el("div", "pl-prof-cf", C), zone = null, msg = null;
      function montrerZone(txt) {
        if (!zone) { zone = el("textarea", "pl-prof-etat", C); zone.spellcheck = false; zone.placeholder = TRAD("Coller ici un réglage copié, puis « Charger »."); }
        zone.hidden = false; if (txt != null) { zone.value = txt; zone.focus(); zone.select(); } else { zone.value = ""; zone.focus(); }
      }
      var tMsg = null;
      function dire(t) {   // le message s'efface seul au bout de 2 s
        if (!msg) msg = el("span", "pl-prof-msg", rg); msg.textContent = t;
        clearTimeout(tMsg); tMsg = setTimeout(function () { msg.textContent = ""; }, 2000);
      }
      function texteEtat() {
        var o = {}; Object.keys(st).forEach(function (k) { if (k !== "cahier") o[k] = st[k]; });
        o.c3Vu = c3Vu;
        return "michelson-etat " + JSON.stringify(o);
      }
      function chargerTexte(txt) {
        var t = String(txt || "").trim().replace(/^michelson-etat\s*/, ""), o = null;
        try { o = JSON.parse(t); } catch (e) {}
        if (!o || o.v !== 1 || !o.cache || !o.ent || !o.sor) return false;
        delete o.c3Vu; o.cahier = st.cahier; st = o; completer();
        c3Vu = st.C3; c0Prec = null; aideIndice = null; montrerAide(); bInd.innerHTML = TRAD("Un indice"); lecteur.effacer();
        Object.keys(V).forEach(function (k) { V[k].dessiner(); });
        dessinerGraine(); majEtapes(); rafraichir(); K.sauverMaintenant(); analyser(); PR.maj();
        if (K.oublierAnnulations) K.oublierAnnulations();
        return true;
      }
      PR.texteEtat = texteEtat; PR.charger = chargerTexte;
      K.bouton(rg, TRAD("Copier le réglage actuel"), function () {
        var txt = texteEtat();
        var ok = function () { dire(TRAD("copié dans le presse-papier")); }, ko = function () { montrerZone(txt); dire(TRAD("Ctrl+C pour copier")); };
        try { if (root.navigator && root.navigator.clipboard && root.isSecureContext) root.navigator.clipboard.writeText(txt).then(ok, ko); else ko(); } catch (e) { ko(); }
      }, "pl-btn-p");
      K.bouton(rg, TRAD("Coller un réglage…"), function () { montrerZone(null); dire(""); }, "pl-btn-p");
      K.bouton(rg, TRAD("Charger"), function () {
        if (!chargerTexte(zone ? zone.value : "")) { dire(TRAD("réglage illisible")); return; }
        zone.hidden = true; dire(TRAD("réglage chargé"));
      }, "pl-btn-p");
      function f(v, n) { return fmtNb(v, n); }
      function g3(v) { return nb(v.toPrecision(3)); }
      PR.lignes = function () {
        var e = epaisseur(st), a = inclinaison(st), B = compensatrice(st), v = CO.VERRES[VERRE_LAMELLE], l = 570e-9;
        var n = CO.indice(VERRE_LAMELLE, 570), ng = n + 2 * v.B / (l * l), ep = epLamelle(st), R = dernier, m = R && R.m, G = R && R.G;
        var L = [
          [TRAD("e (lame d'air)"), f(e * 1e6, 1) + " µm"],
          [TRAD("α (coin d'air)"), f(Math.hypot(a.ax, a.ay) * 1e6, 1) + " µrad  (αx " + f(a.ax * 1e6, 1) + ", αy " + f(a.ay * 1e6, 1) + ")"],
          [TRAD("Compensatrice"), "B₁ " + f(B.b1 * 1e3, 2) + " mrad, B₂ " + f(B.b2 * 1e3, 2) + " mrad"],
          [TRAD("Lecture du contact"), TRAD("{0} mm  (C₃ : {1} mm)", [f(st.cache.Rc, 3), f(st.C3, 4)])],
          [TRAD("Lamelle"), TRAD("ε {0} µm ; (n−1)ε {1} µm, (n_g−1)ε {2} µm (D 263 M, 570 nm)", [f(ep * 1e6, 0), f((n - 1) * ep * 1e6, 1), f((ng - 1) * ep * 1e6, 1)])],
          [TRAD("Anticoïncidences vues"), st.anti.length ? st.anti.map(function (x) { return f(x, 2); }).join(" ; ") + " mm" : TRAD("aucune")]
        ];
        if (G) L.push([TRAD("Observation"), TRAD("plan {0} ({1}), entrée {2}, θs {3} mrad, 2α {4}, fantôme {5} mrad", [({ infini: TRAD("infini"), miroirs: TRAD("miroirs"), autre: TRAD("autre") })[G.plan] || G.plan, (Math.abs(G.zo) < 100 ? f(G.zo * 100, 1) + " cm" : "∞"),
          (G.collimate ? TRAD("collimatée") : TRAD("non collimatée")), f(G.thetaS * 1e3, 2), f(G.sep * 1e3, 2), f(G.fantome * 1e3, 2)])]);
        if (m) L.push([TRAD("Mesure du champ"), TRAD("V {0} (max {1}), éclairé {2} %, {3} franges, courbure {4}, circularité {5}{6}", [f(m.V, 2), f(m.Vmax, 2), Math.round(m.part * 100),
          f(m.nfr, 1), f(m.quad, 2), f(m.ratio, 2), (m.centreDedans ? TRAD(", centre dans le champ") : "")])]);
        var VS = MOT ? MOT.stats.vision : CPU && CPU.vision, vv = vue(st) === "feuille" ? FEU : VS;
        // le niveau AFFICHÉ est celui de l'œil à cet instant ; la cible entre parenthèses pendant qu'il la rejoint (la
        // feuille et le « toujours visible » restent stationnaires : rien à annoncer)
        var laAff = reelle(st) && vue(st) !== "feuille" && (MOT ? MOT.stats.adaptLa : CPU && CPU.adaptLa);
        var relaxe = reelle(st) && vv && vv === VS && (MOT ? MOT.relax : !!(SUIVI_CPU && VS && SUIVI_CPU.enRelax(VS.La)));
        L.push([TRAD("Œil"), (reelle(st) ? TRAD("luminosité réelle") : TRAD("toujours visible")) + (vv ? TRAD(", adapté à {0}{1} cd/m², pupille {2} mm, le plus clair {3} cd/m² (seuil {4}){5}",
          [g3(laAff || vv.La), (relaxe ? TRAD(" (vers {0})", [g3(vv.La)]) : ""), f(vv.D, 1), g3(vv.haut), g3(vv.seuil), (vv.visible ? "" : TRAD(", trop peu de lumière"))]) : "")
          + (vue(st) === "oeil" ? TRAD(", pupille tracée {0} mm", [f(pupilleDe(st), 2)]) : "")]);
        L.push([TRAD("Pendant les gestes"), GESTE[gesteQ].nom + " (" + GESTE[gesteQ].res + " px)" + (CAD.ips ? TRAD(", {0} images/s au dernier geste", [Math.round(CAD.ips)]) : TRAD(", cadence : faire un geste"))]);
        if (R) L.push([TRAD("Atteint en ce moment"), ETAPES.filter(function (d) { return R.ok[d.id] || R.top[d.id]; }).map(function (d) { return d.nom + (R.top[d.id] ? " ★" : ""); }).join(", ") || TRAD("rien")]);
        return L;
      };
      PR.maj = function () {
        var L = PR.lignes();
        vals.innerHTML = "";
        L.forEach(function (x) { var r = el("div", "pl-prof-l", vals); el("span", "pl-prof-k", r, x[0]); el("span", "pl-prof-x", r).textContent = x[1]; });
      };
      PR.panneau.surBascule = function (o) { bProf.setAttribute("aria-pressed", o ? "true" : "false"); if (o) { analyser(); PR.maj(); } };
    })();
    function rafraichir() {
      c3Vu = st.C3; c0Prec = null;
      Object.keys(sale).forEach(function (k) { sale[k] = true; });
      Object.keys(V).forEach(function (k) { V[k].dessiner(); });
      aSale = true; tModif = 0; majFaisceau();
      K.modifie();
    }

    // ================= boucle =================
    function suivreC3() {
      var now = root.performance ? root.performance.now() : Date.now(), dt = tC3 ? Math.min(0.1, (now - tC3) / 1000) : 1 / 60;
      tC3 = now;
      if (c3Vu === st.C3) return;
      c3Vu += (st.C3 - c3Vu) * (1 - Math.exp(-dt / TAU_C3));
      if (Math.abs(st.C3 - c3Vu) < 2e-6) c3Vu = st.C3;            // 2 nm : fin du mouvement
      V.C3.dessiner(); sale.dessin = sale.loupe = sale.optique = true; CAP.sale = true;
    }
    // Pupille stationnaire de l'œil posé (comme `suivrePupille` du banc) : celle que mesure le moteur sur
    // l'image (stats.vision.D) remplace la pupille tracée si elle s'en écarte de plus de 5 %, et l'image repart
    // (luminance rétinienne et pupille dépendent l'une de l'autre) ; au plus 6 relances par geste de l'élève.
    function suivrePupille() {
      var VS = MOT ? MOT.stats.vision : CPU && CPU.vision;
      if (!VS || vue(st) !== "oeil" || !(VS.D > 0) || VS.pupTracee !== pupilleDe(st)) return;
      if (Math.abs(VS.D - pupilleDe(st)) <= 0.05 * pupilleDe(st) || nPup >= 6) return;
      st.pupille = Math.round(100 * VS.D) / 100; nPup++;
      sale.optique = sale.dessin = true; aSale = true; tModif = maintenant(); CAP.sale = true;
    }
    var nTick = 0;
    function tick() {
      suivreC3();
      if (++nTick % 60 === 0) bProf.hidden = !K.estProf();
      if (sale.dessin) { sale.dessin = false; dessinerMobile(); }
      if (sale.etagere) { sale.etagere = false; sale.band = false; ETG.dessiner(); majBandeau(true); K.majGestes(); } else if (sale.band) { sale.band = false; majBandeau(false); }
      if (sale.loupe) { sale.loupe = false; dessinerLoupe(); }
      if (sale.obs) { sale.obs = false; dessinerObs(); }
      if (sale.optique) {
        sale.optique = false;
        try { sombreVu = vue(st) === "ecran" && !assezDeLumiere(st, CO, c3Vu); } catch (e) { sombreVu = false; }
        montrerCanvas();
        if (vue2D()) dessiner2D();
        else if (MOT) {
          // flou de mouvement : δ au centre balayé depuis l'image précédente (geste continu seulement)
          var cfg = configOptique(st, c3Vu), now = root.performance ? root.performance.now() : Date.now(), aff = affichage(st, BAL);
          var c0 = deltaCentre(cfg, aff, CO);
          var pose = c0Prec != null && now - tOpt < 100 ? Math.abs(c0 - c0Prec) : 0;
          c0Prec = c0; tOpt = now;
          MOT.demander(cfg, aff, { pose: pose });
        }
        else if (CPU) { CPU.acc = new Float64Array(CPU.res * CPU.res * 3); CPU.n = 0; }
      }
      if (!vue2D()) { if (MOT) { if (MOT.tick() && MOT.etat === "apercu") noterApercu(); } else if (CPU) cpuPas(); }
      suivrePupille();
      suivreCapteur();
      if (aSale && c3Vu === st.C3 && maintenant() - tModif > 300) { aSale = false; analyser(); }
    }
    function redim(S) {
      cvWrap.style.width = cvWrap.style.height = S + "px";
      LP.style.width = S + "px";
    }
    return {
      tick: tick, redim: redim,
      capturer: function () { return st; },
      // Annuler (coque) : les réglages du Michelson, sans ce qui ne s'annule pas (cahier, lumière, capteurs réels) ni
      // ce qu'`analyser` écrit seul (étapes, anticoïncidences, étape visée) : gardé, il ferait une fausse étape.
      // Le chariot repart de là où il est et glisse vers la position restaurée. Un autre dérèglement vide la pile.
      etatAnnulable: function () {
        var o = {}, k; for (k in st) if (SANS_ANNULER.indexOf(k) < 0) o[k] = st[k];
        return o;
      },
      restaurer: function (o) {
        if (!o || o.graine !== st.graine) return;
        var k, c3 = c3Vu; for (k in st) if (SANS_ANNULER.indexOf(k) < 0) delete st[k];
        for (k in o) if (SANS_ANNULER.indexOf(k) < 0) st[k] = JSON.parse(JSON.stringify(o[k]));
        completer(); aideIndice = null; montrerAide(); bInd.innerHTML = TRAD("Un indice");
        CAP.nouveau(); rafraichir(); c3Vu = c3; PR.maj();
      },
      reservePied: 176,      // place gardée au pied (texte de l'œil décalé, curseur…) : la taille de l'image, donc la largeur de la colonne, n'en dépend plus
      stop: function () {
        document.removeEventListener("keydown", toucheElements);
        root.removeEventListener("pointermove", priseMove); root.removeEventListener("pointerup", priseUp); root.removeEventListener("pointercancel", priseUp); document.removeEventListener("keydown", toucheBandeau);
        if (MOT && MOT.rendu && MOT.rendu.gl) { try { var x = MOT.rendu.gl.getExtension("WEBGL_lose_context"); if (x) x.loseContext(); } catch (e) {} }
      },
      _etat: function () { return st; }, _moteur: MOT, _analyser: analyser, _cahier: CA, _capteur: CAP, _oeil: OE, _cv: cvWrap,
      // après une modification directe de l'état (captures, mode prof) : tout redessiner, sans animation
      _rafraichir: function () { completer(); rafraichir(); }
    };
  }

  P.instruments.michelson = { creer: creer, modele: Michelson };
})(typeof window !== "undefined" ? window : this);
