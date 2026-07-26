/* ============================================================
   main.js — home page only. Renders the stacked index links from
   SITE.sections and wires the contact form. (Shared behaviour —
   smooth scroll, reveals, lightbox — lives in site.js.)
   ============================================================ */
(function () {
  "use strict";
  var S = window.SITE || {}, U = window.Site;

  /* ---------- stacked index links ---------- */
  var wrap = document.getElementById("indexLinks");
  if (wrap && S.sections) {
    S.sections.forEach(function (s) {
      var a = U.el("a", "index-link reveal");
      a.href = s.href;
      a.innerHTML =
        '<span class="index-link__row">' +
          '<span class="index-link__title">' + s.title + '</span>' +
          '<svg class="index-link__arrow" viewBox="0 0 24 24" aria-hidden="true">' +
            '<path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
          '</svg>' +
        '</span>' +
        '<span class="index-link__blurb">' + s.blurb + '</span>';
      wrap.appendChild(a);
    });
    U.reveal(wrap.querySelectorAll(".reveal"));
  }

  /* ---------- contact form → contact.php ---------- */
  var form = document.getElementById("contactForm");
  var status = document.getElementById("formStatus");
  if (form) {
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }
      var btn = form.querySelector(".btn-submit");
      var original = btn.textContent;
      btn.disabled = true; btn.textContent = "Sending…";
      status.className = "form__status"; status.textContent = "";
      fetch(form.action, { method: "POST", body: new FormData(form), headers: { "X-Requested-With": "fetch" } })
        .then(function (r) { return r.json().catch(function () { return { ok: r.ok }; }); })
        .then(function (d) {
          status.className = "form__status " + (d.ok ? "ok" : "err");
          status.textContent = d.message || (d.ok ? "Thanks — your message is on its way!" : "Something went wrong.");
          if (d.ok) form.reset();
        })
        .catch(function () {
          status.className = "form__status err";
          status.textContent = "Couldn't reach the server. Please try again later.";
        })
        .finally(function () { btn.disabled = false; btn.textContent = original; });
    });
  }
})();
