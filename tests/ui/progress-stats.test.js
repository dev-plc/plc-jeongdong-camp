/**
 * 운영 콘솔 진행 현황 — 지점별 현황 · 앞선/뒤처진 조 · 표를 한 화면에 (D-073, 앱 v23.5~23.9).
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
  // 조 이름 덩어리 사이는 줄바꿈 안 되는 빈칸(&nbsp;)이라 보통 빈칸으로 읽는다 (D-077)
  const kv = (sel) => [...s.querySelectorAll(sel + ' > div')].map(d => d.querySelector('dt').textContent + ': ' + d.querySelector('dd').textContent.replace(/\u00a0/g, ' '));
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

async function openProgress(env, width, at) {
  const page = await env.open({ mode: 'admin', width, at });
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
  ok('안내: 3분 미만·1시간 초과는 통계에서 뺀다', await page.evaluate(() => document.querySelector('.spot-stats').textContent
    .includes('3분 미만(잘못 누름)과 1시간 초과(완료를 늦게 누름)는 통계에서 뺍니다(기록은 그대로)')));
  p = await pace(page);
  ok('뒤처진 조가 2/4 의 1조(머무는 곳 없음)로', /가장 뒤처진 조 1조 배재 · 2\/4 완료 · 마지막 15:25/.test(p[1]), p);
  await page.context().close();

  section('🔴 1시간 넘는 체류도 통계에서 뺀다 — 완료를 늦게 누른 것 (D-080)');
  {
    const setCell = async (pg, group, code, st) => {
      await pg.click('.team-card [data-edit-session="10/31(토)"][data-edit-group="' + group + '"][data-edit-code="' + code + '"]');
      await pg.waitForSelector('#cellForm');
      await pg.click('#cellForm input[value="' + st + '"]', { force: true });
      await pg.click('#cellForm button[type="submit"]');
      await pg.waitForFunction(() => !document.querySelector('#cellForm'));
    };
    // 15:40 에 1조 CP4(14:36 도착)를 완료 → 64분
    page = await openProgress(env, 1100, '2026-10-31T15:40:00+09:00');
    await setCell(page, '1조', 'CP4', '완료');
    let cp4 = (await spots(page)).CP4;
    ok('🔴 64분 체류: 완료 개수는 센다 (완료 3)', cp4.nums === '도착: 3/4 | 완료: 3', cp4);
    ok('🔴 64분 체류: 최단·최장·평균에서 빠지고 "1시간 초과 1건 제외" (시간은 적지 않는다)',
      cp4.stay === '최단: 17분 · 3조 이화 | 최장: 18분 · 4조 정동길 | 평균: 18분 (1시간 초과 1건 제외)' && !/64분/.test(cp4.stay), cp4);
    for (const st of ['도착', '완료']) await setCell(page, '2조', 'CP4', st);
    cp4 = (await spots(page)).CP4;
    ok('둘 다 있으면 한 줄로 — "3분 미만 1건 · 1시간 초과 1건 제외"', / \(3분 미만 1건 · 1시간 초과 1건 제외\)$/.test(cp4.stay) && cp4.nums === '도착: 4/4 | 완료: 4', cp4);
    await page.context().close();

    // 경계: 15:36 에 완료 → 정확히 60분은 넣는다
    page = await openProgress(env, 1100, '2026-10-31T15:36:00+09:00');
    await setCell(page, '1조', 'CP4', '완료');
    cp4 = (await spots(page)).CP4;
    ok('🔴 경계: 정확히 60분은 통계에 넣는다 (최장 60분 · 평균 32분)', cp4.stay === '최단: 17분 · 3조 이화 | 최장: 60분 · 1조 배재 | 평균: 32분', cp4);
    await page.context().close();
  }

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

  section('🔴 지점 칸 배치 — 넷이 한 줄, 안 되면 둘씩 두 줄 (셋+하나 없음) (D-077)');
  for (const [width, want] of [[1100, '4'], [640, '2,2'], [390, '2,2']]) {
    page = await openProgress(env, width);
    const lay = await page.evaluate(() => {
      const rows = {};
      document.querySelectorAll('.spot-grid')[0].querySelectorAll('.spot').forEach(sp => {
        const top = Math.round(sp.getBoundingClientRect().top);
        rows[top] = (rows[top] || 0) + 1;
      });
      const lines = (el) => { const r = el.getClientRects(); return r.length === 1 && r[0].height < parseFloat(getComputedStyle(el).fontSize) * 2; };
      // "·" 가 줄 머리(값 칸 왼쪽 끝)에 오면 안 된다
      const dotAtHead = [];
      document.querySelectorAll('.spot__stay dd').forEach(dd => {
        const left = dd.getBoundingClientRect().left;
        const walk = document.createTreeWalker(dd, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
          for (let i = n.data.indexOf('·'); i >= 0; i = n.data.indexOf('·', i + 1)) {
            const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1);
            if (r.getBoundingClientRect().left - left < 3) dotAtHead.push(dd.textContent);
          }
        }
      });
      return { perRow: Object.keys(rows).sort((a, b) => a - b).map(k => rows[k]).join(),
               split: [...document.querySelectorAll('.spot__team, .spot__here')].filter(el => !lines(el)).map(el => el.textContent),
               dotAtHead,
               inside: [...document.querySelectorAll('.spot')].every(sp => sp.scrollWidth <= sp.clientWidth + 1) };
    });
    ok('🔴 ' + width + 'px: 한 줄에 ' + (want === '4' ? '넷' : '둘씩 두 줄') + ' (' + want + ')', lay.perRow === want, lay);
    ok('🔴 ' + width + 'px: 조 이름·머무는 중이 가운데서 갈라지지 않는다', lay.split.length === 0, lay);
    ok(width + 'px: "·" 가 줄 머리에 오지 않는다', lay.dotAtHead.length === 0, lay);
    ok(width + 'px: 지점 칸 밖으로 넘치지 않는다 · 13px 미만 글자 없음', lay.inside && (await smallText(page)).length === 0, lay);
    await page.context().close();
  }

  section('🔴 칸 정정 — 저장이 소리 없이 무시되지 않는다 · 새로고침 · 기준 시각 (D-078)');
  // 현장 신고: '완료' 로 바꾸고 저장 → 창만 닫히고 그대로. 창이 지금 상태를 미리 골라 두고,
  // 고른 것이 지금과 같으면 아무것도 보내지 않고 닫았다. 화면의 "지금" 은 처음 받은 뒤 다시 읽지 않아 낡을 수 있다.
  page = await openProgress(env, 1100);
  const CELL = (g, c) => '.team-card [data-edit-session="10/31(토)"][data-edit-group="' + g + '"][data-edit-code="' + c + '"]';
  const cellText = (g, c) => page.evaluate(s => document.querySelector(s).textContent.replace(/\s+/g, ' ').trim(), CELL(g, c));
  const sets = () => page.evaluate(() => window.__BODIES.filter(b => b.action === 'admin.progress.set'));
  const boards = () => page.evaluate(() => window.__BODIES.filter(b => b.action === 'admin.progress.board').length);
  const toastText = () => page.evaluate(() => document.querySelector('#toast').textContent);
  const openCell = async (g, c) => { await page.click(CELL(g, c)); await page.waitForSelector('#cellForm'); };
  // 창이 닫힐 때까지 — 되돌려 보는 실험에서 30초씩 멈추지 않게 짧게 기다리고, 안 닫혔으면 닫는다
  const saveAndWait = async () => {
    await page.click('#cellForm button[type="submit"]');
    const closed = await page.waitForFunction(() => !document.querySelector('#cellForm'), null, { timeout: 4000 }).then(() => true, () => false);
    if (!closed) await page.click('#cellForm [data-act="cancel"]');
    return closed;
  };
  const pick = (st) => page.locator('#cellForm .seg__item', { hasText: st }).locator('span').click();   // 사람처럼 글자를 누른다
  const reload = async () => {
    const n = await boards();
    await page.click('[data-reload]');
    return page.waitForFunction(k => window.__BODIES.filter(b => b.action === 'admin.progress.board').length > k &&
      !document.querySelector('#view .loading'), n, { timeout: 4000 }).then(() => true, () => false);
  };
  // 다음 admin.progress.board(__TAMPER) · admin.progress.set(__TAMPER_SET) 응답을 한 번 꾸민다 —
  // 그 사이 현장에서 바뀐 서버 값, 또는 서버가 시트에 못 넣은 저장(D-079)을 흉내 낸다
  await page.evaluate(() => {
    const f = window.fetch;
    window.__TAMPER = null;
    window.__TAMPER_SET = null;
    window.fetch = function (url, init) {
      let body = {};
      try { body = JSON.parse((init && init.body) || '{}'); } catch (e) { /* GET */ }
      const p = f.apply(this, arguments);
      const key = body.action === 'admin.progress.board' ? '__TAMPER' : body.action === 'admin.progress.set' ? '__TAMPER_SET' : null;
      const tamper = key && window[key];
      if (!tamper) return p;
      window[key] = null;
      return p.then(r => r.text()).then(t => {
        const j = JSON.parse(t); j.data = tamper(j.data);
        const out = JSON.stringify(j);
        return { ok: true, text: () => Promise.resolve(out) };
      });
    };
  });

  ok('기준 시각이 보인다 ("15:2x 기준")', /^15:2\d 기준$/.test(await page.evaluate(() => document.querySelector('#progressAt').textContent)),
    await page.evaluate(() => document.querySelector('#progressAt').textContent));
  ok('🔴 [새로고침] → 보드를 다시 읽는다', await reload());

  await openCell('1조', 'CP4');
  ok('🔴 창을 열어도 지금 상태(도착)를 미리 고르지 않는다', await page.evaluate(() => !document.querySelector('#cellForm input:checked')));
  ok('창에 "지금 도착 (HH:MM 기준)"', /지금 도착 \(\d{2}:\d{2} 기준\)/.test(await page.evaluate(() => document.querySelector('#cellForm').textContent)));
  let before = (await sets()).length;
  await page.click('#cellForm button[type="submit"]');
  await page.waitForTimeout(300);
  ok('🔴 안 고르고 저장 → 창은 그대로 · "바꿀 상태를 고르세요" · 요청 없음',
    await page.evaluate(() => !!document.querySelector('#cellForm')) && (await toastText()).includes('바꿀 상태를 고르세요') &&
    (await sets()).length === before, await toastText());
  if (await page.$('#cellForm')) await page.click('#cellForm [data-act="cancel"]');

  await openCell('4조', 'CP1');
  await pick('완료');
  await saveAndWait();
  let last = (await sets()).pop();
  ok('🔴 지금과 같은 상태(완료)여도 서버에 보낸다', !!last && last.group === '4조' && last.checkpoint === 'CP1' && last.status === '완료', last);
  ok('알림에 저장한 상태를 적는다', (await toastText()).includes('4조 정동길 · 배재학당역사박물관 → 완료로 저장했습니다'), await toastText());
  ok('같은 상태면 시각은 그대로 (완료 14:00)', (await cellText('4조', 'CP1')).endsWith('완료 14:00'), await cellText('4조', 'CP1'));

  // 🔴 낡은 화면: 콘솔은 1조 CP4 를 완료(14:50)로 보지만 서버는 아직 도착이다
  await page.evaluate(() => {
    window.__TAMPER = (d) => {
      d.teams.forEach(t => {
        if (t.session === '10/31(토)' && t.group === '1조') t.cells.CP4 = Object.assign({}, t.cells.CP4, { status: '완료', completedAt: '2026-10-31T14:50:00+09:00' });
      });
      return d;
    };
  });
  ok('[새로고침] (낡은 값을 받는다)', await reload());
  ok('낡은 화면: 1조 CP4 완료 14:50', (await cellText('1조', 'CP4')).endsWith('완료 14:50'), await cellText('1조', 'CP4'));
  await openCell('1조', 'CP4');
  await pick('완료');
  before = (await sets()).length;
  await saveAndWait();
  ok('🔴 낡은 "지금 완료" 와 같아도 보낸다 — 예전엔 창만 닫히고 아무 일도 없었다', (await sets()).length === before + 1, await sets());
  ok('🔴 화면이 서버 값으로 바로잡힌다 (완료 15:2x — 서버가 지금 찍은 시각)', /완료 15:2\d$/.test(await cellText('1조', 'CP4')), await cellText('1조', 'CP4'));
  await openCell('2조', 'CP4');
  await pick('도착');
  await saveAndWait();
  ok('알림 받침: "도착으로" (완료·대기는 "로")', (await toastText()).includes('2조 정동 · 이화여고 박물관 → 도착으로 저장했습니다'), await toastText());

  // 🔴 D-079: 서버가 "됐다" 고 했는데 응답 진행표에 그 칸이 없다 — 10/31 저녁 새 행이 시트에 남지 않은 날(원인 미확정)
  await page.evaluate(() => {
    window.__TAMPER_SET = (d) => {
      d.teams.forEach(t => { if (t.session === '10/31(토)' && t.group === '3조') delete t.cells.CP1; });
      return d;
    };
  });
  await openCell('3조', 'CP1');
  await pick('완료');
  await saveAndWait();
  const lost = await page.evaluate(() => ({ text: document.querySelector('#toast').textContent, error: document.querySelector('#toast').classList.contains('toast--error') }));
  ok('🔴 응답 진행표에 고른 상태가 없으면 "저장했습니다" 대신 빨간 알림 (다시 저장)',
    lost.error && lost.text.includes('진행표에 들어가지 않았습니다') && lost.text.includes('다시 저장해 보세요') && !lost.text.includes('저장했습니다') &&
    !lost.text.includes('필터'), lost);
  ok('화면은 응답 그대로 — 3조 CP1 대기', (await cellText('3조', 'CP1')).endsWith('대기'), await cellText('3조', 'CP1'));

  // teamPace 가드: 모두 완료인데 도착 시각이 비어 소요 시간을 잴 수 없다(시트를 손으로 고친 경우)
  await page.evaluate(() => {
    window.__TAMPER = (d) => {
      d.teams.forEach(t => {
        if (t.session !== '10/31(토)') return;
        t.route.forEach(code => { t.cells[code] = { status: '완료', arrivedAt: '', completedAt: '2026-10-31T15:00:00+09:00', score: null, scoreSource: '' }; });
      });
      return d;
    };
  });
  ok('[새로고침] (모두 완료 · 도착 시각 없음)', await reload());
  const guard = await page.evaluate(() => ({ stats: !!document.querySelector('.spot-stats'),
    pace: [...document.querySelectorAll('.spot-stats .pace li')].map(li => li.textContent.replace(/\s+/g, ' ').trim()),
    error: (document.querySelector('#view > .empty') || {}).textContent || '' }));
  ok('🔴 모두 완료인데 시각이 비어도 화면이 그려진다 (예전엔 TypeError)', guard.stats && !guard.error, guard);
  ok('앞선 조 줄만 — 잴 수 없는 뒤처진 조 줄은 뺀다', guard.pace.length === 1 && guard.pace[0].startsWith('🏃'), guard);
  await page.context().close();

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
