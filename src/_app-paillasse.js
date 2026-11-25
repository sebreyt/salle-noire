// © 2026 Sébastien Reyt — licence GPLv3 (code) : réutilisation et modification libres, en citant l'auteur, tout dérivé restant sous la même licence. https://www.gnu.org/licenses/gpl-3.0.html — textes, figures et pages : CC BY-NC-SA 4.0.
// Code écrit par Claude (Anthropic), un assistant d'IA, à partir des choix physiques et pédagogiques de l'auteur.
/* Coque « paillasse » des TP virtuels.
 * Mise en page à deux panneaux en salle noire (vue de dessus de l'appareil à gauche, observation à droite, loupe de
 * lecture et rangée du bas), vis moletées qu'on fait rouler à la souris, glisser le long d'un banc, LA molette des trois
 * instruments (pas accumulés, cible figée ; cf. `surMolette`), sauvegarde dans le navigateur, hasard à
 * graine, boucle d'affichage (une mise à jour par requestAnimationFrame, jamais par pointermove).
 * L'INSTRUMENT (michelson, goniometre, banc) s'enregistre dans le registre des instruments et
 * fournit son dessin, ses organes, son modèle :
 *   creer(K) → { viewBox, tick(), redim(S), capturer(), stop() }   (K : API ci-dessous, cf. `api`)
 * Ni parties ni pas à pas. Sur un écran étroit, message « à ouvrir sur un ordinateur ».
 * Annuler (Ctrl+Z ; rétablir : Ctrl+Maj+Z ou Ctrl+Y) : quand l'instrument fournit `etatAnnulable()` (objet JSON, sans ce
 * qu'on ne veut pas annuler : cahier, zoom) et `restaurer(o)`, la coque empile l'état à chaque fois qu'il se pose (600 ms
 * sans geste, le même délai que la sauvegarde) : un glisser ou un tour de molette s'annulent d'un coup. `K.oublierAnnulations()`
 * vide la pile (changement de matériel). Sans ces deux fonctions, Ctrl+Z ne fait rien.
 * Elle porte aussi la rangée des étapes (`etapes`), le cahier de mesures (`cahier`, export CSV), les panneaux flottants
 * au-dessus du dessin (`panneau` : cahier, mode prof) et l'affichage des indices (`montrerAide`) ; l'instrument
 * décide de ce qui est atteint et de ce qu'on dit. `K.prof` : mode réservé à l'auteur.
 * Composants d'interface des trois instruments (sortis du banc) :
 * bandeau du haut à trois lignes (`bandeau`, créé à la demande : grille `.pl-a-haut`), aides en bascules, ligne des
 * gestes (`gestes` : l'instrument fournit ses textes) et panneau « ? » (`panneauGestes`), sélecteur segmenté, curseur,
 * menus déroulants et clic droit (`deroulant`, `ouvrirCtx`, Échap par `surEchap`), étagère (`etagere`, dans le flux
 * ou flottante et escamotable), pastilles réglables (`pastilles` : molette et glisser vertical) et le module `Dessin`
 * (miniatures, profils, vues de dessus ; P.Dessin, sans la `figure` de chaque instrument).
 */
