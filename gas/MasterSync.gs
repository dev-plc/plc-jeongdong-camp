/**
 * ────────────────────────────────────────────────────────────────
 * MasterSync.gs · v15 · 2026-09-26
 * ────────────────────────────────────────────────────────────────
 * 변경 이력 (최근 5건 — 전체는 docs-dev/spec/DECISIONS.md · git log)
 *  v15   2026-09-26  파일 버전 표시 시작
 *  —     2026-09-18  Supabase 읽기 미러 1단계
 *  —     2026-09-17  회차를 3개 이상 쓸 수 있게 (사전답사 리허설)
 *  —     2026-09-17  빠르게 입력한 값이 동기화에서 누락되던 문제 수정
 *  —     2026-09-17  붙여넣기가 조용히 사라지던 동기화 버그 수정 + 명단 반영 메뉴
 *
 * 버전: vN = GAS 배포 번호. vN.k = 서버는 vN 그대로 두고 앱·도구만 고친 k번째.
 *       — 는 버전 기록을 시작하기 전(v12 이전)의 변경.
 * 🔴 이 파일을 고치면 맨 위 줄(이름·버전·날짜)과 이력을 함께 고친다 (CLAUDE.md).
 * ────────────────────────────────────────────────────────────────
 */
var VERSION_MASTERSYNC = 'v15';   // 헤더의 버전과 같아야 한다. health 가 이 값을 알려 준다.

/**
 * MasterSync.gs — 행정팀 시트 동기화 (행정팀 스크립트 + 앱 통합본)
 *
 * 행정팀이 쓰던 스크립트를 앱과 한 프로젝트에서 충돌 없이 돌도록 합친 것이다.
 * 원래 기능 넷을 모두 유지한다:
 *   · 설문지 성도여부 X → `신규DB` 동기화 (주민번호로 생년월일·만나이 계산)
 *   · `DB참조` 기본정보를 실무 탭 전체에 갱신
 *   · 헤더 일치 검증
 *   · **탭 간 양방향 동기화** — 이름을 입력하면 마스터에서 당겨오고,
 *     값을 고치면 같은 이름을 가진 다른 탭에도 전파된다 (onEdit)
 *
 * ⚠ 시트에 있던 **기존 동기화 스크립트는 지우고 이 파일 하나만 두어야 한다.**
 *   Apps Script 는 파일이 달라도 전역 스코프를 공유해서, 같은 이름의 함수가 둘이면
 *   나중에 로드된 것만 남는다 — **에러 없이** 하나가 죽는다.
 *   실제로 `onOpen` 과 `validateHeaders` 가 그 상태였다.
 *
 * 앱과 맞물리며 달라진 점 (셋 다 실제로 문제가 됐던 것들):
 *   1. `onOpen` 은 Setup.gs 한 곳에만 둔다. 여기서는 메뉴를 "추가"만 한다.
 *   2. 앱이 관리하는 탭(Config·Journal·Progress…)은 동기화·검증 대상에서 제외한다.
 *      제외하지 않으면 헤더 검증이 그 탭 9개를 전부 빨갛게 칠한다.
 *   3. 원장 탭 이름은 `resolveSheetName_('Participants')` 로 찾는다(`마스터` 우선).
 *
 * 역할 분담 — **기본정보는 DB참조가 주인이다**:
 *   · DB참조에 있는 열(성별·만나이·핸드폰·생년월일·이전교회…)
 *       → 메뉴 `전체 기본정보 갱신` 만 건드린다. onEdit 은 전파하지 않는다.
 *   · 그 밖의 캠프 운영 값(조 배정·역할·입금 여부·배정 코스…)
 *       → onEdit 이 탭 간 양방향으로 전파한다.
 *   둘 다 건드리게 두면 서로 덮어쓰며 싸운다.
 *
 * 참고: onEdit 같은 단순 트리거는 **사람이 시트를 편집할 때만** 실행된다.
 *       앱(웹앱)이 시트에 쓰는 값에는 반응하지 않으므로 동기화 무한루프는 생기지 않는다.
 */

/**
 * 한 번의 붙여넣기에서 자동 전파를 시도할 최대 칸 수.
 * 넘으면 전파를 포기하고 `명단 반영` 메뉴를 쓰라고 알린다.
 */
var SYNC_MAX_CELLS = 2000;

/** DB참조 탭 이름. 기본정보의 단일 진실. */
var SYNC_DB_SHEET = 'DB참조';

/** 설문지 응답에서 신규 대상자를 모으는 탭. */
var SYNC_NEW_DB_SHEET = '신규DB';

/**
 * DB참조 탭이 없을 때 쓰는 폴백 제외 목록.
 * 평소에는 DB참조 헤더에서 자동으로 뽑는다(syncReadonlyHeaders_).
 */
var SYNC_READONLY_FALLBACK = ['성별', '나이', '만나이', '연락처', '핸드폰', '휴대폰', '휴대전화', '전화번호',
  '생년월일', '등록일', '이전교회'];

/**
 * onEdit 이 탭 간에 **전파하면 안 되는** 열.
 *
 * DB참조에 있는 열은 DB참조가 주인이다(메뉴 `전체 기본정보 갱신` 담당).
 * onEdit 이 같이 퍼뜨리면 두 기능이 서로 덮어쓰며 싸운다.
 * 실행 단위로 한 번만 계산한다.
 */
var __syncReadonly = null;

function syncReadonlyHeaders_() {
  if (__syncReadonly) return __syncReadonly;
  var out = SYNC_READONLY_FALLBACK.slice();
  try {
    var db = getSpreadsheet_().getSheetByName(SYNC_DB_SHEET);
    if (db) {
      headerRow_(db).forEach(function (h) {
        if (h && h !== SYNC_PRIMARY_KEY && out.indexOf(h) < 0) out.push(h);
      });
    }
  } catch (e) {
    // DB참조를 못 읽어도 폴백으로 계속 간다.
  }
  __syncReadonly = out;
  return out;
}

/** 행을 식별하는 기준 열. */
var SYNC_PRIMARY_KEY = '이름';

/** Setup.gs 의 onOpen 이 호출한다. 여기서 직접 onOpen 을 정의하지 않는다(위 주석 1번). */
function addMasterSyncMenu_(ui) {
  ui.createMenu('🔄 동기화 관리')
    .addItem('👥 명단 반영 (설문지 → 마스터 → 실무 탭)', 'syncRoster')
    .addItem('📥 설문지 신규 대상자(X) 신규DB 동기화', 'syncFormToNewDb')
    .addSeparator()
    .addItem('⚡ 전체 기본정보 갱신 (DB참조 기준)', 'syncAllBasicInfoFromDB')
    .addItem('🔍 헤더 일치 여부 검사', 'validateHeaders')
    .addToUi();
}

