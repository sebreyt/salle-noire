#!/usr/bin/env python3
# Créé par Claude
"""Référence Python du moteur goniomètre ().

Deux étages :
  1. PARAXIAL — l'algorithme que le cœur JS (_app-goniometre-coeur.js, session 2b) rejoue opération pour opération :
     chaîne de vergences fente → collimateur → (réseau | miroir | rien) → objectif → plan du réticule → oculaire → œil,
     directions apparentes par le rayon principal, pupille utile (intersection pupille de l'œil / cercle oculaire),
     accommodation (§ 5). Le test de concordance rejoue app_goniometre_controles.json avec le JS à 1e-9.
  2. EXACT — tracé de rayons sur le réseau (équation vectorielle du réseau, source ponctuelle à distance finie) : sert
     à vérifier le facteur (cos i / cos θ)² de la vergence dans le plan de dispersion, l'absence d'effet le long des
     traits (astigmatisme) et l'anamorphose dθ/di = cos i / cos θ.
  + vérifications chiffrées du § 1 de la SPEC (`verifications`).

Conventions (vue de dessus, angles comptés dans le sens trigonométrique depuis l'axe du collimateur ; la lumière du
collimateur va dans la direction 0) :
  phi   lunette : direction de la lumière qui y entre (0 = dans l'axe du collimateur).
  psi   plate-forme : direction de la normale du réseau ou du miroir (une normale est une droite : ψ et ψ + π).
  eps   tirage de la lunette : réticule à fL + eps de l'objectif (eps > 0 : trop loin de l'objectif).
  eC    tirage du collimateur : fente à fC + eC de l'objectif (eC > 0 : trop loin, faisceau sortant convergent).
  u     oculaire : réticule à foc − u de l'oculaire (u > 0 enfoncé : image virtuelle ; u < 0 tiré : « au-delà de
        l'infini »).
  Champ : X vers la droite de l'observateur, Y vers le haut, angles apparents (rad, derrière l'oculaire) vus du centre
  de la pupille utile. Vergences au niveau de l'œil exprimées en « proximité » P = −V (δ) : P = 1/distance de l'image
  virtuelle ; P = 0 image à l'infini, P < 0 faisceau convergent (au-delà de l'infini).

Champ de la lunette (session 2b) : `preparer_champ` réduit la vue à des profils 1D analytiques (aucun
échantillonnage) et `xyz_champ` donne l'éclairement XYZ en un point du champ apparent :
  - noyau d'un objet = disque de défocalisation projeté (densité ∝ √(R² − x²), R = flou / 2) ⊗ gaussienne de
    variance (0,376 × 1er zéro de diffraction)² + (acuité / 2,355)² + pixel² / 12 (le sinus cardinal² remplacé par la
    gaussienne de même largeur à mi-hauteur) ; fonction de répartition : R ≤ s → gaussienne de même variance
    (s² + R²/4), sinon quadrature de Gauss-Hermite à 7 nœuds sur la gaussienne ; erf d'Abramowitz-Stegun 7.1.26.
  - raie = bande de largeur géométrique `largeur`, couverture C(X) = K(X − c + w/2) − K(X − c − w/2), luminance
    I × T (pupille utile) × CIE(λ) (× 0,5 si la lame semi-réfléchissante est baissée) ; la luminance d'une fente ne
    baisse que quand elle devient plus fine que le noyau.
  - réticule et image retour : fils (bandes absorbantes de largeur `fil`, horizontale et verticale) + repère
    dissymétrique (segment vertical) ; disque retour = image du diaphragme de champ éclairé par la lampe latérale
    (lampe à 2800 K), assombri par l'ombre de ses propres fils ; le réticule passe DEVANT tout (il masque, et luit
    faiblement quand la lampe latérale l'éclaire) ; diaphragme de champ au flou du réticule ; voile de 0,2 %.
  - règle d'AFFICHAGE (pas de physique) : un fil fait au moins FIL_PX pixels, sinon il disparaît du champ entier
    (2,4′ par pixel pour une acuité de 1′) alors que l'œil le voit net.

Usage :
    python3 app_goniometre_reference.py            # vérifications chiffrées (§ 1 de la SPEC)
    python3 app_goniometre_reference.py --ecrire   # régénère app_goniometre_controles.json (jamais édité à la main)
"""
import json
import math
import sys
from pathlib import Path

ICI = Path(__file__).resolve().parent
SRC = (ICI / ".." / "src").resolve()
CONTROLES = ICI / "app_goniometre_controles.json"
ARCMIN = math.pi / 180 / 60
DEG = math.pi / 180

# ================= appareil (goniomètre classique, SPEC § 2) =================
APPAREIL = {
    "fC": 0.175, "DC": 0.030,      # objectif du collimateur : focale, diamètre (m)
    "fL": 0.175, "DL": 0.030,      # objectif de la lunette
    "foc": 0.025,                  # oculaire
    "champ": 0.008,                # diaphragme de champ, dans le plan du réticule (diamètre)
    "D1": 0.12, "D2": 0.12,        # objectif du collimateur → axe de la plate-forme, axe → objectif de la lunette
    "a": 1e-3 / 600,               # pas du réseau
    "Lres": 0.040,                 # largeur gravée du réseau
    "fil": 15e-6,                  # largeur d'un fil du réticule
    "repere": 1.6e-3,              # repère dissymétrique du réticule : petit trait vertical à x = +repere
    "repere_h": 0.25e-3,           # sa demi-hauteur
    "fente_h": 0.010,              # hauteur de la fente
    "Lp": 0.040,                   # prisme équilatéral : côté
    "nA": 1.5943, "nB": 8926.0,    # son verre (flint F2) : n = nA + nB/λ² (λ en nm), ajusté sur n_C et n_F
}
OEIL = {"pupille": 3e-3, "acuite": ARCMIN, "pdc": 0.25}   # pupille (lumière du réticule), acuité, profondeur de champ (δ)
# (punctum remotum en proximité, amplitude d'accommodation) en δ
YEUX = {"normal": (0.0, 8.0), "myope": (2.0, 8.0), "hyper": (-1.0, 8.0), "presbyte": (0.0, 1.0)}
EFF = [1.0, 0.45, 0.2, 0.08]       # efficacité relative des ordres |p| = 0..3 (enveloppe simple, indépendante de λ)
PMAX = 3
# Raies (nm, intensité relative). Tables complètes (fiche, NIST) en session 5 ; garder le cœur JS identique.
SOURCES = {
    "Hg": [[404.656, 0.5], [407.783, 0.05], [435.833, 1.0], [491.604, 0.03], [546.074, 0.8], [576.960, 0.12],
           [579.066, 0.12]],   # rapports NIST (raies fortes, 2026-11-14)
    "Na": [[588.995, 1.0], [589.592, 1 / 1.2]],   # D₂/D₁ = 1,2, comme le Michelson
}


def nombre(x):
    """Écriture d'un nombre identique à String(x) en JS (plus court aller-retour, sans « .0 »)."""
    r = repr(float(x))
    return r[:-2] if r.endswith(".0") else r


def app(cfg, k):
    return cfg.get("appareil", {}).get(k, APPAREIL[k])


# ================= étage paraxial (copie du cœur JS) =================
def transfert(V, d):
    """Vergence après un parcours d dans l'air (V > 0 convergent)."""
    return V / (1 - d * V)


def wrap(x):
    """Angle ramené dans ]−π, π]."""
    x = math.fmod(x + math.pi, 2 * math.pi)
    if x <= 0:
        x += 2 * math.pi
    return x - math.pi


def wrap_droite(x):
    """Direction d'une droite (normale) ramenée dans ]−π/2, π/2]."""
    x = math.fmod(x + math.pi / 2, math.pi)
    if x <= 0:
        x += math.pi
    return x - math.pi / 2