(function (root) {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var P = root.VITRINE_PAILLASSE = root.VITRINE_PAILLASSE || { instruments: {} };

  function svg(tag, at, par) {
    var x = document.createElementNS(NS, tag);
    if (at) for (var k in at) if (at[k] != null) x.setAttribute(k, at[k]);
    if (par) par.appendChild(x);
    return x;
  }
  function el(tag, cls, par, html) {
    var x = document.createElement(tag);
    if (cls) x.className = cls;
    if (html != null) x.innerHTML = html;
    if (par) par.appendChild(x);
    return x;
  }
  // Hasard à graine (mulberry32) : un dérèglement est reproductible à partir de son numéro.
  function hasard(graine) {
    var a = graine >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Mémoire du navigateur : try/catch partout, l'app fonctionne sans (navigation privée, stockage bloqué).
  function memoire(cle) {
    return {
      lire: function () { try { var t = root.localStorage.getItem(cle); return t ? JSON.parse(t) : null; } catch (e) { return null; } },
      ecrire: function (o) { try { root.localStorage.setItem(cle, JSON.stringify(o)); return true; } catch (e) { return false; } },
      effacer: function () { try { root.localStorage.removeItem(cle); } catch (e) {} }
    };
  }

  // ======================================================================================================
  // ================= dessin des éléments : profil, vue de dessus, miniature de face ======================
  // ======================================================================================================
  // Module `Dessin` des trois paillasses (sorti du banc).
  // Rendu en chaînes SVG, en pixels du dessin, à partir d'une FIGURE (genre de profil,
  // `med` de la miniature, et ce qu'il faut pour les dessiner) : c'est l'instrument qui la fait (`figure` du banc, qui
  // lit son catalogue, reste au banc). Optique parfaite : la monture reste, le verre devient le symbole du cours ;
  // réelle : la forme du verre, flèche exagérée pour se lire. Les dégradés `bc*` (DEFS) doivent être dans le document :
  // le banc les met dans les `defs` de son dessin ; un instrument qui n'en a pas appelle `K.defsDessin()`.
  var Dessin = (function () {
    var TIRAGE = [45, 120];            // tirage d'une lanterne (mm, depuis le filament) quand la figure ne dit pas `tirages`
    function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
    var DEFS =
      '<linearGradient id="bcRail" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#aab1b9"/><stop offset=".18" stop-color="#7c848d"/><stop offset=".6" stop-color="#525961"/><stop offset="1" stop-color="#2f343a"/></linearGradient>' +
      '<linearGradient id="bcRegle" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b2026"/><stop offset="1" stop-color="#0f1216"/></linearGradient>' +
      '<linearGradient id="bcTige" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4b525a"/><stop offset=".45" stop-color="#b9c0c8"/><stop offset="1" stop-color="#3d434a"/></linearGradient>' +
      '<linearGradient id="bcNoir" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#15181c"/><stop offset=".4" stop-color="#3a4049"/><stop offset="1" stop-color="#15181c"/></linearGradient>' +
      '<linearGradient id="bcCav" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a515a"/><stop offset=".5" stop-color="#2b3037"/><stop offset="1" stop-color="#1a1d22"/></linearGradient>' +
      '<linearGradient id="bcVerre" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#bfe2ff" stop-opacity=".75"/><stop offset=".5" stop-color="#7fb6e6" stop-opacity=".28"/><stop offset="1" stop-color="#bfe2ff" stop-opacity=".6"/></linearGradient>' +
      '<linearGradient id="bcBoite" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b424b"/><stop offset=".5" stop-color="#262b32"/><stop offset="1" stop-color="#15181c"/></linearGradient>' +
      '<linearGradient id="bcEcran" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f4f1e6"/><stop offset=".55" stop-color="#cfcabb"/><stop offset="1" stop-color="#7d796f"/></linearGradient>' +
      '<linearGradient id="bcMiroir" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#eef4f8"/><stop offset=".45" stop-color="#8c9aa6"/><stop offset=".55" stop-color="#dfe7ec"/><stop offset="1" stop-color="#68747e"/></linearGradient>' +
      '<radialGradient id="bcVerreM" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#e6f4ff" stop-opacity=".9"/><stop offset=".5" stop-color="#8fc0ea" stop-opacity=".45"/><stop offset="1" stop-color="#4f86b8" stop-opacity=".55"/></radialGradient>' +
      '<radialGradient id="bcLueur"><stop offset="0" stop-color="#fffbe8"/><stop offset=".25" stop-color="#ffd98a"/><stop offset="1" stop-color="#ffb347" stop-opacity="0"/></radialGradient>' +
      '<radialGradient id="bcNa"><stop offset="0" stop-color="#fff6c2"/><stop offset=".3" stop-color="#ffc21f"/><stop offset="1" stop-color="#ff9d00" stop-opacity="0"/></radialGradient>' +
      '<radialGradient id="bcHg"><stop offset="0" stop-color="#ffffff"/><stop offset=".3" stop-color="#9fe6ff"/><stop offset="1" stop-color="#4aa8ff" stop-opacity="0"/></radialGradient>' +
      '<linearGradient id="bcArc" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7a2cff"/><stop offset=".25" stop-color="#2c7bff"/><stop offset=".5" stop-color="#27d34a"/><stop offset=".72" stop-color="#ffe02b"/><stop offset="1" stop-color="#ff2b2b"/></linearGradient>' +
      '<clipPath id="bcCM"><circle cx="20" cy="20" r="17.2"/></clipPath>' +
      '<linearGradient id="bcRailD" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a3038"/><stop offset=".5" stop-color="#3a424d"/><stop offset="1" stop-color="#1c2027"/></linearGradient>' +
      '<pattern id="bcMolette" width="2.4" height="10" patternUnits="userSpaceOnUse"><rect width="2.4" height="10" fill="#2a3038"/><rect width="1.1" height="10" fill="#566070"/></pattern>' +
      // lampes du Michelson et du goniomètre : mercure filtré, cadmium, inconnue
      '<radialGradient id="bcHgV"><stop offset="0" stop-color="#f4ffe8"/><stop offset=".3" stop-color="#8cff6a"/><stop offset="1" stop-color="#3fbf2a" stop-opacity="0"/></radialGradient>' +
      '<radialGradient id="bcCd"><stop offset="0" stop-color="#fff"/><stop offset=".3" stop-color="#f2a6d6"/><stop offset="1" stop-color="#c04aa0" stop-opacity="0"/></radialGradient>' +
      '<radialGradient id="bcX"><stop offset="0" stop-color="#fff4ea"/><stop offset=".3" stop-color="#ffb38a"/><stop offset="1" stop-color="#ff7a3a" stop-opacity="0"/></radialGradient>';
    function n(v) { return (Math.round(v * 10) / 10).toString(); }
    function lignes(k, f) { var s = ""; for (var i = 0; i < k; i++) s += f(i); return s; }

    function focale(f) { return f.mo ? '<text x="20" y="' + (f.mo.length > 3 ? 23.6 : 24.4) + '" text-anchor="middle" font-size="' + (f.mo.length > 3 ? 10.5 : 12.5) + '" font-weight="700" fill="#08121c">' + f.mo + "</text>" : ""; }
    // Miniature de face, boîte 40 × 40 (la même sur la carte de l'étagère, au-dessus de la pièce et dans le bandeau).
    function miniature(f) {
      var d = '<circle cx="20" cy="20" r="18" ', bord = 'stroke="#4d5560" stroke-width="1.6"/>';
      var noir = d + 'fill="#101317" ' + bord, verre = d + 'fill="url(#bcVerreM)" stroke="#7d9bb6" stroke-width="1.6"/>';
      var L = "#ffe9b0", g = '<g clip-path="url(#bcCM)">', r, s, k, a;
      switch (f.med) {
        case "lanterne": return noir + '<circle cx="20" cy="20" r="15" fill="url(#bcLueur)"/>';
        case "sodium": return noir + '<circle cx="20" cy="20" r="15" fill="url(#bcNa)"/>';
        case "mercure": return noir + '<circle cx="20" cy="20" r="15" fill="url(#bcHg)"/>';
        // Michelson et goniomètre : mercure filtré (raie verte), cadmium, lampe inconnue,
        // lampe éteinte (f.inconnue : « ? » gris), feuille, lamelle, prisme, diaphragme (f.l : largeur en mm), lentille courte
        case "hgv": return noir + '<circle cx="20" cy="20" r="15" fill="url(#bcHgV)"/>';
        case "cadmium": return noir + '<circle cx="20" cy="20" r="15" fill="url(#bcCd)"/>';
        case "inconnue": return noir + '<circle cx="20" cy="20" r="15" fill="url(#bcX)"/><text x="20" y="25" text-anchor="middle" font-size="15" font-weight="700" fill="#2a1408">?</text>';
        case "eteinte": return noir + '<circle cx="20" cy="20" r="9" fill="#2a3038"/>' + (f.inconnue ? '<text x="20" y="25" text-anchor="middle" font-size="14" font-weight="700" fill="#566070">?</text>' : "");
        case "feuille": return '<path d="M9 5h17l6 6v24H9z" fill="#f2efe6" stroke="#8b877b" stroke-width="1.2"/><path d="M26 5v6h6" fill="none" stroke="#8b877b" stroke-width="1.2"/><path d="M13 17h14M13 21h14M13 25h10" stroke="#c9c4b4" stroke-width="1"/>';
        case "lamelle": return '<rect x="8" y="8" width="24" height="24" rx="1" fill="url(#bcVerreM)" stroke="#9fd3e8" stroke-width="1"/><path d="M11 12l7-3" stroke="#fff" stroke-width="1.6" opacity=".8"/>';
        case "prisme": return '<path d="M20 5 35 32H5z" fill="url(#bcVerreM)" stroke="#9fd3e8" stroke-width="1.4"/><path d="M14 22l6-10" stroke="#fff" stroke-width="1.6" opacity=".7"/>';
        case "diaph": return noir + '<rect x="' + n(20 - (f.l || 2) * 2.2) + '" y="7" width="' + n((f.l || 2) * 4.4) + '" height="26" fill="' + L + '" opacity=".85"/>';
        case "lc": return verre + '<text x="20" y="24.6" text-anchor="middle" font-size="11" font-weight="700" fill="#08121c">LC</text>';
        case "laser": return noir + '<path d="M4 20h32" stroke="' + (f.vert ? "#34d058" : "#ff3b30") + '" stroke-width="2.2" opacity=".85"/><circle cx="20" cy="20" r="4.5" fill="' + (f.vert ? "#5be37a" : "#ff5a4d") + '"/><circle cx="20" cy="20" r="1.8" fill="#fff"/>';
        case "F": return noir + '<path d="M14.5 9.5h12v4.2h-7.6v4.4h6v4.2h-6v8.2h-4.4z" fill="' + L + '"/>';
        case "quadrillage": return verre + g + lignes(7, function (i) { var q = 5 + 5 * i; return '<path d="M' + q + ' 0v40M0 ' + q + 'h40" stroke="#0c1016" stroke-width=".9"/>'; }) + "</g>";
        case "regle": return verre + g + '<path d="M0 20h40" stroke="#0c1016" stroke-width=".9"/>' + lignes(13, function (i) { var q = 2 + 3 * i; return '<path d="M' + q + ' 20v' + (i % 5 === 1 ? -8 : -4.5) + '" stroke="#0c1016" stroke-width=".9"/>'; }) + "</g>";
        case "depoli": return d + 'fill="#b9bfc5" fill-opacity=".8" stroke="#7d8791" stroke-width="1.6"/>' + g + lignes(46, function (i) { return '<circle cx="' + (3 + (i * 17) % 35) + '" cy="' + (3 + (i * 29) % 35) + '" r=".8" fill="#fff" opacity=".7"/>'; }) + "</g>";
        case "trou": return noir + '<circle cx="20" cy="20" r="' + n(clamp(1.2 + (f.objet || 0.25) * 3, 1.3, 4.2)) + '" fill="' + L + '"/>';
        case "iris":
          r = f.d ? 3 + f.d / 40 * 11 : 8; s = "";
          for (k = 0; k < 6; k++) { a = k * Math.PI / 3; s += (k ? "L" : "M") + (20 + r * Math.cos(a)).toFixed(1) + " " + (20 + r * Math.sin(a)).toFixed(1); }
          return d + 'fill="#2a2f37" ' + bord + '<path d="' + s + 'z" fill="' + L + '" fill-opacity=".85"/>' +
            lignes(6, function (j) { var b = j * Math.PI / 3; return '<path d="M' + (20 + r * Math.cos(b)).toFixed(1) + " " + (20 + r * Math.sin(b)).toFixed(1) + "L" + (20 + 17 * Math.cos(b + 0.9)).toFixed(1) + " " + (20 + 17 * Math.sin(b + 0.9)).toFixed(1) + '" stroke="#11141a" stroke-width="1"/>'; });
        case "conv": return verre + '<path d="M9 14a13 13 0 0 1 10-7" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" opacity=".8"/>' + focale(f);
        case "div": return verre + '<circle cx="20" cy="20" r="11" fill="none" stroke="#dff1ff" stroke-width="1.1" opacity=".7"/><circle cx="20" cy="20" r="5" fill="none" stroke="#dff1ff" stroke-width=".8" opacity=".5"/>' + focale(f);
        case "miroir": return d + 'fill="url(#bcMiroir)" stroke="#4d5560" stroke-width="1.6"/>';
        case "ecran": return '<rect x="4" y="4" width="32" height="32" rx="2.5" fill="#efece1" stroke="#8b877b" stroke-width="1.4"/>';
        case "capteur": return '<rect x="3" y="7" width="34" height="26" rx="3" fill="#1b1f25" stroke="#4d5560" stroke-width="1.4"/><rect x="10" y="12.5" width="20" height="15" fill="#274a3c" stroke="#63c59a" stroke-width=".8"/>' +
          lignes(3, function (i) { return '<path d="M' + (15 + 5 * i) + ' 12.5v15M10 ' + (16.2 + 3.8 * i) + 'h20" stroke="#63c59a" stroke-width=".4" opacity=".7"/>'; });
        case "photodiode": return noir + '<rect x="15.5" y="15.5" width="9" height="9" rx="1" fill="#274a3c" stroke="#63c59a" stroke-width="1"/>';
        case "spectro": return '<rect x="3" y="11" width="34" height="18" rx="3" fill="#1b1f25" stroke="#4d5560" stroke-width="1.4"/><rect x="7" y="17" width="26" height="6" rx="1" fill="url(#bcArc)"/>';
        case "oeil": return '<path d="M3 20Q20 5 37 20Q20 35 3 20z" fill="#eef1f3" stroke="#59626d" stroke-width="1.4"/><circle cx="20" cy="20" r="7.5" fill="#5f8fb0"/><circle cx="20" cy="20" r="3.4" fill="#0b0d10"/><circle cx="17.6" cy="17.6" r="1.3" fill="#fff"/>';
        case "viseur": return noir + '<circle cx="20" cy="20" r="11.5" fill="#20262e" stroke="#8791a0" stroke-width="1"/><path d="M20 9v22M9 20h22" stroke="#cfd6de" stroke-width=".8"/>';
        case "lunette": return noir + '<circle cx="20" cy="20" r="12.5" fill="#20262e" stroke="#8791a0" stroke-width="1"/><path d="M20 8v24M8 20h24" stroke="#cfd6de" stroke-width=".8"/>' + lignes(7, function (i) { return '<path d="M' + (11 + 3 * i) + ' 18.6v2.8" stroke="#cfd6de" stroke-width=".6"/>'; });
        case "fente": return noir + '<rect x="18.9" y="8" width="2.2" height="24" fill="' + L + '"' + tourne(f) + "/>";
        case "bifente": return noir + '<rect x="16.6" y="8" width="1.7" height="24" fill="' + L + '"/><rect x="21.7" y="8" width="1.7" height="24" fill="' + L + '"/>';
        case "multi": return noir + lignes(5, function (i) { return '<rect x="' + (12.4 + 3.4 * i) + '" y="8" width="1.4" height="24" fill="' + L + '"/>'; });
        case "young": return noir + '<circle cx="16.5" cy="20" r="1.7" fill="' + L + '"/><circle cx="23.5" cy="20" r="1.7" fill="' + L + '"/>';
        case "reseau": return verre + g + lignes(17, function (i) { return '<path d="M' + (4 + 2 * i) + ' 0v40" stroke="#0c1016" stroke-width=".7"/>'; }) + "</g>";
        case "grille":      // pas dessiné proportionnel au vrai (0,25 mm : 3 px)
          k = f.pas ? f.pas * 12 : 3;
          return verre + g + lignes(Math.ceil(40 / k), function (i) { var q = n(1 + k * i); return '<path d="M' + q + ' 0v40M0 ' + q + 'h40" stroke="#0c1016" stroke-width=".6"/>'; }) + "</g>";
        case "fil": return verre + '<path d="M20 3v34" stroke="#0c1016" stroke-width="1.3"' + tourne(f) + "/>";
        case "couteau":     // la lame couvre le côté x < xc (cœur : DEMIPLAN), son bord décalé de xc (×8 pour se voir)
          return verre + g + '<g' + tourne(f) + '><rect x="0" y="0" width="' + n(clamp(20 + 8 * (f.xc || 0), 2, 38)) + '" height="40" fill="#101317"/></g></g>';
        case "filtre": return d + 'fill="' + f.teinte + '" fill-opacity=".8" stroke="#4d5560" stroke-width="1.6"/><path d="M9 14a13 13 0 0 1 10-7" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" opacity=".55"/>';
        // polariseur : son axe en double flèche ; lame : ses deux lignes neutres en tirets ; graduation de la monture
        case "pola": return d + 'fill="#3c3a46" fill-opacity=".9" ' + bord + grad() + "<g" + tourne(f) + '><path d="M20 7v26M16.5 11 20 7l3.5 4M16.5 29 20 33l3.5-4" stroke="#e8e2ff" stroke-width="1.6" fill="none"/></g>';
        case "lame": return d + 'fill="#36506a" fill-opacity=".85" ' + bord + grad() + "<g" + tourne(f) + '><path d="M20 6v28M6 20h28" stroke="#cfe4ff" stroke-width="1" stroke-dasharray="2.5 2"/><path d="M20 6v28" stroke="#cfe4ff" stroke-width="1.6"/></g>' +
          '<text x="20" y="' + (f.mo.length > 3 ? 23.6 : 24.4) + '" text-anchor="middle" font-size="9.5" font-weight="700" fill="#eaf4ff" paint-order="stroke" stroke="#36506a" stroke-width="2.5">' + f.mo + "</text>";
        case "phase": return verre + (f.forme === "lettre" ? '<path d="M15 10h10.5v3.6h-6.4v3.8h5.2v3.6h-5.2v7.4h-4.1z"' : '<path d="M20 9q8 10 8 15a8 8 0 0 1-16 0q0-5 8-15z"') +
          ' fill="none" stroke="#fff" stroke-width="1" stroke-dasharray="2 2" opacity=".75"/>';
        case "pastille": return verre + '<circle cx="20" cy="20" r="' + n(f.d ? 1.5 + 3 * f.d : 3) + '" fill="#0c1016"/>';
        case "diapo":       // cadre de diapositive ; l'image une fois les diapos chargées (VIGNETTES), sinon un verre
          r = VIGNETTES[f.image];
          return '<rect x="3" y="3" width="34" height="34" rx="2" fill="' + (f.eclairee ? "#d9d6cc" : "#e8e3d4") + '" stroke="#8b877b" stroke-width="1.2"/>' +
            (r ? '<image href="' + r + '" x="8" y="8" width="24" height="24" preserveAspectRatio="none"/>' : '<rect x="8" y="8" width="24" height="24" fill="url(#bcVerreM)"/>') +
            '<rect x="8" y="8" width="24" height="24" fill="none" stroke="#5d5a52" stroke-width=".8"/>';
      }
      return noir;
    }
    function grad() { return lignes(12, function (i) { var a = i * Math.PI / 6, c = Math.cos(a), s = Math.sin(a), r0 = i % 3 ? 16.2 : 14.8; return '<path d="M' + n(20 + r0 * c) + " " + n(20 + r0 * s) + "L" + n(20 + 18 * c) + " " + n(20 + 18 * s) + '" stroke="#9aa3ae" stroke-width=".7"/>'; }); }
    function tourne(f) { return f.rot ? ' transform="rotate(' + n(-f.rot * 180 / Math.PI) + ' 20 20)"' : ""; }
    function svgMini(f, cls) { return '<svg viewBox="0 0 40 40" aria-hidden="true"' + (cls ? ' class="' + cls + '"' : "") + ">" + miniature(f) + "</svg>"; }
    // Demi-hauteur dessinée (mm).
    function demiHaut(f) {
      return { lentille: (f.diam || 40) / 2 + 7, plaque: 30, iris: 30, ecran: 100, capteur: 26, oeil: 15, viseur: 15, lanterne: 46, lampe: 42, laser: 20, miroir: 30 }[f.genre] || 30;
    }
    // La pièce de profil, centrée sur son axe (abscisse x, ordonnée y0 de l'axe, sy pixels par mm), sans cavalier.
    // Zone de l'écran montrée par l'observation (f.fen, cf. figureVue) : un trait le long de la face et
    // deux marques à ses bords.
    function zoneAffichee(f, x, y0, sy) {
      if (!f.fen) return "";
      var ya = y0 - f.fen[1] * sy, yb = y0 - f.fen[0] * sy, m = "#f0c75a";
      return '<path d="M' + n(x - 2.5) + " " + n(ya) + "V" + n(yb) + '" stroke="' + m + '" stroke-width="1.2" opacity=".75"/>' +
             '<path d="M' + n(x - 6) + " " + n(ya) + "h9M" + n(x - 6) + " " + n(yb) + 'h9" stroke="' + m + '" stroke-width="1.4"/>';
    }
    function corps(f, x, y0, sy, parfaite) {
      var s = "", H, R, b, t, w, i;
      function cadre(h, l) { return '<rect x="' + n(x - l / 2) + '" y="' + n(y0 - h) + '" width="' + l + '" height="' + n(2 * h) + '" rx="1.2" fill="url(#bcNoir)" stroke="#5b6471" stroke-width=".7"/>'; }
      switch (f.genre) {
        case "lentille":
          R = f.diam / 2 * sy;
          s += '<rect x="' + n(x - 4.5) + '" y="' + n(y0 - R - 8) + '" width="9" height="9" rx="1.5" fill="url(#bcNoir)" stroke="#5b6471" stroke-width=".7"/>' +
               '<rect x="' + n(x - 4.5) + '" y="' + n(y0 + R - 1) + '" width="9" height="9" rx="1.5" fill="url(#bcNoir)" stroke="#5b6471" stroke-width=".7"/>';
          if (f.forme === "objectif") {
            // barillet d'objectif : lentille frontale (petite, vers l'objet) à gauche, filetage vers le tube, bague verte du ×20
            var Rb = Math.max(R + 5, 9);
            s += '<path d="M' + n(x - 3) + " " + n(y0 - R - 1) + "L" + n(x + 4) + " " + n(y0 - Rb) + "H" + n(x + 20) + "V" + n(y0 + Rb) + "H" + n(x + 4) + "L" + n(x - 3) + " " + n(y0 + R + 1) +
                 'z" fill="url(#bcNoir)" stroke="#8a94a3" stroke-width=".8"/>' +
                 '<rect x="' + n(x + 9) + '" y="' + n(y0 - Rb) + '" width="2.5" height="' + n(2 * Rb) + '" fill="#3fae5a"/>' +
                 '<rect x="' + n(x + 17) + '" y="' + n(y0 - Rb - 1.5) + '" width="4" height="' + n(2 * Rb + 3) + '" fill="#9aa3ae"/>' +
                 '<path d="M' + n(x - 2.5) + " " + n(y0 - R) + "V" + n(y0 + R) + '" stroke="#a9d4ff" stroke-width="2.2"/>';
          } else if (parfaite) {
            var e = f.f > 0 ? 1 : 0, o = 1 - e;
            s += '<path d="M' + n(x) + " " + n(y0 - R) + "V" + n(y0 + R) + '" stroke="#a9d4ff" stroke-width="2.2"/>' +
                 '<path d="M' + n(x - 5.5) + " " + n(y0 - R + 7.5 * e) + "L" + n(x) + " " + n(y0 - R + 7.5 * o) + "L" + n(x + 5.5) + " " + n(y0 - R + 7.5 * e) +
                 "M" + n(x - 5.5) + " " + n(y0 + R - 7.5 * e) + "L" + n(x) + " " + n(y0 + R - 7.5 * o) + "L" + n(x + 5.5) + " " + n(y0 + R - 7.5 * e) +
                 '" stroke="#a9d4ff" stroke-width="2.2" fill="none" stroke-linejoin="round" stroke-linecap="round"/>';
          } else {
            b = clamp(f.diam * f.diam / (8.3 * Math.abs(f.f)) * 1.5, 3.2, 17);
            // plan-convexe du cœur : face bombée vers la lumière (−z), plane vers +z ; retournée : l'inverse
            var plan = f.forme === "pcv" && f.f > 0, g = f.retournee ? 1 : -1;
            if (f.f > 0 && !plan) t = "M" + n(x) + " " + n(y0 - R) + "Q" + n(x + 2 * b) + " " + n(y0) + " " + n(x) + " " + n(y0 + R) + "Q" + n(x - 2 * b) + " " + n(y0) + " " + n(x) + " " + n(y0 - R) + "z";
            else if (plan) t = "M" + n(x - g * b) + " " + n(y0 - R) + "V" + n(y0 + R) + "Q" + n(x + g * 3 * b) + " " + n(y0) + " " + n(x - g * b) + " " + n(y0 - R) + "z";
            else t = "M" + n(x - b - 2) + " " + n(y0 - R) + "H" + n(x + b + 2) + "Q" + n(x - b + 3) + " " + n(y0) + " " + n(x + b + 2) + " " + n(y0 + R) + "H" + n(x - b - 2) + "Q" + n(x + b - 3) + " " + n(y0) + " " + n(x - b - 2) + " " + n(y0 - R) + "z";
            s += '<path d="' + t + '" fill="url(#bcVerre)" stroke="#bfe2ff" stroke-width="1"/>';
          }
          // lentille inclinée (niveau 3, vue de profil) : le dessin tourne autour du centre optique
          return f.incl ? '<g transform="rotate(' + n(f.incl) + " " + n(x) + " " + n(y0) + ')">' + s + "</g>" : s;
        case "iris":
          H = 30 * sy; R = Math.max(0.8, (f.d || 20) / 2 * sy);
          return '<rect class="bc-iris" x="' + n(x - 2.5) + '" y="' + n(y0 - H) + '" width="5" height="' + n(H - R) + '" rx="1" fill="url(#bcNoir)" stroke="#5b6471" stroke-width=".7"/>' +
                 '<rect class="bc-iris" x="' + n(x - 2.5) + '" y="' + n(y0 + R) + '" width="5" height="' + n(H - R) + '" rx="1" fill="url(#bcNoir)" stroke="#5b6471" stroke-width=".7"/>';
        case "plaque":
          H = 30 * sy; s = cadre(H, 5);
          if (f.clair || f.teinte) s += '<rect x="' + n(x - 1.4) + '" y="' + n(y0 - 22 * sy) + '" width="2.8" height="' + n(44 * sy) + '" fill="' + (f.teinte || (f.clair === 2 ? "#dfe4e8" : "#a9d4ff")) + '" opacity="' + (f.teinte ? 0.95 : f.clair === 2 ? 0.8 : 0.55) + '"/>';
          else if (f.objet) s += '<rect x="' + n(x - 1.4) + '" y="' + n(y0 - Math.max(1.2, f.objet * sy)) + '" width="2.8" height="' + n(2 * Math.max(1.2, f.objet * sy)) + '" fill="#ffe9b0"/>';
          else s += '<rect x="' + n(x - 1.4) + '" y="' + n(y0 - 1.2) + '" width="2.8" height="2.4" fill="#ffe9b0"/>';
          return s;
        case "miroir":
          H = 28 * sy;
          return '<rect x="' + n(x) + '" y="' + n(y0 - H) + '" width="6" height="' + n(2 * H) + '" rx="1" fill="url(#bcNoir)" stroke="#5b6471" stroke-width=".7"/>' +
                 '<rect x="' + n(x - 1.8) + '" y="' + n(y0 - H + 2) + '" width="2.6" height="' + n(2 * H - 4) + '" fill="#e8f1f7"/>';
        case "ecran":
          H = 100 * sy;
          return '<rect x="' + n(x) + '" y="' + n(y0 - H) + '" width="6" height="' + n(2 * H) + '" rx="1" fill="url(#bcEcran)" stroke="#8b877b" stroke-width=".6"/>' + zoneAffichee(f, x, y0, sy);
        case "capteur":
          H = 26 * sy;
          b = Math.max((f.demi || 2.4) * sy, 1.5);      // surface sensible à sa vraie taille (au moins 3 px)
          return '<rect x="' + n(x) + '" y="' + n(y0 - H) + '" width="30" height="' + n(2 * H) + '" rx="4" fill="url(#bcBoite)" stroke="#59626d" stroke-width=".8"/>' +
                 '<rect x="' + n(x - 1) + '" y="' + n(y0 - b) + '" width="2.6" height="' + n(2 * b) + '" fill="#63c59a"/>' +
                 '<rect x="' + n(x + 8) + '" y="' + n(y0 - H - 5) + '" width="10" height="6" rx="1.5" fill="#2b3037"/>';
        case "oeil":
          R = 12 * sy;
          return '<ellipse cx="' + n(x + 17) + '" cy="' + n(y0) + '" rx="15" ry="' + n(R) + '" fill="#eef1f3" stroke="#59626d" stroke-width=".8"/>' +
                 '<path d="M' + n(x + 5) + " " + n(y0 - R * 0.55) + "Q" + n(x - 3.5) + " " + n(y0) + " " + n(x + 5) + " " + n(y0 + R * 0.55) + '" fill="#bfe2ff" fill-opacity=".5" stroke="#bfe2ff" stroke-width="1"/>' +
                 '<path d="M' + n(x + 5.5) + " " + n(y0 - R * 0.5) + "V" + n(y0 - R * 0.17) + "M" + n(x + 5.5) + " " + n(y0 + R * 0.17) + "V" + n(y0 + R * 0.5) + '" stroke="#5f8fb0" stroke-width="2.6"/>';
        case "viseur":
          H = 10 * sy; w = f.long ? 86 : 56;
          return '<rect x="' + n(x) + '" y="' + n(y0 - H) + '" width="' + w + '" height="' + n(2 * H) + '" rx="3" fill="url(#bcBoite)" stroke="#59626d" stroke-width=".8"/>' +
                 '<rect x="' + n(x + w - 3) + '" y="' + n(y0 - H * 0.7) + '" width="13" height="' + n(1.4 * H) + '" rx="2" fill="url(#bcBoite)" stroke="#59626d" stroke-width=".8"/>' +
                 '<path d="M' + n(x) + " " + n(y0 - H + 2) + "Q" + n(x - 4) + " " + n(y0) + " " + n(x) + " " + n(y0 + H - 2) + '" fill="#bfe2ff" fill-opacity=".5" stroke="#bfe2ff" stroke-width="1"/>' +
                 '<rect x="' + n(x + w * 0.35) + '" y="' + n(y0 - H - 3) + '" width="8" height="' + n(2 * H + 6) + '" rx="1.5" fill="#3a4049"/>';
        case "lanterne": case "lampe":
          H = (f.genre === "lanterne" ? 46 : 42) * sy; w = 50;
          var gl = f.genre === "lanterne" ? "bcLueur" : f.med === "sodium" ? "bcNa" : "bcHg";
          s += '<rect x="' + n(x - w + 8) + '" y="' + n(y0 - H) + '" width="' + (w - 8) + '" height="' + n(2 * H) + '" rx="7" fill="url(#bcBoite)" stroke="#59626d" stroke-width=".8"/>';
          for (i = 0; i < 5; i++) s += '<path d="M' + n(x - w + 15) + " " + n(y0 - H + 9 + i * 5) + "h" + (w - 24) + '" stroke="#0c0e11" stroke-width="1.6" stroke-linecap="round"/>';
          // tube du condenseur : plus long quand le tirage augmente
          s += '<rect x="' + n(x - 1) + '" y="' + n(y0 - 20 * sy) + '" width="' + n(f.genre === "lanterne" ? (f.cond === "rien" ? 5 : 16 + clamp(((f.tirage || 70) - (f.tirages || TIRAGE)[0]) / ((f.tirages || TIRAGE)[1] - (f.tirages || TIRAGE)[0]), 0, 1) * 12) : 5) + '" height="' + n(40 * sy) + '" rx="2" fill="url(#bcNoir)" stroke="#59626d" stroke-width=".7"/>';
          s += '<circle cx="' + n(x - w / 2 + 4) + '" cy="' + n(y0) + '" r="' + n(Math.min(19, H * 0.42)) + '" fill="url(#' + gl + ')"/>';
          if (f.genre === "lanterne" && f.cond === "depoli") s += '<rect x="' + n(x + 14) + '" y="' + n(y0 - 20 * sy) + '" width="3" height="' + n(40 * sy) + '" fill="#e9ecef" fill-opacity=".75" stroke="#9aa3ad" stroke-width=".6"/>';
          return s;
        case "laser":
          H = 14 * sy;
          return '<rect x="' + n(x - 78) + '" y="' + n(y0 - H) + '" width="78" height="' + n(2 * H) + '" rx="4" fill="url(#bcBoite)" stroke="#59626d" stroke-width=".8"/>' +
                 '<rect x="' + n(x - 2) + '" y="' + n(y0 - 3) + '" width="5" height="6" fill="#15181c"/><circle cx="' + n(x - 66) + '" cy="' + n(y0 - H + 6) + '" r="2" fill="' + (f.vert ? "#5be37a" : "#ff5a4d") + '"/>';
      }
      return "";
    }
    // Abscisse de la tige et du cavalier (les boîtes, lampes, viseurs sont tenus à côté de leur plan optique).
    function decalTige(f) {
      return { viseur: f.long ? 43 : 28, capteur: 15, oeil: 17, lanterne: -21, lampe: -21, laser: -39, ecran: 3, miroir: 3 }[f.genre] || 0;
    }
    // Pièce complète sur le rail : zone de saisie, tige, corps, cavalier (vis de serrage, index), miniature au-dessus.
    // G = { sy, railY, parfaite } ; o = { id, sel, titre, regl (nom du réglage à la molette sur la miniature) }.
    function piece(f, x, y0, G, o) {
      var dh = demiHaut(f), bas = y0 + Math.min(dh, f.genre === "lentille" ? f.diam / 2 + 7 : 99) * G.sy, haut = y0 - dh * G.sy, s = "", ry = G.railY;
      if (f.genre === "viseur" || f.genre === "capteur" || f.genre === "oeil") bas = y0 + dh * G.sy * (f.genre === "oeil" ? 0.8 : 0.4);
      var xt = x + decalTige(f), xa = Math.min(x, xt), lg = Math.abs(xt - x);
      if (f.genre === "lanterne" || f.genre === "lampe") { xa = x - 50; lg = 50; }
      s += '<g class="bc-el' + (o.sel ? " sel" : "") + (o.cls ? " " + o.cls : "") + '" data-id="' + o.id + '">' + (o.titre ? "<title>" + o.titre + "</title>" : "");
      s += '<rect x="' + n(xa - 15) + '" y="' + n(haut - 34) + '" width="' + n(lg + 30) + '" height="' + n(ry + 14 - haut + 34) + '" fill="transparent"/>';
      if (o.sel) s += '<rect x="' + n(Math.min(x, xt) - 13) + '" y="' + n(ry - 13) + '" width="' + n(Math.abs(xt - x) + 26) + '" height="28" rx="6" fill="#e0b84c" opacity=".22"/>';
      s += '<rect x="' + n(xt - 2) + '" y="' + n(bas) + '" width="4" height="' + n(Math.max(0, ry - 10 - bas)) + '" fill="url(#bcTige)"/>';
      s += corps(f, x, y0, G.sy, G.parfaite);
      s += '<rect x="' + n(Math.min(x, xt) - 11) + '" y="' + n(ry - 11) + '" width="' + n(Math.abs(xt - x) + 22) + '" height="20" rx="3" fill="url(#bcCav)" stroke="' + (o.sel ? "#e0b84c" : "#636c78") + '" stroke-width="' + (o.sel ? 1.4 : 0.7) + '"/>';
      s += '<circle cx="' + n(xt) + '" cy="' + n(ry - 1) + '" r="3.6" fill="#15181c" stroke="#8791a0" stroke-width=".8"/><path d="M' + n(xt - 2.2) + " " + n(ry - 1) + 'h4.4" stroke="#8791a0" stroke-width=".9"/>';
      s += '<path d="M' + n(x - 4) + " " + n(ry + 9) + 'h8l-4 6z" fill="#e0b84c"/>';
      s += '<g class="bc-mini' + (o.regl ? " regl" : "") + '" transform="translate(' + n(x - 13) + " " + n(haut - 33) + ') scale(.65)">' + miniature(f) + "</g>";
      return s + "</g>";
    }
    // Rail profilé et règle graduée au cm (chiffres tous les 10 ou 20 cm selon la place).
    function rail(X, yAxe, ry, sx, long) {
      var x0 = X(0) - 16, x1 = X(long) + 16, s = "", z;
      s += '<path d="M' + n(X(0) - 30) + " " + n(yAxe) + "H" + n(X(long) + 30) + '" stroke="#39424d" stroke-width="1" stroke-dasharray="7 6"/>';
      s += '<rect x="' + n(x0 + 24) + '" y="' + (ry + 12) + '" width="22" height="9" rx="2" fill="#191c21"/><rect x="' + n(x1 - 46) + '" y="' + (ry + 12) + '" width="22" height="9" rx="2" fill="#191c21"/>';
      s += '<rect x="' + n(x0) + '" y="' + ry + '" width="' + n(x1 - x0) + '" height="13" rx="2.5" fill="url(#bcRail)"/>';
      s += '<rect x="' + n(x0) + '" y="' + (ry + 13) + '" width="' + n(x1 - x0) + '" height="17" rx="1.5" fill="url(#bcRegle)" stroke="#262c34" stroke-width=".8"/>';
      var pas = sx * 10 >= 3.4 ? 10 : 50, d = "", dg = "";
      for (z = 0; z <= long; z += pas) {
        if (z % 100 === 0) dg += "M" + n(X(z)) + " " + (ry + 13) + "v9"; else d += "M" + n(X(z)) + " " + (ry + 13) + "v" + (z % 50 === 0 ? 6.5 : 3.5);
      }
      s += '<path d="' + d + '" stroke="#7f8996" stroke-width=".7"/><path d="' + dg + '" stroke="#cfd6de" stroke-width="1"/>';
      for (z = 0; z <= long; z += (sx * 100 >= 36 ? 100 : 200))
        s += '<text x="' + n(X(z)) + '" y="' + (ry + 42) + '" class="bc-grad" text-anchor="middle">' + z / 10 + (z === long ? " cm" : "") + "</text>";
      return s;
    }
    // ----- vue de dessus -----
    // Rail profilé sous l'axe (bande), règle sur son bord avant, graduations au mm quand on est assez près.
    function railDessus(X, Z, y0, sx, long, W) {
      var x0 = X(0) - 16, x1 = X(long) + 16, s = "", z;
      s += '<rect x="' + n(x0) + '" y="' + n(y0 - 9) + '" width="' + n(x1 - x0) + '" height="18" rx="2" fill="url(#bcRailD)" opacity=".8"/>';
      s += '<path d="M' + n(x0) + " " + n(y0 - 3) + "H" + n(x1) + "M" + n(x0) + " " + n(y0 + 3) + "H" + n(x1) + '" stroke="#14171c" stroke-width="1.2"/>';
      s += '<rect x="' + n(x0) + '" y="' + n(y0 + 9) + '" width="' + n(x1 - x0) + '" height="11" fill="url(#bcRegle)" stroke="#262c34" stroke-width=".8"/>';
      var pas = sx * 10 >= 3.4 ? 10 : 50, d = "", dg = "", z0 = Math.max(0, Math.floor(Z(-20) / pas) * pas), z1 = Math.min(long, Z(W + 20));
      for (z = z0; z <= z1; z += pas) { if (z % 100 === 0) dg += "M" + n(X(z)) + " " + n(y0 + 9) + "v7"; else d += "M" + n(X(z)) + " " + n(y0 + 9) + "v" + (z % 50 === 0 ? 5 : 3); }
      if (sx >= 3) { d = ""; for (z = Math.ceil(z0); z <= z1; z += 1) if (z % 10) d += "M" + n(X(z)) + " " + n(y0 + 9) + "v" + (z % 5 === 0 ? 4 : 2.4); }
      s += '<path d="' + d + '" stroke="#7f8996" stroke-width=".6"/><path d="' + dg + '" stroke="#cfd6de" stroke-width="1"/>';
      var pl = sx * 100 >= 36 ? 100 : 200;
      for (z = Math.ceil(z0 / pl) * pl; z <= z1; z += pl) s += '<text x="' + n(X(z)) + '" y="' + n(y0 + 31) + '" class="bc-grad" text-anchor="middle">' + z / 10 + (z === long ? " cm" : "") + "</text>";
      s += '<path d="M' + n(X(0) - 30) + " " + n(y0) + "H" + n(X(long) + 30) + '" stroke="#39424d" stroke-width="1" stroke-dasharray="7 6" opacity=".7"/>';
      return s;
    }
    // Lanterne (boîtier, tube du condenseur) et lampe spectrale (cheminée ronde) vues de dessus, lueur à la sortie.
    function lampeDessus(f, x, y) {
      var s = "";
      if (f.genre === "lanterne") {
        s += '<rect x="' + n(x - 58) + '" y="' + n(y - 24) + '" width="46" height="48" rx="5" fill="url(#bcNoir)" stroke="#5b6471" stroke-width=".8"/>';
        s += '<circle cx="' + n(x - 35) + '" cy="' + n(y) + '" r="13" fill="#15181c" stroke="#3a424d"/><path d="M' + n(x - 44) + " " + n(y) + "h18M" + n(x - 35) + " " + n(y - 9) + 'v18" stroke="#2a3038" stroke-width="2"/>';
        s += '<rect x="' + n(x - 12) + '" y="' + n(y - 15) + '" width="' + n(Math.max(12, (f.tirage || 70) * 0.3)) + '" height="30" rx="2" fill="url(#bcNoir)" stroke="#5b6471" stroke-width=".8"/>';
        s += '<circle cx="' + n(x - 35) + '" cy="' + n(y) + '" r="5" fill="#ffd27a" opacity=".85"/>';
      } else {
        s += '<circle cx="' + n(x - 30) + '" cy="' + n(y) + '" r="26" fill="url(#bcNoir)" stroke="#5b6471" stroke-width=".8"/><circle cx="' + n(x - 30) + '" cy="' + n(y) + '" r="17" fill="#15181c" stroke="#3a424d"/>';
        s += '<circle cx="' + n(x - 30) + '" cy="' + n(y) + '" r="7" fill="' + (f.med === "sodium" ? "#ffcf4a" : "#bfe9ff") + '" opacity=".8"/>';
        s += '<rect x="' + n(x - 6) + '" y="' + n(y - 8) + '" width="8" height="16" rx="1.5" fill="url(#bcNoir)" stroke="#5b6471" stroke-width=".8"/>';
      }
      return s;
    }
    // Pièce vue de dessus : cavalier en travers du rail, pas de tige (cachée sous la monture) ; pièce décalable (o.dec) :
    // platine de translation sous elle et vis moletée à l'avant du cavalier (classe bc-vis : molette dessus = décalage).
    // G = { sy, yAxe, yDecH, yDecB (bords de la platine), parfaite } ; o comme pour `piece`.
    function pieceDessus(f, x, y, G, o) {
      var dh = demiHaut(f), sy = G.sy, y0 = G.yAxe, lourd = f.genre === "lanterne" || f.genre === "lampe";
      var s = '<g class="bc-el' + (o.sel ? " sel" : "") + (o.cls ? " " + o.cls : "") + '" data-id="' + o.id + '">' + (o.titre ? "<title>" + o.titre + "</title>" : "");
      s += '<rect x="' + n(x - (lourd ? 70 : 18)) + '" y="' + n(Math.min(y0, y) - dh * sy - 34) + '" width="' + (lourd ? 90 : 36) + '" height="' + n(2 * dh * sy + 70 + Math.abs(y - y0)) + '" fill="transparent"/>';
      if (o.sel) s += '<rect x="' + n(x - 16) + '" y="' + n(y0 - 20) + '" width="32" height="40" rx="5" fill="#e0b84c" opacity=".16"/>';
      s += '<rect x="' + n(x - 13) + '" y="' + n(y0 - 17) + '" width="26" height="34" rx="3" fill="url(#bcCav)" stroke="' + (o.sel ? "#e0b84c" : "#636c78") + '" stroke-width="' + (o.sel ? 1.4 : 0.7) + '"/>';
      var haut = y - dh * sy;
      if (o.dec) {
        s += '<rect x="' + n(x - 5) + '" y="' + n(G.yDecH) + '" width="10" height="' + n(G.yDecB - G.yDecH) + '" rx="2" fill="#1e232a" stroke="#4a535f" stroke-width=".7"/>';
        s += '<path d="M' + n(x) + " " + n(G.yDecH + 2) + "V" + n(G.yDecB - 2) + '" stroke="#566070" stroke-width=".8" stroke-dasharray="1.5 2"/>';
        s += '<rect x="' + n(x - 7) + '" y="' + n(y - 4) + '" width="14" height="8" rx="1.5" fill="#8791a0"/>';
        var yb = Math.max(G.yDecB, y0 + 17) + 4;
        s += '<g class="bc-vis" data-id="' + o.id + '" data-axe="x">' +
          '<rect x="' + n(x - 1.5) + '" y="' + n(yb - 4) + '" width="3" height="6" fill="#8791a0"/>' +
          '<rect x="' + n(x - 8) + '" y="' + n(yb + 2) + '" width="16" height="11" rx="2.5" fill="url(#bcMolette)" stroke="' + (o.sel ? "#e0b84c" : "#8791a0") + '" stroke-width="1"/>' +
          '<rect x="' + n(x - 12) + '" y="' + n(yb - 2) + '" width="24" height="24" fill="transparent"/></g>';
        haut = Math.min(haut, G.yDecH - 4);
      }
      s += lourd ? lampeDessus(f, x, y) : corps(f, x, y, sy, G.parfaite);
      s += '<g class="bc-mini' + (o.regl ? " regl" : "") + '" transform="translate(' + n(x - 13) + " " + n(haut - 33) + ') scale(.65)">' + miniature(f) + "</g>";
      return s + "</g>";
    }
    // Vignettes des images (diapos du banc, en data URL) : posées par l'instrument quand ses images sont chargées.
    var VIGNETTES = {};
    return { DEFS: DEFS, miniature: miniature, svgMini: svgMini, demiHaut: demiHaut, corps: corps, piece: piece, rail: rail, n: n,
      railDessus: railDessus, lampeDessus: lampeDessus, pieceDessus: pieceDessus,
      poserVignette: function (nom, url) { VIGNETTES[nom] = url; }, vignette: function (nom) { return VIGNETTES[nom]; } };
  })();

  // Pictos des aides en bascule (ligne 2 du bandeau ; 18 × 14) et des boutons ?, plein écran (16 × 16)
  var ICONES = {
    faisceau: '<path d="M1 7 9 2v10z M9 2l8 5-8 5z" fill="currentColor" opacity=".7"/>',
    construction: '<path d="M1 3h8l8 8M1 3l16 6M1 3l8 8h8" fill="none" stroke="currentColor" stroke-width="1.2"/>',
    pinceau: '<path d="M1 7 9 1l8 6M1 7l8-3 8 3M1 7h16M1 7l8 3 8-3M1 7l8 6 8-6" fill="none" stroke="currentColor" stroke-width="1"/>',
    spot: '<circle cx="9" cy="7" r="5.2" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="2 1.6"/><circle cx="8" cy="6.4" r="1.2" fill="currentColor"/><circle cx="10.4" cy="7.6" r="1.2" fill="currentColor" opacity=".7"/><circle cx="8.6" cy="8.8" r="1" fill="currentColor" opacity=".5"/>',
    deux: '<path d="M1 7h6l10 4M1 7h6M7 5l10 6M7 9l10 2" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M7 3v8" stroke="currentColor" stroke-width="1.6"/>',
    face: '<rect x="4" y="1" width="10" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M8 3v8M10 3v8" stroke="currentColor" stroke-width="1"/>',
    onde: '<path d="M3 1q4 6 0 12M7 1q4 6 0 12M11 1q4 6 0 12" fill="none" stroke="currentColor" stroke-width="1.1"/>',
    rebours: '<path d="M17 7H5M8 3 4 7l4 4M1 2v10" fill="none" stroke="currentColor" stroke-width="1.2"/>',
    pola: '<path d="M9 1v12M5 4l4-3 4 3M5 10l4 3 4-3" fill="none" stroke="currentColor" stroke-width="1.2"/>'
  };
  var ICO_AIDE = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M6.2 6.2a1.9 1.9 0 1 1 2.6 1.8c-.6.3-.8.6-.8 1.3M8 11.3v.2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
  var ICO_PLEIN = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';

  function monter(ctx) {
    var meta = ctx.meta || {};
    var scene = ctx.scene, pane = scene.closest ? scene.closest(".pane-exp") : null;
    var fab = P.instruments[meta.instrument || "michelson"];
    if (pane) pane.classList.add("paillasse-on");
    var R = el("div", "pl", pane || scene);
    // Écran étroit (même seuil que le reste de la page) : message au lieu de la paillasse. Pas de dépendance au
    // code commun des autres apps : le site public des instruments ne le charge pas.
    if (root.matchMedia && root.matchMedia("(max-width:900px)").matches) {
      R.classList.add("pl-etroit");
      el("p", "pl-msg", R, "Cette paillasse virtuelle s'ouvre sur un <b>ordinateur</b> : on y tourne les vis à la souris, " +
        "devant un grand écran.");
      return { stop: function () { R.remove(); if (pane) pane.classList.remove("paillasse-on"); } };
    }
    if (!fab) { el("p", "pl-msg", R, "Instrument inconnu."); return { stop: function () { R.remove(); } }; }

    // ----- squelette -----
    var gauche = el("div", "pl-gauche", R), droite = el("div", "pl-droite", R), bas = el("div", "pl-bas", R);
    var dessus = svg("svg", { class: "pl-dessus", preserveAspectRatio: "xMidYMid meet" }, gauche);
    var boite = el("div", "pl-boite", gauche);
    el("a", "pl-licence", gauche, "© S. Reyt · GPLv3 + CC BY-NC-SA 4.0").setAttribute("href", "https://www.gnu.org/licenses/gpl-3.0.html");
    var obsTete = el("div", "pl-obs-tete", droite), obs = el("div", "pl-obs", droite), obsPied = el("div", "pl-obs-pied", droite);
    var loupe = svg("svg", { class: "pl-loupe" }, droite), lecture = el("div", "pl-lecture", droite);
    var rangEt = el("div", "pl-etapes", bas), ligneBas = el("div", "pl-bas-l", bas);
    var aide = el("p", "pl-aide", ligneBas), actions = el("div", "pl-actions", ligneBas);

    // ----- vis moletées -----
    // o = { x, y, long, diam, axe: "x" | "y" (axe du cylindre), nom, lx, ly (position du nom), tours() (angle
    //       affiché, en tours), tourner(dtours), pasMolette: [normal, Maj, Ctrl+Maj?] en tours (absent : Maj ÷ 10 ; Ctrl : normal × 10),
    //       accel (gain maximal d'un glisser rapide : la vis tourne plus vite que le doigt, comme une vis qu'on lance ;
    //       absent = 1), fin: false (Maj sans effet : vis grossière, on affine avec une autre ; Ctrl, très gros : un tour par cran, reste actif à la molette),
    //       pos() → {x, y} et rot() (degrés, sens du SVG) : vis portée par un organe qui tourne (lunette du
    //       goniomètre) ; elle est alors dessinée tournée, roule dans sa direction tournée, et la molette la trouve
    //       à sa position du moment ; le nom reste horizontal, décalé de (lx, ly) tourné }
    //       Glisser : Maj divise par 10, Ctrl+Maj par 100.
    var VIS = [], ZONES = [];
    function lieuVis(o) {
      var p = o.pos ? o.pos() : o;
      return { x: p.x, y: p.y, r: o.rot ? o.rot() : 0 };
    }
    function vis(parent, o) {
      var g = svg("g", { class: "pl-vis" }, parent), corps = svg("g", {}, g), nom = null;
      if (o.nom) nom = svg("text", { x: o.x + (o.lx || 0), y: o.y + (o.ly || 0), class: "pl-nom-vis", "text-anchor": o.ancre || "middle" }, g);
      if (nom) nom.textContent = o.nom;
      function dessiner() {
        corps.innerHTML = "";
        var tourne = !!(o.pos || o.rot), L = lieuVis(o), ox = o.x, oy = o.y;
        if (tourne) {
          corps.setAttribute("transform", "translate(" + L.x + "," + L.y + ") rotate(" + L.r + ")");
          o.x = 0; o.y = 0;
          if (nom) {
            var c = Math.cos(L.r * Math.PI / 180), s = Math.sin(L.r * Math.PI / 180), lx = o.lx || 0, ly = o.ly || 0;
            nom.setAttribute("x", L.x + lx * c - ly * s); nom.setAttribute("y", L.y + lx * s + ly * c);
          }
        }
        try { dessinerCorps(); } finally { if (tourne) { o.x = ox; o.y = oy; } }
      }
      function dessinerCorps() {
        var w = o.axe === "y" ? o.diam : o.long, h = o.axe === "y" ? o.long : o.diam, x0 = o.x - w / 2, y0 = o.y - h / 2;
        svg("rect", { x: x0, y: y0, width: w, height: h, rx: Math.min(2.5, o.diam / 5), fill: o.axe === "y" ? "url(#plCylY)" : "url(#plCylX)",
          class: "pl-vis-corps", filter: "url(#plOmbre)" }, corps);
        var n = o.stries || 16, demi = o.diam / 2 - 0.6, a = 2 * Math.PI * (o.tours ? o.tours() : 0);
        for (var k = 0; k < n; k++) {
          var th = a + k * 2 * Math.PI / n, c = Math.cos(th);
          if (c <= 0.05) continue;
          var s = Math.sin(th) * demi, l = Math.round(60 + 120 * c), col = "rgb(" + l + "," + (l + 5) + "," + (l + 12) + ")";
          if (o.axe === "y") svg("line", { x1: o.x + s, y1: y0 + 1, x2: o.x + s, y2: y0 + h - 1, stroke: col, "stroke-width": 0.4 + 0.8 * c }, corps);
          else svg("line", { x1: x0 + 1, y1: o.y + s, x2: x0 + w - 1, y2: o.y + s, stroke: col, "stroke-width": 0.4 + 0.8 * c }, corps);
        }
        if (o.repere) {   // trait de repère sur un tambour (tourne avec lui)
          var sr = Math.sin(a) * demi;
          if (Math.cos(a) > 0) {
            if (o.axe === "y") svg("line", { x1: o.x + sr, y1: y0 + 1, x2: o.x + sr, y2: y0 + h - 1, stroke: "#e8c45a", "stroke-width": 1.2 }, corps);
            else svg("line", { x1: x0 + 1, y1: o.y + sr, x2: x0 + w - 1, y2: o.y + sr, stroke: "#e8c45a", "stroke-width": 1.2 }, corps);
          }
        }
      }
      var prise = null;
      function rayonPx() { var m = dessus.getScreenCTM(); return (o.diam / 2) * (m ? m.a : 1); }
      function tourner(dt) { o.tourner(dt); dessiner(); api.modifie(); }
      g.addEventListener("pointerdown", function (ev) {
        prise = { x: ev.clientX, y: ev.clientY, t: ev.timeStamp }; ev.preventDefault();
        try { g.setPointerCapture(ev.pointerId); } catch (e) {}
        g.classList.add("prise");
      });
      g.addEventListener("pointermove", function (ev) {
        if (!prise) return;
        // on fait ROULER le cylindre : déplacement perpendiculaire à son axe
        var dx = ev.clientX - prise.x, dy = ev.clientY - prise.y, ra = (o.rot ? o.rot() : 0) * Math.PI / 180;
        var d = o.axe === "y" ? dx * Math.cos(ra) + dy * Math.sin(ra) : dx * Math.sin(ra) - dy * Math.cos(ra);
        var dt = ev.timeStamp - prise.t, gain = 1;
        if (o.accel && dt > 0) { var v = Math.abs(d) / dt / 0.6; gain = Math.min(o.accel, 1 + v * v); }   // v en px/ms
        prise = { x: ev.clientX, y: ev.clientY, t: ev.timeStamp };
        var fin = o.fin === false || !ev.shiftKey ? 1 : (ev.ctrlKey || ev.metaKey) ? 0.01 : 0.1;      // Maj ÷ 10, Ctrl+Maj ÷ 100
        if (d) tourner(d / (2 * Math.PI * rayonPx()) * fin * gain);
      });
      function lacher() { prise = null; g.classList.remove("prise"); }
      g.addEventListener("pointerup", lacher); g.addEventListener("pointercancel", lacher);
      var v = { g: g, o: o, dessiner: dessiner, molette: function (k, ev) {
        var p = o.pasMolette || [1 / 40, 1 / 400], f = o.fin !== false, ultra = p[2] != null ? p[2] : p[1] / 10;
        tourner(k * (!f ? (ev.ctrlKey && !ev.shiftKey ? 40 * p[0] : p[0]) : ev.shiftKey ? ((ev.ctrlKey || ev.metaKey) ? ultra : p[1]) : ev.ctrlKey ? 10 * p[0] : p[0]));      // Maj fin · Ctrl+Maj ultrafin · Ctrl gros
      } };
      VIS.push(v); dessiner();
      return v;
    }
    function ptSvg(ev) {
      var m = dessus.getScreenCTM ? dessus.getScreenCTM() : null;     // jsdom : absent
      if (!m) return { x: 0, y: 0 };
      var p = dessus.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY;
      return p.matrixTransform(m.inverse());
    }

    // ----- molette (la même pour les trois instruments) : UN écouteur, en capture
    // sur la racine. (1) Défilement ACCUMULÉ : un pas = un cran de souris (deltaMode lu d'abord : Firefox donne des
    // lignes pour une souris, 3 par cran ; en pixels, PX_CRAN par cran) ; les fractions du pavé tactile s'additionnent
    // (avant : un pas entier par événement, le pavé tournait tout dix fois trop vite). (2) Cible FIGÉE au premier
    // événement, gardée tant que les événements se suivent à moins de 1 s, quoi qu'il passe sous le pointeur — la fige
    // ne sert qu'aux cibles qui BOUGENT sous le pointeur (pièce qui avance à la molette, barrette qui tourne, oculaire
    // qui coulisse). Un gestionnaire marqué `fige: false` (cibles sédentaires : zooms d'image, de graphe, de champ) est
    // re-résolu à CHAQUE événement : le zoom ne vaut que tant que le pointeur survole sa zone, jamais au-delà.
    // Gestionnaire = function (k, ev) : k pas ENTIERS, k > 0 = molette vers le haut ; ou { continu: function (p, ev) } :
    // p fractionnaire (zoom proportionnel au défilement). Maj : fin ; Ctrl : gros (chaque gestionnaire lit ev).
    // Les gestionnaires `fige: false` sont renvoyés STABLES (même objet d'un événement à l'autre) : un objet neuf à
    // chaque résolution remettrait l'accumulateur du pavé tactile à zéro à chaque événement (plus de cran entier).
    // Résolution de la cible, dans l'ordre : pastilles réglables (`K.pastilles`), cibles de l'instrument (`K.cibleMolette(f)`, f(élément, ev) → gestionnaire
    // ou null), puis sur le dessin les zones (`K.zoneMolette(f)`, f(point SVG) → gestionnaire ou null, prioritaires sur
    // les vis), puis la vis la plus proche, puis un curseur (input range) hors des panneaux. Rien : l'événement passe
    // (les écouteurs propres d'un élément le reçoivent), sauf sur le dessin où la page ne défile jamais.
    var CIBLES = [], PX_CRAN = 100, MOL = { h: null, t: 0, acc: 0 };
    function zoneMolette(f) { ZONES.push(f); }
    function cibleMolette(f) { CIBLES.push(f); }
    function pasMolette(ev) { var m = ev.deltaMode, d = ev.deltaY; return -(m === 1 ? d / 3 : m === 2 ? d : d / PX_CRAN); }
    var RIEN = function () {};
    // un cran = 1/40 de la course (au moins un pas) ; Maj : 1/400 ; Ctrl+Maj : 1/4000 ; Ctrl : 1/8. Le curseur peut être refait pendant la
    // rafale (tête ou pied de l'observation redessinés) : retrouvé par son rang dans son hôte.
    function curseurMolette(r0) {
      var hote = r0.closest(".pl-obs-pied, .pl-obs-tete, .pl-boite, .pl-bas") || R, rang = Array.prototype.indexOf.call(hote.querySelectorAll("input[type=range]"), r0);
      return function (k, ev) {
        var r = r0.isConnected ? r0 : hote.querySelectorAll("input[type=range]")[rang];
        if (!r) return;
        var lo = +r.min || 0, hi = r.max === "" ? 100 : +r.max, s = +r.step || 1, f = ev.shiftKey ? ((ev.ctrlKey || ev.metaKey) ? 4000 : 400) : ev.ctrlKey ? 8 : 40;
        var d = Math.max(s, Math.round((hi - lo) / f / s) * s);
        r.value = Math.max(lo, Math.min(hi, +r.value + k * d));
        r.dispatchEvent(new root.Event("input", { bubbles: true }));
      };
    }
    function trouverMolette(ev) {
      var t = ev.target, i, h, hp = pastilleDe(t, ev);
      if (hp) return function (k, e) { hp.regler(k, e); api.modifie(); };      // pastille réglable : avant tout le reste
      for (i = 0; i < CIBLES.length; i++) if ((h = CIBLES[i](t, ev))) return h;
      if (t && dessus.contains(t)) {
        var p = ptSvg(ev);
        for (i = 0; i < ZONES.length; i++) if ((h = ZONES[i](p))) return h;
        var best = null, dmin = 34;
        for (i = 0; i < VIS.length; i++) {
          var o = lieuVis(VIS[i].o), d = Math.hypot(p.x - o.x, p.y - o.y);
          if (d < dmin) { dmin = d; best = VIS[i]; }
        }
        return best ? best.molette : RIEN;
      }
      if (t && t.matches && t.matches("input[type=range]") && !t.closest(".pl-pan")) return curseurMolette(t);
      return null;
    }
    function surMolette(ev) {
      var t0 = ev.timeStamp || Date.now(), neuf = !MOL.h || t0 - MOL.t > 1000 || t0 < MOL.t;
      if (neuf) { MOL.h = trouverMolette(ev); MOL.acc = 0; }
      else if (MOL.h.fige === false) {      // cible sédentaire (zoom) : re-résolue à chaque événement — hors de sa zone, elle tombe
        var h2 = trouverMolette(ev);
        if (h2 !== MOL.h) { MOL.h = h2; MOL.acc = 0; }
      }
      MOL.t = t0;
      var h = MOL.h; if (!h) { MOL.h = null; return; }
      ev.preventDefault(); ev.stopPropagation();
      var p = pasMolette(ev);
      if (!p || h === RIEN) return;
      if (h.continu) { h.continu(p, ev); return; }
      MOL.acc += p;
      var k = MOL.acc > 0 ? Math.floor(MOL.acc + 1e-9) : Math.ceil(MOL.acc - 1e-9);
      MOL.acc -= k;
      if (k) h(k, ev);
    }
    R.addEventListener("wheel", surMolette, { passive: false, capture: true });

    // ----- glisser le long d'un banc : f(point SVG, ev) ; un seul glisser à la fois, suivi sur la fenêtre (le dessin
    // de l'élément peut être reconstruit pendant le geste sans perdre le pointeur) -----
    var glisse = null;
    function glisser(cible, f, debut) {
      cible.addEventListener("pointerdown", function (ev) {
        if (ev.button) return;
        ev.preventDefault(); ev.stopPropagation();
        glisse = { f: f, p0: ptSvg(ev), etat: debut ? debut(ptSvg(ev)) : null };
        R.classList.add("pl-glisse");
      });
    }
    function surMove(ev) { if (!glisse) return; glisse.f(ptSvg(ev), ev, glisse); api.modifie(); }
    function surUp() { if (glisse) { glisse = null; R.classList.remove("pl-glisse"); } }
    root.addEventListener("pointermove", surMove);
    root.addEventListener("pointerup", surUp);
    root.addEventListener("pointercancel", surUp);

    // ----- boutons, puces -----
    function bouton(host, texte, f, cls) {
      var b = el("button", "pl-btn" + (cls ? " " + cls : ""), host); b.type = "button"; b.innerHTML = texte;
      b.addEventListener("click", function (ev) { f(ev, b); });
      return b;
    }
    // Lecture d'un appareil vérifiée : l'élève tape sa lecture, l'instrument répond (juste ou l'écart), jamais la valeur.
    function lectureVerif(host, o) {
      host.innerHTML = "";
      el("span", "pl-lect-lab", host, o.label);
      var inp = el("input", "pl-lect-in", host); inp.type = "text"; inp.inputMode = "decimal"; inp.placeholder = o.exemple || "";
      inp.setAttribute("aria-label", o.label.replace(/<[^>]+>/g, ""));
      el("span", "pl-lect-u", host, o.unite || "");
      var verdict;
      var b = bouton(host, "Vérifier ma lecture", function () {
        var v = parseFloat(String(inp.value).replace(",", ".").replace(/\s/g, ""));
        verdict.textContent = isNaN(v) ? (o.aideSaisie || "Taper une valeur.") : o.verifier(v);
      });
      inp.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); b.click(); } ev.stopPropagation(); });
      inp.addEventListener("input", function () { verdict.textContent = ""; });
      verdict = el("span", "pl-lect-verdict", host);
      return { effacer: function () { inp.value = ""; verdict.textContent = ""; } };
    }

    // ================= composants d'interface communs =================
    // Sortis du banc pour les trois instruments : bandeau du haut, ligne des gestes,
    // panneau « ? », sélecteurs, curseurs, menus déroulants, clic droit, étagère, pastilles réglables. Classes `bc-*`
    // gardées : le banc, ses tests et _style.css les lisent.

    // ----- sélecteur segmenté : pastilles exclusives [[valeur, texte, titre?]…], f(valeur) au clic -----
    function seg(host, opts, actif, f) {
      var g = el("span", "bc-seg", host);
      opts.forEach(function (o) {
        var b = el("button", "", g, o[1]); b.type = "button"; b.setAttribute("aria-pressed", o[0] === actif ? "true" : "false");
        if (o[2]) b.title = o[2];
        b.addEventListener("click", function () { f(o[0]); });
      });
      return g;
    }
    // Groupe libellé du bandeau (Niveau [1|2|3]…) : get() la valeur montrée, set(v) au clic ; opts [[valeur, texte, a3?]…].
    function groupe(host, lab, opts, get, set, a3) {
      var g = el("span", "bc-groupe", host), bs = [];
      el("span", "bc-groupe-l", g, lab);
      var s = el("span", "bc-seg", g);
      opts.forEach(function (o) {
        var b = el("button", "", s, o[1]); b.type = "button"; b.setAttribute("data-a3", o[2] || a3);
        b.addEventListener("click", function () { set(o[0]); maj(); });
        bs.push([o[0], b]);
      });
      function maj() { bs.forEach(function (q) { q[1].setAttribute("aria-pressed", get() === q[0] ? "true" : "false"); }); }
      maj();
      return { maj: maj, g: g };
    }
    // Curseur libellé (label.bc-reg : nom, curseur, valeur affichée f(v)) ; apres() après chaque réglage (recalcul).
    // `zero` (inclinaisons, orientations, translations à zéro) : un double-clic sur le curseur y ramène le réglage.
    function curseur(host, lab, min, max, pas, get, set, f, apres, zero) {
      var r = el("label", "bc-reg", host); el("span", "", r, lab);
      var i = el("input", "", r); i.type = "range"; i.min = min; i.max = max; i.step = pas; i.value = get();
      var v = el("output", "", r, f(get()));
      i.addEventListener("input", function () { set(parseFloat(i.value)); v.textContent = f(parseFloat(i.value)); if (apres) apres(); });
      if (zero != null) r.addEventListener("dblclick", function (ev) { ev.preventDefault(); i.value = zero; i.dispatchEvent(new root.Event("input", { bubbles: true })); });
      return r;
    }

    // ----- menus : déroulants (Réglages ▾, Mesurer ▾) et clic droit, une seule mécanique, fermés au premier clic ailleurs
    // et à Échap. items { lab, k (geste rappelé), a3, dis, coche, sub (sous-menu, clic droit), tit, sep, act }.
    // `surFermerMenus(f)` : un menu propre à l'instrument (Montages du banc) se ferme avec les autres.
    var DM = null, CTX = null, FERMEURS = [];
    function fermerDm() { if (DM) { DM.d.remove(); DM.b.setAttribute("aria-pressed", "false"); DM = null; } }
    function fermerCtx(niv) { if (!CTX) return; while (CTX.length > (niv || 0)) CTX.pop().remove(); if (!CTX.length) CTX = null; }
    function fermerMenus() { fermerDm(); fermerCtx(); FERMEURS.forEach(function (f) { f(); }); }
    function deroulant(b, items) {
      b.addEventListener("click", function (ev) {
        ev.stopPropagation();
        var deja = DM && DM.b === b; fermerMenus(); if (deja) return;
        var d = el("div", "bc-dm", R);
        items().forEach(function (it) {
          if (it.tit) { el("div", "bc-dm-t", d).textContent = it.tit; return; }
          if (it.sep) { el("div", "bc-dm-s", d); return; }
          var r = el("button", "bc-dm-i" + (it.coche ? " coche" : ""), d); r.type = "button"; r.textContent = it.lab; r.disabled = !!it.dis;
          if (it.a3) r.setAttribute("data-a3", it.a3);
          r.addEventListener("click", function () { fermerDm(); it.act(); });
        });
        var Rr = R.getBoundingClientRect(), Rb = b.getBoundingClientRect();
        d.style.left = Math.max(4, Math.min(Rb.left - Rr.left, Rr.width - d.offsetWidth - 6)) + "px"; d.style.top = (Rb.bottom - Rr.top + 4) + "px";
        // un bouton du bandeau du haut : le menu s'ouvre SOUS le bandeau, sinon il recouvre la ligne où s'affiche l'aide du survol
        var hb = b.closest && b.closest(".pl-haut"); if (hb) d.style.top = (hb.getBoundingClientRect().bottom - Rr.top + 2) + "px";
        // un bouton du bas (ligne des conditions du Michelson) : au-dessus, s'il déborderait de la paillasse
        else if (Rb.bottom - Rr.top + 4 + d.offsetHeight > Rr.height) d.style.top = Math.max(4, Rb.top - Rr.top - d.offsetHeight - 4) + "px";
        DM = { d: d, b: b }; b.setAttribute("aria-pressed", "true");
      });
    }
    // Clic droit : même aspect que les déroulants, avec des sous-menus (▸, au survol ou au clic) ; (cx, cy) en pixels d'écran.
    function ouvrirCtx(cx, cy, items, niv) {
      niv = niv || 0;
      if (!niv) fermerMenus(); else fermerCtx(niv);
      if (!items.length) return;
      CTX = CTX || [];
      var d = el("div", "bc-dm bc-ctx", R); d.setAttribute("role", "menu");
      items.forEach(function (it) {
        if (it.sep) { el("div", "bc-dm-s", d); return; }
        if (it.tit) { el("div", "bc-dm-t", d).textContent = it.tit; return; }
        var r = el("button", "bc-dm-i" + (it.coche ? " coche" : ""), d, "<span></span>" + (it.sub ? '<span class="bc-dm-k">▸</span>' : it.k ? '<span class="bc-dm-k"></span>' : ""));
        r.type = "button"; r.firstChild.textContent = it.lab; if (it.k && !it.sub) r.lastChild.textContent = it.k;
        r.disabled = !!it.dis || (it.sub && !it.sub.length);
        if (it.a3) r.setAttribute("data-a3", it.a3);
        if (it.sub) {
          var ouvre = function () {
            Array.prototype.forEach.call(d.querySelectorAll(".bc-dm-i.ouvert"), function (q) { q.classList.remove("ouvert"); });
            r.classList.add("ouvert"); var Ri = r.getBoundingClientRect(); ouvrirCtx(Ri.right + 2, Ri.top - 4, it.sub, niv + 1);
          };
          r.addEventListener("mouseenter", ouvre); r.addEventListener("click", ouvre);
        } else {
          r.addEventListener("mouseenter", function () { fermerCtx(niv + 1); Array.prototype.forEach.call(d.querySelectorAll(".bc-dm-i.ouvert"), function (q) { q.classList.remove("ouvert"); }); });
          r.addEventListener("click", function () { fermerCtx(); it.act(); });
        }
      });
      CTX.push(d);
      var Rr = R.getBoundingClientRect(), w = d.offsetWidth, h = d.offsetHeight;
      d.style.left = Math.max(4, Math.min(cx - Rr.left, Rr.width - w - 6)) + "px";
      d.style.top = Math.max(4, Math.min(cy - Rr.top, Rr.height - h - 6)) + "px";
    }
    function horsMenus(ev) {
      if (DM && !DM.d.contains(ev.target) && !DM.b.contains(ev.target)) fermerDm();
      if (CTX && !CTX.some(function (d) { return d.contains(ev.target); })) fermerCtx();
    }
    root.addEventListener("pointerdown", horsMenus);

    // ----- panneau « ? » : tous les gestes et raccourcis, par zone ; G = { zone: [[geste, effet]…] } (ou une fonction qui
    // le rend), les mêmes textes que la ligne des gestes -----
    var RAC = null;
    function panneauGestes(G) {
      if (RAC) { fermerGestes(); return; }
      if (typeof G === "function") G = G();
      RAC = el("div", "bc-voile", R);
      var d = el("div", "bc-rac", RAC), h2 = el("div", "bc-rac-t", d, "<b>Gestes et raccourcis</b>");
      bouton(h2, "Fermer (Échap)", fermerGestes, "pl-btn-p");
      // Site public : formulaire de retour (optique-public/retour.js pose OPTIQUE_RETOUR). En tête
      // du panneau et bien visible : un bug signalé ici emporte l'état de l'instrument, pas celui de l'accueil.
      if (root.OPTIQUE_RETOUR) {
        var pr = el("div", "bc-rac-retour", d);
        el("span", "", pr, "Un problème, une idée ? Signale-le d'ici : l'état de l'instrument est joint au rapport.");
        bouton(pr, "Signaler un bug ou proposer une idée", function () { fermerGestes(); root.OPTIQUE_RETOUR.ouvrir(); }, "pl-btn-retour");
      }
      var c3 = el("div", "bc-rac-c", d), nz = Object.keys(G || {}).length;
      if (nz > 3) c3.style.gridTemplateColumns = "repeat(" + Math.min(nz, 4) + ", minmax(0,1fr))";     // Michelson : quatre zones
      Object.keys(G || {}).forEach(function (z) {
        var col = el("div", "", c3); el("h3", "", col).textContent = z;
        var tb = el("table", "", col);
        G[z].forEach(function (g) { var tr = el("tr", "", tb); el("td", "", tr).textContent = g[0]; el("td", "", tr).textContent = g[1]; });
      });
      RAC.addEventListener("pointerdown", function (ev) { if (ev.target === RAC) fermerGestes(); });
    }
    function fermerGestes() { if (RAC) { RAC.remove(); RAC = null; } }

    // ----- Échap (en capture : avant l'hôte, que document ferme à Échap) : les crochets `avant` de l'instrument
    // (saisie en cours), puis clic droit, panneau « ? », déroulant, puis ses crochets `apres` (son menu, un mode) ;
    // un crochet rend vrai s'il a fermé ou annulé quelque chose. Rien de fermé : la touche passe à l'instrument. -----
    var ECHAP = { avant: [], apres: [] };
    function surEchap(o) { if (o.avant) ECHAP.avant.push(o.avant); if (o.apres) ECHAP.apres.push(o.apres); }
    function unDe(L) { for (var i = 0; i < L.length; i++) if (L[i]()) return true; return false; }
    function echap(ev) {
      if (ev.key !== "Escape" || !R.isConnected) return;
      var fait = unDe(ECHAP.avant);
      if (!fait) { if (CTX) fermerCtx(); else if (RAC) fermerGestes(); else if (DM) fermerDm(); else fait = unDe(ECHAP.apres) ? true : null; }
      if (fait === null) return;
      ev.preventDefault(); ev.stopPropagation();
    }
    root.addEventListener("keydown", echap, true);

    // ----- bandeau du haut (trois lignes fines) : l1 commandes, l2 aides en bascules, l3 ligne des gestes. Créé à la
    // demande, en tête de la paillasse (grille `.pl-a-haut`) ; un instrument qui ne l'appelle pas garde sa mise en page. -----
    var BANDEAU = null;
    function bandeau() {
      if (BANDEAU) return BANDEAU;
      var h = el("div", "pl-haut bc-barre"); R.insertBefore(h, R.firstChild); R.classList.add("pl-a-haut");
      BANDEAU = { el: h, l1: el("div", "bc-l1", h), l2: el("div", "bc-l2", h), l3: el("div", "bc-l3", h) };
      BANDEAU.l2.setAttribute("aria-label", "Aides");
      return BANDEAU;
    }
    function k_(t) { return "<span class=\"k\">" + t + "</span>"; }
    // Une aide en bascule : a = { cle, nom, lettre, titre (a3), on, cls, ico (picto 18 × 14, sinon ICONES[cle]) }.
    function boutonAide(host, a, basculer) {
      var b = el("button", "bc-aide" + (a.cls ? " " + a.cls : ""), host,
        '<svg viewBox="0 0 18 14" aria-hidden="true">' + (a.ico || ICONES[a.cle] || "") + "</svg>" + a.nom + (a.lettre ? "<kbd>" + a.lettre + "</kbd>" : ""));
      b.type = "button"; b.setAttribute("aria-pressed", a.on ? "true" : "false");
      b.setAttribute("data-a3", "<b>" + a.nom + "</b> — " + a.titre + (a.lettre ? " · clic ou touche " + k_(a.lettre) : ""));
      b.addEventListener("click", function () { basculer(a.cle); });
      return b;
    }
    // Ligne des aides : maj(liste) la refait quand elle change (seules celles qui ont un sens : l'instrument filtre).
    function ligneAides(host, basculer, lab) {
      var cle = null;
      return { maj: function (liste) {
        var c = JSON.stringify(liste); if (c === cle) return;
        cle = c; host.innerHTML = "";
        el("span", "bc-l2-lab", host, lab || "Aides");
        liste.forEach(function (a) { boutonAide(host, a, basculer); });
      } };
    }
    // Fin de la ligne 1 : Cahier (o.cahier : rendu de `cahier`), bouton du prof (o.prof = { lab, f, visible, cls, a3 }),
    // « ? » (o.gestes : le panneau), plein écran.
    function boutonsFin(host, o) {
      var r = {};
      if (o.cahier) {
        var CA = o.cahier;
        r.cahier = bouton(host, "Cahier", function () { CA.panneau.basculer(); }, "bc-discret");
        r.cahier.setAttribute("data-a3", "<b>Cahier</b> — les mesures notées, à exporter en CSV");
        CA.panneau.surBascule = (function (f) { return function (v) { if (f) f(v); r.cahier.setAttribute("aria-pressed", v ? "true" : "false"); }; })(CA.panneau.surBascule);
      }
      if (o.prof) {
        r.prof = bouton(host, o.prof.lab, o.prof.f, o.prof.cls || "pl-btn-prof");
        r.prof.hidden = !o.prof.visible; if (o.prof.a3) r.prof.setAttribute("data-a3", o.prof.a3);
      }
      r.aide = bouton(host, ICO_AIDE, function () { panneauGestes(o.gestes); }, "bc-discret bc-ico");
      r.aide.setAttribute("data-a3", "<b>Gestes et raccourcis</b> — tout ce que font la souris et le clavier, par zone · touche " + k_("?"));
      if (root.OPTIQUE_RETOUR) {
        r.retour = bouton(host, "Signaler", function () { root.OPTIQUE_RETOUR.ouvrir(); }, "pl-btn-retour");
        r.retour.setAttribute("data-a3", "<b>Signaler un bug ou proposer une idée</b> — l'état de l'instrument est joint au rapport");
      }
      r.plein = bouton(host, ICO_PLEIN, pleinEcran, "bc-discret bc-ico");
      r.plein.setAttribute("data-a3", "<b>Plein écran</b>");
      return r;
    }

    // ----- ligne des gestes (l3) : ce que font les gestes sur ce que survole la souris. o = { survol(t) → texte ou null
    // (après le `data-a3` d'un ancêtre, toujours prioritaire), defaut() → texte sans survol (l'élément choisi), suivre(t) :
    // vrai si un déplacement sur t doit relire le survol (dessin : les zones changent sans changer d'élément) }.
    // Priorité : le texte d'un geste en cours (`texteGeste`), puis le survol, puis le défaut. -----
    var LG = null, SURV = null, TXT_G = null, texteL3 = "";
    function survolDe(t) {
      if (!t || !t.closest) return null;
      var d = t.closest("[data-a3]"); if (d && R.contains(d)) return d.getAttribute("data-a3");
      return LG && LG.survol ? LG.survol(t) : null;
    }
    function majGestes() {
      if (!BANDEAU || !LG) return;
      var s = TXT_G || SURV || (LG.defaut ? LG.defaut() : "") || "";
      if (s !== texteL3) { texteL3 = s; BANDEAU.l3.innerHTML = s; }
    }
    function gestes(o) {
      LG = o; bandeau();
      R.addEventListener("mouseover", function (ev) { SURV = survolDe(ev.target); majGestes(); });
      R.addEventListener("mousemove", function (ev) { if (LG.suivre && LG.suivre(ev.target)) { var s = survolDe(ev.target); if (s !== SURV) { SURV = s; majGestes(); } } });
      R.addEventListener("mouseleave", function () { SURV = null; majGestes(); });
      majGestes();          // le texte par défaut dès l'ouverture, avant tout mouvement de la souris
    }
    function texteGeste(s) { TXT_G = s || null; majGestes(); }
    function annoncer(s) { SURV = s || null; majGestes(); }       // jusqu'au prochain survol (A / B du banc…)

    // ----- fantôme : la miniature qui suit le pointeur pendant qu'on glisse une carte hors de son banc -----
    var fant = el("div", "bc-fantome", R); fant.hidden = true;
    function fantome(ev, mini) {
      if (!mini) { fant.hidden = true; return; }
      if (fant.getAttribute("data-m") !== mini) { fant.innerHTML = mini; fant.setAttribute("data-m", mini); }
      fant.style.left = ev.clientX + "px"; fant.style.top = ev.clientY + "px"; fant.hidden = false;
    }

    // ----- étagère : onglets et cartes (miniature, nom). Dans le flux (banc) ou flottante et escamotable dans le coin
    // bas droit de son hôte (Michelson, goniomètre : repliée en « Éléments ▴ » ; repliée ou non et l'onglet ouvert
    // gardés dans le navigateur, clé o.memoire). o = {
    //   onglets() → [{ nom, lab (html, sinon le nom), a3 }], defaut (nom ou fonction : l'onglet de départ, ou quand
    //   l'ouvert n'existe plus), cartes(onglet) → [{ cle, mini (svg), nom, titre, a3, dis, pose (surlignée : posée), cls }],
    //   debut(cle, ev) au pointerdown, glisse(cle, ev) → { fantome, texte } à chaque déplacement (au-delà de 4 px),
    //   lache(cle, ev, bouge) au relâchement (bouge faux : un clic ; ev.type "pointercancel" : abandon), clic(cle, ev) au
    //   clavier (Entrée, Espace), flottante, memoire, titre (du bouton replié) }.
    // `gauche` : début de la rangée des onglets, à remplir par l'instrument (Montages du banc). -----
    var EG = null;
    function etagere(host, o) {
      var ET = el("div", "bc-etagere" + (o.flottante ? " bc-etagere-flot" : ""), host), RG = el("div", "bc-rangee", ET),
        RGG = el("div", "bc-rangee-g", RG), ONG = el("div", "bc-onglets", RG), CARTES = el("div", "bc-cartes", ET), MINI = {};
      ONG.setAttribute("role", "tablist");
      var mem = o.flottante && o.memoire ? memoire(o.memoire) : null, m0 = (mem && mem.lire()) || {};
      var ouvert = m0.onglet || null, replie = !o.fixe && !!m0.replie, bOuvrir = null;   // o.fixe : jamais repliée (Michelson)
      function defaut() { return typeof o.defaut === "function" ? o.defaut() : o.defaut; }
      function garder() { if (mem) mem.ecrire({ onglet: ouvert, replie: replie }); }
      if (o.flottante && !o.fixe) {
        var bPlier = el("button", "bc-et-plier", RG, "▾"); bPlier.type = "button";
        bPlier.setAttribute("data-a3", "<b>Replier l'étagère</b> — elle laisse la place à l'appareil");
        bPlier.addEventListener("click", function () { replier(true); });
        bOuvrir = el("button", "pl-btn bc-et-ouvrir", ET, (o.titre || "Éléments") + " ▴"); bOuvrir.type = "button";
        bOuvrir.setAttribute("data-a3", "<b>" + (o.titre || "Éléments") + "</b> — ouvrir l'étagère");
        bOuvrir.addEventListener("click", function () { replier(false); });
      }
      function replier(v) { replie = !!v; ET.classList.toggle("replie", replie); garder(); }
      if (o.flottante) ET.classList.toggle("replie", replie);
      // flottante : déplaçable par sa rangée d'onglets (hors boutons), bornée à son hôte, position gardée tant que l'app
      // est ouverte (comme les panneaux) ; repliée, elle se replie où on l'a mise
      if (o.flottante) {
        RG.style.cursor = "move";
        RG.addEventListener("pointerdown", function (ev) {
          if (ev.button || ev.target.closest("button")) return;
          ev.preventDefault();
          var hote = ET.offsetParent || ET.parentNode, rh = hote.getBoundingClientRect(), re = ET.getBoundingClientRect();
          var dx = ev.clientX - re.left, dy = ev.clientY - re.top;
          function bouger(e) {
            var L = Math.max(0, Math.min(rh.width - re.width, e.clientX - rh.left - dx));
            var B = Math.max(0, Math.min(rh.height - re.height, rh.bottom - e.clientY - (re.height - dy)));
            ET.style.left = L + "px"; ET.style.bottom = B + "px"; ET.style.right = ET.style.top = "auto";
          }
          function lacher() { root.removeEventListener("pointermove", bouger); root.removeEventListener("pointerup", lacher); }
          root.addEventListener("pointermove", bouger); root.addEventListener("pointerup", lacher);
        });
      }
      function dessiner() {
        ONG.innerHTML = ""; CARTES.innerHTML = ""; MINI = {};
        var TS = o.onglets(), i = TS.findIndex(function (T) { return T.nom === ouvert; });
        if (i < 0) i = Math.max(0, TS.findIndex(function (T) { return T.nom === defaut(); }));
        TS.forEach(function (T, k) {
          var b = el("button", "", ONG, T.lab != null ? T.lab : api.esc(T.nom)); b.type = "button";
          if (T.a3) b.setAttribute("data-a3", T.a3);
          b.setAttribute("role", "tab"); b.setAttribute("aria-selected", k === i ? "true" : "false");
          b.addEventListener("click", function () { ouvert = T.nom; garder(); dessiner(); });
        });
        if (!TS[i]) return;
        o.cartes(TS[i]).forEach(function (c) {
          var b = el("button", "bc-carte" + (c.cls ? " " + c.cls : "") + (c.pose ? " posee" : ""), CARTES, c.mini + "<span></span>"); b.type = "button";
          b.lastChild.textContent = c.nom; b.disabled = !!c.dis; b.setAttribute("data-piece", c.cle);
          if (c.titre) b.title = c.titre;
          if (c.a3) b.setAttribute("data-a3", c.a3);
          if (c.pose) b.setAttribute("aria-pressed", "true");
          MINI[c.cle] = c.mini;
          b.addEventListener("pointerdown", function (ev) {
            if (ev.button || b.disabled) return;
            ev.preventDefault();
            EG = { o: o, cle: c.cle, mini: c.mini, x0: ev.clientX, y0: ev.clientY, bouge: false };
            R.classList.add("pl-glisse");
            if (o.debut) o.debut(c.cle, ev);
          });
          // au clavier (ou sans pointeur) : Entrée ou Espace
          b.addEventListener("click", function (ev) { if (ev.detail === 0 && !b.disabled && o.clic) o.clic(c.cle, ev); });
        });
      }
      return { el: ET, rangee: RG, gauche: RGG, onglets: ONG, cartes: CARTES, dessiner: dessiner,
        ouvert: function () { return ouvert || defaut(); }, ouvrir: function (nom) { ouvert = nom; garder(); dessiner(); },
        replier: replier, replie: function () { return replie; } };
    }
    function egMove(ev) {
      if (!EG) return;
      if (!EG.bouge && Math.hypot(ev.clientX - EG.x0, ev.clientY - EG.y0) < 4) return;
      EG.bouge = true;
      var r = (EG.o.glisse && EG.o.glisse(EG.cle, ev)) || {};
      fantome(ev, r.fantome ? EG.mini : null); texteGeste(r.texte);
    }
    function egUp(ev) {
      if (!EG) return;
      var g = EG; EG = null; R.classList.remove("pl-glisse"); fantome(null); texteGeste(null);
      if (g.o.lache) g.o.lache(g.cle, ev, g.bouge);
    }
    root.addEventListener("pointermove", egMove);
    root.addEventListener("pointerup", egUp);
    root.addEventListener("pointercancel", egUp);

    // ----- pastilles réglables : la miniature d'un élément règle son réglage
    // principal à la MOLETTE et au GLISSER vertical (vers le haut = molette vers le haut, un pas tous les PAS_GLISSER px ;
    // Maj : fin, Ctrl : gros, lus par l'instrument) ; un clic sans glisser : h.clic (choisir l'élément).
    // f(cible, ev) → { regler(k, ev) (k pas entiers, k > 0 = vers le haut), clic(ev) } ou null. Le pointerdown est pris
    // en capture sur la paillasse : l'instrument ne le reçoit pas (au banc, la pièce ne part pas avec sa miniature).
    var PASTILLES = [], PG = null, PAS_GLISSER = 8;
    function pastilles(f) { PASTILLES.push(f); }
    function pastilleDe(t, ev) { for (var i = 0, h; i < PASTILLES.length; i++) if ((h = PASTILLES[i](t, ev))) return h; return null; }
    function pgDown(ev) {
      if (ev.button) return;
      var h = pastilleDe(ev.target, ev); if (!h) return;
      ev.preventDefault(); ev.stopPropagation(); fermerMenus();
      PG = { h: h, y0: ev.clientY, fait: 0, bouge: false };
      R.classList.add("pl-regle"); texteGeste(survolDe(ev.target));
    }
    function pgMove(ev) {
      if (!PG) return;
      var dy = PG.y0 - ev.clientY;
      if (!PG.bouge && Math.abs(dy) < 3) return;
      PG.bouge = true;
      var n = dy > 0 ? Math.floor(dy / PAS_GLISSER) : Math.ceil(dy / PAS_GLISSER), k = n - PG.fait;
      if (k) { PG.fait = n; PG.h.regler(k, ev); api.modifie(); }
    }
    function pgUp(ev) {
      if (!PG) return;
      var g = PG; PG = null; R.classList.remove("pl-regle"); texteGeste(null);
      if (!g.bouge && ev.type === "pointerup" && g.h.clic) g.h.clic(ev);
    }
    R.addEventListener("pointerdown", pgDown, true);
    root.addEventListener("pointermove", pgMove);
    root.addEventListener("pointerup", pgUp);
    root.addEventListener("pointercancel", pgUp);

    // Dégradés `bc*` du module Dessin pour les miniatures HTML (étagère, bandeau) d'un instrument dont le dessin ne les
    // porte pas déjà (le banc les met dans les `defs` de son SVG).
    var defsPoses = false;
    function defsDessin() {
      if (defsPoses) return; defsPoses = true;
      var s = svg("svg", { width: 0, height: 0, class: "pl-defs", "aria-hidden": "true" }, R);
      svg("defs", {}, s).innerHTML = Dessin.DEFS;
    }

    // ----- rangée des étapes : defs = [{id, nom, titre, soin, app}] ; maj(faits {id: true | "soignee" | "sautee" | "dereglee" | "laser"},
    // cible, vise) ; choisir(id) au clic sur une puce (étape visée par les indices) -----
    function etapes(defs, choisir) {
      rangEt.innerHTML = "";
      var puces = {};
      defs.forEach(function (d, i) {
        if (d.app && (i === 0 || !defs[i - 1].app)) el("span", "pl-et-sep", rangEt, "Applications");
        var b = el(choisir ? "button" : "span", "pl-et" + (d.app ? " pl-et-app" : ""), rangEt);
        if (choisir) { b.type = "button"; b.addEventListener("click", function () { choisir(d.id); }); }
        b.title = (d.regarde ? "On regarde " + d.regarde + "\n" : "") + (d.titre || "") + (d.soin ? "\nSoignée (★) : " + d.soin : "") + (choisir ? "\nCliquer : les indices visent cette étape." : "");
        b.setAttribute("data-etape", d.id);
        el("span", "pl-et-m", b); el("span", "pl-et-n", b, (d.app ? "" : (i + 1) + ". ") + d.nom);
        puces[d.id] = b;
      });
      return { maj: function (faits, cible, vise) {
        defs.forEach(function (d) {
          var b = puces[d.id], f = faits[d.id];
          b.classList.toggle("fait", f === true || f === "soignee"); b.classList.toggle("soignee", f === "soignee");
          b.classList.toggle("sautee", f === "sautee"); b.classList.toggle("cible", d.id === cible); b.classList.toggle("vise", d.id === vise);
          b.classList.toggle("dereglee", f === "dereglee");   // goniomètre : atteinte, puis perdue (étapes lues en direct)
          b.classList.toggle("laser", f === "laser");         // Michelson : atteinte au laser seulement (coche distincte)
          b.querySelector(".pl-et-m").textContent = f === "soignee" ? "★" : f === true || f === "laser" ? "✓" : f === "sautee" ? "–" : f === "dereglee" ? "!" : "";
        });
      } };
    }

    // ----- panneau « Manipulations » (goniomètre, Michelson) : accordéon, une manipulation ouverte à la fois (celle que
    // visent les indices) ; ce qu'on observe, comment faire, quand la case se coche. Bouton au bout de la rangée des
    // réglages : appeler APRÈS etapes(), qui vide la rangée. defs = [{id, nom, observe, etapes: [..], titre}] ;
    // o = {intro, a3, choisir(id)} ; maj(vus {id: vrai}, vise). -----
    function manipulations(defs, o) {
      var P = panneau("pl-manips", "Manipulations", { mesureBas: true }), items = {};
      if (o.intro) el("p", "pl-mp-intro", P.corps, o.intro);
      defs.forEach(function (m) {
        var it = el("div", "pl-mp", P.corps); it.setAttribute("data-manip", m.id);
        var h = el("button", "pl-mp-n", it); h.type = "button";
        el("span", "pl-et-m", h); el("span", "pl-mp-nom", h, m.nom); el("span", "pl-mp-chev", h, "▸");
        h.addEventListener("click", function () { o.choisir(m.id); });
        var c = el("div", "pl-mp-c", it);
        el("div", "pl-mp-h", c, "Ce qu'on observe"); el("p", "pl-mp-t", c, m.observe);
        el("div", "pl-mp-h", c, "Comment faire");
        var ol = el("ol", "pl-mp-e", c); m.etapes.forEach(function (e) { el("li", "", ol, e); });
        el("p", "pl-mp-q", c, "Coché quand : " + m.titre);
        items[m.id] = it;
      });
      el("span", "pl-bm-sep", rangEt);
      var b = el("button", "pl-bmanip", rangEt); b.type = "button";
      if (o.a3) b.setAttribute("data-a3", o.a3);
      b.addEventListener("click", function () { P.basculer(); });
      P.surBascule = function (v) { b.setAttribute("aria-pressed", v ? "true" : "false"); };
      return { panneau: P, bouton: b, maj: function (vus, vise) {
        var n = 0;
        defs.forEach(function (m) {
          var it = items[m.id], vu = !!(vus && vus[m.id]), ouv = vise === m.id;
          if (vu) n++;
          it.classList.toggle("vu", vu); it.classList.toggle("ouvert", ouv);
          it.querySelector(".pl-et-m").textContent = vu ? "✓" : "";
          it.querySelector(".pl-mp-chev").textContent = ouv ? "▾" : "▸";
        });
        b.innerHTML = "Manipulations <span class=\"pl-bm-n\">" + n + "/" + defs.length + "</span>";
      } };
    }

    // ----- panneaux flottants au-dessus du dessin (cahier, mode prof) : un seul ouvert à la fois -----
    var PANNEAUX = [];
    // o.coin = "bas-droite" : posé dans toute la paillasse, en bas à droite juste au-dessus de la rangée du bas ;
    // o.libre : hors de la règle « un seul ouvert » (affichage d'un capteur, qu'on garde à côté du cahier)
    function panneau(cls, titre, opt) {
      opt = opt || {};
      var p = el("div", "pl-pan " + cls + (opt.coin ? " pl-pan-" + opt.coin : ""), opt.coin ? R : gauche); p.hidden = true;
      var t = el("div", "pl-pan-t", p); el("span", "", t, titre);
      var x = el("button", "pl-pan-x", t, "×"); x.type = "button"; x.title = "Fermer";
      var corps = el("div", "pl-pan-c", p);
      var o = { el: p, corps: corps, libre: !!opt.libre, ouvert: function () { return !p.hidden; }, surBascule: null,
        basculer: function (v) {
          var ouvrir = v == null ? p.hidden : !!v;
          if (!opt.libre) PANNEAUX.forEach(function (q) { if (q !== o && !q.libre && ouvrir && !q.el.hidden) { q.el.hidden = true; if (q.surBascule) q.surBascule(false); } });
          if (ouvrir && (opt.coin || opt.mesureBas)) R.style.setProperty("--pl-bas-h", (bas.offsetHeight || (BANDEAU ? 0 : 60)) + "px");
          p.hidden = !ouvrir; if (o.surBascule) o.surBascule(ouvrir);
        } };
      x.addEventListener("click", function () { o.basculer(false); });
      // déplaçable par sa barre de titre (position gardée tant que l'app est ouverte), bornée au conteneur
      t.style.cursor = "move";
      t.addEventListener("pointerdown", function (ev) {
        if (ev.target === x || ev.button !== 0 || ev.target.closest("button") || p.classList.contains("pl-dock")) return;      // ancré : ne se déplace pas
        ev.preventDefault();
        var hote = p.offsetParent || p.parentNode, rh = hote.getBoundingClientRect(), rp = p.getBoundingClientRect();
        var dx = ev.clientX - rp.left, dy = ev.clientY - rp.top;
        function bouger(e) {
          var L = Math.max(0, Math.min(rh.width - rp.width, e.clientX - rh.left - dx));
          var T = Math.max(0, Math.min(rh.height - rp.height, e.clientY - rh.top - dy));
          p.style.left = L + "px"; p.style.top = T + "px"; p.style.right = p.style.bottom = "auto";
        }
        function lacher() { root.removeEventListener("pointermove", bouger); root.removeEventListener("pointerup", lacher); }
        root.addEventListener("pointermove", bouger); root.addEventListener("pointerup", lacher);
      });
      // les touches tapées dans un champ du panneau ne remontent pas (ni raccourcis du site, ni molette) ; sur un bouton
      // (le focus y reste après un clic), elles remontent : Suppr, flèches, Tab agissent encore sur l'élément choisi
      p.addEventListener("keydown", function (ev) {
        var t = ev.target;
        if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) ev.stopPropagation();
      });
      p.addEventListener("wheel", function (ev) { ev.stopPropagation(); }, { passive: true });
      PANNEAUX.push(o);
      return o;
    }

    // ----- export CSV (cahier, courbes des capteurs) : point décimal, séparateur virgule, lu avec Python -----
    // csvTexte(entetes, lignes) : entetes = noms de colonnes (unités comprises), lignes = tableaux de nombres ou de textes.
    // Un nombre est écrit à 8 chiffres significatifs (pas de bruit de flottant) ; un trou (null) est une cellule vide.
    function csvTexte(entetes, lignes) {
      var q = function (t) { t = String(t == null ? "" : t); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
      var nb = function (v) { return typeof v === "number" ? (isFinite(v) ? String(+v.toPrecision(8)) : "") : q(v); };
      return entetes.map(q).join(",") + "\n" + lignes.map(function (l) { return l.map(nb).join(","); }).join("\n") + (lignes.length ? "\n" : "");
    }
    // Télécharge `texte` sous le nom `nom` (Blob) ; rend false si le navigateur ne sait pas.
    function telecharger(nom, texte) {
      try {
        var a = document.createElement("a"), u = root.URL.createObjectURL(new root.Blob([texte], { type: "text/csv;charset=utf-8" }));
        a.href = u; a.download = nom; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { root.URL.revokeObjectURL(u); }, 1000);
        return true;
      } catch (e) { return false; }
    }
    function exporterCsv(nom, entetes, lignes) { return telecharger(nom, csvTexte(entetes, lignes)); }

    // ----- cahier de mesures : lignes libres (libellé, valeur, unité, incertitude-type) ; ne calcule rien -----
    // o = { lire() → [lignes], ecrire(lignes), fichier: "cahier.csv" }
    function cahier(o) {
      var P = panneau("pl-cahier", "Cahier de mesures");
      function num(v) { return String(v == null ? "" : v).trim().replace(/\s/g, "").replace(",", "."); }
      function csv() {
        var q = function (t) { t = String(t == null ? "" : t); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
        return "libelle,valeur,unite,incertitude\n" + o.lire().map(function (l) {
          return [q(l.lib), q(num(l.val)), q(l.u), q(num(l.inc))].join(",");
        }).join("\n") + "\n";
      }
      function dessiner() {
        var C = P.corps; C.innerHTML = "";
        var L = o.lire(), tab = el("table", "pl-cah-tab", C), th = el("tr", "", tab);
        ["Mesure", "Valeur", "Unité", "Incertitude-type", ""].forEach(function (h) { el("th", "", th, h); });
        L.forEach(function (l, i) {
          var tr = el("tr", "", tab);
          [["lib", "ex. C₃ au contact", "pl-cah-lib"], ["val", "", "pl-cah-v"], ["u", "mm", "pl-cah-u"], ["inc", "", "pl-cah-v"]].forEach(function (c) {
            var td = el("td", "", tr), inp = el("input", "pl-cah-in " + c[2], td);
            inp.type = "text"; inp.value = l[c[0]] == null ? "" : l[c[0]]; inp.placeholder = c[1];
            if (c[2] === "pl-cah-v") inp.inputMode = "decimal";
            inp.setAttribute("aria-label", { lib: "Mesure", val: "Valeur", u: "Unité", inc: "Incertitude-type" }[c[0]]);
            inp.addEventListener("input", function () { var M = o.lire(); M[i][c[0]] = inp.value; o.ecrire(M); });
          });
          var td = el("td", "", tr), x = el("button", "pl-cah-x", td, "×"); x.type = "button"; x.title = "Supprimer la ligne";
          x.addEventListener("click", function () { var M = o.lire(); M.splice(i, 1); o.ecrire(M); dessiner(); });
        });
        var pied = el("div", "pl-cah-pied", C);
        bouton(pied, "Ajouter une ligne", function () {
          var M = o.lire(); M.push({ lib: "", val: "", u: M.length ? M[M.length - 1].u : "mm", inc: "" }); o.ecrire(M); dessiner();
          var ins = P.corps.querySelectorAll(".pl-cah-lib"); if (ins.length) ins[ins.length - 1].focus();
        });
        var bx = bouton(pied, "Exporter (CSV)", function () {
          if (!telecharger(o.fichier || "cahier.csv", csv())) bx.title = "Export impossible dans ce navigateur.";
        });
        bx.title = "Fichier .csv à lire avec Python (point décimal, séparateur virgule).";
        el("p", "pl-cah-n", C, "Le cahier ne calcule rien : les exploitations restent à faire, à la main ou en Python.");
      }
      P.surBascule = function (ouv) { if (ouv) dessiner(); };
      return { panneau: P, csv: csv, redessiner: dessiner };
    }

    // ----- plein écran -----
    var atelier = R.closest ? R.closest(".atelier") : null;
    function pleinEcran() {
      var d = document;
      if (d.fullscreenElement) { if (d.exitFullscreen) d.exitFullscreen(); return; }
      var cible = atelier || R;
      if (cible.requestFullscreen) cible.requestFullscreen().catch(function () {});
    }

    // ----- sauvegarde différée -----
    var tSauve = null, inst = null, mem = memoire("vitrine-paillasse-" + (meta.instrument || "michelson") + "-v1");
    function sauver() { tSauve = null; if (inst && inst.capturer) mem.ecrire(inst.capturer()); poser(); }

    // ----- annuler / rétablir -----
    var ANNUL_MAX = 50, pile = [], refaire = [], courant = null;
    function annulable() { return !!(inst && inst.etatAnnulable && inst.restaurer); }
    function poser() {                        // l'état s'est posé : s'il a changé, l'ancien va sur la pile
      if (!annulable()) return;
      var j = JSON.stringify(inst.etatAnnulable());
      if (courant === null) { courant = j; return; }
      if (j === courant) return;
      pile.push(courant); if (pile.length > ANNUL_MAX) pile.shift();
      refaire.length = 0; courant = j;                        // vidée sur place : revenir() en tient la référence
    }
    function revenir(de, vers) {
      if (!annulable()) return false;
      if (tSauve) { clearTimeout(tSauve); sauver(); }        // un geste en cours se pose d'abord : il est annulé avec le reste
      if (!de.length) return false;
      vers.push(courant); courant = de.pop();
      inst.restaurer(JSON.parse(courant));
      courant = JSON.stringify(inst.etatAnnulable());          // même état, clés dans l'ordre que l'instrument rend
      if (tSauve) clearTimeout(tSauve);
      tSauve = setTimeout(sauver, 600);
      return true;
    }
    function surTouche(ev) {
      if (!(ev.ctrlKey || ev.metaKey) || ev.altKey || !annulable() || !R.isConnected) return;
      var t = ev.target, tag = t && t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable)) return;   // cahier : Ctrl+Z du champ
      var k = (ev.key || "").toLowerCase();
      if (k === "z" && !ev.shiftKey) revenir(pile, refaire);
      else if ((k === "z" && ev.shiftKey) || k === "y") revenir(refaire, pile);
      else return;
      ev.preventDefault(); ev.stopPropagation();
    }
    root.addEventListener("keydown", surTouche, true);

    var api = {
      racine: R, dessus: dessus, boite: boite, obsTete: obsTete, obs: obs, obsPied: obsPied, loupe: loupe,
      lecture: lecture, aide: aide, actions: actions, meta: meta, esc: ctx.esc || function (s) { return String(s); },
      svg: svg, el: el, hasard: hasard, memoire: mem, vis: vis, zoneMolette: zoneMolette, cibleMolette: cibleMolette, glisser: glisser, ptSvg: ptSvg,
      bouton: bouton, lectureVerif: lectureVerif, pleinEcran: pleinEcran, etapes: etapes, manipulations: manipulations, panneau: panneau, cahier: cahier, csvTexte: csvTexte, exporterCsv: exporterCsv,
      // composants communs des trois instruments
      seg: seg, groupe: groupe, curseur: curseur, deroulant: deroulant, ouvrirCtx: ouvrirCtx, fermerCtx: fermerCtx,
      fermerMenus: fermerMenus, surFermerMenus: function (f) { FERMEURS.push(f); }, menuOuvert: function () { return !!(DM || CTX); },
      surEchap: surEchap, bandeau: bandeau, boutonAide: boutonAide, ligneAides: ligneAides, boutonsFin: boutonsFin,
      gestes: gestes, majGestes: majGestes, texteGeste: texteGeste, annoncer: annoncer, panneauGestes: panneauGestes,
      fermerGestes: fermerGestes, gestesOuvert: function () { return !!RAC; }, etagere: etagere, pastilles: pastilles,
      defsDessin: defsDessin, Dessin: Dessin, ICONES: ICONES, k: k_,
      // le professeur (classe posée par l'hôte, relue à la demande : elle peut arriver après)
      estProf: function () { return !!(document.body && document.body.classList.contains("est-prof")); },
      // l'auteur seul (panneau Debug du banc, matériel « prof: true »)
      estDebug: function () { return !!(document.body && document.body.classList.contains("est-debug")); },
      // à appeler à chaque changement d'état : sauvegarde 600 ms après le dernier geste
      modifie: function () { if (tSauve) clearTimeout(tSauve); tSauve = setTimeout(sauver, 600); },
      sauverMaintenant: sauver,
      annuler: function () { return revenir(pile, refaire); }, retablir: function () { return revenir(refaire, pile); },
      oublierAnnulations: function () { pile.length = 0; refaire.length = 0; courant = annulable() ? JSON.stringify(inst.etatAnnulable()) : null; }
    };
    inst = fab.creer(api);
    if (annulable()) courant = JSON.stringify(inst.etatAnnulable());
    if (inst.viewBox) dessus.setAttribute("viewBox", inst.viewBox);
    P.actif = { inst: inst, api: api };     // la paillasse ouverte (captures, tests, futur mode prof)

    // ----- dimensions : carré d'observation S, loupe dessous, le dessin prend le reste -----
    function redim() {
      var hR = R.clientHeight, wR = R.clientWidth;
      if (!hR || !wR) return;
      var hBas = (bas.offsetHeight || (BANDEAU ? 0 : 44)) + (BANDEAU ? BANDEAU.el.offsetHeight || 80 : 0);
      // Place prise par ce qui n'est pas le carré d'observation ni le vernier : tête (ses boutons passent à la ligne quand la colonne est étroite), pied (texte d'une à trois lignes, blocs de
      // capteurs…), lecture, plus les 4 intervalles de 6 px et les marges de 8 px de la colonne. Le pied varie sans cesse : si
      // l'instrument déclare `reservePied` (px, tête + pied + lecture), la taille de l'image n'en dépend plus (elle ne bouge ni quand
      // le texte change de longueur, ni quand on pose ou retire un outil) et la colonne défile si le pied dépasse la réserve.
      // Sinon, la hauteur mesurée.
      var fixe = (inst.reservePied ? inst.reservePied : (obsTete.offsetHeight || 34) + (obsPied.offsetHeight || 34) + (lecture.offsetHeight || 40)) + 40;
      var S = Math.floor(Math.min(0.42 * wR, (hR - hBas - fixe) / 1.34));
      S = Math.max(260, Math.min(560, S));
      // Hystérésis (instruments sans réserve) : un pied qui change de longueur fait varier S de quelques pixels, donc
      // recalculer l'image à chaque fois (clignotement). On ne garde l'ancienne taille que si elle TIENT (S ne grandit pas :
      // jamais de dépassement qui masque la lecture) et que l'écart est petit.
      var dims = hR + "x" + wR;
      if (redim.dims === dims && S >= redim.S && S - redim.S < 24) S = redim.S;
      if (inst.reservePied) S = Math.floor(S / 8) * 8;      // pas de 8 px : un léger flottement de hauteur ne change pas la taille
      redim.dims = dims; redim.S = S;
      R.style.setProperty("--pl-s", S + "px");
      if (inst.redim) inst.redim(S);
    }
    var ro = root.ResizeObserver ? new root.ResizeObserver(redim) : null;
    // la tête et le pied de l'observation aussi : l'instrument les remplit après ce premier calcul (goniomètre : trois lignes)
    if (ro) { ro.observe(R); ro.observe(obsTete); ro.observe(obsPied); } else root.addEventListener("resize", redim);
    redim();

    // ----- boucle -----
    var raf = 0, fini = false;
    function boucle() { if (fini) return; try { inst.tick(); } finally { raf = root.requestAnimationFrame(boucle); } }
    raf = root.requestAnimationFrame ? root.requestAnimationFrame(boucle) : 0;

    return {
      stop: function () {
        fini = true;
        if (raf && root.cancelAnimationFrame) root.cancelAnimationFrame(raf);
        if (tSauve) { clearTimeout(tSauve); sauver(); }
        root.removeEventListener("pointermove", surMove); root.removeEventListener("pointerup", surUp);
        root.removeEventListener("pointercancel", surUp); root.removeEventListener("keydown", surTouche, true);
        root.removeEventListener("pointerdown", horsMenus); root.removeEventListener("keydown", echap, true);
        ["pointermove", "pointerup", "pointercancel"].forEach(function (t, i) {
          root.removeEventListener(t, i ? egUp : egMove); root.removeEventListener(t, i ? pgUp : pgMove);
        });
        if (ro) ro.disconnect(); else root.removeEventListener("resize", redim);
        if (inst.stop) inst.stop();
        R.remove(); if (pane) pane.classList.remove("paillasse-on");
        if (P.actif && P.actif.inst === inst) P.actif = null;
      },
      _inst: inst, _api: api
    };
  }

  P.svg = svg; P.hasard = hasard; P.memoire = memoire; P.monter = monter;
  P.Dessin = Dessin; P.ICONES = ICONES; P.ICO_AIDE = ICO_AIDE; P.ICO_PLEIN = ICO_PLEIN;
  root.VITRINE_APPS = root.VITRINE_APPS || {};
  root.VITRINE_APPS.paillasse = { monter: monter };
  if (typeof module !== "undefined" && module.exports) module.exports = { hasard: hasard, memoire: memoire };
})(typeof window !== "undefined" ? window : this);
