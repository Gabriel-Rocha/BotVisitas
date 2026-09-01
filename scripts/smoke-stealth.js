'use strict';

const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

process.env.SESSION_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'botvisitas-session-'));
process.env.STEALTH = 'true';
process.env.HUMANIZE = 'true';
process.env.TUXLER_ENABLED = 'false';
delete process.env.SESSION_PERSIST;

const { loadConfig } = require('../src/config');
const {
  parseChromeVersion,
  buildUserAgent,
  buildSecChUa,
  createBaseIdentity,
  finalizeIdentity,
  nextVisitor,
} = require('../src/core/identity');
const {
  extraHttpHeaders,
  formatAcceptLanguage,
  computeGapMs,
  getLaunchArgs,
} = require('../src/core/stealth');
const { parseCountryList, getProxyLaunchArgs } = require('../src/core/proxy');
const { clickPoint } = require('../src/core/human');

const config = loadConfig();
assert.strictEqual(config.strategy, 'directLink');
assert.strictEqual(config.session.persist, false);
assert.strictEqual(config.stealth.enabled, true);
assert.strictEqual(config.stealth.humanize, true);
assert.ok(config.browserProfiles.length >= 3);

const chrome = parseChromeVersion('HeadlessChrome/131.0.6778.108');
assert.strictEqual(chrome.major, '131');
assert.strictEqual(chrome.full, '131.0.6778.108');

const uaWin = buildUserAgent({ uaPlatform: 'Windows' }, chrome);
assert.ok(uaWin.includes('Windows NT 10.0'));
assert.ok(uaWin.includes('Chrome/131.0.6778.108'));
assert.ok(!uaWin.includes('HeadlessChrome'));
assert.ok(!uaWin.includes('Firefox'));

const identity = finalizeIdentity(createBaseIdentity(config), 'Chrome/131.0.6778.108');
assert.ok(identity.userAgent);
assert.ok(identity.secChUa.includes('Google Chrome'));
assert.strictEqual(identity.secChUa, buildSecChUa('131'));
assert.ok(identity.timezone);

const headers = extraHttpHeaders(identity);
assert.ok(headers['Accept-Language'].startsWith(identity.language));
assert.ok(headers['sec-ch-ua']);
assert.strictEqual(headers['sec-ch-ua-mobile'], '?0');
assert.ok(formatAcceptLanguage(['pt-BR', 'pt', 'en']).includes('q=0.9'));

const args = getLaunchArgs(config, identity);
assert.ok(args.some((a) => a.includes('disable-blink-features=AutomationControlled')));
assert.ok(args.some((a) => a.startsWith('--window-size=')));
assert.ok(!args.includes('--enable-automation'));
assert.ok(!args.includes('--disable-http2'));

assert.deepStrictEqual(getProxyLaunchArgs(null), []);
assert.deepStrictEqual(parseCountryList('au, de ; us'), ['au', 'de', 'us']);

const argsNoProxy = getLaunchArgs(config, identity, { attachProxy: false });
assert.ok(!argsNoProxy.some((a) => a.startsWith('--proxy-server=')));

const logs = [];
const visitor = nextVisitor(config, 'Chrome/131.0.6778.108', {
  info: (...args) => logs.push(args.join(' ')),
});
assert.ok(visitor.userAgent);
assert.ok(logs.some((line) => line.includes('Visitante novo')));

const gap = computeGapMs(config);
assert.ok(gap >= config.stealth.gapMinMs);
assert.ok(gap <= config.stealth.gapMaxMs);

const point = clickPoint({ width: 1920, height: 1080 });
assert.ok(point.x > 400 && point.x < 1500);
assert.ok(point.y > 200 && point.y < 900);

console.log('smoke-stealth: ok');
console.log(`  perfil=${identity.profileId} chrome=${identity.chromeMajor} uaPlatform=${identity.uaPlatform}`);
