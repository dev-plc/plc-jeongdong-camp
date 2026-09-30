/**
 * 파일 끝 표시 (D-054) — health 가 잘린 붙여넣기를 알린다.
 * 파일 하나를 바꿔 넣어(잘림·섞임·옛 파일) problems 가 제대로 말하는지 본다.
 */
const fs = require('fs');
const path = require('path');
const { load, FILES, GAS_DIR } = require('../lib/gas');
const { ok, section, done } = require('../lib/check');

function health(patch) {
  const G = load({ patch });
  const h = G.get({ action: 'health' });
  h.onOpen = G.run('typeof onOpen');
  return h;
}
const head = f => /· (v\d+) ·/.exec(fs.readFileSync(path.join(GAS_DIR, f), 'utf8'))[1];

section('지금 그대로');
let h = health();
ok('health 성공', h.ok === true, h);
ok('versions 일곱 개 = 헤더', FILES.every(f => h.data.versions[f] === head(f)), h.data.versions);
ok('ends 일곱 개 = 헤더', FILES.every(f => h.data.ends[f] === head(f)), h.data.ends);
ok('problems 가 []', Array.isArray(h.data.problems) && h.data.problems.length === 0, h.data.problems);
ok('onOpen 이 있다', h.onOpen === 'function');

section('🔴 v16 사고 재현 — Setup.gs 가 onOpen 앞에서 잘림');
h = health({ 'Setup.gs': s => s.slice(0, s.indexOf('function onOpen()')) });
ok('onOpen 이 없다 (메뉴가 사라진 상태)', h.onOpen === 'undefined');
ok('versions 는 멀쩡 — 예전 health 로는 못 봤다', h.data.versions['Setup.gs'] === head('Setup.gs'));
ok('🔴 ends 가 null', h.data.ends['Setup.gs'] === null, h.data.ends['Setup.gs']);
ok('🔴 problems 가 Setup.gs 와 할 일을 말한다', h.data.problems.length === 1 &&
  /Setup\.gs: 끝이 잘렸습니다/.test(h.data.problems[0]) && /Raw/.test(h.data.problems[0]), h.data.problems);

section('섞여 붙음 · 옛 파일 · 빠진 파일');
h = health({ 'Sheets.gs': s => s.replace(/var END_SHEETS = 'v\d+';/, "var END_SHEETS = 'v1';") });
ok('앞뒤 버전이 다르면 "섞여 붙었습니다"', h.data.problems.length === 1 &&
  new RegExp('Sheets\\.gs: 앞\\(' + head('Sheets.gs') + '\\)과 끝\\(v1\\)').test(h.data.problems[0]), h.data.problems);
h = health({ 'Mirror.gs': s => s.replace(/^var VERSION_MIRROR[^\n]*\n/m, '').replace(/\n[^\n]*\nvar END_MIRROR[^\n]*\n?$/, '\n') });
ok('옛 파일은 한 줄 ("버전 표시가 없습니다")', h.ok && h.data.problems.length === 1 &&
  /Mirror\.gs: 버전 표시가 없습니다/.test(h.data.problems[0]), h.data.problems);
h = health({ 'Journal.gs': () => '' });
ok('빈 파일(안 붙임)도 알린다', h.ok && h.data.problems.some(p => /^Journal\.gs: 버전 표시가 없습니다/.test(p)), h.data.problems);

section('끝 표시는 맨 마지막 줄');
FILES.forEach(f => {
  const lines = fs.readFileSync(path.join(GAS_DIR, f), 'utf8').split('\n').filter(l => l.trim());
  ok(f + ' 마지막 줄 = END 표시', /^var END_[A-Z]+ = 'v\d+';$/.test(lines[lines.length - 1]), lines[lines.length - 1]);
});

done();
