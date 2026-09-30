/**
 * 조 없는 교역자·스태프, 담당 지점, 공란 회차 (D-051) — B 단계(v16) 서버.
 * 원본은 컨테이너 재시작으로 사라진 scratchpad 의 test-b.js. 세션 기록에서 되살려 옮겼다.
 */
const { camp } = require('../lib/gas');
const { ok, section, done } = require('../lib/check');

const G = camp();
const { run, post, login, setToday } = G;
const tokenOf = (name, last4) => { const r = login(name, last4); return r.ok ? r.data.token : null; };

const S1 = '10/31(토)', S2 = '11/07(토)';


// 사람: [참여 일자, 이름, 조, 역할, 연락처, 담당 지점, 코스]
const PEOPLE = [
  [S1, '김조장', '1조', '조장', '010-1000-1001', '', 'A코스(배재 시작)'],
  [S1, '이조원', '1조', '일반', '010-1000-1002', '', 'A코스(배재 시작)'],
  [S1, '박조장', '2조', '조장', '010-1000-2001', '', 'B코스(러시아 시작)'],
  ['', '최교역', '', '교역자', '010-2000-0001', '', ''],
  ['', '정스태', '', '스태프', '010-2000-0002', 'CP1', ''],
  ['', '한순회', '', '스태프', '010-2000-0003', '', ''],
  [S1, '윤조스', '3조', '스태프', '010-2000-0004', '', 'A코스(배재 시작)'],
  [S1, '두행이', '', '스태프', '010-2000-0005', 'CP2', ''],
  [S2, '두행이', '', '스태프', '010-2000-0005', 'CP2', ''],
  [S1, '오미배', '', '일반', '010-2000-0006', '', ''],
  [S1, '옛사역', '4조', '사역자', '010-2000-0007', '', 'A코스(배재 시작)']
];
G.addPeople(PEOPLE);


setToday('2026-10-31');

// ------------------------------------------------------------------ 모드
section('모드 판정 (D-051)');
const modes = {};
[['김조장', '1001'], ['이조원', '1002'], ['최교역', '0001'], ['정스태', '0002'],
 ['한순회', '0003'], ['윤조스', '0004'], ['오미배', '0006']].forEach(([n, d]) => {
  const r = login(n, d);
  modes[n] = r.ok ? r.data.me : r.error;
});
ok('조장 → leader', modes['김조장'].mode === 'leader' && modes['김조장'].isLeader === true, modes['김조장'].mode);
ok('조원 → member', modes['이조원'].mode === 'member' && !modes['이조원'].isLeader);
ok('🔴 조 없는 교역자 → ops (로그인 됨)', modes['최교역'].mode === 'ops', modes['최교역']);
ok('🔴 ops 는 조장 권한이 아니다', modes['최교역'].isLeader === false);
ok('ops 는 조가 없다', modes['최교역'].team === null);
ok('스태프 + 담당 지점 → station', modes['정스태'].mode === 'station', modes['정스태']);
ok('담당 지점 이름이 실린다', modes['정스태'].station && modes['정스태'].station.code === 'CP1' &&
  modes['정스태'].station.name === '배재학당역사박물관', modes['정스태'].station);
ok('담당 지점 없는 조 없는 스태프 → ops', modes['한순회'].mode === 'ops', modes['한순회'].mode);
ok('조 있는 스태프 → 지금처럼 leader', modes['윤조스'].mode === 'leader' && modes['윤조스'].isLeader === true);
ok('조 없는 일반 → member(미배정)', modes['오미배'].mode === 'member' && modes['오미배'].team === null);

// ------------------------------------------------------------------ 공란 회차
section('공란 참여 일자 = 전 회차 → 지금 회차');
ok('10/31 에는 10/31', modes['최교역'].participant.session === S1, modes['최교역'].participant.session);
setToday('2026-11-03');
ok('두 회차 사이(11/03)에는 다음 회차 11/07', login('최교역', '0001').data.me.participant.session === S2);
setToday('2026-10-01');
ok('캠프 전에는 첫 회차', login('최교역', '0001').data.me.participant.session === S1);
setToday('2026-12-01');
ok('다 끝나면 마지막 회차', login('최교역', '0001').data.me.participant.session === S2);
setToday('2026-10-31');