def lunette(cfg):
    """Géométrie de la lunette : tirages, tube, cercle oculaire (position e après l'oculaire, diamètre), G, champ."""
    fL, foc = app(cfg, "fL"), app(cfg, "foc")
    zr = fL + cfg["eps"]                       # objectif → réticule
    doc = foc - cfg["u"]                       # réticule → oculaire
    Lt = zr + doc                              # objectif → oculaire
    e = 1 / (1 / foc - 1 / Lt)                 # image de l'objectif par l'oculaire : le cercle oculaire
    G = Lt / foc - 1                           # angle apparent / pente du rayon principal dans le tube
    return {"zr": zr, "doc": doc, "Lt": Lt, "e": e, "G": G, "cercle": app(cfg, "DL") * e / Lt,
            "champ": G * app(cfg, "champ") / 2 / zr}


def P_oeil(L, cfg, Vo):
    """Proximité au niveau de l'œil d'un faisceau de vergence Vo juste après l'objectif de la lunette."""
    V = transfert(Vo, L["Lt"]) + 1 / app(cfg, "foc")
    return -transfert(V, L["e"])


def P_point(L, cfg, d):
    """Proximité au niveau de l'œil d'un point à d avant l'oculaire (réticule : d = doc)."""
    return -transfert(-1 / d + 1 / app(cfg, "foc"), L["e"])


def reticule(cfg, L):
    P = P_point(L, cfg, L["doc"])
    return {"id": "reticule", "type": "reticule", "X0": 0.0, "Y0": 0.0, "Px": P, "Py": P,
            "g": L["G"] / L["zr"],                       # angle apparent par mètre dans le plan du réticule
            "fil": L["G"] * app(cfg, "fil") / L["zr"], "Delta": 0.0, "I": 1.0 if cfg.get("lampe_lunette") else 0.0}


def retour(cfg, L):
    """Image retour du réticule (autocollimation sur le miroir de la plate-forme), dépliée : objectif, 2·D2, objectif.

    Rayon principal de l'image d'un point ξ du réticule : celui qui repasse par le centre de l'objectif au retour ;
    sa pente σ' = A ξ + B β est la direction de l'image vue du centre de la pupille. Pente s = dw/d(parcours), w vers
    la gauche de la lumière qui va vers l'œil (= droite de l'observateur). Miroir tourné de β : s → s + 2β.
    """
    fL, D2 = app(cfg, "fL"), app(cfg, "D2")
    beta = wrap_droite(cfg["psi"] - cfg["phi"])
    zr = L["zr"]

    def pente(xi, b):
        # y3(s0) = 0 avec y3 affine en s0 : deux évaluations suffisent
        def y3(s0):
            y1 = xi + s0 * zr
            s1 = s0 - y1 / fL
            y2 = y1 + s1 * D2
            s2 = s1 + 2 * b
            return y2 + s2 * D2, s2
        ya, sa = y3(0.0)
        yb, sb = y3(1.0)
        t = -ya / (yb - ya)
        return sa + t * (sb - sa)
    B0 = pente(0.0, beta)                             # = A·0 + B·β
    A = pente(1.0, 0.0)                               # pente par mètre de ξ (≈ −1/fL : grandissement −1)
    V = -1 / zr + 1 / fL
    V = transfert(V, 2 * D2) + 1 / fL                 # après le second passage dans l'objectif
    P = P_oeil(L, cfg, V)
    Delta = zr - 1 / V                                # position longitudinale : > 0 du côté de l'objectif
    vis = 1.0 if (cfg.get("lampe_lunette") and cfg.get("plateau") == "miroir") else 0.0
    return {"id": "retour", "type": "retour", "X0": L["G"] * B0, "Y0": 0.0, "Px": P, "Py": P,
            "g": L["G"] * A, "fil": L["G"] * abs(A) * app(cfg, "fil"), "Delta": Delta, "beta": beta, "I": vis}


def _image(cfg, L, V1, lam, Isrc, p, ident, th, m, direction, Wout, fg, eff, decal):
    """Image de la fente pour un faisceau parallèle sortant de la plate-forme dans `direction`, de largeur Wout, dont
    le rayon central passe à `decal` (vers la gauche de la lumière) de l'axe ; m = grandissement angulaire dans le plan
    de dispersion (la vergence y est multipliée par m², la largeur de l'image par m)."""
    fC, fL, DL, D2 = app(cfg, "fC"), app(cfg, "fL"), app(cfg, "DL"), app(cfg, "D2")
    alpha = wrap(direction - cfg["phi"])
    V2x = transfert(V1 * m * m, D2)
    V2y = transfert(V1, D2)
    Vox, Voy = V2x + 1 / fL, V2y + 1 / fL
    h0 = D2 * alpha + decal                        # le rayon central coupe l'objectif à h0
    cap = max(0.0, min(h0 + Wout / 2, DL / 2) - max(h0 - Wout / 2, -DL / 2))
    sigma = alpha * (1 + D2 * V2x)                 # pente du rayon principal vers l'image (§ docstring)
    return {"id": ident, "type": "raie", "lam": lam, "p": p, "theta": th, "m": m,
            "direction": direction, "alpha": alpha,
            "X0": L["G"] * sigma, "Y0": 0.0, "Px": P_oeil(L, cfg, Vox), "Py": P_oeil(L, cfg, Voy),
            "largeur": L["G"] * m * cfg["b"] / (fC + cfg["eC"]),
            "Wcap": cap, "Delta": (L["zr"] - 1 / Vox) if abs(Vox) > 1e-9 else None,
            "I": Isrc * eff * fg * (cap / Wout)}


def raies(cfg, L):
    """Images de la fente : une par raie et par ordre (réseau), par trajet (prisme), ou l'image directe (rien)."""
    fC, DC = app(cfg, "fC"), app(cfg, "DC")
    D1, a = app(cfg, "D1"), app(cfg, "a")
    V0 = -1 / (fC + cfg["eC"]) + 1 / fC
    V1 = transfert(V0, D1)
    plateau = cfg.get("plateau", "reseau")
    if plateau == "miroir":
        return []
    psi = wrap_droite(cfg["psi"])
    out = []
    for lam, Isrc in (cfg.get("spectre") or SOURCES[cfg["lampe"]]):   # spectre : [[λ (nm), I], …] fourni par l'instrument
        lm = lam * 1e-9
        if plateau == "prisme":
            n = indice_prisme(cfg, lam)
            for t in trajets_prisme(cfg, n):
                o = _image(cfg, L, V1, lam, Isrc, 1, "raie:%s:P%d%d" % (nombre(lam), t["k"], t["j"]), t["i2"], t["m"],
                           math.atan2(t["d"][1], t["d"][0]), t["Wout"], t["Win"] / DC, 1.0, t["decal"])
                o["W"], o["decal"], o["trajet"] = t["Wout"], t["decal"], {"e": t["e"], "s": t["s"]}
                out.append(o)
            continue
        ordres = range(-PMAX, PMAX + 1) if plateau == "reseau" else [0]
        for p in ordres:
            if plateau == "reseau":
                si = -math.sin(psi)
                s = si + p * lm / a
                if abs(s) >= 1:
                    continue
                ci = math.cos(psi)
                th = math.asin(s)
                ct = math.cos(th)
                m = ci / ct
                direction = psi + th
                Wg = min(DC / ci, app(cfg, "Lres"), cfg.get("diaph") or 1e9)     # longueur éclairée du réseau
                fg = Wg * ci / DC
                eff = EFF[abs(p)]
            else:
                th, m, direction, Wg, fg, eff, ct = 0.0, 1.0, 0.0, DC, 1.0, 1.0, 1.0
            out.append(_image(cfg, L, V1, lam, Isrc, p, "raie:%s:%d" % (nombre(lam), p), th, m, direction,
                              Wg * ct, fg, eff, 0.0))   # Wg·ct = largeur du faisceau diffracté
    return out


# ================= prisme (tracé dans le plan de la plate-forme) =================
def indice_prisme(cfg, lam):
    """Indice du verre du prisme, loi de Cauchy (λ en nm)."""
    return app(cfg, "nA") + app(cfg, "nB") / (lam * lam)


