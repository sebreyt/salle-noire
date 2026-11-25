#!/usr/bin/env python3
# Créé par Claude
"""Référence Python du banc d'optique ( ; lot 1 : cœur et moteur géométrique).

Reproduit _app-banc-coeur.js opération pour opération (catalogue des éléments en primitives, séquence dépliée avec
miroir, tirage des rayons au même hasard à graine, tracé exact primitive par primitive, paraxial : conjugaisons,
diaphragme d'ouverture, enveloppe, faisceau gaussien ; faces transmission et Jones) : le test de concordance rejoue
app_banc_controles.json avec le JS (rayons, matrices et primitives à 1e-9). Conventions et modèle : en-tête du cœur JS.
Le moteur ondulatoire (propagation de Collins, FFT) viendra au lot 4.

+ vérifications physiques chiffrées (SPEC § 8, partie géométrique) : image de Gauss (mince, épaisse), stigmatisme
de la lentille idéale et du condenseur asphérique, aberration sphérique de la plan-convexe dans les deux sens (chiffres
du § 1), chromatisme longitudinal ≈ f'/V, rayon d'Airy 1,22 λ L/D, Bessel et Silbermann retrouvés sur les positions,
autocollimation dans le plan de l'objet (miroir droit et incliné), viseur, œil accommodé, Malus et quart d'onde,
réseau tourné, faisceau gaussien, tirage depuis l'objet éclairé sans biais (même flux que le tirage direct), visée
guidée sans biais et utile (lot 4a de : guide appris sur une passe pilote, contrôles avec guide fixé).

Usage :
    python3 app_banc_reference.py            # vérifications physiques
    python3 app_banc_reference.py --ecrire   # régénère app_banc_controles.json (jamais édité à la main)
"""
import json
import math
import sys
from pathlib import Path

import numpy as np

ICI = Path(__file__).resolve().parent
SRC = (ICI / ".." / "src").resolve()
sys.path.insert(0, str(ICI))
import app_michelson_reference as mich  # noqa: E402  (couleur, spectres, verre, hash)
import app_goniometre_reference as gonio  # noqa: E402  (plage d'accommodation des yeux)

CONTROLES = ICI / "app_banc_controles.json"
M32 = 0xFFFFFFFF


class K:
    SURF, IDEALE, MASQUE, DIFFUSEUR, RESEAU, MIROIR, JONES, FILTRE, PHASE, AIRY, DET = range(1, 12)


class F:
    DISQUE, RECT, FENTES, TROUS, LETTRE, GRILLE, REGLE, DEMIPLAN, PASTILLE, FIL, BIFENTES, RETICULE, DIAPO = range(1, 14)


# Diapos (lot 6d) : images de _app-banc-diapos.js (app_banc_diapos.py) ; T = intensité (texel le plus proche pour
# les rayons), A = √T (moyennée par maille pour le moteur ondulatoire). Fichier absent : diapos vierges (n = 0).
DIAPO_NOMS = ["siemens", "usaf", "fourier", "lune"]


def _charger_diapos():
    import base64
    p = SRC / "_app-banc-diapos.js"
    if not p.exists():
        return {"n": 0, "t": [], "a": []}
    d = json.loads(p.read_text().split("\n")[2])       # données sur la troisième ligne (app_banc_diapos.py)
    n, t = d["n"], []
    for nom in DIAPO_NOMS:
        oct_ = np.frombuffer(base64.b64decode(d["data"][d["noms"].index(nom)]), dtype=np.uint8).astype(float)
        t.append((oct_ / 255).reshape(n, n))
    return {"n": n, "t": t, "a": [np.sqrt(x) for x in t]}


DIAPOS = _charger_diapos()


NP, GRAND, EPS_T, TMAX = 15, 1e6, 1e-6, 1e7
ETA_RESEAU = [e / 2.46 for e in (1, 0.45, 0.2, 0.08)]
FILTRES = {"rouge": 1, "vert": 2, "bleu": 3, "interferentiel": 4}
VERRES = [None, "bk7"]
SQRT2 = math.sqrt(2)


# ================= hasard à graine =================
def graine_rayon(g, p, k):
    h = mich.hash32
    return h(h(h(g) ^ (p & M32)) ^ (k & M32))


class Alea:
    def __init__(self, s):
        self.s = s & M32

    def u(self):
        self.s = mich.hash32(self.s)
        return (self.s >> 8) / 16777216


def disque(u, v):
    """Point uniforme du disque unité depuis (u, v) ∈ [0, 1)² : application concentrique de Shirley et Chiu (cf. le cœur JS)."""
    a, b = 2 * u - 1, 2 * v - 1
    if a == 0 and b == 0:
        return 0.0, 0.0
    if abs(a) > abs(b):
        r, ph = a, math.pi / 4 * (b / a)
    else:
        r, ph = b, math.pi / 2 - math.pi / 4 * (a / b)
    return r * math.cos(ph), r * math.sin(ph)


VISE_R0 = 0.875


def vise(u, v, R, Rl):
    """Cible élargie (lot 4c de, cf. le cœur JS) : (x, y, aire / π de la densité) dans le disque
    utile R (r < VISE_R0, uniforme) prolongé jusqu'à Rl (anneau uniforme) ; Rl = 0 : disque seul."""
    dx, dy = disque(u, v)
    if not Rl > R:
        return R * dx, R * dy, R * R
    r = max(abs(2 * u - 1), abs(2 * v - 1))
    if r < VISE_R0:
        s = R / VISE_R0
        return s * dx, s * dy, s * s
    a = (Rl * Rl - R * R) / (1 - VISE_R0 * VISE_R0)
    s = math.sqrt(R * R + a * (r * r - VISE_R0 * VISE_R0)) / r
    return s * dx, s * dy, a


# ================= visée guidée (lot 4a de ; cf. le cœur JS) =================
GUIDE = {"n": 32, "alpha": 0.125, "compte": 10, "gain": 1.25}
GUIDE_SITES = 4


def f32(x):
    return float(np.float32(x))


