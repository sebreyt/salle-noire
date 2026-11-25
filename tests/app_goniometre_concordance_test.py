#!/usr/bin/env python3
# Créé par Claude
"""Concordance du moteur goniomètre (_app-goniometre-coeur.js).

1. app_goniometre_controles.json est à jour avec la référence Python (app_goniometre_reference.py --ecrire sinon).
2. Le cœur JS rejoue chaque cas (autocollimation, parallaxe, yeux, oculaire tiré, visée directe, réseau en incidence
   normale, collimateur déréglé, minimum de déviation, doublet diaphragmé, vignettage, réseau retourné) : `vue` champ
   par champ à 1e-9 (relatif), `deltaDeP`, et l'éclairement XYZ du champ en ~70 points par cas.
3. Le rendu raster (`rendreChamp`, par colonnes et lignes) redonne `xyzChamp` aux centres des pixels.
4. Les vérifications physiques de la référence (§ 1 de la SPEC, profils).

    python3 tests/app_goniometre_concordance_test.py
"""
import json
import subprocess
import sys
from pathlib import Path

ICI = Path(__file__).resolve().parent
SRC = (ICI / ".." / "src").resolve()
sys.path.insert(0, str(ICI))
import app_goniometre_reference as ref  # noqa: E402

JS = SRC / "_app-goniometre-coeur.js"
ok = 0
echecs = []


def verifier(cond, titre, detail=""):
    global ok
    if cond:
        ok += 1
    else:
        echecs.append(titre)
        print("  ÉCHEC " + titre + (" — " + detail if detail else ""))


def proche(a, b, rel=1e-9, abs_=1e-15):
    return abs(a - b) <= abs_ + rel * max(abs(a), abs(b))


def comparer(a, b, chemin, pire):
    """Comparaison récursive (nombres à 1e-9 relatif) ; renvoie la liste des écarts."""
    ec = []
    if isinstance(a, dict):
        if not isinstance(b, dict) or set(a) != set(b):
            return [chemin + " : clés %r / %r" % (sorted(a) if isinstance(a, dict) else a, sorted(b) if isinstance(b, dict) else b)]
        for k in a:
            ec += comparer(a[k], b[k], chemin + "." + k, pire)
    elif isinstance(a, list):
        if not isinstance(b, list) or len(a) != len(b):
            return [chemin + " : longueurs %r / %r" % (len(a), len(b) if isinstance(b, list) else b)]
        for i, (x, y) in enumerate(zip(a, b)):
            ec += comparer(x, y, "%s[%d]" % (chemin, i), pire)
    elif isinstance(a, bool) or a is None or isinstance(a, str):
        if a != b:
            ec.append("%s : %r / %r" % (chemin, a, b))
    else:
        if isinstance(b, bool) or not isinstance(b, (int, float)):
            return ["%s : %r / %r" % (chemin, a, b)]
        e = abs(a - b) / max(abs(a), abs(b), 1e-300) if a != b else 0.0
        pire[0] = max(pire[0], e if abs(a - b) > 1e-15 else 0.0)
        if not proche(a, b):
            ec.append("%s : %.17g / %.17g" % (chemin, a, b))
    return ec


REJOUER = r"""
const { Coeur } = require(process.argv[1]);
const C = JSON.parse(require("fs").readFileSync(0, "utf8"));
const out = C.cas.map((c) => {
  const V = Coeur.vue(c.cfg);
  const pr = Coeur.preparerChamp(c.cfg, V, c.px);
  const champ = c.champ.map(([X, Y]) => Coeur.xyzChamp(pr, X, Y));
  const dn = c.delta_net.map(([P]) => Coeur.deltaDeP(c.cfg, P));
  // raster : 64 × 64 pixels centrés, échelle du cas × 8 (le champ entier) ; comparé à xyzChamp aux centres
  const W = 64, H = 64, pr8 = Coeur.preparerChamp(c.cfg, V, c.px * 8);
  const img = Coeur.rendreChamp(pr8, W, H, { flottant: true });
  // écart rapporté au maximum de l'image (le champ est en lux : lot R1 du réalisme)
  let pireR = 0, maxE = 0;
  for (let j = 0; j < H; j += 3) for (let i = 0; i < W; i += 3) {
    const e = Coeur.xyzChamp(pr8, (i + 0.5 - W / 2) * pr8.px, (H / 2 - j - 0.5) * pr8.px), k = 3 * (j * W + i);
    for (let q = 0; q < 3; q++) { pireR = Math.max(pireR, Math.abs(e[q] - img[k + q])); maxE = Math.max(maxE, Math.abs(e[q])); }
  }
  pireR /= Math.max(maxE, 1e-300);
  return { vue: V, champ, dn, pireR };
});
process.stdout.write(JSON.stringify(out));
"""


def main():
    print("1. contrôles à jour")
    attendu = ref.generer_controles()
    lu = json.loads(ref.CONTROLES.read_text())
    verifier(lu == json.loads(json.dumps(attendu, ensure_ascii=False)), "app_goniometre_controles.json à jour",
             "relancer : python3 app_goniometre_reference.py --ecrire")

    print("2-3. le cœur JS rejoue les contrôles")
    r = subprocess.run(["node", "-e", REJOUER, str(JS)], input=json.dumps(lu), capture_output=True, text=True)
    if r.returncode:
        print(r.stderr)
        sys.exit(1)
    js = json.loads(r.stdout)
    pire_v, pire_c, pire_r, n_pts = [0.0], 0.0, 0.0, 0
    for c, j in zip(lu["cas"], js):
        ec = comparer(c["vue"], j["vue"], "vue", pire_v)
        verifier(not ec, "vue : " + c["nom"], " ; ".join(ec[:4]))
        verifier(all(proche(a[1], b, 1e-9, 1e-15) for a, b in zip(c["delta_net"], j["dn"])), "plan vu net : " + c["nom"])
        for (X, Y, *xp), xj in zip(c["champ"], j["champ"]):
            n_pts += 1
            echelle = max(max(abs(v) for v in xp), 1e-6)
            e = max(abs(a - b) for a, b in zip(xp, xj)) / echelle
            pire_c = max(pire_c, e)
            verifier(e < 1e-9, "champ : " + c["nom"], "X = %.3e, Y = %.3e : écart relatif %.2e" % (X, Y, e))
        pire_r = max(pire_r, j["pireR"])
        verifier(j["pireR"] < 1e-12, "rendu raster = xyzChamp : " + c["nom"], "%.2e" % j["pireR"])
    print("   vue : écart relatif max %.2e ; champ : %.2e sur %d points ; raster : %.2e" % (pire_v[0], pire_c, n_pts, pire_r))

    print("4. vérifications physiques")
    for bon, titre, detail in ref.verifications(sortie=lambda *_: None):
        verifier(bon, titre, detail)

    print("%d vérifications, %d échec(s)" % (ok + len(echecs), len(echecs)))
    sys.exit(1 if echecs else 0)


if __name__ == "__main__":
    main()