/** 앱이 관리하는 탭인지. 이 탭들은 사람이 편집해도 동기화하지 않는다. */
function isAppSheet_(sheetName) {
  return appManagedSheetNames_().indexOf(sheetName) >= 0;
}

/**
 * 동기화·검증에서 통째로 빼는 탭.
 * 앱 탭 9개 + DB참조/신규DB(원천) + 설문지 응답(원본).
 * 세 순회 함수(onEdit 전파·기본정보 갱신·헤더 검증)가 모두 이걸 쓴다.
 */
function isSyncExcludedSheet_(sheetName) {
  if (isAppSheet_(sheetName)) return true;
  if (sheetName === SYNC_DB_SHEET || sheetName === SYNC_NEW_DB_SHEET) return true;
  return sheetName.indexOf('설문') >= 0 || sheetName.indexOf('Form') >= 0 ||
         sheetName.indexOf('응답') >= 0;
}

// ---------------------------------------------------------------- 동기화

function onEdit(e) {
  if (!e || !e.range) return;

  // ── 🔴 여기에 문서 락이 있었다. 지금은 없다. ────────────────────────────
  // 예전 코드는 waitLock(3000) 이 실패하면 **그냥 return** 했다.
  // 구글시트의 단순 트리거는 동시에 여러 개가 돈다. 한 칸씩 빠르게 치면
  // 실행이 겹치고, 뒤엣것은 락을 못 잡아 **조용히 사라졌다** —
  // 재시도도, 큐도, 알림도, 로그도 없이. "빠르게 입력하면 다 스킵된다"의 정체다.
  //
  // 그 락은 지키는 게 없었다:
  //  · 웹앱의 withLock_ 은 getScriptLock() 이고 여기는 getDocumentLock() 이었다.
  //    **애초에 서로 배제하지 않는다.**
  //  · 웹앱은 마스터(Participants)를 **읽기만** 한다. 겹쳐 쓸 일이 없다.
  //  · onEdit 끼리는 편집된 칸마다 **서로 다른 셀**에 쓴다. 행을 넣거나 지우지도
  //    않으므로 읽고-고쳐-쓰기 경합이 없다.
  // 그래서 지키는 것 없이 데이터만 버리고 있었다 (D-025).
  // 락이 진짜 필요한 곳은 applyScheduleEdit_ 하나뿐이라 거기로 옮겼다.

  var sheet = null;
  try {
    // 🔴 e.source.getActiveSheet() 가 아니라 e.range.getSheet() 다.
    // 실행이 밀리는 동안 사용자가 다른 탭으로 넘어가면 '활성 탭' 은 이미 딴 곳이다.
    // 그러면 값은 편집된 범위에서 읽으면서 헤더는 엉뚱한 탭에서 읽는다.
    sheet = e.range.getSheet();
    var sheetName = sheet.getName();

    // ── 캐시 무효화는 **아래 조기 return 보다 먼저** 해야 한다. ──────────────
    // Config·Notices·Timeline·Checkpoints·Courses 는 전부 '앱 전용 탭' 이라
    // isAppSheet_ 에 걸려 곧바로 빠져나간다. 이 줄을 아래로 내리면
    // 에러 없이 **아무 일도 일어나지 않고**, 설정 변경이 최대 5분 늦게 반영된다.
    // (앱이 고치는 경로인 configSet_ 은 스스로 캐시를 비우므로 여기선 사람 편집만 본다.)
    if (isCachedSourceSheet_(sheetName)) {
      clearConfigCache();
      // 공개 데이터가 바뀐 **바로 그 순간**이다. 미러도 같이 민다 (D-032).
      // mirrorPush 는 설정이 없으면 아무 일도 안 하고, 실패해도 던지지 않는다 —
      // 미러 때문에 사람이 시트를 고치는 일이 막히면 안 된다.
      mirrorPush();
    }

    // Config 탭에서 회차 라벨(SESSION_1/2)을 고치면 5개 탭을 따라 바꾼다.
    // 이것도 조기 return 앞이어야 한다 — Config 는 앱 탭이다.
    if (sheetName === SHEETS.CONFIG) {
      withScheduleLock_(e, function () { applyScheduleEdit_(e, sheet); });
      return;
    }

    // 앱 전용 탭·원천 탭(DB참조·신규DB·설문지)은 (캐시 무효화 말고는) 손대지 않는다.
    if (isSyncExcludedSheet_(sheetName)) return;

    // ── 붙여넣기는 **범위 전체**가 한 번에 온다. ────────────────────────────
    // 구글시트는 여러 셀을 붙여넣어도 onEdit 을 한 번만 부르고 e.range 에 그 범위를
    // 통째로 담아 준다. 예전에는 range.getValue()(= 좌상단 한 칸)만 읽어
    // **나머지를 조용히 버렸다** — 조 배정 9칸을 붙여넣으면 1명만 반영됐다.
    var range = e.range;
    var firstRow = range.getRow();
    var firstCol = range.getColumn();
    var numRows = range.getNumRows();
    var numCols = range.getNumColumns();

    if (firstRow + numRows - 1 < 2) return; // 헤더만 고친 경우

    // 붙여넣기가 너무 크면 칸마다 전파하다 실행 시간 한도에 걸린다.
    // 일부만 조용히 반영하느니 **아무것도 안 하고 알린다.**
    if (numRows * numCols > SYNC_MAX_CELLS) {
      syncToast_(e, numRows * numCols + '칸을 한 번에 붙여넣어 자동 전파를 건너뛰었습니다.\n' +
        '메뉴 → 🔄 동기화 관리 → 👥 명단 반영 으로 한꺼번에 맞추세요.', '⚠ 전파 생략');
      return;
    }

    var headers = headerRow_(sheet);
    var nameColIndex = headers.indexOf(SYNC_PRIMARY_KEY) + 1;
    if (nameColIndex === 0) return;

    var ss = e.source;
    var masterName = resolveSheetName_('Participants');
    var readonly = syncReadonlyHeaders_();
    var values = range.getValues();

    // 이 실행에서 전파할 헤더를 먼저 모은다.
    // 대상 탭을 고를 때 쓴다 — '조 배정' 만 고쳤으면 그 열이 없는 회비 탭은 아예 안 읽는다.
    var editedHeaders = [];
    for (var c = 0; c < numCols; c++) {
      var h = headers[firstCol + c - 1];
      if (!h || h === SYNC_PRIMARY_KEY) continue;
      if (readonly.indexOf(h) >= 0) continue;
      if (editedHeaders.indexOf(h) < 0) editedHeaders.push(h);
    }

    // 편집된 행들의 '이름' 을 **한 번에** 읽는다.
    // 예전에는 칸마다 getRange().getValue() 로 이름을 다시 읽어 왕복이 칸 수만큼 늘었다.
    var nameByRow = readNameColumn_(sheet, firstRow, numRows, nameColIndex,
      firstCol, numCols, values);

    // 무거운 준비는 전부 **필요할 때 한 번만** 한다.
    var targets = null;      // 전파 대상 탭 (loadPushTargets_)
    var masterIndex = null;  // 마스터 인덱스 (pullFromMaster_)
    var writes = [];         // 모아 두었다가 마지막에 한꺼번에 쓴다

    for (var i = 0; i < numRows; i++) {
      var row = firstRow + i;
      if (row === 1) continue; // 헤더 행

      for (var j = 0; j < numCols; j++) {
        var colIdx = firstCol + j;
        var header = headers[colIdx - 1];
        if (!header) continue;
        if (readonly.indexOf(header) >= 0) continue;

        var value = values[i][j];

        // [기능 1] 이름을 입력하면 마스터에서 나머지 값을 당겨온다.
        if (header === SYNC_PRIMARY_KEY) {
          if (sheetName === masterName) continue;
          if (!masterIndex) masterIndex = loadMasterIndex_(ss, masterName);
          pullFromMaster_(masterIndex, sheet, headers, row, value);
          continue;
        }

        // [기능 2] 일반 값 수정 → 같은 이름을 가진 다른 탭에도 반영.
        var targetName = nameByRow[row];
        if (!targetName) continue;
        if (!targets) targets = loadPushTargets_(ss, sheetName, editedHeaders);
        queuePush_(writes, targets, header, targetName, value);
      }
    }

    flushWrites_(writes);

  } catch (error) {
    // 조용히 삼키지 않는다. 운영진은 실행 로그를 보지 않는다.
    console.error('동기화 중 오류 발생: ' + error.message);
    syncToast_(e, '값을 다른 탭에 반영하다 실패했습니다.\n' + error.message, '⚠ 동기화 오류');
  }
}

