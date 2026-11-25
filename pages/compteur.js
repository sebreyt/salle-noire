// Créé par Claude
// Mesure d'audience ANONYME du site public des paillasses (route /api/compte) :
// rien n'est gardé dans le navigateur (ni cookie ni stockage) ; un numéro tiré au hasard à chaque ouverture de page
// relie seulement l'ouverture à ses minutes. Une minute compte si la page est visible ET a été manipulée dans les
// deux dernières minutes. Échec réseau : ignoré, la page n'en dépend pas.
(function () {
  "use strict";
  var app = document.body.getAttribute("data-app") || "accueil";
  var sid = "", ref = "", minutes = 0, geste = Date.now();
  for (var i = 0; i < 12; i++) sid += "abcdefghijklmnopqrstuvwxyz0123456789".charAt(Math.floor(Math.random() * 36));
  try {
    var r = document.referrer ? new URL(document.referrer) : null;
    if (r && r.host !== location.host) ref = r.host;
  } catch (e) {}
  function envoyer(evt) {
    var d = JSON.stringify({ app: app, sid: sid, evt: evt, ref: ref, min: minutes });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon("/api/compte", d)) return;
      fetch("/api/compte", { method: "POST", body: d, keepalive: true }).catch(function () {});
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
