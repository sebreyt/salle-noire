// © 2026 Sébastien Reyt — licence GPLv3 (code) : réutilisation et modification libres, en citant l'auteur, tout dérivé restant sous la même licence. https://www.gnu.org/licenses/gpl-3.0.html — textes, figures et pages : CC BY-NC-SA 4.0.
// Code écrit par Claude (Anthropic), un assistant d'IA, à partir des choix physiques et pédagogiques de l'auteur.
/* Moteur du goniomètre, sans DOM ; `module.exports = { Coeur }` pour node.
 * Il REJOUE la référence Python opération pour opération (concordance à 1e-9) : toute retouche du calcul se fait des deux côtés, puis
 * régénérer les valeurs de contrôle. Conventions, choix de modélisation et forme des profils : docstring
 * de la référence. Module couleur (cie, planck, rgbLin, gammaS, tons) : celui du cœur Michelson,
 * chargé avant ce fichier.
 *
 *   vue(cfg)                       → lunette, pupille utile, accommodation, objets (réticule, image retour, raies)
 *   deltaDeP(cfg, P)               → plan vu net (loupe du réticule de « Voir la lumière »)
 *   preparerChamp(cfg, V, px)      → profils 1D ; xyzChamp(pr, X, Y) → éclairement XYZ en un point du champ
 *   rendreChamp(pr, W, H, o)       → image du champ (RGBA, ou XYZ flottant si o.flottant), par colonnes et lignes
 */
