/**
 * 사진 넘기기 · 크게 보기 (D-073, 앱 v23.5).
 *   예전: 여러 장 띠는 손가락으로만 넘겼다(PC 불가). 사진을 누르면 새 탭에 한 장만 열려 다음 장으로 못 갔다.
 *   이제: 띠 양옆 ‹ › · 누르면 뷰어(‹ › · ←→ · Esc · ✕ · 바깥). 일지·검수·시상 사진 모두.
 * 데모: 4조 글(J0005)이 사진 3장, 1·2조 글은 1장.
 */
const { ok, section, done } = require('../lib/check');
const { withBrowser, login, adminLogin, noHScroll, smallText } = require('../lib/browser');

const GAL = '#journalList .jcard__gallery';
const count = (page, sel) => page.evaluate(s => document.querySelector(s).textContent, sel);
const waitCount = (page, sel, text) => page.waitForFunction(([s, t]) => {
  const el = document.querySelector(s); return el && el.textContent.includes(t);
}, [sel, text], { timeout: 4000 }).then(() => true, () => false);
const viewer = (page) => page.evaluate(() => {
  const v = document.querySelector('#photoViewer');
  return v ? { slides: v.querySelectorAll('.viewer__slide img').length, count: (v.querySelector('.viewer__count') || {}).textContent || null,
               nav: v.querySelectorAll('.gal-btn').length, locked: document.body.classList.contains('is-viewing') }
           : { open: false, locked: document.body.classList.contains('is-viewing') };
});
async function openJournal(env, width) {
  const page = await env.open({ persona: 'leader', width });
  await login(page);
  await page.click('#tabbar [data-view="journal"]');
  await page.click('[data-scope="gallery"]');
  await page.waitForSelector(GAL);
  return page;
}

