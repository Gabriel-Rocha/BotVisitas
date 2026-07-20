'use strict';

const puppeteer = require('puppeteer');
const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { pick, randomInt } = require('../utils/random');
const { sleep } = require('../utils/sleep');
const { humanInteract, makeBehaviorProfile } = require('./humanize');
const { instrumentScript } = require('./page');

let stealthApplied = false;
function ensureStealth() {
  if (!stealthApplied) {
    puppeteerExtra.use(StealthPlugin());
    stealthApplied = true;
  }
}

function launchArgs(level) {
  const args = [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-popup-blocking',
    '--disable-notifications',
  ];
  const options = {
    headless: level.forceHeaded ? false : 'new',
    args,
  };
  // L0 mantém --enable-automation (mais denunciável); demais removem.
  if (!level.keepAutomationArgs) options.ignoreDefaultArgs = ['--enable-automation'];
  return options;
}

async function launchForLevel(level, config) {
  const options = launchArgs(level);
  if (config.headless === false) options.headless = false;
  if (config.chromeExecutablePath) options.executablePath = config.chromeExecutablePath;

  if (level.stealth) {
    ensureStealth();
    return puppeteerExtra.launch(options);
  }
  return puppeteer.launch(options);
}

// Perfil "consistente" para L1–L3 e perfil variável por sessão para L4.
function sessionProfile(level, config) {
  if (level.fingerprintVariation) {
    const ua = pick(config.userAgents);
    const width = pick([1920, 1600, 1536, 1440, 1366]);
    const height = pick([1080, 900, 864, 768]);
    return {
      userAgent: ua,
      viewport: { width, height },
      languages: pick([['en-US', 'en'], ['pt-BR', 'pt', 'en'], ['es-ES', 'es']]),
      acceptLanguage: pick(['en-US,en;q=0.9', 'pt-BR,pt;q=0.9,en;q=0.8', 'es-ES,es;q=0.9']),
    };
  }
  return {
    userAgent: config.defaultUserAgent,
    viewport: config.viewport,
    languages: ['en-US', 'en'],
    acceptLanguage: 'en-US,en;q=0.9',
  };
}

async function runSession({ level, sid, collectorUrl, collector, config, logger }) {
  const profile = sessionProfile(level, config);
  const browser = await launchForLevel(level, config);
  let client = null;
  let persona = null;
  const startedAt = Date.now();

  try {
    const page = await browser.newPage();
    await page.setViewport(profile.viewport);

    // Injeta a instrumentação antes de qualquer script da página.
    await page.evaluateOnNewDocument(instrumentScript());

    const headers = { 'X-RedTeam-Run-Id': sid };
    if (level.overrideUserAgent) {
      await page.setUserAgent(profile.userAgent);
      headers['Accept-Language'] = profile.acceptLanguage;
      await page.evaluateOnNewDocument((langs) => {
        Object.defineProperty(navigator, 'languages', { get: () => langs });
      }, profile.languages);
    }
    await page.setExtraHTTPHeaders(headers);

    await page.goto(`${collectorUrl}/?sid=${encodeURIComponent(sid)}&level=${level.id}`, {
      waitUntil: 'domcontentloaded',
      timeout: config.navigationTimeoutMs,
    });

    const target = { x: profile.viewport.width / 2, y: profile.viewport.height / 2 };

    if (level.clickMode === 'dom') {
      // Bot ingênuo: dispara o clique via DOM, sem qualquer evento de ponteiro.
      await page.evaluate(() => {
        const el = document.getElementById('target');
        if (el) el.click();
      });
    } else if (level.clickMode === 'teleport') {
      // Move direto ao alvo e clica — sem trajetória.
      await page.mouse.click(target.x, target.y);
    } else {
      // Comportamento humanizado com persona própria da sessão.
      persona = makeBehaviorProfile();
      await humanInteract(page, target, profile.viewport, persona);
    }

    await sleep(200); // deixa os listeners assentarem
    client = await page.evaluate(() => window.__redteam.snapshot());
  } finally {
    await browser.close().catch(() => {});
  }

  const server = collector.getServerSignals(sid);
  return {
    sid,
    level: level.id,
    levelName: level.name,
    profileUserAgent: profile.userAgent || null,
    elapsedMs: Date.now() - startedAt,
    persona,
    client,
    server,
  };
}

async function runSweep({ levels, sessionsPerLevel, collector, collectorUrl, config, logger }) {
  const records = [];
  for (const level of levels) {
    logger.info(`── Nível ${level.id} (${level.name}) — ${level.description}`);
    for (let i = 1; i <= sessionsPerLevel; i += 1) {
      const sid = `${level.id}-${String(i).padStart(2, '0')}-${randomInt(1000, 9999)}`;
      try {
        const rec = await runSession({ level, sid, collectorUrl, collector, config, logger });
        records.push(rec);
        logger.info(
          `   sessão ${i}/${sessionsPerLevel} ok | webdriver=${rec.client?.webdriver} ` +
            `moves=${rec.client?.mouseMoves} path=${rec.client?.mousePathLength}px ` +
            `firstInteraction=${rec.client?.firstInteractionMs}ms`
        );
      } catch (err) {
        logger.error(`   sessão ${i}/${sessionsPerLevel} FALHOU: ${err.message}`);
        records.push({ sid, level: level.id, levelName: level.name, error: err.message, client: null, server: null });
      }
    }
  }
  return records;
}

module.exports = { runSweep, runSession };
