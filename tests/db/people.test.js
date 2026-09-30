/**
 * 명단 사본 SQL (D-055) — `docs-dev/ops/supabase-people.sql` 을 **그대로** 로컬 Postgres 에 적용해 본다.
 *
 *   권한: anon 은 표를 못 읽고 함수로만 · 함수: 맞는 키 한 사람 → {token, me}, 아니면 null · 30분 넘은 행 무시
 *   🔴 끝-끝: GAS 모의 환경이 올린 행 → 앱 api.js 의 API.login (fetch 를 Postgres·GAS 모의로 연결) → 받은 토큰으로 GAS me
 *
 * Postgres 가 없으면 건너뜀.
 */
const fs = require('fs');
const path = require('path');
const { find, start } = require('../lib/pg');
const { camp } = require('../lib/gas');
const { loadApi } = require('../lib/app-api');
const { ok, section, done } = require('../lib/check');

const env = find();
if (!env) {
  console.log('\n⚠ 건너뜀: 로컬 Postgres 를 찾지 못했습니다 (/usr/lib/postgresql/*/bin). DB 스위트는 돌지 않았습니다.');
  console.log('\nSKIPPED');
  process.exit(0);
}

const SQL = fs.readFileSync(path.join(__dirname, '..', '..', 'docs-dev', 'ops', 'supabase-people.sql'), 'utf8');
const S1 = '10/31(토)';
const PROPS = { SUPABASE_URL: 'https://mirror.test', SUPABASE_SERVICE_KEY: 'sb_secret_TEST_ONLY' };

const pg = start(env);
process.on('exit', () => pg.stop());

