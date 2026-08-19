'use strict';

/**
 * Servidor de teste LOCAL para exercitar a strategy directLink.
 * Zero dependências (http nativo).
 *
 *   npm run test:server        # sobe em http://localhost:3000
 *   TEST_SERVER_PORT=4000 ...  # porta preferida; se ocupada, tenta a próxima
 *
 * A página tem um botão #cta com contador visível (e window.__clicks), então
 * dá pra confirmar que o bot realmente clicou.
 */

const http = require('http');

const PREFERRED_PORT = Number.parseInt(process.env.TEST_SERVER_PORT, 10) || 3000;
const MAX_PORT_TRIES = 20;
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

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(PAGE);
});

function listen(port, attemptsLeft) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      const next = port + 1;
      // eslint-disable-next-line no-console
      console.warn(`Porta ${port} ocupada — tentando ${next}`);
      listen(next, attemptsLeft - 1);
      return;
    }
    // eslint-disable-next-line no-console
    console.error(`Não foi possível escutar em ${HOST}:${port}: ${err.message}`);
    process.exit(1);
  });
  server.listen(port, HOST, () => {
    const addr = server.address();
    const used = addr && typeof addr === 'object' ? addr.port : port;
    // eslint-disable-next-line no-console
    console.log(`Test server no ar: http://localhost:${used}  (botão: #cta)`);
  });
}

listen(PREFERRED_PORT, MAX_PORT_TRIES);
