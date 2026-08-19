'use strict';

const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

process.env.SESSION_PERSIST = 'false';
process.env.SESSION_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'botvisitas-session-'));
process.env.STEALTH = 'true';
process.env.HUMANIZE = 'true';
process.env.PROXY_ENABLED = 'false';

const { loadConfig } = require('../src/config');
const {
  parseChromeVersion,
  buildUserAgent,
  buildSecChUa,
  createBaseIdentity,
  finalizeIdentity,
} = require('../src/core/identity');
const {
  extraHttpHeaders,
  formatAcceptLanguage,
  computeGapMs,
  getLaunchArgs,
} = require('../src/core/stealth');
const { parseProxyServer, parseProxyList, getProxyLaunchArgs } = require('../src/core/proxy');
const { clickPoint } = require('../src/core/human');

const config = loadConfig();
assert.strictEqual(config.strategy, 'directLink');
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

const parsed = parseProxyServer('http://user:p%40ss@10.0.0.2:8080');
assert.strictEqual(parsed.host, '10.0.0.2');
assert.strictEqual(parsed.port, '8080');
assert.strictEqual(parsed.username, 'user');
assert.strictEqual(parsed.password, 'p@ss');
assert.strictEqual(parsed.arg, 'http://10.0.0.2:8080');
assert.deepStrictEqual(getProxyLaunchArgs(parsed), ['--proxy-server=http://10.0.0.2:8080']);
assert.deepStrictEqual(parseProxyList('a:1, b:2\nc:3'), ['a:1', 'b:2', 'c:3']);

const gap = computeGapMs(config);
assert.ok(gap >= config.stealth.gapMinMs);
assert.ok(gap <= config.stealth.gapMaxMs);

const point = clickPoint({ width: 1920, height: 1080 });
assert.ok(point.x > 400 && point.x < 1500);
assert.ok(point.y > 200 && point.y < 900);

console.log('smoke-stealth: ok');
console.log(`  perfil=${identity.profileId} chrome=${identity.chromeMajor} uaPlatform=${identity.uaPlatform}`);
