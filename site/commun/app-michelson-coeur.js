// © 2026 Sébastien Reyt — licence GPLv3 (code) : réutilisation et modification libres, en citant l'auteur, tout dérivé restant sous la même licence. https://www.gnu.org/licenses/gpl-3.0.html — textes, figures et pages : CC BY-NC-SA 4.0.
// Code écrit par Claude (Anthropic), un assistant d'IA, à partir des choix physiques et pédagogiques de l'auteur.
/* Moteur optique de l'interféromètre de Michelson, partagé par plusieurs apps : rien ici n'est propre à la paillasse
 * (ni dessin, ni organes). Sans DOM ; `module.exports = { Coeur }` pour node (test de concordance avec la référence
 * Python, qui reproduit `trajet`, `trace`, `bras`, `preparer`, `contributions` et `evaluer` opération pour
 * opération ; un calcul exact de la source étendue, indépendant, sert d'arbitre). La partie WebGL2 (`creerRenduGL`, `creerMoteur`) n'est appelée que dans le navigateur.
 *
 * MODÈLE (optique paraxiale, schéma replié, séparatrice idéale)
 *  - Repère replié : M1 dans le plan z = 0, M2* dans z = e + ax x + ay y. Le chemin est DÉPLIÉ : abscisse s le long
 *    du trajet, coordonnées transverses (x, y) communes ; une réflexion sur M1 ne change rien, M2* ajoute la
 *    propagation 2e et un écran de phase 2α·ρ (déviation 2α).
 *  - cfg = { spectre, luminance?, source: {d, rayon, intensite?, forme?}, entree: [{d, f?, R?}], miroirs: {e, ax, ay, R1, R2},
 *    sortie: [{d, f?, R?}], detecteur: {d} } ; toutes les distances en mètres, comptées depuis le plan de M1 le long
 *    du trajet (entrée : vers la source ; sortie : vers le détecteur). f = 0 ou absent : diaphragme seul ;
 *    R absent : pas de bord. Œil = sortie [{d, f: focale accommodée, R: 1 mm}] + detecteur à d + 17 mm.
 *  - Un point source S = (xs, ys) émet des rayons de direction θ (2D). Pour chaque bras, `trace` suit la matrice de
 *    transfert depuis la source : position ρ = A ρs + B θ + h, direction u = C ρs + D θ + k (h, k : écrans de
 *    déviation), et le chemin optique LE LONG DU RAYON, L(θ) = L0 + l·θ + m |θ|²/2 (somme des noyaux de Fresnel
 *    d(1 + u²/2) et des écrans −ρ²/2f, 2α·ρ). Au détecteur, X = B_d θ + Q_d : le rayon qui arrive en X a
 *    θ = s (X − Q_d), s = B_d / (B_d² + ε_δ²) (ε_δ : régularisation au foyer, cf. plus bas), d'où
 *    δ(X) = L₂(θ₂(X)) − L₁(θ₁(X)), polynôme du second degré en (X, Y) dont les coefficients sont calculés en double.
 *    Hors foyer (ε ≪ B_d) c'est exactement l'approximation de Fresnel ; elle tient aussi les ondes planes
 *    (source au foyer du collimateur) sans rien d'infini.
 *  - Pupilles (bords des lentilles, des miroirs, iris, pupille de l'œil) : le rayon d'un point source passe au
 *    plan j en ρ_j = B_j θ + Q_j ; la condition |ρ_j| < R_j est un DISQUE dans le plan du détecteur (centre affine en
 *    ρs, rayon |B_d| R_j / |B_j|), flouté par le pixel et la diffraction ; appartenance = MINIMUM des appartenances
 *    (intersection floue), jamais leur produit. Une pupille presque conjuguée de la source est un disque du plan de la
 *    source (tout ou rien).
 *  - Intégration PAR PIXEL de la source (`preparer`, détail en tête de section) : pour chaque pixel, des points ρs
 *    tirés dans le plus petit disque du plan de la source d'où un rayon peut l'atteindre, un jeu par bras (MIS) ;
 *    éclairement L × appartenance / B_d² par unité d'aire de source (conservation de l'étendue), vignetté dans
 *    l'espace des directions près du foyer (`vignettage` : deux taches, image de la lampe).
 *  - I(X) = Σ_ρs [I₁ + I₂ + 2 √(I₁ I₂) Σ_spectre (terme d'interférence, `terme`) × A], A = exp(−2π² σ² |∇δ|² / λ²) :
 *    moyenne sur un pixel gaussien (σ = 0,45 pixel), des franges plus fines qu'un pixel donnent un éclairement
 *    uniforme, sans moiré. Ordre de δ/λ précalculé en double : φ0 = frac(c0 / λ).
 *  - Spectres (`tirage`) : une raie (sodium, mercure, laser) est intégrée EXACTEMENT sur son profil (enveloppe
 *    analytique) ; le continu (halogène) en bandes de nombre d'onde intégrées exactement sous une densité affine
 *    (`bandes`) : aucun tirage spectral, aucune irisation ; couleur CIE 1931 (ajustement de Wyman, Sloan, Shirley
 *    2013) → sRGB linéaire, balance des blancs sur la lampe halogène.
 *  - Passes : une passe = K points par bras et par pixel (spirale de Vogel tournée, rayon stratifié tiré), le spectre
 *    entier ; une image affichée est toujours la moyenne de passes complètes.
 *  - Données d'une passe : texture RGBA32F (en-tête, éléments spectraux, échantillons) et masque de la forme de la
 *    source (R8), décrits en tête de section ; `contributions` les lit pour le processeur (`evaluer`, capteurs).
 *  - Précision : δ jamais formé en float32 comme différence de deux chemins d'un mètre. Le processeur calcule en
 *    double les coefficients, les disques, φ0 ; le shader n'évalue que la partie variable de δ (≤ 1e-3 m).
 *
 * LAMES DE VERRE (cfg.lames, cfg.lamelle ; absentes : séparatrice idéale, infiniment mince)
 *  - cfg.lames = { t, verre, b1, b2, d, fantome } : séparatrice (traitement sur la face côté source et M1) et
 *    compensatrice de même verre (Cauchy) et même épaisseur t, la compensatrice dans le bras de M1, tournée de b1
 *    (axe horizontal, dans son plan) et b2 (axe vertical) par rapport à la position parallèle. Le bras 2 traverse
 *    trois fois la séparatrice, le bras 1 deux fois la compensatrice et une fois la séparatrice. Chaque traversée
 *    ajoute Ψ(u) = t (n cos r − cos θ), cos θ = |û·N|, fonction de la SEULE direction u du rayon (onde plane) :
 *    développée au second ordre en u autour de l'axe, dérivées exactes (`lame`). Compensatrice parallèle : tout se
 *    compense exactement. Tournée : décalage du contact (b2), anneaux elliptiques (terme anisotrope, coefficients
 *    cxx ≠ cyy, cxy), frange achromatique dégradée (dispersion). Le rayon sort décalé de −∇Ψ (≈ 2 mm par traversée à
 *    45°, `trace`) : zone contrastée des franges localisées au bon endroit ; miroirs et banc de sortie centrés sur le
 *    faisceau réel (décalage commun des lames retiré par `decale`, `trajet`), le relatif reste. Ordre 3 en u : de
 *    l'ordre du nm, vérifié contre la géométrie exacte (référence Python).
 *  - Dispersion : le polynôme de δ est calculé à l'indice de la longueur d'onde moyenne du spectre ; pour chaque
 *    élément spectral, l'écart de retard de phase des lames (constant dans le champ à mieux que le nm) entre dans
 *    l'ordre φ0, et l'enveloppe (raie, bande du continu) est centrée au retard de GROUPE (`dispersionGroupe`) : la
 *    frange achromatique sort à l'indice de groupe.
 *  - Image fantôme (fantome = poids relatif) : la réflexion sur une face de la compensatrice puis sur la séparatrice
 *    renvoie vers M1 une part du faisceau, déviée du double de l'angle entre les deux lames ; sommée en intensité
 *    (lignes sans interférence). Compensatrice parallèle : confondue avec l'image principale.
 *  - cfg.lamelle = { bras, ep, verre, nx, ny, c } : lame à faces parallèles devant le miroir du bras, couvrant le
 *    demi-plan nx x + ny y > c (coordonnées transverses dépliées au plan du miroir), traversée deux fois. Chaque point
 *    source donne deux lignes, sans et avec la lamelle, bornées par la droite du détecteur conjuguée du bord
 *    (demi-plan = disque de très grand rayon).
 *  - rendu.pose (m) : flou de mouvement. Pendant un chariotage, δ balaie `pose` pendant l'image ; l'éclairement est
 *    la moyenne sur ce balayage (persistance de l'œil) : terme d'interférence × sinc(π pose / λ), à l'ordre du
 *    milieu du balayage. Au-delà d'une frange par image, les franges se brouillent au lieu de paraître défiler à
 *    l'envers (effet stroboscopique d'un pas de 10 µm = 34 ordres).
 */
