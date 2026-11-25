#!/usr/bin/env python3
# Créé par Claude
"""Concordance du cœur du banc d'optique (_app-banc-coeur.js).

1. app_banc_controles.json est à jour avec la référence Python (app_banc_reference.py --ecrire sinon).
2. Le cœur JS rejoue chaque banc de contrôle (tous les types d'éléments, optique parfaite et réelle, miroir replié,
   éléments décentrés et inclinés, réseau tourné, Jones) : primitives de la séquence (repères, paramètres, abscisses)
   à 1e-12, diaphragme d'ouverture, cible de la source ; rayons tirés au même hasard (état final, primitive d'arrêt,
   impact, poids, chemin optique, couleur, position, direction, Jones) à 1e-9 ; paraxial (images réelles, image
   finale, matrice, enveloppe dans les deux plans) à 1e-9 ; pinceaux (points de passage) à 1e-9 ; faces transmission
   et Jones, table d'Airy, lentilles conçues, faisceau gaussien ; visée guidée (lot 4a de) : guides
   rebâtis par le JS (passe pilote ou histogrammes donnés) au bit près, rayons guidés à 1e-9.
3. Moteur ondulatoire (processeur) : le cœur JS rejoue les bancs de contrôle (Young, fente source tournée, lumière
   blanche, laser, tavelures, réseau, filtrage en somme brute, polariseurs, plans conjugués, champ proche) : plan du
   calcul (source, plans diffractants, grille, longueurs d'onde) et image à 1e-6 de son maximum ; choix du moteur.
4. Les vérifications physiques de la référence (Gauss, aberration sphérique du § 1, chromatisme, Airy, Bessel,
   Silbermann, autocollimation, viseur, œil, Malus, quart d'onde, réseau, condenseur, laser ; ondes : Collins contre
   l'intégrale directe, interfrange, contraste, flux, lobes, Airy, lumière blanche, Malus, Abbe-Porter, strioscopie).

    python3 tests/app_banc_concordance_test.py
Le shader est vérifié à part contre le cœur JS : tests/banc_gpu_test.py (Chromium, WebGL par SwiftShader).
"""
import json
import math
import subprocess
import sys
from pathlib import Path

ICI = Path(__file__).resolve().parent
SRC = (ICI / ".." / "src").resolve()
sys.path.insert(0, str(ICI))
import app_banc_reference as ref  # noqa: E402

JS = SRC / "_app-banc-coeur.js"
ok = 0
echecs = []


def verifier(cond, titre, detail=""):
    global ok
    if cond:
        ok += 1
    else:
        echecs.append(titre)
        print("  ÉCHEC " + titre + (" — " + detail if detail else ""))


def proche(a, b, rel=1e-9, abs_=1e-12):
    if a is None or b is None:
        return a is None and b is None
    if isinstance(a, float) and math.isnan(a):
        return isinstance(b, float) and math.isnan(b)
    return abs(a - b) <= abs_ + rel * max(abs(a), abs(b))


def listes(a, b, rel=1e-9, abs_=1e-12):
    return len(a) == len(b) and all(proche(x, y, rel, abs_) for x, y in zip(a, b))