withBrowser(async (env) => {
  section('🔴 PC — 띠 양옆 ‹ › 로 한 장씩 넘긴다');
  let page = await openJournal(env, 1100);
  ok('여러 장 띠에 ‹ › 버튼', await page.evaluate(g => document.querySelectorAll(g + ' .gal-btn').length === 2, GAL));
  await page.click(GAL + ' [data-gal="next"]');
  ok('🔴 › → 둘째 장 · "📷 2 / 3"', await waitCount(page, GAL + ' .jcard__count', '2 / 3') &&
    await page.evaluate(g => document.querySelector(g + ' .jcard__photos').scrollLeft > 0, GAL), await count(page, GAL + ' .jcard__count'));
  await page.click(GAL + ' [data-gal="next"]');
  ok('› → 셋째 장 · "📷 3 / 3"', await waitCount(page, GAL + ' .jcard__count', '3 / 3'), await count(page, GAL + ' .jcard__count'));
  await page.click(GAL + ' [data-gal="next"]');
  ok('끝에서 › 는 그대로', await waitCount(page, GAL + ' .jcard__count', '3 / 3'));
  await page.click(GAL + ' [data-gal="prev"]');
  ok('‹ → 둘째 장', await waitCount(page, GAL + ' .jcard__count', '2 / 3'), await count(page, GAL + ' .jcard__count'));

  section('🔴 크게 보기 — 누르면 뷰어, 그 안에서 넘긴다');
  await page.click(GAL + ' .jcard__photo >> nth=0');
  await page.waitForSelector('#photoViewer');
  let v = await viewer(page);
  ok('🔴 새 탭이 아니라 뷰어 — 세 장 · "1 / 3" · 뒤 화면 스크롤 잠금', v.slides === 3 && v.count === '1 / 3' && v.locked, v);
  ok('새 탭(팝업)이 열리지 않았다', page.context().pages().length === 1);
  await page.click('#photoViewer [data-viewer="next"]');
  ok('🔴 › → "2 / 3"', await waitCount(page, '.viewer__count', '2 / 3'), (await viewer(page)).count);
  await page.keyboard.press('ArrowRight');
  ok('🔴 → 키 → "3 / 3"', await waitCount(page, '.viewer__count', '3 / 3'), (await viewer(page)).count);
  await page.keyboard.press('ArrowLeft');
  ok('← 키 → "2 / 3"', await waitCount(page, '.viewer__count', '2 / 3'), (await viewer(page)).count);
  await page.keyboard.press('Escape');
  v = await viewer(page);
  ok('Esc 로 닫힌다 · 스크롤 잠금 풀림', v.open === false && !v.locked, v);
  await page.click(GAL + ' .jcard__photo >> nth=1', { force: true });
  await page.waitForSelector('#photoViewer');
  ok('🔴 둘째 사진을 누르면 "2 / 3" 부터', (await viewer(page)).count === '2 / 3', await viewer(page));
  await page.click('#photoViewer [data-viewer="close"]');
  ok('✕ 로 닫힌다', (await viewer(page)).open === false);
  await page.click(GAL + ' .jcard__photo >> nth=0', { force: true });
  await page.waitForSelector('#photoViewer');
  await page.mouse.click(550, 30);   // 사진 바깥(위쪽 여백)
  ok('사진 바깥을 누르면 닫힌다', (await viewer(page)).open === false);
  await page.click(GAL + ' .jcard__photo >> nth=0', { modifiers: ['Control'] }).catch(() => {});
  ok('Ctrl 클릭은 예전처럼 (뷰어 안 열림)', (await viewer(page)).open === false);
  await page.context().close();

  section('한 장짜리 글 — 뷰어에 넘기기 버튼 없음');
  page = await openJournal(env, 1100);
  const single = await page.evaluate(() => {
    const card = [...document.querySelectorAll('#journalList .jcard')].find(c => c.querySelector(':scope > .jcard__photo'));
    if (!card) return null;
    card.querySelector(':scope > .jcard__photo').setAttribute('data-test-single', '1');
    return true;
  });
  await page.click('[data-test-single]');
  await page.waitForSelector('#photoViewer');
  v = await viewer(page);
  ok('한 장 · ‹ › 없음 · 몇 장 표시 없음', single && v.slides === 1 && v.nav === 0 && v.count === null, v);
  await page.context().close();

  section('모바일 390px — 뷰어가 화면을 넘지 않는다');
  page = await openJournal(env, 390);
  await page.click(GAL + ' .jcard__photo >> nth=0');
  await page.waitForSelector('#photoViewer');
  ok('가로로 밀리지 않는다 (뷰어)', await noHScroll(page));
  ok('13px 미만 글자 없음 (뷰어)', (await smallText(page)).length === 0, await smallText(page));
  await page.click('#photoViewer [data-viewer="next"]');
  ok('모바일에서도 › 로 넘긴다', await waitCount(page, '.viewer__count', '2 / 3'));
  await page.keyboard.press('Escape');
  ok('13px 미만 글자 없음 (카드)', (await smallText(page)).length === 0, await smallText(page));
  await page.context().close();

  section('운영 콘솔 — 검수 카드 띠 · 시상 사진도 넘긴다');
  page = await env.open({ mode: 'admin', width: 1100 });
  await adminLogin(page);
  await page.click('#statusFilter [data-jstatus="전체"]');
  await page.waitForSelector('.jcard__gallery');
  await page.click('.jcard__gallery [data-gal="next"]');
  ok('🔴 검수 카드 띠도 › 로 "2 / 3"', await waitCount(page, '.jcard__gallery .jcard__count', '2 / 3'));
  await page.click('#tabbar [data-view="awards"]');
  await page.waitForSelector('.award-photo img');
  const n = await page.evaluate(() => document.querySelectorAll('.award-grid .award-photo img').length);
  await page.click('.award-grid .award-photo img >> nth=2');
  await page.waitForSelector('#photoViewer');
  v = await viewer(page);
  ok('🔴 시상 사진을 누르면 그 격자의 사진을 넘겨 본다 ("3 / N")', n > 2 && v.slides === n && v.count === '3 / ' + n, { n, v });
  await page.keyboard.press('ArrowRight');
  ok('→ 키로 다음 사진', await waitCount(page, '.viewer__count', '4 / ' + n));
  await page.keyboard.press('Escape');
  ok('★ 버튼은 그대로 (뷰어 안 열림)', await page.evaluate(() => {
    document.querySelector('.award-photo [data-award]').click();
    return !document.querySelector('#photoViewer');
  }));
  await page.context().close();

  section('런타임 오류');
  ok('JS 오류 없음', env.errors.length === 0, env.errors);
}).then(done, e => { console.error(e); process.exit(1); });
