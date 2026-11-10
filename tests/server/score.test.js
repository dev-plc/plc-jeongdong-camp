/**
 * 지점 점수 스위치 · 역할 '캠티' (D-090, GAS v26).
 *   SCORE_INPUT: OFF(기본) · STAFF(거점 스태프) · CAMTI(역할 캠티) · BOTH(둘 다, 스태프 우선). 콘솔 정정은 늘 된다.
 *   캠티: 조가 있으면 진행자(leader) — 조장처럼 도착·완료, 조가 없으면 운영(ops). 진행자 표시는 캠티 우선.
 * 가짜 이름·가짜 번호만.
 */
const { camp } = require('../lib/gas');
const { ok, section, done } = require('../lib/check');

const S1 = '10/31(토)';
const PROPS = { SUPABASE_URL: 'https://mirror.test', SUPABASE_SERVICE_KEY: 'sb_secret_TEST_ONLY' };

const G = camp({ props: PROPS });
const { post, run } = G;
// [참여 일자, 이름, 조, 역할, 연락처, 담당 지점, 코스]
G.addPeople([
  [S1, '가조장', '1조', '조장', '010-1000-1001', '', 'A코스(배재 시작)'],
  [S1, '나조원', '1조', '일반', '010-1000-1002', '', 'A코스(배재 시작)'],
  [S1, '다캠티', '2조', '캠티', '010-1000-2009', '', 'B코스(러시아 시작)'],
  [S1, '라조원', '2조', '일반', '010-1000-2002', '', 'B코스(러시아 시작)'],
  [S1, '마캠티', '', '캠티', '010-1000-3009', '', ''],
  [S1, '사조원', '3조', '일반', '010-1000-3002', '', 'C코스(보구여관 시작)'],
  [S1, '자조장', '4조', '조장', '010-1000-4001', '', 'A코스(배재 시작)'],
  [S1, '차캠티', '4조', '캠티', '010-1000-4009', '', 'A코스(배재 시작)'],
  [S1, '바스태', '', '스태프', '010-2000-0001', 'CP1', '']
]);

const leader = G.token('가조장', '1001');
const camti = G.token('다캠티', '2009');
const camtiMember = G.token('라조원', '2002');
const staff = G.token('바스태', '0001');
const admin = G.adminToken();
const meOf = (name, d) => G.login(name, d).data.me;
const cell = (list, code) => list.find(x => x.checkpoint === code);
const stTeam = (r, g) => r.data.teams.find(t => t.group === g);
const rows = () => { const t = G.sheet('Progress'); const h = t[0]; return t.slice(1).map(x => Object.fromEntries(h.map((k, i) => [k, x[i]]))); };
const rowAt = (g, code) => rows().find(x => x['조 배정'] === g && x['지점코드'] === code);
const lastLog = () => JSON.stringify(G.sheet('Log').slice(-1));
const setMode = (v) => run("configSet_({isAdmin:true}, {key:'SCORE_INPUT', value:'" + v + "', allowNew:true})");

// ------------------------------------------------------------------ 역할 캠티
section('🔴 역할 캠티 — 조가 있으면 진행자, 없으면 운영 (D-090)');
ok('드롭다운 목록에 캠티', run('ENUM.ROLE').indexOf('캠티') >= 0, run('ENUM.ROLE'));
let me = meOf('다캠티', '2009');
ok('🔴 조 있는 캠티 → leader 모드 · 진행자', me.mode === 'leader' && me.isLeader === true && me.participant.role === '캠티', me);
ok('🔴 진행자 표시는 캠티 — leaderName·leaderRole', me.team.leaderName === '다캠티' && me.team.leaderRole === '캠티', me.team);
ok('같은 조 조원 화면에도 "캠티"', meOf('라조원', '2002').team.leaderRole === '캠티');
ok('조장 조는 그대로 "조장"', meOf('가조장', '1001').team.leaderRole === '조장' && meOf('가조장', '1001').team.leaderName === '가조장');
ok('조 없는 캠티 → 운영(읽기)', meOf('마캠티', '3009').mode === 'ops');
let r = post({ action: 'progress.set', token: camti, items: [{ checkpoint: 'CP2', status: '도착' }] });
ok('🔴 캠티가 도착을 기록한다', r.ok && cell(r.data, 'CP2').status === '도착', r);

