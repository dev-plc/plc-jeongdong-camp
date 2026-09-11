/**
 * MasterSync.gs — 행정팀 탭 간 명단 동기화
 *
 * 행정팀이 쓰던 스크립트를 앱과 한 프로젝트에서 충돌 없이 돌도록 정리한 것이다.
 * 원래 동작은 그대로다:
 *   · 다른 탭에서 `이름` 을 입력하면 `마스터` 탭의 해당 행을 끌어와 채운다.
 *   · 어떤 탭에서 값을 고치면 같은 `이름` 을 가진 다른 탭의 같은 헤더 칸도 따라 바뀐다.
 *   · `성별` `나이` `연락처` 는 탭마다 따로 관리하므로 건드리지 않는다.
 *
 * 앱과 맞물리며 달라진 점 (셋 다 실제로 문제가 됐던 것들):
 *   1. `onOpen` 은 Setup.gs 한 곳에만 둔다. 한 프로젝트에 같은 이름의 함수가 둘이면
 *      나중에 로드된 것만 남아 다른 메뉴가 조용히 사라진다. 여기서는 메뉴를 "추가"만 한다.
 *   2. 앱이 관리하는 탭(Config·Journal·Progress…)은 동기화·검증 대상에서 제외한다.
 *      제외하지 않으면 헤더 검증이 그 탭들을 전부 빨갛게 칠한다.
 *   3. 원장 탭 이름은 `resolveSheetName_('Participants')` 로 찾는다(`마스터` 우선).
 *
 * 참고: onEdit 같은 단순 트리거는 **사람이 시트를 편집할 때만** 실행된다.
 *       앱(웹앱)이 시트에 쓰는 값에는 반응하지 않으므로 동기화 무한루프는 생기지 않는다.
 */

/** 탭마다 따로 관리하는 열 — 동기화에서 제외한다. */
var SYNC_READONLY_HEADERS = ['성별', '나이', '만나이', '연락처', '핸드폰', '휴대폰', '휴대전화', '전화번호'];

/** 행을 식별하는 기준 열. */
var SYNC_PRIMARY_KEY = '이름';

/** Setup.gs 의 onOpen 이 호출한다. 여기서 직접 onOpen 을 정의하지 않는다(위 주석 1번). */
function addMasterSyncMenu_(ui) {
  ui.createMenu('🔄 동기화 관리')
    .addItem('헤더 일치 여부 검사 (불일치 표시)', 'validateHeaders')
    .addToUi();
}

/** 앱이 관리하는 탭인지. 이 탭들은 사람이 편집해도 동기화하지 않는다. */
function isAppSheet_(sheetName) {
  return appManagedSheetNames_().indexOf(sheetName) >= 0;
}

// ---------------------------------------------------------------- 동기화

function onEdit(e) {
  if (!e || !e.range) return;

  var lock = LockService.getDocumentLock();
  try { lock.waitLock(3000); } catch (error) { return; }

  try {
    var sheet = e.source.getActiveSheet();
    var sheetName = sheet.getName();

    // 앱 전용 탭은 손대지 않는다.
    if (isAppSheet_(sheetName)) return;

    var range = e.range;
    var editedRow = range.getRow();
    var editedCol = range.getColumn();
    var newValue = range.getValue();

    if (editedRow === 1) return; // 헤더 수정은 무시

    var headers = headerRow_(sheet);
    var editedHeader = headers[editedCol - 1];
    if (!editedHeader) return;
    if (SYNC_READONLY_HEADERS.indexOf(editedHeader) >= 0) return;

    var nameColIndex = headers.indexOf(SYNC_PRIMARY_KEY) + 1;
    if (nameColIndex === 0) return;

    var ss = e.source;
    var masterName = resolveSheetName_('Participants');

    // [기능 1] 이름을 입력하면 마스터에서 나머지 값을 당겨온다.
    if (editedHeader === SYNC_PRIMARY_KEY) {
      if (sheetName === masterName) return;
      pullFromMaster_(ss, sheet, headers, editedRow, newValue, masterName);
      return;
    }

    // [기능 2] 일반 값 수정 → 같은 이름을 가진 다른 탭에도 반영.
    var targetName = sheet.getRange(editedRow, nameColIndex).getValue();
    if (!targetName) return;
    pushToOtherSheets_(ss, sheetName, editedHeader, targetName, newValue);

  } catch (error) {
    console.error('동기화 중 오류 발생: ' + error.message);
  } finally {
    lock.releaseLock();
  }
}

