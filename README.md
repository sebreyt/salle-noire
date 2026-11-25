# Salle noire — paillasses d'optique virtuelles

Trois instruments d'optique de travaux pratiques, simulés à régler soi-même dans le
navigateur — rien n'est pré-réglé, les figures se calculent à chaque instant :

- **Interféromètre de Michelson** — compensatrice, vis, chariot, franges d'égale
  épaisseur, anneaux d'égale inclinaison, contact optique en lumière blanche ;
- **Spectrogoniomètre** — oculaire, autocollimation, collimateur, réseau, prisme,
  vernier ;
- **Banc d'optique** — lentilles, images, rayons de construction, fentes d'Young,
  diffraction, filtrage.

Conçus pour les travaux pratiques de physique en classe préparatoire (CPGE MP/MPSI),
utilisables librement en cours, en TD ou à la maison.

**Version en ligne : <https://optique.cpge-michelet.fr>** (sans compte, rien à installer).

## Essayer localement

Le dossier `site/` est le site complet, autonome, tel qu'il est servi en ligne.
Deux façons de l'ouvrir :

```bash
# au choix —
python3 -m http.server -d site        # http://localhost:8000
# ou simplement ouvrir site/index.html dans un navigateur
```

Seuls le compteur de visites et le formulaire « Un bug, une idée ? » (qui appellent
le serveur de la version en ligne) sont inopérants en local.

## Organisation du dépôt

| Dossier | Contenu |
|---|---|
| `src/` | Sources des instruments : coque commune (`_app-paillasse.js`), moteurs (`*-coeur.js`), un fichier par instrument, `_style-paillasse.css`, et `app_banc_diapos.py` (régénère les diapos du banc, télécharge lui-même les deux images de domaine public) |
| `pages/` | Sources des pages servies : accueil, « Modèle physique », « Prise en main », style, vignettes et captures (`img/`), figures SVG (`schemas/`), KaTeX |
| `site/` | Sortie complète du build — servable tel quel |
| `outils/construire_site.py` | Reconstruit `site/` à partir de `src/` + `pages/` |
| `tests/` | Référence Python des trois moteurs + tests de concordance JS ↔ Python, avec leurs points de contrôle (`app_*_controles.json`) |

Régénérer le site :

```bash
python3 outils/construire_site.py
```

Le build vérifie que les commentaires des fichiers servis ne contiennent aucun chemin
personnel ni pointeur interne (règles `INTERDITS` du script) — ce contrôle requiert `node`
et acorn (`npm i acorn --no-save`) ; sans eux il est sauté, avec un message.

Vérifier la physique (chaque test rejoue les points de contrôle avec le moteur JS sous `node`
et les compare à la référence Python, puis rejoue les vérifications physiques de celle-ci) :

```bash
python3 tests/app_michelson_concordance_test.py      # ~1400 vérifications
python3 tests/app_goniometre_concordance_test.py     # ~1000
python3 tests/app_banc_concordance_test.py           # ~3300
```

## Licences

- **Code** (`src/`, et les `.js`/`.css` de `site/`) : **GPLv3** — voir [LICENSE](LICENSE).
  Réutilisation et modification libres, y compris commercialement ; tout dérivé
  doit rester sous GPLv3.
- **Contenus pédagogiques** (textes des pages, figures, captures) : **CC BY-NC-SA 4.0** —
  voir [LICENCE-contenu.md](LICENCE-contenu.md).
- KaTeX (`site/katex/`) : licence MIT © Khan Academy.

## Contribution

Signalements et suggestions : ouvrez une *issue*. Le code suit le modèle physique décrit
dans la page « Modèle physique » du site — toute modification du moteur doit rester
cohérente avec lui.

## Auteur

Sébastien Reyt — professeur de physique-chimie en CPGE MP (lycée Michelet, Vanves).
Le code de ces instruments a été écrit par Claude (Anthropic), un assistant d'IA, à partir
des choix physiques et pédagogiques de l'auteur.
