/**
 * 캠프 모드 토큰 통일 (D-068, GAS v23).
 *   사본에 오른 사람(지금 회차 · 참가자ID 있음)은 GAS 로 로그인해도 **사본과 같은 토큰**을 받는다.
 *   캠프 모드 전에 받은 옛 토큰으로 내 정보를 부르면 GAS 가 사본 토큰(campToken)을 건넨다.
 *   지금 회차로 올린 사람이 0명이면 캠프 모드 켜기 알림이 경고한다.
 */
const { camp } = require('../lib/gas');
const { ok, section, done } = require('../lib/check');

const S1 = '10/31(토)', S2 = '11/07(토)';
const PROPS = { SUPABASE_URL: 'https://mirror.test', SUPABASE_SERVICE_KEY: 'sb_secret_TEST_ONLY' };

// [참여 일자, 이름, 조, 역할, 연락처, 담당 지점, 코스]
const PEOPLE = [
  [S1, '가조장', '1조', '조장', '010-1000-1001', '', ''],
  [S1, '나조원', '1조', '일반', '010-1000-1002', '', ''],
  [S2, '바조장', '1조', '조장', '010-1000-4001', '', '', '장년부'],
  ['', '라교역', '', '교역자', '010-2000-0002', '', '']
];
const G = camp({ props: PROPS });
G.addPeople(PEOPLE);
G.setToday('2026-10-21');                 // 지금 회차 = 오늘이거나 가장 가까운 다음 회차 = 10/31
const { post, run } = G;
const pidOf = (name) => G.login(name, { 가조장: '1001', 나조원: '1002', 바조장: '4001', 라교역: '0002' }[name]).data.me.participant.id;
const campTok = (pid, d) => { G.fresh(); return run(`campToken_(${JSON.stringify(pid)}${d === undefined ? '' : ', ' + d}).token`); };
const peopleRows = () => {
  const ups = G.FETCH.filter(f => /\/rest\/v1\/people_cache/.test(f.url) && f.method === 'post');
  return ups.length ? JSON.parse(ups[ups.length - 1].payload) : [];
};

section('캠프 모드 전 — 지금처럼 TTL 토큰');
const pid = pidOf('가조장');
const before = G.login('가조장', '1001').data.token;
ok('캠프 모드가 아니면 사본 토큰이 아니다', before !== campTok(pid), before);
let me = post({ action: 'me', token: before });
ok('내 정보에 campToken 이 붙지 않는다', me.ok && !('campToken' in me.data), me.data && Object.keys(me.data));

section('🔴 캠프 모드 — GAS 로그인도 사본과 같은 토큰');
G.fresh(); run('installCampSync()');
const row = peopleRows().find(x => x.me.participant.name === '가조장');
ok('사본에 올라갔다 (10/31)', row && row.session === S1, peopleRows().map(x => x.session));
ok('사본 토큰 = campToken_ (한 곳에서 만든다)', row.token === campTok(pid) && row.token_prev === campTok(pid, 1));
let r = G.login('가조장', '1001');
ok('🔴 GAS 로그인 토큰 = 사본 토큰 — 그 뒤 내 정보는 camp_me 가 찾는다', r.ok && r.data.token === row.token, r.data && r.data.token);
ok('만료는 모레 0시 (서울)', r.data.expiresAt === new Date('2026-10-23T00:00:00+09:00').toISOString(), r.data.expiresAt);
ok('그 토큰으로 GAS 내 정보도 된다 (서명 유효)', post({ action: 'me', token: r.data.token }).ok);
const other = G.login('바조장', '4001');
ok('다른 회차(11/07) 사람은 TTL 토큰 그대로', other.ok && other.data.token !== campTok(pidOf('바조장')), other.error);
const ops = G.login('라교역', '0002');
ok('참여 일자 빈 교역자(사본 제외, D-055)도 TTL 토큰 그대로', ops.ok && ops.data.token !== campTok(pidOf('라교역')), ops.error);

section('🔴 캠프 모드 전에 로그인해 둔 옛 토큰 → 내 정보가 사본 토큰을 건넨다');
me = post({ action: 'me', token: before });
ok('옛 토큰으로 부르면 campToken = 사본 토큰', me.ok && me.data.campToken === row.token, me.data && me.data.campToken);
ok('나머지 모양은 사본의 me 와 같다', (() => { const m = Object.assign({}, me.data); delete m.campToken; return JSON.stringify(m) === JSON.stringify(row.me); })());
ok('사본 토큰으로 부르면 붙지 않는다', !('campToken' in post({ action: 'me', token: row.token }).data));
ok('어제 토큰(token_prev)으로 불러도 붙지 않는다 (사본이 이미 안다)', !('campToken' in post({ action: 'me', token: row.token_prev }).data));
const otherMe = post({ action: 'me', token: other.data.token });
ok('사본에 없는 사람에게는 붙지 않는다', otherMe.ok && !('campToken' in otherMe.data));

section('캠프 모드 끄기 — 다시 TTL 토큰, campToken 없음');
G.fresh(); run('stopCampSync()');
r = G.login('가조장', '1001');
ok('끄면 GAS 로그인은 TTL 토큰', r.ok && r.data.token !== row.token);
ok('옛 토큰 내 정보에 campToken 없음', !('campToken' in post({ action: 'me', token: before }).data));
ok('사본 토큰은 만료(모레 0시)까지 GAS 에서 그대로 쓸 수 있다', post({ action: 'me', token: row.token }).ok);

section('🔴 지금 회차로 올린 사람이 0명이면 경고 (D-068)');
// 알림 기록(UI)은 load 마다 새로 잡히므로, 다음 준비(H)를 만들기 전에 G 의 알림을 먼저 본다
const okMsg = G.UI.filter(u => u.alert && /캠프 모드/.test(u.alert)).map(u => u.alert)[0] || '';
ok('사람이 있으면 경고 대신 인원 수', /10\/31\(토\) 2명을 올렸습니다/.test(okMsg) && !/0명입니다/.test(okMsg), okMsg);
{
  const H = camp({ props: PROPS });
  H.addPeople([['사전답사(10/17)', '가답사', '1조', '조장', '010-1000-3001', '', '']]);
  H.setToday('2026-10-21');
  H.fresh(); H.run('installCampSync()');
  const msg = H.UI.filter(u => u.alert).map(u => u.alert).pop() || '';
  ok('0명이면 "⚠ … 0명입니다 · 참여 일자 확인 · GAS 로 됩니다"', /⚠ 지금 회차\(10\/31\(토\)\)로 올린 사람이 0명입니다/.test(msg) && /참여 일자/.test(msg) && /GAS 로 됩니다/.test(msg), msg);
}

done();
