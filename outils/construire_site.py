#!/usr/bin/env python3
# © 2026 Sébastien Reyt — licence GPLv3 (voir ../LICENSE)
"""Construit le site des paillasses d'optique (publication : https://optique.cpge-michelet.fr).

    python3 outils/construire_site.py [DEST]      (DEST par défaut : site/)

DEST reçoit :
    index.html, img/, robots.txt     page d'accueil (sources dans pages/)
    modele/, doc.css, sommaire.js, katex/       page de documentation « Modèle physique » (pages/modele.html)
    schemas/                         figures SVG de la page Modèle (pages/schemas/)
    michelson/ goniometre/ banc-optique/  une page par paillasse, l'app en PLEINE FENÊTRE (index.html)
    commun/                          paillasse.css, les JS des paillasses et leurs moteurs, compteur.js, retour.js

Part des SOURCES (src/_app-*.js, src/_style-paillasse.css), pas d'une sortie déjà construite.
Ni app-commun.js ni style.css : les instruments n'en dépendent pas, et `verifier_dependances`
refuse de construire si une page en appelle un.
Commentaires des fichiers servis : ni pointeur interne ni chemin personnel, refusés par
`verifier_commentaires` (motifs INTERDITS ; le copyright, ligne « © », est seul exempté).
La vérification requiert node + acorn (npm i acorn --no-save) ; sans eux elle est sautée,
avec un message.
Les pages posent `est-prof` (bouton « Prof » du Michelson et du goniomètre, matériel au
choix du banc). Diapos du banc : src/_app-banc-diapos.js, régénéré par src/app_banc_diapos.py.
Fichiers versionnés par ?v=<hash> (cache des navigateurs).
Construit à côté puis permute : jamais de site à moitié écrit.
"""
from __future__ import annotations

import hashlib
import html
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ICI = Path(__file__).resolve().parent
ROOT = ICI.parent
SRC = ROOT / "src"
PAGES = ROOT / "pages"
# (dossier servi, clé, méta de l'instrument — app/instrument/bac/niveau + titre affiché dans la barre).
APPS = [
    ("michelson", "michelson", {"app": "paillasse", "instrument": "michelson", "niveau": 1,
                                "titre": "Interféromètre de Michelson"}),
    ("goniometre", "goniometre", {"app": "paillasse", "instrument": "goniometre", "niveau": 1,
                                  "titre": "Spectrogoniomètre"}),
    ("banc-optique", "banc", {"app": "paillasse", "instrument": "banc", "bac": "revisions", "niveau": 1,
                              "titre": "Banc d'optique"}),
]
# Ordre du template : moteurs avant la coque et leurs instruments.
JS = ["app-michelson-coeur.js", "app-paillasse.js", "app-paillasse-michelson.js",
      "app-goniometre-coeur.js", "app-paillasse-goniometre.js", "app-banc-coeur.js", "app-paillasse-banc.js"]
