/**
 * 화면 스위트 공용 — docs/ 를 내장 http 서버로 띄우고 Playwright(Chromium)로 demo.html 을 연다.
 *
 * 데모는 실제 앱 코드를 그대로 인라인하고 fetch 만 가짜 백엔드에 물린 페이지다(tools/build-demo.js).
 * 🔴 데모 데이터는 10/31 이라 **시계를 고정**한다(page.clock). headless 는 UTC 로 돌므로
 *    timezoneId 를 안 주면 15:25 KST 가 06:25 가 되어 엉뚱한 화면이 나온다.
 *
 * Playwright 가 없으면 findPlaywright() 가 null — 스위트는 "건너뜀" 을 찍고 끝낸다(조용히 통과하지 않는다).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const DOCS = path.join(__dirname, '..', '..', 'docs');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

function findPlaywright() {
  const tries = ['playwright', '/opt/node22/lib/node_modules/playwright'];
  for (const t of tries) { try { return require(t); } catch (e) { /* 다음 */ } }
  return null;
}

function findChromium() {
  const cands = [];
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  try {
    fs.readdirSync(base).filter(d => /^chromium-\d+$/.test(d)).sort().reverse()
      .forEach(d => cands.push(path.join(base, d, 'chrome-linux', 'chrome')));
  } catch (e) { /* 없음 */ }
  return cands.find(p => fs.existsSync(p)); // 없으면 undefined → Playwright 기본값
}

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
      const file = path.join(DOCS, rel);
      if (!file.startsWith(DOCS) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

/**
 * 스위트를 돌린다. body(env) 는 env.open(...) 으로 페이지를 연다.
 * pageerror 는 모두 env.errors 에 모인다 — 스위트 끝에서 0 인지 본다.
 */
async function withBrowser(body) {
  const pw = findPlaywright();
  if (!pw) {
    console.log('\n⚠ 건너뜀: Playwright 를 찾지 못했습니다 (npm i -g playwright). 화면 스위트는 돌지 않았습니다.');
    console.log('\nSKIPPED');
    process.exit(0);
  }
  const { server, base } = await serve();
  const browser = await pw.chromium.launch({ executablePath: findChromium() });
  const errors = [];

  /**
   * @param {object} o  at: 고정 시각(ISO) · width · persona(leader|member|staff|pastor) · mode(participant|admin)
   */
  async function open(o) {
    o = o || {};
    const ctx = await browser.newContext({ viewport: { width: o.width || 390, height: 844 }, timezoneId: 'Asia/Seoul' });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    await page.clock.install({ time: new Date(o.at || '2026-10-31T15:25:00+09:00') });
    await page.route('https://fonts.**', r => r.abort());
    await page.addInitScript(([p, m]) => {
      try { sessionStorage.setItem('demo_persona', p); sessionStorage.setItem('demo_mode', m); } catch (e) { /* 없음 */ }
    }, [o.persona || 'leader', o.mode || 'participant']);
    await page.goto(base + '/demo.html', { waitUntil: 'networkidle' });
    // 요청 본문을 모아 둔다 — 무엇을 보냈는지 봐야 한다
    await page.evaluate(() => {
      window.__BODIES = [];
      const f = window.fetch;
      window.fetch = function (url, init) {
        try { window.__BODIES.push(JSON.parse((init && init.body) || '{}')); } catch (e) { /* GET */ }
        return f.apply(this, arguments);
      };
    });
    return page;
  }

  try {
    await body({ open, errors, base });
  } finally {
    await browser.close();
    server.close();
  }
}

// ------------------------------------------------------------------ 페이지 도우미

async function login(page, waitFor) {
  await page.fill('input[name="name"]', '아무개');
  await page.fill('input[name="last4"]', '1234');
  await page.click('#loginForm button[type="submit"]');
  await page.waitForSelector(waitFor || '#tabbar:not([hidden])');
}

async function adminLogin(page) {
  await page.waitForSelector('#pinForm');
  await page.fill('input[name="pin"]', '000000');
  await page.click('#pinForm button');
  await page.waitForSelector('.jcard, .empty');
}

const text = (page, sel) => page.evaluate(s => { const el = document.querySelector(s); return el ? el.textContent : null; }, sel);
const bodies = (page, action) => page.evaluate(a => window.__BODIES.filter(b => b.action === a), action);
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const waitToast = (page, t) => page.waitForFunction(x => {
  const el = document.querySelector('#toast');
  return el && el.classList.contains('show') && el.textContent.includes(x);
}, t, { timeout: 5000 });

/** 보이는 글자 중 13px 미만 (D-050 하한). 데모 바·개발용 perf 패널은 뺀다. */
const smallText = (page) => page.evaluate(() => {
  const out = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) {
    const n = w.currentNode;
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    if (el.closest('#demobar, .perf') || !el.checkVisibility()) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 13) out.push(fs + 'px ' + el.tagName + '.' + el.className + ' "' + n.textContent.trim().slice(0, 16) + '"');
  }
  return out;
});

module.exports = { withBrowser, findPlaywright, login, adminLogin, text, bodies, noHScroll, waitToast, smallText };
