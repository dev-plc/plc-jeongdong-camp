/**
 * 진행 기록 (D-045·052) — 조장·스태프·관리자가 같은 writeProgress_ 로 쓴다.
 *   스태프 점수 우선(조장 점수는 무시, 상태는 기록) · 지점/회차는 서버가 정한다 · 배치는 전부 아니면 전무
 *   + 운영 콘솔 정정 · 일괄 승인 · 시상.
 * 원본 스위트는 소실 — 새로 썼다.
 */
const { camp } = require('../lib/gas');
const { ok, section, done } = require('../lib/check');

const S1 = '10/31(토)', S2 = '11/07(토)';
const G = camp({ props: { SUPABASE_URL: 'https://mirror.test', SUPABASE_SERVICE_KEY: 'sb_secret_TEST_ONLY' } });
const { post, run } = G;

// [참여 일자, 이름, 조, 역할, 연락처, 담당 지점, 코스, 부서]  — 가짜 이름·가짜 번호
G.addPeople([
  [S1, '가조장', '1조', '조장', '010-1000-1001', '', 'A코스(배재 시작)'],
  [S1, '나조원', '1조', '일반', '010-1000-1002', '', 'A코스(배재 시작)'],
  [S1, '다조장', '2조', '조장', '010-1000-2001', '', 'B코스(러시아 시작)'],
  [S1, '라조장', '3조', '조장', '010-1000-3001', '', 'C코스(보구여관 시작)'],
  [S2, '마조장', '1조', '조장', '010-1000-4001', '', 'A코스(배재 시작)', '장년부'],
  ['', '바스태', '', '스태프', '010-2000-0001', 'CP1', ''],
  [S2, '사스태', '', '스태프', '010-2000-0002', 'CP1', ''],
  ['', '아교역', '', '교역자', '010-2000-0003', '', '']
]);

const leader = G.token('가조장', '1001');
const member = G.token('나조원', '1002');
const leader2 = G.token('다조장', '2001');
const staff = G.token('바스태', '0001');
const ops = G.token('아교역', '0003');
const admin = G.adminToken();

const cell = (list, code) => list.find(x => x.checkpoint === code);
const progressRows = () => { const t = G.sheet('Progress'); const h = t[0]; return t.slice(1).map(r => Object.fromEntries(h.map((k, i) => [k, r[i]]))); };
const rowOf = (session, group, code) => progressRows().find(r => r['참여 일자'] === session && r['조 배정'] === group && r['지점코드'] === code);
const lastLog = () => { const t = G.sheet('Log'); const h = t[0]; const r = t[t.length - 1]; return Object.fromEntries(h.map((k, i) => [k, r[i]])); };

// ------------------------------------------------------------------ 조장
section('조장 — 상태·점수');
let r = post({ action: 'progress.set', token: leader, items: [{ checkpoint: 'CP1', status: '도착' }] });
ok('도착 기록', r.ok && cell(r.data, 'CP1').status === '도착' && !!cell(r.data, 'CP1').arrivedAt, r);
ok('코스 순서대로 네 지점 (A코스)', r.ok && r.data.map(x => x.checkpoint).join() === 'CP1,CP2,CP3,CP4');
const firstArrived = cell(r.data, 'CP1').arrivedAt;

r = post({ action: 'progress.set', token: leader, items: [{ checkpoint: 'CP1', status: '도착', score: 7 }] });
ok('조장 점수 7 · 출처 조장', r.ok && cell(r.data, 'CP1').score === 7 && cell(r.data, 'CP1').scoreSource === '조장', r.data && cell(r.data, 'CP1'));

r = post({ action: 'progress.set', token: leader, items: [{ checkpoint: 'CP1', status: '완료' }] });
ok('🔴 상태만 보내면 점수는 그대로 (안 보냄 ≠ 비우기, D-039)', r.ok && cell(r.data, 'CP1').score === 7, cell(r.data, 'CP1'));
ok('처음 도착 시각 유지', cell(r.data, 'CP1').arrivedAt === firstArrived);
ok('완료 시각 기록', !!cell(r.data, 'CP1').completedAt);