function pullFromMaster_(ss, sheet, headers, editedRow, name, masterName) {
  var masterSheet = ss.getSheetByName(masterName);
  if (!masterSheet) return;

  var masterHeaders = headerRow_(masterSheet);
  var masterNameIdx = masterHeaders.indexOf(SYNC_PRIMARY_KEY);
  if (masterNameIdx < 0) return;

  var masterData = masterSheet.getDataRange().getValues();
  var sourceRow = null;
  for (var i = 1; i < masterData.length; i++) {
    if (masterData[i][masterNameIdx] === name) { sourceRow = masterData[i]; break; }
  }
  if (!sourceRow) return;

  for (var j = 0; j < headers.length; j++) {
    var header = headers[j];
    if (!header) continue;
    if (header === SYNC_PRIMARY_KEY) continue;
    if (SYNC_READONLY_HEADERS.indexOf(header) >= 0) continue;

    var idx = masterHeaders.indexOf(header);
    if (idx >= 0) sheet.getRange(editedRow, j + 1).setValue(sourceRow[idx]);
  }
}

function pushToOtherSheets_(ss, sourceSheetName, editedHeader, targetName, newValue) {
  ss.getSheets().forEach(function (targetSheet) {
    var name = targetSheet.getName();
    if (name === sourceSheetName) return;
    if (isAppSheet_(name)) return;
    if (targetSheet.getLastColumn() === 0) return;

    var headers = headerRow_(targetSheet);
    var nameIdx = headers.indexOf(SYNC_PRIMARY_KEY);
    var editedIdx = headers.indexOf(editedHeader);
    if (nameIdx < 0 || editedIdx < 0) return;

    var data = targetSheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][nameIdx] === targetName) {
        targetSheet.getRange(i + 1, editedIdx + 1).setValue(newValue);
        break;
      }
    }
  });
}

// ---------------------------------------------------------------- 헤더 검증

/**
 * 마스터에 없는 헤더를 쓰는 탭을 찾아 빨갛게 칠한다.
 * 앱이 관리하는 탭은 헤더 체계가 아예 달라서 검사 대상에서 뺀다.
 */
function validateHeaders() {
  var ss = getSpreadsheet_();
  var masterName = resolveSheetName_('Participants');
  var masterSheet = ss.getSheetByName(masterName);

  if (!masterSheet) {
    ss.toast('원장 탭(' + masterName + ')을 찾을 수 없습니다. 시트 이름을 확인해 주세요.');
    return;
  }

  var masterHeaders = headerRow_(masterSheet).filter(String);
  var mismatches = [];
  var checked = 0;

  ss.getSheets().forEach(function (sheet) {
    var name = sheet.getName();
    if (name === masterName) return;
    if (isAppSheet_(name)) return;

    var lastCol = sheet.getLastColumn();
    if (lastCol === 0) return;
    checked++;

    var headersRange = sheet.getRange(1, 1, 1, lastCol);
    var backgrounds = headerRow_(sheet).map(function (header) {
      if (header && masterHeaders.indexOf(header) < 0) {
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

// ---------------------------------------------------------------- 공용

/** 1행을 공백 제거한 문자열 배열로 읽는다. */
function headerRow_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(function (h) { return h ? String(h).trim() : ''; });
}
