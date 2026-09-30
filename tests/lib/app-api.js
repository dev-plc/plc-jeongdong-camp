/**
 * 앱의 `docs/assets/js/api.js` 를 **그대로** Node 에서 올린다 — 브라우저 없이 통신 계층만 시험한다.
 *
 * fetch 는 테스트가 준 함수로 바꾼다: route(url, init) → { status, body } (body 는 문자열 또는 객체).
 * 시계·localStorage·crypto(WebCrypto)·TextEncoder 는 Node 것을 쓴다.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'assets', 'js', 'api.js'), 'utf8');

function memoryStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
           removeItem: k => m.delete(k), clear: () => m.clear() };
}

/**
 * @param {object} cfg   APP_CONFIG 덮어쓰기 (SUPABASE_URL 등)
 * @param {function} route (url, init) => {status, body} | Promise<…>
 * @param {object} [opt] crypto: false 면 crypto.subtle 이 없는 옛 브라우저
 */
function loadApi(cfg, route, opt) {
  opt = opt || {};
  const calls = [];
  const win = {
    APP_CONFIG: Object.assign({
      API_BASE: 'https://gas.test/exec', TOKEN_KEY: 'plc_jd_token',
      REQUEST_TIMEOUT: 5000, UPLOAD_TIMEOUT: 5000, MIRROR_TIMEOUT: 300,
      MIRROR_MAX_AGE: 26 * 3600e3, BOOTSTRAP_TTL: 1
    }, cfg || {}),
    localStorage: memoryStorage(),
    sessionStorage: memoryStorage(),
    console: { log() {}, warn() {}, error() {} },
    crypto: opt.crypto === false ? undefined : globalThis.crypto,
    performance: { now: () => Date.now() }
  };
  win.window = win;
  win.fetch = (url, init) => {
    calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null });
    return Promise.resolve(route(url, init || {})).then(res => {
      if (res && res.hang) {
        // 응답이 안 온다 — AbortController 로 끊겨야 한다
        return new Promise((resolve, reject) => {
          const sig = init && init.signal;
          if (sig) sig.addEventListener('abort', () => reject(new Error('aborted')));
        });
      }
      const status = (res && res.status) || 200;
      const text = res && typeof res.body !== 'string' ? JSON.stringify(res.body === undefined ? null : res.body) : res.body;
      return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(text), json: () => Promise.resolve(JSON.parse(text)) };
    });
  };
  const ctx = vm.createContext(Object.assign(win, {
    setTimeout, clearTimeout, Promise, AbortController, TextEncoder, Uint8Array, JSON, Date, Math, Array, Object, String
  }));
  vm.runInContext('localStorage = window.localStorage; sessionStorage = window.sessionStorage;', ctx);
  vm.runInContext(SRC, ctx, { filename: 'api.js' });
  return { API: win.API, calls, win };
}

module.exports = { loadApi };
