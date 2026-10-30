/**
 * 운영 콘솔 열기 (D-072, 앱 v23.4) — 토큰 앞부분을 읽어 만료 전 관리자면 **확인 호출 없이** 바로 그린다.
 * 서버가 첫 요청에서 거절하면(만료·서명 불일치) 로그인 화면으로 돌아간다. 읽을 수 없는 토큰은 예전처럼 서버에 묻는다.
 * 데모 시계는 2026-10-31 15:25(서울)다.
 */
const { ok, section, done } = require('../lib/check');
const { withBrowser } = require('../lib/browser');

const tok = (claims) => Buffer.from(JSON.stringify(claims)).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.sig';
const LATER = Date.parse('2026-11-01T00:00:00+09:00'), EARLIER = Date.parse('2026-10-30T00:00:00+09:00');

/** 토큰을 넣고 콘솔을 연다. reject: 이 액션에 UNAUTHORIZED 를 돌려준다. */
const openWith = (env, token, reject) => env.open({ mode: 'admin', width: 1100, init: ([t, rej]) => {
  try { localStorage.setItem('plc_jd_admin_token', t); } catch (e) { /* 없음 */ }
  if (!rej) return;
  let inner;
  Object.defineProperty(window, 'fetch', { configurable: true, get: () => inner, set(f) {
    inner = function (u, i) {
      let action = ''; try { action = JSON.parse(i.body).action; } catch (e) { /* GET */ }
      if (action !== rej) return f.apply(this, arguments);
      window.__DEMO_CALLS.push(action);
      const body = JSON.stringify({ ok: false, error: { code: 'UNAUTHORIZED', message: '로그인이 만료되었습니다. 다시 로그인해 주세요.' } });
      return Promise.resolve({ ok: true, text: () => Promise.resolve(body) });
    };
  } });
}, initArg: [token, reject || ''] });
const calls = (page) => page.evaluate(() => window.__DEMO_CALLS.slice());
const view = (page) => page.evaluate(() => ({
  pin: !!document.querySelector('#pinForm'),
  tabbar: !document.querySelector('#tabbar').hidden,
  token: localStorage.getItem('plc_jd_admin_token')
}));

withBrowser(async (env) => {
  section('🔴 만료 전 관리자 토큰 → 확인 호출 없이 바로 첫 탭');
  let page = await openWith(env, tok({ pid: 'ADMIN', exp: LATER }));
  await page.waitForSelector('.jcard, .empty');
  let c = await calls(page), v = await view(page);
  ok('🔴 admin.journal.pending 을 부르지 않는다 (예전엔 이걸 기다린 뒤 그렸다)', !c.includes('admin.journal.pending'), c);
  ok('첫 요청은 첫 탭(일지 검수)의 목록', c.filter(x => /^admin\./.test(x))[0] === 'admin.journal.list', c);
  ok('탭바가 보이고 로그인 화면이 아니다', v.tabbar && !v.pin, v);
  await page.context().close();

  section('만료·참가자 토큰 → 로그인 화면, 서버는 부르지 않는다');
  for (const [label, t] of [['만료', tok({ pid: 'ADMIN', exp: EARLIER })], ['참가자', tok({ pid: 'P0001', exp: LATER })]]) {
    page = await openWith(env, t);
    await page.waitForSelector('#pinForm');
    c = await calls(page);
    ok(label + ' 토큰 → 로그인 화면 · admin.* 호출 없음', !c.some(x => /^admin\./.test(x)), c);
    await page.context().close();
  }

  section('🔴 서버가 첫 요청에서 거절하면 → 로그인 화면 (콘솔에 갇히지 않는다)');
  page = await openWith(env, tok({ pid: 'ADMIN', exp: LATER }), 'admin.journal.list');
  await page.waitForSelector('#pinForm');
  v = await view(page);
  ok('🔴 로그인 화면 · 탭바 숨김 · 토큰을 지웠다', v.pin && !v.tabbar && !v.token, v);
  ok('거절 이유를 알린다', await page.evaluate(() => document.querySelector('#toast').textContent.includes('다시 로그인')));
  await page.context().close();

  section('읽을 수 없는 토큰 → 예전처럼 서버에 묻는다');
  page = await openWith(env, 'demo-admin-token');
  await page.waitForSelector('.jcard, .empty');
  c = await calls(page);
  ok('admin.journal.pending 으로 확인한 뒤 콘솔', c.includes('admin.journal.pending') && (await view(page)).tabbar, c);
  await page.context().close();

  section('런타임 오류');
  ok('JS 오류 없음', env.errors.length === 0, env.errors);
}).then(done, e => { console.error(e); process.exit(1); });