def refracter(d, N, nn):
    """Snell-Descartes vectoriel : direction unitaire d, normale unitaire N tournée vers la lumière incidente,
    nn = n_avant / n_après. None en réflexion totale."""
    ci = -(N[0] * d[0] + N[1] * d[1])
    s2 = nn * nn * (1 - ci * ci)
    if s2 >= 1:
        return None
    k = nn * ci - math.sqrt(1 - s2)
    return [nn * d[0] + k * N[0], nn * d[1] + k * N[1]]


def geom_prisme(cfg):
    """Prisme équilatéral de côté Lp, centre de gravité sur l'axe de la plate-forme : sommet k dans la direction
    psi + 2πk/3, face k entre les sommets k et k + 1, de normale sortante psi + π/3 + 2πk/3."""
    Rc = app(cfg, "Lp") / math.sqrt(3)
    S = [[Rc * math.cos(cfg["psi"] + 2 * math.pi * k / 3), Rc * math.sin(cfg["psi"] + 2 * math.pi * k / 3)] for k in range(3)]
    N = [[math.cos(cfg["psi"] + math.pi / 3 + 2 * math.pi * k / 3), math.sin(cfg["psi"] + math.pi / 3 + 2 * math.pi * k / 3)]
         for k in range(3)]
    return S, N


def _pt(P, Q, s):
    return [P[0] + s * (Q[0] - P[0]), P[1] + s * (Q[1] - P[1])]


def _sc(u, v):
    return u[0] * v[0] + u[1] * v[1]


def trajets_prisme(cfg, n):
    """Faisceau du collimateur (largeur DC, centré sur l'axe, direction 0) à travers le prisme d'indice n : un trajet par
    face éclairée et par face de sortie atteinte de l'intérieur ; la réflexion totale perd le faisceau (pas de
    réflexion suivie). Rayons parallèles : un sous-faisceau est un intervalle de la coordonnée transverse.
    Rend k, j (faces d'entrée et de sortie), d (direction de sortie), m (grandissement angulaire
    cos i·cos r′ / (cos r·cos i′)), Win et Wout (largeurs du faisceau avant et après), decal (rayon central de sortie,
    vers la gauche de la lumière), i2 (angle de sortie sur la normale), e et s (bords du faisceau sur les deux faces)."""
    S, N = geom_prisme(cfg)
    DC = app(cfg, "DC")
    out = []
    for k in range(3):
        A, B = S[k], S[(k + 1) % 3]
        c0 = N[k][0]                                   # N·d0, d0 = (1, 0)
        if c0 >= 0:
            continue
        ya, yb = max(min(A[1], B[1]), -DC / 2), min(max(A[1], B[1]), DC / 2)
        if yb <= ya:
            continue
        d1 = refracter([1.0, 0.0], N[k], 1 / n)
        n1 = [-d1[1], d1[0]]
        ta = _sc(_pt(A, B, (ya - A[1]) / (B[1] - A[1])), n1)
        tb = _sc(_pt(A, B, (yb - A[1]) / (B[1] - A[1])), n1)
        t0, t1 = min(ta, tb), max(ta, tb)
        tA, tB = _sc(A, n1), _sc(B, n1)
        for j in range(3):
            if j == k:
                continue
            cj = _sc(N[j], d1)
            if cj <= 0:
                continue
            C, D = S[j], S[(j + 1) % 3]
            tC, tD = _sc(C, n1), _sc(D, n1)
            u0, u1 = max(t0, min(tC, tD)), min(t1, max(tC, tD))
            if u1 <= u0:
                continue
            d2 = refracter(d1, [-N[j][0], -N[j][1]], n)
            if d2 is None:
                continue
            ci1, cr1, ci2 = -c0, -_sc(N[k], d1), _sc(N[j], d2)
            sa, sb = _pt(C, D, (u0 - tC) / (tD - tC)), _pt(C, D, (u1 - tC) / (tD - tC))
            M = [(sa[0] + sb[0]) / 2, (sa[1] + sb[1]) / 2]
            out.append({"k": k, "j": j, "d": d2, "m": ci1 * cj / (cr1 * ci2),
                        "Win": (u1 - u0) * ci1 / cr1, "Wout": (u1 - u0) * ci2 / cj,
                        "decal": _sc(M, [-d2[1], d2[0]]),
                        "i2": math.atan2(N[j][0] * d2[1] - N[j][1] * d2[0], ci2),
                        "e": [_pt(A, B, (u0 - tA) / (tB - tA)), _pt(A, B, (u1 - tA) / (tB - tA))], "s": [sa, sb]})
    return out



def pupille_utile(h, dE, dC):
    """Intersection de la pupille de l'œil (diamètre dE, centre h = [hx, hy]) et du cercle oculaire (dC, centré).

    Renvoie T (aire / aire de la pupille de l'œil), centroïde [cx, cy] (d'où la parallaxe) et diamètre équivalent
    (flou de défocalisation). Segments de disque : aire r² acos(c/r) − c√(r² − c²), moment (2/3)(r² − c²)^(3/2).
    """
    rE, rC = dE / 2, dC / 2
    d = math.hypot(h[0], h[1])
    if d >= rE + rC:
        return {"T": 0.0, "c": [0.0, 0.0], "d": 0.0}
    if d <= abs(rC - rE):
        if rE <= rC:
            return {"T": 1.0, "c": [h[0], h[1]], "d": dE}
        return {"T": rC * rC / (rE * rE), "c": [0.0, 0.0], "d": dC}
    x1 = (d * d + rC * rC - rE * rE) / (2 * d)       # corde, depuis le centre du cercle oculaire
    x2 = d - x1                                       # corde, depuis le centre de l'œil (vers le cercle oculaire)
    q1, q2 = math.sqrt(rC * rC - x1 * x1), math.sqrt(rE * rE - x2 * x2)
    A1 = rC * rC * math.acos(x1 / rC) - x1 * q1
    A2 = rE * rE * math.acos(x2 / rE) - x2 * q2
    M1 = 2 / 3 * q1 ** 3
    M2 = 2 / 3 * q2 ** 3
    A = A1 + A2
    xc = (M1 + A2 * d - M2) / A
    return {"T": A / (math.pi * rE * rE), "c": [xc * h[0] / d, xc * h[1] / d], "d": 2 * math.sqrt(A / math.pi)}


def foyer(oe, Pcible):
    """Proximité vue nette par l'œil (§ 5). Modes : repos (PR, + myopie instrumentale mi), objet (il vise Pcible
    dans sa plage, sinon s'arrête à la borne), curseur (accommodation forcée acc ∈ [0, amplitude])."""
    R, amp = YEUX[oe["type"]]
    mode = oe.get("mode", "objet")
    if mode == "repos":
        return R + oe.get("mi", 0.0)
    if mode == "curseur":
        return R + max(0.0, min(amp, oe.get("acc", 0.0)))
    return max(R, min(R + amp, Pcible))


def vue(cfg):
    """Tout ce que voit l'œil : lunette, pupille utile, accommodation, puis chaque objet (direction vue du centroïde de
    la pupille utile, flou en x et en y, netteté, diffraction)."""
    L = lunette(cfg)
    objets = [reticule(cfg, L), retour(cfg, L)] + raies(cfg, L)
    oe = cfg["oeil"]
    pu = pupille_utile(oe.get("h", [0.0, 0.0]), oe.get("pupille", OEIL["pupille"]), L["cercle"])
    cible = next((o for o in objets if o["id"] == oe.get("cible", "reticule")), objets[0])
    Pf = foyer(oe, cible["Px"])
    R = YEUX[oe["type"]][0]
    pdc = OEIL["pdc"]
    Wpu = pu["d"] * L["Lt"] / L["e"]                  # pupille utile ramenée sur l'objectif
    for o in objets:
        o["X"] = o["X0"] - pu["c"][0] * o["Px"]
        o["Y"] = o["Y0"] - pu["c"][1] * o["Py"]
        o["flou_x"] = pu["d"] * abs(o["Px"] - Pf)       # diamètre angulaire apparent du disque de flou
        o["flou_y"] = pu["d"] * abs(o["Py"] - Pf)
        o["net"] = abs(o["Px"] - Pf) <= pdc / 2
        o["champ"] = abs(o["X"]) - o.get("largeur", 0.0) / 2 < L["champ"]
        if o["type"] == "raie":
            W = min(o["Wcap"], Wpu) if Wpu > 0 else 0.0
            o["diffraction"] = L["G"] * o["lam"] * 1e-9 / W if W > 0 else None   # 1er zéro, apparent
    return {"lunette": L, "pupille": pu, "Pf": Pf, "accommodation": Pf - R,
            "dans_plage": R - pdc / 2 <= cible["Px"] <= R + YEUX[oe["type"]][1] + pdc / 2,
            "acuite": OEIL["acuite"], "objets": objets}