EN_PLUS = ["app-banc-diapos.js"]   # chargé à la demande par le banc, à côté de son script, avec son ?v=
BASE = "https://optique.cpge-michelet.fr"
ICONES = ["favicon.svg", "favicon.ico", "favicon-32.png", "apple-touch-icon.png", "icone-192.png", "icone-512.png"]
DESCRIPTION = {
    "accueil": "Simulations en ligne du banc d'optique, du Michelson et du goniomètre de TP de classe "
               "préparatoire, à régler soi-même dans le navigateur. Sans compte, rien à installer.",
    "michelson": "Simulation de l'interféromètre de Michelson à régler comme en TP : compensatrice, franges, "
                 "anneaux, contact optique, lumière blanche.",
    "goniometre": "Simulation du spectrogoniomètre à régler comme en TP : oculaire, autocollimation, "
                  "collimateur, réseau, prisme, vernier.",
    "banc": "Simulation d'un banc d'optique complet : lentilles, images, rayons de construction, Young, "
            "diffraction, filtrage.",
    "modele": "Le modèle optique des trois instruments, ses approximations et ses sources.",
    "prise-en-main": "Gestes, aides et raccourcis du Michelson, du goniomètre et du banc d'optique.",
}
# Bloc « À propos » repliable de la barre des pages instruments. Ouvert, il donne au visiteur
# deux phrases de contexte ; replié, il reste dans le DOM — Google indexe le contenu d'un
# accordéon même fermé (contrairement au texte masqué en CSS, interdit par ses règles anti-spam).
# C'est le seul texte de contexte des instruments, dont la scène est du canvas (illisible aux robots).
APROPOS = {
    "michelson": "<p>Simulation en ligne de l'interféromètre de Michelson des travaux pratiques : rien n'est "
                  "réglé à l'avance. On tourne les vis, on translate le chariot, et l'œil simulé rend "
                  "compte des franges d'égale épaisseur, des anneaux d'égale inclinaison et du contact optique "
                  "en lumière blanche, avec la raie du sodium ou une source étendue.</p>"
                  "<p>Les figures sont calculées à chaque instant, pas pré-enregistrées — voir le "
                  "<a href=\"../modele/\">modèle physique</a>. Gestes et raccourcis : "
                  "<a href=\"../prise-en-main/\">prise en main</a>.</p>",
    "goniometre": "<p>Simulation en ligne du spectrogoniomètre des travaux pratiques : réglage de l'oculaire, "
                  "autocollimation du collimateur, prisme ou réseau, mesures au vernier au dixième de degré — avec "
                  "les raies du sodium ou de l'arc au mercure. Les spectres sont calculés à chaque instant, "
                  "pas pré-enregistrés.</p>"
                  "<p>Modèle et approximations : <a href=\"../modele/\">modèle physique</a>. Gestes et "
                  "raccourcis : <a href=\"../prise-en-main/\">prise en main</a>.</p>",
    "banc": "<p>Simulation en ligne d'un banc d'optique complet : on pose lampes, lentilles, diaphragmes et "
            "écran sur la maquette, on ouvre les fentes de Young, et l'image se forme — rayons de construction, "
            "diffraction et filtrage calculés à chaque instant, pour préparer ou refaire un TP d'optique.</p>"
            "<p>Modèle et approximations : <a href=\"../modele/\">modèle physique</a>. Gestes et raccourcis : "
            "<a href=\"../prise-en-main/\">prise en main</a>.</p>",
}
# <title> et og:title des instruments : le mot-clé « simulation » n'y figurait pas, et le titre
# du méta (affiché dans la barre de l'app) ne doit pas être retouché — d'où ce dédoublement.
TITRE_SEO = {
    "accueil": "Salle noire — simulations d'optique : Michelson, spectrogoniomètre, banc d'optique",
    "michelson": "Simulation de l'interféromètre de Michelson",
    "goniometre": "Simulation du spectrogoniomètre",
    "banc": "Simulation d'un banc d'optique",
}
# Pages de documentation : (dossier servi, source dans pages/, titre, clé de DESCRIPTION).
DOCS = [("modele", "modele.html", "Modèle physique", "modele"),
        ("prise-en-main", "prise-en-main.html", "Prise en main", "prise-en-main")]
# Figures SVG de la page Modèle (référencées ../schemas/<nom>.svg depuis modele/, vérifiées par verifier_dependances).
SCHEMAS_SERVIS = ("spectres", "vision-reponse", "ddm-ordre2", "blanc-bandes", "moyenne-pixel",
                  "pupilles", "etendue-poids", "tirage-rebours", "onde-propagation", "parallaxe")
# Site indexé (Google) : tout est ouvert sauf l'API (compteur, retours), plan du site déclaré.
ROBOTS = f"User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: {BASE}/sitemap.xml\n"