section('조장 — 배치 (D-045)');
const before = progressRows().length;
r = post({ action: 'progress.set', token: leader, items: [{ checkpoint: 'CP2', status: '도착' }, { checkpoint: 'CP3', status: '엉뚱' }] });
ok('🔴 한 건이라도 틀리면 전부 거절', !r.ok && r.error.code === 'BAD_REQUEST', r);
ok('🔴 아무 행도 안 생긴다', progressRows().length === before, progressRows().length);
r = post({ action: 'progress.set', token: leader, items: [{ checkpoint: 'CP2', status: '도착' }, { checkpoint: 'CP2', status: '완료' }] });
ok('같은 지점 두 번 → 마지막이 이긴다', r.ok && cell(r.data, 'CP2').status === '완료', r.data && cell(r.data, 'CP2'));
r = post({ action: 'progress.set', token: leader, checkpoint: 'CP3', status: '도착' });
ok('옛 앱의 단건 형식도 받는다', r.ok && cell(r.data, 'CP3').status === '도착');
r = post({ action: 'progress.set', token: leader, items: [{ checkpoint: 'CP3', status: '대기' }] });
ok('대기로 되돌리면 시각을 비운다', r.ok && cell(r.data, 'CP3').status === '대기' && !cell(r.data, 'CP3').arrivedAt);
r = post({ action: 'progress.set', token: leader, items: [{ checkpoint: 'CP4', status: '도착', score: 150 }] });
ok('점수 0~100 밖은 거절', !r.ok && /0~100/.test(r.error.message), r);

