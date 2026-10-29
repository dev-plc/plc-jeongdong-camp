/**
 * 코스(진행) 사본 읽기 — 기록 0건인 조 (D-070, 앱 v23.2).
 *   사본에 그 조의 행이 없으면 예전엔 바로 GAS 로 갔다(캠프 전에는 모든 조가 0건 → 코스 탭이 늘 2~4초).
 *   이제 **동기화가 신선하고 표를 실제로 읽을 수 있을 때만** "전부 대기" 를 사본에서 만든다. 아니면 GAS.
 *   🔴 정책(RLS) 누락도 빈 배열이다 — 그때 "대기" 를 보여 주면 기록한 조가 기록을 잃은 것처럼 본다.
 */
const { loadApi } = require('../lib/app-api');
const { camp } = require('../lib/gas');
const { ok, section, done } = require('../lib/check');

const SUPA = { SUPABASE_URL: 'https://supa.test', SUPABASE_ANON_KEY: 'sb_publishable_TEST', MIRROR_PROGRESS_MAX_AGE: 26 * 3600e3 };
const TEAM = { session: '10/31(토)', group: '1조', route: ['CP3', 'CP4', 'CP1', 'CP2'] };
const H = 3600e3;
const iso = (agoMs) => new Date(Date.now() - agoMs).toISOString();
const GAS_LIST = TEAM.route.map((c, i) => ({ checkpoint: c, visitOrder: i + 1, status: '대기', arrivedAt: '', completedAt: '', score: null, memo: '', via: 'gas' }));

/**
 * s.team: 이 조의 행 · s.meta: progress_meta 의 value (null 이면 키 없음) · s.probe: 아무 조 1행
 * 값 대신 { status } 를 주면 그 응답 코드로 실패한다.
 */
function app(s) {
  return loadApi(SUPA, (url, init) => {
    const reply = (v) => (v && v.status ? { status: v.status, body: '' } : { body: v });
    if (/\/rest\/v1\/progress_cache\?session=/.test(url)) return reply(s.team || []);
    if (/\/rest\/v1\/app_cache\?key=eq\.progress_meta/.test(url)) return s.meta && s.meta.status ? reply(s.meta) : { body: s.meta ? [{ value: s.meta }] : [] };
    if (/\/rest\/v1\/progress_cache\?select=checkpoint&limit=1$/.test(url)) return reply(s.probe || []);
    const body = JSON.parse(init.body);
    if (body.action === 'progress.list') return { body: { ok: true, data: GAS_LIST } };
    if (body.action === 'progress.set') return { body: { ok: true, data: GAS_LIST } };
    return { status: 404, body: '' };
  });
}
const gasCalls = (a) => a.calls.filter(c => c.url === 'https://gas.test/exec').map(c => c.body.action);
const supaCalls = (a) => a.calls.filter(c => /supa\.test/.test(c.url)).map(c => c.url.replace('https://supa.test/rest/v1/', ''));
const fromMirror = (list) => Array.isArray(list) && list.every(x => !x.via);
const allWaiting = (list) => fromMirror(list) && list.map(x => x.checkpoint).join() === TEAM.route.join() &&
  list.every((x, i) => x.visitOrder === i + 1 && x.status === '대기' && x.arrivedAt === '' && x.completedAt === '' && x.score === null && x.memo === '');