REJOUER = r"""
const { Coeur: C } = require(process.argv[1]);
const D = JSON.parse(require("fs").readFileSync(0, "utf8"));
const NR = D.nr;
const num = (v) => (Number.isFinite(v) ? v : null);
const cas = D.cas.map((c) => {
  const seq = C.sequence(c.banc), o = seq.objet;
  const prims = seq.prims.map((p) => [p.k, p.dz, p.R, p.Sm, p.sens, p.zp, p.s].concat(p.O, p.ex, p.ey, p.ez, p.p, p.ap));
  const rayons = [];
  for (const k of c.rayons.map((x) => x[0])) {
    const r = C.tirer(seq, 3, 1, k, NR), s = C.suivre(seq, r, r.alea);
    rayons.push([k, s.i, s.etat === "detecte" ? 1 : 0, r.x, r.y, r.w, r.L, r.l].concat(r.f, r.p, r.d, r.J || []));
  }
  const par = {};
  for (const l of [486.13, 587.6, 656.27]) {
    const im = C.images(seq, l, o);
    par[String(l)] = im === null ? null : { reelles: im.reelles.map((x) => [x.s, x.z, x.gamma, x.apres]),
      finale: [num(im.finale.s), num(im.finale.gamma), num(im.finale.angle || 0)], M: im.M };
  }
  const ouv = C.ouverture(seq, 587.6, o);
  const env = C.enveloppe(seq, 587.6, -1, -2, 1.5, 1, 1.0, 4), env2 = C.enveloppe(seq, 550, o, -1, 1, 0, 0.5, 3);
  const pin = C.pinceau(seq, { x: 0.3, y: 1.2, z: o >= 0 ? seq.prims[o].zp : seq.zEm }, { n: 5, axe: 1, l: [480, 640], de: o + 1 });
  return { prims, objet: o, iDet: seq.iDet, vue: seq.vue, cible: seq.cible, stop: ouv ? [ouv.i, ouv.u, ouv.D] : null, rayons, parax: par,
    env: env.pts.map((p) => [p.s, p.z, p.lo, p.hi]), env2: env2.pts.map((p) => [p.s, p.lo, p.hi]),
    pinceau: pin.map((x) => [x.l, x.etat === "detecte" ? 1 : 0, x.L, x.x, x.y].concat(...x.pts)) };
});
const guides = D.guides.map((g) => {
  const seq = C.sequence(g.banc);
  const G = g.pilote ? C.guideCPU(seq, g.pilote) : C.guideTables(g.histos, g.n, g.alpha == null ? C.GUIDE.alpha : g.alpha);
  seq.guide = G;
  const rayons = g.rayons.map((x) => {
    const k = x[0], r = C.tirer(seq, 3, 1, k, NR), s = C.suivre(seq, r, r.alea);
    return [k, s.i, s.etat === "detecte" ? 1 : 0, r.x, r.y, r.w, r.L, r.l].concat(r.f, r.p, r.d, r.J || []);
  });
  const t = G.t.map((x) => (x ? { n: x.n, H: Array.from(x.H), prob: Array.from(x.prob), alias: Array.from(x.alias), iq: Array.from(x.iq) } : null));
  return { mode: seq.mode, guide: { n: G.n, alpha: G.alpha, t }, rayons };
});
const faces = D.faces.map((f) => C.transmission(f.el, f.x, f.y, f.l));
const jones = D.jones.map((j) => C.jones(j.el, j.l));
const formes = D.formes.map((f) => { const g = []; for (let i = 0; i < 61; i++) for (let j = 0; j < 61; j++) g.push(C.forme(f.f, f.a, -f.Rx + 2 * f.Rx * i / 60, -f.Ry + 2 * f.Ry * j / 60)); return g; });
const lent = D.lentilles.map((x) => C.lentille(x[0], x[1], x[2], x[3]));
const gauss = C.gaussien(C.sequence(D.gaussBanc), 632.8, 0.4, [50, 150, 199, 600]).map((x) => [x.s, x.w]);
const planJson = (pl) => (!pl.ok ? { ok: false, raison: pl.raison } : { ok: true, laser: pl.laser, src: pl.src.i, planes: pl.planes.map((q) => [q.i, q.genre]),
  reseau: pl.reseau, N: pl.N, limite: pl.limite, pasSource: pl.pasSource,
  nums: [pl.lref, pl.ang, num(pl.rw)].concat(pl.d, ...pl.lambdas.map((l) => [l[0]].concat(l[1]))) });
const onde = D.onde.cas.map((c) => {
  const pl = C.ondePlan(C.sequence(c.banc), c.opt);
  return { plan: planJson(pl), rendus: pl.ok ? c.rendus.map((r) => Array.from(C.ondePasse(pl, r.rendu))) : [] };
});
const moteurs = D.onde.moteurs.map((m) => { const o = m.opt || undefined, r = C.ondeMoteur(C.sequence(m.banc), o); return { plan: planJson(C.ondePlan(C.sequence(m.banc), o)), moteur: r.moteur, raison: r.raison }; });
const spectres = {
  rayons: D.spectres.rayons.map((c) => Array.from(C.spectreCPU(C.sequence(c.banc), c.rendu))),
  ondes: D.spectres.ondes.map((c) => {
    const seq = C.sequence(c.banc), pl = C.ondePlan(seq, c.opt), ps = C.planSpectre(pl), sp = seq.source.sp;
    return { I: c.o.map((o) => C.ondeSpectre(pl, o, ps)), poids: c.o.map((o) => C.poidsSpectre(seq, o.l, sp.type === 0 ? 0 : sp.l.indexOf(o.l))) };
  })
};
process.stdout.write(JSON.stringify({ cas, guides, faces, jones, airy: C.AIRY, lent, gauss, formes, onde, moteurs, spectres }));
"""


