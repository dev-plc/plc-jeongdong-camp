/**
 * 명단 사본 (D-055) — 캠프 모드 동안 그 회차 인원을 Supabase people_cache 에.
 *   누가 올라가나(참여 일자 = 지금 회차, 🔴 공란 제외) · 연락처 원문 없음 · 로그인 키 규칙 = GAS 로그인 규칙 ·
 *   토큰이 GAS 에서 검증되고 날짜로 고정 · 내 정보가 GAS `me` 와 같음 · 끄면 지움.
 */
const crypto = require('crypto');
const { camp, load } = require('../lib/gas');
const { ok, section, done } = require('../lib/check');

const S1 = '10/31(토)', S2 = '11/07(토)';
const PROPS = { SUPABASE_URL: 'https://mirror.test', SUPABASE_SERVICE_KEY: 'sb_secret_TEST_ONLY' };
const key = (name, d) => crypto.createHash('sha256').update(name + '|' + d).digest('hex');

const PEOPLE = [
  [S1, '가조장', '1조', '조장', '010-1000-1001', '', 'A코스(배재 시작)'],
  [S1, '나조원', '1조', '일반', '010-1000-1002', '', 'A코스(배재 시작)'],
  [S1, '다스태', '', '스태프', '010-2000-0001', 'CP1', ''],
  [S1, '홍길동 1234', '2조', '일반', '010-1000-9999', '', 'B코스(러시아 시작)'],
  [S1, '같은이', '2조', '일반', '010-1000-5555', '', 'B코스(러시아 시작)'],
  [S1, '같은이', '3조', '일반', '010-1000-5555', '', 'C코스(보구여관 시작)'],
  ['', '라교역', '', '교역자', '010-2000-0002', '', ''],
  ['', '마스태', '', '스태프', '010-2000-0003', 'CP2', ''],
  [S2, '바조장', '1조', '조장', '010-1000-4001', '', 'A코스(배재 시작)', '장년부']
];

function setup(opt) {
  const G = camp(Object.assign({ props: PROPS }, opt));
  G.addPeople(PEOPLE);
  return G;
}
const peopleCalls = (G) => G.FETCH.filter(f => /\/rest\/v1\/people_cache/.test(f.url));
const upserted = (G) => { const u = peopleCalls(G).filter(f => f.method === 'post'); return u.length ? JSON.parse(u[u.length - 1].payload) : []; };
const byName = (rows, n) => rows.find(r => r.me.participant.name === n);

// ------------------------------------------------------------------ 캠프 모드
section('캠프 모드가 아니면 올리지 않는다');
let G = setup();
let r = G.run('mirrorPeopleSync()');
ok('꺼져 있으면 안 올린다', !r.ok && /캠프 모드/.test(r.reason) && peopleCalls(G).length === 0, r);

section('캠프 모드 켜기 → 바로 올린다');
G.fresh(); G.run('installCampSync()');
ok('CAMP_MODE 표시', G.props.get('CAMP_MODE') === 'TRUE');
ok('10분 트리거', G.TRIGGERS.length === 1 && G.TRIGGERS[0].fn === 'mirrorDaily');
let rows = upserted(G);
ok('켜자마자 올렸다', rows.length > 0, peopleCalls(G).map(f => f.method + ' ' + f.url));
ok('알림에 회차·인원', G.UI.some(u => u.alert && u.alert.includes(S1 + ' 6명')), G.UI.filter(u => u.alert).map(u => u.alert));

section('🔴 누가 올라가나 — 참여 일자가 지금 회차인 사람만');
const names = rows.map(x => x.me.participant.name).sort();
ok('10/31 여섯 명 (스태프 포함)', names.join() === ['가조장', '나조원', '다스태', '홍길동', '같은이', '같은이'].sort().join(), names);
ok('🔴 참여 일자 공란 교역자·스태프는 없다', !names.includes('라교역') && !names.includes('마스태'));
ok('다른 회차(11/07)는 없다', !names.includes('바조장'));
ok('모든 행이 지금 회차', rows.every(x => x.session === S1));
ok('공란 교역자는 여전히 GAS 로 로그인된다', G.login('라교역', '0002').ok);

section('🔴 연락처 원문은 없다');
const raw = JSON.stringify(rows);
ok('전화번호 문자열 없음', !/010-\d{4}-\d{4}/.test(raw) && !/0101000/.test(raw));
ok('행의 칸은 정해진 것뿐', rows.every(x => Object.keys(x).sort().join() === 'keys,me,pid,session,token,token_prev,updated_at'), Object.keys(rows[0]));
ok('내 정보에도 연락처 칸 없음', !/phone|연락처/.test(raw));

