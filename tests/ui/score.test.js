/**
 * 지점 점수(0~100) — 스위치 SCORE_INPUT · 역할 '캠티' (D-090, GAS v26 · 앱 v26). 기획 확정 전이라 기본은 끔.
 *   OFF: 어디에도 점수 칸·표시가 없다(D-056 과 같다).  STAFF: 거점 스태프 "내 지점".  CAMTI: 캠티 코스.  BOTH: 둘 다, 스태프 우선.
 *   콘솔: 운영 설정에서 스위치 · 정정 창 점수 · 카드·표 "N점" · 🏆 ⭐ 점수 합계 · 진행자 "캠티/조장".
 * 데모(10/31 15:25) 점수: 1조 CP3 90(스태프) · 2조 CP1 100(스태프)·CP2 80(캠티) · 3조 70·90·80 · 4조 90·100·80(관리자)·90.
 *   2조는 캠티 윤지한(데모 '캠티' 계정)이 이끈다. 스태프 계정은 CP1 거점.
 */
const { ok, section, done } = require('../lib/check');
const { withBrowser, login, adminLogin, bodies, waitToast, smallText, noHScroll } = require('../lib/browser');

const withScore = (mode) => (m) => { try { sessionStorage.setItem('demo_config', JSON.stringify({ SCORE_INPUT: m })); } catch (e) { /* 없음 */ } };
async function openAs(env, persona, mode, extra) {
  const page = await env.open(Object.assign({ persona, init: mode ? withScore() : undefined, initArg: mode }, extra || {}));
  await login(page);
  await page.click('#tabbar [data-view="course"]');
  await page.waitForSelector(persona === 'staff' ? '.st-row' : '.cp');
  return page;
}
const toastText = (page) => page.evaluate(() => document.querySelector('#toast').textContent);
const forms = (page) => page.evaluate(() => [...document.querySelectorAll('.score-form')].map(f => ({
  key: f.getAttribute('data-score-group') || f.getAttribute('data-score-cp'),
  value: f.querySelector('input').value, locked: f.querySelector('input').disabled,
  note: (f.querySelector('.score-form__note') || {}).textContent || ''
})));
const pageText = (page) => page.evaluate(() => document.querySelector('#view').textContent);
const fill = async (page, sel, v) => { await page.fill(sel + ' input', String(v)); };

