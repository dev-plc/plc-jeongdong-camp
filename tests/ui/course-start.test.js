/**
 * 출발 안내 (D-063, v22) — 코스 비고("시청역 3번 출구")를 홈 조 카드와 코스 탭 1번 지점 앞에.
 * 코스 탭 줄은 첫 지점에 도착하면 내려간다. 비고가 비면 둘 다 없다.
 */
const { ok, section, done } = require('../lib/check');
const { withBrowser, login, text, noHScroll, smallText } = require('../lib/browser');

/** progress.list 응답을 바꿔 끼운다 — 데모의 1조는 이미 출발했으므로 "출발 전" 을 만든다. */
const patchProgress = (page, fn) => page.evaluate(src => {
  const f = window.fetch;
  const edit = new Function('list', 'return (' + src + ')(list)');
  window.fetch = function (u, i) {
    const action = (() => { try { return JSON.parse(i.body).action; } catch (e) { return ''; } })();
    return f.apply(this, arguments).then(r => action !== 'progress.list' ? r : r.text().then(t => {
      const p = JSON.parse(t); p.data = edit(p.data);
      return { ok: true, text: () => Promise.resolve(JSON.stringify(p)) };
    }));
  };
}, fn.toString());
const KV = (page) => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.card--team .kv > div')]
  .map(d => [d.querySelector('dt').textContent, d.querySelector('dd').textContent])));

withBrowser(async (env) => {
  section('홈 조 카드 — "출발" 줄');
  let page = await env.open({ persona: 'member' });
  await login(page);
  const kv = await KV(page);
  ok('🔴 집결 다음에 출발 · 시청역 3번 출구', kv['출발'] === '시청역 3번 출구', kv);
  const order = Object.keys(kv);
  ok('줄 순서: 집결 → 출발', order.indexOf('출발') === order.indexOf('집결') + 1, order);

  section('코스 탭 — 1번 지점 앞, 출발 전에만');
  await patchProgress(page, list => list.map(x => Object.assign(x, { status: '대기', arrivedAt: '', completedAt: '' })));
  await page.click('#tabbar [data-view="course"]');
  await page.waitForSelector('.cp');
  const st = await page.evaluate(() => {
    const el = document.querySelector('.course-start');
    if (!el) return null;
    const next = el.nextElementSibling;
    return { text: el.textContent, map: el.querySelector('a').getAttribute('href'), beforeFirst: !!next && next.matches('.cp') && next.querySelector('.cp__no').textContent === '1' };
  });
  ok('🔴 출발 전: "🚇 출발 · 시청역 3번 출구 → 1. 첫 지점"', st && st.text.includes('시청역 3번 출구') && /→ 1\. 보구여관/.test(st.text), st);
  ok('1번 지점 카드 바로 앞', st && st.beforeFirst, st);
  ok('지도는 출구를 카카오맵에서 찾는다', st && st.map === 'https://map.kakao.com/link/search/' + encodeURIComponent('시청역 3번 출구'), st && st.map);
  ok('13px 미만 글자 없음 (코스)', (await smallText(page)).length === 0, await smallText(page));
  ok('가로로 밀리지 않는다 (코스)', await noHScroll(page));
  await page.context().close();

  page = await env.open({ persona: 'member' });
  await login(page);
  await page.click('#tabbar [data-view="course"]');
  await page.waitForSelector('.cp');
  ok('🔴 첫 지점에 도착(완료)한 뒤에는 내려간다', (await page.locator('.course-start').count()) === 0);
  await page.context().close();

  section('비고가 비면 둘 다 없다');
  page = await env.open({ persona: 'leader' });
  await page.evaluate(() => {
    const f = window.fetch;
    window.fetch = function (u, i) {
      const action = (() => { try { return JSON.parse(i.body).action; } catch (e) { return ''; } })();
      return f.apply(this, arguments).then(r => (action !== 'auth.login' && action !== 'me') ? r : r.text().then(t => {
        const p = JSON.parse(t); const me = p.data.me || p.data; if (me.team) me.team.courseNote = '';
        return { ok: true, text: () => Promise.resolve(JSON.stringify(p)) };
      }));
    };
  });
  await login(page);
  ok('홈에 출발 줄 없음', !('출발' in (await KV(page))), await KV(page));
  await patchProgress(page, list => list.map(x => Object.assign(x, { status: '대기', arrivedAt: '', completedAt: '' })));
  await page.click('#tabbar [data-view="course"]');
  await page.waitForSelector('.cp');
  ok('코스에도 없음', (await page.locator('.course-start').count()) === 0);
  await page.context().close();

  section('런타임 오류');
  ok('JS 오류 없음', env.errors.length === 0, env.errors);
}).then(done, e => { console.error(e); process.exit(1); });
