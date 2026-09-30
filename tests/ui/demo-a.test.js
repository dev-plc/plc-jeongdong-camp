/**
 * A 단계 (D-050, v15.1) — 홈 "지금·다음", 코스 다음 동작 버튼·접기, 운영 콘솔 조별 카드, 글자 하한.
 * 원본은 소실된 scratchpad 의 test-a.js — 세션 기록에서 되살려 옮겼다.
 */
const { ok, section, done } = require('../lib/check');
const { withBrowser, text, smallText, waitToast } = require('../lib/browser');

withBrowser(async (env) => {
  const open = (at, width) => env.open({ at, width, persona: 'leader' });
  async function login(page) {
    await page.fill('input[name="name"]', '김캠티');
    await page.fill('input[name="last4"]', '5678');
    await page.click('#loginForm button[type="submit"]');
    await page.waitForSelector('.card--team');
  }
  const openAdmin = (at, width) => env.open({ at, width, mode: 'admin' });
  async function admin(page) {
    await page.waitForSelector('#pinForm');
    await page.fill('input[name="pin"]', '000000');
    await page.click('#pinForm button');
    await page.waitForSelector('.jcard, .empty');
    await page.click('[data-view="progress"]');
    await page.waitForSelector('.team-card');
  }

  // ------------------------------------------------------------ 홈 "지금 · 다음"
  section('홈 — 지금 · 다음 (폰 시계 기준)');
  let page = await open('2026-10-31T15:25:00+09:00');
  await login(page);
  await page.waitForSelector('#nowCard');
  const now = await text(page, '#nowCard');
  ok('15:25 → 지금 정동 답사', now.includes('지금') && now.includes('정동 답사'), now);
  ok('다음 항목 16:25 마무리', now.includes('다음 · 16:25 마무리'), now);
  ok('일정 목록에서 지금 줄 강조',
    ((await text(page, '.timeline__row.is-now')) || '').includes('정동 답사'), await text(page, '.timeline__row.is-now'));
  ok('강조된 줄은 하나', (await page.locator('.timeline__row.is-now').count()) === 1);
  await page.waitForFunction(() => { const el = document.querySelector('#nowCourse'); return el && !el.hidden; });
  const course = await text(page, '#nowCourse');
  ok('당일에는 코스 진행·다음 지점', course.includes('코스 1/4') && course.includes('이화여고 박물관'), course);
  await page.click('#goCourse');
  await page.waitForSelector('.cp');
  ok('"코스 보기" 로 코스 화면', await page.isVisible('.course-summary'));

  // 글자 하한 — 홈·코스를 본 김에
  ok('코스 화면 13px 미만 글자 없음', (await smallText(page)).length === 0, await smallText(page));
  await page.click('[data-view="home"]');
  await page.waitForSelector('#nowCard');
  ok('홈 13px 미만 글자 없음', (await smallText(page)).length === 0, await smallText(page));
  await page.context().close();

  const cases = [
    ['2026-10-31T09:00:00+09:00', '09:00 → 곧 시작 · 첫 일정', s => s.includes('곧 시작') && s.includes('도착 · 등록') && s.includes('09:30')],
    ['2026-10-31T16:15:00+09:00', '🔴 16:15 일정 사이 → 곧 시작 · 마무리', s => s.includes('곧 시작') && s.includes('마무리 모임') && s.includes('16:25')],
    ['2026-10-31T17:30:00+09:00', '17:30 → 끝났습니다', s => s.includes('끝났습니다') && !s.includes('지금')]
  ];
  for (const [at, name, test] of cases) {
    page = await open(at);
    await login(page);
    await page.waitForSelector('#nowCard');
    const s = await text(page, '#nowCard');
    ok(name, test(s), s);
    ok('  └ 지금 줄 강조 없음', (await page.locator('.timeline__row.is-now').count()) === 0);
    await page.context().close();
  }

  page = await open('2026-10-27T10:00:00+09:00');
  await login(page);
  await page.waitForSelector('.now-card');
  ok('당일 전이면 D-day', ((await text(page, '.now-card')) || '').includes('D-4'), await text(page, '.now-card'));
  ok('당일 전에는 코스를 부르지 않는다',
    !(await page.evaluate(() => window.__DEMO_CALLS.slice())).includes('progress.list'),
    await page.evaluate(() => window.__DEMO_CALLS.slice()));
  await page.context().close();

  page = await open('2026-11-02T10:00:00+09:00');
  await login(page);
  await page.waitForTimeout(300);
  ok('지난 회차면 카드 없음', (await page.locator('.now-card').count()) === 0);
  await page.context().close();

  // ------------------------------------------------------------ 코스
  section('코스 — 다음 동작 버튼 · 접기');
  page = await open('2026-10-31T15:25:00+09:00');
  await login(page);
  await page.click('[data-view="course"]');
  await page.waitForSelector('.cp');
  const cards = () => page.evaluate(() => [...document.querySelectorAll('.cp')].map(el => ({
    tag: el.tagName, open: el.tagName === 'DETAILS' ? el.open : true,
    status: el.getAttribute('data-status'), next: el.classList.contains('cp--next'),
    buttons: [...el.querySelectorAll('.cp__actions button')].map(b => b.textContent)
  })));
  let c = await cards();
  ok('다음 지점(2번, 도착)이 강조', c[1].next && c.filter(x => x.next).length === 1, c);
  ok('🔴 다음 지점만 펼치고 나머지는 접는다',
    c[1].tag === 'ARTICLE' && [0, 2, 3].every(i => c[i].tag === 'DETAILS' && !c[i].open), c);
  ok('도착 → "완료했어요" + "도착 취소"',
    JSON.stringify(c[1].buttons) === JSON.stringify(['완료했어요', '도착 취소']), c[1].buttons);
  ok('대기 → "도착했어요" 하나', JSON.stringify(c[2].buttons) === JSON.stringify(['도착했어요']), c[2].buttons);
  ok('완료 → "완료 취소" 하나', JSON.stringify(c[0].buttons) === JSON.stringify(['완료 취소']), c[0].buttons);
  ok('🔴 "대기" 로 가는 큰 버튼이 없다',
    (await page.locator('.cp__next[data-status="대기"]').count()) === 0);
  ok('완료한 지점은 접힌 줄에 시각', ((await page.locator('.cp').nth(0).locator('summary').textContent()) || '').includes('완료 14:24'));
  const sum = await text(page, '.course-summary');
  ok('위에 진행 요약', sum.includes('진행 1/4') && sum.includes('이화여고 박물관'), sum);
  ok('요약이 다음 카드로 이어진다', (await page.getAttribute('.course-summary', 'href')) === '#cp-CP4');

  // 🔴 되돌리기는 확인창 — "취소" 면 아무것도 안 바뀐다
  await page.evaluate(() => { window.__DEMO_CALLS.length = 0; });
  await page.locator('.cp').nth(0).evaluate(el => { el.open = true; });
  await page.locator('.cp').nth(0).locator('.cp__undo').click();
  await page.waitForSelector('.modal');
  ok('취소 버튼은 확인창을 띄운다', ((await text(page, '.modal')) || '').includes('완료를 취소할까요'));
  await page.click('.modal [data-act="cancel"]');
  await page.waitForTimeout(400);
  ok('🔴 확인창에서 취소하면 그대로', (await cards())[0].status === '완료');
  ok('🔴 요청도 안 나간다', !(await page.evaluate(() => window.__DEMO_CALLS.slice())).includes('progress.set'),
    await page.evaluate(() => window.__DEMO_CALLS.slice()));

  // 다음 동작 → 다음 지점이 넘어간다
  await page.click('.cp--next .cp__next');
  await page.waitForFunction(() => document.querySelector('.cp--next') &&
    document.querySelector('.cp--next').getAttribute('data-code') === 'CP1');
  await waitToast(page, '기록했습니다');     // 먼저 그린 화면(낙관)을 서버 응답이 다시 그린다 — 그 뒤에 본다
  c = await cards();
  ok('"완료했어요" 누르면 다음 지점이 3번으로', c[2].next && c[1].status === '완료', c);
  ok('요약도 2/4', ((await text(page, '.course-summary')) || '').includes('진행 2/4'));
  ok('완료한 2번은 접힌다', c[1].tag === 'DETAILS', c[1]);

  // 확인창에서 "완료 취소" 를 누르면 돌아간다
  await page.locator('.cp').nth(1).evaluate(el => { el.open = true; });
  await page.locator('.cp').nth(1).locator('.cp__undo').click();
  await page.click('.modal [data-act="ok"]');
  await page.waitForFunction(() => document.querySelectorAll('.cp')[1].getAttribute('data-status') === '도착');
  ok('확인하면 되돌린다 (완료 → 도착)', true);
  await page.context().close();

  // ------------------------------------------------------------ 운영 콘솔
  section('운영 콘솔 — 조별 카드');
  page = await openAdmin('2026-10-31T15:25:00+09:00');
  await admin(page);
  const teams = await page.evaluate(() => [...document.querySelectorAll('.team-card')].map(el => ({
    team: el.getAttribute('data-team'), stale: el.classList.contains('is-stale'),
    last: (el.querySelector('.team-card__last') || {}).textContent || '',
    steps: el.querySelectorAll('.step').length
  })));
  ok('조마다 카드 (10/31 넷 + 11/07 하나)', teams.length === 5, teams.map(t => t.team));
  const t1 = teams.find(t => t.team === '10/31(토) 1조');
  const t2 = teams.find(t => t.team === '10/31(토) 2조');
  const t3 = teams.find(t => t.team === '11/07(토) 1조');
  ok('🔴 14:36 이 마지막이면 15:25 에 49분 전 · ⚠', t1.stale && t1.last.includes('49분 전') && t1.last.includes('⚠'), t1);
  ok('15:12 가 마지막이면 13분 전 · 경고 없음', !t2.stale && t2.last.includes('13분 전'), t2);
  ok('기록이 없으면 "아직 기록 없음" · 경고 없음', !t3.stale && t3.last.includes('아직 기록 없음'), t3);
  ok('카드마다 지점 네 칸', teams.every(t => t.steps === 4), teams.map(t => t.steps));
  ok('맨 위 경고 줄', ((await text(page, '.team-alert')) || '').includes('1개 조가 40분'), await text(page, '.team-alert'));

  // 🔴 폰에서 네 칸이 화면 안에 — 옛 표는 진행 칸이 오른쪽으로 잘렸다
  const outside = await page.evaluate(() => [...document.querySelectorAll('.team-card .step')]
    .filter(el => { const r = el.getBoundingClientRect(); return r.right > window.innerWidth || r.left < 0; }).length);
  ok('🔴 390px 에서 모든 칸이 화면 안', outside === 0, outside);
  ok('가로 스크롤 없음', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  ok('콘솔 13px 미만 글자 없음', (await smallText(page)).length === 0, await smallText(page));
  ok('표는 "표로 보기" 에 접혀 있다',
    await page.evaluate(() => !!document.querySelector('details.board-table .admin-table') &&
      !document.querySelector('details.board-table').open));
  await page.context().close();

  page = await openAdmin('2026-10-31T14:50:00+09:00');
  await admin(page);
  ok('14:50 에는 경고 없음 (14분)', (await page.locator('.team-card.is-stale').count()) === 0);
  ok('경고 줄도 없음', (await page.locator('.team-alert').count()) === 0);
  await page.context().close();

  page = await openAdmin('2026-10-31T15:25:00+09:00', 1200);
  await admin(page);
  const cols = await page.evaluate(() => getComputedStyle(document.querySelector('.team-grid')).gridTemplateColumns.split(' ').length);
  ok('넓은 화면은 여러 줄 (3열)', cols === 3, cols);
  await page.context().close();

  section('콘솔 — 점수 입력·시상 퀴즈 없음 (D-056)');
  page = await openAdmin('2026-10-31T15:25:00+09:00');
  await admin(page);
  await page.locator('.step__btn').first().click();
  await page.waitForSelector('#cellForm');
  ok('정정 창은 상태만 (대기·도착·완료)', (await page.locator('#cellForm input[name="status"]').count()) === 3);
  ok('🔴 정정 창에 점수 칸이 없다', (await page.locator('#cellForm input[name="score"], #cellForm input[type="number"]').count()) === 0 &&
    !/점수/.test((await text(page, '#cellForm')) || ''), await text(page, '#cellForm'));
  await page.click('#cellForm [data-act="cancel"]');
  ok('🔴 진행 카드에 "N점" 표시가 없다', !/\d+점/.test((await text(page, '.team-grid')) || ''));
  await page.click('[data-view="awards"]');
  await page.waitForSelector('.award');
  const heads = await page.evaluate(() => [...document.querySelectorAll('.award .card__title')].map(h => h.textContent));
  ok('시상은 소요 시간 · 사진 두 부문', heads.length === 2 && /소요 시간/.test(heads[0]) && /사진/.test(heads[1]), heads);
  ok('🔴 시상에 퀴즈 부문·점수 글자가 없다', !/퀴즈|점수/.test((await text(page, '#view')) || ''));
  ok('소요 시간 순위는 그대로', (await page.locator('.award .rank__row').count()) > 0);
  await page.context().close();

  section('런타임 오류');
  ok('JS 오류 없음', env.errors.length === 0, env.errors);
}).then(done, e => { console.error(e); process.exit(1); });