/** 시트 상단에 알린다. e.source 가 없어도(테스트 등) 죽지 않는다. */
function syncToast_(e, message, title) {
  try {
    var ss = (e && e.source) || getSpreadsheet_();
    ss.toast(message, title, 15);
  } catch (ignored) { /* 알림 실패가 본 작업을 막지 않게 한다. */ }
}

/**
 * 회차 라벨 변경만 직렬화한다.
 * 5개 탭 수백 행을 읽고 고쳐 쓰므로 두 실행이 겹치면 실제로 깨진다.
 * 못 잡으면 **조용히 넘기지 않고 알린다** — 이게 예전 onEdit 이 하던 실수다.
 */
function withScheduleLock_(e, fn) {
  var lock = LockService.getDocumentLock();
  try {
    lock.waitLock(10000);
  } catch (error) {
    syncToast_(e, '다른 변경이 처리 중이라 일정 반영을 못 했습니다.\n' +
      '잠시 후 값을 다시 입력해 주세요.', '⚠ 일정 반영 실패');
    return;
  }
  try {
    fn();
  } finally {
    lock.releaseLock();
  }
}

/**
 * 편집된 행들의 `이름` 을 한 번에 읽는다.
 * 이름 열이 편집 범위 안에 있으면 방금 붙여넣은 값이 맞으므로 거기서 가져온다.
 */
function readNameColumn_(sheet, firstRow, numRows, nameColIndex, firstCol, numCols, values) {
  var out = {};
  var inRange = nameColIndex >= firstCol && nameColIndex < firstCol + numCols;

  if (inRange) {
    for (var i = 0; i < numRows; i++) {
      out[firstRow + i] = String(values[i][nameColIndex - firstCol] || '').trim();
    }
    return out;
  }

  var col = sheet.getRange(firstRow, nameColIndex, numRows, 1).getValues();
  for (var k = 0; k < numRows; k++) {
    out[firstRow + k] = String(col[k][0] || '').trim();
  }
  return out;
}

/**
 * 마스터의 헤더와 `이름 → 행 값` 색인을 **실행당 한 번만** 만든다.
 * 예전 pullFromMaster_ 는 이름 칸마다 마스터 전체를 다시 읽었다 —
 * 이름 9개를 붙여넣으면 145행짜리 마스터를 9번 읽었다.
 */
function loadMasterIndex_(ss, masterName) {
  var sheet = ss.getSheetByName(masterName);
  if (!sheet) return { headers: [], rowByName: {} };

  var headers = headerRow_(sheet);
  var nameIdx = headers.indexOf(SYNC_PRIMARY_KEY);
  if (nameIdx < 0) return { headers: headers, rowByName: {} };

  var lastRow = sheet.getLastRow();
  var rowByName = {};
  if (lastRow >= 2) {
    var data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    for (var i = 0; i < data.length; i++) {
      var key = String(data[i][nameIdx] || '').trim();
      if (key && !rowByName.hasOwnProperty(key)) rowByName[key] = data[i];
    }
  }
  return { headers: headers, rowByName: rowByName };
}

/**
 * 하위 탭에 이름을 입력하면 마스터에서 나머지 값을 당겨온다.
 * 행 하나를 **한 번 읽어 배열에서 고친 뒤 한 번에 쓴다** —
 * 예전에는 채울 열마다 setValue() 를 불러 행 하나에 최대 14번 썼다.
 */
function pullFromMaster_(masterIndex, sheet, headers, editedRow, name) {
  var key = String(name || '').trim();
  if (!key) return;

  var sourceRow = masterIndex.rowByName[key];
  if (!sourceRow) return;

  var readonly = syncReadonlyHeaders_();
  var current = sheet.getRange(editedRow, 1, 1, headers.length).getValues()[0];
  var changed = false;

  for (var j = 0; j < headers.length; j++) {
    var header = headers[j];
    if (!header) continue;
    if (header === SYNC_PRIMARY_KEY) continue;
    if (readonly.indexOf(header) >= 0) continue;

    var idx = masterIndex.headers.indexOf(header);
    if (idx < 0) continue;
    if (current[j] === sourceRow[idx]) continue;

    current[j] = sourceRow[idx];
    changed = true;
  }

  if (changed) sheet.getRange(editedRow, 1, 1, headers.length).setValues([current]);
}

