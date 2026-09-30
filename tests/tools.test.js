/**
 * 도구 — 버전 헤더 검사가 실제로 무는지 · 생성물(demo.html · ?v= 해시)이 최신인지.
 *
 * check-versions 는 저장소 사본(임시 폴더)에서 일부러 어긋나게 만들어 돌린다 — 원본은 건드리지 않는다.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { ok, section, done } = require('./lib/check');

const ROOT = path.join(__dirname, '..');

/** tools/ gas/ docs/ 를 임시 폴더에 복사한다. */
function copyRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'camp-tools-'));
  ['tools', 'gas', 'docs'].forEach(d => fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true }));
  return dir;
}
const node = (dir, script, args) => spawnSync(process.execPath, [path.join(dir, script)].concat(args || []), { cwd: dir, encoding: 'utf8' });
const edit = (dir, rel, fn) => { const p = path.join(dir, rel); fs.writeFileSync(p, fn(fs.readFileSync(p, 'utf8'))); };

section('버전 헤더 (check-versions)');
let r = node(ROOT, 'tools/check-versions.js');
ok('지금 저장소는 통과', r.status === 0, r.stdout + r.stderr);

const cases = [
  ['헤더 버전만 올리고 이력을 빠뜨림', 'docs/assets/js/app.js', s => s.replace(/(app\.js · )v[\d.]+/, '$1v99.1'), /이력 첫 줄/],
  ['.gs 에 vN.k', 'gas/Code.gs', s => s.replace(/(Code\.gs · )v\d+/, '$1v18.1').replace(/(\n[ *]+)v\d+(\s+\d{4}-\d{2}-\d{2}\s+파일 끝)/, '$1v18.1$2'), /정수/],
  ['VERSION 상수를 안 고침', 'gas/Auth.gs', s => s.replace(/var VERSION_AUTH = '[^']*'/, "var VERSION_AUTH = 'v1'"), /VERSION_AUTH = 'v1'/],
  ['🔴 끝 표시를 안 고침 (D-054)', 'gas/Setup.gs', s => s.replace(/var END_SETUP = '[^']*';/, "var END_SETUP = 'v1';"), /END_SETUP = 'v1'/],
  ['🔴 끝 표시 뒤에 코드가 붙음', 'gas/Sheets.gs', s => s + '\nfunction extra() {}\n', /맨 마지막 줄/],
  ['끝 표시 이름이 다른 파일 것', 'gas/Mirror.gs', s => s.replace(/var END_MIRROR = /, 'var END_JOURNAL = '), /END_JOURNAL 입니다/],
  ['복사해 붙이고 이름을 안 바꿈', 'tools/stamp-assets.js', s => s.replace('stamp-assets.js ·', 'build-demo.js ·'), /헤더의 이름/]
];
cases.forEach(([name, rel, fn, want]) => {
  const dir = copyRepo();
  edit(dir, rel, fn);
  const x = node(dir, 'tools/check-versions.js');
  ok(name + ' → 막는다', x.status === 1 && want.test(x.stdout), x.stdout.trim().split('\n').slice(0, 3).join(' / '));
  fs.rmSync(dir, { recursive: true, force: true });
});

section('생성물이 최신인가');
r = node(ROOT, 'tools/stamp-assets.js', ['--check']);
ok('?v= 해시가 최신 (stamp-assets --check)', r.status === 0, r.stdout + r.stderr);
{
  const dir = copyRepo();
  const x = node(dir, 'tools/build-demo.js');
  const fresh = fs.readFileSync(path.join(dir, 'docs/demo.html'), 'utf8');
  const committed = fs.readFileSync(path.join(ROOT, 'docs/demo.html'), 'utf8');
  ok('🔴 docs/demo.html = build-demo 결과 (손으로 고치지 않았다 · 다시 만들었다)', x.status === 0 && fresh === committed,
    x.status !== 0 ? x.stderr : '다름 — node tools/build-demo.js 를 돌리고 아티팩트도 다시 올리세요');
  fs.rmSync(dir, { recursive: true, force: true });
}

section('🔴 공개 저장소 — 비밀 키가 없다');
const scan = ['docs/assets/js/config.js', 'docs/demo.html'].concat(
  fs.readdirSync(path.join(ROOT, 'tests'), { recursive: true }).filter(f => f.endsWith('.js')).map(f => 'tests/' + f));
const leaks = scan.filter(rel => {
  const s = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  return /sb_secret_(?!TEST_ONLY)[A-Za-z0-9]/.test(s) || /service_role["']?\s*[:=]\s*["']eyJ/.test(s);
});
ok('config.js · demo · tests 에 sb_secret_/service_role 키 없음', leaks.length === 0, leaks);

done();
