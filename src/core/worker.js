'use strict';

const path = require('path');
const crypto = require('crypto');
const { launchBrowser, closeBrowser } = require('./browser');
const { createSession, recreateSession } = require('./session');
const { resolveSessionLocale } = require('./geo');
const { pickSessionPersona } = require('./devices');
const { randomInt } = require('../utils/random');
const { sleep, sleepInterruptible, isAbortError } = require('../utils/sleep');
const { isTransientProxyError } = require('../utils/netErrors');
const {
  getCurrentPublicIp,
  checkInvoluntaryRotation,
  isPausedForIpChange,
} = require('./ip');
const { getIpDayStats } = require('./schedule');
const { insertVisitMetric } = require('../db/runs');

function hashPersona(persona) {
  const raw = `${persona.userAgent}|${persona.viewport?.width}x${persona.viewport?.height}`;
  return crypto.createHash('sha1').update(raw).digest('hex').slice(0, 12);
}

/**
 * Um worker = 1 identidade = 1 perfil persistente.
 * Persona sorteada UMA vez no createWorker — nunca por visita.
 * Visitas passam pela fila global (visitGate) quando VISIT_SERIAL=true.
 */
function createWorker({
  workerId,
  config,
  strategy,
  logger,
  proxyLease = null,
  visitGate = null,
  deviceType = 'desktop',
  deviceProfile = null,
  preferredCountry = null,
}) {
  const needsBrowser = strategy.requiresBrowser !== false;
  const prefix = `[w${workerId}]`;
  const device = deviceProfile ? { type: deviceType, profile: deviceProfile } : null;
  const egress = String(config.egress || 'native').toLowerCase();

  // Identidade fixa do boot ao shutdown
  const persona = deviceProfile
    ? (() => {
        const p = pickSessionPersona(deviceProfile);
        p.hash = hashPersona(p);
        return p;
      })()
    : null;
  const screenOffset = {
    x: randomInt(0, 96),
    y: randomInt(0, 72),
  };
  const userDataDir = path.join(config.profilesDir || path.join(process.cwd(), 'profiles'), `w${workerId}`);

  const visitQuality = {
    sessions: 0,
    withCookies: 0,
    withoutCallback: 0,
    hitsToday: 0,
    publicIp: null,
    privacyType: null,
    asn: null,
    org: null,
    sessionMs: [],
  };

  const stats = {
    workerId,
    deviceType,
    personaHash: persona?.hash || null,
    startedAt: Date.now(),
    iterations: 0,
    ok: 0,
    offers: 0,
    intermediate: 0,
    errors: 0,
    clicks: 0,
    browserRestarts: 0,
    proxyLabel: null,
    timezoneId: null,
    locale: null,
    geoCountry: null,
    visitQuality,
  };

  let browser = null;
  let page = null;
  let activeProxy = null;
  let sessionLocale = null;
  let stopping = false;
  let abortController = null;
  let captureInProgress = null;
  let lastPreview = null;
  let recycleRequested = null;
  let publicIp = null;

  function log(level, ...args) {
    logger[level](prefix, ...args);
  }

  async function acquireProxy() {
    if (!proxyLease || egress !== 'tuxler') return null;
    const proxy = await proxyLease.acquire(preferredCountry);
    if (!proxy) return null;
    stats.proxyLabel = proxy.label;
    log('info', `Tuxler adquirido: ${proxy.label}`);
    return proxy;
  }

  function releaseProxy() {
    if (!proxyLease || !activeProxy) return;
    proxyLease.release(activeProxy);
    log('info', `Tuxler liberado: ${activeProxy.label}`);
    activeProxy = null;
    stats.proxyLabel = null;
  }

  async function acquireUsableProxy() {
    if (!proxyLease || egress !== 'tuxler') return { proxy: null, hints: await resolveLocaleForProxy(null) };
    activeProxy = await acquireProxy();
    const hints = await resolveLocaleForProxy(activeProxy);
    return { proxy: activeProxy, hints };
  }

  async function resolveLocaleForProxy(proxy) {
    const hints = await resolveSessionLocale({
      egressGeo: proxy?.geo || null,
      proxy: proxy?.ip ? { host: proxy.ip, label: proxy.label } : null,
      fallbackTimezone: config.stealth?.timezoneId || 'America/Sao_Paulo',
      fallbackLocale: config.stealth?.locale || 'pt-BR',
      enabled: config.stealth?.geoTz !== false,
      logger: {
        info: (...a) => log('info', ...a),
        warn: (...a) => log('warn', ...a),
        debug: (...a) => log('debug', ...a),
      },
    });
    sessionLocale = hints;
    stats.timezoneId = hints.timezoneId;
    stats.locale = hints.locale;
    stats.geoCountry = hints.countryCode;
    return hints;
  }

  async function ensureBrowser() {
    if (!needsBrowser) return;
    if (browser && browser.isConnected()) return;

    log('info', `Subindo Chromium (perfil ${userDataDir})...`);

    await closeBrowser(browser, {
      info: (...a) => log('info', ...a),
      warn: (...a) => log('warn', ...a),
    });

    let localeHints;
    if (egress === 'tuxler' && !activeProxy && proxyLease) {
      const acquired = await acquireUsableProxy();
      localeHints = acquired.hints;
    } else {
      localeHints = await resolveLocaleForProxy(activeProxy);
    }

    const launched = await launchBrowser(
      config,
      {
        info: (...a) => log('info', ...a),
        warn: (...a) => log('warn', ...a),
        debug: (...a) => log('debug', ...a),
      },
      null,
      { lang: localeHints.locale, userDataDir }
    );

    browser = launched.browser;
    page = await createSession(
      browser,
      config,
      {
        info: (...a) => log('info', ...a),
        warn: (...a) => log('warn', ...a),
        debug: (...a) => log('debug', ...a),
      },
      null,
      device,
      localeHints,
      persona,
      screenOffset
    );
  }

  async function recycleBrowser(reason = 'periódico') {
    if (!needsBrowser) return;

    log('info', `Reciclando Chromium (${reason}) #${stats.iterations}`);
    await closeBrowser(browser, {
      info: (...a) => log('info', ...a),
      warn: (...a) => log('warn', ...a),
      debug: (...a) => log('debug', ...a),
    });
    browser = null;
    page = null;
    lastPreview = null;

    const tuxlerSkip =
      egress === 'tuxler' && (config.tuxler?.rotateMode || 'skip') === 'skip';
    if (proxyLease && egress === 'tuxler' && !tuxlerSkip) {
      releaseProxy();
      try {
        await acquireUsableProxy();
      } catch (err) {
        log('warn', 'Falha ao rotacionar Tuxler no restart — tentando de novo:', err.message);
        await sleep(2000);
        await acquireUsableProxy();
      }
    }

    stats.browserRestarts += 1;
    await ensureBrowser();
  }

  async function maybeRestartBrowser() {
    if (!needsBrowser) return;
    const every = config.browserRestartEvery;
    if (!every || every <= 0) return;
    if (stats.iterations === 0 || stats.iterations % every !== 0) return;
    await recycleBrowser('periódico');
  }

  async function forceRecycleBrowser(reason = 'watchdog-ram') {
    if (!needsBrowser) return;
    recycleRequested = reason;
    if (!page || page.isClosed()) {
      recycleRequested = null;
      await recycleBrowser(reason);
    }
  }

  async function releaseTuxlerTurn() {
    if (egress !== 'tuxler' || !proxyLease) return;
    await closeBrowser(browser, {
      info: (...a) => log('info', ...a),
      warn: (...a) => log('warn', ...a),
    });
    browser = null;
    page = null;
    sessionLocale = null;
    releaseProxy();
  }

  function visitContext() {
    return {
      shouldStop: () => stopping,
      signal: abortController?.signal,
    };
  }

  async function runStrategyWithCap() {
    const ctx = visitContext();
    const runPromise = strategy.run(page, {
      config,
      logger: {
        info: (...a) => log('info', ...a),
        warn: (...a) => log('warn', ...a),
        error: (...a) => log('error', ...a),
        debug: (...a) => log('debug', ...a),
      },
      ...ctx,
    });

    const maxSec = config.visitMaxSec || 0;
    if (!maxSec || maxSec <= 0) return runPromise;

    let timer;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`Visita abortada (${maxSec}s)`);
        err.code = 'VISIT_TIMEOUT';
        reject(err);
      }, maxSec * 1000);
    });

    try {
      return await Promise.race([runPromise, timeoutPromise]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function waitCadence() {
    try {
      publicIp = await getCurrentPublicIp();
    } catch (err) {
      log('warn', `IP público indisponível: ${err.message}`);
      publicIp = publicIp || 'unknown';
    }
    visitQuality.publicIp = publicIp;

    while (isPausedForIpChange() && !stopping) {
      log('warn', 'Pausado por mudança involuntária de IP — aguardando confirmação/estabilização');
      await sleepInterruptible(30_000, {
        shouldStop: () => stopping,
        signal: abortController?.signal,
      });
    }

    const country =
      sessionLocale?.countryCode ||
      preferredCountry ||
      stats.geoCountry ||
      'BR';

    if (!visitGate) {
      log('warn', 'visitGate ausente — visita sem fila serial');
      return { skipped: false, hitsToday: 0, release: () => {} };
    }

    return visitGate.acquire({
      countryCode: country,
      workerId,
      logger: {
        info: (...a) => log('info', ...a),
        warn: (...a) => log('warn', ...a),
      },
      shouldStop: () => stopping,
      signal: abortController?.signal,
    });
  }

  async function persistVisit(result, sessionStartedAt, cadenceInfo) {
    const tempoSessaoMs = Date.now() - sessionStartedAt;
    const meta = result?.meta || {};
    const clicks = meta.clickCount ?? meta.verifiedClicks ?? 0;
    const cookiesPresent = Boolean(page?.__botCookiesPresent);
    const nCookies = page?.__botNCookies ?? 0;
    const popupMs = page?.__botPopupMeta?.lingerMs || 0;
    const callback = Boolean(meta.callbackAdsterra ?? meta.adsterraCallback ?? meta.hasCallback);
    const hosts = meta.hostsSeen || meta.hosts_vistos || [];
    const bytes = meta.bytesTotal ?? meta.bytes_totais ?? null;
    const firstClickMs = meta.timeToFirstClickMs ?? meta.tempo_ate_primeiro_clique_ms ?? null;

    visitQuality.sessions += 1;
    if (cookiesPresent) visitQuality.withCookies += 1;
    if (!callback && result?.ok) visitQuality.withoutCallback += 1;
    visitQuality.sessionMs.push(tempoSessaoMs);
    if (visitQuality.sessionMs.length > 200) visitQuality.sessionMs.shift();

    const dayStats = getIpDayStats(publicIp, config.scheduleFile);
    visitQuality.hitsToday = dayStats.hitsToday || cadenceInfo?.hitsToday || 0;

    const payload = {
      worker_index: workerId,
      public_ip: publicIp,
      asn: visitQuality.asn,
      org: visitQuality.org,
      privacy_type: visitQuality.privacyType,
      country: stats.geoCountry,
      egress_mode: egress,
      hits_hoje_no_ip: visitQuality.hitsToday,
      minutos_desde_ultimo_hit: cadenceInfo?.minutesSinceLastHit ?? dayStats.minutesSinceLastHit,
      persona_hash: persona?.hash || null,
      cookies_presentes: cookiesPresent,
      n_cookies: nCookies,
      popup_aberta_ms: popupMs,
      cliques: clicks,
      tempo_ate_primeiro_clique_ms: firstClickMs,
      callback_adsterra_disparou: callback,
      hosts_vistos: hosts,
      bytes_totais: bytes,
      tempo_sessao_ms: tempoSessaoMs,
      ok: Boolean(result?.ok),
      quality: result?.quality || null,
    };

    try {
      await insertVisitMetric(payload);
    } catch (err) {
      log('debug', 'insertVisitMetric:', err.message);
    }

    return payload;
  }

  async function tick() {
    if (stopping) return;
    abortController = new AbortController();

    let cadenceInfo = null;
    let slotRelease = null;
    try {
      cadenceInfo = await waitCadence();
      if (cadenceInfo?.skipped || stopping) return;
      slotRelease = cadenceInfo.release || null;

      const sessionStartedAt = Date.now();
      await ensureBrowser();

      const result = await runStrategyWithCap();

      if (visitGate) {
        const { markHit } = require('./schedule');
        const marked = markHit(
          publicIp && publicIp !== 'unknown' ? publicIp : null,
          config.scheduleFile
        );
        visitQuality.hitsToday = marked.hitsToday;
      }

      await persistVisit(result, sessionStartedAt, cadenceInfo);

      if (result?.ok) {
        stats.ok += 1;
        const q = result.quality || 'offer';
        if (q === 'intermediate') stats.intermediate += 1;
        else stats.offers += 1;
        const visitClicks = result.meta?.clickCount ?? result.meta?.verifiedClicks ?? 0;
        stats.clicks += visitClicks;
        if (visitClicks > 0) {
          log('info', `Cliques na visita: ${visitClicks} (total worker: ${stats.clicks})`);
        }
      } else {
        stats.errors += 1;
      }

      stats.iterations += 1;

      const every = config.ipCheckEveryVisits ?? 10;
      if (every > 0 && stats.iterations % every === 0) {
        try {
          await checkInvoluntaryRotation({
            info: (...a) => log('info', ...a),
            warn: (...a) => log('warn', ...a),
          });
        } catch (err) {
          log('debug', 'checkInvoluntaryRotation:', err.message);
        }
      }

      if (recycleRequested) {
        const reason = recycleRequested;
        recycleRequested = null;
        await recycleBrowser(reason);
        return;
      }

      const tuxlerRotates =
        egress === 'tuxler' && (config.tuxler?.rotateMode || 'skip').toLowerCase() !== 'skip';
      const tuxlerTurnQueue = Boolean(
        tuxlerRotates && proxyLease && (config.concurrency || 1) > 1
      );
      if (tuxlerTurnQueue) {
        await releaseTuxlerTurn();
      } else {
        await maybeRestartBrowser();
      }
    } finally {
      if (typeof slotRelease === 'function') slotRelease();
    }
  }

  async function run() {
    log(
      'info',
      `Worker start | device=${deviceType} | persona=${persona?.hash || 'n/a'} | egress=${egress} | strategy=${strategy.name}`
    );

    while (!stopping) {
      try {
        await tick();
      } catch (err) {
        if (stopping || isAbortError(err)) {
          break;
        }
        stats.errors += 1;
        log('error', 'Erro na iteração:', err.message);
        log('debug', err.stack);

        if (err.code === 'VISIT_TIMEOUT') {
          stats.iterations += 1;
          log('warn', 'Iteração estourou VISIT_MAX_SEC — próximo link');
          try {
            page = await recreateSession(
              browser,
              page,
              config,
              {
                info: (...a) => log('info', ...a),
                debug: (...a) => log('debug', ...a),
              },
              activeProxy,
              device,
              sessionLocale,
              persona,
              screenOffset
            );
          } catch {
            await releaseTuxlerTurn();
          }
          continue;
        }

        if (needsBrowser) {
          const tuxlerSkip =
            egress === 'tuxler' && (config.tuxler?.rotateMode || 'skip') === 'skip';
          const rotateProxy =
            egress === 'tuxler' && Boolean(proxyLease) && isTransientProxyError(err) && !tuxlerSkip;
          try {
            if (rotateProxy) {
              log('warn', 'Erro de túnel/proxy — trocando sticky e reiniciando browser');
              await releaseTuxlerTurn();
              await ensureBrowser();
            } else {
              page = await recreateSession(
                browser,
                page,
                config,
                {
                  info: (...a) => log('info', ...a),
                  debug: (...a) => log('debug', ...a),
                },
                activeProxy,
                device,
                sessionLocale,
                persona,
                screenOffset
              );
            }
          } catch {
            await releaseTuxlerTurn();
          }
        }
      }

      if (stopping) break;

      // INTERVAL_* legado só como jitter curto pós-visita; cadência real é HIT_*
      const minI = config.intervalMinSec ?? 0;
      const maxI = config.intervalMaxSec ?? 0;
      if (maxI > 0) {
        const waitSec = randomInt(minI, maxI);
        if (waitSec > 0) {
          log('debug', `Jitter pós-visita ${waitSec}s...`);
          try {
            await sleepInterruptible(waitSec * 1000, {
              shouldStop: () => stopping,
              signal: abortController?.signal,
            });
          } catch {
            break;
          }
        }
      }
    }
  }

  async function stop() {
    stopping = true;
    abortController?.abort();
    log('info', 'Encerrando...', JSON.stringify(getStats()));
    if (needsBrowser) {
      await closeBrowser(browser, {
        info: (...a) => log('info', ...a),
        warn: (...a) => log('warn', ...a),
        debug: (...a) => log('debug', ...a),
      });
    }
    browser = null;
    page = null;
    releaseProxy();
  }

  async function capturePreview() {
    if (!needsBrowser || !page || page.isClosed()) {
      throw new Error('Worker sem página ativa para visualizar');
    }
    if (captureInProgress) return captureInProgress;

    captureInProgress = (async () => {
      let image;
      try {
        image = await page.screenshot({
          type: 'jpeg',
          quality: 58,
          fullPage: false,
          captureBeyondViewport: false,
          timeout: 12_000,
        });
      } catch (err) {
        const msg = String(err?.message || err);
        if (lastPreview?.image) {
          log('debug', `Preview indisponível (${msg}) — reutilizando última captura`);
          return {
            image: lastPreview.image,
            capturedAt: lastPreview.capturedAt,
            title: lastPreview.title,
            url: lastPreview.url,
            stale: true,
          };
        }
        throw new Error(
          msg.includes('timeout') || msg.includes('Timeout')
            ? 'Captura expirou (página navegando?)'
            : msg
        );
      }
      let title = '';
      try {
        title = await page.title();
      } catch {
        // A navegação pode trocar o contexto logo após a captura.
      }
      lastPreview = {
        capturedAt: new Date().toISOString(),
        title,
        url: page.url(),
        image,
      };
      return { image, ...lastPreview };
    })();

    try {
      return await captureInProgress;
    } finally {
      captureInProgress = null;
    }
  }

  function getStats() {
    return {
      ...stats,
      uptimeSec: Math.round((Date.now() - stats.startedAt) / 1000),
      currentUrl: page && !page.isClosed() ? page.url() : null,
      previewCapturedAt: lastPreview?.capturedAt || null,
      pageTitle: lastPreview?.title || '',
      visitQuality: { ...visitQuality, sessionMs: [...visitQuality.sessionMs] },
    };
  }

  return { workerId, run, stop, getStats, capturePreview, forceRecycleBrowser };
}

module.exports = { createWorker };