def delta_de_P(cfg, P):
    """Plan (écart longitudinal au réticule, > 0 vers l'objectif) que l'œil voit net quand il est au point sur P :
    la « loupe du réticule » de « Voir la lumière » (§ 4). Inverse de P_point."""
    L = lunette(cfg)
    foc = app(cfg, "foc")
    V = transfert(-P, -L["e"])                       # vergence juste après l'oculaire
    d = 1 / (1 / foc - V)                            # point à d avant l'oculaire
    return d - L["doc"]


# ================= champ de la lunette : profils et éclairement (session 2b) =================
import app_michelson_reference as _mich   # noqa: E402  (module couleur partagé : cie, planck)

cie = _mich.cie   # queues rouge et violette corrigées dans le module couleur (référence Michelson)

LUM = {"retour": 0.25, "lueur": 0.05, "voile": 0.002, "lame": 0.5, "T_lampe": 2800.0, "lam_oeil": 550e-9, "reticule": 400.0}
# Unités absolues (lot R1) : éclairement rétinien en lux, même calcul que `echelle` et `facteurRetine` du cœur JS.
# Lampe du réticule (lot R5) : sa propre luminance LUM["reticule"] (cd/m², petite ampoule derrière un verre dépoli,
# vue par la lame semi-réfléchissante), indépendante de la lampe à raies : `facteur_lampe`.
F_OEIL, LUM_SOURCES = 0.017, {"Hg": "hgc", "Na": "na"}


def echelle(cfg):
    """cd/m² par unité de Y relatif (Y = Σ I ȳ) du spectre de la lampe."""
    if cfg.get("echelle") is not None:
        return cfg["echelle"]
    y = 0.0
    for l, i in (cfg.get("spectre") or SOURCES[cfg["lampe"]]):
        y += i * cie(l)[1]
    return _mich.luminance_source(LUM_SOURCES.get(cfg["lampe"], "cd")) / y


def facteur_lampe(cfg):
    """Éclairement rétinien (lx) par unité des poids de la lampe du réticule (retour, lueur, voile)."""
    p = cfg["oeil"]["pupille"] if cfg.get("oeil") and cfg["oeil"].get("pupille") else OEIL["pupille"]
    return LUM["reticule"] * math.pi * p * p / 4 / (F_OEIL * F_OEIL)


def facteur_retine(cfg):
    """Éclairement rétinien (lx) par unité de Y relatif : échelle × A_pupille / f_œil²."""
    p = cfg["oeil"]["pupille"] if cfg.get("oeil") and cfg["oeil"].get("pupille") else OEIL["pupille"]
    return echelle(cfg) * math.pi * p * p / 4 / (F_OEIL * F_OEIL)
GH_T = [0.0, 0.8162878828589647, -0.8162878828589647, 1.6735516287674714, -1.6735516287674714,
        2.6519613568352334, -2.6519613568352334]
GH_W = [0.8102646175568073, 0.4256072526101278, 0.4256072526101278, 0.05451558281912703, 0.05451558281912703,
        0.0009717812450995192, 0.0009717812450995192]
FWHM = 2.3548200450309493
FIL_PX = 1.2     # largeur affichée minimale d'un fil (pixels) : l'œil résout 1′, un pixel du champ entier en vaut 2,4


def erf_as(x):
    """erf d'Abramowitz-Stegun 7.1.26 (|erreur| < 1,5e-7), écrite de même en JS."""
    sg = 1.0 if x >= 0 else -1.0
    x = abs(x)
    t = 1 / (1 + 0.3275911 * x)
    y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * math.exp(-x * x)
    return sg * y


def cdf_disque(x, R):
    """Répartition du disque uniforme de rayon R projeté sur un axe."""
    if x <= -R:
        return 0.0
    if x >= R:
        return 1.0
    q = x / R
    return 0.5 + (q * math.sqrt(1 - q * q) + math.asin(q)) / math.pi


def noyau(x, R, s):
    """Répartition du noyau disque projeté (rayon R) ⊗ gaussienne (écart type s)."""
    st = math.sqrt(s * s + R * R / 4)
    lim = R + 7 * st
    if x <= -lim:
        return 0.0
    if x >= lim:
        return 1.0
    if R <= s:
        return 0.5 * (1 + erf_as(x / (st * math.sqrt(2))))
    t = 0.0
    for k in range(7):
        t += GH_W[k] * cdf_disque(x - math.sqrt(2) * s * GH_T[k], R)
    return t / math.sqrt(math.pi)


def couverture(x, c, w, R, s):
    """Part d'une bande [c − w/2, c + w/2] vue en x à travers le noyau (R, s)."""
    return noyau(x - c + w / 2, R, s) - noyau(x - c - w / 2, R, s)


def xyz_lampe():
    """Couleur de la lampe latérale (Planck), normalisée à Y = 1."""
    t = [0.0, 0.0, 0.0]
    for k in range(81):
        l = 380 + 5 * k
        w = _mich.planck(l, LUM["T_lampe"])
        c = cie(l)
        t[0] += w * c[0]
        t[1] += w * c[1]
        t[2] += w * c[2]
    return [t[0] / t[1], 1.0, t[2] / t[1]]


def preparer_champ(cfg, V, px):
    """Réduit la vue à ce que `xyz_champ` évalue ; px = angle apparent d'un pixel (rad)."""
    L, pu = V["lunette"], V["pupille"]
    T = pu["T"]
    s0 = (OEIL["acuite"] / FWHM) ** 2 + px * px / 12
    lame = LUM["lame"] if cfg.get("lampe_lunette") else 1.0
    ka, kl = facteur_retine(cfg), facteur_lampe(cfg)
    ob = {o["id"]: o for o in V["objets"]}
    diff_oeil = LUM["lam_oeil"] / pu["d"] if pu["d"] > 0 else 0.0

    def s_de(diff):
        return math.sqrt(s0 + (0.376 * diff) ** 2)

    def motif(o):
        return {"X": o["X"], "Y": o["Y"], "fil": max(o["fil"], FIL_PX * px), "R": o["flou_x"] / 2, "Ry": o["flou_y"] / 2,
                "s": s_de(diff_oeil), "xt": o["X"] + o["g"] * app(cfg, "repere"), "ht": abs(o["g"]) * app(cfg, "repere_h")}
    rt, rr = ob["reticule"], ob["retour"]
    la = xyz_lampe()
    bandes = []
    for o in V["objets"]:
        if o["type"] != "raie" or o["I"] <= 0 or not o["champ"]:
            continue
        c = cie(o["lam"])
        k = o["I"] * T * lame * ka
        bandes.append({"X": o["X"], "w": o["largeur"], "R": o["flou_x"] / 2, "s": s_de(o["diffraction"] or 0.0),
                       "xyz": [k * c[0], k * c[1], k * c[2]]})
    ret = None
    if rr["I"] > 0:
        k = LUM["retour"] * T * kl
        ret = {"disque": {"X": rr["X"], "Y": rr["Y"], "rho": abs(rr["g"]) * app(cfg, "champ") / 2,
                          "R": rr["flou_x"] / 2, "s": s_de(diff_oeil)},
               "motif": motif(rr), "xyz": [k * la[0], k * la[1], k * la[2]]}
    allume = bool(cfg.get("lampe_lunette"))
    return {"px": px, "bandes": bandes, "retour": ret, "reticule": motif(rt),
            "champ": {"X": rt["X"], "Y": rt["Y"], "rho": L["champ"], "R": rt["flou_x"] / 2, "s": s_de(diff_oeil)},
            "lueur": [LUM["lueur"] * T * kl * x for x in la] if allume else None,
            "voile": [LUM["voile"] * T * kl * x for x in la] if allume else None}


