/**
 * 모든 화면 한 바퀴 — 페르소나 넷(조장·조원·스태프·교역자) × 탭 전부 + 운영 콘솔 탭 전부.
 * 각 화면에서: 내용이 그려진다 · JS 오류 없음 · 오류 토스트 없음 · 390px 가로 넘침 없음 · 13px 미만 글자 없음(D-050)
 *            · 점수 칸·점수 표시 없음(D-056).
 * 새 탭을 만들면 여기 목록에 더한다.
 */
const { ok, section, done } = require('../lib/check');
const { withBrowser, login, adminLogin, noHScroll, smallText } = require('../lib/browser');

const APP_TABS = ['home', 'course', 'journal', 'me'];
const ADMIN_TABS = ['review', 'notice', 'progress', 'awards', 'fee', 'settings'];

async function check(page, label) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(250);
  const view = await page.evaluate(() => (document.querySelector('#view') || {}).textContent || '');
  ok(label + ' — 그려짐', view.trim().length > 20, view.slice(0, 60));
  const bad = await page.evaluate(() => { const t = document.querySelector('#toast.show.toast--error'); return t ? t.textContent : ''; });
  ok(label + ' — 오류 토스트 없음', !bad, bad);
  ok(label + ' — 가로 넘침 없음', await noHScroll(page));
  const small = await smallText(page);
  ok(label + ' — 13px 미만 글자 없음', small.length === 0, small);
  // 🔴 미션 점수 입력·표시는 D-056 에서 뺐다. 데모 데이터에는 점수가 남아 있다 — 새어 나오면 여기서 잡힌다.
  const score = await page.evaluate(() => ({
    fields: document.querySelectorAll('.input--score, [data-score-save], [data-st="score"], input[name="score"], .cp__score, .step__score').length,
    // "13:30" 뒤에 "점심식사" 가 붙어 읽히는 일정표는 뺀다 — 시각(:) 뒤 숫자·"점심" 은 점수가 아니다
    text: (document.querySelector('#view').textContent.match(/퀴즈 점수|(?:^|[^:\d])\d{1,3}점(?!심)/) || [''])[0]
  }));
  ok(label + ' — 점수 칸·점수 표시 없음', !score.fields && !score.text, score);
}

withBrowser(async (env) => {
  for (const persona of ['leader', 'member', 'staff', 'pastor']) {
    section('참가자 앱 — ' + persona);
    const page = await env.open({ persona });
    await login(page);
    for (const v of APP_TABS) {
      await page.click(`#tabbar [data-view="${v}"]`);
      await check(page, persona + '/' + v);
    }
    await page.context().close();
  }

  for (const width of [390, 1200]) {
    section('운영 콘솔 — ' + width + 'px');
    const page = await env.open({ mode: 'admin', width });
    await adminLogin(page);
    for (const v of ADMIN_TABS) {
      await page.click(`#tabbar [data-view="${v}"]`);
      await check(page, 'admin/' + v + '@' + width);
    }
    await page.context().close();
  }

  section('런타임 오류');
  ok('JS 오류 없음 (전 화면)', env.errors.length === 0, env.errors);
}).then(done, e => { console.error(e); process.exit(1); });
