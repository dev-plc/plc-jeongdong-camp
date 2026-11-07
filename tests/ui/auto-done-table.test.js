/**
 * 11/07 현장 요청 (GAS v25 · 앱 v25).
 *  - 다음 지점에 도착하면 머물던 지점은 완료 (D-087). 조장·조원 코스는 서버가 AUTO_COMPLETE_PREV 를 켜 보낼 때만 미리 바꾼다.
 *  - 내 지점(스태프): 직전 지점 문구를 상태마다 · 시각까지, 먼저 기록된 것을 그대로 두면 알린다, 1분마다·다시 보이면 새로 읽는다.
 *  - 콘솔 표로 보기 (D-088): 조 칸 "1조 배재 청년부 / 조장 김캠티 · 4명", 지점 이름 낱말 사이 줄바꿈, 머리 고정.
 * 데모 10/31 15:25: 1조 코스 CP3 완료 · CP4 도착 14:36 · CP1 · CP2. 3조 CP4 완료 15:20 → CP1. 스태프는 CP1 거점.
 */
const { ok, section, done } = require('../lib/check');
const { withBrowser, login, adminLogin, allSessions, bodies, waitToast, smallText, noHScroll } = require('../lib/browser');

const status = (page, code) => page.evaluate(c => document.querySelector('#cp-' + c).getAttribute('data-status'), code);
const pause = async (page) => page.clock.pauseAt(new Date((await page.evaluate(() => Date.now())) + 1000));
const clickCp = (page, code) => page.evaluate(c => document.querySelector('#cp-' + c + ' .cp__next').click(), code);
const toastText = (page) => page.evaluate(() => document.querySelector('#toast').textContent);

async function openCourse(env, opt) {
  const page = await env.open(Object.assign({ persona: 'member' }, opt || {}));
  await login(page);
  await page.click('#tabbar [data-view="course"]');
  await page.waitForSelector('.cp');
  return page;
}

/** bootstrap 응답에서 AUTO_COMPLETE_PREV 를 뺀다 — 옛 서버(v24) */
const oldServer = () => {
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
          if (j.data && j.data.config) delete j.data.config.AUTO_COMPLETE_PREV;
          const out = JSON.stringify(j);
          return { ok: true, status: 200, text: () => Promise.resolve(out) };
        });
      };
    }
  });
};

/** 스태프 화면이 모르게 같은 가짜 서버에 기록한다 — 화면은 낡는다 */
const behind = (page, items) => page.evaluate(async (its) => {
  await window.fetch(window.__DEMO_API, { method: 'POST', body: JSON.stringify({ action: 'station.set', items: its }) });
}, items);
const meta = (page, g) => page.evaluate(x => document.querySelector('.st-row[data-group="' + x + '"] .team-card__meta').textContent, g);
const rowStatus = (page, g) => page.evaluate(x => document.querySelector('.st-row[data-group="' + x + '"] .chip').textContent, g);