def couverture_motif(m, X, Y):
    cv = couverture(X, m["X"], m["fil"], m["R"], m["s"])
    ch = couverture(Y, m["Y"], m["fil"], m["Ry"], m["s"])
    ct = couverture(X, m["xt"], m["fil"], m["R"], m["s"]) * couverture(Y, m["Y"], 2 * m["ht"], m["Ry"], m["s"])
    return 1 - (1 - cv) * (1 - ch) * (1 - ct)


def dans_disque(d, X, Y):
    return noyau(d["rho"] - math.hypot(X - d["X"], Y - d["Y"]), d["R"], d["s"])


def xyz_champ(pr, X, Y):
    """Éclairement XYZ au point (X, Y) du champ apparent (rad ; X à droite, Y en haut)."""
    lum = [0.0, 0.0, 0.0]
    for b in pr["bandes"]:
        c = couverture(X, b["X"], b["w"], b["R"], b["s"])
        for j in range(3):
            lum[j] += c * b["xyz"][j]
    if pr["retour"]:
        r = pr["retour"]
        k = dans_disque(r["disque"], X, Y) * (1 - couverture_motif(r["motif"], X, Y))
        for j in range(3):
            lum[j] += k * r["xyz"][j]
    if pr["voile"]:
        for j in range(3):
            lum[j] += pr["voile"][j]
    cr = couverture_motif(pr["reticule"], X, Y)
    m = dans_disque(pr["champ"], X, Y)
    for j in range(3):
        lum[j] = (lum[j] * (1 - cr) + (pr["lueur"][j] * cr if pr["lueur"] else 0.0)) * m
    return lum


def points_champ(pr):
    """Points d'échantillonnage des contrôles : grille + bords de chaque objet."""
    rho = pr["champ"]["rho"]
    pts = [(rho * (i / 3 - 1) * 1.05, rho * (j / 3 - 1) * 1.05) for i in range(7) for j in range(7)]
    for b in pr["bandes"]:
        for dx in (0.0, b["w"] / 2, b["w"] / 2 + b["R"], -b["w"] / 2 - 2 * b["s"]):
            pts.append((b["X"] + dx, 0.3 * rho))
    for m in [pr["reticule"]] + ([pr["retour"]["motif"]] if pr["retour"] else []):
        pts += [(m["X"] + m["fil"] / 3, 0.2 * rho), (0.1 * rho, m["Y"] - m["fil"] / 4), (m["xt"], m["Y"] + 0.5 * m["ht"]),
                (m["X"], m["Y"])]
    if pr["retour"]:
        d = pr["retour"]["disque"]
        pts += [(d["X"] + 0.99 * d["rho"], d["Y"]), (d["X"] - d["rho"] - d["R"] / 2, d["Y"] + 0.1 * rho)]
    pts += [(pr["champ"]["X"] + rho + pr["champ"]["R"] / 3, pr["champ"]["Y"])]
    return pts


# ================= étage exact : tracé de rayons sur le réseau =================
def _norm(v):
    n = math.sqrt(sum(x * x for x in v))
    return [x / n for x in v]


def diffracte(k, n, t, p, lam, a):
    """Équation vectorielle du réseau (transmission) : composante sur t (⊥ aux traits) + pλ/a, sur les traits inchangée."""
    g = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]]
    kt = sum(x * y for x, y in zip(k, t)) + p * lam / a
    kg = sum(x * y for x, y in zip(k, g))
    kn = math.sqrt(1 - kt * kt - kg * kg)
    return [kn * n[j] + kt * t[j] + kg * g[j] for j in range(3)]


def foyers_exacts(psi, lam, p, R, a=APPAREIL["a"], h=2e-5):
    """Source ponctuelle à R en amont du réseau (R > 0 : faisceau divergent) dans la direction 0 ; rayons fins autour du
    centre, diffractés exactement. Renvoie (R'_t, R'_s) : distances (en amont, le long du rayon diffracté central) des
    sources virtuelles tangentielle (plan de dispersion) et sagittale (le long des traits), et θ."""
    n = [math.cos(psi), math.sin(psi), 0.0]
    t = [-math.sin(psi), math.cos(psi), 0.0]
    S = [-R, 0.0, 0.0]
    k0 = diffracte([1.0, 0.0, 0.0], n, t, p, lam, a)

    def rayon(q):                                    # point q du réseau (dans son plan)
        M = [q[0] * t[0], q[0] * t[1], q[1]]
        k = _norm([M[j] - S[j] for j in range(3)])
        return M, diffracte(k, n, t, p, lam, a)

    def croisement(M1, k1, M2, k2):
        """Distance le long de k0, depuis le centre, du point le plus proche des deux droites (moindres carrés)."""
        w = [M1[j] - M2[j] for j in range(3)]
        b = sum(x * y for x, y in zip(k1, k2))
        d1, d2 = sum(x * y for x, y in zip(k1, w)), sum(x * y for x, y in zip(k2, w))
        s1 = (b * d2 - d1) / (1 - b * b)
        P = [M1[j] + s1 * k1[j] for j in range(3)]
        return -sum(P[j] * k0[j] for j in range(3))
    Rt = croisement(*rayon([h, 0.0]), *rayon([-h, 0.0]))
    Rs = croisement(*rayon([0.0, h]), *rayon([0.0, -h]))
    return Rt, Rs, math.asin(-math.sin(psi) + p * lam / a)


# ================= cas de contrôle =================
def _cfg(**kw):
    c = {"u": 0.0, "eps": 0.0, "eC": 0.0, "phi": 0.0, "psi": 0.0, "b": 0.1e-3, "lampe": "Hg", "plateau": "reseau",
         "lampe_lunette": False, "diaph": None, "oeil": {"type": "normal", "mode": "objet", "cible": "reticule"}}
    c.update(kw)
    return c


def theta(lam, p, psi=0.0, a=APPAREIL["a"]):
    return math.asin(-math.sin(psi) + p * lam * 1e-9 / a)


def psi_min(lam, p, a=APPAREIL["a"]):
    """Orientation du réseau au minimum de déviation (θ = −i, soit sin ψ = pλ/2a)."""
    return math.asin(p * lam * 1e-9 / (2 * a))


def dev_min_prisme(lam):
    """Déviation minimale du prisme équilatéral : 2 asin(n sin 30°) − 60°."""
    return 2 * math.asin(indice_prisme({}, lam) / 2) - math.pi / 3


def dir_prisme(psi, lam):
    """Direction du trajet le plus large du prisme orienté à psi."""
    t = max(trajets_prisme(_cfg(plateau="prisme", psi=psi), indice_prisme({}, lam)), key=lambda t: t["Wout"])
    return math.atan2(t["d"][1], t["d"][0])


