/**
 * 출발 안내 (D-063, GAS v22) — Courses `비고`(예: "시청역 3번 출구")가 조 정보 `courseNote` 로 간다.
 * 코스 매칭 규칙(정확 일치 · 앞글자)은 경로와 같고, 경로가 기본 순서로 되돌아가면 출구도 비운다.
 * 캠프 모드의 명단 사본은 `buildMe_` 결과를 그대로 올리므로 사본에도 같은 값이 있어야 한다.
 */
const { camp } = require('../lib/gas');
const { ok, section, done } = require('../lib/check');

const S1 = '10/31(토)';
const G = camp({ props: { SUPABASE_URL: 'https://mirror.test', SUPABASE_SERVICE_KEY: 'sb_secret_TEST_ONLY' } });
const { run, login } = G;

G.fresh();
run(`appendRow_(SHEETS.COURSES, { '코스명': '1번 경로', '방문 순서': 'CP2,CP3,CP4,CP1', '비고': '시청역 3번 출구' });
     appendRow_(SHEETS.COURSES, { '코스명': '2번 경로', '방문 순서': 'CP2,CP4', '비고': '시청역 12번 출구' });
     readTable_(SHEETS.COURSES).forEach(function (r) {
       if (r['코스명'] === 'A코스(배재 시작)') updateRow_(SHEETS.COURSES, r.__row, { '비고': '  시청역 10번 출구 ' });
     });`);

// [참여 일자, 이름, 조, 역할, 연락처, 담당 지점, 코스]
G.addPeople([
  [S1, '가조장', '1조', '조장', '010-1000-1001', '', '1번 경로'],
  [S1, '나조원', '1조', '일반', '010-1000-1002', '', '1번 경로'],
  [S1, '다조장', '2조', '조장', '010-1000-2001', '', 'A코스'],          // 앞글자만 같다
  [S1, '라조장', '3조', '조장', '010-1000-3001', '', '2번 경로'],       // 방문 순서가 지점을 다 덮지 못한다
  [S1, '마조장', '4조', '조장', '010-1000-4001', '', '없는 코스'],
  [S1, '바조장', '5조', '조장', '010-1000-5001', '', 'B코스(러시아 시작)'], // 비고 빈칸
  [S1, '사스태', '', '스태프', '010-2000-0001', 'CP1', '']
]);
const team = (n, d) => { const r = login(n, d); return r.ok ? r.data.me.team : 'ERR:' + r.error.code; };

section('조 정보에 출발 안내 — Courses 비고');
let t = team('가조장', '1001');
ok('🔴 코스명이 같으면 그 코스의 비고', t.courseNote === '시청역 3번 출구', t);
ok('경로는 그 코스 순서 그대로', t.route.join() === 'CP2,CP3,CP4,CP1', t.route);
ok('조원에게도 같은 값', team('나조원', '1002').courseNote === '시청역 3번 출구');
t = team('다조장', '2001');
ok('앞글자만 같아도 그 코스 (경로와 같은 규칙) · 앞뒤 공백은 뺀다', t.courseNote === '시청역 10번 출구' && t.route[0] === 'CP1', t);
t = team('라조장', '3001');
ok('🔴 방문 순서가 지점을 다 덮지 못하면 경로는 기본 순서, 출구는 비운다 (첫 지점과 짝이 안 맞는다)',
  t.courseNote === '' && t.route.join() === 'CP1,CP2,CP3,CP4', t);
ok('없는 코스면 비어 있다', team('마조장', '4001').courseNote === '');
ok('비고가 빈 코스면 비어 있다', team('바조장', '5001').courseNote === '');
const st = login('사스태', '0001');
ok('지점 스태프는 조 정보가 없다 (그대로)', st.ok && st.data.me.team === null, st.data && st.data.me.team);

section('내 정보(me)도 같다');
const tok = G.token('가조장', '1001');
const me = G.post({ action: 'me', token: tok });
ok('me 의 조 정보에도 courseNote', me.ok && me.data.team.courseNote === '시청역 3번 출구', me.error || me.data.team);

section('🔴 캠프 모드 명단 사본에도 실린다 (buildMe_ 그대로, D-055 칸은 그대로)');
G.fresh(); run('installCampSync()');
const posts = G.FETCH.filter(f => /\/rest\/v1\/people_cache/.test(f.url) && f.method === 'post');
const rows = posts.length ? JSON.parse(posts[posts.length - 1].payload) : [];
const row = rows.find(x => x.me.participant.name === '가조장');
ok('사본의 me.team.courseNote', row && row.me.team.courseNote === '시청역 3번 출구', row && row.me.team);
ok('행의 칸은 그대로', rows.length > 0 && rows.every(x => Object.keys(x).sort().join() === 'keys,me,pid,session,token,token_prev,updated_at'));

done();
