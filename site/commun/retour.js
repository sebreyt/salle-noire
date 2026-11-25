// Créé par Claude
// Formulaire « Un bug, une idée ? » du site public optique (route POST /api/retour) :
// type, instrument, description, signature facultative ; sur une page d'instrument, l'état gardé par le navigateur
// (capturer() de l'instance, sinon la clé de sauvegarde de l'instrument) peut être joint pour reproduire un bug. Pose
// window.OPTIQUE_RETOUR.ouvrir(instrument) (appelé par le panneau « ? » des instruments) et branche les [data-retour].
(function () {
  "use strict";
  var NOMS = { michelson: "Michelson", goniometre: "Goniomètre", banc: "Banc d'optique", site: "Le site" };
  var app = document.body.getAttribute("data-app") || "";
  var surInstrument = !!NOMS[app] && app !== "site";
  var css = document.createElement("style");
  css.textContent =
    ".rt-voile{position:fixed;inset:0;z-index:100000;background:#000a;display:flex;align-items:center;justify-content:center;padding:16px}" +
    ".rt-boite{width:min(520px,100%);max-height:100%;overflow:auto;background:#0f1216;color:#c9cfd8;border:1px solid #2a313b;border-radius:10px;" +
    "padding:18px 20px;font:15px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;box-shadow:0 10px 40px #000c}" +
    ".rt-boite h2{margin:0 0 12px;font-size:19px;color:#eef1f5;font-weight:620}" +
    ".rt-boite label{display:block;margin:12px 0 4px;font-size:13px;color:#8a939f}" +
    ".rt-boite textarea,.rt-boite input[type=text],.rt-boite select{width:100%;box-sizing:border-box;background:#08090b;color:#e6e9ee;" +
    "border:1px solid #2a313b;border-radius:6px;padding:8px 10px;font:inherit}" +
    ".rt-boite textarea{min-height:130px;resize:vertical}" +
    ".rt-seg{display:flex;gap:6px}.rt-seg button{flex:1;padding:7px;border:1px solid #2a313b;border-radius:6px;background:#08090b;color:#c9cfd8;font:inherit;cursor:pointer}" +
    ".rt-seg button.on{border-color:#e0b84c;color:#e0b84c;background:#16130b}" +
    ".rt-case{display:flex;gap:8px;align-items:flex-start;margin-top:12px;font-size:14px}.rt-case input{margin-top:4px}" +
    ".rt-pied{display:flex;gap:10px;justify-content:flex-end;align-items:center;margin-top:16px}" +
    ".rt-pied button{padding:8px 16px;border-radius:6px;font:inherit;font-weight:600;cursor:pointer;border:1px solid #2a313b;background:#08090b;color:#c9cfd8}" +
    ".rt-pied button.ok{border-color:#e0b84c;background:#e0b84c;color:#14110a}.rt-msg{flex:1;font-size:13.5px;color:#8a939f}.rt-msg.err{color:#e57373}" +
    ".rt-piege{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}";
  document.head.appendChild(css);

  function ouvrir(instrument) {
    if (document.querySelector(".rt-voile")) return;
    instrument = NOMS[instrument] ? instrument : (surInstrument ? app : "site");
    var type = "bug";
    var v = document.createElement("div");
    v.className = "rt-voile";
    v.innerHTML = '<form class="rt-boite"><h2>Un bug, une idée ?</h2>' +
      '<div class="rt-seg"><button type="button" data-t="bug" class="on">Bug</button><button type="button" data-t="suggestion">Suggestion</button></div>' +
      '<label>Instrument</label><select name="instrument">' +
      Object.keys(NOMS).map(function (k) { return '<option value="' + k + '"' + (k === instrument ? " selected" : "") + ">" + NOMS[k] + "</option>"; }).join("") +
      '</select><label>Description</label><textarea name="texte" maxlength="4000" required placeholder="Ce qui se passe, ce qui était attendu, comment le refaire…"></textarea>' +
      '<label>Signature (facultative)</label><input type="text" name="signature" maxlength="200" placeholder="Nom ou adresse, si vous souhaitez une réponse">' +
      '<div class="rt-piege" aria-hidden="true"><input type="text" name="site" tabindex="-1" autocomplete="off"></div>' +
      (surInstrument ? '<label class="rt-case"><input type="checkbox" name="etat" checked> <span>Joindre l\'état de l\'instrument (réglages en cours, pour reproduire le problème)</span></label>' : "") +
      '<div class="rt-pied"><span class="rt-msg"></span><button type="button" class="rt-annuler">Annuler</button><button type="submit" class="ok">Envoyer</button></div></form>';
    document.body.appendChild(v);
    var f = v.querySelector("form"), msg = v.querySelector(".rt-msg"), caseEtat = f.querySelector("input[name=etat]");
    function fermer() { v.remove(); removeEventListener("keydown", echap, true); }
    function echap(ev) { if (ev.key === "Escape") { ev.stopPropagation(); fermer(); } else ev.stopPropagation(); }
    addEventListener("keydown", echap, true);     // les touches ne partent pas vers l'instrument (raccourcis à une lettre)
    v.addEventListener("pointerdown", function (ev) { if (ev.target === v) fermer(); });
    v.querySelector(".rt-annuler").onclick = fermer;
    v.querySelectorAll(".rt-seg button").forEach(function (b) {
      b.onclick = function () {
        type = b.getAttribute("data-t");
        v.querySelectorAll(".rt-seg button").forEach(function (c) { c.classList.toggle("on", c === b); });
        if (caseEtat) caseEtat.checked = type === "bug";
      };
    });
    f.onsubmit = function (ev) {
      ev.preventDefault();
      var texte = f.texte.value.trim();
      if (texte.length < 3) { msg.className = "rt-msg err"; msg.textContent = "Décrivez le problème ou l'idée."; return; }
      var etat = null;
      if (caseEtat && caseEtat.checked) {
        // l'état en cours (ce que la coque sauverait) ; à défaut, le dernier sauvé
        try {
          var P = window.VITRINE_PAILLASSE, I = P && P.actif && P.actif.inst;
          etat = I && I.capturer ? I.capturer() : JSON.parse(localStorage.getItem("vitrine-paillasse-" + app + "-v1") || "null");
        } catch (e) { etat = null; }
      }
      var d = { type: type, instrument: f.instrument.value, texte: texte, signature: f.signature.value.trim(), site: f.site.value,
        page: location.pathname, ecran: innerWidth + "x" + innerHeight, etat: etat };
      msg.className = "rt-msg"; msg.textContent = "Envoi…";
      f.querySelector("button.ok").disabled = true;
      fetch("/api/retour", { method: "POST", body: JSON.stringify(d) }).then(function (r) {
        if (r.ok) { f.innerHTML = '<h2>Merci</h2><p>Votre message est bien arrivé.</p><div class="rt-pied"><button type="button" class="ok">Fermer</button></div>'; f.querySelector("button").onclick = fermer; return; }
        return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.erreur || "Envoi refusé (" + r.status + ")."); });
      }).catch(function (e) {
        msg.className = "rt-msg err"; msg.textContent = e.message || "Envoi impossible.";
        var b = f.querySelector("button.ok"); if (b) b.disabled = false;
      });
    };
    f.texte.focus();
  }
  window.OPTIQUE_RETOUR = { ouvrir: ouvrir };
  document.querySelectorAll("[data-retour]").forEach(function (b) {
    b.addEventListener("click", function (ev) { ev.preventDefault(); ouvrir(b.getAttribute("data-retour")); });
  });
})();