def main():
    print("1. contrôles à jour")
    attendu = ref.generer_controles()
    lu = json.loads(ref.CONTROLES.read_text())
    verifier(lu == json.loads(json.dumps(attendu)), "app_banc_controles.json à jour", "relancer : python3 app_banc_reference.py --ecrire")

    print("2. le cœur JS rejoue les contrôles")
    entree = dict(lu, nr=ref.NR_CTRL, gaussBanc=next(b for n, b in ref.cas_controle() if n.startswith("laser")))
    r = subprocess.run(["node", "-e", REJOUER, str(JS)], input=json.dumps(entree), capture_output=True, text=True)
    if r.returncode:
        print(r.stderr)
        sys.exit(1)
    js = json.loads(r.stdout)
    pire, nr, ndet = 0.0, 0, 0

    def rayons(ca, cj, nom):
        nonlocal pire, nr, ndet
        for a, b in zip(ca, cj):
            nr += 1
            ndet += a[2]
            bon = a[:3] == b[:3] and len(a) == len(b)
            if bon:
                e = max((abs(x - y) / max(1.0, abs(x)) for x, y in zip(a[3:], b[3:])), default=0.0)
                pire = max(pire, e)
                bon = e < 1e-9
            verifier(bon, "rayon %d %s" % (a[0], nom), "%r / %r" % (a[:8], b[:8]))
    for c, j in zip(lu["cas"], js["cas"]):
        nom = c["nom"]
        verifier(len(c["prims"]) == len(j["prims"]) and all(listes(a, b, 1e-12, 1e-12) for a, b in zip(c["prims"], j["prims"])),
                 "primitives " + nom, "%d / %d" % (len(c["prims"]), len(j["prims"])))
        verifier(c["objet"] == j["objet"] and c["iDet"] == j["iDet"] and c["vue"] == j["vue"], "objet, détecteur, vue " + nom)
        verifier((c["cible"] is None and j["cible"] is None) or listes(c["cible"], j["cible"]), "cible de la source " + nom)
        verifier((c["stop"] is None and j["stop"] is None) or listes(c["stop"], j["stop"]), "diaphragme d'ouverture " + nom)
        rayons(c["rayons"], j["rayons"], nom)
        for l, pa in c["parax"].items():
            pj = j["parax"][l]
            if pa is None:
                verifier(pj is None, "paraxial %s %s" % (l, nom))
                continue
            verifier(len(pa["reelles"]) == len(pj["reelles"]) and all(listes(x, y) for x, y in zip(pa["reelles"], pj["reelles"]))
                     and listes(pa["finale"], pj["finale"]) and listes(pa["M"], pj["M"]), "images à %s nm %s" % (l, nom),
                     "%r / %r" % (pa["finale"], pj["finale"]))
        verifier(len(c["env"]) == len(j["env"]) and all(listes(x, y) for x, y in zip(c["env"], j["env"])), "enveloppe (profil) " + nom)
        verifier(len(c["env2"]) == len(j["env2"]) and all(listes(x, y) for x, y in zip(c["env2"], j["env2"])), "enveloppe (dessus) " + nom)
        verifier(len(c["pinceau"]) == len(j["pinceau"]) and all(listes(x, y) for x, y in zip(c["pinceau"], j["pinceau"])), "pinceau " + nom)
    print("   %d rayons (%d détectés) sur %d bancs : écart relatif max %.2e" % (nr, ndet, len(lu["cas"]), pire))
    # visée guidée (lot 4a de) : guide rebâti par le JS (passe pilote ou histogrammes donnés), tables
    # identiques (alias et probabilités en float32 au bit près), rayons guidés à 1e-9
    pire, nr, ndet = 0.0, 0, 0
    for c, j in zip(lu["guides"], js["guides"]):
        gc, gj = c["guide"], j["guide"]
        tab = gc["n"] == gj["n"] and gc["alpha"] == gj["alpha"] and len(gc["t"]) == len(gj["t"]) and all(
            (a is None and b is None) or (a is not None and b is not None and a["n"] == b["n"] and a["alias"] == b["alias"]
                                          and a["prob"] == b["prob"] and listes(a["H"], b["H"], 1e-12) and listes(a["iq"], b["iq"], 1e-12))
            for a, b in zip(gc["t"], gj["t"]))
        verifier(tab and c["mode"] == j["mode"] and any(gc["t"]), "guide « %s »" % c["nom"],
                 "sites %r / %r" % ([t and t["n"] for t in gc["t"]], [t and t["n"] for t in gj["t"]]))
        rayons(c["rayons"], j["rayons"], "guidé " + c["nom"])
    verifier(len(js["guides"]) == len(lu["guides"]), "contrôles de la visée guidée rejoués")
    print("   visée guidée : %d rayons (%d détectés) sur %d bancs : écart relatif max %.2e" % (nr, ndet, len(lu["guides"]), pire))
    verifier(all(listes(a["t"], b) for a, b in zip(lu["faces"], js["faces"])), "face transmission")
    verifier(all(listes([v for z in a["M"] for v in z], [v for z in b for v in z]) for a, b in zip(lu["jones"], js["jones"])), "face Jones")
    verifier(listes(lu["airy"], js["airy"], 1e-12, 1e-12), "table d'Airy")
    for f, g in zip(lu["formes"], js["formes"]):
        verifier(f["g"] == g and 0 < sum(g) < len(g), "forme « %s » (%d points, %d transmis)" % (f["nom"], len(g), sum(f["g"])))
    verifier(all(listes([x[4][k] for k in ("f", "D", "h", "c1", "k1", "c2", "k2", "t")], [y[k] for k in ("f", "D", "h", "c1", "k1", "c2", "k2", "t")], 1e-12)
                 for x, y in zip(lu["lentilles"], js["lent"])), "lentilles conçues")
    verifier(all(listes(a, b) for a, b in zip(lu["gauss"], js["gauss"])), "faisceau gaussien")

    print("3. moteur ondulatoire : le cœur JS rejoue les bancs de contrôle")

    def plans(a, b):
        if not a["ok"] or not b["ok"]:
            return a == b
        return all(a[k] == b[k] for k in ("laser", "src", "planes", "reseau", "N", "limite", "pasSource")) and listes(a["nums"], b["nums"])

    pire, npx = 0.0, 0
    for c, j in zip(lu["onde"]["cas"], js["onde"]):
        nom = c["nom"]
        verifier(plans(c["plan"], j["plan"]), "plan du calcul « %s »" % nom, "%r / %r" % (c["plan"], j["plan"]))
        for k, (r, img) in enumerate(zip(c["rendus"], j["rendus"])):
            mx = max(r["img"])
            e = max(abs(x - y) for x, y in zip(r["img"], img)) / mx if len(img) == len(r["img"]) and mx > 0 else float("inf")
            pire, npx = max(pire, e), npx + len(img) // 3
            verifier(e < 1e-6, "image « %s » (rendu %d)" % (nom, k), "écart %.2e du maximum" % e)
        verifier(len(j["rendus"]) == len(c["rendus"]), "rendus « %s »" % nom)
    print("   %d pixels sur %d bancs : écart max %.2e du maximum de l'image" % (npx, len(lu["onde"]["cas"]), pire))
    for m, j in zip(lu["onde"]["moteurs"], js["moteurs"]):
        att = "onde" if m["plan"]["ok"] else "rayons"
        verifier(plans(m["plan"], j["plan"]) and j["moteur"] == att and j["raison"] == m["plan"].get("raison"),
                 "choix du moteur (%s)" % (m["plan"].get("raison") or "onde"), "%r / %r" % (m["plan"], j))

    print("4. spectromètre : le cœur JS rejoue les contrôles")
    for c, j in zip(lu["spectres"]["rayons"], js["spectres"]["rayons"]):
        verifier(sum(c["cases"]) > 0 and listes(c["cases"], j), "rayons dans la fibre « %s »" % c["nom"], "%d cases" % len(j))
    for c, j in zip(lu["spectres"]["ondes"], js["spectres"]["ondes"]):
        verifier(all(v > 0 for v in c["I"]) and listes(c["I"], j["I"], 1e-6) and listes(c["poids"], j["poids"]), "ondes à la fibre « %s »" % c["nom"],
                 "%r / %r" % (c["I"], j["I"]))

    print("5. vérifications physiques")
    res, _ = ref.verifications(sortie=lambda *a: None)
    res = res + ref.verifications_onde(sortie=lambda *a: None)[0]
    for bon, titre, detail in res:
        verifier(bon, titre, detail)

    print("%d vérifications, %d échec(s)" % (ok + len(echecs), len(echecs)))
    sys.exit(1 if echecs else 0)


if __name__ == "__main__":
    main()
