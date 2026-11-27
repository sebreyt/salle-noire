// © 2026 Sébastien Reyt — licence GPLv3 (code) : réutilisation et modification libres, en citant l'auteur, tout dérivé restant sous la même licence. https://www.gnu.org/licenses/gpl-3.0.html — textes, figures et pages : CC BY-NC-SA 4.0.
// Code écrit par Claude (Anthropic), un assistant d'IA, à partir des choix physiques et pédagogiques de l'auteur.
/* Instrument « goniometre » de la coque paillasse (_app-paillasse.js).
 * Moteur : _app-goniometre-coeur.js, qui prend son module couleur à _app-michelson-coeur.js :
 * les deux chargés avant ce fichier.
 *
 * 1. Partie SANS DOM (module.exports pour node) : état, dérèglement à graine, état → configuration du moteur
 *    (`config`), lecture du vernier et sa vérification, rotation de la lunette bornée par le collimateur.
 *    Angles (rad) comptés dans le sens trigonométrique depuis l'axe du collimateur (la lumière du collimateur va
 *    dans la direction 0) ; `phi` = lunette, `plat` = plate-forme, la normale de l'objet posé dessus vaut
 *    plat + cache.offM (miroir) ou plat + cache.offR (réseau), plat seul pour le prisme (sommet dans cette direction) : on pose l'objet n'importe comment, il faut tourner la
 *    plate-forme. Plate-forme non graduée ; la lunette se lit au vernier : lecture = cache.offV + phi (degrés,
 *    origine du cercle cachée). Tirages `eps`, `eC`, oculaire `u`, fente `b` : conventions du cœur (m).
 * 2. Interface : vue de dessus (dessin en mm, axe de la plate-forme au centre, SVG y vers le bas) ; les déplacements
 *    des tirages et de l'oculaire y sont exagérés EX fois (sinon invisibles) ; « Voir la lumière » au même
 *    facteur le long de l'axe de la lunette, loupe du réticule dilatée bien davantage. Champ de la lunette rendu par
 *    le cœur (aperçu pendant un geste à la définition que la machine suit, image fine au repos), œil désigné ou au curseur, loupe du
 *    vernier et son entraînement.
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
  var DEG = Math.PI / 180, MM = 1e-3;
  var PHI_MAX = 162 * DEG;                       // la lunette bute sur le collimateur (tubes de Ø 36 mm à 12 cm de l'axe)
  var PAS_TIRAGE = 1e-3, PAS_FENTE = 0.25e-3;    // m par tour de molette
  var BORNES = { u: [-4e-3, 8e-3], eps: [-6e-3, 6e-3], eC: [-6e-3, 6e-3], b: [0, 1e-3] };
  var H_MAX = 3.6e-3;                            // décalage de l'œil : au-delà, il est sorti du cercle oculaire
  var GRAINE_DEPART = 1;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function wrap(x) { x = (x + Math.PI) % (2 * Math.PI); if (x <= 0) x += 2 * Math.PI; return x - Math.PI; }
  function hasardDe(graine) {   // mulberry32, comme le hasard de la coque (partie sans DOM : copie locale)
    var a = graine >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0; var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ================= état =================
  // Dérèglement n° graine : oculaire franchement tiré (réticule flou pour tout œil non hypermétrope) ou enfoncé
  // (net en accommodant fort, ou flou) ; tirages de la lunette et du collimateur à 0,8-2,5 mm du foyer ; miroir posé
  // sur la plate-forme à 1,5-5° de l'autocollimation (image retour hors du champ, qui s'arrête à 39′) ; réseau posé
  // n'importe comment ; fente entre 0,2 et 0,5 mm ; origine du cercle gradué quelconque.
  // ================= sources =================
  // Raies (nm, intensité relative) : Hg et Na sont dans le cœur ; les autres viennent d'ici, passées au cœur par
  // cfg.spectre. Longueurs d'onde et rapports d'intensité : tables des raies fortes du NIST (Handbook of Basic Atomic
  // Spectroscopic Data) ; intensités d'arc, donc ordres de grandeur seulement pour une lampe
  // basse pression. Raies d'ion (Ar II) gardées faibles : le TP les cite, une lampe spectrale les émet peu.
  // Kr 486,1 du TP n'est pas une raie du krypton (c'est H-β) : absente.
  var RAIES = {
    Cd: [[467.8, 0.1], [480.0, 0.15], [508.6, 0.5], [643.8, 1.0]],
    Ne: [[540.1, 0.2], [585.2, 0.2], [588.2, 0.1], [594.5, 0.05], [603.0, 0.1], [607.4, 0.1], [614.3, 0.1], [616.4, 0.1],
      [621.7, 0.1], [626.6, 0.1], [633.4, 0.1], [638.3, 0.1], [640.2, 0.2], [650.7, 0.15], [659.9, 0.1], [692.9, 1.0],
      [703.2, 0.8], [717.4, 0.8]],
    Ar: [[420.1, 0.05], [472.7, 0.03], [476.5, 0.03], [488.0, 0.03], [696.5, 0.43], [706.7, 0.43], [750.4, 0.86], [763.5, 1.0]],
    Kr: [[427.4, 0.3], [432.0, 0.3], [437.6, 0.25], [446.4, 0.25], [450.2, 0.2], [557.0, 0.6], [587.1, 1.0], [758.7, 0.3], [760.2, 0.6]],
    He: [[447.1, 0.4], [471.3, 0.06], [492.2, 0.04], [501.6, 0.2], [587.6, 1.0], [667.8, 0.4], [706.5, 0.2]]
  };
  var INCONNUES = ["Ne", "Ar", "Kr", "He"];
  var NOMS_GAZ = { Ne: TRAD("néon"), Ar: "argon", Kr: "krypton", He: TRAD("hélium") };
  // Filtres devant la fente (lampe halogène) : transmission T(λ), λ en nm.
  var FILTRES = {
    rouge: { nom: TRAD("Rouge"), T: function (l) { return 0.9 / (1 + Math.exp(-(l - 605) / 9)); } },
    vert: { nom: TRAD("Vert"), T: function (l) { return 0.8 * Math.exp(-Math.pow((l - 530) / 38, 2)); } },
    bleu: { nom: TRAD("Bleu"), T: function (l) { return 0.8 * Math.exp(-Math.pow((l - 455) / 40, 2)); } },
    interf: { nom: TRAD("Interf. 546"), T: function (l) { return 0.6 * Math.exp(-0.5 * Math.pow((l - 546) / (10 / 2.3548), 2)); } }
  };
  var T_HALO = 2800, A_RES = 1e-3 / 600, F_COLL = 0.175, DEMI_CHAMP = 1.6 * DEG;
  var N_PRISME = [1.5943, 8926.0];   // verre du prisme : nA, nB de APPAREIL (cœur)
  // Directions de sortie du prisme orienté à psi (géométrie de geomPrisme du cœur, positions ignorées : toutes les
  // paires face éclairée → face atteinte de l'intérieur, hors réflexion totale), pour le peigne du continu.
  function prismeDirections(ps, n) {
    var N = [0, 1, 2].map(function (k) { var a = ps + Math.PI / 3 + 2 * Math.PI * k / 3; return [Math.cos(a), Math.sin(a)]; });
    var out = [];
    for (var k = 0; k < 3; k++) {
      var c0 = N[k][0];
      if (c0 >= 0) continue;
      var ci = -c0, s2 = (1 - ci * ci) / (n * n), q = ci / n - Math.sqrt(1 - s2);
      var d1 = [1 / n + q * N[k][0], q * N[k][1]];
      for (var j = 0; j < 3; j++) {
        if (j === k) continue;
        var cj = N[j][0] * d1[0] + N[j][1] * d1[1];
        if (cj <= 0) continue;
        var t2 = n * n * (1 - cj * cj);
        if (t2 >= 1) continue;
        var r = Math.sqrt(1 - t2) - n * cj, d2 = [n * d1[0] + r * N[j][0], n * d1[1] + r * N[j][1]];
        out.push({ kj: "" + k + j, a: Math.atan2(d2[1], d2[0]) });
      }
    }
    return out;
  }
  // ---- gros plan sur la plate-forme (« Voir la lumière ») : dessin seul, le champ de la lunette n'en dépend pas ----
  function refracter(d, N, nn) {   // comme le cœur : N tournée vers le côté d'où vient la lumière, nn = n_avant/n_après
    var ci = -(N[0] * d[0] + N[1] * d[1]), s2 = nn * nn * (1 - ci * ci);
    if (s2 >= 1) return null;
    var k = nn * ci - Math.sqrt(1 - s2);
    return [nn * d[0] + k * N[0], nn * d[1] + k * N[1]];
  }
  // Rayon du collimateur (direction +x, à la hauteur y, départ à x = −R) à travers le prisme orienté à ps (géométrie
  // de geomPrisme du cœur, côté lp). Tracé exact, réflexions totales comprises : le cœur compte ces trajets perdus
  // pour le champ, le gros plan montre où va la lumière. Segments en mètres : { a, b, verre, tot (après une réflexion
  // totale), k (face touchée en b) } ; le dernier, sorti du verre, a la longueur 2R.
  function rayonPrisme(ps, n, y, R, lp) {
    var Rc = lp / Math.sqrt(3), S = [], N = [], k;
    for (k = 0; k < 3; k++) {
      S.push([Rc * Math.cos(ps + 2 * Math.PI * k / 3), Rc * Math.sin(ps + 2 * Math.PI * k / 3)]);
      N.push([Math.cos(ps + Math.PI / 3 + 2 * Math.PI * k / 3), Math.sin(ps + Math.PI / 3 + 2 * Math.PI * k / 3)]);
    }
    var P = [-R, y], d = [1, 0], dedans = false, tot = false, segs = [];
    for (var it = 0; it < 6; it++) {
      var best = null;
      for (k = 0; k < 3; k++) {
        var dn = d[0] * N[k][0] + d[1] * N[k][1];
        if (dedans ? dn <= 1e-12 : dn >= -1e-12) continue;
        var t = ((S[k][0] - P[0]) * N[k][0] + (S[k][1] - P[1]) * N[k][1]) / dn;
        if (t <= 1e-12) continue;
        var Q = [P[0] + t * d[0], P[1] + t * d[1]], B = S[(k + 1) % 3], e = [B[0] - S[k][0], B[1] - S[k][1]];
        var u = ((Q[0] - S[k][0]) * e[0] + (Q[1] - S[k][1]) * e[1]) / (e[0] * e[0] + e[1] * e[1]);
        if (u < 0 || u > 1) continue;
        if (!best || t < best.t) best = { t: t, k: k, Q: Q };
      }
      if (!best) break;
      segs.push({ a: P, b: best.Q, verre: dedans, tot: tot, k: best.k });
      var Nk = N[best.k];
      if (!dedans) { d = refracter(d, Nk, 1 / n); dedans = true; }
      else {
        var d2 = refracter(d, [-Nk[0], -Nk[1]], n);
        if (d2) { d = d2; dedans = false; }
        else { var c = d[0] * Nk[0] + d[1] * Nk[1]; d = [d[0] - 2 * c * Nk[0], d[1] - 2 * c * Nk[1]]; tot = true; }
      }
      P = best.Q;
    }
    if (!dedans) segs.push({ a: P, b: [P[0] + 2 * R * d[0], P[1] + 2 * R * d[1]], verre: false, tot: tot, k: null, d: d });
    return segs;
  }
  // Réseau orienté à ps (normale ramenée dans ]−π/2, π/2] comme le cœur) : partie éclairée [−w/2, w/2] le long des
  // traits (w = min(DC/cos i, Lres, diaphragme), comme raies() du cœur) et directions des ordres |p| ≤ 3 qui existent.
  function ordresReseau(ps, lam, diaph) {
    var pw = ps - Math.PI * Math.round(ps / Math.PI), ci = Math.cos(pw), out = [];
    for (var p = -3; p <= 3; p++) {
      var s = -Math.sin(pw) + p * lam * 1e-9 / A_RES;
      if (Math.abs(s) < 1) out.push({ p: p, dir: pw + Math.asin(s) });
    }
    return { psi: pw, g: [-Math.sin(pw), Math.cos(pw)], w: Math.min(0.030 / ci, 0.040, diaph || 1e9), ordres: out };
  }
  // Couleurs du gros plan : les raies fortes de la lampe (≥ 10 % de la plus forte, une seule par groupe de 3 nm,
  // six au plus), ou pour l'halogène quelques longueurs d'onde réparties sur ce que laisse passer le filtre.
  function couleursGrosPlan(st, GO) {
    if (!st.lampe) return [];
    if (st.lampe === "W") {
      var T = st.filtre && FILTRES[st.filtre] ? FILTRES[st.filtre].T : null, lo = 400, hi = 700, l;
      if (T) {
        var m = 0; for (l = 400; l <= 700; l += 1) m = Math.max(m, T(l));
        lo = null; for (l = 400; l <= 700; l += 1) if (T(l) >= 0.3 * m) { if (lo === null) lo = l; hi = l; }
      }
      var nb = Math.max(1, Math.min(6, Math.floor((hi - lo) / 40) + 1)), L = [];
      for (var i = 0; i < nb; i++) L.push(Math.round(lo + (i + 0.5) * (hi - lo) / nb));
      return L;
    }
    var src = st.lampe === "X" ? RAIES[st.cache.inc || "Ne"] : RAIES[st.lampe] || GO.SOURCES[st.lampe];
    if (!src || !src.length) return [];
    var max = 0; src.forEach(function (r) { max = Math.max(max, r[1]); });
    var garde = [];
    src.filter(function (r) { return r[1] >= 0.1 * max; }).sort(function (a, b) { return b[1] - a[1]; }).forEach(function (r) {
      if (garde.length < 6 && !garde.some(function (g) { return Math.abs(g - r[0]) < 3; })) garde.push(r[0]);
    });
    return garde.sort(function (a, b) { return a - b; });
  }
  function planckRel(l) { var x = 1.4388e7 / (l * T_HALO), x0 = 1.4388e7 / (600 * T_HALO); return Math.pow(600 / l, 5) * (Math.exp(x0) - 1) / (Math.exp(x) - 1); }
  // Spectre passé au cœur (null : celui du cœur). Continu (halogène) = peigne de raies : pas de 5 nm partout, pas
  // fin dans la fenêtre de chaque ordre qui tombe dans le champ de la lunette : un tiers de la largeur spectrale de
  // l'image de la fente, au plus un millième du champ (PAS_CHAMP) ; poids = densité × intervalle, si bien que la
  // luminance du spectre vaut S(λ) × largeur spectrale de la fente (plus de lumière quand la fente s'ouvre, comme en
  // vrai) et ne dépend pas du pas. Le plafond au millième du champ : les bords des images de la fente sont nets, la
  // somme des créneaux décalés d'un pas ondule (2 à 9 % d'une colonne à l'autre au tiers de la fente, fente de 0,08 à
  // 0,5 mm, réseau et prisme) ; « toujours visible » l'écrase (compression), la luminosité réelle la montait en traits
  // verticaux. Au millième : sous 0,2 %, ~1 000 raies, rendu du champ inchangé (mesuré en node, 440²).
  var PAS_CHAMP = 1e-3;
  function spectre(st, c) {
    if (st.lampe === "X") return RAIES[st.cache.inc || "Ne"];
    if (st.lampe && RAIES[st.lampe]) return RAIES[st.lampe];
    if (st.lampe !== "W") return null;
    var T = st.filtre && FILTRES[st.filtre] ? FILTRES[st.filtre].T : function () { return 1; };
    var L = [], l, p;
    for (l = 380; l <= 780; l += 5) L.push(l);
    if (c.plateau === "reseau") {
      var ps = c.psi - Math.PI * Math.round(c.psi / Math.PI);   // comme le cœur (wrapDroite) : normale dans ]−π/2, π/2]
      var sI = -Math.sin(ps);
      for (p = -3; p <= 3; p++) {
        if (!p) continue;
        var dph = c.phi - ps; dph -= 2 * Math.PI * Math.round(dph / (2 * Math.PI));
        var t1 = dph - DEMI_CHAMP, t2 = dph + DEMI_CHAMP;
        if (t2 < -Math.PI / 2 || t1 > Math.PI / 2) continue;
        t1 = Math.max(t1, -1.5); t2 = Math.min(t2, 1.5);
        var la = A_RES * (Math.sin(t1) - sI) / p * 1e9, lb = A_RES * (Math.sin(t2) - sI) / p * 1e9;
        var lo = Math.max(380, Math.min(la, lb)), hi = Math.min(780, Math.max(la, lb));
        if (hi <= lo) continue;
        var dl = A_RES * Math.cos((t1 + t2) / 2) * (c.b / F_COLL) / Math.abs(p) * 1e9 / 3;
        dl = Math.max(Math.min(dl, (hi - lo) * PAS_CHAMP), 0.02);
        for (l = lo; l <= hi; l += dl) L.push(l);
      }
    } else if (c.plateau === "prisme") {
      // Directions de sortie de chaque trajet (face d'entrée k, de sortie j) sur une grille de 1 nm ; là où elles
      // tombent dans le champ, pas fin d'un tiers de la largeur spectrale de la fente (plafond PAS_CHAMP), d'après la dispersion locale
      // (elle triple du rouge au bleu et grandit loin du minimum de déviation).
      var g, k, j, dirs = {};
      for (g = 380; g <= 780; g++) prismeDirections(c.psi, N_PRISME[0] + N_PRISME[1] / (g * g)).forEach(function (t) {
        (dirs[t.kj] = dirs[t.kj] || [])[g - 380] = t.a;
      });
      Object.keys(dirs).forEach(function (kj) {
        var D = dirs[kj];
        for (g = 380; g < 780; g++) {
          if (D[g - 380] === undefined || D[g + 1 - 380] === undefined) continue;
          var e0 = wrap(D[g - 380] - c.phi), e1 = wrap(D[g + 1 - 380] - c.phi);
          if (Math.min(e0, e1) > DEMI_CHAMP || Math.max(e0, e1) < -DEMI_CHAMP) continue;
          var de = Math.max(Math.abs(e1 - e0), 1e-9), dlq = Math.max(Math.min((c.b / F_COLL) / de / 3, 2 * DEMI_CHAMP * PAS_CHAMP / de), 0.02);
          for (l = g; l < g + 1; l += dlq) L.push(l);
        }
      });
    }
    L.sort(function (x, y) { return x - y; });
    var U = []; L.forEach(function (x) { if (!U.length || x - U[U.length - 1] > 1e-6) U.push(x); });
    return U.map(function (x, i) {
      var g = i > 0 ? U[i - 1] : x - 2.5, d = i < U.length - 1 ? U[i + 1] : x + 2.5;
      return [x, planckRel(x) * T(x) * (d - g) / 2];
    });
  }
  function continu(st) { return st.lampe === "W"; }

  function dereglement(graine) {
    var r = hasardDe(graine), sg = function () { return r() < 0.5 ? -1 : 1; };
    var u = r() < 0.5 ? -(1 + 2 * r()) * MM : (3 + 2 * r()) * MM;
    var eps = sg() * (0.8 + 1.7 * r()) * MM, eC = sg() * (0.8 + 1.7 * r()) * MM;
    var phi = sg() * (25 + 35 * r()) * DEG, beta = sg() * (1.5 + 3.5 * r()) * DEG;
    var offM = 2 * Math.PI * r(), offR = 2 * Math.PI * r(), offV = Math.floor(360 * 60 * r()) / 60 + 0.37 * r() / 60;
    var b = (0.2 + 0.3 * r()) * MM;
    var inc = INCONNUES[Math.floor(INCONNUES.length * r()) % INCONNUES.length];   // gaz de la lampe inconnue
    return { u: u, eps: eps, eC: eC, phi: phi, beta: beta, offM: offM, offR: offR, offV: offV, b: b, inc: inc };
  }
  function etatDepart(graine) {
    var d = dereglement(graine);
    return { v: 1, graine: graine, cache: { offM: d.offM, offR: d.offR, offV: d.offV, inc: d.inc },
      u: d.u, eps: d.eps, eC: d.eC, b: d.b, phi: d.phi, plat: wrap(d.phi + d.beta - d.offM),
      plateau: "miroir", lampe: "Hg", lampe_lunette: true, filtre: null, diaph: null,
      oeil: { type: "normal", mode: "objet", cible: "reticule", acc: 0, h: [0, 0] },
      zoom: 1, lumiere: false, cahier: [] };
  }
  function psi(st) { return st.plat + (st.plateau === "miroir" ? st.cache.offM : st.plateau === "reseau" ? st.cache.offR : 0); }
  // Échelle absolue du spectre passé au cœur (cd/m² par unité de Y relatif, cf. `echelle` du cœur) :
  // luminance typique de la lampe (module couleur) / Y relatif de son spectre NON filtré. Cadmium et lampe inconnue :
  // lampes spectrales basse pression (« cd », comme le sodium) ; halogène : filament, Y = ∫ planckRel ȳ dλ (le peigne
  // porte densité × intervalle en nm). null : celle du cœur (Hg, Na).
  var MI_ = (root && root.VITRINE_MICHELSON) || (typeof require === "function" ? require("./_app-michelson-coeur.js").Coeur : null);
  var ECH_W = null;
  function echelleLampe(st) {
    var r = st.lampe === "X" ? RAIES[st.cache.inc || "Ne"] : st.lampe && RAIES[st.lampe], y = 0, l;
    if (r) { r.forEach(function (q) { y += q[1] * MI_.cie(q[0])[1]; }); return MI_.luminanceSource("cd") / y; }
    if (st.lampe !== "W") return null;
    if (ECH_W == null) { for (l = 380.5; l < 780; l += 1) y += planckRel(l) * MI_.cie(l)[1]; ECH_W = MI_.luminanceSource("bl") / y; }
    return ECH_W;
  }
  // État → configuration du cœur (`oeil` : remplace celle de l'état, pour le saut de l'œil d'un objet à l'autre).
  function config(st, oeil) {
    var o = oeil || st.oeil;
    var c = { u: st.u, eps: st.eps, eC: st.eC, phi: st.phi, psi: psi(st), b: st.b, lampe: st.lampe || "Hg",
      plateau: st.plateau, lampe_lunette: !!st.lampe_lunette, diaph: st.plateau === "reseau" && st.diaph || null,
      oeil: { type: o.type, mode: o.mode, cible: o.cible, acc: o.acc || 0, mi: 0, h: [o.h[0], o.h[1]], pupille: 3e-3 } };
    var sp = spectre(st, c); if (sp) c.spectre = sp;
    var ech = echelleLampe(st); if (ech != null) c.echelle = ech;
    return c;
  }
  // Vue du cœur, lampe du collimateur éteinte comprise (le cœur ne connaît pas l'extinction : raies à intensité nulle).
  function vueDe(GO, st, cfg) {
    var V = GO.vue(cfg);
    if (!st.lampe) V.objets.forEach(function (o) { if (o.type === "raie") o.I = 0; });
    return V;
  }
  // Lecture vraie du vernier (degrés dans [0, 360[).
  function lecture(st) { return (((st.cache.offV + st.phi / DEG) % 360) + 360) % 360; }
  // Vérification d'une lecture (degrés, minutes) : juste à ±1′, sinon l'écart en minutes ; jamais la valeur.
  function verifierLecture(vrai, deg, min) {
    var lu = deg + (min || 0) / 60, ec = (((lu - vrai) % 360 + 540) % 360 - 180) * 60;
    if (Math.abs(ec) <= 1) return { juste: true, texte: TRAD("Lecture juste.") };
    var n = Math.round(Math.abs(ec)), ecart = n >= 60 ? Math.floor(n / 60) + "° " + (n % 60) + "′" : n + "′";
    return { juste: false, ecart: n, texte: ec > 0 ? TRAD("Écart de {0} : lecture trop grande.", [ecart])
      : TRAD("Écart de {0} : lecture trop petite.", [ecart]) };
  }
  // Rotation de la lunette : bornée de part et d'autre du collimateur, jamais de saut par-dessus.
  function tournerLunette(st, d) { st.phi = clamp(st.phi + d, -PHI_MAX, PHI_MAX); }

  // ================= étapes du réglage =================
  // Une étape = un réglage de l'appareil, lu sur l'état EN DIRECT (pas une observation verrouillée) : chaque réglage
  // est une grandeur indépendante (u, eps, eC, lame, fente). Deux niveaux : ✓ atteinte, ★ soignée. L'instrument
  // garde seulement « déjà atteinte » (st.deja) pour montrer en orange une étape qui ne l'est plus.
  // Seuils (calculés avec le cœur, œil normal, pupille 3 mm) : réticule à ε du foyer → image retour à 2ε, floue de
  // 3,3′ par 0,1 mm quand l'œil regarde le réticule, parallaxe de 1,2′ par 0,1 mm l'œil à 1,5 mm du centre du cercle
  // oculaire. ✓ « correct » = image nette à ×1, 0,12 mm (4,0′ de flou, 1,4′ de parallaxe) ; ★ « soigné » = sans
  // = sans parallaxe au zoom ×4 (0,6′ par pixel), 0,06 mm (2′ de flou, 0,7′ de parallaxe). La fente vue dans la
  // lunette n'est déplacée que de e_C (pas d'aller-retour) : seuils doubles pour le même aspect. Oculaire : réticule
  // dans la plage de l'œil (✓), net œil au repos et indicateur « au repos » (★ : image entre PR − pdc/2 et PR + 0,05 δ,
  // soit ~0,1 mm d'oculaire).
  // ✓ de l'oculaire : net sans forcer (au plus 2 δ d'accommodation ; l'oculaire enfoncé du dérèglement en demande 5 à 8)
  // — l'accommodation ne floute pas l'image (0,6 à 1,2′), elle la fatigue : ce seuil reste à 2 δ.
  var SEUILS = { eps: [0.12e-3, 0.06e-3], eC: [0.24e-3, 0.12e-3], repos: 0.05, acc: 2, b: 0.1e-3 };
  var ETAPES = [
    { id: "oculaire", nom: TRAD("Oculaire"), titre: TRAD("Réticule net pour votre œil (réglage personnel)."),
      soin: TRAD("réticule net l'œil au repos : son image au punctum remotum de l'œil.") },
    { id: "lunette", nom: TRAD("Lunette à l'infini"), titre: TRAD("Autocollimation : réticule et image retour nets ensemble."),
      soin: TRAD("réticule et image retour sans parallaxe quand l'œil se déplace.") },
    { id: "collimateur", nom: TRAD("Collimateur à l'infini"), titre: TRAD("Fente nette dans le plan du réticule de la lunette réglée."),
      soin: TRAD("fente et réticule sans parallaxe.") },
    { id: "pret", nom: TRAD("Prêt à mesurer"), titre: TRAD("Lunette et collimateur réglés, réseau posé, lampe latérale éteinte et lame relevée."),
      soin: TRAD("fente fine (une raie de deux minutes d'arc environ).") }
  ];
  // Manipulations : ce que montre un goniomètre, sans ordre ni parcours. Chacune est un
  // constat gardé une fois vu (st.app, jamais décoché) et une situation qu'on peut poser (CONFIGS, même id). Les ids
  // « normale », « mindev », « doublet », « resolution », « filtres » sont ceux des anciennes applications (états sauvés).
  // observe : ce qu'on voit et pourquoi ; etapes : comment faire, gestes seulement, jamais de valeur ; titre : quand
  // la case se coche (le constat de `constats`).
  var MANIPS = [
    { id: "normale", nom: TRAD("Incidence normale"),
      observe: TRAD("Les ordres +p et −p d'une même raie ne sont symétriques par rapport à l'ordre 0 qu'en incidence normale. L'angle entre eux vaut alors 2θ, avec a sin θ = pλ : il donne le pas du réseau, ou la longueur d'onde."),
      etapes: [TRAD("Réseau posé, lampe à raies, goniomètre réglé."),
        TRAD("Repérer une raie dans les ordres +p et −p ; tourner la plate-forme jusqu'à ce que ses deux écarts à l'ordre 0 soient égaux (l'ordre 2 montre mieux la dissymétrie que l'ordre 1). Une petite erreur d'incidence ne fausse θ qu'au second ordre."),
        TRAD("Sans plus toucher à la plate-forme, pointer la raie dans l'ordre +p, puis dans l'ordre −p : fil vertical du réticule sur la raie, champ agrandi au plus, puis lâcher la lunette.")],
      titre: TRAD("les deux pointés faits sans toucher à la plate-forme, réseau en incidence normale à 30′ près.") },
    { id: "incidence", nom: TRAD("Déviation et incidence"),
      observe: TRAD("En tournant le réseau, une raie diffractée se rapproche de l'ordre 0, s'arrête, puis repart : la déviation passe par un minimum. On peut échanger les angles d'incidence et d'émergence sans changer la déviation (retour inverse de la lumière) : le minimum est atteint quand ils sont égaux."),
      etapes: [TRAD("Réseau posé, une raie de l'ordre 1 dans le champ."),
        TRAD("Tourner lentement la plate-forme, toujours dans le même sens, en regardant le champ ; si la raie en sort, l'y ramener avec la lunette."),
        TRAD("La raie s'arrête, puis repart dans l'autre sens : laisser la lunette où elle s'est arrêtée et continuer à tourner la plate-forme.")],
      titre: TRAD("la même raie vue dans le champ de part et d'autre de son minimum, plate-forme tournée d'une dizaine de degrés de chaque côté.") },
    { id: "mindev", nom: TRAD("Minimum de déviation"),
      observe: TRAD("Au minimum de déviation, l'angle entre une raie de l'ordre +1 et la même raie de l'ordre −1 vaut 2 D_m, avec 2a sin(D_m/2) = λ : une mesure qui ne passe ni par l'ordre 0 ni par la normale au réseau."),
      etapes: [TRAD("Amener une raie de l'ordre +1 à son minimum de déviation (comme dans « Déviation et incidence ») et l'y pointer."),
        TRAD("Tourner la plate-forme vers la position symétrique, chercher le minimum de la même raie dans l'ordre −1 et l'y pointer."),
        TRAD("Le minimum est plat : pas besoin d'être exactement dessus, la déviation n'y change presque pas.")],
      titre: TRAD("la même raie pointée au minimum de déviation dans l'ordre +1 et dans l'ordre −1.") },
    { id: "recouvrement", nom: TRAD("Recouvrement des ordres"),
      observe: TRAD("Chaque ordre étale le spectre de la lumière blanche du violet au rouge, d'autant plus loin de l'ordre 0 que l'ordre est élevé. Les ordres 1 et 2 se touchent à peine, mais le rouge de l'ordre 2 tombe là où arrive le bleu de l'ordre 3 : les deux couleurs se mêlent dans le champ."),
      etapes: [TRAD("Lampe halogène sans filtre, réseau posé, goniomètre réglé."),
        TRAD("Partir de l'ordre 0 et tourner la lunette en s'en éloignant : traverser le spectre de l'ordre 1, puis celui de l'ordre 2."),
        TRAD("Sur le rouge de l'ordre 2, le bleu de l'ordre 3 arrive dans le même champ : la couleur vire.")],
      titre: TRAD("un ordre 2 et un ordre 3 vus ensemble dans le champ.") },
    { id: "nets", nom: TRAD("Ordres nets ensemble"),
      observe: TRAD("Collimateur réglé, la fente est à l'infini, et ses images aussi, dans tous les ordres. Déréglé, l'image de la fente est à distance finie, et le réseau change cette distance d'un ordre à l'autre : on ne voit plus tous les ordres nets à la fois. Seul le minimum de déviation y échappe : l'image y est à la même distance que celle de l'ordre 0."),
      etapes: [TRAD("Réseau posé : dérégler nettement le tirage du collimateur."),
        TRAD("Rendre l'ordre 0 net avec le tirage de la lunette : fente et réticule sans parallaxe."),
        TRAD("Tourner la lunette vers l'ordre 2 : la raie est floue."),
        TRAD("Sans toucher aux tirages, amener cette raie à son minimum de déviation en tournant la plate-forme : elle redevient nette. Il faudra ensuite régler de nouveau lunette et collimateur.")],
      titre: TRAD("collimateur déréglé, une raie vue floue, puis une raie nette au minimum de déviation, sans toucher aux tirages entre les deux.") },
    { id: "doublet", nom: TRAD("Doublet du sodium"),
      observe: TRAD("La raie jaune du sodium est double : deux raies très proches, que le réseau sépare quand leurs images sont assez fines, donc la fente assez fermée."),
      etapes: [TRAD("Lampe au sodium, réseau posé, raie jaune de l'ordre 1 ou 2 au centre du champ, champ agrandi au plus."),
        TRAD("Fermer la fente jusqu'à voir deux raies. À l'ordre 2, elles sont plus écartées.")],
      titre: TRAD("les deux raies jaunes vues séparées.") },
    { id: "fente", nom: TRAD("Largeur de la fente"),
      observe: TRAD("La fente fixe à la fois la finesse des raies et la lumière qu'elles reçoivent. Fine : les raies sont séparées mais sombres ; large : lumineuses, mais le doublet se fond en une seule raie."),
      etapes: [TRAD("Doublet du sodium séparé à l'ordre 1 (manipulation précédente)."),
        TRAD("Ouvrir lentement la fente : les deux raies s'élargissent et se fondent."),
        TRAD("La refermer : elles se séparent de nouveau, moins lumineuses.")],
      titre: TRAD("le doublet vu séparé puis fondu dans le même ordre en changeant la fente, sans diaphragme.") },
    { id: "resolution", nom: TRAD("Résolution"),
      observe: TRAD("Le pouvoir de résolution du réseau vaut N p, N étant le nombre de traits éclairés. Avec moins de traits, deux raies proches ne se séparent plus, si fine que soit la fente."),
      etapes: [TRAD("Doublet du sodium séparé à l'ordre 1."),
        TRAD("Poser le diaphragme de 1 mm devant le réseau (étagère, onglet « Filtres et diaphragmes »)."),
        TRAD("Fermer la fente autant qu'on veut : le doublet reste fondu.")],
      titre: TRAD("avec un diaphragme, le doublet non séparé alors qu'il le serait sans lui.") },
    { id: "filtres", nom: TRAD("Filtres"),
      observe: TRAD("Un filtre ne laisse passer qu'une partie du spectre : à travers lui, le spectre de la lumière blanche se réduit à une bande, dont on lit les longueurs d'onde à la lunette."),
      etapes: [TRAD("Lampe halogène, réseau posé, lunette sur l'ordre 1."),
        TRAD("Poser chaque filtre tour à tour (étagère, onglet « Filtres et diaphragmes ») et chercher la bande qu'il laisse passer.")],
      titre: TRAD("le spectre vu à travers chacun des quatre filtres.") }
  ];
  var REGLAGES = ETAPES;
  function estManip(id) { return MANIPS.some(function (m) { return m.id === id; }); }
  // Pointé : lunette au repos, raie (ordre ≠ 0, lampe à raies) à moins de 0,5′ du fil vertical, lunette et collimateur
  // réglés (atteints). Minimum de déviation : |θ + i| ≤ 2° (déviation à moins de 1′ du minimum).
  var POINTE = { tol: 0.5 / 60 * DEG, min: 2 * DEG, normale: 30 / 60 * DEG, memePsi: 0.2 / 60 * DEG };
  // Constats des manipulations. dev : |θ + i| d'une raie vue de chaque côté du minimum de déviation (θ + i ≈ 2 Δ, Δ =
  // rotation de la plate-forme depuis le minimum : 20° ↔ ±10°, la raie y revient de 17′ vers l'ordre 0, lunette fixe,
  // et reste dans le champ de ±1,3°). net / flou : écart de vergence image − réticule (δ) ; net = profondeur de champ de
  // l'œil (OEIL.pdc / 2) ; flou ≥ 0,5 δ (collimateur à 1 mm : ordre 0 à 0,006 δ, ordre 1 à 0,19 δ, ordre 2 à 1,2 δ, flou de 12′).
  // recouv : luminance de l'ordre le plus faible rapportée au plus fort. Le bleu de l'ordre 3 (Planck, efficacité du
  // réseau) vaut 5 à 8 % du rouge de l'ordre 2 dans un même champ (lunette sur 620-700 nm) et vire le rouge au rose.
  var EXPLO = { dev: 20 * DEG, flou: 0.5, recouv: 0.04 };
  function nomEtape(id) { var L = ETAPES.concat(MANIPS); for (var i = 0; i < L.length; i++) if (L[i].id === id) return L[i].nom; return id; }
  // Analyse : ok (atteinte) et top (soignée) de chaque étape, plus ce qu'il faut aux indices.
  function analyse(st, GO) {
    var Y = GO.YEUX[st.oeil.type], R = Y[0], amp = Y[1], pdc = GO.OEIL.pdc;
    var cfg = config(st, { type: st.oeil.type, mode: "objet", cible: "reticule", acc: 0, h: [0, 0] });
    var V = vueDe(GO, st, cfg), ret = V.objets[0], rt = V.objets[1];
    var o0 = null; V.objets.forEach(function (o) { if (o.type === "raie" && o.p === 0 && (!o0 || o.I > o0.I)) o0 = o; });
    var ae = Math.abs(st.eps), ac = Math.abs(st.eC), ok = {}, top = {};
    var Pr = ret.Px - R;
    ok.oculaire = Pr >= -pdc / 2 && Pr <= Math.min(amp + pdc / 2, SEUILS.acc);
    top.oculaire = Pr >= -pdc / 2 && Pr <= SEUILS.repos;
    ok.lunette = ae <= SEUILS.eps[0]; top.lunette = ae <= SEUILS.eps[1];
    ok.collimateur = ac <= SEUILS.eC[0]; top.collimateur = ac <= SEUILS.eC[1];
    ok.pret = ok.lunette && ok.collimateur && st.plateau === "reseau" && !st.lampe_lunette && !!st.lampe;
    top.pret = ok.pret && st.b <= SEUILS.b;
    var beta = GO.wrapDroite(cfg.psi - cfg.phi);
    // pointé et observations des applications
    var pointe = null, G = V.lunette.G, iInc = -GO.wrapDroite(cfg.psi), doublet = null, spectreVu = false, ordresVus = {}, devs = [], plans = null;
    var R1 = V.objets.filter(function (o) { return o.type === "raie" && o.champ && o.I > 0.02; });
    if (st.plateau === "reseau" && st.lampe && ok.lunette && ok.collimateur) {
      if (!continu(st)) {
        var best = null; R1.forEach(function (o) { if (o.p && (!best || Math.abs(o.X) < Math.abs(best.X))) best = o; });
        if (best && Math.abs(best.X) / G <= POINTE.tol)
          pointe = { l: best.lam, p: best.p, psi: cfg.psi, i: iInc, min: Math.abs(best.theta + iInc) <= POINTE.min };
        // déviation et incidence : chaque raie vue, avec son écart au minimum (θ + i, de signe opposé de part et d'autre)
        R1.forEach(function (o) { if (o.p) devs.push({ k: (st.lampe === "X" ? "X:" + st.cache.inc : st.lampe) + ":" + o.lam + ":" + o.p, x: o.theta + iInc }); });
      } else {
        // continu : la raie du peigne porte densité × pas (`spectre`) ; seuil sur densité × tiers de la largeur
        // spectrale de la fente (luminance du spectre), indépendant du pas : le 0,02 par raie d'avant le plafond
        // PAS_CHAMP, quand le pas valait ce tiers. ordresVus[p] : luminance la plus forte de l'ordre p dans le champ.
        [-3, -2, -1, 1, 2, 3].forEach(function (p) {
          var u = V.objets.filter(function (o) { return o.type === "raie" && o.champ && o.p === p; }).sort(function (a, b) { return a.lam - b.lam; }), m = 0;
          u.forEach(function (o, i) {
            if (!i || i === u.length - 1) return;
            var dens = o.I / ((u[i + 1].lam - u[i - 1].lam) / 2), tiers = A_RES * Math.abs(Math.cos(o.theta)) * (st.b / F_COLL) * 1e9 / 3;
            m = Math.max(m, dens * tiers);
          });
          ordresVus[p] = m;
        });
        spectreVu = ordresVus[1] > 0.02 || ordresVus[-1] > 0.02;
      }
      if (st.lampe === "Na") {
        var sep = function (V2) {   // les deux raies du doublet dans un même ordre, dans le champ : séparées ?
          var a = null, b2 = null;
          V2.objets.forEach(function (o) { if (o.type === "raie" && o.p && o.champ) { if (o.lam < 589.3) a = a && Math.abs(a.X) < Math.abs(o.X) ? a : o; } });
          if (a) V2.objets.forEach(function (o) { if (o.type === "raie" && o.p === a.p && o.lam > 589.3) b2 = o; });
          if (!a || !b2 || !b2.champ) return null;
          var flou = Math.max(a.flou_x, b2.flou_x) + Math.max(a.diffraction || 0, b2.diffraction || 0);
          return { s: Math.abs(a.X - b2.X) - (a.largeur + b2.largeur) / 2 - flou > GO.OEIL.acuite, p: a.p };   // angles apparents
        };
        var s1 = sep(V);
        if (s1 !== null) {
          doublet = { separe: s1.s, p: s1.p, b: st.b, diaph: !!cfg.diaph, sansDiaph: null };
          if (cfg.diaph) { var c2 = {}; for (var k in cfg) c2[k] = cfg[k]; c2.diaph = null; var s0 = sep(vueDe(GO, st, c2)); doublet.sansDiaph = s0 && s0.s; }
        }
      }
    }
    // ordres nets ensemble : collimateur déréglé, raies d'une lampe à raies dans le champ ; plan de chaque image
    // par rapport au réticule (écart de vergence Px, direction de dispersion), tirages notés pour la clé du constat
    if (st.plateau === "reseau" && st.lampe && !continu(st) && ac > SEUILS.eC[0]) {
      plans = { cle: Math.round(st.eC * 1e6) + ":" + Math.round(st.eps * 1e6), flou: false, min: false };
      R1.forEach(function (o) {
        var e = Math.abs(o.Px - ret.Px);
        if (o.p && e >= EXPLO.flou) plans.flou = true;
        if (o.p && e <= pdc / 2 && Math.abs(o.theta + iInc) <= POINTE.min) plans.min = true;
      });
    }
    return { ok: ok, top: top, V: V, pointe: pointe, doublet: doublet, spectreVu: spectreVu, ordresVus: ordresVus, devs: devs, plans: plans,
      d: { Pr: Pr, amp: amp, beta: beta, retourChamp: rt.champ, retourFlou: rt.flou_x, fente: o0,
        fenteChamp: !!o0 && o0.champ, dRet: rt.Px - ret.Px, dFente: o0 ? o0.Px - ret.Px : 0 } };
  }
  // Affichage d'une étape : "soignee" | true (atteinte) | "dereglee" (déjà atteinte, plus maintenant) | undefined.
  function faits(R, deja, apps) {
    var f = {};
    ETAPES.forEach(function (e) {
      f[e.id] = R.top[e.id] ? "soignee" : R.ok[e.id] ? true : deja && deja[e.id] ? "dereglee" : undefined;
    });
    return f;
  }
  // Constats des applications à partir d'une analyse : pointés gardés (st.pointes), filtres vus, applications
  // atteintes (st.app, jamais décochées). Rend la liste des applications nouvellement atteintes.
  function constats(st, R) {
    if (!st.pointes) st.pointes = []; if (!st.app) st.app = {}; if (!st.filtresVus) st.filtresVus = {};
    if (!st.vus) st.vus = { dev: {}, fente: {}, plans: null };
    var avant = {}, k; for (k in st.app) avant[k] = st.app[k];
    var P = R.pointe;
    if (P) {
      var lampe = st.lampe === "X" ? "X:" + st.cache.inc : st.lampe;
      var deja = st.pointes.some(function (q) { return q.lampe === lampe && q.l === P.l && q.p === P.p && Math.abs(wrap(q.psi - P.psi)) < POINTE.memePsi; });
      if (!deja) { st.pointes.push({ lampe: lampe, l: P.l, p: P.p, psi: P.psi, i: P.i, min: P.min }); if (st.pointes.length > 80) st.pointes.shift(); }
    }
    var L = st.pointes;
    function paire(q, r, min) { return q.lampe === r.lampe && q.l === r.l && q.p === -r.p && q.p !== 0 && (!min || (q.min && r.min && Math.abs(q.p) === 1)); }
    L.forEach(function (q) {
      L.forEach(function (r) {
        if (paire(q, r) && Math.abs(wrap(q.psi - r.psi)) < POINTE.memePsi && Math.abs(q.i) <= POINTE.normale) st.app.normale = true;
        if (paire(q, r, true)) st.app.mindev = true;
      });
    });
    var D = R.doublet;
    if (D && D.separe) st.app.doublet = true;
    if (D && !D.separe && D.sansDiaph) st.app.resolution = true;
    if (D && !D.diaph) {      // largeur de la fente : séparé à b, fondu à b' > b, même ordre
      var q = st.vus.fente[D.p] || (st.vus.fente[D.p] = { s: null, f: null });
      if (D.separe) q.s = q.s == null ? D.b : Math.min(q.s, D.b); else q.f = q.f == null ? D.b : Math.max(q.f, D.b);
      if (q.s != null && q.f != null && q.f > q.s) st.app.fente = true;
    }
    if (R.spectreVu && st.filtre) st.filtresVus[st.filtre] = true;
    if (Object.keys(FILTRES).every(function (f) { return st.filtresVus[f]; })) st.app.filtres = true;
    var O = R.ordresVus || {};
    [1, -1].forEach(function (sg) {   // ordres 2 et 3 du même côté : le plus faible (le bleu de l'ordre 3) à EXPLO.recouv du plus fort
      var a = O[2 * sg] || 0, b = O[3 * sg] || 0;
      if (Math.max(a, b) > 0.02 && Math.min(a, b) >= EXPLO.recouv * Math.max(a, b)) st.app.recouvrement = true;
    });
    (R.devs || []).forEach(function (d) {
      if (Math.abs(d.x) < EXPLO.dev) return;
      var v = st.vus.dev[d.k] || (st.vus.dev[d.k] = 0);
      st.vus.dev[d.k] = v | (d.x > 0 ? 1 : 2);
      if (st.vus.dev[d.k] === 3) st.app.incidence = true;
    });
    if (R.plans) {           // mêmes tirages : une raie floue, puis (ou avant) une raie nette au minimum
      var P2 = st.vus.plans && st.vus.plans.cle === R.plans.cle ? st.vus.plans : (st.vus.plans = { cle: R.plans.cle, flou: false, min: false });
      P2.flou = P2.flou || R.plans.flou; P2.min = P2.min || R.plans.min;
      if (P2.flou && P2.min) st.app.nets = true;
    }
    return MANIPS.filter(function (e) { return st.app[e.id] && !avant[e.id]; }).map(function (e) { return e.nom; });
  }
  // Étape visée par les indices : celle qu'on a choisie, sinon la première non atteinte, sinon la première non soignée.
  function cible(f, vise) {
    if (vise && (estManip(vise) || ETAPES.some(function (e) { return e.id === vise; }))) return vise;
    for (var i = 0; i < REGLAGES.length; i++) if (f[REGLAGES[i].id] !== true && f[REGLAGES[i].id] !== "soignee") return REGLAGES[i].id;
    for (i = 0; i < REGLAGES.length; i++) if (f[REGLAGES[i].id] !== "soignee") return REGLAGES[i].id;
    return null;     // réglé : les manipulations se choisissent, aucune n'est imposée
  }
  // Indice gradué : t1 = ce qu'il faut regarder et pourquoi, adapté à ce qu'on voit ; t2 = l'organe et le sens, jamais de valeur.
  // Parallaxe (sens vérifiés avec le cœur) : une image plus loin que le réticule SUIT l'œil ; image retour qui suit →
  // réticule trop loin de l'objectif (ε > 0) ; fente qui suit → fente trop loin de l'objectif du collimateur (e_C > 0).
  function indice(st, R, f, vise) {
    var c = cible(f, vise), d = R.d, soin = !!c && !!R.ok[c];
    if (!c) return { cle: "fini", t1: TRAD("Le goniomètre est réglé. Ne plus toucher aux tirages ; l'oculaire, lui, se règle à la vue de chacun. Les manipulations montrent ce qu'il permet de voir : en choisir une, les indices la viseront."), t2: TRAD("Bouton « Manipulations », en bas, après les réglages.") };
    var pre = f[c] === "dereglee" ? TRAD("« {0} » était réglée et ne l'est plus. ", [nomEtape(c)]) : "";
    function I(cle, t1, t2) { return { cle: c + "-" + cle, t1: pre + t1, t2: t2 || "" }; }
    var tourne = function (b) { return b > 0 ? TRAD("dans le sens des aiguilles d'une montre") : TRAD("dans le sens inverse des aiguilles d'une montre"); };
    if (c === "oculaire") {
      if (d.Pr < -GO_PDC2) return I("loin", TRAD("Le réticule est flou pour cet œil : son image est « au-delà de l'infini ». Enfoncer lentement l'oculaire et s'arrêter à la première netteté."),
        TRAD("Glisser l'oculaire vers l'objectif, par petits pas (Maj : plus fin)."));
      if (d.Pr > d.amp + GO_PDC2) return I("pres", TRAD("L'image du réticule est trop proche : même en accommodant, l'œil ne la voit pas nette. Tirer l'oculaire jusqu'au flou, puis l'enfoncer lentement jusqu'à la première netteté."),
        TRAD("Glisser l'oculaire vers l'œil."));
      if (d.Pr > SEUILS.acc) return I("force", TRAD("Le réticule n'est net qu'en accommodant fort : l'œil se fatigue vite. Tirer l'oculaire jusqu'au flou, puis l'enfoncer lentement jusqu'à la première netteté."),
        TRAD("Glisser l'oculaire vers l'œil, puis revenir lentement vers l'objectif."));
      return I("accommode", TRAD("Le réticule est net, mais l'œil accommode (indicateur sous le champ) : il se fatigue et le réglage dépend de son effort. Tirer l'oculaire jusqu'au flou, puis l'enfoncer lentement jusqu'à la première netteté."),
        TRAD("Glisser l'oculaire vers l'œil, puis revenir lentement vers l'objectif."));
    }
    if (c === "lunette") {
      if (st.plateau !== "miroir") return I("miroir", TRAD("Le tirage de la lunette se règle par autocollimation : poser le miroir plan sur la plate-forme, face à la lunette."), TRAD("Étagère, onglet Plate-forme : la carte « Miroir »."));
      if (!st.lampe_lunette) return I("lampe", TRAD("Éclairer le réticule : allumer la lampe latérale et baisser la lame semi-réfléchissante."), TRAD("Clic sur la petite lampe de la lunette : elle s'allume, la lame se baisse."));
      if (!d.retourChamp) return I("champ", TRAD("L'image retour n'est pas dans le champ : le miroir n'est pas perpendiculaire à la lunette. Tourner lentement la plate-forme en regardant le champ ; l'aide « Faisceau » montre où revient le faisceau."),
        TRAD("Tourner la plate-forme {0}.", [tourne(d.beta)]));
      if (!soin) return I("flou", TRAD("L'image retour est dans le champ : tourner le tirage jusqu'à voir nets ensemble le réticule et son image retour (cliquer sur l'un puis sur l'autre : l'œil ne doit presque pas accommoder)."),
        st.eps > 0 ? TRAD("Molette de tirage de la lunette : rapprocher le réticule de l'objectif.") : TRAD("Molette de tirage de la lunette : éloigner le réticule de l'objectif."));
      return I("parallaxe", TRAD("Nets ensemble ne suffit pas : déplacer l'œil dans le champ (Maj+glisser, ou flèches) jusqu'au bord du cercle oculaire, le champ agrandi au plus (+ au-dessus du champ). Si l'image retour bouge par rapport au réticule, ils ne sont pas dans le même plan."),
        d.dRet < 0 ? TRAD("L'image retour suit l'œil : elle est plus loin que le réticule. Rapprocher le réticule de l'objectif (molette de tirage).") :
        TRAD("L'image retour va contre l'œil : elle est plus près que le réticule. Éloigner le réticule de l'objectif (molette de tirage)."));
    }
    if (c === "collimateur") {
      if (!R.ok.lunette) return I("lunette", TRAD("La lunette n'est pas à l'infini{0}. Une fente nette dans son réticule ne dit alors rien du collimateur : régler d'abord la lunette par autocollimation, puis ne plus toucher à son tirage.",
        [f.lunette === "dereglee" ? TRAD(" : son tirage a bougé depuis son réglage") : ""]), "");
      if (!st.lampe) return I("lampe", TRAD("Allumer la lampe devant la fente du collimateur."), TRAD("Clic sur la lampe, ou sur sa pastille : « Allumer »."));
      if (st.plateau === "miroir") return I("miroir", TRAD("Ôter le miroir de la plate-forme : la lunette doit viser directement la fente à travers le collimateur."), TRAD("Étagère : un clic sur la carte du miroir, surlignée, le retire."));
      if (!d.fenteChamp) return I("champ", TRAD("Tourner la lunette face au collimateur, jusqu'à voir l'image de la fente dans le champ."),
        TRAD("Tourner la lunette {0}.", [tourne(st.phi)]));
      if (st.b > 0.3e-3) return I("fente", TRAD("La fente est très large : la fermer presque, son image nette se juge mieux."), TRAD("Molette de la fente."));
      if (!soin) return I("flou", TRAD("Tourner le tirage du collimateur jusqu'à voir la fente nette en même temps que le réticule, sans toucher au tirage de la lunette : c'est elle qui sert de référence de l'infini. Collimateur déréglé, les ordres du réseau ne seraient pas nets en même temps."),
        st.eC > 0 ? TRAD("Molette de tirage du collimateur : rapprocher la fente de l'objectif.") : TRAD("Molette de tirage du collimateur : éloigner la fente de l'objectif."));
      return I("parallaxe", TRAD("Déplacer l'œil dans le champ (Maj+glisser, ou flèches), le champ agrandi au plus : la fente ne doit pas bouger par rapport au réticule."),
        d.dFente < 0 ? TRAD("La fente suit l'œil : la rapprocher de l'objectif du collimateur (molette de tirage).") :
        TRAD("La fente va contre l'œil : l'éloigner de l'objectif du collimateur (molette de tirage)."));
    }
    // manipulations : le goniomètre doit être réglé (sauf « ordres nets ensemble », qui dérègle le collimateur)
    if (estManip(c) && c !== "nets" && (!R.ok.lunette || !R.ok.collimateur))
      return I("regler", TRAD("Pour cette manipulation, la lunette et le collimateur doivent être réglés à l'infini : sinon les raies ne sont pas nettes et les angles lus sont faux."),
        TRAD("Régler d'abord : étapes de la rangée du bas."));
    if (c === "normale") return I("m", TRAD("Les ordres +p et −p d'une raie ne sont symétriques par rapport à l'ordre 0 qu'en incidence normale, et l'écart grandit avec l'ordre (l'ordre 2 le montre mieux que l'ordre 1). Tourner la plate-forme jusqu'à cette symétrie, puis, sans plus y toucher, pointer la raie en +p et en −p : le demi-angle entre les deux pointés est θ, et une petite erreur d'incidence ne le fausse qu'au second ordre."),
      TRAD("Pointer : amener le fil vertical du réticule sur la raie (champ agrandi au plus), puis lâcher la lunette."));
    if (c === "mindev") return I("m", TRAD("Quand on tourne la plate-forme, une raie de l'ordre 1 se rapproche de l'ordre 0, s'arrête puis rebrousse chemin : c'est le minimum de déviation. La suivre à la lunette et la pointer là où elle s'arrête ; tourner ensuite la plate-forme vers la position symétrique et pointer le minimum dans l'ordre −1. L'angle entre les deux pointés vaut 2 D_m : la mesure ne passe ni par l'ordre 0 ni par la direction de la normale."),
      TRAD("Le minimum est plat : pas besoin d'être exactement dessus, à un ou deux degrés de plate-forme près la déviation change de moins d'une minute."));
    if (c === "incidence") return I("m", TRAD("La déviation ne change pas quand on échange les angles d'incidence et d'émergence (retour inverse de la lumière) : elle passe donc par un extremum quand ils sont égaux. Lunette fixe sur une raie de l'ordre 1, tourner lentement la plate-forme toujours dans le même sens : la raie se rapproche de l'ordre 0, s'arrête puis repart."),
      TRAD("Tourner la plate-forme loin de part et d'autre de la position où la raie s'arrête ; si la raie sort du champ, y ramener la lunette."));
    if (c === "recouvrement") return I("m", TRAD("Lumière blanche : chaque ordre étale le spectre du violet au rouge, d'autant plus loin de l'ordre 0 que l'ordre est élevé. Le violet de l'ordre 2 est dévié plus que le rouge de l'ordre 1, mais le violet de l'ordre 3 moins que le rouge de l'ordre 2 : ces deux ordres se chevauchent. Chercher le rouge de l'ordre 2 et le bleu de l'ordre 3 dans un même champ."),
      st.lampe !== "W" ? TRAD("Étagère : la carte « Halogène » (Lampes), sans filtre ; puis tourner la lunette au-delà du rouge de l'ordre 2.") :
      st.filtre ? TRAD("Retirer le filtre (Filtres et diaphragmes) : il ne laisse passer qu'une partie du spectre.") : TRAD("Tourner la lunette au-delà du rouge de l'ordre 2."));
    if (c === "nets") {
      if (Math.abs(st.eC) <= SEUILS.eC[0]) return I("m", TRAD("Collimateur réglé, la fente est à l'infini et ses images par le réseau aussi, dans tous les ordres. Collimateur déréglé, elles sont à distance finie, et le réseau change cette distance d'un ordre à l'autre : il multiplie les petits angles par cos i / cos θ, et les vergences par son carré. Dérégler le collimateur pour le voir."),
        TRAD("Molette de tirage du collimateur, nettement."));
      return I("m", TRAD("Collimateur déréglé, l'image de la fente n'est plus à l'infini et le réseau multiplie sa vergence par (cos i / cos θ)², différent d'un ordre à l'autre : régler la lunette sur un ordre, un autre est flou. Au minimum de déviation, cos i = cos θ : la raie est nette dans le plan de l'ordre 0."),
        TRAD("Mettre l'ordre 0 net avec la molette de tirage de la lunette, tourner la lunette vers l'ordre 2, puis la plate-forme jusqu'au minimum de déviation de cette raie, sans retoucher aux tirages."));
    }
    if (c === "fente") return I("m", TRAD("Plus la fente est fine, plus ses images sont fines et faciles à séparer, mais moins elles reçoivent de lumière. Doublet du sodium dans l'ordre 1 : ouvrir et fermer la fente, le doublet se fond puis se sépare."),
      st.lampe !== "Na" ? TRAD("Étagère : la carte « Sodium » (Lampes).") : TRAD("Molette de la fente."));
    if (c === "doublet") return I("m", TRAD("Lampe au sodium, ordre 1 ou 2 : la raie jaune est double. Fermer la fente jusqu'à voir les deux raies séparées (champ agrandi au plus)."), TRAD("À l'ordre 1, il faut une fente très fine ; à l'ordre 2, la séparation est 2,6 fois plus grande."));
    if (c === "resolution") return I("m", TRAD("Le pouvoir de résolution vaut N p, N étant le nombre de traits éclairés. Doublet séparé à l'ordre 1, poser un diaphragme de 1 mm devant le réseau : que devient la séparation, même en fermant la fente ?"),
      TRAD("Étagère : la carte « Réseau » (Plate-forme), puis « Diaphr. 1 mm » (Filtres et diaphragmes)."));
    if (c === "filtres") {
      var vus = Object.keys(FILTRES).filter(function (k) { return st.filtresVus && st.filtresVus[k]; }).map(function (k) { return FILTRES[k].nom; });
      return I("m", TRAD("Lampe halogène : observer le spectre continu dans l'ordre 1 à travers chacun des quatre filtres, et repérer les longueurs d'onde transmises."), vus.length ? TRAD("Déjà vus : {0}.", [vus.join(", ")]) : TRAD("Étagère : la carte « Halogène » (Lampes), puis un filtre (Filtres et diaphragmes)."));
    }
    // pret
    if (!R.ok.lunette || !R.ok.collimateur) return I("reglages", TRAD("La lunette et le collimateur doivent d'abord être réglés à l'infini."), "");
    if (st.lampe_lunette) return I("lame", TRAD("Éteindre la lampe latérale et relever la lame : baissée, elle prend la moitié de la lumière des raies."), TRAD("Clic sur la petite lampe de la lunette : elle s'éteint, la lame se relève."));
    if (st.plateau !== "reseau") return I("reseau", TRAD("Poser le réseau sur la plate-forme."), TRAD("Étagère, onglet Plate-forme : la carte « Réseau »."));
    if (!st.lampe) return I("lampe", TRAD("Allumer la lampe devant la fente."), TRAD("Clic sur la lampe, ou sur sa pastille : « Allumer »."));
    return I("fente", TRAD("Fermer la fente jusqu'à ce que les raies soient fines, mais encore bien lumineuses : fines, les raies voisines se séparent et le fil se centre mieux ; trop fermée, la fente n'envoie presque plus de lumière."), TRAD("Molette de la fente."));
  }
  var GO_PDC2 = 0.125;   // demi-profondeur de champ de l'œil (δ), celle du cœur (OEIL.pdc / 2)

  // ================= configurations types du mode prof =================
  // Le dérèglement caché (origines du cercle, poses du miroir et du réseau) est gardé : on règle par-dessus.
  // Oculaire au repos pour l'œil choisi : image du réticule au punctum remotum (Px = PR), par la méthode de Newton.
  function uRepos(st, GO) {
    var R = GO.YEUX[st.oeil.type][0], u = 0, k;
    function P(x) { var c = config(st); c.u = x; return GO.reticule(c, GO.lunette(c)).Px; }
    for (k = 0; k < 6; k++) { var p0 = P(u), d = (P(u + 1e-5) - p0) / 1e-5; u -= (p0 - R) / d; }
    return u;
  }
  function oeilAuCentre(st) { st.oeil.mode = "objet"; st.oeil.cible = "reticule"; st.oeil.h = [0, 0]; }
  function regle(st, GO) { st.u = uRepos(st, GO); st.eps = 0; st.eC = 0; st.b = 0.08e-3; st.lampe = "Hg"; st.filtre = null; st.diaph = null; st.zoom = 1; st.zc = [0, 0]; oeilAuCentre(st); }
  function miroirFace(st) { st.plateau = "miroir"; st.plat = wrap(st.phi - st.cache.offM); st.lampe_lunette = true; }
  function reseauA(st, psi) { st.plateau = "reseau"; st.plat = wrap(psi - st.cache.offR); st.lampe_lunette = false; }
  // direction (rad) d'une raie dans l'ordre p, réseau de normale psi (formule du cœur : direction = psi + θ)
  function devMinPrisme(GO, lam) { return 2 * Math.asin(GO.indicePrisme({}, lam) / 2) - Math.PI / 3; }
  function directionRaie(GO, lam, p, psi) { var a = 1e-3 / 600, s = -Math.sin(psi) + p * lam * 1e-9 / a; return psi + Math.asin(s); }
  var CONFIGS = [
    { id: "oculaire", nom: TRAD("Oculaire déréglé"), f: function (st, GO) { regle(st, GO); miroirFace(st); st.u = -1.5e-3; } },
    { id: "auto", nom: TRAD("Autocollimation floue"), f: function (st, GO) { regle(st, GO); miroirFace(st); st.eps = 0.8e-3; } },
    { id: "parallaxe", nom: TRAD("Parallaxe"), f: function (st, GO) { regle(st, GO); miroirFace(st); st.eps = 0.1e-3; st.zoom = 4; st.oeil.h = [1.5e-3, 0]; } },
    { id: "lunette", nom: TRAD("Lunette réglée"), f: function (st, GO) { regle(st, GO); miroirFace(st); } },
    // prisme : lunette sur la déviation minimale (546 nm), la plate-forme balaie ±12° autour (au-delà, réflexion totale)
    { id: "prisme", nom: TRAD("Prisme, minimum de déviation"), f: function (st, GO) { regle(st, GO); var Dm = devMinPrisme(GO, 546.074);
      st.plateau = "prisme"; st.lampe_lunette = false; st.plat = wrap(Math.PI / 2 - Dm / 2); st.phi = -Dm; st.lumiere = true; st.gros = true; },
      anime: { centre: function (GO) { return Math.PI / 2 - devMinPrisme(GO, 546.074) / 2; }, amp: 12 * DEG, T: 12000 } },
    // ----- situations des manipulations (manip: true, id = celui de MANIPS) : panneau « Manipulations », pour tous -----
    { id: "normale", manip: true, f: function (st, GO) { regle(st, GO); reseauA(st, 0); st.phi = directionRaie(GO, 546.074, 1, 0); } },
    // lunette fixe sur la direction du minimum (546 nm, ordre 1) ; l'interface fait balayer la plate-forme de ±20°
    // autour du minimum (onde triangulaire, `anime`) : la raie entre dans le champ, s'arrête au centre, rebrousse
    // chemin (écart quadratique : 4,3′ à 5°, ~1,1° à 20°, dans le champ réel de ±1,3°) ; un geste arrête l'animation.
    { id: "incidence", manip: true, f: function (st, GO) { regle(st, GO);
      var ps = Math.asin(546.074e-9 * 600e3 / 2); reseauA(st, ps); st.phi = directionRaie(GO, 546.074, 1, ps); },
      anime: { centre: Math.asin(546.074e-9 * 600e3 / 2), amp: 20 * DEG, T: 12000 } },
    { id: "mindev", manip: true, f: function (st, GO) { regle(st, GO);
      var ps = Math.asin(546.074e-9 * 600e3 / 2); reseauA(st, ps); st.phi = directionRaie(GO, 546.074, 1, ps); } },
    // lunette sur le rouge (650 nm) de l'ordre 2 : le bleu de l'ordre 3 (425-441 nm) est dans le même champ
    { id: "recouvrement", manip: true, f: function (st, GO) { regle(st, GO); st.lampe = "W"; reseauA(st, 0); st.phi = directionRaie(GO, 650, 2, 0); } },
    // collimateur ET lunette au point sur la fente (sinon l'ordre 0 non plus n'est pas dans le plan du réticule) :
    // ordre 0 net, ordre 2 flou (facteur (cos i / cos θ)²)
    { id: "nets", manip: true, f: function (st, GO) { regle(st, GO); st.eC = 1e-3; st.eps = -1e-3; reseauA(st, 0);
      st.phi = directionRaie(GO, 546.074, 2, 0); st.zoom = 2; } },
    { id: "doublet", manip: true, f: function (st, GO) { regle(st, GO); st.lampe = "Na"; reseauA(st, 0);
      st.phi = directionRaie(GO, 589.3, 1, 0); st.b = 0.04e-3; st.zoom = 4; } },
    { id: "fente", manip: true, f: function (st, GO) { regle(st, GO); st.lampe = "Na"; reseauA(st, 0);
      st.phi = directionRaie(GO, 589.3, 1, 0); st.b = 0.2e-3; st.zoom = 4; } },
    { id: "resolution", manip: true, f: function (st, GO) { regle(st, GO); st.lampe = "Na"; reseauA(st, 0);
      st.phi = directionRaie(GO, 589.3, 1, 0); st.b = 0.04e-3; st.diaph = 1e-3; st.zoom = 4; } },
    { id: "filtres", manip: true, f: function (st, GO) { regle(st, GO); st.lampe = "W"; st.filtre = "rouge"; reseauA(st, 0); st.phi = directionRaie(GO, 650, 1, 0); } }
  ];
  CONFIGS.forEach(function (c) { if (c.manip) c.nom = nomEtape(c.id); });

  var Goniometre = { DEG: DEG, PHI_MAX: PHI_MAX, BORNES: BORNES, H_MAX: H_MAX, dereglement: dereglement,
    etatDepart: etatDepart, psi: psi, config: config, vueDe: vueDe, lecture: lecture, verifierLecture: verifierLecture,
    tournerLunette: tournerLunette, wrap: wrap,
    N_PRISME: N_PRISME, prismeDirections: prismeDirections, RAIES: RAIES, INCONNUES: INCONNUES, NOMS_GAZ: NOMS_GAZ, FILTRES: FILTRES, spectre: spectre, continu: continu,
    SEUILS: SEUILS, ETAPES: ETAPES, MANIPS: MANIPS, EXPLO: EXPLO, analyse: analyse, faits: faits, cible: cible, indice: indice, constats: constats, POINTE: POINTE,
    CONFIGS: CONFIGS, uRepos: uRepos, directionRaie: directionRaie,
    rayonPrisme: rayonPrisme, ordresReseau: ordresReseau, couleursGrosPlan: couleursGrosPlan };
  if (typeof module !== "undefined" && module.exports) { module.exports = { Goniometre: Goniometre }; return; }

  // ======================================================================================================
  // ================= interface ==========================================================================
  // ======================================================================================================
  var P = root.VITRINE_PAILLASSE = root.VITRINE_PAILLASSE || { instruments: {} };
  var EXD = 12;                                // exagération de la convergence/divergence du faisceau du collimateur (dessin seul)
  var EX = 4;                                  // exagération des déplacements de tirage et d'oculaire sur le dessin
  var R_OBJ = 120, F_MM = 175, OC_MM = 25;     // dessin en mm
  // Luminosité du champ : st.luminosite = "reelle" (défaut) ou "visible".
  // Réelle : luminance équivalente de l'image rétinienne (lux × f_œil² / aire de la pupille ; elle vaut la luminance
  // de l'objet × la part utile T de la pupille) par `vision` du module couleur, adaptation et pupille stationnaire
  // mesurées sur le champ ENTIER (zoom 1 : agrandir n'est pas changer d'exposition ; définition : `definitionAdapt`), un œil.
  // Le niveau d'adaptation AFFICHÉ rejoint sa cible dans le temps (`lisser`), l'œil ne sautant pas d'un niveau à
  // l'autre : c'est la seule partie non stationnaire de la chaîne.
  // Toujours visible : exposition sur le 99e centile du même champ, réponse en L^COMP_VISIBLE.
  var COMP_VISIBLE = 0.5, ADAPT = 64, ADAPT_MAX = 1024;
  var NOMS_OEIL = { normal: "normal", myope: TRAD("myope"), hyper: TRAD("hypermétrope"), presbyte: TRAD("presbyte") };
  var TITRES_OEIL = { normal: TRAD("Œil normal : au repos, il voit net à l'infini."), myope: TRAD("Œil myope (2 δ) : au repos, il voit net à 50 cm."),
    hyper: TRAD("Œil hypermétrope (1 δ) : il accommode déjà pour voir net à l'infini."),
    presbyte: TRAD("Œil presbyte : net à l'infini au repos, mais il n'accommode presque plus (1 δ).") };
  var ORDRE_LAMPES = ["Hg", "Na", "Cd", "X", "W"];
  var LAMPES = { Hg: { court: TRAD("Mercure"), coul: "#c3ccff" }, Na: { court: "Sodium", coul: "#ffc23a" },
    Cd: { court: "Cadmium", coul: "#f2c6e0" }, X: { court: TRAD("Inconnue"), coul: "#ffb38a" }, W: { court: TRAD("Halogène"), coul: "#ffe2b0" } };
  function fmtNb(v, n) { return I18N ? I18N.nb(v, n) : v.toFixed(n).replace(".", ","); }
  function nomRaie(l) {
    return l < 425 ? TRAD("violette") : l < 470 ? TRAD("bleue") : l < 520 ? TRAD("bleu-vert") : l < 565 ? TRAD("verte") : l < 600 ? TRAD("jaune") : TRAD("rouge");
  }

  function creer(K) {
    var GO = root.VITRINE_GONIOMETRE, MI = root.VITRINE_MICHELSON, svg = K.svg, el = K.el;
    var mem = K.memoire.lire(), st;
    if (mem && mem.v === 1 && mem.cache && mem.oeil && mem.oeil.h) st = mem; else st = etatDepart(GRAINE_DEPART);
    function completer() {
      if (!st.cahier) st.cahier = [];
      if (!st.zoom) st.zoom = 1;
      if (!st.zc || st.zoom === 1) st.zc = [0, 0];
      if (!st.deja) st.deja = {};
      if (!st.cache.inc) st.cache.inc = INCONNUES[st.graine % INCONNUES.length];   // ancien état sauvé
      if (!LAMPES[st.lampe]) st.lampe = st.lampe ? "Hg" : null;
      if (!NOMS_OEIL[st.oeil.type]) st.oeil.type = "normal";
    }
    completer();
    var sale = { dessin: true, champ: true, lum: true, loupe: true, etagere: true, tete: true };
    var tourne = null;   // plate-forme animée (configuration « minimum de déviation ») : { centre, amp, T, t0 }
    var tModif = 0, fin = false, anim = null, V = null, CFG = null, vz = null, train = null;
    var SANS_ANNULER = ["cahier", "zoom", "zc", "lumiere", "gpCoul", "gpPlie", "deja", "app", "pointes", "filtresVus", "vus", "vise", "luminosite", "loupe", "gros"];
    // Pupille stationnaire de l'œil (mm) : tenue hors de l'état, posée dans CFG (la vue) seulement ; l'analyse des
    // étapes garde la pupille de 3 mm du cœur (ses seuils y sont calculés). Au plus 6 relances par geste.
    var PUP = 3, nPup = 0, AD = null, tAdapt = -1e9;
    // `relaxant` : l'image est refaite par la seule relaxation du niveau d'adaptation (`relaxe`). Le champ ne change
    // pas pendant ce temps, donc la cible n'est pas remesurée : sans ce drapeau, chaque image de la relaxation
    // relancerait un calcul de 1 à 35 ms (`definitionAdapt`).
    var relaxant = false;
    function maintenant() { return root.performance ? root.performance.now() : Date.now(); }
    function modifie(quoi) {
      tourne = null;                                   // un geste reprend la main sur la plate-forme animée
      (quoi || "dessin champ lum loupe").split(" ").forEach(function (q) { sale[q] = true; });
      tModif = maintenant(); fin = false; nPup = 0;
      K.modifie();
    }
    function couleur(l) {   // teinte d'une raie : sRGB normalisé au canal le plus fort
      var c = MI.rgbLin(MI.cie(l)), m = Math.max(c[0], c[1], c[2], 1e-30);
      return "rgb(" + c.map(function (v) { return Math.round(255 * MI.gammaS(Math.max(0, v) / m)); }).join(",") + ")";
    }

    // ================= vue de dessus =================
    var D = K.dessus;
    var defs = svg("defs", {}, D);
    defs.innerHTML =
      '<linearGradient id="plCylY" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3a4048"/><stop offset=".35" stop-color="#9aa3ad"/><stop offset=".6" stop-color="#6c747e"/><stop offset="1" stop-color="#2c3137"/></linearGradient>' +
      '<linearGradient id="plCylX" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a4048"/><stop offset=".35" stop-color="#9aa3ad"/><stop offset=".6" stop-color="#6c747e"/><stop offset="1" stop-color="#2c3137"/></linearGradient>' +
      '<linearGradient id="gnTube" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#262b32"/><stop offset=".3" stop-color="#5a636e"/><stop offset=".55" stop-color="#3c434d"/><stop offset="1" stop-color="#1d2126"/></linearGradient>' +
      '<linearGradient id="gnLaiton" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a4a2a"/><stop offset=".35" stop-color="#b69a5c"/><stop offset=".6" stop-color="#806b3d"/><stop offset="1" stop-color="#3d321d"/></linearGradient>' +
      '<radialGradient id="gnPlat" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#4a525d"/><stop offset="1" stop-color="#262b32"/></radialGradient>' +
      '<radialGradient id="gnSocle" cx=".45" cy=".4" r=".7"><stop offset="0" stop-color="#22262c"/><stop offset="1" stop-color="#121418"/></radialGradient>' +
      '<radialGradient id="gnTable" cx=".5" cy=".5" r=".75"><stop offset="0" stop-color="#191c21"/><stop offset="1" stop-color="#0a0b0d"/></radialGradient>' +
      '<radialGradient id="gnLueur"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".3" stop-color="#fff" stop-opacity=".45"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>' +
      '<filter id="plOmbre" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="1.6" dy="2.4" stdDeviation="2" flood-color="#000" flood-opacity=".75"/></filter>';
    // Cadre serré sur ce qui sert : la lampe (x ≈ −385) et la lunette jusqu'à ±58° environ (réseau à l'ordre 2 : 44°) ; au-delà (miroir seulement),
    // le bout de l'oculaire (rayon ≤ 376) déborde un peu en haut ou en bas. L'étagère est en bas à GAUCHE
    // (.gn-etagere) : la lunette ne passe derrière qu'au-delà de 120° de déviation.
    var VB = { x: -400, y: -330, w: 800, h: 660 };
    var gTable = svg("g", {}, D), gFixe = svg("g", {}, D), gColl = svg("g", {}, D), gPlat = svg("g", { class: "gn-tourne" }, D);
    var gObj = svg("g", { class: "gn-tourne" }, D), gLun = svg("g", {}, D);
    var gFaisceau = svg("g", { style: "mix-blend-mode:screen", "pointer-events": "none" }, D), gVis = svg("g", {}, D);
    svg("rect", { x: VB.x - 300, y: VB.y - 300, width: VB.w + 600, height: VB.h + 600, fill: "url(#gnTable)" }, gTable);
    function pt(r, a) { return { x: r * Math.cos(a), y: -r * Math.sin(a) }; }
    // repère de la lunette (x le long de son axe, vers l'oculaire) → dessin
    function versG(x, y) { var c = Math.cos(st.phi), s = Math.sin(st.phi); return { x: x * c + y * s, y: -x * s + y * c }; }
    function versL(p) { var c = Math.cos(st.phi), s = Math.sin(st.phi); return { x: p.x * c - p.y * s, y: p.x * s + p.y * c }; }
    function txt(par, x, y, t, cls, anc) { var z = svg("text", { x: x, y: y, class: cls || "pl-lab", "text-anchor": anc || "start" }, par); z.textContent = t; return z; }
    function xRet() { return R_OBJ + F_MM + st.eps / MM * EX; }           // réticule (dessin)
    function xOc() { return xRet() + OC_MM - st.u / MM * EX; }             // oculaire
    function xFente() { return -(R_OBJ + F_MM + st.eC / MM * EX); }

    function dessinerFixe() {   // socle et cercle gradué (ses traits suivent l'origine cachée du cercle)
      gFixe.innerHTML = "";
      svg("circle", { cx: 0, cy: 0, r: 150, fill: "url(#gnSocle)", stroke: "#2a2f37", "stroke-width": 1.5, filter: "url(#plOmbre)" }, gFixe);
      svg("circle", { cx: 0, cy: 0, r: 104, fill: "none", stroke: "#3b424c", "stroke-width": 16 }, gFixe);
      var d = "", o = st.cache.offV;
      for (var k = 0; k < 360; k++) {   // un trait par degré (dessin : les demi-degrés ne se voient qu'à la loupe)
        var a = (k - o) * DEG, L = k % 10 === 0 ? 9 : k % 5 === 0 ? 6 : 3.5, p1 = pt(112 - L, a), p2 = pt(112, a);
        d += "M" + p1.x.toFixed(2) + " " + p1.y.toFixed(2) + "L" + p2.x.toFixed(2) + " " + p2.y.toFixed(2);
      }
      svg("path", { d: d, stroke: "#8d96a2", "stroke-width": 0.6, fill: "none" }, gFixe);
      txt(gFixe, 0, 172, TRAD("goniomètre, vue de dessus"), "pl-lab", "middle");
    }
    // Collimateur (fixe, à gauche : la lumière sort vers la droite) ; la fente suit son tirage (exagéré).
    function dessinerColl() {
      gColl.innerHTML = "";
      var xf = xFente();
      svg("rect", { x: xf - 2, y: -13, width: -270 - xf + 2, height: 26, fill: "url(#gnTube)", stroke: "#15181c", "stroke-width": 0.8 }, gColl);
      svg("rect", { x: -285, y: -18, width: 165, height: 36, fill: "url(#gnTube)", stroke: "#15181c", "stroke-width": 0.8, filter: "url(#plOmbre)" }, gColl);
      svg("rect", { x: -134, y: -21, width: 16, height: 42, rx: 2, fill: "url(#gnLaiton)", stroke: "#2b2417", "stroke-width": 0.8 }, gColl);
      svg("rect", { x: xf - 4, y: -22, width: 7, height: 44, rx: 1.5, fill: "#3c434d", stroke: "#66707c", "stroke-width": 0.8 }, gColl);
      svg("line", { x1: xf, y1: -8, x2: xf, y2: 8, stroke: st.lampe ? LAMPES[st.lampe].coul : "#222", "stroke-width": Math.max(0.5, st.b / MM * 6) }, gColl);
      // lampe devant la fente (clic : le menu des lampes) et sa pastille dessous
      var xl = xf - 30, gL = svg("g", { "data-lampe": "1", style: "cursor:pointer" }, gColl);
      svg("rect", { x: xl - 22, y: -24, width: 40, height: 48, rx: 7, fill: "#262b32", stroke: "#4b525d", "stroke-width": 1, filter: "url(#plOmbre)" }, gL);
      if (st.lampe) {
        svg("circle", { cx: xl - 2, cy: 0, r: 30, fill: LAMPES[st.lampe].coul, opacity: 0.2, style: "mix-blend-mode:screen", "pointer-events": "none" }, gL);
        svg("circle", { cx: xl - 2, cy: 0, r: 9, fill: LAMPES[st.lampe].coul, opacity: 0.8 }, gL);
      }
      var py = 66, gP = svg("g", { "data-lampe": "1", "data-past": "lampe", class: "gn-past", style: "cursor:pointer" }, gColl);
      svg("path", { d: "M" + (xl - 2) + " 26V" + (py - 18), stroke: "#4b525d", "stroke-width": 1, "stroke-dasharray": "2 2" }, gP);
      svg("circle", { cx: xl - 2, cy: py, r: 18, fill: "#0b0d10", stroke: "#4b525d", "stroke-width": 1 }, gP);
      svg("g", { transform: "translate(" + (xl - 17) + " " + (py - 15) + ") scale(.75)" }, gP).innerHTML = K.Dessin.miniature(figLampe());
      txt(gP, xl - 2, py + 32, st.lampe ? LAMPES[st.lampe].court : TRAD("Éteinte"), "pl-lab", "middle");
      txt(gColl, -200, -26, TRAD("collimateur"), "pl-lab", "middle");
    }
    // miniature de la lampe (module Dessin) : sa lueur, « ? » pour l'inconnue, grise éteinte
    var MED = { Hg: "mercure", Na: "sodium", Cd: "cadmium", X: "inconnue", W: "lanterne" };
    function figLampe() { return st.lampe ? { med: MED[st.lampe] } : { med: "eteinte", inconnue: st.lampeAvant === "X" }; }
    function mettreLampe(k) {
      if (k) { st.lampe = k; st.lampeAvant = k; }   // filtre et diaphragme gardés : sans effet hors halogène, hors réseau
      else { if (st.lampe) st.lampeAvant = st.lampe; st.lampe = null; }
      sale.etagere = sale.tete = true; modifie("dessin champ lum loupe");
    }
    function menuLampe(x, y) {
      K.ouvrirCtx(x, y, [{ tit: TRAD("Lampe") }].concat(ORDRE_LAMPES.map(function (k) {
        return { lab: LAMPES[k].court, coche: st.lampe === k, act: function () { mettreLampe(k); } };
      })).concat([{ sep: true }, st.lampe ? { lab: TRAD("Éteindre"), act: function () { mettreLampe(null); } }
        : { lab: TRAD("Allumer"), act: function () { mettreLampe(st.lampeAvant || "Hg"); } }]));
    }
    gColl.addEventListener("click", function (ev) {
      var g = ev.target.closest && ev.target.closest("[data-lampe]"); if (!g) return;
      var r = g.getBoundingClientRect(); menuLampe(r.right + 4, r.top);
    });
    gColl.addEventListener("contextmenu", function (ev) {
      if (!(ev.target.closest && ev.target.closest("[data-lampe]"))) return;
      ev.preventDefault(); menuLampe(ev.clientX, ev.clientY);
    });
    // Plate-forme (tourne) et l'objet posé dessus (normale à psi).
    function dessinerPlat() {
      gPlat.innerHTML = "";
      gPlat.setAttribute("transform", "rotate(" + (-st.plat / DEG) + ")");
      svg("circle", { cx: 0, cy: 0, r: 56, fill: "url(#gnPlat)", stroke: "#59616d", "stroke-width": 1.2, filter: "url(#plOmbre)" }, gPlat);
      [0, 120, 240].forEach(function (a) { var p = pt(44, (a + 30) * DEG); svg("circle", { cx: p.x, cy: p.y, r: 4, fill: "#2a2f36", stroke: "#6b7480", "stroke-width": 0.7 }, gPlat); });
      svg("line", { x1: 50, y1: 0, x2: 56, y2: 0, stroke: "#c9a64a", "stroke-width": 1.6 }, gPlat);
      gObj.innerHTML = "";
      gObj.setAttribute("transform", "rotate(" + (-psi(st) / DEG) + ")");
      if (st.plateau === "reseau") {
        svg("rect", { x: -6, y: -27, width: 12, height: 6, fill: "#4b535d" }, gObj);
        svg("rect", { x: -6, y: 21, width: 12, height: 6, fill: "#4b535d" }, gObj);
        svg("rect", { x: -1.6, y: -23, width: 3.2, height: 46, fill: "#9fc6da", "fill-opacity": 0.7, stroke: "#cfe6f2", "stroke-width": 0.5 }, gObj);
        txt(gObj, 0, 40, TRAD("réseau"), "pl-lab", "middle");
      } else if (st.plateau === "miroir") {
        svg("rect", { x: -5, y: -28, width: 4, height: 56, fill: "#3a414b" }, gObj);
        svg("rect", { x: -1, y: -27, width: 3, height: 54, fill: "#e4eaf0", stroke: "#9aa5b0", "stroke-width": 0.5 }, gObj);
        txt(gObj, 0, 42, TRAD("miroir plan"), "pl-lab", "middle");
      } else if (st.plateau === "prisme") {   // sommet 0 dans la direction psi (repère de l'objet), cf. geomPrisme
        var rc = GO.APPAREIL.Lp / MM / Math.sqrt(3), som = [0, 1, 2].map(function (k) { return pt(rc, 2 * Math.PI * k / 3); });
        svg("polygon", { points: som.map(function (q) { return q.x.toFixed(2) + "," + q.y.toFixed(2); }).join(" "),
          fill: "#9fc6da", "fill-opacity": 0.28, stroke: "#cfe6f2", "stroke-width": 0.8, "stroke-linejoin": "round" }, gObj);
        txt(gObj, 0, 40, "prisme", "pl-lab", "middle");
      }
    }
    // Lunette (tourne autour de l'axe) : bras, tube, tirage, lampe latérale et lame, oculaire qui coulisse.
    var gLunT = svg("g", {}, gLun), gOc = null, gTube = null;
    function dessinerLunette() {
      gLunT.innerHTML = "";
      gLunT.setAttribute("transform", "rotate(" + (-st.phi / DEG) + ")");
      var xr = xRet(), xo = xOc();
      gTube = svg("g", { class: "gn-tourne" }, gLunT);
      svg("rect", { x: 18, y: -8, width: 118, height: 16, rx: 3, fill: "#343a43", stroke: "#4c545f", "stroke-width": 0.8 }, gTube);
      svg("rect", { x: 96, y: -10, width: 16, height: 20, rx: 1.5, fill: "#14181e", stroke: "#e0b84c", "stroke-width": 1 }, gTube);   // fenêtre du vernier
      svg("rect", { x: 132, y: -18, width: 154, height: 36, fill: "url(#gnTube)", stroke: "#15181c", "stroke-width": 0.8, filter: "url(#plOmbre)" }, gTube);
      svg("rect", { x: 118, y: -21, width: 16, height: 42, rx: 2, fill: "url(#gnLaiton)", stroke: "#2b2417", "stroke-width": 0.8 }, gTube);
      svg("rect", { x: 270, y: -14, width: xr + 6 - 270, height: 28, fill: "url(#gnTube)", stroke: "#15181c", "stroke-width": 0.8 }, gTube);
      // lampe latérale et lame semi-réfléchissante (baissée quand la lampe éclaire le réticule)
      var xl = xr - 14;
      if (st.lampe_lunette) svg("line", { x1: xl - 7, y1: -11, x2: xl + 7, y2: 11, stroke: "#bfe6f5", "stroke-width": 1.2, "stroke-opacity": 0.8 }, gTube);
      else svg("line", { x1: xl - 7, y1: -12.5, x2: xl + 7, y2: -12.5, stroke: "#bfe6f5", "stroke-width": 1, "stroke-opacity": 0.5 }, gTube);
      svg("line", { x1: xr, y1: -13, x2: xr, y2: 13, stroke: "#d7dde4", "stroke-width": 0.5, "stroke-opacity": 0.6 }, gTube);   // réticule
      // petite lampe du réticule, hors du tube (pas de glisser) : clic = réticule éclairé ↔ lame relevée
      var gR = svg("g", { "data-ret": "1", style: "cursor:pointer" }, gLunT);
      svg("rect", { x: xl - 11, y: 12, width: 22, height: 30, fill: "transparent" }, gR);
      svg("rect", { x: xl - 6, y: 14, width: 12, height: 20, rx: 2, fill: "#2b3038", stroke: st.lampe_lunette ? "#e0b84c" : "#6b7480", "stroke-width": 0.9 }, gR);
      if (st.lampe_lunette) {
        svg("circle", { cx: xl, cy: 30, r: 14, fill: "#ffd9a6", opacity: 0.25, style: "mix-blend-mode:screen" }, gR);
        svg("circle", { cx: xl, cy: 30, r: 3.5, fill: "#ffe3b8" }, gR);
      } else svg("circle", { cx: xl, cy: 30, r: 3, fill: "#3a414a" }, gR);
      // oculaire (on le fait coulisser)
      gOc = svg("g", { class: "gn-oc" }, gLunT);
      svg("rect", { x: xr + 4, y: -11, width: xo + 12 - (xr + 4), height: 22, rx: 2, fill: "url(#gnTube)", stroke: "#1b1f24", "stroke-width": 0.8 }, gOc);
      svg("rect", { x: xo + 8, y: -13, width: 8, height: 26, rx: 2.5, fill: "#22262c", stroke: "#5a636e", "stroke-width": 0.8 }, gOc);
      for (var i = 0; i < 6; i++) svg("line", { x1: xo - 8 + 2.6 * i, y1: -11, x2: xo - 8 + 2.6 * i, y2: 11, stroke: "#1b1f24", "stroke-width": 0.6 }, gOc);
      var lab = versG((132 + 286) / 2, -26);
      var t = gLun.querySelector(".gn-nom-lun") || svg("text", { class: "pl-lab gn-nom-lun", "text-anchor": "middle" }, gLun);
      t.setAttribute("x", lab.x); t.setAttribute("y", lab.y); t.textContent = TRAD("lunette");
      brancherLunette();
    }
    function basculerReticule() { st.lampe_lunette = !st.lampe_lunette; modifie("dessin champ lum loupe"); }
    gLun.addEventListener("click", function (ev) { if (ev.target.closest && ev.target.closest("[data-ret]")) basculerReticule(); });
    var VIS = {};
    function visL(id, o) { VIS[id] = K.vis(gVis, o); VIS[id].g.setAttribute("data-vis", id); return VIS[id]; }
    // molettes : tirage de la lunette (crémaillère), tirage du collimateur, largeur de fente
    visL("tL", { nom: TRAD("tirage"), lx: 0, ly: 17, x: 0, y: 0, diam: 14, long: 10, axe: "y", stries: 14,
      pos: function () { return versG(215, 25); }, rot: function () { return -st.phi / DEG; },
      tours: function () { return st.eps / PAS_TIRAGE; }, pasMolette: [1 / 40, 1 / 400],
      tourner: function (dt) { st.eps = clamp(st.eps + dt * PAS_TIRAGE, BORNES.eps[0], BORNES.eps[1]); modifie(); } });
    visL("tC", { nom: TRAD("tirage"), lx: 0, ly: 19, x: -215, y: 25, diam: 14, long: 10, axe: "y", stries: 14,
      tours: function () { return st.eC / PAS_TIRAGE; }, pasMolette: [1 / 40, 1 / 400],
      tourner: function (dt) { st.eC = clamp(st.eC + dt * PAS_TIRAGE, BORNES.eC[0], BORNES.eC[1]); modifie("dessin champ lum"); } });
    visL("fe", { nom: TRAD("fente"), lx: 0, ly: -12, x: 0, y: 0, diam: 12, long: 9, axe: "y", stries: 12, repere: true,
      pos: function () { return { x: xFente() - 0.5, y: -31 }; },
      tours: function () { return st.b / PAS_FENTE; }, pasMolette: [1 / 50, 1 / 500],
      tourner: function (dt) { st.b = clamp(st.b + dt * PAS_FENTE, BORNES.b[0], BORNES.b[1]); modifie("dessin champ lum"); } });

    // ----- gestes : rotations au glisser, oculaire qui coulisse -----
    function angle(p) { return Math.atan2(-p.y, p.x); }
    function tournerPlat(d) { st.plat = wrap(st.plat + d); modifie(); }
    function debutRot(p) { return { a: angle(p) }; }
    function glisserRot(quoi) {
      return function (p, ev, g) {
        var a = angle(p), d = wrap(a - g.etat.a);
        g.etat.a = a;
        if (ev.shiftKey) d *= (ev.ctrlKey || ev.metaKey) ? 0.01 : 0.1;
        if (quoi === "lun") { tournerLunette(st, d); modifie(); } else tournerPlat(d);
      };
    }
    K.glisser(gPlat, glisserRot("plat"), debutRot);
    K.glisser(gObj, glisserRot("plat"), debutRot);
    function brancherLunette() {   // le tube et l'oculaire sont redessinés : rebrancher leurs gestes
      K.glisser(gTube, glisserRot("lun"), debutRot);
      K.glisser(gOc, function (p, ev, g) {
        var c = Math.cos(st.phi), s = Math.sin(st.phi), dl = (p.x - g.etat.p.x) * c - (p.y - g.etat.p.y) * s;   // le long de l'axe
        g.etat.p = p;
        // démultiplié : l'oculaire avance quatre fois moins que la main (sinon 0,3 mm par pixel, la netteté se joue à 0,05 mm)
        st.u = clamp(st.u - dl / EX * MM * (ev.shiftKey ? ((ev.ctrlKey || ev.metaKey) ? 0.0025 : 0.025) : 0.25), BORNES.u[0], BORNES.u[1]);
        modifie();
      }, function (p) { return { p: p }; });
    }
    // ----- molette : sur la plate-forme ou la lunette, 10′ par cran (Maj : 1′, Ctrl+Maj : 0,1′, Ctrl : 100′) ; sur l'oculaire -----
    function pasRot(k, ev) { return k * (ev.shiftKey ? ((ev.ctrlKey || ev.metaKey) ? 0.1 : 1) : ev.ctrlKey ? 100 : 10) / 60 * DEG; }
    K.zoneMolette(function (p) {
      for (var k in VIS) { var q = VIS[k].o.pos ? VIS[k].o.pos() : VIS[k].o; if (Math.hypot(p.x - q.x, p.y - q.y) < 13) return null; }
      if (Math.hypot(p.x, p.y) < 60) return function (k, ev) { tournerPlat(pasRot(k, ev)); };
      var l = versL(p), xr = xRet(), xo = xOc();
      if (l.x > xr + 3 && l.x < xo + 17 && Math.abs(l.y) < 14) return function (k, ev) {
        st.u = clamp(st.u + k * (ev.shiftKey ? ((ev.ctrlKey || ev.metaKey) ? 0.0002 : 0.002) : ev.ctrlKey ? 0.1 : 0.02) * MM, BORNES.u[0], BORNES.u[1]); modifie();
      };
      if (l.x > 16 && l.x < xo + 17 && Math.abs(l.y) < 22) return function (k, ev) { tournerLunette(st, pasRot(k, ev)); modifie(); };
      return null;
    });

    // ================= « Voir la lumière » =================
    function poly(par, pts, coul, op) {
      svg("polygon", { points: pts.map(function (q) { return q.x.toFixed(2) + "," + q.y.toFixed(2); }).join(" "), fill: coul, "fill-opacity": op }, par);
    }
    function bande(par, a, r1, r2, w1, w2, coul, op, cy) {   // faisceau le long de la direction a (dessin global)
      var u = { x: Math.cos(a), y: -Math.sin(a) }, n = { x: Math.sin(a), y: Math.cos(a) }, c = cy || 0;
      poly(par, [{ x: u.x * r1 + n.x * (c + w1 / 2), y: u.y * r1 + n.y * (c + w1 / 2) }, { x: u.x * r2 + n.x * (c + w2 / 2), y: u.y * r2 + n.y * (c + w2 / 2) },
        { x: u.x * r2 + n.x * (c - w2 / 2), y: u.y * r2 + n.y * (c - w2 / 2) }, { x: u.x * r1 + n.x * (c - w1 / 2), y: u.y * r1 + n.y * (c - w1 / 2) }], coul, op);
    }
    function polyL(par, pts, coul, op) { poly(par, pts.map(function (q) { return versG(q.x, q.y); }), coul, op); }
    // dans la lunette : faisceau capté [y1, y2] sur l'objectif → image (xi, yi) → oculaire → sortie vers l'œil
    function dansLunette(par, y1, y2, xi, yi, coul, op) {
      var xo = xOc(), k = (xo - xi) / Math.max(20, xi - R_OBJ), w = (y2 - y1) * OC_MM / F_MM;
      polyL(par, [{ x: R_OBJ + 6, y: y1 }, { x: xi, y: yi }, { x: R_OBJ + 6, y: y2 }], coul, op);
      polyL(par, [{ x: xi, y: yi }, { x: xo, y: yi + (y2 - yi) * k }, { x: xo, y: yi + (y1 - yi) * k }], coul, op);
      polyL(par, [{ x: xo, y: -w / 2 }, { x: xo + 45, y: -w / 2 }, { x: xo + 45, y: w / 2 }, { x: xo, y: w / 2 }], coul, op * 0.9);
    }
    function dessinerFaisceaux() {
      gFaisceau.innerHTML = "";
      if (!st.lumiere || !V) return;
      var xf = xFente(), b = Math.max(0.6, st.b / MM * 6);
      var cs = st.lampe ? LAMPES[st.lampe].coul : null, ps = psi(st);
      // Faisceau du collimateur : largeur 30 mm sur l'objectif, puis 30·(1 − d·e_C/f²) à la distance d (fente trop loin → converge,
      // trop près → diverge). Effet réel ~0,1 mm sur tout le trajet : exagéré ×EXD pour être visible (comme les tirages ×EX).
      // facteur de largeur à la distance d de l'objectif du collimateur (suivi le long des faisceaux diffractés, le réseau ne fait que dévier), borné
      var facColl = function (d) { return Math.max(0.6, Math.min(1.4, 1 - d * (st.eC / MM) * EXD / (F_MM * F_MM))); };
      var wColl = 30 * facColl(R_OBJ);
      if (cs) {
        poly(gFaisceau, [{ x: xf, y: -b / 2 }, { x: -R_OBJ - 4, y: -15 }, { x: -R_OBJ - 4, y: 15 }, { x: xf, y: b / 2 }], cs, 0.22);
        if (st.plateau === "miroir") {
          bande(gFaisceau, Math.PI, 0, R_OBJ, wColl, 30, cs, 0.18);
          // réfléchi par le miroir (hors du modèle du champ) : le miroir plan garde la convergence, la largeur continue de suivre
          // la distance parcourue depuis l'objectif du collimateur
          bande(gFaisceau, 2 * ps + Math.PI, 0, 260, wColl, 30 * facColl(R_OBJ + 260), cs, 0.06);
        } else if (st.plateau === "prisme") {   // du collimateur jusqu'aux faces éclairées seulement
          var GP = GO.geomPrisme(CFG);
          for (var k = 0; k < 3; k++) {
            var A = GP.S[k], Bq = GP.S[(k + 1) % 3];
            if (GP.N[k][0] >= 0) continue;
            var ya = Math.max(Math.min(A[1], Bq[1]), -0.015), yb = Math.min(Math.max(A[1], Bq[1]), 0.015);
            if (yb <= ya) continue;
            var ea = GO.pt(A, Bq, (ya - A[1]) / (Bq[1] - A[1])), eb = GO.pt(A, Bq, (yb - A[1]) / (Bq[1] - A[1]));
            poly(gFaisceau, [{ x: -R_OBJ - 4, y: -ya / MM }, { x: ea[0] / MM, y: -ea[1] / MM }, { x: eb[0] / MM, y: -eb[1] / MM },
              { x: -R_OBJ - 4, y: -yb / MM }], cs, 0.22);
          }
        } else bande(gFaisceau, Math.PI, 0, R_OBJ, wColl, 30, cs, 0.22);
      }
      V.objets.forEach(function (o) {
        if (o.type !== "raie" || o.I < 0.004) return;
        if (continu(st) && Math.abs(o.lam / 10 - Math.round(o.lam / 10)) > 1e-6) return;
        var ci = Math.cos(GO.wrapDroite(ps)), Wg = st.plateau === "reseau" ? Math.min(30 / ci, 40) : 30, W = Wg * Math.cos(o.theta);
        var coul = o.p === 0 && (st.lampe === "Hg" || continu(st)) ? "#dfe4ff" : couleur(o.lam), op = Math.min(0.3, 0.05 + 0.3 * o.I);
        // prisme : faisceau dans le verre entre ses bords sur les deux faces, puis sortie décalée de l'axe (decal)
        var r0 = 0, dec = 0;
        if (o.trajet) {
          var e = o.trajet.e, sq = o.trajet.s, Mx = (sq[0][0] + sq[1][0]) / 2, My = (sq[0][1] + sq[1][1]) / 2;
          W = o.W / MM; dec = o.decal / MM; r0 = (Mx * Math.cos(o.direction) + My * Math.sin(o.direction)) / MM;
          poly(gFaisceau, [e[0], e[1], sq[1], sq[0]].map(function (q) { return { x: q[0] / MM, y: -q[1] / MM }; }), coul, op);
        }
        if (o.Wcap > 0) {
          var fc = o.trajet ? function () { return 1; } : facColl;
          bande(gFaisceau, o.direction, r0, R_OBJ / Math.cos(o.alpha), W * fc(R_OBJ + r0), W * fc(R_OBJ + R_OBJ / Math.cos(o.alpha)), coul, op, -dec);
          // repère de la lunette : centre du faisceau sur l'objectif à −α·R_OBJ (− décalage), image sur le rayon passant par le centre
          var y1 = Math.max(-o.alpha * R_OBJ - dec - W / 2, -15), y2 = Math.min(-o.alpha * R_OBJ - dec + W / 2, 15);
          var di = o.Delta != null ? o.Delta : 0, xi = R_OBJ + F_MM + (st.eps - di) / MM * EX, yi = -o.alpha * (xi - R_OBJ);
          if (y2 > y1) dansLunette(gFaisceau, y1, y2, xi, yi, coul, Math.min(0.42, op * 1.6));
        } else bande(gFaisceau, o.direction, r0, 420, W * (o.trajet ? 1 : facColl(R_OBJ + r0)), W * (o.trajet ? 1 : facColl(R_OBJ + 420)), coul, op, -dec);
      });
      if (st.lampe_lunette && st.plateau === "miroir") {   // autocollimation : aller vers le miroir, retour à 2β
        var rr = V.objets[1], beta = rr.beta, xr = xRet(), cr = "#ffcf96";
        polyL(gFaisceau, [{ x: xr - 14, y: -4 }, { x: R_OBJ + 6, y: -15 }, { x: R_OBJ + 6, y: 15 }, { x: xr - 14, y: 4 }], cr, 0.18);
        bande(gFaisceau, st.phi, 0, R_OBJ, 30, 30, cr, 0.14);
        var aR = st.phi + 2 * beta, dec = -Math.tan(2 * beta) * R_OBJ;
        if (Math.abs(dec) < 30) {
          bande(gFaisceau, aR, 0, R_OBJ / Math.cos(2 * beta), 30, 30, cr, 0.14);
          var y1 = Math.max(dec - 15, -15), y2 = Math.min(dec + 15, 15), xi = R_OBJ + F_MM + (st.eps - rr.Delta) / MM * EX;
          if (y2 > y1) dansLunette(gFaisceau, y1, y2, xi, -2 * beta * (xi - R_OBJ), cr, 0.3);
        } else bande(gFaisceau, aR, 0, 420, 30, 30, cr, 0.14);
      }
    }
    // Loupe sur le réticule : longueurs le long de l'axe dilatées ; pointe du cône de lumière, réticule, plan vu net.
    var gauche = D.parentNode;
    var LR = el("div", "gn-loupe-ret", gauche); LR.hidden = true;
    var LRs = svg("svg", { viewBox: "0 0 300 140" }, LR);
    function dessinerLoupeRet() {
      if (!st.loupe || !V) return;
      var K2 = 30, xr = 160, y0 = 62, h = LRs, pente = 34 / 120;
      h.innerHTML = "";
      svg("rect", { x: 0, y: 0, width: 300, height: 140, rx: 8, fill: "#0c0e11" }, h);
      var ob = null;
      if (st.plateau === "miroir" && st.lampe_lunette) ob = V.objets[1];
      else V.objets.forEach(function (o) { if (o.type === "raie" && o.I > 0.004 && o.Wcap > 0 && o.Delta != null && (!ob || Math.abs(o.X) < Math.abs(ob.X))) ob = o; });
      if (ob) {
        var coul = ob.type === "retour" ? "#ffcf96" : ob.p === 0 && (st.lampe === "Hg" || continu(st)) ? "#dfe4ff" : couleur(ob.lam);
        // cône convergent venant de l'objectif (gauche), pointe = image, puis cône divergent vers l'oculaire
        var xt = xr - ob.Delta / MM * K2, xtc = clamp(xt, -400, 700);
        svg("polygon", { points: "0," + (y0 - xtc * pente) + " " + xtc + "," + y0 + " 0," + (y0 + xtc * pente), fill: coul, "fill-opacity": 0.24 }, h);
        svg("polygon", { points: xtc + "," + y0 + " 300," + (y0 - (300 - xtc) * pente) + " 300," + (y0 + (300 - xtc) * pente), fill: coul, "fill-opacity": 0.12 }, h);
        if (xt > 0 && xt < 300) svg("circle", { cx: xt, cy: y0, r: 2.6, fill: coul }, h);
        txt(h, clamp(xt, 40, 260), 14, ob.type === "retour" ? TRAD("image retour") : TRAD("image de la fente"), "gn-lr-t", "middle").setAttribute("fill", coul);
      } else txt(h, 150, 16, TRAD("aucune lumière n'entre dans la lunette"), "gn-lr-n", "middle");
      // réticule (nom à droite du trait) et plan vu net par l'œil (nom à gauche du sien) : jamais l'un sur l'autre
      svg("line", { x1: xr, y1: y0 - 40, x2: xr, y2: y0 + 40, stroke: "#e8e0d0", "stroke-width": 2 }, h);
      txt(h, xr + 5, y0 + 38, TRAD("réticule"), "gn-lr-r", "start");
      var xn = xr - GO.deltaDeP(CFG, V.Pf) / MM * K2;
      if (xn > 4 && xn < 296) {
        svg("line", { x1: xn, y1: y0 - 34, x2: xn, y2: y0 + 34, stroke: "#7fb8ff", "stroke-width": 1.3, "stroke-dasharray": "4 3" }, h);
        txt(h, xn - 5, y0 + 30, TRAD("vu net par l'œil"), "gn-lr-o", "end");
      } else txt(h, xn <= 4 ? 6 : 294, y0 + 30, TRAD("vu net par l'œil : hors de la loupe"), "gn-lr-o", xn <= 4 ? "start" : "end");
      txt(h, 6, 118, TRAD("← objectif"), "gn-lr-n", "start"); txt(h, 294, 118, TRAD("oculaire →"), "gn-lr-n", "end");
      txt(h, 150, 133, TRAD("loupe sur le réticule : longueurs le long de l'axe dilatées"), "gn-lr-n", "middle");
    }

    // Gros plan sur la plate-forme (prisme ou réseau) : rayons du collimateur tracés à l'échelle, une couleur au choix
    // ou plusieurs superposées (couleursGrosPlan). Le panneau laisse passer les gestes vers la vue de dessus, sauf
    // sa rangée de pastilles.
    // Le titre replie le panneau (il peut cacher la lunette tournée vers le haut).
    var GP = el("div", "gn-gros-plan", gauche); GP.hidden = true;
    var GPt = el("div", "gn-gp-t", GP);
    var GPs = svg("svg", { viewBox: "0 0 300 200" }, GP);
    var GPc = el("div", "gn-gp-c", GP), clePastilles = "";
    var KG = 300 / 0.09, CXG = 115, CYG = 100;   // px par mètre (9 cm de large), centre de la plate-forme
    function gx(p) { return CXG + p[0] * KG; }
    function gy(p) { return CYG - p[1] * KG; }
    function ligneG(par, a, b, coul, op, lw, tir) {
      var o = { x1: gx(a).toFixed(1), y1: gy(a).toFixed(1), x2: gx(b).toFixed(1), y2: gy(b).toFixed(1), stroke: coul, "stroke-opacity": op, "stroke-width": lw };
      if (tir) o["stroke-dasharray"] = tir;
      return svg("line", o, par);
    }
    function bordG(a, m) {   // point où la demi-droite issue du centre dans la direction a sort du cadre (marge m px)
      var u = [Math.cos(a), -Math.sin(a)], t = 1e9;
      if (u[0] > 1e-9) t = Math.min(t, (300 - m - CXG) / u[0]); if (u[0] < -1e-9) t = Math.min(t, (m - CXG) / u[0]);
      if (u[1] > 1e-9) t = Math.min(t, (200 - m - CYG) / u[1]); if (u[1] < -1e-9) t = Math.min(t, (m - CYG) / u[1]);
      return { x: CXG + t * u[0], y: CYG + t * u[1] };
    }
    function pastilles(L) {
      var cle = (st.lampe || "") + "|" + L.join(",") + "|" + st.gpCoul;
      if (cle === clePastilles) return;
      clePastilles = cle; GPc.innerHTML = "";
      el("span", "gn-gp-l", GPc, L.length > 1 ? "Couleurs" : "Couleur");
      if (L.length > 1) {
        var bt = el("button", "pl-puce", GPc, "Toutes"); bt.type = "button";
        bt.setAttribute("aria-pressed", L.indexOf(st.gpCoul) < 0 ? "true" : "false");
        bt.addEventListener("click", function () { st.gpCoul = null; sale.lum = true; K.modifie(); });
      }
      L.forEach(function (l) {
        var b = el("button", "pl-puce gn-gp-p", GPc); b.type = "button";
        b.title = st.lampe === "W" ? TRAD("Lumière {0}", [nomRaie(l)]) : TRAD("Raie {0}", [nomRaie(l)]);
        b.setAttribute("aria-pressed", L.length === 1 || st.gpCoul === l ? "true" : "false");
        el("span", "gn-gp-d", b).style.background = couleur(l);
        b.addEventListener("click", function () { st.gpCoul = l; sale.lum = true; K.modifie(); });
      });
    }
    function dessinerGrosPlan() {
      if (!st.gros) return;
      var vu = st.plateau === "prisme" || st.plateau === "reseau", prisme = st.plateau === "prisme";
      GPt.textContent = !vu ? TRAD("Rien à montrer de près : poser le réseau ou le prisme sur la plate-forme.") :
        prisme ? TRAD("Prisme, à l'échelle") : TRAD("Réseau, à l'échelle · nombres : ordres de diffraction");
      GPs.style.display = GPc.style.display = vu ? "" : "none";
      if (!vu) return;
      var h = GPs, lw = 1, ps = psi(st);
      h.innerHTML = "";
      svg("rect", { x: 0, y: 0, width: 300, height: 200, fill: "#0c0e11" }, h);
      var tous = couleursGrosPlan(st, GO), L = tous.indexOf(st.gpCoul) >= 0 ? [st.gpCoul] : tous, seule = L.length === 1;
      var cs = st.lampe ? LAMPES[st.lampe].coul : null, gR = svg("g", { style: "mix-blend-mode:screen" }, h);
      // repères : d'où vient la lumière, où regarde la lunette
      var gH = svg("g", {}, h);   // au-dessus des rayons (ajouté en fin)
      txt(gH, 6, CYG - 0.015 * KG - 5, TRAD("du collimateur"), "gn-gp-r", "start");
      var bl = bordG(st.phi, 14);
      svg("line", { x1: CXG, y1: CYG, x2: bl.x, y2: bl.y, stroke: "#e8e0d0", "stroke-opacity": 0.55, "stroke-width": 0.8, "stroke-dasharray": "3 4" }, gH);
      txt(gH, clamp(bl.x, 30, 270), clamp(bl.y + (bl.y > CYG ? 11 : -4), 10, 194), TRAD("lunette"), "gn-gp-r", "middle");
      var Y = []; for (var q = -6; q <= 6; q++) Y.push(q * 0.0145 / 6);   // 13 rayons dans le faisceau de 30 mm
      if (st.plateau === "prisme") {
        var Rc = GO.APPAREIL.Lp / Math.sqrt(3), som = [0, 1, 2].map(function (k) { var a = ps + 2 * Math.PI * k / 3; return [Rc * Math.cos(a), Rc * Math.sin(a)]; });
        svg("polygon", { points: som.map(function (p) { return gx(p).toFixed(1) + "," + gy(p).toFixed(1); }).join(" "),
          fill: "#9fc3e6", "fill-opacity": 0.08, stroke: "#9fb3c8", "stroke-opacity": 0.75, "stroke-width": 1 }, h);
        if (cs) Y.forEach(function (y) {   // avant le prisme, toutes les couleurs ensemble
          var s0 = rayonPrisme(ps, 1.6, y, 0.05, GO.APPAREIL.Lp)[0];
          ligneG(gR, s0.a, s0.b, cs, s0.k === null ? 0.25 : 0.7, lw);
        });
        var normales = null;
        L.forEach(function (l) {
          var n = GO.indicePrisme({}, l), coul = couleur(l), op = seule ? 0.9 : 0.75;
          Y.forEach(function (y, iy) {
            var S = rayonPrisme(ps, n, y, 0.05, GO.APPAREIL.Lp);
            if (S.length < 2) return;
            for (var i = 1; i < S.length; i++) ligneG(gR, S[i].a, S[i].b, coul, S[i].tot ? op * 0.45 : op, lw);
            if (seule && !normales && S.length === 3 && !S[2].tot && Math.abs(iy - 6) <= 3) normales = S;
          });
        });
        // une couleur : les normales aux points d'entrée et de sortie d'un rayon proche du milieu (pointillés)
        if (normales) [[normales[0].b, normales[0].k], [normales[1].b, normales[1].k]].forEach(function (e) {
          var a = ps + Math.PI / 3 + 2 * Math.PI * e[1] / 3, u = [Math.cos(a) * 0.009, Math.sin(a) * 0.009];
          ligneG(h, [e[0][0] - u[0], e[0][1] - u[1]], [e[0][0] + u[0], e[0][1] + u[1]], "#e8e0d0", 0.7, 0.8, "2 2");
        });
        if (!cs) txt(h, 150, 190, TRAD("lampe éteinte"), "gn-gp-r", "middle");
      } else {
        var R0 = ordresReseau(ps, 546, st.diaph), g = R0.g, w = R0.w, Lres = 0.020;
        ligneG(h, [-g[0] * Lres, -g[1] * Lres], [g[0] * Lres, g[1] * Lres], "#c9d3dd", 0.55, 2.2);
        ligneG(h, [-g[0] * w / 2, -g[1] * w / 2], [g[0] * w / 2, g[1] * w / 2], "#e8eef5", 0.9, 2.2);
        // rayons diffractés : un sur trois (sept ordres par couleur), l'éventail de chaque ordre en aplat
        var pts = Y.filter(function (y, i) { return i % 3 === 0 && Math.abs(y / g[1]) <= w / 2 + 1e-12; }).map(function (y) { return [y / g[1] * g[0], y]; });
        if (cs) {
          Y.forEach(function (y) {   // hors de la partie éclairée (diaphragme, monture), le rayon s'arrête au réseau, pâle
            var s = y / g[1], ok = Math.abs(s) <= w / 2 + 1e-12;
            ligneG(gR, [-0.05, y], Math.abs(s) < 0.03 ? [s * g[0], y] : [0.05, y], cs, ok ? 0.7 : 0.25, lw);
          });
          var etiq = {};
          L.forEach(function (l) {
            var R = ordresReseau(ps, l, st.diaph), coul = couleur(l);
            R.ordres.forEach(function (o) {
              var d = [Math.cos(o.dir), Math.sin(o.dir)], a = [-g[0] * w / 2, -g[1] * w / 2], b = [g[0] * w / 2, g[1] * w / 2];
              var eff = GO.EFF[Math.abs(o.p)], op = (seule ? 0.9 : 0.7) * (0.35 + 0.65 * eff);
              svg("polygon", { points: [a, b, [b[0] + 0.1 * d[0], b[1] + 0.1 * d[1]], [a[0] + 0.1 * d[0], a[1] + 0.1 * d[1]]].map(function (p) {
                return gx(p).toFixed(1) + "," + gy(p).toFixed(1); }).join(" "), fill: coul, "fill-opacity": 0.06 + 0.06 * eff }, gR);
              pts.forEach(function (p) { ligneG(gR, p, [p[0] + 0.1 * d[0], p[1] + 0.1 * d[1]], coul, op, lw * 0.8); });
              if (!etiq[o.p]) etiq[o.p] = [];
              etiq[o.p].push(o.dir);
            });
          });
          Object.keys(etiq).forEach(function (p) {   // numéro de l'ordre au bout de son éventail
            var D = etiq[p], m = D.reduce(function (s, x) { return s + x; }, 0) / D.length, e = bordG(m, 8);
            var t = txt(gH, e.x, e.y + 3, p === "0" ? "0" : (p > 0 ? "+" : "−") + Math.abs(p), "gn-gp-o", "middle");
            t.setAttribute("fill", D.length === 1 ? couleur(L[0]) : "#e8e0d0");
          });
        } else txt(h, 150, 190, TRAD("lampe éteinte"), "gn-gp-r", "middle");
      }
      h.appendChild(gH);
      if (tous.length) { GPc.hidden = false; pastilles(tous); } else GPc.hidden = true;
    }

    // ================= étagère =================
    // Flottante et escamotable, en bas à GAUCHE du dessin (la lunette n'y passe qu'au-delà de 120° de déviation) :
    // Plate-forme · Lampes · Filtres et diaphragmes. Un clic pose (remplace), un clic sur la carte posée la retire ;
    // glisser une carte sur la plate-forme, la lampe ou le collimateur l'y pose. L'œil choisi est sous le champ.
    K.boite.hidden = true;
    K.defsDessin();
    var PLATS = { reseau: [TRAD("Réseau"), TRAD("Réseau de 600 traits par millimètre.")], miroir: [TRAD("Miroir"), TRAD("Miroir plan, pour régler la lunette par autocollimation.")],
      prisme: [TRAD("Prisme"), TRAD("Prisme équilatéral en flint, 40 mm de côté : pour voir où passe la lumière.")] };
    var TEINTES = { rouge: "#c0392b", vert: "#2e8b57", bleu: "#2f5fb0", interf: "#7ac74f" };
    function cartesEt(T) {
      var a3 = function (b, t) { return "<b>" + b + "</b> — " + t; };
      if (T.nom === "Plate-forme") return Object.keys(PLATS).map(function (k) {
        var pose = st.plateau === k;
        return { cle: "P" + k, nom: PLATS[k][0], mini: K.Dessin.svgMini({ med: k }), pose: pose,
          a3: a3(PLATS[k][1].replace(/\.$/, ""), (pose ? TRAD("clic : le retirer (plate-forme vide)") : TRAD("clic : le poser sur la plate-forme (remplace)")) + TRAD(" · glisser sur la plate-forme : l'y poser")) };
      });
      if (T.nom === "Lampes") return ORDRE_LAMPES.map(function (k) {
        var pose = st.lampe === k;
        return { cle: "L" + k, nom: LAMPES[k].court, mini: K.Dessin.svgMini({ med: MED[k] }), pose: pose,
          a3: a3(TRAD("Lampe {0}", [LAMPES[k].court.toLowerCase()]), (k === "X" ? TRAD("nature inconnue, à identifier par ses raies · ") : k === "W" ? TRAD("spectre continu, filtres devant la fente · ") : "") +
            (pose ? TRAD("clic : l'éteindre") : TRAD("clic : la mettre devant la fente (remplace)")) + TRAD(" · aussi : clic sur la lampe du dessin")) };
      });
      var W = continu(st), res = st.plateau === "reseau";
      return Object.keys(FILTRES).map(function (k) {
        var pose = W && st.filtre === k;
        return { cle: "F" + k, nom: k === "interf" ? TRAD("Interf. 546") : FILTRES[k].nom, mini: K.Dessin.svgMini({ med: "filtre", teinte: TEINTES[k] || "#888" }), pose: pose, dis: !W,
          a3: W ? a3(TRAD("Filtre {0}", [FILTRES[k].nom.toLowerCase()]), (k === "interf" ? TRAD("interférentiel, centré sur 546 nm, bande passante 10 nm") : TRAD("coloré, en verre, à large bande")) + TRAD(" · clic : {0}", [(pose ? TRAD("le retirer") : TRAD("le poser devant la fente (remplace)"))]))
            : a3(TRAD("Filtre {0}", [FILTRES[k].nom.toLowerCase()]), TRAD("avec la lampe halogène seulement (spectre continu) : la mettre d'abord")) };
      }).concat([2e-3, 1e-3].map(function (d) {
        var l = d / MM, pose = res && st.diaph === d;
        return { cle: "D" + l, nom: TRAD("Diaphr. {0} mm", [l]), mini: K.Dessin.svgMini({ med: "diaph", l: l }), pose: pose, dis: !res,
          a3: res ? a3(TRAD("Diaphragme de {0} mm", [l]), TRAD("posé devant le réseau : seuls {0} mm de traits éclairés (N plus petit) · clic : {1}", [l, (pose ? TRAD("le retirer") : TRAD("le poser (remplace)"))]))
            : a3(TRAD("Diaphragme de {0} mm", [l]), TRAD("devant le réseau seulement : poser d'abord le réseau")) };
      }));
    }
    function clicCarte(c) {
      var t = c.charAt(0), k = c.slice(1);
      if (t === "P") st.plateau = st.plateau === k ? "rien" : k;
      else if (t === "L") { mettreLampe(st.lampe === k ? null : k); return; }
      else if (t === "F") { if (!continu(st)) return; st.filtre = st.filtre === k ? null : k; }
      else if (t === "D") { if (st.plateau !== "reseau") return; var d = parseFloat(k) * MM; st.diaph = st.diaph === d ? null : d; }
      sale.etagere = sale.tete = true; modifie("dessin champ lum loupe");
    }
    // Où une carte lâchée au point p (dessin) se pose : texte de la ligne des gestes, ou null (rien).
    function poseCarte(c, p) {
      var t = c.charAt(0), xl = xFente() - 32;
      if (t === "P" && Math.hypot(p.x, p.y) < 75) return TRAD("lâché ici : sur la plate-forme");
      if (t === "L" && Math.hypot(p.x - xl, p.y) < 50) return TRAD("lâchée ici : elle remplace la lampe");
      if (t === "F" && continu(st) && p.x < -110 && p.x > xl - 30 && Math.abs(p.y) < 40) return TRAD("lâché ici : devant la fente");
      if (t === "D" && st.plateau === "reseau" && Math.hypot(p.x, p.y) < 75) return TRAD("lâché ici : devant le réseau");
      return null;
    }
    var ETG = K.etagere(K.dessus.parentNode, { flottante: true, memoire: "paillasse-goniometre-etagere", titre: TRAD("Éléments"), defaut: "Plate-forme",
      // `nom` est la clé de l'onglet (état, mémoire, sélection des cartes) : il ne se traduit pas.
      // `lab` est le libellé affiché, seul traduit — même distinction que les pièces (`cle` / `nom`).
      onglets: function () { return [{ nom: "Plate-forme", lab: TRAD("Plate-forme"), a3: TRAD("<b>Plate-forme</b> — réseau, miroir, prisme : un seul à la fois") },
        { nom: "Lampes", lab: TRAD("Lampes"), a3: TRAD("<b>Lampes</b> — devant la fente du collimateur : une seule à la fois") },
        { nom: "Filtres et diaphragmes", lab: TRAD("Filtres et diaphragmes"), a3: TRAD("<b>Filtres et diaphragmes</b> — filtres avec la lampe halogène ; diaphragmes devant le réseau") }]; },
      cartes: cartesEt,
      glisse: function (c, ev) {
        var q = poseCarte(c, K.ptSvg(ev)), t = c.charAt(0), k = c.slice(1);
        var nm = t === "P" ? PLATS[k][0] : t === "L" ? TRAD("Lampe {0}", [LAMPES[k].court.toLowerCase()]) : t === "F" ? TRAD("Filtre {0}", [FILTRES[k].nom.toLowerCase()]) : TRAD("Diaphragme de {0} mm", [k]);
        return { fantome: true, texte: q ? "<b>" + K.esc(nm) + "</b> — " + q : TRAD("Lâcher sur {0} pour poser ; ailleurs : rien", [(c.charAt(0) === "L" ? TRAD("la lampe") : c.charAt(0) === "F" ? TRAD("le collimateur") : TRAD("la plate-forme"))]) };
      },
      lache: function (c, ev, bouge) {
        if (ev.type === "pointercancel") return;
        if (!bouge) { clicCarte(c); return; }
        if (!poseCarte(c, K.ptSvg(ev))) return;
        var t = c.charAt(0), k = c.slice(1);       // lâchée : poser (jamais retirer)
        if (t === "P" && st.plateau === k) return;
        if (t === "L" && st.lampe === k) return;
        if (t === "F" && st.filtre === k) return;
        if (t === "D" && st.diaph === parseFloat(k) * MM) return;
        clicCarte(c);
      },
      clic: clicCarte });
    ETG.el.classList.add("gn-etagere");

    // ================= champ de la lunette =================
    var cvWrap = el("div", "pl-cv gn-cv", K.obs);
    cvWrap.tabIndex = 0; cvWrap.setAttribute("aria-label", TRAD("Champ de la lunette : molette pour agrandir, glisser pour se déplacer, Maj + glisser pour déplacer l'œil, clic sur un objet pour le regarder"));
    var cv = el("canvas", "", cvWrap), Wc = 440; cv.width = cv.height = Wc;
    var ctx = null, tmp = document.createElement("canvas");
    try { ctx = cv.getContext("2d"); } catch (e) { ctx = null; }
    function pxDe(n) { return V.lunette.champ / (n / 2 - 8 * n / Wc) / st.zoom; }
    // Aperçu pendant un geste : la plus grande définition qui tient dans BUDGET ms, d'après le coût mesuré par pixel
    // (moyenne glissante) ; pleine définition dès que la machine suit, jamais sous la demi-définition.
    var BUDGET = 25, coutPx = 0;
    // Adaptation : champ entier à ADAPT² pixels, en lux rétiniens ; AD = CIBLE mesurée par adapterVision (+ expo du
    // « toujours visible », pupille tracée) ; le niveau affiché ADa la rejoint (`lisser`) et c'est lui que voit `vision`.
    // Définition : au moins ADAPT ; lampe à raies, un pixel au plus du cinquième de la raie la plus fine du champ (au plus
    // ADAPT_MAX). Le niveau d'adaptation pondère par l² : une raie plus fine que le pixel y est étalée, sa luminance
    // sous-estimée (raies jaunes du mercure : 51 000 cd/m² mesurés à 64², 83 000 en vrai), l'exposition trop forte, et
    // `vision` blanchit la raie au-delà du blanc. Le continu (halogène) est juste dès 64².
    function definitionAdapt() {
      if (continu(st)) return ADAPT;
      var w = Infinity;
      V.objets.forEach(function (o) { if (o.type === "raie" && o.champ && o.I > 0.004 && o.largeur > 0) w = Math.min(w, o.largeur); });
      if (!isFinite(w)) return ADAPT;
      return Math.max(ADAPT, Math.min(ADAPT_MAX, 32 * Math.ceil(5 * 2 * V.lunette.champ / w / (1 - 16 / Wc) / 32)));
    }
    // Poids de regard : l'œil regarde le centre du champ (le réticule), pas son bord. Un élément ne pèse donc dans la
    // moyenne logarithmique que par (1 − u²)², u = ρ / ρ_champ : un bout de raie qui entre au bord du diaphragme de champ
    // — là où l'œil ne regarde pas — ne peut plus éteindre les raies du centre. Mesuré sur une raie seule à u = 1 : le
    // niveau d'adaptation tombe de 35 à 0,7 cd/m² ; au centre (u < 0,3) rien ne change.
    function poidsRegard(pr, N, px) {
      var a = new Float64Array(N * N), k2 = 1 / (pr.champ.rho * pr.champ.rho), x0 = pr.champ.X, y0 = pr.champ.Y;
      for (var j = 0, i = 0; j < N; j++) for (var c = 0; c < N; c++, i++) {
        var x = (c + 0.5 - N / 2) * px - x0, y = (N / 2 - j - 0.5) * px - y0;
        var u2 = Math.min(1, (x * x + y * y) * k2), w = 1 - u2;
        a[i] = w * w;                                   // (1 − u²)², sans racine
      }
      return a;
    }
    function adapter() {
      var V0 = MI.VISION, p = PUP * 1e-3, s = GO.F_OEIL * GO.F_OEIL / (Math.PI * p * p / 4), N = definitionAdapt();
      var px = V.lunette.champ / (N / 2 - 8 * N / Wc), pr = GO.preparerChamp(CFG, V, px), img = GO.rendreChamp(pr, N, N, { flottant: true });
      var n = N * N, L = new Float64Array(n), a = poidsRegard(pr, N, px), ys = [], i;
      for (i = 0; i < n; i++) { L[i] = Math.max(img[3 * i + 1], 0) * s; if (L[i] > 0) ys.push(L[i]); }
      AD = MI.adapterVision(L, Math.pow(px * 180 / Math.PI, 2), { M: 0.1, Fsalle: 3283 * V0.Esalle, salle: V0.Lsalle, poids: a });
      ys.sort(function (a, b) { return a - b; });
      AD.expo = ys.length ? 0.9 * s / ys[Math.floor(0.99 * (ys.length - 1))] : 1;
      AD.s = s; AD.pupTracee = PUP; tAdapt = maintenant();
    }
    // ================= niveau d'adaptation affiché : l'œil ne saute pas d'un niveau à l'autre =================
    // La loi est celle du module couleur (`suiviAdaptation`), la même aux trois instruments : le LOGARITHME de La
    // rejoint sa cible en exponentielle, 1 s vers la lumière, 2 s vers le noir (asymétrie de l'œil, Durand-Dorsey
    // 2000), ancré à l'arrivée et quand la scène change. Les constantes s'y règlent (`TAU_ADAPT`), une seule fois.
    // Le reste de la chaîne est stationnaire : `parametresVision` est rappelé avec le La du moment, seuil, Ward et
    // Hunt suivent.
    // ANCRAGE : aucun transitoire à l'arrivée ni quand la SCÈNE change — lampe, filtre, diaphragme, plateau, lampe du
    // réticule, œil, mode de luminosité, graine : l'observateur vient de refaire le montage. Tourner la lunette,
    // déplacer l'œil dans le champ, zoomer, régler la fente, l'oculaire ou le collimateur n'y touchent pas : c'est la
    // même scène, et l'image ne doit pas s'assombrir parce qu'une raie forte est entrée dans le champ.
    var ADa = null, sceneAD = "", LISS = MI.suiviAdaptation(), tLiss = 0;
    function sceneSig() {
      return [st.graine, st.lampe, st.filtre, st.diaph, st.plateau, st.lampe_lunette, st.oeil.type, reelle()].join("|");
    }
    function enRelax() { return !!(AD && LISS.enRelax(AD.La)); }
    function lisser(ancre) {
      if (!AD) return;
      var t = maintenant(), La = LISS.pas(AD.La, tLiss ? (t - tLiss) / 1000 : 0, ancre || LISS.ancre);
      tLiss = t;
      // `parametresLisses` : mêmes seuil et chroma que la cible, le gain de Ward sur le niveau affiché ; l'image au
      // repos est EXACTEMENT la stationnaire (La est alors la valeur mesurée, sans conversion log → exp)
      ADa = { La: La, p: MI.parametresLisses(La, -1, AD.haut), s: AD.s, expo: AD.expo };
    }
    function suivrePupille() {
      if (!AD || AD.pupTracee !== PUP || !(AD.D > 0) || Math.abs(AD.D - PUP) <= 0.05 * PUP || nPup >= 6) return;
      PUP = Math.round(100 * AD.D) / 100; nPup++; fin = false; sale.champ = true;
    }
    function reelle() { return st.luminosite !== "visible"; }
    function rendreChamp(complet) {
      if (!ctx || !V) return;
      var n = Wc;
      if (!complet && coutPx > 0) n = Math.max(Math.round(Wc / 2), Math.min(Wc, 2 * Math.round(Math.sqrt(BUDGET / coutPx) / 2)));
      // Cible mesurée quand la scène change (mesure forcée : c'est elle qui fait l'ancrage), à l'image fine (fin de
      // geste), pendant un geste (5 fois par seconde au plus) et quand la pupille tracée a bougé ; pas pendant la
      // relaxation, où le champ ne change pas.
      var scen = sceneSig(), neuf = scen !== sceneAD;
      sceneAD = scen;
      if (neuf || (!relaxant && (complet || !AD || AD.pupTracee !== PUP || maintenant() - tAdapt > 200))) adapter();
      if (!AD) return;
      lisser(neuf);
      var oR = reelle() ? { vision: { p: ADa.p, s: ADa.s } } : { expo: AD.expo, comp: COMP_VISIBLE }, pxn = pxDe(n);
      oR.cx = n / 2 - st.zc[0] / pxn; oR.cy = n / 2 + st.zc[1] / pxn;      // vue agrandie : centrée sur st.zc (rad)
      var t0 = maintenant(), pr = GO.preparerChamp(CFG, V, pxn), data = GO.rendreChamp(pr, n, n, oR);
      var c = (maintenant() - t0) / (n * n);
      coutPx = coutPx > 0 ? 0.7 * coutPx + 0.3 * c : c;
      if (n === Wc) { var im = ctx.createImageData(n, n); im.data.set(data); ctx.putImageData(im, 0, 0); return; }
      tmp.width = tmp.height = n;
      var tc = tmp.getContext("2d"), id = tc.createImageData(n, n); id.data.set(data); tc.putImageData(id, 0, 0);
      ctx.imageSmoothingEnabled = true; ctx.drawImage(tmp, 0, 0, Wc, Wc);
    }
    // Gestes du champ (mêmes que l'image du banc) : glisser = se déplacer dans le champ
    // agrandi (×1 : rien à déplacer, le glisser déplace l'œil) ; Maj+glisser : l'œil, fin ; Ctrl+glisser : l'œil ;
    // molette = zoom ×1 / ×2 / ×4 autour du pointeur, un palier par cran ; double-clic = tout le champ, œil recentré ;
    // clic sur un objet = l'œil le regarde. L'accommodation forcée : son curseur (molette dessus : la coque).
    var prC = null, ZOOMS = [1, 2, 4];
    // centre de la vue agrandie borné : le bord de la vue ne sort pas du cercle de champ (sur chaque axe)
    function poserVue(z, zc) {
      var m = V ? V.lunette.champ * (1 - 1 / z) : 0;
      st.zoom = z; st.zc = z === 1 ? [0, 0] : [clamp(zc[0], -m, m), clamp(zc[1], -m, m)];
      sale.tete = true; modifie("champ");
    }
    function zoomerChamp(k, ev) {
      var i = ZOOMS.indexOf(st.zoom), z1 = ZOOMS[clamp((i < 0 ? 0 : i) + k, 0, ZOOMS.length - 1)];
      if (z1 === st.zoom) return;
      var q = st.zc;
      if (ev && V) { var c = versChamp(ev), px = pxDe(Wc); q = [(c.x - Wc / 2) * px + st.zc[0], (Wc / 2 - c.y) * px + st.zc[1]]; }
      var r = st.zoom / z1;      // le point sous le pointeur y reste
      poserVue(z1, [q[0] - (q[0] - st.zc[0]) * r, q[1] - (q[1] - st.zc[1]) * r]);
    }
    // zoom du champ (×1/2/4 autour du pointeur) : gestionnaire stable et `fige: false` — le zoom ne vaut que tant que
    // le pointeur est sur le champ, pas une seconde après l'avoir quitté (la coque re-résout à chaque événement)
    var MOL_CHAMP = function (k, ev) { zoomerChamp(k, ev); };
    MOL_CHAMP.fige = false;
    K.cibleMolette(function (t) { return t && t.closest && cvWrap.contains(t) ? MOL_CHAMP : null; });
    function versChamp(ev) {
      var r = cv.getBoundingClientRect(), k = Wc / (r.width || Wc);
      return { x: (ev.clientX - r.left) * k, y: (ev.clientY - r.top) * k, kx: r.width ? Wc / r.width : 1 };
    }
    function bougerOeil(dx, dy) {
      var h = st.oeil.h, x = h[0] + dx, y = h[1] + dy, d = Math.hypot(x, y);
      if (d > H_MAX) { x *= H_MAX / d; y *= H_MAX / d; }
      st.oeil.h = [x, y]; modifie("champ lum");
    }
    cvWrap.addEventListener("pointerdown", function (ev) {
      if (ev.button) return;
      prC = versChamp(ev); prC.bouge = false; prC.cx = ev.clientX; prC.cy = ev.clientY;
      prC.oeil = st.zoom === 1 || ev.shiftKey || ev.ctrlKey; prC.k = ev.shiftKey ? 0.2 : 1;
      try { cvWrap.setPointerCapture(ev.pointerId); } catch (e) {}
      cvWrap.focus({ preventScroll: true }); ev.preventDefault();
    });
    cvWrap.addEventListener("pointermove", function (ev) {
      if (!prC) return;
      var dx = ev.clientX - prC.cx, dy = ev.clientY - prC.cy;
      if (!prC.bouge && Math.hypot(dx, dy) < 4) return;
      prC.bouge = true; prC.cx = ev.clientX; prC.cy = ev.clientY;
      if (!prC.oeil) { var px = pxDe(Wc) * prC.kx; poserVue(st.zoom, [st.zc[0] - dx * px, st.zc[1] + dy * px]); return; }
      var f = 1.2e-5 * prC.k;
      bougerOeil(dx * f, -dy * f);
    });
    function lacherC(ev) {
      if (!prC) return;
      var bouge = prC.bouge, c = prC; prC = null;
      if (bouge || !V || ev.type === "pointercancel") return;
      var px = pxDe(Wc), X = (c.x - Wc / 2) * px + st.zc[0], Y = (Wc / 2 - c.y) * px + st.zc[1], best = null, dmin = 12 * px;
      V.objets.forEach(function (o) {
        if (o.type !== "reticule" && (o.I <= 0 || !o.champ)) return;
        // un clic dans la bande d'une raie la désigne, même sur un fil du réticule qui la croise
        var d = o.type === "raie" ? Math.max(0, Math.abs(X - o.X) - o.largeur / 2) - px : Math.min(Math.abs(X - o.X), Math.abs(Y - o.Y));
        if (d < dmin) { dmin = d; best = o; }
      });
      if (best) viser(best.id);
    }
    cvWrap.addEventListener("pointerup", lacherC);
    cvWrap.addEventListener("pointercancel", lacherC);
    function toutLeChamp() { st.oeil.h = [0, 0]; poserVue(1, [0, 0]); modifie("champ lum"); }
    cvWrap.addEventListener("dblclick", toutLeChamp);
    cvWrap.addEventListener("keydown", function (ev) {
      var d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[ev.key];
      if (!d) return;
      ev.preventDefault(); ev.stopPropagation();
      var p = (ev.shiftKey ? 0.02 : 0.1) * MM;
      bougerOeil(d[0] * p, d[1] * p);
    });
    // L'œil saute sur l'objet désigné, en ~0,3 s, s'il est dans sa plage d'accommodation (sinon il reste à la borne).
    function viser(id) {
      var P0 = V ? V.Pf : null;
      st.oeil.mode = "objet"; st.oeil.cible = id;
      anim = P0 != null ? { P0: P0, t0: maintenant() } : null;
      modifie("champ lum");
    }
    function calculer() {   // configuration et vue du moment (saut de l'œil compris)
      var cfg = config(st);
      if (anim) {
        var t = (maintenant() - anim.t0) / 300;
        if (t >= 1) anim = null;
        else {
          var Pf1 = vueDe(GO, st, cfg).Pf, R = GO.YEUX[st.oeil.type][0], e = t * t * (3 - 2 * t);
          var o = { type: st.oeil.type, mode: "curseur", cible: st.oeil.cible, acc: anim.P0 + (Pf1 - anim.P0) * e - R, h: st.oeil.h };
          cfg = config(st, o);
        }
      }
      cfg.oeil.pupille = PUP * 1e-3;
      CFG = cfg; V = vueDe(GO, st, cfg);
    }

    // ---- tête et pied du champ ----
    var etatOeil = null, curAcc = null, bLibre = null, miniOeil = null;
    function nomObjet(id) {
      if (id === "retour") return TRAD("l'image retour");
      if (/^raie:/.test(id)) { var l = parseFloat(id.split(":")[1]); return TRAD("une raie {0}", [nomRaie(l)]); }
      return TRAD("le réticule");
    }
    function dessinerTete() {
      var T = K.obsTete, Pd = K.obsPied;
      T.innerHTML = ""; Pd.innerHTML = "";
      el("span", "pl-obs-t", T, TRAD("Dans la lunette"));
      miniOeil = svg("svg", { class: "gn-mini", viewBox: "-24 -24 48 48" }, T);
      miniOeil.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "title")).textContent = TRAD("Position de l'œil (petit disque) dans le cercle oculaire, derrière l'oculaire");
      // − ×N + Tout le champ : paliers ×1, ×2, ×4 autour du centre de la vue ; Tout le champ = ×1, œil recentré
      var zb = el("span", "pl-obs-b", T), k_ = K.k;
      var bM = K.bouton(zb, "−", function () { zoomerChamp(-1); }, "pl-btn-p");
      bM.disabled = st.zoom === 1; bM.setAttribute("data-a3", TRAD("<b>Moins grand</b> — palier précédent (×4 → ×2 → ×1) · touche {0}", [k_("−")]));
      el("span", "pl-obs-n gn-zoom", zb, "×" + st.zoom);
      var bP = K.bouton(zb, "+", function () { zoomerChamp(1); }, "pl-btn-p");
      bP.disabled = st.zoom === 4; bP.setAttribute("data-a3", TRAD("<b>Plus grand</b> — palier suivant (×1 → ×2 → ×4) autour du centre : les détails fins (flou, parallaxe, doublet) ne se voient qu'agrandis · touche {0}", [k_("+")]));
      var bT = K.bouton(zb, TRAD("Tout le champ"), toutLeChamp, "pl-btn-p");
      bT.setAttribute("aria-pressed", st.zoom === 1 ? "true" : "false");
      bT.setAttribute("data-a3", TRAD("<b>Tout le champ</b> — ×1, œil recentré, comme à l'œil · double-clic dans le champ · touche {0}", [k_("0")]));
      etatOeil = el("span", "pl-obs-n gn-etat", Pd);
      var ac = el("span", "gn-acc", Pd);
      el("span", "pl-acc-l", ac, TRAD("Accommoder : loin"));
      curAcc = el("input", "pl-acc", ac); curAcc.type = "range"; curAcc.min = 0; curAcc.max = GO.YEUX[st.oeil.type][1]; curAcc.step = 0.01;
      curAcc.setAttribute("aria-label", TRAD("Accommodation forcée de l'œil"));
      curAcc.addEventListener("input", function () { st.oeil.mode = "curseur"; st.oeil.acc = parseFloat(curAcc.value); anim = null; modifie("champ lum"); majEtat(); });
      el("span", "pl-acc-l", ac, TRAD("près"));
      bLibre = K.bouton(ac, TRAD("Œil libre"), function () { viser(st.oeil.cible || "reticule"); majEtat(); }, "pl-btn-p");
      bLibre.setAttribute("data-a3", TRAD("<b>Œil libre</b> — l'œil cesse de suivre le curseur et regarde de nouveau l'objet désigné"));
      curAcc.setAttribute("data-a3", TRAD("<b>Accommoder</b> — forcer l'accommodation de l'œil : glisser, ou molette dessus (Maj : fin · Ctrl : gros)"));
      // l'œil choisi (descendu de la boîte, comme le bloc de l'œil du banc)
      var oc = el("span", "gn-oeil", Pd); el("span", "pl-acc-l", oc, TRAD("Œil"));
      var sg = K.seg(oc, Object.keys(NOMS_OEIL).map(function (k) { return [k, NOMS_OEIL[k], TITRES_OEIL[k]]; }), st.oeil.type, function (k) {
        st.oeil.type = k; if (st.oeil.mode === "curseur") st.oeil.acc = Math.min(st.oeil.acc, GO.YEUX[k][1]);
        sale.tete = true; modifie("champ lum");
      });
      sg.setAttribute("data-a3", TRAD("<b>L'œil qui regarde</b> — normal, myope, hypermétrope, presbyte : le réglage de l'oculaire est personnel"));
      majEtat();
    }
    function majEtat() {
      if (!etatOeil || !V) return;
      var cur = st.oeil.mode === "curseur", t;
      t = cur ? TRAD("Accommodation au curseur") : TRAD("L'œil regarde {0}", [nomObjet(st.oeil.cible)]);
      t += V.accommodation < 0.05 ? TRAD(" · œil au repos") : TRAD(" · l'œil accommode");
      if (!cur && !anim && !V.dans_plage) t += TRAD(" · il ne peut pas le voir net");
      if (V.pupille.T <= 0) t += TRAD(" · l'œil est sorti du cercle oculaire");
      // part de la pupille la plus grande possible : le cercle oculaire entier quand la pupille le dépasse
      else if (V.pupille.T < 0.97 * Math.min(1, Math.pow(V.lunette.cercle / CFG.oeil.pupille, 2))) t += TRAD(" · œil au bord du cercle oculaire : champ assombri");
      else if (reelle() && AD && !AD.visible) t += TRAD(" · trop peu de lumière pour l'œil");
      etatOeil.textContent = t;
      bLibre.hidden = !cur;
      if (document.activeElement !== curAcc) curAcc.value = cur ? st.oeil.acc : V.accommodation;
      if (miniOeil) {
        var s = 8000, rc = V.lunette.cercle / 2 * s;
        miniOeil.querySelectorAll("circle").forEach(function (c) { c.remove(); });
        svg("circle", { cx: 0, cy: 0, r: Math.min(22, rc), fill: "#1a1e24", stroke: "#6e7783", "stroke-width": 1 }, miniOeil);
        svg("circle", { cx: clamp(st.oeil.h[0] * s, -22, 22), cy: clamp(-st.oeil.h[1] * s, -22, 22), r: 1.5e-3 * s, fill: "#e0b84c", "fill-opacity": 0.35, stroke: "#e0b84c", "stroke-width": 0.8 }, miniOeil);
      }
    }

    // ================= loupe du vernier et lecture =================
    var LP = K.loupe;
    LP.setAttribute("viewBox", "0 0 440 150");
    LP.style.cursor = "zoom-in";
    // clic : le vernier entier, en grand, par-dessus la vue de dessus (le champ et la lecture restent à droite) ;
    // clic sur lui ou Échap : fermé
    var GV = el("div", "gn-vern-grand", gauche); GV.hidden = true;
    var GVs = svg("svg", { viewBox: "0 0 1000 250" }, GV);
    el("p", "gn-vern-grand-l", GV, TRAD("Vernier agrandi · clic ou Échap : fermer"));
    function vernierGrand(o) { vz = o; GV.hidden = !o; LP.style.cursor = o ? "zoom-out" : "zoom-in"; sale.loupe = true; }
    LP.addEventListener("click", function () { vernierGrand(!vz); });
    GV.addEventListener("click", function () { vernierGrand(false); });
    // capture sur window : passe avant l'Échap de l'hôte (document), qui fermerait l'app entière
    root.addEventListener && root.addEventListener("keydown", function (ev) {
      if (vz && ev.key === "Escape" && GV.isConnected) { ev.stopPropagation(); ev.preventDefault(); vernierGrand(false); }
    }, true);
    // Cercle au demi-degré (fixe) et vernier de 30 divisions sur 29 demi-degrés (tourne avec la lunette), lecture R :
    // zéro du vernier à x = X0, PD unités par degré, k = échelle des traits et des marges.
    function traceVernier(host, R, Wv, X0, PD, k, clN, clD) {
      var pas = 29 / 30 * PD / 2, yRef = 70 * k, d = "", dv = "", v, x;
      var g = svg("g", {}, host);
      svg("rect", { x: -20, y: 8 * k, width: Wv + 40, height: yRef - 8 * k, fill: "#d9d3c3" }, g);
      svg("rect", { x: X0 - 14 * k, y: yRef, width: 30 * pas + 28 * k, height: 58 * k, fill: "#c9c2b0" }, g);
      var dmin = R + (-X0 - 10) / PD, dmax = R + (Wv + 10 - X0) / PD;
      for (v = Math.floor(dmin * 2); v <= Math.ceil(dmax * 2); v++) {
        var deg = v / 2; x = X0 + (deg - R) * PD;
        if (x < -10 || x > Wv + 10) continue;
        var ent = v % 2 === 0, L = (ent ? (((deg % 5) + 5) % 5 === 0 ? 30 : 24) : 15) * k;
        d += "M" + x.toFixed(2) + " " + (yRef - L) + "V" + yRef;
        if (ent) txt(g, x, yRef - L - 4 * k, String(((deg % 360) + 360) % 360), clN, "middle");
      }
      for (v = 0; v <= 30; v++) {
        x = X0 + v * pas; var Lv = (v % 5 === 0 ? 22 : 14) * k;
        if (x < -10 || x > Wv + 10) continue;
        dv += "M" + x.toFixed(2) + " " + yRef + "V" + (yRef + Lv);
        if (v % 5 === 0) txt(g, x, yRef + Lv + 12 * k, String(v), clD, "middle");
      }
      svg("path", { d: d, stroke: "#14130f", "stroke-width": 0.8 * Math.sqrt(k), fill: "none" }, g);
      svg("path", { d: dv, stroke: "#14130f", "stroke-width": 0.8 * Math.sqrt(k), fill: "none" }, g);
      svg("line", { x1: -20, y1: yRef, x2: Wv + 20, y2: yRef, stroke: "#6c6656", "stroke-width": 0.6 }, g);
    }
    function dessinerVernier() {
      LP.innerHTML = "";
      var R = train != null ? train : lecture(st);
      var dfs = svg("defs", {}, LP);
      dfs.innerHTML = '<clipPath id="gnVernClip"><rect x="4" y="4" width="432" height="128" rx="10"/></clipPath>';
      var cadre = svg("g", { "clip-path": "url(#gnVernClip)" }, LP);
      svg("rect", { x: 0, y: 0, width: 440, height: 150, fill: "#0c0e11" }, cadre);
      traceVernier(cadre, R, 440, 26, 27, 1, "gn-vern-n", "gn-vern-d");
      svg("rect", { x: 4, y: 4, width: 432, height: 128, rx: 10, fill: "none", stroke: "#3a414a", "stroke-width": 2 }, LP);
      txt(LP, 8, 146, (train != null ? TRAD("Entraînement, position tirée au hasard · ") : TRAD("Loupe du vernier de la lunette · ")) +
        TRAD("cercle au demi-degré, vernier de 30 divisions · clic : {0}", [(vz ? TRAD("fermer") : TRAD("agrandir"))]), "pl-loupe-l");
      if (!vz) return;
      // en grand : tout le vernier (14,5°) et un peu de cercle de part et d'autre, chiffres lisibles
      GVs.innerHTML = "";
      var df2 = svg("defs", {}, GVs);
      df2.innerHTML = '<clipPath id="gnVernClipG"><rect x="4" y="4" width="992" height="242" rx="14"/></clipPath>';
      var c2 = svg("g", { "clip-path": "url(#gnVernClipG)" }, GVs);
      svg("rect", { x: 0, y: 0, width: 1000, height: 250, fill: "#0c0e11" }, c2);
      traceVernier(c2, R, 1000, 110, 54, 1.75, "gn-vg-n", "gn-vg-d");
      svg("rect", { x: 4, y: 4, width: 992, height: 242, rx: 14, fill: "none", stroke: "#3a414a", "stroke-width": 2 }, GVs);
    }
    var LF = K.lecture, iD, iM, verdict, bTrain, bAutre;
    (function () {
      LF.innerHTML = "";
      el("span", "pl-lect-lab", LF, TRAD("Lecture :"));
      iD = el("input", "pl-lect-in gn-lect-d", LF); iD.type = "text"; iD.inputMode = "numeric"; iD.placeholder = TRAD("degrés"); iD.setAttribute("aria-label", TRAD("Degrés"));
      el("span", "pl-lect-u", LF, "°");
      iM = el("input", "pl-lect-in gn-lect-m", LF); iM.type = "text"; iM.inputMode = "numeric"; iM.placeholder = "min"; iM.setAttribute("aria-label", "Minutes");
      el("span", "pl-lect-u", LF, "′");
      var bV = K.bouton(LF, TRAD("Vérifier ma lecture"), function () {
        var dg = parseFloat(String(iD.value).replace(",", ".")), mn = parseFloat(String(iM.value || "0").replace(",", "."));
        if (isNaN(dg) || isNaN(mn)) { verdict.textContent = TRAD("Taper les degrés et les minutes."); return; }
        verdict.textContent = verifierLecture(train != null ? train : lecture(st), dg, mn).texte;
      });
      [iD, iM].forEach(function (i) {
        i.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); bV.click(); } ev.stopPropagation(); });
        i.addEventListener("input", function () { verdict.textContent = ""; });
      });
      bTrain = K.bouton(LF, TRAD("S'entraîner"), function () {
        if (train == null) tirer(); else train = null;
        majTrain();
      }, "pl-btn-p");
      bTrain.title = TRAD("Lire le vernier sur des positions tirées au hasard ; la lunette ne bouge pas.");
      bAutre = K.bouton(LF, TRAD("Autre position"), function () { tirer(); majTrain(); }, "pl-btn-p");
      verdict = el("span", "pl-lect-verdict", LF);
    })();
    function tirer() { train = Math.floor(Math.random() * 360 * 60) / 60 + (0.1 + 0.3 * Math.random()) / 60; }
    function majTrain() {
      bTrain.innerHTML = train == null ? TRAD("S'entraîner") : TRAD("Revenir à la lunette");
      bAutre.hidden = train == null;
      iD.value = iM.value = ""; verdict.textContent = ""; sale.loupe = true;
    }
    majTrain();

    // ================= bandeau du haut, ligne des gestes, panneau « ? » =================
    // Bandeau de la coque réduit à sa ligne 1 (Faisceau, Réglages ▾ … Cahier, Prof, ?, plein écran) et à la ligne des
    // gestes, comme au Michelson. Les textes des gestes vivent ici (GESTES, survol) : un seul endroit à réécrire.
    var k_ = K.k, BH = K.bandeau(), L1 = BH.l1;
    BH.l2.hidden = true;
    // Trois aides : « Faisceau » dessine la lumière sur l'appareil ; la loupe du
    // réticule et le gros plan sont des panneaux libres, déplaçables, fermés par leur × ou leur bouton. Hors Ctrl+Z.
    var bLum = K.boutonAide(L1, { cle: "faisceau", nom: TRAD("Faisceau"), lettre: "F", on: st.lumiere,
      titre: TRAD("la lumière dessinée dans tout le goniomètre, de la fente à l'œil") }, basculerFaisceau);
    function basculerFaisceau() { st.lumiere = !st.lumiere; bLum.setAttribute("aria-pressed", st.lumiere ? "true" : "false"); modifie("lum"); }
    var bLoupe = K.boutonAide(L1, { cle: "loupe", nom: TRAD("Loupe du réticule"), lettre: "L", on: !!st.loupe,
      ico: '<circle cx="7" cy="6" r="4.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 9l5 4" stroke="currentColor" stroke-width="2"/>',
      titre: TRAD("où se forme l'image dans la lunette, par rapport au réticule et au plan que l'œil voit net (longueurs le long de l'axe dilatées)") },
      function () { PLo.basculer(!st.loupe); });
    var bGros = K.boutonAide(L1, { cle: "gros", nom: TRAD("Gros plan"), lettre: "G", on: !!st.gros,
      ico: '<rect x="1.5" y="1.5" width="15" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M9 3v8 M4 7l10-3 M4 7l10 3" stroke="currentColor" stroke-width="1.1"/>',
      titre: TRAD("la plate-forme vue de près, à l'échelle : rayons dans le prisme, ordres du réseau") },
      function () { PGr.basculer(!st.gros); });
    var PLo = K.panneau("gn-pan-loupe", TRAD("Loupe du réticule"), { libre: true }), PGr = K.panneau("gn-pan-gros", TRAD("Gros plan"), { libre: true });
    PLo.corps.appendChild(LR); PGr.corps.appendChild(GP); LR.hidden = GP.hidden = false;
    function aide(cle, pan, b) {
      pan.surBascule = function (v) { st[cle] = !!v; b.setAttribute("aria-pressed", v ? "true" : "false"); sale.lum = true; K.modifie(); };
      if (st[cle]) pan.basculer(true);
    }
    aide("loupe", PLo, bLoupe); aide("gros", PGr, bGros);
    // Œil simulé (avec = luminosité réelle, défaut ; sans = toujours visible) ; hors annulation.
    function poserLumi(v) { st.luminosite = v; fin = false; sale.champ = true; K.modifie(); }
    K.groupe(L1, TRAD("Œil simulé"), [
      ["reelle", TRAD("avec"), TRAD("<b>Œil simulé : avec</b> — luminosité réelle : réponse à la luminance du champ regardé, pupille, vision de nuit, sans fond de salle ajouté : le noir reste noir ; une raie faible paraît faible, ou ne se voit pas du tout")],
      ["visible", TRAD("sans"), TRAD("<b>Œil simulé : sans</b> — le champ est exposé pour être bien visible, quelle que soit la lumière reçue")]],
      function () { return reelle() ? "reelle" : "visible"; }, poserLumi);
    el("span", "bc-pousse", L1);
    var CA = K.cahier({ fichier: "cahier-goniometre.csv", lire: function () { return st.cahier; }, ecrire: function (L) { st.cahier = L; K.modifie(); } });
    var bProf = K.boutonsFin(L1, { cahier: CA, gestes: function () { return GESTES; },
      prof: { lab: TRAD("Prof"), f: function () { PR.panneau.basculer(); }, visible: K.estProf(), a3: TRAD("<b>Mode prof</b> — valeurs cachées, configurations types, projection, réglage à transmettre") } }).prof;

    // ----- ligne des gestes : ce que font la souris et le clavier sur ce que survole le pointeur -----
    var PT = null;      // dernier point du pointeur sur le dessin : plate-forme, lunette, oculaire (sans élément propre)
    D.addEventListener("mousemove", function (ev) { PT = K.ptSvg(ev); });
    var ROT = TRAD("glisser : la tourner (Maj : dix fois plus lent · Ctrl+Maj : cent fois) · molette : 10′ par cran (Maj 1′ · Ctrl+Maj 0,1′ · Ctrl 100′)");
    var TXT_VIS = {
      tL: TRAD("<b>Tirage de la lunette</b> — faire rouler la molette (glisser ou molette ; Maj : fin) : le réticule avance ou recule dans le tube"),
      tC: TRAD("<b>Tirage du collimateur</b> — faire rouler la molette (glisser ou molette ; Maj : fin) : la fente avance ou recule"),
      fe: TRAD("<b>Molette de fente</b> — faire rouler (glisser ou molette ; Maj : fin) : ouvrir, fermer la fente")
    };
    function nomPlateau() { return st.plateau === "rien" ? TRAD("vide") : TRAD("avec {0}", [{ reseau: TRAD("le réseau"), miroir: TRAD("le miroir"), prisme: TRAD("le prisme") }[st.plateau]]); }
    function survolDessin(t) {
      var v = t.closest("[data-vis]"); if (v) return TXT_VIS[v.getAttribute("data-vis")];
      if (t.closest("[data-past]")) return TRAD("Pastille de la <b>lampe</b> ({0}) — clic : le menu des lampes, Éteindre / Allumer · pas de réglage", [(st.lampe ? LAMPES[st.lampe].court.toLowerCase() : TRAD("éteinte"))]);
      if (t.closest("[data-lampe]")) return TRAD("<b>Lampe</b> ({0}) — clic ou clic droit : le menu des lampes, Éteindre / Allumer · on y lâche une carte « Lampes » de l'étagère", [(st.lampe ? LAMPES[st.lampe].court.toLowerCase() : TRAD("éteinte"))]);
      if (t.closest("[data-ret]")) return TRAD("<b>Lampe du réticule</b> — clic : {0}", [(st.lampe_lunette ? TRAD("l'éteindre et relever la lame (comme pour les mesures : la lame baissée absorbe la moitié de la lumière)") : TRAD("l'allumer, lame baissée : réticule éclairé (autocollimation)"))]);
      var p = PT;
      if (p) {
        if (Math.hypot(p.x, p.y) < 60) return TRAD("<b>Plate-forme</b> ({0}) — {1} · on y lâche une carte de l'étagère", [nomPlateau(), ROT]);
        var l = versL(p), xr = xRet(), xo = xOc();
        if (l.x > xr + 3 && l.x < xo + 17 && Math.abs(l.y) < 14) return TRAD("<b>Oculaire</b> — glisser le long de la lunette, ou molette dessus (Maj : fin · Ctrl+Maj : ultrafin · Ctrl : gros) : le réticule net pour son œil");
        if (l.x > 16 && l.x < xo + 17 && Math.abs(l.y) < 22) return TRAD("<b>Lunette</b> — {0} · lecture : loupe du vernier sous le champ", [ROT]);
        if (p.x < -110 && p.x > xFente() - 10 && Math.abs(p.y) < 22) return TRAD("<b>Collimateur</b> — fixe · on y lâche un filtre (avec la lampe halogène)");
      }
      return TRAD("<b>Goniomètre</b> vu de dessus — glisser la lunette ou la plate-forme pour les tourner · faire rouler les molettes · clic sur la lampe : changer, éteindre · {0} : tous les gestes", [k_("?")]);
    }
    function survol(t) {
      if (D.contains(t)) return survolDessin(t);
      if (cvWrap.contains(t)) return TRAD("<b>Champ de la lunette</b> — molette : ×1, ×2, ×4 autour du pointeur · glisser : se déplacer dans le champ agrandi (au ×1 : l'œil) · Maj+glisser : l'œil, fin (Ctrl+glisser : moins fin) · clic sur un objet : l'œil le regarde · double-clic : tout le champ · {0} (champ choisi) : l'œil", [k_("← → ↑ ↓")]);
      if (t === LP || LP.contains(t)) return TRAD("<b>Loupe du vernier</b> — clic : le vernier entier en grand (clic ou Échap : fermer) · lire, taper la lecture, « Vérifier ma lecture »");
      if (GV.contains(t)) return TRAD("<b>Vernier agrandi</b> — clic ou Échap : fermer");
      if (GP.contains(t)) return TRAD("<b>Gros plan</b> — pastilles : une seule couleur tracée · barre de titre : le déplacer · × : le fermer");
      if (LR.contains(t)) return TRAD("<b>Loupe du réticule</b> — où se forme l'image, par rapport au réticule et au plan que l'œil voit net · barre de titre : la déplacer");
      var et = t.closest(".pl-et[data-etape]");
      if (et) { var d = ETAPES.filter(function (x) { return x.id === et.getAttribute("data-etape"); })[0];
        if (d) return "<b>" + K.esc(d.nom) + "</b> — " + K.esc(d.titre || "") + TRAD(" · clic : les indices visent cette étape ; un second clic : choix automatique"); }
      return null;
    }
    K.gestes({ survol: survol, suivre: function (t) { return D.contains(t); }, defaut: function () {
      return TRAD("<b>Goniomètre</b> — glisser la lunette ou la plate-forme pour les tourner · clic sur la lampe : changer, éteindre · clic sur la petite lampe de la lunette : réticule éclairé ou lame relevée · survoler un organe : ses gestes · {0} : tous les gestes et raccourcis · {1} : annuler",
        [k_("?"), k_(TRAD("Ctrl+Z"))]);
    } });
    K.lecture.setAttribute("data-a3", TRAD("<b>Lecture du vernier</b> — taper degrés et minutes, puis « Vérifier ma lecture » : jamais la valeur, seulement l'écart · « S'entraîner » : une autre position à lire"));
    var GESTES = {
      [TRAD("Goniomètre")]: [[TRAD("glisser la lunette, la plate-forme"), TRAD("la tourner (Maj : dix fois plus lent · Ctrl+Maj : cent fois)")], [TRAD("molette dessus"), TRAD("10′ par cran (Maj 1′ · Ctrl+Maj 0,1′ · Ctrl 100′)")],
        [TRAD("molettes de tirage, de fente"), TRAD("les faire rouler (glisser ou molette ; Maj : fin)")], [TRAD("oculaire"), TRAD("glisser le long de la lunette, ou molette dessus (Maj : fin · Ctrl+Maj : ultrafin · Ctrl : gros)")],
        [TRAD("clic sur la lampe (ou sa pastille)"), TRAD("le menu des lampes ; Éteindre / Allumer")], [TRAD("clic sur la petite lampe de la lunette"), TRAD("réticule éclairé ↔ lampe éteinte et lame relevée")],
        [TRAD("Faisceau, Loupe du réticule, Gros plan"), TRAD("les trois aides : la lumière de la fente à l'œil ; où se forme l'image dans la lunette ; la plate-forme de près (panneaux déplaçables par leur titre)")]],
      [TRAD("Étagère")]: [[TRAD("carte : clic"), TRAD("la poser (remplace) ; sur la carte posée (surlignée) : la retirer")], [TRAD("carte : glisser"), TRAD("sur la plate-forme, la lampe, le collimateur : l'y poser ; ailleurs : rien")],
        [TRAD("onglets"), TRAD("Plate-forme · Lampes · Filtres et diaphragmes (filtres : avec l'halogène ; diaphragmes : devant le réseau)")], [TRAD("▾, Éléments ▴"), TRAD("replier l'étagère, la rouvrir")]],
      [TRAD("Champ")]: [[TRAD("molette"), TRAD("×1, ×2, ×4 autour du pointeur")], [TRAD("− + Tout le champ"), TRAD("palier précédent, suivant ; ×1 et œil recentré")], [TRAD("glisser"), TRAD("se déplacer dans le champ agrandi (au ×1 : l'œil)")],
        [TRAD("Maj+glisser"), TRAD("déplacer l'œil, fin (Ctrl+glisser : moins fin ; ou flèches)")], [TRAD("clic sur un objet"), TRAD("l'œil le regarde")], [TRAD("double-clic"), TRAD("tout le champ, œil recentré")],
        [TRAD("Accommoder, Œil libre, Œil"), TRAD("sous le champ : forcer l'accommodation, la rendre à l'œil, choisir l'œil")], [TRAD("vernier"), TRAD("loupe (clic : en grand), lecture, « Vérifier ma lecture », « S'entraîner »")],
        [TRAD("étapes"), TRAD("clic : les indices visent cette étape ; un second clic : choix automatique")], [TRAD("Manipulations (en bas)"), TRAD("ce que montre un goniomètre : ouvrir une manipulation, « Un indice » aide alors sur elle")], [TRAD("Un indice"), TRAD("ce qu'il faut regarder, et pourquoi ; un second clic : l'organe et le sens du geste ; jamais de valeur")]],
      [TRAD("Clavier")]: [[TRAD("flèches (champ choisi)"), TRAD("déplacer l'œil (Maj : fin)")], ["+ − 0", TRAD("palier du champ, tout le champ")], ["F, L, G", TRAD("aides « Faisceau », « Loupe du réticule », « Gros plan »")], ["?", TRAD("ce panneau")],
        [TRAD("Échap"), TRAD("fermer ce panneau, un menu, le vernier agrandi")], [TRAD("Ctrl+Z, Ctrl+Maj+Z"), TRAD("annuler, rétablir (un glisser ou un tour de molette d'un coup ; le cahier n'est jamais annulé)")]]
    };
    // Touches F, ?, + − 0, où qu'en soit le focus, sauf dans un champ.
    function toucheBandeau(ev) {
      var t = ev.target;
      if (!K.racine.isConnected || ev.ctrlKey || ev.altKey || ev.metaKey) return;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      if (ev.key === "?") K.panneauGestes(GESTES);
      else if (ev.key === "f" || ev.key === "F") basculerFaisceau();
      else if (ev.key === "l" || ev.key === "L") PLo.basculer(!st.loupe);
      else if (ev.key === "g" || ev.key === "G") PGr.basculer(!st.gros);
      else if (ev.key === "+" || ev.key === "=") zoomerChamp(1);
      else if (ev.key === "-" || ev.key === "−") zoomerChamp(-1);
      else if (ev.key === "0") toutLeChamp();
      else return;
      ev.preventDefault();
    }
    document.addEventListener("keydown", toucheBandeau);

    // ================= rangée du bas : étapes, « Un indice » et son texte, « Nouveau dérèglement » =================
    var A = K.actions;
    // ----- étapes : lues sur l'état en direct, au repos (image fine) ; st.deja garde « déjà atteinte » -----
    var aideIndice = null, tAnnonce = null, RA = null, F = {};
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
    function oublierIndice() { aideIndice = null; montrerAide(); bInd.innerHTML = TRAD("Un indice"); }
    // Un clic sur une puce : les indices visent cette étape ; un second clic rend la main au choix automatique.
    var RE = K.etapes(ETAPES, function (id) { st.vise = st.vise === id ? null : id; oublierIndice(); majEtapes(); K.modifie(); });
    // Manipulations (panneau de la coque, bouton au bout de la rangée) : la manipulation ouverte est celle que visent les
    // indices (st.vise) ; les situations à poser sont au mode prof.
    var MP = K.manipulations(MANIPS, { choisir: function (id) { st.vise = st.vise === id ? null : id; oublierIndice(); majEtapes(); K.modifie(); },
      intro: TRAD("Ce qu'un goniomètre permet de voir, dans l'ordre qu'on veut. Ouvrir une manipulation : « Un indice » aide alors sur elle. La case se coche quand on a vu le phénomène."),
      a3: TRAD("<b>Manipulations</b> — ce que montre un goniomètre, un phénomène à la fois : ce qu'on observe, comment faire ; la case se coche quand on l'a vu") });
    function majEtapes() { RE.maj(F, cible(F, st.vise), st.vise); MP.maj(st.app, st.vise); }
    function analyser() {
      try { RA = analyse(st, GO); } catch (e) { return; }
      var avant = F, neuf = [], soin = [], perdu = [];
      var apps = constats(st, RA);
      F = faits(RA, st.deja, st.app);
      ETAPES.forEach(function (e) {
        var a = avant[e.id], n = F[e.id];
        if (n === true && a !== true && a !== "soignee") neuf.push(e.nom);
        if (n === "soignee" && a !== "soignee") soin.push(e.nom);
        if (n === "dereglee" && a !== "dereglee" && a !== undefined) perdu.push(e.nom);
        if (n === true || n === "soignee") st.deja[e.id] = true;
      });
      if (st.vise && F[st.vise] === "soignee") st.vise = null;
      var t = [];
      if (neuf.length) t.push(TRAD("Étape atteinte : {0}.", [neuf.join(", ")]));
      if (soin.length) t.push(TRAD("Étape soignée : {0}.", [soin.join(", ")]));
      if (apps.length) t.push(TRAD("Manipulation : {0}.", [apps.join(", ")]));
      if (perdu.length) t.push(TRAD("Ne l'est plus : {0}", [perdu.join(", ")]) + (perdu.indexOf(ETAPES[0].nom) >= 0 && perdu.length === 1 ?
        TRAD(" (le réglage de l'oculaire est personnel ; la lunette, elle, reste réglée).") : "."));
      if (t.length && analyser.pret) annoncer(t.join(" "));
      analyser.pret = true;
      if (neuf.length || soin.length || apps.length || RA.pointe) K.modifie();
      majEtapes();
    }
    var bInd = K.bouton(K.aide.parentNode, TRAD("Un indice"), function () {
      analyser();
      if (!RA) return;
      var I = indice(st, RA, F, st.vise);
      var n = aideIndice && aideIndice.cle === I.cle && aideIndice.niveau === 1 && I.t2 ? 2 : 1;
      aideIndice = { cle: I.cle, t1: I.t1, t2: I.t2, niveau: n };
      if (tAnnonce) { clearTimeout(tAnnonce); tAnnonce = null; }
      montrerAide();
      bInd.innerHTML = n === 1 && I.t2 ? TRAD("Préciser l'indice") : TRAD("Un indice");
    }, "pl-btn-ind");
    K.aide.parentNode.insertBefore(bInd, K.aide);        // en tête de la ligne, devant son texte
    bInd.setAttribute("data-a3", TRAD("<b>Un indice</b> — ce qu'il faut regarder sur l'étape visée, et pourquoi (cadre bleu : cliquer une étape pour la choisir) ; un second clic : l'organe et le sens du geste · jamais de valeur"));
    montrerAide();
    var bNouv = K.bouton(A, TRAD("Nouveau dérèglement"), function () {
      if (!bNouv.classList.contains("confirme")) {
        bNouv.classList.add("confirme"); bNouv.innerHTML = TRAD("Confirmer : l'appareil repart déréglé");
        setTimeout(function () { bNouv.classList.remove("confirme"); bNouv.innerHTML = TRAD("Nouveau dérèglement"); }, 3500);
        return;
      }
      bNouv.classList.remove("confirme"); bNouv.innerHTML = TRAD("Nouveau dérèglement");
      nouveau(1 + Math.floor(Math.random() * 99998));
    });
    bNouv.setAttribute("data-a3", TRAD("<b>Nouveau dérèglement</b> — un autre appareil à régler (deux clics : on confirme) ; le cahier de mesures et le choix de l'œil sont gardés"));
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
      var garde = { cahier: st.cahier, lumiere: st.lumiere, zoom: st.zoom, type: st.oeil.type, luminosite: st.luminosite };
      st = etatDepart(graine); st.cahier = garde.cahier; st.lumiere = garde.lumiere; st.zoom = garde.zoom; st.oeil.type = garde.type; st.luminosite = garde.luminosite;
      completer(); anim = null; train = null; majTrain();
      F = {}; analyser.pret = false; oublierIndice(); analyser();
      dessinerFixe(); dessinerGraine();
      rafraichir();
      K.sauverMaintenant(); if (K.oublierAnnulations) K.oublierAnnulations();
    }
    function rafraichir() {
      Object.keys(sale).forEach(function (k) { sale[k] = true; });
      Object.keys(VIS).forEach(function (k) { VIS[k].dessiner(); });
      tModif = 0; fin = false; K.modifie();
    }
    dessinerFixe(); dessinerGraine();

    // ================= mode prof : valeurs cachées, configurations types =================
    function effacerEtapes() { st.deja = {}; st.app = {}; st.pointes = []; st.filtresVus = {}; st.vus = null; st.vise = null; F = {}; analyser.pret = false; analyser(); K.modifie(); }
    function appliquer(c) {
      c.f(st, GO); anim = null; train = null; majTrain(); oublierIndice(); completer(); dessinerFixe(); rafraichir();
      PLo.basculer(!!st.loupe); PGr.basculer(!!st.gros);   // une configuration peut ouvrir une aide (prisme : gros plan)
      tourne = null;   // une configuration non animée arrête la précédente (sinon la plate-forme continue de tourner)
      if (c.anime) tourne = { centre: typeof c.anime.centre === "function" ? c.anime.centre(GO) : c.anime.centre, amp: c.anime.amp, T: c.anime.T, t0: maintenant() };   // après rafraichir
    }
    var PR = { panneau: K.panneau("pl-prof", TRAD("Mode prof : valeurs cachées"), { coin: "bas-droite" }) };
    (function () {
      var C = PR.panneau.corps, vals = el("div", "pl-prof-v", C);
      el("p", "pl-prof-t", C, TRAD("Configurations types des réglages (le dérèglement caché est gardé) :"));
      var cf = el("div", "pl-prof-cf", C);
      CONFIGS.forEach(function (c) { if (!c.manip) K.bouton(cf, c.nom, function () { appliquer(c); PR.maj(); }, "pl-btn-p"); });
      el("p", "pl-prof-t", C, TRAD("Situations des manipulations (l'appareil réglé pour montrer le phénomène, d'un coup) :"));
      var cm = el("div", "pl-prof-cf", C);
      CONFIGS.forEach(function (c) { if (c.manip) K.bouton(cm, c.nom, function () { appliquer(c); st.vise = c.id; oublierIndice(); majEtapes(); PR.maj(); }, "pl-btn-p"); });
      var ef = el("div", "pl-prof-cf", C);
      K.bouton(ef, TRAD("Effacer étapes et manipulations"), function () { effacerEtapes(); PR.maj(); }, "pl-btn-p");
      var rg = el("div", "pl-prof-cf", C), zone = null, msg = null;
      function montrerZone(txt) {
        if (!zone) { zone = el("textarea", "pl-prof-etat", C); zone.spellcheck = false; zone.placeholder = TRAD("Coller ici un réglage copié, puis « Charger »."); }
        zone.hidden = false; zone.value = txt == null ? "" : txt; zone.focus(); if (txt != null) zone.select();
      }
      var tMsg = null;
      function dire(t) {   // le message s'efface seul au bout de 2 s
        if (!msg) msg = el("span", "pl-prof-msg", rg); msg.textContent = t;
        clearTimeout(tMsg); tMsg = setTimeout(function () { msg.textContent = ""; }, 2000);
      }
      PR.texteEtat = function () {
        var o = {}; Object.keys(st).forEach(function (k) { if (k !== "cahier") o[k] = st[k]; });
        return "goniometre-etat " + JSON.stringify(o);
      };
      PR.charger = function (txt) {
        var t = String(txt || "").trim().replace(/^goniometre-etat\s*/, ""), o = null;
        try { o = JSON.parse(t); } catch (e) {}
        if (!o || o.v !== 1 || !o.cache || !o.oeil || !o.oeil.h) return false;
        o.cahier = st.cahier; st = o; completer(); anim = null; oublierIndice();
        F = {}; analyser.pret = false; dessinerFixe(); dessinerGraine(); rafraichir(); K.sauverMaintenant(); analyser();
        if (K.oublierAnnulations) K.oublierAnnulations();
        return true;
      };
      K.bouton(rg, TRAD("Copier le réglage actuel"), function () {
        var txt = PR.texteEtat();
        var ok = function () { dire(TRAD("copié dans le presse-papier")); }, ko = function () { montrerZone(txt); dire(TRAD("Ctrl+C pour copier")); };
        try { if (root.navigator && root.navigator.clipboard && root.isSecureContext) root.navigator.clipboard.writeText(txt).then(ok, ko); else ko(); } catch (e) { ko(); }
      }, "pl-btn-p");
      K.bouton(rg, TRAD("Coller un réglage…"), function () { montrerZone(null); dire(""); }, "pl-btn-p");
      K.bouton(rg, TRAD("Charger"), function () {
        if (!PR.charger(zone ? zone.value : "")) { dire(TRAD("réglage illisible")); return; }
        zone.hidden = true; dire(TRAD("réglage chargé")); PR.maj();
      }, "pl-btn-p");
      function f(v, n) { return fmtNb(v, n); }
      PR.lignes = function () {
        var Y = GO.YEUX[st.oeil.type], R = RA, ps = psi(st), mm = function (x) { return f(x * 1e3, 3) + " mm"; };
        var pc = function (x) { var s = x.toPrecision(3); return I18N && I18N.dec() === "." ? s : s.replace(".", ","); };
        var L = [
          [TRAD("Œil"), TRAD("{0} (PR {1} δ, amplitude {2} δ)", [NOMS_OEIL[st.oeil.type], f(Y[0], 1), f(Y[1], 1)])],
          // le niveau affiché est celui de l'œil à cet instant ; la cible entre parenthèses pendant qu'il la rejoint
          [TRAD("Luminosité"), (reelle() ? TRAD("réelle") : TRAD("toujours visible")) + (AD && ADa ? TRAD(" ; œil adapté à {0} cd/m²{1}, pupille {2} mm (tracée {3}), le plus clair {4} cd/m² (seuil {5})",
            [pc(ADa.La), (enRelax() ? TRAD(" (vers {0})", [pc(AD.La)]) : ""), f(AD.D, 1), f(PUP, 2), pc(AD.haut), pc(AD.seuil)]) : "")],
          [TRAD("Oculaire"), TRAD("u {0} ; au repos pour cet œil : {1}{2}", [mm(st.u), mm(uRepos(st, GO)), (R ? TRAD(" (image du réticule à PR {0}{1} δ)", [(R.d.Pr >= 0 ? "+ " : "− "), f(Math.abs(R.d.Pr), 2)]) : "")])],
          [TRAD("Tirage de la lunette"), TRAD("ε {0}  (seuils {1} / {2} mm)", [mm(st.eps), f(SEUILS.eps[0] * 1e3, 2), f(SEUILS.eps[1] * 1e3, 2)])],
          [TRAD("Tirage du collimateur"), TRAD("e_C {0}  (seuils {1} / {2} mm)", [mm(st.eC), f(SEUILS.eC[0] * 1e3, 2), f(SEUILS.eC[1] * 1e3, 2)])],
          [TRAD("Fente"), mm(st.b) + (st.diaph && st.plateau === "reseau" ? TRAD(" ; diaphragme devant le réseau {0}", [mm(st.diaph)]) : "")],
          [TRAD("Lampe"), st.lampe === "X" ? TRAD("inconnue : {0}", [NOMS_GAZ[st.cache.inc]]) : st.lampe ? LAMPES[st.lampe].court + (st.filtre ? TRAD(", filtre {0}", [FILTRES[st.filtre].nom]) : "") : TRAD("éteinte")],
          [TRAD("Vernier (vrai)"), f(lecture(st), 3) + "°"]
        ];
        if (st.plateau === "miroir") L.push([TRAD("Miroir"), TRAD("écart à l'autocollimation β {0}′", [f(GO.wrapDroite(ps - st.phi) / DEG * 60, 1)])]);
        if (st.plateau === "reseau") L.push([TRAD("Réseau"), "incidence i " + f(-GO.wrapDroite(ps) / DEG, 2) + "°"]);
        if (st.plateau === "prisme") L.push([TRAD("Prisme"), TRAD("flint, n(546) = {0}, D_m(546) = {1}°", [f(GO.indicePrisme({}, 546.074), 4), f(devMinPrisme(GO, 546.074) / DEG, 2)])]);
        if (R) L.push([TRAD("Atteint en ce moment"), ETAPES.filter(function (e) { return R.ok[e.id]; }).map(function (e) { return e.nom + (R.top[e.id] ? " ★" : ""); }).join(", ") || TRAD("rien")]);
        return L;
      };
      PR.maj = function () {
        vals.innerHTML = "";
        PR.lignes().forEach(function (x) { var r = el("div", "pl-prof-l", vals); el("span", "pl-prof-k", r, x[0]); el("span", "pl-prof-x", r).textContent = x[1]; });
      };
      PR.panneau.surBascule = function (o) { bProf.setAttribute("aria-pressed", o ? "true" : "false"); if (o) { analyser(); PR.maj(); } };
    })();
    // ================= boucle =================
    var nTick = 0, tRelax = 0;
    // Après le geste, l'image fine est déjà affichée et le niveau d'adaptation rejoint encore sa cible : on refait
    // l'image fine (25 fois par seconde au plus) tant qu'il reste plus de 1 % à parcourir, puis on garde le niveau
    // atteint — la fin du parcours est inaperçue et n'a pas à tourner indéfiniment.
    function relaxe() {
      if (!enRelax() || maintenant() - tRelax < 40) return false;
      tRelax = maintenant();
      return true;
    }
    function tick() {
      if (++nTick % 60 === 0) bProf.hidden = !K.estProf();
      if (tourne) {
        var ph = ((maintenant() - tourne.t0) / tourne.T) % 1, tri = ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph;
        st.plat = wrap(tourne.centre + tourne.amp * tri - (psi(st) - st.plat));
        sale.dessin = sale.champ = sale.lum = true; tModif = maintenant(); fin = false;
      }
      if (anim) sale.champ = sale.lum = true;
      var calc = sale.champ || sale.lum || sale.tete || !fin;
      if (calc) calculer();
      if (sale.dessin) {
        sale.dessin = false;
        dessinerColl(); dessinerPlat(); dessinerLunette();
        Object.keys(VIS).forEach(function (k) { VIS[k].dessiner(); });
      }
      if (sale.etagere) { sale.etagere = false; ETG.dessiner(); }
      if (sale.tete) { sale.tete = false; dessinerTete(); }
      if (sale.lum) { sale.lum = false; dessinerFaisceaux(); dessinerLoupeRet(); dessinerGrosPlan(); }
      if (sale.loupe) { sale.loupe = false; dessinerVernier(); }
      if (sale.champ) {   // aperçu pendant un geste (définition adaptée au temps de calcul), image fine 150 ms après
        sale.champ = false; rendreChamp(false); majEtat(); fin = false;
      } else if (!fin && !anim && maintenant() - tModif > 150) { fin = true; rendreChamp(true); suivrePupille(); majEtat(); analyser();
        if (PR.panneau.ouvert()) PR.maj(); }
      else if (fin && relaxe()) { relaxant = true; rendreChamp(true); relaxant = false; majEtat(); if (PR.panneau.ouvert()) PR.maj(); }
    }
    function redim(S) {
      cvWrap.style.width = cvWrap.style.height = S + "px";
      LP.style.width = S + "px";
      // par pas de 16 px, et le champ n'est recalculé que si la définition change : le pied de l'observation (texte
      // d'une ou deux lignes) redéclenche redim sans que la taille change, ce qui faisait clignoter l'image
      var n = Math.max(240, Math.min(520, Math.round(S / 16) * 16));
      if (n !== Wc) { Wc = n; cv.width = cv.height = n; fin = false; sale.champ = true; }
    }
    D.setAttribute("viewBox", VB.x + " " + VB.y + " " + VB.w + " " + VB.h);
    return {
      viewBox: VB.x + " " + VB.y + " " + VB.w + " " + VB.h,
      reservePied: 176,      // place gardée au pied (texte, lecture) pour calculer la taille de l'image : voir `redim` de la coque
      tick: tick, redim: redim,
      capturer: function () { return st; },
      // Annuler (coque) : les réglages du goniomètre, sans ce qui ne s'annule pas (cahier, zoom, lumière) ni ce
      // qu'`analyser` écrit seul (étapes atteintes, applications, pointés, filtres vus, étape visée) : gardé, il
      // ferait une fausse étape entre un geste et l'analyse. Un autre dérèglement (graine) vide la pile.
      etatAnnulable: function () {
        var o = {}, k; for (k in st) if (SANS_ANNULER.indexOf(k) < 0) o[k] = st[k];
        return o;
      },
      restaurer: function (o) {
        if (!o || o.graine !== st.graine) return;
        var k; for (k in st) if (SANS_ANNULER.indexOf(k) < 0) delete st[k];
        for (k in o) if (SANS_ANNULER.indexOf(k) < 0) st[k] = JSON.parse(JSON.stringify(o[k]));
        completer(); anim = null; tourne = null; train = null; majTrain(); oublierIndice();
        dessinerFixe(); dessinerGraine(); rafraichir(); analyser();
      },
      stop: function () {},
      _etat: function () { return st; }, _vue: function () { calculer(); return V; }, _cahier: CA,
      _rafraichir: function () { completer(); dessinerFixe(); dessinerGraine(); rafraichir(); },
      _train: function () { return train; }, _prof: PR, _tourne: function () { return tourne; },
      _configs: function (i) { appliquer(CONFIGS[i]); }
    };
  }

  P.instruments.goniometre = { creer: creer, modele: Goniometre };
})(typeof window !== "undefined" ? window : this);
