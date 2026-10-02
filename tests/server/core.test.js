/**
 * 기본 흐름 — 설치 · 로그인/토큰 · 일지 · 공지 · 회비 · 설정 · 사본.
 * 예전 기본 스위트(test.js 등)는 소실 — 새로 썼다. 사고가 났던 곳(🔴)은 사고를 다시 재현한다.
 */
const { camp, load } = require('../lib/gas');
const { ok, section, done } = require('../lib/check');

const S1 = '10/31(토)', S2 = '11/07(토)';
const G = camp({ props: { SUPABASE_URL: 'https://mirror.test', SUPABASE_SERVICE_KEY: 'sb_secret_TEST_ONLY' } });
const { post, get, run } = G;

// ------------------------------------------------------------------ 설치
section('초기 세팅');
const tabs = G.ss.getSheets().map(s => s.getName());
ok('스키마의 탭이 모두 생긴다', ['Config', 'Participants', 'Teams', 'Courses', 'Checkpoints', 'Progress', 'Journal', 'Notices', 'Timeline', 'Log']
  .every(t => tabs.includes(t)), tabs);
ok('지점 네 개 · 코스 네 개', G.sheet('Checkpoints').length === 5 && G.sheet('Courses').length === 5);
ok('B 단계 열이 있다 (담당 지점·점수출처·수상)', G.sheet('Participants')[0].includes('담당 지점') &&
  G.sheet('Progress')[0].includes('점수출처') && G.sheet('Journal')[0].includes('수상'));
const cfgRows = G.sheet('Config').length, tlRows = G.sheet('Timeline').length;
G.fresh(); run('setupSpreadsheet()');
ok('두 번 돌려도 행이 늘지 않는다', G.sheet('Config').length === cfgRows && G.sheet('Checkpoints').length === 5 &&
  G.sheet('Timeline').length === tlRows, G.sheet('Config').length);
{
  // 옛 시트: 담당 지점 열 없이 운영 중 → 다시 세팅하면 뒤에 덧붙고, 기존 값은 그대로
  const H = load();
  H.fresh(); H.run('setupSpreadsheet()');
  const p = H.ss.getSheetByName('Participants').__data();
  const i = p[0].indexOf('담당 지점');
  p.forEach(row => row.splice(i, 1));
  H.ss.getSheetByName('Participants').appendRow(p[0].map(h => h === '이름' ? '옛사람' : ''));
  H.fresh(); H.run('setupSpreadsheet()');
  const q = H.ss.getSheetByName('Participants').__data();
  ok('빠진 열은 맨 뒤에 덧붙인다', q[0][q[0].length - 1] === '담당 지점', q[0].slice(-3));
  ok('기존 행은 그대로', q[1][q[0].indexOf('이름')] === '옛사람');
}

G.addPeople([
  [S1, '가조장', '1조', '조장', '010-1000-1001', '', 'A코스(배재 시작)'],
  [S1, '나조원', '1조', '일반', '010-1000-1002', '', 'A코스(배재 시작)'],
  [S1, '다조장', '2조', '조장', '010-1000-2001', '', 'B코스(러시아 시작)'],
  [S1, '라조원', '2조', '일반', '010-1000-2002', '', 'B코스(러시아 시작)'],
  [S2, '마조장', '1조', '조장', '010-1000-4001', '', 'A코스(배재 시작)', '장년부']
]);
ok('참가자ID 가 채워진다', G.sheet('Participants').slice(1).every(r => /^P\d{4}$/.test(r[G.sheet('Participants')[0].indexOf('참가자ID')])));