r = post({ action: 'admin.progress.board', token: admin });
ok('🔴 조장·캠티가 둘 다 있는 조는 캠티가 진행자', r.ok && r.data.teams.find(t => t.group === '4조').leaderName === '차캠티' &&
  r.data.teams.find(t => t.group === '4조').leaderRole === '캠티', r.data && r.data.teams.find(t => t.group === '4조'));
ok('콘솔 보드 팀에 leaderRole', r.ok && r.data.teams.find(t => t.group === '2조').leaderRole === '캠티' &&
  r.data.teams.find(t => t.group === '1조').leaderRole === '조장', r.data && r.data.teams.map(t => t.group + ':' + t.leaderRole));
r = post({ action: 'station.board', token: staff });
ok('스태프 내 지점 팀에도 leaderRole', r.ok && stTeam(r, '2조').leaderRole === '캠티' && stTeam(r, '1조').leaderRole === '조장', r.data && r.data.teams);

const check = run('checkDuplicates()');
ok('🔴 명단 점검: 캠티만 있는 조는 진행자 있음', !/2조: 조장·캠티가 없음/.test(check), check.split('\n').filter(l => /2조/.test(l)));
ok('   둘 다 없는 조는 "조장·캠티가 없음"', /3조: 조장·캠티가 없음/.test(check), check.split('\n').filter(l => /없음/.test(l)));

G.run('installCampSync()');
const up = G.FETCH.filter(f => /\/rest\/v1\/people_cache/.test(f.url) && f.method === 'post').pop();
const camtiRow = up && JSON.parse(up.payload).find(x => x.me.participant.name === '다캠티');
ok('🔴 명단 사본(me)에도 역할 캠티 · leader — SQL 변경 없이 사본 로그인이 통한다',
  !!camtiRow && camtiRow.me.participant.role === '캠티' && camtiRow.me.mode === 'leader' && camtiRow.me.team.leaderRole === '캠티', camtiRow && camtiRow.me);

// ------------------------------------------------------------------ 스위치
section('🔴 SCORE_INPUT 기본은 OFF — 아무도 점수를 못 넣는다');
ok('bootstrap 공개 설정 SCORE_INPUT = OFF', post({ action: 'bootstrap' }).data.config.SCORE_INPUT === 'OFF');
r = post({ action: 'station.set', token: staff, items: [{ group: '1조', score: 85 }] });
ok('🔴 스태프 점수 → FORBIDDEN "지금은 점수를 받지 않습니다"', !r.ok && r.error.code === 'FORBIDDEN' && /지금은 점수를 받지/.test(r.error.message), r);
r = post({ action: 'progress.set', token: camti, items: [{ checkpoint: 'CP2', score: 90 }] });
ok('🔴 캠티 점수도 FORBIDDEN', !r.ok && r.error.code === 'FORBIDDEN', r);
r = post({ action: 'station.set', token: staff, items: [{ group: '1조', status: '도착' }] });
ok('상태만은 그대로 된다', r.ok && stTeam(r, '1조').status === '도착', r);
setMode('YES');
ok('모르는 값은 OFF (오타로 켜지지 않게)', post({ action: 'bootstrap' }).data.config.SCORE_INPUT === 'OFF');

section('STAFF — 거점 스태프만');
setMode('staff');
ok('소문자도 STAFF 로', post({ action: 'bootstrap' }).data.config.SCORE_INPUT === 'STAFF');
r = post({ action: 'station.set', token: staff, items: [{ group: '1조', score: 85 }] });
ok('🔴 스태프 85 · 출처 스태프', r.ok && stTeam(r, '1조').score === 85 && stTeam(r, '1조').scoreSource === '스태프', r.data && stTeam(r, '1조'));
r = post({ action: 'progress.set', token: camti, items: [{ checkpoint: 'CP2', score: 90 }] });
ok('캠티는 FORBIDDEN "거점 스태프가 넣습니다"', !r.ok && /거점 스태프가 넣습니다/.test(r.error.message), r);
r = post({ action: 'progress.set', token: leader, items: [{ checkpoint: 'CP1', status: '완료', score: 70 }] });
ok('🔴 조장도 FORBIDDEN — 상태까지 함께 거절(배치는 전부 아니면 전무)', !r.ok && r.error.code === 'FORBIDDEN' && rowAt('1조', 'CP1')['상태'] === '도착', r);