(async () => {
  // ---------------------------------------------------------------- 설치
  section('SQL 적용');
  let r = pg.sql(SQL);
  ok('파일이 오류 없이 돈다', r.ok, r.err);
  r = pg.sql(SQL);
  ok('두 번 돌려도 된다 (운영자가 다시 눌러도)', r.ok, r.err);

  // ---------------------------------------------------------------- GAS 가 올린 행을 그대로
  const G = camp({ props: PROPS });
  G.addPeople([
    [S1, '가조장', '1조', '조장', '010-1000-1001', '', 'A코스(배재 시작)'],
    [S1, '나조원', '1조', '일반', '010-1000-1002', '', 'A코스(배재 시작)'],
    [S1, '홍길동 1234', '2조', '일반', '010-1000-9999', '', 'B코스(러시아 시작)'],
    [S1, '같은이', '2조', '일반', '010-1000-5555', '', 'B코스(러시아 시작)'],
    [S1, '같은이', '3조', '일반', '010-1000-5555', '', 'C코스(보구여관 시작)'],
    ['', '라교역', '', '교역자', '010-2000-0002', '', '']
  ]);
  G.fresh(); G.run('installCampSync()');
  const post = G.FETCH.filter(f => /people_cache/.test(f.url) && f.method === 'post').pop();
  const rows = JSON.parse(post.payload);

  section('GAS 가 보내는 행 = 표의 칸');
  const cols = pg.sql(`select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_name = 'people_cache'`).out;
  ok('칸 이름이 정확히 같다 (PostgREST 는 모르는 칸이면 거절한다)', Object.keys(rows[0]).sort().join() === cols, { gas: Object.keys(rows[0]).sort().join(), db: cols });
  // service_role 로 넣는다 — GAS 의 upsert 와 같은 역할
  r = pg.sql(`insert into people_cache select * from jsonb_populate_recordset(null::people_cache, :'rows'::jsonb)
              on conflict (pid) do update set me = excluded.me, keys = excluded.keys, token = excluded.token,
              token_prev = excluded.token_prev, updated_at = excluded.updated_at`,
  { role: 'service_role', vars: { rows: JSON.stringify(rows) } });
  ok('service_role 이 넣는다', r.ok, r.err);
  ok('다섯 명 (공란 교역자 없음)', pg.sql('select count(*) from people_cache').out === '5');

  // ---------------------------------------------------------------- 권한
  section('🔴 권한 — anon 은 표를 못 읽는다');
  r = pg.sql('select * from people_cache', { role: 'anon' });
  ok('anon SELECT 거절', !r.ok && /permission denied/.test(r.err), r);
  r = pg.sql("insert into people_cache(pid, session, me, token, token_prev) values ('X','x','{}','t','t')", { role: 'anon' });
  ok('anon INSERT 거절', !r.ok && /permission denied/.test(r.err), r);
  r = pg.sql("delete from people_cache", { role: 'anon' });
  ok('anon DELETE 거절', !r.ok && /permission denied/.test(r.err), r);
  r = pg.sql('select * from people_cache', { role: 'authenticated' });
  ok('authenticated 도 거절', !r.ok, r);
  r = pg.sql("select camp_login('x')", { role: 'authenticated' });
  ok('함수는 anon 에게만 (authenticated 실행 거절)', !r.ok && /permission denied/.test(r.err), r);

  // ---------------------------------------------------------------- 함수
  section('camp_login · camp_me');
  const { API } = loadApi({}, () => ({ status: 500 }));
  const k = await API.loginKey('가조장', '1001');
  r = pg.sql("select camp_login(:'k')", { role: 'anon', vars: { k } });
  const hit = JSON.parse(r.out || 'null');
  ok('맞는 키 → 토큰·내 정보', r.ok && hit && hit.token && hit.me.participant.name === '가조장', r);
  ok('틀린 키 → null', pg.sql("select camp_login(:'k')", { role: 'anon', vars: { k: await API.loginKey('가조장', '1000') } }).out === '');
  ok('짧은 문자열 → null', pg.sql("select camp_login('abc')", { role: 'anon' }).out === '');
  r = pg.sql("select camp_login(:'k')", { role: 'anon', vars: { k: await API.loginKey('같은이', '5555') } });
  ok('🔴 겹친 이름·번호 → null (GAS 로)', r.ok && r.out === '', r);
  ok('이름 끝 4자리로도', !!JSON.parse(pg.sql("select camp_login(:'k')", { role: 'anon', vars: { k: await API.loginKey('홍 길동', '1234') } }).out || 'null'));
  const ga = rows.find(x => x.me.participant.name === '가조장');
  ok('camp_me(오늘 토큰)', JSON.parse(pg.sql("select camp_me(:'t')", { role: 'anon', vars: { t: ga.token } }).out || 'null').participant.id === ga.pid);
  ok('camp_me(어제 토큰)', JSON.parse(pg.sql("select camp_me(:'t')", { role: 'anon', vars: { t: ga.token_prev } }).out || 'null').participant.id === ga.pid);
  ok('모르는 토큰 → null', pg.sql("select camp_me(:'t')", { role: 'anon', vars: { t: ga.token.slice(0, -2) + 'xx' } }).out === '');
  ok('빈 토큰 → null', pg.sql("select camp_me('')", { role: 'anon' }).out === '');
  ok('🔴 키 하나가 두 행에 있으면 (GAS 가 못 걸렀어도) null', (() => {
    const u = pg.sql(`update people_cache set keys = array_append(keys, :'k') where me->'participant'->>'name' = '나조원'`, { vars: { k } });
    if (!u.ok) throw new Error(u.err);
    const x = pg.sql("select camp_login(:'k')", { role: 'anon', vars: { k } });
    pg.sql(`update people_cache set keys = array_remove(keys, :'k') where me->'participant'->>'name' = '나조원'`, { vars: { k } });
    return x.ok && x.out === '';          // 오류가 아니라 null 이어야 한다
  })());

  section('🔴 30분 넘게 안 갱신된 행은 쓰지 않는다');
  pg.sql("update people_cache set updated_at = now() - interval '31 minutes' where pid = :'p'", { vars: { p: ga.pid } });
  ok('로그인 → null', pg.sql("select camp_login(:'k')", { role: 'anon', vars: { k } }).out === '');
  ok('내 정보 → null', pg.sql("select camp_me(:'t')", { role: 'anon', vars: { t: ga.token } }).out === '');
  pg.sql("update people_cache set updated_at = now() - interval '29 minutes' where pid = :'p'", { vars: { p: ga.pid } });
  ok('29분은 쓴다', pg.sql("select camp_login(:'k')", { role: 'anon', vars: { k } }).out !== '');
  pg.sql("update people_cache set updated_at = now()");

  // ---------------------------------------------------------------- 끝-끝
  section('🔴 끝-끝 — 앱 api.js → Postgres 함수 → GAS');
  const SUPA = 'https://supa.test';
  const route = (url, init) => {
    const m = /\/rest\/v1\/rpc\/(camp_login|camp_me)$/.exec(url);
    if (m) {
      const args = JSON.parse(init.body);
      const v = m[1] === 'camp_login' ? { a: args.p_key } : { a: args.p_token };
      const out = pg.sql(`select ${m[1]}(:'a')`, { role: 'anon', vars: v });
      return out.ok ? { status: 200, body: out.out || 'null' } : { status: 400, body: { message: out.err } };
    }
    if (url === 'https://gas.test/exec') return { status: 200, body: G.post(JSON.parse(init.body)) };
    return { status: 404, body: '' };
  };
  const app = loadApi({ SUPABASE_URL: SUPA, SUPABASE_ANON_KEY: 'sb_publishable_TEST' }, route);
  const login = await app.API.login('', '가 조장', '010-1000-1001'.slice(-4));
  ok('사본으로 로그인', login.me.participant.name === '가조장' && !app.calls.some(c => c.url === 'https://gas.test/exec'), app.calls.map(c => c.url));
  ok('🔴 받은 토큰을 GAS 가 받아 준다 (쓰기는 GAS)', G.post({ action: 'me', token: login.token }).ok);
  ok('뒷자리 원문을 보내지 않았다', !JSON.stringify(app.calls).includes('1001'));
  app.calls.length = 0;
  const me = await app.API.me();
  ok('다시 열 때 내 정보도 사본', me.participant.id === ga.pid && app.calls.length === 1 && /camp_me/.test(app.calls[0].url));
  const fee = await app.API.feeStatus();
  const gasFee = G.post({ action: 'fee.status', token: login.token }).data;
  ok('🔴 회비 = GAS fee.status 와 같은 모양·값', JSON.stringify(fee) === JSON.stringify(gasFee), { mirror: fee, gas: gasFee });
  app.calls.length = 0;
  const twin = await app.API.login('', '같은이', '5555').catch(e => e);
  ok('겹친 사람은 GAS 가 판단 (AMBIGUOUS)', twin.code === 'AMBIGUOUS' && app.calls.some(c => c.url === 'https://gas.test/exec'), twin);
  const pastor = await app.API.login('', '라교역', '0002');
  ok('공란 교역자는 GAS 로 로그인', pastor.me.mode === 'ops');
  app.calls.length = 0;
  await app.API.me();
  ok('  └ 그 토큰의 내 정보는 GAS 로 (사본에 없다)', app.calls.some(c => c.url === 'https://gas.test/exec'));

  section('캠프 모드 끄기 → 표가 빈다');
  pg.sql("delete from people_cache where pid is not null", { role: 'service_role' });
  ok('끈 뒤 사본 로그인은 null → GAS', pg.sql("select camp_login(:'k')", { role: 'anon', vars: { k } }).out === '');
  ok('사본 토큰도 GAS 에서는 여전히 유효 (앱이 안 끊긴다)', G.post({ action: 'me', token: login.token }).ok);
})().then(done, e => { console.error(e); process.exit(1); });
