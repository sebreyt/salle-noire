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

**Version en ligne : <https://optique.cpge-michelet.fr>** (site non indexé, sans compte).

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
| `site/` | Site complet autonome, servable tel quel (publication issue des sources) |
| `src/` | Sources JavaScript des instruments (coque commune `_app-paillasse.js`, moteurs `*-coeur.js`, un fichier par instrument), CSS, et le générateur des diapos du banc |

Les fichiers de `site/commun/` sont les copies publiées de `src/` (sans le tiret bas) ;
`site/index.html`, `site/modele/` et `site/prise-en-main/` sont les pages d'accueil et de
documentation.

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

Sébastien Reyt — professeur de physique-chimie en CPGE MP (lycée Michelet, Paris).