section('로그인 키 = GAS 로그인 규칙');
ok('이름|연락처 뒷자리', byName(rows, '가조장').keys.includes(key('가조장', '1001')));
const hong = byName(rows, '홍길동');
ok('이름 끝 4자리 붙은 사람 → 이름 두 가지 × 4자리 두 가지', hong.keys.length === 4 &&
  [key('홍길동1234', '9999'), key('홍길동1234', '1234'), key('홍길동', '9999'), key('홍길동', '1234')].every(k => hong.keys.includes(k)), hong.keys.length);
ok('🔴 키마다 GAS 로그인도 된다', [['홍길동', '9999'], ['홍길동', '1234'], ['홍길동 1234', '9999'], ['홍 길동', '1234']].every(([n, d]) => G.login(n, d).ok));
const twins = rows.filter(x => x.me.participant.name === '같은이');
ok('🔴 두 사람이 겹치는 키는 뺀다 (GAS 가 AMBIGUOUS 로 판단)', twins.length === 2 && twins.every(x => x.keys.length === 0), twins.map(x => x.keys));
ok('  └ GAS 도 실제로 AMBIGUOUS', G.login('같은이', '5555').error.code === 'AMBIGUOUS');
ok('키는 중복 없이', rows.every(x => new Set(x.keys).size === x.keys.length));

section('토큰 — GAS 가 검증 · 서울 날짜로 고정');
const ga = byName(rows, '가조장');
let me = G.post({ action: 'me', token: ga.token });
ok('🔴 사본 토큰으로 GAS me 가 된다', me.ok && me.data.participant.id === ga.pid, me.error);
ok('어제 토큰(token_prev)도 된다', G.post({ action: 'me', token: ga.token_prev }).ok);
const payload = (t) => JSON.parse(Buffer.from(t.split('.')[0], 'base64').toString());
ok('오늘 토큰은 모레 0시(KST)에 끝난다', payload(ga.token).exp === Date.parse('2026-11-02T00:00:00+09:00'), new Date(payload(ga.token).exp));
ok('어제 토큰은 내일 0시', payload(ga.token_prev).exp === Date.parse('2026-11-01T00:00:00+09:00'));
ok('🔴 내 정보 = GAS me 응답 그대로', JSON.stringify(ga.me) === JSON.stringify(me.data), { mirror: ga.me, gas: me.data });
const st = byName(rows, '다스태');
ok('스태프 내 정보에 담당 지점', st.me.mode === 'station' && st.me.station.code === 'CP1');
const na = byName(rows, '나조원');
ok('조원 내 정보 = GAS me', JSON.stringify(na.me) === JSON.stringify(G.post({ action: 'me', token: na.token }).data));

G.FETCH.length = 0;
G.fresh(); G.run('mirrorDaily()');
ok('🔴 같은 날 다시 올려도 같은 토큰', byName(upserted(G), '가조장').token === ga.token);
G.setToday('2026-10-30');
G.FETCH.length = 0;
G.fresh(); G.run('mirrorDaily()');
const eve = byName(upserted(G), '가조장');
G.setToday('2026-10-31');
G.FETCH.length = 0;
G.fresh(); G.run('mirrorDaily()');
ok('날이 바뀌면 새 토큰, 전날 것은 token_prev 로 이어진다', eve.token !== ga.token && ga.token_prev === eve.token);

section('순서 — 넣고 나서 낡은 행을 지운다 · 메타');
G.FETCH.length = 0;
G.fresh(); G.run('mirrorPeopleSync()');
const calls = peopleCalls(G).map(f => f.method);
ok('upsert → 낡은 행 DELETE', calls.join() === 'post,delete', calls);
ok('DELETE 는 updated_at 조건부', /updated_at=lt\./.test(peopleCalls(G)[1].url), peopleCalls(G)[1].url);
ok('app_cache 에 people_meta', G.FETCH.some(f => /app_cache/.test(f.url) && /people_meta/.test(f.payload)));
ok('merge-duplicates (pid 로 덮어쓰기)', peopleCalls(G)[0].headers.Prefer === 'resolution=merge-duplicates');

