#!/usr/bin/env python3
# Créé par Claude
"""Concordance du moteur Michelson (_app-michelson-coeur.js).

1. app_michelson_controles.json est à jour avec la référence Python (app_michelson_reference.py --ecrire sinon).
2. Le cœur JS rejoue chaque point de contrôle (lame d'air, coin d'air, mêlés, écran nu, œil à l'infini et sur les
   miroirs, collimateur, condenseur, laser, hors axe, lames inclinées, lamelle ; avec et sans flou de rendu) : δ aux
   points du détecteur à
   1e-10 m, coefficients du polynôme, éclairements des deux bras et disques des pupilles à 1e-9 (relatif).
3. Il rejoue l'éclairement XYZ de quelques pixels d'une passe complète (`preparer` + `evaluer`) à 1e-9 (relatif) :
   même hasard à graine, mêmes λ tirées, mêmes points sources ; lignes de la lamelle et de l'image fantôme, flou de
   mouvement (`pose`).
4. Les vérifications physiques de la référence (Fresnel vs géométrie exacte, r_n, interfrange, doublet, mercure,
   localisation, moiré ; lames : chemin exact dans le verre, image fantôme, lamelle et indice de groupe).

    python3 tests/app_michelson_concordance_test.py
Le shader est vérifié à part contre le cœur JS : tests/michelson_gpu_test.py (Chromium, WebGL par SwiftShader).
"""
import json
import subprocess
import sys
from pathlib import Path

ICI = Path(__file__).resolve().parent
SRC = (ICI / ".." / "src").resolve()
sys.path.insert(0, str(ICI))
import app_michelson_reference as ref  # noqa: E402

JS = SRC / "_app-michelson-coeur.js"
ok = 0
echecs = []


def verifier(cond, titre, detail=""):
    global ok
    if cond:
        ok += 1
    else:
        echecs.append(titre)
        print("  ÉCHEC " + titre + (" — " + detail if detail else ""))


def proche(a, b, rel=1e-9, abs_=0.0):
    return abs(a - b) <= abs_ + rel * max(abs(a), abs(b))


REJOUER = r"""
const { Coeur } = require(process.argv[1]);
const C = JSON.parse(require("fs").readFileSync(0, "utf8"));
const pts = C.points.map((c) => {
  const P = Coeur.pointSource(c.cfg, c.rendu, c.xs, c.ys);
  const d = (b) => b.disques.map((x) => [x.cx, x.cy, x.r, x.w]);
  return { c0: P.c0, cx: P.cx, cy: P.cy, cxx: P.cxx, cyy: P.cyy, cxy: P.cxy, I1: P.b1.I, I2: P.b2.I, disques1: d(P.b1), disques2: d(P.b2),
    delta: c.delta.map(([X, Y]) => Coeur.delta(c.cfg, c.xs, c.ys, X, Y, c.rendu)) };
});
const pix = C.pixels.map((c) => {
  const prep = Coeur.preparer(c.cfg, c.rendu, c.passe);
  return { n: prep.n, xyz: c.xyz.map(([X, Y]) => Coeur.evaluer(prep, X, Y)) };
});
process.stdout.write(JSON.stringify({ pts, pix }));
"""


def main():
    print("1. contrôles à jour")
    attendu = ref.generer_controles()
    lu = json.loads(ref.CONTROLES.read_text())
    verifier(lu == json.loads(json.dumps(attendu)), "app_michelson_controles.json à jour",
             "relancer : python3 app_michelson_reference.py --ecrire")

    print("2-3. le cœur JS rejoue les contrôles")
    r = subprocess.run(["node", "-e", REJOUER, str(JS)], input=json.dumps(lu), capture_output=True, text=True, check=True)
    js = json.loads(r.stdout)
    pire_d = 0.0
    for c, j in zip(lu["points"], js["pts"]):
        tag = "%s (%g, %g)%s" % (c["nom"], c["xs"] * 1e3, c["ys"] * 1e3, " flou" if c["rendu"]["pixel"] else "")
        for (X, Y, dp), dj in zip(c["delta"], j["delta"]):
            pire_d = max(pire_d, abs(dp - dj))
            verifier(abs(dp - dj) < 1e-10, "δ " + tag, "X = %g, Y = %g : %.3e / %.3e" % (X, Y, dp, dj))
        verifier(abs(c["c0"] - j["c0"]) < 1e-12 and all(proche(c[k], j[k], 1e-9, 1e-15) for k in ("cx", "cy", "cxx", "cyy", "cxy")),
                 "coefficients " + tag)
        verifier(proche(c["I1"], j["I1"]) and proche(c["I2"], j["I2"]), "éclairements " + tag,
                 "%r / %r" % ((c["I1"], c["I2"]), (j["I1"], j["I2"])))
        for k in ("disques1", "disques2"):
            verifier(len(c[k]) == len(j[k]) and all(proche(a, b, 1e-9, 1e-15) for da, db in zip(c[k], j[k]) for a, b in zip(da, db)),
                     k + " " + tag)
    pire_p = 0.0
    for c, j in zip(lu["pixels"], js["pix"]):
        verifier(c["n"] == j["n"], "points sources éclairés " + c["nom"], "%d / %d" % (c["n"], j["n"]))
        for (X, Y, *xp), xj in zip(c["xyz"], j["xyz"]):
            echelle = max(abs(v) for v in xp) or 1.0
            e = max(abs(a - b) for a, b in zip(xp, xj)) / echelle
            pire_p = max(pire_p, e)
            verifier(e < 1e-9, "pixel " + c["nom"], "X = %g, Y = %g : écart relatif %.2e" % (X, Y, e))
    print("   δ : écart max %.2e m sur %d points ; pixels : écart relatif max %.2e" % (pire_d, sum(len(c["delta"]) for c in lu["points"]), pire_p))

    print("4. vérifications physiques")
    res, _ = ref.verifications()
    for bon, titre, detail in res:
        verifier(bon, titre, detail)

    print("%d vérifications, %d échec(s)" % (ok + len(echecs), len(echecs)))
    sys.exit(1 if echecs else 0)


if __name__ == "__main__":
    main()