/**
 * 전파 대상 탭을 고르고 **필요한 것만** 읽어 둔다.
 *
 * 두 단계로 나눈 이유: 한 칸 고칠 때마다 실무 탭 전체를 읽으면 실행이 몇 초씩 걸리고,
 * 그 느림이 곧 동시 실행 충돌이 된다(D-025).
 *  ① 헤더 행만 읽어 **편집된 열을 가진 탭**만 남긴다 — `조 배정` 만 고쳤으면
 *     그 열이 없는 `회비` 는 여기서 걸러져 데이터를 아예 안 읽는다.
 *  ② 남은 탭에서 **`이름` 열 1열만** 읽는다. 145×6 이 145×1 이 된다.
 */
function loadPushTargets_(ss, sourceSheetName, editedHeaders) {
  var out = [];
  if (!editedHeaders || !editedHeaders.length) return out;

  ss.getSheets().forEach(function (sheet) {
    var name = sheet.getName();
    if (name === sourceSheetName) return;
    if (isSyncExcludedSheet_(name)) return;

    var lastRow = sheet.getLastRow();
    if (sheet.getLastColumn() === 0 || lastRow < 2) return;

    var headers = headerRow_(sheet);
    var nameIdx = headers.indexOf(SYNC_PRIMARY_KEY);
    if (nameIdx < 0) return;

    // ① 편집된 열을 하나도 안 가진 탭은 여기서 끝. 데이터를 읽지 않는다.
    var useful = false;
    for (var h = 0; h < editedHeaders.length; h++) {
      if (headers.indexOf(editedHeaders[h]) >= 0) { useful = true; break; }
    }
    if (!useful) return;

    // ② 이름 열 1열만 읽는다.
    var col = sheet.getRange(2, nameIdx + 1, lastRow - 1, 1).getValues();
    var rowByName = {};
    for (var i = 0; i < col.length; i++) {
      var key = String(col[i][0] || '').trim();
      // 같은 이름이 여럿이면 **첫 행**만 잡는다(기존 동작 유지).
      if (key && !rowByName.hasOwnProperty(key)) rowByName[key] = i + 2;
    }
    out.push({ sheet: sheet, headers: headers, rowByName: rowByName, id: out.length });
  });
  return out;
}

/**
 * 같은 이름을 가진 다른 탭의 같은 헤더 칸에 넣을 값을 **모아 둔다.**
 * 바로 쓰지 않는 이유: 여러 열을 붙여넣으면 칸 수만큼 setValue() 왕복이 늘어난다.
 * flushWrites_ 가 탭·행 단위로 묶어 한 번에 쓴다.
 */
function queuePush_(writes, targets, editedHeader, targetName, newValue) {
  var key = String(targetName).trim();
  targets.forEach(function (t) {
    var col = t.headers.indexOf(editedHeader);
    if (col < 0) return;
    var row = t.rowByName[key];
    if (!row) return;
    writes.push({ target: t, row: row, col: col, value: newValue });
  });
}

/**
 * 모아 둔 쓰기를 탭·행 단위로 묶어 내보낸다.
 *
 * 한 행 안에서 **붙어 있는 열끼리** 묶어 setValues() 한 번으로 쓴다.
 * 읽지 않고 쓰기만 하므로 왕복이 늘지 않는다 —
 * 한 열만 내리 붙여넣으면 행마다 1회, 세 열을 한 번에 붙여넣으면 그것도 행마다 1회다.
 */
function flushWrites_(writes) {
  if (!writes.length) return;

  var groups = {};
  var order = [];
  writes.forEach(function (w) {
    var k = w.target.id + '#' + w.row;
    if (!groups[k]) {
      groups[k] = { target: w.target, row: w.row, cells: [] };
      order.push(k);
    }
    groups[k].cells.push(w);
  });

  var touched = {};
  order.forEach(function (k) {
    var group = groups[k];
    var cells = group.cells.slice().sort(function (a, b) { return a.col - b.col; });

    var runStart = 0;
    for (var i = 1; i <= cells.length; i++) {
      // 마지막이거나, 앞 칸과 열이 붙어 있지 않으면 거기서 한 덩어리를 끊는다.
      if (i < cells.length && cells[i].col === cells[i - 1].col + 1) continue;

      var run = cells.slice(runStart, i);
      var values = run.map(function (c) { return c.value; });
      group.target.sheet
        .getRange(group.row, run[0].col + 1, 1, run.length)
        .setValues([values]);
      runStart = i;
    }
    touched[group.target.sheet.getName()] = true;
  });

  Object.keys(touched).forEach(function (name) { invalidateTable_(name); });
}

// ---------------------------------------------------------------- 명단 반영

/**
 * 설문지 응답 탭을 찾는다. 탭 이름이 여러 번 바뀌어서 후보를 넓게 본다.
 */
function findFormSheet_(ss) {
  var found = ss.getSheetByName('Form_Responses') || ss.getSheetByName('설문지 응답 시트2');
  if (found) return found;
  ss.getSheets().forEach(function (sh) {
    if (found) return;
    var n = sh.getName();
    if (n.indexOf('Form') >= 0 || n.indexOf('응답') >= 0 || n.indexOf('설문') >= 0) found = sh;
  });
  return found;
}

/**
 * **명단이 아래로 흘러가게 한다.** 설문지 → 마스터 → 실무 탭 순으로 빠진 행을 채운다.
 *
 * 왜 자동 트리거가 아니라 메뉴인가:
 * - 폼 제출은 `onEdit` 이 잡지 못한다(설치형 `onFormSubmit` 트리거가 따로 필요하다).
 * - 행 추가는 되돌리기가 번거롭다. **미리보기 → 확인** 단계가 있는 편이 안전하다.
 * - 요청의 핵심은 '자동'이 아니라 **'무엇이 달라지는지 확인하는 편의성'** 이었다.
 *
 * 하는 일:
 *  ① 설문지에만 있는 사람을 마스터에 추가한다. `이름` 과 `핸드폰` 만 가져온다.
 *     **`캠프 대상`(부서)은 비워 둔다** — 설문의 자기신고를 그대로 믿지 않는다.
 *     주민등록번호·이메일도 가져오지 않는다(개인정보는 원천 탭에만 둔다).
 *  ② 마스터에만 있는 사람을 `회비`·`조편성` 같은 실무 탭에 추가하고,
 *     마스터에 있는 값으로 나머지 열을 채운다.
 *  ③ 실무 탭에만 있고 마스터에 없는 이름은 **지우지 않고 알리기만** 한다.
 */