def guide_paire(G, site, a, uv=None):
    """(u, v, 1/q) d'un site : deux tirages sans table ; avec table, b, c, u, v (alias), poids × 1/q."""
    T = G["t"][site] if G and site < GUIDE_SITES else None
    if T is None:
        u = a.u()
        v = a.u()
        f = 1
    else:
        b = a.u()
        c = a.u()
        u = a.u()
        v = a.u()
        n = T["n"]
        if b < G["alpha"]:
            i = math.floor(u * n) + n * math.floor(v * n)
        else:
            x = c * n * n
            j = math.floor(x)
            i = j if x - j < T["prob"][j] else T["alias"][j]
            u, v = (i % n + u) / n, (i // n + v) / n
        f = T["iq"][i]
    if uv is not None:
        uv[site] = (u, v)
    return u, v, f


def _agreger(h, n, m):
    f, hm = n // m, [0.0] * (m * m)
    for j in range(n):
        for i in range(n):
            hm[i // f + m * (j // f)] += h[i + n * j]
    return hm


def guide_tables(histos, n, alpha, carres=None):
    """Guide à partir d'histogrammes bruts (un par site, n × n cases, ou None) : probabilités, alias (Vose), facteurs 1/q.
    carres[s] = Σ y² des rayons pilotes du site s : résolution m ≤ n et choix des sites (cf. le cœur JS) ; sans : n, tous."""
    al, t = f32(alpha), []
    for s in range(GUIDE_SITES):
        h = histos[s] if s < len(histos) else None
        h = [max(0.0, x) for x in h] if h is not None else None
        tot = sum(h) if h is not None else 0.0
        if not tot > 0:
            t.append(None)
            continue
        m = n
        if carres is not None:
            neff = tot * tot / carres[s] if carres[s] > 0 else 0.0
            while m > 4 and neff < GUIDE["compte"] * sum(1 for x in _agreger(h, n, m) if x > 0):
                m //= 2
            h = _agreger(h, n, m)
            S = 0.0
            for x in h:
                S += (x / tot) * (x / tot)
            if not (neff > 1 and m * m * (S - 1 / neff) / (1 - 1 / neff) >= GUIDE["gain"]):
                t.append(None)
                continue
        N = m * m
        H = [x / tot for x in h]
        q = [x * N for x in H]
        iq = [1 / (al + (1 - al) * x) for x in q]
        prob, alias, pt, gd = [1.0] * N, list(range(N)), [], []
        for i in range(N):
            (pt if q[i] < 1 else gd).append(i)
        while pt and gd:
            lo, g = pt.pop(), gd.pop()
            prob[lo], alias[lo] = q[lo], g
            q[g] = q[g] + q[lo] - 1
            (pt if q[g] < 1 else gd).append(g)
        t.append({"n": m, "H": H, "prob": [f32(x) for x in prob], "alias": alias, "iq": iq})
    return {"n": n, "alpha": al, "t": t}


def guide_cpu(seq, rendu, n=None, alpha=None):
    """Passe pilote sur le processeur : Σ w·Y (et Σ (w·Y)²) des rayons détectés dans la fenêtre, par case de chaque site,
    puis guide_tables. Les rayons suivent le guide déjà posé (seq["guide"]) : sans biais."""
    n = n or GUIDE["n"]
    W, cx, cy = rendu["W"], rendu.get("cx", 0), rendu.get("cy", 0)
    histos = [[0.0] * (n * n) for _ in range(GUIDE_SITES)]
    carres = [0.0] * GUIDE_SITES
    if seq.get("iDet", -1) >= 0 and seq["prims"]:
        for k in range(rendu["Nr"]):
            r = tirer(seq, rendu.get("graine", 1), rendu.get("passe", 0), k, rendu["Nr"])
            s = suivre(seq, r, r["alea"])
            if s["etat"] != "detecte" or not (abs(r["x"] - cx) < W and abs(r["y"] - cy) < W):
                continue
            y = r["w"] * r["f"][1]
            for site in sorted(r["uv"]):
                if site < GUIDE_SITES:
                    u, v = r["uv"][site]
                    histos[site][math.floor(u * n) + n * math.floor(v * n)] += y
                    carres[site] += y * y
    return guide_tables(histos, n, GUIDE["alpha"] if alpha is None else alpha, carres)


# ================= couleur, verre, spectres =================
def planck_u(l, T):
    u = l * 1e-3
    return 1 / (u * u * u * u * u * (math.exp(14388 / (u * T)) - 1))


def n_verre(v, l):
    return mich.indice(VERRES[v], l) if v else 1


_SP = {}
# λ d'un continu tirée selon Planck·(ȳ + x·x̄ + z·z̄), table inverse de nq quantiles (comme TIRAGE_L du cœur)
TIRAGE_L = {"x": 0.3, "z": 1, "nq": 128}


def quantiles_tirage(g, G, a, b):
    n, Q, i, cum = len(g), [a], 0, 0.0
    h = (b - a) / n
    for j in range(1, TIRAGE_L["nq"] - 1):
        cible = G * j / (TIRAGE_L["nq"] - 1)
        while i < n - 1 and cum + g[i] < cible:
            cum += g[i]
            i += 1
        Q.append(a + h * (i + (min(max((cible - cum) / g[i], 0), 1) if g[i] > 0 else 0)))
    Q.append(b)
    return Q


def lambda_continu(sp, u):
    Q = sp["Q"]
    m = len(Q) - 1
    t = u * m
    i = min(math.floor(t), m - 1)
    dq = Q[i + 1] - Q[i]
    l = Q[i] + (t - i) * dq
    return l, planck_u(l, sp["T"]) / sp["normP"] * dq * m / (sp["b"] - sp["a"])


def spectre_tirage(nom):
    if nom in _SP:
        return _SP[nom]
    sp = mich.SPECTRES[nom]
    if "continu" in sp:
        a, b = sp["continu"]
        n, s, g, G = 4096, 0.0, [], 0.0
        for i in range(n):
            l = a + (b - a) * (i + 0.5) / n
            pl, c = planck_u(l, sp["T"]), mich.cie(l)
            s += pl * c[1]
            g.append(pl * (c[1] + TIRAGE_L["x"] * c[0] + TIRAGE_L["z"] * c[2]))
            G += g[i]
        out = {"type": 0, "a": a, "b": b, "T": sp["T"], "normP": s / n, "Q": quantiles_tirage(g, G, a, b)}
    else:
        tot = 0.0
        for r in sp["raies"]:
            tot += r["poids"]
        Y, c, cum, ls = 0.0, 0.0, [], []
        for r in sp["raies"]:
            c += r["poids"] / tot
            cum.append(c)
            ls.append(r["l"])
            Y += r["poids"] / tot * mich.cie(r["l"])[1]
        cum[-1] = 1
        out = {"type": 1, "l": ls, "cum": cum, "norm": 1 / Y, "n": len(ls)}
    _SP[nom] = out
    return out


def facteur_xyz(sp, l):
    c = mich.cie(l)
    k = planck_u(l, sp["T"]) / sp["normP"] if sp["type"] == 0 else sp["norm"]
    return [c[0] * k, c[1] * k, c[2] * k]


def trans_filtre(kind, l):
    if kind >= 10:
        return 10.0 ** (10 - kind)
    if kind == 1:
        return 0.85 / (1 + math.exp(-(l - 600) / 8))
    mu = 530 if kind == 2 else 450 if kind == 3 else 546
    fw = 10 if kind == 4 else 80
    t = (l - mu) / (fw / 2.3548200450309493)
    return (0.6 if kind == 4 else 0.75) * math.exp(-0.5 * t * t)


# ================= tache d'Airy =================
def bessel_j(n, v):
    Kq = 400
    t = math.pi * (np.arange(Kq) + 0.5) / Kq
    return float(np.cumsum(np.cos(n * t - v * np.sin(t)))[-1]) / Kq


def _airy():
    vs, ee = [], []
    v = 0.0
    while v <= 60:
        j0, j1 = bessel_j(0, v), bessel_j(1, v)
        vs.append(v)
        ee.append(1 - j0 * j0 - j1 * j1)
        v += 0.02
    out, k = [], 0
    for i in range(128):
        cible = 0.97 * i / 127
        while k < len(ee) - 2 and ee[k + 1] < cible:
            k += 1
        a, b = ee[k], ee[k + 1]
        out.append(vs[k] + ((cible - a) / (b - a) if b > a else 0) * (vs[k + 1] - vs[k]))
    return out


AIRY = _airy()


# ================= lentilles =================
def sag(c, k, h):
    x = 1 - (1 + k) * c * c * h * h
    return c * h * h / (1 + math.sqrt(x if x > 0 else 0))


def concevoir(f, D, forme):
    n = mich.indice("bk7", 587.6)
    h, te = D / 2, 2
    c1 = c2 = k1 = k2 = 0.0
    if forme == "bicv":
        c = 1 / (2 * (n - 1) * f)
        for _ in range(40):
            t = te + 2 * sag(c, 0, h)
            a, b = (n - 1) * (n - 1) * t / n, 2 * (n - 1)
            c = (b - math.sqrt(b * b - 4 * a / f)) / (2 * a)
        c1, c2 = c, -c
        t = te + 2 * sag(c, 0, h)
    elif forme == "bicc":
        t = te
        a, b = (n - 1) * (n - 1) * t / n, 2 * (n - 1)
        c = (-b + math.sqrt(b * b - 4 * a / f)) / (2 * a)
        c1, c2 = -c, c
    else:
        c1 = 1 / ((n - 1) * f)
        if forme == "asph":
            k1 = -n * n
        t = te + sag(c1, k1, h)
    return {"f": f, "D": D, "h": h, "c1": c1, "k1": k1, "c2": c2, "k2": k2, "t": t, "forme": forme}


def retourner_lentille(L):
    return dict(L, c1=-L["c2"], k1=L["k2"], c2=-L["c1"], k2=L["k1"])


_LENT = {}


def lentille(f, D, forme=None, retournee=False):
    forme = forme or ("bicv" if f > 0 else "bicc")
    cle = (f, D, forme, bool(retournee))
    if cle not in _LENT:
        L = concevoir(f, D, forme)
        _LENT[cle] = retourner_lentille(L) if retournee else L
    return _LENT[cle]


# ================= primitives =================
def prim(k, dz, R, Sm, p=None, ap=None):
    q = [0.0] * NP
    for i, v in enumerate(p or []):
        if v is not None:
            q[i] = v
    return {"k": k, "dz": dz, "R": R, "Sm": Sm, "p": q, "ap": list(ap) if ap else [R, R]}


def rayon_forme(f, a):
    if f == F.DISQUE:
        return a[0]
    if f == F.RECT:
        return 0.5 * math.sqrt(a[0] * a[0] + a[1] * a[1])
    if f == F.FENTES:
        lx = (a[0] - 1) * a[2] + a[1]
        return 0.5 * math.sqrt(lx * lx + a[3] * a[3])
    if f == F.TROUS:
        return 0.5 * ((a[0] - 1) * a[2] + a[1])
    if f == F.LETTRE:
        return math.sqrt(136) * a[0]
    if f == F.GRILLE:
        return a[2] * SQRT2
    if f == F.REGLE:
        return math.sqrt((a[0] + 2) * (a[0] + 2) + a[2] * a[2])
    if f in (F.PASTILLE, F.FIL):
        return a[1]
    if f == F.BIFENTES:
        am = 2 * max(a[7], 2 - a[7]) * a[5] + max(a[0], a[1], a[2]) + a[3]
        return 0.5 * math.sqrt(am * am + a[4] * a[4])
    if f == F.RETICULE:
        return a[3]
    if f == F.DIAPO:
        return a[1] * SQRT2
    return GRAND


def ap_rect(hx, hy, rot):
    c, s = abs(math.cos(rot)), abs(math.sin(rot))
    return [min(hx / c if c > 1e-12 else GRAND, hy / s if s > 1e-12 else GRAND),
            min(hx / s if s > 1e-12 else GRAND, hy / c if c > 1e-12 else GRAND)]


def masque(forme, a, Sm, dz=0, rot=0):
    r = min(rayon_forme(forme, a), Sm * SQRT2)
    if forme in (F.DISQUE, F.RETICULE):
        ap = [r, r]
    elif forme == F.RECT:
        ap = ap_rect(a[0] / 2, a[1] / 2, rot or 0)
    elif forme == F.FENTES and a[0] <= 1:
        ap = ap_rect(a[1] / 2, a[3] / 2, rot or 0)
    elif forme in (F.PASTILLE, F.FIL, F.DEMIPLAN):
        ap = [Sm, Sm]
    elif forme == F.DIAPO:              # carré de demi-côté a[1] (le rayon circonscrit élargissait le faisceau de √2)
        ap = ap_rect(a[1], a[1], rot or 0)
    else:
        ap = [r, r]
    P = prim(K.MASQUE, dz or 0, GRAND, Sm, [forme] + list(a), ap)
    P["rc"] = r
    return P


def prims_lentille(L, o, dz=0, Sm=None):
    Sm = Sm or L["h"] + 8
    if o["optique"] != "reelle":
        return [prim(K.IDEALE, dz, L["h"], Sm, [L["f"]])]
    return [prim(K.SURF, dz - L["t"] / 2, L["h"], Sm, [L["c1"], L["k1"], 0, 1]),
            prim(K.SURF, dz + L["t"] / 2, L["h"], Sm, [L["c2"], L["k2"], 1, 0])]


def detecteur(dz, Sm, hy, forme=0, a=None):
    p = [forme or 0] + list(a or [0] * 8)
    while len(p) < 9:
        p.append(0)
    p.append(hy)
    return prim(K.DET, dz, GRAND, Sm, p, [Sm, hy])


# Filament spiralé de la lanterne (cœur : FILAMENT, xFilament, dansFilament, aireSource) : n spires, fil plein sur la
# fraction `plein` du pas, spires penchées de `pente` ; luminance 1 sur le fil. Moteur géométrique seulement.
FILAMENT = {"n": 7, "plein": 0.6, "pente": 0.25}


def x_filament(em, u, ys):
    f = em["fil"]
    p, k = em["a"] / f["n"], min(f["n"] - 1, math.floor(u * f["n"]))
    return (k - 0.5 * (f["n"] - 1)) * p + f["pente"] * ys + (u * f["n"] - k - 0.5) * f["plein"] * p


def dans_filament(em, x, y):
    f = em["fil"]
    p = em["a"] / f["n"]
    xc = x - f["pente"] * y
    k = math.floor(xc / p + 0.5 * (f["n"] - 1) + 0.5)
    return abs(y) < 0.5 * em["b"] and 0 <= k < f["n"] and abs(xc - (k - 0.5 * (f["n"] - 1)) * p) < 0.5 * f["plein"] * p


def aire_source(em):
    return em["a"] * em["b"] * (em["fil"]["plein"] if em.get("fil") else 1) if em["forme"] == "rect" else math.pi * em["a"] * em["a"]


def axe_bifentes(t):
    """Bifentes côte à côte le long de x, centrées en hauteur : rang de la bifente sur l'axe (la seule découverte,
    sinon celle du milieu)."""
    n, r = 0, 1
    for i in range(3):
        if not (t and t[i]):
            n, r = n + 1, i
    return r if n == 1 else 1


def bits(t):
    b = 0
    for i in range(3):
        if t and t[i]:
            b |= 1 << i
    return b


def prims_oeil(p, o, el=None):
    Pf = gonio.foyer({"type": p.get("type") or "normal", "mode": p.get("mode") or "curseur", "acc": p.get("acc") or 0,
                      "mi": p.get("mi") or 0}, p.get("cible") or 0)
    V = 1 / 17 + Pf / 1000
    pup = o.get("pupille") or p.get("pupille") or 4       # banc.pupille : pupille stationnaire (réalisme R3)
    return [masque(F.DISQUE, [pup / 2], 30), prim(K.IDEALE, 0, 6, 30, [1 / V]), detecteur(o["sens"] * 17, 12, 12)]


def _viseur(p, o, el):
    return (prims_lentille(lentille(50, 20, "bicv"), o, 0, 15) + [masque(F.RETICULE, [0, 0.01, 0.1, 6], 10, 100)]
            + prims_lentille(lentille(25, 15, "pcv", True), o, 125, 12))


def prims_objectif_lunette(o):
    """Objectif de la lunette : en optique réelle, foyer image à 587,6 nm sur le réticule (cœur : primsObjectifLunette)."""
    L, n = lentille(200, 30, "pcv"), mich.indice("bk7", 587.6)
    return prims_lentille(L, o, L["t"] / n - L["t"] / 2 if o["optique"] == "reelle" else 0, 22)


def _lunette(p, o, el):
    return ((prims_lentille(lentille(100, 30, "pcv"), o, -15, 20) if p.get("bonnette") else [])
            + prims_objectif_lunette(o) + [masque(F.RETICULE, [1, 0.01, 0.1, 6], 10, 200)]
            + prims_lentille(lentille(20, 15, "pcv", True), o, 220, 12))



def _nom_spectrale(p):
    return "na" if p["gaz"] == "na" else ("hg" if p["filtre"] else "hgc")


def prims_condenseur(o):
    """Condenseur de la lanterne : tirage compté depuis son plan principal objet (sommet de la face bombée), dans les
    deux optiques (cœur : primsCondenseur)."""
    L = lentille(60, 50, "asph")
    return prims_lentille(L, o, L["t"] / 2 if o["optique"] == "reelle" else 0, 32)


def emission_laser(p):    # He-Ne 632,8 nm, 0,8 mm ; vert : 532 nm, 1 mm ; 1 mW (comme le cœur)
    l, a = (532, 0.5) if p.get("vert") else (632.8, 0.4)
    return {"forme": "gauss", "a": a, "b": l * 1e-6 / (math.pi * a), "dz": 0, "spectre": "laserVert" if p.get("vert") else "laser",
            "L": 1e6 * mich.flux_laser(l)}


TYPES = {
    "lanterne": {"tiroir": "sources", "source": True, "boitier": True, "defaut": {"tirage": 70, "cond": "cond", "emet": "filament"},
                 "emission": lambda p: {"forme": "rect", "a": 4, "b": 2, "dz": -p["tirage"], "spectre": "bl", "L": mich.luminance_source("bl"),
                                        **({} if p["emet"] == "carre" else {"fil": FILAMENT})},
                 "prims": lambda p, o, el: ([] if p["cond"] == "rien" else [prim(K.DIFFUSEUR, 0, 25, 32, [])] if p["cond"] == "depoli"
                                            else prims_condenseur(o))},
    "spectrale": {"tiroir": "sources", "source": True, "defaut": {"gaz": "na", "filtre": False},
                  "emission": lambda p: {"forme": "disque", "a": 7.5, "b": 0, "dz": 0,
                                         "spectre": _nom_spectrale(p), "L": mich.luminance_source(_nom_spectrale(p))},
                  "prims": lambda p, o, el: []},
    "laser": {"tiroir": "sources", "source": True, "defaut": {"vert": False},
              "emission": lambda p: emission_laser(p),
              "prims": lambda p, o, el: []},
    "lettreF": {"tiroir": "objets", "objet": True, "plaque": {"forme": F.LETTRE, "a": [1], "Sm": 30}, "defaut": {},
                "prims": lambda p, o, el: [masque(F.LETTRE, [1], 30)]},
    "quadrillage": {"tiroir": "objets", "objet": True, "defaut": {},
                    "prims": lambda p, o, el: [masque(F.GRILLE, [1, 0.1, 20, 5, 0.2], 30)]},
    "regle": {"tiroir": "objets", "objet": True, "defaut": {},
              "prims": lambda p, o, el: [masque(F.REGLE, [25, 0.01, 5, 0.1], 30)]},
    "depoli": {"tiroir": "objets", "objet": True, "defaut": {},
               "prims": lambda p, o, el: [prim(K.DIFFUSEUR, 0, 25, 32, [])]},
    "fenteSource": {"tiroir": "objets", "objet": True, "orientable": True, "defaut": {"b": 0.1},
                    "prims": lambda p, o, el: [masque(F.RECT, [p["b"], 10], 25, 0, el.get("rot"))]},
    "trouSource": {"tiroir": "objets", "objet": True, "plaque": {"forme": F.DISQUE, "a": lambda p: [p["d"] / 2], "Sm": 25}, "defaut": {"d": 0.1},
                   "prims": lambda p, o, el: [masque(F.DISQUE, [p["d"] / 2], 25)]},
    "iris": {"tiroir": "objets", "defaut": {"D": 20}, "prims": lambda p, o, el: [masque(F.DISQUE, [p["D"] / 2], 35)]},
    "diapo": {"tiroir": "objets", "objet": True, "defaut": {"image": "siemens", "eclairee": False},
              "prims": lambda p, o, el: ([prim(K.DIFFUSEUR, -1, 15, 25, [])] if p["eclairee"] else [])
              + [masque(F.DIAPO, [max(0, DIAPO_NOMS.index(p["image"]) if p["image"] in DIAPO_NOMS else -1), 10], 25)]},
    "couteau": {"tiroir": "objets", "orientable": True, "defaut": {"xc": 0},
                "prims": lambda p, o, el: [masque(F.DEMIPLAN, [p["xc"]], 30)]},
    "lentille": {"tiroir": "lentilles", "defaut": {"f": 200, "D": 40, "forme": "bicv", "retournee": False},
                 "prims": lambda p, o, el: ([prim(K.IDEALE, 0, p["D"] / 2, p["D"] / 2 + 8, [p["f"]])] if p["forme"] == "objectif"
                                            else prims_lentille(lentille(p["f"], p["D"], p["forme"], p["retournee"]), o))},
    "condenseur": {"tiroir": "lentilles", "defaut": {"retournee": False},
                   "prims": lambda p, o, el: prims_lentille(lentille(60, 50, "asph", p["retournee"]), o, 0, 32)},
    "miroir": {"tiroir": "lentilles", "miroir": True, "defaut": {}, "prims": lambda p, o, el: [prim(K.MIROIR, 0, 25, 32, [])]},
    "fente": {"tiroir": "young", "orientable": True, "defaut": {"e": 0.1},
              "prims": lambda p, o, el: [masque(F.FENTES, [1, p["e"], 0, 10], 25, 0, el.get("rot"))]},
    "trou": {"tiroir": "young", "defaut": {"d": 0.2}, "prims": lambda p, o, el: [masque(F.DISQUE, [p["d"] / 2], 25)]},
    "bifentes": {"tiroir": "young", "orientable": True,
                 "defaut": {"a": [0.2, 0.25, 0.3], "e": 0.06, "h": 5, "pas": 7, "caches": [False, False, False]},
                 "prims": lambda p, o, el: [masque(F.BIFENTES, [p["a"][0], p["a"][1], p["a"][2], p["e"], p["h"], p["pas"], bits(p["caches"]), axe_bifentes(p["caches"])], 25)]},
    "trousYoung": {"tiroir": "young", "defaut": {"a": 0.5, "d": 0.1},
                   "prims": lambda p, o, el: [masque(F.TROUS, [2, p["d"], p["a"]], 25)]},
    "fentesMultiples": {"tiroir": "young", "orientable": True, "defaut": {"n": 2, "e": 0.04, "pas": 0.2},
                        "prims": lambda p, o, el: [masque(F.FENTES, [p["n"], p["e"], p["pas"], 5], 25)]},
    "reseau": {"tiroir": "young", "orientable": True, "defaut": {"n": 300},
               "prims": lambda p, o, el: [prim(K.RESEAU, 0, 12.5, 25, [1 / p["n"]])]},
    "fil": {"tiroir": "young", "orientable": True, "defaut": {"w": 0.07},
            "prims": lambda p, o, el: [masque(F.FIL, [p["w"], 15], 25)]},
    "filtre": {"tiroir": "filtres", "defaut": {"couleur": "vert"},
               "prims": lambda p, o, el: [prim(K.FILTRE, 0, 20, 30, [FILTRES.get(p["couleur"]) or 2])]},
    "densite": {"tiroir": "filtres", "defaut": {"d": 2},
                "prims": lambda p, o, el: [prim(K.FILTRE, 0, 20, 30, [10 + int(p["d"])])]},
    "polariseur": {"tiroir": "polarisation", "orientable": True, "polarisant": True, "defaut": {},
                   "prims": lambda p, o, el: [prim(K.JONES, 0, 20, 30, [1, el.get("rot") or 0])]},
    "lame": {"tiroir": "polarisation", "orientable": True, "polarisant": True, "defaut": {"ordre": "quart"},
             "prims": lambda p, o, el: [prim(K.JONES, 0, 12.5, 25, [2, el.get("rot") or 0, math.pi if p["ordre"] == "demi" else math.pi / 2, 546.07])]},
    "grilleCroisee": {"tiroir": "fourier", "objet": True, "defaut": {"pas": 0.25, "w": 0.05},
                      "prims": lambda p, o, el: [masque(F.GRILLE, [p["pas"], p["w"], 10, 0, 0], 25)]},
    "objetPhase": {"tiroir": "fourier", "objet": True, "defaut": {"forme": "goutte", "phi": 1},
                   "prims": lambda p, o, el: [prim(K.PHASE, 0, 10, 25, [2 if p["forme"] == "lettre" else 1, p["phi"], 1.2])]},
    "pastille": {"tiroir": "fourier", "defaut": {"d": 0.5}, "prims": lambda p, o, el: [masque(F.PASTILLE, [p["d"] / 2, 15], 25)]},
    "ecran": {"tiroir": "observer", "detecteur": True, "oriente": True, "plaque": {"forme": 0, "a": [], "Sm": 100}, "defaut": {},
              "prims": lambda p, o, el: [detecteur(0, 100, 100)], "vue": lambda s: [-s, 1]},
    "capteur": {"tiroir": "observer", "detecteur": True, "oriente": True, "defaut": {},
                "prims": lambda p, o, el: [detecteur(0, 3.2, 2.4)], "vue": lambda s: [-s, -1]},
    "oeil": {"tiroir": "observer", "detecteur": True, "oriente": True, "defaut": {"type": "normal", "mode": "curseur", "acc": 0, "pupille": 4},
             "prims": prims_oeil, "vue": lambda s: [-s, -1]},
    "viseur": {"tiroir": "observer", "instrument": True, "oeilApres": 156.25, "frontale": 100, "defaut": {"oeil": "integre", "ox": 0, "oy": 0}, "prims": _viseur},
    "lunette": {"tiroir": "observer", "instrument": True, "oeilApres": 242, "defaut": {"bonnette": False, "oeil": "integre", "ox": 0, "oy": 0}, "prims": _lunette},
}


def params(el):
    p = dict(TYPES[el["type"]]["defaut"])
    p.update(el.get("params") or {})
    return p


def repere(el):
    r = el.get("rot") or 0
    incl = el.get("incl")
    ax = (incl and incl[0]) or 0
    ay = (incl and incl[1]) or 0
    cr, sr, ca, sa, cb, sb = math.cos(r), math.sin(r), math.cos(ax), math.sin(ax), math.cos(ay), math.sin(ay)

    def rxy(v):
        w = [v[0], ca * v[1] - sa * v[2], sa * v[1] + ca * v[2]]
        return [cb * w[0] + sb * w[2], w[1], -sb * w[0] + cb * w[2]]
    return {"O": [el.get("x") or 0, el.get("y") or 0, el["z"]], "ex": rxy([cr, sr, 0]), "ey": rxy([-sr, cr, 0]), "ez": rxy([0, 0, 1])}


# ================= séquence =================
def retourner_prim(pr):
    q = {"k": pr["k"], "dz": pr["dz"], "R": pr["R"], "Sm": pr["Sm"], "p": list(pr["p"]), "ap": pr["ap"], "rc": pr.get("rc")}
    if q["k"] == K.SURF:
        q["p"][2], q["p"][3] = pr["p"][3], pr["p"][2]
    return q


def rayon_utile(pr):
    if pr["k"] == K.MASQUE:
        return pr["rc"]
    if pr["k"] == K.DET:
        return max(pr["Sm"], pr["p"][9]) * SQRT2
    return pr["R"]


def centre_plan(pr):
    return [pr["O"][i] + pr["dz"] * pr["ez"][i] for i in range(3)]


def elargir(P, i_det, j0, S0, a_s, C, pc=None):
    """Rayon Rl de la cible élargie (lot 4c ; 0 : rien à élargir) : cônes émetteur (S0, a_s) → monture des primitives
    qui dévient ou détectent, jusqu'au détecteur ou au premier miroir, dans le plan de la cible C ; pc : primitive dont
    C est le plan, un masque plan droit dont la plaque couvre Rl n'est pas élargi (cf. le cœur JS)."""
    Rl = 0.0
    for m in range(j0, len(P)):
        pk = P[m]
        if pk["sens"] < 0:
            break
        airy = m + 1 < len(P) and P[m + 1]["k"] == K.AIRY
        if not (pk["k"] == K.AIRY or (pk["k"] in (K.MASQUE, K.FILTRE, K.JONES) and not airy)):
            Pk = centre_plan(pk)
            Rk = rayon_utile(pk) if pk["k"] == K.DET else pk["Sm"] * SQRT2
            L = Pk[2] - Rk * math.sqrt(pk["ez"][0] * pk["ez"][0] + pk["ez"][1] * pk["ez"][1]) - S0[2]
            if L > 1e-6:
                t = (C[2] - S0[2]) / L
                ox, oy = S0[0] + t * (Pk[0] - S0[0]) - C[0], S0[1] + t * (Pk[1] - S0[1]) - C[1]
                Rl = max(Rl, math.sqrt(ox * ox + oy * oy) + a_s * abs(1 - t) + abs(t) * Rk)
        if m == i_det or pk["k"] == K.MIROIR:
            break
    if pc is not None and pc["k"] == K.MASQUE and not pc["ez"][0] and not pc["ez"][1] and 1.02 * Rl <= pc["Sm"]:
        return 0.0
    return 1.02 * Rl if Rl > 1.001 * abs(C[3]) else 0.0


def sequence(banc):
    optique = "reelle" if banc.get("optique") == "reelle" else "parfaite"
    els = [e for _, e in sorted(((j, e) for j, e in enumerate(banc.get("elements") or []) if e["type"] in TYPES),
                                key=lambda o: (o[1]["z"], o[0]))]
    src = next((e for e in els if TYPES[e["type"]].get("source")), None)
    if src is None:
        return {"vide": "source", "prims": []}
    etapes, det, mir, implicite = [{"el": src, "sens": 1}], None, None, None
    for e in els:
        T = TYPES[e["type"]]
        if e is src or not e["z"] > src["z"]:
            continue
        if T.get("source"):
            break
        etapes.append({"el": e, "sens": 1})
        if T.get("detecteur"):
            det = e
            break
        if T.get("miroir"):
            mir = e
            break
    if mir is not None:
        for e in reversed(els):
            T = TYPES[e["type"]]
            if e is mir or not e["z"] < mir["z"] or not e["z"] > src["z"]:
                continue
            if T.get("source"):
                break
            if T.get("plaque"):
                etapes.append({"el": e, "sens": -1, "plaque": True})
                det = e
                break
            etapes.append({"el": e, "sens": -1})
    elif det is None:
        der = etapes[-1]["el"]
        Td = TYPES[der["type"]]
        pd = params(der)
        integre = bool(Td.get("instrument")) and pd.get("oeil") != "aucun"
        implicite = {"type": "oeil", "id": "oeil",
                     "z": der["z"] + Td["oeilApres"] if integre else max(banc.get("longueur") or 2000, der["z"] + 250),
                     "x": (der.get("x") or 0) + (pd.get("ox") or 0 if integre else 0), "y": (der.get("y") or 0) + (pd.get("oy") or 0 if integre else 0),
                     "params": {"type": "normal", "mode": "repos"}}
        etapes.append({"el": implicite, "sens": 1})
        det = implicite
    prims, jones, objet, i_det = [], False, -1, -1
    for et in etapes:
        el = et["el"]
        Ty = TYPES[el["type"]]
        p, fr, o = params(el), repere(el), {"optique": optique, "sens": et["sens"], "pupille": banc.get("pupille")}
        if et.get("plaque"):
            pl = Ty["plaque"]
            L = [detecteur(0, pl["Sm"], pl["Sm"], pl["forme"], pl["a"](p) if callable(pl["a"]) else pl["a"])]
        else:
            L = Ty["prims"](p, o, el) or []
            if et["sens"] < 0 and not Ty.get("oriente"):
                L = [retourner_prim(x) for x in reversed(L)]
        for pr in L:
            pr.update(O=fr["O"], ex=fr["ex"], ey=fr["ey"], ez=fr["ez"], sens=et["sens"], el=el["id"], type=el["type"])
            prims.append(pr)
        if Ty.get("polarisant"):
            jones = True
        if Ty.get("objet") and not et.get("plaque") and L:
            objet = len(prims) - 1
        if det is el and L:
            i_det = len(prims) - 1
    Ts = TYPES[src["type"]]
    em, frs = Ts["emission"](params(src)), repere(src)
    seq = {"optique": optique, "prims": prims, "jones": jones, "objet": objet, "iDet": i_det,
           "miroir": mir["id"] if mir else None, "etapes": [{"id": et["el"]["id"], "sens": et["sens"]} for et in etapes],
           "source": {"el": src["id"], "em": em, "fr": frs, "sp": spectre_tirage(em["spectre"]), "nomSpectre": em["spectre"]}}
    if det is not None:
        seq["vue"] = [1, 1] if etapes[-1].get("plaque") else TYPES[det["type"]]["vue"](etapes[-1]["sens"])
    else:
        seq["vue"] = [1, 1]
    z_prec, s = src["z"] + em["dz"], 0.0
    for pr in prims:
        pr["zp"] = pr["O"][2] + pr["dz"]
        s += abs(pr["zp"] - z_prec)
        pr["s"] = s
        z_prec = pr["zp"]
    seq["zEm"] = src["z"] + em["dz"]
    seq["stop"] = None
    if i_det >= 0:
        ouv = ouverture(seq, 587.6, objet)
        seq["stop"] = ouv
        if optique == "reelle" and ouv:
            ps = prims[ouv["i"]]
            A = prim(K.AIRY, ps["dz"], GRAND, GRAND, [ouv["D"]])
            A.update(O=ps["O"], ex=ps["ex"], ey=ps["ey"], ez=ps["ez"], sens=ps["sens"], el=ps["el"], type="airy", zp=ps["zp"], s=ps["s"])
            prims.insert(ouv["i"] + 1, A)
            if objet > ouv["i"]:
                objet += 1
                seq["objet"] = objet
            i_det += 1
            seq["iDet"] = i_det

    def suivant(j):
        for m in range(j + 1, len(prims)):
            if prims[m]["k"] != K.AIRY:
                return prims[m]
        return None

    def apres_diffuseur(j):
        """Un dépoli vise au-delà d'un objet étendu (lettre, quadrillage, règle : motif testé au passage)."""
        for m in range(j + 1, len(prims)):
            q = prims[m]
            if q["k"] == K.AIRY or (q["k"] == K.MASQUE and q["p"][0] in (F.LETTRE, F.GRILLE, F.REGLE, F.DIAPO)):
                continue
            return q
        return suivant(j)
    def champ_vu(j):
        """Champ vu au plan de l'objet étendu qui suit le dépoli j (cf. `champVu` du cœur JS) : [0, 0, z, X] ou None."""
        io = -1
        for m in range(j + 1, len(prims)):
            q = prims[m]
            if q["k"] == K.AIRY:
                continue
            if q["k"] == K.MASQUE and q["p"][0] in (F.LETTRE, F.GRILLE, F.REGLE, F.DIAPO):
                io = m
            break
        if io < 0 or i_det <= io:
            return None
        ap = []
        for m in range(io + 1, i_det + 1):
            q = prims[m]
            if q["O"][0] != 0 or q["O"][1] != 0 or q["ez"][0] != 0 or q["ez"][1] != 0 or q["sens"] < 0:
                return None
            if q["k"] in (K.AIRY, K.FILTRE, K.JONES, K.PHASE):
                continue
            if q["k"] == K.MASQUE and q["p"][0] in (F.LETTRE, F.GRILLE, F.REGLE, F.DIAPO):
                continue
            if q["k"] not in (K.SURF, K.IDEALE, K.MASQUE, K.DET):
                return None
            M = chaine(seq, 587.6, io, m)
            ap.append((M[0], M[1], rayon_utile(q)))
        X0 = prims[io]["rc"]
        X = X0
        for _ in range(4):      # chaque borne resserre l'autre, toutes deux restent vraies
            uM = math.inf
            for a in ap:
                if abs(a[1]) > 1e-9:
                    uM = min(uM, (a[2] + abs(a[0]) * X) / abs(a[1]))
            if not math.isfinite(uM):
                return None
            for a in ap:
                if abs(a[0]) > 1e-9:
                    X = min(X, (a[2] + abs(a[1]) * uM) / abs(a[0]))
        X = 1.3 * X + 0.05
        return [0, 0, prims[io]["zp"], X] if X < X0 else None

    p0 = suivant(-1)
    seq["cible"] = centre_plan(p0) + [rayon_utile(p0)] if p0 else None
    nd = 0
    for j, pr in enumerate(prims):
        if pr["k"] != K.DIFFUSEUR:
            continue
        pr["p"][4] = nd          # numéro du dépoli sur le trajet : site 2 + nd de la visée guidée
        nd += 1
        nx = apres_diffuseur(j)
        c = centre_plan(nx) + [rayon_utile(nx)] if nx else [0, 0, 0, 0]
        # pupille d'entrée vue du dépoli (cf. le cœur JS)
        sd = seq["stop"]
        dr = bool(sd) and sd["i"] > j and all(
            prims[m]["k"] != K.MIROIR and prims[m]["O"][0] == 0 and prims[m]["O"][1] == 0 and prims[m]["ez"][0] == 0
            and prims[m]["ez"][1] == 0 and prims[m]["sens"] > 0 for m in range(j, sd["i"] + 1))
        if dr and nx:
            Md = chaine(seq, 587.6, j, sd["i"])
            sdp = Md[1] / Md[0] if abs(Md[0]) > 1e-9 else 0
            Rd = 2 * sd["D"] / 2 / abs(Md[0])      # MARGE_PUPILLE du cœur JS
            if abs(sdp) > 1 and Rd / abs(sdp) < abs(c[3]) / max(abs(c[2] - pr["zp"]), 1e-9):
                c = [0, 0, pr["zp"] + sdp, Rd if sdp > 0 else -Rd]      # pupille virtuelle : rayon négatif
        cf = champ_vu(j)
        if cf and cf[3] / max(abs(cf[2] - pr["zp"]), 1e-9) < abs(c[3]) / max(abs(c[2] - pr["zp"]), 1e-9):
            c = cf
        pr["p"][0:4] = c
        pr["p"][5] = elargir(prims, seq["iDet"], j + 1, centre_plan(pr), pr["R"], c, nx if c[3] == rayon_utile(nx) else None) if nx else 0.0     # cible élargie (lot 4c)
    # cible élargie de la source (lot 4c) : pas dans un boîtier (lanterne)
    if em["forme"] == "rect":
        Rs = 0.5 * math.sqrt((em["a"] + (abs(em["fil"]["pente"]) * em["b"] if em.get("fil") else 0)) ** 2 + em["b"] * em["b"])
    else:
        Rs = em["a"]
    if seq["cible"]:
        seq["cible"].append(0.0 if Ts.get("boitier") or em["forme"] == "gauss" else
                            elargir(prims, seq["iDet"], 0, [frs["O"][i] + em["dz"] * frs["ez"][i] for i in range(3)], Rs, seq["cible"], p0))
    # tirage depuis l'objet éclairé (petit objet que seules des lentilles séparent de la source)
    seq["mode"], seq["de"], seq["arriere"] = 0, 0, []
    o = seq["objet"]
    ns = suivant(o) if o >= 0 else None
    if o >= 0 and em["forme"] != "gauss" and prims[o]["k"] == K.MASQUE and prims[o]["rc"] <= 6 and ns and banc.get("tirage") != "source":
        if all(prims[j]["k"] in (K.SURF, K.IDEALE) for j in range(o)):
            seq["mode"], seq["de"] = 1, o
            seq["cibleObj"] = centre_plan(prims[o]) + [prims[o]["rc"]]
            seq["cibleSuiv"] = centre_plan(ns) + [rayon_utile(ns)]
            sto = seq["stop"]
            droit = bool(sto) and all(prims[j]["k"] != K.MIROIR and prims[j]["O"][0] == 0 and prims[j]["O"][1] == 0 and prims[j]["ez"][0] == 0
                                      and prims[j]["ez"][1] == 0 and prims[j]["sens"] > 0 for j in range(o, sto["i"] + 1))
            if droit:
                Mp = chaine(seq, 587.6, o, sto["i"])
                sp = Mp[1] / Mp[0] if abs(Mp[0]) > 1e-9 else 0
                Rp = 1.3 * sto["D"] / 2 / abs(Mp[0])
                if sp > 1 and Rp < seq["cibleSuiv"][3]:
                    seq["cibleSuiv"] = [0, 0, prims[o]["zp"] + sp, Rp]
            arr = []
            for pr in reversed(prims[:o]):
                q = retourner_prim(pr)
                q.update(O=pr["O"], ex=pr["ex"], ey=pr["ey"], ez=pr["ez"], sens=-pr["sens"], el=pr["el"], type=pr["type"])
                arr.append(q)
            seq["arriere"] = arr
    return seq


# ================= tirage d'un rayon =================
def tirer(seq, g, passe, k, Nr):
    S = seq["source"]
    em, sp, fr = S["em"], S["sp"], S["fr"]
    a = Alea(graine_rayon(g, passe, k))
    u1 = a.u()
    if sp["type"] == 0:
        l, kl = lambda_continu(sp, (k + u1) / Nr)
    else:
        i = 0
        while i < sp["n"] - 1 and u1 >= sp["cum"][i]:
            i += 1
        l, kl = sp["l"][i], sp["norm"]
    c = mich.cie(l)
    fx = [c[0] * kl, c[1] * kl, c[2] * kl]
    G, uv = seq.get("guide"), {}
    u2, u3, g0 = guide_paire(G, 0, a, uv)
    if seq["mode"] == 1:
        Co, Cs = seq["cibleObj"], seq["cibleSuiv"]
        qo = disque(u2, u3)
        Q = [Co[0] + Co[3] * qo[0], Co[1] + Co[3] * qo[1], Co[2]]
        u4, u5, g1 = guide_paire(G, 1, a, uv)
        dq = disque(u4, u5)
        v = [Cs[0] + Cs[3] * dq[0] - Q[0], Cs[1] + Cs[3] * dq[1] - Q[1], Cs[2] - Q[2]]
        d2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2]
        dn = math.sqrt(d2)
        d = [v[0] / dn, v[1] / dn, v[2] / dn]
        vient = depuis_source(seq, Q, d, l, a)
        w = em["L"] * math.pi * Co[3] * Co[3] * math.pi * Cs[3] * Cs[3] * d[2] * d[2] / d2 * g0 * g1 if vient else 0
        J = [0.0, 0.0, 0.0, 0.0] if seq["jones"] else None
        return {"p": Q, "d": d, "l": l, "w": w, "f": fx, "k": kl, "J": J, "L": 0.0, "n": 1, "alea": a, "x": 0.0, "y": 0.0,
                "hors": False, "de": seq["de"], "mort": not vient, "uv": uv}
    As = 0.0
    if em["forme"] == "rect":
        ys = (u3 - 0.5) * em["b"]
        xs, As = x_filament(em, u2, ys) if em.get("fil") else (u2 - 0.5) * em["a"], aire_source(em)
    elif em["forme"] == "disque":
        dq = disque(u2, u3)
        xs, ys, As = em["a"] * dq[0], em["a"] * dq[1], math.pi * em["a"] * em["a"]
    else:
        r, ph = math.sqrt(-2 * math.log(1 - u2)), 2 * math.pi * u3
        xs, ys = 0.5 * em["a"] * r * math.cos(ph), 0.5 * em["a"] * r * math.sin(ph)
    O, ex, ey, ez = fr["O"], fr["ex"], fr["ey"], fr["ez"]
    P = [O[i] + xs * ex[i] + ys * ey[i] + em["dz"] * ez[i] for i in range(3)]
    u4, u5, g1 = guide_paire(G, 1, a, uv)
    if em["forme"] == "gauss":
        r, ph = math.sqrt(-2 * math.log(1 - u4)), 2 * math.pi * u5
        tx, ty = 0.5 * em["b"] * r * math.cos(ph), 0.5 * em["b"] * r * math.sin(ph)
        nl = math.sqrt(tx * tx + ty * ty + 1)
        tx, ty, tz = tx / nl, ty / nl, 1 / nl
        d = [tx * ex[i] + ty * ey[i] + tz * ez[i] for i in range(3)]
        w = em["L"] * g0 * g1
    else:
        C = seq["cible"]
        dq = vise(u4, u5, C[3], C[4])
        v = [C[0] + dq[0] - P[0], C[1] + dq[1] - P[1], C[2] - P[2]]
        d2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2]
        dn = math.sqrt(d2)
        d = [v[0] / dn, v[1] / dn, v[2] / dn]
        w = em["L"] * As * math.pi * dq[2] * d[2] * d[2] / d2 * g0 * g1
    J = [0.0, 0.0, 0.0, 0.0] if seq["jones"] else None
    return {"p": P, "d": d, "l": l, "w": w, "f": fx, "k": kl, "J": J, "L": 0.0, "n": 1, "alea": a, "x": 0.0, "y": 0.0,
            "hors": False, "de": 0, "mort": False, "uv": uv}


