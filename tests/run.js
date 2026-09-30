#!/usr/bin/env node
/**
 * 테스트 러너 — 스위트마다 따로 돌리고(서로 상태가 새지 않게) 합계를 낸다.
 *
 *   node tests/run.js            전부
 *   node tests/run.js server     서버(GAS 모의)만 — 몇 초
 *   node tests/run.js ui         화면(데모 + Chromium)만
 *   node tests/run.js tools      도구·생성물만
 *   node tests/run.js -v         스위트 출력을 전부 보인다 (기본은 실패한 스위트만)
 *
 * 하나라도 실패하거나 죽으면 1 로 끝난다. 화면 스위트가 Playwright 가 없어 건너뛰면 **건너뜀** 으로 따로 센다.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DIR = __dirname;
const GROUPS = {
  server: fs.readdirSync(path.join(DIR, 'server')).filter(f => f.endsWith('.test.js')).map(f => 'server/' + f),
  ui: fs.readdirSync(path.join(DIR, 'ui')).filter(f => f.endsWith('.test.js')).map(f => 'ui/' + f),
  tools: ['tools.test.js']
};

const args = process.argv.slice(2);
const verbose = args.includes('-v');
const picked = args.filter(a => !a.startsWith('-'));
const groups = picked.length ? picked : Object.keys(GROUPS);
const unknown = groups.filter(g => !GROUPS[g]);
if (unknown.length) { console.error('모르는 묶음: ' + unknown.join(', ') + ' (server · ui · tools)'); process.exit(2); }

let totalPass = 0, totalFail = 0, broken = 0, skipped = 0;
const rows = [];
const t0 = Date.now();

groups.forEach(g => GROUPS[g].forEach(rel => {
  const t = Date.now();
  const r = spawnSync(process.execPath, [path.join(DIR, rel)], { encoding: 'utf8', cwd: path.join(DIR, '..') });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = /(\d+) passed, (\d+) failed\s*$/.exec(out.trim());
  const sec = ((Date.now() - t) / 1000).toFixed(1) + 's';
  let line;
  if (/^SKIPPED$/m.test(out)) { skipped++; line = `  ⚠ ${rel}  건너뜀 (Playwright 없음)`; }
  else if (!m) { broken++; line = `  ✗ ${rel}  죽음 (exit ${r.status})`; }
  else {
    const p = +m[1], f = +m[2];
    totalPass += p; totalFail += f;
    if (f || r.status !== 0) { if (!f) broken++; line = `  ✗ ${rel}  ${p} passed, ${f} failed`; }
    else line = `  ✓ ${rel}  ${p}`;
  }
  rows.push(line + '  ' + sec);
  const failedSuite = line.startsWith('  ✗');
  if (verbose || failedSuite) console.log('\n── ' + rel + '\n' + out.trimEnd());
  if (!verbose) console.log(line + '  ' + sec);
}));

if (verbose) console.log('\n' + rows.join('\n'));
console.log(`\n합계 ${totalPass} passed, ${totalFail} failed` +
  (broken ? `, 죽은 스위트 ${broken}` : '') + (skipped ? `, 건너뜀 ${skipped}` : '') +
  `  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
process.exit(totalFail || broken ? 1 : 0);
