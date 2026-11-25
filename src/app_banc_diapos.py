#!/usr/bin/env python3
# Créé par Claude
"""Diapos du banc d'optique (lot 6d) : génère _app-banc-diapos.js (jamais édité à la main).

Quatre images carrées de N × N pixels, TRANSMISSION EN INTENSITÉ codée sur un octet (0 opaque, 255 transparent),
ligne 0 en HAUT de la diapo (y > 0 du banc), colonne 0 à gauche (x < 0) ; côté de la diapo : TAILLE mm. Le cœur JS,
le shader et la référence Python lisent ce même fichier (texel le plus proche pour les rayons ; amplitude √T moyennée
par maille pour le moteur ondulatoire) : régénérer le fichier puis `python3 app_banc_reference.py --ecrire`.

  - siemens : mire de Siemens, 36 secteurs opaques (générée) ;
  - usaf    : mire USAF 1951, groupes 0 à 2 (générée ; fréquences 2^(g + (e−1)/6) traits par mm) ;
  - fourier : portrait de Joseph Fourier (gravure de J.-L. Boilly, domaine public, Wikimedia Commons « Fourier2.jpg »)
              sous une trame croisée de pas TRAME pixels ;
  - lune    : cratère Dédale, Apollo 11, AS11-41-6151 (NASA, domaine public, Wikimedia Commons), lignes de balayage
              horizontales au pas de TRAME pixels.

Les deux photos sont téléchargées une fois dans diapos-sources/ (hors git).

Usage : python3 app_banc_diapos.py
"""
import base64
import json
import math
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

ICI = Path(__file__).resolve().parent
SORTIE = ICI / "_app-banc-diapos.js"
SOURCES = ICI / "diapos-sources"
N, TAILLE, TRAME, SUR = 512, 20.0, 4, 4          # pixels, côté (mm), pas de la trame (pixels), suréchantillonnage
PHOTOS = {
    "fourier": ("https://upload.wikimedia.org/wikipedia/commons/a/aa/Fourier2.jpg", "fourier.jpg"),
    "lune": ("https://upload.wikimedia.org/wikipedia/commons/e/ed/Daedalus_crater_AS11-41-6151.jpg", "lune.jpg"),
}
NOMS = ["siemens", "usaf", "fourier", "lune"]


def coords():
    """Centres des sous-pixels (mm), x vers la droite, y vers le HAUT (ligne 0 en haut)."""
    k = (np.arange(N * SUR) + 0.5) / (N * SUR)
    x = (k - 0.5) * TAILLE
    X, Y = np.meshgrid(x, -x)
    return X, Y


def reduire(t):
    return t.reshape(N, SUR, N, SUR).mean(axis=(1, 3))


def siemens():
    X, Y = coords()
    r, th = np.hypot(X, Y), np.arctan2(Y, X)
    secteur = (np.floor(th / (2 * math.pi) * 72) % 2) == 0
    t = np.where((r < 9.0) & secteur, 0.0, 1.0)
    t = np.where((r >= 9.0) & (r < 9.25), 0.0, t)        # cercle de bord
    return reduire(t)


def usaf():
    """Groupes 0, 1, 2 en colonnes ; un élément = trois traits horizontaux et trois traits verticaux (longueur 5 w)."""
    X, Y = coords()
    t = np.ones_like(X)

    def rect(x0, y0, w, h):
        nonlocal t
        t = np.where((X >= x0) & (X < x0 + w) & (Y <= y0) & (Y > y0 - h), 0.0, t)

    x = -5.25                                  # bloc centré : 10,5 mm × 14,9 mm
    for g in (0, 1, 2):
        y = 7.45
        for e in range(1, 7):
            w = 0.5 / 2 ** (g + (e - 1) / 6)       # largeur d'un trait (mm)
            for b in range(3):                     # traits horizontaux : empilés
                rect(x, y - 2 * b * w, 5 * w, w)
            for b in range(3):                     # traits verticaux : côte à côte
                rect(x + 6 * w + 2 * b * w, y, w, 5 * w)
            y -= 6.5 * w
        x += 12 * 0.5 / 2 ** g
    return reduire(t)


def photo(nom):
    url, fic = PHOTOS[nom]
    p = SOURCES / fic
    if not p.exists():
        SOURCES.mkdir(exist_ok=True)
        req = urllib.request.Request(url, headers={"User-Agent": "banc-optique-diapos/1.0"})
        p.write_bytes(urllib.request.urlopen(req, timeout=120).read())
    im = Image.open(p).convert("L")
    w, h = im.size
    if nom == "fourier":                 # visage et buste, carré
        c = int(0.80 * w)
        box = ((w - c) // 2, int(0.08 * h), (w - c) // 2 + c, int(0.08 * h) + c)
    else:                                # le cratère, au centre
        c = int(0.62 * min(w, h))
        box = ((w - c) // 2, (h - c) // 2, (w - c) // 2 + c, (h - c) // 2 + c)
    a = np.asarray(im.crop(box).resize((N, N), Image.LANCZOS), dtype=float) / 255
    lo, hi = np.percentile(a, 1), np.percentile(a, 99.5)
    return np.clip((a - lo) / (hi - lo), 0, 1)


def fourier():
    a = 0.06 + 0.94 * photo("fourier")
    j = np.arange(N)
    trait = (j % TRAME) == 0
    trame = np.where(trait[:, None] | trait[None, :], 0.15, 1.0)
    return a * trame


def lune():
    a = 0.04 + 0.96 * photo("lune")
    j = np.arange(N)
    return a * np.where((j % TRAME) == 0, 0.2, 1.0)[:, None]


def main():
    gen = {"siemens": siemens, "usaf": usaf, "fourier": fourier, "lune": lune}
    data = []
    for nom in NOMS:
        t = np.clip(np.rint(gen[nom]() * 255), 0, 255).astype(np.uint8)
        data.append(base64.b64encode(t.tobytes()).decode("ascii"))
    out = {"n": N, "taille": TAILLE, "trame": TRAME, "noms": NOMS, "data": data,
           "credits": {"fourier": "Joseph Fourier, gravure de Julien-Léopold Boilly (domaine public, Wikimedia Commons)",
                       "lune": "Cratère Dédale, Apollo 11, AS11-41-6151 (NASA, domaine public)"}}
    # Un script (pas un JSON) : injecté à la demande par l'instrument, il se charge aussi en file:// (export hors ligne).
    # Les données sont sur la TROISIÈME ligne : app_banc_reference.py la lit telle quelle.
    SORTIE.write_text("// © 2026 Sébastien Reyt — licence GPLv3 — fichier généré, ne pas éditer (app_banc_diapos.py)\n"
                      "(function (r, d) { r.VITRINE_BANC_DIAPOS = d; if (typeof module !== \"undefined\" && module.exports) module.exports = d; })(typeof window !== \"undefined\" ? window : this,\n"
                      + json.dumps(out, separators=(",", ":")) + "\n);\n")
    print(f"{SORTIE.name} : {SORTIE.stat().st_size / 1e6:.2f} Mo")


if __name__ == "__main__":
    main()
