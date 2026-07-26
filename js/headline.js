/* ============================================================
   headline.js — home page only. Hovering a headline word plays
   an effect ON THE CHROME LOGO (the words are only the trigger):
     Art.   → the mark fades to a traced pencil outline, then the
              real chrome colors itself back in like a drawing
     Code.  → the mark becomes flickering binary, every digit
              colored by the live chrome pixels, with a soft bloom
     Craft. → the mark shatters into little 3D blocks that tumble
              away into the dark, then blocks fly back in from all
              over and snap into place like an assembly
   All three sample the live WebGL render as their pixel source,
   so the glossy 3D look never goes away. While an effect runs the
   mark eases to face forward (.face-forward on .chrome — chrome.js
   steers the tilt to zero), and the overlay and the mark both read
   the same --tilt variable, so they always carry the exact same
   transform by construction. First and last frames are exact copies
   of the live mark — the handoff is invisible.
   ============================================================ */
(function () {
  "use strict";

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;

  var chrome = document.getElementById("chrome");
  var stage = document.getElementById("chromeCanvas");
  var words = [].slice.call(document.querySelectorAll(".headline .word[data-fx]"));
  if (!chrome || !stage || !words.length) return;

  var DPR = Math.min(window.devicePixelRatio || 1, 2);

  /* the logo silhouette, straight out of logo.svg (viewBox 0 0 1000 1000) —
     only the Art trace needs the vector; everything else reads pixels */
  var LOGO_D = "M947.56,510.4v173.06c0,46.37-24.74,89.22-64.9,112.41l-309.46,178.66c-46.6,26.9-102.41,32.8-153.6,16.22l-89.58-29c-47.05-15.23-53.79-79.02-10.96-103.75l360.39-208.07H212.77c-88.55,0-160.33-71.78-160.33-160.33v-173.07c0-46.37,24.74-89.22,64.9-112.41L426.81,25.47c46.6-26.9,102.41-32.8,153.6-16.22l89.58,29c47.05,15.23,53.79,79.02,10.96,103.75l-360.41,208.09h466.69c88.55,0,160.33,71.78,160.33,160.33Z";
  var LOGO_PATH = new Path2D(LOGO_D);
  /* the WebGL mark sits at ~84% of its stage; match it exactly */
  var FIT = 0.84;

  var LOGO_LEN = (function () {          // outline length for the dash-draw
    try {
      var NS = "http://www.w3.org/2000/svg";
      var svg = document.createElementNS(NS, "svg");
      var p = document.createElementNS(NS, "path");
      p.setAttribute("d", LOGO_D);
      svg.appendChild(p);
      svg.style.position = "absolute";
      svg.style.width = svg.style.height = "0";
      document.body.appendChild(svg);
      var len = p.getTotalLength();
      svg.remove();
      return len || 6000;
    } catch (e) { return 6000; }
  })();

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function smooth(p) { return p * p * (3 - 2 * p); }
  function backOut(p) {                  // gentle overshoot, no wobble
    var c1 = 0.9, c3 = c1 + 1, q = p - 1;
    return 1 + c3 * q * q * q + c1 * q * q;
  }

  var FX = {};

  /* ──────────────── Art. — drawn back in ────────────────
     The chrome fades out, a pencil line traces the real outline,
     then the live mark sweeps back in behind it like it's being
     colored in. Ends on the exact live render. */
  FX.draw = function (env) {
    var ctx = env.ctx, sw = env.sw, sh = env.sh, pad = env.pad;
    var fill = document.createElement("canvas");   // live mark, sweep-masked
    fill.width = sw * DPR; fill.height = sh * DPR;
    var f = fill.getContext("2d");
    f.scale(DPR, DPR);

    return { frame: function (t) {
      ctx.clearRect(0, 0, env.w, env.h);

      var away = 1 - clamp01(t / 220);            // chrome slips away first
      if (away > 0) env.drawLive(away);

      var fT = smooth(clamp01((t - 620) / 700));  // ...and sweeps back in
      if (fT > 0) {
        f.clearRect(0, 0, sw, sh);
        f.drawImage(env.gl, 0, 0, sw, sh);
        var soft = 0.16;
        var edge = fT * (1 + soft) - soft;
        var g = f.createLinearGradient(0, 0, sw, 0);
        g.addColorStop(0, "rgba(0,0,0,1)");
        var c0 = clamp01(edge);
        g.addColorStop(c0, "rgba(0,0,0,1)");
        g.addColorStop(Math.min(1, c0 + soft), "rgba(0,0,0,0)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        f.globalCompositeOperation = "destination-in";
        f.fillStyle = g;
        f.fillRect(0, 0, sw, sh);
        f.globalCompositeOperation = "source-over";
        ctx.drawImage(fill, pad, pad, sw, sh);
      }

      var oT = smooth(clamp01((t - 60) / 920));   // the pencil trace
      var oA = 1 - clamp01((t - 1300) / 280);
      if (oA > 0) {
        ctx.save();
        ctx.globalAlpha = oA;
        ctx.translate(env.ox, env.oy);
        ctx.scale(env.s, env.s);
        ctx.lineWidth = 3.2;                       // viewBox units
        ctx.lineCap = "round";
        ctx.strokeStyle = "rgba(246,245,242,.95)";
        ctx.setLineDash([LOGO_LEN * oT, LOGO_LEN]);
        ctx.stroke(LOGO_PATH);
        ctx.restore();
      }
      return t > 1620;                             // whole again — hand back
    } };
  };

  /* ──────────────── Code. — live binary ────────────────
     A grid of flickering 1s and 0s, each digit colored by the
     chrome pixel underneath it right now — tilt, shimmer and all —
     over a soft bloom of itself. Runs until the cursor leaves. */
  FX.binary = function (env) {
    var ctx = env.ctx, sw = env.sw, sh = env.sh, pad = env.pad;
    var cell = Math.max(9, Math.round(sw / 34));
    var cols = Math.ceil(sw / cell), rows = Math.ceil(sh / cell), n = cols * rows;
    var bits = new Uint8Array(n), phase = new Float32Array(n), spark = new Float32Array(n);
    for (var i = 0; i < n; i++) { bits[i] = Math.random() < 0.5 ? 1 : 0; phase[i] = Math.random() * 6.2832; }

    var tiny = document.createElement("canvas");   // live chrome → one px per cell
    tiny.width = cols; tiny.height = rows;
    var tc = tiny.getContext("2d", { willReadFrequently: true });

    var off = document.createElement("canvas");    // the digit layer
    off.width = sw * DPR; off.height = sh * DPR;
    var o = off.getContext("2d");
    o.scale(DPR, DPR);
    o.font = "500 " + (cell * 1.12) + "px ui-monospace, 'SF Mono', Menlo, monospace";
    o.textAlign = "center"; o.textBaseline = "middle";

    var lastFlip = -1e9;
    return { frame: function (t) {
      if (t - lastFlip > 75) {                     // digits churn ~13×/second
        lastFlip = t;
        for (var i = 0; i < n; i++) {
          if (Math.random() < 0.08) { bits[i] ^= 1; spark[i] = 1; }
        }
      }
      tc.clearRect(0, 0, cols, rows);
      tc.drawImage(env.gl, 0, 0, cols, rows);
      var px = tc.getImageData(0, 0, cols, rows).data;

      o.clearRect(0, 0, sw, sh);
      for (var r = 0; r < rows; r++) {
        var cy = r * cell + cell / 2;
        for (var c = 0; c < cols; c++) {
          var i2 = r * cols + c, k = i2 * 4;
          var a = px[k + 3];
          if (a < 26) { spark[i2] *= 0.86; continue; }
          var b = 0.78 + 0.3 * Math.sin(phase[i2] + t * 0.006) + spark[i2] * 0.9;
          spark[i2] *= 0.86;
          o.fillStyle = "rgba(" +
            Math.min(255, px[k] * b | 0) + "," +
            Math.min(255, px[k + 1] * b | 0) + "," +
            Math.min(255, px[k + 2] * b | 0) + "," +
            (a / 255).toFixed(3) + ")";
          o.fillText(bits[i2] ? "1" : "0", c * cell + cell / 2, cy);
        }
      }

      ctx.clearRect(0, 0, env.w, env.h);
      var entry = clamp01(t / 240);                // dissolve out of the chrome
      if (entry < 1) env.drawLive(1 - entry);
      ctx.filter = "blur(" + (cell * 0.55) + "px)";   // bloom underlay
      ctx.globalAlpha = entry * 0.8;
      ctx.drawImage(off, pad, pad, sw, sh);
      ctx.filter = "none";
      ctx.globalAlpha = entry;
      ctx.drawImage(off, pad, pad, sw, sh);
      ctx.globalAlpha = 1;
      return false;
    } };
  };

  /* ──────────────── Craft. — assembly ────────────────
     Every cell of the stage becomes a little 3D block. Each one gets
     a random throw — outward direction, a depth kick toward or away
     from the camera, a spin and a tumbling flip — and they scatter in
     a loosely top-down but heavily randomized order. After a beat of
     empty, blocks fly back in from a *different* scatter (so the
     rebuild reads as assembly, not a reversed explosion), loosely
     bottom-up, and every block lands exactly on its grid spot.
     Blocks are cut from the live render each frame, so the chrome
     keeps moving inside them; the final frame is the live mark. */
  FX.blocks = function (env) {
    var ctx = env.ctx, sw = env.sw, sh = env.sh, pad = env.pad;
    var cell = Math.max(12, Math.round(sw / 22));
    var cols = Math.ceil(sw / cell), rows = Math.ceil(sh / cell);
    var fxs, fys;   // buffer→CSS ratio, re-read each frame (the buffer can resize)
    var P = 900;    // same perspective depth as the mark's CSS tilt

    var OUT = 320, IN = 360, BEAT = 150;

    function throwFrom(base) {      // one random 3D trajectory
      var ang = base + rand(-1.2, 1.2);
      var d = rand(0.22, 0.5) * sw;
      return {
        x: Math.cos(ang) * d,
        y: Math.sin(ang) * d,
        z: rand(-220, 300),                       // toward / away from camera
        spin: rand(-2.6, 2.6),                    // screen-plane rotation
        tum: rand(1.8, 4.6) * (Math.random() < 0.5 ? -1 : 1),   // 3D flip
        ax: Math.random() < 0.5                   // ...about x or y axis
      };
    }

    var cells = [], lastIn = 0;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var base = Math.atan2((r + 0.5) * cell - sh / 2, (c + 0.5) * cell - sw / 2);
        cells.push({
          c: c, r: r,
          out: throwFrom(base), inn: throwFrom(base),
          vanishAt: r * 5 + rand(0, 300)          // top-down bias, mostly chaos
        });
      }
    }
    var HOLD_END = (rows - 1) * 5 + 300 + OUT + BEAT;
    cells.forEach(function (cl) {
      cl.rebuildAt = HOLD_END + (rows - 1 - cl.r) * 7 + rand(0, 320);   // bottom-up-ish
      if (cl.rebuildAt > lastIn) lastIn = cl.rebuildAt;
    });
    var wholeAt = lastIn + IN;

    function seated(cl) {           // a block sitting exactly on its grid spot
      ctx.drawImage(env.gl, cl.c * cell * fxs, cl.r * cell * fys, cell * fxs, cell * fys,
                    pad + cl.c * cell, pad + cl.r * cell, cell, cell);
    }

    function piece(cl, v, g) {      // g: 0 = seated, 1 = fully scattered
      var a = 1 - smooth(clamp01((g - 0.35) / 0.45));   // gone by g ≈ 0.8
      if (a <= 0.01) return;
      var tum = Math.cos(v.tum * g);
      var flat = Math.abs(tum) < 0.06 ? (tum < 0 ? -0.06 : 0.06) : tum;
      var persp = P / (P - v.z * g);
      ctx.save();
      // edge-on blocks go translucent — on the dark page that reads as shading
      ctx.globalAlpha = a * (0.55 + 0.45 * Math.abs(tum));
      ctx.translate(pad + cl.c * cell + cell / 2 + v.x * g,
                    pad + cl.r * cell + cell / 2 + v.y * g);
      ctx.rotate(v.spin * g);
      ctx.scale(persp * (v.ax ? flat : 1), persp * (v.ax ? 1 : flat));
      ctx.drawImage(env.gl, cl.c * cell * fxs, cl.r * cell * fys, cell * fxs, cell * fys,
                    -cell / 2, -cell / 2, cell, cell);
      ctx.restore();
    }

    return { frame: function (t) {
      fxs = env.gl.width / sw; fys = env.gl.height / sh;
      ctx.clearRect(0, 0, env.w, env.h);
      if (t >= wholeAt) {
        env.drawLive(1);                           // every pixel back, exactly
        return t > wholeAt + 200;
      }
      var flights = [];
      for (var i = 0; i < cells.length; i++) {
        var cl = cells[i];
        if (t < cl.vanishAt) { seated(cl); continue; }
        if (t < cl.vanishAt + OUT) {
          var p = (t - cl.vanishAt) / OUT;
          flights.push({ cl: cl, v: cl.out, g: p * p });          // fling away
        } else if (t >= cl.rebuildAt) {
          var q = Math.min(1, (t - cl.rebuildAt) / IN);
          var g = (1 - q) * (1 - q) * (1 - q);                    // slam home, settle
          if (g < 0.001) { seated(cl); continue; }
          flights.push({ cl: cl, v: cl.inn, g: g });
        }
      }
      // painter's order: farthest blocks first, nearest on top
      flights.sort(function (A, B) { return A.v.z * A.g - B.v.z * B.g; });
      for (var j = 0; j < flights.length; j++) piece(flights[j].cl, flights[j].v, flights[j].g);
      return false;
    } };
  };
  FX.blocks.pad = 0.5;   // flying blocks need room well past the mark's box

  /* ──────────────── controller ────────────────
     The overlay's first frame is an exact copy of the live mark,
     painted before the real canvas is hidden — and the mark is
     hidden with transition:none so the swap lands in one paint.
     Coming back, the mark fades in under the fading overlay. */
  var ownerSeq = 0, owner = 0;

  function start(make) {
    var sw = stage.clientWidth, sh = stage.clientHeight;
    if (!sw || !sh || !stage.width) return null;

    // right after page load the mark may not have rendered yet (its
    // normal maps build async) — sampling an empty buffer would play
    // the effect on nothing, so keep the real logo until it's there
    var probe = document.createElement("canvas");
    probe.width = probe.height = 4;
    var pc = probe.getContext("2d");
    pc.drawImage(stage, 0, 0, 4, 4);
    var pd = pc.getImageData(0, 0, 4, 4).data;
    if (pd[3] < 8 && pd[23] < 8 && pd[43] < 8 && pd[63] < 8) return null;
    var pad = Math.ceil(sw * (make.pad || 0.1));   // effects can ask for more room
    var w = sw + pad * 2, h = sh + pad * 2;

    // match the mark's own backing resolution so live copies are 1:1
    // pixels — resampling made the handoff look slightly soft
    var os = Math.min(3, stage.width / sw) || DPR;

    var canvas = document.createElement("canvas");
    canvas.className = "word-fx";
    canvas.width = Math.round(w * os); canvas.height = Math.round(h * os);
    canvas.style.width = w + "px"; canvas.style.height = h + "px";
    canvas.style.left = -pad + "px"; canvas.style.top = -pad + "px";
    var ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.scale(os, os);

    var env = {
      ctx: ctx, w: w, h: h, pad: pad, sw: sw, sh: sh, gl: stage,
      ox: pad + sw * (1 - FIT) / 2,
      oy: pad + sh * (1 - FIT) / 2,
      s: (sw * FIT) / 1000,
      drawLive: function (a) {
        ctx.globalAlpha = a == null ? 1 : a;
        ctx.drawImage(stage, pad, pad, sw, sh);
        ctx.globalAlpha = 1;
      }
    };

    var my = ++ownerSeq; owner = my;
    var fx = make(env);

    chrome.appendChild(canvas);
    env.drawLive(1);                               // exact copy first…
    stage.style.transition = "none";               // …then swap invisibly
    stage.style.opacity = "0";
    chrome.classList.add("face-forward");          // ease the mark flat

    var t0 = performance.now(), raf = 0, dead = false;
    var mode = "run", untilTs = Infinity;

    function restoreMark(ms) {
      stage.style.transition = "opacity " + ms + "ms ease";
      stage.style.opacity = "1";
      canvas.classList.add("out");
      untilTs = performance.now() + 380;
    }
    function cleanup() {
      if (dead) return;
      dead = true;
      cancelAnimationFrame(raf);
      canvas.remove();
      if (owner === my) {                          // don't undo a newer run
        stage.style.transition = "";
        stage.style.opacity = "";
        chrome.classList.remove("face-forward");   // tilt resumes
      }
    }
    function loop(now) {
      if (dead) return;
      if (stage.clientWidth !== sw || stage.clientHeight !== sh) {
        cleanup();                                 // layout changed mid-run:
        return;                                    // hand straight back
      }
      var t = now - t0;
      if (mode === "run") {
        if (fx.frame(t)) {
          // the overlay now shows an exact copy of the live mark — swap
          // in a single paint; crossfading two copies reads as a smear
          // whenever the tilt moves between frames
          cleanup();
          return;
        }
      } else {
        fx.frame(t);                               // keep moving while fading
      }
      if (now > untilTs) { cleanup(); return; }
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);

    return {
      leave: function () {
        if (dead || mode !== "run") return;
        mode = "fade";                             // interrupted: crossfade back
        chrome.classList.remove("face-forward");   // tilt resumes right away
        restoreMark(220);
      },
      cancel: cleanup
    };
  }

  words.forEach(function (word) {
    var make = FX[word.getAttribute("data-fx")];
    if (!make) return;
    var run = null;
    word.addEventListener("mouseenter", function () {
      if (run) run.cancel();
      run = start(make);
    });
    word.addEventListener("mouseleave", function () {
      if (run) { run.leave(); run = null; }
    });
  });
})();
