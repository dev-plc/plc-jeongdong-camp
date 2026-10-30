/**
 * 운영 콘솔 진행·시상 — 뼈대는 GAS, 칸은 사본 (D-072, 앱 v23.4). 토큰 읽기.
 *   앱(api.js)을 **가짜 GAS 서버(lib/gas)에 그대로 물리고**, 서버가 사본에 민 행으로 가짜 Supabase 를 채운다.
 *   🔴 사본으로 덮은 진행 = 서버 admin.progress.board (전 회차). 같은 "1조" 라도 회차가 다르면 다른 조다.
 */
const { loadApi } = require('../lib/app-api');
const { camp } = require('../lib/gas');
const { ok, section, done } = require('../lib/check');

const S1 = '10/31(토)', S2 = '11/07(토)';
const SUPA = { SUPABASE_URL: 'https://supa.test', SUPABASE_ANON_KEY: 'sb_publishable_TEST', MIRROR_PROGRESS_MAX_AGE: 26 * 3600e3 };

// ── 가짜 Supabase: 서버가 민 진행 행을 그대로 담는다 ────────────────────────────────
const store = new Map();
let failPush = false;
let meta = null;
const G = camp({
  props: { SUPABASE_URL: 'https://mirror.test', SUPABASE_SERVICE_KEY: 'sb_secret_TEST_ONLY' },
  fetch: (url, o) => {
    if (!/\/rest\/v1\/progress_cache/.test(url) || (o && o.method) !== 'post') return null;
    if (failPush) return { code: 500, body: 'boom' };
    JSON.parse(o.payload).forEach(r => store.set(r.session + '|' + r.team + '|' + r.checkpoint, r));
    return { code: 201, body: '[]' };
  }
});
// [참여 일자, 이름, 조, 역할, 연락처, 담당 지점, 코스]
G.addPeople([
  [S1, '가조장', '1조', '조장', '010-1000-1001', '', 'A코스(배재 시작)'],
  [S1, '다조장', '2조', '조장', '010-1000-2001', '', 'B코스(러시아 시작)'],
  [S1, '라조장', '10조', '조장', '010-1000-3001', '', 'A코스(배재 시작)'],
  [S2, '바조장', '1조', '조장', '010-1000-5001', '', 'C코스(보구여관 시작)', '장년부'],   // 같은 "1조" · 다른 회차
  [S2, '사조장', '2조', '조장', '010-1000-6001', '', '', '장년부'],
  [S1, '아스태', '', '스태프', '010-2000-0001', 'CP2', '']
]);
const adminTok = G.adminToken();
const s1Leader = G.token('가조장', '1001');
const staffTok = G.token('아스태', '0001');
// 11/07 조의 기록은 운영 콘솔 정정(adminSet)으로 만든다 — 다른 기기에서 고친 것과 같다

function app(token, cfg, opt) {
  const a = loadApi(Object.assign({}, SUPA, cfg || {}), (url, init) => {
    if (url === 'https://gas.test/exec') return { body: G.post(JSON.parse(init.body)) };
    let m = /\/rest\/v1\/progress_cache\?(?:session=eq\.([^&]+)&)?(?:team=eq\.([^&]+)&)?select=/.exec(url);
    if (m) {
      const s = m[1] ? decodeURIComponent(m[1]) : null, t = m[2] ? decodeURIComponent(m[2]) : null;
      return { body: [...store.values()].filter(r => (s === null || r.session === s) && (t === null || r.team === t)) };
    }
    if (/\/rest\/v1\/progress_cache\?select=checkpoint&limit=1$/.test(url)) return { body: [...store.values()].slice(0, 1) };
    if (/\/rest\/v1\/app_cache\?key=eq\.progress_meta/.test(url)) return { body: meta ? [{ value: meta }] : [] };
    return { status: 404, body: '' };
  }, opt);
  a.win.localStorage.setItem('plc_jd_token', token);
  return a;
}
const gasCalls = (a) => a.calls.filter(c => c.url === 'https://gas.test/exec').map(c => c.body.action);
const supaCalls = (a) => a.calls.filter(c => /supa\.test/.test(c.url)).map(c => c.url.replace('https://supa.test/rest/v1/', ''));
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.keys(x).sort().reduce((o, key) => { o[key] = x[key]; return o; }, {}) : x));
/** 빈 "대기" 칸 = 없는 칸 (화면은 둘 다 대기). 사본에는 코스 전 지점이 밀리고, 시트에는 기록한 칸만 있다. */
const cellsOnly = (board) => board.teams.map(t => {
  const c = {};
  Object.keys(t.cells).forEach(k => { const x = t.cells[k]; if (x.status !== '대기' || x.arrivedAt || x.completedAt || x.score !== null) c[k] = x; });
  return Object.assign({}, t, { cells: c });
});
const sameAsServer = (b) => {
  const srv = G.post({ action: 'admin.progress.board', token: adminTok }).data;
  return canon(cellsOnly(b)) === canon(cellsOnly(srv)) && canon(b.checkpoints) === canon(srv.checkpoints);
};
const nextSecond = () => new Promise(r => setTimeout(r, 1100));
const cellOf = (b, session, group, code) => ((b.teams.find(t => t.session === session && t.group === group) || {}).cells || {})[code] || {};
const adminSet = (p) => { const r = G.post(Object.assign({ action: 'admin.progress.set', token: adminTok }, p)); if (!r.ok) throw new Error(JSON.stringify(r.error)); };