function syncRoster() {
  var ss = getSpreadsheet_();
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) { ui = null; }
  var say = function (msg) { if (ui) ui.alert(msg); else ss.toast(msg, '명단 반영', 10); };

  var masterName = resolveSheetName_('Participants');
  var master = ss.getSheetByName(masterName);
  if (!master) { say('원장 탭(' + masterName + ')을 찾을 수 없습니다.'); return; }

  var masterHeaders = headerRow_(master);
  var mNameIdx = masterHeaders.indexOf(SYNC_PRIMARY_KEY);
  if (mNameIdx < 0) { say(masterName + ' 탭에 \'' + SYNC_PRIMARY_KEY + '\' 열이 없습니다.'); return; }

  var masterData = master.getDataRange().getValues();
  var masterRowByName = {};
  for (var i = 1; i < masterData.length; i++) {
    var mn = String(masterData[i][mNameIdx] || '').trim();
    if (mn && !masterRowByName.hasOwnProperty(mn)) masterRowByName[mn] = masterData[i];
  }

  // ── ① 설문지에만 있는 사람 ──────────────────────────────────────────────
  var newcomers = collectFormNewcomers_(ss, masterHeaders, masterRowByName);

  // 마스터에 들어갈 예정까지 포함한 전체 명단
  var roster = {};
  Object.keys(masterRowByName).forEach(function (n) { roster[n] = masterRowByName[n]; });
  newcomers.forEach(function (c) { roster[c.name] = c.row; });

  // ── ② 마스터에만 있는 사람 (실무 탭에 추가) / ③ 실무 탭에만 있는 사람 ──
  var plans = [];
  var orphans = [];

  ss.getSheets().forEach(function (sheet) {
    var name = sheet.getName();
    if (name === masterName) return;
    if (isSyncExcludedSheet_(name)) return;
    if (sheet.getLastColumn() === 0) return;

    var headers = headerRow_(sheet);
    var nameIdx = headers.indexOf(SYNC_PRIMARY_KEY);
    if (nameIdx < 0) return;

    var have = {};
    var lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      var col = sheet.getRange(2, nameIdx + 1, lastRow - 1, 1).getValues();
      col.forEach(function (r) {
        var n = String(r[0] || '').trim();
        if (!n) return;
        have[n] = true;
        if (!roster.hasOwnProperty(n)) orphans.push({ sheet: name, name: n });
      });
    }

    var missing = Object.keys(roster).filter(function (n) { return !have[n]; });
    if (missing.length) plans.push({ sheet: sheet, headers: headers, missing: missing });
  });

  // ── 미리보기 ───────────────────────────────────────────────────────────
  var lines = [];
  if (newcomers.length) {
    lines.push('· ' + masterName + ' 에 ' + newcomers.length + '명 추가: ' +
      previewNames_(newcomers.map(function (c) { return c.name; })));
  }
  plans.forEach(function (p) {
    lines.push('· ' + p.sheet.getName() + ' 에 ' + p.missing.length + '명 추가: ' +
      previewNames_(p.missing));
  });
  if (orphans.length) {
    lines.push('');
    lines.push('⚠ 마스터에 없는 이름 ' + orphans.length + '건 (지우지 않습니다):');
    orphans.slice(0, 10).forEach(function (o) { lines.push('   - ' + o.sheet + ': ' + o.name); });
    if (orphans.length > 10) lines.push('   … 외 ' + (orphans.length - 10) + '건');
  }

  if (!newcomers.length && !plans.length) {
    say('추가할 행이 없습니다. 명단이 이미 맞습니다.' +
      (orphans.length ? '\n\n' + lines.join('\n') : ''));
    return { added: 0, sheets: 0, orphans: orphans.length };
  }

  if (ui) {
    var answer = ui.alert('명단 반영',
      lines.join('\n') + '\n\n이대로 추가할까요?', ui.ButtonSet.OK_CANCEL);
    if (answer !== ui.Button.OK) return null;
  }

  // ── 실행 ───────────────────────────────────────────────────────────────
  if (newcomers.length) {
    appendRows_(master, masterHeaders.length,
      newcomers.map(function (c) { return c.row; }));
    invalidateTable_(masterName);
  }

  var addedTotal = 0;
  plans.forEach(function (p) {
    var rows = p.missing.map(function (n) { return rowFromMaster_(p.headers, masterHeaders, roster[n]); });
    appendRows_(p.sheet, p.headers.length, rows);
    invalidateTable_(p.sheet.getName());
    addedTotal += rows.length;
  });

  var out = ['[명단 반영 완료]'];
  if (newcomers.length) out.push('· ' + masterName + ': ' + newcomers.length + '명 추가');
  plans.forEach(function (p) { out.push('· ' + p.sheet.getName() + ': ' + p.missing.length + '명 추가'); });
  if (orphans.length) out.push('· 마스터에 없는 이름 ' + orphans.length + '건 — 확인이 필요합니다');
  out.push('');
  out.push('새로 추가된 행은 참가자ID 가 비어 있습니다.');
  out.push('메뉴 → 🧭 캠프 앱 → 참가자ID 채우기 를 실행하세요.');
  say(out.join('\n'));

  return { added: newcomers.length + addedTotal, sheets: plans.length, orphans: orphans.length };
}

/** 미리보기에 이름을 몇 개만 보여 준다. 145명을 다 찍으면 창이 넘친다. */
function previewNames_(names) {
  if (names.length <= 5) return names.join(', ');
  return names.slice(0, 5).join(', ') + ' 외 ' + (names.length - 5) + '명';
}

/**
 * 설문지 응답에서 마스터에 없는 사람을 뽑아 **마스터 한 행**으로 만든다.
 * 가져오는 값은 `이름` 과 `핸드폰` 뿐이다. `캠프 대상` 은 운영진이 정한다.
 */
