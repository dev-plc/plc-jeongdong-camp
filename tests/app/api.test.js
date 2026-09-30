/**
 * 앱 통신 계층(api.js) — 명단 사본 경로와 **폴백** (D-055).
 * 🔴 사본이 없거나(SQL 안 돌림 404)·느리거나·못 찾으면 **반드시 GAS 로** 간다. 사본은 캐시지 원장이 아니다.
 */
const crypto = require('crypto');
const { loadApi } = require('../lib/app-api');
const { ok, section, done } = require('../lib/check');

const SUPA = { SUPABASE_URL: 'https://supa.test', SUPABASE_ANON_KEY: 'sb_publishable_TEST' };
const ME = { participant: { id: 'P0001', name: '가조장', session: '10/31(토)', group: '1조', feeStatus: '완납', role: '조장' },
  mode: 'leader', isLeader: true, isAdmin: false,
  members: [{ id: 'P0001', name: '가조장', role: '조장', feeStatus: '완납', insurance: '' },
            { id: 'P0002', name: '나조원', role: '일반', feeStatus: '미납', insurance: '가입' }] };
const GAS_LOGIN = { ok: true, data: { token: 'gas.token', expiresAt: '', me: Object.assign({}, ME, { via: 'gas' }) } };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** rpc: (fn, args) => {status, body} | {hang:true} */
function app(rpc, cfg, opt) {
  return loadApi(Object.assign({}, SUPA, cfg || {}), (url, init) => {
    const m = /\/rest\/v1\/rpc\/(\w+)$/.exec(url);
    if (m) return rpc(m[1], JSON.parse(init.body));
    const body = JSON.parse(init.body);
    if (body.action === 'auth.login') return { body: GAS_LOGIN };
    if (body.action === 'me') return { body: { ok: true, data: Object.assign({}, ME, { via: 'gas' }) } };
    if (body.action === 'fee.status') return { body: { ok: true, data: { me: { status: '미납' }, members: [], via: 'gas' } } };
    return { status: 404, body: '' };
  }, opt);
}
const gasCalls = (a) => a.calls.filter(c => c.url === 'https://gas.test/exec').map(c => c.body.action);
const rpcCalls = (a) => a.calls.filter(c => /\/rpc\//.test(c.url));

(async () => {
  section('로그인 키 = 서버 loginKeys_ 의 식');
  let a = app(() => ({ body: null }));
  ok('SHA-256(이름|4자리) hex', await a.API.loginKey('가조장', '1001') === sha('가조장|1001'));
  ok('공백·대소문자 정규화 (normalizeName_)', await a.API.loginKey('  가 조 장 ', '1001') === sha('가조장|1001') &&
    await a.API.loginKey('Kim Min', '1001') === sha('kimmin|1001'));
  ok('4자리는 숫자만', await a.API.loginKey('가조장', '1-001') === sha('가조장|1001'));
  ok('4자리가 아니면 null', await a.API.loginKey('가조장', '100') === null);
  ok('이름이 비면 null', await a.API.loginKey('  ', '1001') === null);

  section('사본으로 로그인');
  a = app((fn, args) => (fn === 'camp_login' && args.p_key === sha('가조장|1001') ? { body: { token: 'mirror.token', me: ME } } : { body: null }));
  let r = await a.API.login('', '가조장', '1001');
  ok('사본이 맞으면 GAS 를 부르지 않는다', r.token === 'mirror.token' && gasCalls(a).length === 0, gasCalls(a));
  ok('토큰을 저장한다', a.win.localStorage.getItem('plc_jd_token') === 'mirror.token');
  ok('🔴 보낸 것은 키뿐 (이름·뒷자리 원문 없음)', JSON.stringify(rpcCalls(a)[0].body) === JSON.stringify({ p_key: sha('가조장|1001') }));
  ok('publishable 키는 apikey 로만 (Bearer 없음)', rpcCalls(a)[0].init.headers.apikey === 'sb_publishable_TEST' && !rpcCalls(a)[0].init.headers.Authorization);
  ok('perf 에 auth.login:supabase', a.API.perf.list().some(p => p.a === 'auth.login:supabase' && p.ok));

  section('🔴 폴백 — 사본이 안 되면 GAS');
  const cases = [
    ['못 찾음 (null)', () => ({ body: null })],
    ['SQL 을 아직 안 돌림 (404)', () => ({ status: 404, body: { message: 'function not found' } })],
    ['오류 (500)', () => ({ status: 500, body: 'x' })],
    ['모양이 틀림 (me 없음)', () => ({ body: { token: 't' } })],
    ['응답이 없음 → 시간 초과', () => ({ hang: true })]
  ];
  for (const [name, rpc] of cases) {
    a = app(rpc);
    const t0 = Date.now();
    r = await a.API.login('', '가조장', '1001');
    ok(name + ' → GAS 로그인', r.me.via === 'gas' && gasCalls(a).join() === 'auth.login', gasCalls(a));
    if (/시간 초과/.test(name)) ok('  └ MIRROR_TIMEOUT 에서 끊는다', Date.now() - t0 < 2000, Date.now() - t0);
  }
  a = app(() => { throw new Error('부르면 안 됨'); }, { SUPABASE_URL: '' });
  r = await a.API.login('', '가조장', '1001');
  ok('사본 설정이 없으면 바로 GAS (함수 안 부름)', r.me.via === 'gas' && rpcCalls(a).length === 0);
  a = app(() => ({ body: { token: 'm', me: ME } }), {}, { crypto: false });
  r = await a.API.login('', '가조장', '1001');
  ok('WebCrypto 없는 옛 브라우저 → GAS', r.me.via === 'gas' && rpcCalls(a).length === 0);
  a = app(() => ({ body: null }));
  await a.API.login('', '가조장', '12').catch(e => e);
  ok('4자리가 아니면 사본을 건너뛰고 GAS 가 말한다', rpcCalls(a).length === 0 && gasCalls(a).join() === 'auth.login');

  section('내 정보 · 회비');
  a = app((fn, args) => (fn === 'camp_me' && args.p_token === 'mirror.token' ? { body: ME } : { body: null }));
  a.win.localStorage.setItem('plc_jd_token', 'mirror.token');
  r = await a.API.me();
  ok('사본 토큰 → camp_me', r.participant.id === 'P0001' && !r.via && gasCalls(a).length === 0);
  const fee = await a.API.feeStatus();
  ok('회비 = fee.status 모양 (조장은 조원까지)', JSON.stringify(fee) === JSON.stringify({
    me: { status: '완납' }, members: [{ id: 'P0001', name: '가조장', status: '완납' }, { id: 'P0002', name: '나조원', status: '미납' }] }), fee);
  ok('🔴 조원 보험·역할은 회비에 싣지 않는다', !JSON.stringify(fee).includes('insurance') && !JSON.stringify(fee).includes('role'));
  a.win.localStorage.setItem('plc_jd_token', 'gas.token');
  a.calls.length = 0;
  r = await a.API.me();
  ok('GAS 토큰(사본에 없음) → GAS me', r.via === 'gas' && gasCalls(a).join() === 'me');
  r = await a.API.feeStatus();
  ok('  └ 회비도 GAS', r.via === 'gas');
  a = app(() => ({ body: Object.assign({}, ME, { isLeader: false, members: [] }) }));
  a.win.localStorage.setItem('plc_jd_token', 'mirror.token');
  ok('조원은 본인 것만', JSON.stringify(await a.API.feeStatus()) === JSON.stringify({ me: { status: '완납' }, members: [] }));
})().then(done, e => { console.error(e); process.exit(1); });
