#!/usr/bin/env node
/**
 * ────────────────────────────────────────────────────────────────
 * stamp-assets.js · v15 · 2026-09-26
 * ────────────────────────────────────────────────────────────────
 * 변경 이력 (최근 5건 — 전체는 docs-dev/spec/DECISIONS.md · git log)
 *  v15   2026-09-26  파일 버전 표시 시작
 *  —     2026-09-17  자산 주소에 내용 해시를 붙여 브라우저 캐시를 깬다
 *
 * 버전: vN = GAS 배포 번호. vN.k = 서버는 vN 그대로 두고 앱·도구만 고친 k번째.
 *       — 는 버전 기록을 시작하기 전(v12 이전)의 변경.
 * 🔴 이 파일을 고치면 맨 위 줄(이름·버전·날짜)과 이력을 함께 고친다 (CLAUDE.md).
 * ────────────────────────────────────────────────────────────────
 */

/**
 * stamp-assets.js — HTML 이 참조하는 자산에 **내용 해시**를 붙인다.
 *
 * 왜 필요한가: GitHub Pages 는 응답 헤더를 바꿀 수 없다. `_headers` 같은 장치가
 * 없어서 `Cache-Control` 을 우리가 정하지 못한다. 그래서 `app.js` 를 고쳐도
 * 브라우저가 들고 있던 옛 파일을 계속 쓴다 — "고쳤는데 화면에 안 보인다".
 *
 * 해결: 참조 주소에 내용 해시를 붙인다.
 *   ./assets/js/app.js  →  ./assets/js/app.js?v=3f9a1c22
 * 내용이 바뀌면 주소가 바뀌니 브라우저가 **무조건 새로 받는다.**
 * 내용이 그대로면 해시도 그대로라 **캐시를 최대한 재사용한다.**
 *
 * 왜 타임스탬프나 커밋 해시가 아닌가:
 * - 타임스탬프는 안 바뀐 파일까지 매번 새로 받게 만든다.
 * - 커밋 해시는 이 스크립트가 만든 변경이 다시 커밋을 바꾸므로 순환한다.
 * 내용 해시는 둘 다 아니다.
 *
 * 실행: node tools/stamp-assets.js        (고친다)
 *       node tools/stamp-assets.js --check (고치지 않고 어긋난 곳만 알린다 — 테스트용)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');

/** 스탬프를 붙일 HTML. demo.html 은 자산을 통째로 품고 있어 대상이 아니다. */
const PAGES = ['index.html', 'admin.html'];

/** 로컬 자산을 가리키는 href/src. 외부 주소(https://…)와 data: 는 건드리지 않는다. */
const REF = /(\b(?:href|src)=")(\.\/[^"?#]+)(\?v=[0-9a-f]+)?(#[^"]*)?(")/g;

function hashOf(file) {
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 8);
}

/**
 * 한 페이지의 참조를 훑어 새 내용으로 만든다.
 * 반환: { next, changes: [{ ref, from, to }] }
 */
function stampPage(pageName) {
  const file = path.join(DOCS, pageName);
  const src = fs.readFileSync(file, 'utf8');
  const changes = [];

  const next = src.replace(REF, function (all, head, ref, oldQuery, hash, tail) {
    const target = path.join(DOCS, ref);
    // 참조는 하는데 파일이 없으면 스탬프를 못 붙인다. 조용히 넘기지 않고 알린다.
    if (!fs.existsSync(target)) {
      changes.push({ ref: ref, from: oldQuery || '(없음)', to: null, missing: true });
      return all;
    }
    const want = '?v=' + hashOf(target);
    if (oldQuery !== want) changes.push({ ref: ref, from: oldQuery || '(없음)', to: want });
    return head + ref + want + (hash || '') + tail;
  });

  return { file: file, next: next, src: src, changes: changes };
}

function run(checkOnly) {
  let stale = 0;
  let missing = 0;

  PAGES.forEach(function (page) {
    const r = stampPage(page);
    r.changes.forEach(function (c) {
      if (c.missing) {
        missing++;
        console.error('  ✗ ' + page + ' → ' + c.ref + ' : 파일이 없습니다');
      } else {
        stale++;
        console.log('  ' + (checkOnly ? '✗' : '·') + ' ' + page + ' → ' + c.ref +
          '  ' + c.from + ' → ' + c.to);
      }
    });
    if (!checkOnly && r.next !== r.src) fs.writeFileSync(r.file, r.next);
  });

  if (missing) {
    console.error('\n참조하는 파일이 없습니다. 주소를 확인해 주세요.');
    return 1;
  }
  if (checkOnly) {
    if (stale) {
      console.error('\n자산 버전이 어긋났습니다. `node tools/stamp-assets.js` 를 실행하고 커밋하세요.');
      return 1;
    }
    console.log('  ✓ 자산 버전이 모두 최신입니다.');
    return 0;
  }
  console.log(stale ? '\n' + stale + '곳을 갱신했습니다.' : '\n바꿀 것이 없습니다.');
  return 0;
}

if (require.main === module) {
  process.exit(run(process.argv.indexOf('--check') >= 0));
}

module.exports = { stampPage: stampPage, hashOf: hashOf, PAGES: PAGES };
