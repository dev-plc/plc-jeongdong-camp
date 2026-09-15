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

  var lock = LockService.getDocumentLock();
  try { lock.waitLock(3000); } catch (error) { return; }

  try {
    var sheet = e.source.getActiveSheet();
    var sheetName = sheet.getName();

    // ── 캐시 무효화는 **아래 조기 return 보다 먼저** 해야 한다. ──────────────
    // Config·Notices·Timeline·Checkpoints·Courses 는 전부 '앱 전용 탭' 이라
    // isAppSheet_ 에 걸려 곧바로 빠져나간다. 이 줄을 아래로 내리면
    // 에러 없이 **아무 일도 일어나지 않고**, 설정 변경이 최대 5분 늦게 반영된다.
    // (앱이 고치는 경로인 configSet_ 은 스스로 캐시를 비우므로 여기선 사람 편집만 본다.)
    if (isCachedSourceSheet_(sheetName)) {
      clearConfigCache();
    }

    // Config 탭에서 회차 라벨(SESSION_1/2)을 고치면 5개 탭을 따라 바꾼다.
    // 이것도 조기 return 앞이어야 한다 — Config 는 앱 탭이다.
    if (sheetName === SHEETS.CONFIG) {
      applyScheduleEdit_(e, sheet);
      return;
    }

    // 앱 전용 탭·원천 탭(DB참조·신규DB·설문지)은 (캐시 무효화 말고는) 손대지 않는다.
    if (isSyncExcludedSheet_(sheetName)) return;

    var range = e.range;
    var editedRow = range.getRow();
    var editedCol = range.getColumn();
    var newValue = range.getValue();

    if (editedRow === 1) return; // 헤더 수정은 무시

    var headers = headerRow_(sheet);
    var editedHeader = headers[editedCol - 1];
    if (!editedHeader) return;
    if (syncReadonlyHeaders_().indexOf(editedHeader) >= 0) return;

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
    if (syncReadonlyHeaders_().indexOf(header) >= 0) continue;

    var idx = masterHeaders.indexOf(header);
    if (idx >= 0) sheet.getRange(editedRow, j + 1).setValue(sourceRow[idx]);
  }
}

function pushToOtherSheets_(ss, sourceSheetName, editedHeader, targetName, newValue) {
  ss.getSheets().forEach(function (targetSheet) {
    var name = targetSheet.getName();
    if (name === sourceSheetName) return;
    if (isSyncExcludedSheet_(name)) return;
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

  var formSheet = ss.getSheetByName('Form_Responses') || ss.getSheetByName('설문지 응답 시트2');
  if (!formSheet) {
    ss.getSheets().forEach(function (sh) {
      if (formSheet) return;
      var n = sh.getName();
      if (n.indexOf('Form') >= 0 || n.indexOf('응답') >= 0 || n.indexOf('설문') >= 0) formSheet = sh;
    });
  }

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
 * `Config` 탭에서 `SESSION_1` / `SESSION_2` 의 **값**을 고치면
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
  if (key !== 'SESSION_1' && key !== 'SESSION_2') return;

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
    var other = key === 'SESSION_1' ? 'SESSION_2' : 'SESSION_1';
    ss.toast('"' + to + '" 에 이미 ' + blocked + '행이 있어 두 회차가 섞입니다.\n' +
      other + ' 를 먼저 바꾼 뒤 다시 시도하세요. (값은 되돌렸습니다)', '⚠ 일정 변경 보류', 15);
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
