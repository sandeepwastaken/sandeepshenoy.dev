/* ============================================================
   chrome.js — renders logo.svg as an animated 3D chrome mark.
   The SVG silhouette becomes a smooth beveled surface; per-pixel
   normals are computed in JS at full precision (no 8-bit height
   banding) and lit with a matcap-style chrome environment.
   Swap logo.svg and this updates automatically.
   ============================================================ */
(function () {
  "use strict";

  var canvas = document.getElementById("chromeCanvas");
  if (!canvas) return;

  // preserveDrawingBuffer: headline.js samples this canvas each frame
  // for the hover effects (the loop clears explicitly, so no ghosting)
  var gl = canvas.getContext("webgl", { premultipliedAlpha: true, antialias: true, alpha: true, preserveDrawingBuffer: true });
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!gl) {
    var img = new Image();
    img.src = "logo.svg"; img.alt = "";
    img.style.cssText = "width:78%;height:78%;object-fit:contain;margin:11% auto;display:block;filter:brightness(.85)";
    canvas.replaceWith(img);
    return;
  }

  /* ---------- shaders ---------- */
  var VERT =
    "attribute vec2 p;varying vec2 uv;" +
    "void main(){uv=p*0.5+0.5;gl_Position=vec4(p,0.,1.);}";

  var FRAG = [
    "precision highp float;",
    "varying vec2 uv;",
    "uniform sampler2D uNormal;",   // RG = encoded normal.xy, A = coverage
    "uniform sampler2D uScratch;",  // scratch/roughness texture
    "uniform float uTime;",
    "uniform vec2 uTilt;",          // hover tilt: shifts the lighting slightly
    "float bar(float y,float c,float w){float d=(y-c)/w;return exp(-d*d);}",
    "",
    "// scene pass: monochrome chrome shading, premultiplied into the FBO.",
    "// Bloom + chromatic aberration happen in the post pass.",
    "float shade(vec2 suv, out float covOut){",
    "  vec4 s = texture2D(uNormal, suv);",
    "  covOut = s.a;",
    "  // scratch.png is near-black with bright hairline streaks — any",
    "  // brightness IS a scratch. Two offset scales break up repetition.",
    "  vec2 suv1 = fract(suv*1.65 + vec2(0.13, 0.07));",
    "  vec2 suv2 = fract(suv*3.70 + vec2(0.41, 0.23));",
    "  float s1 = texture2D(uScratch, suv1).r;",
    "  float s2 = texture2D(uScratch, suv2).r;",
    "  // high floor: only genuine bright hairlines count — the texture's",
    "  // broad faint smudges would otherwise read as dirt on the face",
    "  float rough = smoothstep(0.17, 0.60, s1*1.35 + s2*0.85);",
    "  // groove slope: the gradient points across each hairline. It bends",
    "  // the normal a little — and deflects the light bands a lot, so a",
    "  // reflection visibly jumps as it crosses a scratch",
    "  float e = 2.0/512.0;",
    "  vec2 slope = vec2(texture2D(uScratch, suv1 + vec2(e, 0.0)).r - s1,",
    "                    texture2D(uScratch, suv1 + vec2(0.0, e)).r - s1)",
    "             + vec2(texture2D(uScratch, suv2 + vec2(e, 0.0)).r - s2,",
    "                    texture2D(uScratch, suv2 + vec2(0.0, e)).r - s2) * 0.6;",
    "  vec2 grain = slope * 0.12;",
    "  vec2 nxy = s.rg*2.0-1.0;",
    "  float nz = sqrt(max(0.0, 1.0 - dot(nxy,nxy)));",
    "  vec3 n = normalize(vec3(nxy + grain + uTilt*0.16, max(nz, 0.08)));",
    "  float t = uTime;",
    "  float rho = length(n.xy);",         // 0 on flat face, ~1 at the rim
    "  float rim  = smoothstep(0.74, 0.97, rho);",
    "  float rimHot = smoothstep(0.91, 0.996, rho);",
    "  float rimSoft = smoothstep(0.45, 0.86, rho);",
    "  float corner = pow(rho, 16.0);",
    "  // dark glass body: keep the material nearly black, with roughness breaking the sheen",
    "  float face = 0.010 + 0.026*pow(n.y*0.5+0.5, 2.35)*n.z;",
    "  face += 0.012*smoothstep(-0.25, 0.75, suv.x)*smoothstep(1.05, 0.25, suv.y);",
    "  // soft studio cards reflected across the broad face",
    "  // panels ride the normal hard enough to visibly bend over curvature,",
    "  // the way a studio softbox smears around a fender",
    "  float panelA = bar(suv.x*0.68 + suv.y*0.58 + n.x*0.16, 0.72, 0.16);",
    "  float panelB = bar(suv.x*0.28 - suv.y*0.82 + n.y*0.17, -0.32, 0.20);",
    "  float panelC = bar(suv.x*0.92 + suv.y*0.10 + n.x*0.10, 0.40, 0.11);",
    "  // rim highlights stay thin and local instead of becoming a white border",
    "  float env = bar(n.y, 0.70, 0.034)*0.16 + bar(n.y, -0.58, 0.042)*0.070",
    "            + bar(n.x, 0.86, 0.050)*0.080 + bar(n.x, -0.82, 0.048)*0.050;",
    "  // rolling shine: a repeating train of soft light bands drifting in ONE",
    "  // direction across the mark (like reflections of passing strip lights),",
    "  // kinking where the surface bends via the normal offset",
    "  // strong normal coupling: the band is a reflected feature, so it",
    "  // wraps and kinks around the surface instead of sliding across it",
    "  float axis = suv.x*0.72 + suv.y*0.55 + (n.x*0.32 - n.y*0.20);",
    "  // ...and its edge is not a ruler: a slow drifting meander (three",
    "  // incommensurate sines along the band) keeps it organic",
    "  float perp = suv.x*0.55 - suv.y*0.72;",
    "  float wob = sin(perp*7.3 + t*0.35)*0.5 + sin(perp*13.1 - t*0.22)*0.3",
    "            + sin(perp*23.7 + t*0.51)*0.2;",
    "  float ph = fract(axis*1.35 - t*0.08 + dot(slope, vec2(0.85, -0.55))*0.075 + wob*0.022);",
    "  float d = ph - 0.5;",
    "  float spill = exp(-pow(d/0.30, 2.0));",
    "  float halo  = exp(-pow(d/0.095, 2.0));",
    "  float core  = exp(-pow(d/0.034, 2.0));",
    "  // a second, dimmer band half a period behind keeps the surface alive",
    "  float ph2 = fract(ph + 0.5) - 0.5;",
    "  float band2 = exp(-pow(ph2/0.10, 2.0)) * 0.20;",
    "  // brushed-metal response: scratches carve visible streaks through",
    "  // every reflection — dark grooves inside the light, bright burrs",
    "  // just outside it",
    "  // scratches live in the reflections: they modulate the moving",
    "  // light, not the resting color of the metal",
    "  float brush = mix(0.48, 1.05, rough);",
    "  float glintWin = bar(n.y, 0.16, 0.06) * bar(n.x, 0.10, 0.07);",
    "  float glint = rough * glintWin * (1.0 - rimSoft);",
    "  // deep black face, one crisp hot streak: the wash stays faint so",
    "  // the mark keeps its glassy contrast. Grazing metal catches more of",
    "  // the environment than the flat face (cheap fresnel).",
    "  float fres = 0.72 + 0.85*(1.0 - n.z);",
    "  // the streak's brightness drifts along its length — real reflections",
    "  // have hot spots, not uniform intensity",
    "  float hot = 0.85 + 0.30*sin(perp*9.7 + t*0.30);",
    "  float shine = ((spill*0.008 + halo*0.030)*brush",
    "              + (core + band2)*(0.72 + 1.25*rimHot)*mix(0.55, 1.18, rough)*hot) * fres;",
    "  float wear = rough * (halo*0.16 + band2*0.22) * (0.3 + 0.7*rimSoft);",
    "  float c = face + (panelA*0.030 + panelB*0.020 + panelC*0.014)*brush",
    "          + env*rim*mix(0.7, 1.0, rough) + rimHot*0.045 + rimSoft*0.018 + corner*0.05",
    "          + shine + glint*0.25 + wear;",
    "  return clamp(c, 0.0, 1.0);",
    "}",
    "",
    "void main(){",
    "  float cov;",
    "  float c = shade(uv, cov);",
    "  if(cov < 0.004){ discard; }",
    "  c = pow(c, 0.92);",
    "  gl_FragColor = vec4(vec3(c)*cov, cov);",   // premultiplied
    "}"
  ].join("\n");

  /* post pass: bloom + lens chromatic aberration over the rendered scene */
  var FRAG_POST = [
    "precision highp float;",
    "varying vec2 uv;",
    "uniform sampler2D uScene;",
    "uniform vec2 uTexel;",
    "void main(){",
    "  // lens CA: sample each channel at a slightly different radius",
    "  vec2 off = (uv - 0.5) * 0.007;",
    "  float r = texture2D(uScene, uv + off).r;",
    "  vec4  g = texture2D(uScene, uv);",
    "  float b = texture2D(uScene, uv - off).b;",
    "  vec3 col = vec3(r, g.g, b);",
    "  // bloom: 12-tap disc blur of the bright part of the scene",
    "  float acc = 0.0;",
    "  vec2 rad1 = uTexel * 6.0, rad2 = uTexel * 14.0;",
    "  for (int i = 0; i < 6; i++) {",
    "    float a = 6.2832 * (float(i) / 6.0);",
    "    vec2 dir = vec2(cos(a), sin(a));",
    "    acc += texture2D(uScene, uv + dir*rad1).g;",
    "    acc += texture2D(uScene, uv + dir*rad2).g * 0.6;",
    "  }",
    "  float bloom = max(0.0, acc/9.6 - 0.16) * 0.85;",
    "  col += bloom;",
    "  // alpha: keep silhouette, let bloom spill additively past the edge",
    "  float a2 = max(g.a, min(bloom*1.4, 1.0));",
    "  gl_FragColor = vec4(col, a2);",   // premultiplied
    "}"
  ].join("\n");

  function compile(type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) console.warn(gl.getShaderInfoLog(sh));
    return sh;
  }
  function makeProgram(fragSrc) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragSrc));
    gl.linkProgram(p);
    return p;
  }
  var prog = makeProgram(FRAG);        // scene pass
  var progPost = makeProgram(FRAG_POST); // bloom + CA pass

  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  [prog, progPost].forEach(function (p) {
    var loc = gl.getAttribLocation(p, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  });

  gl.useProgram(prog);
  var uTime = gl.getUniformLocation(prog, "uTime");
  var uTilt = gl.getUniformLocation(prog, "uTilt");
  gl.uniform1i(gl.getUniformLocation(prog, "uNormal"), 0);
  gl.uniform1i(gl.getUniformLocation(prog, "uScratch"), 1);
  gl.uniform2f(uTilt, 0, 0);

  gl.useProgram(progPost);
  var uTexelPost = gl.getUniformLocation(progPost, "uTexel");
  gl.uniform1i(gl.getUniformLocation(progPost, "uScene"), 0);

  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);   // image row 0 = top of screen
  gl.clearColor(0, 0, 0, 0);

  /* offscreen scene target the post pass reads from */
  var sceneTex = gl.createTexture();
  var sceneFbo = gl.createFramebuffer();
  var fboW = 0, fboH = 0;
  function allocScene(w, h) {
    if (w === fboW && h === fboH) return;
    fboW = w; fboH = h;
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /* ---------- separable box blur (Float32) ---------- */
  function boxBlur(src, N, r) {
    var tmp = new Float32Array(N * N), out = new Float32Array(N * N), inv = 1 / (2 * r + 1);
    var x, y, k, s;
    for (y = 0; y < N; y++) for (x = 0; x < N; x++) {
      s = 0; for (k = -r; k <= r; k++) s += src[y * N + Math.min(N - 1, Math.max(0, x + k))];
      tmp[y * N + x] = s * inv;
    }
    for (x = 0; x < N; x++) for (y = 0; y < N; y++) {
      s = 0; for (k = -r; k <= r; k++) s += tmp[Math.min(N - 1, Math.max(0, y + k)) * N + x];
      out[y * N + x] = s * inv;
    }
    return out;
  }

  /* ---------- build a smooth normal map from the silhouette ---------- */
  var TEX = 512;
  var texture = gl.createTexture();
  var scratchTexture = gl.createTexture();
  var normalReady = false;
  var scratchReady = false;
  var ready = false;

  function markReady() {
    ready = normalReady && scratchReady;
  }

  function buildNormalField(alpha, N) {
    // 1) smooth height = heavily blurred coverage → rounded bevel, flat core
    var H = new Float32Array(N * N);
    for (var i = 0; i < N * N; i++) H[i] = alpha[i] / 255;
    var r = Math.max(2, Math.round(N * 0.017));
    H = boxBlur(H, N, r); H = boxBlur(H, N, Math.max(1, Math.round(r * 0.65)));

    // 2) per-pixel normals from the FLOAT height (no 8-bit banding)
    var BUMP = N * 0.105;
    var nx = new Float32Array(N * N), ny = new Float32Array(N * N);
    function at(x, y) { return H[Math.min(N - 1, Math.max(0, y)) * N + Math.min(N - 1, Math.max(0, x))]; }
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      // Sobel gradient
      var gx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1))
             - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      var gy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1))
             - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      nx[y * N + x] = -gx * BUMP;
      ny[y * N + x] =  gy * BUMP;   // +y is up in normal space
    }
    // 3) soften the normals a touch for glassy-smooth reflections
    nx = boxBlur(nx, N, 1); ny = boxBlur(ny, N, 1);

    // 4) feathered coverage: the outermost pixels dissolve to fully
    //    transparent over a ~3px breath, so the bright bevel light sits
    //    just inside the silhouette instead of ending in a hard rim
    var A = new Float32Array(N * N);
    for (var q = 0; q < N * N; q++) A[q] = alpha[q] / 255;
    var soft = boxBlur(A, N, 2);
    function feather(v) {
      var t = Math.min(1, Math.max(0, (v - 0.5) / 0.42));
      return t * t * (3 - 2 * t);
    }

    // 5) normalize and encode into RG, coverage into A
    var data = new Uint8Array(N * N * 4);
    for (var m = 0; m < N * N; m++) {
      var X = nx[m], Y = ny[m], Z = 1.0;
      var inv = 1 / Math.sqrt(X * X + Y * Y + Z * Z);
      X *= inv; Y *= inv;
      data[m * 4]     = Math.round((X * 0.5 + 0.5) * 255);
      data[m * 4 + 1] = Math.round((Y * 0.5 + 0.5) * 255);
      data[m * 4 + 2] = 0;
      data[m * 4 + 3] = Math.round(alpha[m] * feather(soft[m]));
    }
    return data;
  }

  var svgImg = new Image();
  svgImg.crossOrigin = "anonymous";
  svgImg.onload = function () {
    var off = document.createElement("canvas");
    off.width = off.height = TEX;
    var ctx = off.getContext("2d");
    var pad = TEX * 0.08, box = TEX - pad * 2;
    var sc = Math.min(box / svgImg.width, box / svgImg.height);
    var w = svgImg.width * sc, h = svgImg.height * sc;
    ctx.drawImage(svgImg, (TEX - w) / 2, (TEX - h) / 2, w, h);
    var px = ctx.getImageData(0, 0, TEX, TEX).data;
    var alpha = new Uint8Array(TEX * TEX);
    for (var i = 0; i < TEX * TEX; i++) alpha[i] = px[i * 4 + 3];

    var field = buildNormalField(alpha, TEX);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, TEX, TEX, 0, gl.RGBA, gl.UNSIGNED_BYTE, field);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    normalReady = true;
    markReady();
  };
  svgImg.src = "logo.svg";

  var scratchImg = new Image();
  function uploadFallbackScratch() {
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, scratchTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    scratchReady = true;
    markReady();
  }
  scratchImg.onload = function () {
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, scratchTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scratchImg);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    scratchReady = true;
    markReady();
  };
  scratchImg.onerror = uploadFallbackScratch;
  scratchImg.src = "scratch.png";

  /* ---------- size + render loop ---------- */
  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    // layout size, not getBoundingClientRect — the rect is post-transform,
    // so the cursor tilt would re-allocate the buffer every frame
    var w = Math.max(2, Math.round(canvas.clientWidth * dpr));
    var h = Math.max(2, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
  }
  window.addEventListener("resize", resize);
  resize();

  /* ---------- hover: 3D tilt (CSS) + shifted lighting (shader) ----------
     Tracked across the whole hero so the mark leans toward the cursor as
     it approaches, and the shifting light rakes across the scratch map —
     that's what makes the micro-cracks glint. */
  var targX = 0, targY = 0, tiltX = 0, tiltY = 0;
  var host = canvas.closest(".chrome") || canvas;
  var arena = canvas.closest(".hero") || host;
  if (!reduce) {
    arena.addEventListener("mousemove", function (e) {
      var r = host.getBoundingClientRect();
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      // -1…1 at the mark's edges, softly saturating beyond them
      targX = Math.max(-1.4, Math.min(1.4, (e.clientX - cx) / (r.width * 0.55)));
      targY = Math.max(-1.4, Math.min(1.4, (e.clientY - cy) / (r.height * 0.55)));
    });
    arena.addEventListener("mouseleave", function () { targX = 0; targY = 0; });
  }

  var start = performance.now();
  function frame(now) {
    resize();
    // ease the tilt toward the cursor for a weighty, physical feel
    // while a headline effect runs (headline.js sets .face-forward) the
    // mark eases flat — a forward-facing mark has no tilt to warp
    var fw = host.classList.contains("face-forward");
    tiltX += ((fw ? 0 : targX) - tiltX) * 0.09;
    tiltY += ((fw ? 0 : targY) - tiltY) * 0.09;
    // written as a variable on the host so the canvas and any headline.js
    // overlay share one transform — they can never disagree by a frame
    host.style.setProperty("--tilt",
      "perspective(900px) rotateY(" + (tiltX * 13).toFixed(3) + "deg)" +
      " rotateX(" + (-tiltY * 13).toFixed(3) + "deg)");
    if (ready) {
      allocScene(canvas.width, canvas.height);

      // pass 1: shade the mark into the offscreen scene texture
      gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
      gl.viewport(0, 0, fboW, fboH);
      gl.disable(gl.BLEND);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(prog);
      gl.uniform1f(uTime, reduce ? 6.0 : (now - start) * 0.001);
      gl.uniform2f(uTilt, tiltX * 0.85, -tiltY * 0.85);   // shader y is up
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, scratchTexture);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // pass 2: bloom + chromatic aberration onto the page
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(progPost);
      gl.uniform2f(uTexelPost, 1 / fboW, 1 / fboH);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sceneTex);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else {
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    if (!reduce) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  if (reduce) { var w8 = setInterval(function () { if (ready) { requestAnimationFrame(frame); clearInterval(w8); } }, 100); }
})();