section('🔴 CAMTI — 역할 캠티만 (조장·조원·스태프는 안 됨)');
setMode('CAMTI');
r = post({ action: 'progress.set', token: camti, items: [{ checkpoint: 'CP2', score: 90 }] });
ok('🔴 캠티가 점수만 넣는다 — 상태는 그대로 · 출처 캠티', r.ok && cell(r.data, 'CP2').score === 90 && cell(r.data, 'CP2').status === '도착' &&
  rowAt('2조', 'CP2')['점수출처'] === '캠티', r.data && cell(r.data, 'CP2'));
r = post({ action: 'progress.set', token: camti, items: [{ checkpoint: 'CP2', score: '' }] });
ok('지우기(\'\') → 점수·출처를 비운다', r.ok && cell(r.data, 'CP2').score === null && rowAt('2조', 'CP2')['점수출처'] === '', rowAt('2조', 'CP2'));
r = post({ action: 'progress.set', token: camti, items: [{ score: 50 }] });
ok('점수만 보내도 지점은 있어야 한다', !r.ok && r.error.code === 'BAD_REQUEST', r);
r = post({ action: 'progress.set', token: camti, items: [{ checkpoint: 'CP2', score: 101 }] });
ok('0~100 밖은 거절', !r.ok && /0~100/.test(r.error.message), r);
r = post({ action: 'progress.set', token: leader, items: [{ checkpoint: 'CP1', score: 70 }] });
ok('🔴 참가자 조장은 FORBIDDEN "캠티만"', !r.ok && /캠티만/.test(r.error.message), r);
r = post({ action: 'progress.set', token: camtiMember, items: [{ checkpoint: 'CP2', score: 70 }] });
ok('캠티 조의 조원도 FORBIDDEN', !r.ok && r.error.code === 'FORBIDDEN', r);
r = post({ action: 'station.set', token: staff, items: [{ group: '1조', score: 60 }] });
ok('스태프는 FORBIDDEN "캠티가 넣습니다"', !r.ok && /캠티가 넣습니다/.test(r.error.message), r);

section('🔴 BOTH — 둘 다, 스태프 점수 우선');
setMode('BOTH');
r = post({ action: 'station.set', token: staff, items: [{ group: '2조', status: '도착', score: 80 }] });
ok('스태프가 2조 CP1 에 80', r.ok && stTeam(r, '2조').score === 80, r.data && stTeam(r, '2조'));
r = post({ action: 'progress.set', token: camti, items: [{ checkpoint: 'CP1', score: 40 }] });
ok('🔴 캠티가 바꾸려 하면 거절이 아니라 무시 — 80 · 스태프 그대로', r.ok && cell(r.data, 'CP1').score === 80 && cell(r.data, 'CP1').scoreSource === '스태프', r.data && cell(r.data, 'CP1'));
ok('Log 에 "스태프 점수 유지"', /스태프 점수 유지 CP1/.test(lastLog()), lastLog());
r = post({ action: 'progress.set', token: camti, items: [{ checkpoint: 'CP2', score: 75 }] });
ok('스태프 점수가 없는 칸은 캠티가 넣는다', r.ok && cell(r.data, 'CP2').score === 75, r.data && cell(r.data, 'CP2'));

section('운영 콘솔 정정은 스위치와 상관없이 된다');
setMode('OFF');
r = post({ action: 'admin.progress.set', token: admin, session: S1, group: '1조', checkpoint: 'CP1', score: 55 });
ok('🔴 OFF 에서도 콘솔은 점수를 고친다 · 출처 관리자', r.ok && rowAt('1조', 'CP1')['퀴즈점수'] === 55 && rowAt('1조', 'CP1')['점수출처'] === '관리자', rowAt('1조', 'CP1'));

done();