function collectFormNewcomers_(ss, masterHeaders, masterRowByName) {
  var formSheet = findFormSheet_(ss);
  if (!formSheet) return [];

  var lastRow = formSheet.getLastRow();
  var lastCol = formSheet.getLastColumn();
  if (lastRow <= 1 || lastCol === 0) return [];

  var fHeaders = formSheet.getRange(1, 1, 1, lastCol).getValues()[0].map(syncNormalize_);
  // 설문지의 이름 열은 D열(구분번호가 붙은 이름)이 기준이다. 아니면 헤더로 찾는다.
  var colName = fHeaders[3] === '이름' ? 3 : fHeaders.indexOf('이름');
  if (colName < 0) return [];

  var colPhone = -1;
  for (var i = 0; i < fHeaders.length; i++) {
    var h = fHeaders[i];
    if (h.indexOf('연락처') >= 0 || h.indexOf('핸드폰') >= 0 || h.indexOf('전화번호') >= 0) {
      colPhone = i;
      break;
    }
  }

  var phoneCol = -1;
  ['핸드폰', '연락처', '휴대폰', '전화번호'].forEach(function (h) {
    if (phoneCol < 0) phoneCol = masterHeaders.indexOf(h);
  });

  var data = formSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var seen = {};
  var out = [];

  data.forEach(function (r) {
    var name = String(r[colName] || '').trim();
    if (!name) return;
    if (masterRowByName.hasOwnProperty(name)) return;
    if (seen[name]) return;
    seen[name] = true;

    var row = [];
    for (var k = 0; k < masterHeaders.length; k++) row.push('');
    row[masterHeaders.indexOf(SYNC_PRIMARY_KEY)] = name;
    if (phoneCol >= 0 && colPhone >= 0) row[phoneCol] = r[colPhone];
    out.push({ name: name, row: row });
  });

  return out;
}

/**
 * 마스터 한 행을 대상 탭의 열 순서에 맞춰 옮겨 담는다.
 *
 * `onEdit` 의 `pullFromMaster_` 와 달리 **기본정보 열도 함께 채운다.**
 * 새로 만드는 빈 행이라 덮어쓸 값이 없고, 핸드폰이 비어 있으면 실무 탭에서
 * 사람을 확인할 수가 없다. (기존 행을 고치는 경로는 지금처럼 DB참조가 주인이다.)
 */
function rowFromMaster_(headers, masterHeaders, masterRow) {
  var row = [];
  for (var i = 0; i < headers.length; i++) {
    var h = headers[i];
    var idx = h ? masterHeaders.indexOf(h) : -1;
    row.push(idx >= 0 ? masterRow[idx] : '');
  }
  return row;
}

/** 시트 끝에 여러 행을 한 번에 붙인다. 행마다 appendRow 하면 왕복이 폭증한다. */
function appendRows_(sheet, width, rows) {
  if (!rows.length) return;
  var start = sheet.getLastRow() + 1;
  var padded = rows.map(function (r) {
    var out = r.slice(0, width);
    while (out.length < width) out.push('');
    return out;
  });
  sheet.getRange(start, 1, padded.length, width).setValues(padded);
}

// ---------------------------------------------------------------- 헤더 검증

/**
 * 마스터·DB참조에 없는 헤더를 쓰는 탭을 찾아 빨갛게 칠한다.
 *
 * 검증 기준은 **마스터 + DB참조** 두 탭의 헤더를 합친 것이다(행정팀 원래 방식).
 * 검사 대상에서는 **앱이 관리하는 탭을 뺀다** — 헤더 체계가 아예 달라서
 * 빼지 않으면 Config·Journal·Progress 등 9개 탭이 전부 빨갛게 칠해진다.
 */
function validateHeaders() {
  var ss = getSpreadsheet_();
  var masterName = resolveSheetName_('Participants');
  var masterSheet = ss.getSheetByName(masterName);

  if (!masterSheet) {
    ss.toast('원장 탭(' + masterName + ')을 찾을 수 없습니다. 시트 이름을 확인해 주세요.');
    return;
  }

  var valid = {};
  headerRow_(masterSheet).forEach(function (h) { if (h) valid[h] = true; });
  var db = ss.getSheetByName(SYNC_DB_SHEET);
  if (db) headerRow_(db).forEach(function (h) { if (h) valid[h] = true; });

  var mismatches = [];
  var checked = 0;

  ss.getSheets().forEach(function (sheet) {
    var name = sheet.getName();
    if (name === masterName) return;
    if (isSyncExcludedSheet_(name)) return;

    var lastCol = sheet.getLastColumn();
    if (lastCol === 0) return;
    checked++;

    var headersRange = sheet.getRange(1, 1, 1, lastCol);
    var backgrounds = headerRow_(sheet).map(function (header) {
      if (header && !valid[header]) {
        mismatches.push(name + ' → "' + header + '"');
        return '#FFCCCC';
      }
      return null;
    });
    headersRange.setBackgrounds([backgrounds]);
  });

  if (mismatches.length) {
    ss.toast(mismatches.length + '건을 빨갛게 표시했습니다: ' + mismatches.slice(0, 3).join(', ') +
      (mismatches.length > 3 ? ' 외' : ''), '헤더 검증 완료', 10);
  } else {
    ss.toast(checked + '개 탭의 헤더가 모두 일치합니다.', '헤더 검증 완료', 5);
  }
}

// ------------------------------------------------- DB참조 → 실무 탭 기본정보 갱신

/**
 * DB참조의 기본정보를 `이름` 기준으로 실무 탭 전체에 밀어넣는다.
 * 기본정보는 DB참조가 주인이므로, 탭에서 손으로 고쳤어도 이 메뉴를 돌리면 되돌아간다.
 */
