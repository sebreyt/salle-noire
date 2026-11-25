// Créé par Claude — sommaire des pages de documentation du site public (doc.css) : sur écran étroit, le sommaire
// (<nav class="sommaire"><details>) part replié ; le bouton « Sommaire » de la barre le rouvre et y ramène, un clic sur
// une entrée le referme. Sur grand écran il reste ouvert (colonne de gauche), le résumé n'y est pas cliquable.
(function () {
  var etroit = window.matchMedia("(max-width:900px)");
  var d = document.querySelector("nav.sommaire details");
  if (!d) return;
  function caler() { d.open = !etroit.matches; }
  caler();
  if (etroit.addEventListener) etroit.addEventListener("change", caler);
  d.addEventListener("click", function (e) {
    // Replier change la hauteur de tout ce qui suit : le saut natif vers l'ancre, calculé avant, tomberait à côté.
    var a = e.target.closest("a");
    if (!etroit.matches || !a) return;
    var cible = document.getElementById(a.getAttribute("href").slice(1));
    if (!cible) return;
    e.preventDefault();
    d.open = false;
    history.pushState(null, "", a.getAttribute("href"));
    cible.scrollIntoView({ behavior: "smooth" });
  });
  var b = document.querySelector(".barre .vers-sommaire");
  if (b) b.addEventListener("click", function () { d.open = true; });
})();