def cas_controle():
    Dp = dev_min_prisme(546.074)
    pm1 = psi_min(546.074, 1)
    t1 = theta(546.074, 1)
    oeil = lambda **k: dict({"type": "normal", "mode": "objet", "cible": "reticule"}, **k)
    return [
        ("autocollimation floue, miroir tourné", _cfg(u=3e-3, eps=1.2e-3, psi=4e-3, plateau="miroir", lampe_lunette=True)),
        ("autocollimation, l'œil vise l'image", _cfg(u=1e-3, eps=-0.4e-3, psi=-2e-3, plateau="miroir", lampe_lunette=True,
                                                     oeil=oeil(cible="retour", h=[0.4e-3, -0.2e-3]))),
        ("parallaxe, œil au bord du cercle", _cfg(u=0.6e-3, eps=0.3e-3, psi=1e-3, plateau="miroir", lampe_lunette=True,
                                                  oeil=oeil(type="myope", h=[2.6e-3, 0.5e-3]))),
        ("lunette réglée, presbyte au curseur", _cfg(u=-0.2e-3, plateau="miroir", lampe_lunette=True, psi=math.pi + 1e-4,
                                                     oeil=oeil(type="presbyte", mode="curseur", acc=0.7))),
        ("oculaire tiré, œil au repos", _cfg(u=-2e-3, eps=0.5e-3, plateau="miroir", lampe_lunette=True,
                                             oeil=oeil(type="hyper", mode="repos", mi=1.0))),
        ("visée directe de la fente, collimateur déréglé", _cfg(eC=0.6e-3, eps=-0.6e-3, plateau="rien", lampe="Na")),
        ("incidence normale, ordre 1", _cfg(phi=t1 + 3e-3, u=1e-3, oeil=oeil(cible="raie:546.074:1"))),
        ("incidence normale, ordre −2, collimateur déréglé", _cfg(phi=theta(546.074, -2) - 5e-3, eC=0.4e-3, eps=-0.4e-3,
                                                                 oeil=oeil(cible="raie:546.074:-2", h=[-0.5e-3, 0.0]))),
        ("minimum de déviation, ordre 1", _cfg(psi=pm1, phi=2 * pm1 + 1e-3, eC=0.4e-3, eps=-0.4e-3, b=0.05e-3)),
        ("doublet, ordre 2, fente fine, diaphragme", _cfg(lampe="Na", phi=theta(589.3, 2, 0.1) + 0.1, psi=0.1,
                                                          b=0.03e-3, diaph=1.5e-3, oeil=oeil(cible="raie:588.995:2"))),
        ("réseau incliné, faisceau vignetté", _cfg(psi=0.6, phi=0.6 + theta(435.833, 1, 0.6) + 2e-3, u=2e-3)),
        ("ordre 0, réseau retourné", _cfg(psi=math.pi - 0.2, phi=0.002, u=4e-3, oeil=oeil(mode="curseur", acc=3.0))),
        ("prisme, minimum de déviation", _cfg(plateau="prisme", psi=math.pi / 2 - Dp / 2, phi=-Dp + 1e-3, eC=0.3e-3,
                                              eps=-0.3e-3, oeil=oeil(cible="raie:546.074:P02"))),
        ("prisme tourné, sodium, faisceau partagé", _cfg(plateau="prisme", lampe="Na", psi=1.3, phi=dir_prisme(1.3, 588.995) - 2e-3,
                                                         u=1e-3, oeil=oeil(h=[0.3e-3, 0.0]))),
        # spectre fourni par l'instrument (cadmium, lampe inconnue, peigne du continu)
        ("spectre fourni, ordre 1", _cfg(lampe="Cd", spectre=[[480.0, 0.8], [508.6, 1.0], [508.9, 0.3], [643.8, 1.0]],
                                         phi=theta(508.6, 1) + 1e-3, oeil=oeil(cible="raie:508.6:1"))),
    ]


def _arrondir(x):
    if isinstance(x, float):
        return x
    if isinstance(x, dict):
        return {k: _arrondir(v) for k, v in x.items()}
    if isinstance(x, list):
        return [_arrondir(v) for v in x]
    return x


def generer_controles():
    out = {"appareil": APPAREIL, "oeil": OEIL, "yeux": YEUX, "eff": EFF, "sources": SOURCES, "lum": LUM, "cas": []}
    for nom, cfg in cas_controle():
        V = vue(cfg)
        px = V["lunette"]["champ"] / 228
        pr = preparer_champ(cfg, V, px)
        out["cas"].append({"nom": nom, "cfg": cfg, "vue": _arrondir(V), "px": px,
                           "delta_net": [[P, delta_de_P(cfg, P)] for P in (-1.0, 0.0, 2.5)],
                           "champ": [[X, Y] + xyz_champ(pr, X, Y) for X, Y in points_champ(pr)]})
    return out


