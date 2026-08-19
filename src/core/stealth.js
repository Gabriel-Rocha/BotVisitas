'use strict';

const fs = require('fs');
const { randomInt } = require('../utils/random');
const { getProxyLaunchArgs, getWebrtcLaunchArgs } = require('./proxy');

function formatAcceptLanguage(languages) {
  return languages
    .map((lang, i) => (i === 0 ? lang : `${lang};q=${Math.max(0.1, (10 - i) / 10).toFixed(1)}`))
    .join(',');
}

function extraHttpHeaders(identity) {
  const headers = {
    'Accept-Language': formatAcceptLanguage(identity.languages || [identity.language || 'pt-BR']),
    'Upgrade-Insecure-Requests': '1',
    'sec-ch-ua': identity.secChUa,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': identity.uaPlatform ? `"${identity.uaPlatform}"` : undefined,
  };
  Object.keys(headers).forEach((key) => {
    if (headers[key] == null || headers[key] === '') delete headers[key];
  });
  return headers;
}

function findChromeExecutable(config) {
  if (config.chromeExecutablePath && fs.existsSync(config.chromeExecutablePath)) {
    return config.chromeExecutablePath;
  }
  if (!config.chromeAutodetect) return null;

  const candidates = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];

  return candidates.find((p) => fs.existsSync(p)) || null;
}

function getLaunchArgs(config, identity, options = {}) {
  const w = identity.viewport.width;
  const h = identity.viewport.height;
  const locale = identity.locale || 'pt-BR';
  const attachProxy = options.attachProxy === true;

  return [
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-infobars',
    '--disable-popup-blocking',
    '--disable-notifications',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-sync',
    '--disable-default-apps',
    '--disable-features=AutomationControlled,Translate,TranslateUI',
    '--disable-blink-features=AutomationControlled',
    '--no-first-run',
    '--no-default-browser-check',
    '--password-store=basic',
    '--use-mock-keychain',
    '--ignore-certificate-errors',
    `--window-size=${w},${h}`,
    `--window-position=${randomInt(0, 24)},${randomInt(0, 24)}`,
    `--lang=${locale}`,
    ...getWebrtcLaunchArgs(Boolean(config.proxy.enabled)),
    ...(attachProxy ? getProxyLaunchArgs(identity.proxy) : []),
  ];
}

function computeGapMs(config) {
  const minSec = config.intervalMinSec;
  const maxSec = config.intervalMaxSec;
  if (maxSec > 0) {
    return randomInt(minSec * 1000, maxSec * 1000);
  }
  const minMs = config.stealth.gapMinMs;
  const maxMs = config.stealth.gapMaxMs;
  if (maxMs <= 0) return 0;
  return randomInt(minMs, maxMs);
}

async function applyFingerprint(page, identity) {
  await page.evaluateOnNewDocument((id) => {
    const patch = (obj, prop, value) => {
      try {
        Object.defineProperty(obj, prop, {
          get: () => value,
          configurable: true,
        });
      } catch {
        // ignore
      }
    };

    patch(navigator, 'platform', id.platform);
    patch(navigator, 'language', id.language);
    patch(navigator, 'languages', Object.freeze([].concat(id.languages)));
    patch(navigator, 'hardwareConcurrency', id.hardwareConcurrency);
    patch(navigator, 'deviceMemory', id.deviceMemory);
    patch(navigator, 'maxTouchPoints', id.maxTouchPoints);
    patch(navigator, 'vendor', id.vendor || 'Google Inc.');
    patch(navigator, 'vendorSub', '');
    patch(navigator, 'productSub', '20030107');
    patch(navigator, 'doNotTrack', null);

    if (id.screen) {
      patch(screen, 'width', id.screen.width);
      patch(screen, 'height', id.screen.height);
      patch(screen, 'availWidth', id.screen.availWidth);
      patch(screen, 'availHeight', id.screen.availHeight);
      patch(screen, 'colorDepth', id.screen.colorDepth || 24);
      patch(screen, 'pixelDepth', id.screen.colorDepth || 24);
    }

    const outerW = id.viewport.width;
    const outerH = id.viewport.height + 85;
    patch(window, 'outerWidth', outerW);
    patch(window, 'outerHeight', outerH);
    patch(window, 'devicePixelRatio', id.viewport.deviceScaleFactor || 1);

    const unmaskedVendor = 0x9245;
    const unmaskedRenderer = 0x9246;
    const proto = window.WebGLRenderingContext && window.WebGLRenderingContext.prototype;
    if (proto && id.webgl) {
      const original = proto.getParameter;
      proto.getParameter = function patchedGetParameter(param) {
        if (param === unmaskedVendor) return id.webgl.vendor;
        if (param === unmaskedRenderer) return id.webgl.renderer;
        return original.call(this, param);
      };
    }

    if (!navigator.getBattery) {
      navigator.getBattery = () =>
        Promise.resolve({
          charging: true,
          chargingTime: 0,
          dischargingTime: Infinity,
          level: 1,
          addEventListener() {},
          removeEventListener() {},
        });
    }

    try {
      const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (conn) {
        patch(conn, 'effectiveType', '4g');
        patch(conn, 'rtt', 50);
        patch(conn, 'downlink', 10);
        patch(conn, 'saveData', false);
      }
    } catch {
      // ignore
    }
  }, {
    platform: identity.platform,
    language: identity.language,
    languages: identity.languages,
    vendor: identity.vendor,
    hardwareConcurrency: identity.hardwareConcurrency,
    deviceMemory: identity.deviceMemory,
    maxTouchPoints: identity.maxTouchPoints,
    viewport: identity.viewport,
    screen: identity.screen,
    webgl: identity.webgl,
  });
}

async function applyCdpOverrides(page, identity) {
  const client = typeof page.createCDPSession === 'function'
    ? await page.createCDPSession()
    : await page.target().createCDPSession();

  const major = String(identity.chromeMajor || '131');
  const full = identity.chromeFull || `${major}.0.0.0`;

  try {
    await client.send('Emulation.setTimezoneOverride', { timezoneId: identity.timezone });
  } catch {
    // ignore
  }

  try {
    await client.send('Emulation.setLocaleOverride', { locale: identity.locale });
  } catch {
    // ignore
  }

  try {
    await client.send('Emulation.setGeolocationOverride', {
      latitude: identity.geolocation.latitude,
      longitude: identity.geolocation.longitude,
      accuracy: 40,
    });
  } catch {
    // ignore
  }

  const uaOverride = {
    userAgent: identity.userAgent,
    acceptLanguage: formatAcceptLanguage(identity.languages),
    platform: identity.platform,
    userAgentMetadata: {
      brands: [
        { brand: 'Not)A;Brand', version: '99' },
        { brand: 'Google Chrome', version: major },
        { brand: 'Chromium', version: major },
      ],
      fullVersion: full,
      platform: identity.uaPlatform,
      platformVersion: identity.platformVersion || '',
      architecture: 'x86',
      model: '',
      mobile: false,
      bitness: '64',
      wow64: false,
    },
  };

  try {
    await client.send('Network.setUserAgentOverride', uaOverride);
  } catch {
    await client.send('Network.setUserAgentOverride', {
      userAgent: identity.userAgent,
      acceptLanguage: formatAcceptLanguage(identity.languages),
      platform: identity.platform,
    });
  }

  return client;
}

module.exports = {
  formatAcceptLanguage,
  extraHttpHeaders,
  findChromeExecutable,
  getLaunchArgs,
  computeGapMs,
  applyFingerprint,
  applyCdpOverrides,
};