// ------------------------------------------------------------------ 로그인
section('로그인');
let r = G.login('가조장', '1001');
ok('이름 + 뒷4자리', r.ok && r.data.me.participant.name === '가조장' && r.data.me.isLeader);
ok('조원 목록', r.data.me.members.length === 2, r.data.me.members);
ok('이름 사이 공백은 무시', G.login('가 조장', '1001').ok);
r = G.login('가조장', '9999');
ok('번호가 틀리면 NOT_FOUND', !r.ok && r.error.code === 'NOT_FOUND');
ok('실패는 Log 에 남는다', G.sheet('Log').slice(-1)[0].includes('NOT_FOUND'));
ok('뒷자리 4자리가 아니면 BAD_REQUEST', G.login('가조장', '12').error.code === 'BAD_REQUEST');
ok('이름이 비면 BAD_REQUEST', G.login('', '1001').error.code === 'BAD_REQUEST');
r = post({ action: 'auth.login', name: '가조장', phoneLast4: '1001', session: S2 });
ok('다른 회차를 골라도 실제 회차로 (sessionCorrected)', r.ok && r.data.me.participant.session === S1 && r.data.me.sessionCorrected === true);
run("configSet_({isAdmin:true}, {key:'SESSION_2_ACTIVE', value:'FALSE', allowNew:true})");
r = G.login('마조장', '4001');
ok('꺼진 회차는 로그인 불가', !r.ok && r.error.code === 'FORBIDDEN' && /열려 있지 않은 회차/.test(r.error.message), r.error);
run("configSet_({isAdmin:true}, {key:'SESSION_2_ACTIVE', value:'TRUE'})");