def depuis_source(seq, Q, d, l, a):
    S = seq["source"]
    em, fr = S["em"], S["fr"]
    rb = {"p": list(Q), "d": [-d[0], -d[1], -d[2]], "l": l, "w": 1, "f": [0, 0, 0], "J": [0.0, 0.0, 0.0, 0.0] if seq["jones"] else None,
          "L": 0.0, "n": 1, "x": 0, "y": 0, "hors": False}
    for pr in seq["arriere"]:
        if etape(pr, rb, a, seq) != 0:
            return False
    ex, ey, ez, O = fr["ex"], fr["ey"], fr["ez"], fr["O"]
    vx, vy, vz = rb["p"][0] - O[0], rb["p"][1] - O[1], rb["p"][2] - O[2]
    qz = vx * ez[0] + vy * ez[1] + vz * ez[2]
    dz = rb["d"][0] * ez[0] + rb["d"][1] * ez[1] + rb["d"][2] * ez[2]
    if dz == 0:
        return False
    t = (em["dz"] - qz) / dz
    if not t > 0:
        return False
    px, py, pz = vx + t * rb["d"][0], vy + t * rb["d"][1], vz + t * rb["d"][2]
    x, y = px * ex[0] + py * ex[1] + pz * ex[2], px * ey[0] + py * ey[1] + pz * ey[2]
    if em["forme"] == "rect":
        return dans_filament(em, x, y) if em.get("fil") else abs(x) < 0.5 * em["a"] and abs(y) < 0.5 * em["b"]
    return x * x + y * y < em["a"] * em["a"]


# ================= formes =================
def forme(f, a, x, y):
    if f == F.DISQUE:
        return 1 if x * x + y * y < a[0] * a[0] else 0
    if f == F.RECT:
        return 1 if abs(x) < 0.5 * a[0] and abs(y) < 0.5 * a[1] else 0
    if f in (F.FENTES, F.TROUS):
        if f == F.FENTES and abs(y) >= 0.5 * a[3]:
            return 0
        n, xm = a[0], 0
        if n > 1.5:
            m = min(max(math.floor(x / a[2] + 0.5 * (n - 1) + 0.5), 0), n - 1)
            xm = (m - 0.5 * (n - 1)) * a[2]
        if f == F.FENTES:
            return 1 if abs(x - xm) < 0.5 * a[1] else 0
        dx = x - xm
        return 1 if dx * dx + y * y < 0.25 * a[1] * a[1] else 0
    if f == F.LETTRE:
        u, v = x / a[0], y / a[0]
        return 1 if ((-6 < u < -3 and -10 < v < 10) or (-6 < u < 6 and 7 < v < 10) or (-6 < u < 3 and -1.5 < v < 1.5)) else 0
    if f == F.GRILLE:
        if abs(x) >= a[2] or abs(y) >= a[2]:
            return 0
        gx, gy = abs(x - a[0] * math.floor(x / a[0] + 0.5)), abs(y - a[0] * math.floor(y / a[0] + 0.5))
        if gx < 0.5 * a[1] or gy < 0.5 * a[1]:
            return 0
        if a[3] > 0:
            gx, gy = abs(x - a[3] * math.floor(x / a[3] + 0.5)), abs(y - a[3] * math.floor(y / a[3] + 0.5))
            if gx < 0.5 * a[4] or gy < 0.5 * a[4]:
                return 0
        return 1
    if f == F.REGLE:
        if abs(x) >= a[0] + 2 or abs(y) >= a[2]:
            return 0
        j = math.floor(x / a[3] + 0.5)
        if abs(j * a[3]) <= a[0] and abs(x - j * a[3]) < 0.5 * a[1]:
            aj = abs(j)
            ln = 2.5 if aj % 10 == 0 else 1.6 if aj % 5 == 0 else 1.0
            if y + a[2] < ln:
                return 0
        return 1
    if f == F.DEMIPLAN:
        return 1 if x > a[0] else 0
    if f == F.PASTILLE:
        r2 = x * x + y * y
        return 1 if a[0] * a[0] < r2 < a[1] * a[1] else 0
    if f == F.FIL:
        return 1 if abs(x) >= 0.5 * a[0] and x * x + y * y < a[1] * a[1] else 0
    if f == F.BIFENTES:
        ib = math.floor(x / a[5] + a[7] + 0.5)
        if ib < 0 or ib > 2:
            return 0
        if abs(y) >= 0.5 * a[4]:
            return 0
        if (int(math.floor(a[6] + 0.5)) >> ib) & 1:
            return 0
        return 1 if abs(abs(x - (ib - a[7]) * a[5]) - 0.5 * a[ib]) < 0.5 * a[3] else 0
    if f == F.RETICULE:
        if x * x + y * y >= a[3] * a[3]:
            return 0
        if abs(x) < 0.5 * a[1] or abs(y) < 0.5 * a[1]:
            return 0
        if a[0] > 0.5:
            jr = math.floor(x / a[2] + 0.5)
            if abs(jr * a[2]) <= 5 and abs(x - jr * a[2]) < 0.5 * a[1]:
                ar = abs(jr)
                lr = 0.6 if ar % 10 == 0 else 0.4 if ar % 5 == 0 else 0.25
                if 0 < y < lr:
                    return 0
        return 1
    if f == F.DIAPO:                     # transmission en intensité au texel le plus proche (pas 0/1)
        n = DIAPOS["n"]
        if not n:
            return 1 if abs(x) < a[1] and abs(y) < a[1] else 0
        i, j = math.floor((x / a[1] + 1) * 0.5 * n), math.floor((1 - y / a[1]) * 0.5 * n)
        return 0 if i < 0 or i >= n or j < 0 or j >= n else float(DIAPOS["t"][int(a[0])][j, i])
    return 1


def phase(p, x, y):
    if p[0] == 2:
        return p[1] if forme(F.LETTRE, [0.25], x, y) else 0
    return p[1] * math.exp(-(x * x + y * y) / (p[2] * p[2]))


def transmission(el, x, y, l):
    L = TYPES[el["type"]]["prims"](params(el), {"optique": "parfaite", "sens": 1}, el) or []
    re, im = 1.0, 0.0
    for pr in L:
        t, ph = 1.0, 0.0
        if pr["k"] == K.MASQUE:
            t = forme(pr["p"][0], pr["p"][1:], x, y) if abs(x) <= pr["Sm"] and abs(y) <= pr["Sm"] else 1
            if pr["p"][0] == F.DIAPO:
                t = math.sqrt(t)
        elif pr["k"] == K.PHASE:
            ph = phase(pr["p"], x, y)
        elif pr["k"] == K.FILTRE:
            t = math.sqrt(trans_filtre(pr["p"][0], l))
        c, s = t * math.cos(ph), t * math.sin(ph)
        re, im = re * c - im * s, re * s + im * c
    return [re, im]


def jones_prim(p, l):
    c, s = math.cos(p[1]), math.sin(p[1])
    if p[0] == 1:
        return [[c * c, 0], [c * s, 0], [c * s, 0], [s * s, 0]]
    g = p[2] * p[3] / l
    er, ei = math.cos(g), math.sin(g)
    return [[c * c + s * s * er, s * s * ei], [c * s * (1 - er), -c * s * ei], [c * s * (1 - er), -c * s * ei], [s * s + c * c * er, c * c * ei]]


def jones(el, l):
    for pr in TYPES[el["type"]]["prims"](params(el), {"optique": "parfaite", "sens": 1}, el) or []:
        if pr["k"] == K.JONES:
            return jones_prim(pr["p"], l)
    return [[1, 0], [0, 0], [0, 0], [1, 0]]


# ================= une primitive =================
def monture(pr, x, y):
    if abs(x) > pr["Sm"] or abs(y) > pr["Sm"]:
        return 2
    return 1 if x * x + y * y > pr["R"] * pr["R"] else 0


def inter_conique(q, d, zv, c, k):
    qx, qy, qz, e = q[0], q[1], q[2] - zv, 1 + k
    A = c * (d[0] * d[0] + d[1] * d[1] + e * d[2] * d[2])
    B = d[2] - c * (qx * d[0] + qy * d[1] + e * qz * d[2])
    C = c * (qx * qx + qy * qy + e * qz * qz) - 2 * qz
    disc = B * B - A * C
    if disc < 0:
        return math.nan
    s = math.sqrt(disc)
    den = B + (s if B >= 0 else -s)
    t1 = C / den if den != 0 else math.nan
    t2 = den / A if A != 0 else math.nan
    o1 = -EPS_T < t1 < TMAX and c * e * (qz + t1 * d[2]) < 1
    o2 = -EPS_T < t2 < TMAX and c * e * (qz + t2 * d[2]) < 1
    if o1 and o2:
        return t1 if t1 < t2 else t2
    return t1 if o1 else t2 if o2 else math.nan


def _lab(pr, q):
    O, ex, ey, ez = pr["O"], pr["ex"], pr["ey"], pr["ez"]
    return [O[i] + q[0] * ex[i] + q[1] * ey[i] + q[2] * ez[i] for i in range(3)]


def etape(pr, r, alea, seq):
    P = pr["p"]
    if pr["k"] == K.AIRY:
        if r.get("hors"):
            return 0
        u = alea.u() * 127
        i = math.floor(u)
        vA = AIRY[i] + (u - i) * (AIRY[min(i + 1, 127)] - AIRY[i])
        al = vA * r["l"] * 1e-6 / (math.pi * P[0] * r["n"])
        ps = 2 * math.pi * alea.u()
        az = abs(r["d"][2])
        dx, dy = r["d"][0] + al * az * math.cos(ps), r["d"][1] + al * az * math.sin(ps)
        na = math.sqrt(dx * dx + dy * dy + r["d"][2] * r["d"][2])
        r["d"] = [dx / na, dy / na, r["d"][2] / na]
        return 0
    O, ex, ey, ez = pr["O"], pr["ex"], pr["ey"], pr["ez"]
    vx, vy, vz = r["p"][0] - O[0], r["p"][1] - O[1], r["p"][2] - O[2]
    q = [vx * ex[0] + vy * ex[1] + vz * ex[2], vx * ey[0] + vy * ey[1] + vz * ey[2], vx * ez[0] + vy * ez[1] + vz * ez[2]]
    rd = r["d"]
    d = [rd[0] * ex[0] + rd[1] * ex[1] + rd[2] * ex[2], rd[0] * ey[0] + rd[1] * ey[1] + rd[2] * ey[2], rd[0] * ez[0] + rd[1] * ez[1] + rd[2] * ez[2]]
    d_lab = None
    if pr["k"] == K.SURF:
        t = inter_conique(q, d, pr["dz"], P[0], P[1])
        touche = -EPS_T < t < TMAX
        if not touche:
            t = (pr["dz"] - q[2]) / d[2] if d[2] != 0 else math.nan
        if not (-EPS_T < t < TMAX):
            return 1
        q = [q[0] + t * d[0], q[1] + t * d[1], q[2] + t * d[2]]
        r["L"] += r["n"] * t
        m = monture(pr, q[0], q[1])
        r["hors"] = m == 2
        if m == 1 or (m == 0 and not touche):
            return 1
        if m == 0:
            Z = q[2] - pr["dz"]
            nx, ny, nz = P[0] * q[0], P[0] * q[1], P[0] * (1 + P[1]) * Z - 1
            nn = math.sqrt(nx * nx + ny * ny + nz * nz)
            nx, ny, nz = nx / nn, ny / nn, nz / nn
            n1, n2 = n_verre(P[2], r["l"]), n_verre(P[3], r["l"])
            eta = n1 / n2
            ci = -(d[0] * nx + d[1] * ny + d[2] * nz)
            if ci < 0:
                nx, ny, nz, ci = -nx, -ny, -nz, -ci
            kk = 1 - eta * eta * (1 - ci * ci)
            if kk < 0:
                return 1
            co = eta * ci - math.sqrt(kk)
            d = [eta * d[0] + co * nx, eta * d[1] + co * ny, eta * d[2] + co * nz]
            r["n"] = n2
    else:
        t = (pr["dz"] - q[2]) / d[2] if d[2] != 0 else math.nan
        if not (-EPS_T < t < TMAX):
            return 1
        q = [q[0] + t * d[0], q[1] + t * d[1], q[2] + t * d[2]]
        r["L"] += r["n"] * t
        if pr["k"] == K.DET:
            if abs(q[0]) < pr["Sm"] and abs(q[1]) < P[9] and (P[0] == 0 or forme(P[0], P[1:], q[0], q[1]) == 0):
                r["x"], r["y"] = q[0], q[1]
                r["p"] = _lab(pr, q)
                return 2
            return 1
        m = monture(pr, q[0], q[1])
        r["hors"] = m == 2
        if m == 1:
            return 1
        if m == 0:
            k = pr["k"]
            if k == K.IDEALE:
                sg = 1 if d[2] >= 0 else -1
                ad = abs(d[2])
                mx, my = d[0] / ad - q[0] / P[0], d[1] / ad - q[1] / P[0]
                nm = math.sqrt(mx * mx + my * my + 1)
                d = [mx / nm, my / nm, sg / nm]
                r["L"] -= (q[0] * q[0] + q[1] * q[1]) / (2 * P[0])
            elif k == K.MASQUE:
                tm = forme(P[0], P[1:], q[0], q[1])
                if tm == 0:
                    return 1
                if tm != 1:
                    r["w"] *= tm             # diapo : niveaux de gris
            elif k == K.DIFFUSEUR:
                pl = _lab(pr, q)
                ua, ub, gd = guide_paire(seq.get("guide"), 2 + int(P[4]), alea, r.get("uv"))
                dd = vise(ua, ub, abs(P[3]), P[5])
                v = [P[0] + dd[0] - pl[0], P[1] + dd[1] - pl[1], P[2] - pl[2]]
                if P[3] < 0:             # cible virtuelle (pupille d'entrée derrière le dépoli)
                    v = [-v[0], -v[1], -v[2]]
                d2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2]
                dn = math.sqrt(d2)
                d_lab = [v[0] / dn, v[1] / dn, v[2] / dn]
                co2 = abs(d_lab[0] * ez[0] + d_lab[1] * ez[1] + d_lab[2] * ez[2])
                r["w"] *= co2 * abs(d_lab[2]) * dd[2] / d2 * gd
            elif k == K.RESEAU:
                gl = r["l"] * 1e-6 / P[0]
                Ssum = 0.0
                for o in range(-3, 4):
                    s2 = (d[0] + o * gl) * (d[0] + o * gl) + d[1] * d[1]
                    if s2 < 1:
                        Ssum += ETA_RESEAU[abs(o)]
                if not Ssum > 0:
                    return 1
                ur, cumr, ordre = alea.u() * Ssum, 0.0, 0
                for o in range(-3, 4):
                    s2 = (d[0] + o * gl) * (d[0] + o * gl) + d[1] * d[1]
                    if s2 < 1:
                        cumr += ETA_RESEAU[abs(o)]
                        ordre = o
                        if ur < cumr:
                            break
                dxr = d[0] + ordre * gl
                s2r = dxr * dxr + d[1] * d[1]
                if not s2r < 1:
                    return 1
                d = [dxr, d[1], (1 if d[2] >= 0 else -1) * math.sqrt(1 - s2r)]
                r["w"] *= Ssum
            elif k == K.MIROIR:
                d = [d[0], d[1], -d[2]]
            elif k == K.JONES:
                if seq["jones"] and r["J"] and not any(r["J"]):
                    # lumière naturelle (J nul) : une lame la laisse naturelle, le polariseur la polarise selon son axe, ½
                    if P[0] == 1:
                        r["J"] = [math.cos(P[1]), 0.0, math.sin(P[1]), 0.0]
                        r["w"] *= 0.5
                elif seq["jones"] and r["J"]:
                    Mj, J = jones_prim(P, r["l"]), r["J"]
                    ar = Mj[0][0] * J[0] - Mj[0][1] * J[1] + Mj[1][0] * J[2] - Mj[1][1] * J[3]
                    ai = Mj[0][0] * J[1] + Mj[0][1] * J[0] + Mj[1][0] * J[3] + Mj[1][1] * J[2]
                    br = Mj[2][0] * J[0] - Mj[2][1] * J[1] + Mj[3][0] * J[2] - Mj[3][1] * J[3]
                    bi = Mj[2][0] * J[1] + Mj[2][1] * J[0] + Mj[3][0] * J[3] + Mj[3][1] * J[2]
                    I = ar * ar + ai * ai + br * br + bi * bi
                    if not I > 0:
                        return 1
                    nj = math.sqrt(I)
                    r["J"] = [ar / nj, ai / nj, br / nj, bi / nj]
                    r["w"] *= I
            elif k == K.FILTRE:
                r["w"] *= trans_filtre(P[0], r["l"])
            elif k == K.PHASE:
                if P[0] == 1:
                    gk = r["l"] * 1e-6 / (2 * math.pi) * P[1] * math.exp(-(q[0] * q[0] + q[1] * q[1]) / (P[2] * P[2])) * (-2 / (P[2] * P[2]))
                    px, py = d[0] + gk * q[0], d[1] + gk * q[1]
                    np_ = math.sqrt(px * px + py * py + d[2] * d[2])
                    d = [px / np_, py / np_, d[2] / np_]
    r["p"] = _lab(pr, q)
    r["d"] = d_lab or [d[0] * ex[i] + d[1] * ey[i] + d[2] * ez[i] for i in range(3)]
    return 0


def suivre(seq, r, alea, pts=False, de=None, sans_airy=False):
    P = seq["prims"]
    lp = [list(r["p"])] if pts else None
    de = r.get("de", 0) if de is None else de
    if r.get("mort"):
        return {"etat": "arrete", "i": -1, "pts": lp}
    for i in range(de, len(P)):
        if P[i]["k"] == K.AIRY and sans_airy:
            continue
        c = etape(P[i], r, alea, seq)
        if lp is not None and P[i]["k"] != K.AIRY:
            lp.append(list(r["p"]))
        if c == 1:
            return {"etat": "arrete", "i": i, "pts": lp}
        if c == 2:
            return {"etat": "detecte", "i": i, "pts": lp}
    return {"etat": "perdu", "i": len(P), "pts": lp}


def passe_cpu(seq, rendu):
    res, W = rendu["res"], rendu["W"]
    h = 2 * W / res
    x0, y0 = rendu.get("cx", 0) - W, rendu.get("cy", 0) - W
    img = np.zeros(res * res * 3)
    n = 0
    if seq.get("iDet", -1) < 0:
        return img, 0
    for k in range(rendu["Nr"]):
        r = tirer(seq, rendu.get("graine", 1), rendu.get("passe", 0), k, rendu["Nr"])
        s = suivre(seq, r, r["alea"])
        if s["etat"] != "detecte":
            continue
        ix, iy = math.floor((r["x"] - x0) / h), math.floor((r["y"] - y0) / h)
        if ix < 0 or iy < 0 or ix >= res or iy >= res:
            continue
        q = 3 * (iy * res + ix)
        for c in range(3):
            img[q + c] += r["w"] * r["f"][c]
        n += 1
    return img, n


# ================= spectromètre à fibre (lot 6c) =================
def k_spectre(sp, l):
    return planck_u(l, sp["T"]) / sp["normP"] if sp["type"] == 0 else sp["norm"]


def cases_spectre(seq, spe):
    sp = seq["source"]["sp"]
    return spe["nb"] if sp["type"] == 0 else sp["n"]


def spectre_cpu(seq, rendu):
    """Σ w·k(λ) des rayons détectés dans la fibre (spe = {x, y, r, la, lb, nb}), par case de longueur d'onde (continu) ou
    par raie : densité = case / (rayons × π r² × largeur de la case)."""
    spe, sp = rendu["spe"], seq["source"]["sp"]
    nb = cases_spectre(seq, spe)
    out = [0.0] * nb
    if seq.get("iDet", -1) < 0:
        return out
    for k in range(rendu["Nr"]):
        r = tirer(seq, rendu.get("graine", 1), rendu.get("passe", 0), k, rendu["Nr"])
        s = suivre(seq, r, r["alea"])
        if s["etat"] != "detecte":
            continue
        dx, dy = r["x"] - spe["x"], r["y"] - spe["y"]
        if dx * dx + dy * dy >= spe["r"] * spe["r"]:
            continue
        b = math.floor((r["l"] - spe["la"]) / (spe["lb"] - spe["la"]) * nb) if sp["type"] == 0 else sp["l"].index(r["l"])
        if 0 <= b < nb:
            out[b] += r["w"] * r["k"]
    return out


def pinceau(seq, pt, n=15, axe=1, ls=(550,), de=0):
    P, out = seq["prims"], []
    j = de
    while j < len(P) and P[j]["k"] == K.AIRY:
        j += 1
    if j >= len(P):
        return out
    C, Rc, z0 = centre_plan(P[j]), rayon_utile(P[j]) * 0.97, pt["z"]
    for l in ls:
        for i in range(n):
            h = -Rc + 2 * Rc * i / (n - 1) if n > 1 else 0
            Q = [C[0] + (h if axe == 0 else 0), C[1] + (h if axe == 1 else 0), C[2]]
            v = [Q[0] - pt["x"], Q[1] - pt["y"], Q[2] - z0]
            dn = math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
            r = {"p": [pt["x"], pt["y"], z0], "d": [v[0] / dn, v[1] / dn, v[2] / dn], "l": l, "w": 1, "f": [0, 0, 0],
                 "J": None, "L": 0.0, "n": 1, "x": 0.0, "y": 0.0}
            s = suivre(seq, r, Alea(graine_rayon(7, 0, i)), pts=True, de=j, sans_airy=True)
            out.append({"l": l, "pts": s["pts"], "etat": s["etat"], "L": r["L"], "x": r["x"], "y": r["y"]})
    return out


# ================= paraxial =================
def abcd_prim(pr, l):
    if pr["k"] == K.SURF:
        n1, n2 = n_verre(pr["p"][2], l), n_verre(pr["p"][3], l)
        return [1, 0, -(n2 - n1) * pr["p"][0] * pr["sens"], 1]
    if pr["k"] == K.IDEALE:
        return [1, 0, -1 / pr["p"][0], 1]
    return [1, 0, 0, 1]


def mul(B, A):
    return [B[0] * A[0] + B[1] * A[2], B[0] * A[1] + B[1] * A[3], B[2] * A[0] + B[3] * A[2], B[2] * A[1] + B[3] * A[3]]


def milieu(seq, i, l):
    while i >= 0 and seq["prims"][i]["k"] == K.AIRY:
        i -= 1
    return n_verre(seq["prims"][i]["p"][3], l) if i >= 0 and seq["prims"][i]["k"] == K.SURF else 1


def s_de(seq, i):
    return 0 if i < 0 else seq["prims"][i]["s"]


def chaine(seq, l, i, j):
    P, Mt, s = seq["prims"], [1, 0, 0, 1], s_de(seq, i)
    m = i + 1
    while m <= j and m < len(P):
        n = milieu(seq, m - 1, l)
        Mt = mul([1, (P[m]["s"] - s) / n, 0, 1], Mt)
        s = P[m]["s"]
        if m < j:
            Mt = mul(abcd_prim(P[m], l), Mt)
        m += 1
    return Mt


def z_de_s(seq, s):
    P, za, sa = seq["prims"], seq["zEm"], 0
    for pr in P:
        if s <= pr["s"]:
            dz, ds = pr["zp"] - za, pr["s"] - sa
            return za + dz * (s - sa) / ds if ds > 0 else za
        za, sa = pr["zp"], pr["s"]
    der = P[-1] if P else None
    return za + (-1 if der and der["sens"] < 0 else 1) * (s - sa)


def images(seq, l, i):
    P, nd = seq["prims"], seq["iDet"]
    if nd < 0:
        return None
    out, Mt, s = [], [1, 0, 0, 1], s_de(seq, i)
    for m in range(i + 1, nd + 1):
        n = milieu(seq, m - 1, l)
        gap = P[m]["s"] - s
        if n == 1 and abs(Mt[3]) > 1e-15:
            d = -Mt[1] / Mt[3]
            if 1e-9 < d <= gap and not (out and abs(out[-1]["s"] - (s + d)) < 1e-9):
                out.append({"s": s + d, "z": z_de_s(seq, s + d), "gamma": Mt[0] + d * Mt[2], "apres": m - 1})
        Mt = mul([1, gap / n, 0, 1], Mt)
        s = P[m]["s"]
        if m < nd:
            Mt = mul(abcd_prim(P[m], l), Mt)
    last = nd - 1
    if last > i:
        Mf, sl = mul(abcd_prim(P[last], l), chaine(seq, l, i, last)), P[last]["s"]
    else:
        Mf, sl = [1, 0, 0, 1], s_de(seq, i)
    if abs(Mf[3]) < 1e-12:
        fin = {"infini": True, "s": math.inf, "gamma": math.inf, "angle": Mf[2]}
    else:
        df = -Mf[1] / Mf[3]
        fin = {"infini": False, "s": sl + df, "z": z_de_s(seq, sl + df), "gamma": 1 / Mf[3], "reelle": df >= 0}
    return {"reelles": out, "finale": fin, "M": Mf}


def ouverture(seq, l, i):
    P = seq["prims"]
    nd = seq["iDet"] if seq["iDet"] >= 0 else len(P)
    best = None
    for j in range(i + 1, nd):
        if P[j]["k"] == K.AIRY:
            continue
        a = min(P[j]["ap"][0], P[j]["ap"][1])
        if not a < GRAND / 2:
            continue
        B = chaine(seq, l, i, j)[1]
        if abs(B) < 1e-9:
            continue
        u = a / abs(B)
        if best is None or u < best["u"]:
            best = {"i": j, "u": u, "D": 2 * a, "el": P[j]["el"]}
    return best


def couper(poly, a, b, c):
    out, n = [], len(poly)
    for k in range(n):
        Pk, Q = poly[k], poly[(k + 1) % n]
        fp, fq = a * Pk[0] + b * Pk[1] - c, a * Q[0] + b * Q[1] - c
        if fp <= 0:
            out.append(Pk)
        if (fp < 0 < fq) or (fp > 0 > fq):
            t = fp / (fp - fq)
            out.append([Pk[0] + t * (Q[0] - Pk[0]), Pk[1] + t * (Q[1] - Pk[1])])
    return out