withBrowser(async (env) => {
  // ------------------------------------------------------------ D-087 코스
  section('🔴 조원 — 다음 지점에 도착하면 머물던 지점은 완료 (D-087)');
  let page = await openCourse(env);
  await pause(page);
  await clickCp(page, 'CP1');               // CP4(이화여고) 에 도착해 있는 채로 CP1 도착
  ok('🔴 누르자마자 CP4 가 완료로 (서버가 켠 키를 보고 미리)', await status(page, 'CP4') === '완료' && await status(page, 'CP1') === '도착');
  await page.clock.runFor(400);
  await waitToast(page, '기록했습니다: 도착');
  ok('🔴 알림: "이화여고 박물관 완료로 바꿨습니다"', (await toastText(page)).includes('이화여고 박물관 완료로 바꿨습니다'), await toastText(page));
  const sent = (await bodies(page, 'progress.set')).pop();
  ok('보내는 것은 도착 하나뿐 — 완료는 서버가 바꾼다', JSON.stringify(sent.items) === JSON.stringify([{ checkpoint: 'CP1', status: '도착', undo: false }]), sent);
  ok('응답 뒤에도 CP4 완료 · CP1 도착', await status(page, 'CP4') === '완료' && await status(page, 'CP1') === '도착');
  ok('CP4 카드에 완료 시각', (await page.evaluate(() => document.querySelector('#cp-CP4').textContent)).includes('· 완료 '));
  await page.context().close();

  section('🔴 옛 서버(키 없음)면 화면에서 미리 바꾸지 않는다 — 응답이 오면 튀므로');
  page = await openCourse(env, { init: oldServer });
  await pause(page);
  await clickCp(page, 'CP1');
  ok('🔴 누른 직후 CP4 는 도착 그대로', await status(page, 'CP4') === '도착' && await status(page, 'CP1') === '도착');
  await page.clock.runFor(400);
  await page.context().close();

  // ------------------------------------------------------------ D-087 스태프
  section('🔴 내 지점 — 직전 지점 문구가 상태마다 · 시각까지 (D-087)');
  page = await env.open({ persona: 'staff' });
  await login(page);
  await page.click('#tabbar [data-view="course"]');
  await page.waitForSelector('.st-row[data-group="1조"]');
  ok('🔴 직전 지점에 도착해 있으면 "📍 …에 있음 (도착 14:36)"', (await meta(page, '1조')).includes('📍 이화여고 박물관에 있음 (도착 14:36)'), await meta(page, '1조'));
  ok('🔴 직전 지점을 끝냈으면 "🚶 오는 중 — … 완료 15:20"', (await meta(page, '3조')).includes('🚶 오는 중 — 이화여고 박물관 완료 15:20'), await meta(page, '3조'));
  ok('13px 미만 없음 · 가로 넘침 없음', (await smallText(page)).length === 0 && await noHScroll(page), await smallText(page));

  await page.click('.st-row[data-group="1조"] [data-st="set"][data-status="도착"]');
  await waitToast(page, '1조 도착');
  ok('🔴 도착 확인 → 알림 "1조 도착 · 이화여고 박물관 완료로 바꿨습니다"', (await toastText(page)) === '1조 도착 · 이화여고 박물관 완료로 바꿨습니다', await toastText(page));

  section('🔴 낡은 화면에서 누르면 — 먼저 기록된 것을 그대로 두었다고 알린다');
  await behind(page, [{ group: '3조', status: '도착' }]);    // 다른 사람이 먼저 기록 — 이 화면은 아직 대기
  ok('(전제) 화면은 3조 대기', await rowStatus(page, '3조') === '대기');
  await page.click('.st-row[data-group="3조"] [data-st="set"][data-status="도착"]');
  await waitToast(page, '3조 —');
  ok('🔴 "3조 — 먼저 기록된 것을 그대로 두었습니다 (도착 HH:MM)"', /^3조 — 먼저 기록된 것을 그대로 두었습니다 \(도착 \d\d:\d\d\)$/.test(await toastText(page)), await toastText(page));

  section('🔴 1분마다 · 다시 보이면 새로 읽는다');
  await behind(page, [{ group: '3조', status: '완료' }]);
  ok('(전제) 화면은 아직 3조 도착', await rowStatus(page, '3조') === '도착');
  await page.clock.runFor(61000);
  await page.waitForFunction(() => document.querySelector('.st-row[data-group="3조"] .chip').textContent === '완료', null, { timeout: 4000 }).catch(() => {});
  ok('🔴 1분 지나면 3조 완료로', await rowStatus(page, '3조') === '완료');
  await page.evaluate(() => document.querySelector('.st-row[data-group="3조"] .cp__no').closest('.st-row').setAttribute('data-mark', '1'));
  await behind(page, [{ group: '3조', status: '도착', undo: true }]);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(() => document.querySelector('.st-row[data-group="3조"] .chip').textContent === '도착', null, { timeout: 4000 }).catch(() => {});
  ok('🔴 다시 보이면 바로 새로 읽는다 (1분 안 기다림)', await rowStatus(page, '3조') === '도착');
  await page.context().close();

  // ------------------------------------------------------------ D-088 표
  section('🔴 콘솔 표로 보기 — 조 칸 두 줄 (D-088)');
  page = await env.open({ mode: 'admin', width: 1100 });
  await adminLogin(page);
  await page.click('#tabbar [data-view="progress"]');
  await page.waitForSelector('.board-table');
  await page.evaluate(() => { document.querySelector('.board-table').open = true; });
  const teamCell = (p) => p.evaluate(() => {
    const tr = [...document.querySelectorAll('.board-grid tbody tr')].find(r => r.textContent.includes('1조 배재'));
    const td = tr.cells[0];
    return { name: td.querySelector('.team-line strong').textContent, tag: (td.querySelector('.team-tag') || {}).textContent,
      sub: td.querySelector('small').textContent,
      sameLine: Math.abs(td.querySelector('strong').getBoundingClientRect().top - td.querySelector('.team-tag').getBoundingClientRect().top) < 6 };
  });
  let tc = await teamCell(page);
  ok('🔴 첫 줄 "1조 배재 청년부" (이름 옆에 대상)', tc.name === '1조 배재' && tc.tag === '청년부' && tc.sameLine, tc);
  ok('🔴 둘째 줄 "조장 김캠티 · 4명"', tc.sub === '조장 김캠티 · 4명', tc);
  await allSessions(page);
  await page.evaluate(() => { document.querySelector('.board-table').open = true; });
  tc = await teamCell(page);
  ok('전체 회차면 둘째 줄 앞에 회차', tc.sub === '10/31(토) · 조장 김캠티 · 4명', tc);

  section('🔴 지점 이름 — 번호는 윗줄, 낱말 사이에서 줄바꿈');
  const head = await page.evaluate(() => [...document.querySelectorAll('.board-grid thead th')].slice(1).map(th => ({
    no: th.querySelector('.th-no').textContent, name: th.querySelector('.th-name').textContent, wbr: th.querySelectorAll('wbr').length
  })));
  ok('번호가 따로 · 이름은 그대로', head[0].no === '1' && head[0].name === '배재학당역사박물관' && head[1].name === '러시아 공사관과 킹스로드', head);
  ok('"배재학당역사박물관" 에 줄 바꿀 자리', head[0].wbr === 1, head);
  const lines = (p) => p.evaluate(() => {
    const el = document.querySelectorAll('.board-grid thead th .th-name')[0];
    const out = [];
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      const n = walk.currentNode;
      for (let i = 0; i < n.length; i++) {
        const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1);
        const top = Math.round(r.getBoundingClientRect().top);
        const last = out[out.length - 1];
        if (last && Math.abs(last.top - top) < 4) last.text += n.data[i]; else out.push({ top, text: n.data[i] });
      }
    }
    return out.map(x => x.text);
  });
  for (const w of [1100, 690]) {
    await page.setViewportSize({ width: w, height: 900 });
    const l = await lines(page);
    ok('🔴 @' + w + ' "배재학당 / 역사박물관" (글자 중간 "박물 / 관" 아님)',
      JSON.stringify(l) === JSON.stringify(['배재학당역사박물관']) || JSON.stringify(l) === JSON.stringify(['배재학당', '역사박물관']), l);
  }
  await page.setViewportSize({ width: 1100, height: 900 });
  const st = await page.evaluate(() => {
    const td = [...document.querySelectorAll('.board-grid tbody tr')].find(r => r.textContent.includes('1조 배재')).cells[3];   // CP3 완료 14:24
    const c = td.querySelector('.chip').getBoundingClientRect(), t = td.querySelector('.cell-time').getBoundingClientRect();
    return { chip: td.querySelector('.chip').textContent, time: td.querySelector('.cell-time').textContent, same: Math.abs((c.top + c.bottom) / 2 - (t.top + t.bottom) / 2) < 4 };
  });
  ok('상태와 시각이 한 줄 @1100', st.same && st.chip === '완료' && st.time === '14:24', st);

  section('🔴 내려도 표 머리가 앱바 밑에 붙어 있다');
  // 데모는 조가 다섯이라 표가 짧다 — 창을 낮춰 표 위쪽이 앱바 밑으로 들어가게 내린다(실제는 조가 10개 넘는다)
  const stick = (p) => p.evaluate(() => {
    const table = document.querySelector('.board-grid');
    window.scrollTo(0, window.scrollY + table.getBoundingClientRect().top + 120);
    const bar = document.querySelector('.appbar').getBoundingClientRect();
    const th = table.querySelector('thead th').getBoundingClientRect();
    return { tableTop: Math.round(table.getBoundingClientRect().top), barBottom: Math.round(bar.bottom), thTop: Math.round(th.top) };
  });
  await page.setViewportSize({ width: 1100, height: 420 });
  let s = await stick(page);
  ok('🔴 @1100 표가 앱바 위로 올라가도 머리는 앱바 바로 밑', s.tableTop < s.barBottom && Math.abs(s.thTop - s.barBottom) <= 1, s);
  await page.context().close();

  page = await env.open({ mode: 'admin', width: 390 });
  await adminLogin(page);
  await page.click('#tabbar [data-view="progress"]');
  await page.waitForSelector('.board-table');
  await page.evaluate(() => { document.querySelector('.board-table').open = true; });
  await page.setViewportSize({ width: 390, height: 520 });
  s = await stick(page);
  ok('🔴 @390 도 머리 고정', s.tableTop < s.barBottom && Math.abs(s.thTop - s.barBottom) <= 1, s);
  ok('@390 가로 넘침 없음 · 13px 미만 없음', await noHScroll(page) && (await smallText(page)).length === 0, await smallText(page));
  await page.context().close();

  section('런타임 오류');
  ok('JS 오류 없음', env.errors.length === 0, env.errors);
}).then(done, e => { console.error(e); process.exit(1); });
