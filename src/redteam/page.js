'use strict';

/**
 * Instrumentação de coleta de sinais.
 *
 * `instrumentScript()` devolve o código (string) que o runner injeta via
 * page.evaluateOnNewDocument ANTES do load — assim funciona tanto no coletor
 * local quanto contra um staging que você controle. Ele coleta os MESMOS
 * sinais que um detector de bots inspecionaria (fingerprint estático +
 * comportamento) e expõe `window.__redteam.snapshot()`.
 *
 * `minimalPage()` é a página servida pelo coletor: só um alvo clicável e corpo
 * rolável, sem script inline (a instrumentação é injetada).
 */

function instrumentScript() {
  return `(function () {
  var firstInteractionMs = null;
  var b = { mouseMoves: 0, mousePathLength: 0, distinctPoints: 0, scrollEvents: 0,
            maxScrollY: 0, clicks: 0, mouseMovedBeforeFirstClick: false };
  var lastX = null, lastY = null, seen = Object.create(null);
  function markFirst() { if (firstInteractionMs === null) firstInteractionMs = Math.round(performance.now()); }

  window.addEventListener('mousemove', function (e) {
    markFirst(); b.mouseMoves++;
    if (lastX !== null) b.mousePathLength += Math.hypot(e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX; lastY = e.clientY;
    var k = Math.round(e.clientX) + ',' + Math.round(e.clientY);
    if (!seen[k]) { seen[k] = 1; b.distinctPoints++; }
  }, { passive: true });

  window.addEventListener('scroll', function () {
    markFirst(); b.scrollEvents++;
    b.maxScrollY = Math.max(b.maxScrollY, window.scrollY || window.pageYOffset || 0);
  }, { passive: true, capture: true });

  document.addEventListener('click', function () {
    markFirst();
    if (b.mouseMoves > 0) b.mouseMovedBeforeFirstClick = true;
    b.clicks++;
  }, true);

  function webgl() {
    try {
      var c = document.createElement('canvas');
      var gl = c.getContext('webgl') || c.getContext('experimental-webgl');
      if (!gl) return { vendor: null, renderer: null };
      var d = gl.getExtension('WEBGL_debug_renderer_info');
      if (!d) return { vendor: null, renderer: null };
      return { vendor: gl.getParameter(d.UNMASKED_VENDOR_WEBGL),
               renderer: gl.getParameter(d.UNMASKED_RENDERER_WEBGL) };
    } catch (e) { return { vendor: null, renderer: null }; }
  }

  function canvasHash() {
    try {
      var c = document.createElement('canvas'); c.width = 240; c.height = 60;
      var x = c.getContext('2d'); x.textBaseline = 'top'; x.font = '16px Arial';
      x.fillStyle = '#f60'; x.fillRect(0, 0, 100, 30);
      x.fillStyle = '#069'; x.fillText('redteam-fp', 4, 8);
      var s = c.toDataURL(), h = 5381;
      for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
      return h.toString(16);
    } catch (e) { return null; }
  }

  function fingerprint() {
    var w = webgl();
    return {
      webdriver: navigator.webdriver === true,
      userAgent: navigator.userAgent,
      headlessUa: /headless/i.test(navigator.userAgent),
      languages: (navigator.languages || []).length,
      languagesList: navigator.languages || [],
      plugins: (navigator.plugins || []).length,
      hasWindowChrome: !!window.chrome,
      hardwareConcurrency: navigator.hardwareConcurrency || null,
      deviceMemory: navigator.deviceMemory || null,
      maxTouchPoints: navigator.maxTouchPoints || 0,
      outerWidth: window.outerWidth, outerHeight: window.outerHeight,
      innerWidth: window.innerWidth, innerHeight: window.innerHeight,
      screenWidth: screen.width, screenHeight: screen.height,
      devicePixelRatio: window.devicePixelRatio,
      timezone: (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return null; } })(),
      notificationPermission: (window.Notification && Notification.permission) || null,
      webglVendor: w.vendor, webglRenderer: w.renderer, canvasHash: canvasHash()
    };
  }

  window.__redteam = {
    snapshot: function () {
      var fp = fingerprint();
      fp.mouseMoves = b.mouseMoves; fp.mousePathLength = Math.round(b.mousePathLength);
      fp.distinctPoints = b.distinctPoints; fp.scrollEvents = b.scrollEvents;
      fp.maxScrollY = Math.round(b.maxScrollY); fp.clicks = b.clicks;
      fp.mouseMovedBeforeFirstClick = b.mouseMovedBeforeFirstClick;
      fp.firstInteractionMs = firstInteractionMs;
      return fp;
    }
  };
})();`;
}

function minimalPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Red-Team Detection Lab</title>
<style>
  html, body { margin: 0; font-family: system-ui, Arial, sans-serif; }
  body { min-height: 3200px; background: linear-gradient(#0b1021, #131a33); color: #cdd6f4; }
  #target { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
    width: 220px; height: 90px; font-size: 18px; cursor: pointer; border: 0;
    border-radius: 12px; background: #7c3aed; color: #fff; }
  .hint { position: fixed; left: 16px; bottom: 16px; opacity: .6; font-size: 13px; }
</style>
</head>
<body>
  <button id="target" type="button">Detection Lab target</button>
  <div class="hint">Ambiente de teste autorizado — coleta de sinais para construir detecção.</div>
</body>
</html>`;
}

module.exports = { instrumentScript, minimalPage };