withBrowser(async (env) => {
  // ------------------------------------------------------------ OFF
  section('🔴 OFF (기본) — 어디에도 점수가 없다');
  let page = await openAs(env, 'staff');
  ok('🔴 스태프 내 지점에 점수 칸 없음 · ⭐ 없음', (await forms(page)).length === 0 && !/⭐/.test(await pageText(page)));
  await page.context().close();
  page = await openAs(env, 'camti');
  ok('🔴 캠티 코스에도 점수 칸·표시 없음 (데이터엔 점수가 있다)', (await forms(page)).length === 0 && !/⭐|\d+점/.test(await pageText(page)));
  ok('캠티도 진행자 — 도착·완료 단추가 있다', await page.locator('.cp__next').count() > 0);
  await page.context().close();

  // ------------------------------------------------------------ STAFF
  section('🔴 STAFF — 거점 스태프가 넣는다');
  page = await openAs(env, 'staff', 'STAFF');
  let f = await forms(page);
  ok('🔴 도착·완료한 조(2조·4조)에만 칸 · 대기 조(1조·3조)엔 없다', JSON.stringify(f.map(x => x.key).sort()) === JSON.stringify(['2조', '4조']), f);
  ok('   지금 점수가 칸에 (2조 100 · 4조 90)', f.find(x => x.key === '2조').value === '100' && f.find(x => x.key === '4조').value === '90', f);
  ok('   안내에 점수', (await page.textContent('.section-head .hint')).includes('점수(0~100)'));
  ok('   진행자 표시 — 2조 "캠티 윤지한", 4조 "조장 서하준"', await page.evaluate(() =>
    document.querySelector('.st-row[data-group="2조"] .team-card__meta').textContent.startsWith('캠티 윤지한') &&
    document.querySelector('.st-row[data-group="4조"] .team-card__meta').textContent.startsWith('조장 서하준')));
  ok('13px 미만 없음 · 가로 넘침 없음 @390', (await smallText(page)).length === 0 && await noHScroll(page), await smallText(page));
  const ROW4 = '.st-row[data-group="4조"] .score-form';
  for (const bad of ['101', '-1', '7.5']) {
    await fill(page, ROW4, bad);
    const n = (await bodies(page, 'station.set')).length;
    await page.click(ROW4 + ' [data-score-save]');
    await waitToast(page, '0~100');
    ok('🔴 "' + bad + '" 은 막는다 — 보내지 않는다', (await bodies(page, 'station.set')).length === n);
  }
  await fill(page, ROW4, 85);
  await page.click(ROW4 + ' [data-score-save]');
  await waitToast(page, '4조 점수 85점 저장');
  let sent = (await bodies(page, 'station.set')).pop();
  ok('🔴 station.set [{group:4조, score:85}]', JSON.stringify(sent.items) === JSON.stringify([{ group: '4조', score: 85 }]), sent);
  ok('   다시 그린 칸에 85', (await forms(page)).find(x => x.key === '4조').value === '85');
  await page.click(ROW4 + ' [data-score-clear]');
  await waitToast(page, '4조 점수를 지웠습니다');
  sent = (await bodies(page, 'station.set')).pop();
  ok('지우기 → score:\'\' · 지우기 단추가 사라진다', JSON.stringify(sent.items) === JSON.stringify([{ group: '4조', score: '' }]) &&
    await page.locator(ROW4 + ' [data-score-clear]').count() === 0, sent);
  await page.context().close();

  page = await openAs(env, 'camti', 'STAFF');
  ok('🔴 STAFF 에서 캠티는 칸 없이 보기만 — "⭐ 점수 100점"(CP1)', (await forms(page)).length === 0 &&
    (await page.textContent('#cp-CP1')).includes('⭐ 점수 100점'));
  await page.context().close();
  page = await openAs(env, 'leader', 'STAFF');
  ok('조장 코스도 보기만 — CP3 "⭐ 점수 90점"', (await forms(page)).length === 0 && (await page.textContent('#cp-CP3')).includes('⭐ 점수 90점'));
  await page.context().close();

  // ------------------------------------------------------------ CAMTI
  section('🔴 CAMTI — 캠티(역할 캠티)가 자기 조 코스에서');
  page = await openAs(env, 'camti', 'CAMTI');
  f = await forms(page);
  ok('🔴 도착·완료한 지점(CP1·CP2·CP3)에 칸 · 대기(CP4)엔 없다', JSON.stringify(f.map(x => x.key)) === JSON.stringify(['CP1', 'CP2', 'CP3']), f);
  ok('   스태프가 넣은 CP1(100)은 잠기고 "스태프가 넣은 점수"', f[0].locked && f[0].value === '100' && f[0].note === '스태프가 넣은 점수', f[0]);
  ok('   캠티가 넣은 CP2(80)는 고칠 수 있다', !f[1].locked && f[1].value === '80', f[1]);
  ok('   안내에 점수', (await page.textContent('.section-head .hint')).includes('점수(0~100)는 도착한 지점 카드에서'));
  ok('13px 미만 없음 · 가로 넘침 없음 @390', (await smallText(page)).length === 0 && await noHScroll(page), await smallText(page));
  await fill(page, '#cp-CP3 .score-form', 95);
  await page.click('#cp-CP3 .score-form [data-score-save]');
  await waitToast(page, '보구여관 터 점수 95점 저장');
  sent = (await bodies(page, 'progress.set')).pop();
  ok('🔴 progress.set [{checkpoint:CP3, score:95}] — 상태는 안 보낸다', JSON.stringify(sent.items) === JSON.stringify([{ checkpoint: 'CP3', score: 95 }]), sent);
  ok('   카드에 "⭐ 점수 95점" · 상태는 도착 그대로', (await page.textContent('#cp-CP3')).includes('⭐ 점수 95점') &&
    await page.evaluate(() => document.querySelector('#cp-CP3').getAttribute('data-status')) === '도착');
  await page.context().close();

  for (const who of ['leader', 'member']) {
    page = await openAs(env, who, 'CAMTI');
    ok('🔴 CAMTI 에서 ' + (who === 'leader' ? '참가자 조장' : '조원') + '은 칸 없음 (역할 캠티만)', (await forms(page)).length === 0);
    await page.context().close();
  }
  page = await openAs(env, 'staff', 'CAMTI');
  ok('CAMTI 에서 스태프는 칸 없이 "⭐ 100점"(2조)', (await forms(page)).length === 0 &&
    (await page.textContent('.st-row[data-group="2조"] .team-card__meta')).includes('⭐ 100점'));
  await page.context().close();

  // ------------------------------------------------------------ BOTH
  section('🔴 BOTH — 스태프 점수가 우선');
  page = await openAs(env, 'camti', 'BOTH');
  await page.evaluate(() => {           // 잠긴 칸을 억지로 풀어 보낸다 — 서버가 그대로 둔다
    const fm = document.querySelector('#cp-CP1 .score-form');
    fm.querySelectorAll('input, button').forEach(el => { el.disabled = false; });
    fm.querySelector('input').value = '40';
    fm.querySelector('[data-score-save]').click();
  });
  await waitToast(page, '스태프가 넣은 점수');
  ok('🔴 "스태프가 넣은 점수(100점)라 바꾸지 않았습니다"', (await toastText(page)) === '스태프가 넣은 점수(100점)라 바꾸지 않았습니다.', await toastText(page));
  ok('   카드는 100점 그대로 · 다시 잠김', (await page.textContent('#cp-CP1')).includes('⭐ 점수 100점') && (await forms(page))[0].locked);
  await page.context().close();
  page = await openAs(env, 'staff', 'BOTH');
  ok('BOTH 에서 스태프도 칸', (await forms(page)).length === 2);
  await page.context().close();

  // ------------------------------------------------------------ 콘솔
  section('🔴 콘솔 — 운영 설정에서 켜기');
  page = await env.open({ mode: 'admin', width: 1100 });
  await adminLogin(page);
  await page.click('#tabbar [data-view="progress"]');
  await page.waitForSelector('.team-card');
  ok('(꺼짐) 카드에 점수 없음', !/\d+점/.test(await page.textContent('.team-grid')));
  await page.click('#tabbar [data-view="settings"]');
  await page.waitForSelector('#scoreSeg');
  ok('설정에 "지점 점수" — 현재 끔', (await page.textContent('#view')).includes('현재: 끔'));
  await page.click('#scoreSeg input[value="STAFF"]', { force: true });
  await waitToast(page, '지점 점수: 거점 스태프');
  const cfg = (await bodies(page, 'admin.config.set')).pop();
  ok('🔴 admin.config.set {SCORE_INPUT: STAFF, allowNew} (옛 시트엔 키가 없다)', cfg.key === 'SCORE_INPUT' && cfg.value === 'STAFF' && cfg.allowNew === true, cfg);
  ok('   현재: 거점 스태프', (await page.textContent('#view')).includes('현재: 거점 스태프'));

  await page.click('#tabbar [data-view="progress"]');
  await page.waitForSelector('.team-card');
  ok('🔴 켜면 카드 칸에 "· 90점" (1조 보구여관 터)', await page.evaluate(() => [...document.querySelectorAll('.team-card[data-team="10/31(토) 1조"] .step__state')]
    .some(e => e.textContent === '완료 14:24 · 90점')));
  ok('   진행자 "캠티 윤지한"(2조) · "조장 김캠티"(1조)', await page.evaluate(() =>
    document.querySelector('.team-card[data-team="10/31(토) 2조"] .team-card__meta').textContent.startsWith('캠티 윤지한') &&
    document.querySelector('.team-card[data-team="10/31(토) 1조"] .team-card__meta').textContent.startsWith('조장 김캠티')));
  await page.evaluate(() => { document.querySelector('.board-table').open = true; });
  ok('   표 칸 "90점" · 조 칸 "캠티 윤지한 · 5명"', await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.board-grid tbody tr')];
    const r1 = rows.find(r => r.textContent.includes('1조 배재')), r2 = rows.find(r => r.textContent.includes('2조 정동'));
    return r1.cells[3].querySelector('.cell-score').textContent === '90점' && r2.cells[0].querySelector('small').textContent === '캠티 윤지한 · 5명';
  }));

  section('🔴 정정 창 — 점수만 고치기');
  await page.click('[data-edit-session="10/31(토)"][data-edit-group="1조"][data-edit-code="CP3"]');
  await page.waitForSelector('#cellForm input[name="score"]');
  ok('지금 점수가 칸에 (90)', await page.inputValue('#cellForm input[name="score"]') === '90');
  await page.fill('#cellForm input[name="score"]', '101');
  await page.click('#cellForm button[type="submit"]');
  await waitToast(page, '0~100');
  ok('101 은 막는다', (await bodies(page, 'admin.progress.set')).length === 0);
  await page.fill('#cellForm input[name="score"]', '75');
  await page.click('#cellForm button[type="submit"]');
  await waitToast(page, '75점으로 저장했습니다');
  const ed = (await bodies(page, 'admin.progress.set')).pop();
  ok('🔴 상태를 안 고르면 점수만 보낸다 {score:75}', ed.score === 75 && !('status' in ed) && ed.checkpoint === 'CP3', ed);
  ok('   카드 "· 75점"', await page.evaluate(() => [...document.querySelectorAll('.team-card[data-team="10/31(토) 1조"] .step__state')]
    .some(e => e.textContent === '완료 14:24 · 75점')));
  await page.click('[data-edit-session="10/31(토)"][data-edit-group="1조"][data-edit-code="CP3"]');
  await page.waitForSelector('#cellForm');
  await page.click('#cellForm input[value="완료"]', { force: true });
  await page.click('#cellForm button[type="submit"]');
  await waitToast(page, '완료로 저장했습니다');
  const ed2 = (await bodies(page, 'admin.progress.set')).pop();
  ok('상태만 고르면 점수는 안 보낸다 (D-039)', ed2.status === '완료' && !('score' in ed2), ed2);
  await page.context().close();

  section('🔴 🏆 ⭐ 점수 합계 (켜졌을 때만)');
  page = await env.open({ mode: 'admin', width: 1100, init: withScore(), initArg: 'BOTH' });
  await adminLogin(page);
  await page.click('#tabbar [data-view="awards"]');
  await page.waitForSelector('#scoreAward');
  const rank = await page.evaluate(() => [...document.querySelectorAll('#scoreAward .rank__row')].map(r =>
    r.querySelector('.rank__no').textContent + ' ' + r.querySelector('.rank__name').textContent + ' ' + r.querySelector('.rank__val').textContent));
  ok('🔴 합계 순위 — 4조 360 · 3조 240 · 2조 180 · 1조 90', JSON.stringify(rank) === JSON.stringify(['1 4조 정동길 360점', '2 3조 이화 240점', '3 2조 정동 180점', '4 1조 배재 90점']), rank);
  ok('   채점한 곳 수와 출처', (await page.textContent('#scoreAward .rank__row')).includes('4/4곳 채점'));
  await page.click('[data-present]');
  ok('크게 보기는 상위 3', await page.locator('#scoreAward .rank__row').count() === 3);
  await page.context().close();
  page = await env.open({ mode: 'admin', width: 1100 });
  await adminLogin(page);
  await page.click('#tabbar [data-view="awards"]');
  await page.waitForSelector('.award');
  ok('🔴 꺼지면 점수 부문이 없다 (D-056 그대로)', await page.locator('#scoreAward').count() === 0);
  await page.context().close();

  section('콘솔 390px');
  page = await env.open({ mode: 'admin', width: 390, init: withScore(), initArg: 'BOTH' });
  await adminLogin(page);
  await page.click('#tabbar [data-view="settings"]');
  await page.waitForSelector('#scoreSeg');
  ok('설정 390px 넘침 없음 · 13px 미만 없음', await noHScroll(page) && (await smallText(page)).length === 0, await smallText(page));
  await page.click('#tabbar [data-view="progress"]');
  await page.waitForSelector('.team-card');
  await page.evaluate(() => { document.querySelector('.board-table').open = true; });
  ok('진행 390px 넘침 없음 · 13px 미만 없음', await noHScroll(page) && (await smallText(page)).length === 0, await smallText(page));
  await page.context().close();

  section('런타임 오류');
  ok('JS 오류 없음', env.errors.length === 0, env.errors);
}).then(done, e => { console.error(e); process.exit(1); });
