#!/usr/bin/env python3
# Créé par Claude
"""Référence Python du moteur Michelson (_app-michelson-coeur.js).

Deux étages :
  1. PARAXIAL — même algorithme que le cœur JS, opération pour opération (hash32/u4, spectres stratifiés, spirale de
     Vogel, `trajet`, `trace`, `bras`, `point_source`, `preparer`, `evaluer`) : le test de concordance rejoue
     app_michelson_controles.json avec le JS (δ à 1e-10 m, éclairement à 1e-9 relatif).
  2. EXACT (non paraxial) — δ par la géométrie exacte : images S'₁, S'₂ du point source (après des lentilles
     d'entrée parfaites) par les plans M1 (z = 0) et M2* (z = e + ax x + ay y), différence de chemins par
     différence de carrés ; lentille de sortie parfaite : plan focal → δ = (S'₁ − S'₂)·û, conjugaison finie →
     δ = |S'₂A| − |S'₁A| au point objet A ; onde plane incidente (source au foyer du collimateur) :
     chemin v_k·M + (v − v_k)·Q_k. Sert à chiffrer l'erreur de l'approximation de Fresnel du modèle.
  + vérifications physiques chiffrées (SPEC § 9) : r_n = f'√(nλ/e), interfrange λ/2α × grandissement, période du
    contraste au doublet λ²/2Δλ, brouillage au mercure vers ℓc, localisation (contraste écran nu < plan focal),
    écran collé à la lentille sans moiré.

Usage :
    python3 app_michelson_reference.py            # vérifications physiques + écarts paraxial / exact
    python3 app_michelson_reference.py --ecrire   # régénère app_michelson_controles.json (jamais édité à la main)
"""
import json
import math
import sys
from pathlib import Path

import numpy as np

ICI = Path(__file__).resolve().parent
SRC = (ICI / ".." / "src").resolve()
CONTROLES = ICI / "app_michelson_controles.json"
M32 = 0xFFFFFFFF
ARM = 0.130                     # bras de l'appareil (m), séparatrice → miroir


# ================= hasard à graine =================
def hash32(x):
    x &= M32
    x = ((x ^ (x >> 16)) * 0x7FEB352D) & M32
    x = ((x ^ (x >> 15)) * 0x846CA68B) & M32
    return (x ^ (x >> 16)) & M32


def u4(g, p, k, j):
    return hash32(hash32(hash32(hash32(g) ^ (p & M32)) ^ (k & M32)) ^ (j & M32)) / 4294967296


def erfinv(x):
    w = -math.log((1 - x) * (1 + x))
    if w < 5:
        w -= 2.5
        p = 2.81022636e-08
        for c in (3.43273939e-07, -3.5233877e-06, -4.39150654e-06, 0.00021858087, -0.00125372503,
                  -0.00417768164, 0.246640727, 1.50140941):
            p = c + p * w
    else:
        w = math.sqrt(w) - 3
        p = -0.000200214257
        for c in (0.000100950558, 0.00134934322, -0.00367342844, 0.00573950773, -0.0076224613,
                  0.00943887047, 1.00167406, 2.83297682):
            p = c + p * w
    return p * x


# ================= couleur et spectres =================
def _g1(l, mu, s1, s2):
    t = (l - mu) / (s1 if l < mu else s2)
    return math.exp(-0.5 * t * t)


def cie_fit(l):
    """Approximation de Wyman, Sloan et Shirley (2013) des fonctions CIE 1931, fausse dans les queues : cf. `cie`."""
    return [1.056 * _g1(l, 599.8, 37.9, 31.0) + 0.362 * _g1(l, 442.0, 16.0, 26.7) - 0.065 * _g1(l, 501.1, 20.4, 26.2),
            0.821 * _g1(l, 568.8, 46.9, 40.5) + 0.286 * _g1(l, 530.9, 16.3, 31.1),
            1.217 * _g1(l, 437.0, 11.8, 36.0) + 0.681 * _g1(l, 459.0, 26.0, 13.8)]


CIE_V410, CIE_Y425, CIE_R650 = 0.2400237446254625, 0.007351557355164084, 2.5824952544821675