function syncAllBasicInfoFromDB() {
  var ss = getSpreadsheet_();
  var dbSheet = ss.getSheetByName(SYNC_DB_SHEET);

  if (!dbSheet) {
    ss.toast(SYNC_DB_SHEET + ' 탭을 찾을 수 없습니다.', '오류');
    return;
  }

  var dbLastRow = dbSheet.getLastRow();
  var dbLastCol = dbSheet.getLastColumn();
  if (dbLastRow <= 1 || dbLastCol === 0) {
    ss.toast(SYNC_DB_SHEET + ' 탭에 데이터가 없습니다.', '알림');
    return;
  }

  var dbData = dbSheet.getRange(1, 1, dbLastRow, dbLastCol).getValues();
  var dbHeaders = dbData[0].map(function (h) { return h ? String(h).trim() : ''; });
  var dbNameIdx = dbHeaders.indexOf(SYNC_PRIMARY_KEY);

  if (dbNameIdx === -1) {
    ss.toast(SYNC_DB_SHEET + " 탭에 '" + SYNC_PRIMARY_KEY + "' 열이 없습니다.", '오류');
    return;
  }

  var dbMap = {};
  for (var r = 1; r < dbData.length; r++) {
    var key = dbData[r][dbNameIdx] ? String(dbData[r][dbNameIdx]).trim() : '';
    if (key) dbMap[key] = dbData[r];
  }

  var readOnly = dbHeaders.filter(function (h) { return h && h !== SYNC_PRIMARY_KEY; });
  var updated = 0;

  ss.getSheets().forEach(function (sheet) {
    if (isSyncExcludedSheet_(sheet.getName())) return;

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow <= 1 || lastCol === 0) return;

    var headers = headerRow_(sheet);
    var nameIdx = headers.indexOf(SYNC_PRIMARY_KEY);
    if (nameIdx === -1) return;

    var range = sheet.getRange(2, 1, lastRow - 1, lastCol);
    var rows = range.getValues();
    var touched = false;

    for (var i = 0; i < rows.length; i++) {
      var name = rows[i][nameIdx] ? String(rows[i][nameIdx]).trim() : '';
      if (!name || !dbMap[name]) continue;

      var src = dbMap[name];
      for (var c = 0; c < headers.length; c++) {
        if (readOnly.indexOf(headers[c]) < 0) continue;
        var idx = dbHeaders.indexOf(headers[c]);
        if (idx !== -1 && rows[i][c] !== src[idx]) {
          rows[i][c] = src[idx];
          touched = true;
        }
      }
    }

    if (touched) {
      range.setValues(rows);
      invalidateTable_(sheet.getName());
      updated++;
    }
  });

  ss.toast('기본정보 갱신 완료 (' + updated + '개 시트 반영)', '완료');
}

// ---------------------------------------------------------------- 공용

/** 1행을 공백 제거한 문자열 배열로 읽는다. */
function headerRow_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(function (h) { return h ? String(h).trim() : ''; });
}

// ------------------------------------------------- 설문지 → 신규DB

/** 공백·줄바꿈을 걷어낸 비교용 문자열. */
function syncNormalize_(text) {
  return text ? String(text).replace(/[\s\r\n\t]+/g, '').trim() : '';
}

/**
 * 주민등록번호 앞자리로 생년월일과 만나이를 계산한다.
 * **행정팀 원본 로직 그대로다.** 생년 추정 규칙을 건드리면 기존 데이터와 어긋나므로
 * 손대지 않는다.
 */
function parseBirthAndAge_(rrnRaw) {
  if (!rrnRaw) return { birthDate: '', fullAge: '' };
  var digits = String(rrnRaw).replace(/[^0-9]/g, '');
  if (digits.length < 6) return { birthDate: '', fullAge: '' };

  var numY = parseInt(digits.substring(0, 2), 10);
  var month = parseInt(digits.substring(2, 4), 10);
  var day = parseInt(digits.substring(4, 6), 10);

  if (isNaN(numY) || isNaN(month) || isNaN(day) || month < 1 || month > 12 || day < 1 || day > 31) {
    return { birthDate: '', fullAge: '' };
  }

  var today = new Date();
  var currentYear = today.getFullYear();
  var currentYearShort = currentYear % 100;
  var fullYear = null;

  if (digits.length >= 7) {
    var code = digits.charAt(6);
    if (['3', '4', '7', '8'].indexOf(code) >= 0) {
      fullYear = 2000 + numY;
    } else if (['1', '2', '5', '6'].indexOf(code) >= 0) {
      fullYear = numY <= currentYearShort ? 2000 + numY : 1900 + numY;
    }
  }
  if (!fullYear) {
    fullYear = (numY <= currentYearShort || numY <= 30) ? 2000 + numY : 1900 + numY;
  }

  var pad = function (n) { return String(n).length < 2 ? '0' + n : String(n); };
  var age = currentYear - fullYear;
  if (today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day)) age--;

  return { birthDate: fullYear + '-' + pad(month) + '-' + pad(day), fullAge: age >= 0 ? age : 0 };
}

/**
 * 설문지 응답 중 **피엘교회 성도여부가 X** 인 사람만 골라 `신규DB` 탭을 다시 만든다.
 *
 * ⚠ 주민등록번호로 생년월일·만나이를 계산한다. 주민번호 열을 먼저 지우면
 *   이 값들이 빈칸으로 들어간다. **신규DB 동기화를 끝낸 뒤에 주민번호를 지울 것**(D-020).
 */
