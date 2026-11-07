/**
 * 11/07 현장 요청 두 가지 (앱 v25).
 *  - 40분 넘게 소식 없는 조를 **이름으로** 보이고, 누르면 그 조 카드로 스크롤 (D-084) — 콘솔·교역자 진행 공용.
 *  - 도착 3분 뒤부터 완료 (D-085) — 3초 잠금(v19.1)은 한 폰의 연타만 막아 "도착 14:01 · 완료 14:01" 이 들어갔다.
 *    기준은 **기록된 도착 시각**이라 다른 조원이 누른 도착에도 걸린다. 거점 스태프 화면은 잠그지 않는다.
 * 데모 10/31: 1조 마지막 14:36(CP4 도착) · 2조 15:12 · 3조·4조 완주 · 11/07 1조 기록 없음.
 *   16:10 이면 1조 94분(1시간 34분) · 2조 58분 · 3조 50분(CP1 이 남아 3/4) → 셋 다 ⚠, 오래 조용한 1조가 먼저.
 *   4조만 완주라 빠진다.
 */
const { ok, section, done } = require('../lib/check');
const { withBrowser, login, adminLogin, allSessions, bodies, waitToast, smallText, noHScroll } = require('../lib/browser');

const LATE = '2026-10-31T16:10:00+09:00';
const jumps = (page) => page.evaluate(() => [...document.querySelectorAll('.team-alert__jump')].map(b => ({
  key: b.getAttribute('data-jump-team'), text: b.textContent
})));
const cardBox = (page, key) => page.evaluate(k => {
  const c = [...document.querySelectorAll('.team-card')].find(e => e.getAttribute('data-team') === k);
  const r = c.getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight, jumped: c.classList.contains('is-jumped') };
}, key);
const visible = (b) => b.top >= 0 && b.bottom <= b.vh;

async function jumpTo(page, key) {
  await page.click('.team-alert__jump[data-jump-team="' + key + '"]');
  await page.waitForFunction(k => {
    const c = [...document.querySelectorAll('.team-card')].find(e => e.getAttribute('data-team') === k);
    const r = c.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight;
  }, key, { timeout: 4000 }).catch(() => {});
  return cardBox(page, key);
}

const cpWait = (page, code) => page.evaluate(c => {
  const el = document.querySelector('#cp-' + c);
  const b = el && el.querySelector('.cp__next');
  const w = el && el.querySelector('.cp__wait');
  return { btn: b ? b.textContent : null, disabled: b ? b.disabled : null, wait: w ? w.textContent : '' };
}, code);
const forceClick = (page, code) => page.evaluate(c => {
  const b = document.querySelector('#cp-' + c + ' .cp__next'); b.disabled = false; b.click();
}, code);
const sentComplete = async (page) => (await bodies(page, 'progress.set'))
  .filter(b => (b.items || []).some(it => it.status === '완료'));

async function openCourse(env, persona, at) {
  const page = await env.open({ persona, at });
  await login(page);
  await page.click('#tabbar [data-view="course"]');
  await page.waitForSelector('.cp');
  return page;
}

