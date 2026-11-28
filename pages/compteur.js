// Créé par Claude
// Mesure d'audience ANONYME du site public des paillasses (route /api/compte) :
// rien n'est gardé dans le navigateur (ni cookie ni stockage) ; un numéro tiré au hasard à chaque ouverture de page
// relie seulement l'ouverture à ses minutes. Une minute compte si la page est visible ET a été manipulée dans les
// deux dernières minutes. Échec réseau : ignoré, la page n'en dépend pas.
// Deux sites sortent du même build (optique.cpge-michelet.fr en fr, lightbench.org en en) : `lang` du
// document dit de quel site vient la page, sinon les deux audiences se compteraient ensemble.
(function () {
  "use strict";
  var app = document.body.getAttribute("data-app") || "accueil";
  var langue = (document.documentElement.getAttribute("lang") || "").slice(0, 2).toLowerCase() === "en" ? "en" : "fr";
  // Le domaine anglais n'a pas de serveur applicatif : son compteur poste en ABSOLU vers celui du français.
  var api = langue === "en" ? "https://optique.cpge-michelet.fr/api/compte" : "/api/compte";
  var sid = "", ref = "", minutes = 0, geste = Date.now();
  for (var i = 0; i < 12; i++) sid += "abcdefghijklmnopqrstuvwxyz0123456789".charAt(Math.floor(Math.random() * 36));
  try {
    var r = document.referrer ? new URL(document.referrer) : null;
    if (r && r.host !== location.host) ref = r.host;
  } catch (e) {}
  function envoyer(evt) {
    var d = JSON.stringify({ app: app, sid: sid, evt: evt, ref: ref, min: minutes, langue: langue });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(api, d)) return;
      fetch(api, { method: "POST", body: d, keepalive: true }).catch(function () {});
    } catch (e) {}
  }
  ["pointerdown", "wheel", "keydown"].forEach(function (t) {
    addEventListener(t, function () { geste = Date.now(); }, { capture: true, passive: true });
  });
  envoyer("ouverture");
  if (app === "accueil") return;
  setInterval(function () {
    if (document.visibilityState === "visible" && Date.now() - geste < 120000) { minutes++; envoyer("minute"); }
  }, 60000);
})();
