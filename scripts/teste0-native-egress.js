'use strict';

/**
 * TESTE 0 — EGRESS=native: Chromium com --no-proxy-server deve ver o IP da operadora.
 * Critério: mesmo IP do api.ipify.org do Node, sem vpn/hosting no ipinfo.
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const https = require('https');
const { resolveChromePath } = require('../src/core/browser');
const { getProxyLaunchArgs } = require('../src/core/proxy');
const { getStealthLaunchArgs } = require('../src/core/stealth');

puppeteer.use(StealthPlugin());

function getJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { timeout: 12_000 }, (res) => {
        let body = '';
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve({ raw: body.trim() });
          }
        });
      })
      .on('error', reject);
  });
}

function getText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { timeout: 12_000 }, (res) => {
        let body = '';
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => resolve(body.trim()));
      })
      .on('error', reject);
  });
}

async function main() {
  const workers = Number.parseInt(process.env.TEST_WORKERS || '4', 10) || 4;
  const nodeIp = await getText('https://api.ipify.org');
  console.log(`Node ipify: ${nodeIp}`);

  const info = await getJson(`https://ipinfo.io/${nodeIp}/json`);
  console.log(
    `ipinfo: org=${info.org || '?'} country=${info.country || '?'} privacy=${JSON.stringify(info.privacy || null)}`
  );

  const privacyType = info.privacy?.type || '';
  if (/vpn|proxy|hosting/i.test(privacyType) || /vpn|proxy|hosting|digitalocean|aws|azure|gcp/i.test(info.org || '')) {
    console.error('REPROVOU: IP com sinal de vpn/proxy/hosting — não avance.');
    process.exit(2);
  }

  const proxyArgs = getProxyLaunchArgs({ egress: 'native' }, null);
  if (!proxyArgs.includes('--no-proxy-server')) {
    console.error('REPROVOU: getProxyLaunchArgs(native) sem --no-proxy-server');
    process.exit(3);
  }
  console.log(`Launch args: ${proxyArgs.join(' ')}`);

  const chromePath = resolveChromePath(process.env.CHROME_EXECUTABLE_PATH || null);
  const ips = [];

  for (let i = 0; i < workers; i += 1) {
    const browser = await puppeteer.launch({
      headless: 'new',
      executablePath: chromePath || undefined,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        ...getStealthLaunchArgs({ lang: 'pt-BR', egress: 'native' }),
        ...proxyArgs,
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    });
    try {
      const page = await browser.newPage();
      await page.goto('https://api.ipify.org', { waitUntil: 'domcontentloaded', timeout: 20_000 });
      const ip = (await page.evaluate(() => document.body.innerText)).trim();
      ips.push(ip);
      console.log(`Chromium w${i}: ${ip}`);
    } finally {
      await browser.close();
    }
  }

  const allSame = ips.every((ip) => ip === nodeIp);
  if (!allSame) {
    console.error('REPROVOU: Chromium não bate com IP nativo — proxy de sistema ainda vence?');
    console.error({ nodeIp, ips });
    process.exit(4);
  }

  console.log(`PASSOU TESTE 0: ${workers}x ${nodeIp} (residencial ${info.org})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