section('조장 권한');
r = post({ action: 'progress.set', token: member, items: [{ checkpoint: 'CP1', status: '완료' }] });
ok('🔴 조원은 기록 못 한다', !r.ok && r.error.code === 'FORBIDDEN', r);
r = post({ action: 'progress.set', token: staff, items: [{ checkpoint: 'CP1', status: '완료' }] });
ok('🔴 조 없는 스태프도 조장 기록은 못 한다', !r.ok && r.error.code === 'FORBIDDEN', r);
r = post({ action: 'progress.list', token: ops });
ok('교역자에게 코스 목록 대신 안내', !r.ok && /진행" 화면/.test(r.error.message), r);

// ------------------------------------------------------------------ 스태프
section('🔴 스태프 점수 우선 (D-052)');
G.FETCH.length = 0;
r = post({ action: 'station.set', token: staff, items: [{ group: '1조', score: 9 }] });
ok('스태프 점수 9 저장', r.ok && r.data.teams.find(t => t.group === '1조').score === 9, r);
ok('출처 스태프', r.data.teams.find(t => t.group === '1조').scoreSource === '스태프');
ok('상태는 그대로(완료) — 점수만 보냈다', r.data.teams.find(t => t.group === '1조').status === '완료');
ok('사본에 조마다 한 번 밀었다', G.FETCH.filter(f => /progress_cache/.test(f.url)).length === 1, G.FETCH.map(f => f.url));
const pushed = JSON.parse(G.FETCH[0].payload);
ok('🔴 사본 행에는 점수출처가 없다 (스키마 고정)', pushed.every(p => !('scoreSource' in p) && !('score_source' in p)) &&
  pushed.find(p => p.checkpoint === 'CP1').score === 9, pushed[0]);
ok('sb_secret_ 키는 Bearer 로 보내지 않는다', !G.FETCH[0].headers.Authorization && G.FETCH[0].headers.apikey === 'sb_secret_TEST_ONLY');

r = post({ action: 'progress.set', token: leader, items: [{ checkpoint: 'CP1', status: '완료', score: 3 }] });
ok('🔴 조장이 바꾸려 하면 거절이 아니라 점수만 무시', r.ok && cell(r.data, 'CP1').score === 9 && cell(r.data, 'CP1').scoreSource === '스태프', r.data && cell(r.data, 'CP1'));
ok('로그에 "스태프 점수 유지"', /스태프 점수 유지 CP1/.test(lastLog()['결과']), lastLog());
r = post({ action: 'progress.set', token: leader, items: [{ checkpoint: 'CP1', status: '도착', score: 1 }, { checkpoint: 'CP4', status: '도착', score: 6 }] });
ok('🔴 같은 배치의 다른 지점은 들어간다', r.ok && cell(r.data, 'CP1').status === '도착' && cell(r.data, 'CP4').score === 6 && cell(r.data, 'CP1').score === 9, r.data);

section('스태프 — 지점·회차는 서버가 정한다');
r = post({ action: 'station.board', token: staff });
ok('내 지점 = CP1', r.ok && r.data.checkpoint.code === 'CP1', r);
ok('10/31 조 세 개만 (11/07 조 없음)', r.data.teams.length === 3 && r.data.session === S1, r.data.teams.map(t => t.group));
ok('🔴 이 지점에 오는 순서대로 (A 1번째, C 3번째, B 4번째)', r.data.teams.map(t => t.group + ':' + t.visitOrder).join() === '1조:1,3조:3,2조:4',
  r.data.teams.map(t => t.group + ':' + t.visitOrder));
ok('직전 지점 이름·상태', r.data.teams.find(t => t.group === '2조').prevName === '이화여고 박물관' &&
  r.data.teams.find(t => t.group === '2조').prevStatus === '대기');
r = post({ action: 'station.set', token: staff, items: [{ group: '2조', status: '도착', checkpoint: 'CP3' }] });
ok('🔴 요청이 다른 지점을 말해도 CP1 에 쓴다', r.ok && !!rowOf(S1, '2조', 'CP1') && !rowOf(S1, '2조', 'CP3'), progressRows().filter(x => x['조 배정'] === '2조'));
r = post({ action: 'station.set', token: staff, items: [{ group: '9조', status: '도착' }] });
ok('이 지점을 안 지나는 조는 거절', !r.ok && r.error.code === 'FORBIDDEN', r);
const s2staff = G.token('사스태', '0002');
r = post({ action: 'station.set', token: s2staff, items: [{ group: '3조', status: '도착' }] });
ok('🔴 다른 회차 스태프는 10/31 조를 못 건드린다', !r.ok && r.error.code === 'FORBIDDEN', r);
r = post({ action: 'station.set', token: staff, items: [{ group: '3조' }] });
ok('바꿀 게 없으면 거절', !r.ok && r.error.code === 'BAD_REQUEST', r);

section('교역자·조원 — 읽기');
r = post({ action: 'ops.board', token: ops });
ok('교역자 진행 보드 = 내 회차 조만', r.ok && r.data.teams.length === 3 && r.data.teams.every(t => t.session === S1), r.data && r.data.teams.map(t => t.session + t.group));
ok('칸에 점수·출처', r.data.teams.find(t => t.group === '1조').cells.CP1.scoreSource === '스태프');
r = post({ action: 'ops.board', token: staff });
ok('지점 스태프도 전체 진행을 본다', r.ok);
r = post({ action: 'ops.board', token: member });
ok('조원은 못 본다', !r.ok && r.error.code === 'FORBIDDEN');
r = post({ action: 'station.board', token: ops });
ok('담당 지점 없는 교역자는 내 지점 없음', !r.ok && r.error.code === 'FORBIDDEN');

section('진행 마감');
run("configSet_({isAdmin:true}, {key:'PROGRESS_OPEN', value:'FALSE'})");
ok('조장 CLOSED', post({ action: 'progress.set', token: leader2, items: [{ checkpoint: 'CP2', status: '도착' }] }).error.code === 'CLOSED');
ok('스태프 CLOSED', post({ action: 'station.set', token: staff, items: [{ group: '2조', status: '완료' }] }).error.code === 'CLOSED');
run("configSet_({isAdmin:true}, {key:'PROGRESS_OPEN', value:'TRUE'})");

// ------------------------------------------------------------------ 관리자 정정
section('운영 콘솔 — 칸 정정 (D-052)');
G.FETCH.length = 0;
r = post({ action: 'admin.progress.set', token: admin, session: S1, group: '3조', checkpoint: 'CP3', status: '완료', score: 8 });
ok('정정 → 보드에 반영', r.ok && r.data.teams.find(t => t.group === '3조' && t.session === S1).cells.CP3.status === '완료', r);
ok('출처 관리자', rowOf(S1, '3조', 'CP3')['점수출처'] === '관리자');
ok('🔴 사본까지 민다', G.FETCH.some(f => /progress_cache/.test(f.url) && JSON.parse(f.payload).some(p => p.team === '3조' && p.checkpoint === 'CP3' && p.status === '완료')));
r = post({ action: 'admin.progress.set', token: admin, session: S1, group: '3조', checkpoint: 'CP3', score: '' });
ok('점수 비우기 → 출처도 비운다', r.ok && rowOf(S1, '3조', 'CP3')['퀴즈점수'] === '' && rowOf(S1, '3조', 'CP3')['점수출처'] === '' &&
  rowOf(S1, '3조', 'CP3')['상태'] === '완료');
r = post({ action: 'admin.progress.set', token: admin, session: S2, group: '7조', checkpoint: 'CP1', status: '도착' });
ok('없는 조는 NOT_FOUND', !r.ok && r.error.code === 'NOT_FOUND');
r = post({ action: 'admin.progress.set', token: leader, session: S1, group: '1조', checkpoint: 'CP1', status: '대기' });
ok('🔴 참가자 토큰으로는 못 한다', !r.ok && r.error.code === 'FORBIDDEN', r.error);

section('🔴 점수출처 열이 없으면 (초기 세팅 안 돌림)');
{
  const H = camp();
  H.addPeople([[S1, '가조장', '1조', '조장', '010-1000-1001', '', 'A코스(배재 시작)']]);
  const t = H.token('가조장', '1001');
  const sh = H.ss.getSheetByName('Progress').__data();
  const i = sh[0].indexOf('점수출처');
  sh.forEach(row => row.splice(i, 1));
  let x = H.post({ action: 'progress.set', token: t, items: [{ checkpoint: 'CP1', status: '도착', score: 5 }] });
  ok('점수 쓰기는 막고 할 일을 알린다', !x.ok && /점수출처.*초기 세팅 실행/.test(x.error.message), x.error);
  x = H.post({ action: 'progress.set', token: t, items: [{ checkpoint: 'CP1', status: '도착' }] });
  ok('상태만은 그대로 된다', x.ok && x.data[0].status === '도착', x);
}

// ------------------------------------------------------------------ 일지 — 일괄 승인 · 시상
section('일괄 승인 · 시상 (D-052)');
const PNG = Buffer.from('fake-png-bytes').toString('base64');
const j1 = post({ action: 'journal.create', token: leader, text: '첫 글', checkpoint: 'CP1', photo: { dataBase64: PNG, mimeType: 'image/png' } }).data;
const j2 = post({ action: 'journal.create', token: member, text: '둘째 글' }).data;
const j3 = post({ action: 'journal.create', token: leader2, text: '반려될 글' }).data;
ok('세 글 모두 대기', [j1, j2, j3].every(j => j && j.status === '대기'), [j1, j2, j3]);
ok('사진은 Drive 에 저장·공유', G.DRIVE.files.length === 1 && G.DRIVE.files[0].shared === true, G.DRIVE.files);
post({ action: 'admin.journal.review', token: admin, id: j3.id, decision: '반려', reason: '사진이 흐립니다' });
r = post({ action: 'admin.journal.award', token: admin, id: j1.id, award: true });
ok('🔴 승인 전 사진은 수상작이 될 수 없다', !r.ok && /승인된 사진 글만/.test(r.error.message), r);
r = post({ action: 'admin.journal.reviewBatch', token: admin, decision: '승인', ids: [j1.id, j2.id, j3.id, 'J9999'] });
ok('대기 글만 승인', r.ok && r.data.approved.join() === [j1.id, j2.id].join(), r.data);
ok('🔴 이미 검토된 글·없는 글은 건너뛴다', r.data.skipped.join() === [j3.id, 'J9999'].join(), r.data.skipped);
ok('반려 글은 반려 그대로', post({ action: 'admin.journal.list', token: admin }).data.items.find(j => j.id === j3.id).status === '반려');
r = post({ action: 'admin.journal.reviewBatch', token: admin, decision: '반려', ids: [j1.id] });
ok('일괄 반려는 받지 않는다', !r.ok && r.error.code === 'BAD_REQUEST');
r = post({ action: 'admin.journal.award', token: admin, id: j1.id, award: true });
ok('승인된 사진 글 → ★', r.ok && r.data.award === true, r);
r = post({ action: 'admin.journal.award', token: admin, id: j2.id, award: true });
ok('사진 없는 글은 수상작 불가', !r.ok, r);
r = post({ action: 'admin.journal.award', token: admin, id: j1.id, award: false });
ok('해제', r.ok && r.data.award === false);

done();