function syncFormToNewDb() {
  var ss = getSpreadsheet_();
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch (e) { ui = null; }
  var say = function (msg) { if (ui) ui.alert(msg); else ss.toast(msg); };

  var formSheet = findFormSheet_(ss);
  var newDbSheet = ss.getSheetByName(SYNC_NEW_DB_SHEET);
  if (!formSheet || !newDbSheet) {
    say('오류: 설문지 응답 탭 또는 ' + SYNC_NEW_DB_SHEET + ' 탭을 찾을 수 없습니다.');
    return;
  }

  var fLastRow = formSheet.getLastRow();
  var fLastCol = formSheet.getLastColumn();
  if (fLastRow <= 1) { say('설문지 시트에 데이터가 없습니다.'); return; }

  var fHeadersRaw = formSheet.getRange(1, 1, 1, fLastCol).getValues()[0];
  var fHeaders = fHeadersRaw.map(syncNormalize_);

  var idxOfMatch = function (arr, test) {
    for (var i = 0; i < arr.length; i++) { if (test(arr[i])) return i; }
    return -1;
  };

  var colCheck = idxOfMatch(fHeaders, function (h) {
    return h.indexOf('피엘교회성도여부') >= 0 || h.indexOf('성도여부') >= 0;
  });
  var colKey = fHeaders[3] === '이름' ? 3 : fHeaders.indexOf('이름');
  var colPhone = idxOfMatch(fHeaders, function (h) {
    return h.indexOf('연락처') >= 0 || h.indexOf('핸드폰') >= 0 || h.indexOf('전화번호') >= 0;
  });
  var colGender = fHeaders.indexOf('성별');
  var colRrn = idxOfMatch(fHeaders, function (h) { return h.indexOf('주민등록번호') >= 0; });

  if (colCheck === -1 || colKey === -1) {
    say("오류: '피엘교회 성도여부' 또는 '이름' 열 위치를 확인하지 못했습니다.");
    return;
  }

  var newDbLastCol = newDbSheet.getLastColumn();
  if (newDbLastCol === 0) {
    say('오류: ' + SYNC_NEW_DB_SHEET + ' 탭 1행에 헤더가 정의되어 있지 않습니다.');
    return;
  }
  var newDbHeadersRaw = newDbSheet.getRange(1, 1, 1, newDbLastCol).getValues()[0];

  var fData = formSheet.getRange(2, 1, fLastRow - 1, fLastCol).getValues();
  var seen = {};
  var order = [];

  fData.forEach(function (row) {
    var check = syncNormalize_(row[colCheck]).toUpperCase();
    var key = row[colKey] ? String(row[colKey]).trim() : '';
    if (!key) return;
    if (check !== 'X' && check.indexOf('아니') < 0) return;

    var parsed = parseBirthAndAge_(colRrn !== -1 ? row[colRrn] : '');
    var mapped = [];
    for (var i = 0; i < newDbLastCol; i++) mapped.push('');

    newDbHeadersRaw.forEach(function (head, idx) {
      var h = syncNormalize_(head);
      if (!h) return;
      if (h === '이름') mapped[idx] = key;
      else if (h === '핸드폰' && colPhone !== -1) mapped[idx] = row[colPhone];
      else if (h === '성별' && colGender !== -1) mapped[idx] = row[colGender];
      else if (h.indexOf('생년월일') >= 0 || h.indexOf('생일') >= 0) mapped[idx] = parsed.birthDate;
      else if (h.indexOf('만나이') >= 0 || h === '나이') mapped[idx] = parsed.fullAge;
      else {
        var m = fHeaders.indexOf(h);
        if (m !== -1) mapped[idx] = row[m];
      }
    });

    if (!seen[key]) order.push(key);
    seen[key] = mapped;   // 같은 이름이 여러 번이면 마지막 응답이 남는다(원본 동작)
  });

  var rows = order.map(function (k) { return seen[k]; });
  var maxRows = newDbSheet.getMaxRows();
  if (maxRows > 1) newDbSheet.getRange(2, 1, maxRows - 1, newDbLastCol).clearContent();

  if (rows.length) {
    newDbSheet.getRange(2, 1, rows.length, newDbLastCol).setValues(rows);
    invalidateTable_(SYNC_NEW_DB_SHEET);
    say('[동기화 완료]\n총 ' + rows.length + '명의 신규 대상자(X) 정보가 ' +
        SYNC_NEW_DB_SHEET + ' 탭에 등록되었습니다.');
  } else {
    say("설문지 응답 중 성도여부가 'X'인 대상자가 없습니다.");
  }
  return rows.length;
}

// ------------------------------------------------- Config 에서 회차 라벨 변경

/**
 * `Config` 탭에서 `SESSION_1` / `SESSION_2` / … 의 **값**을 고치면
 * 명단·Teams·Timeline·Progress·Journal 다섯 탭의 `참여 일자` 를 따라 바꾼다.
 *
 * **왜 자동으로 해야 하나**: `참여 일자` 는 설정값이 아니라 조를 특정하는 키의 일부다(D-011).
 * Config 만 바뀌면 다섯 탭이 옛 라벨에 묶인 채 남아 **조가 통째로 사라진 것처럼** 보인다.
 *
 * **🔴 겹침 방어**: 새 1차 라벨이 옛 2차 라벨과 같은 경우가 실제로 있다
 * (`10/24·10/31` → `10/31·11/07`). 한 셀씩 고치는 순서가 곧 순차 치환이라,
 * 1차를 먼저 바꾸면 두 회차가 한 값으로 뭉갠다.
 * 그래서 **옮겨갈 라벨에 이미 행이 있으면 되돌리고** 순서를 안내한다.
 * 안내대로 2차부터 바꾸면 충돌 없이 끝난다.
 */
function applyScheduleEdit_(e, sheet) {
  if (!e.range || e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return;
  if (e.oldValue === undefined) return;   // 붙여넣기·삭제 등은 oldValue 가 없다

  var idx = headerIndex_(SHEETS.CONFIG);
  if (e.range.getColumn() !== idx['값']) return;   // '값' 열이 아니면 무관

  var key = str_(sheet.getRange(e.range.getRow(), idx['키']).getValue());
  if (!/^SESSION_\d+$/.test(key)) return;   // 회차 개수는 정해져 있지 않다 (D-026)

  var from = str_(e.oldValue);
  var to = str_(e.range.getValue());
  if (!from || !to || from === to) return;

  var ss = getSpreadsheet_();
  var targets = [SHEETS.PARTICIPANTS, SHEETS.TEAMS, SHEETS.TIMELINE,
                 SHEETS.PROGRESS, SHEETS.JOURNAL];

  // 옮겨갈 라벨에 이미 행이 있으면 두 무리가 섞인다. 되돌리고 순서를 알려 준다.
  var blocked = 0;
  targets.forEach(function (name) { blocked += countSessionRows_(name, keyedMap_(to)); });
  if (blocked) {
    e.range.setValue(from);
    invalidateTable_(SHEETS.CONFIG);
    clearConfigCache();
    // 새 라벨을 지금 쓰고 있는 회차를 찾아 이름을 대 준다. 그 회차를 먼저 비켜야 한다.
    var owner = null;
    sessions_().forEach(function (sn) { if (sn.label === to && !owner) owner = 'SESSION_' + sn.n; });
    ss.toast('"' + to + '" 에 이미 ' + blocked + '행이 있어 두 회차가 섞입니다.\n' +
      (owner ? owner : '그 라벨을 쓰는 회차') +
      ' 를 먼저 바꾼 뒤 다시 시도하세요. (값은 되돌렸습니다)', '⚠ 일정 변경 보류', 15);
    return;
  }

  var rename = {};
  rename[from] = to;
  var changed = 0;
  targets.forEach(function (name) { changed += renameSessionIn_(name, rename); });
  clearConfigCache();

  if (changed) {
    ss.toast(from + ' → ' + to + '  ·  ' + changed + '행을 함께 바꿨습니다.', '✅ 일정 변경', 10);
  } else {
    ss.toast('Config 는 바꿨지만 "' + from + '" 로 적힌 행이 없었습니다.\n' +
      '명단의 참여 일자 표기를 확인해 주세요.', '⚠ 바뀐 행 없음', 10);
  }
}
