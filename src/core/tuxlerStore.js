'use strict';

const fs = require('fs');
const path = require('path');
const { resolveTuxlerSocksEndpoint } = require('./proxy');

const STORE_PATH = path.join(process.cwd(), 'logs', 'tuxler-exits.json');
const MAX_EXITS = 500;

let chain = Promise.resolve();

function emptyStore(socksUrl = null) {
  return {
    updatedAt: new Date().toISOString(),
    socks: socksUrl,
    note:
      'O campo socks é o proxy reutilizável (Tuxler local). ip/countryCode é o egress — o site vê esse IP; não é um host para conectar depois. Para repetir a saída, ligue o Tuxler no mesmo país com o app aberto.',
    exits: [],
  };
}

function readStore() {
  try {
    if (!fs.existsSync(STORE_PATH)) return emptyStore();
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    if (!parsed || !Array.isArray(parsed.exits)) return emptyStore(parsed?.socks);
    return parsed;
  } catch {
    return emptyStore();
  }
}

function writeStore(data) {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${STORE_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, STORE_PATH);
}

function socksUrlFromConfig(config) {
  try {
    const endpoint = resolveTuxlerSocksEndpoint(config || {});
    return endpoint?.proxyUrl || 'socks5://127.0.0.1:23321';
  } catch {
    return 'socks5://127.0.0.1:23321';
  }
}

function rememberTuxlerExit(slot, config = {}) {
  const ip = String(slot?.ip || slot?.geo?.ip || '').trim();
  if (!ip) return chain;

  const socks = socksUrlFromConfig(config);
  const now = new Date().toISOString();
  const countryCode = String(
    slot?.geo?.countryCode || slot?.country || ''
  )
    .trim()
    .toUpperCase();

  chain = chain
    .then(() => {
      const store = readStore();
      store.socks = socks;
      store.updatedAt = now;
      store.note = emptyStore().note;

      let row = store.exits.find((e) => e.ip === ip);
      if (!row) {
        row = {
          ip,
          countryCode: countryCode || null,
          country: slot?.geo?.country || null,
          timezoneId: slot?.geo?.timezoneId || null,
          locale: slot?.geo?.locale || null,
          isp: slot?.geo?.isp || null,
          socks,
          firstSeenAt: now,
          lastSeenAt: now,
          hits: 0,
        };
        store.exits.unshift(row);
        if (store.exits.length > MAX_EXITS) {
          store.exits.length = MAX_EXITS;
        }
      }
      row.countryCode = countryCode || row.countryCode;
      row.country = slot?.geo?.country || row.country;
      row.timezoneId = slot?.geo?.timezoneId || row.timezoneId;
      row.locale = slot?.geo?.locale || row.locale;
      row.isp = slot?.geo?.isp || row.isp;
      row.socks = socks;
      row.lastSeenAt = now;
      row.hits = (Number(row.hits) || 0) + 1;

      writeStore(store);
    })
    .catch(() => {});

  return chain;
}

function listTuxlerExits() {
  return readStore();
}

module.exports = {
  STORE_PATH,
  rememberTuxlerExit,
  listTuxlerExits,
};
