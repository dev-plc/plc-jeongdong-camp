/**
 * 거점 스태프 "내 지점" · 교역자 "진행" — 뼈대는 GAS, 칸은 사본 (D-071, 앱 v23.3).
 *   앱(api.js)을 **가짜 GAS 서버(lib/gas)에 그대로 물리고**, 서버가 사본에 민 행으로 가짜 Supabase 를 채운다.
 *   🔴 사본으로 덮은 화면 = 서버가 지금 만드는 화면 (station.board · ops.board) — 정렬·다른 회차·코스 없는 조까지.
 *   🔴 기록한 조의 사본이 그 기록보다 낡으면(푸시 실패) GAS. 조장 기록 뒤 코스도 사본에서(보낸 시각, D-071).
 */
const { loadApi } = require('../lib/app-api');
const { camp } = require('../lib/gas');
const { ok, section, done } = require('../lib/check');

const S1 = '10/31(토)', S2 = '11/07(토)';
const SUPA = { SUPABASE_URL: 'https://supa.test', SUPABASE_ANON_KEY: 'sb_publishable_TEST', MIRROR_PROGRESS_MAX_AGE: 26 * 3600e3 };

// ── 가짜 Supabase: 서버가 민 진행 행을 그대로 담는다 ────────────────────────────────
const store = new Map();          // 'session|team|checkpoint' → 행
let failPush = false;             // true 면 서버의 사본 푸시가 실패한다 (500)
let meta = null;                  // app_cache.progress_meta 의 value
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
  [S1, '나조원', '1조', '일반', '010-1000-1002', '', 'A코스(배재 시작)'],
  [S1, '다조장', '2조', '조장', '010-1000-2001', '', 'B코스(러시아 시작)'],
  [S1, '라조장', '10조', '조장', '010-1000-3001', '', 'A코스(배재 시작)'],   // 숫자 정렬: 2조 뒤
  [S1, '마조장', '3조', '조장', '010-1000-4001', '', ''],                     // 코스 없음 → 기본 순서
  [S1, '차조장', '4조', '조장', '010-1000-6001', '', 'C코스(보구여관 시작)'],
  [S2, '바조장', '1조', '조장', '010-1000-5001', '', 'A코스(배재 시작)'],     // 다른 회차 — 안 보인다
  [S1, '사스태', '', '스태프', '010-2000-0001', 'CP2', ''],
  [S1, '아교역', '', '교역자', '010-2000-0002', '', '']
]);
const staffTok = G.token('사스태', '0001');
const opsTok = G.token('아교역', '0002');
const leaderTok = G.token('가조장', '1001');
const CP2 = JSON.parse(JSON.stringify(G.get({ action: 'bootstrap' }).data.checkpoints.find(c => c.code === 'CP2')));

/** 앱 하나 — GAS 요청은 가짜 서버로, Supabase 요청은 store 로. */
function app(token, cfg) {
  const a = loadApi(Object.assign({}, SUPA, cfg || {}), (url, init) => {
    if (url === 'https://gas.test/exec') return { body: G.post(JSON.parse(init.body)) };
    // 조 하나(조장 코스) · 회차 전체(내 지점·진행) — PostgREST 처럼 걸러서 준다
    let m = /\/rest\/v1\/progress_cache\?session=eq\.([^&]+)&(?:team=eq\.([^&]+)&)?/.exec(url);
    if (m) {
      const s = decodeURIComponent(m[1]), t = m[2] ? decodeURIComponent(m[2]) : null;
      return { body: [...store.values()].filter(r => r.session === s && (t === null || r.team === t)) };
    }
    if (/\/rest\/v1\/progress_cache\?select=checkpoint&limit=1$/.test(url)) return { body: [...store.values()].slice(0, 1) };
    if (/\/rest\/v1\/app_cache\?key=eq\.progress_meta/.test(url)) return { body: meta ? [{ value: meta }] : [] };
    return { status: 404, body: '' };
  });
  a.win.localStorage.setItem('plc_jd_token', token);
  return a;
}
const gasCalls = (a) => a.calls.filter(c => c.url === 'https://gas.test/exec').map(c => c.body.action);
/** 키 순서와 무관하게 비교한다 (칸은 시트 순서·사본 순서가 다를 수 있다). */
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.keys(x).sort().reduce((o, key) => { o[key] = x[key]; return o; }, {}) : x));
/** 빈 "대기" 칸 = 없는 칸 (화면은 둘 다 대기). 사본에는 코스 전 지점이 밀리고, 시트에는 기록한 칸만 있다. */
const cellsOnly = (board) => board.teams.map(t => {
  const c = {};
  Object.keys(t.cells).forEach(k => { const x = t.cells[k]; if (x.status !== '대기' || x.arrivedAt || x.completedAt || x.score !== null) c[k] = x; });
  return Object.assign({}, t, { cells: c });
});
/** 서버의 사본 시각은 초 단위다 — 같은 조를 1초 안에 두 번 기록하면 둘째 푸시의 실패는 못 가린다(D-071). 실제 간격처럼 띄운다. */
const nextSecond = () => new Promise(r => setTimeout(r, 1100));
const serverStation = () => G.post({ action: 'station.board', token: staffTok }).data;
const serverOps = (tok) => G.post({ action: 'ops.board', token: tok || opsTok }).data;
const leaderSet = (items) => { const r = G.post({ action: 'progress.set', token: leaderTok, items }); if (!r.ok) throw new Error(JSON.stringify(r.error)); };

