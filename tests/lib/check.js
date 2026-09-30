/**
 * 아주 작은 단언 도구. 스위트 하나 = 파일 하나, 끝에서 done() 이 합계를 찍고 종료 코드를 정한다.
 * 러너(tests/run.js)는 마지막 줄 "N passed, M failed" 를 읽어 합친다.
 */
let pass = 0, fail = 0;
const failed = [];

function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else {
    fail++; failed.push(name);
    console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
  }
}

function section(title) { console.log('\n' + title); }

function done() {
  if (failed.length) console.log('\n실패:\n' + failed.map(n => '  ✗ ' + n).join('\n'));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

module.exports = { ok, section, done };
