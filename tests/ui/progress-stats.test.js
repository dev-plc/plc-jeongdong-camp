/**
 * 운영 콘솔 진행 현황 — 지점별 현황 · 앞선/뒤처진 조 · 표를 한 화면에 (D-073, 앱 v23.5).
 * 기대값은 데모 데이터(10/31 네 조)로 손계산했다.
 *   1조 C코스  CP3 완료 14:00→14:24(24분) · CP4 도착 14:36
 *   2조 A코스  CP1 완료 14:02→14:26(24) · CP2 완료 14:38→15:00(22) · CP3 도착 15:12
 *   3조 B코스  CP2 완료 14:05→14:30(25) · CP3 완료 14:38→14:58(20) · CP4 완료 15:03→15:20(17)
 *   4조 A코스  CP1 13:40→14:00(20) · CP2 14:08→14:28(20) · CP3 14:36→14:56(20) · CP4 15:00→15:18(18) — 완주 1시간 38분
 *   11/07 1조  기록 없음
 */
const { ok, section, done } = require('../lib/check');
const { withBrowser, adminLogin, noHScroll, smallText } = require('../lib/browser');

/** 지점 칸 — 도착·완료(D-076)와 체류(D-075)는 한 줄씩이라 "도착: 4/4 | 완료: 3" · "최단: 20분 · 4조 정동길 | …" 으로 모아 읽는다. */
const spots = (page) => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.spot-stats .spot')].map(s => {
  const kv = (sel) => [...s.querySelectorAll(sel + ' > div')].map(d => d.querySelector('dt').textContent + ': ' + d.querySelector('dd').textContent);
  const rows = kv('.spot__stay');
  const note = s.querySelector('.spot__note');
  return [s.getAttribute('data-spot'), { nums: kv('.spot__nums').join(' | '),
    stay: (rows.length ? rows.join(' | ') : s.querySelector('.spot__cap').textContent) + (note ? ' (' + note.textContent + ')' : '') }];
})));
const pace = (page) => page.evaluate(() => [...document.querySelectorAll('.spot-stats .pace li')].map(li => li.textContent.replace(/\s+/g, ' ').trim()));
const EXPECT = {
  // 평균은 반올림한 분 (D-074): CP2 (22+25+20)/3=22.3 · CP3 (24+20+20)/3=21.3 · CP4 (17+18)/2=17.5→18
  CP1: { nums: '도착: 2/4 | 완료: 2', stay: '최단: 20분 · 4조 정동길 | 최장: 24분 · 2조 정동 | 평균: 22분' },
  CP2: { nums: '도착: 3/4 | 완료: 3', stay: '최단: 20분 · 4조 정동길 | 최장: 25분 · 3조 이화 | 평균: 22분' },
  CP3: { nums: '도착: 4/4 (머무는 중 1) | 완료: 3', stay: '최단: 20분 · 3조 이화 · 4조 정동길 | 최장: 24분 · 1조 배재 | 평균: 21분' },
  CP4: { nums: '도착: 3/4 (머무는 중 1) | 완료: 2', stay: '최단: 17분 · 3조 이화 | 최장: 18분 · 4조 정동길 | 평균: 18분' }
};

async function openProgress(env, width) {
  const page = await env.open({ mode: 'admin', width });
  await adminLogin(page);
  await page.click('#tabbar [data-view="progress"]');
  await page.waitForSelector('.spot-stats');
  return page;
}