def enveloppe(seq, l, i, y0, y1, axe=1, U=1.0, nsub=8):
    P = seq["prims"]
    nd = seq["iDet"] if seq["iDet"] >= 0 else len(P) - 1
    poly = [[y0, -U], [y1, -U], [y1, U], [y0, U]]
    for j in range(i + 1, nd + 1):
        if not poly:
            break
        if P[j]["k"] == K.AIRY:
            continue
        a = P[j]["ap"][axe]
        if not a < GRAND / 2:
            continue
        Mt = chaine(seq, l, i, j)
        poly = couper(couper(poly, Mt[0], Mt[1], a), -Mt[0], -Mt[1], a)
    pts = []
    if not poly:
        return {"poly": poly, "pts": pts}

    def bornes(Mx, s):
        lo, hi = math.inf, -math.inf
        for v in poly:
            y = Mx[0] * v[0] + Mx[1] * v[1]
            lo, hi = min(lo, y), max(hi, y)
        pts.append({"s": s, "z": z_de_s(seq, s), "lo": lo, "hi": hi})
    Mt, s = [1, 0, 0, 1], s_de(seq, i)
    bornes(Mt, s)
    for j in range(i + 1, nd + 1):
        n, gap = milieu(seq, j - 1, l), P[j]["s"] - s
        for k in range(1, nsub + 1):
            bornes(mul([1, gap * k / nsub / n, 0, 1], Mt), s + gap * k / nsub)
        Mt = mul([1, gap / n, 0, 1], Mt)
        s = P[j]["s"]
        if j < nd:
            Mt = mul(abcd_prim(P[j], l), Mt)
    return {"poly": poly, "pts": pts}


def gaussien(seq, l, w0, liste):
    lm, P = l * 1e-6, seq["prims"]
    zr = math.pi * w0 * w0 / lm
    out = []
    for s in liste:
        j = 0
        while j < len(P) and P[j]["s"] < s:
            j += 1
        Mt = mul(abcd_prim(P[j - 1], l), chaine(seq, l, -1, j - 1)) if j > 0 else [1, 0, 0, 1]
        Mt = mul([1, (s - s_de(seq, j - 1)) / milieu(seq, j - 1, l), 0, 1], Mt)
        A, B, C, D = Mt
        nr, ni, den = B * D + A * C * zr * zr, zr * (A * D - B * C), D * D + C * C * zr * zr
        qr, qi = nr / den, ni / den
        im = -qi / (qr * qr + qi * qi)
        out.append({"s": s, "z": z_de_s(seq, s), "w": math.sqrt(-lm / (math.pi * im))})
    return out


# ================= moteur ondulatoire (SPEC § 4.5 et 4.3 ; lot 4a : processeur) =================
# Modèle et conventions : en-tête « MOTEUR ONDULATOIRE » du cœur JS. Ici le même calcul, vectorisé (numpy.fft).
def _c1(c, w, x, d):
    """Part de l'intervalle [c − w/2, c + w/2] vue de la maille centrée en x, pondérée par un triangle de base 2d
    (deux moyennes glissantes de largeur d) : le spectre du masque est multiplié par sinc²(f d), repliements
    négligeables ; une transformée le compense (division par sinc²)."""
    def F(t):
        t = np.clip(t, -1, 1)
        return np.where(t < 0, 0.5 * (1 + t) ** 2, 1 - 0.5 * (1 - t) ** 2)
    return F((c + w / 2 - x) / d) - F((c - w / 2 - x) / d)


def _disque(r, x, y, dx, dy):
    """Part du disque de rayon r vue de la maille (triangle le long de x, huit lignes pondérées le long de y)."""
    s = 0.0
    for k in range(8):
        ys = y + (k - 3.5) * dy / 4
        s = s + (1 - abs(k - 3.5) / 4) / 4 * _c1(0, 2 * np.sqrt(np.maximum(r * r - ys * ys, 0)), x, dx)
    return s


def _aire_disque(r, x, y, dx, dy):
    """Part de la maille dx × dy (centre x, y) dans le disque de rayon r : exacte le long de x, quatre lignes en y."""
    s = 0.0
    for k in range(4):
        w = 2 * math.sqrt(max(r * r - (y + (k - 1.5) * dy / 4) ** 2, 0))
        s += max(min(x + dx / 2, w / 2) - max(x - dx / 2, -w / 2), 0) / dx
    return s / 4


def _fils(pas, w, x, d):
    if d >= 4 * pas:
        return w / pas + 0 * x
    k0, s = np.floor(x / pas + 0.5), 0.0
    for k in range(-2, 3):
        s = s + _c1((k0 + k) * pas, w, x, d)
    return np.minimum(s, 1)


def _couv_diapo(a, x, y, dx, dy, intens=False):
    """Diapo sur la maille : pixels constants par morceaux pondérés par le triangle de `_c1`, en unités de pixel ;
    amplitude √T, ou intensité T (`intens` : poids d'une source étendue)."""
    n, h = DIAPOS["n"], a[1]
    if not n:
        return _c1(0, 2 * h, x, dx) * _c1(0, 2 * h, y, dy)
    p = 2 * h / n
    u, v, du, dv = (np.asarray(x) + h) / p, (h - np.asarray(y)) / p, dx / p, dy / p
    A = DIAPOS["t" if intens else "a"][int(a[0])]
    i0, j0 = np.floor(u - du), np.floor(v - dv)
    s = 0.0
    for oj in range(int(math.floor(2 * dv)) + 2):
        j = j0 + oj
        wy = _c1(j + 0.5, 1, v, dv) * ((j >= 0) & (j < n))
        jc = np.clip(j, 0, n - 1).astype(int)
        for oi in range(int(math.floor(2 * du)) + 2):
            i = i0 + oi
            wx = _c1(i + 0.5, 1, u, du) * ((i >= 0) & (i < n))
            s = s + wy * wx * A[jc, np.clip(i, 0, n - 1).astype(int)]
    return s


def couverture(f, a, x, y, dx, dy, intens=False):
    """Transmission moyenne d'un masque sur la maille dx × dy centrée en (x, y) (repère du masque ; x, y : tableaux)."""
    if f == F.DIAPO:
        return _couv_diapo(a, x, y, dx, dy, intens)
    if f == F.DISQUE:
        return _disque(a[0], x, y, dx, dy)
    if f == F.RECT:
        return _c1(0, a[0], x, dx) * _c1(0, a[1], y, dy)
    if f in (F.FENTES, F.TROUS):
        n, s = max(1, int(round(a[0]))), 0.0
        for m in range(n):
            xm = (m - 0.5 * (n - 1)) * a[2]
            s = s + (_c1(xm, a[1], x, dx) if f == F.FENTES else _disque(a[1] / 2, x - xm, y, dx, dy))
        return s * _c1(0, a[3], y, dy) if f == F.FENTES else s
    if f == F.LETTRE:
        s = a[0]
        return (_c1(-4.5 * s, 3 * s, x, dx) * _c1(0, 20 * s, y, dy) + _c1(1.5 * s, 9 * s, x, dx) * _c1(8.5 * s, 3 * s, y, dy)
                + _c1(0, 6 * s, x, dx) * _c1(0, 3 * s, y, dy))
    if f == F.GRILLE:
        fx, fy = _fils(a[0], a[1], x, dx), _fils(a[0], a[1], y, dy)
        if a[3] > 0:
            fx, fy = np.maximum(fx, _fils(a[3], a[4], x, dx)), np.maximum(fy, _fils(a[3], a[4], y, dy))
        return _c1(0, 2 * a[2], x, dx) * _c1(0, 2 * a[2], y, dy) * (1 - fx) * (1 - fy)
    if f == F.DEMIPLAN:
        return _c1(a[0] + GRAND, 2 * GRAND, x, dx) + 0 * y
    if f == F.PASTILLE:
        return _disque(a[1], x, y, dx, dy) - _disque(a[0], x, y, dx, dy)
    if f == F.FIL:
        return _disque(a[1], x, y, dx, dy) * (1 - _c1(0, a[0], x, dx))
    if f == F.BIFENTES:
        s = 0.0
        for ib in range(3):
            if not (int(round(a[6])) >> ib) & 1:
                s = s + _c1(0, a[4], y, dy) * (_c1((ib - a[7]) * a[5] + 0.5 * a[ib], a[3], x, dx) + _c1((ib - a[7]) * a[5] - 0.5 * a[ib], a[3], x, dx))
        return s
    return np.vectorize(lambda u, v: float(forme(f, a, u, v)))(x + 0 * y, y + 0 * x)      # règle : au centre de la maille


def geom_forme(f, a):
    """[cx, cy, hx, hy, détail x, détail y] : boîte de la partie transparente (repère du masque) et plus petit détail."""
    if f == F.DISQUE:
        return [0, 0, a[0], a[0], 2 * a[0], 2 * a[0]]
    if f == F.RECT:
        return [0, 0, a[0] / 2, a[1] / 2, a[0], a[1]]
    if f == F.FENTES:
        n = max(1, int(round(a[0])))
        return [0, 0, ((n - 1) * a[2] + a[1]) / 2, a[3] / 2, min(a[1], a[2] - a[1]) if n > 1 else a[1], a[3]]
    if f == F.TROUS:
        n = max(1, int(round(a[0])))
        return [0, 0, ((n - 1) * a[2] + a[1]) / 2, a[1] / 2, min(a[1], a[2] - a[1]) if n > 1 else a[1], a[1]]
    if f == F.LETTRE:
        return [0, 0, 6 * a[0], 10 * a[0], 3 * a[0], 3 * a[0]]
    if f == F.GRILLE:
        d = min(a[1], a[0] - a[1])
        return [0, 0, a[2], a[2], d, d]
    if f == F.REGLE:
        return [0, 0, a[0] + 2, a[2], a[1], a[2]]
    if f == F.DIAPO:
        pd = 2 * a[1] / (DIAPOS["n"] or 512)
        return [0, 0, a[1], a[1], 2 * pd, 2 * pd]
    if f == F.PASTILLE:
        return [0, 0, a[1], a[1], 2 * a[0], 2 * a[0]]
    if f == F.FIL:
        return [0, 0, a[1], a[1], a[0], GRAND]
    if f == F.BIFENTES:
        rangs = [ib for ib in range(3) if not (int(round(a[6])) >> ib) & 1]
        if not rangs:
            return [0, 0, 1, 1, 1, 1]
        am = [a[ib] for ib in rangs]
        x0 = min((ib - a[7]) * a[5] - (a[ib] + a[3]) / 2 for ib in rangs)
        x1 = max((ib - a[7]) * a[5] + (a[ib] + a[3]) / 2 for ib in rangs)
        return [(x0 + x1) / 2, 0, (x1 - x0) / 2, a[4] / 2, min(a[3], min(am) - a[3]), a[4]]
    return [0, 0, GRAND, GRAND, GRAND, GRAND]


def _ang(fr):
    return math.atan2(fr["ex"][1], fr["ex"][0])


def _boite(g, ph):
    """Boîte g (repère propre) vue d'un repère tourné de −ph : [Hx, Hy, détail x, détail y, cx, cy]."""
    c, s = math.cos(ph), math.sin(ph)
    dx, dy = g[4], g[5]
    if abs(c) < 1e-9:
        dx, dy = dy, dx
    elif abs(s) >= 1e-9:
        dx = dy = min(dx, dy)
    return [abs(g[2] * c) + abs(g[3] * s), abs(g[2] * s) + abs(g[3] * c), dx, dy, g[0] * c - g[1] * s, g[0] * s + g[1] * c]


def _plan_onde(pr, i):
    k, Sm = pr["k"], pr["Sm"]
    pl = {"i": i, "O": [pr["O"][0], pr["O"][1]], "ang": _ang(pr), "R": pr["R"], "Sm": Sm}
    if k == K.MASQUE:
        g = geom_forme(pr["p"][0], pr["p"][1:])
        pl.update(genre="masque", f=pr["p"][0], a=pr["p"][1:], g=[g[0], g[1], min(g[2], Sm), min(g[3], Sm), g[4], g[5]])
    elif k == K.PHASE:
        d = 0.75 if pr["p"][0] == 2 else pr["p"][2]
        pl.update(genre="phase", p=pr["p"], g=[0, 0, pr["R"], pr["R"], d, d])
    elif k == K.DIFFUSEUR:
        pl.update(genre="speckle", g=[0, 0, pr["R"], pr["R"], GRAND, GRAND])
    else:
        pl.update(genre="monture", g=[0, 0, pr["R"], pr["R"], 2 * pr["R"], 2 * pr["R"]])
    return pl


def _demi_ouverture(pr):
    if pr["k"] == K.MASQUE:
        f, a = pr["p"][0], pr["p"][1:]
        return a[0] if f == F.DISQUE else min(a[0], a[1]) / 2 if f == F.RECT else GRAND
    return pr["R"]


ONDE_OPTIONS = {"maxN": 4096, "maxCellules": 1 << 20, "nl": 16, "champ": 16, "fin": 8, "maxPoints": 400, "graine": 7, "ouvertures": True}


def onde_plan(seq, o=None):
    opt = dict(ONDE_OPTIONS)
    opt.update(o or {})

    def non(r):
        return {"ok": False, "raison": r}

    if seq.get("vide") or seq.get("iDet", -1) < 0:
        return non("detecteur")
    if seq["miroir"]:
        return non("miroir")
    P, nd, S = seq["prims"], seq["iDet"], seq["source"]
    em, sp, Oe = S["em"], S["sp"], S["fr"]["O"]
    laser = em["forme"] == "gauss"
    if sp["type"] == 0:
        lref = 0.5 * (sp["a"] + sp["b"])
    else:
        lref = sum(sp["l"][i] * (sp["cum"][i] - (sp["cum"][i - 1] if i else 0)) for i in range(sp["n"]))
    lm = lref * 1e-6
    src = {"i": -1, "forme": em["forme"], "O": [Oe[0], Oe[1]], "ang": _ang(S["fr"]),
           "g": [0, 0, em["a"] / 2, em["b"] / 2] if em["forme"] == "rect" else [0, 0, em["a"], em["a"]]}

    def w_laser(i):
        Mt, zr = chaine(seq, lref, -1, i), math.pi * em["a"] ** 2 / lm
        return math.sqrt(lm / (math.pi * (1 / ((Mt[0] * -1j * zr + Mt[1]) / (Mt[2] * -1j * zr + Mt[3]))).imag))

    planes, ouv, reseau, i1, z1, th, rw = [], [], None, -1, 0.0, 0.0, GRAND
    for i in range(nd):
        pr = P[i]
        k = pr["k"]
        if k == K.AIRY or (k == K.MASQUE and pr["p"][0] == F.RETICULE):
            continue
        T = TYPES.get(pr["type"]) or {}
        office = T.get("tiroir") in ("young", "fourier")
        if k == K.DIFFUSEUR and not laser:
            return non("depoli")
        if k == K.RESEAU:
            if reseau is not None:
                return non("reseau")
            reseau = i
        structure = k in (K.PHASE, K.DIFFUSEUR) or (k == K.MASQUE and (office or pr["p"][0] not in (F.DISQUE, F.RECT)))
        a = _demi_ouverture(pr)
        if i1 < 0:
            if laser:
                oui = structure or a < 2.5 * w_laser(i)
            elif k == K.MASQUE and not office:
                pl = _plan_onde(pr, i)
                Bi = chaine(seq, lref, src["i"], i)[1]
                b, bs = _boite(pl["g"], pl["ang"]), _boite(src["g"] + [GRAND, GRAND], src["ang"])
                oui = (opt["ouvertures"] is not False or pl["f"] == F.DIAPO) and abs(Bi) >= 1e-9 and any(d < GRAND / 2 and d * 2 * H / abs(Bi) < lm for d, H in ((b[2], bs[0]), (b[3], bs[1])))
                if not oui and T.get("objet"):
                    src = {"i": i, "forme": "masque", "f": pl["f"], "a": pl["a"], "g": pl["g"][:4], "O": pl["O"], "ang": pl["ang"]}
                    ouv = []
                    continue
            else:
                oui = structure
            if not oui:
                if a < GRAND / 2:
                    ouv.append((i, a))
                continue
            pl = _plan_onde(pr, i)
            if laser:
                rw = 2.5 * w_laser(i) + max(abs(Oe[0]), abs(Oe[1]))
            else:
                Bs = chaine(seq, lref, src["i"], i)[1]
                if abs(Bs) < 1e-9:
                    return non("conjugue")
                for j, aj in ouv:
                    Bj = chaine(seq, lref, src["i"], j)[1]
                    if abs(Bj) > 1e-9:
                        rw = min(rw, aj / abs(Bj) * abs(Bs))
                th = max(src["g"][2], src["g"][3]) / abs(Bs)
            i1, ang0, g = i, pl["ang"], pl["g"]
            ca, sa = math.cos(ang0), math.sin(ang0)
            off = [ca * pl["O"][0] + sa * pl["O"][1] + g[0], -sa * pl["O"][0] + ca * pl["O"][1] + g[1]]
            zone = [min(abs(off[0]) + g[2], rw), min(abs(off[1]) + g[3], rw)]
            N, d, limite = [], [], False
            for ax in (0, 1):
                Wd = 2 * zone[ax]
                # diapo au premier plan : un pixel par maille (le pas est fixé par l'image)
                dt = 2 * pl["a"][1] / (DIAPOS["n"] or 512) if pl.get("f") == F.DIAPO else min(g[4 + ax] / opt["fin"], Wd / 16)
                n = 16
                while n < opt["maxN"] and n * dt < opt["champ"] * Wd:
                    n *= 2
                if n * dt < 1.5 * Wd:
                    dt, limite = 1.5 * Wd / n, True
                N.append(n)
                d.append(dt)
            while N[0] * N[1] > opt["maxCellules"]:
                m0, m1 = N[0] * d[0] / zone[0], N[1] * d[1] / zone[1]      # marge de champ ; à égalité, l'axe le plus fin
                ax = (0 if N[0] >= N[1] else 1) if abs(m0 - m1) <= 1e-9 * m0 else 0 if m0 > m1 else 1
                N[ax] //= 2
                if N[ax] * d[ax] < 3 * zone[ax]:
                    d[ax], limite = 3 * zone[ax] / N[ax], True
            z1 = max(zone)
            th += 2 * lm / min(g[4], g[5], z1 / 4)
            planes.append(pl)
        else:
            Mt = mul(chaine(seq, lref, i1, i), abcd_prim(P[i1], lref))
            if structure or a < abs(Mt[0]) * z1 + abs(Mt[1]) * th:
                planes.append(_plan_onde(pr, i))
    if reseau is not None and planes and planes[-1]["i"] > reseau:
        return non("reseau")
    if not planes and not laser:
        return non("geometrique")
    plan = {"ok": True, "seq": seq, "laser": laser, "src": src, "planes": planes, "reseau": reseau, "lref": lref, "opt": opt,
            "ang": 0.0, "N": [0, 0], "d": [0, 0], "rw": rw, "limite": False, "pasSource": 1, "cache": {}}
    if planes:
        plan.update(ang=ang0, N=N, d=d, limite=limite)
        if not laser and len(planes) > 1:
            Bs = abs(chaine(seq, lref, src["i"], i1)[1])
            bs = _boite(src["g"] + [GRAND, GRAND], src["ang"] - ang0)
            n = (2 * bs[0] * N[0] * d[0] / (lm * Bs) + 1) * (2 * bs[1] * N[1] * d[1] / (lm * Bs) + 1)
            plan["pasSource"] = max(1, math.ceil(math.sqrt(n / opt["maxPoints"])))
    plan["lambdas"] = _lambdas(seq, opt["nl"])
    return plan


def onde_moteur(seq, o=None):
    """Choix du moteur (§ 4.3) : « onde » si un élément diffractant éclairé est sur le trajet (ou le laser), sinon « rayons »."""
    pl = onde_plan(seq, o)
    return {"moteur": "onde" if pl["ok"] else "rayons", "raison": pl.get("raison"), "plan": pl if pl["ok"] else None}


def _facteur_onde(seq, l):
    """Filtres et polarisation : éléments uniformes dans leur ouverture, le champ se factorise U(x, y)·J ; lumière
    naturelle : ½ Tr(J†J)."""
    t, J = 1.0, None
    for pr in seq["prims"][:seq["iDet"]]:
        if pr["k"] == K.FILTRE:
            t *= trans_filtre(pr["p"][0], l)
        elif pr["k"] == K.JONES:
            m = [complex(z[0], z[1]) for z in jones_prim(pr["p"], l)]
            J = m if J is None else [m[0] * J[0] + m[1] * J[2], m[0] * J[1] + m[1] * J[3], m[2] * J[0] + m[3] * J[2], m[2] * J[1] + m[3] * J[3]]
    if J is not None:
        t *= 0.5 * sum(abs(z) ** 2 for z in J)
    return t


def poids_spectre(seq, l, j=0):
    """Poids spectral d'une longueur d'onde (moteur ondulatoire) : continu k(λ) / (b − a) par nm, raie j : sa part × norm ;
    × filtres et polariseurs."""
    sp, t = seq["source"]["sp"], _facteur_onde(seq, l)
    if sp["type"] == 0:
        return t * k_spectre(sp, l) / (sp["b"] - sp["a"])
    return t * sp["norm"] * (sp["cum"][j] - (sp["cum"][j - 1] if j else 0))


def _lambdas(seq, nl):
    sp, out = seq["source"]["sp"], []
    if sp["type"] == 0:
        ls = [(sp["a"] + (sp["b"] - sp["a"]) * (k + 0.5) / nl, 1 / nl) for k in range(nl)]
    else:
        ls = [(sp["l"][i], sp["cum"][i] - (sp["cum"][i - 1] if i else 0)) for i in range(sp["n"])]
    for l, p in ls:
        t = p * _facteur_onde(seq, l)
        if t > 0:
            out.append([l, [c * t for c in facteur_xyz(sp, l)]])
    return out


