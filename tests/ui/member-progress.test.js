/**
 * 조원도 도착·완료 — 한 사람이 누르면 조 전체에 (D-081, GAS v24 · 앱 v24).
 *   현장 요청: "기록가가 도착/완료 찍을 수 있게". 기록가를 지정할 시간이 없어 조원 누구나 누르게 한다.
 *   서버가 MEMBER_PROGRESS 를 켜 보낼 때만 조원에게 버튼 — 옛 서버(v23)는 키가 없어 버튼이 숨는다.
 *   보통 버튼은 undo:false(앞으로만), 취소는 undo:true. 다른 조원이 먼저 더 앞으로 기록했으면 그대로 두고 알린다.
 * 데모: 조원 페르소나도 1조(조장과 같은 조). 1조 코스 CP3 완료 · CP4 도착 · CP1 · CP2.
 */
const { ok, section, done } = require('../lib/check');
const { withBrowser, login, bodies, waitToast, smallText, noHScroll } = require('../lib/browser');

const status = (page, code) => page.evaluate(c => (document.querySelector('#cp-' + c) || {}).getAttribute
  ? document.querySelector('#cp-' + c).getAttribute('data-status') : null, code);
const toastText = (page) => page.evaluate(() => document.querySelector('#toast').textContent);
/** 다른 조원(조장 페르소나)이 같은 가짜 서버에 기록한다 — 이 화면은 모른 채 낡는다 */
const otherRecords = (page, items) => page.evaluate(async (its) => {
  sessionStorage.setItem('demo_persona', 'leader');
  try {
    await window.fetch(window.__DEMO_API, { method: 'POST', body: JSON.stringify({ action: 'progress.set', items: its }) });
  } finally { sessionStorage.setItem('demo_persona', 'member'); }
}, items);
const unpause = (page) => page.clock.runFor(3100);   // 누른 뒤 3초 잠금 (v19.1)

async function openCourse(env, opt) {
  const page = await env.open(Object.assign({ persona: 'member' }, opt || {}));
  await login(page);
  await page.click('#tabbar [data-view="course"]');
  await page.waitForSelector('.cp');
  return page;
}

withBrowser(async (env) => {
  section('🔴 조원 코스에 도착·완료 버튼 — 서버가 MEMBER_PROGRESS 를 켜면');
  let page = await openCourse(env);
  ok('🔴 다음 지점(CP4 도착)에 "완료했어요"', await page.locator('.cp--next .cp__next').count() === 1 &&
    (await page.locator('.cp--next .cp__next').textContent()) === '완료했어요');
  ok('안내: 조원 누구나 · 조 전체에 반영', (await page.evaluate(() => document.querySelector('.section-head .hint').textContent))
    .includes('조원 누구나 누를 수 있고, 한 사람이 누르면 조 전체에 반영됩니다'));
  ok('13px 미만 글자 없음 · 가로로 밀리지 않는다', (await smallText(page)).length === 0 && await noHScroll(page), await smallText(page));

  await page.click('.cp--next .cp__next');
  await waitToast(page, '기록했습니다: 완료');
  let sent = (await bodies(page, 'progress.set')).pop();
  ok('🔴 보통 버튼은 undo:false 로 보낸다 (서버는 앞으로만)', sent && JSON.stringify(sent.items) === JSON.stringify([{ checkpoint: 'CP4', status: '완료', undo: false }]), sent);
  ok('카드가 완료로', await status(page, 'CP4') === '완료');

  section('취소는 확인 뒤 undo:true');
  await unpause(page);
  await page.evaluate(() => document.querySelector('#cp-CP4 .cp__undo').click());
  await page.click('.modal [data-act="ok"]');
  await waitToast(page, '기록했습니다: 도착');
  sent = (await bodies(page, 'progress.set')).pop();
  ok('🔴 완료 취소 → {CP4, 도착, undo:true}', sent && JSON.stringify(sent.items) === JSON.stringify([{ checkpoint: 'CP4', status: '도착', undo: true }]), sent);
  ok('카드가 도착으로', await status(page, 'CP4') === '도착');

  section('🔴 다른 조원이 먼저 더 앞으로 기록했으면 — 그대로 두고 알린다');
  await otherRecords(page, [{ checkpoint: 'CP1', status: '완료' }]);
  ok('이 화면은 아직 CP1 대기 (낡음)', await status(page, 'CP1') === '대기');
  await unpause(page);
  await page.evaluate(() => document.querySelector('#cp-CP1 .cp__next').click());   // 낡은 "도착했어요"
  await waitToast(page, '그대로 두었습니다');
  ok('🔴 "다른 조원이 먼저 기록해 그대로 두었습니다 — 배재학당역사박물관 완료"',
    (await toastText(page)).includes('다른 조원이 먼저 기록해 그대로 두었습니다 — 배재학당역사박물관 완료'), await toastText(page));
  ok('🔴 CP1 은 완료 그대로 (도착으로 내려가지 않았다)', await status(page, 'CP1') === '완료');

  section('🔴 다시 보이면 코스를 새로 읽는다 — 다른 조원이 누른 것이 보이게');
  await unpause(page);
  await otherRecords(page, [{ checkpoint: 'CP2', status: '도착' }]);
  ok('아직 CP2 대기', await status(page, 'CP2') === '대기');
  const lists = async () => (await bodies(page, 'progress.list')).length;
  const before = await lists();
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const fresh = await page.waitForFunction(() => (document.querySelector('#cp-CP2') || {}).getAttribute &&
    document.querySelector('#cp-CP2').getAttribute('data-status') === '도착', null, { timeout: 4000 }).then(() => true, () => false);
  ok('🔴 visible → 코스를 다시 읽어 CP2 도착이 보인다', fresh && (await lists()) === before + 1, { fresh, before, after: await lists() });
  await page.context().close();

  section('🔴 옛 서버(v23, MEMBER_PROGRESS 없음) — 조원 버튼을 그리지 않는다');
  page = await openCourse(env, {
    // 가짜 서버가 window.fetch 를 갈아 끼우는 순간 감싸, bootstrap 응답에서 설정 키를 뺀다
    init: () => {
      let inner = window.fetch;
      Object.defineProperty(window, 'fetch', {
        configurable: true,
        get() { return inner; },
        set(v) {
          inner = function (url, o) {
            let b = {};
            try { b = JSON.parse((o && o.body) || '{}'); } catch (e) { /* GET */ }
            const p = v.apply(this, arguments);
            if (b.action !== 'bootstrap') return p;
            return p.then(r => r.text()).then(t => {
              const j = JSON.parse(t);
              if (j.data && j.data.config) delete j.data.config.MEMBER_PROGRESS;
              const out = JSON.stringify(j);
              return { ok: true, status: 200, text: () => Promise.resolve(out) };
            });
          };
        }
      });
    }
  });
  ok('🔴 버튼 없음', await page.locator('.cp__actions').count() === 0);
  ok('안내: "상태는 조장이 기록합니다"', (await page.evaluate(() => document.querySelector('.section-head .hint').textContent)).includes('상태는 조장이 기록합니다'));
  await page.context().close();

  section('런타임 오류');
  ok('JS 오류 없음', env.errors.length === 0, env.errors);
}).then(done, e => { console.error(e); process.exit(1); });