def _lisse(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def cie(l):
    """cie_fit aux queues corrigées, même calcul que `cie` du cœur JS (le pourquoi y est écrit).

    Rouge > 650 nm : x̄/ȳ ramené vers 2,77 en 40 nm ; violet < 410 nm : x̄/z̄ vers 0,21 en 30 nm ; violet < 425 nm :
    ȳ/z̄ vers 0,0059 en 15 nm. Raccords continus aux valeurs de l'approximation (CIE_V410, CIE_Y425, CIE_R650)."""
    c = cie_fit(l)
    if l < 425:
        c[1] = c[2] * (CIE_Y425 + (0.0059 - CIE_Y425) * _lisse((425 - l) / 15))
    if l < 410:
        c[0] = c[2] * (CIE_V410 + (0.21 - CIE_V410) * _lisse((410 - l) / 30))
    elif l > 650:
        c[0] = c[1] * (CIE_R650 + (2.77 - CIE_R650) * _lisse((l - 650) / 40))
    return c


def planck(lnm, T):
    l = lnm * 1e-9
    return 1 / (l ** 5 * (math.exp(1.4388e-2 / (l * T)) - 1))


FWHM_SIGMA = 2.3548200450309493
SPECTRES = {
    "na": {"raies": [{"l": 588.995, "poids": 1.2}, {"l": 589.592, "poids": 1}], "profil": "gauss", "largeur": 0.012, "lmoy": 589.3},
    "hg": {"raies": [{"l": 546.1, "poids": 1}], "profil": "gauss", "largeur": 1.0, "lmoy": 546.1},
    "hgb": {"raies": [{"l": 546.1, "poids": 1}], "profil": "gauss", "largeur": 0.002, "lmoy": 546.1},
    "hgc": {"raies": [{"l": l, "poids": w, "largeur": 1.0 * (l / 546.1) * (l / 546.1)}
                      for l, w in ((404.656, 0.5), (407.783, 0.05), (435.833, 1), (491.604, 0.03), (546.074, 0.8), (576.960, 0.12), (579.066, 0.12))],
            "profil": "gauss", "lmoy": 500},
    "hgcb": {"raies": [{"l": l, "poids": w, "largeur": 0.002 * (l / 546.1) * (l / 546.1)}
                      for l, w in ((404.656, 0.5), (407.783, 0.05), (435.833, 1), (491.604, 0.03), (546.074, 0.8), (576.960, 0.12), (579.066, 0.12))],
            "profil": "gauss", "lmoy": 500},
    "bl": {"continu": [400, 700], "T": 3200, "lmoy": 550},
    "laser": {"raies": [{"l": 632.8, "poids": 1}], "profil": "mono", "lmoy": 632.8},
    "laserVert": {"raies": [{"l": 532, "poids": 1}], "profil": "mono", "lmoy": 532},
}


def spectre_de(sp):
    return SPECTRES[sp] if isinstance(sp, str) else sp


# Luminances typiques des sources (cd/m²) : même table que `luminanceSource` du cœur JS (le pourquoi y est écrit).
LUMINANCES = {"bl": 2.5e7, "na": 1e5, "hgc": 2e6, "hgb": 1e5, "hgcb": 1e5, "cd": 1e5}
T_FILTRE_VERT, P_LASER = 0.6, 1e-3


def part_y_raie(sp, l):
    ptot = sum(r["poids"] for r in sp["raies"])
    best = min(range(len(sp["raies"])), key=lambda i: abs(sp["raies"][i]["l"] - l))
    Y = sum(r["poids"] / ptot * cie(r["l"])[1] for r in sp["raies"])
    return sp["raies"][best]["poids"] / ptot * cie(sp["raies"][best]["l"])[1] / Y


def luminance_source(nom):
    if nom == "hg":
        return LUMINANCES["hgc"] * part_y_raie(SPECTRES["hgc"], 546.1) * T_FILTRE_VERT
    if nom == "hgb":
        return LUMINANCES["hgb"] * T_FILTRE_VERT
    if nom == "hgcb":
        return LUMINANCES["hgcb"]
    return LUMINANCES[nom]


def flux_laser(l=632.8):
    return 683 * cie(l)[1] * P_LASER


def lambda_raie(r, prof, larg, uu):
    if prof == "gauss":
        uu = min(1 - 1e-6, max(1e-6, uu))
        return r["l"] + larg / FWHM_SIGMA * math.sqrt(2) * erfinv(2 * uu - 1)
    if prof == "rect":
        return r["l"] + (uu - 0.5) * larg
    return r["l"]


def tirage(sp, M):
    """Éléments spectraux (`tirage` du cœur) : [{l, w, W, V, kappa, rho}] ; raies intégrées exactement (enveloppe),
    continu en bandes de nombre d'onde (`bandes`)."""
    if "continu" in sp:
        return bandes(sp, M)
    out = []
    ptot = sum(r["poids"] for r in sp["raies"])
    for r in sp["raies"]:
        l0, kap, rho = r["l"] * 1e-9, 0.0, 0.0
        larg = r["largeur"] if r.get("largeur") is not None else sp.get("largeur")
        c, w = cie(r["l"]), r["poids"] / ptot
        if sp["profil"] == "gauss":
            sg = larg / FWHM_SIGMA * 1e-9 / (l0 * l0)
            kap = 2 * math.pi * math.pi * sg * sg
        elif sp["profil"] == "rect":
            rho = math.pi * larg * 1e-9 / (l0 * l0)
        out.append({"l": r["l"], "w": w, "W": [w * c[0], w * c[1], w * c[2]], "V": [0.0, 0.0, 0.0], "kappa": kap, "rho": rho})
    return out


_BANDES = {}


def bandes(sp, M):
    """M bandes égales en nombre d'onde, densité affine (`bandes` du cœur, le pourquoi y est écrit)."""
    cle = json.dumps(sp, sort_keys=True) + "|%d" % M
    if cle in _BANDES:
        return _BANDES[cle]
    s0, s1 = 1e9 / sp["continu"][1], 1e9 / sp["continu"][0]
    h, NS = (s1 - s0) / (2 * M), 32

    def dens(sg):
        l = 1e9 / sg
        w = planck(l, sp["T"]) * l * l * 1e-18
        c = cie(l)
        return [w * c[0], w * c[1], w * c[2], w]
    out, tot, P = [], [0.0, 0.0, 0.0], 0.0
    for j in range(M):
        sc = s0 + (2 * j + 1) * h
        W, p, dl, dr = [0.0, 0.0, 0.0], 0.0, dens(sc - h), dens(sc + h)
        for i in range(NS):
            d = dens(sc - h + (i + 0.5) / NS * 2 * h)
            for k in range(3):
                W[k] += d[k]
            p += d[3]
        for k in range(3):
            W[k] *= 2 * h / NS
            tot[k] += W[k]
        p *= 2 * h / NS
        P += p
        out.append({"l": 1e9 / sc, "w": p, "W": W, "V": [h * (dr[k] - dl[k]) for k in range(3)], "kappa": 0.0, "rho": 2 * math.pi * h})
    xyz = xyz_spectre(sp)
    for o in out:
        o["w"] /= P
        for k in range(3):
            f = xyz[k] / tot[k]
            o["W"][k] *= f
            o["V"][k] *= f
    _BANDES[cle] = out
    return out


def terme(L, dd, dt, t, g2):
    """[env sinc cos Φ, env j₁ sin Φ, env sinc sin Φ, env j₁ cos Φ] (`terme` du cœur)."""
    e = dt + L["g"][t]
    env = math.exp(-g2 * L["inv"] * L["inv"] - L["kappa"] * e * e)
    sn, jj = 1.0, 0.0
    if L["rho"] > 0:
        x = L["rho"] * e
        if abs(x) < 0.05:
            sn, jj = 1 - x * x / 6, x / 3 - x * x * x / 30
        else:
            sx, cx = math.sin(x), math.cos(x)
            sn, jj = sx / x, (sx - x * cx) / (x * x)
    ph = 2 * math.pi * (L["ph"][t] + dd * L["inv"])
    cp, spp = math.cos(ph) * env, math.sin(ph) * env
    return [sn * cp, jj * spp, sn * spp, jj * cp]


def enveloppe(kappa, rho, d):
    v = math.exp(-kappa * d * d)
    if rho > 0:
        x = rho * d
        v *= 1 if abs(x) < 1e-8 else math.sin(x) / x
    return v


def xyz_spectre(sp):
    n = 4096
    t = [0.0, 0.0, 0.0]
    if "continu" in sp:
        tot = 0.0
        for s in range(n):
            l = sp["continu"][0] + (s + 0.5) / n * (sp["continu"][1] - sp["continu"][0])
            w = planck(l, sp["T"])
            c = cie(l)
            t = [t[0] + w * c[0], t[1] + w * c[1], t[2] + w * c[2]]
            tot += w
        return [t[0] / tot, t[1] / tot, t[2] / tot]
    ptot = sum(r["poids"] for r in sp["raies"])
    for r in sp["raies"]:
        c = cie(r["l"])
        ww = r["poids"] / ptot
        t = [t[0] + ww * c[0], t[1] + ww * c[1], t[2] + ww * c[2]]
    return t


OR = math.pi * (3 - math.sqrt(5))


def points_source(R, N, g, p):
    if not R > 0:
        return [(0.0, 0.0)]
    rot = 2 * math.pi * u4(g, p, 0x7FFFFFFF, 1)
    out = []
    nb = int(math.floor(2 * math.sqrt(N) + 0.5)) if N >= 16 else 0   # anneau au bord (cf. pointsSource du cœur)
    Ni, Rb = N - nb, R * math.sqrt(1 - nb / (2 * N))
    for k in range(N):
        r = R * math.sqrt((k + u4(g, p, k, 2)) / N) if k < Ni else Rb
        th = k * OR + rot
        out.append((r * math.cos(th), r * math.sin(th)))
    return out


def dans_forme(forme, x, y):
    if not forme:
        return True
    for f in forme:
        if f["t"] == "rect" and f["x0"] <= x <= f["x1"] and f["y0"] <= y <= f["y1"]:
            return True
        if f["t"] == "ell":
            u, v = (x - f["cx"]) / f["a"], (y - f["cy"]) / f["b"]
            if u * u + v * v <= 1:
                return True
        if f["t"] == "anneau":   # secteur d'anneau : r0 ≤ r ≤ r1, angle atan2 dans [a0, a1]
            dx, dy = x - f["cx"], y - f["cy"]
            r2, an = dx * dx + dy * dy, math.atan2(dy, dx)
            if f["r0"] ** 2 <= r2 <= f["r1"] ** 2 and f["a0"] <= an <= f["a1"]:
                return True
    return False


# ================= modèle paraxial (copie du cœur JS) =================
def _fini(R):
    return R is not None and R > 0 and math.isfinite(R)


# ================= lames de verre (copie du cœur JS) =================
VERRES = {"bk7": {"A": 1.5046, "B": 4.20e-15}, "d263": {"A": 1.5089, "B": 4.96e-15}}


def indice(verre, lnm):
    v = VERRES[verre] if isinstance(verre, str) else verre
    l = lnm * 1e-9
    return v["A"] + v["B"] / (l * l)


def chemin_lame(t, n, c):
    return t * (math.sqrt(n * n - 1 + c * c) - c)


R2 = math.sqrt(0.5)
NSEP = [R2, -R2, 0.0]
SEG = {
    "entree": [[0, -1, 0], [-1, 0, 0], [0, 0, 1]], "retour2": [[0, 1, 0], [-1, 0, 0], [0, 0, 1]],
    "aller1": [[-1, 0, 0], [0, -1, 0], [0, 0, 1]], "sortie": [[1, 0, 0], [0, -1, 0], [0, 0, 1]],
    "normal": [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
}


def dot3(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def rot3(v, ax, a):
    c, s = math.cos(a), math.sin(a)
    d = dot3(ax, v) * (1 - c)
    return [v[0] * c + (ax[1] * v[2] - ax[2] * v[1]) * s + ax[0] * d, v[1] * c + (ax[2] * v[0] - ax[0] * v[2]) * s + ax[1] * d,
            v[2] * c + (ax[0] * v[1] - ax[1] * v[0]) * s + ax[2] * d]


def refl3(v, n):
    d = 2 * dot3(v, n)
    return [v[0] - d * n[0], v[1] - d * n[1], v[2] - d * n[2]]


def normale_compensatrice(b1, b2):
    return rot3(rot3(NSEP, [0, 0, 1], b2), [R2, R2, 0], b1)


def deviation_fantome(Nc):
    g = refl3(refl3(refl3([0, -1, 0], NSEP), Nc), NSEP)
    S = SEG["aller1"]
    a = dot3(g, S[0])
    return [dot3(g, S[1]) / a, dot3(g, S[2]) / a]


def lame(t, verre, nref, N, seg, nom):
    p, qx, qy = dot3(seg[0], N), dot3(seg[1], N), dot3(seg[2], N)
    c, sg = abs(p), (-1 if p < 0 else 1)
    n = indice(verre, nref)
    K = n * n - 1 + c * c
    F1 = t * (c / math.sqrt(K) - 1)
    F2 = t * (n * n - 1) / (K * math.sqrt(K))
    return ("lame", {"nom": nom, "t": t, "verre": verre, "c": c, "P0": chemin_lame(t, n, c), "gx": F1 * sg * qx,
                     "gy": F1 * sg * qy, "hxx": F2 * qx * qx - F1 * c, "hxy": F2 * qx * qy, "hyy": F2 * qy * qy - F1 * c})


def dispersion(el, lnm):
    D = 0.0
    for o in el:
        if o[0] == "lame":
            L = o[1]
            D += chemin_lame(L["t"], indice(L["verre"], lnm), L["c"]) - L["P0"]
    return D


def dispersion_groupe(el, lnm):
    """Retard de groupe des lames moins le retard de phase à l'indice de référence (`dispersionGroupe` du cœur)."""
    D, l = 0.0, lnm * 1e-9
    for o in el:
        if o[0] == "lame":
            L = o[1]
            v = VERRES[L["verre"]] if isinstance(L["verre"], str) else L["verre"]
            n = indice(L["verre"], lnm)
            D += chemin_lame(L["t"], n, L["c"]) - L["P0"] + L["t"] * n / math.sqrt(n * n - 1 + L["c"] * L["c"]) * 2 * v["B"] / (l * l)
    return D


def decalage_commun(LA, nref, segs):
    """Décalage du rayon d'axe par la séparatrice seule (compensatrice parallèle) : `decalageCommun` du cœur."""
    x = y = 0.0
    for sg in segs:
        g = lame(LA["t"], LA.get("verre", "bk7"), nref, NSEP, SEG[sg], "")[1]
        x -= g["gx"]
        y -= g["gy"]
    return [x, y]


def trajet(cfg, bras, opt=None):
    """Trajet déplié (`trajet` du cœur) ; miroirs et sortie centrés sur le faisceau réel par ("decale", dx, dy)."""
    opt = opt or {}
    src, mir = cfg["source"], cfg["miroirs"]
    el, z = [], src["d"]
    LA = cfg.get("lames")
    nref = spectre_de(cfg["spectre"])["lmoy"]
    Nc = normale_compensatrice(LA.get("b1", 0), LA.get("b2", 0)) if LA else None
    LL = cfg["lamelle"] if opt.get("lamelle") and cfg.get("lamelle") and cfg["lamelle"]["bras"] == bras else None

    def verre(N, seg, nom):
        el.append(lame(LA["t"], LA.get("verre", "bk7"), nref, N, SEG[seg], nom))

    def lamelle():
        el.append(lame(LL["ep"], LL.get("verre", "bk7"), nref, [0, 0, 1], SEG["normal"], "lamelle"))
    cM = decalage_commun(LA, nref, ["entree"]) if LA else None
    cR = decalage_commun(LA, nref, ["retour2", "sortie"]) if LA else None

    def decale(c):
        if c:
            el.append(("decale", c[0], c[1]))

    ent = sorted(cfg.get("entree") or [], key=lambda o: -o["d"])
    for i, o in enumerate(ent):
        if not (o["d"] < src["d"]) or o["d"] < 0:
            continue
        el.append(("prop", z - o["d"]))
        z = o["d"]
        if _fini(o.get("R")):
            el.append(("pupille", o["R"], o.get("nom") or "entree%d" % i))
        if o.get("f"):
            el.append(("lentille", o["f"]))
    if bras == 1:
        if opt.get("fantome") and LA:
            ds = min(z, LA.get("d") or 0)
            g = deviation_fantome(Nc)
            el.append(("prop", z - ds))
            el.append(("devie", g[0], g[1]))
            el.append(("prop", ds))
        else:
            el.append(("prop", z))
        if LA:
            verre(Nc, "aller1", "compensatrice")
        decale(cM)
        el.append(("repere", "miroir"))
        if _fini(mir.get("R1")):
            el.append(("pupille", mir["R1"], "M1"))
        if LL:
            lamelle()
            lamelle()
        if LA:
            verre(Nc, "sortie", "compensatrice")
            verre(NSEP, "sortie", "separatrice")
    else:
        if LA:
            verre(NSEP, "entree", "separatrice")
        el.append(("prop", z + mir["e"]))
        decale(cM)
        el.append(("repere", "miroir"))
        if _fini(mir.get("R2")):
            el.append(("pupille", mir["R2"], "M2"))
        if LL:
            lamelle()
        el.append(("devie", 2 * mir["ax"], 2 * mir["ay"]))
        if LL:
            lamelle()
        el.append(("prop", mir["e"]))
        if LA:
            verre(NSEP, "retour2", "separatrice")
            verre(NSEP, "sortie", "separatrice")
    decale(cR)
    z = 0.0
    sor = sorted(cfg.get("sortie") or [], key=lambda o: o["d"])
    for i, q in enumerate(sor):
        if not (q["d"] < cfg["detecteur"]["d"]):
            continue
        el.append(("prop", q["d"] - z))
        z = q["d"]
        ox, oy = q.get("ox", 0), q.get("oy", 0)
        if _fini(q.get("R")):
            el.append(("pupille", q["R"], q.get("nom") or "sortie%d" % i, ox, oy))
        if q.get("f"):
            el.append(("lentille", q["f"]))
            if ox or oy:
                el.append(("devie", ox / q["f"], oy / q["f"]))
    el.append(("prop", cfg["detecteur"]["d"] - z))
    return el


def trace(el, xs, ys):
    A, B, C, D = 1.0, 0.0, 0.0, 1.0
    hx = hy = kx = ky = 0.0
    L0 = lx = ly = m = gxx = gxy = gyy = 0.0
    pup, rep = [], {}
    for o in el:
        qx, qy, ux, uy = A * xs + hx, A * ys + hy, C * xs + kx, C * ys + ky
        if o[0] == "prop":
            d = o[1]
            L0 += d * (1 + (ux * ux + uy * uy) / 2)
            lx += d * D * ux
            ly += d * D * uy
            m += d * D * D
            A += d * C
            B += d * D
            hx += d * kx
            hy += d * ky
        elif o[0] == "lentille":
            f = o[1]
            L0 -= (qx * qx + qy * qy) / (2 * f)
            lx -= B * qx / f
            ly -= B * qy / f
            m -= B * B / f
            C -= A / f
            D -= B / f
            kx -= hx / f
            ky -= hy / f
        elif o[0] == "devie":
            L0 += o[1] * qx + o[2] * qy
            lx += o[1] * B
            ly += o[2] * B
            kx += o[1]
            ky += o[2]
        elif o[0] == "pupille":
            ox, oy = (o[3], o[4]) if len(o) > 3 else (0.0, 0.0)
            pup.append({"A": A, "B": B, "qx": qx - ox, "qy": qy - oy, "R": o[1], "nom": o[2]})
        elif o[0] == "lame":                               # rayon décalé de −∇Ψ (partie g + h̄ I), cf. `trace` du cœur
            L = o[1]
            hb = (L["hxx"] + L["hyy"]) / 2
            axx, ayy, axy = L["hxx"] - hb, L["hyy"] - hb, L["hxy"]
            L0 += L["P0"] - 0.5 * hb * (ux * ux + uy * uy) + 0.5 * (axx * ux * ux + 2 * axy * ux * uy + ayy * uy * uy)
            lx += D * (axx * ux + axy * uy - hb * ux)
            ly += D * (axy * ux + ayy * uy - hb * uy)
            m -= D * D * hb
            gxx += D * D * axx
            gxy += D * D * axy
            gyy += D * D * ayy
            A -= hb * C
            B -= hb * D
            hx -= L["gx"] + hb * kx
            hy -= L["gy"] + hb * ky
        elif o[0] == "decale":                             # nouvelle origine transverse (cf. `trajet`)
            hx -= o[1]
            hy -= o[2]
        elif o[0] == "repere":
            rep[o[1]] = {"A": A, "B": B, "qx": qx, "qy": qy}
    return {"A": A, "B": B, "qx": A * xs + hx, "qy": A * ys + hy, "L0": L0, "lx": lx, "ly": ly, "m": m,
            "gxx": gxx, "gxy": gxy, "gyy": gyy, "pup": pup, "rep": rep}


def bras(t, rendu):
    Bd, Ad = t["B"], t["A"]
    disques, fconj, bind = [], 1.0, None
    wpix, patch = rendu.get("pixel") or 0, rendu.get("patch") or 0
    lm = (rendu.get("lmoy") or 550) * 1e-9
    for p in t["pup"]:
        Bp = Bd * p["A"] - Ad * p["B"]
        if abs(p["B"]) < 1e-12:
            sc = patch * abs(p["A"]) + 1e-12
            fconj *= max(0.0, min(1.0, (p["R"] - math.hypot(p["qx"], p["qy"])) / sc + 0.5))
            continue
        Rth = p["R"] / abs(p["B"])
        cx = t["qx"] - Bd * p["qx"] / p["B"]
        cy = t["qy"] - Bd * p["qy"] / p["B"]
        r = abs(Bd) * Rth
        wd = 0.61 * lm * abs(Bp) / p["R"] if rendu.get("diffraction") else 0.0
        wp = patch * abs(Bp / p["B"])
        w = math.sqrt(wpix * wpix + wd * wd + wp * wp)
        dsq = {"cx": cx, "cy": cy, "r": r, "w": w, "wd": wd, "Rth": Rth, "nom": p["nom"]}
        disques.append(dsq)
        if bind is None or Rth < bind["Rth"]:
            bind = dsq
    eps2 = 13 / 12 * bind["w"] * bind["w"] / (bind["Rth"] * bind["Rth"]) if bind else 0.0
    epsd2 = 0.0025 * bind["wd"] * bind["wd"] / (bind["Rth"] * bind["Rth"]) if bind else 0.0
    den, dend = Bd * Bd + eps2, Bd * Bd + epsd2
    s = Bd / dend if dend > 0 else 0.0
    s2 = s * s / 2
    mxx, myy, mxy, Qx, Qy = t["m"] + t["gxx"], t["m"] + t["gyy"], t["gxy"], t["qx"], t["qy"]
    return {"I": fconj / den if den > 0 else 0.0, "disques": disques, "s": s, "eps2": eps2, "epsd2": epsd2, "Bd": Bd,
            "qx": Qx, "qy": Qy, "rep": t["rep"],
            "c": t["L0"] - s * (t["lx"] * Qx + t["ly"] * Qy) + s2 * (mxx * Qx * Qx + 2 * mxy * Qx * Qy + myy * Qy * Qy),
            "cx": s * t["lx"] - 2 * s2 * (mxx * Qx + mxy * Qy), "cy": s * t["ly"] - 2 * s2 * (mxy * Qx + myy * Qy),
            "cxx": s2 * mxx, "cyy": s2 * myy, "cxy": 2 * s2 * mxy}


def point_source(cfg, rendu, xs, ys, el1=None, el2=None):
    b1 = bras(trace(el1 or trajet(cfg, 1), xs, ys), rendu)
    b2 = bras(trace(el2 or trajet(cfg, 2), xs, ys), rendu)
    cxx, cyy = b2["cxx"] - b1["cxx"], b2["cyy"] - b1["cyy"]
    return {"b1": b1, "b2": b2, "c0": b2["c"] - b1["c"], "cx": b2["cx"] - b1["cx"], "cy": b2["cy"] - b1["cy"],
            "cxx": cxx, "cyy": cyy, "cxy": b2["cxy"] - b1["cxy"], "cq": (cxx + cyy) / 2}


def delta_parax(cfg, xs, ys, X, Y, rendu=None):
    P = point_source(cfg, rendu or {}, xs, ys)
    return P["c0"] + P["cx"] * X + P["cy"] * Y + P["cxx"] * X * X + P["cyy"] * Y * Y + P["cxy"] * X * Y


NDMAX, NCMAX, MMAX, LARG, NMASQ = 8, 4, 24, 128, 1024


def _round_js(x):
    return math.floor(x + 0.5)


def masque_forme(forme, _cache={}):
    """Masque de la forme (`masqueForme` du cœur) : cellule allumée si son centre est dans la forme (numpy, mêmes
    opérations élément par élément)."""
    cle = json.dumps(forme, sort_keys=True)
    if cle in _cache:
        return _cache[cle]
    x0 = y0 = math.inf
    x1 = y1 = -math.inf
    for f in forme:
        b = ((f["x0"], f["x1"], f["y0"], f["y1"]) if f["t"] == "rect" else
             (f["cx"] - f["a"], f["cx"] + f["a"], f["cy"] - f["b"], f["cy"] + f["b"]) if f["t"] == "ell" else
             (f["cx"] - f["r1"], f["cx"] + f["r1"], f["cy"] - f["r1"], f["cy"] + f["r1"]))
        x0, x1, y0, y1 = min(x0, b[0]), max(x1, b[1]), min(y0, b[2]), max(y1, b[3])
    h = max(x1 - x0, y1 - y0) / (NMASQ - 2)
    X0, Y0 = x0 - h, y0 - h
    nx, ny = min(NMASQ, math.ceil((x1 - x0) / h) + 2), min(NMASQ, math.ceil((y1 - y0) / h) + 2)
    xs = X0 + (np.arange(nx) + 0.5) * h
    ys = Y0 + (np.arange(ny) + 0.5) * h
    x, y = np.meshgrid(xs, ys)
    ok = np.zeros(x.shape, bool)
    for f in forme:
        if f["t"] == "rect":
            ok |= (x >= f["x0"]) & (x <= f["x1"]) & (y >= f["y0"]) & (y <= f["y1"])
        elif f["t"] == "ell":
            u, v = (x - f["cx"]) / f["a"], (y - f["cy"]) / f["b"]
            ok |= u * u + v * v <= 1
        elif f["t"] == "anneau":
            dx, dy = x - f["cx"], y - f["cy"]
            r2, an = dx * dx + dy * dy, np.arctan2(dy, dx)
            ok |= (r2 >= f["r0"] * f["r0"]) & (r2 <= f["r1"] * f["r1"]) & (an >= f["a0"]) & (an <= f["a1"])
    m = {"x0": X0, "y0": Y0, "inv": 1 / h, "nx": nx, "ny": ny, "d": ok}
    _cache[cle] = m
    return m


def dans_masque(m, x, y):
    i, j = math.floor((x - m["x0"]) * m["inv"]), math.floor((y - m["y0"]) * m["inv"])
    return 0 <= i < m["nx"] and 0 <= j < m["ny"] and bool(m["d"][j, i])


def lentille_aire(r1, r2, d):
    if d >= r1 + r2:
        return 0.0
    if d <= abs(r1 - r2):
        r = min(r1, r2)
        return math.pi * r * r
    a = math.acos(max(-1.0, min(1.0, (d * d + r1 * r1 - r2 * r2) / (2 * d * r1))))
    b = math.acos(max(-1.0, min(1.0, (d * d + r2 * r2 - r1 * r1) / (2 * d * r2))))
    return r1 * r1 * a + r2 * r2 * b - 0.5 * math.sqrt(max(0.0, (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2)))


def analyse_bras(el, ro, Rs):
    t = trace(el, 0, 0)
    Ad, Bd = t["A"], t["B"]
    wpix, lm = ro.get("pixel") or 0, (ro.get("lmoy") or 550) * 1e-9
    D, C = [], []
    Rb = math.inf
    for p in t["pup"]:
        if abs(p["B"]) > 1e-12:
            Rb = min(Rb, p["R"] / abs(p["B"]))
    for p in t["pup"]:
        if not (abs(p["B"]) * 100 * Rb > p["R"]):
            if abs(p["A"]) > 1e-12 and len(C) < NCMAX:
                C.append({"cx": -p["qx"] / p["A"], "cy": -p["qy"] / p["A"], "r": p["R"] / abs(p["A"])})
            continue
        Bp = Bd * p["A"] - Ad * p["B"]
        r = abs(Bd) * p["R"] / abs(p["B"])
        wd = 0.61 * lm * abs(Bp) / p["R"] if ro.get("diffraction") else 0.0
        w = math.sqrt(wpix * wpix + wd * wd)
        if not w > 0:
            w = 1e-9
        D.append({"k": Ad - Bd * p["A"] / p["B"], "c0x": t["qx"] - Bd * p["qx"] / p["B"], "c0y": t["qy"] - Bd * p["qy"] / p["B"],
                  "rp": math.sqrt(r * r + w * w), "w": w, "Rt": p["R"] / abs(p["B"]), "ta": -p["A"] / p["B"],
                  "tbx": -p["qx"] / p["B"], "tby": -p["qy"] / p["B"], "nom": p["nom"]})
    D = sorted(D, key=lambda d: d["rp"])[:NDMAX]
    bind = blob = -1
    for i, d in enumerate(D):
        if bind < 0 or d["Rt"] < D[bind]["Rt"]:
            bind = i
        if blob < 0 or d["rp"] * d["rp"] + d["w"] * d["w"] / 12 < D[blob]["rp"] * D[blob]["rp"] + D[blob]["w"] * D[blob]["w"] / 12:
            blob = i
    wmin = min([d["w"] for d in D], default=math.inf)
    eps2 = 13 / 12 * wmin * wmin / (D[bind]["Rt"] * D[bind]["Rt"]) if bind >= 0 else 0.0
    tir = {"A": 0.0, "bx": 0.0, "by": 0.0, "r": Rs if Rs > 0 else math.inf}
    for i, d in enumerate(D):
        if not abs(d["k"]) > 1e-12:
            continue
        rr = (d["rp"] + d["w"] / 2) / abs(d["k"])
        if rr < tir["r"]:
            tir = {"A": 1 / d["k"], "bx": -d["c0x"] / d["k"], "by": -d["c0y"] / d["k"], "r": rr, "j": i}
    for c in C:
        if c["r"] < tir["r"]:
            tir = {"A": 0.0, "bx": c["cx"], "by": c["cy"], "r": c["r"]}
    tir.setdefault("j", -1)
    return {"t": t, "Ad": Ad, "Bd": Bd, "D": D, "C": C, "bind": bind, "blob": blob, "eps2": eps2,
            "conj": Bd * Bd < 1e4 * eps2, "tir": tir}


def poly_delta(cfg, ro, el1, el2):
    h = 0.01
    P = lambda x, y: point_source(cfg, ro, x, y, el1, el2)
    p00, pp0, pm0, p0p, p0m, ppp = P(0, 0), P(h, 0), P(-h, 0), P(0, h), P(0, -h), P(h, h)
    c = p00["c0"]
    return {"c00": c, "sx": (pp0["c0"] - pm0["c0"]) / (2 * h), "sy": (p0p["c0"] - p0m["c0"]) / (2 * h),
            "sxx": (pp0["c0"] + pm0["c0"] - 2 * c) / (2 * h * h), "syy": (p0p["c0"] + p0m["c0"] - 2 * c) / (2 * h * h),
            "sxy": (ppp["c0"] - pp0["c0"] - p0p["c0"] + c) / (h * h),
            "cx": p00["cx"], "cxsx": (pp0["cx"] - pm0["cx"]) / (2 * h), "cxsy": (p0p["cx"] - p0m["cx"]) / (2 * h),
            "cy": p00["cy"], "cysx": (pp0["cy"] - pm0["cy"]) / (2 * h), "cysy": (p0p["cy"] - p0m["cy"]) / (2 * h),
            "cxx": p00["cxx"], "cyy": p00["cyy"], "cxy": p00["cxy"]}


def preparer(cfg, rendu, passe):
    """Passe du rendu par pixel (`preparer` du cœur) : en-tête (bras, polynôme de δ, lamelle), éléments spectraux,
    échantillons (ux, uy, composante)."""
    sp = spectre_de(cfg["spectre"])
    Rs = cfg["source"]["rayon"] if (cfg["source"].get("rayon") or 0) > 0 else 0.0
    g, p = rendu["graine"] & M32, passe & M32
    spec = tirage(sp, min(MMAX, rendu["M"] if "continu" in sp else len(sp["raies"])))
    lum = (cfg.get("luminance") or 1) / xyz_spectre(sp)[1]
    pose, ponct = rendu.get("pose") or 0.0, not Rs > 0
    ro = {"pixel": 2 * rendu["W"] / rendu["res"], "patch": 0, "lmoy": sp["lmoy"], "diffraction": rendu.get("diffraction", True) is not False}
    el1, el2 = trajet(cfg, 1), trajet(cfg, 2)
    elG = trajet(cfg, 1, {"fantome": True}) if cfg.get("lames") and (cfg["lames"].get("fantome") or 0) > 0 else None
    B = [analyse_bras(el1, ro, Rs), analyse_bras(el2, ro, Rs)] + ([analyse_bras(elG, ro, Rs)] if elG else [])
    LL = cfg["lamelle"] if cfg.get("lamelle") and cfg["lamelle"].get("bras") in (1, 2) else None
    e1L = trajet(cfg, 1, {"lamelle": True}) if LL and LL["bras"] == 1 else el1
    e2L = trajet(cfg, 2, {"lamelle": True}) if LL and LL["bras"] == 2 else el2
    q0 = poly_delta(cfg, ro, el1, el2)
    qL = poly_delta(cfg, ro, e1L, e2L) if LL else q0
    K = max(1, min(64, rendu.get("K") or (_round_js(rendu["N"] / 6) if rendu.get("N") else 16)))
    Kc = [1, 0, 0] if ponct else [K, K, max(4, K >> 2) if elG else 0]
    sel = [0.0, 0.0, 0.0, 0.0, -1.0]
    if LL:
        Tb = B[LL["bras"] - 1]["t"]
        rm = Tb["rep"]["miroir"]
        Bs = rm["B"] * bras(Tb, ro)["s"]
        nx, ny = LL["nx"], LL["ny"]
        sel = [(rm["A"] - Bs * Tb["A"]) * nx, (rm["A"] - Bs * Tb["A"]) * ny, Bs * nx, Bs * ny,
               nx * rm["qx"] + ny * rm["qy"] - LL["c"] - Bs * (nx * Tb["qx"] + ny * Tb["qy"])]
    lam, som = [], [0.0, 0.0, 0.0]
    for e in spec:
        inv = 1e9 / e["l"]
        x = math.pi * pose * inv
        fl = math.sin(x) / x if x > 1e-8 else 1.0
        ph0 = (q0["c00"] + dispersion(el2, e["l"]) - dispersion(el1, e["l"])) * inv
        ph1 = (qL["c00"] + dispersion(e2L, e["l"]) - dispersion(e1L, e["l"])) * inv
        lam.append({"l": e["l"], "inv": inv, "ph": [ph0 - math.floor(ph0), ph1 - math.floor(ph1)],
                    "W": [v * fl for v in e["W"]], "V": [v * fl for v in e["V"]], "kappa": e["kappa"], "rho": e["rho"],
                    "g": [dispersion_groupe(el2, e["l"]) - dispersion_groupe(el1, e["l"]),
                          dispersion_groupe(e2L, e["l"]) - dispersion_groupe(e1L, e["l"])]})
        for k in range(3):
            som[k] += e["W"][k]
    ech = []
    for c in range(3):
        rot = 2 * math.pi * u4(g, p, 0x7FFFFFFF, 1 + c)
        for k in range(Kc[c]):
            rr = 0.0 if ponct else math.sqrt((k + u4(g, p, k + 977 * c, 2)) / Kc[c])
            th = k * OR + rot
            ech.append((rr * math.cos(th), rr * math.sin(th), c))
    forme = cfg["source"].get("forme")
    return {"n": len(ech), "M": len(lam), "bras": B, "Rs": Rs, "ponct": ponct, "lamelle": bool(LL), "lum": lum,
            "I0": (cfg["source"].get("intensite") or 1e-6) * lum, "fan": cfg["lames"]["fantome"] if elG else 0.0, "K": Kc,
            "q": [q0, qL], "sel": sel, "lam": lam, "somme": som, "ech": ech, "sigma": 0.45 * ro["pixel"],
            "masque": masque_forme(forme) if (not ponct and forme) else None}


def vignettage(b, x, y):
    """Facteur v d'un bras près du foyer (`vignettage` du cœur)."""
    D, ib, ia = b["D"], b["bind"], b["blob"]
    db = D[ib]
    Rb, bx, by = db["Rt"], db["ta"] * x + db["tbx"], db["ta"] * y + db["tby"]
    om = math.pi * Rb * Rb
    for j, d in enumerate(D):
        if j == ib:
            continue
        cx, cy = d["ta"] * x + d["tbx"], d["ta"] * y + d["tby"]
        om = min(om, lentille_aire(Rb, d["Rt"], math.sqrt((cx - bx) * (cx - bx) + (cy - by) * (cy - by))))
    da = D[ia]
    ra, wa, ax, ay = da["rp"], da["w"], da["k"] * x + da["c0x"], da["k"] * y + da["c0y"]
    ai = math.pi * ra * ra
    for j, d in enumerate(D):
        if j == ia:
            continue
        cx, cy = d["k"] * x + d["c0x"], d["k"] * y + d["c0y"]
        ai = min(ai, lentille_aire(ra, d["rp"], math.sqrt((cx - ax) * (cx - ax) + (cy - ay) * (cy - ay))))
    return om / (ai * (1 + wa * wa / (12 * ra * ra))) if ai > 0 else 0.0


def appartenance(b, x, y, X, Y, s2):
    """Appartenance floue aux pupilles d'un bras, bords adoucis de |k| √s2 sauf la pupille de tirage (cf. le cœur)."""
    m = 1.0
    for c in b["C"]:
        ex, ey = x - c["cx"], y - c["cy"]
        if ex * ex + ey * ey > c["r"] * c["r"]:
            return 0.0
    for j, d in enumerate(b["D"]):
        ex, ey = X - (d["k"] * x + d["c0x"]), Y - (d["k"] * y + d["c0y"])
        b2 = 0.0 if j == b["tir"]["j"] else d["k"] * d["k"] * s2
        a = (math.sqrt(max(0.0, d["rp"] * d["rp"] - b2 / 12)) - math.sqrt(ex * ex + ey * ey)) / math.sqrt(d["w"] * d["w"] + b2) + 0.5
        if a < m:
            m = a
            if not m > 0:
                return 0.0
    return m


def contributions(prep, X, Y):
    """Échantillons utiles au point (X, Y) : [(s, amp, dd, dt, gx, gy, t)] (`contributions` du cœur)."""
    B, nb, Rs, K = prep["bras"], len(prep["bras"]), prep["Rs"], prep["K"]
    tc, v = [], []
    for b in B:
        t = b["tir"]
        tc.append((t["A"] * X + t["bx"], t["A"] * Y + t["by"], t["r"]))
        v.append(vignettage(b, tc[-1][0], tc[-1][1]) if b["conj"] else (1 / (b["Bd"] * b["Bd"]) if b["Bd"] != 0 else 0.0))
    out = []
    for ux, uy, c in prep["ech"]:
        s2 = 0.0
        if prep["ponct"]:
            x = y = 0.0
            W = prep["I0"]
        else:
            x, y = tc[c][0] + tc[c][2] * ux, tc[c][1] + tc[c][2] * uy
            if x * x + y * y > Rs * Rs:
                continue
            if prep["masque"] is not None and not dans_masque(prep["masque"], x, y):
                continue
            den = 0.0
            for j in range(nb):
                ddx, ddy = x - tc[j][0], y - tc[j][1]
                if ddx * ddx + ddy * ddy <= tc[j][2] * tc[j][2]:
                    den += K[j] / (math.pi * tc[j][2] * tc[j][2])
            if not den > 0:
                continue
            W = prep["lum"] / den
            s2 = 1 / den
        f1 = appartenance(B[0], x, y, X, Y, s2) * v[0] * W
        f2 = appartenance(B[1], x, y, X, Y, s2) * v[1] * W
        fG = appartenance(B[2], x, y, X, Y, s2) * v[2] * W * prep["fan"] if nb > 2 else 0.0
        if not f1 + f2 + fG > 0:
            continue
        S = prep["sel"]
        t = 1 if prep["lamelle"] and S[0] * x + S[1] * y + S[2] * X + S[3] * Y + S[4] > 0 else 0
        q = prep["q"][t]
        Cx, Cy = q["cx"] + q["cxsx"] * x + q["cxsy"] * y, q["cy"] + q["cysx"] * x + q["cysy"] * y
        dd = (q["sx"] * x + q["sy"] * y + q["sxx"] * x * x + q["syy"] * y * y + q["sxy"] * x * y + Cx * X + Cy * Y
              + q["cxx"] * X * X + q["cyy"] * Y * Y + q["cxy"] * X * Y)
        out.append((f1 + f2 + fG, 2 * math.sqrt(f1 * f2), dd, q["c00"] + dd, Cx + 2 * q["cxx"] * X + q["cxy"] * Y,
                    Cy + q["cxy"] * X + 2 * q["cyy"] * Y, t))
    return out


def evaluer(prep, X, Y):
    sig2 = 2 * math.pi * math.pi * prep["sigma"] * prep["sigma"]
    S, a = prep["somme"], [0.0, 0.0, 0.0]
    for s, amp, dd, dt, gx, gy, t in contributions(prep, X, Y):
        for k in range(3):
            a[k] += S[k] * s
        if not amp > 0:
            continue
        g2 = (gx * gx + gy * gy) * sig2
        for L in prep["lam"]:
            f = terme(L, dd, dt, t, g2)
            for k in range(3):
                a[k] += amp * (L["W"][k] * f[0] - L["V"][k] * f[1])
    return a


def image(cfg, rendu, passes=1):
    res, W = rendu["res"], rendu["W"]
    h = 2 * W / res
    img = np.zeros((res, res, 3))
    for p in range(passes):
        prep = preparer(cfg, rendu, p)
        for iy in range(res):
            for ix in range(res):
                img[iy, ix] += np.array(evaluer(prep, rendu.get("cx0", 0) - W + (ix + 0.5) * h, rendu.get("cy0", 0) + W - (iy + 0.5) * h)) / passes
    return img


# ================= géométrie exacte (non paraxiale) =================
def _miroir2(mir):
    N = math.sqrt(1 + mir["ax"] ** 2 + mir["ay"] ** 2)
    return np.array([-mir["ax"], -mir["ay"], 1.0]) / N, mir["e"] / N


def _image_point(P, n, c):
    return P - 2 * (n @ P - c) * n


def _onde_entree(cfg, xs, ys):
    """Onde arrivant sur les miroirs depuis le point source, entrée par lentilles PARFAITES (conjugaison paraxiale
    étendue : plans conjugués, pas de distorsion). ('point', S' (3D), σ) ou ('dir', v (unitaire, vers +z))."""
    z_obj, h, dirn = -cfg["source"]["d"], np.array([xs, ys]), None   # objet : point (z, h) ou direction (pente)
    for o in sorted(cfg.get("entree") or [], key=lambda o: -o["d"]):
        if not o.get("f") or not (o["d"] < cfg["source"]["d"]):
            continue
        zl, f = -o["d"], o["f"]
        if dirn is None:
            a = zl - z_obj                                 # distance objet → lentille (> 0 : objet réel)
            inv_b = 1 / f - 1 / a
            if abs(inv_b) < 1e-12:
                dirn, z_obj, h = -h / f, None, None        # objet au foyer : onde plane, pente −h/f
            else:
                b = 1 / inv_b
                h, z_obj = -h * b / a, zl + b
        else:                                              # onde plane → foyer image, hauteur f·pente
            h, z_obj, dirn = dirn * f, zl + f, None
    if dirn is not None:
        v = np.array([dirn[0], dirn[1], 1.0])
        return "dir", v / np.linalg.norm(v)
    return "point", np.array([h[0], h[1], z_obj])


def delta_exact(cfg, xs, ys, X, Y):
    """δ exact au point (X, Y) du détecteur (None si le détecteur est à un foyer de l'onde plane)."""
    mir = cfg["miroirs"]
    n2, c2 = _miroir2(mir)
    n1 = np.array([0.0, 0.0, 1.0])
    kind, S = _onde_entree(cfg, xs, ys)
    sor = sorted([o for o in (cfg.get("sortie") or []) if o.get("f") and o["d"] < cfg["detecteur"]["d"]],
                 key=lambda o: o["d"])
    if len(sor) > 1:
        raise ValueError("une seule lentille de sortie")
    zd = -cfg["detecteur"]["d"]
    if not sor:                                            # écran nu
        Mpt, cible = np.array([X, Y, zd]), "point"
    else:
        zl, f = -sor[0]["d"], sor[0]["f"]
        ox, oy = sor[0].get("ox", 0), sor[0].get("oy", 0)   # lentille (œil) décalée : détecteur lié à elle
        X, Y = X - ox, Y - oy
        q = sor[0]["d"] - cfg["detecteur"]["d"]            # < 0 : le détecteur est en aval (z décroissant)
        q = -q
        inv_a = 1 / f - 1 / q
        if abs(inv_a) < 1e-12:                             # plan focal : direction û (tangente X/f)
            u = np.array([X, Y, -f])
            Mpt, cible = u / np.linalg.norm(u), "dir"
        else:
            a = 1 / inv_a
            Mpt, cible = np.array([-X * a / q + ox, -Y * a / q + oy, zl + a]), "point"
    if kind == "point":
        S1, S2 = _image_point(S, n1, 0.0), _image_point(S, n2, c2)
        if cible == "dir":
            return float((S1 - S2) @ Mpt)
        sig = 1.0 if S1[2] > Mpt[2] else -1.0
        d1, d2 = np.linalg.norm(S1 - Mpt), np.linalg.norm(S2 - Mpt)
        return float(sig * ((S2 - S1) @ (S2 + S1 - 2 * Mpt)) / (d1 + d2))
    if cible == "dir":
        return None
    v = S
    v1 = v - 2 * (v @ n1) * n1
    v2 = v - 2 * (v @ n2) * n2
    Q2 = np.array([0.0, 0.0, mir["e"]])
    return float((v2 @ Mpt + (v - v2) @ Q2) - (v1 @ Mpt))


# ================= cas de contrôle =================
def _sortie_lentille(f, pos=0.12, R=0.025):
    return [{"d": ARM + pos, "f": f, "R": R}]


def _conj(f, pos=0.12):
    p = ARM + pos
    return ARM + pos + 1 / (1 / f - 1 / p)


def _oeil(pos, acc, R=0.001, ox=0.0, oy=0.0):
    q = 0.017
    f = 1 / (1 / q + (0 if acc is None else 1 / acc))
    o = {"d": ARM + pos, "f": f, "R": R, "nom": "oeil"}
    if ox or oy:
        o.update(ox=ox, oy=oy)
    return [o], ARM + pos + q


def _centre(cfg):
    """Centre du champ : celui de l'œil quand il est déplacé latéralement (la rétine suit l'œil)."""
    for o in cfg.get("sortie") or []:
        if o.get("nom") == "oeil":
            return o.get("ox", 0.0), o.get("oy", 0.0)
    return 0.0, 0.0


def LAMES(b1, b2, fantome=0.04):
    return {"t": 0.006, "verre": "bk7", "b1": b1, "b2": b2, "d": ARM, "fantome": fantome}


def LAMELLE(bras, n, c, ep=1.7e-4):
    return {"bras": bras, "ep": ep, "verre": "d263", "nx": n[0], "ny": n[1], "c": c}


def cas_controle():
    na = lambda e, ax, ay: {"e": e, "ax": ax, "ay": ay, "R1": 0.015, "R2": 0.015}
    lampe = {"d": 0.25 + ARM, "rayon": 0.006}
    oeil_inf, ret_inf = _oeil(0.10, None)
    oeil_mir, ret_mir = _oeil(0.10, ARM + 0.10)
    oeil_dec, ret_dec = _oeil(0.10, None, ox=0.006, oy=-0.004)
    oeil_dmir, ret_dmir = _oeil(0.10, ARM + 0.10, ox=-0.003, oy=0.002)
    cas = [
        ("lame d'air, plan focal 1 m", {"spectre": "na", "source": lampe, "miroirs": na(5e-4, 0, 0),
                                        "sortie": _sortie_lentille(1.0), "detecteur": {"d": ARM + 1.12}}),
        ("coin d'air, miroirs conjugués (20 cm)", {"spectre": "bl", "source": lampe, "miroirs": na(0, 1e-4, 3e-5),
                                                    "sortie": _sortie_lentille(0.2), "detecteur": {"d": _conj(0.2)}}),
        ("lame et coin mêlés", {"spectre": "na", "source": lampe, "miroirs": na(3e-4, 1e-4, 5e-5),
                                "sortie": _sortie_lentille(0.2), "detecteur": {"d": _conj(0.2)}}),
        ("écran nu", {"spectre": "na", "source": lampe, "miroirs": na(5e-4, 2e-5, 0), "detecteur": {"d": ARM + 1.12}}),
        ("œil à l'infini", {"spectre": "na", "source": {"d": 0.25 + ARM, "rayon": 0.015}, "miroirs": na(1e-3, 5e-5, 0),
                            "sortie": oeil_inf, "detecteur": {"d": ret_inf}}),
        ("œil sur les miroirs", {"spectre": "hg", "source": {"d": 0.25 + ARM, "rayon": 0.015}, "miroirs": na(2e-5, 2e-4, -1e-4),
                                 "sortie": oeil_mir, "detecteur": {"d": ret_mir}}),
        ("œil décalé, à l'infini, coin résiduel", {"spectre": "na", "source": {"d": 0.10 + ARM, "rayon": 0.025},
                                                  "miroirs": na(1e-3, 1e-5, -4e-6), "sortie": oeil_dec, "detecteur": {"d": ret_dec}}),
        ("œil décalé, sur les miroirs", {"spectre": "hg", "source": {"d": 0.25 + ARM, "rayon": 0.015}, "miroirs": na(2e-5, 2e-4, -1e-4),
                                         "sortie": oeil_dmir, "detecteur": {"d": ret_dmir}}),
        ("collimateur, coin d'air projeté", {"spectre": "na", "source": {"d": 0.6, "rayon": 0.001},
                                             "entree": [{"d": 0.4, "f": 0.2, "R": 0.02}], "miroirs": na(1e-5, 1e-4, 0),
                                             "sortie": _sortie_lentille(0.2), "detecteur": {"d": _conj(0.2)}}),
        ("condenseur, lame d'air au plan focal", {"spectre": "na", "source": {"d": 0.38, "rayon": 0.004},
                                                  "entree": [{"d": 0.30, "f": 0.06, "R": 0.02}], "miroirs": na(8e-4, 0, 0),
                                                  "sortie": _sortie_lentille(1.0), "detecteur": {"d": ARM + 1.12}}),
        ("mercure sans filtre, lame d'air", {"spectre": "hgc", "source": lampe, "miroirs": na(2e-4, 0, 0),
                                             "sortie": _sortie_lentille(1.0), "detecteur": {"d": ARM + 1.12}}),
        ("laser, écran nu", {"spectre": "laser", "source": {"d": 0.30, "rayon": 0, "intensite": 1e-6},
                             "miroirs": na(2e-3, 1e-4, 0), "detecteur": {"d": ARM + 1.5}}),
        ("lampe sans dépoli (tube en U), condenseur", {"spectre": "na", "source": {"d": 0.38, "rayon": 0.016, "forme": [
            {"t": "rect", "x0": -0.0075, "y0": -0.0085, "x1": -0.0025, "y1": 0.0105}, {"t": "rect", "x0": 0.0025, "y0": -0.0085, "x1": 0.0075, "y1": 0.0105},
            {"t": "ell", "cx": -0.005, "cy": 0.0105, "a": 0.0025, "b": 0.0025}, {"t": "ell", "cx": 0.005, "cy": 0.0105, "a": 0.0025, "b": 0.0025},
            {"t": "anneau", "cx": 0, "cy": -0.0085, "r0": 0.0025, "r1": 0.0075, "a0": -math.pi, "a1": 0}]},
            "entree": [{"d": 0.30, "f": 0.06, "R": 0.02}], "miroirs": na(3e-4, 4e-5, 0),
            "sortie": _sortie_lentille(1.0), "detecteur": {"d": ARM + 1.12}}),
        ("hors axe, mêlés, écran proche", {"spectre": "na", "source": {"d": 0.5, "rayon": 0.01}, "miroirs": na(-7e-4, -2e-4, 3e-4),
                                           "sortie": _sortie_lentille(1.0, 0.3), "detecteur": {"d": ARM + 0.3 + 0.4}}),
        ("lames inclinées, anneaux au plan focal", {"spectre": "na", "source": lampe, "miroirs": na(6e-5, 2e-5, -1e-5),
                                                   "lames": LAMES(4e-3, -6e-3), "sortie": _sortie_lentille(1.0), "detecteur": {"d": ARM + 1.12}}),
        ("lames inclinées, lumière blanche, miroirs conjugués", {"spectre": "bl", "source": lampe, "miroirs": na(-1e-5, 1e-4, 3e-5),
                                                                "lames": LAMES(-2e-3, 3e-3), "sortie": _sortie_lentille(0.2), "detecteur": {"d": _conj(0.2)}}),
        ("lames, œil à l'infini, collimateur", {"spectre": "hg", "source": {"d": 0.53, "rayon": 0.0003},
                                               "entree": [{"d": ARM + 0.2, "f": 0.2, "R": 0.025}], "miroirs": na(2e-4, 3e-3, -1e-3),
                                               "lames": LAMES(5e-3, 2e-3), "sortie": oeil_inf, "detecteur": {"d": ret_inf}}),
        ("raie fine (mercure basse pression), loin du contact", {"spectre": "hgb", "source": {"d": 0.53, "rayon": 0.0003},
                                                                 "entree": [{"d": ARM + 0.2, "f": 0.2, "R": 0.025}], "miroirs": na(3e-4, 3e-3, -1e-3),
                                                                 "lames": LAMES(5e-3, 2e-3), "sortie": oeil_inf, "detecteur": {"d": ret_inf}}),
        ("raies fines sans filtre (mercure basse pression), loin du contact", {"spectre": "hgcb", "source": {"d": 0.53, "rayon": 0.0003},
                                                                              "entree": [{"d": ARM + 0.2, "f": 0.2, "R": 0.025}], "miroirs": na(3e-4, 3e-3, -1e-3),
                                                                              "lames": LAMES(5e-3, 2e-3), "sortie": oeil_inf, "detecteur": {"d": ret_inf}}),
        ("lamelle sur M2, lumière blanche, miroirs conjugués", {"spectre": "bl", "source": lampe, "miroirs": na(8.8e-5, 6e-5, 0),
                                                               "lames": LAMES(0, 0), "lamelle": LAMELLE(2, (1, 0), 0.002),
                                                               "sortie": _sortie_lentille(0.2), "detecteur": {"d": _conj(0.2)}}),
        ("lamelle sur M1, anneaux", {"spectre": "na", "source": lampe, "miroirs": na(3e-4, 0, 0),
                                     "lamelle": LAMELLE(1, (0.6, -0.8), -0.003), "sortie": _sortie_lentille(1.0), "detecteur": {"d": ARM + 1.12}}),
    ]
    sources = [(0, 0), (0.004, 0.0), (-0.003, 0.005), (0.0105, -0.0098)]
    detect = [(0, 0), (0.01, 0), (-0.007, 0.012), (0.03, -0.02)]
    return cas, sources, detect


def _rendu_nu():
    return {"pixel": 0, "patch": 0, "diffraction": False}


def _ech_detect(cfg, detect):
    """Points du détecteur à l'échelle du champ (rétine : mm ; écran : cm)."""
    k = 0.02 if any(o.get("nom") == "oeil" for o in cfg.get("sortie") or []) else 1.0
    cx, cy = _centre(cfg)
    return [(cx + x * k, cy + y * k) for x, y in detect]


def generer_controles():
    cas, sources, detect = cas_controle()
    out = {"points": [], "pixels": []}
    rendu = {"pixel": 3e-4, "patch": 2e-4, "lmoy": 589.3, "diffraction": True}
    for nom, cfg in cas:
        R = cfg["source"].get("rayon", 0)
        for xs, ys in (sources if R > 0 else [(0, 0)]):
            xs, ys = min(abs(xs), R) * (1 if xs >= 0 else -1), min(abs(ys), R) * (1 if ys >= 0 else -1)
            for ro in (_rendu_nu(), rendu):
                P = point_source(cfg, ro, xs, ys)
                out["points"].append({
                    "nom": nom, "cfg": cfg, "rendu": ro, "xs": xs, "ys": ys,
                    "c0": P["c0"], "cx": P["cx"], "cy": P["cy"], "cxx": P["cxx"], "cyy": P["cyy"], "cxy": P["cxy"],
                    "I1": P["b1"]["I"], "I2": P["b2"]["I"],
                    "disques1": [[d["cx"], d["cy"], d["r"], d["w"]] for d in P["b1"]["disques"]],
                    "disques2": [[d["cx"], d["cy"], d["r"], d["w"]] for d in P["b2"]["disques"]],
                    "delta": [[X, Y, delta_parax(cfg, xs, ys, X, Y, ro)] for X, Y in _ech_detect(cfg, detect)],
                })
    for i, (nom, cfg) in enumerate(cas):
        W = 0.0016 if any(o.get("nom") == "oeil" for o in cfg.get("sortie") or []) else 0.05
        cx, cy = _centre(cfg)
        r = {"res": 16, "W": W, "N": 12, "M": 6, "graine": 7 + i}
        if cx or cy:
            r.update(cx0=cx, cy0=cy)
        if nom.startswith("lames inclinées, anneaux"):
            r["pose"] = 7.3e-7
        prep = preparer(cfg, r, 3)
        pix = [(cx + W * a, cy + W * b) for a, b in ((0.0, 0.0), (0.31, -0.12), (-0.62, 0.44), (0.9, 0.9))]
        out["pixels"].append({"nom": nom, "cfg": cfg, "rendu": r, "passe": 3, "n": prep["n"],
                              "xyz": [[X, Y] + evaluer(prep, X, Y) for X, Y in pix]})
    return out


# ================= vérifications physiques =================
def contraste_spectral(sp, delta, n=4000):
    """|⟨exp(2iπδ/λ)⟩| sur le spectre (quadrature fine, pas l'échantillonnage du rendu)."""
    sp = spectre_de(sp)
    if "continu" in sp:
        raise ValueError
    ls, ws = [], []
    ptot = sum(r["poids"] for r in sp["raies"])
    for r in sp["raies"]:
        for s in range(n):
            ls.append(lambda_raie(r, sp["profil"], r.get("largeur", sp.get("largeur", 0)), (s + 0.5) / n))
            ws.append(r["poids"] / ptot / n)
    ls, ws = np.array(ls), np.array(ws)
    return abs(np.sum(ws * np.exp(2j * np.pi * delta / (ls * 1e-9))))


def verifications(sortie=print):
    res = []

    def ok(cond, titre, detail):
        res.append((bool(cond), titre, detail))
        sortie(("  ok    " if cond else "  ÉCHEC ") + titre + " — " + detail)

    cas, sources, detect = cas_controle()
    cfgs = dict(cas)
    # 1. écarts paraxial / exact
    pire = 0.0
    for nom, cfg in cas:
        if cfg.get("lames") or cfg.get("lamelle"):
            continue                                       # verre : vérifié à part (§ 8)
        R = cfg["source"].get("rayon", 0)
        ecart = 0.0
        for xs, ys in (sources if R > 0 else [(0, 0)]):
            xs, ys = min(abs(xs), R) * (1 if xs >= 0 else -1), min(abs(ys), R) * (1 if ys >= 0 else -1)
            for X, Y in _ech_detect(cfg, detect):
                de = delta_exact(cfg, xs, ys, X, Y)
                if de is None:
                    continue
                ecart = max(ecart, abs(delta_parax(cfg, xs, ys, X, Y) - de))
        pire = max(pire, ecart)
        ok(ecart < 20e-9, "Fresnel vs exact : " + nom, "écart max %.2f nm" % (ecart * 1e9))
    # 2. anneaux : r_n = f'√(nλ/e) (centre brillant), paraxial et exact, à 1 %
    lam, f = 589.3e-9, 1.0
    for e in (5e-4, 1e-3, 3e-3):
        cfg = dict(cfgs["lame d'air, plan focal 1 m"], miroirs={"e": e, "ax": 0, "ay": 0, "R1": 0.015, "R2": 0.015})
        P = point_source(cfg, _rendu_nu(), 0.003, -0.002)
        pire_p = pire_e = 0.0
        for n in range(1, 11):
            formule = f * math.sqrt(n * lam / e)
            r_par = math.sqrt(n * lam / -P["cq"])
            r_ex = f * math.tan(math.acos(1 - n * lam / (2 * e)))
            pire_p = max(pire_p, abs(r_par / formule - 1))
            pire_e = max(pire_e, abs(r_ex / formule - 1))
        ok(pire_p < 0.01 and pire_e < 0.01, "r_n = f'√(nλ/e), e = %g mm" % (e * 1e3),
           "écart max %.3f %% (modèle), %.3f %% (2e cos i exact), n = 1 à 10" % (pire_p * 100, pire_e * 100))
    # 3. coin d'air : interfrange λ/2α × grandissement, indépendant du point source (localisé sur les miroirs)
    cfg = cfgs["coin d'air, miroirs conjugués (20 cm)"]
    gmag = (cfg["detecteur"]["d"] - (ARM + 0.12)) / (ARM + 0.12)
    al = math.hypot(1e-4, 3e-5)
    for xs, ys in ((0, 0), (0.005, -0.003)):
        P = point_source(cfg, _rendu_nu(), xs, ys)
        i_mod = lam / math.hypot(P["cx"], P["cy"])
        i_th = lam / (2 * al) * gmag
        ok(abs(i_mod / i_th - 1) < 1e-6 and abs(P["c0"]) < 1e-9 and abs(P["cq"]) < 1e-9,
           "coin d'air : interfrange λ/2α × g (point source %g, %g mm)" % (xs * 1e3, ys * 1e3),
           "%.4f mm sur l'écran (formule %.4f mm), c0 = %.1e m" % (i_mod * 1e3, i_th * 1e3, P["c0"]))
    # 4. doublet : période du contraste en e = λ²/2Δλ
    es = np.linspace(0, 1.2e-3, 1201)
    C = np.array([contraste_spectral("na", 2 * e) for e in es])
    mins = [es[i] for i in range(1, len(es) - 1) if C[i] < C[i - 1] and C[i] < C[i + 1]]
    per = np.mean(np.diff(mins))
    th = 589.3e-9 ** 2 / (2 * (589.592 - 588.995) * 1e-9)
    cmin = min(C[[es.tolist().index(m) for m in mins]])
    ok(abs(per / th - 1) < 0.01 and abs(cmin - 0.2 / 2.2) < 0.01,
       "doublet : période du contraste λ²/2Δλ, contraste (D₂ − D₁)/(D₂ + D₁) à l'anticoïncidence",
       "%.4f mm (formule %.4f mm), contraste minimal %.3f (0,2/2,2 = 0,091)" % (per * 1e3, th * 1e3, cmin))
    # 4 bis. le contraste tel que le rendu le calcule (enveloppes analytiques des raies) = quadrature sur le profil
    def contraste_rendu(sp, delta):
        z = sum(e["w"] * enveloppe(e["kappa"], e["rho"], delta) * np.exp(2j * np.pi * delta / (e["l"] * 1e-9))
                for e in tirage(spectre_de(sp), 1))
        return abs(z)
    ec = max(abs(contraste_rendu("na", 2 * e) - contraste_spectral("na", 2 * e)) for e in es[::40])
    ok(ec < 2e-3, "doublet : enveloppes du rendu = intégrale sur le profil", "écart max %.1e sur e de 0 à 1,2 mm" % ec)
    # 5. mercure : brouillage vers δ ≈ ℓc
    lc = 546.1e-9 ** 2 / 1e-9
    c1, c4, cr = contraste_spectral("hg", lc), contraste_spectral("hg", lc / 4), contraste_rendu("hg", lc)
    eh = max(abs(contraste_rendu("hgc", d) - contraste_spectral("hgc", d)) for d in np.linspace(0, 6e-4, 61))
    ok(eh < 2e-3, "mercure sans filtre : enveloppes du rendu = intégrale sur les profils", "écart max %.1e, δ de 0 à 0,6 mm" % eh)
    ok(c1 < 0.05 and c4 > 0.7 and cr < 0.08, "mercure : brouillage vers δ = ℓc = λ²/Δλ",
       "ℓc = %.3f mm ; contraste %.3f à ℓc (%.3f dans le rendu), %.2f à ℓc/4" % (lc * 1e3, c1, cr, c4))
    # 6. localisation : contraste écran nu < plan focal (source étendue)
    def visibilite(cfg, X, Y, N=400):
        z, s = 0, 0
        for xs, ys in points_source(cfg["source"]["rayon"], N, 5, 0):
            P = point_source(cfg, _rendu_nu(), xs, ys)
            d = P["c0"] + P["cx"] * X + P["cy"] * Y + P["cq"] * (X * X + Y * Y)
            z += np.exp(2j * np.pi * d / lam)
            s += 1
        return abs(z) / s
    depoli = {"d": 0.25 + ARM, "rayon": 0.015}
    pts = ((0.0, 0.0), (0.02, 0.01), (0.04, 0.0))
    vf = min(visibilite(dict(cfgs["lame d'air, plan focal 1 m"], source=depoli), X, Y) for X, Y in pts)
    vn = [visibilite(dict(cfgs["écran nu"], source=depoli), X, Y) for X, Y in pts]
    ok(vf > 0.99 and max(vn) < 0.5, "localisation : écran nu brouillé, plan focal net (dépoli Ø 30 mm)",
       "visibilité (monochromatique) %.3f au plan focal ; sur l'écran nu %s (centre, 22 mm, 40 mm)"
       % (vf, ", ".join("%.2f" % v for v in vn)))
    # 6 bis. le flou de rendu ne touche pas δ hors foyer (vision à l'œil devant un grand dépoli, plan focal 1 m)
    oeil, ret = _oeil(0.06, None)
    for nom, cfg, W in (("œil à l'infini, dépoli Ø 50 mm", {"spectre": "na", "source": {"d": 0.10 + ARM, "rayon": 0.025},
                         "miroirs": {"e": 1.5e-3, "ax": 0, "ay": 0, "R1": 0.015, "R2": 0.015}, "sortie": oeil,
                         "detecteur": {"d": ret}}, 0.07 * 0.017),
                        ("plan focal 1 m, dépoli Ø 50 mm", dict(cfgs["lame d'air, plan focal 1 m"], source={"d": 0.38, "rayon": 0.025}), 0.06)):
        ro = {"pixel": 2 * W / 440, "patch": 1.5 * 0.025 * math.sqrt(math.pi / 128), "lmoy": 589.3, "diffraction": True}
        pire_r = 0.0
        for xs, ys in ((0, 0), (0.012, -0.007), (-0.02, 0.01)):
            P, P0 = point_source(cfg, ro, xs, ys), point_source(cfg, _rendu_nu(), xs, ys)
            pire_r = max(pire_r, abs(P["cq"] / P0["cq"] - 1), abs(P["c0"] - P0["c0"]) / lam)
        ok(pire_r < 1e-3, "flou de rendu sans effet sur δ : " + nom, "écart relatif max %.1e (coefficient de r², c0 en λ)" % pire_r)
    # 7. écran collé à la lentille : franges plus fines qu'un pixel → éclairement uniforme, pas de moiré
    cfg = dict(cfgs["lame d'air, plan focal 1 m"], miroirs={"e": 3e-3, "ax": 1e-3, "ay": 0, "R1": 0.015, "R2": 0.015},
               detecteur={"d": ARM + 0.12 + 0.01})
    r = {"res": 64, "W": 0.06, "N": 48, "M": 4, "graine": 3}
    P = point_source(cfg, _rendu_nu(), 0, 0)
    per_pix = max(lam / math.hypot(P["cx"] + 2 * P["cq"] * x, P["cy"]) for x in (-0.015, 0, 0.015)) / (2 * r["W"] / r["res"])
    img = image(cfg, r)[..., 1]
    cen = img[24:40, 24:40]
    mod = (cen.max() - cen.min()) / (cen.max() + cen.min())
    ok(per_pix < 0.8 and mod < 0.02, "écran collé à la lentille, sans moiré",
       "période des franges %.2f pixel, modulation résiduelle %.4f" % (per_pix, mod))
    # 9. œil déplacé latéralement, à l'infini : la pupille ne regarde qu'une zone des miroirs, d'épaisseur e + α·x ;
    # le centre des anneaux (direction de l'axe) change d'ordre de 2αΔx/λ (anneaux qui naissent ou rentrent),
    # rien ne bouge pour une lame d'air parfaite. Phase de Σ √(I₁I₂) e^{2iπδ/λ} sur les points sources dont les
    # deux ondes passent la pupille, au point de la rétine de la direction de l'axe.
    def centre(cfg, N=800):
        ox, oy = _centre(cfg)
        # morceau de source vu à travers la pupille en ce point : centre du disque de l'œil affine en (xs, ys)
        def c(xs, ys):
            d = [d for d in point_source(cfg, _rendu_nu(), xs, ys)["b1"]["disques"] if d["nom"] == "oeil"][0]
            return np.array([d["cx"], d["cy"]]), d["r"]
        c0, r = c(0, 0)
        J = np.column_stack([(c(1e-3, 0)[0] - c0) / 1e-3, (c(0, 1e-3)[0] - c0) / 1e-3])
        s0 = np.linalg.solve(J, np.array([ox, oy]) - c0)
        rs = 1.5 * r / min(abs(np.linalg.eigvals(J)))
        z = 0
        for xs, ys in points_source(rs, N, 3, 0):
            xs, ys = xs + s0[0], ys + s0[1]
            P = point_source(cfg, _rendu_nu(), xs, ys)
            if all(math.hypot(ox - d["cx"], oy - d["cy"]) < d["r"] for d in P["b1"]["disques"] + P["b2"]["disques"]):
                z += math.sqrt(P["b1"]["I"] * P["b2"]["I"]) * np.exp(2j * np.pi * delta_parax(cfg, xs, ys, ox, oy) / lam)
        return z
    for al in (0.0, 1e-5):
        dd = []
        for h in (-0.006, 0.006):
            oe, rt = _oeil(0.10, None, ox=h)
            cfg = {"spectre": "na", "source": {"d": 0.10 + ARM, "rayon": 0.025}, "miroirs": {"e": 1e-3, "ax": al, "ay": 0, "R1": 0.015, "R2": 0.015},
                   "sortie": oe, "detecteur": {"d": rt}}
            dd.append(centre(cfg))
        dphi = np.angle(dd[1] / dd[0]) / (2 * np.pi) * lam
        th = 2 * al * 0.012
        ok(abs(abs(dphi) - th) < 0.1 * th + 2e-9, "œil déplacé de 12 mm à l'infini, α = %g µrad" % (al * 1e6),
           "variation de δ au centre %.1f nm (2αΔx = %.1f nm), soit %.2f anneau" % (abs(dphi) * 1e9, th * 1e9, abs(dphi) / lam))
    verifications_lames(ok)
    return res, pire


# ================= lames : géométrie exacte, écrite indépendamment du développement du cœur =================
def _psi_exact(theta, b1, b2, t, n, alpha=(0.0, 0.0)):
    """ΔΨ (bras 2 − bras 1) exact pour la direction dépliée theta (tangentes), chemins t (n cos r − cos θ) de chaque
    traversée aux directions exactes ; normales par matrices de rotation (numpy)."""
    def Rot(axe, a):
        axe = np.asarray(axe, float) / np.linalg.norm(axe)
        K = np.array([[0, -axe[2], axe[1]], [axe[2], 0, -axe[0]], [-axe[1], axe[0], 0]])
        return np.eye(3) + math.sin(a) * K + (1 - math.cos(a)) * K @ K
    ns = np.array([1.0, -1.0, 0.0]) / math.sqrt(2)
    nc = Rot([1, 1, 0], b1) @ Rot([0, 0, 1], b2) @ ns

    def F(axe, ex, ey, u, N):
        d = np.asarray(axe, float) + u[0] * np.asarray(ex, float) + u[1] * np.asarray(ey, float)
        c = abs(d @ N) / np.linalg.norm(d)
        return t * (math.sqrt(n * n - 1 + c * c) - c)
    u = np.asarray(theta, float)
    v = u + 2 * np.asarray(alpha, float)
    b2_ = F([0, -1, 0], [-1, 0, 0], [0, 0, 1], u, ns) + F([0, 1, 0], [-1, 0, 0], [0, 0, 1], v, ns) + F([1, 0, 0], [0, -1, 0], [0, 0, 1], v, ns)
    b1_ = F([-1, 0, 0], [0, -1, 0], [0, 0, 1], u, nc) + F([1, 0, 0], [0, -1, 0], [0, 0, 1], u, nc) + F([1, 0, 0], [0, -1, 0], [0, 0, 1], u, ns)
    return b2_ - b1_


def verifications_lames(ok):
    lam = 589.3e-9
    n = indice("bk7", 589.3)
    base = {"spectre": "na", "source": {"d": 0.25 + ARM, "rayon": 0.006}, "miroirs": {"e": 1e-4, "ax": 0, "ay": 0, "R1": 0.015, "R2": 0.015},
            "sortie": _sortie_lentille(1.0), "detecteur": {"d": ARM + 1.12}}
    # 8a. δ du verre (cœur, développement au 2e ordre) = ΔΨ exact à la direction du rayon, jusqu'à 70 mrad du centre
    pire = 0.0
    for b1, b2 in ((0, 5e-3), (5e-3, 0), (-4e-3, 7e-3), (8e-3, -3e-3)):
        cfg = dict(base, lames=LAMES(b1, b2, 0))
        for xs, ys in ((0, 0), (0.004, -0.003)):
            P, P0 = point_source(cfg, _rendu_nu(), xs, ys), point_source(base, _rendu_nu(), xs, ys)
            for X, Y in ((0, 0), (0.07, 0), (0, -0.07), (0.05, 0.05), (-0.03, 0.06)):
                th = P["b1"]["s"] * (X - P["b1"]["qx"]), P["b1"]["s"] * (Y - P["b1"]["qy"])
                dm = (delta_parax(cfg, xs, ys, X, Y) - delta_parax(base, xs, ys, X, Y))
                pire = max(pire, abs(dm - _psi_exact(th, b1, b2, 0.006, n)))
    ok(pire < 3e-9, "lames : développement du cœur = chemin exact dans le verre",
       "écart max %.2f nm (compensatrice tournée jusqu'à 8 mrad, champ jusqu'à 70 mrad)" % (pire * 1e9))
    # 8b. ordres de grandeur : décalage du contact et ellipse à 5 mrad
    cfg = dict(base, lames=LAMES(0, 5e-3, 0))
    P, P0 = point_source(cfg, _rendu_nu(), 0, 0), point_source(base, _rendu_nu(), 0, 0)
    dq = np.linalg.eigvalsh([[P["cxx"] - P0["cxx"], (P["cxy"] - P0["cxy"]) / 2], [(P["cxy"] - P0["cxy"]) / 2, P["cyy"] - P0["cyy"]]])
    e_ell = abs(dq[1] - dq[0]) / 0.19                       # δ ≈ 2e − e r²/f² : rapport des axes 0,9 quand |Δc| = 0,19 e/f²
    ok(15e-6 < P["c0"] - P0["c0"] < 25e-6 and 50e-6 < e_ell < 250e-6,
       "compensatrice tournée de 5 mrad (axe vertical)",
       "contact décalé de %.1f µm (δ), anneaux visiblement elliptiques (axes < 0,9) pour e < %.0f µm" % ((P["c0"] - P0["c0"]) * 1e6, e_ell * 1e6))
    # 8c. image fantôme : deux réflexions (compensatrice, séparatrice) = rotation de 2φ autour de l'intersection des
    # plans (φ : angle entre eux) ; un faisceau à l'angle γ de cet axe tourne de 2 sin γ sin φ (corde).
    pire = 0.0
    ns = np.array(NSEP)
    for b1, b2 in ((0, 5e-3), (5e-3, 0), (-4e-3, 7e-3)):
        Nc = np.array(normale_compensatrice(b1, b2))
        g = deviation_fantome(list(Nc))
        cp = Nc - 2 * (Nc @ ns) * ns                      # compensatrice vue par la séparatrice
        phi = math.acos(min(1.0, abs(cp @ ns)))
        axe = np.cross(ns, cp)
        axe /= np.linalg.norm(axe)
        gam = math.acos(abs(np.array([-1.0, 0, 0]) @ axe))
        pire = max(pire, abs(math.hypot(*g) / (2 * math.sin(gam) * math.sin(phi)) - 1))
    ok(pire < 2e-3, "image fantôme : déviation de 2 sin γ sin φ (deux réflexions)", "écart relatif max %.1e" % pire)
    # 8d. lamelle : 2(n − 1)ε en monochromatique ; en lumière blanche, frange achromatique à (n_g − 1)ε, pas (n − 1)ε
    ep = 1.7e-4
    cfgL = dict(base, miroirs=dict(base["miroirs"], e=0.0), lamelle=LAMELLE(2, (1, 0), -1.0, ep))
    el1, elL = trajet(cfgL, 1), trajet(cfgL, 2, {"lamelle": True})
    PL, P0 = point_source(cfgL, _rendu_nu(), 0, 0, el1, elL), point_source(cfgL, _rendu_nu(), 0, 0)
    nL = indice("d263", 589.3)
    ok(abs((PL["c0"] - P0["c0"]) - 2 * (nL - 1) * ep) < 1e-12, "lamelle (D 263 M) : retard 2(n − 1)ε à λ = 589 nm",
       "%.3f µm (formule %.3f µm)" % ((PL["c0"] - P0["c0"]) * 1e6, 2 * (nL - 1) * ep * 1e6))
    ls = np.linspace(400, 700, 1501)
    w = np.array([planck(l, 3200) * cie(l)[1] for l in ls])
    lref = spectre_de("bl")["lmoy"]
    cfgB = dict(cfgL, spectre="bl")
    el1, elL = trajet(cfgB, 1), trajet(cfgB, 2, {"lamelle": True})
    PL = point_source(cfgB, _rendu_nu(), 0, 0, el1, elL)
    Dl = np.array([dispersion(elL, l) - dispersion(el1, l) for l in ls])
    es = np.linspace(-1.4e-4, 0, 2801)                    # lamelle sur M2 : on rapproche M2 (e < 0)
    env = [abs(np.sum(w * np.exp(2j * np.pi * (2 * e + PL["c0"] + Dl) / (ls * 1e-9)))) for e in es]
    e_star = -es[int(np.argmax(env))]
    leff = float(np.sum(w * ls) / np.sum(w))
    ng = indice("d263", leff) + 2 * VERRES["d263"]["B"] / (leff * 1e-9) ** 2
    n_eff = indice("d263", leff)
    ok(abs(e_star / ((ng - 1) * ep) - 1) < 0.02 and abs(e_star / ((n_eff - 1) * ep) - 1) > 0.03,
       "lamelle en lumière blanche : frange achromatique retrouvée à (n_g − 1)ε",
       "chariotage %.1f µm ; (n_g − 1)ε = %.1f µm (n_g = %.4f), (n − 1)ε = %.1f µm (n = %.4f, λ moyenne %.0f nm)"
       % (e_star * 1e6, (ng - 1) * ep * 1e6, ng, (n_eff - 1) * ep * 1e6, n_eff, leff))
    # 8e. la même frange, telle que le rendu la calcule (bandes du continu, enveloppes centrées au retard de groupe)
    sp = spectre_de("bl")
    els = [(e, [dispersion(elL, e["l"]) - dispersion(el1, e["l"]), dispersion_groupe(elL, e["l"]) - dispersion_groupe(el1, e["l"])])
           for e in tirage(sp, 16)]

    def gamma_y(d):
        z = 0j
        for e, (dph, dg) in els:
            inv = 1e9 / e["l"]
            ph = (d + dph) * inv
            L = {"inv": inv, "ph": [ph - math.floor(ph)], "g": [dg - dph], "kappa": 0.0, "rho": e["rho"]}
            f = terme(L, 0.0, d + dph, 0, 0.0)
            z += (e["W"][1] * f[0] - e["V"][1] * f[1]) + 1j * (e["W"][1] * f[2] + e["V"][1] * f[3])
        return abs(z)
    er = -es[int(np.argmax([gamma_y(2 * e + PL["c0"]) for e in es[::4]])) * 4]
    ok(abs(er - e_star) < 0.5e-6, "lamelle en lumière blanche : le rendu (16 bandes) retrouve la frange au même chariotage",
       "%.2f µm (quadrature fine : %.2f µm)" % (er * 1e6, e_star * 1e6))
    # 8f. bandes du continu = spectre continu (quadrature fine), terme d'interférence de chaque canal
    lq = np.linspace(400, 700, 6001)[:-1] + 0.025
    wq = np.array([[planck(l, 3200) * c for c in cie(l)] for l in lq])
    pire = [0.0, 0.0, 0.0]
    for d in np.arange(0, 150e-6, 0.25e-6):
        ex = (wq * np.cos(2 * np.pi * d / (lq * 1e-9))[:, None]).sum(axis=0) / wq.sum(axis=0)
        bd = [0.0, 0.0, 0.0]
        for e in tirage(sp, 16):
            f = terme({"inv": 1e9 / e["l"], "ph": [(d * 1e9 / e["l"]) % 1.0], "g": [0.0], "kappa": 0.0, "rho": e["rho"]}, 0.0, d, 0, 0.0)
            for k in range(3):
                bd[k] += (e["W"][k] * f[0] - e["V"][k] * f[1]) / xyz_spectre(sp)[k]
        zone = 0 if d < 5e-6 else 1 if d < 20e-6 else 2
        pire[zone] = max(pire[zone], max(abs(bd[k] - ex[k]) for k in range(3)))
    ok(max(pire) < 0.012, "lumière blanche : 16 bandes = spectre continu (terme d'interférence de X, Y, Z)",
       "écart max %.4f (δ < 5 µm), %.4f (5-20 µm), %.4f (20-150 µm), en part de chaque canal" % tuple(pire))
    # 8g. compensatrice parallèle, œil sur les miroirs : la zone contrastée (là où δ ne dépend pas du point source)
    # ne bouge pas (les deux bras traversent les mêmes lames ; rayons décalés par les lames, cf. `trace`)
    oe, rt = _oeil(0.20, ARM + 0.20, R=0.0024, ox=-0.0008, oy=-0.0012)
    cfgO = {"spectre": "na", "source": {"d": 0.2, "rayon": 0.025}, "miroirs": {"e": 2.88e-3, "ax": -1.8e-4, "ay": 1.17e-4, "R1": 0.015, "R2": 0.015},
            "sortie": oe, "detecteur": {"d": rt}}
    ro = {"pixel": 5e-6, "patch": 0, "lmoy": 589.3, "diffraction": True}

    def zone(cfg):     # pixel X où ∇_ρs δ = 0 au point source vu par le centre de la pupille, ρs = A X + b (tirage)
        q, t = poly_delta(cfg, ro, trajet(cfg, 1), trajet(cfg, 2)), analyse_bras(trajet(cfg, 1), ro, 0.025)["tir"]
        A, bx, by = t["A"], t["bx"], t["by"]
        M = [[2 * q["sxx"] * A + q["cxsx"], q["sxy"] * A + q["cysx"]], [q["sxy"] * A + q["cxsy"], 2 * q["syy"] * A + q["cysy"]]]
        v = [-(q["sx"] + 2 * q["sxx"] * bx + q["sxy"] * by), -(q["sy"] + 2 * q["syy"] * by + q["sxy"] * bx)]
        return np.linalg.solve(M, v)
    z0, z1 = zone(cfgO), zone(dict(cfgO, lames=LAMES(0, 0, 0)))
    g_mir = 0.017 / (ARM + 0.20)                           # rétine / plan des miroirs (œil accommodé sur eux)
    ok(np.hypot(*(z1 - z0)) / g_mir < 0.3e-3, "compensatrice parallèle, œil sur les miroirs : zone contrastée inchangée",
       "écart %.2f mm sur les miroirs (ancien modèle des lames, rayons non décalés : 1,7 mm)" % (np.hypot(*(z1 - z0)) / g_mir * 1e3))


def main():
    if "--ecrire" in sys.argv:
        CONTROLES.write_text(json.dumps(generer_controles(), indent=1) + "\n")
        print("écrit", CONTROLES)
        return
    res, pire = verifications()
    n_ok = sum(1 for r in res if r[0])
    print("%d/%d vérifications ; écart Fresnel/exact max %.2f nm" % (n_ok, len(res), pire * 1e9))
    sys.exit(0 if n_ok == len(res) else 1)


if __name__ == "__main__":
    main()