def tete(cle, titre, url, image, rac):
    """Icônes + Open Graph + JSON-LD d'une page ; `rac` = chemin relatif vers la racine du site.

    `titre` sert ici d'intitulé SEO (<title>/og:title/JSON-LD) : pour les instruments, passer
    TITRE_SEO[cle] — la barre de l'app affiche, elle, le titre du méta."""
    d = html.escape(DESCRIPTION[cle], quote=True)
    t = html.escape(titre, quote=True)
    ld = {"@context": "https://schema.org", "@type": "WebApplication", "name": titre,
          "url": f"{BASE}{url}", "description": DESCRIPTION[cle],
          "applicationCategory": "EducationalApplication", "inLanguage": "fr",
          "browserRequirements": "Requires JavaScript",
          "offers": {"@type": "Offer", "price": "0", "priceCurrency": "EUR"}}
    ld_txt = json.dumps(ld, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    return (f'<link rel="canonical" href="{BASE}{url}">\n'
            f'<link rel="icon" href="{rac}favicon.svg" type="image/svg+xml">\n'
            f'<link rel="icon" href="{rac}favicon-32.png" sizes="32x32" type="image/png">\n'
            f'<link rel="apple-touch-icon" href="{rac}apple-touch-icon.png">\n'
            # color-scheme:dark — la page EST sombre ; le déclarer désactive le « mode sombre forcé »
            # d'Android qui recolore le texte (chiffres des pastilles rendus blanc sur or, donc invisibles).
            '<meta name="color-scheme" content="dark">\n'
            '<meta name="theme-color" content="#08090b">\n'
            f'<meta name="description" content="{d}">\n'
            f'<meta property="og:type" content="website">\n'
            f'<meta property="og:locale" content="fr_FR">\n'
            f'<meta property="og:title" content="{t}">\n'
            f'<meta property="og:description" content="{d}">\n'
            f'<meta property="og:url" content="{BASE}{url}">\n'
            f'<meta property="og:image" content="{BASE}/img/{image}">\n'
            f'<meta property="og:image:width" content="1200">\n'
            f'<meta property="og:image:height" content="630">\n'
            f'<meta property="og:image:alt" content="{t}">\n'
            f'<meta name="twitter:card" content="summary_large_image">\n'
            f'<script type="application/ld+json">{ld_txt}</script>\n')

PAGE_APP = """<!doctype html>
<!-- © 2026 Sébastien Reyt — page générée, ne pas éditer -->
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="index, follow">
<title>{titre_seo}</title>
{tete}<link rel="stylesheet" href="../commun/paillasse.css?v={v_css}">
<style>
  *, *::before, *::after {{ box-sizing:border-box; }}
  a {{ color:inherit; text-decoration:none; }}
  svg {{ display:block; }}
  @media (prefers-reduced-motion: reduce) {{ * {{ transition:none !important; }} }}
  html, body {{ margin:0; height:100%; background:#08090b; overflow:hidden; }}
  .op-barre {{ position:fixed; top:0; left:0; right:0; height:32px; z-index:10; display:flex; align-items:center; gap:14px;
    padding:0 14px; background:#0c0f13; border-bottom:1px solid #1b1f25; font:13px/1 system-ui, sans-serif; color:#8a939f; }}
  .op-barre a {{ color:#c9cfd8; text-decoration:none; }}
  .op-barre a:hover {{ color:#e0b84c; }}
  .op-barre b {{ color:#eef1f5; font-weight:600; }}
  .op-app {{ position:fixed; top:33px; left:0; right:0; bottom:0; }}
  .op-app .pl-licence {{ display:none; }}
  .op-barre {{ white-space:nowrap; overflow:hidden; }}
  .op-barre b {{ overflow:hidden; text-overflow:ellipsis; }}
  .op-app {{ background:#08090b; }}
  /* « À propos » repliable : texte de contexte lisible par les robots, discret pour le visiteur.
     Panneau en position:fixed car la barre a overflow:hidden (il serait clippé sinon). */
  .op-barre .op-apropos {{ margin-left:auto; }}
  .op-apropos summary {{ cursor:pointer; list-style:none; user-select:none; white-space:nowrap; color:#6e7783; font-size:12px; }}
  .op-apropos summary::-webkit-details-marker {{ display:none; }}
  .op-apropos[open] summary {{ color:#e0b84c; }}
  .op-apropos-panneau {{ position:fixed; top:33px; right:10px; width:360px; max-width:calc(100vw - 20px); z-index:9;
    background:#0c0f13; border:1px solid #1b1f25; border-radius:8px; padding:13px 16px 15px;
    font:13.5px/1.55 system-ui, sans-serif; color:#8a939f; text-align:left; white-space:normal; }}
  .op-apropos-panneau a {{ color:#e0b84c; }}
  .op-apropos-panneau a:hover {{ color:#f0d28a; }}
  .op-apropos-panneau p {{ margin:0 0 9px; }}
  .op-apropos-panneau p:last-child {{ margin-bottom:0; }}
  .op-app .atelier-scene {{ display:none; }}
  @media (max-width:700px) {{ .op-barre .op-lic {{ display:none; }} }}
  .op-barre .op-lic {{ margin-left:14px; color:#6e7783; font-size:12px; }}
</style>
</head>
<body class="est-prof" data-app="{cle}">
<header class="op-barre"><a href="../">&larr; Accueil</a><b>{titre}</b><details class="op-apropos"><summary>&Agrave; propos de la simulation</summary><div class="op-apropos-panneau">{apropos}</div></details><a class="op-lic" href="https://github.com/sebreyt/salle-noire/blob/main/LICENSE">&copy; S. Reyt &middot; GPLv3</a></header>
<section class="pane-exp paillasse-on app-signature op-app"><div class="atelier-scene"></div></section>
{scripts}
<script>
(function () {{
  var meta = {meta};
  var esc = function (s) {{ return String(s).replace(/[&<>"']/g, function (c) {{ return "&#" + c.charCodeAt(0) + ";"; }}); }};
  var scene = document.querySelector(".atelier-scene");
  try {{ window.VITRINE_APPS.paillasse.monter({{ scene: scene, meta: meta, esc: esc }}); }}
  catch (e) {{ scene.textContent = "Erreur au chargement de l'instrument : " + (e.message || e); }}
}})();
</script>
<script src="../commun/compteur.js?v={v_cpt}"></script>
<script src="../commun/retour.js?v={v_ret}"></script>
</body>
</html>
"""


def empreinte(p: Path) -> str:
    return hashlib.sha1(p.read_bytes()).hexdigest()[:10]


# Motifs refusés dans les commentaires des fichiers servis (le site public est lu par des inconnus) :
# pointeurs vers la doc interne, noms et chemins personnels, reste de l'écosystème. Le copyright (ligne « © »)
# porte le nom de l'auteur, il est seul exempté.
INTERDITS = re.compile(r"SPEC-|\blots? \d|\blot [A-Z]\d|Sébastien|Édouard|/data/|/home/|~/|\b[Vv]itrine\b|Michelet|"
                       r"\batelier\b|maquette-|CLAUDE\.md|LICENCE-|\bTODO\b|_test\.(?:py|js|mjs)\b|_reference\.py|"
                       r"generate\.py|recherche\.py|Nextcloud|Pyodide|\.meta\.yaml|\bskill\b|20\d\d-\d\d-\d\d")
SERVIS_JS = ["src/_" + f for f in JS + EN_PLUS] + [f"pages/{f}" for f in ("compteur.js", "retour.js", "sommaire.js")]
SERVIS_AUTRES = ["src/_style-paillasse.css", "pages/doc.css", "pages/index.html",
                 "pages/modele.html", "pages/prise-en-main.html"]

# Extraction de commentaires (JS : acorn — une chaîne n'est jamais prise pour un commentaire).
NODE_EXTRAIRE = r"""
const acorn = require(process.argv[1] + '/acorn');
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const out = [];
acorn.parse(src, {ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true, locations: true,
  allowReturnOutsideFunction: true,
  onComment: (bloc, texte, debut, fin, l0) => out.push({debut, fin, ligne: l0.line, colonne: l0.column})});
console.log(JSON.stringify(out));
"""


def commentaires(rel: str) -> list[dict]:
    """[{debut, fin, ligne, colonne, texte}] du fichier (offsets en caractères)."""
    p = ROOT / rel
    src = p.read_text(encoding="utf-8")
    if rel.endswith(".js"):
        r = subprocess.run(["node", "-e", NODE_EXTRAIRE, str(ROOT / "node_modules"), str(p)],
                           capture_output=True, text=True, check=True)
        res = json.loads(r.stdout)
    else:
        if rel.endswith(".css"):
            motifs = [r"/\*.*?\*/"]
        else:
            motifs = [r"<!--.*?-->", r"/\*.*?\*/", r"(?<![:\"'\\])//[^\n]*"]
        res = []
        for m in re.finditer("|".join(motifs), src, flags=re.S):
            debut = m.start()
            ligne = src.count("\n", 0, debut) + 1
            colonne = debut - (src.rfind("\n", 0, debut) + 1)
            res.append({"debut": debut, "fin": m.end(), "ligne": ligne, "colonne": colonne})
    for c in res:
        c["texte"] = src[c["debut"]:c["fin"]]
    return res


def verifier_commentaires() -> None:
    """Refuse de construire si un commentaire servi contient un motif d'INTERDITS."""
    if not (shutil.which("node") and (ROOT / "node_modules" / "acorn").exists()):
        print("  (contrôle des commentaires sauté : node/acorn absents — npm i acorn --no-save)")
        return
    fautes = []
    for rel in SERVIS_JS + SERVIS_AUTRES:
        for c in commentaires(rel):
            for k, ligne in enumerate(c["texte"].split("\n")):
                m = None if "©" in ligne else INTERDITS.search(ligne)
                if m:
                    fautes.append(f"  {rel}:{c['ligne'] + k} « {m.group(0)} » : {ligne.strip()[:100]}")
    if fautes:
        sys.exit("Commentaires à nettoyer avant publication (site public) :\n" + "\n".join(fautes))


def verifier_dependances(dest: Path) -> None:
    """Les pages du site ne chargent que ce qu'il contient."""
    for page in dest.rglob("*.html"):
        t = page.read_text(encoding="utf-8")
        for ref in re.findall(r'(?:src|href)="([^"#?]+)', t):
            if ref.startswith(("http:", "https:", "data:", "mailto:")):
                continue
            if not (page.parent / ref).resolve().exists():
                sys.exit(f"{page.relative_to(dest)} : {ref} introuvable dans le site construit")


def construire(dest: Path) -> None:
    verifier_commentaires()
    neuf = dest.with_name(dest.name + ".new")
    shutil.rmtree(neuf, ignore_errors=True)
    (neuf / "commun").mkdir(parents=True)
    for f in JS + EN_PLUS:
        shutil.copy2(SRC / ("_" + f), neuf / "commun" / f)
    shutil.copy2(SRC / "_style-paillasse.css", neuf / "commun" / "paillasse.css")
    shutil.copy2(PAGES / "compteur.js", neuf / "commun" / "compteur.js")
    shutil.copy2(PAGES / "retour.js", neuf / "commun" / "retour.js")
    shutil.copytree(PAGES / "img", neuf / "img")
    shutil.copytree(PAGES / "katex", neuf / "katex")
    shutil.copy2(PAGES / "doc.css", neuf / "doc.css")
    shutil.copy2(PAGES / "sommaire.js", neuf / "sommaire.js")
    (neuf / "schemas").mkdir()
    for fig in SCHEMAS_SERVIS:
        shutil.copy2(PAGES / "schemas" / (fig + ".svg"), neuf / "schemas" / (fig + ".svg"))
    v_docs = {"doc.css": empreinte(neuf / "doc.css"), "sommaire.js": empreinte(neuf / "sommaire.js"),
          "compteur.js": empreinte(neuf / "commun" / "compteur.js")}
    for dossier, src, titre, cle in DOCS:
        page = (PAGES / src).read_text(encoding="utf-8")
        # CSS/JS versionnés : cache heuristique des téléphones sinon (le HTML est no-cache, le CSS non)
        page = page.replace('href="../doc.css"', f'href="../doc.css?v={v_docs["doc.css"]}"')
        page = page.replace('src="../sommaire.js"', f'src="../sommaire.js?v={v_docs["sommaire.js"]}"')
        page = page.replace('src="../commun/compteur.js"', f'src="../commun/compteur.js?v={v_docs["compteur.js"]}"')
        page = page.replace("</head>", tete(cle, titre, f"/{dossier}/", "apercu.jpg", "../") + "</head>", 1)
        (neuf / dossier).mkdir()
        (neuf / dossier / "index.html").write_text(page, encoding="utf-8")
    (neuf / "robots.txt").write_text(ROBOTS, encoding="utf-8")
    urls = ["/"] + [f"/{d}/" for d, _, _, _ in DOCS] + [f"/{d}/" for d, _, _ in APPS]
    (neuf / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "".join(f"  <url><loc>{BASE}{u}</loc></url>\n" for u in urls) + "</urlset>\n", encoding="utf-8")
    for f in ICONES:
        shutil.copy2(PAGES / f, neuf / f)
    v = {f: empreinte(neuf / "commun" / f) for f in JS + ["paillasse.css", "compteur.js", "retour.js"]}
    accueil = (PAGES / "index.html").read_text(encoding="utf-8")
    accueil = accueil.replace('src="commun/compteur.js"', f'src="commun/compteur.js?v={v["compteur.js"]}"')
    accueil = accueil.replace('src="commun/retour.js"', f'src="commun/retour.js?v={v["retour.js"]}"')
    # Vignettes animées de l'accueil : versionnées comme le reste (sinon le cache heuristique
    # garde les vignettes fixes après qu'elles sont devenues animées, le HTML seul est no-cache).
    for cle in ("michelson", "goniometre", "banc"):
        accueil = accueil.replace(f'src="img/{cle}.webp"',
                                  f'src="img/{cle}.webp?v={empreinte(neuf / "img" / f"{cle}.webp")}"')
    accueil = accueil.replace("</head>", tete("accueil", TITRE_SEO["accueil"], "/", "apercu.jpg", "") + "</head>", 1)
    (neuf / "index.html").write_text(accueil, encoding="utf-8")
    scripts = "\n".join(f'<script src="../commun/{f}?v={v[f]}"></script>' for f in JS)
    for dossier, cle, meta in APPS:
        (neuf / dossier).mkdir()
        (neuf / dossier / "index.html").write_text(PAGE_APP.format(
            titre_seo=html.escape(TITRE_SEO[cle]), titre=html.escape(meta.get("titre") or cle), cle=cle,
            tete=tete(cle, TITRE_SEO[cle], f"/{dossier}/", f"apercu-{cle}.jpg", "../"), v_css=v["paillasse.css"], v_cpt=v["compteur.js"], v_ret=v["retour.js"],
            scripts=scripts, meta=json.dumps(meta, ensure_ascii=False), apropos=APROPOS[cle]), encoding="utf-8")
    verifier_dependances(neuf)
    vieux = dest.with_name(dest.name + ".old")
    shutil.rmtree(vieux, ignore_errors=True)
    if dest.exists():
        dest.rename(vieux)
    neuf.rename(dest)
    shutil.rmtree(vieux, ignore_errors=True)


if __name__ == "__main__":
    dest = Path(sys.argv[1]).resolve() if len(sys.argv) == 2 else ROOT / "site"
    construire(dest)
    print(f"Site construit dans {dest}")
