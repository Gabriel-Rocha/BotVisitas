'use strict';

/**
 * Servidor de teste LOCAL para exercitar a strategy directLink contra uma
 * página que você controla. Zero dependências (http nativo).
 *
 *   npm run test:server        # sobe em http://localhost:3000
 *   TEST_SERVER_PORT=4000 ...  # porta alternativa
 *
 * A página tem um botão #cta com contador visível (e window.__clicks), então
 * dá pra confirmar que o bot realmente clicou.
 */

const http = require('http');

const PORT = Number.parseInt(process.env.TEST_SERVER_PORT, 10) || 3000;
// Escuta em 0.0.0.0 para o container Docker alcançar via host.docker.internal
const HOST = process.env.TEST_SERVER_HOST || '0.0.0.0';

const PAGE = `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8" /><title>Sandbox de teste — directLink</title>
<style>
  html,body{margin:0;font-family:system-ui,Arial,sans-serif;background:#0b1021;color:#cdd6f4}
  main{min-height:2400px;display:flex;flex-direction:column;align-items:center;gap:24px;padding-top:120px}
  #cta{font-size:20px;padding:18px 32px;border:0;border-radius:12px;background:#7c3aed;color:#fff;cursor:pointer}
  #count{font-size:18px;opacity:.85}
</style></head>
<body>
  <main>
    <h1>Sandbox local de teste</h1>
    <button id="cta">Comprar</button>
    <div id="count">cliques: 0</div>
  </main>
  <script>
    window.__clicks = 0;
    var c = document.getElementById('cta');
    var out = document.getElementById('count');
    c.addEventListener('click', function () {
      window.__clicks += 1;
      out.textContent = 'cliques: ' + window.__clicks;
    });
  </script>
</body>
</html>`;

http
  .createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  })
  .listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`Test server no ar: http://localhost:${PORT}  (botão: #cta)`);
  });
