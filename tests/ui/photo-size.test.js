/**
 * 탐험일지 사진을 더 크게 (D-089, 앱 v25) — 운영자 11/07 "사진 원본크기로 저장 가능한지" → 11/09 "앞으로는 더 크게".
 *   긴 변 1600·0.8 → 3000·0.9. 한 장이 PHOTO_TARGET_BYTES(2.5MB)를 넘으면 품질(0.8·0.7) → 긴 변(0.8배, 1600 까지) 순으로 낮춘다.
 *   작은 사진은 키우지 않는다. 데모 APP_CONFIG 도 실제 config.js 와 같은 값이다.
 */
const fs = require('fs');
const path = require('path');
const { ok, section, done } = require('../lib/check');
const { withBrowser, login, bodies } = require('../lib/browser');

const TARGET = 2500000;

/** 브라우저에서 그림을 만들어 UI.resizePhoto 에 넣고, 결과 JPEG 의 실제 픽셀·바이트를 돌려준다. */
const resize = (page, spec) => page.evaluate(async (s) => {
  const src = document.createElement('canvas');
  src.width = s.w; src.height = s.h;
  const ctx = src.getContext('2d');
  if (s.noise) {
    // 압축이 안 되는 최악의 사진(잎·자갈 같은 잔무늬) — 화소마다 무작위
    const img = ctx.createImageData(s.w, s.h);
    let x = 12345;
    for (let i = 0; i < img.data.length; i += 4) {
      x = (x * 1103515245 + 12345) >>> 0; img.data[i] = x & 255; img.data[i + 1] = (x >>> 8) & 255; img.data[i + 2] = (x >>> 16) & 255; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  } else {
    const g = ctx.createLinearGradient(0, 0, s.w, s.h);
    g.addColorStop(0, '#984534'); g.addColorStop(1, '#c2c2c2');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s.w, s.h);
  }
  const blob = await new Promise(r => src.toBlob(r, 'image/jpeg', 1));
  const keep = APP_CONFIG.PHOTO_TARGET_BYTES;
  if (s.target) APP_CONFIG.PHOTO_TARGET_BYTES = s.target;   // 긴 변까지 내려가는 경우를 확실히 만들 때
  let r;
  try { r = await UI.resizePhoto(new File([blob], 'x.jpg', { type: 'image/jpeg' })); } finally { APP_CONFIG.PHOTO_TARGET_BYTES = keep; }
  const out = await new Promise(res => { const im = new Image(); im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight }); im.src = r.previewUrl; });
  // 같은 크기를 품질 0.9 로 한 번에 만든 것과 견준다 — 품질을 낮추지 않았는지
  const ref = document.createElement('canvas'); ref.width = out.w; ref.height = out.h;
  const im2 = await new Promise(res => { const im = new Image(); im.onload = () => res(im); im.src = URL.createObjectURL(blob); });
  ref.getContext('2d').drawImage(im2, 0, 0, out.w, out.h);
  const ref90 = ref.toDataURL('image/jpeg', 0.9);
  return { w: out.w, h: out.h, bytes: r.approxBytes, mime: r.mimeType, at90: ref90.split(',')[1].length === r.dataBase64.length };
}, spec);

