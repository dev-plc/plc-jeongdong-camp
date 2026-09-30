/**
 * B 단계 화면 (D-051·052) — 스태프(내 지점) · 교역자(진행, 읽기 전용) · 조장 코스.
 * 🔴 미션 점수 입력·표시는 D-056 에서 뺐다 — 어디에도 점수 칸·점수 글자가 없어야 한다.
 * 원본은 소실된 scratchpad 의 test-b-ui.js — 세션 기록에서 되살려 옮겼다. 시계는 10/31 15:25 KST.
 */
const { ok, section, done } = require('../lib/check');
const { withBrowser, login, text, bodies, noHScroll, waitToast, smallText } = require('../lib/browser');

withBrowser(async (env) => {
  const open = (persona) => env.open({ persona });

  // ------------------------------------------------------------ 스태프
  section('거점 스태프 — 내 지점');
  let page = await open('staff');
  await login(page);
  const home = await text(page, '.card--role');
  ok('홈에 역할 카드 (조 카드 대신)', home && home.includes('스태프') && home.includes('배재학당역사박물관'), home);
  ok('조 카드는 없다', (await page.locator('.card--team:not(.card--role)').count()) === 0);
  ok('탭 이름이 "내 지점"', ((await text(page, '#tabbar [data-view="course"]')) || '').includes('내 지점'));

  await page.click('#tabbar [data-view="course"]');
  await page.waitForSelector('.st-row');
  const rows = () => page.evaluate(() => [...document.querySelectorAll('.st-row')].map(el => ({
    group: el.getAttribute('data-group'),
    status: el.querySelector('.chip').textContent,
    meta: el.querySelector('.team-card__meta').textContent,
    buttons: [...el.querySelectorAll('.st-row__actions button')].map(b => b.textContent),
    scoreBox: !!el.querySelector('input, .cp__score')
  })));
  let r = await rows();
  ok('이 지점을 지나는 10/31 조 네 개', r.length === 4, r.map(x => x.group));
  ok('🔴 이 지점에 오는 순서대로 (첫 지점 조가 먼저)', r.map(x => x.group).join() === '2조,4조,1조,3조', r.map(x => x.group));
  const g3 = r.find(x => x.group === '3조');
  ok('직전 지점을 끝낸 조는 "오는 중"', g3.meta.includes('오는 중'), g3.meta);
  ok('대기 → "도착 확인" 하나', JSON.stringify(g3.buttons) === '["도착 확인"]', g3.buttons);
  const g2 = r.find(x => x.group === '2조');
  ok('완료 → "완료 취소" 만', JSON.stringify(g2.buttons) === '["완료 취소"]', g2);
  ok('🔴 어느 행에도 점수 칸이 없다 (D-056)', r.every(x => !x.scoreBox), r.map(x => x.group + ':' + x.scoreBox));
  ok('🔴 안내 문구에 점수 얘기가 없다', !/점수/.test((await text(page, '#view')) || ''), await text(page, '.section-head'));
  ok('제목에 지점 이름', ((await text(page, '.section-head h2')) || '').includes('배재학당역사박물관'));

  await page.click('.st-row[data-group="3조"] [data-st="set"]');
  await waitToast(page, '3조 도착');
  r = await rows();
  ok('도착 확인 → 3조 도착', r.find(x => x.group === '3조').status === '도착', r.find(x => x.group === '3조'));
  const sent = await bodies(page, 'station.set');
  ok('station.set 에 조와 상태만 (지점은 서버가 정한다)', sent.length === 1 &&
    JSON.stringify(sent[0].items) === JSON.stringify([{ group: '3조', status: '도착' }]), sent.map(b => b.items));

  // 취소는 확인창 — 취소하면 그대로
  await page.click('.st-row[data-group="2조"] [data-st="set"]');
  await page.waitForSelector('.modal');
  await page.click('.modal [data-act="cancel"]');
  await page.waitForTimeout(300);
  ok('🔴 완료 취소 → 확인창에서 취소하면 요청 없음', (await bodies(page, 'station.set')).length === 1 &&
    (await rows()).find(x => x.group === '2조').status === '완료');
  ok('390px 가로 넘침 없음 (내 지점)', await noHScroll(page));
  ok('13px 미만 글자 없음 (내 지점)', (await smallText(page)).length === 0, await smallText(page));

  await page.click('[data-st="all"]');
  await page.waitForSelector('.team-card');
  ok('"전체 진행" → 조별 카드', (await page.locator('.team-card').count()) === 4);
  ok('🔴 읽기 전용 — 칸 버튼 없음', (await page.locator('.step__btn').count()) === 0);
  await page.click('[data-board="back"]');
  await page.waitForSelector('.st-row');
  ok('"내 지점으로" 돌아온다', true);
  await page.context().close();

  // ------------------------------------------------------------ 교역자
  section('교역자 — 진행 (읽기 전용)');
  page = await open('pastor');
  await login(page);
  ok('홈 역할 카드', ((await text(page, '.card--role')) || '').includes('교역자'));
  ok('탭 이름이 "진행"', ((await text(page, '#tabbar [data-view="course"]')) || '').includes('진행'));
  await page.click('#tabbar [data-view="course"]');
  await page.waitForSelector('.team-card');
  ok('내 회차 조 카드 네 개', (await page.locator('.team-card').count()) === 4);
  ok('🔴 읽기 전용 — 칸 버튼 없음', (await page.locator('.step__btn').count()) === 0);
  ok('⚠ 경고 줄', ((await text(page, '.team-alert')) || '').includes('1개 조'), await text(page, '.team-alert'));
  ok('🔴 칸에 점수 표시가 없다 (데이터에 점수가 있어도)', !/\d+점/.test((await text(page, '.team-grid')) || '') &&
    (await page.locator('.step__score').count()) === 0, await text(page, '.team-card[data-team="10/31(토) 2조"]'));
  ok('운영 콘솔(PIN) 링크', (await page.getAttribute('a[href="admin.html"]', 'href')) === 'admin.html');
  ok('390px 가로 넘침 없음 (진행)', await noHScroll(page));
  ok('13px 미만 글자 없음 (진행)', (await smallText(page)).length === 0, await smallText(page));
  await page.click('#tabbar [data-view="journal"]');
  await page.waitForSelector('#scopeTabs');
  ok('일지에 "우리 조" 탭 없음', !((await text(page, '#scopeTabs')) || '').includes('우리 조'));
  await page.click('#tabbar [data-view="me"]');
  await page.waitForSelector('#logoutBtn');
  ok('내 정보 — 운영진 (조 없음)', ((await text(page, '#view')) || '').includes('운영진 (조 없음)'));
  await page.context().close();

  // ------------------------------------------------------------ 조장 코스
  section('조장 — 도착·완료만 (점수 칸 없음, D-056)');
  page = await open('leader');
  await login(page);
  await page.click('#tabbar [data-view="course"]');
  await page.waitForSelector('.cp');
  ok('🔴 점수 칸·저장 버튼이 없다', (await page.locator('.input--score, [data-score-save], .cp__score').count()) === 0);
  ok('🔴 코스 화면 어디에도 "N점" 이 없다 (스태프가 넣은 점수가 데이터에 있어도)', !/\d+점/.test((await text(page, '#view')) || ''));
  await page.click('.cp--next .cp__next');
  await waitToast(page, '기록했습니다');
  const ps = (await bodies(page, 'progress.set')).pop();
  ok('🔴 보낸 것은 지점과 상태뿐', ps && JSON.stringify(ps.items) === JSON.stringify([{ checkpoint: 'CP4', status: '완료' }]), ps && ps.items);
  ok('13px 미만 글자 없음 (코스)', (await smallText(page)).length === 0, await smallText(page));
  await page.context().close();

  // ------------------------------------------------------------ 탐험일지 탭 (D-057)
  section('탐험일지 — 기본은 우리 조, 탭으로 전체 · 내 일지 없음');
  const journalView = async (persona) => {
    const pg = await open(persona);
    await login(pg);
    await pg.click('#tabbar [data-view="journal"]');
    await pg.waitForSelector('#journalList .jcard, #journalList .empty');
    return pg;
  };
  const tabs = (pg) => pg.evaluate(() => [...document.querySelectorAll('#scopeTabs .tab')].map(t => t.textContent + (t.classList.contains('is-active') ? '*' : '')));
  const ids = (pg) => pg.evaluate(() => [...document.querySelectorAll('#journalList .jcard')].map(c => c.getAttribute('data-id')));

  page = await journalView('member');
  ok('🔴 탭은 우리 조 · 전체 — 기본은 우리 조', JSON.stringify(await tabs(page)) === JSON.stringify(['우리 조*', '전체']), await tabs(page));
  ok('🔴 "내 일지" 탭이 없다', !((await text(page, '#scopeTabs')) || '').includes('내 일지'));
  ok('처음 부르는 목록이 우리 조', (await bodies(page, 'journal.list'))[0].scope === 'team');
  let seen = await ids(page);
  ok('조원은 우리 조의 승인된 글만 (조원의 확인 전 글 제외)', seen.join() === 'J0001,J0002' || seen.sort().join() === 'J0001,J0002', seen);
  ok('다른 조 글은 없다', !seen.includes('J0003'));
  await page.click('#scopeTabs [data-scope="gallery"]');
  await page.waitForFunction(() => document.querySelector('#scopeTabs .tab.is-active').textContent === '전체');
  await page.waitForSelector('#journalList .jcard');
  seen = await ids(page);
  ok('전체 탭 → 같은 회차의 다른 조 글도', seen.includes('J0003') && (await bodies(page, 'journal.list')).pop().scope === 'gallery', seen);
  await page.context().close();

  page = await journalView('leader');
  ok('조장도 기본은 우리 조', JSON.stringify(await tabs(page)) === JSON.stringify(['우리 조*', '전체']), await tabs(page));
  seen = await ids(page);
  ok('조장은 우리 조의 확인 전 글까지 본다', seen.includes('J0007'), seen);
  ok('안내: 조장은 확인 전 글도', ((await text(page, '#scopeHint')) || '').includes('확인 전'));
  await page.context().close();

  page = await journalView('pastor');
  ok('조 없는 교역자는 전체 탭 하나', JSON.stringify(await tabs(page)) === JSON.stringify(['전체*']), await tabs(page));
  await page.context().close();

  section('런타임 오류');
  ok('JS 오류 없음', env.errors.length === 0, env.errors);
}).then(done, e => { console.error(e); process.exit(1); });