(function (root) {
  "use strict";
  var M = root && root.VITRINE_MICHELSON;
  if (!M && typeof require === "function") M = require("./_app-michelson-coeur.js").Coeur;

  var ARCMIN = Math.PI / 180 / 60;
  var APPAREIL = {
    fC: 0.175, DC: 0.030, fL: 0.175, DL: 0.030, foc: 0.025, champ: 0.008, D1: 0.12, D2: 0.12, a: 1e-3 / 600,
    Lres: 0.040, fil: 15e-6, repere: 1.6e-3, repere_h: 0.25e-3, fente_h: 0.010,
    Lp: 0.040, nA: 1.5943, nB: 8926.0   // prisme équilatéral (côté) en flint F2 : n = nA + nB/λ² (λ en nm)
  };
  var OEIL = { pupille: 3e-3, acuite: ARCMIN, pdc: 0.25 };
  var YEUX = { normal: [0.0, 8.0], myope: [2.0, 8.0], hyper: [-1.0, 8.0], presbyte: [0.0, 1.0] };
  var EFF = [1.0, 0.45, 0.2, 0.08], PMAX = 3;
  var SOURCES = {
    Hg: [[404.656, 0.5], [407.783, 0.05], [435.833, 1.0], [491.604, 0.03], [546.074, 0.8], [576.960, 0.12], [579.066, 0.12]],   // rapports NIST (raies fortes)
    Na: [[588.995, 1.0], [589.592, 1 / 1.2]]   // D₂/D₁ = 1,2 (lampe qui réabsorbe sa lumière ; 2 en vapeur mince), comme le Michelson
  };
  var BLANC_HG = M.BLANC_HG;   // blanc ajouté pour ce qui sort du gamut sRGB côté bleu-vert (rendreChamp ; versRGB du module couleur)
  var cie = M.cie;   // queues rouge et violette corrigées dans le module couleur (cœur Michelson)
  var LUM = { retour: 0.25, lueur: 0.05, voile: 0.002, lame: 0.5, T_lampe: 2800.0, lam_oeil: 550e-9, reticule: 400.0 };
  // Unités absolues : le champ est l'éclairement RÉTINIEN en lux. Les intensités
  // des raies (SOURCES, cfg.spectre) restent relatives ; `echelle` (cd/m² par unité de Y relatif, Y = Σ I ȳ) les rend
  // luminances : cfg.echelle si l'instrument la donne (Cd, lampe inconnue, halogène), sinon luminance typique de la
  // lampe (module couleur, `luminanceSource`) / Σ I ȳ du spectre du cœur. Éclairement rétinien d'une plage de luminance
  // L : L × A_pupille / f_œil² (f_œil = 17 mm ; A = aire de la pupille de l'œil, la part utile étant T). Lampe du
  // réticule (retour, lueur, voile) : sa propre luminance LUM.reticule (cd/m², petite ampoule derrière un
  // verre dépoli, vue par la lame semi-réfléchissante ; ordre de grandeur : l'image retour, 0,25 × 400 = 100 cd/m²,
  // est celle d'une feuille blanche dans une pièce éclairée), indépendante de la lampe à raies (`facteurLampe`).
  var F_OEIL = 0.017, LUM_SOURCES = { Hg: "hgc", Na: "na" };
  // Sans cfg.echelle : spectre du cfg (sinon du cœur) normalisé à la luminance de la lampe (Hg, Na), ou d'une lampe
  // spectrale basse pression (« cd ») pour un spectre d'ailleurs.
  function echelle(cfg) {
    if (cfg.echelle != null) return cfg.echelle;
    var src = cfg.spectre || SOURCES[cfg.lampe], y = 0.0;
    for (var i = 0; i < src.length; i++) y += src[i][1] * cie(src[i][0])[1];
    return M.luminanceSource(LUM_SOURCES[cfg.lampe] || "cd") / y;
  }
  function facteurLampe(cfg) {
    var p = cfg.oeil && cfg.oeil.pupille ? cfg.oeil.pupille : OEIL.pupille;
    return LUM.reticule * Math.PI * p * p / 4 / (F_OEIL * F_OEIL);
  }
  function facteurRetine(cfg) {
    var p = cfg.oeil && cfg.oeil.pupille ? cfg.oeil.pupille : OEIL.pupille;
    return echelle(cfg) * Math.PI * p * p / 4 / (F_OEIL * F_OEIL);
  }

  function app(cfg, k) { var a = cfg.appareil; return a && a[k] !== undefined ? a[k] : APPAREIL[k]; }

  // ================= étage paraxial =================
  function transfert(V, d) { return V / (1 - d * V); }
  function fmod(a, b) { return a % b; }
  function wrap(x) { x = fmod(x + Math.PI, 2 * Math.PI); if (x <= 0) x += 2 * Math.PI; return x - Math.PI; }
  function wrapDroite(x) { x = fmod(x + Math.PI / 2, Math.PI); if (x <= 0) x += Math.PI; return x - Math.PI / 2; }

  function lunette(cfg) {
    var fL = app(cfg, "fL"), foc = app(cfg, "foc");
    var zr = fL + cfg.eps, doc = foc - cfg.u, Lt = zr + doc;
    var e = 1 / (1 / foc - 1 / Lt), G = Lt / foc - 1;
    return { zr: zr, doc: doc, Lt: Lt, e: e, G: G, cercle: app(cfg, "DL") * e / Lt, champ: G * app(cfg, "champ") / 2 / zr };
  }
  function Poeil(L, cfg, Vo) { var V = transfert(Vo, L.Lt) + 1 / app(cfg, "foc"); return -transfert(V, L.e); }
  function Ppoint(L, cfg, d) { return -transfert(-1 / d + 1 / app(cfg, "foc"), L.e); }

  function reticule(cfg, L) {
    var P = Ppoint(L, cfg, L.doc);
    return { id: "reticule", type: "reticule", X0: 0.0, Y0: 0.0, Px: P, Py: P, g: L.G / L.zr,
      fil: L.G * app(cfg, "fil") / L.zr, Delta: 0.0, I: cfg.lampe_lunette ? 1.0 : 0.0 };
  }
  function retour(cfg, L) {
    var fL = app(cfg, "fL"), D2 = app(cfg, "D2"), beta = wrapDroite(cfg.psi - cfg.phi), zr = L.zr;
    function pente(xi, b) {
      function y3(s0) {
        var y1 = xi + s0 * zr, s1 = s0 - y1 / fL, y2 = y1 + s1 * D2, s2 = s1 + 2 * b;
        return [y2 + s2 * D2, s2];
      }
      var A = y3(0.0), B = y3(1.0), t = -A[0] / (B[0] - A[0]);
      return A[1] + t * (B[1] - A[1]);
    }
    var B0 = pente(0.0, beta), A = pente(1.0, 0.0);
    var V = -1 / zr + 1 / fL;
    V = transfert(V, 2 * D2) + 1 / fL;
    var P = Poeil(L, cfg, V), Delta = zr - 1 / V;
    var vis = cfg.lampe_lunette && cfg.plateau === "miroir" ? 1.0 : 0.0;
    return { id: "retour", type: "retour", X0: L.G * B0, Y0: 0.0, Px: P, Py: P, g: L.G * A,
      fil: L.G * Math.abs(A) * app(cfg, "fil"), Delta: Delta, beta: beta, I: vis };
  }
  // Image de la fente pour un faisceau parallèle sortant de la plate-forme (référence : _image).
  function image(cfg, L, V1, lam, Isrc, p, id, th, m, direction, Wout, fg, eff, decal) {
    var fC = app(cfg, "fC"), fL = app(cfg, "fL"), DL = app(cfg, "DL"), D2 = app(cfg, "D2");
    var alpha = wrap(direction - cfg.phi);
    var V2x = transfert(V1 * m * m, D2), V2y = transfert(V1, D2);
    var Vox = V2x + 1 / fL, Voy = V2y + 1 / fL, h0 = D2 * alpha + decal;
    var cap = Math.max(0.0, Math.min(h0 + Wout / 2, DL / 2) - Math.max(h0 - Wout / 2, -DL / 2));
    var sigma = alpha * (1 + D2 * V2x);
    return { id: id, type: "raie", lam: lam, p: p, theta: th, m: m,
      direction: direction, alpha: alpha, X0: L.G * sigma, Y0: 0.0, Px: Poeil(L, cfg, Vox), Py: Poeil(L, cfg, Voy),
      largeur: L.G * m * cfg.b / (fC + cfg.eC), Wcap: cap, Delta: Math.abs(Vox) > 1e-9 ? L.zr - 1 / Vox : null,
      I: Isrc * eff * fg * (cap / Wout) };
  }
  function raies(cfg, L) {
    var fC = app(cfg, "fC"), DC = app(cfg, "DC");
    var D1 = app(cfg, "D1"), a = app(cfg, "a");
    var V0 = -1 / (fC + cfg.eC) + 1 / fC, V1 = transfert(V0, D1);
    var plateau = cfg.plateau || "reseau";
    if (plateau === "miroir") return [];
    var psi = wrapDroite(cfg.psi), out = [], src = cfg.spectre || SOURCES[cfg.lampe];   // spectre : [[λ (nm), I], …] fourni par l'instrument
    for (var r = 0; r < src.length; r++) {
      var lam = src[r][0], Isrc = src[r][1], lm = lam * 1e-9;
      if (plateau === "prisme") {
        var T = trajetsPrisme(cfg, indicePrisme(cfg, lam));
        for (var q = 0; q < T.length; q++) {
          var t = T[q], o = image(cfg, L, V1, lam, Isrc, 1, "raie:" + String(lam) + ":P" + t.k + t.j, t.i2, t.m,
            Math.atan2(t.d[1], t.d[0]), t.Wout, t.Win / DC, 1.0, t.decal);
          o.W = t.Wout; o.decal = t.decal; o.trajet = { e: t.e, s: t.s };
          out.push(o);
        }
        continue;
      }
      var p0 = plateau === "reseau" ? -PMAX : 0, p1 = plateau === "reseau" ? PMAX : 0;
      for (var p = p0; p <= p1; p++) {
        var th, m, direction, Wg, fg, eff, ct;
        if (plateau === "reseau") {
          var si = -Math.sin(psi), s = si + p * lm / a;
          if (Math.abs(s) >= 1) continue;
          var ci = Math.cos(psi);
          th = Math.asin(s); ct = Math.cos(th); m = ci / ct; direction = psi + th;
          Wg = Math.min(DC / ci, app(cfg, "Lres"), cfg.diaph || 1e9);
          fg = Wg * ci / DC; eff = EFF[Math.abs(p)];
        } else { th = 0.0; m = 1.0; direction = 0.0; Wg = DC; fg = 1.0; eff = 1.0; ct = 1.0; }
        out.push(image(cfg, L, V1, lam, Isrc, p, "raie:" + String(lam) + ":" + p, th, m, direction, Wg * ct, fg, eff, 0.0));
      }
    }
    return out;
  }

  // ================= prisme (référence : indice_prisme, refracter, geom_prisme, trajets_prisme) =================
  function indicePrisme(cfg, lam) { return app(cfg, "nA") + app(cfg, "nB") / (lam * lam); }
  function refracter(d, N, nn) {
    var ci = -(N[0] * d[0] + N[1] * d[1]), s2 = nn * nn * (1 - ci * ci);
    if (s2 >= 1) return null;
    var k = nn * ci - Math.sqrt(1 - s2);
    return [nn * d[0] + k * N[0], nn * d[1] + k * N[1]];
  }
  function geomPrisme(cfg) {
    var Rc = app(cfg, "Lp") / Math.sqrt(3), S = [], N = [];
    for (var k = 0; k < 3; k++) {
      S.push([Rc * Math.cos(cfg.psi + 2 * Math.PI * k / 3), Rc * Math.sin(cfg.psi + 2 * Math.PI * k / 3)]);
      N.push([Math.cos(cfg.psi + Math.PI / 3 + 2 * Math.PI * k / 3), Math.sin(cfg.psi + Math.PI / 3 + 2 * Math.PI * k / 3)]);
    }
    return { S: S, N: N };
  }
  function pt(P, Q, s) { return [P[0] + s * (Q[0] - P[0]), P[1] + s * (Q[1] - P[1])]; }
  function sc(u, v) { return u[0] * v[0] + u[1] * v[1]; }
  function trajetsPrisme(cfg, n) {
    var G = geomPrisme(cfg), S = G.S, N = G.N, DC = app(cfg, "DC"), out = [];
    for (var k = 0; k < 3; k++) {
      var A = S[k], B = S[(k + 1) % 3], c0 = N[k][0];
      if (c0 >= 0) continue;
      var ya = Math.max(Math.min(A[1], B[1]), -DC / 2), yb = Math.min(Math.max(A[1], B[1]), DC / 2);
      if (yb <= ya) continue;
      var d1 = refracter([1.0, 0.0], N[k], 1 / n), n1 = [-d1[1], d1[0]];
      var ta = sc(pt(A, B, (ya - A[1]) / (B[1] - A[1])), n1), tb = sc(pt(A, B, (yb - A[1]) / (B[1] - A[1])), n1);
      var t0 = Math.min(ta, tb), t1 = Math.max(ta, tb), tA = sc(A, n1), tB = sc(B, n1);
      for (var j = 0; j < 3; j++) {
        if (j === k) continue;
        var cj = sc(N[j], d1);
        if (cj <= 0) continue;
        var C = S[j], D = S[(j + 1) % 3], tC = sc(C, n1), tD = sc(D, n1);
        var u0 = Math.max(t0, Math.min(tC, tD)), u1 = Math.min(t1, Math.max(tC, tD));
        if (u1 <= u0) continue;
        var d2 = refracter(d1, [-N[j][0], -N[j][1]], n);
        if (d2 === null) continue;
        var ci1 = -c0, cr1 = -sc(N[k], d1), ci2 = sc(N[j], d2);
        var sa = pt(C, D, (u0 - tC) / (tD - tC)), sb = pt(C, D, (u1 - tC) / (tD - tC)), M = [(sa[0] + sb[0]) / 2, (sa[1] + sb[1]) / 2];
        out.push({ k: k, j: j, d: d2, m: ci1 * cj / (cr1 * ci2), Win: (u1 - u0) * ci1 / cr1, Wout: (u1 - u0) * ci2 / cj,
          decal: sc(M, [-d2[1], d2[0]]), i2: Math.atan2(N[j][0] * d2[1] - N[j][1] * d2[0], ci2),
          e: [pt(A, B, (u0 - tA) / (tB - tA)), pt(A, B, (u1 - tA) / (tB - tA))], s: [sa, sb] });
      }
    }
    return out;
  }

  function pupilleUtile(h, dE, dC) {
    var rE = dE / 2, rC = dC / 2, d = Math.hypot(h[0], h[1]);
    if (d >= rE + rC) return { T: 0.0, c: [0.0, 0.0], d: 0.0 };
    if (d <= Math.abs(rC - rE)) {
      if (rE <= rC) return { T: 1.0, c: [h[0], h[1]], d: dE };
      return { T: rC * rC / (rE * rE), c: [0.0, 0.0], d: dC };
    }
    var x1 = (d * d + rC * rC - rE * rE) / (2 * d), x2 = d - x1;
    var q1 = Math.sqrt(rC * rC - x1 * x1), q2 = Math.sqrt(rE * rE - x2 * x2);
    var A1 = rC * rC * Math.acos(x1 / rC) - x1 * q1, A2 = rE * rE * Math.acos(x2 / rE) - x2 * q2;
    var M1 = 2 / 3 * Math.pow(q1, 3), M2 = 2 / 3 * Math.pow(q2, 3), A = A1 + A2;
    var xc = (M1 + A2 * d - M2) / A;
    return { T: A / (Math.PI * rE * rE), c: [xc * h[0] / d, xc * h[1] / d], d: 2 * Math.sqrt(A / Math.PI) };
  }
  function foyer(oe, Pcible) {
    var R = YEUX[oe.type][0], amp = YEUX[oe.type][1], mode = oe.mode || "objet";
    if (mode === "repos") return R + (oe.mi || 0.0);
    if (mode === "curseur") return R + Math.max(0.0, Math.min(amp, oe.acc || 0.0));
    return Math.max(R, Math.min(R + amp, Pcible));
  }

  function vue(cfg) {
    var L = lunette(cfg), objets = [reticule(cfg, L), retour(cfg, L)].concat(raies(cfg, L));
    var oe = cfg.oeil, pu = pupilleUtile(oe.h || [0.0, 0.0], oe.pupille || OEIL.pupille, L.cercle);
    var idc = oe.cible || "reticule", cible = objets[0];
    for (var i = 0; i < objets.length; i++) if (objets[i].id === idc) { cible = objets[i]; break; }
    var Pf = foyer(oe, cible.Px), R = YEUX[oe.type][0], pdc = OEIL.pdc, Wpu = pu.d * L.Lt / L.e;
    objets.forEach(function (o) {
      o.X = o.X0 - pu.c[0] * o.Px;
      o.Y = o.Y0 - pu.c[1] * o.Py;
      o.flou_x = pu.d * Math.abs(o.Px - Pf);
      o.flou_y = pu.d * Math.abs(o.Py - Pf);
      o.net = Math.abs(o.Px - Pf) <= pdc / 2;
      o.champ = Math.abs(o.X) - (o.largeur || 0.0) / 2 < L.champ;
      if (o.type === "raie") {
        var W = Wpu > 0 ? Math.min(o.Wcap, Wpu) : 0.0;
        o.diffraction = W > 0 ? L.G * o.lam * 1e-9 / W : null;
      }
    });
    return { lunette: L, pupille: pu, Pf: Pf, accommodation: Pf - R,
      dans_plage: R - pdc / 2 <= cible.Px && cible.Px <= R + YEUX[oe.type][1] + pdc / 2,
      acuite: OEIL.acuite, objets: objets };
  }
  function deltaDeP(cfg, P) {
    var L = lunette(cfg), foc = app(cfg, "foc"), V = transfert(-P, -L.e), d = 1 / (1 / foc - V);
    return d - L.doc;
  }

  // ================= champ : profils et éclairement =================
  var GH_T = [0.0, 0.8162878828589647, -0.8162878828589647, 1.6735516287674714, -1.6735516287674714,
    2.6519613568352334, -2.6519613568352334];
  var GH_W = [0.8102646175568073, 0.4256072526101278, 0.4256072526101278, 0.05451558281912703, 0.05451558281912703,
    0.0009717812450995192, 0.0009717812450995192];
  var FIL_PX = 1.2;   // largeur affichée minimale d'un fil (pixels), cf. référence
  var FWHM = 2.3548200450309493, RAC2 = Math.sqrt(2), RACPI = Math.sqrt(Math.PI);

  function erfAS(x) {
    var sg = x >= 0 ? 1.0 : -1.0; x = Math.abs(x);
    var t = 1 / (1 + 0.3275911 * x);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return sg * y;
  }
  function cdfDisque(x, R) {
    if (x <= -R) return 0.0;
    if (x >= R) return 1.0;
    var q = x / R;
    return 0.5 + (q * Math.sqrt(1 - q * q) + Math.asin(q)) / Math.PI;
  }
  function noyau(x, R, s) {
    var st = Math.sqrt(s * s + R * R / 4), lim = R + 7 * st;
    if (x <= -lim) return 0.0;
    if (x >= lim) return 1.0;
    if (R <= s) return 0.5 * (1 + erfAS(x / (st * RAC2)));
    var t = 0.0;
    for (var k = 0; k < 7; k++) t += GH_W[k] * cdfDisque(x - RAC2 * s * GH_T[k], R);
    return t / RACPI;
  }
  function couverture(x, c, w, R, s) { return noyau(x - c + w / 2, R, s) - noyau(x - c - w / 2, R, s); }
  var _lampe = null;
  function xyzLampe() {
    if (_lampe) return _lampe;
    var t = [0.0, 0.0, 0.0];
    for (var k = 0; k < 81; k++) {
      var l = 380 + 5 * k, w = M.planck(l, LUM.T_lampe), c = cie(l);
      t[0] += w * c[0]; t[1] += w * c[1]; t[2] += w * c[2];
    }
    return (_lampe = [t[0] / t[1], 1.0, t[2] / t[1]]);
  }

  function preparerChamp(cfg, V, px) {
    var L = V.lunette, pu = V.pupille, T = pu.T;
    var s0 = Math.pow(OEIL.acuite / FWHM, 2) + px * px / 12;
    var lame = cfg.lampe_lunette ? LUM.lame : 1.0, ob = {}, ka = facteurRetine(cfg), kl = facteurLampe(cfg);
    V.objets.forEach(function (o) { ob[o.id] = o; });
    var diffOeil = pu.d > 0 ? LUM.lam_oeil / pu.d : 0.0;
    function sDe(diff) { return Math.sqrt(s0 + Math.pow(0.376 * diff, 2)); }
    function motif(o) {
      return { X: o.X, Y: o.Y, fil: Math.max(o.fil, FIL_PX * px), R: o.flou_x / 2, Ry: o.flou_y / 2, s: sDe(diffOeil),
        xt: o.X + o.g * app(cfg, "repere"), ht: Math.abs(o.g) * app(cfg, "repere_h") };
    }
    var rt = ob.reticule, rr = ob.retour, la = xyzLampe(), bandes = [];
    V.objets.forEach(function (o) {
      if (o.type !== "raie" || o.I <= 0 || !o.champ) return;
      var c = cie(o.lam), k = o.I * T * lame * ka;
      bandes.push({ X: o.X, w: o.largeur, R: o.flou_x / 2, s: sDe(o.diffraction || 0.0), xyz: [k * c[0], k * c[1], k * c[2]],
        sc: k * 1700 / 683 * M.vScot(o.lam) });   // luminance scotopique, exacte pour une raie
    });
    var ret = null;
    if (rr.I > 0) {
      var k = LUM.retour * T * kl;
      ret = { disque: { X: rr.X, Y: rr.Y, rho: Math.abs(rr.g) * app(cfg, "champ") / 2, R: rr.flou_x / 2, s: sDe(diffOeil) },
        motif: motif(rr), xyz: [k * la[0], k * la[1], k * la[2]] };
    }
    var allume = !!cfg.lampe_lunette;
    return { px: px, bandes: bandes, retour: ret, reticule: motif(rt),
      champ: { X: rt.X, Y: rt.Y, rho: L.champ, R: rt.flou_x / 2, s: sDe(diffOeil) },
      lueur: allume ? la.map(function (x) { return LUM.lueur * T * kl * x; }) : null,
      voile: allume ? la.map(function (x) { return LUM.voile * T * kl * x; }) : null,
      scLampe: M.rapportPlanck(LUM.T_lampe) };   // rapport scotopique de la lampe du réticule (corps noir)
  }
  function couvertureMotif(m, X, Y) {
    var cv = couverture(X, m.X, m.fil, m.R, m.s), ch = couverture(Y, m.Y, m.fil, m.Ry, m.s);
    var ct = couverture(X, m.xt, m.fil, m.R, m.s) * couverture(Y, m.Y, 2 * m.ht, m.Ry, m.s);
    return 1 - (1 - cv) * (1 - ch) * (1 - ct);
  }
  function dansDisque(d, X, Y) { return noyau(d.rho - Math.hypot(X - d.X, Y - d.Y), d.R, d.s); }
  function xyzChamp(pr, X, Y) {
    var lum = [0.0, 0.0, 0.0], j;
    for (var i = 0; i < pr.bandes.length; i++) {
      var b = pr.bandes[i], c = couverture(X, b.X, b.w, b.R, b.s);
      for (j = 0; j < 3; j++) lum[j] += c * b.xyz[j];
    }
    if (pr.retour) {
      var r = pr.retour, k = dansDisque(r.disque, X, Y) * (1 - couvertureMotif(r.motif, X, Y));
      for (j = 0; j < 3; j++) lum[j] += k * r.xyz[j];
    }
    if (pr.voile) for (j = 0; j < 3; j++) lum[j] += pr.voile[j];
    var cr = couvertureMotif(pr.reticule, X, Y), m = dansDisque(pr.champ, X, Y);
    for (j = 0; j < 3; j++) lum[j] = (lum[j] * (1 - cr) + (pr.lueur ? pr.lueur[j] * cr : 0.0)) * m;
    return lum;
  }

  // ================= rendu raster =================
  // Pixel (i, j) ↔ X = (i + 0,5 − cx)·px, Y = (cy − j − 0,5)·px. Les termes qui ne dépendent que de X (bandes, fils
  // verticaux, repère) ou que de Y (fils horizontaux) sont calculés une fois par colonne ou par ligne ; le produit
  // est le même que xyzChamp (test de concordance). o = {cx, cy, expo, comp, bal, flottant, vision}.
  // o.vision = {p (parametresVision du module couleur), s (cd/m² par lux rétinien)} : luminosité réelle,
  // chaque pixel passe par `vision` (expo et comp ignorés) avec sa luminance scotopique exacte (raie par raie,
  // corps noir pour la lampe du réticule) au lieu de l'approximation XYZ. Pas de halo
  // de la CIE ici (essayé : contre une raie du mercure il reste au seuil, collé à la raie, pour ~50 ms de calcul).
  function disqueRapide(d) {   // bornes en r² hors desquelles noyau(ρ − r) vaut exactement 0 ou 1 (marge relative 1e-9)
    var st = Math.sqrt(d.s * d.s + d.R * d.R / 4), lim = d.R + 7 * st, a = d.rho - lim, b = d.rho + lim;
    return { X: d.X, Y: d.Y, rho: d.rho, R: d.R, s: d.s, int2: a > 0 ? a * a * (1 - 1e-9) : -1, ext2: b * b * (1 + 1e-9) };
  }
  function rendreChamp(pr, W, H, o) {
    o = o || {};
    var px = pr.px, cx = o.cx != null ? o.cx : W / 2, cy = o.cy != null ? o.cy : H / 2;
    var nb = pr.bandes.length, i, j, q, b;
    var colB = new Float64Array(3 * W), colS = new Float64Array(W), Xs = new Float64Array(W), Ys = new Float64Array(H);
    var vis = o.vision && !o.flottant ? o.vision : null, scL = pr.scLampe || 0;
    var aS = !!vis;
    var mr = pr.reticule, mt = pr.retour && pr.retour.motif;
    var cvR = new Float64Array(W), ctxR = new Float64Array(W), chR = new Float64Array(H), ctyR = new Float64Array(H);
    var cvT = new Float64Array(W), ctxT = new Float64Array(W), chT = new Float64Array(H), ctyT = new Float64Array(H);
    // couverture d'une bande exactement nulle à plus de w/2 + lim de son centre (noyau à 0 ou 1 des deux côtés) :
    // indispensable au peigne serré du continu (plus de mille raies)
    var limB = new Float64Array(nb);
    for (q = 0; q < nb; q++) { b = pr.bandes[q]; limB[q] = b.w / 2 + b.R + 7 * Math.sqrt(b.s * b.s + b.R * b.R / 4); }
    for (i = 0; i < W; i++) {
      var X = (i + 0.5 - cx) * px; Xs[i] = X;
      for (q = 0; q < nb; q++) {
        b = pr.bandes[q];
        if (Math.abs(X - b.X) >= limB[q] * (1 + 1e-9)) continue;
        var c = couverture(X, b.X, b.w, b.R, b.s);
        colB[3 * i] += c * b.xyz[0]; colB[3 * i + 1] += c * b.xyz[1]; colB[3 * i + 2] += c * b.xyz[2];
        if (aS) colS[i] += c * (b.sc || 0);
      }
      cvR[i] = couverture(X, mr.X, mr.fil, mr.R, mr.s); ctxR[i] = couverture(X, mr.xt, mr.fil, mr.R, mr.s);
      if (mt) { cvT[i] = couverture(X, mt.X, mt.fil, mt.R, mt.s); ctxT[i] = couverture(X, mt.xt, mt.fil, mt.R, mt.s); }
    }
    for (j = 0; j < H; j++) {
      var Y = (cy - j - 0.5) * px; Ys[j] = Y;
      chR[j] = couverture(Y, mr.Y, mr.fil, mr.Ry, mr.s); ctyR[j] = couverture(Y, mr.Y, 2 * mr.ht, mr.Ry, mr.s);
      if (mt) { chT[j] = couverture(Y, mt.Y, mt.fil, mt.Ry, mt.s); ctyT[j] = couverture(Y, mt.Y, 2 * mt.ht, mt.Ry, mt.s); }
    }
    var out = o.flottant ? new Float64Array(3 * W * H) : new Uint8ClampedArray(4 * W * H);
    // Disques (champ, image retour) : noyau(ρ − r) vaut exactement 1 en deçà de ρ − lim et 0 au-delà de ρ + lim ;
    // seul l'anneau entre les deux appelle `noyau`. r = √(dx² + dy²) au lieu de Math.hypot (lent) : écart d'un ulp.
    var ch = pr.champ, dc = disqueRapide(ch), dr = mt ? disqueRapide(pr.retour.disque) : null;
    var expo = o.expo || 1, comp = o.comp, bal = o.bal || [1, 1, 1], flot = !!o.flottant;
    var vo = pr.voile, lu = pr.lueur, rx = mt ? pr.retour.xyz : null;
    // couleur : versRGB du cœur Michelson, déroulée sans allocation, et mémoire du dernier triplet (les pixels voisins
    // d'une même zone ont souvent exactement la même valeur)
    var mem0 = NaN, mem1 = NaN, mem2 = NaN, memS = NaN, r0 = 0, r1 = 0, r2 = 0;
    // … et mémoire par colonne (spectre continu : chaque colonne a sa teinte, mais deux pixels l'un au-dessus de
    // l'autre ont la même valeur hors des fils et des bords)
    var cm = flot ? null : new Float64Array(6 * W).fill(NaN);
    var kc = comp > 0 && comp < 1, b0 = expo / bal[0], b1 = expo / bal[1], b2 = expo / bal[2];
    for (j = 0; j < H; j++) {
      var Y = Ys[j], dyc = Y - ch.Y, dyc2 = dyc * dyc, dyr = dr ? Y - dr.Y : 0, dyr2 = dyr * dyr;
      var chRj = 1 - chR[j], ctyRj = ctyR[j], chTj = mt ? 1 - chT[j] : 0, ctyTj = mt ? ctyT[j] : 0;
      for (i = 0; i < W; i++) {
        var k = j * W + i, X = Xs[i], dxc = X - ch.X, rc2 = dxc * dxc + dyc2, m;
        var l0 = 0, l1 = 0, l2 = 0, ls = 0;
        if (rc2 >= dc.ext2) m = 0.0;
        else if (rc2 <= dc.int2) m = 1.0;
        else m = noyau(dc.rho - Math.sqrt(rc2), dc.R, dc.s);
        if (m > 0) {
          l0 = colB[3 * i]; l1 = colB[3 * i + 1]; l2 = colB[3 * i + 2]; ls = colS[i];
          if (mt) {
            var dxr = X - dr.X, rr2 = dxr * dxr + dyr2, md;
            if (rr2 >= dr.ext2) md = 0.0;
            else if (rr2 <= dr.int2) md = 1.0;
            else md = noyau(dr.rho - Math.sqrt(rr2), dr.R, dr.s);
            if (md > 0) {
              var kr = md * (1 - cvT[i]) * chTj * (1 - ctxT[i] * ctyTj);
              l0 += kr * rx[0]; l1 += kr * rx[1]; l2 += kr * rx[2]; ls += kr * rx[1] * scL;
            }
          }
          if (vo) { l0 += vo[0]; l1 += vo[1]; l2 += vo[2]; ls += vo[1] * scL; }
          var cr = 1 - (1 - cvR[i]) * chRj * (1 - ctxR[i] * ctyRj), un = 1 - cr;
          if (lu) { l0 = (l0 * un + lu[0] * cr) * m; l1 = (l1 * un + lu[1] * cr) * m; l2 = (l2 * un + lu[2] * cr) * m; ls = (ls * un + lu[1] * scL * cr) * m; }
          else { l0 = l0 * un * m; l1 = l1 * un * m; l2 = l2 * un * m; ls = ls * un * m; }
        }
        if (flot) { out[3 * k] = l0; out[3 * k + 1] = l1; out[3 * k + 2] = l2; continue; }
        if (vis) {
          var sv = vis.s, h0 = l0 * sv, h1 = l1 * sv, h2 = l2 * sv, hs = ls * sv;
          if (h0 !== mem0 || h1 !== mem1 || h2 !== mem2 || hs !== memS) {
            mem0 = h0; mem1 = h1; mem2 = h2; memS = hs;
            var pv = [vis.p[0], vis.p[1], vis.p[2], h1 > 0 ? hs / h1 : -1], vv = M.vision([h0, h1, h2], pv, bal);
            r0 = 255 * M.gammaS(vv[0]); r1 = 255 * M.gammaS(vv[1]); r2 = 255 * M.gammaS(vv[2]);
          }
          out[4 * k] = r0; out[4 * k + 1] = r1; out[4 * k + 2] = r2; out[4 * k + 3] = 255;
          continue;
        }
        if (l0 !== mem0 || l1 !== mem1 || l2 !== mem2) {
          mem0 = l0; mem1 = l1; mem2 = l2;
          var q6 = 6 * i;
          if (l0 === cm[q6] && l1 === cm[q6 + 1] && l2 === cm[q6 + 2]) { r0 = cm[q6 + 3]; r1 = cm[q6 + 4]; r2 = cm[q6 + 5]; }
          else {
            var c0 = 3.2406 * l0 - 1.5372 * l1 - 0.4986 * l2, c1 = -0.9689 * l0 + 1.8758 * l1 + 0.0415 * l2,
              c2 = 0.0557 * l0 - 0.2040 * l1 + 1.0570 * l2;
            var kk = kc ? Math.pow(Math.max(l1 * expo, 1e-9), comp - 1) : 1;
            // Une lumière spectrale bleu-vert est hors du gamut sRGB (R < 0). L'écraser à 0 laisse un vert pur (0, G, 0)
            // et un bleu pur sur des centaines de pixels : paliers sans dégradé. On ajoute donc du blanc (même valeur
            // aux trois canaux, dans l'espace équilibré) proportionnel à ce qui manque au rouge (BLANC_HG = 0,4 :
            // 1 ferait du vert un turquoise uniforme). Côté rouge (G < 0), rien : le rouge spectral est déjà
            // presque le primaire sRGB, lui ajouter du blanc via B le rend rose.
            var x0 = c0 * b0 * kk, x1 = c1 * b1 * kk, x2 = c2 * b2 * kk, bw = x0 < 0 ? -BLANC_HG * x0 : 0;
            r0 = 255 * M.gammaS(M.tons(x0 + bw)); r1 = 255 * M.gammaS(M.tons(x1 + bw)); r2 = 255 * M.gammaS(M.tons(x2 + bw));
            cm[q6] = l0; cm[q6 + 1] = l1; cm[q6 + 2] = l2; cm[q6 + 3] = r0; cm[q6 + 4] = r1; cm[q6 + 5] = r2;
          }
        }
        out[4 * k] = r0; out[4 * k + 1] = r1; out[4 * k + 2] = r2; out[4 * k + 3] = 255;
      }
    }
    return out;
  }

  var Coeur = {
    APPAREIL: APPAREIL, OEIL: OEIL, F_OEIL: F_OEIL, echelle: echelle, facteurRetine: facteurRetine, facteurLampe: facteurLampe, YEUX: YEUX, EFF: EFF, PMAX: PMAX, SOURCES: SOURCES, LUM: LUM, ARCMIN: ARCMIN,
    transfert: transfert, wrap: wrap, wrapDroite: wrapDroite, lunette: lunette, Poeil: Poeil, Ppoint: Ppoint,
    reticule: reticule, retour: retour, raies: raies, indicePrisme: indicePrisme, geomPrisme: geomPrisme, trajetsPrisme: trajetsPrisme, pt: pt, pupilleUtile: pupilleUtile, foyer: foyer, vue: vue, deltaDeP: deltaDeP,
    erfAS: erfAS, cdfDisque: cdfDisque, noyau: noyau, couverture: couverture, xyzLampe: xyzLampe,
    preparerChamp: preparerChamp, couvertureMotif: couvertureMotif, dansDisque: dansDisque, xyzChamp: xyzChamp,
    rendreChamp: rendreChamp
  };
  if (typeof module !== "undefined" && module.exports) { module.exports = { Coeur: Coeur }; return; }
  root.VITRINE_GONIOMETRE = Coeur;
})(typeof window !== "undefined" ? window : this);