withBrowser(async (env) => {
  section('설정 — 실제 config.js 와 데모가 같은 값');
  const cfg = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'assets', 'js', 'config.js'), 'utf8');
  ok('🔴 config.js: 긴 변 3000 · 품질 0.9 · 목표 2.5MB · 사진 요청 120초',
    /PHOTO_MAX_EDGE:\s*3000\b/.test(cfg) && /PHOTO_QUALITY:\s*0\.9\b/.test(cfg) && /PHOTO_TARGET_BYTES:\s*2500000\b/.test(cfg) && /UPLOAD_TIMEOUT:\s*120000\b/.test(cfg));
  let page = await env.open({ persona: 'member' });
  const demo = await page.evaluate(() => ({ e: APP_CONFIG.PHOTO_MAX_EDGE, q: APP_CONFIG.PHOTO_QUALITY, t: APP_CONFIG.PHOTO_TARGET_BYTES }));
  ok('데모 APP_CONFIG 도 같다', demo.e === 3000 && demo.q === 0.9 && demo.t === TARGET, demo);

  section('🔴 큰 사진 → 긴 변 3000 · 품질 0.9 (D-089)');
  let r = await resize(page, { w: 4000, h: 3000 });
  ok('🔴 4000×3000 → 3000×2250 (예전 1600×1200)', r.w === 3000 && r.h === 2250, r);
  ok('   품질 0.9 그대로 (목표 아래라 낮추지 않음) · JPEG', r.at90 && r.mime === 'image/jpeg' && r.bytes <= TARGET, r);
  r = await resize(page, { w: 3000, h: 4000 });
  ok('세로 사진도 긴 변 기준 — 2250×3000', r.w === 2250 && r.h === 3000, r);

  section('🔴 잔무늬가 많아 목표를 넘으면 — 품질 → 긴 변 순으로 낮춘다');
  r = await resize(page, { w: 4000, h: 3000, noise: true });
  ok('🔴 한 장 2.5MB 이하로 (서버 한도 4MB 에 안 걸린다)', r.bytes <= TARGET, r);
  ok('   그러려고 무언가를 낮췄다 (3000px·0.9 그대로가 아니다)', !(r.w === 3000 && r.at90), r);
  // 목표를 1MB 로 낮춰 품질만으로는 안 되게 한다 — 긴 변까지 내려가야 한다(실측: 잡음 3000px·0.7 은 약 2.4MB)
  r = await resize(page, { w: 4000, h: 3000, noise: true, target: 1000000 });
  ok('🔴 품질로 안 되면 긴 변을 낮춘다 — 1600 아래로는 안 내려간다', Math.max(r.w, r.h) < 3000 && Math.max(r.w, r.h) >= 1600, r);
  ok('   1MB 이하이거나, 아니면 바닥(1600)에서 멈춘다', r.bytes <= 1000000 || Math.max(r.w, r.h) === 1600, r);
  ok('   가로세로 비율 그대로', Math.abs(r.w / r.h - 4 / 3) < 0.01, r);

  section('작은 사진은 키우지 않는다');
  r = await resize(page, { w: 800, h: 600 });
  ok('🔴 800×600 → 800×600', r.w === 800 && r.h === 600, r);

  section('일지 쓰기 — 큰 사진이 3000px 로 나간다');
  const big = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 4032; c.height = 3024;
    const g = c.getContext('2d').createLinearGradient(0, 0, 4032, 3024);
    g.addColorStop(0, '#3f7d5a'); g.addColorStop(1, '#f6f2ed');
    const ctx = c.getContext('2d'); ctx.fillStyle = g; ctx.fillRect(0, 0, 4032, 3024);
    return c.toDataURL('image/jpeg', 0.95).split(',')[1];
  });
  await login(page);
  await page.click('#tabbar [data-view="journal"]');
  await page.waitForSelector('#journalForm');
  await page.setInputFiles('#journalForm input[name="photoPick"]', [{ name: 'phone.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(big, 'base64') }]);
  await page.waitForFunction(() => document.querySelectorAll('#photoPicks .photo-pick').length === 1);
  await page.fill('#journalForm textarea[name="text"]', '큰 사진 한 장');
  await page.click('#journalForm button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#photoPicks').hidden);
  const sent = (await bodies(page, 'journal.create')).pop();
  const dim = await page.evaluate(b64 => new Promise(res => {
    const im = new Image(); im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight }); im.src = 'data:image/jpeg;base64,' + b64;
  }), sent.photos[0].dataBase64);
  ok('🔴 보낸 사진: 4032×3024 → 3000×2250', dim.w === 3000 && dim.h === 2250, dim);
  ok('   한 장 2.5MB 이하', sent.photos[0].dataBase64.length * 0.75 <= TARGET, sent.photos[0].dataBase64.length);
  await page.context().close();

  section('런타임 오류');
  ok('JS 오류 없음', env.errors.length === 0, env.errors);
}).then(done, e => { console.error(e); process.exit(1); });
