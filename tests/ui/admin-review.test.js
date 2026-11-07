/**
 * 운영 콘솔 — 캠프 당일이면 그 회차가 기본 · 일지 검수 회차 필터 · 체크해서 골라 승인 (D-083, 앱 v25).
 * 데모 데이터: 회차 10/31(토)·11/07(토)·사전답사(10/11, 비활성). 일지 대기 3건은 모두 10/31 —
 *   J0004 3조 · J0006 2조 · J0007 1조. 데모 시계 기본은 2026-10-31 15:25(서울).
 */
const { ok, section, done } = require('../lib/check');
const { withBrowser, adminLogin, bodies, noHScroll, smallText, waitToast } = require('../lib/browser');

const activeSession = (page) => page.evaluate(() => {
  const el = document.querySelector('#sessionFilter .tab.is-active');
  return el ? el.getAttribute('data-session') : null;
});
const cards = (page) => page.evaluate(() => [...document.querySelectorAll('#view .jcard')].map(c => ({
  id: c.getAttribute('data-id'), status: c.getAttribute('data-status'), pick: !!c.querySelector('[data-pick]')
})));
const pickBtn = (page) => page.evaluate(() => {
  const b = document.querySelector('[data-act="pickApprove"]');
  const a = document.querySelector('[data-act="pickAll"]');
  return b ? { text: b.textContent, disabled: b.disabled, all: a && a.textContent } : null;
});

async function openConsole(env, at, width) {
  const page = await env.open({ mode: 'admin', width: width || 1100, at });
  await adminLogin(page);
  return page;
}

