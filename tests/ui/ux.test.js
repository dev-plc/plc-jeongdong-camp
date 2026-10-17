/**
 * 외부 사용성 보고서 반영 (D-058, v20.1) — 장년층 현장 사용.
 * 일지 임시저장 · 코스 "운영본부에 저장됨" · 공지 번호 → 전화 · 제목 고딕·글씨 · 알림 5초 · 로그아웃 문구.
 * 시계는 10/31 15:25 KST.
 */
const { ok, section, done } = require('../lib/check');
const { withBrowser, login, adminLogin, text, bodies, noHScroll, smallText } = require('../lib/browser');

const DRAFT = (pg) => pg.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('plc_jd_draft:')));

withBrowser(async (env) => {
  // ------------------------------------------------------------ 공지 → 전화
  section('공지의 전화번호를 누르면 전화');
  let page = await env.open({ persona: 'member' });
  await login(page);
  const tel = await page.evaluate(() => [...document.querySelectorAll('.notice a.tel')].map(a => [a.getAttribute('href'), a.textContent]));
  ok('🔴 "010-0000-0000" → tel: 링크', tel.length === 1 && tel[0][0] === 'tel:01000000000' && tel[0][1] === '010-0000-0000', tel);
  ok('공지 본문의 다른 글자는 그대로', ((await text(page, '.notice')) || '').includes('운영본부 010-0000-0000 으로 전화해 주세요'));
  ok('일정표의 시각은 링크가 아니다', (await page.locator('.timeline a.tel').count()) === 0);

  // ------------------------------------------------------------ 알림 시간
  section('알림은 5초, 오류는 6초');
  await page.evaluate(() => UI.toast('보통 알림'));
  await page.clock.runFor(4500);
  ok('🔴 4.5초 뒤에도 보인다', await page.evaluate(() => document.querySelector('#toast').classList.contains('show')));
  await page.clock.runFor(700);
  ok('5초가 지나면 사라진다', !(await page.evaluate(() => document.querySelector('#toast').classList.contains('show'))));
  await page.evaluate(() => UI.toast('오류 알림', 'error'));
  await page.clock.runFor(5500);
  ok('오류는 5.5초 뒤에도 보인다', await page.evaluate(() => document.querySelector('#toast').classList.contains('show')));
  await page.clock.runFor(700);
  ok('오류도 6초가 지나면 사라진다', !(await page.evaluate(() => document.querySelector('#toast').classList.contains('show'))));

  // ------------------------------------------------------------ 일지 임시저장
  section('탐험일지 — 쓰던 글을 되살린다');
  await page.click('#tabbar [data-view="journal"]');
  await page.waitForSelector('#journalForm');
  ok('처음에는 안내가 숨어 있다', await page.locator('#draftHint').isHidden());
  await page.fill('#journalForm textarea[name="text"]', '심슨기념관 계단에서 쓰는 중');
  ok('🔴 글만 써도 바로 저장', await page.evaluate(() => (JSON.parse(localStorage.getItem('plc_jd_draft:P0001') || '{}').text) === '심슨기념관 계단에서 쓰는 중'));
  await page.selectOption('#journalForm select[name="checkpoint"]', 'CP4');
  ok('입력하는 대로 기기에 저장 (사람별 키)', JSON.stringify(await DRAFT(page)) === '["plc_jd_draft:P0001"]', await DRAFT(page));

  await page.reload({ waitUntil: 'networkidle' });                // 메신저 보러 나갔다 온 경우
  await page.waitForSelector('#tabbar:not([hidden])');
  await page.click('#tabbar [data-view="journal"]');
  await page.waitForSelector('#journalForm');
  const back = await page.evaluate(() => ({ text: document.querySelector('#journalForm textarea').value, cp: document.querySelector('#journalForm select').value }));
  ok('🔴 새로 열어도 글이 남아 있다', back.text === '심슨기념관 계단에서 쓰는 중', back);
  ok('🔴 지점도 남아 있다', back.cp === 'CP4', back);
  ok('안내: 불러왔다 · 사진은 다시', !(await page.locator('#draftHint').isHidden()) &&
    ((await text(page, '#draftHint')) || '').includes('사진은 다시'));
  ok('13px 미만 글자 없음 (일지)', (await smallText(page)).length === 0, await smallText(page));

  await page.fill('#journalForm textarea[name="text"]', '');
  await page.selectOption('#journalForm select[name="checkpoint"]', '');
  ok('다 지우면 저장본도 지운다', (await DRAFT(page)).length === 0, await DRAFT(page));

  await page.fill('#journalForm textarea[name="text"]', '올릴 글');
  await page.evaluate(() => { window.__BODIES = []; const f = window.fetch; window.fetch = function (u, i) { try { window.__BODIES.push(JSON.parse(i.body)); } catch (e) { /* GET */ } return f.apply(this, arguments); }; });
  await page.click('#journalForm button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#journalForm textarea').value === '');
  ok('올리면 보낸 글은 그대로', (await bodies(page, 'journal.create'))[0].text === '올릴 글');
  ok('🔴 올리면 저장본을 지운다', (await DRAFT(page)).length === 0, await DRAFT(page));
  ok('올린 뒤 안내도 숨는다', await page.locator('#draftHint').isHidden());

  // ------------------------------------------------------------ 사진 입력 (D-059 · D-060)
  section('사진 — 촬영 버튼 없음, 갤러리 하나 (D-060)');
  const pick = await page.evaluate(() => {
    const ins = [...document.querySelectorAll('#journalForm input[type="file"]')];
    return { n: ins.length, captures: ins.filter(el => el.hasAttribute('capture')).length,
             shot: !!document.querySelector('#journalForm input[name="photoShot"]'),
             accept: ins[0] && ins[0].getAttribute('accept'), label: (document.querySelector('#journalForm .filepick') || {}).textContent,
             hint: (document.querySelector('#photoHint') || {}).textContent || '' };
  });
  ok('🔴 촬영 입력이 없다 · capture 붙은 입력 0개', !pick.shot && pick.captures === 0, pick);
  ok('🔴 파일 입력은 하나 — 갤러리', pick.n === 1 && /갤러리/.test(pick.label), pick);
  ok('갤러리는 형식을 나열한다 (와일드카드 아님 · JPEG 포함 · HEIC 제외)',
    !/\*/.test(pick.accept) && /image\/jpeg/.test(pick.accept) && !/heic/i.test(pick.accept), pick.accept);
  ok('안내: 카메라로 먼저 찍은 뒤 고르기', pick.hint.includes('카메라로 먼저 찍은 뒤'), pick.hint);
  // 회귀: 갤러리로 넣은 사진이 미리보기 → 올리기까지 간다 (1x1 PNG)
  await page.setInputFiles('#journalForm input[name="photoPick"]', { name: 'a.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
  await page.waitForSelector('#photoPreview:not([hidden])');
  ok('갤러리 사진 → 미리보기', true);
  await page.click('#photoClear');

  // ------------------------------------------------------------ 로그아웃
  section('로그아웃 — 기록은 남는다고 알리고, 쓰던 글은 지운다');
  await page.fill('#journalForm textarea[name="text"]', '기기를 넘기기 전 쓰던 글');
  await page.click('#tabbar [data-view="me"]');
  await page.click('#logoutBtn');
  await page.waitForSelector('.modal');
  ok('🔴 확인창: 기록은 그대로 남는다', ((await text(page, '.modal__msg')) || '').includes('그대로 남습니다'), await text(page, '.modal__msg'));
  await page.click('.modal [data-act="ok"]');
  await page.waitForSelector('#loginForm');
  ok('🔴 로그아웃하면 쓰던 글도 지운다 (다음 사람이 못 본다)', (await DRAFT(page)).length === 0, await DRAFT(page));
  await page.context().close();

  // ------------------------------------------------------------ 일지 수정 화면의 사진 입력 (D-060)
  section('일지 수정 — 사진 교체도 갤러리, capture 없음');
  page = await env.open({ persona: 'leader' });
  await login(page);
  await page.click('#tabbar [data-view="journal"]');
  await page.waitForSelector('#journalList .jcard [data-act="edit"]');
  await page.click('#journalList .jcard [data-act="edit"]');
  await page.waitForSelector('#journalList [data-field="photo"]', { state: 'attached' });
  const editPick = await page.evaluate(() => {
    const el = document.querySelector('#journalList [data-field="photo"]');
    return { accept: el.getAttribute('accept'), capture: el.hasAttribute('capture'),
             anyCapture: document.querySelectorAll('input[capture]').length };
  });
  ok('🔴 수정 화면 사진 입력: capture 없음 · 형식 나열', !editPick.capture && editPick.anyCapture === 0 && /image\/jpeg/.test(editPick.accept) && !/\*/.test(editPick.accept), editPick);
  await page.context().close();

  // ------------------------------------------------------------ 코스 — 저장됨
  section('코스 — "운영본부에 저장됨" 이 카드에 남는다');
  page = await env.open({ persona: 'leader' });
  await login(page);
  await page.click('#tabbar [data-view="course"]');
  await page.waitForSelector('.cp');
  const saved = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.cp')].map(c => {
    const s = c.querySelector('.cp__saved');
    return [c.getAttribute('data-code'), s ? (s.classList.contains('is-pending') ? 'pending:' : '') + s.textContent : ''];
  })));
  let sv = await saved();
  ok('🔴 완료(CP3)·도착(CP4) 카드에 "운영본부에 저장됨"', sv.CP3 === '✓ 운영본부에 저장됨' && sv.CP4 === '✓ 운영본부에 저장됨', sv);
  ok('대기 카드에는 없다', sv.CP1 === '' && sv.CP2 === '', sv);

  // 서버 응답을 붙잡아 "저장 중" 을 본다
  await page.evaluate(() => {
    const f = window.fetch; const held = [];
    window.fetch = function (u, i) {
      if (!(i && String(i.body).includes('progress.set'))) return f.apply(this, arguments);
      return new Promise(r => held.push(() => r(f.call(window, u, i))));
    };
    window.__release = () => held.splice(0).forEach(x => x());
  });
  await page.click('#cp-CP4 .cp__next');
  sv = await saved();
  ok('🔴 보내는 동안은 "저장 중"', sv.CP4.startsWith('pending:') && sv.CP4.includes('저장 중'), sv);
  await page.evaluate(() => window.__release());
  await page.waitForFunction(() => { const s = document.querySelector('#cp-CP4 .cp__saved'); return s && !s.classList.contains('is-pending'); });
  sv = await saved();
  ok('🔴 응답이 오면 "운영본부에 저장됨"', sv.CP4 === '✓ 운영본부에 저장됨', sv);
  ok('🔴 토스트가 사라져도 남는다', (await page.clock.runFor(8000), (await saved()).CP4) === '✓ 운영본부에 저장됨');

  // ------------------------------------------------------------ 글씨
  section('제목·지점명은 고딕, 본문은 크게');
  const font = await page.evaluate(() => {
    const cs = (s) => { const el = document.querySelector(s); return el ? getComputedStyle(el) : null; };
    return {
      name: cs('.cp__name').fontFamily, nameW: cs('.cp__name').fontWeight,
      head: cs('.section-head h2').fontFamily,
      mission: parseFloat(cs('.cp__mission').fontSize), desc: parseFloat(cs('.cp__desc').fontSize),
      appbar: cs('.appbar__title').fontFamily
    };
  });
  ok('🔴 지점명이 고딕 굵게', /Noto Sans KR/.test(font.name) && !/Gowun/.test(font.name) && Number(font.nameW) >= 700, font);
  ok('화면 제목도 고딕', /Noto Sans KR/.test(font.head) && !/Gowun/.test(font.head), font.head);
  ok('🔴 미션 15px · 현장설명 16px 이상', font.mission >= 15 && font.desc >= 16, font);
  ok('앱바 제목은 명조 그대로 (브랜드)', /Gowun/.test(font.appbar), font.appbar);
  ok('390px 가로 넘침 없음 (코스)', await noHScroll(page));
  ok('13px 미만 글자 없음 (코스)', (await smallText(page)).length === 0, await smallText(page));
  await page.context().close();

  // ------------------------------------------------------------ 운영 콘솔 조별 카드 (D-059)
  section('운영 콘솔 — 10조는 9조 다음 · 지점 이름 전체');
  for (const width of [1200, 390]) {
    page = await env.open({ mode: 'admin', width });
    await adminLogin(page);
    await page.click('#tabbar [data-view="progress"]');
    await page.waitForSelector('.team-card .step__name');
    const names = await page.evaluate(() => [...document.querySelectorAll('.team-card .step__name')].map(el => ({
      text: el.textContent, cut: el.scrollWidth > el.clientWidth + 1 || getComputedStyle(el).textOverflow === 'ellipsis'
    })));
    ok('🔴 지점 이름이 잘리지 않는다 @' + width, names.length > 0 && names.every(n => !n.cut), names.filter(n => n.cut));
    ok('긴 이름도 전체로 @' + width, names.some(n => n.text === '러시아 공사관과 킹스로드'));
    const row = await page.evaluate(() => {
      const li = document.querySelector('.team-card[data-team="10/31(토) 1조"] .step');
      return { no: li.querySelector('.step__no').textContent, name: li.querySelector('.step__name').textContent, state: li.querySelector('.step__state').textContent };
    });
    ok('한 줄에 번호 · 이름 · 상태와 시각 @' + width, row.no === '1' && row.name === '보구여관 터' && row.state === '완료 14:24', row);
    ok('카드 칸은 여전히 눌러 고친다 @' + width, (await page.locator('.team-card .step__btn').count()) === 20);
    ok('가로 넘침 없음 @' + width, await noHScroll(page));
    ok('13px 미만 글자 없음 @' + width, (await smallText(page)).length === 0, await smallText(page));
    if (width === 1200) {
      const order = await page.evaluate(() => {
        const t = (session, group) => ({ session, group, name: group, leaderName: '', memberCount: 1, route: [], cells: {} });
        const teams = [t('사전답사(10/17)', '10조'), t('사전답사(10/17)', '1조'), t('사전답사(10/17)', '2조'),
          t('사전답사(10/17)', '9조'), t('11/07(토)', '1조'), t('사전답사(10/17)', '운영')];
        const html = UI.teamGrid(teams, [], {}).html;
        const box = document.createElement('div'); box.innerHTML = html;
        return [...box.querySelectorAll('.team-card')].map(el => el.getAttribute('data-team'));
      });
      ok('🔴 카드 순서: 1 · 2 · 9 · 10조, 번호 없는 조는 뒤 · 회차 순서는 그대로', JSON.stringify(order) === JSON.stringify(
        ['사전답사(10/17) 1조', '사전답사(10/17) 2조', '사전답사(10/17) 9조', '사전답사(10/17) 10조', '사전답사(10/17) 운영', '11/07(토) 1조']), order);
      const same = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('.team-card strong')].map(el => el.textContent);
        const rows = [...document.querySelectorAll('.board-table tbody tr')].map(tr => tr.children[2].textContent);
        return { cards, rows };
      });
      ok('표로 보기도 카드와 같은 순서', JSON.stringify(same.cards) === JSON.stringify(same.rows), same);
    }
    await page.context().close();
  }

  section('런타임 오류');
  ok('JS 오류 없음', env.errors.length === 0, env.errors);
}).then(done, e => { console.error(e); process.exit(1); });