section('명단이 바뀌면 다음 동기화에 반영');
G.addPeople([[S1, '새사람', '1조', '일반', '010-1000-7777', '', 'A코스(배재 시작)']]);
G.FETCH.length = 0;
G.fresh(); G.run('mirrorDaily()');
ok('새 사람이 올라간다', !!byName(upserted(G), '새사람'));
ok('조장 내 정보의 조원 목록도 새로', byName(upserted(G), '가조장').me.members.some(m => m.name === '새사람'));

section('회차가 바뀌면');
G.setToday('2026-11-03');
G.FETCH.length = 0;
G.fresh(); G.run('mirrorDaily()');
ok('11/03 → 다음 회차 11/07 인원', upserted(G).map(x => x.me.participant.name).join() === '바조장', upserted(G).map(x => x.me.participant.name));
ok('지난 회차 행은 청소 DELETE 가 지운다', peopleCalls(G).some(f => f.method === 'delete' && /updated_at=lt\./.test(f.url)));
G.setToday('2026-10-31');

section('끄기 → 지운다');
G.FETCH.length = 0;
G.fresh(); G.run('stopCampSync()');
ok('CAMP_MODE 해제', !G.props.has('CAMP_MODE'));
ok('하루 1회 트리거로', G.TRIGGERS.length === 1);
ok('🔴 명단 사본 DELETE (조건부 — 전부)', peopleCalls(G).some(f => f.method === 'delete' && /pid=not\.is\.null/.test(f.url)), peopleCalls(G).map(f => f.url));
ok('알림: 지웠습니다', G.UI.some(u => u.alert && /명단 사본을 지웠습니다/.test(u.alert)));
G.FETCH.length = 0;
G.fresh(); G.run('mirrorDaily()');
ok('🔴 꺼진 뒤 매일 트리거도 다시 지운다 (올리지는 않는다)', peopleCalls(G).length === 1 && peopleCalls(G)[0].method === 'delete');
G.FETCH.length = 0;
G.fresh(); G.run('mirrorPushNow()');
ok('꺼진 상태의 "미러 지금 갱신" 은 명단을 올리지 않는다', !peopleCalls(G).some(f => f.method === 'post'));

section('실패해도 멈추지 않는다');
{
  const H = setup({ fetch: (url) => (/people_cache/.test(url) ? { code: 500, body: 'boom' } : null) });
  H.fresh(); H.run('installCampSync()');
  ok('켜기는 된다 (트리거·표시)', H.props.get('CAMP_MODE') === 'TRUE' && H.TRIGGERS.length === 1);
  ok('알림: 올리지 못했다 · GAS 로 된다', H.UI.some(u => u.alert && /올리지 못했습니다/.test(u.alert) && /GAS/.test(u.alert)));
  ok('Log 에 mirror.people HTTP_500', H.sheet('Log').some(l => l.includes('mirror.people') && l.includes('HTTP_500')));
  H.fresh(); H.run('stopCampSync()');
  ok('끄기: 지우지 못했다 · 내일 다시', H.UI.some(u => u.alert && /지우지 못했습니다/.test(u.alert)));
  ok('그래도 캠프 모드는 꺼진다', !H.props.has('CAMP_MODE'));
}
{
  const H = camp();                              // Supabase 설정 없음
  H.addPeople(PEOPLE);
  H.fresh(); H.run('installCampSync()');
  ok('설정이 없으면 요청 없이 알림만', H.FETCH.length === 0 && H.UI.some(u => u.alert && /Supabase 설정 없음/.test(u.alert)));
}
{
  const H = setup();
  H.run("configSet_({isAdmin:true}, {key:'SESSION_1_ACTIVE', value:'FALSE', allowNew:true}); configSet_({isAdmin:true}, {key:'SESSION_2_ACTIVE', value:'FALSE', allowNew:true});");
  H.fresh(); H.run('installCampSync()');
  ok('열린 회차가 없으면 올리지 않고 지운다', !peopleCalls(H).some(f => f.method === 'post') &&
    peopleCalls(H).some(f => f.method === 'delete' && /pid=not\.is\.null/.test(f.url)));
}
{
  const H = setup();
  H.run("configSet_({isAdmin:true}, {key:'LOGIN_ALLOW_NAME_DIGITS', value:'FALSE'})");
  H.fresh(); H.run('installCampSync()');
  const h = byName(upserted(H), '홍길동');
  ok('LOGIN_ALLOW_NAME_DIGITS=FALSE → 이름 끝 4자리 키 없음 (GAS 도 거절)', h.keys.length === 2 && !h.keys.includes(key('홍길동', '1234')) &&
    !H.login('홍길동', '1234').ok && H.login('홍길동', '9999').ok, h.keys.length);
}

done();