withBrowser(async (env) => {
  // ------------------------------------------------------------ D-084
  section('🔴 운영 콘솔 — 40분 넘게 소식 없는 조를 이름으로 (D-084)');
  let page = await env.open({ mode: 'admin', width: 390, at: LATE });
  await adminLogin(page);
  await page.click('#tabbar [data-view="progress"]');
  await page.waitForSelector('.team-card');
  ok('경고 줄: 3개 조', (await page.textContent('.team-alert')).includes('3개 조가 40분 넘게 소식이 없습니다'), await page.textContent('.team-alert'));
  let j = await jumps(page);
  ok('🔴 조 이름 단추 — 오래 조용한 조부터 · 몇 분째인지', JSON.stringify(j) === JSON.stringify([
    { key: '10/31(토) 1조', text: '1조 배재 · 1시간 34분 전' },
    { key: '10/31(토) 2조', text: '2조 정동 · 58분 전' },
    { key: '10/31(토) 3조', text: '3조 이화 · 50분 전' }]), j);
  ok('완주한 4조·기록 없는 조(11/07)는 없다', j.length === 3);
  ok('13px 미만 없음 · 가로 넘침 없음 @390', (await smallText(page)).length === 0 && await noHScroll(page), await smallText(page));
  const before = await cardBox(page, '10/31(토) 2조');
  ok('(전제) 2조 카드는 처음에 화면 밖', !visible(before), before);
  let after = await jumpTo(page, '10/31(토) 2조');
  ok('🔴 누르면 2조 카드로 스크롤 — 화면 안에', visible(after), after);
  ok('   잠깐 테두리를 밝힌다', after.jumped, after);
  after = await jumpTo(page, '10/31(토) 1조');
  ok('다른 조를 누르면 그 조로', visible(after) && after.jumped, after);

  await allSessions(page);
  await page.waitForSelector('.team-alert__jump');
  j = await jumps(page);
  ok('전체 회차면 단추에 회차도', j.length === 3 && j[0].text === '1조 배재 10/31(토) · 1시간 34분 전', j);
  await page.context().close();

  section('🔴 교역자 진행 — 같은 경고 줄 · 같은 스크롤');
  page = await env.open({ persona: 'pastor', at: LATE });
  await login(page);
  await page.click('#tabbar [data-view="course"]');
  await page.waitForSelector('.team-card');
  j = await jumps(page);
  ok('교역자 화면에도 조 이름 단추 셋', j.length === 3 && j[1].text === '2조 정동 · 58분 전', j);
  after = await jumpTo(page, '10/31(토) 2조');
  ok('🔴 누르면 2조 카드로', visible(after) && after.jumped, after);
  await page.context().close();

  // ------------------------------------------------------------ D-085
  section('🔴 다른 조원이 누른 도착에도 3분 잠금 — 기록된 도착 시각 기준 (D-085)');
  // 14:37:30 — CP4 는 14:36 에 (다른 사람이) 도착 기록됨. 이 폰은 아무것도 안 눌렀다.
  page = await openCourse(env, 'member', '2026-10-31T14:37:30+09:00');
  let w = await cpWait(page, 'CP4');
  ok('🔴 "완료했어요" 가 잠겨 있다', w.btn === '완료했어요' && w.disabled === true, w);
  ok('   언제 열리는지: 14:39부터', w.wait === '완료는 도착 3분 뒤 14:39부터 누를 수 있어요.', w);
  ok('   안내 문구에도 3분', (await page.textContent('.section-head .hint')).includes('완료는 도착 3분 뒤부터 눌립니다'));
  ok('   13px 미만 없음', (await smallText(page)).length === 0, await smallText(page));
  await forceClick(page, 'CP4');
  await waitToast(page, '완료는 도착 3분 뒤 14:39부터');
  ok('🔴 잠긴 단추를 우회해 눌러도 보내지 않는다', (await sentComplete(page)).length === 0 && (await cpWait(page, 'CP4')).btn === '완료했어요');
  await page.clock.runFor(91000);           // 14:39:00 을 넘긴다 — 타이머가 다시 그린다
  w = await cpWait(page, 'CP4');
  ok('🔴 3분이 지나면 저절로 풀린다', w.disabled === false && w.wait === '', w);
  await page.click('#cp-CP4 .cp__next');
  await waitToast(page, '기록했습니다: 완료');
  ok('   풀린 뒤에는 완료가 나간다', (await sentComplete(page)).length === 1);
  await page.context().close();

  section('🔴 이 폰이 도착을 누르면 3분 동안 완료가 잠긴다 — 3초 잠금이 끝나도');
  page = await openCourse(env, 'leader');
  ok('(전제) 14:36 도착한 CP4 는 49분 지나 바로 완료 가능', (await cpWait(page, 'CP4')).disabled === false);
  await page.click('#cp-CP4 .cp__next');
  await waitToast(page, '기록했습니다: 완료');
  await page.clock.runFor(3100);
  await page.click('#cp-CP1 .cp__next');    // 다음 지점 CP1 — 도착했어요
  await waitToast(page, '기록했습니다: 도착');
  await page.clock.runFor(3100);            // 3초 잠금(v19.1)이 끝난다
  w = await cpWait(page, 'CP1');
  ok('🔴 3초 뒤에도 CP1 "완료했어요" 는 잠겨 있다', w.btn === '완료했어요' && w.disabled === true, w);
  ok('   열리는 시각: 15:29부터 (15:25 도착 + 3분, 분 올림)', w.wait === '완료는 도착 3분 뒤 15:29부터 누를 수 있어요.', w);
  ok('   "도착 취소" 는 잠그지 않는다', await page.evaluate(() => document.querySelector('#cp-CP1 .cp__undo').disabled === false));
  const before1 = (await sentComplete(page)).length;
  await forceClick(page, 'CP1');
  await waitToast(page, '완료는 도착 3분 뒤');
  ok('🔴 우회해 눌러도 CP1 완료는 나가지 않는다', (await sentComplete(page)).length === before1);
  await page.clock.runFor(3 * 60000);
  w = await cpWait(page, 'CP1');
  ok('3분 뒤 풀린다', w.disabled === false && w.wait === '', w);
  await page.context().close();

  section('거점 스태프 화면은 잠그지 않는다 — 운영진이 몰아 적는 곳');
  page = await env.open({ persona: 'staff' });
  await login(page);
  await page.click('#tabbar [data-view="course"]');
  await page.waitForSelector('.st-row[data-group="3조"]');
  await page.click('.st-row[data-group="3조"] [data-st="set"][data-status="도착"]');
  await page.waitForSelector('.st-row[data-group="3조"] [data-st="set"][data-status="완료"]:not([disabled])');
  await page.click('.st-row[data-group="3조"] [data-st="set"][data-status="완료"]');
  await waitToast(page, '3조 완료');
  const st = await bodies(page, 'station.set');
  ok('스태프는 도착 바로 뒤 완료가 나간다', st.length === 2 && st[1].items[0].status === '완료', st);
  await page.context().close();

  section('런타임 오류');
  ok('JS 오류 없음', env.errors.length === 0, env.errors);
}).then(done, e => { console.error(e); process.exit(1); });