(async () => {
  section('사본이 꺼져 있으면 예전 그대로 (데모 포함)');
  let a = app(adminTok, { SUPABASE_URL: '' });
  let b = await a.API.adminProgressBoard();
  ok('admin.progress.board 한 번', gasCalls(a).join() === 'admin.progress.board' && sameAsServer(b), gasCalls(a));

  section('🔴 첫 열기는 GAS 한 번, 다시 열면 칸만 사본에서 — 전 회차');
  a = app(adminTok);
  b = await a.API.adminProgressBoard();
  ok('첫 열기 = admin.progress.board (뼈대)', gasCalls(a).join() === 'admin.progress.board', gasCalls(a));
  G.post({ action: 'progress.set', token: s1Leader, items: [{ checkpoint: 'CP1', status: '완료' }] });          // 10/31 1조
  G.post({ action: 'station.set', token: staffTok, items: [{ group: '2조', status: '도착' }] });              // 10/31 2조
  adminSet({ session: S2, group: '1조', checkpoint: 'CP3', status: '도착' });                                 // 11/07 1조
  a.calls.length = 0;
  b = await a.API.adminProgressBoard();
  ok('🔴 다시 열기는 GAS 0번 · 사본 한 번(전 회차)', gasCalls(a).length === 0 && supaCalls(a).length === 1 && !/session=eq/.test(supaCalls(a)[0]), { gas: gasCalls(a), supa: supaCalls(a) });
  ok('🔴 서버 admin.progress.board 와 같다 (빈 대기 칸 = 없는 칸)', sameAsServer(b), cellsOnly(b).map(t => t.session + t.group + JSON.stringify(t.cells)));
  ok('🔴 같은 "1조" 라도 회차마다 따로 — 10/31 은 CP1 완료, 11/07 은 CP3 도착',
    cellOf(b, S1, '1조', 'CP1').status === '완료' && !cellOf(b, S1, '1조', 'CP3').arrivedAt &&
    cellOf(b, S2, '1조', 'CP3').status === '도착' && !cellOf(b, S2, '1조', 'CP1').completedAt, b.teams.filter(t => t.group === '1조'));

  section('🔴 칸 정정 — 응답은 서버, 다음 열기는 사본 (푸시가 성공했으면)');
  b = await a.API.adminProgressSet({ session: S1, group: '10조', checkpoint: 'CP1', status: '도착' });
  ok('정정 응답은 서버의 전 회차 진행', cellOf(b, S1, '10조', 'CP1').status === '도착');
  a.calls.length = 0;
  b = await a.API.adminProgressBoard();
  ok('🔴 다음 열기는 사본 — GAS 안 부름', gasCalls(a).length === 0 && cellOf(b, S1, '10조', 'CP1').status === '도착', gasCalls(a));
  await nextSecond();
  failPush = true;
  await a.API.adminProgressSet({ session: S2, group: '1조', checkpoint: 'CP3', status: '완료' });
  failPush = false;
  // 그 뒤 **다른 회차의 같은 "1조"** 가 새로 밀린다 — 조 이름만으로 보면 "1조는 새롭다" 로 속는다
  G.post({ action: 'progress.set', token: s1Leader, items: [{ checkpoint: 'CP2', status: '도착' }] });
  a.calls.length = 0;
  b = await a.API.adminProgressBoard();
  ok('🔴 11/07 1조 푸시가 실패 → GAS · 고친 완료가 보인다 (10/31 1조가 새로 밀려도 속지 않는다)',
    gasCalls(a).join() === 'admin.progress.board' && cellOf(b, S2, '1조', 'CP3').status === '완료', { gas: gasCalls(a), cell: cellOf(b, S2, '1조', 'CP3') });
  adminSet({ session: S2, group: '1조', checkpoint: 'CP3', status: '완료' });   // 다시 밀린다
  a.calls.length = 0;
  await a.API.adminProgressBoard();
  ok('그 조가 다시 밀리면 사본으로 돌아온다', gasCalls(a).length === 0, gasCalls(a));

  section('뼈대는 10분 · 토큰이 바뀌면 다시');
  a = app(adminTok, { OPS_SKELETON_TTL: 40 });
  await a.API.adminProgressBoard();
  G.addPeople([[S1, '자조장', '5조', '조장', '010-1000-7001', '', 'A코스(배재 시작)']]);
  a.calls.length = 0;
  let o = await a.API.adminProgressBoard();
  ok('10분 안: 새 조는 아직 없다 (사본으로 덮기만)', gasCalls(a).length === 0 && !o.teams.some(t => t.group === '5조'));
  await new Promise(r => setTimeout(r, 60));
  a.calls.length = 0;
  o = await a.API.adminProgressBoard();
  ok('10분 지나면 다시 · 새 조가 보인다', gasCalls(a).join() === 'admin.progress.board' && o.teams.some(t => t.group === '5조'), gasCalls(a));
  a.win.localStorage.setItem('plc_jd_token', G.adminToken() + 'x');
  a.calls.length = 0;
  await a.API.adminProgressBoard().then(() => {}, () => {});
  ok('토큰이 바뀌면 뼈대를 다시 (GAS 가 판단)', gasCalls(a).join() === 'admin.progress.board', gasCalls(a));
  a = app(adminTok);
  await a.API.adminProgressBoard();
  a.API.logout();
  a.win.localStorage.setItem('plc_jd_token', adminTok);
  a.calls.length = 0;
  await a.API.adminProgressBoard();
  ok('로그아웃하면 뼈대를 버린다', gasCalls(a).join() === 'admin.progress.board', gasCalls(a));

  section('사본을 못 믿으면 GAS');
  const saved = new Map(store);
  a = app(adminTok);
  await a.API.adminProgressBoard();
  store.forEach((r, k) => store.set(k, Object.assign({}, r, { updated_at: new Date(Date.now() - 27 * 3600e3).toISOString() })));
  a.calls.length = 0;
  await a.API.adminProgressBoard();
  ok('가장 새로운 행이 26시간 넘음 → GAS', gasCalls(a).join() === 'admin.progress.board', gasCalls(a));
  store.clear();
  meta = { syncedAt: new Date(Date.now() - 3600e3).toISOString(), rows: 0 };
  a.calls.length = 0;
  o = await a.API.adminProgressBoard();
  ok('기록이 0건 + 근거(동기화 0행) → 전부 대기, GAS 안 부름', gasCalls(a).length === 0 && o.teams.every(t => !Object.keys(t.cells).length), gasCalls(a));
  meta = { syncedAt: new Date(Date.now() - 3600e3).toISOString(), rows: 9 };
  a.calls.length = 0;
  await a.API.adminProgressBoard();
  ok('🔴 0건인데 동기화는 9행 · 아무 조도 안 보임 (정책 누락 모양) → GAS', gasCalls(a).join() === 'admin.progress.board', gasCalls(a));
  saved.forEach((v, k) => store.set(k, v));

  section('토큰 읽기 (서명은 검증하지 않는다 — 화면을 먼저 그릴지만 정한다)');
  a = app(adminTok);
  let c = a.API.tokenClaims();
  ok('관리자 토큰 → pid ADMIN · 만료 전', c && c.pid === 'ADMIN' && c.exp > Date.now(), c);
  a.win.localStorage.setItem('plc_jd_token', s1Leader);
  c = a.API.tokenClaims();
  ok('참가자 토큰 → 참가자 pid (관리자가 아니다)', c && c.pid !== 'ADMIN' && /^P\d+/.test(c.pid), c);
  const fake = (claims) => Buffer.from(JSON.stringify(claims)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.sig';
  a.win.localStorage.setItem('plc_jd_token', fake({ pid: 'ADMIN', exp: Date.now() - 1000 }));
  c = a.API.tokenClaims();
  ok('만료된 토큰도 읽는다 (만료 판단은 부르는 쪽)', c && c.exp < Date.now());
  ok('패딩 없는 base64 도 읽는다', a.API.tokenClaims().pid === 'ADMIN');
  const websafe = fake({ pid: 'ADMIN', exp: Date.now() + 1000, x: '???>>>' });
  a.win.localStorage.setItem('plc_jd_token', websafe);
  ok('웹 안전 글자(- _)가 든 토큰도 읽는다 (서버 base64EncodeWebSafe)', /[-_]/.test(websafe.split('.')[0]) && (a.API.tokenClaims() || {}).pid === 'ADMIN', websafe);
  for (const bad of ['', 'abc', 'a.b.c', '!!!.sig', fake({ pid: 1, exp: 'x' })]) {
    a.win.localStorage.setItem('plc_jd_token', bad);
    ok('읽을 수 없는 토큰 → null: ' + JSON.stringify(bad.slice(0, 12)), a.API.tokenClaims() === null);
  }
  a = app(adminTok, {}, { atob: false });
  ok('atob 이 없는 환경 → null (예전처럼 서버에 묻는다)', a.API.tokenClaims() === null);
})().then(done, e => { console.error(e); process.exit(1); });