# ================= vérifications chiffrées (SPEC § 1) =================
def verifications(sortie=print):
    res = []

    def ok(cond, titre, detail):
        res.append((bool(cond), titre, detail))
        sortie(("  ok    " if cond else "  ÉCHEC ") + titre + " — " + detail)

    foc, fL = APPAREIL["foc"], APPAREIL["fL"]
    pdc = OEIL["pdc"]

    def P_ret(u, eps=0.0):
        c = _cfg(u=u, eps=eps)
        return reticule(c, lunette(c))["Px"]

    def u_de_P(P, eps=0.0):                           # dichotomie : P croît avec u
        lo, hi = -0.02, 0.02
        for _ in range(200):
            mid = (lo + hi) / 2
            lo, hi = (mid, hi) if P_ret(mid, eps) < P else (lo, mid)
        return (lo + hi) / 2

    # --- point 1 : oculaire ---
    L0 = lunette(_cfg())
    ok(abs(L0["G"] - 7) < 1e-12 and abs(L0["cercle"] - 0.030 / 7) < 1e-12, "grossissement et cercle oculaire",
       "G = %.3f, cercle oculaire Ø %.2f mm, à %.2f mm de l'oculaire" % (L0["G"], L0["cercle"] * 1e3, L0["e"] * 1e3))
    lignes = []
    for t, (R, amp) in YEUX.items():
        u1, u2 = u_de_P(R - pdc / 2), u_de_P(R + amp + pdc / 2)
        lignes.append("%s : net pour u ∈ [%.2f ; %.2f] mm" % (t, u1 * 1e3, u2 * 1e3))
    u_n = u_de_P(-pdc / 2)
    ok(abs(u_n - (-pdc / 2) * foc ** 2) < 2e-6, "réticule net sur une plage de l'oculaire ; 1re netteté = PR",
       " ; ".join(lignes) + " (bornes basses : 1re netteté en enfonçant, image au PR à la profondeur de champ près)")
    um, un = u_de_P(2.0), u_de_P(0.0)
    ok(abs((um - un) - 2.0 * foc ** 2) < 0.03 * 2.0 * foc ** 2, "deux yeux, deux réglages d'oculaire",
       "myope −2 δ et emmétrope : %.2f mm d'écart (≈ 2 δ × foc² = %.2f mm)" % ((um - un) * 1e3, 2 * foc ** 2 * 1e3))
    ok(True, "myopie instrumentale (1 δ) : erreur de la méthode « regarder au loin puis entrer »",
       "oculaire enfoncé de %.2f mm de trop (image du réticule à 1 m)" % ((u_de_P(1.0) - un) * 1e3))

    # --- point 2 : autocollimation ---
    eps = 0.5e-3
    lig, pire = [], 0.0
    for D2 in (0.05, 0.12, 0.30):
        c = _cfg(eps=eps, plateau="miroir", appareil={"D2": D2})
        r = retour(c, lunette(c))
        pire = max(pire, abs(r["Delta"] - 2 * eps))
        lig.append("D2 = %.2f m : %.4f mm" % (D2, r["Delta"] * 1e3))
    ok(pire < 0.01 * eps, "image retour à 2ε du réticule, indépendante de la distance du miroir",
       "ε = 0,5 mm ; écart réticule-image " + ", ".join(lig) + " (dépendance en 2·D2·ε²/f'², ici < %.1f µm)" % (pire * 1e6))
    c = _cfg(psi=3e-3, plateau="miroir")
    L = lunette(c)
    r = retour(c, L)
    xi = r["X0"] / L["G"] * fL                       # position dans le plan du réticule (lunette réglée)
    ok(abs(xi - 2 * fL * 3e-3) < 1e-9, "miroir tourné de β → image décalée de 2f'β",
       "β = 3 mrad : %.4f mm (2f'β = %.4f mm), dans le champ tant que |β| < %.0f′" %
       (xi * 1e3, 2 * fL * 3e-3 * 1e3, APPAREIL["champ"] / 2 / (2 * fL) / ARCMIN))
    ok(abs(r["g"] / (L["G"] / L["zr"]) + 1) < 1e-12, "image retour retournée (grandissement −1)",
       "rapport des échelles image/réticule = %.6f" % (r["g"] / (L["G"] / L["zr"])))

    # --- point 3 : parallaxe ---
    def rel(eps, h, u=1e-3):
        c = _cfg(u=u, eps=eps, plateau="miroir", lampe_lunette=True, oeil={"type": "normal", "mode": "objet", "h": [h, 0.0]})
        v = vue(c)
        o = {x["id"]: x for x in v["objets"]}
        return o["retour"]["X"] - o["reticule"]["X"]
    d = rel(0.2e-3, 0.5e-3) - rel(0.2e-3, 0.0)
    ok(d > 0, "sens de la parallaxe",
       "réticule trop loin de l'objectif (ε > 0) : l'image retour SUIT l'œil (%.2f′ pour 0,5 mm d'œil, ε = 0,2 mm) "
       "→ rapprocher le réticule de l'objectif ; elle va contre l'œil si ε < 0" % (d / ARCMIN))
    ok(all(abs(rel(0.0, 0.5e-3, u) - rel(0.0, 0.0, u)) < 1e-15 for u in (-2e-3, 0.0, 1e-3, 4e-3)),
       "le réglage de la lunette ne dépend pas de l'œil", "ε = 0 : aucune parallaxe, quel que soit l'oculaire")
    e_tol = pdc * foc ** 2 / 2
    c1 = _cfg(eps=e_tol, plateau="miroir")
    L1 = lunette(c1)
    dP = reticule(c1, L1)["Px"] - retour(c1, L1)["Px"]
    ok(abs(dP - pdc) < 0.01 * pdc, "tolérance « nets ensemble » (profondeur de champ 0,25 δ)",
       "ε = %.3f mm ; parallaxe pour l'œil promené sur tout le cercle oculaire (±%.1f mm) : %.2f′ apparentes" %
       (e_tol * 1e3, (L1["cercle"] - OEIL["pupille"]) / 2 * 1e3, dP * (L1["cercle"] - OEIL["pupille"]) / ARCMIN))

    # --- point 4 : réseau, vergence, contre le tracé exact ---
    lig, pire = [], 0.0
    for psi, lam, p in ((0.0, 546.074, 1), (0.0, 546.074, 2), (0.0, 589.3, 2), (0.25, 435.833, -1),
                        (psi_min(546.074, 2), 546.074, 2)):
        R = 1.5
        Rt, Rs, th = foyers_exacts(psi, lam * 1e-9, p, R)
        fx = R / Rt                                    # facteur sur la vergence (|V| = 1/R)
        m2 = (math.cos(psi) / math.cos(th)) ** 2
        pire = max(pire, abs(fx - m2) / m2, abs(R / Rs - 1))
        lig.append("ψ = %.1f°, %g nm, p = %d : %.4f (m² = %.4f), le long des traits %.6f" % (psi / DEG, lam, p, fx, m2, R / Rs))
    ok(pire < 1e-4, "vergence × (cos i/cos θ)² dans le plan de dispersion, × 1 le long des traits (tracé exact)",
       " ; ".join(lig))
    di = 1e-6
    th_a, th_b = theta(546.074, 2, -di), theta(546.074, 2, di)
    ana = (th_b - th_a) / (2 * di)                    # dθ/dψ ; i = −ψ donc dθ/di = −dθ/dψ
    ok(abs(-ana - 1 / math.cos(theta(546.074, 2))) < 1e-6, "anamorphose dθ/di = cos i/cos θ",
       "incidence normale, ordre 2 à 546 nm : %.4f" % (-ana))
    lig = ["%g nm : facteur %.3f" % (lam, 1 / math.cos(theta(lam, 2)) ** 2) for lam in (546.074, 589.3)]
    c = _cfg(eC=0.4e-3, eps=-0.4e-3)
    L = lunette(c)
    ob = {o["id"]: o for o in raies(c, L)}
    P0 = ob["raie:546.074:0"]["Px"] - reticule(c, L)["Px"]
    P2 = ob["raie:546.074:2"]["Px"] - reticule(c, L)["Px"]
    P2y = ob["raie:546.074:2"]["Py"] - reticule(c, L)["Px"]
    P2_th = -(1 / math.cos(theta(546.074, 2)) ** 2 - 1) * 0.4e-3 / foc ** 2
    ok(abs(P0) < 0.02 and abs(P2 / P2_th - 1) < 0.03 and abs(P2y) < 0.02, "collimateur déréglé : ordre 0 net, ordre 2 flou",
       "fente à 0,4 mm du foyer, lunette au point sur l'ordre 0 : écart de vergence %.3f δ (ordre 0), %.3f δ (ordre 2, "
       "plan de dispersion ; −(m² − 1)·eC/foc² = %.3f δ), %.3f δ (le long des traits), flou %.1f′ apparentes pour une "
       "pupille de 3 mm ; facteur en incidence normale : %s" %
       (P0, P2, P2_th, P2y, abs(P2) * OEIL["pupille"] / ARCMIN, ", ".join(lig)))
    pm = psi_min(546.074, 2)
    c = _cfg(psi=pm, phi=2 * pm, eC=0.4e-3, eps=-0.4e-3)
    L = lunette(c)
    ob = {o["id"]: o for o in raies(c, L)}
    ok(abs(ob["raie:546.074:2"]["m"] - 1) < 1e-12 and abs(ob["raie:546.074:2"]["Px"] - reticule(c, L)["Px"]) < 0.02,
       "au minimum de déviation, facteur 1 : la raie aussi nette que l'ordre 0",
       "ordre 2, 546 nm : m = %.6f, écart de vergence %.3f δ" % (ob["raie:546.074:2"]["m"], ob["raie:546.074:2"]["Px"] - reticule(c, L)["Px"]))

    # --- point 5 : minimum de déviation ---
    Dm = [2 * psi_min(546.074, p) / DEG for p in (1, 2)]
    ok(abs(Dm[0] - 18.86) < 0.005 and abs(Dm[1] - 38.25) < 0.005, "D_m à 546 nm",
       "ordre 1 : %.2f°, ordre 2 : %.2f°" % tuple(Dm))
    lig = []
    for p in (1, 2):
        pm = psi_min(546.074, p)
        Dmin = pm + theta(546.074, p, pm)
        for dpsi in (1, 5):
            dD = (pm + dpsi * DEG + theta(546.074, p, pm + dpsi * DEG)) - Dmin
            lig.append("ordre %d, réseau à %d° : +%.1f′" % (p, dpsi, dD / ARCMIN))
    ok(True, "minimum plat (écart quadratique en l'angle du réseau)", " ; ".join(lig))

    # prisme : minimum de déviation retrouvé par le tracé, faisceau ni élargi ni grandi au minimum
    n = indice_prisme({}, 546.074)
    best = None
    for i in range(-3600, 3601):
        c = _cfg(plateau="prisme", psi=i * math.pi / 3600)
        for t in trajets_prisme(c, n):
            D = abs(math.atan2(t["d"][1], t["d"][0]))
            if best is None or D < best[0]:
                best = (D, t)
    Dp = dev_min_prisme(546.074)
    ok(abs(best[0] - Dp) < 1e-6 and abs(best[1]["m"] - 1) < 1e-3 and abs(best[1]["Win"] / best[1]["Wout"] - 1) < 1e-3,
       "prisme : minimum de déviation par le tracé",
       "n(546) = %.4f, D_m = %.3f° (formule %.3f°), m = %.4f" % (n, best[0] / DEG, Dp / DEG, best[1]["m"]))

    # --- point 6 : doublet du sodium ---
    l1, l2 = 588.995, 589.592
    sep = [(theta(l2, p) - theta(l1, p)) / ARCMIN for p in (1, 2)]
    fente = 0.1e-3 / APPAREIL["fC"] / ARCMIN
    m1 = 1 / math.cos(theta(589.3, 1))
    b_lim = sep[0] * ARCMIN / m1 * APPAREIL["fC"]
    b_gap = (sep[0] * ARCMIN - OEIL["acuite"] / 7) / m1 * APPAREIL["fC"]
    N = APPAREIL["DC"] / APPAREIL["a"]
    ok(abs(sep[0] - 1.32) < 0.01 and abs(sep[1] - 3.48) < 0.01 and abs(fente - 1.96) < 0.01,
       "doublet du sodium et largeur de fente",
       "séparation %.2f′ (ordre 1), %.2f′ (ordre 2) en incidence normale ; fente de 0,1 mm : %.2f′ ; ordre 1 : images "
       "disjointes sous %.3f mm de fente, intervalle sombre plus large que l'acuité sous %.3f mm ; fente de 0,04 mm vue "
       "sous %.2f mrad dans l'oculaire ; N = %.0f traits sur 30 mm, R requis = λ/Δλ = %.0f" %
       (sep[0], sep[1], fente, b_lim * 1e3, b_gap * 1e3, 7 * 0.04e-3 / APPAREIL["fC"] * 1e3, N, 589.3 / (l2 - l1)))

    # --- point 7 : incidence normale par symétrie des ordres ±p ---
    lig = []
    for p in (1, 2):
        dpsi = 1e-5
        asym = lambda ps: (ps + theta(546.074, p, ps) + ps + theta(546.074, -p, ps)) / 2
        k = (asym(dpsi) - asym(-dpsi)) / (2 * dpsi)
        k_th = 1 - 1 / math.cos(theta(546.074, p))
        lig.append("ordre %d : (φ₊+φ₋)/2 = %.3f ψ (1 − 1/cos θ = %.3f) → ψ à %.0f′ près pour 1′ d'asymétrie" %
                   (p, k, k_th, 1 / abs(k)))
        ok(abs(k - k_th) < 1e-6, "asymétrie des ordres ±%d du premier ordre en ψ" % p, lig[-1])
    pm = 0.5 * DEG
    d0 = theta(546.074, 1, 0) - theta(546.074, -1, 0)
    dpm = theta(546.074, 1, pm) - theta(546.074, -1, pm)
    ok(True, "écart φ₊ − φ₋ : second ordre en ψ", "réseau à 30′ de l'incidence normale : %.2f′ sur 2θ₁ (ordre 1)" %
       ((dpm - d0) / ARCMIN))

    # --- loupe du réticule : plan vu net ---
    c = _cfg(u=1.5e-3, eps=0.3e-3, plateau="miroir")
    L = lunette(c)
    rt, rr = reticule(c, L), retour(c, L)
    e1, e2 = delta_de_P(c, rt["Px"]), delta_de_P(c, rr["Px"]) - rr["Delta"]
    ok(abs(e1) < 1e-12 and abs(e2) < 1e-12, "plan vu net (loupe du réticule) cohérent avec les vergences",
       "réticule %.1e m, image retour %.1e m" % (e1, e2))
    # vignettage : faisceau diffracté plus large que l'objectif de la lunette quand |θ| < |i|
    c = _cfg(psi=0.6, phi=0.6 + theta(435.833, 1, 0.6))
    o = next(x for x in raies(c, lunette(c)) if x["id"] == "raie:435.833:1")
    ok(abs(o["Wcap"] - APPAREIL["DL"]) < 1e-12 and o["I"] < dict(SOURCES["Hg"])[435.833] * EFF[1], "vignettage par l'objectif de la lunette",
       "ψ = 34°, ordre 1 à 436 nm : faisceau de %.1f mm, %.1f mm captés" %
       (APPAREIL["DC"] / math.cos(0.6) * math.cos(o["theta"]) * 1e3, o["Wcap"] * 1e3))
    # --- profils du champ (session 2b) ---
    import numpy as np
    pire = 0.0
    for R, s in ((0.0, 2e-4), (1e-4, 3e-4), (6e-4, 2e-4), (3e-3, 1e-4)):
        xs = np.linspace(-(R + 8 * s + 1e-4), R + 8 * s + 1e-4, 40001)
        ker = np.zeros_like(xs)
        dx = xs[1] - xs[0]
        # convolution numérique disque projeté ⊗ gaussienne
        g = np.exp(-0.5 * (xs / s) ** 2)
        g /= g.sum()
        d = np.where(np.abs(xs) < R, np.sqrt(np.maximum(R * R - xs ** 2, 0)), 0.0) if R > 0 else (np.abs(xs) < dx / 2) * 1.0
        d /= d.sum()
        ker = np.convolve(d, g, mode="same")
        cdf = np.cumsum(ker)
        an = np.array([noyau(x, R, s) for x in xs[::400]])
        pire = max(pire, float(np.max(np.abs(an - cdf[::400]))))
    ok(pire < 0.03, "noyau des profils (disque projeté ⊗ gaussienne) contre une convolution numérique",
       "écart maximal sur la répartition : %.3f (quadrature de Gauss-Hermite et bascule gaussienne à R = s)" % pire)
    c = _cfg(b=0.2e-3, phi=theta(546.074, 1))
    V = vue(c)
    pr = preparer_champ(c, V, V["lunette"]["champ"] / 228)
    b = next(x for x in pr["bandes"] if abs(x["X"]) < 1e-3)
    tot = sum(couverture(x, b["X"], b["w"], b["R"], b["s"]) for x in np.linspace(b["X"] - 0.02, b["X"] + 0.02, 20001)) * 0.04 / 20000
    ok(abs(tot / b["w"] - 1) < 1e-4 and abs(couverture(b["X"], b["X"], b["w"], b["R"], b["s"]) - 1) < 1e-3,
       "une raie large et nette : luminance pleine, flux = largeur", "∫C = %.5f w ; C(centre) = %.5f" %
       (tot / b["w"], couverture(b["X"], b["X"], b["w"], b["R"], b["s"])))

    # --- pupille utile : contrôles de cohérence ---
    pu = pupille_utile([1.2e-3, 0.9e-3], 3e-3, 30 / 7 * 1e-3)
    import random
    rnd = random.Random(3)
    rE, rC, hx, hy = 1.5e-3, 15 / 7 * 1e-3, 1.2e-3, 0.9e-3
    n_in, sx, sy = 0, 0.0, 0.0
    for _ in range(400000):
        x, y = rnd.uniform(-rE, rE) + hx, rnd.uniform(-rE, rE) + hy
        if (x - hx) ** 2 + (y - hy) ** 2 < rE * rE and x * x + y * y < rC * rC:
            n_in, sx, sy = n_in + 1, sx + x, sy + y
    T_mc = n_in / 400000 * 4 / math.pi
    ok(abs(pu["T"] - T_mc) < 0.01 and abs(pu["c"][0] - sx / n_in) < 2e-5 and abs(pu["c"][1] - sy / n_in) < 2e-5,
       "pupille utile (intersection de disques) contre Monte-Carlo",
       "œil à 1,5 mm de l'axe : T = %.3f (MC %.3f), centroïde (%.3f, %.3f) mm" % (pu["T"], T_mc, pu["c"][0] * 1e3, pu["c"][1] * 1e3))
    return res


def main():
    if "--ecrire" in sys.argv:
        CONTROLES.write_text(json.dumps(generer_controles(), indent=1, ensure_ascii=False) + "\n")
        print("écrit", CONTROLES)
        return
    res = verifications()
    n_ok = sum(1 for r in res if r[0])
    print("%d/%d vérifications" % (n_ok, len(res)))
    sys.exit(0 if n_ok == len(res) else 1)


if __name__ == "__main__":
    main()