withBrowser(async (env) => {
  section('🔴 지점별 현황 — 도착(누적)·머무는 중·완료·체류 최단/최장/평균');
  let page = await openProgress(env, 1100);
  const s = await spots(page);
  Object.keys(EXPECT).forEach(code => {
    ok('🔴 ' + code + ' ' + EXPECT[code].nums, s[code] && s[code].nums === EXPECT[code].nums, s[code]);
    ok('   ' + code + ' ' + EXPECT[code].stay, s[code] && s[code].stay === EXPECT[code].stay, s[code]);
  });

  section('🔴 회차 전체 — 가장 앞선 조 · 가장 뒤처진 조');
  let p = await pace(page);
  ok('🔴 앞선 조 = 완주가 가장 빠른 4조 (1시간 38분, 시상과 같은 식)', p[0] === '🏃 가장 앞선 조 4조 정동길 · 완주 1시간 38분', p);
  ok('🔴 뒤처진 조 = 완료가 가장 적은 1조', p[1] === '🐢 가장 뒤처진 조 1조 배재 · 1/4 완료 · 도착 중 · 마지막 14:36', p);
  const sessions = await page.evaluate(() => [...document.querySelectorAll('.spot-stats__session')].map(e => e.textContent));
  ok('전체 회차면 회차마다 묶는다', sessions.join() === '10/31(토),11/07(토)', sessions);
  ok('🔴 기록 없는 회차(11/07)는 "아직 기록 없음" — 뒤처진 조로 잡지 않는다',
    await page.evaluate(() => document.querySelectorAll('.spot-stats__none').length === 1 && document.querySelectorAll('.spot-stats .pace').length === 1));

  section('회차 필터를 따른다');
  await page.click('#sessionFilter [data-session="10/31(토)"]');
  await page.waitForSelector('.spot-stats');
  ok('10/31 만 — 회차 머리 없이 같은 수치', JSON.stringify(await spots(page)) === JSON.stringify(EXPECT) &&
    await page.evaluate(() => !document.querySelector('.spot-stats__session')), await spots(page));
  await page.click('#sessionFilter [data-session="11/07(토)"]');
  await page.waitForSelector('.spot-stats');
  ok('11/07 만 — 아직 기록 없음', await page.evaluate(() => !!document.querySelector('.spot-stats__none') && !document.querySelector('.spot-stats .spot')));
  await page.click('#sessionFilter [data-session="10/31(토)"]');

  section('칸을 고치면 현황도 바로 바뀐다');
  await page.click('[data-edit-session="10/31(토)"][data-edit-group="1조"][data-edit-code="CP4"]');
  await page.waitForSelector('#cellForm');
  await page.click('#cellForm input[value="완료"]', { force: true });
  await page.click('#cellForm button[type="submit"]');
  await page.waitForFunction(() => !document.querySelector('#cellForm'));
  const cp4 = (await spots(page)).CP4;
  ok('1조 CP4 완료(15:25) → 도착 3/4 · 완료 3 · 최장 1조 49분 · 평균 28분(17·18·49)',
    cp4.nums === '도착: 3/4 | 완료: 3' && /최장: 49분 · 1조 배재 \| 평균: 28분$/.test(cp4.stay), cp4);
  // 🔴 3분 미만 체류 (D-074): 2조 CP4 를 도착 → 바로 완료(0분). 기록은 남고 개수는 늘지만, 체류 통계에는 안 들어간다
  for (const st of ['도착', '완료']) {
    await page.click('[data-edit-session="10/31(토)"][data-edit-group="2조"][data-edit-code="CP4"]');
    await page.waitForSelector('#cellForm');
    await page.click('#cellForm input[value="' + st + '"]', { force: true });
    await page.click('#cellForm button[type="submit"]');
    await page.waitForFunction(() => !document.querySelector('#cellForm'));
  }
  const short = (await spots(page)).CP4;
  ok('🔴 0분 체류: 도착·완료 개수는 센다 (4/4 · 완료 4)', short.nums === '도착: 4/4 | 완료: 4', short);
  ok('🔴 0분 체류: 최단·최장·평균에서 빠진다 (그대로 17 · 49 · 28)',
    short.stay.startsWith('최단: 17분 · 3조 이화 | 최장: 49분 · 1조 배재 | 평균: 28분'), short);
  ok('🔴 "3분 미만 1건 제외" 를 붙이고, 그 시간(0분)은 적지 않는다', / \(3분 미만 1건 제외\)$/.test(short.stay) && !/ 0분/.test(short.stay), short);
  ok('기록은 그대로 — 표·카드의 2조 CP4 는 완료', await page.evaluate(() =>
    [...document.querySelectorAll('.team-card')].some(c => c.textContent.includes('2조 정동') && /이화여고 박물관\s*완료/.test(c.textContent))));
  ok('안내: 3분 미만은 통계에서 뺀다', await page.evaluate(() => document.querySelector('.spot-stats').textContent.includes('3분 미만은 잘못 누른 것으로 보고 통계에서 뺍니다')));
  p = await pace(page);
  ok('뒤처진 조가 2/4 의 1조(머무는 곳 없음)로', /가장 뒤처진 조 1조 배재 · 2\/4 완료 · 마지막 15:25/.test(p[1]), p);
  await page.context().close();

  section('🔴 도착·완료 / 체류 최단·최장·평균 — 한 줄씩, 숫자가 한 세로선에 (D-075·076)');
  for (const width of [1100, 390]) {
    page = await openProgress(env, width);
    const lay = await page.evaluate(() => {
      const box = (el) => el.getBoundingClientRect();
      const measure = (sel) => {
        // 머무는 중이 있는 CP3 — 예전에는 "… (머무는 중 1) · 완료 3" 이 좁은 칸에서 완료를 다음 줄 중간으로 밀었다
        const rows = [...document.querySelectorAll('.spot[data-spot="CP3"] ' + sel + ' > div')];
        return { n: rows.length, tops: rows.map(r => Math.round(box(r.querySelector('dt')).top)),
                 lefts: rows.map(r => Math.round(box(r.querySelector('dd strong')).left)) };
      };
      return { nums: measure('.spot__nums'), stay: measure('.spot__stay'),
               inside: [...document.querySelectorAll('.spot')].every(sp => sp.scrollWidth <= sp.clientWidth + 1) };
    });
    const { nums, stay } = lay;
    ok('🔴 ' + width + 'px: 도착·완료가 서로 다른 줄 (머무는 중이 있어도)', nums.n === 2 && nums.tops[0] < nums.tops[1], lay);
    ok(width + 'px: 도착·완료 숫자가 한 세로선에서 시작', new Set(nums.lefts).size === 1, lay);
    ok('🔴 ' + width + 'px: 세 줄(최단·최장·평균)이 서로 다른 줄', stay.n === 3 && stay.tops[0] < stay.tops[1] && stay.tops[1] < stay.tops[2], lay);
    ok(width + 'px: 분 숫자가 한 세로선에서 시작', new Set(stay.lefts).size === 1, lay);
    ok(width + 'px: 지점 칸 밖으로 넘치지 않는다', lay.inside, lay);
    ok(width + 'px: 13px 미만 글자 없음 (현황)', (await smallText(page)).length === 0, await smallText(page));
    await page.context().close();
  }

  section('🔴 표로 보기 — 옆으로 밀지 않고 한 화면에');
  for (const width of [1100, 390]) {
    page = await openProgress(env, width);
    await page.evaluate(() => { document.querySelector('.board-table').open = true; });
    const fit = await page.evaluate(() => {
      const t = document.querySelector('.board-table table');
      return { table: t.scrollWidth, box: t.parentElement.clientWidth, cols: t.querySelectorAll('thead th').length,
               scroller: !!t.closest('.table-scroll') };
    });
    ok('🔴 ' + width + 'px: 표 폭 ≤ 카드 폭 (옆 스크롤 없음)', fit.table <= fit.box && !fit.scroller, fit);
    ok(width + 'px: 다섯 칸 (조 + 지점 넷)', fit.cols === 5, fit);
    ok(width + 'px: 화면 전체도 밀리지 않는다', await noHScroll(page));
    ok(width + 'px: 13px 미만 글자 없음', (await smallText(page)).length === 0, await smallText(page));
    await page.context().close();
  }
  page = await openProgress(env, 1100);
  await page.evaluate(() => { document.querySelector('.board-table').open = true; });
  const row = await page.evaluate(() => {
    const tr = [...document.querySelectorAll('.board-table tbody tr')].find(r => r.textContent.includes('1조 배재'));
    return { team: tr.cells[0].textContent, cp3: tr.cells[3].textContent, cp4: tr.cells[4].textContent };
  });
  ok('조 칸에 회차·대상·조장·인원을 모은다', /1조 배재.*10\/31\(토\).*청년부.*조장 김캠티.*4명/.test(row.team), row);
  ok('지점 칸: 몇 번째 · 상태 · 시각', row.cp3 === '1번째완료14:24' && row.cp4 === '2번째도착14:36', row);
  await page.context().close();

  section('런타임 오류');
  ok('JS 오류 없음', env.errors.length === 0, env.errors);
}).then(done, e => { console.error(e); process.exit(1); });
