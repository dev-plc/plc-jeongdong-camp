/**
 * 탐험일지 사진 여러 장 (D-064, v22) — 화면.
 *   작성: multiple · 고를 때마다 이어 붙임 · 한도 4 · ✕ · 다 차면 잠금 · 보낸 본문(photos) ·
 *   카드: 옆으로 넘기는 띠 + "📷 N장" · 수정: 사진마다 빼기 + 추가 · 예전 서버(한도 없음)면 한 장·예전 필드 ·
 *   운영 콘솔: 검수에 사진 전부 · 시상 ★ 는 사진마다.
 */
const { ok, section, done } = require('../lib/check');
const { withBrowser, login, adminLogin, text, bodies, noHScroll, smallText, waitToast } = require('../lib/browser');

const PNG = (n) => ({ name: 'p' + n + '.png', mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
const PICK = '#journalForm input[name="photoPick"]';
const picks = (page) => page.evaluate(() => document.querySelectorAll('#photoPicks .photo-pick').length);
const waitPicks = (page, n) => page.waitForFunction(k => document.querySelectorAll('#photoPicks .photo-pick').length === k, n);

withBrowser(async (env) => {
  // ------------------------------------------------------------ 작성
  section('작성 — 여러 장 고르기');
  let page = await env.open({ persona: 'member' });
  await login(page);
  await page.click('#tabbar [data-view="journal"]');
  await page.waitForSelector('#journalForm');
  const attr = await page.evaluate(s => { const el = document.querySelector(s); return { multiple: el.multiple, capture: el.hasAttribute('capture') }; }, PICK);
  ok('입력에 multiple (capture 는 여전히 없음)', attr.multiple && !attr.capture, attr);
  ok('버튼에 "최대 4장"', ((await text(page, '#photoPickBtn')) || '').includes('최대 4장'), await text(page, '#photoPickBtn'));

  await page.setInputFiles(PICK, [PNG(1), PNG(2), PNG(3)]);
  await waitPicks(page, 3);
  ok('세 장 → 썸네일 셋', (await picks(page)) === 3);
  ok('준비가 끝나면 안내 문구가 돌아온다', ((await text(page, '#photoHint')) || '').includes('카메라로 먼저 찍은 뒤'), await text(page, '#photoHint'));
  await page.click('#photoPicks .photo-pick:nth-child(2) .photo-pick__x');
  ok('✕ 로 한 장 빼기', (await picks(page)) === 2);
  await page.setInputFiles(PICK, [PNG(4)]);
  await waitPicks(page, 3);
  ok('🔴 다시 고르면 이어 붙는다 (한 장씩 고르는 피커)', (await picks(page)) === 3);
  await page.setInputFiles(PICK, [PNG(5), PNG(6)]);
  await waitToast(page, '4장까지');
  await waitPicks(page, 4);
  ok('🔴 한도를 넘으면 앞의 것만 넣고 알린다', (await picks(page)) === 4 &&
    ((await text(page, '#toast')) || '').includes('앞의 1장만'), await text(page, '#toast'));
  const full = await page.evaluate(s => ({ disabled: document.querySelector(s).disabled, cls: document.querySelector('#photoPickBtn').className }), PICK);
  ok('다 차면 고르기 버튼을 잠근다', full.disabled && /is-full/.test(full.cls), full);
  await page.click('#photoPicks .photo-pick:nth-child(4) .photo-pick__x');
  ok('빼면 다시 열린다', !(await page.evaluate(s => document.querySelector(s).disabled, PICK)));
  ok('13px 미만 글자 없음 (고른 사진)', (await smallText(page)).length === 0, await smallText(page));
  ok('가로로 밀리지 않는다 (고른 사진)', await noHScroll(page));

  await page.fill('#journalForm textarea[name="text"]', '세 장 올립니다');
  await page.click('#journalForm button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#photoPicks').hidden);
  const sent = (await bodies(page, 'journal.create'))[0];
  ok('🔴 보낸 본문: photos 3장 · 예전 필드 photo 없음', sent && sent.photos.length === 3 && !('photo' in sent), sent && Object.keys(sent));
  ok('미리보기 data URL 은 보내지 않는다 · JPEG 로 줄여서', sent.photos.every(p => p.dataBase64 && !p.previewUrl && p.mimeType === 'image/jpeg'));
  ok('올리면 고른 사진도 비운다', (await picks(page)) === 0);

  // ------------------------------------------------------------ 카드
  section('카드 — 옆으로 넘기는 띠');
  await page.waitForSelector('#journalList .jcard__gallery');
  const card = await page.evaluate(() => {
    const g = document.querySelector('#journalList .jcard__gallery');
    const strip = g.querySelector('.jcard__photos');
    return { n: g.querySelectorAll('.jcard__photo img').length, count: g.querySelector('.jcard__count').textContent,
             scrolls: strip.scrollWidth > strip.clientWidth, alt: g.querySelector('img').getAttribute('alt') };
  });
  ok('🔴 세 장이 한 카드에', card.n === 3, card);
  ok('"📷 3장" 표시', card.count.includes('📷 3장'), card.count);
  ok('띠 안에서 옆으로 넘긴다', card.scrolls, card);
  ok('사진마다 몇 번째인지 대체 글', /1\/3$/.test(card.alt), card.alt);
  ok('🔴 화면 전체는 가로로 밀리지 않는다', await noHScroll(page));
  const single = await page.evaluate(() => [...document.querySelectorAll('#journalList .jcard')]
    .filter(c => c.querySelectorAll('img').length === 1).map(c => !!c.querySelector(':scope > .jcard__photo')));
  ok('한 장짜리 글은 예전 모양 그대로', single.length > 0 && single.every(Boolean), single);
  ok('13px 미만 글자 없음 (카드)', (await smallText(page)).length === 0, await smallText(page));
  await page.context().close();

  // ------------------------------------------------------------ 수정
  section('수정 — 사진마다 빼기 · 추가');
  page = await env.open({ persona: 'leader' });
  await login(page);
  await page.click('#tabbar [data-view="journal"]');
  await page.waitForSelector('#journalForm');
  await page.setInputFiles(PICK, [PNG(1), PNG(2)]);
  await waitPicks(page, 2);
  await page.click('#journalForm button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#photoPicks').hidden);
  await page.waitForSelector('#journalList .jcard__gallery');
  const editId = await page.evaluate(() => document.querySelector('#journalList .jcard__gallery').closest('.jcard').getAttribute('data-id'));
  await page.click(`#journalList .jcard[data-id="${editId}"] [data-act="edit"]`);
  await page.waitForSelector('.jcard--editing [data-remove-photo]', { state: 'attached' });
  const ed = await page.evaluate(() => {
    const c = document.querySelector('.jcard--editing');
    const inp = c.querySelector('[data-field="photo"]');
    return { old: c.querySelectorAll('[data-remove-photo]').length, multiple: inp.multiple, label: inp.closest('label').textContent };
  });
  ok('지금 사진 두 장 — 사진마다 "빼기"', ed.old === 2, ed);
  ok('"사진 추가 · 최대 4장" (multiple)', ed.multiple && ed.label.includes('사진 추가'), ed);
  const EDIT = '.jcard--editing [data-field="photo"]';
  const newPicks = () => page.evaluate(() => document.querySelectorAll('.jcard--editing [data-role="newPicks"] .photo-pick').length);
  await page.setInputFiles(EDIT, [PNG(7), PNG(8), PNG(9)]);
  await waitToast(page, '4장까지');
  await page.waitForFunction(() => document.querySelectorAll('.jcard--editing [data-role="newPicks"] .photo-pick').length === 2);
  ok('🔴 남는 자리만큼만 (지금 2장 → 2장 더)', (await newPicks(page)) === 2);
  await page.click('.jcard--editing [data-role="newPicks"] .photo-pick:nth-child(2) .photo-pick__x');
  await page.click('.jcard--editing .photo-pick--old:first-child');          // 사진을 눌러도 "빼기" 가 걸린다
  const removedId = await page.evaluate(() => document.querySelector('.jcard--editing [data-remove-photo]:checked').getAttribute('data-remove-photo'));
  await page.setInputFiles(EDIT, [PNG(10), PNG(11)]);
  await page.waitForFunction(() => document.querySelectorAll('.jcard--editing [data-role="newPicks"] .photo-pick').length === 3);
  ok('빼기를 고르면 자리가 늘어난다 (1장 남김 → 3장 더)', (await newPicks(page)) === 3);
  ok('13px 미만 글자 없음 (수정)', (await smallText(page)).length === 0, await smallText(page));
  await page.click('.jcard--editing [data-act="save"]');
  await page.waitForSelector('.jcard--editing', { state: 'detached' });
  const upd = (await bodies(page, 'journal.update')).pop();
  ok('🔴 보낸 본문: removePhotoIds · addPhotos', upd && JSON.stringify(upd.removePhotoIds) === JSON.stringify([removedId]) &&
    upd.addPhotos.length === 3 && !('photo' in upd) && !('removePhoto' in upd), upd && Object.keys(upd));
  const after = await page.evaluate(id => document.querySelectorAll(`#journalList .jcard[data-id="${id}"] .jcard__photo img`).length, editId);
  ok('카드는 네 장 (1장 남김 + 3장)', after === 4, after);
  await page.context().close();

  // ------------------------------------------------------------ 예전 서버
  section('예전 서버(사본에 한도 없음) — 한 장, 예전 필드');
  // 데모의 가짜 서버가 fetch 를 갈아 끼우는 순간 감싸서, bootstrap 응답에서 한도를 뺀다
  page = await env.open({ persona: 'member', init: () => {
    let inner = window.fetch;
    Object.defineProperty(window, 'fetch', { configurable: true, get: () => inner, set(f) {
      inner = function (u, i) {
        let action = ''; try { action = JSON.parse(i.body).action; } catch (e) { /* GET */ }
        return f.apply(this, arguments).then(r => action !== 'bootstrap' ? r : r.text().then(t => {
          const p = JSON.parse(t); delete p.data.config.PHOTO_MAX_COUNT;
          return { ok: true, text: () => Promise.resolve(JSON.stringify(p)) };
        }));
      };
    } });
  } });
  await login(page);
  await page.click('#tabbar [data-view="journal"]');
  await page.waitForSelector('#journalForm');
  const legacy = await page.evaluate(s => ({ multiple: document.querySelector(s).multiple, label: document.querySelector('#photoPickBtn').textContent }), PICK);
  ok('multiple 없음 · "최대" 없음', !legacy.multiple && !legacy.label.includes('최대'), legacy);
  await page.setInputFiles(PICK, [PNG(1)]);
  await waitPicks(page, 1);
  await page.click('#journalForm button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#photoPicks').hidden);
  const old = (await bodies(page, 'journal.create')).pop();
  ok('🔴 예전 필드 photo 로 보낸다 (photos 를 모르는 서버에 사진이 빠지지 않게)', old && old.photo && old.photo.dataBase64 && !('photos' in old), old && Object.keys(old));
  await page.context().close();

  // ------------------------------------------------------------ 운영 콘솔
  section('운영 콘솔 — 검수에 사진 전부 · ★ 는 사진마다');
  page = await env.open({ mode: 'admin', width: 1100 });
  await adminLogin(page);
  await page.click('[data-jstatus="승인"]');
  await page.waitForSelector('.jcard__gallery');
  const rv = await page.evaluate(() => document.querySelector('.jcard__gallery').querySelectorAll('img').length);
  ok('🔴 검수 카드에 세 장 모두', rv === 3, rv);
  await page.click('[data-view="awards"]');
  await page.waitForSelector('.award-photo');
  const tiles = () => page.evaluate(() => [...document.querySelectorAll('.award-photo')]
    .filter(f => /4조/.test(f.textContent)).map(f => ({ photo: f.getAttribute('data-photo'), on: f.classList.contains('is-award'), cap: f.querySelector('figcaption').textContent })));
  let t = await tiles();
  ok('🔴 사진 한 장 = 한 칸 (4조 글 세 칸, 몇 번째인지)', t.length === 3 && t.every((x, i) => x.cap.includes('(' + (i + 1) + '/3)')), t);
  const second = t[1].photo;
  await page.click(`.award-photo[data-photo="${second}"] [data-award]`);
  await page.waitForFunction(p => { const f = document.querySelector(`.award-photo[data-photo="${p}"]`); return f && f.classList.contains('is-award'); }, second);
  const aw = (await bodies(page, 'admin.journal.award')).pop();
  ok('🔴 보낸 본문에 photoId', aw && aw.photoId === second && aw.award === true, aw);
  t = await tiles();
  ok('그 사진에만 ★ — 같은 글의 다른 사진은 그대로', t.filter(x => x.on).map(x => x.photo).join() === second, t);
  ok('★ 1장', ((await text(page, '.award .card__title .hint')) || '').includes('★ 1장') ||
    (await page.evaluate(() => [...document.querySelectorAll('.award .card__title')].some(h => h.textContent.includes('★ 1장')))));
  await page.click('[data-present]');
  const shown = await page.evaluate(() => [...document.querySelectorAll('.award-photo')].map(f => f.getAttribute('data-photo')));
  ok('크게 보기에는 ★ 사진만', shown.join() === second, shown);
  await page.context().close();

  section('런타임 오류');
  ok('JS 오류 없음', env.errors.length === 0, env.errors);
}).then(done, e => { console.error(e); process.exit(1); });
