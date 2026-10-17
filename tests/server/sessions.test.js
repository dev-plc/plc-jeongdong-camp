/**
 * 참여 일자로 사람을 가른다 (D-062, GAS v21).
 * 같은 이름·번호라도 회차가 다르면 다른 사람 — 로그인은 쓸 수 있는 회차 중 가까운 회차 행으로.
 * 같은 회차 안에서 겹칠 때만 AMBIGUOUS. 함께: 회차 추가의 두 함정(날짜 이름, 시각 복사) · toHm_ · 미러 지금 갱신.
 */
const { camp } = require('../lib/gas');
const { ok, section, done } = require('../lib/check');

const G = camp({ props: { SUPABASE_URL: 'https://mirror.test', SUPABASE_SERVICE_KEY: 'sb_secret_TEST_ONLY' } });
const { run, login, setToday, answers } = G;

const S1 = '10/31(토)', S2 = '11/07(토)', PRE = '사전답사(10/17)';
run(`configSet_({isAdmin:true}, {key:'SESSION_3', value:${JSON.stringify(PRE)}, allowNew:true});
     configSet_({isAdmin:true}, {key:'SESSION_3_DATE', value:'2026-10-17', allowNew:true});
     configSet_({isAdmin:true}, {key:'SESSION_3_ACTIVE', value:'TRUE', allowNew:true}); clearConfigCache();`);

// [참여 일자, 이름, 조, 역할, 연락처, 담당 지점, 코스]
G.addPeople([
  [PRE, '이주영', '1조', '조장', '010-1000-6308', '', ''],
  [S1, '이주영', '2조', '일반', '010-1000-6308', '', ''],      // 같은 사람, 본 캠프
  [S1, '박한나', '1조', '조장', '010-1000-7227', '', ''],
  [S1, '박한나', '3조', '일반', '010-1000-7227', '', ''],      // 같은 회차 안 중복 — 진짜 충돌
  [PRE, '김정민', '1조', '일반', '010-1000-7107', '', ''],
  [S2, '김정민', '1조', '일반', '010-1000-7107', '', ''],
  ['', '정수정', '', '일반', '010-1000-5982', '', ''],          // 참여 일자 없는 행 — 로그인 불가 행
  [S2, '정수정', '2조', '일반', '010-1000-5982', '', '']
]);
const sessionOf = (n, d) => { const r = login(n, d); return r.ok ? r.data.me.participant.session : 'ERR:' + r.error.code; };

section('🔴 회차가 다르면 다른 사람 — 날짜로 고른다');
setToday('2026-10-17');
ok('사전답사 날(10/17)에는 사전답사 행', sessionOf('이주영', '6308') === PRE, sessionOf('이주영', '6308'));
setToday('2026-10-20');
ok('🔴 회차 사이(10/20)에는 가까운 다음 회차(10/31) 행 — 예전엔 AMBIGUOUS', sessionOf('이주영', '6308') === S1, sessionOf('이주영', '6308'));
setToday('2026-10-31');
ok('본 캠프 날에는 본 캠프 행', sessionOf('이주영', '6308') === S1);
setToday('2026-12-01');
ok('모두 지났으면 가장 최근 회차 (11/07)', sessionOf('김정민', '7107') === S2, sessionOf('김정민', '7107'));
setToday('2026-10-10');
ok('모두 앞이면 가장 가까운 회차 (10/17)', sessionOf('김정민', '7107') === PRE, sessionOf('김정민', '7107'));

section('로그인할 수 없는 행은 후보에서 뺀다');
run(`configSet_({isAdmin:true}, {key:'SESSION_3_ACTIVE', value:'FALSE', allowNew:true}); clearConfigCache();`);
setToday('2026-10-17');
ok('🔴 사전답사를 끄면 그날도 본 캠프 행 (비활성 회차 제외)', sessionOf('이주영', '6308') === S1, sessionOf('이주영', '6308'));
run(`configSet_({isAdmin:true}, {key:'SESSION_3_ACTIVE', value:'TRUE', allowNew:true}); clearConfigCache();`);
ok('참여 일자 없는 행은 빼고 11/07 행으로', sessionOf('정수정', '5982') === S2, sessionOf('정수정', '5982'));

section('같은 회차 안의 중복은 여전히 막는다');
setToday('2026-10-31');
ok('🔴 같은 회차 두 행 → AMBIGUOUS', sessionOf('박한나', '7227') === 'ERR:AMBIGUOUS');