(async () => {
  section('🔴 기록 0건인 조 — 근거가 맞으면 사본에서 "전부 대기"');
  let a = app({ team: [], meta: { syncedAt: iso(H), rows: 0 }, probe: [] });
  let r = await a.API.progressList(TEAM);
  ok('🔴 동기화 신선 + 마지막 동기화 0행 → 전부 대기, GAS 안 부름 (캠프 전 지금)', allWaiting(r) && gasCalls(a).length === 0, { r, gas: gasCalls(a) });
  ok('코스 순서·번호 그대로', r.map(x => x.checkpoint + x.visitOrder).join() === 'CP31,CP42,CP13,CP24', r);
  a = app({ team: [], meta: { syncedAt: iso(H), rows: 7 }, probe: [{ checkpoint: 'CP1' }] });
  r = await a.API.progressList(TEAM);
  ok('🔴 다른 조는 기록했고 이 조만 0건 (당일 첫 기록 전) → 전부 대기', allWaiting(r) && gasCalls(a).length === 0, gasCalls(a));
  ok('근거 둘은 같이 묻는다 (meta · 아무 조 1행)', supaCalls(a).length === 3 &&
    supaCalls(a).some(u => /^app_cache\?key=eq\.progress_meta/.test(u)) && supaCalls(a).some(u => /limit=1$/.test(u)), supaCalls(a));

  section('🔴 근거가 하나라도 빠지면 GAS');
  a = app({ team: [], meta: { syncedAt: iso(H), rows: 7 }, probe: [] });
  r = await a.API.progressList(TEAM);
  ok('🔴 동기화는 7행이라는데 아무 조도 안 보인다 (정책 누락 모양) → GAS', r[0].via === 'gas' && gasCalls(a).join() === 'progress.list', gasCalls(a));
  a = app({ team: [], meta: { syncedAt: iso(27 * H), rows: 0 }, probe: [] });
  ok('동기화가 26시간 넘게 멈췄다 → GAS', (await a.API.progressList(TEAM))[0].via === 'gas');
  a = app({ team: [], meta: { syncedAt: iso(-H), rows: 0 }, probe: [] });
  ok('동기화 시각이 미래 (시계 이상) → GAS', (await a.API.progressList(TEAM))[0].via === 'gas');
  a = app({ team: [], meta: { syncedAt: 'not-a-date', rows: 0 }, probe: [] });
  ok('동기화 시각이 깨졌다 → GAS', (await a.API.progressList(TEAM))[0].via === 'gas');
  a = app({ team: [], meta: null, probe: [{ checkpoint: 'CP1' }] });
  ok('progress_meta 가 없다 (동기화가 한 번도 안 돎) → GAS', (await a.API.progressList(TEAM))[0].via === 'gas');
  a = app({ team: [], meta: { syncedAt: iso(H) }, probe: [] });
  ok('행 수가 없는 옛 meta + 아무 조도 안 보임 → GAS', (await a.API.progressList(TEAM))[0].via === 'gas');
  a = app({ team: [], meta: { status: 500 }, probe: [{ checkpoint: 'CP1' }] });
  ok('meta 읽기 실패 → GAS', (await a.API.progressList(TEAM))[0].via === 'gas');
  a = app({ team: [], meta: { syncedAt: iso(H), rows: 0 }, probe: { status: 401 } });
  ok('표 읽기 실패 (401) → GAS', (await a.API.progressList(TEAM))[0].via === 'gas');

  section('🔴 이 기기가 기록한 뒤 비어 있으면 = 사본 푸시 실패 → GAS');
  a = app({ team: [], meta: { syncedAt: iso(H), rows: 0 }, probe: [] });
  await a.API.progressSet('CP3', '도착');
  a.calls.length = 0;
  r = await a.API.progressList(TEAM);
  ok('기록한 기기 → GAS (근거를 묻지도 않는다)', r[0].via === 'gas' && supaCalls(a).length === 1, supaCalls(a));

  section('기록이 있는 조 — 예전 그대로');
  a = app({ team: [{ checkpoint: 'CP3', status: '완료', arrived_at: '2026-10-31T05:00:00Z', completed_at: '2026-10-31T05:20:00Z', score: null, memo: '', updated_at: iso(H) }] });
  r = await a.API.progressList(TEAM);
  ok('행이 있으면 그 행 + 나머지 대기, 근거는 묻지 않는다', fromMirror(r) && r[0].status === '완료' && r.slice(1).every(x => x.status === '대기') &&
    supaCalls(a).length === 1 && gasCalls(a).length === 0, { r, supa: supaCalls(a) });
  a = app({ team: [{ checkpoint: 'CP3', status: '완료', arrived_at: '', completed_at: '', score: null, memo: '', updated_at: iso(27 * H) }] });
  ok('행이 낡았으면 GAS (그대로)', (await a.API.progressList(TEAM))[0].via === 'gas');

  section('🔴 사본의 "전부 대기" = 서버 progress.list (같은 모양)');
  const G = camp();
  G.addPeople([[TEAM.session, '가조장', TEAM.group, '조장', '010-1000-1001', '', '']]);
  const tok = G.token('가조장', '1001');
  const me = G.post({ action: 'me', token: tok }).data;
  const server = G.post({ action: 'progress.list', token: tok });
  a = app({ team: [], meta: { syncedAt: iso(H), rows: 0 }, probe: [] });
  const mirrored = await a.API.progressList({ session: me.team.session, group: me.team.group, route: me.team.route });
  // scoreSource 는 사본에 없는 칸이다 (서버 progressListFor_ 주석) — 빈 칸이면 화면에서 같다
  const strip = (list) => JSON.stringify(list.map(x => { const y = Object.assign({}, x); delete y.scoreSource; return y; }));
  ok('서버가 기록 0건 조에 주는 목록과 같다 (scoreSource 빼고)', server.ok && strip(server.data) === strip(mirrored), { server: server.data, mirrored });
  ok('  └ 서버의 scoreSource 는 빈 칸', server.data.every(x => x.scoreSource === ''));
})().then(done, e => { console.error(e); process.exit(1); });