def _grille_onde(plan, d):
    Nx, Ny = plan["N"]
    return np.meshgrid((np.arange(Nx) - Nx // 2) * d[0], (np.arange(Ny) - Ny // 2) * d[1])


def _t_plan(plan, pl, d):
    """Transmission complexe d'un plan sur la grille (pas d, repère de la grille tourné de plan.ang)."""
    X, Y = _grille_onde(plan, d)
    c0, s0, ca, sa = math.cos(plan["ang"]), math.sin(plan["ang"]), math.cos(pl["ang"]), math.sin(pl["ang"])
    xl, yl = c0 * X - s0 * Y - pl["O"][0], s0 * X + c0 * Y - pl["O"][1]
    xm, ym = ca * xl + sa * yl, -sa * xl + ca * yl
    cp, sp = abs(math.cos(pl["ang"] - plan["ang"])), abs(math.sin(pl["ang"] - plan["ang"]))
    ex, ey = d[0] * cp + d[1] * sp, d[0] * sp + d[1] * cp
    if pl["genre"] == "masque":
        return couverture(pl["f"], pl["a"], xm, ym, ex, ey) * _c1(0, 2 * pl["Sm"], xm, ex) * _c1(0, 2 * pl["Sm"], ym, ey)
    t = _disque(pl["R"], xm, ym, ex, ey)
    if pl["genre"] == "phase":
        p = pl["p"]
        if p[0] == 2:
            u, v = xm / 0.25, ym / 0.25
            ph = p[1] * (((u > -6) & (u < -3) & (v > -10) & (v < 10)) | ((u > -6) & (u < 6) & (v > 7) & (v < 10)) | ((u > -6) & (u < 3) & (v > -1.5) & (v < 1.5)))
        else:
            ph = p[1] * np.exp(-(xm * xm + ym * ym) / (p[2] * p[2]))
        return t * np.exp(1j * ph)
    if pl["genre"] == "speckle":
        Ny, Nx = X.shape
        ph = np.array([[Alea(graine_rayon(plan["opt"]["graine"], j, i)).u() for i in range(Nx)] for j in range(Ny)])
        return t * np.exp(2j * math.pi * ph)
    return t


def _prop_axe(u, axe, lm, d, c, Mt, comp=True):
    """Intégrale de Collins le long d'un axe (1 : x, 0 : y), sphère de référence de courbure c portée à part.
    Renvoie (champ, pas, courbure). comp : compense le lissage des masques (÷ sinc² de la maille) après une transformée."""
    A, B, C, D = Mt
    N = u.shape[axe]
    k = np.arange(N) - N // 2
    Ap = A + B * c

    def ax(v):
        return v.reshape([1, -1] if axe == 1 else [-1, 1])

    def tf(v, inv=False):
        return np.fft.fftshift((np.fft.ifft if inv else np.fft.fft)(np.fft.ifftshift(v, axes=axe), axis=axe), axes=axe)

    def signe(v, s):
        return np.take(v, (N - np.arange(N)) % N, axis=axe) if s < 0 else v

    if abs(B) < 1e-9:                                   # plans conjugués : copie à l'échelle
        return signe(u, Ap) / math.sqrt(abs(Ap)), abs(Ap) * d, (C + D * c) / Ap
    if N * d * d * abs(Ap) <= lm * abs(B):              # loin : une transformée (Fresnel, Fraunhofer si A' = 0)
        u2 = signe(tf(u * ax(np.exp(1j * math.pi * Ap * (k * d) ** 2 / (lm * B)))), B) * (d / math.sqrt(lm * abs(B)))
        return u2 / ax(np.sinc(k / N) ** 2) if comp else u2, lm * abs(B) / (N * d), D / B
    f = k / (N * d)                                     # près : spectre angulaire, grille à l'échelle A'
    u2 = tf(tf(u) * ax(np.exp(-1j * math.pi * lm * (B / Ap) * f * f)), True)
    return signe(u2, Ap) / math.sqrt(abs(Ap)), abs(Ap) * d, (C + D * c) / Ap


def _eclairage(plan, l):
    """Champ au premier plan (source ponctuelle sur l'axe, d'aire et de luminance unité, ou faisceau du laser), fois
    la transmission du plan ; courbure de la sphère de référence."""
    key = ("E", l)
    if key not in plan["cache"]:
        seq, pl, lm, em = plan["seq"], plan["planes"][0], l * 1e-6, plan["seq"]["source"]["em"]
        X, Y = _grille_onde(plan, plan["d"])
        Ms = chaine(seq, l, plan["src"]["i"], pl["i"])
        if plan["laser"]:
            zr, Oe = math.pi * em["a"] ** 2 / lm, seq["source"]["fr"]["O"]
            iq = 1 / ((Ms[0] * -1j * zr + Ms[1]) / (Ms[2] * -1j * zr + Ms[3]))
            w2, c, c0, s0 = lm / (math.pi * iq.imag), iq.real, math.cos(plan["ang"]), math.sin(plan["ang"])
            xl, yl = c0 * X - s0 * Y - Ms[0] * Oe[0], s0 * X + c0 * Y - Ms[0] * Oe[1]
            u = math.sqrt(2 / (math.pi * w2)) * np.exp(-(xl * xl + yl * yl) / w2)
        else:
            u, c = np.full(X.shape, 1 / max(abs(Ms[1]), 1e-9)), Ms[3] / Ms[1] if abs(Ms[1]) > 1e-9 else 0.0
            if plan["rw"] < GRAND / 2:
                u = u * _disque(plan["rw"], X, Y, plan["d"][0], plan["d"][1])
        if "T0" not in plan["cache"]:
            plan["cache"]["T0"] = _t_plan(plan, pl, plan["d"])
        plan["cache"][key] = (u * plan["cache"]["T0"], c)
    return plan["cache"][key]


def onde_champ(plan, l, mx=0, my=0):
    """Intensité au détecteur sur la grille native, pour une longueur d'onde et un point source (inclinaison mx, my en
    périodes de la grille au premier plan). Renvoie (I, [dx, dy])."""
    seq, P, nd, lm, pls = plan["seq"], plan["seq"]["prims"], plan["seq"]["iDet"], l * 1e-6, plan["planes"]
    u, c = _eclairage(plan, l)
    Nx, Ny = plan["N"]
    if mx or my:
        u = u * np.exp(2j * math.pi * (mx * (np.arange(Nx) - Nx // 2) / Nx)).reshape(1, -1) * np.exp(2j * math.pi * (my * (np.arange(Ny) - Ny // 2) / Ny)).reshape(-1, 1)
    d, cs = list(plan["d"]), [c, c]
    for k, pl in enumerate(pls):
        der = k == len(pls) - 1
        Mt = mul(chaine(seq, l, pl["i"], nd if der else pls[k + 1]["i"]), abcd_prim(P[pl["i"]], l))
        u, d[0], cs[0] = _prop_axe(u, 1, lm, d[0], cs[0], Mt, pl["genre"] != "speckle")
        u, d[1], cs[1] = _prop_axe(u, 0, lm, d[1], cs[1], Mt, pl["genre"] != "speckle")
        if not der:
            key = ("T", k + 1, l)
            if key not in plan["cache"]:
                plan["cache"][key] = _t_plan(plan, pls[k + 1], d)
            u = u * plan["cache"][key]
    return u.real ** 2 + u.imag ** 2, d


def _natif(I, d, h, cible=(0, 0)):
    """Grille native prête à lire : moyenne par blocs (puissance de 2) tant que le pas reste sous le demi-pixel h/2, ou
    sous cible[a] (taille de l'image d'une strate de la source : la somme sur les strates reste lisse)."""
    off, d = [0.0, 0.0], list(d)
    for axe in (1, 0):
        N, r, a = I.shape[axe], 1, 1 - axe
        while 2 * r * d[a] <= max(h / 2, cible[a]) and 2 * r <= N:
            r *= 2
        if r > 1:
            I = I.reshape((I.shape[0], N // r, r) if axe == 1 else (N // r, r, I.shape[1])).mean(axis=2 if axe == 1 else 1)
            off[a], d[a] = (r - 1) / 2 * d[a], r * d[a]
    return {"I": I, "d": d, "off": off, "L": [I.shape[1] * d[0], I.shape[0] * d[1]],
            "mx": I.sum(axis=1) * d[0], "my": I.sum(axis=0) * d[1], "tot": I.sum() * d[0] * d[1]}


def _lire(nat, gx, gy, boite=(0, 0), h=0):
    """Intensité aux points (gx, gy) du repère de la grille : bilinéaire, nulle hors de la grille (l'intégrale de la
    figure est conservée). boite[a] > 0 :
    figure intégrée le long de l'axe a et étalée sur cette largeur (part du pixel h couverte)."""
    if "w2" in nat:                                      # faisceau gaussien sans plan diffractant
        return 2 / (math.pi * nat["w2"]) * np.exp(-2 * ((gx - nat["c"][0]) ** 2 + (gy - nat["c"][1]) ** 2) / nat["w2"])
    I = nat["I"]
    Ny, Nx = I.shape

    def axe(g, N, a):                                   # indices voisins et poids ; hors de la grille : zéro
        t = (g - nat["off"][a]) / nat["d"][a] + N // 2
        i0 = np.floor(t)
        f, i0 = t - i0, i0.astype(np.int64)
        return np.clip(i0, 0, N - 1), np.clip(i0 + 1, 0, N - 1), (1 - f) * ((i0 >= 0) & (i0 < N)), f * ((i0 + 1 >= 0) & (i0 + 1 < N))

    bx = _c1(0, boite[0], gx, h) / boite[0] if boite[0] else None
    by = _c1(0, boite[1], gy, h) / boite[1] if boite[1] else None
    if boite[0] and boite[1]:
        return nat["tot"] * bx * by
    if boite[1]:
        x0, x1, a0, a1 = axe(gx, Nx, 0)
        return (nat["my"][x0] * a0 + nat["my"][x1] * a1) * by
    if boite[0]:
        y0, y1, b0, b1 = axe(gy, Ny, 1)
        return (nat["mx"][y0] * b0 + nat["mx"][y1] * b1) * bx
    x0, x1, a0, a1 = axe(gx, Nx, 0)
    y0, y1, b0, b1 = axe(gy, Ny, 1)
    return (I[y0, x0] * a0 + I[y0, x1] * a1) * b0 + (I[y1, x0] * a0 + I[y1, x1] * a1) * b1


def _eclaire(plan, l, xl, yl):
    """Le point (xl, yl) du plan source (labo) est-il éclairé par la lampe, vu du centre du premier plan ? (paraxial)"""
    seq, src, em = plan["seq"], plan["src"], plan["seq"]["source"]["em"]
    if src["i"] < 0:
        return 1.0
    Me, Ms, Oe = chaine(seq, l, -1, src["i"]), chaine(seq, l, src["i"], plan["planes"][0]["i"]), seq["source"]["fr"]["O"]
    g = Me[3] + Me[1] * Ms[0] / Ms[1]
    xe, ye = g * xl - Oe[0], g * yl - Oe[1]
    if em["forme"] == "rect":
        return 1.0 * ((abs(xe) < 0.5 * em["a"]) & (abs(ye) < 0.5 * em["b"]))
    return 1.0 * (xe * xe + ye * ye < em["a"] ** 2)


def _ordres(plan, l):
    """Réseau : copies décalées, une par ordre (sin θ = mλ/a, décalage B tan θ le long de l'axe du réseau)."""
    if plan["reseau"] is None:
        return [(0.0, 0.0, 1.0)]
    seq, pr, out = plan["seq"], plan["seq"]["prims"][plan["reseau"]], []
    Bg, c0, s0 = chaine(seq, l, plan["reseau"], seq["iDet"])[1], math.cos(plan["ang"]), math.sin(plan["ang"])
    gx, gy = c0 * pr["ex"][0] + s0 * pr["ex"][1], -s0 * pr["ex"][0] + c0 * pr["ex"][1]
    for m in range(-3, 4):
        s = m * l * 1e-6 / pr["p"][0]
        if abs(s) < 1:
            t = Bg * s / math.sqrt(1 - s * s)
            out.append((t * gx, t * gy, ETA_RESEAU[abs(m)]))
    return out


def _points(plan, l):
    """Points de la source pour la somme brute : réseau dont le pas donne une inclinaison entière sur la grille."""
    if plan["laser"]:
        return [(0, 0, 1.0)]
    seq, src, s = plan["seq"], plan["src"], plan["pasSource"]
    Bs, (Nx, Ny), d = chaine(seq, l, src["i"], plan["planes"][0]["i"])[1], plan["N"], plan["d"]
    sx, sy, sg = s * l * 1e-6 * abs(Bs) / (Nx * d[0]), s * l * 1e-6 * abs(Bs) / (Ny * d[1]), 1 if Bs > 0 else -1
    c0, s0, ca, sa = math.cos(plan["ang"]), math.sin(plan["ang"]), math.cos(src["ang"]), math.sin(src["ang"])
    b = _boite(src["g"] + [GRAND, GRAND], src["ang"] - plan["ang"])
    cx, cy = c0 * src["O"][0] + s0 * src["O"][1] + b[4], -s0 * src["O"][0] + c0 * src["O"][1] + b[5]
    cp, sp = abs(math.cos(src["ang"] - plan["ang"])), abs(math.sin(src["ang"] - plan["ang"]))
    ex, ey, g, out = sx * cp + sy * sp, sx * sp + sy * cp, src["g"], []
    for ky in range(math.ceil((cy - b[1]) / sy - 1), math.floor((cy + b[1]) / sy + 1) + 1):
        for kx in range(math.ceil((cx - b[0]) / sx - 1), math.floor((cx + b[0]) / sx + 1) + 1):
            xl, yl = c0 * kx * sx - s0 * ky * sy, s0 * kx * sx + c0 * ky * sy
            xs, ys = ca * (xl - src["O"][0]) + sa * (yl - src["O"][1]), -sa * (xl - src["O"][0]) + ca * (yl - src["O"][1])
            xa, ya = np.array(xs), np.array(ys)
            if src["forme"] == "masque":
                w = couverture(src["f"], src["a"], xa, ya, ex, ey, True)
            elif src["forme"] == "rect":
                w = _c1(0, 2 * g[2], xa, ex) * _c1(0, 2 * g[3], ya, ey)
            else:
                w = _disque(g[2], xa, ya, ex, ey)
            w = float(w) * float(_eclaire(plan, l, xl, yl)) * sx * sy
            if w > 0:
                out.append((-kx * s * sg, -ky * s * sg, w))
    return out


def onde_passe(plan, rendu):
    """Éclairement XYZ par pixel de la fenêtre (cx ± W, cy ± W) du détecteur, ligne 0 en bas : mêmes unités que le moteur
    géométrique (Σ poids × XYZ / (rayons × aire du pixel)). rendu = {res, W, cx, cy, ns, passe, graine, np}."""
    seq, res, W = plan["seq"], rendu["res"], rendu["W"]
    P, nd, det, em = seq["prims"], seq["iDet"], seq["prims"][seq["iDet"]], seq["source"]["em"]
    h, c0, s0 = 2 * W / res, math.cos(plan["ang"]), math.sin(plan["ang"])
    X, Y = np.meshgrid(rendu.get("cx", 0) - W + (np.arange(res) + 0.5) * h, rendu.get("cy", 0) - W + (np.arange(res) + 0.5) * h)
    xl, yl = det["O"][0] + X * det["ex"][0] + Y * det["ey"][0], det["O"][1] + X * det["ex"][1] + Y * det["ey"][1]
    GX, GY = c0 * xl + s0 * yl, -s0 * xl + c0 * yl
    img, pls, src, lams = np.zeros((res, res, 3)), plan["planes"], plan["src"], plan["lambdas"]
    passe, graine = rendu.get("passe", 0), rendu.get("graine", 1)

    def ajouter(nat, wl, k, dx=0.0, dy=0.0, boite=(0, 0)):
        s = 0.0
        for ox, oy, eta in _ordres(plan, wl[0]):
            s = s + eta * _lire(nat, GX - dx - ox, GY - dy - oy, boite, h)
        for c in range(3):
            img[:, :, c] += (k * wl[1][c]) * s

    if not pls:                                          # laser sans plan diffractant : faisceau gaussien (ABCD)
        for wl in lams:
            lm, Md, Oe = wl[0] * 1e-6, chaine(seq, wl[0], -1, nd), seq["source"]["fr"]["O"]
            zr = math.pi * em["a"] ** 2 / lm
            w2 = lm / (math.pi * (1 / ((Md[0] * -1j * zr + Md[1]) / (Md[2] * -1j * zr + Md[3]))).imag)
            ajouter({"w2": w2, "c": [Md[0] * Oe[0], Md[0] * Oe[1]]}, wl, em["L"])
    elif not plan["laser"] and len(pls) == 1:            # raccourci : un point source ne fait que décaler la figure
        i1, g = pls[0]["i"], src["g"]
        ca, sa = math.cos(src["ang"]), math.sin(src["ang"])

        def kappa(l):
            return -mul(chaine(seq, l, i1, nd), abcd_prim(P[i1], l))[1] / chaine(seq, l, src["i"], i1)[1]

        ns, ph = rendu.get("ns", 16), src["ang"] - plan["ang"]
        al = 0 if abs(math.sin(ph)) < 1e-9 else 1 if abs(math.cos(ph)) < 1e-9 else -1     # axes de la source ↔ grille
        sep = src["forme"] == "rect" or (src["forme"] == "masque" and (src["f"] == F.RECT or (src["f"] == F.FENTES and src["a"][0] <= 1)))
        for wl in lams:
            key = ("I", wl[0])
            if key not in plan["cache"]:
                plan["cache"][key] = onde_champ(plan, wl[0])
            (I0, d0), kp = plan["cache"][key], kappa(wl[0])
            Lg = [I0.shape[1] * d0[0], I0.shape[0] * d0[1]]
            T = [2 * g[2] * abs(kp), 2 * g[3] * abs(kp)]
            nn, boite, cible = [min(ns, max(1, math.ceil(T[0] / h))), min(ns, max(1, math.ceil(T[1] / h)))], [0, 0], [0, 0]
            for pr_ in (0, 1):                           # source bien plus étendue que la figure le long d'un axe
                ga = pr_ if al == 0 else 1 - pr_
                if al >= 0 and sep and T[pr_] >= 2 * Lg[ga]:
                    nn[pr_] = 1
                if al >= 0:
                    cible[ga] = T[pr_] / nn[pr_]
                    if cible[ga] >= 2 * Lg[ga]:
                        boite[ga] = cible[ga]
            key = ("N", wl[0], h, cible[0], cible[1])
            if key not in plan["cache"]:
                plan["cache"][key] = _natif(I0, d0, h, cible)
            nat = plan["cache"][key]
            bo = [boite[0], boite[1]] if al == 0 else [boite[1], boite[0]]      # par axe propre de la source
            for b in range(nn[1]):
                for a in range(nn[0]):
                    u1 = u2 = 0.5
                    if passe:
                        al_ = Alea(graine_rayon(graine, passe, a + nn[0] * b))
                        u1, u2 = al_.u(), al_.u()
                        u1, u2 = 0.5 if bo[0] else u1, 0.5 if bo[1] else u2
                    xs, ys = g[0] - g[2] + (a + u1) * 2 * g[2] / nn[0], g[1] - g[3] + (b + u2) * 2 * g[3] / nn[1]
                    if src["forme"] == "rect":
                        w = 1.0
                    elif src["forme"] == "disque" or src["f"] == F.DISQUE:
                        w = _aire_disque(g[2], xs, ys, 2 * g[2] / nn[0], 2 * g[3] / nn[1])
                    else:
                        w = float(forme(src["f"], src["a"], xs, ys))
                    px, py = src["O"][0] + ca * xs - sa * ys, src["O"][1] + sa * xs + ca * ys
                    w = w * float(_eclaire(plan, wl[0], px, py)) * (2 * g[2] / nn[0]) * (2 * g[3] / nn[1])
                    if w > 0:
                        ajouter(nat, wl, w * em["L"], kp * (c0 * px + s0 * py), kp * (-s0 * px + c0 * py), boite)
    else:                                                # somme brute : une propagation par point source et par λ
        paires = [(il, pt) for il, wl in enumerate(lams) for pt in _points(plan, wl[0])]
        ordre = sorted(range(len(paires)), key=lambda q: (mich.hash32(graine ^ mich.hash32(q)), q))
        n = rendu.get("np", 0) or len(paires)
        for q in range(min(n, len(paires))):
            il, (mx, my, w) = paires[ordre[(passe * n + q) % len(paires)]]
            I, d = onde_champ(plan, lams[il][0], mx, my)
            ajouter(_natif(I, d, h), lams[il], w * em["L"] * len(paires) / min(n, len(paires)))
    return img.reshape(-1)


def onde_spectre(plan, o):
    """Spectromètre sur le moteur ondulatoire : éclairement moyen sur la fibre (o = {x, y, r, l, ns, np, graine, passe})
    pour une longueur d'onde de poids 1 (figure nue), sur 4 × 4 pixels de même aire que la fibre."""
    p = dict(plan)
    p["lambdas"] = [[o["l"], [1.0, 1.0, 1.0]]]
    rendu = {"res": 4, "W": 0.8862269254527579 * o["r"], "cx": o["x"], "cy": o["y"]}
    for k in ("ns", "np", "graine", "passe"):
        if o.get(k) is not None:
            rendu[k] = o[k]
    img = onde_passe(p, rendu)
    return float(sum(img[3 * q] for q in range(16)) / 16)


# ================= contrôles (rejoués par le cœur JS) =================
def E(type_, id_, z, **kw):
    e = {"type": type_, "id": id_, "z": z}
    for k in ("x", "y", "rot", "incl"):
        if k in kw:
            e[k] = kw.pop(k)
    if kw:
        e["params"] = kw
    return e


def cas_controle():
    """Bancs de contrôle : chaque type d'élément et chaque primitive passent au moins une fois."""
    return [
        ("F, plan-convexe, écran (réelle)", {"optique": "reelle", "elements": [
            E("lanterne", "L", 0), E("lettreF", "F", 80), E("lentille", "l1", 480, f=100, D=40, forme="pcv"), E("ecran", "E", 620)]}),
        ("lanterne idéale (rectangle uniforme), F, lentille, écran", {"optique": "parfaite", "elements": [
            E("lanterne", "L", 0, emet="carre"), E("lettreF", "F", 80), E("lentille", "l1", 480, f=100, D=40, forme="pcv"), E("ecran", "E", 620)]}),
        ("lanterne sans condenseur, F, lentille, écran", {"optique": "parfaite", "elements": [
            E("lanterne", "L", 0, cond="rien", tirage=30), E("lettreF", "F", 120), E("lentille", "l1", 360, f=100, D=40), E("ecran", "E", 600)]}),
        ("lanterne et son dépoli, F, lentille, écran", {"optique": "parfaite", "elements": [
            E("lanterne", "L", 0, cond="depoli", tirage=60), E("lettreF", "F", 120), E("lentille", "l1", 360, f=100, D=40), E("ecran", "E", 600)]}),
        ("F, plan-convexe, écran (parfaite)", {"optique": "parfaite", "elements": [
            E("lanterne", "L", 0), E("lettreF", "F", 80), E("lentille", "l1", 480, f=100, D=40, forme="pcv"), E("ecran", "E", 620)]}),
        ("appareil photo : biconvexe, iris, capteur", {"optique": "reelle", "elements": [
            E("lanterne", "L", 0, tirage=66.2), E("lettreF", "F", 60), E("lentille", "l1", 700, f=50, D=25), E("iris", "I", 706, D=8),
            E("capteur", "C", 754)]}),
        ("objectif de microscope corrigé, oculaire, capteur (réelle)", {"optique": "reelle", "elements": [
            E("lanterne", "L", 0, tirage=70), E("trouSource", "T", 300, d=0.1), E("lentille", "ob", 310.5, f=10, D=8, forme="objectif"),
            E("capteur", "C", 520.5)]}),
        ("laser élargi : objectif, lentille de 200 mm, écran (réelle)", {"optique": "reelle", "elements": [
            E("laser", "La", 0), E("lentille", "ob", 100, f=10, D=8, forme="objectif"), E("lentille", "l1", 310, f=200, D=40),
            E("ecran", "E", 900)]}),
        ("trou source, iris : Airy", {"optique": "reelle", "elements": [
            E("spectrale", "S", 0, gaz="hg", filtre=True), E("trouSource", "T", 30, d=0.1), E("lentille", "l1", 430, f=200, D=40),
            E("iris", "I", 445, D=2), E("ecran", "E", 830)]}),
        ("trou source éclairé par la lanterne (à rebours dans le condenseur)", {"optique": "reelle", "elements": [
            E("lanterne", "L", 0, tirage=70), E("trouSource", "T", 420, d=0.5), E("lentille", "l1", 560, f=100, D=40), E("ecran", "E", 760)]}),
        ("autocollimation, miroir incliné", {"optique": "reelle", "elements": [
            E("lanterne", "L", 0), E("lettreF", "F", 100), E("lentille", "l1", 300, f=200, D=40), E("miroir", "M", 380, incl=[0.004, -0.006])]}),
        ("autocollimation, trou source", {"optique": "parfaite", "elements": [
            E("lanterne", "L", 0, tirage=100), E("trouSource", "T", 150, d=0.5), E("lentille", "l1", 350, f=200, D=40), E("miroir", "M", 450, incl=[0.0175, 0.0])]}),
        ("autocollimation (parfaite)", {"optique": "parfaite", "elements": [
            E("lanterne", "L", 0), E("lettreF", "F", 100), E("lentille", "l1", 300, f=200, D=40), E("miroir", "M", 380, incl=[0.0, 0.01])]}),
        ("divergente puis convergente, décentrée et inclinée", {"optique": "reelle", "elements": [
            E("lanterne", "L", 0), E("quadrillage", "Q", 100), E("lentille", "l1", 300, x=1.5, y=-2, incl=[0.05, -0.03], f=-100, D=40),
            E("lentille", "l2", 420, f=100, D=40, forme="pcv", retournee=True), E("ecran", "E", 900)]}),
        ("œil derrière une loupe", {"optique": "parfaite", "elements": [
            E("lanterne", "L", 0), E("quadrillage", "Q", 100), E("lentille", "l1", 140, f=50, D=25), E("oeil", "O", 160, type="myope", acc=1.5)]}),
        ("lunette, œil intégré décalé de 1,5 et −1 mm", {"optique": "reelle", "elements": [
            E("lanterne", "L", 0), E("regle", "R", 400), E("lunette", "Lu", 500, ox=1.5, oy=-1)]}),
        ("lunette sans œil intégré, œil posé derrière et décalé", {"optique": "reelle", "elements": [
            E("lanterne", "L", 0), E("regle", "R", 400), E("lunette", "Lu", 500, oeil="aucun"), E("oeil", "O", 742, y=1.2)]}),
        ("viseur, règle, œil implicite", {"optique": "reelle", "elements": [
            E("lanterne", "L", 0), E("regle", "R", 400), E("viseur", "V", 500)]}),
        ("Young : fente source, bifentes, lunette", {"optique": "reelle", "elements": [
            E("spectrale", "S", 0, gaz="na"), E("condenseur", "C", 50, retournee=True), E("fenteSource", "Fs", 120, rot=0.3, b=0.3),
            E("lentille", "l1", 320, f=200, D=40), E("bifentes", "B", 340, caches=[False, True, True]),
            E("lunette", "Lu", 420, bonnette=True)]}),
        ("lunette avec bonnette, quadrillage", {"optique": "reelle", "elements": [
            E("lanterne", "L", 0), E("quadrillage", "Q", 100), E("lunette", "Lu", 215, bonnette=True)]}),
        ("laser, dépoli, lentille", {"optique": "reelle", "elements": [
            E("laser", "La", 0, y=0.3), E("depoli", "D", 200), E("lentille", "l1", 400, f=100, D=40), E("ecran", "E", 700)]}),
        ("lanterne, dépoli devant la lettre F, lentille", {"optique": "parfaite", "elements": [
            E("lanterne", "L", 0), E("depoli", "D", 140), E("lettreF", "F", 150), E("lentille", "l1", 550, f=200, D=40), E("ecran", "E", 950)]}),
        ("polariseurs, lame quart d'onde, filtre", {"optique": "parfaite", "elements": [
            E("lanterne", "L", 0), E("polariseur", "P1", 100), E("lame", "Q", 150, rot=math.pi / 4),
            E("lame", "H", 170, rot=0.2, ordre="demi"), E("polariseur", "P2", 200, rot=0.7), E("filtre", "Fi", 220, couleur="interferentiel"),
            E("ecran", "E", 400)]}),
        ("réseau tourné, mercure", {"optique": "reelle", "elements": [
            E("spectrale", "S", 0, gaz="hg"), E("fenteSource", "Fs", 30, b=0.5), E("lentille", "l1", 230, f=200, D=40),
            E("reseau", "R", 260, rot=0.1, incl=[0.02, 0.15], n=300), E("lentille", "l2", 300, f=200, D=40), E("ecran", "E", 500)]}),
        ("objet de phase, couteau, filtres colorés", {"optique": "parfaite", "elements": [
            E("lanterne", "L", 0), E("filtre", "Fr", 40, couleur="rouge"), E("objetPhase", "Ph", 100, phi=3),
            E("lentille", "l1", 300, f=200, D=40), E("couteau", "K", 500, rot=0.2, xc=0.05), E("filtre", "Fb", 520, couleur="bleu"),
            E("ecran", "E", 700)]}),
        ("masques : fil, grille, pastille, lettre de phase", {"optique": "reelle", "elements": [
            E("spectrale", "S", 0, gaz="hg", filtre=False), E("fil", "Fi", 24, rot=0.4), E("grilleCroisee", "G", 26), E("pastille", "Pa", 28, d=0.2),
            E("objetPhase", "Ph", 34, forme="lettre"), E("ecran", "E", 300)]}),
        ("fentes multiples, lanterne", {"optique": "reelle", "elements": [
            E("lanterne", "L", 0, tirage=62), E("fentesMultiples", "N", 400, n=5), E("ecran", "E", 1500)]}),
        ("diapo de Siemens éclairée, lentille inclinée", {"optique": "reelle", "elements": [
            E("lanterne", "L", 0), E("diapo", "D", 100, eclairee=True), E("lentille", "l1", 400, f=200, D=40, incl=[0.2, 0]), E("ecran", "E", 750)]}),
        ("diapo USAF sous la lanterne, projection", {"optique": "parfaite", "elements": [
            E("lanterne", "L", 0), E("diapo", "D", 80, image="usaf"), E("lentille", "l1", 480, f=100, D=40), E("ecran", "E", 620)]}),
        ("microscope : objectif de 10 mm, oculaire de 20 mm, œil (lot 6e)", {"optique": "reelle", "elements": [
            E("lanterne", "L", 0), E("depoli", "D", 145), E("regle", "R", 150), E("lentille", "l1", 160.5, f=10, D=8),
            E("lentille", "l2", 390.5, f=20, D=16), E("oeil", "O", 412.5)]}),
        ("œil myope, lentille de −500 mm (lot 6e)", {"optique": "parfaite", "elements": [
            E("lanterne", "L", 0), E("depoli", "D", 140), E("lettreF", "F", 150), E("lentille", "l1", 450, f=300, D=40),
            E("lentille", "l2", 640, f=-500, D=40), E("oeil", "O", 650, type="myope")]}),
        ("lunette de Galilée : pupille d'entrée virtuelle vue du dépoli (cible à rayon négatif)", {"optique": "reelle", "elements": [
            E("lanterne", "L", 60, tirage=70), E("depoli", "D", 190), E("lettreF", "F", 200), E("lentille", "l1", 500, f=300, D=40),
            E("lentille", "l2", 700, f=200, D=40), E("lentille", "l3", 800.490965, f=-100, D=40, forme="bicc"),
            E("oeil", "O", 812.490965, type="normal", mode="objet", acc=0, pupille=4)]}),
        ("œil seul en bout de banc", {"optique": "parfaite", "elements": [
            E("spectrale", "S", 0, gaz="na"), E("trouSource", "T", 30, d=1), E("lentille", "l1", 400, f=300, D=40)]}),
    ]


def _num(v):
    if isinstance(v, float) and not math.isfinite(v):
        return None
    return v


def _prims_json(seq):
    out = []
    for pr in seq["prims"]:
        out.append([pr["k"], pr["dz"], pr["R"], pr["Sm"], pr["sens"], pr["zp"], pr["s"]] + list(pr["O"]) + list(pr["ex"]) + list(pr["ey"])
                   + list(pr["ez"]) + list(pr["p"]) + list(pr["ap"]))
    return out


NR_CTRL, N_DET, N_ARR = 3000, 50, 30      # rayons tirés par passe ; on garde 50 détectés et 30 arrêtés par banc


def formes_controle():
    """Formes des masques du catalogue (et variantes), évaluées sur une grille couvrant le motif."""
    out = []
    for nom, T in TYPES.items():
        for pr in T["prims"](params({"type": nom}), {"optique": "parfaite", "sens": 1}, {"type": nom, "z": 0}):
            if pr["k"] == K.MASQUE:
                R = min(pr["rc"], pr["Sm"]) * 1.1
                out.append((nom, pr["p"][0], pr["p"][1:9], 0.2 if pr["p"][0] == F.BIFENTES else R, R))
    out += [("bifentes caches", F.BIFENTES, [0.2, 0.25, 0.3, 0.06, 5, 7, 3, 2], 0.2, 3.0), ("fentes N = 10", F.FENTES, [10, 0.04, 0.2, 5, 0, 0, 0, 0], 1.2, 3),
            ("lettre de phase", F.LETTRE, [0.25, 0, 0, 0, 0, 0, 0, 0], 3.0, 3.0),
            ("réticule de la lunette, près des traits", F.RETICULE, [1, 0.01, 0.1, 6, 0, 0, 0, 0], 0.7, 0.7)]
    res = []
    for nom, f, a, Rx, Ry in out:
        grille = []
        for i in range(61):
            for j in range(61):
                grille.append(forme(f, a, -Rx + 2 * Rx * i / 60, -Ry + 2 * Ry * j / 60))
        res.append({"nom": nom, "f": f, "a": a, "Rx": Rx, "Ry": Ry, "g": grille})
    return res


def cas_onde():
    """Bancs de contrôle du moteur ondulatoire : (nom, banc, options du plan, rendus). Petites grilles : le cœur JS les
    rejoue en une seconde."""
    def young(src, fs, extra=(), opt="parfaite", f1=200, **kw):
        return {"optique": opt, "elements": [src, fs, E("lentille", "l1", 30 + f1, f=f1, D=40), E("bifentes", "B", 250, caches=[True, False, True], **kw),
                                             E("lentille", "l2", 300, f=200, D=40), E("ecran", "E", 500)] + list(extra)}

    def filtrage(objet, filtre):
        return {"optique": "parfaite", "elements": [E("spectrale", "S", 0, gaz="hg", filtre=True), E("trouSource", "T", 30, d=0.1), E("lentille", "l0", 230, f=200, D=40),
                                                    E("iris", "I", 240, D=3), objet, E("lentille", "l1", 450, f=200, D=40)] + filtre
                + [E("lentille", "l2", 850, f=200, D=40), E("ecran", "E", 1050)]}

    na = E("spectrale", "S", 0, gaz="na", filtre=True)
    hg = E("spectrale", "S", 0, gaz="hg", filtre=True)
    return [
        ("Young aligné, sodium", young(na, E("fenteSource", "Fs", 30, b=0.2)), {"maxN": 1024, "maxCellules": 1 << 15},
         [{"res": 24, "W": 1.2, "ns": 8}, {"res": 16, "W": 8.0, "cx": 1.0, "cy": -2.0}]),
        ("Young, fente source tournée, strates tirées (optique réelle)", young(na, E("fenteSource", "Fs", 30, b=0.3, rot=0.3), opt="reelle"),
         {"maxN": 1024, "maxCellules": 1 << 15}, [{"res": 20, "W": 1.5, "ns": 6, "passe": 2, "graine": 5}]),
        ("Young, fente source croisée", young(na, E("fenteSource", "Fs", 30, b=0.1, rot=math.pi / 2), f1=100), {"maxN": 512, "maxCellules": 1 << 14, "fin": 2},
         [{"res": 16, "W": 1.5, "ns": 4, "passe": 1, "graine": 2}]),
        ("Young en lumière blanche, filtre coloré", young(E("lanterne", "L", -390, tirage=70), E("fenteSource", "Fs", 30, b=0.05), extra=[E("filtre", "Fv", 520, couleur="vert")]),
         {"maxN": 512, "maxCellules": 1 << 14, "nl": 6}, [{"res": 24, "W": 1.0}]),
        ("laser et fente", {"optique": "parfaite", "elements": [E("laser", "La", 0, x=0.02), E("fente", "F", 300, e=0.1), E("ecran", "E", 1300)]},
         {"maxN": 512, "maxCellules": 1 << 14}, [{"res": 24, "W": 20.0}]),
        ("laser vert et fente", {"optique": "parfaite", "elements": [E("laser", "La", 0, x=0.02, vert=True), E("fente", "F", 300, e=0.1), E("ecran", "E", 1300)]},
         {"maxN": 512, "maxCellules": 1 << 14}, [{"res": 24, "W": 20.0}]),
        ("laser et dépoli (tavelures)", {"optique": "parfaite", "elements": [E("laser", "La", 0), E("depoli", "D", 200), E("ecran", "E", 700)]},
         {"maxCellules": 1 << 12, "graine": 11}, [{"res": 16, "W": 4.0}]),
        ("laser et réseau tourné", {"optique": "parfaite", "elements": [E("laser", "La", 0, y=0.3), E("reseau", "R", 100, rot=0.2, n=300), E("ecran", "E", 600)]},
         {}, [{"res": 16, "W": 3.0, "cx": 500 * math.tan(math.asin(632.8e-6 * 300)) * math.cos(0.2), "cy": 500 * math.tan(math.asin(632.8e-6 * 300)) * math.sin(0.2)},
              {"res": 16, "W": 2.0}]),
        ("laser, fente tournée puis réseau", {"optique": "parfaite", "elements": [E("laser", "La", 0), E("fente", "F", 300, e=0.1, rot=0.4), E("reseau", "R", 320, n=100),
                                                                                E("ecran", "E", 900)]},
         {"maxN": 256, "maxCellules": 1 << 13}, [{"res": 20, "W": 60.0}]),
        ("Abbe-Porter, somme brute par passes", filtrage(E("grilleCroisee", "G", 250), [E("fente", "F", 650, e=0.2)]), {"maxCellules": 1 << 12},
         [{"res": 16, "W": 1.2, "np": 5, "passe": 1, "graine": 3}, {"res": 12, "W": 1.2}]),
        ("strioscopie : objet de phase et couteau", filtrage(E("objetPhase", "Ph", 250, phi=1), [E("couteau", "K", 650, rot=0.3, xc=0.01)]), {"maxCellules": 1 << 12},
         [{"res": 12, "W": 1.5, "np": 7}]),
        ("polariseurs, lame et trous d'Young", {"optique": "parfaite", "elements": [
            na, E("trouSource", "T", 30, d=0.2), E("polariseur", "P", 60), E("lame", "Q", 80, rot=0.5), E("polariseur", "A", 100, rot=0.7),
            E("lentille", "l1", 230, f=200, D=40), E("trousYoung", "Ty", 250), E("lentille", "l2", 300, f=200, D=40), E("ecran", "E", 500)]},
         {"maxN": 256, "maxCellules": 1 << 14}, [{"res": 20, "W": 1.0, "ns": 6}]),
        ("imagerie d'une fente (plans conjugués)", {"optique": "parfaite", "elements": [
            hg, E("trouSource", "T", 30, d=0.02), E("lentille", "l1", 230, f=200, D=40), E("fente", "F", 250, e=0.1, y=0.5), E("lentille", "l2", 450, f=100, D=40),
            E("ecran", "E", 650)]}, {"maxN": 256, "maxCellules": 1 << 13}, [{"res": 24, "W": 0.12, "cy": -0.5}]),
        ("fente, lentille, écran au-delà de l'image (figure retournée, près)", {"optique": "parfaite", "elements": [
            hg, E("trouSource", "T", 30, d=0.02), E("lentille", "l1", 230, f=200, D=40), E("fente", "F", 250, e=0.1, x=0.2), E("lentille", "l2", 350, f=50, D=25),
            E("ecran", "E", 460)]}, {"maxN": 256, "maxCellules": 1 << 13}, [{"res": 24, "W": 0.5}]),
        ("fente, plan de Fourier repris par une lentille (figure retournée, loin)", {"optique": "parfaite", "elements": [
            hg, E("trouSource", "T", 30, d=0.02), E("lentille", "l1", 230, f=200, D=40), E("fente", "F", 250, e=0.1, x=0.2), E("lentille", "l2", 300, f=200, D=40),
            E("lentille", "l3", 600, f=50, D=25), E("ecran", "E", 700)]}, {"maxN": 256, "maxCellules": 1 << 13}, [{"res": 24, "W": 3.0, "cx": 0.5}]),
        ("fil en champ proche", {"optique": "parfaite", "elements": [
            hg, E("trouSource", "T", 30, d=0.02), E("lentille", "l1", 230, f=200, D=40), E("iris", "I", 240, D=6), E("fil", "Fi", 250, rot=0.1), E("ecran", "E", 290)]},
         {"maxN": 1024, "maxCellules": 1 << 14}, [{"res": 24, "W": 0.4}]),
        ("diapo : portrait tramé, filtré par un iris (un pixel par maille)", filtrage(E("diapo", "D", 250, image="fourier"), [E("iris", "If", 650, D=1)]),
         {"maxCellules": 1 << 14}, [{"res": 16, "W": 3.0, "np": 3, "passe": 1, "graine": 3}]),
        ("diapo : lignes de la Lune, fente horizontale (grille grossie, moyenne par maille)",
         filtrage(E("diapo", "D", 250, image="lune", x=0.3), [E("fente", "F", 650, e=0.3, rot=math.pi / 2)]), {"maxCellules": 1 << 10},
         [{"res": 12, "W": 3.0, "np": 4}]),
        ("chambre noire : trou éclairé par l'ampoule", {"optique": "reelle", "elements": [E("spectrale", "S", 0, gaz="na"), E("trou", "Tr", 100, d=0.1, x=0.3), E("ecran", "E", 300)]},
         {"maxN": 256, "maxCellules": 1 << 14}, [{"res": 16, "W": 20.0, "ns": 5, "passe": 3}]),
    ]


def moteurs_controle():
    """Choix du moteur (§ 4.3) : bancs acceptés et refusés."""
    return [
        {"optique": "parfaite", "elements": [E("lanterne", "L", 0), E("lettreF", "F", 80), E("lentille", "l", 480, f=100), E("ecran", "E", 620)]},
        {"optique": "parfaite", "elements": [E("spectrale", "S", 0), E("fenteSource", "Fs", 30, b=0.1), E("lentille", "l", 230), E("iris", "I", 250, D=10), E("ecran", "E", 500)]},
        {"optique": "parfaite", "elements": [E("spectrale", "S", 0), E("fenteSource", "Fs", 30, b=0.1), E("lentille", "l", 230), E("iris", "I", 250, D=1), E("ecran", "E", 500)]},
        {"optique": "reelle", "elements": [E("spectrale", "S", 0), E("fenteSource", "Fs", 30, b=0.1), E("lentille", "l", 230), E("bifentes", "B", 250), E("lunette", "Lu", 330)]},
        {"optique": "parfaite", "elements": [E("laser", "La", 0), E("lentille", "l", 300), E("ecran", "E", 500)]},
        {"optique": "parfaite", "elements": [E("lanterne", "L", 0), E("depoli", "D", 100), E("fente", "F", 200), E("ecran", "E", 500)]},
        {"optique": "parfaite", "elements": [E("spectrale", "S", 0), E("lettreF", "Fl", 50), E("fente", "F", 100), E("lentille", "l", 300), E("miroir", "M", 400)]},
        {"optique": "parfaite", "elements": [E("spectrale", "S", 0), E("fenteSource", "Fs", 30), E("lentille", "l", 230), E("reseau", "R", 250), E("lentille", "l2", 300),
                                             E("ecran", "E", 500)]},
        {"optique": "parfaite", "elements": [E("spectrale", "S", 0), E("fente", "F", 100), E("reseau", "R", 150), E("fente", "F2", 200), E("ecran", "E", 500)]},
        {"optique": "parfaite", "elements": [E("spectrale", "S", 0), E("trouSource", "T", 30), E("lentille", "l", 230, f=100), E("fente", "F", 430), E("ecran", "E", 600)]},
        {"optique": "parfaite", "elements": [E("spectrale", "S", 0), E("fente", "F", 100)]},
        # optique parfaite de l'instrument : l'iris de 1 mm et le petit trou source restent au moteur géométrique
        ({"optique": "parfaite", "elements": [E("spectrale", "S", 0), E("fenteSource", "Fs", 30, b=0.1), E("lentille", "l", 230), E("iris", "I", 250, D=1),
                                              E("ecran", "E", 500)]}, {"ouvertures": False}),
        ({"optique": "parfaite", "elements": [E("spectrale", "S", 0), E("trouSource", "T", 300, d=0.1), E("lentille", "l", 700, f=100), E("ecran", "E", 900)]},
         {"ouvertures": False}),
        ({"optique": "parfaite", "elements": [E("spectrale", "S", 0), E("trouSource", "T", 300, d=0.1), E("lentille", "l", 700, f=100), E("ecran", "E", 900)]}, None),
        ({"optique": "parfaite", "elements": [E("spectrale", "S", 0), E("fenteSource", "Fs", 30, b=0.1), E("lentille", "l", 230), E("bifentes", "B", 250),
                                              E("lentille", "l2", 300), E("ecran", "E", 500)]}, {"ouvertures": False}),
        # diapo : éclairée par un trou source, elle diffracte même en optique parfaite ; sous la lanterne, elle devient la
        # source (rayons) ; éclairée par son dépoli : rayons
        ({"optique": "parfaite", "elements": [E("spectrale", "S", 0), E("trouSource", "T", 30, d=0.1), E("lentille", "l", 230), E("diapo", "D", 250),
                                              E("lentille", "l2", 450), E("ecran", "E", 650)]}, {"ouvertures": False}),
        {"optique": "reelle", "elements": [E("lanterne", "L", 0), E("diapo", "D", 80, image="usaf"), E("lentille", "l", 480, f=100), E("ecran", "E", 620)]},
        {"optique": "reelle", "elements": [E("spectrale", "S", 0), E("trouSource", "T", 30, d=0.1), E("lentille", "l", 230), E("diapo", "D", 250, eclairee=True),
                                           E("lentille", "l2", 450), E("ecran", "E", 650)]},
    ]


def _plan_json(pl):
    if not pl["ok"]:
        return {"ok": False, "raison": pl["raison"]}
    return {"ok": True, "laser": pl["laser"], "src": pl["src"]["i"], "planes": [[q["i"], q["genre"]] for q in pl["planes"]], "reseau": pl["reseau"],
            "N": list(pl["N"]), "limite": pl["limite"], "pasSource": pl["pasSource"],
            "nums": [pl["lref"], pl["ang"], _num(pl["rw"])] + list(pl["d"]) + [v for l in pl["lambdas"] for v in [l[0]] + list(l[1])]}


def controles_onde():
    cas = []
    for nom, banc, opt, rendus in cas_onde():
        pl = onde_plan(sequence(banc), opt)
        assert pl["ok"], (nom, pl)
        cas.append({"nom": nom, "banc": banc, "opt": opt, "plan": _plan_json(pl), "rendus": [{"rendu": r, "img": [float(v) for v in onde_passe(pl, r)]} for r in rendus]})
    return {"cas": cas, "moteurs": [{"banc": b[0], "opt": b[1], "plan": _plan_json(onde_plan(sequence(b[0]), b[1]))} if isinstance(b, tuple)
                                         else {"banc": b, "opt": None, "plan": _plan_json(onde_plan(sequence(b)))} for b in moteurs_controle()]}


def cas_spectre():
    """Bancs du spectromètre : rayons (continu filtré, raies du mercure) et ondes (Young en lumière blanche, sodium)."""
    blanc = {"optique": "parfaite", "elements": [E("lanterne", "L", 0), E("filtre", "Fi", 80, couleur="vert"), E("lettreF", "F", 120),
                                                 E("lentille", "l", 400, f=200, D=40), E("ecran", "E", 800)]}
    hg = {"optique": "reelle", "elements": [E("spectrale", "S", 0, gaz="hg"), E("trou", "T", 100, d=1), E("ecran", "E", 300)]}
    young = {"optique": "parfaite", "elements": [E("lanterne", "L", -390, tirage=70), E("fenteSource", "Fs", 30, b=0.05), E("lentille", "l1", 230, f=200, D=40),
                                                 E("bifentes", "B", 250, caches=[True, False, True]), E("lentille", "l2", 300, f=200, D=40), E("ecran", "E", 500)]}
    na = {"optique": "parfaite", "elements": [E("spectrale", "S", 0, gaz="na"), E("fenteSource", "Fs", 30, b=0.05), E("lentille", "l1", 230, f=200, D=40),
                                              E("bifentes", "B", 250, caches=[True, False, True]), E("lentille", "l2", 300, f=200, D=40), E("ecran", "E", 500)]}
    rayons = [("filtre vert", blanc, {"Nr": 4000, "graine": 3, "passe": 1, "spe": {"x": 0.5, "y": -1, "r": 3, "la": 400, "lb": 700, "nb": 30}}),
              ("mercure", hg, {"Nr": 4000, "graine": 3, "passe": 1, "spe": {"x": 0, "y": 0, "r": 2, "la": 380, "lb": 780, "nb": 0}})]
    ondes = [("young blanc", young, {"maxCellules": 1 << 14, "nl": 4}, [{"x": 0.3, "y": 0, "r": 0.05, "l": 520.0, "ns": 4},
                                                                        {"x": 0.3, "y": 0.2, "r": 0.05, "l": 610.0, "ns": 4, "passe": 2, "graine": 5}]),
             ("sodium", na, {"maxCellules": 1 << 14}, [{"x": -0.2, "y": 0, "r": 0.1, "l": 588.995, "ns": 4}])]
    return rayons, ondes


def controles_spectre():
    rayons, ondes = cas_spectre()
    out = {"rayons": [], "ondes": []}
    for nom, banc, rendu in rayons:
        out["rayons"].append({"nom": nom, "banc": banc, "rendu": rendu, "cases": spectre_cpu(sequence(banc), rendu)})
    for nom, banc, opt, os_ in ondes:
        seq = sequence(banc)
        pl = onde_plan(seq, opt)
        assert pl["ok"], (nom, pl)
        sp = seq["source"]["sp"]
        out["ondes"].append({"nom": nom, "banc": banc, "opt": opt, "o": os_, "I": [onde_spectre(pl, o) for o in os_],
                             "poids": [poids_spectre(seq, o["l"], 0 if sp["type"] == 0 else sp["l"].index(o["l"])) for o in os_]})
    return out


def cas_guides():
    """Contrôles de la visée guidée (lot 4a de) : guide appris par une passe pilote sur le processeur
    (résolution et sites choisis par guide_tables), ou guide synthétique (histogrammes donnés, cases vides comprises :
    tous les sites, y compris ceux du laser)."""
    def synth(n, graine):
        return [[float((i * (37 + 6 * s) + graine) % 11) for i in range(n * n)] for s in range(GUIDE_SITES)]
    return [
        ("lanterne et son dépoli, F, lentille, écran", {"pilote": {"W": 40, "cx": 0.5, "cy": -0.5, "Nr": 3000, "graine": 5, "passe": 0}}),
        ("trou source éclairé par la lanterne (à rebours dans le condenseur)", {"pilote": {"W": 1e9, "Nr": 3000, "graine": 5, "passe": 0}}),
        ("œil myope, lentille de −500 mm (lot 6e)", {"pilote": {"W": 1e9, "Nr": 12000, "graine": 5, "passe": 0}}),
        ("laser, dépoli, lentille", {"n": 8, "histos": synth(8, 3)}),
        ("masques : fil, grille, pastille, lettre de phase", {"n": 4, "alpha": 0.2, "histos": synth(4, 1)}),
    ]


def guide_json(G):
    return {"n": G["n"], "alpha": G["alpha"], "t": [None if t is None else {k: t[k] for k in ("n", "H", "prob", "alias", "iq")} for t in G["t"]]}


def controles_guides():
    bancs, out = dict(cas_controle()), []
    for nom, g in cas_guides():
        seq = sequence(bancs[nom])
        G = guide_cpu(seq, g["pilote"]) if "pilote" in g else guide_tables(g["histos"], g["n"], g.get("alpha", GUIDE["alpha"]))
        seq["guide"] = G
        rayons, nd, na = [], 0, 0
        for k in range(NR_CTRL):
            r = tirer(seq, 3, 1, k, NR_CTRL)
            s = suivre(seq, r, r["alea"])
            det = s["etat"] == "detecte"
            if (det and nd < N_DET) or (not det and na < N_ARR):
                rayons.append([k, s["i"], 1 if det else 0, r["x"], r["y"], r["w"], r["L"], r["l"]]
                              + list(r["f"]) + list(r["p"]) + list(r["d"]) + (list(r["J"]) if r["J"] else []))
                nd += det
                na += not det
            if nd >= N_DET and na >= N_ARR:
                break
        out.append(dict(g, nom=nom, banc=bancs[nom], mode=seq["mode"], guide=guide_json(G), rayons=rayons))
    return out


def generer_controles():
    cas = []
    for nom, banc in cas_controle():
        seq = sequence(banc)
        rayons, nd, na = [], 0, 0
        for k in range(NR_CTRL):
            r = tirer(seq, 3, 1, k, NR_CTRL)
            s = suivre(seq, r, r["alea"])
            det = s["etat"] == "detecte"
            if (det and nd < N_DET) or (not det and na < N_ARR):
                rayons.append([k, s["i"], 1 if det else 0, r["x"], r["y"], r["w"], r["L"], r["l"]]
                              + list(r["f"]) + list(r["p"]) + list(r["d"]) + (list(r["J"]) if r["J"] else []))
                nd += det
                na += not det
            if nd >= N_DET and na >= N_ARR:
                break
        o = seq["objet"]
        par = {}
        for l in (486.13, 587.6, 656.27):
            im = images(seq, l, o)
            par[str(l)] = None if im is None else {
                "reelles": [[x["s"], x["z"], x["gamma"], x["apres"]] for x in im["reelles"]],
                "finale": [_num(im["finale"]["s"]), _num(im["finale"].get("gamma")), _num(im["finale"].get("angle", 0))], "M": im["M"]}
        ouv = ouverture(seq, 587.6, o)
        env = enveloppe(seq, 587.6, -1, -2, 1.5, 1, 1.0, 4)
        env2 = enveloppe(seq, 550, o, -1, 1, 0, 0.5, 3)
        pin = pinceau(seq, {"x": 0.3, "y": 1.2, "z": seq["prims"][o]["zp"] if o >= 0 else seq["zEm"]}, n=5, axe=1,
                      ls=(480, 640), de=o + 1)
        cas.append({
            "nom": nom, "banc": banc, "prims": _prims_json(seq), "objet": o, "iDet": seq["iDet"], "vue": seq["vue"],
            "cible": seq["cible"], "stop": [ouv["i"], ouv["u"], ouv["D"]] if ouv else None, "rayons": rayons, "parax": par,
            "env": [[p["s"], p["z"], p["lo"], p["hi"]] for p in env["pts"]], "env2": [[p["s"], p["lo"], p["hi"]] for p in env2["pts"]],
            "pinceau": [[x["l"], 1 if x["etat"] == "detecte" else 0, x["L"], x["x"], x["y"]] + [c for pt in x["pts"] for c in pt] for x in pin],
        })
    faces = []
    for el, pts in ((E("lettreF", "F", 0), [(0, 0), (-4, 0), (2, 8.5)]), (E("objetPhase", "P", 0, phi=2), [(0.3, 0.1), (1.5, -1)]),
                    (E("objetPhase", "P", 0, forme="lettre"), [(-1.2, 0), (0.5, 0.5)]), (E("filtre", "Fi", 0, couleur="vert"), [(0, 0)]),
                    (E("bifentes", "B", 0, caches=[True, False, False]), [(0.15, 0), (-6.9, 0), (0.125, 7)])):
        for x, y in pts:
            faces.append({"el": el, "x": x, "y": y, "l": 546.07, "t": transmission(el, x, y, 546.07)})
    jon = []
    for el, l in ((E("lame", "Q", 0, rot=0.3), 600.0), (E("lame", "H", 0, rot=-1.1, ordre="demi"), 450.0), (E("polariseur", "P", 0, rot=2.0), 550.0)):
        jon.append({"el": el, "l": l, "M": jones(el, l)})
    return {"cas": cas, "guides": controles_guides(), "onde": controles_onde(), "spectres": controles_spectre(), "faces": faces, "jones": jon, "airy": AIRY, "formes": formes_controle(),
            "lentilles": [[f, D, forme, ret, lentille(f, D, forme, ret)] for f, D, forme, ret in
                          ((100, 40, "pcv", False), (200, 40, "bicv", False), (-100, 40, "bicc", False), (60, 50, "asph", True), (50, 25, "bicv", False))],
            "gauss": [[x["s"], x["w"]] for x in gaussien(sequence(next(b for n, b in cas_controle() if n.startswith("laser"))), 632.8, 0.4, [50, 150, 199, 600])]}


# ================= vérifications physiques (SPEC § 8, partie géométrique) =================
def _axe(seq, i0, h, l, z_lens):
    """Croisement de l'axe d'un rayon méridien (plan y) issu du point axial de l'objet, visant la hauteur h au plan z_lens."""
    P0 = seq["prims"][i0]["zp"] if i0 >= 0 else seq["zEm"]
    v = [0, h, z_lens - P0]
    dn = math.sqrt(v[1] * v[1] + v[2] * v[2])
    r = {"p": [0, 0, P0], "d": [0, v[1] / dn, v[2] / dn], "l": l, "w": 1, "f": [0, 0, 0], "J": None, "L": 0.0, "n": 1, "x": 0, "y": 0}
    j = i0 + 1
    while j < seq["iDet"]:
        if seq["prims"][j]["k"] != K.AIRY and etape(seq["prims"][j], r, Alea(1), seq) != 0:
            return None
        j += 1
    p, d = r["p"], r["d"]
    return p[2] - p[1] * d[2] / d[1], r


def abcd_lentille(L, l):
    """Matrice d'une lentille épaisse seule (dioptre, verre, dioptre), indépendante de la séquence."""
    n = mich.indice("bk7", l)
    return mul([1, 0, -(1 - n) * L["c2"], 1], mul([1, L["t"] / n, 0, 1], [1, 0, -(n - 1) * L["c1"], 1]))


def verifications(sortie=print):
    res = []

    def ok(cond, titre, detail=""):
        res.append((bool(cond), titre, detail))
        sortie(("  ok    " if cond else "  ÉCHEC ") + titre + (" — " + detail if detail else ""))

    # 0. focales effectives : lentilles conçues pour f' à 587,6 nm
    for f, D, fo in ((100, 40, "pcv"), (200, 40, "bicv"), (50, 25, "bicv"), (-100, 40, "bicc"), (-200, 40, "bicc"), (60, 50, "asph")):
        seq = sequence({"optique": "reelle", "elements": [E("laser", "La", 0), E("lentille", "l", 300, f=f, D=D, forme=fo), E("ecran", "E", 900)]})
        Ml, Ms = abcd_lentille(lentille(f, D, fo), 587.6), images(seq, 587.6, -1)["M"]
        ok(abs(-1 / Ml[2] - f) < 1e-9 * abs(f) and abs(Ms[2] - Ml[2]) < 1e-15, "focale effective %s %g mm (et la séquence)" % (fo, f),
           "f' = %.12g" % (-1 / Ml[2]))

    # 1. Gauss, lentille idéale : image d'un plan, stigmatisme exact pour tous les rayons
    seq = sequence({"optique": "parfaite", "elements": [E("lanterne", "L", 0), E("lettreF", "F", 100), E("lentille", "l1", 400, f=200, D=40),
                                                        E("ecran", "E", 1000)]})
    im = images(seq, 550, seq["objet"])
    ok(abs(im["finale"]["z"] - 1000) < 1e-9 and abs(im["finale"]["gamma"] + 2) < 1e-12, "image de Gauss (idéale) : p = −300 → p' = 600, γ = −2",
       "z = %.9g, γ = %.9g" % (im["finale"]["z"], im["finale"]["gamma"]))
    pin = pinceau(seq, {"x": 2.0, "y": 4.0, "z": 100}, n=9, axe=1, de=seq["objet"] + 1)
    e = max(math.hypot(x["x"] - (-4), x["y"] - (-8)) for x in pin if x["etat"] == "detecte")
    ok(e < 1e-9 and all(x["etat"] == "detecte" for x in pin), "lentille idéale stigmatique (9 rayons d'un point hors axe)", "écart %.1e mm" % e)

    # 2. lentille épaisse : image paraxiale = limite des rayons exacts
    seq = sequence({"optique": "reelle", "elements": [E("lanterne", "L", 0), E("lettreF", "F", 80), E("lentille", "l1", 480, f=100, D=40, forme="pcv"),
                                                      E("ecran", "E", 620)]})
    o = seq["objet"]
    zG = images(seq, 587.6, o)["finale"]["z"]
    z0, _ = _axe(seq, o, 0.02, 587.6, 480)
    ok(abs(z0 - zG) < 2e-4, "image paraxiale (épaisse, pcv 100) = limite des rayons exacts", "Gauss %.5f, rayon h = 0,02 mm : %.5f mm" % (zG, z0))

    # 3. aberration sphérique de la plan-convexe (chiffres du § 1 : marginal à 1,65 mm au plan de Gauss, 3,7 retournée ;
    #    meilleure image 7 mm avant, rms 0,27 mm)
    def sa(ret):
        sq = sequence({"optique": "reelle", "elements": [E("lanterne", "L", 0), E("lettreF", "F", 80),
                                                         E("lentille", "l1", 480, f=100, D=40, forme="pcv", retournee=ret), E("ecran", "E", 620)]})
        oo = sq["objet"]
        zg = images(sq, 587.6, oo)["finale"]["z"]
        L = lentille(100, 40, "pcv", ret)
        zv = 480 - L["t"] / 2
        # rayon marginal : visé au bord utile du premier dioptre (0,97 h, comme les rayons de la maquette)
        _, r = _axe(sq, oo, 0.97 * 20, 587.6, zv)
        ym = r["p"][1] + (zg - r["p"][2]) * r["d"][1] / r["d"][2]
        # meilleure image : pupille remplie uniformément (rayons visés uniformément dans le premier dioptre)
        pts = []
        for i in range(60):
            for j in range(60):
                hx, hy = -20 + 40 * (i + 0.5) / 60, -20 + 40 * (j + 0.5) / 60
                if hx * hx + hy * hy > 0.97 * 0.97 * 400:
                    continue
                v = [hx, hy, zv - 80]
                dn = math.sqrt(sum(c * c for c in v))
                rr = {"p": [0, 0, 80], "d": [c / dn for c in v], "l": 587.6, "w": 1, "f": [0, 0, 0], "J": None, "L": 0.0, "n": 1, "x": 0, "y": 0}
                good = True
                for jj in range(oo + 1, sq["iDet"]):
                    if sq["prims"][jj]["k"] != K.AIRY and etape(sq["prims"][jj], rr, Alea(1), sq) != 0:
                        good = False
                        break
                if good:
                    pts.append((rr["p"], rr["d"]))

        def rms(z):
            return math.sqrt(sum(((p[0] + (z - p[2]) * d[0] / d[2]) ** 2 + (p[1] + (z - p[2]) * d[1] / d[2]) ** 2) for p, d in pts) / len(pts))
        zs = np.linspace(zg - 20, zg + 2, 221)
        r_ = [rms(z) for z in zs]
        kb = int(np.argmin(r_))
        return abs(ym), zg - zs[kb], r_[kb]
    m1, dz1, rm1 = sa(False)
    m2, dz2, rm2 = sa(True)
    ok(abs(m1 - 1.65) < 0.1 and abs(m2 - 3.7) < 0.2, "aberration sphérique pcv 100, objet à 400 mm : marginal au plan de Gauss",
       "bombée vers l'objet %.2f mm (1,65 attendu), retournée %.2f mm (3,7)" % (m1, m2))
    ok(abs(dz1 - 7) < 1.0 and abs(rm1 - 0.27) < 0.04, "meilleure image (pupille pleine, bombée vers l'objet)",
       "%.1f mm avant Gauss (7), rms %.3f mm (0,27) ; retournée : %.1f mm, rms %.3f" % (dz1, rm1, dz2, rm2))

    # 4. chromatisme longitudinal ≈ f'/V (BK7 : V ≈ 64)
    nd, nF, nC = mich.indice("bk7", 587.6), mich.indice("bk7", 486.13), mich.indice("bk7", 656.27)
    V = (nd - 1) / (nF - nC)
    fF, fC = -1 / abcd_lentille(lentille(200, 40), 486.13)[2], -1 / abcd_lentille(lentille(200, 40), 656.27)[2]
    ok(abs((fC - fF) / (200 / V) - 1) < 0.02, "chromatisme longitudinal f'_C − f'_F ≈ f'/V (biconvexe 200)",
       "%.3f mm pour f'/V = %.3f mm (V = %.1f)" % (fC - fF, 200 / V, V))

    # 5. tache d'Airy : trou de 1 µm, lentille 200, iris Ø 2 mm, écran au plan image ; rayon à 83,8 % d'énergie ≈ 1,22 λ L/D
    seq = sequence({"optique": "reelle", "elements": [E("spectrale", "S", 0, gaz="hg", filtre=True), E("trouSource", "T", 30, d=0.001),
                                                      E("lentille", "l1", 430, f=200, D=40), E("iris", "I", 445, D=2), E("ecran", "E", 830)]})
    o = seq["objet"]
    zi = images(seq, 546.1, o)["finale"]["z"]
    seq = sequence({"optique": "reelle", "elements": [E("spectrale", "S", 0, gaz="hg", filtre=True), E("trouSource", "T", 30, d=0.001),
                                                      E("lentille", "l1", 430, f=200, D=40), E("iris", "I", 445, D=2), E("ecran", "E", zi)]})
    o = seq["objet"]
    ok(seq["stop"] and seq["prims"][seq["stop"]["i"]]["el"] == "I", "diaphragme d'ouverture trouvé : l'iris", str(seq["stop"]))
    a = Alea(12345)
    rr_ = []
    for k in range(20000):
        rt, pt = 0.999 * math.sqrt(a.u()), 2 * math.pi * a.u()
        v = [rt * math.cos(pt), rt * math.sin(pt), 445 - 30]
        dn = math.sqrt(sum(c * c for c in v))
        r = {"p": [0, 0, 30], "d": [c / dn for c in v], "l": 546.1, "w": 1, "f": [0, 0, 0], "J": None, "L": 0.0, "n": 1, "x": 0, "y": 0}
        s = suivre(seq, r, a, de=o + 1)
        if s["etat"] == "detecte":
            rr_.append(math.hypot(r["x"], r["y"]))
    # énergie encerclée mesurée ↔ théorie 1 − J0² − J1² en v = π D r / (λ L) (la table s'arrête à 97 % : anneaux
    # lointains redistribués) ; premier anneau noir r = 1,22 λ L / D
    Lr = zi - 445
    ecart_ee = 0.0
    for v in (0.8, 1.6, 2.4, 3.8317, 5.0, 7.0):
        r_v = v * 546.1e-6 * Lr / (math.pi * 2)
        j0, j1 = bessel_j(0, v), bessel_j(1, v)
        ecart_ee = max(ecart_ee, abs(sum(1 for x in rr_ if x < r_v) / len(rr_) - min(1.0, (1 - j0 * j0 - j1 * j1) / 0.97)))
    ok(ecart_ee < 0.015, "tache d'Airy : énergie encerclée de la tache = 1 − J0² − J1² (premier anneau noir à 1,22 λ L / D = %.4f mm)"
       % (1.22 * 546.1e-6 * Lr / 2), "écart max %.4f (%d rayons)" % (ecart_ee, len(rr_)))

    # 5 bis. tirage depuis l'objet éclairé : même flux sur l'écran que le tirage direct depuis la source (sans biais),
    #        lampe spectrale nue et lanterne (à rebours dans le condenseur asphérique)
    for nom_, src_, zt, zl, ze in (("lampe spectrale", E("spectrale", "S", 0, gaz="na"), 30, 130, 260),
                                   ("lanterne", E("lanterne", "L", 0, tirage=70), 420, 560, 760)):
        flux = []
        for tir, N in (("source", 60000), (None, 6000)):
            b_ = {"optique": "reelle", "elements": [src_, E("trouSource", "T", zt, d=1.0), E("lentille", "l1", zl, f=100, D=40),
                                                    E("iris", "I", zl + 5, D=20), E("ecran", "E", ze)]}
            if tir:
                b_["tirage"] = tir
            sq = sequence(b_)
            tot = tot2 = 0.0
            for k in range(N):
                r = tirer(sq, 11, 0, k, N)
                if suivre(sq, r, r["alea"])["etat"] == "detecte":
                    tot += r["w"] * r["f"][1]
                    tot2 += (r["w"] * r["f"][1]) ** 2
            moy = tot / N
            flux.append((moy, math.sqrt(max(tot2 / N - moy * moy, 0) / N), sq["mode"]))
        (fa, ea, ma), (fb, eb, mb) = flux
        ok(ma == 0 and mb == 1 and abs(fa - fb) < 3 * math.hypot(ea, eb), "tirage depuis l'objet éclairé sans biais (%s)" % nom_,
           "flux %.4g ± %.2g (direct, 60 000 rayons) / %.4g ± %.2g (depuis l'objet, 6 000)" % (fa, ea, fb, eb))

    # 5 ter. visée guidée (lot 4a de) : guide appris sur une passe pilote, même flux détecté que sans
    #        guide (sans biais), variance par rayon réduite ; dépoli, tirage depuis l'objet, œil ; laser : rien à gagner,
    #        aucun site guidé (le bruit de la passe pilote ne passe pas dans les poids)
    bancs_ = dict(cas_controle())
    for nom_, Np, N, gain_min in (("lanterne et son dépoli, F, lentille, écran", 6000, 6000, 1.2),
                                  ("trou source éclairé par la lanterne (à rebours dans le condenseur)", 4000, 4000, 3),
                                  ("laser, dépoli, lentille", 4000, 4000, 0), ("œil myope, lentille de −500 mm (lot 6e)", 30000, 12000, 2)):
        sq = sequence(bancs_[nom_])
        G_ = guide_cpu(sq, {"W": 1e9, "Nr": Np, "graine": 5, "passe": 0})
        flux = []
        for g_ in (None, G_):
            sq["guide"] = g_
            n_ = 4 * N if g_ is None else N
            tot = tot2 = 0.0
            nd_ = 0
            for k in range(n_):
                r = tirer(sq, 11, 0, k, n_)
                if suivre(sq, r, r["alea"])["etat"] == "detecte":
                    y_ = r["w"] * r["f"][1]
                    tot, tot2, nd_ = tot + y_, tot2 + y_ * y_, nd_ + 1
            moy = tot / n_
            var = max(tot2 / n_ - moy * moy, 0)
            flux.append((moy, math.sqrt(var / n_), nd_ / n_, var / (moy * moy)))
        (fa, ea, ra, va), (fb, eb, rb, vb) = flux
        sites_ = [s_ for s_, t_ in enumerate(G_["t"]) if t_]
        gain_ = va / vb
        attendu = (len(sites_) > 0 and gain_ > gain_min) if gain_min else not sites_
        ok(abs(fa - fb) < 3 * math.hypot(ea, eb) and attendu, "visée guidée sans biais (%s)" % nom_,
           "flux %.4g ± %.2g (sans guide, %d rayons) / %.4g ± %.2g (guidé, %d) ; variance par rayon ÷ %.2f ; rendement %.2f %% → %.2f %% ; "
           "sites guidés %s (cases %s)" % (fa, ea, 4 * N, fb, eb, N, gain_, 100 * ra, 100 * rb, sites_, [G_["t"][s_]["n"] for s_ in sites_]))
        sq["guide"] = None

    # 5 quater. cible élargie (lot 4c de) : lampe nue, trou de 0,1 mm sur sa plaque de 50 mm, écran ;
    #           la bande de l'écran hors de l'ombre de la plaque (|x| ou |y| > 95 mm) reçoit la même lumière que sans
    #           le trou, la tache du trou est inchangée, et doubler Rl ne change rien (Rl couvre tout ce qui arrive)
    def _flux_bande(sq, N, fac=1.0):
        Rl = sq["cible"][4]
        sq["cible"][4] = Rl * fac
        b1 = b2 = c1 = 0.0
        for k in range(N):
            r = tirer(sq, 13, 0, k, N)
            if suivre(sq, r, r["alea"])["etat"] != "detecte":
                continue
            y_ = r["w"] * r["f"][1]
            if max(abs(r["x"]), abs(r["y"])) > 95:
                b1, b2 = b1 + y_, b2 + y_ * y_
            elif math.hypot(r["x"], r["y"]) < 20:
                c1 += y_
        sq["cible"][4] = Rl
        m_ = b1 / N
        return m_, math.sqrt(max(b2 / N - m_ * m_, 0) / N), c1 / N
    lampe_ = [E("spectrale", "S", 0, gaz="na"), E("ecran", "E", 300)]
    sq_t = sequence({"optique": "parfaite", "elements": lampe_[:1] + [E("trou", "Tr", 100, d=0.1)] + lampe_[1:]})
    sq_l = sequence({"optique": "parfaite", "elements": lampe_})
    (bt, et_, ct), (bt2, et2, _), (bl, el_, _) = _flux_bande(sq_t, 30000), _flux_bande(sq_t, 30000, 2.0), _flux_bande(sq_l, 30000)
    ca = mich.luminance_source("na") * math.pi * 0.05 ** 2 * math.pi * 7.5 ** 2 / (7.5 ** 2 + 100 ** 2)
    ok(sq_t["cible"][4] > 35 and sq_l["cible"][4] == 0 and abs(bt - bl) < 3 * math.hypot(et_, el_) and abs(bt2 - bt) < 3 * math.hypot(et_, et2)
       and abs(ct / ca - 1) < 0.01, "cible élargie : la lampe nue éclaire l'écran autour de la plaque du trou comme sans elle",
       "Rl %.1f mm ; bande %.4g ± %.2g (trou) / %.4g ± %.2g (Rl × 2) / %.4g ± %.2g (sans trou) ; tache %.5g pour %.5g"
       % (sq_t["cible"][4], bt, et_, bt2, et2, bl, el_, ct, ca))

    # 6. Bessel et Silbermann (positions de netteté trouvées sur l'écran par les conjugaisons)
    def nettete(f, D, opt, forme_="bicv"):
        def ecart(zl):
            sq = sequence({"optique": opt, "elements": [E("lanterne", "L", 0), E("lettreF", "F", 100), E("lentille", "l", zl, f=f, D=40, forme=forme_),
                                                        E("ecran", "E", 100 + D)]})
            return images(sq, 587.6, sq["objet"])["finale"]["z"] - (100 + D)
        zs = np.linspace(100 + 5, 100 + D - 5, 400)
        ev = [ecart(z) for z in zs]
        out = []
        for i in range(len(zs) - 1):
            if ev[i] * ev[i + 1] < 0 and abs(ev[i]) < D:
                a_, b_ = zs[i], zs[i + 1]
                for _ in range(60):
                    m = (a_ + b_) / 2
                    if ecart(a_) * ecart(m) <= 0:
                        b_ = m
                    else:
                        a_ = m
                out.append((a_ + b_) / 2)
        return out
    pos = nettete(200, 1000, "parfaite")
    d = pos[1] - pos[0] if len(pos) == 2 else float("nan")
    ok(len(pos) == 2 and abs((1000 ** 2 - d * d) / 4000 - 200) < 1e-6, "Bessel (idéale) : f' = (D² − d²)/4D", "d = %.4f mm" % d)
    pos = nettete(200, 1000, "reelle")
    d = pos[1] - pos[0] if len(pos) == 2 else float("nan")
    fb = (1000 ** 2 - d * d) / 4000
    ok(len(pos) == 2 and abs(fb / 200 - 1) < 0.01, "Bessel (biconvexe réelle, 587,6 nm) à 1 % de la focale", "f' Bessel = %.3f mm" % fb)
    sq = sequence({"optique": "parfaite", "elements": [E("lanterne", "L", 0), E("lettreF", "F", 100), E("lentille", "l", 500, f=200, D=40),
                                                       E("ecran", "E", 900)]})
    im = images(sq, 587.6, sq["objet"])["finale"]
    ok(abs(im["z"] - 900) < 1e-9 and abs(im["gamma"] + 1) < 1e-12 and not nettete(200, 790, "parfaite"),
       "Silbermann : D = 4f', γ = −1 ; pas d'image sur l'écran pour D < 4f'")

    # 7. autocollimation : retour dans le plan de l'objet, renversé ; miroir incliné de α : décalage f' tan 2α
    for incl in (0.0, 0.01):
        sq = sequence({"optique": "parfaite", "elements": [E("lanterne", "L", 0), E("lettreF", "F", 100), E("lentille", "l1", 300, f=200, D=40),
                                                           E("miroir", "M", 380, incl=[0.0, incl])]})
        pin = pinceau(sq, {"x": 2.0, "y": 4.0, "z": 100}, n=7, axe=1, de=sq["objet"] + 1)
        det = [x for x in pin if x["etat"] == "detecte"]
        # attendu : faisceau parallèle de pente (−x0/f, −y0/f), réfléchi exactement par le miroir de normale (sin α, 0, cos α),
        # refocalisé à f × pente (lentille idéale) ; miroir droit : (−x0, −y0)
        dd = [-2.0 / 200, -4.0 / 200, 1.0]
        nm = [math.sin(incl), 0.0, math.cos(incl)]
        pr_ = sum(a_ * b_ for a_, b_ in zip(dd, nm))
        dr = [a_ - 2 * pr_ * b_ for a_, b_ in zip(dd, nm)]
        ax_, ay_ = 200 * dr[0] / abs(dr[2]), 200 * dr[1] / abs(dr[2])
        e = max(abs(x["x"] - ax_) + abs(x["y"] - ay_) for x in det) if det else float("nan")
        ok(len(det) >= 5 and e < 1e-9, "autocollimation : image renversée dans le plan de l'objet" + (", miroir incliné de α : décalée de ≈ f' tan 2α" if incl else ""),
           "attendu (%.4f, %.4f), écart %.1e mm (%d rayons sur 7 revenus sur la plaque, le reste vignetté par la lentille)" % (ax_, ay_, e, len(det)))

    # 8. viseur : le plan visé (z − 100) est conjugué du réticule avec γ = −1
    sq = sequence({"optique": "parfaite", "elements": [E("lanterne", "L", 0), E("regle", "R", 400), E("viseur", "V", 500)]})
    im = images(sq, 587.6, sq["objet"])
    ret = [x for x in im["reelles"] if abs(x["z"] - 600) < 1e-6]
    ok(len(ret) == 1 and abs(ret[0]["gamma"] + 1) < 1e-12, "viseur : image de la règle sur le réticule (γ = −1)", str([(round(x["z"], 6), round(x["gamma"], 6)) for x in im["reelles"]]))

    # 9. œil : accommodation (normal, 4 δ) → objet à 250 mm net sur la rétine
    sq = sequence({"optique": "parfaite", "elements": [E("lanterne", "L", 0), E("lettreF", "F", 200), E("oeil", "O", 450, acc=4)]})
    im = images(sq, 550, sq["objet"])["finale"]
    ok(abs(im["z"] - 467) < 1e-9, "œil normal accommodé de 4 δ : objet à 250 mm net sur la rétine", "image à z = %.9g (rétine 467)" % im["z"])

    # 10. Jones : Malus en cos², quart d'onde à 45° : intensité indépendante de l'analyseur (à λ0 seulement)
    def nat(Ms, l):        # intensité transmise en lumière naturelle : ½ tr(M M†)
        A = np.eye(2, dtype=complex)
        for el in Ms:
            m = jones(el, l)
            A = np.array([[complex(*m[0]), complex(*m[1])], [complex(*m[2]), complex(*m[3])]]) @ A
        return 0.5 * float(np.trace(A @ A.conj().T).real)
    th = 0.6
    ok(abs(nat([E("polariseur", "P", 0), E("polariseur", "A", 0, rot=th)], 550) - 0.5 * math.cos(th) ** 2) < 1e-12, "Malus : I = I₀ cos² θ / 2")
    vals = [nat([E("polariseur", "P", 0), E("lame", "Q", 0, rot=math.pi / 4), E("polariseur", "A", 0, rot=a_)], 546.07) for a_ in (0, 0.5, 1.2, 2)]
    vals2 = [nat([E("polariseur", "P", 0), E("lame", "Q", 0, rot=math.pi / 4), E("polariseur", "A", 0, rot=a_)], 650.0) for a_ in (0, 1.57)]
    ok(max(vals) - min(vals) < 1e-12 and abs(vals[0] - 0.25) < 1e-12 and abs(vals2[0] - vals2[1]) > 0.02,
       "quart d'onde à 45° : circulaire à 546 nm (Malus plat), elliptique à 650 nm", "%.4f / %.4f à 650 nm" % tuple(vals2))
    sq = sequence({"optique": "parfaite", "elements": [E("laser", "La", 0), E("polariseur", "P", 50), E("polariseur", "A", 100, rot=th), E("ecran", "E", 300)]})
    tot = n = 0
    for k in range(20000):
        r = tirer(sq, 9, 0, k, 20000)
        if suivre(sq, r, r["alea"])["etat"] == "detecte":
            tot += r["w"]
        n += 1
    Ls = sq["source"]["em"]["L"]
    ok(abs(tot / n / Ls / (0.5 * math.cos(th) ** 2) - 1) < 0.02, "Malus par les rayons (Jones tiré, 20 000 rayons)", "%.4f pour %.4f" % (tot / n / Ls, 0.5 * math.cos(th) ** 2))

    # 11. réseau tourné de 90° : dispersion verticale, sin θ₁ = λ/a
    sq = sequence({"optique": "parfaite", "elements": [E("laser", "La", 0), E("reseau", "R", 100, rot=math.pi / 2, n=600), E("ecran", "E", 300)]})
    found = False
    for k in range(200):
        r = {"p": [0, 0, 50], "d": [0, 0, 1], "l": 546.07, "w": 1, "f": [0, 0, 0], "J": None, "L": 0.0, "n": 1, "x": 0, "y": 0}
        al = Alea(graine_rayon(4, 0, k))
        if suivre(sq, r, al)["etat"] == "detecte" and r["y"] > 1:
            sy = r["d"][1]
            found = abs(abs(sy) - 546.07e-6 * 600) < 1e-12 and abs(r["d"][0]) < 1e-12 or found
    ok(found, "réseau tourné de 90° : ordre 1 vertical, sin θ = λ/a")

    # 12. condenseur asphérique : point au foyer objet → faisceau parallèle exact
    sq = sequence({"optique": "reelle", "elements": [E("laser", "La", 0), E("condenseur", "C", 100), E("ecran", "E", 300)]})
    P = [pr for pr in sq["prims"] if pr["k"] == K.SURF]
    l = 587.6
    Mc = abcd_lentille(lentille(60, 50, "asph"), l)
    a_ = -Mc[3] / Mc[2]
    zF = P[0]["zp"] - a_
    e, hmax = 0.0, 0.0
    for h in (1, 8, 15, 20, 21.3):
        v = [0, h, P[0]["zp"] - zF]
        dn = math.hypot(v[1], v[2])
        r = {"p": [0, 0, zF], "d": [0, v[1] / dn, v[2] / dn], "l": l, "w": 1, "f": [0, 0, 0], "J": None, "L": 0.0, "n": 1, "x": 0, "y": 0}
        if etape(P[0], r, Alea(1), sq) == 0 and etape(P[1], r, Alea(1), sq) == 0:
            e, hmax = max(e, abs(r["d"][1])), max(hmax, abs(r["p"][1]))
    ok(e < 1e-9 and hmax > 24, "condenseur asphérique (k = −n²) : point au foyer → rayons parallèles", "pente max %.1e jusqu'à %.1f mm de l'axe" % (e, hmax))

    # 13. faisceau gaussien : w(z) = w0 √(1 + (z/zR)²) ; rayons tirés : rms = w/2 par axe
    sq = sequence({"optique": "parfaite", "elements": [E("laser", "La", 0), E("ecran", "E", 1000)]})
    zr = math.pi * 0.16 / 632.8e-6
    g = gaussien(sq, 632.8, 0.4, [1000])[0]["w"]
    xs = []
    for k in range(20000):
        r = tirer(sq, 2, 0, k, 20000)
        if suivre(sq, r, r["alea"])["etat"] == "detecte":
            xs.append(r["x"])
    rms = math.sqrt(sum(x * x for x in xs) / len(xs))
    ok(abs(g - 0.4 * math.sqrt(1 + (1000 / zr) ** 2)) < 1e-12 and abs(rms / (g / 2) - 1) < 0.02, "laser : w(1 m) et rayons tirés (rms = w/2)",
       "w = %.4f mm, rms %.4f mm" % (g, rms))
    return res, None


# ================= vérifications physiques du moteur ondulatoire (SPEC § 8) =================
def _coupe(seq, res, W, o=None, **kw):
    """Plan, image (res, res, 3) et abscisses des pixels."""
    pl = onde_plan(seq, o)
    assert pl["ok"], pl
    return pl, onde_passe(pl, dict(res=res, W=W, **kw)).reshape(res, res, 3), kw.get("cx", 0) - W + (np.arange(res) + 0.5) * 2 * W / res


def _extremum(xs, y, x0, dx, signe=1):
    """Maximum (signe = 1) ou minimum (−1) de y près de x0, affiné par une parabole."""
    sel = np.where(abs(xs - x0) < dx)[0]
    i = sel[np.argmax(signe * y[sel])]
    a, b, c = y[i - 1], y[i], y[i + 1]
    return xs[i] + 0.5 * (a - c) / (a - 2 * b + c) * (xs[1] - xs[0])


def verifications_onde(sortie=print):
    res = []

    def ok(cond, titre, detail=""):
        res.append((bool(cond), titre, detail))
        sortie(("  ok    " if cond else "  ÉCHEC ") + titre + (" — " + detail if detail else ""))

    def young(b=0.05, zl=300, gaz="na", src=None, extra=(), opt="parfaite", **kw):
        return sequence({"optique": opt, "elements": [src or E("spectrale", "S", 0, gaz=gaz, filtre=True), E("fenteSource", "Fs", 30, b=b),
                                                    E("lentille", "l1", 230, f=200, D=40), E("bifentes", "B", 250, caches=[True, False, True], **kw),
                                                    E("lentille", "l2", zl, f=200, D=40), E("ecran", "E", zl + 200)] + list(extra)})

    # 1. Collins le long d'un axe contre l'intégrale calculée directement (fente, quatre régimes)
    def fresnel(e, lm, N, d, Mt, c=0.0):
        k = np.arange(N) - N // 2
        u2, d2, _ = _prop_axe(_c1(0, e, k * d, d).reshape(1, -1).astype(complex), 1, lm, d, c, Mt)
        xs = (np.arange(4000) + 0.5) / 4000 * e - e / 2
        A, B = Mt[0], Mt[1]
        x2 = k * d2
        sel = abs(x2) < (0.25 * N * d2 if N * d * d * abs(A + B * c) <= lm * abs(B) else 3 * e)
        ref = np.array([abs(np.sum(np.exp(1j * math.pi / (lm * B) * ((A + B * c) * xs ** 2 - 2 * xs * x))) * e / 4000) ** 2 / (lm * abs(B)) for x in x2[sel]])
        return np.max(abs(abs(u2[0][sel]) ** 2 - ref)) / ref.max()

    ecarts = [fresnel(0.5, 550e-6, 4096, 0.5 / 256, [1, 20, 0, 1]), fresnel(0.5, 550e-6, 4096, 0.5 / 64, [1, 2000, 0, 1]),
              fresnel(0.5, 550e-6, 2048, 0.5 / 64, [1, 300, 0, 1]), fresnel(0.5, 550e-6, 2048, 0.5 / 64, mul([1, 150, 0, 1], mul([1, 0, -1 / 200, 1], [1, 80, 0, 1])), 1 / 300)]
    ok(max(ecarts) < 3e-3, "Collins (près, loin, entre les deux, lentille et onde sphérique) contre l'intégrale de Fresnel directe",
       "écarts relatifs " + ", ".join("%.1e" % e for e in ecarts))

    # 2. fentes d'Young (sodium, bifentes a = 0,25 mm, f' = 200 mm) : interfrange λf'/a, contraste |sinc(π a b / λ f')|
    lam, f, a, e = 589.29e-6, 200.0, 0.25, 0.06
    i0 = lam * f / a
    pl, im, xs = _coupe(young(0.02, gaz="na"), 512, 1.2)
    y = im[256, :, 1]
    mesure = _extremum(xs, y, 0.5 * i0, 0.15, -1) - _extremum(xs, y, -0.5 * i0, 0.15, -1)
    ok(abs(mesure / i0 - 1) < 3e-3 and pl["src"]["i"] == 0 and len(pl["planes"]) == 1, "Young : interfrange λf'/a", "%.4f mm pour %.4f" % (mesure, i0))
    env = np.sinc(e * 0.5 * i0 / (lam * f)) ** 2
    det = []
    for b in (0.02, 0.2, 0.3, lam * f / a, 0.6):
        _, im, xs = _coupe(young(b, gaz="na"), 256, 0.6, ns=32)
        y = im[128, :, 1]
        c0, cm = np.interp(0, xs, y), 0.5 * (np.interp(0.5 * i0, xs, y) + np.interp(-0.5 * i0, xs, y)) / env
        x = math.pi * a * b / (lam * f)
        det.append(((c0 - cm) / (c0 + cm), math.sin(x) / x))
    ok(all(abs(c - t) < 0.015 for c, t in det) and abs(det[3][0]) < 0.015 and det[4][0] < -0.1, "Young : contraste = sinc(π a b / λ f'), brouillage à b = λf'/a, puis inversion",
       ", ".join("%.3f/%.3f" % d for d in det))

    # 3. flux : ce qui passe par les fentes arrive sur l'écran (éclairement × aire = L·A_source·A_fentes/f'²)
    _, im, xs = _coupe(young(0.2, gaz="na"), 256, 8.0)
    flux, att = im[:, :, 1].sum() * (16 / 256) ** 2, mich.luminance_source("na") * 0.2 * 10 / 200 ** 2 * 2 * 0.06 * 5
    ok(abs(flux / att - 0.965) < 0.03, "Young : flux reçu par l'écran (± 8 mm : 96 % de L·A_s·A_fentes/f'²)", "%.3e pour %.3e" % (flux, att))

    # 4. franges à l'infini : indépendantes de la position de la lentille de projection
    _, im2, _ = _coupe(young(0.2, gaz="na", zl=380), 256, 8.0)
    ok(np.max(abs(im2 - im)) < 1e-9 * im.max(), "Young : franges à l'infini indépendantes de la position de la lentille")

    # 5. fente simple : zéros à λf'/e, lobes latéraux 4,72 % et 1,65 %
    seq = sequence({"optique": "parfaite", "elements": [E("spectrale", "S", 0, gaz="hg", filtre=True), E("trouSource", "T", 30, d=0.02), E("lentille", "l1", 230, f=200, D=40),
                                                    E("fente", "F", 250, e=0.1), E("lentille", "l2", 300, f=200, D=40), E("ecran", "E", 500)]})
    pl, im, xs = _coupe(seq, 512, 4.0)
    lh = pl["lambdas"][0][0] * 1e-6
    y, x0 = im[256, :, 1], lh * 200 / 0.1
    z1, lobes = _extremum(xs, y, x0, 0.3, -1), [np.interp(k * x0, xs, y) / y.max() for k in (1.4303, 2.459)]
    ok(abs(z1 / x0 - 1) < 5e-3 and abs(lobes[0] / 0.04719 - 1) < 0.03 and abs(lobes[1] / 0.01648 - 1) < 0.05, "fente simple : premier zéro à λf'/e, lobes latéraux",
       "zéro %.4f mm pour %.4f ; lobes %.4f et %.4f" % (z1, x0, lobes[0], lobes[1]))

    # 6. trou : premier anneau noir à 1,22 λf'/D
    seq = sequence({"optique": "parfaite", "elements": [E("spectrale", "S", 0, gaz="hg", filtre=True), E("trouSource", "T", 30, d=0.004), E("lentille", "l1", 230, f=200, D=40),
                                                    E("trou", "Tr", 250, d=0.2), E("lentille", "l2", 300, f=200, D=40), E("ecran", "E", 500)]})
    pl = onde_plan(seq)
    I, d = onde_champ(pl, lh * 1e6)
    r1 = _extremum((np.arange(I.shape[1]) - I.shape[1] // 2) * d[0], I[I.shape[0] // 2], 1.2197 * lh * 200 / 0.2, 0.15, -1)
    ok(abs(r1 / (1.2197 * lh * 200 / 0.2) - 1) < 0.005, "trou : premier anneau noir à 1,22 λf'/D", "%.4f mm pour %.4f" % (r1, 1.2197 * lh * 200 / 0.2))

    # 7. même flux que le moteur géométrique (lampe, trou de 0,1 mm, écran : chambre noire), en lux × mm² = 1e-6 lm :
    # les deux moteurs sont dans les mêmes unités (, lot R1). Flux attendu L · π r² · π sin²α
    # (disque lambertien de demi-angle α vu du trou). Ondes : écart de discrétisation (strates de la source, masque
    # lissé) de 2,3 % aux réglages par défaut, 0,3 % avec fin = 32 et ns = 32. Rayons : fenêtre de ±20 mm (tache du trou ;
    # l'ombre de la plaque s'étend jusqu'à 60 mm) : au-delà, la lampe nue éclaire l'écran autour de la plaque (cible
    # élargie, lot 4c de), lumière que le moteur ondulatoire ne connaît pas.
    seq = sequence({"optique": "parfaite", "elements": [E("spectrale", "S", 0, gaz="na"), E("trou", "Tr", 100, d=0.1), E("ecran", "E", 300)]})
    pl, im, xs = _coupe(seq, 128, 20.0, {"fin": 32}, ns=32)
    fo = im[:, :, 1].sum() * (40 / 128) ** 2
    geo = passe_cpu(seq, {"res": 8, "W": 20, "Nr": 40000, "graine": 5, "passe": 0})
    fg = sum(geo[0][1::3]) / 40000
    fa = mich.luminance_source("na") * math.pi * 0.05 ** 2 * math.pi * 7.5 ** 2 / (7.5 ** 2 + 100 ** 2)
    ok(abs(fo / fg - 1) < 0.01 and abs(fg / fa - 1) < 0.005 and pl["src"]["i"] == -1, "chambre noire : même flux (lux × mm²) pour les deux moteurs, L π r² π sin²α",
       "%.4e (ondes), %.4e (rayons), %.4e attendu" % (fo, fg, fa))

    # 8. laser : faisceau gaussien libre (puissance, rayon), fente (minima à λD/e), réseau (ordres à D tan θ, sin θ = mλ/a)
    seq = sequence({"optique": "parfaite", "elements": [E("laser", "La", 0), E("ecran", "E", 1000)]})
    pl, im, xs = _coupe(seq, 128, 2.0)
    fy, w = seq["source"]["em"]["L"] * facteur_xyz(seq["source"]["sp"], 632.8)[1], gaussien(seq, 632.8, 0.4, [1000])[0]["w"]
    geo = passe_cpu(seq, {"res": 8, "W": 100, "Nr": 2000, "graine": 5, "passe": 0})
    ok(abs(im[:, :, 1].sum() * (4 / 128) ** 2 / fy - 1) < 1e-3 and abs(np.interp(w, xs, im[64, :, 1]) / np.interp(0, xs, im[64, :, 1]) / math.exp(-2) - 1) < 0.01
       and abs(sum(geo[0][1::3]) / 2000 / fy - 1) < 1e-9 and abs(fy / (1e6 * mich.flux_laser()) - 1) < 1e-9,
       "laser : puissance (1 mW, en 1e-6 lm, les deux moteurs) et rayon du faisceau à 1 m", "w = %.4f mm" % w)
    seq = sequence({"optique": "parfaite", "elements": [E("laser", "La", 0), E("fente", "F", 300, e=0.1), E("ecran", "E", 1300)]})
    pl, im, xs = _coupe(seq, 512, 20.0)
    m1 = _extremum(xs, im[256, :, 1], 6.328, 1.5, -1)
    ok(abs(m1 / 6.328 - 1) < 5e-3 and len(pl["planes"]) == 1, "laser et fente de 0,1 mm : premier minimum à λD/e", "%.3f mm pour 6,328" % m1)
    seq = sequence({"optique": "parfaite", "elements": [E("laser", "La", 0), E("reseau", "R", 100, n=300), E("ecran", "E", 600)]})
    x1 = 500 * math.tan(math.asin(632.8e-6 * 300))
    pl, im, xs = _coupe(seq, 128, 2.0, cx=x1)
    ok(abs(_extremum(xs, im[64, :, 1], x1, 1.0) - x1) < 0.01 and abs(im[:, :, 1].sum() * (4 / 128) ** 2 / fy / ETA_RESEAU[1] - 1) < 1e-3 and not pl["planes"],
       "laser et réseau 300 traits/mm : ordre 1 à D tan θ, sin θ = λ/a", "%.2f mm" % x1)

    # 9. lumière blanche : frange centrale de la teinte de la lampe, bords irisés
    seq = young(0.05, src=E("lanterne", "L", -390, tirage=70))
    pl, im, xs = _coupe(seq, 256, 1.0)
    blanc = np.sum([np.array(l[1]) / l[0] for l in pl["lambdas"]], axis=0)       # au centre, éclairement en 1/λ
    c0, cb = im[128, 128] / im[128, 128].sum(), im[128, np.argmin(abs(xs - 0.5 * 550e-6 * 200 / 0.25))]
    cb = cb / cb.sum()
    ok(np.max(abs(c0 - blanc / blanc.sum())) < 5e-3 and np.max(abs(cb - c0)) > 0.05 and len(pl["lambdas"]) == 16 and pl["src"]["i"] > 0,
       "lumière blanche : frange centrale blanche, première frange sombre colorée", "xyz au centre %s, à i/2 %s" % (np.round(c0, 3), np.round(cb, 3)))

    # 10. Malus à travers les fentes : polariseur et analyseur croisés de θ
    fl = []
    for th in (None, 0.0, 0.7, math.pi / 2):
        extra = [] if th is None else [E("polariseur", "P", 60), E("polariseur", "A", 100, rot=th)]
        fl.append(_coupe(young(0.2, gaz="na", extra=extra), 64, 2.0)[1][:, :, 1].sum())
    ok(abs(fl[1] / fl[0] - 0.5) < 1e-9 and abs(fl[2] / fl[1] - math.cos(0.7) ** 2) < 1e-9 and fl[3] / fl[0] < 1e-12, "Malus : ½ puis cos² θ")

    # 11. filtrage (somme brute sur le trou source) : Abbe-Porter, strioscopie
    def filtrage(objet, filtre):
        return sequence({"optique": "parfaite", "elements": [E("spectrale", "S", 0, gaz="hg", filtre=True), E("trouSource", "T", 30, d=0.1), E("lentille", "l0", 230, f=200, D=40),
                                                           E("iris", "I", 240, D=3), objet, E("lentille", "l1", 450, f=200, D=40)] + filtre
                         + [E("lentille", "l2", 850, f=200, D=40), E("ecran", "E", 1050)]})

    def modulation(im, xs):
        c = abs(xs) < 0.6
        lx, ly = im[np.argmin(abs(xs - 0.125)), c, 1], im[c, np.argmin(abs(xs - 0.125)), 1]
        return (lx.max() - lx.min()) / (lx.max() + lx.min()), (ly.max() - ly.min()) / (ly.max() + ly.min())

    o = {"maxCellules": 1 << 16}
    pl, im, xs = _coupe(filtrage(E("grilleCroisee", "G", 250), []), 96, 1.2, o)
    m0 = modulation(im, xs)
    pl, im, xs = _coupe(filtrage(E("grilleCroisee", "G", 250), [E("fente", "F", 650, e=0.2)]), 96, 1.2, o)
    m1 = modulation(im, xs)
    ok(m0[0] > 0.8 and m0[1] > 0.8 and m1[0] < 0.1 and m1[1] > 0.8 and len(pl["planes"]) == 2 and pl["src"]["i"] == 0,
       "Abbe-Porter : une fente verticale au plan de Fourier ne laisse que les traits horizontaux",
       "modulation le long de x, de y : %.2f, %.2f sans filtre ; %.2f, %.2f avec (%d points sources)" % (m0 + m1 + (len(_points(pl, pl["lref"])),)))
    asym = []
    for rot in (0.0, math.pi):
        pl, im, xs = _coupe(filtrage(E("objetPhase", "Ph", 250, phi=1), [E("couteau", "K", 650, rot=rot, xc=0)]), 96, 1.5, o)
        g, d = im[:, (xs < -0.15) & (xs > -1.2), 1].sum(), im[:, (xs > 0.15) & (xs < 1.2), 1].sum()
        asym.append((d - g) / (d + g))
    ok(asym[0] * asym[1] < 0 and min(abs(asym[0]), abs(asym[1])) > 0.1 and abs(asym[0] + asym[1]) < 0.02,
       "strioscopie : la goutte de phase est claire d'un côté, sombre de l'autre ; retourner le couteau échange les côtés", "asymétrie %.2f puis %.2f" % tuple(asym))

    # 12. choix du moteur (§ 4.3)
    def moteur(*els, opt="parfaite"):
        m = onde_moteur(sequence({"optique": opt, "elements": list(els)}))
        return m["moteur"] if m["moteur"] == "onde" else m["raison"]

    choix = [moteur(E("lanterne", "L", 0), E("lettreF", "F", 80), E("lentille", "l", 480, f=100), E("ecran", "E", 620)),
             moteur(E("spectrale", "S", 0), E("fenteSource", "Fs", 30, b=0.1), E("lentille", "l", 230), E("iris", "I", 250, D=10), E("ecran", "E", 500)),
             moteur(E("spectrale", "S", 0), E("fenteSource", "Fs", 30, b=0.1), E("lentille", "l", 230), E("iris", "I", 250, D=1), E("ecran", "E", 500)),
             moteur(E("spectrale", "S", 0), E("fenteSource", "Fs", 30, b=0.1), E("lentille", "l", 230), E("bifentes", "B", 250), E("lunette", "Lu", 330), opt="reelle"),
             moteur(E("laser", "La", 0), E("lentille", "l", 300), E("ecran", "E", 500)),
             moteur(E("laser", "La", 0), E("depoli", "D", 100), E("ecran", "E", 500)),
             moteur(E("lanterne", "L", 0), E("depoli", "D", 100), E("fente", "F", 200), E("ecran", "E", 500)),
             moteur(E("spectrale", "S", 0), E("lettreF", "Fl", 50), E("fente", "F", 100), E("lentille", "l", 300), E("miroir", "M", 400)),
             moteur(E("spectrale", "S", 0), E("fenteSource", "Fs", 30), E("lentille", "l", 230), E("reseau", "R", 250), E("lentille", "l2", 300), E("ecran", "E", 500))]
    ok(choix == ["geometrique", "geometrique", "onde", "onde", "onde", "onde", "depoli", "miroir", "geometrique"], "choix du moteur", " ".join(choix))

    # 13. spectromètre (lot 6c)
    # a. Young en lumière blanche : fibre à x = 1,2 mm, δ = a x / f' = 1500 nm, cannelures noires à δ / (p + ½)
    seq = young(0.02, src=E("lanterne", "L", -390, tirage=70))
    pl = onde_plan(seq, {"maxCellules": 1 << 16})
    ls = np.arange(410.0, 680.5, 1.0)
    sp = np.array([onde_spectre(pl, {"x": 1.2, "y": 0, "r": 0.02, "l": l, "ns": 4}) for l in ls])
    mins = [_extremum(ls, sp, 1500 / (p + 0.5), 25, -1) for p in (2, 3)]
    ok(all(abs(m / (1500 / (p + 0.5)) - 1) < 0.01 for m, p in zip(mins, (2, 3))) and sp.min() < 0.05 * sp.max(),
       "spectre cannelé de Young : cannelures noires à λ = δ / (p + ½)", "%.1f et %.1f nm pour 600,0 et 428,6" % tuple(mins))
    # b. même spectre par les rayons et par les ondes (sodium, chambre noire, fibre au centre de la tache)
    seq = sequence({"optique": "parfaite", "elements": [E("spectrale", "S", 0, gaz="na"), E("trou", "Tr", 100, d=0.1), E("ecran", "E", 300)]})
    # (ondes : moyenne sur 8 passes, strates de la source décalées au hasard, comme dans l'instrument)
    Nr, rf = 80000, 6.0        # 80 000 : 23 % des rayons visent l’anneau de la cible élargie (lot 4c), hors de la tache
    geo = spectre_cpu(seq, {"Nr": Nr, "graine": 5, "passe": 0, "spe": {"x": 0, "y": 0, "r": rf, "la": 380, "lb": 780, "nb": 0}})
    pl, spn = onde_plan(seq), seq["source"]["sp"]
    ond = [np.mean([onde_spectre(pl, {"x": 0, "y": 0, "r": rf, "l": l, "ns": 8, "passe": p, "graine": 3}) for p in range(1, 9)]) * poids_spectre(seq, l, j)
           for j, l in enumerate(spn["l"])]
    rap = [g / (Nr * math.pi * rf * rf) / o for g, o in zip(geo, ond)]
    ok(all(abs(x - 1) < 0.04 for x in rap), "spectromètre : mêmes raies par les rayons et par les ondes (sodium, chambre noire)", ", ".join("%.3f" % x for x in rap))
    # c. lanterne et filtre interférentiel : pic à 546 nm, 10 nm à mi-hauteur
    seq = sequence({"optique": "parfaite", "elements": [E("lanterne", "L", 0), E("filtre", "Fi", 80, couleur="interferentiel"), E("ecran", "E", 300)]})
    cs = np.array(spectre_cpu(seq, {"Nr": 40000, "graine": 2, "passe": 0, "spe": {"x": 0, "y": 0, "r": 8, "la": 500, "lb": 600, "nb": 50}}))
    xs = 500 + (np.arange(50) + 0.5) * 2
    lisse = np.convolve(cs, np.ones(3) / 3, mode="same")
    pic = xs[np.argmax(lisse)]
    haut = xs[lisse > 0.5 * lisse.max()]
    ok(abs(pic - 546) <= 2 and 6 <= haut[-1] - haut[0] + 2 <= 14, "spectromètre : filtre interférentiel, pic à 546 nm et ~10 nm à mi-hauteur",
       "pic %.0f nm, %.0f nm à mi-hauteur" % (pic, haut[-1] - haut[0] + 2))
    return res, None


def main():
    if "--ecrire" in sys.argv:
        CONTROLES.write_text(json.dumps(generer_controles(), ensure_ascii=False, separators=(",", ":")))
        print("écrit :", CONTROLES)
        return
    res = verifications()[0] + verifications_onde()[0]
    n_ok = sum(1 for r in res if r[0])
    print("%d / %d vérifications physiques" % (n_ok, len(res)))
    sys.exit(0 if n_ok == len(res) else 1)


if __name__ == "__main__":
    main()
