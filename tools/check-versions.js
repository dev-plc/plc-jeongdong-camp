#!/usr/bin/env node
/**
 * ────────────────────────────────────────────────────────────────
 * check-versions.js · v15 · 2026-09-26
 * ────────────────────────────────────────────────────────────────
 * 변경 이력 (최근 5건 — 전체는 docs-dev/spec/DECISIONS.md · git log)
 *  v15   2026-09-26  처음 만듦 — 파일 버전 헤더를 검사한다 (D-049)
 *
 * 버전: vN = GAS 배포 번호. vN.k = 서버는 vN 그대로 두고 앱·도구만 고친 k번째.
 *       — 는 버전 기록을 시작하기 전(v12 이전)의 변경.
 * 🔴 이 파일을 고치면 맨 위 줄(이름·버전·날짜)과 이력을 함께 고친다 (CLAUDE.md).
 * ────────────────────────────────────────────────────────────────
 */

/**
 * check-versions.js — 파일마다 붙은 **버전 헤더**가 앞뒤가 맞는지 본다 (D-049).
 *
 * 헤더는 사람이 고친다. 사람이 고치는 것은 반드시 어긋난다 — 그래서 기계가 본다.
 *
 *   1. 헤더가 있다:     `<파일 이름> · vN · YYYY-MM-DD`
 *   2. 이름이 파일과 같다 (복사해 붙이다 이름을 안 바꾸는 실수)
 *   3. 이력의 첫 줄이 헤더와 같은 버전·날짜다 (헤더만 올리고 이력을 빠뜨리는 실수)
 *   4. `.gs` 는 `var VERSION_X = 'vN'` 이 헤더와 같다 — health 가 이 값을 알려 주므로,
 *      어긋나면 배포 확인이 거짓말을 한다
 *   5. 🔴 **GAS 버전은 정수**다 — `.gs` 에 `vN.k` 가 붙으면 안 된다. 서버를 고쳤다면
 *      새로 배포해야 하고, 배포하면 번호가 하나 오른다.
 *
 * 실행: node tools/check-versions.js      (어긋난 곳이 있으면 1 로 끝난다)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** 헤더를 달아야 하는 파일. 새 파일을 만들면 여기에 더한다. */
const FILES = [
  'gas/Auth.gs', 'gas/Code.gs', 'gas/Journal.gs', 'gas/MasterSync.gs',
  'gas/Mirror.gs', 'gas/Setup.gs', 'gas/Sheets.gs',
  'docs/assets/js/config.js', 'docs/assets/js/api.js', 'docs/assets/js/ui.js',
  'docs/assets/js/app.js', 'docs/assets/js/admin.js',
  'docs/assets/css/app.css',
  'tools/build-demo.js', 'tools/stamp-assets.js', 'tools/check-versions.js'
];

const HEAD = /^[ *]*(\S+) · (v\d+(?:\.\d+)?) · (\d{4}-\d{2}-\d{2})\s*$/m;
const FIRST_ENTRY = /변경 이력[^\n]*\n[ *]*(v\d+(?:\.\d+)?|—)\s+(\d{4}-\d{2}-\d{2})\s+\S/;
const CONST = /^var (VERSION_[A-Z]+) = '([^']*)';/m;

function check(rel) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const top = src.split('\n').slice(0, 12).join('\n');   // 헤더는 맨 위에 있어야 한다
  const errs = [];

  const h = HEAD.exec(top);
  if (!h) return ['헤더가 없습니다 (`<이름> · vN · YYYY-MM-DD`)'];
  const [, name, ver, date] = h;

  if (name !== path.basename(rel)) errs.push('헤더의 이름이 ' + name + ' 입니다 (파일은 ' + path.basename(rel) + ')');

  const e = FIRST_ENTRY.exec(src.slice(0, 2000));
  if (!e) errs.push('변경 이력이 없습니다');
  else if (e[1] !== ver || e[2] !== date) {
    errs.push('이력 첫 줄(' + e[1] + ' ' + e[2] + ')이 헤더(' + ver + ' ' + date + ')와 다릅니다');
  }

  if (rel.endsWith('.gs')) {
    if (/\.\d+$/.test(ver)) errs.push('.gs 에 ' + ver + ' — GAS 버전은 정수입니다. 서버를 고쳤으면 새로 배포합니다');
    const c = CONST.exec(src);
    if (!c) errs.push("`var VERSION_X = '" + ver + "';` 이 없습니다 — health 가 이 파일을 못 봅니다");
    else if (c[2] !== ver) errs.push(c[1] + " = '" + c[2] + "' 가 헤더(" + ver + ')와 다릅니다');
  }
  return errs;
}

let bad = 0;
FILES.forEach(function (rel) {
  const errs = check(rel);
  if (!errs.length) return;
  bad++;
  console.log('✗ ' + rel);
  errs.forEach(function (m) { console.log('    ' + m); });
});

if (bad) {
  console.log('\n' + bad + '개 파일의 버전 헤더가 어긋났습니다.');
  process.exit(1);
}
console.log('  ✓ 버전 헤더 ' + FILES.length + '개 파일 모두 맞습니다.');