section('토큰');
const leader = G.token('가조장', '1001');
const member = G.token('나조원', '1002');
const other = G.token('다조장', '2001');
const otherMember = G.token('라조원', '2002');
ok('me', post({ action: 'me', token: leader }).data.participant.group === '1조');
const [p64, sig] = leader.split('.');
const forged = Buffer.from(JSON.stringify({ pid: 'ADMIN', exp: Date.now() + 1e9 })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_') + '.' + sig;
ok('🔴 서명이 안 맞는 토큰 (ADMIN 사칭) → UNAUTHORIZED', post({ action: 'admin.journal.list', token: forged }).error.code === 'UNAUTHORIZED');
ok('모양이 틀린 토큰', post({ action: 'me', token: 'abc' }).error.code === 'UNAUTHORIZED');
run('var __realNow = Date.now; Date.now = function () { return __realNow() + 13 * 3600 * 1000; };');
r = post({ action: 'me', token: leader });
run('Date.now = __realNow;');
ok('12시간 지나면 만료', !r.ok && /만료/.test(r.error.message), r);
ok('관리자 PIN 이 틀리면 거절', post({ action: 'admin.login', pin: '000000' }).error.code === 'UNAUTHORIZED');
const admin = G.adminToken();
ok('참가자 토큰으로 관리자 액션 불가', post({ action: 'admin.journal.list', token: leader }).error.code === 'FORBIDDEN');
ok('모르는 액션', post({ action: 'nope', token: leader }).error.code === 'BAD_REQUEST');
ok('깨진 JSON', JSON.parse(run("doPost({postData:{contents:'{'}}).getContent()")).error.code === 'BAD_REQUEST');

// ------------------------------------------------------------------ 부트스트랩
section('부트스트랩');
r = get({ action: 'bootstrap' });
ok('설정·지점·일정', r.ok && r.data.config.CAMP_NAME && r.data.checkpoints.length === 4 && r.data.timeline[S1].length > 0, r.data && Object.keys(r.data));
ok('🔴 비밀 설정(DRIVE_FOLDER_ID 등)은 내려가지 않는다', !JSON.stringify(r.data.config).includes('FOLDER_OK') && !('TOKEN_TTL_HOURS' in r.data.config));
ok('일정 시각이 HH:mm', /^\d{2}:\d{2}$/.test(r.data.timeline[S1][0].start), r.data.timeline[S1][0]);

// ------------------------------------------------------------------ 일지
section('탐험일지 — 쓰기·승인·갤러리');
const PNG = Buffer.from('fake-png').toString('base64');
let j1 = post({ action: 'journal.create', token: member, text: '배재학당에서', checkpoint: 'CP1', photo: { dataBase64: PNG, mimeType: 'image/png' } });
ok('쓰면 대기', j1.ok && j1.data.status === '대기' && j1.data.checkpoint === 'CP1', j1);
j1 = j1.data;
ok('글도 사진도 없으면 거절', post({ action: 'journal.create', token: member, text: '  ' }).error.code === 'BAD_REQUEST');
ok('이미지가 아니면 거절', post({ action: 'journal.create', token: member, photo: { dataBase64: PNG, mimeType: 'application/pdf' } }).error.code === 'BAD_REQUEST');
run("configSet_({isAdmin:true}, {key:'PHOTO_MAX_BYTES', value:'4'})");
ok('큰 사진은 TOO_LARGE', post({ action: 'journal.create', token: member, photo: { dataBase64: PNG, mimeType: 'image/png' } }).error.code === 'TOO_LARGE');
run("configSet_({isAdmin:true}, {key:'PHOTO_MAX_BYTES', value:'4000000'})");
const gallery = (tok) => post({ action: 'journal.list', token: tok }).data.items.map(j => j.id);
ok('🔴 승인 전에는 남에게 안 보인다', !gallery(other).includes(j1.id));
ok('본인에게는 보인다', gallery(member).includes(j1.id));
ok('조장은 우리 조 탭에서 본다', post({ action: 'journal.list', token: leader, scope: 'team' }).data.items.some(j => j.id === j1.id));
r = post({ action: 'journal.list', token: member, scope: 'team' });
ok('조원도 우리 조 탭을 본다 (D-057) — 확인 전인 내 글 포함', r.ok && r.data.items.some(j => j.id === j1.id), r.error || r.data.items);
ok('대기 목록에 있다', post({ action: 'admin.journal.pending', token: admin }).data.items.some(j => j.id === j1.id));

r = post({ action: 'admin.journal.review', token: admin, id: j1.id, decision: '반려', reason: '얼굴이 보입니다' });
ok('반려 + 사유', r.ok && r.data.status === '반려' && r.data.rejectReason === '얼굴이 보입니다');
r = post({ action: 'journal.update', token: member, id: j1.id, text: '다시 올립니다' });
ok('🔴 반려 글을 고치면 다시 대기 (v12)', r.ok && r.data.status === '대기' && r.data.rejectReason === '', r.data);
r = post({ action: 'admin.journal.review', token: admin, id: j1.id, decision: '승인' });
ok('승인하면 남에게 보인다', r.ok && gallery(other).includes(j1.id));
r = post({ action: 'journal.update', token: leader, id: j1.id, text: '조장이 다듬음' });
ok('조장은 우리 조 글을 고칠 수 있고, 다시 대기', r.ok && r.data.status === '대기');
ok('다른 조 조장은 못 고친다', post({ action: 'journal.update', token: other, id: j1.id, text: 'x' }).error.code === 'FORBIDDEN');
ok('다른 조원도 못 지운다', post({ action: 'journal.delete', token: otherMember, id: j1.id }).error.code === 'FORBIDDEN');
r = post({ action: 'admin.journal.update', token: admin, id: j1.id, text: '관리자 수정' });
ok('관리자 수정은 상태를 유지', r.ok && r.data.status === '대기');
const photoId = G.DRIVE.files[0].id;
r = post({ action: 'journal.update', token: member, id: j1.id, removePhoto: true });
ok('사진을 빼면 Drive 휴지통', r.ok && !r.data.photoUrl && G.DRIVE.trashed.includes(photoId), G.DRIVE);
ok('글까지 비우면 거절 (삭제를 쓰라고)', post({ action: 'journal.update', token: member, id: j1.id, text: '' }).error.code === 'BAD_REQUEST');
r = post({ action: 'journal.delete', token: member, id: j1.id });
ok('삭제는 상태=삭제 (행은 남는다, D-009)', r.ok && r.data.status === '삭제' && G.sheet('Journal').length === 2);
ok('삭제 글은 목록에서 빠진다', !post({ action: 'admin.journal.list', token: admin }).data.items.some(j => j.id === j1.id));
run("configSet_({isAdmin:true}, {key:'JOURNAL_OPEN', value:'FALSE'})");
ok('일지 마감 → CLOSED', post({ action: 'journal.create', token: member, text: '늦게' }).error.code === 'CLOSED');
run("configSet_({isAdmin:true}, {key:'JOURNAL_OPEN', value:'TRUE'})");
run("configSet_({isAdmin:true}, {key:'GALLERY_SCOPE', value:'TEAM'})");
const j2 = post({ action: 'journal.create', token: otherMember, text: '2조 글' }).data;
post({ action: 'admin.journal.review', token: admin, id: j2.id, decision: '승인' });
ok('GALLERY_SCOPE=TEAM → 다른 조 글은 안 보인다', !gallery(member).includes(j2.id) && gallery(other).includes(j2.id));
run("configSet_({isAdmin:true}, {key:'GALLERY_SCOPE', value:'ALL'})");
ok('ALL → 같은 회차 글이 보인다', gallery(member).includes(j2.id));

section('우리 조 탭 (D-057) — 앱의 기본 탭');
const teamIds = (tok) => post({ action: 'journal.list', token: tok, scope: 'team' }).data.items.map(j => j.id);
const jL = post({ action: 'journal.create', token: leader, text: '조장 글 — 아직 확인 전' }).data;
ok('🔴 조원에게 조원의 확인 전 글은 안 보인다', !teamIds(member).includes(jL.id), teamIds(member));
ok('조장은 우리 조 글을 확인 전이어도 본다 (검수·수정 권한, D-009)', teamIds(leader).includes(jL.id));
post({ action: 'admin.journal.review', token: admin, id: jL.id, decision: '승인' });
ok('승인되면 조원에게도 보인다', teamIds(member).includes(jL.id));
ok('🔴 다른 조 글은 승인돼도 우리 조 탭에 없다', !teamIds(member).includes(j2.id) && !teamIds(leader).includes(j2.id));
run("configSet_({isAdmin:true}, {key:'JOURNAL_REQUIRE_APPROVAL', value:'FALSE'})");
const jM = post({ action: 'journal.create', token: member, text: '승인 없이 바로' }).data;
ok('승인 절차를 끄면 바로 보인다', teamIds(leader).includes(jM.id) && teamIds(member).includes(jM.id));
run("configSet_({isAdmin:true}, {key:'JOURNAL_REQUIRE_APPROVAL', value:'TRUE'})");
G.addPeople([['', '바교역', '', '교역자', '010-2000-0009', '', '']]);
r = post({ action: 'journal.list', token: G.token('바교역', '0009'), scope: 'team' });
ok('조가 없는 교역자는 우리 조 탭 없음 (FORBIDDEN)', !r.ok && r.error.code === 'FORBIDDEN', r);
ok('관리자는 조 없이도 된다 (콘솔 호환)', post({ action: 'journal.list', token: admin, scope: 'team' }).ok);
ok('옛 앱의 "내 일지" 요청도 아직 받는다 (캐시된 옛 화면 호환)', post({ action: 'journal.list', token: member, scope: 'mine' }).ok);

// ------------------------------------------------------------------ 공지
section('공지 — 만들기·고치기·지우기');
G.FETCH.length = 0;
r = post({ action: 'admin.notice.save', token: admin, title: '집합 장소', body: '시청역 3번 출구', target: '전체', pinned: true });
ok('만들면 바로 게시', r.ok && r.data.id === 'N001' && r.data.status === '게시중', r);
ok('🔴 공지를 바꾸면 사본(app_cache)도 민다 (D-047)', G.FETCH.some(f => /app_cache/.test(f.url)), G.FETCH.map(f => f.url));
ok('부트스트랩에 바로 뜬다 (캐시를 비웠다)', get({ action: 'bootstrap' }).data.notices.some(n => n.id === 'N001'));
r = post({ action: 'admin.notice.save', token: admin, id: 'N001', title: '집합 장소 변경', body: '2번 출구', target: S1 });
ok('고치기', r.ok && r.data.title === '집합 장소 변경' && r.data.target === S1);
ok('없는 대상은 거절', post({ action: 'admin.notice.save', token: admin, title: 'x', target: '12/25' }).error.code === 'BAD_REQUEST');
post({ action: 'admin.notice.save', token: admin, title: '둘째', body: '' });
r = post({ action: 'admin.notice.delete', token: admin, id: 'N001' });
ok('🔴 지우기 (v13 은 Sheets.gs 가 빠져 여기서만 터졌다)', r.ok && r.data.id === 'N001', r);
ok('행이 실제로 지워진다 (D-048)', G.sheet('Notices').length === 2 && G.sheet('Notices')[1].includes('둘째'));
ok('부트스트랩에서도 사라진다', !get({ action: 'bootstrap' }).data.notices.some(n => n.id === 'N001'));
ok('지운 뒤 새 번호는 겹치지 않는다', post({ action: 'admin.notice.save', token: admin, title: '셋째' }).data.id === 'N003');
ok('없는 공지 지우기 → NOT_FOUND', post({ action: 'admin.notice.delete', token: admin, id: 'N001' }).error.code === 'NOT_FOUND');

// ------------------------------------------------------------------ 회비·설정
section('회비');
r = post({ action: 'fee.status', token: leader });
ok('조장은 조원 회비 상태', r.ok && r.data.members.length === 2 && r.data.members.every(m => m.status === '미납'));
ok('🔴 금액·납부일은 내려가지 않는다', r.data.members.every(m => Object.keys(m).join() === 'id,name,status'), r.data.members[0]);
ok('조원은 본인 것만', post({ action: 'fee.status', token: member }).data.members.length === 0);
run("configSet_({isAdmin:true}, {key:'SHOW_FEE', value:'FALSE'})");
ok('SHOW_FEE=FALSE → CLOSED', post({ action: 'fee.status', token: leader }).error.code === 'CLOSED');
run("configSet_({isAdmin:true}, {key:'SHOW_FEE', value:'TRUE'})");

section('설정');
r = post({ action: 'admin.config.set', token: admin, key: 'PROGRES_OPEN', value: 'FALSE' });
ok('🔴 오타 키는 거절하고 비슷한 키를 알려 준다', !r.ok && /PROGRESS_OPEN/.test(r.error.message), r.error);
ok('오타로 새 행이 생기지 않는다', !G.sheet('Config').some(x => x[0] === 'PROGRES_OPEN'));
r = post({ action: 'admin.config.set', token: admin, key: 'NOTICE_TICKER', value: '비 옵니다 — 우산' });
ok('바꾸면 부트스트랩에 바로', r.ok && get({ action: 'bootstrap' }).data.config.NOTICE_TICKER === '비 옵니다 — 우산');

section('사본이 꺼져 있으면');
{
  const H = camp();
  H.addPeople([[S1, '가조장', '1조', '조장', '010-1000-1001', '', 'A코스(배재 시작)']]);
  const x = H.post({ action: 'progress.set', token: H.token('가조장', '1001'), items: [{ checkpoint: 'CP1', status: '도착' }] });
  ok('Supabase 설정이 없어도 기록은 된다 (요청 없음)', x.ok && H.FETCH.length === 0);
}
{
  const H = camp({ props: { SUPABASE_URL: 'https://mirror.test', SUPABASE_SERVICE_KEY: 'sb_secret_TEST_ONLY' }, fetch: () => ({ code: 503, body: 'down' }) });
  H.addPeople([[S1, '가조장', '1조', '조장', '010-1000-1001', '', 'A코스(배재 시작)']]);
  const x = H.post({ action: 'progress.set', token: H.token('가조장', '1001'), items: [{ checkpoint: 'CP1', status: '도착' }] });
  ok('🔴 사본이 죽어도 원장(시트)에는 들어간다', x.ok && x.data[0].status === '도착');
  ok('실패는 Log 에 HTTP_503', H.sheet('Log').some(l => l.includes('HTTP_503')));
}

done();
