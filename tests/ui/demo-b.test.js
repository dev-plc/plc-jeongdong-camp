/**
 * B 단계 화면 (D-051·052) — 스태프(내 지점) · 교역자(진행, 읽기 전용) · 조장 점수 칸.
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
    score: (el.querySelector('.input--score') || {}).value
  })));
  let r = await rows();
  ok('이 지점을 지나는 10/31 조 네 개', r.length === 4, r.map(x => x.group));
  ok('🔴 이 지점에 오는 순서대로 (첫 지점 조가 먼저)', r.map(x => x.group).join() === '2조,4조,1조,3조', r.map(x => x.group));
  const g3 = r.find(x => x.group === '3조');
  ok('직전 지점을 끝낸 조는 "오는 중"', g3.meta.includes('오는 중'), g3.meta);
  ok('대기 → "도착 확인" 하나', JSON.stringify(g3.buttons) === '["도착 확인"]', g3.buttons);
  const g2 = r.find(x => x.group === '2조');
  ok('완료 → "완료 취소" 만 + 점수 10', JSON.stringify(g2.buttons) === '["완료 취소"]' && g2.score === '10', g2);
  ok('제목에 지점 이름', ((await text(page, '.section-head h2')) || '').includes('배재학당역사박물관'));

  await page.click('.st-row[data-group="3조"] [data-st="set"]');
  await waitToast(page, '3조 도착');
  r = await rows();
  ok('도착 확인 → 3조 도착', r.find(x => x.group === '3조').status === '도착', r.find(x => x.group === '3조'));
  const sent = await bodies(page, 'station.set');
  ok('station.set 에 조와 상태만 (지점은 서버가 정한다)', sent.length === 1 &&
    JSON.stringify(sent[0].items) === JSON.stringify([{ group: '3조', status: '도착' }]), sent.map(b => b.items));

  await page.fill('.st-row[data-group="3조"] .input--score', '9');
  await page.click('.st-row[data-group="3조"] [data-st="score"]');
  await waitToast(page, '점수 저장');
  r = await rows();
  ok('점수 저장 → 9', r.find(x => x.group === '3조').score === '9');
  ok('점수만 보냈다 (상태 없음)', JSON.stringify((await bodies(page, 'station.set')).pop().items) === JSON.stringify([{ group: '3조', score: 9 }]));

  await page.fill('.st-row[data-group="3조"] .input--score', '150');
  await page.click('.st-row[data-group="3조"] [data-st="score"]');
  await waitToast(page, '0~100');
  ok('범위 밖 점수는 보내지 않는다', (await bodies(page, 'station.set')).length === 2);

  // 취소는 확인창 — 취소하면 그대로
  await page.click('.st-row[data-group="2조"] [data-st="set"]');
  await page.waitForSelector('.modal');
  await page.click('.modal [data-act="cancel"]');
  await page.waitForTimeout(300);
  ok('🔴 완료 취소 → 확인창에서 취소하면 요청 없음', (await bodies(page, 'station.set')).length === 2 &&
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
  ok('칸에 점수와 스태프 확인 표시', ((await text(page, '.team-card[data-team="10/31(토) 2조"]')) || '').includes('10점 ✓'));
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

  // ------------------------------------------------------------ 조장 점수
  section('조장 — 퀴즈 점수 (스태프 우선)');
  page = await open('leader');
  await login(page);
  await page.click('#tabbar [data-view="course"]');
  await page.waitForSelector('.cp');
  ok('🔴 스태프가 넣은 점수는 잠겨 있다 (1번 지점 9점)',
    ((await text(page, '.cp[data-code="CP3"] .cp__score')) || '').includes('스태프 확인') &&
    (await page.locator('.cp[data-code="CP3"] .input--score').count()) === 0);
  ok('도착한 지점에 점수 칸', await page.isVisible('.cp[data-code="CP4"] .input--score'));
  ok('아직 안 간 지점엔 점수 칸 없음', (await page.locator('.cp[data-code="CP1"] .input--score').count()) === 0);
  await page.fill('.cp[data-code="CP4"] .input--score', '7');
  await page.click('.cp[data-code="CP4"] [data-score-save]');
  await waitToast(page, '점수를 저장했습니다');
  const ps = (await bodies(page, 'progress.set')).pop();
  ok('상태(그대로)와 점수를 함께 보낸다', ps && JSON.stringify(ps.items) === JSON.stringify([{ checkpoint: 'CP4', status: '도착', score: 7 }]),
    ps && ps.items);
  ok('칸에 7', (await page.inputValue('.cp[data-code="CP4"] .input--score')) === '7');
  await page.click('.cp--next .cp__next');
  await waitToast(page, '기록했습니다');
  ok('완료해도 점수는 남는다', ((await text(page, '.cp[data-code="CP4"]')) || '').includes('완료') &&
    (await page.inputValue('.cp[data-code="CP4"] .input--score').catch(() => '')) === '7');
  ok('13px 미만 글자 없음 (코스)', (await smallText(page)).length === 0, await smallText(page));
  await page.context().close();

  section('런타임 오류');
  ok('JS 오류 없음', env.errors.length === 0, env.errors);
}).then(done, e => { console.error(e); process.exit(1); });