withBrowser(async (env) => {
  section('🔴 기본 회차 — 오늘이 캠프 날이면 그 회차부터 (D-083)');
  let page = await openConsole(env);
  ok('🔴 10/31 에 열면 검수 탭 회차가 10/31(토)', await activeSession(page) === '10/31(토)', await activeSession(page));
  await page.context().close();

  page = await openConsole(env, '2026-11-07T10:00:00+09:00');
  ok('🔴 11/07 에 열면 11/07(토)', await activeSession(page) === '11/07(토)', await activeSession(page));
  ok('🔴 11/07 검수 — 10/31 대기 글이 안 보인다', (await cards(page)).length === 0 &&
    await page.evaluate(() => !!document.querySelector('#view .empty')), await cards(page));
  ok('   안내 문구 앞에 회차 · 대기 0건', await page.evaluate(() =>
    document.querySelector('.section-head .hint').textContent.startsWith('11/07(토) · 검수 대기 0건')));
  await page.click('#sessionFilter [data-session="전체"]');
  await page.waitForSelector('#view .jcard');
  ok('   전체를 누르면 대기 3건이 보인다', (await cards(page)).length === 3, await cards(page));
  await page.click('#tabbar [data-view="progress"]');
  await page.waitForSelector('#sessionFilter');
  ok('   전체를 고른 뒤 다른 탭으로 가도 전체 그대로', await activeSession(page) === '전체', await activeSession(page));
  await page.context().close();

  page = await openConsole(env, '2026-11-07T10:00:00+09:00');
  await page.click('#tabbar [data-view="progress"]');
  await page.waitForSelector('#sessionFilter');
  ok('🔴 11/07 진행 탭도 11/07 만', await activeSession(page) === '11/07(토)' &&
    await page.evaluate(() => [...document.querySelectorAll('[data-edit-session]')].every(e => e.getAttribute('data-edit-session') === '11/07(토)')),
    await activeSession(page));
  await page.context().close();

  page = await openConsole(env, '2026-11-03T10:00:00+09:00');
  ok('🔴 캠프 날이 아니면(11/03) 예전처럼 전체', await activeSession(page) === '전체', await activeSession(page));
  await page.context().close();

  section('🔴 체크해서 골라 승인 (D-083)');
  page = await openConsole(env);
  let c = await cards(page);
  ok('대기 3건 · 모두 체크박스가 있다', c.length === 3 && c.every(x => x.status === '대기' && x.pick), c);
  ok('처음엔 "선택한 0건 승인" 이 잠겨 있다', JSON.stringify(await pickBtn(page)) ===
    JSON.stringify({ text: '선택한 0건 승인', disabled: true, all: '모두 선택' }), await pickBtn(page));

  await page.click('#view .jcard[data-id="J0004"] [data-pick]');
  await page.click('#view .jcard[data-id="J0007"] .jcard__pick');   // 글자(label)를 눌러도 된다
  ok('🔴 두 건 고르면 "선택한 2건 승인" 이 풀린다', JSON.stringify(await pickBtn(page)) ===
    JSON.stringify({ text: '선택한 2건 승인', disabled: false, all: '모두 선택' }), await pickBtn(page));
  ok('   고른 카드는 테두리', await page.evaluate(() =>
    getComputedStyle(document.querySelector('.jcard[data-id="J0004"]')).outlineStyle === 'solid' &&
    getComputedStyle(document.querySelector('.jcard[data-id="J0006"]')).outlineStyle === 'none'));

  await page.click('[data-act="pickApprove"]');
  await waitToast(page, '건 승인했습니다');   // 몇 건인지는 아래에서 본다 — 틀려도 시간 초과가 아니라 ✗ 로
  const sent = await bodies(page, 'admin.journal.reviewBatch');
  ok('🔴 reviewBatch 하나 · 고른 두 건만 · 승인', sent.length === 1 &&
    JSON.stringify(sent[0].ids.slice().sort()) === JSON.stringify(['J0004', 'J0007']) && sent[0].decision === '승인', sent);
  // 다시 불러와 그린 뒤 — '불러오는 중…' 동안은 카드가 0장이라 그것을 기다리면 안 된다
  await page.waitForFunction(() => !document.querySelector('#view .loading') && document.querySelector('#view .section-head') &&
    document.querySelectorAll('#view .jcard').length < 3);
  c = await cards(page);
  ok('🔴 고르지 않은 J0006 만 대기로 남는다', c.length === 1 && c[0].id === 'J0006', c);
  ok('   알림도 2건', await page.evaluate(() => document.querySelector('#toast').textContent.includes('2건 승인했습니다')));

  await page.click('#statusFilter [data-jstatus="전체"]');
  await page.waitForSelector('#view .jcard[data-status="승인"]');
  c = await cards(page);
  ok('승인·반려 글에는 체크박스가 없다', c.filter(x => x.status !== '대기').every(x => !x.pick) &&
    c.filter(x => x.status === '대기').every(x => x.pick) && c.some(x => x.status === '승인'), c);
  await page.context().close();

  section('모두 선택 · 선택 해제');
  page = await openConsole(env);
  await page.click('[data-act="pickAll"]');
  ok('모두 선택 → 3건 · 단추는 "선택 해제"', JSON.stringify(await pickBtn(page)) ===
    JSON.stringify({ text: '선택한 3건 승인', disabled: false, all: '선택 해제' }), await pickBtn(page));
  await page.click('[data-act="pickAll"]');
  ok('한 번 더 → 0건 · 잠김', JSON.stringify(await pickBtn(page)) ===
    JSON.stringify({ text: '선택한 0건 승인', disabled: true, all: '모두 선택' }), await pickBtn(page));
  await page.click('[data-act="pickAll"]');
  await page.click('#view .jcard[data-id="J0006"] [data-pick]');
  ok('하나 풀면 2건 · 다시 "모두 선택"', JSON.stringify(await pickBtn(page)) ===
    JSON.stringify({ text: '선택한 2건 승인', disabled: false, all: '모두 선택' }), await pickBtn(page));
  await page.click('#statusFilter [data-jstatus="대기"]');
  ok('🔴 필터를 다시 누르면 체크가 풀린다 — 안 보이던 글이 승인되지 않게', JSON.stringify(await pickBtn(page)) ===
    JSON.stringify({ text: '선택한 0건 승인', disabled: true, all: '모두 선택' }), await pickBtn(page));
  ok('기존 "보이는 대기 3건 모두 승인" 은 그대로', await page.evaluate(() =>
    (document.querySelector('[data-act="bulk"]') || {}).textContent === '보이는 대기 3건 모두 승인'));
  await page.context().close();

  section('390px — 넘치지 않고 13px 미만 없음');
  page = await openConsole(env, undefined, 390);
  await page.click('#view .jcard[data-id="J0004"] [data-pick]');
  ok('가로 넘침 없음', await noHScroll(page));
  const small = await smallText(page);
  ok('13px 미만 글자 없음', small.length === 0, small);
  ok('체크 칸이 눌리기 쉬운 크기(36px 이상)', await page.evaluate(() =>
    document.querySelector('.jcard__pick').getBoundingClientRect().height >= 36));
  await page.context().close();

  section('런타임 오류');
  ok('JS 오류 없음', env.errors.length === 0, env.errors);
}).then(done, e => { console.error(e); process.exit(1); });
