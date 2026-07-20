'use strict';

const http = require('http');
const { minimalPage } = require('./page');

/**
 * Coletor local = o "staging" que você controla.
 *
 * - Serve a página instrumentada em GET /
 * - Registra, por sessão (sid), os sinais de REDE observados no request
 *   (User-Agent, Accept-Language, client hints, ordem/caixa dos headers).
 * - Não faz saída de rede. Escuta só em 127.0.0.1.
 *
 * Os sinais de cliente (fingerprint/comportamento) são lidos pelo runner via
 * page.evaluate; aqui capturamos o lado servidor, que também denuncia bots.
 */

function serverSignals(req, sid) {
  const h = req.headers;
  const order = [];
  for (let i = 0; i < req.rawHeaders.length; i += 2) order.push(req.rawHeaders[i]);
  return {
    sid,
    userAgent: h['user-agent'] || null,
    acceptLanguage: h['accept-language'] || null,
    accept: h['accept'] || null,
    secChUa: h['sec-ch-ua'] || null,
    secChUaMobile: h['sec-ch-ua-mobile'] || null,
    secChUaPlatform: h['sec-ch-ua-platform'] || null,
    dnt: h['dnt'] || null,
    connection: h['connection'] || null,
    redTeamRunId: h['x-redteam-run-id'] || null,
    headerOrder: order,
    remoteAddress: req.socket.remoteAddress || null,
  };
}

function startCollector({ host = '127.0.0.1', port = 0, logger } = {}) {
  const html = minimalPage();
  const signalsBySid = new Map();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === '/__signals') {
      const sid = url.searchParams.get('sid');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(signalsBySid.get(sid) || null));
      return;
    }

    // Página instrumentada (qualquer outra rota) — grava sinais de rede.
    const sid = url.searchParams.get('sid');
    if (sid) signalsBySid.set(sid, serverSignals(req, sid));

    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, host, () => {
      const actualPort = server.address().port;
      const baseUrl = `http://${host}:${actualPort}`;
      if (logger) logger.info(`Coletor no ar: ${baseUrl}`);
      resolve({
        baseUrl,
        getServerSignals: (sid) => signalsBySid.get(sid) || null,
        stop: () =>
          new Promise((done) => {
            server.close(() => {
              if (logger) logger.info('Coletor encerrado');
              done();
            });
          }),
      });
    });
  });
}

module.exports = { startCollector };