section('명단 점검 — 같은 회차 안에서만 ❌');
const report = run('checkDuplicates()');
const block = (title) => { const i = report.indexOf(title); if (i < 0) return ''; const rest = report.slice(i); const j = rest.indexOf('\n\n'); return j < 0 ? rest : rest.slice(0, j); };
const bad = block('❌ 로그인 충돌');
const info = block('ℹ 회차별로 두 행인 사람');
ok('🔴 같은 회차 중복(박한나)은 ❌', bad.includes('박한나') && bad.includes(S1), bad);
ok('🔴 회차만 다른 이주영·김정민은 ❌ 가 아니다', !bad.includes('이주영') && !bad.includes('김정민'), bad);
ok('회차만 다른 사람은 ℹ 안내로', info.includes('이주영') && info.includes('김정민') && info.includes('다른 사람으로'), info);
ok('참여 일자 없는 행(정수정)은 충돌로 세지 않는다', !bad.includes('정수정') && !info.includes('정수정'), report);

section('회차 추가 — 날짜 모양 이름은 받지 않는다');
['2026-10-17', '2026.10.17', '10/17', '10-17', '10월 17일', '2026년 10월 17일'].forEach(t => {
  ok('날짜 모양: ' + t, run(`looksLikeDate_(${JSON.stringify(t)})`) === true);
});
['사전답사(10/17)', '10/31(토)', '11/07(토)', '사전답사'].forEach(t => {
  ok('글자 붙은 이름은 통과: ' + t, run(`looksLikeDate_(${JSON.stringify(t)})`) === false);
});
const before = run('sessions_().length');
answers.push('2026-10-24');
run('addSession()');
ok('🔴 날짜만 적으면 회차를 만들지 않는다', run('sessions_().length') === before);
ok('안내: "사전답사(10/17)" 처럼', G.UI.some(u => u.alert && /사전답사\(10\/17\)" 처럼/.test(u.alert)));

section('회차 추가 — 일정 시각을 시각 그대로 복사');
// 10/31 일정표의 시각 칸을 실제 시트처럼 Date 로 바꿔 둔다 (시각 표기 통일 뒤의 모습, D-040)
run(`(function () {
  var sh = getSheet_(SHEETS.TIMELINE), idx = headerIndex_(SHEETS.TIMELINE);
  var rows = readTable_(SHEETS.TIMELINE).filter(function (r) { return str_(r[COL.SESSION]) === ${JSON.stringify(S1)}; });
  rows.forEach(function (r) {
    ['시작', '종료'].forEach(function (h) {
      var m = /^(\\d{1,2}):(\\d{2})$/.exec(str_(r[h])); if (!m) return;
      sh.getRange(r.__row, idx[h]).setValue(new Date(Date.UTC(1899, 11, 30, Number(m[1]) - 9, Number(m[2]))));
    });
  });
  invalidateTable_(SHEETS.TIMELINE);
})()`);
const srcFirst = run(`toHm_(readTable_(SHEETS.TIMELINE).filter(function (r) { return str_(r[COL.SESSION]) === ${JSON.stringify(S1)}; })[0]['시작'])`);
answers.push('사전답사(10/24)', '2026-10-24', 'OK', 'OK');
run('addSession()');
const copied = run(`readTable_(SHEETS.TIMELINE).filter(function (r) { return str_(r[COL.SESSION]) === '사전답사(10/24)'; }).map(function (r) { return [Object.prototype.toString.call(r['시작']), toHm_(r['시작']), String(r['시작'])]; })`);
ok('일정표가 복사됐다', copied.length > 0, copied.length);
ok('🔴 복사된 시각은 Date 그대로 (글자 아님)', copied.every(c => c[0] === '[object Date]'), copied.slice(0, 2));
ok('🔴 앱에는 HH:mm 으로 (원본 첫 행과 같다)', copied[0][1] === srcFirst && /^\d{2}:\d{2}$/.test(copied[0][1]), [copied[0][1], srcFirst]);

section('toHm_ — 글자로 들어간 시각도 읽는다');
const hm = (v) => run(`toHm_(${JSON.stringify(v)})`);
ok('🔴 "Sat Dec 30 1899 09:30:00 GMT+0827 (한국 표준시)" → 09:30', hm('Sat Dec 30 1899 09:30:00 GMT+0827 (한국 표준시)') === '09:30');
ok('"14:00" 은 그대로', hm('14:00') === '14:00');
ok('"9:30" 은 지금처럼 그대로', hm('9:30') === '9:30');
ok('빈 값은 빈 값', hm('') === '');
ok('시각이 없는 글자는 그대로', hm('오전') === '오전');

section('미러 지금 갱신 — 진행 사본도 시트에 맞춘다');
G.FETCH.length = 0;
G.fresh();
run('mirrorPushNow()');
const urls = G.FETCH.map(f => f.method + ' ' + f.url);
ok('🔴 진행 사본의 낡은 행을 지운다 (시트에서 지운 진행이 남지 않게)',
  G.FETCH.some(f => /progress_cache/.test(f.url) && /updated_at=lt/.test(f.url) && /delete/i.test(f.method || '')), urls);

done();
