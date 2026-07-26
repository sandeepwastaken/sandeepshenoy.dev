/* ============================================================
   site.js — shared helpers used by every page.
   Exposes window.Site with: lenis smooth scroll, reveal-on-scroll,
   a reusable lightbox, and small render utilities.
   ============================================================ */
(function () {
  "use strict";

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- smooth scroll ----------
     Skipped on the 3D gallery page: its camera already lerps toward the
     scroll position, and stacking Lenis on top double-smooths into mush. */
  var lenis = null;
  var noLenis = document.body.classList.contains("gallery-page") ||
                document.body.classList.contains("theater-page");
  if (window.Lenis && !reduce && !noLenis) {
    lenis = new window.Lenis({ lerp: 0.09, smoothWheel: true });
    (function raf(t) { lenis.raf(t); requestAnimationFrame(raf); })();
    window.__lenis = lenis;
  }
  function scrollToTarget(el) {
    if (lenis) lenis.scrollTo(el, { duration: 1.2 });
    else el.scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
  }
  // in-page anchor links
  document.querySelectorAll('a[data-scroll]').forEach(function (a) {
    a.addEventListener("click", function (e) {
      var id = a.getAttribute("href");
      if (!id || id[0] !== "#") return;
      var el = id === "#top" ? document.body : document.querySelector(id);
      if (!el) return;
      e.preventDefault();
      scrollToTarget(el);
    });
  });

  /* ---------- page transitions ----------
     Each page's <head> stamps html.pt before first paint (body starts
     transparent); here we fade it in, and fade out before following any
     internal link so navigations crossfade through the dark background.
     Runs in the bubble phase so per-link handlers (data-scroll, lightboxes)
     can preventDefault first and opt out. */
  var root = document.documentElement;
  var GALLERY = /^\/gallery(\/|$)/;
  var pageIn = function () {
    root.classList.remove("pt-out", "pt-out-left", "pt-out-right");
    // rAF lets the hidden state paint first so the transition runs, but it
    // stalls in throttled/background tabs — the timeout guarantees entry.
    var entered = false;
    var enter = function () {
      if (entered) return;
      entered = true;
      root.classList.add("pt-in");
    };
    requestAnimationFrame(enter);
    setTimeout(enter, 150);
  };
  if (root.classList.contains("pt")) {
    var OUT_MS = 240;

    var beginEnter = function () {
      // directional entrance requested by the page we came from (gallery swipe)
      var enterDir = "";
      try {
        enterDir = sessionStorage.getItem("ptEnter") || "";
        sessionStorage.removeItem("ptEnter");
      } catch (err) {}
      if (enterDir && !reduce) {
        root.classList.add("pt-" + enterDir);
        // drop the swipe class once it has played — a lingering transform
        // animation would keep hijacking hover/scroll transforms inside main
        var swipeDone = function () {
          root.classList.remove("pt-from-right", "pt-from-left");
        };
        document.addEventListener("animationend", function (ev) {
          if (ev.animationName === "ptFromRight" || ev.animationName === "ptFromLeft") swipeDone();
        });
        setTimeout(swipeDone, 900);
      }
      pageIn();
    };
    // prerendered pages (speculation rules) hold the entrance until they're
    // actually on screen, otherwise it plays invisibly before activation
    if (document.prerendering) document.addEventListener("prerenderingchange", beginEnter, { once: true });
    else beginEnter();

    // restored from the back/forward cache — the leave state is still applied
    window.addEventListener("pageshow", function (e) {
      if (!e.persisted) return;
      try { sessionStorage.removeItem("ptEnter"); } catch (err) {}
      pageIn();
    });

    document.addEventListener("click", function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target && e.target.closest && e.target.closest("a[href]");
      if (!a || a.target || a.hasAttribute("download")) return;
      var url;
      try { url = new URL(a.href, location.href); } catch (err) { return; }
      if (url.origin !== location.origin) return;
      // in-page anchors scroll, they don't navigate
      if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
      e.preventDefault();

      // returning to the exact page we came from? go through history so the
      // browser restores it instantly from the back/forward cache (scroll
      // position and all) instead of reloading it
      var goBack = false;
      try {
        var ref = document.referrer ? new URL(document.referrer) : null;
        goBack = !!ref && ref.origin === location.origin &&
                 ref.pathname === url.pathname && history.length > 1;
      } catch (err) {}
      var go = function () { if (goBack) history.back(); else location.href = url.href; };
      if (reduce) { go(); return; }

      // gallery gets a directional swipe; everything else crossfades
      var toGallery = GALLERY.test(url.pathname);
      var fromGallery = document.body.classList.contains("gallery-page");
      var outClass = "pt-out";
      try {
        if (toGallery && !fromGallery) { outClass = "pt-out-left"; sessionStorage.setItem("ptEnter", "from-right"); }
        else if (fromGallery && !toGallery) { outClass = "pt-out-right"; sessionStorage.setItem("ptEnter", "from-left"); }
      } catch (err) {}
      root.classList.remove("pt-in");
      root.classList.add(outClass);
      setTimeout(go, OUT_MS);
      // failsafe: if the navigation stalls, bring the page back
      setTimeout(pageIn, OUT_MS + 2000);
    });
  }

  /* ---------- reveal on scroll ---------- */
  function reveal(nodes) {
    nodes = [].slice.call(nodes);
    if (!("IntersectionObserver" in window)) { nodes.forEach(function (n) { n.classList.add("in"); }); return; }
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); obs.unobserve(e.target); }
      });
    }, { threshold: 0.14 });
    nodes.forEach(function (n) { obs.observe(n); });
  }

  /* ---------- current year stamps ---------- */
  [].slice.call(document.querySelectorAll('[data-year]')).forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });

  /* ---------- lightbox (built on demand) ----------
     items: [{src, title, meta}], returns { open(i) } */
  function createLightbox(items) {
    var lb = document.createElement("div");
    lb.className = "lightbox";
    lb.setAttribute("role", "dialog");
    lb.setAttribute("aria-modal", "true");
    lb.setAttribute("data-lenis-prevent", "");
    lb.hidden = true;
    lb.innerHTML =
      '<button class="lightbox__btn lightbox__close" aria-label="Close">&times;</button>' +
      '<button class="lightbox__btn lightbox__prev" aria-label="Previous">&#8249;</button>' +
      '<figure class="lightbox__fig"><img alt=""><figcaption></figcaption></figure>' +
      '<button class="lightbox__btn lightbox__next" aria-label="Next">&#8250;</button>';
    document.body.appendChild(lb);

    var img = lb.querySelector("img");
    var cap = lb.querySelector("figcaption");
    var idx = 0;

    function show(i) {
      idx = (i + items.length) % items.length;
      var it = items[idx];
      img.src = it.src; img.alt = it.title || "";
      cap.textContent = (it.title || "") + (it.meta ? "  ·  " + it.meta : "");
    }
    function open(i) {
      show(i); lb.hidden = false;
      requestAnimationFrame(function () { lb.classList.add("open"); });
      if (lenis) lenis.stop();
      document.addEventListener("keydown", onKey);
    }
    function close() {
      lb.classList.remove("open");
      setTimeout(function () { lb.hidden = true; img.src = ""; }, 300);
      if (lenis) lenis.start();
      document.removeEventListener("keydown", onKey);
    }
    function onKey(e) {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") show(idx + 1);
      else if (e.key === "ArrowLeft") show(idx - 1);
    }
    lb.querySelector(".lightbox__close").addEventListener("click", close);
    lb.querySelector(".lightbox__prev").addEventListener("click", function () { show(idx - 1); });
    lb.querySelector(".lightbox__next").addEventListener("click", function () { show(idx + 1); });
    lb.addEventListener("click", function (e) { if (e.target === lb) close(); });
    return { open: open };
  }

  /* ---------- helpers ---------- */
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function byDateDesc(a, b) { return (b.date || "").localeCompare(a.date || ""); }
  function prettyDate(s) {
    if (!s) return "";
    var d = new Date(s + "T00:00:00");
    if (isNaN(d)) return s;
    return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  }

  window.Site = {
    lenis: lenis,
    reduce: reduce,
    reveal: reveal,
    scrollToTarget: scrollToTarget,
    createLightbox: createLightbox,
    el: el,
    byDateDesc: byDateDesc,
    prettyDate: prettyDate
  };
})();