(async () => {
  section('사본이 꺼져 있으면 예전 그대로 (데모 포함)');
  let a = app(staffTok, { SUPABASE_URL: '' });
  let b = await a.API.stationBoard(CP2);
  ok('내 지점 = station.board 한 번', gasCalls(a).join() === 'station.board' && canon(b) === canon(serverStation()), gasCalls(a));
  a = app(opsTok, { SUPABASE_URL: '' });
  await a.API.opsBoard();
  ok('진행 = ops.board 한 번', gasCalls(a).join() === 'ops.board', gasCalls(a));

  section('🔴 첫 열기 — 뼈대(ops.board)를 GAS 에서 한 번, "내 지점" 은 서버와 같다');
  a = app(staffTok);
  b = await a.API.stationBoard(CP2);
  ok('GAS 는 ops.board 한 번', gasCalls(a).join() === 'ops.board', gasCalls(a));
  ok('🔴 서버 station.board 와 같다', canon(b) === canon(serverStation()), { mine: b, server: serverStation() });
  ok('이 지점(CP2)을 지나는 그 회차 조만 · 오는 순서 → 조 번호 순 (10조 는 숫자로)',
    b.teams.map(t => t.visitOrder + ':' + t.group).join() === '1:2조,2:1조,2:3조,2:10조,4:4조', b.teams.map(t => t.visitOrder + ':' + t.group));
  ok('다른 회차(11/07) 조는 없다', b.session === S1 && b.teams.every(t => !/바조장/.test(t.leaderName)));
  ok('지점 머리(이름·미션·퀴즈)는 bootstrap 그대로', canon(b.checkpoint) === canon({ code: CP2.code, name: CP2.name, mission: CP2.mission, quizUrl: CP2.quizUrl }));

  section('🔴 새로고침 — 칸만 사본에서, GAS 안 부름 · 결과는 서버가 지금 만드는 것과 같다');
  leaderSet([{ checkpoint: 'CP1', status: '완료' }]);                          // 1조: CP1 완료 → CP2 로 "오는 중"
  G.post({ action: 'station.set', token: staffTok, items: [{ group: '2조', status: '도착' }] });   // 다른 기기(스태프 폰 둘째)
  a.calls.length = 0;
  b = await a.API.stationBoard(CP2);
  ok('🔴 GAS 안 부름', gasCalls(a).length === 0, gasCalls(a));
  ok('🔴 서버 station.board 와 같다 (다른 기기 기록·직전 지점 완료까지)', canon(b) === canon(serverStation()), { mine: b.teams, server: serverStation().teams });
  const one = b.teams.find(t => t.group === '1조'), two = b.teams.find(t => t.group === '2조');
  ok('  └ 1조 "오는 중" (직전 CP1 완료) · 2조 도착', one.prevStatus === '완료' && one.status === '대기' && two.status === '도착' && !!two.arrivedAt, { one, two });
  a = app(opsTok);
  await a.API.opsBoard();
  a.calls.length = 0;
  const ops = await a.API.opsBoard();
  ok('🔴 진행도 새로고침은 GAS 안 부름 · 서버 ops.board 와 같다 (빈 대기 칸 = 없는 칸)',
    gasCalls(a).length === 0 && canon(cellsOnly(ops)) === canon(cellsOnly(serverOps())) &&
    canon(Object.assign({}, ops, { teams: null })) === canon(Object.assign({}, serverOps(), { teams: null })),
    { mine: cellsOnly(ops).map(t => t.cells), server: cellsOnly(serverOps()).map(t => t.cells) });

  section('🔴 스태프가 기록하면 — 응답은 서버, 다음 새로고침은 사본 (푸시가 성공했으면)');
  a = app(staffTok);
  await a.API.stationBoard(CP2);
  b = await a.API.stationSet([{ group: '1조', status: '도착' }]);
  ok('기록 응답은 서버의 "내 지점"', b.teams.find(t => t.group === '1조').status === '도착');
  a.calls.length = 0;
  b = await a.API.stationBoard(CP2);
  ok('🔴 다음 새로고침은 사본 — GAS 안 부름', gasCalls(a).length === 0 && b.teams.find(t => t.group === '1조').status === '도착', gasCalls(a));
  await nextSecond();
  failPush = true;
  await a.API.stationSet([{ group: '1조', status: '완료' }]);
  failPush = false;
  a.calls.length = 0;
  b = await a.API.stationBoard(CP2);
  ok('🔴 푸시가 실패했으면(사본이 기록보다 낡음) → GAS · 내가 누른 완료가 보인다',
    gasCalls(a).join() === 'ops.board' && b.teams.find(t => t.group === '1조').status === '완료', { gas: gasCalls(a), t: b.teams.find(t => t.group === '1조') });
  ok('  └ 서버 화면과 같다', canon(b) === canon(serverStation()));
  // 그 조가 다시 밀리면(다음 기록·정합) 사본으로 돌아온다
  G.post({ action: 'station.set', token: staffTok, items: [{ group: '1조', status: '완료' }] });
  a.calls.length = 0;
  await a.API.stationBoard(CP2);
  ok('그 조가 다시 밀리면 사본으로 돌아온다', gasCalls(a).length === 0, gasCalls(a));

  section('🔴 조장 기록 뒤 코스도 사본에서 — 기록 시각은 "보낸 시각" (D-071)');
  a = app(leaderTok);
  const me = G.post({ action: 'me', token: leaderTok }).data;
  const team = { session: me.team.session, group: me.team.group, route: me.team.route };
  await a.API.progressSet('CP2', '도착');
  a.calls.length = 0;
  let list = await a.API.progressList(team);
  ok('🔴 기록 직후 코스 = 사본 (예전엔 응답 받은 시각과 비교해 늘 GAS 였다)', gasCalls(a).length === 0 && list.find(x => x.checkpoint === 'CP2').status === '도착', gasCalls(a));
  await nextSecond();
  failPush = true;
  await a.API.progressSet('CP2', '완료');
  failPush = false;
  a.calls.length = 0;
  list = await a.API.progressList(team);
  ok('푸시가 실패했으면 → GAS (그대로)', gasCalls(a).join() === 'progress.list' && list.find(x => x.checkpoint === 'CP2').status === '완료', gasCalls(a));

  section('뼈대는 10분 — 지나면 GAS 에서 다시 (조·코스 변경 반영)');
  a = app(opsTok, { OPS_SKELETON_TTL: 40 });
  await a.API.opsBoard();
  G.addPeople([[S1, '자조장', '5조', '조장', '010-1000-7001', '', 'A코스(배재 시작)']]);
  a.calls.length = 0;
  let o = await a.API.opsBoard();
  ok('10분 안: 사본으로 덮기만 — 새 조는 아직 없다', gasCalls(a).length === 0 && !o.teams.some(t => t.group === '5조'));
  await new Promise(r => setTimeout(r, 60));
  a.calls.length = 0;
  o = await a.API.opsBoard();
  ok('10분 지나면 ops.board 를 다시 · 새 조가 보인다', gasCalls(a).join() === 'ops.board' && o.teams.some(t => t.group === '5조'), gasCalls(a));
  a.win.localStorage.setItem('plc_jd_token', staffTok);
  a.calls.length = 0;
  await a.API.opsBoard();
  ok('토큰이 바뀌면(다른 사람) 뼈대를 다시', gasCalls(a).join() === 'ops.board', gasCalls(a));

  section('사본을 못 믿으면 GAS');
  const saved = new Map(store);
  a = app(opsTok);
  await a.API.opsBoard();
  store.forEach((r, k) => store.set(k, Object.assign({}, r, { updated_at: new Date(Date.now() - 27 * 3600e3).toISOString() })));
  a.calls.length = 0;
  await a.API.opsBoard();
  ok('가장 새로운 행이 26시간 넘음 → GAS', gasCalls(a).join() === 'ops.board', gasCalls(a));
  store.clear();
  meta = { syncedAt: new Date(Date.now() - 3600e3).toISOString(), rows: 0 };
  a.calls.length = 0;
  o = await a.API.opsBoard();
  ok('회차에 기록이 0건 + 근거(동기화 0행) → 전부 대기, GAS 안 부름', gasCalls(a).length === 0 && o.teams.every(t => !Object.keys(t.cells).length), gasCalls(a));
  meta = { syncedAt: new Date(Date.now() - 3600e3).toISOString(), rows: 9 };
  a.calls.length = 0;
  await a.API.opsBoard();
  ok('🔴 0건인데 동기화는 9행 · 아무 조도 안 보임 (정책 누락 모양) → GAS', gasCalls(a).join() === 'ops.board', gasCalls(a));
  // 내가 기록했는데 회차가 통째로 비어 있다 = 그 푸시가 실패했다 (근거가 "0행" 이어도 믿지 않는다)
  store.clear();
  meta = { syncedAt: new Date(Date.now() - 3600e3).toISOString(), rows: 0 };
  a = app(staffTok);
  await a.API.stationBoard(CP2);
  failPush = true;
  await a.API.stationSet([{ group: '2조', status: '완료' }]);
  failPush = false;
  a.calls.length = 0;
  b = await a.API.stationBoard(CP2);
  ok('🔴 내가 기록했는데 회차 사본이 비었다(푸시 실패) → GAS · 누른 완료가 보인다',
    gasCalls(a).join() === 'ops.board' && b.teams.find(t => t.group === '2조').status === '완료', gasCalls(a));
  saved.forEach((v, k) => store.set(k, v));

  section('지점을 모르면 서버가 안내한다');
  a = app(staffTok);
  await a.API.stationBoard(null).then(() => {}, () => {});
  ok('bootstrap 에 없는 지점 → station.board (예전 그대로)', gasCalls(a).join() === 'station.board', gasCalls(a));
})().then(done, e => { console.error(e); process.exit(1); });