// 요청 컨텍스트도 같은 회차를 써야 한다 (me 와 서버 판단이 어긋나지 않게)
const opsTok = tokenOf('최교역', '0001');
const meOps = post({ action: 'me', token: opsTok });
ok('me 도 같은 회차·모드', meOps.ok && meOps.data.participant.session === S1 && meOps.data.mode === 'ops', meOps);

section('🔴 두 회차 행을 가진 사람 — 오늘 회차 행으로');
let two = login('두행이', '0005');
ok('10/31 에는 10/31 행으로 로그인', two.ok && two.data.me.participant.session === S1, two.error || two.data.me.participant.session);
setToday('2026-11-07');
two = login('두행이', '0005');
ok('11/07 에는 11/07 행으로', two.ok && two.data.me.participant.session === S2, two.error || two.data.me.participant.session);
setToday('2026-11-03');
two = login('두행이', '0005');
ok('어느 회차도 아닌 날에는 여전히 막는다(AMBIGUOUS)', !two.ok && two.error.code === 'AMBIGUOUS', two);
setToday('2026-10-31');

section('활성 회차가 없으면');
run(`configSet_({isAdmin:true}, {key:'SESSION_1_ACTIVE', value:'FALSE', allowNew:true});
     configSet_({isAdmin:true}, {key:'SESSION_2_ACTIVE', value:'FALSE', allowNew:true}); clearConfigCache();`);
const none = login('최교역', '0001');
ok('공란 회차 교역자는 "열려 있는 회차가 없습니다"', !none.ok && /열려 있는 회차가 없/.test(none.error.message), none.error);
run(`configSet_({isAdmin:true}, {key:'SESSION_1_ACTIVE', value:'TRUE', allowNew:true});
     configSet_({isAdmin:true}, {key:'SESSION_2_ACTIVE', value:'TRUE', allowNew:true}); clearConfigCache();`);

// ------------------------------------------------------------------ 옛 역할
section('사역자 → 교역자');
const old = login('옛사역', '0007');
ok('🔴 사역자는 이제 조장 권한이 없다 (조원으로)', old.ok && old.data.me.mode === 'member' && !old.data.me.isLeader, old.data && old.data.me.mode);
const check = run('checkDuplicates()');
ok('명단 점검이 사역자 행을 알린다', /사역자" → "교역자"/.test(check), check.split('\n').filter(l => /사역자/.test(l)));
ok('공란 회차 교역자·스태프는 "참여 일자 미배정" 이 아니다',
  !/최교역\): 참여 일자 미배정/.test(check) && !/정스태\): 참여 일자 미배정/.test(check));
ok('조 없는 일반은 여전히 미배정이 아니라 — 회차는 있으니 경고 없음', !/오미배\): 참여 일자/.test(check));
ok('새 열 있음', /새 열\(담당 지점·점수출처·수상\) 있음/.test(check));
ok('드롭다운 목록에 교역자', run('ENUM.ROLE').indexOf('교역자') >= 0 && run('ENUM.ROLE').indexOf('사역자') < 0);

// 담당 지점 오타
run(`
  var r = readTable_(SHEETS.PARTICIPANTS).filter(function (x) { return x[COL.NAME] === '한순회'; })[0];
  updateRow_(SHEETS.PARTICIPANTS, r.__row, (function(){ var o = {}; o[COL.STATION] = 'CP9'; return o; })());
`);
ok('담당 지점 오타를 알린다', /담당 지점 "CP9" 가 지점코드가 아님/.test(run('checkDuplicates()')));
run(`
  var r = readTable_(SHEETS.PARTICIPANTS).filter(function (x) { return x[COL.NAME] === '한순회'; })[0];
  updateRow_(SHEETS.PARTICIPANTS, r.__row, (function(){ var o = {}; o[COL.STATION] = ''; return o; })());
`);

// ------------------------------------------------------------------ 보드·회비
section('가짜 조가 생기지 않는다');
const adminTok = G.adminToken();
const board = post({ action: 'admin.progress.board', token: adminTok });
ok('진행 보드에 운영진 조가 없다', board.ok && board.data.teams.every(t => t.group), board.data && board.data.teams.map(t => t.group));
const fee = post({ action: 'admin.fee.board', token: adminTok });
ok('회비 보드는 운영진으로 묶는다', fee.ok && fee.data.teams.some(t => t.group === '운영진'),
  fee.data && fee.data.teams.map(t => t.label));
ok('조 없는 일반은 여전히 (조 미배정)', fee.data.teams.some(t => t.group === '(조 미배정)'));

done();