(function (root) {
  "use strict";

  // ================= hasard à graine (hash 32 bits, reproduit en Python) =================
  function hash32(x) {
    x = x >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
    x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
    return (x ^ (x >>> 16)) >>> 0;
  }
  // Nombre dans [0, 1) attaché à (graine, passe, k, canal) : accès direct, sans état.
  function u4(g, p, k, j) { return hash32(hash32(hash32(hash32(g) ^ p) ^ k) ^ j) / 4294967296; }

  // ================= couleur =================
  function g1(l, mu, s1, s2) { var t = (l - mu) / (l < mu ? s1 : s2); return Math.exp(-0.5 * t * t); }
  // Fonctions colorimétriques CIE 1931 : approximation de Wyman, Sloan et Shirley (2013), juste à quelques % entre
  // 425 et 650 nm, fausse dans les queues, que `cie` corrige (écarts relevés contre la table CIE à 5 nm) :
  //  - rouge, au-delà de 650 nm : x̄/ȳ retombe de 2,6 à 1,3 à 700 nm (chromaticité 0,57 / 0,43, un orange, au lieu de
  //    0,735 / 0,265 : le rouge lointain vire à l'olive) ; la chromaticité vraie y est presque constante : ȳ gardé
  //    (à 15 % près jusqu'à 720 nm), x̄/ȳ ramené vers 2,77 (sa valeur vraie de 690 à 780 nm) en 40 nm ;
  //  - violet, sous 410 nm : x̄/z̄ retombe à 0,03 en 380 nm (vrai : 0,21, constant de 380 à 410 nm), l'extrémité du
  //    spectre repasse au bleu pur ; x̄/z̄ ramené vers 0,21 en 30 nm ;
  //  - violet, sous 425 nm : ȳ trop grand (×2,2 à 410 nm, ×6 à 380 nm ; la raie de 404,7 nm du mercure sortait 2,7 fois
  //    trop lumineuse) ; ȳ/z̄ ramené vers 0,0059 (vrai de 380 à 415 nm) en 15 nm.
  // Raccords continus (valeurs de l'approximation aux bords : CIE_V410, CIE_Y425, CIE_R650), en lissage cubique.
  // Même calcul, à retoucher ensemble : `cie` de la référence Python, du shader de tracé du banc (GLSL_COMMUN de
  // _app-banc-coeur.js : le test GPU n'y compare que ȳ, une erreur sur x̄ ou z̄ passe) et de copies dans
  // d'autres apps (qui ne chargent pas ce cœur). Goniomètre et instruments : celle-ci (M.cie).
  function cieFit(l) {
    return [1.056 * g1(l, 599.8, 37.9, 31.0) + 0.362 * g1(l, 442.0, 16.0, 26.7) - 0.065 * g1(l, 501.1, 20.4, 26.2),
      0.821 * g1(l, 568.8, 46.9, 40.5) + 0.286 * g1(l, 530.9, 16.3, 31.1),
      1.217 * g1(l, 437.0, 11.8, 36.0) + 0.681 * g1(l, 459.0, 26.0, 13.8)];
  }
  var CIE_V410 = 0.2400237446254625, CIE_Y425 = 0.007351557355164084, CIE_R650 = 2.5824952544821675;
  function lisse(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }
  function cie(l) {
    var c = cieFit(l);
    if (l < 425) c[1] = c[2] * (CIE_Y425 + (0.0059 - CIE_Y425) * lisse((425 - l) / 15));
    if (l < 410) c[0] = c[2] * (CIE_V410 + (0.21 - CIE_V410) * lisse((410 - l) / 30));
    else if (l > 650) c[0] = c[1] * (CIE_R650 + (2.77 - CIE_R650) * lisse((l - 650) / 40));
    return c;
  }
  function rgbLin(c) {
    return [3.2406 * c[0] - 1.5372 * c[1] - 0.4986 * c[2], -0.9689 * c[0] + 1.8758 * c[1] + 0.0415 * c[2],
      0.0557 * c[0] - 0.2040 * c[1] + 1.0570 * c[2]];
  }
  function gammaS(v) { v = Math.max(0, Math.min(1, v)); return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; }
  function tons(v) { return v <= 0 ? 0 : 1 - Math.exp(-v); }       // compression douce des fortes valeurs
  function planck(lnm, T) { var l = lnm * 1e-9; return 1 / (Math.pow(l, 5) * (Math.exp(1.4388e-2 / (l * T)) - 1)); }

  // ================= spectres =================
  // Raies : profil gaussien (largeur = largeur à mi-hauteur), rectangulaire (largeur totale) ou monochromatique.
  // Sodium : 588,995 et 589,592 nm (NIST), D₂/D₁ = 1,2 : 2 dans une vapeur mince, vers 1 quand la lampe réabsorbe
  // sa propre lumière ; il reste un contraste (1,2 − 1)/(1,2 + 1) ≈ 0,09 à l'anticoïncidence, faible mais non nul.
  // Largeur à mi-hauteur 0,012 nm (ℓc = λ²/Δλ ≈ 2,9 cm) : anneaux visibles longtemps (contraste 0,5 vers e ≈ 6,4 mm),
  // brouillés (enveloppe < 0,2) au-delà de e ≈ 9,7 mm, donc dans la course de C₃ quel que soit le contact. Une lampe
  // basse pression idéale serait plus fine (Tolansky : 0,0052 nm, ℓc ≈ 6,7 cm, brouillage hors course). Mercure +
  // filtre vert, haute pression (ampoule claire, arc) : largeur à mi-hauteur 1 nm, ℓc = λ²/Δλ ≈ 0,30 mm (valeur
  // visée ; mesure ENS Lyon : 1,0 ± 0,1 nm, contraste éteint vers δ ≈ 300 µm ; PHYWE P2220600, lampe à ~30 bar :
  // extinction à 0,29 mm) ; profil gaussien, réaliste (le contraste ne
  // renaît pas au-delà de ℓc ; le profil rectangulaire du cours reste disponible : {raies, profil: "rect"}). Mercure +
  // filtre vert, basse pression (lampe spectrale, décharge en vapeur rarefaite — celle qu'on croise en salle de TP,
  // la raie y sert d'étalon de longueur d'onde) : profil quasi limité par l'effet Doppler (≈ 0,3-0,5 pm à 400 K),
  // élargi un peu par les collisions et l'auto-absorption : 0,002 nm, ℓc ≈ 15 cm, brouillage hors de la course de
  // C₃ — de PHYWE lui-même, la même lampe avant que la pression ne s'établisse : le micromètre n'y suffit pas.
  // Mercure sans filtre : raies visibles, rapports NIST des raies fortes (les mêmes que le goniomètre), même lampe que
  // la raie verte : même largeur en nombre d'onde pour toutes (Δλ ∝ λ²), donc ℓc ≈ 0,3 mm pour chacune ; en basse
  // pression (hgcb), mêmes raies fines que hgb (Δλ ∝ λ² aussi, 0,002 nm sur la verte) : loin du contact, chaque raie
  // garde ses franges d'interfrange propre — les teintes se décalent d'une raie à l'autre, irisations bien au-delà du
  // voisinage du contact, comme sur la paillasse. Une raie peut porter sa propre `largeur` (nm), sinon celle du spectre.
  var SPECTRES = {
    na: { raies: [{ l: 588.995, poids: 1.2 }, { l: 589.592, poids: 1 }], profil: "gauss", largeur: 0.012, lmoy: 589.3 },
    hg: { raies: [{ l: 546.1, poids: 1 }], profil: "gauss", largeur: 1.0, lmoy: 546.1 },
    hgb: { raies: [{ l: 546.1, poids: 1 }], profil: "gauss", largeur: 0.002, lmoy: 546.1 },
    hgc: { raies: [[404.656, 0.5], [407.783, 0.05], [435.833, 1], [491.604, 0.03], [546.074, 0.8], [576.960, 0.12], [579.066, 0.12]].map(function (r) {
      return { l: r[0], poids: r[1], largeur: 1.0 * (r[0] / 546.1) * (r[0] / 546.1) }; }), profil: "gauss", lmoy: 500 },
    hgcb: { raies: [[404.656, 0.5], [407.783, 0.05], [435.833, 1], [491.604, 0.03], [546.074, 0.8], [576.960, 0.12], [579.066, 0.12]].map(function (r) {
      return { l: r[0], poids: r[1], largeur: 0.002 * (r[0] / 546.1) * (r[0] / 546.1) }; }), profil: "gauss", lmoy: 500 },
    bl: { continu: [400, 700], T: 3200, lmoy: 550 },
    laser: { raies: [{ l: 632.8, poids: 1 }], profil: "mono", lmoy: 632.8 },
    laserVert: { raies: [{ l: 532, poids: 1 }], profil: "mono", lmoy: 532 }
  };
  function spectreDe(sp) { return typeof sp === "string" ? SPECTRES[sp] : sp; }
  // Éléments spectraux d'une passe (les mêmes pour tous les points sources et toutes les passes) :
  // [{l (nm), w (part du spectre), W: [X, Y, Z], V: [X, Y, Z], kappa (m⁻²), rho (m⁻¹)}], ΣW = xyzSpectre. Le terme
  // d'interférence d'un élément, à la différence de marche de phase δ et de groupe δg, vaut (`terme`)
  //   W env(δg) cos 2πσδ − V j₁(ρ δg) sin 2πσδ,   env = exp(−κ δg²) × sinc(ρ δg),   j₁(x) = (sin x − x cos x)/x².
  //  - Raie : intégrale EXACTE sur son profil (aucun bruit au-delà de ℓc, brouillage uniforme) : profil gaussien
  //    (κ = 2π²(σ_λ/λ0²)²) ou rectangulaire (ρ = πΔλ/λ0²), V = 0 ; monochromatique : env = 1.
  //  - Continu (`bandes`) : M bandes égales en nombre d'onde σ, chacune intégrée EXACTEMENT sous une densité spectrale
  //    affine en σ (poids W = intégrale de la densité, pente V = h (d(σc + h) − d(σc − h)), d = Planck × CIE par unité
  //    de σ) : ∫ (a + b t) e^{2iπ(σc + t)δ} dt = e^{2iπσcδ} (W sinc x + i V j₁(x)), x = 2πhδ. Les densités affines se
  //    raccordent aux bords, d'où une erreur en 1/δ² au lieu de 1/δ : à M = 16, au plus 0,9 % de l'amplitude d'un canal
  //    (X, Y ou Z) dans les teintes de Newton, 0,4 % au-delà de 20 µm (blanc d'ordre supérieur), contre 22 % pour
  //    16 longueurs d'onde tirées sur 27 points sources (ancien tirage : irisations de l'aperçu et de l'image fine).
  //    Rien n'est tiré : aucun bruit spectral, l'image fine ne moyenne plus que la source.
  function tirage(sp, M) {
    if (sp.continu) return bandes(sp, M);
    var out = [], i, ptot = 0;
    for (i = 0; i < sp.raies.length; i++) ptot += sp.raies[i].poids;
    for (i = 0; i < sp.raies.length; i++) {
      var r = sp.raies[i], l0 = r.l * 1e-9, kap = 0, rho = 0, larg = r.largeur != null ? r.largeur : sp.largeur, c = cie(r.l), w = r.poids / ptot;
      if (sp.profil === "gauss") { var sg = larg / 2.3548200450309493 * 1e-9 / (l0 * l0); kap = 2 * Math.PI * Math.PI * sg * sg; }
      else if (sp.profil === "rect") rho = Math.PI * larg * 1e-9 / (l0 * l0);
      out.push({ l: r.l, w: w, W: [w * c[0], w * c[1], w * c[2]], V: [0, 0, 0], kappa: kap, rho: rho });
    }
    return out;
  }
  var BANDES = {};
  function bandes(sp, M) {
    var cle = JSON.stringify(sp) + "|" + M;
    if (BANDES[cle]) return BANDES[cle];
    var s0 = 1e9 / sp.continu[1], s1 = 1e9 / sp.continu[0], h = (s1 - s0) / (2 * M), NS = 32, out = [], tot = [0, 0, 0], P = 0, j, i, k;
    function dens(sg) { var l = 1e9 / sg, w = planck(l, sp.T) * l * l * 1e-18, c = cie(l); return [w * c[0], w * c[1], w * c[2], w]; }
    for (j = 0; j < M; j++) {
      var sc = s0 + (2 * j + 1) * h, W = [0, 0, 0], p = 0, dl = dens(sc - h), dr = dens(sc + h);
      for (i = 0; i < NS; i++) { var d = dens(sc - h + (i + 0.5) / NS * 2 * h); for (k = 0; k < 3; k++) W[k] += d[k]; p += d[3]; }
      for (k = 0; k < 3; k++) { W[k] *= 2 * h / NS; tot[k] += W[k]; }
      p *= 2 * h / NS; P += p;
      out.push({ l: 1e9 / sc, w: p, W: W, V: [h * (dr[0] - dl[0]), h * (dr[1] - dl[1]), h * (dr[2] - dl[2])], kappa: 0, rho: 2 * Math.PI * h });
    }
    var xyz = xyzSpectre(sp);   // ΣW = xyzSpectre exactement (normalisation de la luminance, balance des blancs)
    for (j = 0; j < M; j++) { var o = out[j]; o.w /= P; for (k = 0; k < 3; k++) { var f = xyz[k] / tot[k]; o.W[k] *= f; o.V[k] *= f; } }
    BANDES[cle] = out;
    return out;
  }
  // Enveloppe de cohérence d'une raie à la différence de marche δ (m).
  function enveloppe(kappa, rho, d) {
    var v = Math.exp(-kappa * d * d);
    if (rho > 0) { var x = rho * d; v *= Math.abs(x) < 1e-8 ? 1 : Math.sin(x) / x; }
    return v;
  }
  // Terme d'interférence de l'élément spectral L (entrée de prep.lam) : dd = partie variable de δ, dt = δ entier,
  // t = 0 / 1 (sans / avec lamelle), g2 = |∇δ|² × 2π²σ_pixel² (0 : sans anti-repliement). f reçoit
  // [env sinc cos Φ, env j₁ sin Φ, env sinc sin Φ, env j₁ cos Φ] : partie réelle du canal c = W_c f0 − V_c f1,
  // partie imaginaire = W_c f2 + V_c f3. Même calcul que le shader.
  function terme(L, dd, dt, t, g2, f) {
    var e = dt + L.g[t], env = Math.exp(-g2 * L.inv * L.inv - L.kappa * e * e), sn = 1, jj = 0;
    if (L.rho > 0) {
      var x = L.rho * e;
      if (Math.abs(x) < 0.05) { sn = 1 - x * x / 6; jj = x / 3 - x * x * x / 30; }
      else { var sx = Math.sin(x), cx = Math.cos(x); sn = sx / x; jj = (sx - x * cx) / (x * x); }
    }
    var ph = 2 * Math.PI * (L.ph[t] + dd * L.inv), cp = Math.cos(ph) * env, sp = Math.sin(ph) * env;
    f[0] = sn * cp; f[1] = jj * sp; f[2] = sn * sp; f[3] = jj * cp;
    return f;
  }
  // XYZ moyen du spectre (raies : couleur de λ0 ; continu : quadrature, 4096 strates au milieu) : sert à normaliser
  // la luminance (Y = 1) et à la balance des blancs.
  var XYZ_CACHE = {};
  function xyzSpectre(sp) {
    var cle = JSON.stringify(sp);
    if (XYZ_CACHE[cle]) return XYZ_CACHE[cle];
    var n = 4096, t = [0, 0, 0], i, s, c, tot = 0;
    if (sp.continu) {
      for (s = 0; s < n; s++) {
        var l = sp.continu[0] + (s + 0.5) / n * (sp.continu[1] - sp.continu[0]), w = planck(l, sp.T);
        c = cie(l); t[0] += w * c[0]; t[1] += w * c[1]; t[2] += w * c[2]; tot += w;
      }
      t = [t[0] / tot, t[1] / tot, t[2] / tot];
    } else {
      var ptot = 0; for (i = 0; i < sp.raies.length; i++) ptot += sp.raies[i].poids;
      for (i = 0; i < sp.raies.length; i++) {
        c = cie(sp.raies[i].l); var ww = sp.raies[i].poids / ptot; t[0] += ww * c[0]; t[1] += ww * c[1]; t[2] += ww * c[2];
      }
    }
    XYZ_CACHE[cle] = t;
    return t;
  }
  // Balance des blancs : composantes sRGB linéaires de la lampe halogène rapportées à son vert.
  function balance() { var w = rgbLin(xyzSpectre(SPECTRES.bl)); return [w[0] / w[1], 1, w[2] / w[1]]; }
  // Luminances TYPIQUES des sources (cd/m², partie qui émet), valeurs « moyennes »,
  // jamais calées sur une salle ou des lampes réelles : filament halogène 12 V 100 W (3200 K), lampe spectrale au
  // sodium basse pression, arc d'une lampe au mercure haute pression (ampoule claire), cadmium (lampe spectrale, comme
  // le sodium). Le mercure + filtre vert garde la part de Y de la raie 546 dans le spectre complet, × T du filtre
  // interférentiel (0,6 au pic : celui du banc) ; basse pression, c'est une lampe spectrale comme le sodium : presque
  // tout le vert émis passe le filtre. Laser He-Ne de 1 mW : flux lumineux 683 ȳ(632,8) P (lm), avec le ȳ de
  // ce module (cohérent avec la normalisation Y = 1 des spectres). Le moteur en tire des éclairements en lux.
  var LUMINANCES = { bl: 2.5e7, na: 1e5, hgc: 2e6, hgb: 1e5, hgcb: 1e5, cd: 1e5 }, T_FILTRE_VERT = 0.6, P_LASER = 1e-3;
  function partYRaie(sp, l) {   // part de Y du spectre `sp` (raies) portée par la raie la plus proche de l (nm)
    var ptot = 0, Y = 0, i, best = 0;
    for (i = 0; i < sp.raies.length; i++) { ptot += sp.raies[i].poids; if (Math.abs(sp.raies[i].l - l) < Math.abs(sp.raies[best].l - l)) best = i; }
    for (i = 0; i < sp.raies.length; i++) Y += sp.raies[i].poids / ptot * cie(sp.raies[i].l)[1];
    return sp.raies[best].poids / ptot * cie(sp.raies[best].l)[1] / Y;
  }
  function luminanceSource(nom) {
    if (nom === "hg") return LUMINANCES.hgc * partYRaie(SPECTRES.hgc, 546.1) * T_FILTRE_VERT;
    if (nom === "hgb") return LUMINANCES.hgb * T_FILTRE_VERT;
    if (nom === "hgcb") return LUMINANCES.hgcb;
    if (LUMINANCES[nom] == null) throw new Error("luminance inconnue : " + nom);
    return LUMINANCES[nom];
  }
  function fluxLaser(l) { return 683 * cie(l || 632.8)[1] * P_LASER; }   // l (nm) : 632,8 par défaut (He-Ne), 532 (vert)
  // ================= détecteurs au silicium =================
  // Sensibilité typique d'une photodiode au silicium (A/W ; courbe d'un fabricant, ordre de grandeur : 0,4 A/W à
  // 633 nm, pic ≈ 0,6 A/W vers 900 nm), interpolée linéairement, nulle hors de 300-1120 nm.
  var SI_A_W = [[300, 0.04], [350, 0.1], [400, 0.15], [450, 0.21], [500, 0.27], [550, 0.32], [600, 0.37], [633, 0.4], [700, 0.46],
    [750, 0.5], [800, 0.54], [850, 0.57], [900, 0.6], [950, 0.58], [1000, 0.46], [1050, 0.26], [1100, 0.08], [1120, 0]];
  function reponseSilicium(l) {
    if (l <= SI_A_W[0][0] || l >= SI_A_W[SI_A_W.length - 1][0]) return 0;
    for (var i = 1; i < SI_A_W.length; i++) if (l <= SI_A_W[i][0]) {
      var a = SI_A_W[i - 1], b = SI_A_W[i]; return a[1] + (b[1] - a[1]) * (l - a[0]) / (b[0] - a[0]);
    }
    return 0;
  }
  // Courant d'un détecteur au silicium par lumen reçu (A/lm) pour la lumière d'un spectre, à travers une transmission
  // trans(λ) (filtres ; défaut 1). Raies : exact. Continu (lampe halogène) : le moteur ne compte que le visible
  // (400-700 nm, les lux), mais le silicium voit aussi le proche infrarouge du filament : numérateur de Planck sur
  // 300-1120 nm, dénominateur sur la fenêtre du spectre (c'est sur elle que le moteur rend ses lux).
  function amperesParLumen(sp, trans) {
    sp = spectreDe(sp); trans = trans || function () { return 1; };
    var num = 0, den = 0, i, l, w;
    if (sp.raies) {
      for (i = 0; i < sp.raies.length; i++) { l = sp.raies[i].l; w = sp.raies[i].poids * trans(l); num += w * reponseSilicium(l); den += w * cie(l)[1]; }
    } else {
      for (l = 300.5; l < 1120; l += 1) { w = planck(l, sp.T) * trans(l); num += w * reponseSilicium(l); if (l >= sp.continu[0] && l <= sp.continu[1]) den += w * cie(l)[1]; }
    }
    return den > 0 ? num / (683 * den) : 0;
  }

  // ================= source échantillonnée =================
  var OR = Math.PI * (3 - Math.sqrt(5));
  // Passe p : N points couvrant TOUT le disque (spirale de Vogel tournée d'un angle tiré, rayon stratifié tiré), les
  // nb ≈ 2√N derniers sur un anneau au bord (rayon médian de la couronne qu'ils représentent). Sans cet anneau, une
  // douzaine de points seulement touchent le bord : en une passe (aperçu pendant un geste), l'image d'une source vue
  // défocalisée (œil qui n'accommode pas sur elle) avait un bord festonné, chaque point y posant son disque de flou.
  function pointsSource(R, N, g, p) {
    if (!(R > 0)) return [{ x: 0, y: 0 }];
    var rot = 2 * Math.PI * u4(g, p, 0x7fffffff, 1), out = [];
    var nb = N >= 16 ? Math.floor(2 * Math.sqrt(N) + 0.5) : 0, Ni = N - nb, Rb = R * Math.sqrt(1 - nb / (2 * N));
    for (var k = 0; k < N; k++) {
      var r = k < Ni ? R * Math.sqrt((k + u4(g, p, k, 2)) / N) : Rb, th = k * OR + rot;
      out.push({ x: r * Math.cos(th), y: r * Math.sin(th) });
    }
    return out;
  }

  // ================= lames de verre =================
  // Verres : loi de Cauchy n = A + B/λ² (λ en m). BK7 (lames) : n(589 nm) = 1,5167, n(400 nm) = 1,5309, n(700 nm) =
  // 1,5132 ; écart à la formule de Sellmeier de Schott (N-BK7) ≤ 1,1e-4 sur 400-700 nm, indice de groupe à 0,0015.
  // D 263 M (lamelles couvre-objet, Schott) : ajusté sur n_e = 1,5255 et ν_e = 55, d'où n_D = 1,5232 (fiche : 1,5230).
  var VERRES = { bk7: { A: 1.5046, B: 4.20e-15 }, d263: { A: 1.5089, B: 4.96e-15 } };
  function indice(verre, lnm) { var v = typeof verre === "string" ? VERRES[verre] : verre, l = lnm * 1e-9; return v.A + v.B / (l * l); }
  // Chemin ajouté par une traversée (onde plane, cos θ = c) : F(c) = t (n cos r − cos θ) = t (√(n² − 1 + c²) − c).
  function cheminLame(t, n, c) { return t * (Math.sqrt(n * n - 1 + c * c) - c); }
  // Repère du laboratoire : X vers la sortie, Y vers la source, Z vertical ; séparatrice de normale (1, −1, 0)/√2.
  // Segments du trajet replié : [axe, direction de +x déplié, de +y déplié] (x déplié = −Y dans le bras de M1 et à la
  // sortie, −X à l'entrée et dans le bras de M2 ; y déplié = Z).
  var R2 = Math.SQRT1_2, NSEP = [R2, -R2, 0];
  var SEG = {
    entree: [[0, -1, 0], [-1, 0, 0], [0, 0, 1]], retour2: [[0, 1, 0], [-1, 0, 0], [0, 0, 1]],
    aller1: [[-1, 0, 0], [0, -1, 0], [0, 0, 1]], sortie: [[1, 0, 0], [0, -1, 0], [0, 0, 1]],
    normal: [[0, 0, 1], [1, 0, 0], [0, 1, 0]]      // lame perpendiculaire à l'axe (lamelle), normale [0, 0, 1]
  };
  function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function rot3(v, ax, a) {   // rotation de v d'un angle a autour de l'axe unitaire ax (Rodrigues)
    var c = Math.cos(a), s = Math.sin(a), d = dot3(ax, v) * (1 - c);
    return [v[0] * c + (ax[1] * v[2] - ax[2] * v[1]) * s + ax[0] * d, v[1] * c + (ax[2] * v[0] - ax[0] * v[2]) * s + ax[1] * d,
      v[2] * c + (ax[0] * v[1] - ax[1] * v[0]) * s + ax[2] * d];
  }
  function refl3(v, n) { var d = 2 * dot3(v, n); return [v[0] - d * n[0], v[1] - d * n[1], v[2] - d * n[2]]; }
  // Compensatrice tournée de b2 autour de la verticale, puis de b1 autour de son axe horizontal.
  function normaleCompensatrice(b1, b2) { return rot3(rot3(NSEP, [0, 0, 1], b2), [R2, R2, 0], b1); }
  // Image fantôme : séparatrice, face de la compensatrice, séparatrice, puis M1 ; déviation (dépliée) par rapport au
  // faisceau principal (séparatrice puis M1), pour le rayon axial.
  function deviationFantome(Nc) {
    var din = [0, -1, 0], g = refl3(refl3(refl3(din, NSEP), Nc), NSEP), S = SEG.aller1, a = dot3(g, S[0]);
    return [dot3(g, S[1]) / a, dot3(g, S[2]) / a];
  }
  // Traversée d'une lame de normale N par le segment seg : Ψ(u) = F(|û·N|), û = (p0 + ux px + uy py)/√(1 + u²),
  // développée au second ordre autour de u = 0 : Ψ0 + g·u + ½ uᵀHu (∇c = σq, Hess c = −|p| I).
  function lame(t, verre, nref, N, seg, nom) {
    var p = dot3(seg[0], N), qx = dot3(seg[1], N), qy = dot3(seg[2], N), c = Math.abs(p), sg = p < 0 ? -1 : 1;
    var n = indice(verre, nref), K = n * n - 1 + c * c, F1 = t * (c / Math.sqrt(K) - 1), F2 = t * (n * n - 1) / (K * Math.sqrt(K));
    return { type: "lame", nom: nom, t: t, verre: verre, c: c, P0: cheminLame(t, n, c), gx: F1 * sg * qx, gy: F1 * sg * qy,
      hxx: F2 * qx * qx - F1 * c, hxy: F2 * qx * qy, hyy: F2 * qy * qy - F1 * c };
  }
  // Retard de phase des lames du trajet à la longueur d'onde lnm, moins celui à l'indice de référence (déjà dans δ).
  function dispersion(el, lnm) {
    var D = 0;
    for (var i = 0; i < el.length; i++) { var o = el[i]; if (o.type === "lame") D += cheminLame(o.t, indice(o.verre, lnm), o.c) - o.P0; }
    return D;
  }
  // Retard de GROUPE des lames, moins le retard de phase à l'indice de référence : d(σ·dispersion)/dσ =
  // dispersion + σ (dP/dn)(dn/dσ), dP/dn = t n / √(n² − 1 + c²), σ dn/dσ = 2B/λ² (Cauchy). Centre de l'enveloppe d'une
  // raie ou d'une bande (`terme`) : la frange achromatique sort à l'indice de groupe.
  function dispersionGroupe(el, lnm) {
    var D = 0, l = lnm * 1e-9;
    for (var i = 0; i < el.length; i++) {
      var o = el[i]; if (o.type !== "lame") continue;
      var v = typeof o.verre === "string" ? VERRES[o.verre] : o.verre, n = indice(o.verre, lnm);
      D += cheminLame(o.t, n, o.c) - o.P0 + o.t * n / Math.sqrt(n * n - 1 + o.c * o.c) * 2 * v.B / (l * l);
    }
    return D;
  }

  // ================= tracé d'un point source =================
  // Éléments du trajet déplié pour un bras : [{type: "prop", d} | {type: "lentille", f} | {type: "pupille", R, nom}
  // | {type: "devie", ax, ay} | {type: "lame", …} | {type: "repere", nom} | {type: "decale", dx, dy}], de la source
  // au détecteur. opt = { lamelle: vrai (traverser la lamelle de ce bras), fantome: vrai (bras 1 : image fantôme) }.
  // Montures centrées sur le faisceau RÉEL : les lames décalent le rayon d'axe (`trace`, ≈ 2 mm par traversée à 45°),
  // et un vrai appareil est construit sur ce faisceau (miroirs, banc de sortie). `decale` change l'origine des
  // coordonnées transverses (aucun chemin) : avant le miroir, du décalage commun du rayon d'axe à l'aller ; après la
  // dernière lame, de ce qu'il gagne au retour. Décalage commun = celui de la séparatrice seule (compensatrice
  // parallèle, identique dans les deux bras) : une compensatrice tournée garde son décalage RELATIF. Sans ces
  // translations, miroirs et sortie restaient centrés sur l'axe géométrique et le champ vu était coupé d'un côté
  // (−93 % .. +55 % du demi-champ de l'œil, lames de 6 mm).
  function decalageCommun(LA, nref, segs) {
    var x = 0, y = 0;
    for (var i = 0; i < segs.length; i++) { var g = lame(LA.t, LA.verre || "bk7", nref, NSEP, SEG[segs[i]], ""); x -= g.gx; y -= g.gy; }
    return [x, y];
  }
  function trajet(cfg, bras, opt) {
    opt = opt || {};
    var src = cfg.source, mir = cfg.miroirs, el = [], z = src.d, i;
    var LA = cfg.lames || null, nref = spectreDe(cfg.spectre).lmoy, Nc = LA ? normaleCompensatrice(LA.b1 || 0, LA.b2 || 0) : null;
    var LL = opt.lamelle && cfg.lamelle && cfg.lamelle.bras === bras ? cfg.lamelle : null;
    function verre(N, seg, nom) { el.push(lame(LA.t, LA.verre || "bk7", nref, N, SEG[seg], nom)); }
    function lamelle() { el.push(lame(LL.ep, LL.verre || "bk7", nref, [0, 0, 1], SEG.normal, "lamelle")); }
    var cM = LA ? decalageCommun(LA, nref, ["entree"]) : null, cR = LA ? decalageCommun(LA, nref, ["retour2", "sortie"]) : null;
    function decale(c) { if (c) el.push({ type: "decale", dx: c[0], dy: c[1] }); }   // origine portée en c
    var ent = (cfg.entree || []).slice().sort(function (a, b) { return b.d - a.d; });
    for (i = 0; i < ent.length; i++) {
      var o = ent[i]; if (!(o.d < src.d) || o.d < 0) continue;
      el.push({ type: "prop", d: z - o.d }); z = o.d;
      if (o.R > 0 && isFinite(o.R)) el.push({ type: "pupille", R: o.R, nom: o.nom || "entree" + i });
      if (o.f) el.push({ type: "lentille", f: o.f });
    }
    if (bras === 1) {
      if (opt.fantome && LA) {                       // déviation à la séparatrice (distance LA.d de M1)
        var ds = Math.min(z, LA.d || 0), g = deviationFantome(Nc);
        el.push({ type: "prop", d: z - ds }); el.push({ type: "devie", ax: g[0], ay: g[1] }); el.push({ type: "prop", d: ds });
      } else el.push({ type: "prop", d: z });
      if (LA) verre(Nc, "aller1", "compensatrice");
      decale(cM);
      el.push({ type: "repere", nom: "miroir" });
      if (mir.R1 > 0 && isFinite(mir.R1)) el.push({ type: "pupille", R: mir.R1, nom: "M1" });
      if (LL) { lamelle(); lamelle(); }
      if (LA) { verre(Nc, "sortie", "compensatrice"); verre(NSEP, "sortie", "separatrice"); }
    } else {
      if (LA) verre(NSEP, "entree", "separatrice");
      el.push({ type: "prop", d: z + mir.e });
      decale(cM);
      el.push({ type: "repere", nom: "miroir" });
      if (mir.R2 > 0 && isFinite(mir.R2)) el.push({ type: "pupille", R: mir.R2, nom: "M2" });
      if (LL) lamelle();
      el.push({ type: "devie", ax: 2 * mir.ax, ay: 2 * mir.ay });
      if (LL) lamelle();
      el.push({ type: "prop", d: mir.e });
      if (LA) { verre(NSEP, "retour2", "separatrice"); verre(NSEP, "sortie", "separatrice"); }
    }
    decale(cR);
    z = 0;
    var sor = (cfg.sortie || []).slice().sort(function (a, b) { return a.d - b.d; });
    for (i = 0; i < sor.length; i++) {
      var q = sor[i]; if (!(q.d < cfg.detecteur.d)) continue;
      el.push({ type: "prop", d: q.d - z }); z = q.d;
      var ox = q.ox || 0, oy = q.oy || 0;   // élément décalé (œil déplacé latéralement) : centre (ox, oy)
      if (q.R > 0 && isFinite(q.R)) el.push({ type: "pupille", R: q.R, nom: q.nom || "sortie" + i, ox: ox, oy: oy });
      if (q.f) {
        el.push({ type: "lentille", f: q.f });
        // lentille de centre h = lentille centrée + prisme de déviation h/f (−|q−h|²/2f = −q²/2f + q·h/f + cte)
        if (ox || oy) el.push({ type: "devie", ax: ox / q.f, ay: oy / q.f });
      }
    }
    el.push({ type: "prop", d: cfg.detecteur.d - z });
    return el;
  }
  // Suit le rayon (ρs, θ) : renvoie l'état au détecteur et les pupilles rencontrées. Chemin le long du rayon :
  // L(θ) = L0 + l·θ + ½ θᵀMθ, M = m I + G (G : partie anisotrope des lames).
  // Lame (déphasage Ψ(u) = P0 + g·u + ½ uᵀHu de chaque onde plane, H = h̄ I + Hₐ) : le rayon sort DÉCALÉ de −∇Ψ (règle
  // de la caractéristique angulaire), et le chemin entre deux plans de front vaut Ψ − u·∇Ψ = P0 − ½ h̄ |u|² pour la
  // partie g + h̄ I : positions A −= h̄ C, B −= h̄ D, h −= g + h̄ k (lame à incidence normale : distance apparente réduite
  // de t(1 − 1/n) ; lame à 45° : rayon décalé de ≈ 2 mm). Ancien modèle (Ψ ajouté au chemin, rayon NON décalé) : juste à
  // l'infini, mais pour des franges localisées le terme g·θ, multiplié par des s = 1/B_d différents dans les deux bras,
  // devenait un faux terme en ρs qui déplaçait la zone contrastée de 3 mm (compensatrice parallèle, œil sur les
  // miroirs ; physiquement les deux bras sont identiques et elle ne bouge pas). La partie anisotrope Hₐ (≈ 1,6e-3 m par
  // lame à 45°) reste au chemin sans décalage : B et A sont des scalaires ; erreur ≤ 0,2 mm sur la zone contrastée.
  function trace(el, xs, ys) {
    var A = 1, B = 0, C = 0, D = 1, hx = 0, hy = 0, kx = 0, ky = 0;
    var L0 = 0, lx = 0, ly = 0, m = 0, gxx = 0, gxy = 0, gyy = 0, pup = [], rep = {};
    for (var i = 0; i < el.length; i++) {
      var o = el[i], qx = A * xs + hx, qy = A * ys + hy, ux = C * xs + kx, uy = C * ys + ky;
      if (o.type === "prop") {
        var d = o.d;
        L0 += d * (1 + (ux * ux + uy * uy) / 2); lx += d * D * ux; ly += d * D * uy; m += d * D * D;
        A += d * C; B += d * D; hx += d * kx; hy += d * ky;
      } else if (o.type === "lentille") {
        var f = o.f;
        L0 -= (qx * qx + qy * qy) / (2 * f); lx -= B * qx / f; ly -= B * qy / f; m -= B * B / f;
        C -= A / f; D -= B / f; kx -= hx / f; ky -= hy / f;
      } else if (o.type === "devie") {
        L0 += o.ax * qx + o.ay * qy; lx += o.ax * B; ly += o.ay * B;
        kx += o.ax; ky += o.ay;
      } else if (o.type === "pupille") {
        pup.push({ A: A, B: B, qx: qx - (o.ox || 0), qy: qy - (o.oy || 0), R: o.R, nom: o.nom });   // q relatif au centre
      } else if (o.type === "lame") {               // Ψ(u), u = u0 + D θ (cf. en tête de fonction)
        var hb = (o.hxx + o.hyy) / 2, axx = o.hxx - hb, ayy = o.hyy - hb, axy = o.hxy;
        L0 += o.P0 - 0.5 * hb * (ux * ux + uy * uy) + 0.5 * (axx * ux * ux + 2 * axy * ux * uy + ayy * uy * uy);
        lx += D * (axx * ux + axy * uy - hb * ux); ly += D * (axy * ux + ayy * uy - hb * uy);
        m -= D * D * hb; gxx += D * D * axx; gxy += D * D * axy; gyy += D * D * ayy;
        A -= hb * C; B -= hb * D; hx -= o.gx + hb * kx; hy -= o.gy + hb * ky;
      } else if (o.type === "decale") {             // nouvelle origine transverse (montures sur le faisceau réel)
        hx -= o.dx; hy -= o.dy;
      } else if (o.type === "repere") {
        rep[o.nom] = { A: A, B: B, qx: qx, qy: qy };
      }
    }
    return { A: A, B: B, qx: A * xs + hx, qy: A * ys + hy, L0: L0, lx: lx, ly: ly, m: m, gxx: gxx, gxy: gxy, gyy: gyy, pup: pup, rep: rep };
  }

  // Ce que voit le détecteur d'un bras (point source traité) : intensité, disques, coefficients de L(X).
  //   rendu = { pixel (m), W (demi-côté du champ, m), cx0, cy0 (centre), patch (rayon du morceau de source que
  //             représente un point, m), lmoy (nm), diffraction (bool) }
  function bras(t, rendu) {
    var Bd = t.B, Ad = t.A, disques = [], fconj = 1, bind = null;
    var wpix = rendu.pixel || 0, patch = rendu.patch || 0, lm = (rendu.lmoy || 550) * 1e-9;
    for (var j = 0; j < t.pup.length; j++) {
      var p = t.pup[j], Bp = Bd * p.A - Ad * p.B;          // élément B du transfert pupille → détecteur
      if (Math.abs(p.B) < 1e-12) {                          // pupille conjuguée de la source : tout ou rien
        var sc = patch * Math.abs(p.A) + 1e-12;
        fconj *= Math.max(0, Math.min(1, (p.R - Math.hypot(p.qx, p.qy)) / sc + 0.5));
        continue;
      }
      var Rth = p.R / Math.abs(p.B), cx = t.qx - Bd * p.qx / p.B, cy = t.qy - Bd * p.qy / p.B, r = Math.abs(Bd) * Rth;
      var wd = rendu.diffraction ? 0.61 * lm * Math.abs(Bp) / p.R : 0, wp = patch * Math.abs(Bp / p.B);
      var w = Math.sqrt(wpix * wpix + wd * wd + wp * wp);
      var dsq = { cx: cx, cy: cy, r: r, w: w, wd: wd, Rth: Rth, nom: p.nom };
      disques.push(dsq);
      if (!bind || Rth < bind.Rth) bind = dsq;
    }
    // ε (flux) : tout le flou ; ε_δ (chemin) : la seule diffraction, très réduite. Un flou de pixel ou de pas de source
    // dans ε_δ écraserait δ dès que la tache d'un point source est petite SANS être au foyer (œil devant un grand
    // dépoli : pupille de 2 mm), et les anneaux disparaîtraient.
    var eps2 = bind ? 13 / 12 * bind.w * bind.w / (bind.Rth * bind.Rth) : 0;
    var epsd2 = bind ? 0.0025 * bind.wd * bind.wd / (bind.Rth * bind.Rth) : 0;
    var den = Bd * Bd + eps2, dend = Bd * Bd + epsd2, s = dend > 0 ? Bd / dend : 0;
    // L(X) = L0 + s l·(X − Q) + (s²/2)(X − Q)ᵀ M (X − Q)
    var s2 = s * s / 2, mxx = t.m + t.gxx, myy = t.m + t.gyy, mxy = t.gxy, Qx = t.qx, Qy = t.qy;
    return {
      I: den > 0 ? fconj / den : 0, disques: disques, s: s, eps2: eps2, epsd2: epsd2, Bd: Bd, qx: Qx, qy: Qy, rep: t.rep,
      c: t.L0 - s * (t.lx * Qx + t.ly * Qy) + s2 * (mxx * Qx * Qx + 2 * mxy * Qx * Qy + myy * Qy * Qy),
      cx: s * t.lx - 2 * s2 * (mxx * Qx + mxy * Qy), cy: s * t.ly - 2 * s2 * (mxy * Qx + myy * Qy),
      cxx: s2 * mxx, cyy: s2 * myy, cxy: 2 * s2 * mxy
    };
  }
  // Tracé complet d'un point source : les deux bras. cq = partie isotrope (moyenne de cxx et cyy).
  function pointSource(cfg, rendu, xs, ys, el1, el2) {
    var b1 = bras(trace(el1 || trajet(cfg, 1), xs, ys), rendu), b2 = bras(trace(el2 || trajet(cfg, 2), xs, ys), rendu);
    var cxx = b2.cxx - b1.cxx, cyy = b2.cyy - b1.cyy;
    return { b1: b1, b2: b2, c0: b2.c - b1.c, cx: b2.cx - b1.cx, cy: b2.cy - b1.cy, cxx: cxx, cyy: cyy, cxy: b2.cxy - b1.cxy, cq: (cxx + cyy) / 2 };
  }
  // δ(X, Y) pour un point source (double) : pour les tests.
  function delta(cfg, xs, ys, X, Y, rendu) {
    var P = pointSource(cfg, rendu || {}, xs, ys);
    return P.c0 + P.cx * X + P.cy * Y + P.cxx * X * X + P.cyy * Y * Y + P.cxy * X * Y;
  }

  // ================= préparation d'une passe (données du shader) =================
  // INTÉGRATION PAR PIXEL. Les rayons d'un bras qui arrivent au pixel X forment une
  // famille à deux paramètres, repérée par le point source ρs (commun aux deux bras : c'est lui qui apparie les deux
  // ondes qui interfèrent). Pour chaque pixel, K points sont tirés dans le PLUS PETIT disque du plan de la source d'où
  // un rayon de ce bras peut l'atteindre (souvent la pupille de l'œil vue depuis la source : 1 à 3 mm de dépoli, voire
  // quelques dizaines de µm), un jeu par bras (et par image fantôme), poids d'échantillonnage préférentiel combinés
  // (heuristique de la balance : W = 1 / Σ_c K_c [ρs ∈ D_c] / aire(D_c)) : le terme croisé est estimé sur les mêmes
  // points que les termes propres, |Γ| ≤ √(I₁ I₂) point par point. Rien n'est étalé : le contraste suit le vrai cône de
  // la pupille (une source qui le déborde n'est plus brouillée par l'iris), sans grain ni volutes.
  //  - Pupille j d'un bras, pour le point source ρs : disque du détecteur de centre c_j(ρs) = k_j ρs + c0_j (affine),
  //    de rayon |B_d| R_j / |B_j| (cône de demi-angle Rθ_j = R_j / |B_j|), flouté par w_j = √(pixel² + diffraction²) ;
  //    appartenance floue (r' − |X − c_j|) / w_j + ½, r' = √(r² + w²), MINIMUM sur les pupilles (comme avant).
  //    Pupille dont le cône dépasse 100 fois celui de la pupille limitante (presque conjuguée de la source) : test sur
  //    ρs seul (disque du plan de la source), comme une pupille conjuguée (B_j = 0).
  //  - Éclairement par unité d'aire de source : f = L × min_j(appartenance) × v, v = 1 / B_d² loin du foyer ; près du
  //    foyer (B_d² < 1e4 ε², ε² = (13/12) w² / Rθ²), v = aire du cône admis (intersection des disques de direction,
  //    `vignettage`) / aire de la tache (intersection des disques flous du détecteur), au centre du disque de tirage du
  //    pixel : le flux d'un point source est conservé et vignetté au foyer (deux taches, source vue nette), sans pupille
  //    « limitante » qui bascule ; loin du foyer les deux aires se rapportent comme B_d² et v → 1/B_d².
  //  - δ(ρs, X) : polynôme du second degré en (xs, ys, X, Y) (`polyDelta`, coefficients en double), deux jeux s'il y a
  //    une lamelle (sans et avec), choisis par le signe d'une forme affine de (ρs, X) : le rayon du bras de la lamelle
  //    passe-t-il son demi-plan au plan du miroir.
  //  - Spectre : les mêmes éléments (`tirage` : raies, ou bandes du continu) pour tous les échantillons et toutes les
  //    passes ; seul le hasard de la source change d'une passe à l'autre.
  //  - Forme de la source (lampe nue) : masque (`masqueForme`), une lecture par échantillon.
  // Données : une texture RGBA32F de LARG texels de large ; ligne 0 = en-tête (H), ligne 1 = éléments spectraux, 4 texels
  // chacun : (σ = 1/λ, φ0 sans lamelle, φ0 avec, ρ), (WX, WY, WZ, κ), (VX, VY, VZ, g0), (g1, 0, 0, 0) (g : retard de
  // groupe des lames moins le retard de phase, `dispersionGroupe`), et au texel LARG − 1 (ΣX, ΣY, ΣZ) (éclairement sans
  // interférence) ; lignes 2… = les échantillons, un texel chacun (ux, uy, composante, 0). Le masque est une seconde
  // texture (R8). Le shader lit ces nombres ; `contributions` et `evaluer` lisent les mêmes, l'en-tête dans `donnees`,
  // le spectre dans `prep.lam` et `prep.somme`, le masque dans `prep.masque`.
  var NDMAX = 8, NCMAX = 4, MMAX = 24, LARG = 128, BLK = 2 + 3 * NDMAX + NCMAX, NMASQ = 1024;
  var H = { GEN: 0, SRC: 1, K: 2, TIR: 3, POLY: 6, POLYL: 10, SEL: 14, SEL2: 15, BRAS: 16, MASQ: 16 + 3 * BLK };
  function rayonSource(cfg) { return cfg.source.rayon > 0 ? cfg.source.rayon : 0; }
  // Forme lumineuse de la source (lampe sans dépoli : tube d'une lampe spectrale, filament) : union de rectangles
  // {t: "rect", x0, y0, x1, y1}, d'ellipses {t: "ell", cx, cy, a, b} et de secteurs d'anneau {t: "anneau", cx, cy, r0,
  // r1, a0, a1} (r0 ≤ r ≤ r1, angle atan2 dans [a0, a1], rad : coude d'un tube en U) (m), dans le disque de rayon `rayon` (iris,
  // fenêtre). Un point tiré hors de la forme ne compte pas (l'intégrale reste juste). Le rendu ne l'évalue pas point par
  // point (filament : 28 rectangles par échantillon, l'aperçu en lumière blanche passait de 8 à 18 ms) : `masqueForme`.
  function dansForme(forme, x, y) {
    if (!forme || !forme.length) return true;
    for (var i = 0; i < forme.length; i++) {
      var f = forme[i];
      if (f.t === "rect" && x >= f.x0 && x <= f.x1 && y >= f.y0 && y <= f.y1) return true;
      if (f.t === "ell") { var u = (x - f.cx) / f.a, v = (y - f.cy) / f.b; if (u * u + v * v <= 1) return true; }
      if (f.t === "anneau") {
        var dx = x - f.cx, dy = y - f.cy, r2 = dx * dx + dy * dy, an = Math.atan2(dy, dx);
        if (r2 >= f.r0 * f.r0 && r2 <= f.r1 * f.r1 && an >= f.a0 && an <= f.a1) return true;
      }
    }
    return false;
  }
  // Masque de la forme : grille de cellules carrées (au plus NMASQ sur le grand côté de la boîte englobante, bord d'une
  // cellule), cellule allumée si son CENTRE est dans la forme (`dansForme`) ; lu par `dansMasque` (cœur) et par le shader
  // (texture R8), une lecture par échantillon. Cellule : 4 µm pour le filament, 28 µm pour le tube en U, plus fine que
  // ce qu'un pixel du détecteur voit de la source. Mis en cache par forme.
  var MASQUES = {};
  function masqueForme(forme) {
    var cle = JSON.stringify(forme);
    if (MASQUES[cle]) return MASQUES[cle];
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, i, j;
    for (i = 0; i < forme.length; i++) {
      var f = forme[i], b = f.t === "rect" ? [f.x0, f.x1, f.y0, f.y1] : f.t === "ell" ? [f.cx - f.a, f.cx + f.a, f.cy - f.b, f.cy + f.b]
        : [f.cx - f.r1, f.cx + f.r1, f.cy - f.r1, f.cy + f.r1];
      x0 = Math.min(x0, b[0]); x1 = Math.max(x1, b[1]); y0 = Math.min(y0, b[2]); y1 = Math.max(y1, b[3]);
    }
    var h = Math.max(x1 - x0, y1 - y0) / (NMASQ - 2), X0 = x0 - h, Y0 = y0 - h;
    var nx = Math.min(NMASQ, Math.ceil((x1 - x0) / h) + 2), ny = Math.min(NMASQ, Math.ceil((y1 - y0) / h) + 2), d = new Uint8Array(nx * ny);
    for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) d[j * nx + i] = dansForme(forme, X0 + (i + 0.5) * h, Y0 + (j + 0.5) * h) ? 255 : 0;
    var m = { x0: X0, y0: Y0, inv: 1 / h, nx: nx, ny: ny, d: d };
    MASQUES[cle] = m;
    return m;
  }
  function dansMasque(m, x, y) {
    var i = Math.floor((x - m.x0) * m.inv), j = Math.floor((y - m.y0) * m.inv);
    return i >= 0 && j >= 0 && i < m.nx && j < m.ny && m.d[j * m.nx + i] > 0;
  }
  // Aire de l'intersection de deux disques (rayons r1, r2, centres à d).
  function lentille(r1, r2, d) {
    if (d >= r1 + r2) return 0;
    if (d <= Math.abs(r1 - r2)) { var r = Math.min(r1, r2); return Math.PI * r * r; }
    var a = Math.acos(Math.max(-1, Math.min(1, (d * d + r1 * r1 - r2 * r2) / (2 * d * r1))));
    var b = Math.acos(Math.max(-1, Math.min(1, (d * d + r2 * r2 - r1 * r1) / (2 * d * r2))));
    return r1 * r1 * a + r2 * r2 * b - 0.5 * Math.sqrt(Math.max(0, (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2)));
  }
  // Un bras vu du détecteur, pour tout point source : disques des pupilles (affines en ρs), pupilles traitées sur ρs
  // seul, pupille limitante (plus petit cône), plus petite tache, disque de tirage (centre affine en X : A X + b, rayon).
  // ro = { pixel (m), lmoy (nm), diffraction (bool) }.
  function analyseBras(el, ro, Rs) {
    var t = trace(el, 0, 0), Ad = t.A, Bd = t.B, wpix = ro.pixel || 0, lm = (ro.lmoy || 550) * 1e-9, D = [], C = [], i, p;
    var Rb = Infinity;
    for (i = 0; i < t.pup.length; i++) if (Math.abs(t.pup[i].B) > 1e-12) Rb = Math.min(Rb, t.pup[i].R / Math.abs(t.pup[i].B));
    for (i = 0; i < t.pup.length; i++) {
      p = t.pup[i];
      if (!(Math.abs(p.B) * 100 * Rb > p.R)) {     // cône > 100 Rθ limitant (ou B = 0) : test sur ρs seul
        if (Math.abs(p.A) > 1e-12 && C.length < NCMAX) C.push({ cx: -p.qx / p.A, cy: -p.qy / p.A, r: p.R / Math.abs(p.A) });
        continue;
      }
      var Bp = Bd * p.A - Ad * p.B, r = Math.abs(Bd) * p.R / Math.abs(p.B);
      var wd = ro.diffraction ? 0.61 * lm * Math.abs(Bp) / p.R : 0, w = Math.sqrt(wpix * wpix + wd * wd);
      if (!(w > 0)) w = 1e-9;
      D.push({ k: Ad - Bd * p.A / p.B, c0x: t.qx - Bd * p.qx / p.B, c0y: t.qy - Bd * p.qy / p.B, rp: Math.sqrt(r * r + w * w), w: w,
        Rt: p.R / Math.abs(p.B), ta: -p.A / p.B, tbx: -p.qx / p.B, tby: -p.qy / p.B, nom: p.nom });
    }
    D.sort(function (a, b) { return a.rp - b.rp; });
    if (D.length > NDMAX) D = D.slice(0, NDMAX);
    var bind = -1, blob = -1;
    for (i = 0; i < D.length; i++) {
      if (bind < 0 || D[i].Rt < D[bind].Rt) bind = i;
      if (blob < 0 || D[i].rp * D[i].rp + D[i].w * D[i].w / 12 < D[blob].rp * D[blob].rp + D[blob].w * D[blob].w / 12) blob = i;
    }
    var wmin = Infinity;
    for (i = 0; i < D.length; i++) wmin = Math.min(wmin, D[i].w);
    var eps2 = bind >= 0 ? 13 / 12 * wmin * wmin / (D[bind].Rt * D[bind].Rt) : 0;
    // disque de tirage : le plus petit support (dans le plan de la source) d'une appartenance non nulle
    var tir = { A: 0, bx: 0, by: 0, r: Rs > 0 ? Rs : Infinity };
    for (i = 0; i < D.length; i++) {
      var d = D[i];
      if (!(Math.abs(d.k) > 1e-12)) continue;      // pupille conjuguée du détecteur : diaphragme de champ
      var rr = (d.rp + d.w / 2) / Math.abs(d.k);
      if (rr < tir.r) tir = { A: 1 / d.k, bx: -d.c0x / d.k, by: -d.c0y / d.k, r: rr, j: i };
    }
    for (i = 0; i < C.length; i++) if (C[i].r < tir.r) tir = { A: 0, bx: C[i].cx, by: C[i].cy, r: C[i].r };
    if (tir.j == null) tir.j = -1;
    return { t: t, Ad: Ad, Bd: Bd, D: D, C: C, bind: bind, blob: blob, eps2: eps2, conj: Bd * Bd < 1e4 * eps2, tir: tir };
  }
  // Coefficients de δ(ρs, X) = c00 + sx xs + sy ys + sxx xs² + syy ys² + sxy xs ys + Cx X + Cy Y + cxx X² + cyy Y²
  // + cxy X Y, Cx = cx + cxsx xs + cxsy ys, Cy = cy + cysx xs + cysy ys : polynôme exact du second degré (c0 de
  // `pointSource` est quadratique en ρs, cx et cy affines, cxx, cyy, cxy constants), relevé en six points sources.
  function polyDelta(cfg, ro, el1, el2) {
    var h = 0.01, P = function (x, y) { return pointSource(cfg, ro, x, y, el1, el2); };
    var p00 = P(0, 0), pp0 = P(h, 0), pm0 = P(-h, 0), p0p = P(0, h), p0m = P(0, -h), ppp = P(h, h), c = p00.c0;
    return { c00: c, sx: (pp0.c0 - pm0.c0) / (2 * h), sy: (p0p.c0 - p0m.c0) / (2 * h),
      sxx: (pp0.c0 + pm0.c0 - 2 * c) / (2 * h * h), syy: (p0p.c0 + p0m.c0 - 2 * c) / (2 * h * h), sxy: (ppp.c0 - pp0.c0 - p0p.c0 + c) / (h * h),
      cx: p00.cx, cxsx: (pp0.cx - pm0.cx) / (2 * h), cxsy: (p0p.cx - p0m.cx) / (2 * h),
      cy: p00.cy, cysx: (pp0.cy - pm0.cy) / (2 * h), cysy: (p0p.cy - p0m.cy) / (2 * h), cxx: p00.cxx, cyy: p00.cyy, cxy: p00.cxy };
  }
  // rendu : { res, W, cx0?, cy0?, K (points par bras et par passe, 16 par défaut), M (bandes du continu), graine,
  // diffraction?, pose? }. Renvoie { n (échantillons), M (éléments spectraux), larg, lignes, donnees: Float64Array
  // (lignes × larg × 4), sigma, bras: [analyseBras…], Rs, lam: [{l, inv, ph: [φ0, φ0L], W, V, kappa, rho, g: [g0, g1]}],
  // somme: [ΣX, ΣY, ΣZ], masque }.
  function preparer(cfg, rendu, passe) {
    var sp = spectreDe(cfg.spectre), Rs = rayonSource(cfg), g = rendu.graine >>> 0, p = passe >>> 0, j, k, c;
    var spec = tirage(sp, Math.min(MMAX, sp.continu ? rendu.M : sp.raies.length)), M = spec.length, lum = (cfg.luminance || 1) / xyzSpectre(sp)[1];
    var pose = rendu.pose || 0, ponct = !(Rs > 0);
    var ro = { pixel: 2 * rendu.W / rendu.res, patch: 0, lmoy: sp.lmoy, diffraction: rendu.diffraction !== false };
    var el1 = trajet(cfg, 1), el2 = trajet(cfg, 2);
    var elG = cfg.lames && cfg.lames.fantome > 0 ? trajet(cfg, 1, { fantome: true }) : null;
    var B = [analyseBras(el1, ro, Rs), analyseBras(el2, ro, Rs)];
    if (elG) B.push(analyseBras(elG, ro, Rs));
    var LL = cfg.lamelle && (cfg.lamelle.bras === 1 || cfg.lamelle.bras === 2) ? cfg.lamelle : null;
    var e1L = LL && LL.bras === 1 ? trajet(cfg, 1, { lamelle: true }) : el1, e2L = LL && LL.bras === 2 ? trajet(cfg, 2, { lamelle: true }) : el2;
    var q0 = polyDelta(cfg, ro, el1, el2), qL = LL ? polyDelta(cfg, ro, e1L, e2L) : q0;
    var K = Math.max(1, Math.min(64, rendu.K || (rendu.N ? Math.round(rendu.N / 6) : 16))), Kc = ponct ? [1, 0, 0] : [K, K, elG ? Math.max(4, K >> 2) : 0], n = Kc[0] + Kc[1] + Kc[2];
    var nl = 2 + Math.ceil(n / LARG), Dd = new Float64Array(nl * LARG * 4);
    function tx(r, t) { return (r * LARG + t) * 4; }
    function ecr(o, a, b, cc, d) { Dd[o] = a; Dd[o + 1] = b; Dd[o + 2] = cc; Dd[o + 3] = d; }
    var masque = !ponct && cfg.source.forme && cfg.source.forme.length ? masqueForme(cfg.source.forme) : null;
    ecr(tx(0, H.GEN), B.length, ponct ? 1 : 0, LL ? 1 : 0, Rs);
    ecr(tx(0, H.SRC), masque ? 1 : 0, lum, (cfg.source.intensite || 1e-6) * lum, elG ? cfg.lames.fantome : 0);
    ecr(tx(0, H.K), Kc[0], Kc[1], Kc[2], M);
    for (c = 0; c < 3; c++) if (B[c]) ecr(tx(0, H.TIR + c), B[c].tir.A, B[c].tir.bx, B[c].tir.by, B[c].tir.r);
    function poly(o, q) {
      ecr(tx(0, o), q.sx, q.sy, q.sxx, q.syy); ecr(tx(0, o + 1), q.sxy, q.cx, q.cxsx, q.cxsy);
      ecr(tx(0, o + 2), q.cy, q.cysx, q.cysy, q.cxx); ecr(tx(0, o + 3), q.cyy, q.cxy, 0, 0);
    }
    poly(H.POLY, q0); poly(H.POLYL, qL);
    // lamelle : n·ρ_miroir − c > 0, ρ_miroir = q_M(ρs) + B_M s (X − Q_d(ρs)) (rayon du bras de la lamelle)
    var sel = [0, 0, 0, 0, -1];
    if (LL) {
      var Tb = B[LL.bras - 1].t, rm = Tb.rep.miroir, s = bras(Tb, ro).s, Bs = rm.B * s, nx = LL.nx, ny = LL.ny;
      sel = [(rm.A - Bs * Tb.A) * nx, (rm.A - Bs * Tb.A) * ny, Bs * nx, Bs * ny, nx * rm.qx + ny * rm.qy - LL.c - Bs * (nx * Tb.qx + ny * Tb.qy)];
    }
    ecr(tx(0, H.SEL), sel[0], sel[1], sel[2], sel[3]); ecr(tx(0, H.SEL2), sel[4], q0.c00, qL.c00, 0);
    for (c = 0; c < B.length; c++) {
      var b = B[c], o = H.BRAS + c * BLK;
      ecr(tx(0, o), b.D.length, b.C.length, b.conj ? 1 : 0, b.Bd !== 0 ? 1 / (b.Bd * b.Bd) : 0);
      ecr(tx(0, o + 1), b.bind, b.blob, b.tir.j, 0);
      for (j = 0; j < b.D.length; j++) {
        var d = b.D[j];
        ecr(tx(0, o + 2 + 3 * j), d.k, d.c0x, d.c0y, d.rp); ecr(tx(0, o + 3 + 3 * j), d.w, d.ta, d.tbx, d.tby); ecr(tx(0, o + 4 + 3 * j), d.Rt, 0, 0, 0);
      }
      for (j = 0; j < b.C.length; j++) ecr(tx(0, o + 2 + 3 * NDMAX + j), b.C[j].cx, b.C[j].cy, b.C[j].r, 0);
    }
    if (masque) { ecr(tx(0, H.MASQ), masque.x0, masque.y0, masque.inv, masque.nx); ecr(tx(0, H.MASQ + 1), masque.ny, 0, 0, 0); }
    // éléments spectraux : ordre φ0 = frac((c00 + dispersion) σ) en double ; flou de pose sinc(π pose σ) sur W et V
    var lam = [], som = [0, 0, 0];
    for (j = 0; j < spec.length; j++) {
      var e = spec[j], inv = 1e9 / e.l, x = Math.PI * pose * inv, fl = x > 1e-8 ? Math.sin(x) / x : 1;
      var ph0 = (q0.c00 + dispersion(el2, e.l) - dispersion(el1, e.l)) * inv, ph1 = (qL.c00 + dispersion(e2L, e.l) - dispersion(e1L, e.l)) * inv;
      var L = { l: e.l, inv: inv, ph: [ph0 - Math.floor(ph0), ph1 - Math.floor(ph1)], W: [e.W[0] * fl, e.W[1] * fl, e.W[2] * fl],
        V: [e.V[0] * fl, e.V[1] * fl, e.V[2] * fl], kappa: e.kappa, rho: e.rho,
        g: [dispersionGroupe(el2, e.l) - dispersionGroupe(el1, e.l), dispersionGroupe(e2L, e.l) - dispersionGroupe(e1L, e.l)] };
      lam.push(L);
      var q = tx(1, 4 * j);
      ecr(q, inv, L.ph[0], L.ph[1], L.rho); ecr(q + 4, L.W[0], L.W[1], L.W[2], L.kappa);
      ecr(q + 8, L.V[0], L.V[1], L.V[2], L.g[0]); ecr(q + 12, L.g[1], 0, 0, 0);
      for (k = 0; k < 3; k++) som[k] += e.W[k];
    }
    ecr(tx(1, LARG - 1), som[0], som[1], som[2], 0);
    // échantillons : spirale de Vogel dans le disque unité, tournée par composante et par passe, rayon stratifié tiré
    var ns = 0;
    for (c = 0; c < 3; c++) {
      var rot = 2 * Math.PI * u4(g, p, 0x7fffffff, 1 + c);
      for (k = 0; k < Kc[c]; k++) {
        var rr = ponct ? 0 : Math.sqrt((k + u4(g, p, k + 977 * c, 2)) / Kc[c]), th = k * OR + rot;
        ecr(tx(2, ns), rr * Math.cos(th), rr * Math.sin(th), c, 0);
        ns++;
      }
    }
    return { n: n, M: M, larg: LARG, lignes: nl, donnees: Dd, sigma: 0.45 * ro.pixel, bras: B, Rs: Rs, lam: lam, somme: som, masque: masque };
  }
  // Facteur v d'un bras près du foyer, au point source (x, y) (cf. en tête de section) ; o = début du bloc du bras.
  function vignettage(D, o, x, y) {
    var ib = D[o + 4], ia = D[o + 5], nD = D[o], j, q, cx, cy;
    var qb = o + 8 + 12 * ib, Rb = D[qb + 8], bx = D[qb + 5] * x + D[qb + 6], by = D[qb + 5] * y + D[qb + 7], om = Math.PI * Rb * Rb;
    for (j = 0; j < nD; j++) {
      if (j === ib) continue;
      q = o + 8 + 12 * j; cx = D[q + 5] * x + D[q + 6]; cy = D[q + 5] * y + D[q + 7];
      om = Math.min(om, lentille(Rb, D[q + 8], Math.sqrt((cx - bx) * (cx - bx) + (cy - by) * (cy - by))));
    }
    var qa = o + 8 + 12 * ia, ra = D[qa + 3], wa = D[qa + 4], ax = D[qa] * x + D[qa + 1], ay = D[qa] * y + D[qa + 2], ai = Math.PI * ra * ra;
    for (j = 0; j < nD; j++) {
      if (j === ia) continue;
      q = o + 8 + 12 * j; cx = D[q] * x + D[q + 1]; cy = D[q] * y + D[q + 2];
      ai = Math.min(ai, lentille(ra, D[q + 3], Math.sqrt((cx - ax) * (cx - ax) + (cy - ay) * (cy - ay))));
    }
    return ai > 0 ? om / (ai * (1 + wa * wa / (12 * ra * ra))) : 0;
  }
  // Appartenance (floue) du rayon (point source (x, y) → pixel (X, Y)) à toutes les pupilles d'un bras.
  // s2 = carré de l'écart entre points tirés autour de (x, y) (1 / densité) : le bord du disque de chaque pupille, sauf
  // celle dont le bras tire ses points (`tir.j`), est adouci de |k| √s2 en plus de w (w² += k² s2, rp² −= k² s2 / 12 :
  // l'aire π(rp² + w²/12) de la rampe, donc le flux, est conservée) :
  // anti-repliement de l'échantillonnage de la source. Sans lui, quand peu de points éclairent (lampe nue au
  // condenseur : le miroir ne voit que l'espace entre les branches du tube), le bord du champ était la réunion de
  // quelques disques nets (pétales). Les phases ne sont pas touchées : le contraste reste celui du vrai cône.
  function appartenance(D, o, x, y, X, Y, s2) {
    var nD = D[o], nC = D[o + 1], jt = D[o + 6], m = 1, j, q, ex, ey, a, b2;
    for (j = 0; j < nC; j++) {
      q = o + 8 + 12 * NDMAX + 4 * j; ex = x - D[q]; ey = y - D[q + 1];
      if (ex * ex + ey * ey > D[q + 2] * D[q + 2]) return 0;
    }
    for (j = 0; j < nD; j++) {
      q = o + 8 + 12 * j; ex = X - (D[q] * x + D[q + 1]); ey = Y - (D[q] * y + D[q + 2]);
      b2 = j === jt ? 0 : D[q] * D[q] * s2;
      a = (Math.sqrt(Math.max(0, D[q + 3] * D[q + 3] - b2 / 12)) - Math.sqrt(ex * ex + ey * ey)) / Math.sqrt(D[q + 4] * D[q + 4] + b2) + 0.5;
      if (a < m) { m = a; if (!(m > 0)) return 0; }
    }
    return m;
  }
  // Tous les échantillons utiles au point (X, Y) du détecteur : fn(s, amp, dd, dt, gx, gy, t) avec s = éclairement
  // sans interférence (lux, à multiplier par prep.somme pour l'XYZ), amp = 2 √(I₁ I₂), dd = partie variable de δ,
  // dt = δ entier, (gx, gy) = ∇_X δ, t = 0 (sans lamelle) ou 1 (avec) ; le terme d'interférence de chaque élément
  // spectral de prep.lam s'obtient par `terme`.
  function contributions(prep, X, Y, fn) {
    var D = prep.donnees, nb = D[0], ponct = D[1] > 0, lam = D[2] > 0, Rs = D[3], lum = D[5], I0 = D[6], fan = D[7], ms = prep.masque;
    var K = prep._K || (prep._K = [D[8], D[9], D[10]]), v = prep._v || (prep._v = [0, 0, 0]), c, j, o;
    var tc = prep._tc || (prep._tc = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
    for (c = 0; c < nb; c++) {
      o = (H.TIR + c) * 4; tc[c][0] = D[o] * X + D[o + 1]; tc[c][1] = D[o] * Y + D[o + 2]; tc[c][2] = D[o + 3];
      o = (H.BRAS + c * BLK) * 4;
      v[c] = D[o + 2] > 0 ? vignettage(D, o, tc[c][0], tc[c][1]) : D[o + 3];
    }
    var P = H.POLY * 4;
    for (var s = 0; s < prep.n; s++) {
      var q = (2 * LARG + s) * 4, x, y, W, s2 = 0;
      if (ponct) { x = 0; y = 0; W = I0; }
      else {
        c = D[q + 2]; x = tc[c][0] + tc[c][2] * D[q]; y = tc[c][1] + tc[c][2] * D[q + 1];
        if (x * x + y * y > Rs * Rs) continue;
        if (ms && !dansMasque(ms, x, y)) continue;
        var den = 0;
        for (j = 0; j < nb; j++) {
          var ddx = x - tc[j][0], ddy = y - tc[j][1];
          if (ddx * ddx + ddy * ddy <= tc[j][2] * tc[j][2]) den += K[j] / (Math.PI * tc[j][2] * tc[j][2]);
        }
        if (!(den > 0)) continue;
        W = lum / den; s2 = 1 / den;
      }
      var f1 = appartenance(D, H.BRAS * 4, x, y, X, Y, s2) * v[0] * W, f2 = appartenance(D, (H.BRAS + BLK) * 4, x, y, X, Y, s2) * v[1] * W;
      var fG = nb > 2 ? appartenance(D, (H.BRAS + 2 * BLK) * 4, x, y, X, Y, s2) * v[2] * W * fan : 0;
      if (!(f1 + f2 + fG > 0)) continue;
      var t = lam && D[56] * x + D[57] * y + D[58] * X + D[59] * Y + D[60] > 0 ? 1 : 0, b = P + 16 * t;
      var Cx = D[b + 5] + D[b + 6] * x + D[b + 7] * y, Cy = D[b + 8] + D[b + 9] * x + D[b + 10] * y;
      var dd = D[b] * x + D[b + 1] * y + D[b + 2] * x * x + D[b + 3] * y * y + D[b + 4] * x * y + Cx * X + Cy * Y + D[b + 11] * X * X + D[b + 12] * Y * Y + D[b + 13] * X * Y;
      fn(f1 + f2 + fG, 2 * Math.sqrt(f1 * f2), dd, D[61 + t] + dd, Cx + 2 * D[b + 11] * X + D[b + 13] * Y, Cy + D[b + 13] * X + 2 * D[b + 12] * Y, t);
    }
  }
  // Éclairement (X, Y, Z) au point (X, Y) du détecteur pour une passe : ce que calcule le shader, en double.
  function evaluer(prep, X, Y) {
    var E = prep._ev;
    if (!E) {
      var lam = prep.lam, M = lam.length, S = prep.somme, sig2 = 2 * Math.PI * Math.PI * prep.sigma * prep.sigma, f = [0, 0, 0, 0];
      E = prep._ev = { a: [0, 0, 0], fn: null };
      E.fn = function (s, amp, dd, dt, gx, gy, t) {
        var a = E.a;
        a[0] += S[0] * s; a[1] += S[1] * s; a[2] += S[2] * s;
        if (!(amp > 0)) return;
        var g2 = (gx * gx + gy * gy) * sig2;
        for (var j = 0; j < M; j++) {
          var L = lam[j];
          terme(L, dd, dt, t, g2, f);
          a[0] += amp * (L.W[0] * f[0] - L.V[0] * f[1]); a[1] += amp * (L.W[1] * f[0] - L.V[1] * f[1]); a[2] += amp * (L.W[2] * f[0] - L.V[2] * f[1]);
        }
      };
    }
    E.a = [0, 0, 0];
    contributions(prep, X, Y, E.fn);
    return E.a;
  }
  // Partie éclairée du détecteur (boîte englobante, [x0, x1, y0, y1]) : pour chaque bras, la plus petite des
  // enveloppes des disques de ses pupilles quand le point source parcourt la source ; réunion des bras.
  function boiteEclairee(prep) {
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    prep.bras.forEach(function (b) {
      var best = null, Rs = prep.Rs, cx = 0, cy = 0, rs = Rs;
      if (b.C.length) { cx = b.C[0].cx; cy = b.C[0].cy; rs = Math.min(Rs > 0 ? Rs + Math.hypot(cx, cy) : Infinity, b.C[0].r); }
      b.D.forEach(function (d) {
        var r = Math.abs(d.k) * (rs || 0) + d.rp + d.w / 2, ccx = d.k * cx + d.c0x, ccy = d.k * cy + d.c0y;
        if (!best || r < best[2]) best = [ccx, ccy, r];
      });
      if (!best) { x0 = y0 = -Infinity; x1 = y1 = Infinity; return; }
      x0 = Math.min(x0, best[0] - best[2]); x1 = Math.max(x1, best[0] + best[2]); y0 = Math.min(y0, best[1] - best[2]); y1 = Math.max(y1, best[1] + best[2]);
    });
    return [x0, x1, y0, y1];
  }
  // Image (res × res, ligne 0 en HAUT, Y décroissant) moyennée sur `passes` passes : Float64Array XYZ.
  function rendreCPU(cfg, rendu, passes, p0) {
    var res = rendu.res, W = rendu.W, h = 2 * W / res, cx0 = rendu.cx0 || 0, cy0 = rendu.cy0 || 0;
    var img = new Float64Array(res * res * 3), np = passes || 1;
    for (var p = 0; p < np; p++) {
      var prep = preparer(cfg, rendu, (p0 || 0) + p);
      for (var iy = 0; iy < res; iy++) for (var ix = 0; ix < res; ix++) {
        var v = evaluer(prep, cx0 - W + (ix + 0.5) * h, cy0 + W - (iy + 0.5) * h), q = 3 * (iy * res + ix);
        img[q] += v[0] / np; img[q + 1] += v[1] / np; img[q + 2] += v[2] / np;
      }
    }
    return img;
  }
  // XYZ → sRGB 8 bits (balance des blancs, exposition, blanc hors gamut, compression douce, gamma) : même calcul que
  // le shader. Hors gamut : une lumière spectrale bleu-vert a R < 0 ; l'écraser à 0 laisse (0, G, B) sur toute la bande
  // 470-550 nm, un aplat sans dégradé ; on ajoute aux trois canaux (espace équilibré, donc du blanc de la source)
  // BLANC_HG fois ce qui manque au rouge (1 ferait de 465-550 nm un cyan uniforme). Côté rouge (G < 0) rien : le rouge
  // spectral est presque le primaire sRGB, y ajouter du blanc le rend rose. Repris par le goniomètre et le banc.
  var BLANC_HG = 0.4;
  function versRGB(xyz, expo, bal, comp) {
    var c = rgbLin(xyz), k = comp > 0 && comp < 1 ? Math.pow(Math.max(xyz[1] * expo, 1e-9), comp - 1) : 1;
    var r0 = c[0] / bal[0] * expo * k, r1 = c[1] / bal[1] * expo * k, r2 = c[2] / bal[2] * expo * k, bw = r0 < 0 ? -BLANC_HG * r0 : 0;
    return [255 * gammaS(tons(r0 + bw)), 255 * gammaS(tons(r1 + bw)), 255 * gammaS(tons(r2 + bw))];
  }

  // ================= vision : ce qu'un œil perçoit de la luminance qu'il reçoit
  // Écrit UNE fois pour toutes les vues « œil » : écran regardé (L = ρE/π), œil posé ou derrière un instrument
  // (luminance équivalente de l'image rétinienne). État stationnaire. Valeurs typiques :
  // observateur de 18 ans, belle salle d'optique très sombre (0,02 lx), moniteur de 150 cd/m², écran ρ = 0,8.
  // La salle n'entre que dans les calculs (adaptation, pupille) : rien n'est ajouté à l'image.
  var VISION = { rho: 0.8, Esalle: 0.02, age: 18, Ldmax: 150, dObs: 400, retine: 17, plancher: 0.015, laMon: 0.2 };
  // Luminance de l'écran blanc (ou des murs) éclairé par la salle seule (cd/m²).
  VISION.Lsalle = VISION.rho * VISION.Esalle / Math.PI;
  // V'(λ) scotopique CIE 1951, 380-780 nm par pas de 10 (interpolation logarithmique), K'm = 1700 lm/W.
  var V_SCOT = [5.89e-4, 2.209e-3, 9.29e-3, 3.484e-2, 9.66e-2, 0.1998, 0.3281, 0.455, 0.567, 0.676, 0.793, 0.904, 0.982,
    0.997, 0.935, 0.811, 0.65, 0.481, 0.3288, 0.2076, 0.1212, 6.55e-2, 3.315e-2, 1.593e-2, 7.37e-3, 3.335e-3, 1.497e-3,
    6.77e-4, 3.129e-4, 1.48e-4, 7.15e-5, 3.533e-5, 1.78e-5, 9.14e-6, 4.78e-6, 2.546e-6, 1.379e-6, 7.6e-7, 4.25e-7,
    2.41e-7, 1.39e-7];
  function vScot(l) {
    if (!(l >= 380 && l <= 780)) return 0;
    var t = (l - 380) / 10, i = Math.min(39, Math.floor(t)), f = t - i;
    return Math.exp(Math.log(V_SCOT[i]) * (1 - f) + Math.log(V_SCOT[i + 1]) * f);
  }
  // Luminance scotopique / photopique d'un spectre de RAIES (exacte : V' de la CIE, ȳ de ce module) ; null pour un
  // continu (le pixel n'en garde que XYZ : approximation de Larson-Ward, `scotXYZ`). L'approximation XYZ est fausse
  // pour les raies (sodium : 0,66 au lieu de 0,22) ; une combinaison linéaire de X, Y, Z ajustée sur V' ne fait pas
  // mieux (raies bleues ×2) : d'où le facteur par spectre. Un spectre de raies dispersé (mercure sans filtre derrière un
  // réseau) garde le rapport de l'ensemble.
  function rapportScotopique(sp) {
    sp = spectreDe(sp);
    if (!sp || !sp.raies) return null;
    var ptot = 0, Y = 0, S = 0, i;
    for (i = 0; i < sp.raies.length; i++) ptot += sp.raies[i].poids;
    for (i = 0; i < sp.raies.length; i++) { var w = sp.raies[i].poids / ptot; Y += w * cie(sp.raies[i].l)[1]; S += w * vScot(sp.raies[i].l); }
    return 1700 * S / (683 * Y);
  }
  function scotXYZ(c) { return c[0] > 0 ? Math.max(0, c[1] * (1.33 * (1 + (c[1] + c[2]) / c[0]) - 1.68)) : 0; }
  // Pupille stationnaire (Watson et Yellott 2012) : F = ∫L dΩ en cd/m² × deg² (3283 × éclairement cornéen en lx),
  // M = 1 pour deux yeux, 0,1 pour un seul ; diamètre en mm, borné à 2-8,5.
  function pupille(F, M, age) {
    var k = Math.pow(Math.max(F, 0) * (M == null ? 1 : M) / 846, 0.41), D = 7.75 - 5.75 * k / (k + 2);
    D += ((age == null ? VISION.age : age) - 28.58) * (0.02132 - 0.009562 * D);
    return Math.max(2, Math.min(8.5, D));
  }
  // Seuils de visibilité ΔL (cd/m²) au niveau d'adaptation La (Ferwerda et al. 1996) ; coefficients vérifiés par la
  // continuité aux quatre raccords (écart < 0,015 en log). Seuil retenu : le plus bas des deux.
  function seuilBatonnets(La) {
    var x = Math.log10(Math.max(La, 1e-12)), y = x <= -3.94 ? -2.86 : x < -1.44 ? Math.pow(0.405 * x + 1.6, 2.18) - 2.86 : x - 0.395;
    return Math.pow(10, y);
  }
  function seuilCones(La) {
    var x = Math.log10(Math.max(La, 1e-12)), y = x <= -2.6 ? -0.72 : x < 1.9 ? Math.pow(0.249 * x + 0.65, 2.7) - 0.72 : x - 1.255;
    return Math.pow(10, y);
  }
  function seuilVision(La) { return Math.min(seuilBatonnets(La), seuilCones(La)); }
  // Part des bâtonnets (Hunt, d'après Krawczyk) ; L en cd/m².
  function sigmaBatonnets(L) { return 0.04 / (0.04 + Math.max(L, 0)); }
  // Facteur de Ward 1994 : luminance réelle → luminance du moniteur (contraste au seuil conservé), L_da = L_dmax / 2.
  function facteurWard(La, Ldmax) {
    Ldmax = Ldmax || VISION.Ldmax;
    return Math.pow((1.219 + Math.pow(Ldmax / 2, 0.4)) / (1.219 + Math.pow(Math.max(La, 0), 0.4)), 2.5);
  }
  // Effet Hunt (CIECAM02) : la couleur pâlit quand le niveau baisse ; facteur de chroma, borné à 1. CIECAM02 est un
  // modèle de vision de jour : sous HUNT_MIN cd/m², la perte de couleur est l'affaire des bâtonnets (σ) ; sans cette
  // borne, les deux s'empilaient (franges du sodium : chroma × 0,31 × 0,47, presque grises).
  var HUNT_MIN = 0.1;
  function FL(La) { var k = 1 / (5 * La + 1), k4 = k * k * k * k; return 0.2 * k4 * 5 * La + 0.1 * (1 - k4) * (1 - k4) * Math.cbrt(5 * La); }
  function facteurHunt(La) { return Math.min(1, Math.pow(FL(Math.max(La, HUNT_MIN)) / FL(VISION.laMon * VISION.Ldmax), 0.25)); }
  // Paramètres d'affichage pour un niveau d'adaptation La : [m (luminance → fraction du blanc du moniteur), seuil (cd/m²),
  // facteur de chroma, rapport scotopique (−1 : XYZ)]. Mêmes quatre nombres que l'uniforme du GLSL. Plancher : haut =
  // luminance du plus clair du champ (99e centile des éléments éclairés) ; s'il tomberait sous `plancher` du blanc, m
  // est relevé pour l'y amener : UN gain pour toute l'image (le profil des franges est gardé ; appliqué pixel par
  // pixel, le plancher aplatissait le haut des franges du sodium en créneaux).
  function parametresVision(La, scot, haut) {
    var m = facteurWard(La) / VISION.Ldmax;
    if (haut > 0) m *= Math.max(1, VISION.plancher / (m * haut));
    return [m, seuilVision(La), facteurHunt(La), scot == null || !(scot >= 0) ? -1 : scot];
  }
  // Niveau d'adaptation et pupille d'un champ : L = luminances (cd/m²) des éléments du champ ENTIER, aire = angle solide
  // d'un élément en deg² ; o = {M, Fsalle (3283 × éclairement cornéen par la salle), salle (luminance de la salle)}.
  // La = moyenne logarithmique de l = L + salle PONDÉRÉE par l² (le regard va où est la lumière) : vaut L pour un
  // champ uniforme, la salle quand rien n'éclaire, la luminance de la zone éclairée dès qu'elle couvre plus que
  // (salle / L)² du champ ; ne suit pas le zoom. Non pondérée, sur un écran de 20 cm vu à 40 cm, elle restait celle de
  // la salle quel que soit le montage ; pondérée par l, les franges de Young en lumière blanche (0,1 % de l'écran)
  // la laissaient à 0,013 cd/m² : centre blanc saturé, sans couleur.
  // o.noir : nombre d'éléments NOIRS (luminance nulle, salle seule) à compter en plus de L, de même aire : le reste du
  // champ quand L ne couvre que sa partie éclairée (Michelson : grille de `mesure` recadrée sur la lumière).
  // o.poids : poids relatif de chaque élément dans la moyenne (défaut : 1 partout) — au goniomètre, le poids de regard
  // (on regarde le centre du champ : un bout de raie au bord du diaphragme de champ ne fixe plus le niveau).
  // o.LB : luminances d'une moitié indépendante B du même tirage (L = A + B, tracé de Monte-Carlo) : le poids l² devient
  // 4·A·B + 2·L·salle + salle², son estimation sans biais. Avec l², le bruit d'un champ peu peuplé de rayons
  // (microscope : un rayon isolé fait un texel très clair, et son carré domine) tirait La vers le haut, jusqu'à 40 fois
  // à 2^14 rayons : œil « ébloui », image sombre. Pondéré par A·B, un texel touché par une seule moitié ne compte plus.
  function adaptation(L, aire, o) {
    o = o || {};
    var n = L.length, s = 0, w = 0, F = 0, Ls = o.salle != null ? o.salle : VISION.Lsalle, nn = Math.max(0, o.noir || 0), LB = o.LB, po = o.poids;
    for (var i = 0; i < n; i++) {
      var Li = Math.max(L[i], 0), l = Li + Ls, wi = l * l;
      if (LB) { var b = Math.min(Math.max(LB[i], 0), Li); wi = 4 * (Li - b) * b + 2 * Li * Ls + Ls * Ls; }
      if (po) wi *= Math.max(po[i], 0);                // poids d'aire (goniomètre : poids de regard, cf. `adaptation`)
      s += wi * Math.log(l); w += wi; F += Li * aire;
    }
    s += nn * Ls * Ls * Math.log(Ls); w += nn * Ls * Ls;
    var Fs = o.Fsalle != null ? o.Fsalle : 3283 * VISION.Esalle;
    return { La: n + nn ? Math.exp(s / w) : Ls, F: F + Fs, D: pupille(F + Fs, o.M, o.age) };
  }
  // Adaptation d'un champ et réglages d'affichage, en une fois (Michelson, goniomètre ; le banc fait de même dans son
  // moteur) : L, aire, o comme `adaptation` (+ o.scot : rapport scotopique, −1 ou absent : approximation XYZ ;
  // o.haut : luminances où chercher le plus clair, défaut L). Renvoie {La, F, D (pupille, mm), haut (99e centile des
  // éléments éclairés), hautDrapeau (plus clair pour le drapeau de visibilité : `plusClairDrapeau`),
  // p (parametresVision), seuil, visible (le plus clair du drapeau dépasse la moitié du seuil : visibilité 0,2 dans
  // `vision`)}.
  // Centile q des éléments ÉCLAIRÉS de Y : au-dessus d'un milliardième du plus clair, pas seulement > 0. Une feuille
  // sur un miroir laisse à son bras une pupille de rayon presque nul (R_CACHE de l'instrument), dont la diffraction
  // pose une poussière (~1e-21 du flux) sur TOUT le champ : avec « > 0 », tous les pixels comptaient, le 99e centile
  // tombait sur cette poussière et le plancher de `parametresVision` relevait le gain d'autant (tache restante et
  // fantôme saturés en blanc, selon la position de l'œil, là où la poussière passait au-dessus de zéro).
  function centileEclaires(Y, q) {
    var mx = 0, ys = [], i;
    for (i = 0; i < Y.length; i++) if (Y[i] > mx) mx = Y[i];
    for (i = 0; i < Y.length; i++) if (Y[i] > 1e-9 * mx) ys.push(Y[i]);
    ys.sort(function (x, y) { return x - y; });
    return ys.length ? ys[Math.floor(q * (ys.length - 1))] : 0;
  }
  // Plus clair du champ pour le DRAPEAU « trop peu de lumière » (le plancher de `parametresVision` garde, lui, le 99e
  // centile de `centileEclaires`) : un cœur brillant qui ne fait qu'un pour cent du champ (laser focalisé par une
  // courte focale, tache douce) laisse ce centile des milliers de fois sous le maximum. L'image est pourtant juste
  // (cœur saturé, fond au plancher) et l'instrument annonçait « trop peu de lumière » : au banc, une lentille de 10 mm
  // sur un laser et une densité derrière l'écran, haut = 9e-4 cd/m² quand le maximum du champ en fait 1,6e3 et que
  // l'œil est adapté à 1,6e3 (seuil 87). On prend donc le MAXIMUM de blocs `cote` × `cote` (défaut 4 : un cœur plus
  // petit qu'un texel de la passe de mesure y garde sa luminance) avant le centile, qui écarte un bloc isolé. Mêmes
  // éléments « éclairés » que `centileEclaires` (au-dessus d'un milliardième du plus clair) : la poussière de
  // diffraction sur tout le champ ne compte pas. Y : luminances d'une grille carrée.
  function plusClairDrapeau(Y, cote) {
    var n = Y.length, mx = 0, r = Math.round(Math.sqrt(n)), c = cote || 4, i, x, y, x0, y0, m, v, bs = [];
    for (i = 0; i < n; i++) if (Y[i] > mx) mx = Y[i];
    if (!(mx > 0)) return 0;
    if (c <= 1 || r * r !== n) return centileEclaires(Y, 0.99);
    for (y0 = 0; y0 < r; y0 += c) for (x0 = 0; x0 < r; x0 += c) {
      for (m = 0, y = y0; y < Math.min(r, y0 + c); y++) for (x = x0; x < Math.min(r, x0 + c); x++) {
        v = Y[y * r + x]; if (v > m) m = v;
      }
      if (m > 1e-9 * mx) bs.push(m);
    }
    bs.sort(function (a, b) { return a - b; });
    return bs.length ? bs[Math.floor(0.99 * (bs.length - 1))] : 0;
  }
  function adapterVision(L, aire, o) {
    o = o || {};
    var a = adaptation(L, aire, o), H = o.haut || L;
    a.haut = centileEclaires(H, 0.99);
    a.p = parametresVision(a.La, o.scot, a.haut); a.seuil = a.p[1];
    // le drapeau ne se lit pas sur le 99e centile (un cœur brillant de 1 % du champ l'écrase) : `plusClairDrapeau`
    a.hautDrapeau = plusClairDrapeau(H); a.visible = a.hautDrapeau > 0.5 * a.seuil;
    if (o.pied > 0) a.p[4] = o.pied;     // pied de luminance (fraction du blanc) en luminosité réelle : sources ponctuelles (cf. `vision`)
    return a;
  }
  // --- Niveau d'adaptation AFFICHÉ : l'œil ne saute pas d'un niveau à l'autre --------------------------------
  // Le LOGARITHME de La rejoint sa cible en exponentielle, asymétrique : vers la lumière en TAU_ADAPT.lumiere, vers le
  // noir en TAU_ADAPT.obscur (Durand-Dorsey 2000). Les deux constantes sont ABRÉGÉES (le vrai retour du noir prend des
  // minutes) et surtout BORNÉES : le logarithme d'un écart de 5 décades met τ·ln(300) à se refermer (à 5 s, 25 s de
  // champ noir après un passage sur l'ordre 0, mesuré). Vers la lumière, 1 s est l'ordre du réflexe pupillaire
  // (fermeture : latence 0,2 à 0,3 s, constante ≈ 1 s) ; la rétine seule irait à 0,1-0,4 s.
  // Ce filtre ne touche QUE l'affichage : `adaptation`, `adapterVision`, `adaptationCroisee` et `parametresVision`
  // restent stationnaires et purs (les références les rejouent), et `stats.vision` de chaque moteur reste la CIBLE
  // mesurée (la boucle de pupille et les relevés la lisent). Aucune horloge ici : l'appelant donne dt.
  var TAU_ADAPT = { lumiere: 1.0, obscur: 2.0 };      // s, pour les trois instruments (un seul endroit à régler)
  var POSE_ADAPT = 0.01;                              // 1 % : au-delà, ça ne se voit plus
  function suiviAdaptation(tau) {
    var tl = (tau && tau.lumiere) || TAU_ADAPT.lumiere, to = (tau && tau.obscur) || TAU_ADAPT.obscur, niv = null, net = null;
    function cible(l) { return Math.log(Math.max(l, 1e-12)); }
    // La cible de la dernière pose, gardée TELLE QUELLE : exp(ln x) s'en écarte d'une unité flottante, et l'image au
    // repos doit être identique au bit près à la version stationnaire (mêmes paramètres d'affichage, mêmes pixels).
    function niveau() { return net != null ? net : Math.exp(niv); }
    return {
      // Un pas. `l` = cible mesurée (cd/m²), `dt` en secondes (borné à 0,1 s : une page laissée en arrière-plan ne
      // saute pas d'un coup), `ancre` = arrivée ou scène refaite, sans transitoire. Renvoie le niveau affiché (cd/m²).
      pas: function (l, dt, ancre) {
        var c = cible(l), d;
        if (ancre || niv == null) { niv = c; net = l; }
        else if (c !== niv) {
          d = Math.min(Math.max(dt || 0, 0), 0.1); niv += (c - niv) * (1 - Math.exp(-d / (c > niv ? tl : to))); net = null;
        }
        if (Math.abs(c - niv) < POSE_ADAPT) { niv = c; net = l; }   // le reste ne se voit pas : au repos, l'image est EXACTEMENT la stationnaire
        return niveau();
      },
      enRelax: function (l) { return niv != null && Math.abs(cible(l) - niv) >= POSE_ADAPT; },
      // Vrai tant qu'aucun pas n'a été fait : l'appelant ancre à l'arrivée sur la première mesure.
      get ancre() { return niv == null; },
      get La() { return niv == null ? null : niveau(); }
    };
  }
  // Paramètres d'affichage du niveau AFFICHÉ, à partir de la cible mesurée (`a` d'`adapterVision` ou de `adaptation`) :
  // mêmes seuil, chroma et rapport scotopique qu'elle, mais le gain de Ward suit le niveau affiché. `pied` (p[4]) est un
  // réglage d'affichage de source ponctuelle, indépendant du niveau : repris tel quel.
  function parametresLisses(La, scot, haut, pied) {
    var p = parametresVision(La, scot, haut);
    if (pied > 0) p[4] = pied;
    return p;
  }
  // Rapport scotopique / photopique d'un corps noir à T (K), sur 380-780 nm : lampe à filament (goniomètre : lampe du
  // réticule), là où le spectre est connu (l'approximation XYZ de `scotXYZ` vaut pour un continu quelconque).
  var cacheRP = {};
  function rapportPlanck(T) {
    if (cacheRP[T]) return cacheRP[T];
    var S = 0, Y = 0;
    for (var l = 380.5; l < 780; l += 1) { var w = planck(l, T); S += w * vScot(l); Y += w * cie(l)[1]; }
    return (cacheRP[T] = 1700 * S / (683 * Y));
  }
  // Teinte de la vision de nuit (Krawczyk) ; visibilité progressive v = d²/(1 + d²), d = L / seuil (0,5 au seuil,
  // 0,9 à trois fois, 0,1 au tiers : ni noir exact ni coupure, une frange garde son profil) ; genou de l'écrêtage doux
  // (fraction du blanc).
  var TEINTE_NUIT = [1.05, 0.97, 1.27], GENOU = 0.8, LUMA = [0.2126, 0.7152, 0.0722];
  // « Toujours visible » (interrupteur Luminosité) : même chaîne de couleur, sans ce qui dépend du niveau absolu (ni
  // seuil, ni bâtonnets, ni effet Hunt, ni halo) : p = parametresVisible(y99), y99 = luminance (unités de c) du 99e
  // centile du champ REGARDÉ, amené à VISIBLE du blanc ; linéaire, écrêtage doux au-dessus du genou comme en « réelle ».
  // Marqueur : seuil p[1] ≤ 0. Pied (p[1] = −x0 < 0, `pied` > 0) : les faibles lumières relevées, Y + x0 √(Y/x0) e^(−Y/x0)
  // (fraction du blanc ; croissante, sans effet au-dessus de 4 x0) : une image fantôme de 4 % d'une tache passe de 0,03
  // à 0,09 du blanc, des franges peu contrastées près du blanc gardent leur contraste (une réponse en L^0,5 l'aurait
  // divisé par deux). Sans pied (p[1] = 0), purement linéaire.
  var VISIBLE = 0.7;
  function parametresVisible(y99, pied) { return [y99 > 0 ? VISIBLE / y99 : 1, pied > 0 ? -pied : 0, 1, -1]; }
  // XYZ (Y = luminance en cd/m²) → sRGB linéaire du moniteur, 0-1 (avant gamma). p = parametresVision ; bal = balance.
  // Cônes : XYZ → sRGB, balance, blanc hors gamut (versRGB), chroma × Hunt ; bâtonnets : luminance scotopique × teinte,
  // mêlés par σ(L) ; Ward (plancher compris, `parametresVision`) × visibilité ; écrêtage doux de la luminance au-dessus
  // du genou, couleur qui blanchit à mesure qu'on dépasse le blanc (éblouissement). Hors gamut sans éblouissement (une
  // raie spectrale vive : le jaune pur ne dépasse pas 0,6 du blanc, le rouge 0,21), la COULEUR est gardée et la
  // luminance baisse (r / max) : garder la luminance la désaturait vers le blanc (raies du mercure au goniomètre,
  // sodium jaune pâle). Seul l'éblouissement (Yd > 1, ch) blanchit.
  function vision(c, p, bal) {
    var L = Math.max(c[1], 0), q = rgbLin(c), r = [q[0] / bal[0], q[1] / bal[1], q[2] / bal[2]], k;
    var bw = r[0] < 0 ? -BLANC_HG * r[0] : 0;
    for (k = 0; k < 3; k++) r[k] = Math.max(r[k] + bw, 0);
    var Yc = LUMA[0] * r[0] + LUMA[1] * r[1] + LUMA[2] * r[2];
    for (k = 0; k < 3; k++) r[k] = Yc + (r[k] - Yc) * p[2];
    var reel = p[1] > 0, sg = reel ? sigmaBatonnets(L) : 0, Ls = p[3] >= 0 ? p[3] * L : scotXYZ(c);
    for (k = 0; k < 3; k++) r[k] = r[k] * (1 - sg) + Ls * sg * TEINTE_NUIT[k];
    var Yp = LUMA[0] * r[0] + LUMA[1] * r[1] + LUMA[2] * r[2];
    if (!(Yp > 0)) return [0, 0, 0];
    var d = reel ? L / p[1] : 0, Yd = (reel ? d * d / (1 + d * d) : 1) * p[0] * Yp;
    if (p[1] < 0) { var u = -Yd / p[1]; Yd -= p[1] * Math.sqrt(u) * Math.exp(-u); }
    else if (p[4] > 0) { var u4 = Yd / p[4]; Yd += p[4] * Math.sqrt(u4) * Math.exp(-u4); }   // p[4] : pied en luminosité réelle (source ponctuelle : tache saturée, fantôme de 1 % perdu sans lui)
    var Ye = Yd < GENOU ? Yd : GENOU + (1 - GENOU) * (1 - Math.exp(-(Yd - GENOU) / (1 - GENOU)));
    var ch = 1 / (1 + Math.max(Yd - 1, 0)), mx = 0;
    for (k = 0; k < 3; k++) { r[k] = Ye + (r[k] * Ye / Yp - Ye) * ch; mx = Math.max(mx, r[k]); }
    if (mx > 1) for (k = 0; k < 3; k++) r[k] /= mx;
    return [Math.max(r[0], 0), Math.max(r[1], 0), Math.max(r[2], 0)];
  }
  // Halo dans l'œil (CIE 146:2002, équation générale de l'éblouissement) : Ψ(θ) en sr⁻¹, θ en degrés (0,1-100°),
  // âge A, pigmentation p (0,5 : yeux marron). Luminance de voile = Σ Ψ(θ) × éclairement de la pupille par chaque
  // élément du champ (L dΩ). À 18 ans, 7,8 % de la lumière part au-delà de 1°, 27 % au-delà de 0,1°.
  var HALO = { p: 0.5, min: 0.1, max: 100 };
  function psiHalo(th, age, p) {
    if (!(th >= HALO.min && th <= HALO.max)) return 0;
    var A = age == null ? VISION.age : age, pp = p == null ? HALO.p : p, a4 = Math.pow(A / 62.5, 4);
    return 10 / (th * th * th) + (5 / (th * th) + 0.1 * pp / th) * (1 + a4) + 2.5e-3 * pp;
  }
  // FFT radix 2 en place, le long d'une ligne (pas 1) ou d'une colonne (pas n) ; directe : exp(−2iπ jk/n) ;
  // inverse sans le 1/n (appliqué par l'appelant). Tables (bits renversés, cosinus) par taille.
  var TABLES_HALO = {};
  function tablesHalo(n) {
    if (TABLES_HALO[n]) return TABLES_HALO[n];
    var rev = new Uint32Array(n), cs = new Float64Array(n / 2), sn = new Float64Array(n / 2), i, j = 0;
    for (i = 1; i < n; i++) { var b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; rev[i] = j; }
    for (i = 0; i < n / 2; i++) { cs[i] = Math.cos(2 * Math.PI * i / n); sn[i] = Math.sin(2 * Math.PI * i / n); }
    return (TABLES_HALO[n] = { rev: rev, cs: cs, sn: sn });
  }
  function fftHalo(re, im, n, pas, o, inv) {
    var T = tablesHalo(n), i, k, t;
    for (i = 1; i < n; i++) {
      var j = T.rev[i];
      if (i < j) { var a1 = o + i * pas, a2 = o + j * pas; t = re[a1]; re[a1] = re[a2]; re[a2] = t; t = im[a1]; im[a1] = im[a2]; im[a2] = t; }
    }
    for (var size = 2; size <= n; size <<= 1) {
      var h = size >> 1, st = n / size;
      for (i = 0; i < n; i += size) for (k = 0; k < h; k++) {
        var wr = T.cs[k * st], wi = inv ? T.sn[k * st] : -T.sn[k * st], p1 = o + (i + k) * pas, p2 = p1 + h * pas;
        var xr = re[p2] * wr - im[p2] * wi, xi = re[p2] * wi + im[p2] * wr;
        re[p2] = re[p1] - xr; im[p2] = im[p1] - xi; re[p1] += xr; im[p1] += xi;
      }
    }
  }
  // 2D sur une grille N × N dont seules les nl premières lignes comptent : à l'aller, elles seules sont non nulles ;
  // au retour, elles seules sont lues (colonnes d'abord).
  function fft2Halo(re, im, N, inv, nl) {
    var l, c;
    if (!inv) { for (l = 0; l < nl; l++) fftHalo(re, im, N, 1, l * N, false); for (c = 0; c < N; c++) fftHalo(re, im, N, N, c, false); }
    else { for (c = 0; c < N; c++) fftHalo(re, im, N, N, c, true); for (l = 0; l < nl; l++) fftHalo(re, im, N, 1, l * N, true); }
  }
  // Noyau Ψ(θ) × angle solide d'un élément, sur une grille 2n (convolution sans repliement), transformé ; mis en cache.
  // θ = pas × distance en éléments (petits angles : le champ fait ±19° au plus) ; l'élément central n'en reçoit rien
  // (ce qui part à moins d'un élément reste dans l'image). Noyau réel et pair : transformée réelle.
  var cacheHalo = {};
  function noyauHalo(n, pas, age) {
    var cle = n + ":" + pas.toPrecision(6) + ":" + age;
    if (cacheHalo[cle]) return cacheHalo[cle];
    var N = 2 * n, re = new Float64Array(N * N), im = new Float64Array(N * N), om = Math.pow(pas * Math.PI / 180, 2);
    for (var j = 0; j < N; j++) for (var i = 0; i < N; i++) {
      var di = i < n ? i : i - N, dj = j < n ? j : j - N;
      re[j * N + i] = di || dj ? psiHalo(pas * Math.sqrt(di * di + dj * dj), age) * om : 0;
    }
    fft2Halo(re, im, N, false, N);
    cacheHalo = {}; cacheHalo[cle] = re;
    return re;
  }
  // Voile (cd/m², XYZ) sur une grille n × n (n puissance de 2) : c = XYZ des éléments du champ (Y en cd/m², 3 par
  // élément, ligne par ligne), pas = taille angulaire d'un élément (degrés). Renvoie Float32Array de 3n². Deux
  // convolutions complexes (X + iZ, puis Y) : le noyau étant réel et pair, parties réelle et imaginaire restent séparées.
  function voileHalo(c, n, pas, age) {
    var N = 2 * n, K = noyauHalo(n, pas, age == null ? VISION.age : age), out = new Float32Array(3 * n * n);
    for (var q = 0; q < 2; q++) {
      var re = new Float64Array(N * N), im = new Float64Array(N * N), i, j, e;
      for (j = 0; j < n; j++) for (i = 0; i < n; i++) {
        e = 3 * (j * n + i);
        if (q === 0) { re[j * N + i] = Math.max(c[e], 0); im[j * N + i] = Math.max(c[e + 2], 0); } else re[j * N + i] = Math.max(c[e + 1], 0);
      }
      fft2Halo(re, im, N, false, n);
      for (i = 0; i < N * N; i++) { re[i] *= K[i]; im[i] *= K[i]; }
      fft2Halo(re, im, N, true, n);
      for (j = 0; j < n; j++) for (i = 0; i < n; i++) {
        e = 3 * (j * n + i);
        if (q === 0) { out[e] = Math.max(re[j * N + i] / (N * N), 0); out[e + 2] = Math.max(im[j * N + i] / (N * N), 0); } else out[e + 1] = Math.max(re[j * N + i] / (N * N), 0);
      }
    }
    return out;
  }
  // Double GLSL de `vision` : vec3 vision(vec3 c, vec4 p, vec3 bal), mêmes constantes.
  var GLSL_VISION = [
    "vec3 vision(vec3 c, vec4 p, vec3 bal, float pied){",
    "  const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722); const vec3 TEINTE = vec3(" + TEINTE_NUIT.join(", ") + ");",
    "  float L = max(c.y, 0.0);",
    "  vec3 r = vec3(3.2406*c.x-1.5372*c.y-0.4986*c.z, -0.9689*c.x+1.8758*c.y+0.0415*c.z, 0.0557*c.x-0.2040*c.y+1.0570*c.z) / bal;",
    "  r = max(r + " + BLANC_HG.toFixed(3) + " * max(-r.x, 0.0), vec3(0.0));",
    "  float Yc = dot(r, LUMA); r = Yc + (r - Yc) * p.z;",
    "  bool reel = p.y > 0.0; float sg = reel ? 0.04 / (0.04 + L) : 0.0, Ls = p.w >= 0.0 ? p.w * L : (c.x > 0.0 ? max(0.0, c.y * (1.33 * (1.0 + (c.y + c.z) / c.x) - 1.68)) : 0.0);",
    "  r = r * (1.0 - sg) + Ls * sg * TEINTE;",
    "  float Yp = dot(r, LUMA); if (!(Yp > 0.0)) return vec3(0.0);",
    "  float d = L / max(p.y, 1e-30), Yd = (reel ? d * d / (1.0 + d * d) : 1.0) * p.x * Yp;",
    "  if (p.y < 0.0) { float u = -Yd / p.y; Yd -= p.y * sqrt(u) * exp(-u); }",
    "  else if (pied > 0.0) { float u = Yd / pied; Yd += pied * sqrt(u) * exp(-u); }",
    "  float G = " + GENOU.toFixed(3) + ", Ye = Yd < G ? Yd : G + (1.0 - G) * (1.0 - exp(-(Yd - G) / (1.0 - G)));",
    "  float ch = 1.0 / (1.0 + max(Yd - 1.0, 0.0));",
    "  r = Ye + (r * (Ye / Yp) - Ye) * ch;",
    "  float mx = max(r.x, max(r.y, r.z)); if (mx > 1.0) r /= mx;",
    "  return max(r, vec3(0.0));",
    "}",
    "vec3 vision(vec3 c, vec4 p, vec3 bal){ return vision(c, p, bal, 0.0); }"].join("\n");

  var Coeur = {
    hash32: hash32, u4: u4, enveloppe: enveloppe, cie: cie, cieFit: cieFit, CIE: [CIE_V410, CIE_Y425, CIE_R650], BLANC_HG: BLANC_HG, rgbLin: rgbLin, gammaS: gammaS, tons: tons, planck: planck,
    SPECTRES: SPECTRES, spectreDe: spectreDe, tirage: tirage, bandes: bandes, terme: terme, xyzSpectre: xyzSpectre, balance: balance,
    LUMINANCES: LUMINANCES, luminanceSource: luminanceSource, fluxLaser: fluxLaser, partYRaie: partYRaie, reponseSilicium: reponseSilicium, amperesParLumen: amperesParLumen,
    pointsSource: pointsSource, dansForme: dansForme, trajet: trajet, trace: trace, bras: bras, pointSource: pointSource, delta: delta,
    preparer: preparer, evaluer: evaluer, contributions: contributions, boiteEclairee: boiteEclairee, analyseBras: analyseBras,
    polyDelta: polyDelta, vignettage: vignettage, lentille: lentille, rendreCPU: rendreCPU, versRGB: versRGB,
    VISION: VISION, vScot: vScot, rapportScotopique: rapportScotopique, scotXYZ: scotXYZ, pupille: pupille, seuilBatonnets: seuilBatonnets,
    seuilCones: seuilCones, seuilVision: seuilVision, sigmaBatonnets: sigmaBatonnets, facteurWard: facteurWard, facteurHunt: facteurHunt,
    parametresVision: parametresVision, adaptation: adaptation, adapterVision: adapterVision, plusClairDrapeau: plusClairDrapeau, rapportPlanck: rapportPlanck, vision: vision, parametresVisible: parametresVisible, VISIBLE: VISIBLE, GLSL_VISION: GLSL_VISION,
    suiviAdaptation: suiviAdaptation, parametresLisses: parametresLisses, TAU_ADAPT: TAU_ADAPT,
    HALO: HALO, psiHalo: psiHalo, voileHalo: voileHalo,
    VERRES: VERRES, indice: indice, cheminLame: cheminLame, lame: lame, dispersion: dispersion, SEG: SEG,
    normaleCompensatrice: normaleCompensatrice, deviationFantome: deviationFantome,
    NDMAX: NDMAX, NCMAX: NCMAX, MMAX: MMAX, LARG: LARG, BLK: BLK, H: H, NMASQ: NMASQ, masqueForme: masqueForme, dansMasque: dansMasque,
    dispersionGroupe: dispersionGroupe
  };
  if (typeof module !== "undefined" && module.exports) { module.exports = { Coeur: Coeur }; return; }

  // ================= carte graphique (WebGL2) =================
  // Le shader reprend `evaluer` en float32 sur les données de `preparer` ; accumulation des passes dans une texture
  // RGBA32F (ping-pong, sans mélange flottant), affichage = moyenne des passes complètes.
  var VS = "#version 300 es\nin vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }";
  var FS_PASSE = "#version 300 es\nprecision highp float; precision highp int;\n" +
    "uniform highp sampler2D uD; uniform highp sampler2D uPrec; uniform highp sampler2D uMasq; uniform int uN; uniform int uM; uniform vec2 uX0; uniform float uH; uniform float uSig2;\n" +
    "out vec4 o;\n" +
    "const int ND = " + NDMAX + ", NC = " + NCMAX + ", BLK = " + BLK + ", OB = " + H.BRAS + ", LG = " + LARG + ";\n" +
    "const float PI = 3.14159265358979;\n" +
    "vec4 T(int t){ return texelFetch(uD, ivec2(t, 0), 0); }\n" +
    "vec4 S(int t){ return texelFetch(uD, ivec2(t, 1), 0); }\n" +
    "float lentille(float r1, float r2, float d){\n" +
    "  if (d >= r1 + r2) return 0.0;\n" +
    "  if (d <= abs(r1 - r2)) { float r = min(r1, r2); return PI * r * r; }\n" +
    "  float a = acos(clamp((d * d + r1 * r1 - r2 * r2) / (2.0 * d * r1), -1.0, 1.0)), b = acos(clamp((d * d + r2 * r2 - r1 * r1) / (2.0 * d * r2), -1.0, 1.0));\n" +
    "  return r1 * r1 * a + r2 * r2 * b - 0.5 * sqrt(max(0.0, (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2)));\n" +
    "}\n" +
    "float vign(int o, vec2 p){\n" +                                   // `vignettage`
    "  vec4 h0 = T(o), h1 = T(o + 1); int nD = int(h0.x + 0.5), ib = int(h1.x + 0.5), ia = int(h1.y + 0.5);\n" +
    "  vec4 b1 = T(o + 3 + 3 * ib); float Rb = T(o + 4 + 3 * ib).x; vec2 cb = b1.y * p + b1.zw; float om = PI * Rb * Rb;\n" +
    "  for (int j = 0; j < ND; j++) { if (j >= nD) break; if (j == ib) continue; vec4 d1 = T(o + 3 + 3 * j); om = min(om, lentille(Rb, T(o + 4 + 3 * j).x, length(d1.y * p + d1.zw - cb))); }\n" +
    "  vec4 a0 = T(o + 2 + 3 * ia); float ra = a0.w, wa = T(o + 3 + 3 * ia).x; vec2 ca = a0.x * p + a0.yz; float ai = PI * ra * ra;\n" +
    "  for (int j = 0; j < ND; j++) { if (j >= nD) break; if (j == ia) continue; vec4 d0 = T(o + 2 + 3 * j); ai = min(ai, lentille(ra, d0.w, length(d0.x * p + d0.yz - ca))); }\n" +
    "  return ai > 0.0 ? om / (ai * (1.0 + wa * wa / (12.0 * ra * ra))) : 0.0;\n" +
    "}\n" +
    "float app(int o, vec2 p, vec2 X, float s2){\n" +                 // `appartenance`
    "  vec4 h0 = T(o); int nD = int(h0.x + 0.5), nC = int(h0.y + 0.5), jt = int(floor(T(o + 1).z + 0.5)); float m = 1.0;\n" +
    "  for (int j = 0; j < NC; j++) { if (j >= nC) break; vec4 c = T(o + 2 + 3 * ND + j); if (length(p - c.xy) > c.z) return 0.0; }\n" +
    "  for (int j = 0; j < ND; j++) { if (j >= nD) break; vec4 d0 = T(o + 2 + 3 * j); float w = T(o + 3 + 3 * j).x, b2 = j == jt ? 0.0 : d0.x * d0.x * s2;\n" +
    "    m = min(m, max(0.0, (sqrt(max(0.0, d0.w * d0.w - b2 / 12.0)) - length(X - (d0.x * p + d0.yz))) / sqrt(w * w + b2) + 0.5)); if (m <= 0.0) return 0.0; }\n" +
    "  return m;\n" +
    "}\n" +
    "void main(){\n" +
    "  ivec2 pix = ivec2(gl_FragCoord.xy);\n" +
    "  vec2 X = uX0 + vec2(gl_FragCoord.xy) * uH;\n" +           // uX0 = coin bas gauche ; gl_FragCoord au centre du pixel
    "  vec4 g = T(0), sr = T(1), kk = T(2), se = T(14), se2 = T(15), mq = T(" + H.MASQ + "), mq2 = T(" + (H.MASQ + 1) + ");\n" +
    "  int nb = int(g.x + 0.5); bool ponct = g.y > 0.5, lam = g.z > 0.5, masq = sr.x > 0.5; float Rs = g.w; ivec2 nm = ivec2(int(mq.w + 0.5), int(mq2.x + 0.5));\n" +
    "  vec3 som = S(LG - 1).xyz;\n" +
    "  vec3 tc[3]; float v[3];\n" +
    "  for (int c = 0; c < 3; c++) { tc[c] = vec3(0.0, 0.0, 1.0); v[c] = 0.0; if (c >= nb) continue;\n" +
    "    vec4 t = T(3 + c); tc[c] = vec3(t.x * X + t.yz, t.w); vec4 h = T(OB + c * BLK); v[c] = h.z > 0.5 ? vign(OB + c * BLK, tc[c].xy) : h.w; }\n" +
    "  vec3 acc = vec3(0.0);\n" +
    "  for (int s = 0; s < uN; s++) {\n" +
    "    int ts = LG * 2 + s; vec2 p; float W, s2 = 0.0;\n" +
    "    if (ponct) { p = vec2(0.0); W = sr.z; }\n" +
    "    else {\n" +
    "      vec4 u = texelFetch(uD, ivec2(ts % LG, ts / LG), 0); int c = int(u.z + 0.5); p = tc[c].xy + tc[c].z * u.xy;\n" +
    "      if (dot(p, p) > Rs * Rs) continue;\n" +
    "      if (masq) { ivec2 ij = ivec2(floor((p - mq.xy) * mq.z)); if (ij.x < 0 || ij.y < 0 || ij.x >= nm.x || ij.y >= nm.y || texelFetch(uMasq, ij, 0).r < 0.5) continue; }\n" +
    "      float den = 0.0;\n" +
    "      for (int j = 0; j < 3; j++) { if (j >= nb) break; vec2 e = p - tc[j].xy; if (dot(e, e) <= tc[j].z * tc[j].z) den += kk[j] / (PI * tc[j].z * tc[j].z); }\n" +
    "      if (!(den > 0.0)) continue;\n" +
    "      W = sr.y / den; s2 = 1.0 / den;\n" +
    "    }\n" +
    "    float f1 = app(OB, p, X, s2) * v[0] * W, f2 = app(OB + BLK, p, X, s2) * v[1] * W, fG = nb > 2 ? app(OB + 2 * BLK, p, X, s2) * v[2] * W * sr.w : 0.0;\n" +
    "    float sm = f1 + f2 + fG;\n" +
    "    if (!(sm > 0.0)) continue;\n" +
    "    acc += som * sm;\n" +
    "    float amp = 2.0 * sqrt(f1 * f2);\n" +
    "    if (!(amp > 0.0)) continue;\n" +
    "    int t = lam && dot(se, vec4(p, X)) + se2.x > 0.0 ? 1 : 0, pb = 6 + 4 * t;\n" +
    "    vec4 a0 = T(pb), a1 = T(pb + 1), a2 = T(pb + 2), a3 = T(pb + 3);\n" +
    "    float Cx = a1.y + a1.z * p.x + a1.w * p.y, Cy = a2.x + a2.y * p.x + a2.z * p.y;\n" +
    "    float dd = a0.x * p.x + a0.y * p.y + a0.z * p.x * p.x + a0.w * p.y * p.y + a1.x * p.x * p.y + Cx * X.x + Cy * X.y + a2.w * X.x * X.x + a3.x * X.y * X.y + a3.y * X.x * X.y;\n" +
    "    vec2 gr = vec2(Cx + 2.0 * a2.w * X.x + a3.y * X.y, Cy + a3.y * X.x + 2.0 * a3.x * X.y);\n" +
    "    float g2 = dot(gr, gr) * uSig2, dt = (t == 1 ? se2.z : se2.y) + dd;\n" +
    "    for (int j = 0; j < uM; j++) {\n" +                                // `terme`
    "      vec4 l0 = S(4 * j), l1 = S(4 * j + 1), l2 = S(4 * j + 2);\n" +
    "      float e = dt + (t == 1 ? S(4 * j + 3).x : l2.w), env = amp * exp(-g2 * l0.x * l0.x - l1.w * e * e), sn = 1.0, jj = 0.0;\n" +
    "      if (l0.w > 0.0) { float x = l0.w * e; if (abs(x) < 0.05) { sn = 1.0 - x * x / 6.0; jj = x / 3.0 - x * x * x / 30.0; } else { float sx = sin(x); sn = sx / x; jj = (sx - x * cos(x)) / (x * x); } }\n" +
    "      float ph = 6.2831853 * fract((t == 1 ? l0.z : l0.y) + dd * l0.x);\n" +
    "      acc += env * (l1.xyz * (sn * cos(ph)) - l2.xyz * (jj * sin(ph)));\n" +
    "    }\n" +
    "  }\n" +
    "  o = texelFetch(uPrec, pix, 0) + vec4(acc, 0.0);\n" +
    "}\n";
  // Affichage : moyenne des passes, interpolée (bilinéaire à la main : pas de filtrage des flottants exigé),
  // XYZ → sRGB, balance, exposition, compression, gamma ; fond (lumière parasite de la salle sur l'écran blanc, AJOUTÉE à
  // l'image) ; retournement. Vision en faible lumière (uVis = (Lt, Lc), luminance Y après exposition ; Lt = 0 : sans),
  // point par point (un noyau de voisinage dessinait des copies d'un point brillant) : sous Lt, l'éclairement perçu
  // tombe comme (L/Lt)² et se fond dans la lumière parasite (seuil de vision : des anneaux faibles disparaissent, une
  // image vive ou une tache brillante est intacte) ; sous Lc, la couleur se perd (désaturation complète vers Lc/20).
  // Compression (uComp = p, 0 < p < 1 ; sinon sans) : luminance affichée en L^p, teinte gardée. Vision à l'œil adapté
  // au noir : une image fantôme de 4 % d'une tache se voit nettement (0,04^0,5 = 0,2), comme dans l'appareil.
  // Luminosité réelle : uMode = 1, la moyenne des passes (lux) × uS = luminance
  // vue (cd/m² : écran ρ/π, rétine 289 / aire de la pupille en mm²), puis `vision` du module couleur (uVisP =
  // parametresVision), ni fond, ni compression : le moniteur affiche ce que l'œil percevrait.
  var FS_AFFICHE = "#version 300 es\nprecision highp float; precision highp int;\n" +
    "uniform highp sampler2D uA; uniform float uInv; uniform vec3 uBal; uniform float uExpo; uniform vec2 uTaille; uniform int uRes;\n" +
    "uniform vec3 uFond; uniform vec4 uCadre; uniform float uRetourne; uniform vec2 uVis; uniform float uComp;\n" +
    "uniform int uMode; uniform vec4 uVisP; uniform float uS; uniform float uPied;\n" +
    "out vec4 o;\n" + GLSL_VISION + "\n" +
    "vec3 lire(ivec2 p){ p = clamp(p, ivec2(0), ivec2(uRes - 1)); return texelFetch(uA, p, 0).xyz; }\n" +
    "vec3 ech(vec2 f){ vec2 q = f * float(uRes) - 0.5; ivec2 i0 = ivec2(floor(q)); vec2 t = q - floor(q);\n" +
    "  return mix(mix(lire(i0), lire(i0 + ivec2(1, 0)), t.x), mix(lire(i0 + ivec2(0, 1)), lire(i0 + ivec2(1, 1)), t.x), t.y) * uInv; }\n" +
    "float gam(float x){ x = clamp(x, 0.0, 1.0); return x <= 0.0031308 ? 12.92 * x : 1.055 * pow(x, 1.0 / 2.4) - 0.055; }\n" +
    "void main(){\n" +
    "  vec2 f = gl_FragCoord.xy / uTaille;\n" +                       // 0..1, bas gauche
    "  if (uRetourne > 0.5) f = 1.0 - f;\n" +
    "  vec3 c = ech(f);\n" +
    "  if (uMode == 1) { vec3 v = vision(c * uS, uVisP, uBal, uPied); o = vec4(gam(v.x), gam(v.y), gam(v.z), 1.0); return; }\n" +
    "  vec3 r = vec3(3.2406*c.x-1.5372*c.y-0.4986*c.z, -0.9689*c.x+1.8758*c.y+0.0415*c.z, 0.0557*c.x-0.2040*c.y+1.0570*c.z) / uBal * uExpo;\n" +
    "  r += " + BLANC_HG.toFixed(3) + " * max(-r.x, 0.0);\n" +                     // blanc hors gamut (versRGB)
    "  r = max(r, vec3(0.0));\n" +
    "  if (uComp > 0.0 && uComp < 1.0) r *= pow(max(c.y * uExpo, 1e-9), uComp - 1.0);\n" +
    "  if (uVis.x > 0.0) {\n" +
    "    float L = max(c.y * uExpo, 1e-9), w = clamp(log(uVis.y / L) / log(20.0), 0.0, 1.0);\n" +
    "    r = mix(r, vec3(L), 0.85 * w);\n" +
    "    if (L < uVis.x) r *= (L / uVis.x) * (L / uVis.x);\n" +
    "  }\n" +
    "  vec2 g = gl_FragCoord.xy; bool dedans = g.x >= uCadre.x && g.y >= uCadre.y && g.x <= uCadre.z && g.y <= uCadre.w;\n" +
    "  r = 1.0 - exp(-(r + (dedans ? uFond : vec3(0.0))));\n" +
    "  o = vec4(gam(r.x), gam(r.y), gam(r.z), 1.0);\n" +
    "}\n";

  // Renvoie null sans WebGL2 ou sans rendu en flottant (EXT_color_buffer_float) : repli sur le CPU.
  function creerRenduGL(canvas) {
    var gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    if (!gl) return null;
    if (!gl.getExtension("EXT_color_buffer_float")) return null;
    function sh(t, src) {
      var x = gl.createShader(t); gl.shaderSource(x, src); gl.compileShader(x);
      if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x));
      return x;
    }
    function prog(fs) {
      var p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(p, 0, "a"); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      var U = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (var i = 0; i < n; i++) { var nom = gl.getActiveUniform(p, i).name; U[nom] = gl.getUniformLocation(p, nom); }
      return { p: p, U: U };
    }
    var PP = prog(FS_PASSE), PA = prog(FS_AFFICHE);
    var vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    function tex() {
      var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }
    var tD = tex(), tM = tex(), masqCharge = null, acc = [], res = 0, cour = 0, npasses = 0, f32 = null, rendu = null;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(1));
    function dimensionner(r) {
      if (r === res) return;
      res = r;
      acc.forEach(function (a) { gl.deleteTexture(a.t); gl.deleteFramebuffer(a.fb); });
      acc = [0, 1].map(function () {
        var t = tex(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, r, r, 0, gl.RGBA, gl.FLOAT, null);
        var fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
        return { t: t, fb: fb };
      });
      raz();
    }
    function raz() {
      for (var i = 0; i < 2; i++) { gl.bindFramebuffer(gl.FRAMEBUFFER, acc[i].fb); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
      npasses = 0;
    }
    // Ajoute une passe (sortie de Coeur.preparer, faite pour ce `rendu`).
    function passe(prep, r) {
      rendu = r; dimensionner(r.res);
      var L = prep.larg, n = prep.lignes;
      if (!f32 || f32.length < L * n * 4) f32 = new Float32Array(L * n * 4);
      f32.set(prep.donnees);
      gl.useProgram(PP.p); gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tD);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, L, n, 0, gl.RGBA, gl.FLOAT, f32, 0);
      if (prep.masque && prep.masque !== masqCharge) {      // masque de la forme : chargé quand il change
        var m = prep.masque; masqCharge = m;
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tM);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, m.nx, m.ny, 0, gl.RED, gl.UNSIGNED_BYTE, m.d);
      }
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tM);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, acc[cour].t);
      var U = PP.U, h = 2 * r.W / r.res;
      gl.uniform1i(U.uD, 0); gl.uniform1i(U.uPrec, 1); gl.uniform1i(U.uMasq, 2); gl.uniform1i(U.uN, prep.n); gl.uniform1i(U.uM, prep.M);
      gl.uniform2f(U.uX0, (r.cx0 || 0) - r.W, (r.cy0 || 0) - r.W); gl.uniform1f(U.uH, h);
      gl.uniform1f(U.uSig2, 2 * Math.PI * Math.PI * prep.sigma * prep.sigma);
      gl.bindFramebuffer(gl.FRAMEBUFFER, acc[1 - cour].fb); gl.viewport(0, 0, r.res, r.res);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, null);
      cour = 1 - cour; npasses++;
    }
    // Attend la fin du calcul (lecture d'un pixel) : pour chronométrer.
    function finir() { var px = new Float32Array(4); gl.bindFramebuffer(gl.FRAMEBUFFER, acc[cour].fb); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, px); }
    // Moyenne des passes (XYZ), ligne 0 en HAUT comme rendreCPU.
    function lire() {
      var b = new Float32Array(res * res * 4), out = new Float64Array(res * res * 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, acc[cour].fb); gl.readPixels(0, 0, res, res, gl.RGBA, gl.FLOAT, b);
      for (var iy = 0; iy < res; iy++) for (var ix = 0; ix < res; ix++) {
        var s = 4 * ((res - 1 - iy) * res + ix), d = 3 * (iy * res + ix);
        out[d] = b[s] / npasses; out[d + 1] = b[s + 1] / npasses; out[d + 2] = b[s + 2] / npasses;
      }
      return out;
    }
    // o = { expo, bal: [r, g, b], fond: [r, g, b] (linéaire, ajouté), cadre: [x0, y0, x1, y1] (pixels du canvas, bas gauche),
    //       retourne: bool, vision: [Lt, Lc] (faible lumière, cf. FS_AFFICHE ; absent : sans), comp: p (L^p ; absent : sans),
    //       visP: parametresVision et s (cd/m² par lux) : luminosité réelle (expo, fond, comp, vision ignorés) }
    function afficher(o) {
      if (!npasses) return;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(PA.p); gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, acc[cour].t);
      var U = PA.U, bal = o.bal || [1, 1, 1], fond = o.fond || [0, 0, 0], cad = o.cadre || [0, 0, canvas.width, canvas.height];
      gl.uniform1i(U.uA, 0); gl.uniform1f(U.uInv, 1 / npasses); gl.uniform3f(U.uBal, bal[0], bal[1], bal[2]);
      gl.uniform1f(U.uExpo, o.expo); gl.uniform2f(U.uTaille, canvas.width, canvas.height); gl.uniform1i(U.uRes, res);
      gl.uniform3f(U.uFond, fond[0], fond[1], fond[2]); gl.uniform4f(U.uCadre, cad[0], cad[1], cad[2], cad[3]);
      gl.uniform1f(U.uRetourne, o.retourne ? 1 : 0);
      var vis = o.vision || [0, 0]; gl.uniform2f(U.uVis, vis[0], vis[1]);
      gl.uniform1f(U.uComp, o.comp || 1);
      var vp = o.visP; gl.uniform1i(U.uMode, vp ? 1 : 0); gl.uniform1f(U.uS, vp ? o.s : 0);
      gl.uniform4f(U.uVisP, vp ? vp[0] : 0, vp ? vp[1] : 1, vp ? vp[2] : 1, vp ? vp[3] : -1); gl.uniform1f(U.uPied, vp && vp[4] > 0 ? vp[4] : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    return {
      gl: gl, passe: passe, raz: raz, finir: finir, lire: lire, afficher: afficher, dimensionner: dimensionner,
      get npasses() { return npasses; }, get res() { return res; },
      info: function () { var d = gl.getExtension("WEBGL_debug_renderer_info"); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); }
    };
  }

  // Moteur progressif : aperçu pendant le geste (petite résolution, une passe), puis, 150 ms après le dernier
  // changement, image fine accumulée passe après passe (chaque passe = toute la source). Une passe par image
  // d'animation : la page reste fluide. q = { apercu: {res, N, M}, fin: {res, N, M, passes} } par spectre.
  // demander(cfg, aff, {pose}) : `pose` = δ balayé depuis l'image précédente (flou de mouvement de l'aperçu).
  // Luminosité : aff.vision = {s (cd/m² par lux), omega (deg² par m² du détecteur), M, Fsalle,
  // salle, scot, pup, affiche (false : seulement la pupille)} → niveau d'adaptation et pupille mesurés sur l'image
  // elle-même (le champ affiché EST le champ entier : pas de zoom au Michelson), stats.vision (`adapterVision`) ;
  // aff.auto : exposition sur le 99e centile des pixels éclairés (« toujours visible ») ; avec aff.visible = x0 (pied,
  // `parametresVisible`), par la chaîne de `vision` sans seuil (linéaire, genou, pied) au lieu de versRGB et aff.comp.
  // Mesure (relecture de l'image)
  // à l'aperçu d'un changement parti du repos, sinon (geste en cours) à la première passe de l'image fine : pendant un
  // geste l'œil garde son adaptation.
  function creerMoteur(canvas, opts) {
    var R = creerRenduGL(canvas);
    if (!R) return null;
    var cfg = null, aff = null, sale = false, tChange = 0, etat = "repos", fin = 0, graine = (opts && opts.graine) || 1, t0Fin = 0, pose = 0;
    var stats = { apercuMs: 0, passeMs: 0, passes: 0, finMs: 0, objectif: 0, vision: null, expo: 0, y99: 0, adaptMs: 0, adaptLa: null };
    var chrono = !!(opts && opts.chrono), adaptDue = false, cleAdapt = null, tMesure = -1e9;
    // Niveau d'adaptation affiché (cf. `suiviAdaptation`) : la cible mesurée reste `stats.vision`, `visA` est ce que
    // voit l'image ; `sceneAncre` = la scène où le niveau a été ancré pour la dernière fois.
    var SUIVI = suiviAdaptation(), visA = null, tLiss = 0, tRelax = 0, sceneAncre = null;
    function demander(c, a, x) { cfg = c; aff = a; pose = (x && x.pose) || 0; sale = true; tChange = performance.now(); }
    function cle(a) { return a ? JSON.stringify([a.vision || null, !!a.auto, a.visible || 0, a.W, a.cx0 || 0, a.cy0 || 0]) : null; }
    function adapter() {
      var t0 = performance.now(), img = R.lire(), n = img.length / 3, h = 2 * aff.W / R.res, Y = new Float64Array(n), i;
      for (i = 0; i < n; i++) Y[i] = Math.max(img[3 * i + 1], 0);
      if (aff.auto) {
        stats.y99 = centileEclaires(Y, 0.99);
        stats.expo = stats.y99 > 0 ? 0.9 / stats.y99 : 0;
      }
      if (aff.vision) {
        var V = aff.vision, L = new Float64Array(n);
        for (i = 0; i < n; i++) L[i] = Y[i] * V.s;
        var a = adapterVision(L, V.omega * h * h, { M: V.M, Fsalle: V.Fsalle, salle: V.salle, scot: V.scot, pied: V.pied });
        a.pupTracee = V.pup || 0; a.cfg = cfg; a.scene = aff.scene == null ? null : aff.scene; stats.vision = a;
      } else stats.vision = null;
      cleAdapt = cle(aff); adaptDue = false; tMesure = t0; stats.adaptMs = performance.now() - t0;
    }
    // Le niveau AFFICHÉ rejoint la cible mesurée, ancré quand la scène change (la cible porte la scène où elle a été
    // mesurée) et à l'arrivée. Aucune passe : seuls les paramètres d'affichage changent.
    function lisser() {
      if (!aff || !aff.vision || !stats.vision) return;
      var t = performance.now(), a = stats.vision, neuf = a.scene !== sceneAncre;
      sceneAncre = a.scene;
      var La = SUIVI.pas(a.La, tLiss ? (t - tLiss) / 1000 : 0, neuf || SUIVI.ancre);
      tLiss = t;
      visA = parametresLisses(La, aff.vision.scot, a.haut, a.p[4]);
      stats.adaptLa = La;
    }
    function aAfficher() {
      if (!aff || !(aff.vision || aff.auto)) return aff;
      var o = {}, k; for (k in aff) o[k] = aff[k];
      if (aff.vision && aff.vision.affiche !== false && stats.vision) { lisser(); o.visP = visA || stats.vision.p; o.s = aff.vision.s; }
      else if (aff.auto && aff.visible && stats.y99 > 0) { o.visP = parametresVisible(stats.y99 / (aff.expo || 1), aff.visible); o.s = 1; }
      else if (aff.auto && stats.expo > 0) o.expo = stats.expo * (aff.expo || 1);
      return o;
    }
    function qualite() { return opts.qualite(cfg); }
    function rendu(niv) {
      var q = qualite()[niv];
      return { res: q.res, W: aff.W, cx0: aff.cx0 || 0, cy0: aff.cy0 || 0, K: q.K, N: q.N, M: q.M, graine: graine, pose: niv === "apercu" ? pose : 0 };
    }
    function unePasse(r, p) {
      var t = performance.now();
      R.passe(preparer(cfg, r, p), r);
      if (chrono) R.finir();
      return performance.now() - t;
    }
    // À appeler à chaque requestAnimationFrame ; renvoie vrai si l'image a changé.
    function tick() {
      if (!cfg) return false;
      var now = performance.now();
      if (sale) {
        sale = false;
        var r = rendu("apercu"); R.dimensionner(r.res); R.raz();
        stats.apercuMs = unePasse(r, 0); stats.passes = 0;
        if (aff.vision || aff.auto) {
          // Pendant un geste, la cible du niveau d'adaptation AFFICHÉ est remesurée 5 fois par seconde au plus (l'aperçu
          // est le champ entier : le fondu se voit donc pendant le geste) ; un changement parti du repos est mesuré tout
          // de suite. En « toujours visible » (`auto` sans `vision` affichée) il n'y a rien à faire fondre : la mesure
          // attend la fin du geste, sinon l'exposition renormalise à chaque pas et l'image clignote.
          var vu = !!(aff.vision && aff.vision.affiche !== false);
          if (!(stats.vision || stats.expo) || cle(aff) !== cleAdapt || etat === "repos" || (vu && performance.now() - tMesure > 200)) adapter(); else adaptDue = true;
        }
        etat = "apercu"; R.afficher(aAfficher()); return true;
      }
      if (etat === "apercu" && now - tChange > 150) {
        etat = "fin"; fin = 0; t0Fin = now; stats.finMs = 0; stats.objectif = qualite().fin.passes;
      }
      if (etat === "fin") {
        var rf = rendu("fin");
        if (fin === 0) { R.dimensionner(rf.res); R.raz(); }
        stats.passeMs = unePasse(rf, fin + 1); fin++; stats.passes = fin;
        if (fin === 1 && adaptDue) adapter();
        R.afficher(aAfficher());
        if (fin >= qualite().fin.passes) { etat = "repos"; stats.finMs = performance.now() - t0Fin; }
        return true;
      }
      // Image fine posée et niveau d'adaptation encore en mouvement : on la repeint (aucune passe, l'accumulateur
      // reste tel quel) 25 fois par seconde au plus ; la fin du parcours est inaperçue et n'a pas à tourner.
      if (etat === "repos" && stats.vision && SUIVI.enRelax(stats.vision.La) && now - tRelax > 40) {
        tRelax = now; R.afficher(aAfficher()); return true;
      }
      return false;
    }
    function reafficher(a) { aff = a; if ((aff.vision || aff.auto) && cle(aff) !== cleAdapt && R.npasses) adapter(); R.afficher(aAfficher()); }
    return { demander: demander, tick: tick, reafficher: reafficher, stats: stats, rendu: R, get etat() { return etat; },
      // vrai tant que le niveau d'adaptation rejoint encore sa cible : l'appelant sait qu'une repeinte ne dit rien de
      // neuf du champ (ni histogramme, ni courbe à relire)
      get relax() { return !!(stats.vision && SUIVI.enRelax(stats.vision.La)); } };
  }

  Coeur.creerRenduGL = creerRenduGL;
  Coeur.creerMoteur = creerMoteur;
  root.VITRINE_MICHELSON = Coeur;
})(typeof window !== "undefined" ? window : this);
