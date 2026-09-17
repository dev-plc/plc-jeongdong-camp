/**
 * Sheets.gs — 스프레드시트 접근 레이어
 *
 * 규칙: 코드는 "헤더 텍스트"로 컬럼을 찾는다. 열 순서를 바꿔도 동작하고,
 *       헤더 이름을 바꾸면 여기 SCHEMA 를 같이 고쳐야 한다.
 * 스키마 문서: docs-dev/spec/SHEET-SCHEMA.md
 */

var TZ = 'Asia/Seoul';

var SHEETS = {
  CONFIG: 'Config',
  PARTICIPANTS: 'Participants',
  TEAMS: 'Teams',
  COURSES: 'Courses',
  CHECKPOINTS: 'Checkpoints',
  PROGRESS: 'Progress',
  JOURNAL: 'Journal',
  NOTICES: 'Notices',
  TIMELINE: 'Timeline',
  LOG: 'Log'
};

/**
 * 컬럼 이름 상수.
 * Participants 의 헤더는 행정팀 마스터시트(2026 PLC 정동캠프 명단)의 표기를 **글자 그대로** 쓴다.
 * 시트를 통째로 붙여넣어도 코드가 그대로 읽히게 하기 위해서다.
 */
var COL = {
  AUDIENCE: '캠프 대상',        // 청년부 / 장년부
  SESSION: '참여 일자',         // 10/31(토) / 11/07(토)  — 캠프 대상과 독립적이다
  NAME: '이름',
  GENDER: '성별',
  AGE: '나이',
  PHONE: '연락처',
  FEE_AMOUNT: '회비 대상(2만/3만)',
  FEE_STATUS: '입금 여부',
  GROUP: '조 배정',             // 1조 / 2조 …  (참여 일자와 묶여야 조가 특정된다)
  ROLE: '역할',                 // 일반 / 조장 / 스태프 / 사역자
  INSURANCE: '여행자 보험 가입',
  COURSE: '배정 코스',          // A코스(배재 시작) …
  NOTE: '비고'
};

/**
 * 마스터시트 표기가 흔들리는 열의 **별칭**.
 *
 * 행정팀 실물 시트를 확인해 보니 `연락처` 가 `핸드폰`, `나이` 가 `만나이` 로 적혀 있었다.
 * 열을 헤더 글자로 찾기 때문에(D-012) 이름이 어긋나면 **에러 없이 빈 값**이 되고,
 * 하필 `연락처` 는 로그인에서 뒷 4자리를 대조하는 열이라 **로그인이 통째로 막힌다.**
 *
 * 한쪽으로 강제하는 대신 양쪽을 모두 인정한다. 시트가 어느 쪽으로 적혀 있든 동작하고,
 * 앞으로 표기가 또 바뀌어도 여기 한 줄만 늘리면 된다.
 * 화면 문구는 **시트에 실제로 있는 이름**을 따라간다 (D-013, labels_()).
 *
 * 맨 앞이 정식 이름(= COL 값)이고 나머지가 받아 주는 표기다.
 */
var COL_ALIASES = {};
COL_ALIASES[COL.PHONE] = [COL.PHONE, '핸드폰', '휴대폰', '휴대전화', '전화번호'];
COL_ALIASES[COL.AGE] = [COL.AGE, '만나이', '만 나이'];

/** 시트에 실제로 적힌 헤더 이름을 돌려준다. 못 찾으면 정식 이름 그대로. */
function actualHeader_(sheetName, canonical) {
  var alts = COL_ALIASES[canonical];
  if (!alts) return canonical;
  var present = headerIndex_(sheetName).__present || {};
  for (var i = 0; i < alts.length; i++) {
    if (present[alts[i]]) return alts[i];
  }
  return canonical;
}

/** 각 시트의 헤더 정의. 배열 순서가 setupSpreadsheet() 이 만드는 열 순서다. */
var SCHEMA = {
  Config: ['키', '값', '설명'],
  Participants: [
    '참가자ID',
    COL.AUDIENCE, COL.SESSION, COL.NAME, COL.GENDER, COL.AGE, COL.PHONE,
    COL.FEE_AMOUNT, COL.FEE_STATUS, COL.GROUP, COL.ROLE, COL.INSURANCE, COL.COURSE, COL.NOTE,
    '등록일시'
  ],
  // 조는 (참여 일자 + 조 배정) 조합으로 특정된다. 별도 조ID를 두지 않는다 — 행정팀이
  // ID를 따로 관리할 필요가 없고, 마스터시트의 "1조" 표기를 그대로 쓸 수 있다.
  Teams: [COL.SESSION, COL.GROUP, '조이름', '색상', '집결장소', '비고'],
  Courses: ['코스명', '방문 순서', '비고'],
  Checkpoints: [
    '지점코드', '기본순번', '지점명', '주소', '위도', '경도', '체류시간분',
    '한줄소개', '현장설명', '미션', '퀴즈URL', '사진URL', '운영시간'
  ],
  Progress: [
    '기록ID', COL.SESSION, COL.GROUP, '지점코드', '상태',
    '도착시각', '완료시각', '퀴즈점수', '기록자ID', '메모', '수정일시'
  ],
  Journal: [
    '일지ID', COL.SESSION, COL.GROUP, '참가자ID', '작성자명', '지점코드', '내용',
    '사진ID', '사진URL', '상태', '반려사유',
    '작성일시', '수정일시', '수정자ID', '검토자', '검토일시'
  ],
  Notices: ['공지ID', '대상', '제목', '내용', '고정', '게시일시', '종료일시'],
  Timeline: [COL.SESSION, '순번', '시작', '종료', '내용', '장소', '비고'],
  Log: ['일시', '액션', '행위자', '대상', '결과', '상세']
};

/** 상태/역할 등 열거값 — 데이터 검증과 코드가 공유한다. */
var ENUM = {
  AUDIENCE: ['청년부', '장년부'],
  ROLE: ['일반', '조장', '스태프', '사역자'],
  FEE: ['미납', '완납', '면제'],
  FEE_AMOUNT: ['20000', '30000'],
  INSURANCE: ['미가입', '가입완료'],
  PROGRESS: ['대기', '도착', '완료'],
  JOURNAL: ['대기', '승인', '반려', '삭제']
};

/** 조장 권한을 갖는 역할. 스태프·사역자도 현장에서 대신 기록해야 할 때가 있다. */
var LEADER_ROLES = ['조장', '스태프', '사역자'];

// ---------------------------------------------------------------- 회차 / 조

/**
 * 참여 일자 목록. Config 에서 읽으므로 날짜가 바뀌어도 배포가 필요 없다.
 * 반환: [{ n: 1, label: '10/31(토)', date: '2026-10-31' }, ...] — 번호순.
 *
 * **회차 개수는 정해져 있지 않다.** Config 의 키에서 `SESSION_<숫자>` 를 찾아낸다.
 * 사전답사 같은 회차를 `SESSION_3` 으로 하나 더 얹으면 로그인 화면·일정표·조 키·
 * 명단 점검이 전부 따라온다 (D-026).
 *
 * 🔴 `1..N` 을 훑다 빈 칸에서 멈추는 방식은 **쓰지 않는다.**
 * 그러면 `SESSION_2` 를 지웠을 때 `SESSION_3` 이 **에러 없이 사라진다.**
 */
function sessions_() {
  var conf = getConfig_();   // 이미 캐시된 키→값 맵. 추가 읽기가 없다.
  var out = [];

  Object.keys(conf).forEach(function (key) {
    var m = /^SESSION_(\d+)$/.exec(key);   // SESSION_1_DATE 는 걸리지 않는다
    if (!m) return;
    var label = str_(conf[key]);
    if (!label) return;
    // `SESSION_<n>_ACTIVE` 가 없거나 비어 있으면 **활성**이다.
    // 기존 회차는 행을 새로 넣지 않아도 그대로 돌아간다 (D-031).
    var flag = conf[key + '_ACTIVE'];
    var active = (flag === undefined || str_(flag) === '')
      ? true
      : /^(true|y|yes|1|on)$/i.test(str_(flag));

    out.push({
      n: parseInt(m[1], 10),
      label: label,
      date: str_(conf[key + '_DATE'] || ''),
      active: active
    });
  });

  return out.sort(function (a, b) { return a.n - b.n; });
}

function sessionLabels_() {
  return sessions_().map(function (s) { return s.label; });
}

/**
 * **앱이 실제로 열어 주는** 회차만.
 *
 * 비활성 회차는 앱 입장에서 **없는 회차**다 — 그 회차 참가자는 로그인할 수 없고
 * 일정표도 내려가지 않는다. 시트 데이터는 그대로 남는다 (D-031).
 * 사전답사가 끝나면 이걸로 끈다.
 */
function activeSessionLabels_() {
  return sessions_().filter(function (s) { return s.active; })
    .map(function (s) { return s.label; });
}

/** 명단에 적을 수 있는 회차인가. 비활성도 **적을 수는 있다**(드롭다운·명단 점검용). */
function isValidSession_(label) {
  return sessionLabels_().indexOf(str_(label)) >= 0;
}

/** 지금 로그인을 열어 주는 회차인가. */
function isActiveSession_(label) {
  return activeSessionLabels_().indexOf(str_(label)) >= 0;
}

/**
 * 조를 특정하는 키. 같은 "1조" 라도 참여 일자가 다르면 다른 조다.
 * Progress / Journal 조회는 전부 이 키로 맞춘다.
 */
function teamKey_(session, group) {
  return str_(session) + '|' + str_(group);
}

function rowTeamKey_(row) {
  return teamKey_(row[COL.SESSION], row[COL.GROUP]);
}

/**
 * 논리 시트 이름 → 실제 탭 이름 후보.
 * 행정팀 원장 탭은 `마스터` 이고, 앱이 만드는 나머지 탭은 이름이 그대로다.
 * 앞에 있는 후보부터 찾아 먼저 존재하는 탭을 쓴다.
 */
var SHEET_ALIASES = {
  Participants: ['마스터', 'Participants', '명단']
};

/** 앱이 직접 관리하는 탭(= 마스터 동기화 대상이 아닌 탭)들의 논리 이름. */
function appManagedSheetNames_() {
  return Object.keys(SCHEMA)
    .filter(function (n) { return n !== 'Participants'; })
    .map(resolveSheetName_);
}

// ---------------------------------------------------------------- 스프레드시트

var __sheetNameCache = {};

/** 논리 이름을 실제 탭 이름으로 바꾼다. 없으면 논리 이름을 그대로 돌려준다. */
function resolveSheetName_(logical) {
  if (__sheetNameCache[logical]) return __sheetNameCache[logical];

  var aliases = SHEET_ALIASES[logical] || [logical];
  var ss = getSpreadsheet_();
  for (var i = 0; i < aliases.length; i++) {
    if (ss.getSheetByName(aliases[i])) {
      __sheetNameCache[logical] = aliases[i];
      return aliases[i];
    }
  }
  __sheetNameCache[logical] = logical;
  return logical;
}

/**
 * 이 스크립트는 **반드시 스프레드시트에 바인딩된 상태**로 배포한다(확장 프로그램 → Apps Script).
 *
 * appsscript.json 의 권한이 `spreadsheets.currentonly` 이므로 **붙어 있는 그 문서 하나만**
 * 열 수 있다. 예전에는 독립형 스크립트를 대비해 `SPREADSHEET_ID` 속성으로
 * `openById` 하는 폴백이 있었는데, 좁힌 권한 아래에서는 어차피 실패한다.
 * 남겨 두면 "속성만 넣으면 되겠지" 하고 헛짚게 되므로 지웠다 (D-020).
 */
function getSpreadsheet_() {
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  throw new AppError('SERVER_ERROR',
    '스프레드시트를 찾을 수 없습니다. 이 스크립트는 시트에 바인딩된 상태로 배포해야 합니다.');
}

/** 논리 이름을 받아 실제 탭을 돌려준다(`Participants` → `마스터` 등). */
function getSheet_(logical) {
  var name = resolveSheetName_(logical);
  var sh = getSpreadsheet_().getSheetByName(name);
  if (!sh) {
    throw new AppError('SERVER_ERROR', '시트가 없습니다: ' + name + ' (setupSpreadsheet 실행 필요)');
  }
  return sh;
}

// ---------------------------------------------------------------- 읽기

/**
 * 실행 단위 캐시. 한 요청 안에서 같은 시트를 여러 번 읽는 경로가 많아
 * (예: me → 조회/조장판정/조장이름/코스순서) 왕복을 줄인다.
 * 요청마다 새 실행이므로 요청 간에는 남지 않고, 쓰기가 일어나면 그 시트만 비운다.
 */
var __tableCache = {};

function invalidateTable_(name) {
  delete __tableCache[name];
}

/** 헤더를 새로 쓴 뒤(setupSpreadsheet) 호출한다. */
function invalidateHeaders_() {
  __headerCache = {};
}

/**
 * 시트 전체를 객체 배열로 읽는다.
 * 각 객체에는 원본 행 번호가 `__row` 로 붙는다(수정 시 사용).
 * 모든 셀이 빈 행은 건너뛴다.
 *
 * 반환된 배열/객체는 캐시와 공유되므로 호출자가 내용을 고쳐서는 안 된다.
 * (filter/map/정렬용 사본은 괜찮다.)
 */
function readTable_(name) {
  if (__tableCache[name]) return __tableCache[name];
  var sh = getSheet_(name);
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) {
    __tableCache[name] = [];
    return __tableCache[name];
  }

  var values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var out = [];

  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var empty = true;
    for (var c = 0; c < row.length; c++) {
      if (row[c] !== '' && row[c] !== null) { empty = false; break; }
    }
    if (empty) continue;

    var obj = { __row: i + 1 };
    for (var j = 0; j < headers.length; j++) {
      if (!headers[j]) continue;
      obj[headers[j]] = row[j];
    }
    // 시트가 '핸드폰' 으로 적어 놨어도 row[COL.PHONE] 로 읽히게 한다.
    aliasRowKeys_(obj);
    out.push(obj);
  }
  __tableCache[name] = out;
  return out;
}

/** 별칭으로 적힌 열을 정식 이름으로도 읽을 수 있게 키를 하나 더 단다. */
function aliasRowKeys_(obj) {
  Object.keys(COL_ALIASES).forEach(function (canonical) {
    if (obj[canonical] !== undefined) return;
    var alts = COL_ALIASES[canonical];
    for (var i = 0; i < alts.length; i++) {
      if (obj[alts[i]] !== undefined) { obj[canonical] = obj[alts[i]]; return; }
    }
  });
}

/**
 * 헤더 이름 → 1-based 열 번호 맵.
 * appendRow_/updateRow_ 가 매번 호출하므로 실행 단위로 캐시한다.
 * 헤더 행은 요청 중에 바뀌지 않으므로 쓰기 후에도 무효화할 필요가 없다.
 */
var __headerCache = {};

function headerIndex_(name) {
  if (__headerCache[name]) return __headerCache[name];

  var sh = getSheet_(name);
  var lastCol = sh.getLastColumn();
  if (lastCol < 1) return {};
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var map = {};
  var present = {};
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i]).trim();
    if (h) { map[h] = i + 1; present[h] = i + 1; }
  }
  applyColumnAliases_(map);
  // 실제로 시트에 적힌 이름만 따로 남긴다(별칭으로 채워 넣은 것과 구분).
  Object.defineProperty(map, '__present', { value: present, enumerable: false });
  __headerCache[name] = map;
  return map;
}

/**
 * 정식 이름이 없고 별칭만 있는 열을, 정식 이름으로도 찾을 수 있게 심어 준다.
 * 정식 이름이 이미 있으면 건드리지 않는다(시트가 우선).
 */
function applyColumnAliases_(map) {
  Object.keys(COL_ALIASES).forEach(function (canonical) {
    if (map[canonical]) return;
    var alts = COL_ALIASES[canonical];
    for (var i = 0; i < alts.length; i++) {
      if (map[alts[i]]) { map[canonical] = map[alts[i]]; return; }
    }
  });
}

// ---------------------------------------------------------------- 쓰기

/** 객체 하나를 시트 끝에 붙인다. 정의되지 않은 헤더는 무시된다. */
function appendRow_(name, obj) {
  var sh = getSheet_(name);
  var idx = headerIndex_(name);
  var width = sh.getLastColumn();
  var row = new Array(width).fill('');
  Object.keys(obj).forEach(function (k) {
    if (idx[k]) row[idx[k] - 1] = obj[k];
  });
  sh.appendRow(row);
  invalidateTable_(name);
  return sh.getLastRow();
}

/**
 * 특정 행의 일부 컬럼만 갱신한다.
 *
 * 셀마다 setValue() 를 부르면 patch 키 수만큼 스프레드시트 API 를 왕복한다.
 * (열 11개를 고치는 progress.set 이 11회) 그래서 **바꿀 열들을 감싸는 최소 구간을
 * 한 번 읽어, 필요한 칸만 갈아 끼운 뒤 setValues() 로 한 번에 쓴다.**
 * 구간 안의 건드리지 않을 칸은 읽은 값을 그대로 되돌려 쓰므로 내용이 보존된다.
 */
function updateRow_(name, rowNumber, patch) {
  var idx = headerIndex_(name);

  var cols = Object.keys(patch)
    .filter(function (k) { return idx[k]; })
    .map(function (k) { return idx[k]; });
  if (!cols.length) return;

  var from = Math.min.apply(null, cols);
  var to = Math.max.apply(null, cols);
  var width = to - from + 1;

  var sh = getSheet_(name);
  var range = sh.getRange(rowNumber, from, 1, width);
  var row = range.getValues()[0];

  Object.keys(patch).forEach(function (k) {
    if (idx[k]) row[idx[k] - from] = patch[k];
  });

  range.setValues([row]);
  invalidateTable_(name);
}

// ---------------------------------------------------------------- Config

/**
 * Config 시트를 key/value 객체로 읽는다. 5분 캐시.
 * 시트를 고친 뒤 즉시 반영이 필요하면 clearConfigCache() 를 실행한다.
 */
var __configMemo = null; // 실행 단위 메모. confBool_/confStr_ 이 자주 불려 왕복을 줄인다.

function getConfig_() {
  if (__configMemo) return __configMemo;

  var cache = CacheService.getScriptCache();
  var hit = cache.get('config_v1');
  if (hit) {
    try {
      __configMemo = JSON.parse(hit);
      return __configMemo;
    } catch (e) { /* 캐시 손상 시 재조회 */ }
  }

  var conf = {};
  readTable_(SHEETS.CONFIG).forEach(function (r) {
    var key = String(r['키'] || '').trim();
    if (key) conf[key] = String(r['값'] === null || r['값'] === undefined ? '' : r['값']).trim();
  });
  cache.put('config_v1', JSON.stringify(conf), 300);
  __configMemo = conf;
  return conf;
}

/**
 * 요청 간 캐시(CacheService) 읽기/쓰기 공용 헬퍼.
 *
 * CacheService 는 값 하나당 약 100KB 제한이 있고, 넘으면 **조용히 실패**한다.
 * 그래서 넣기 전에 크기를 재고, 너무 크면 캐시를 포기하고 매번 계산한다.
 * (틀린 값을 캐시하는 것보다 느린 편이 낫다.)
 */
var CACHE_MAX_BYTES = 90000;

function cacheGet_(key) {
  try {
    var hit = CacheService.getScriptCache().get(key);
    return hit ? JSON.parse(hit) : null;
  } catch (e) {
    return null; // 캐시 손상 — 그냥 다시 계산한다
  }
}

function cachePut_(key, value, seconds) {
  try {
    var json = JSON.stringify(value);
    if (json.length > CACHE_MAX_BYTES) return false;
    CacheService.getScriptCache().put(key, json, seconds);
    return true;
  } catch (e) {
    return false;
  }
}

/** 앱이 쓰는 요청 간 캐시 키 전부. 하나라도 늘면 여기에 추가한다. */
var CACHE_KEYS = ['config_v1', 'bootstrap_v1'];

/**
 * 위 캐시에 담기는 값의 **원천 탭**.
 * 이 탭들이 바뀌면 캐시가 낡으므로 즉시 비워야 한다 (onEdit 이 호출한다).
 */
function isCachedSourceSheet_(sheetName) {
  return [SHEETS.CONFIG, SHEETS.NOTICES, SHEETS.TIMELINE,
          SHEETS.CHECKPOINTS, SHEETS.COURSES].indexOf(sheetName) >= 0;
}

/** 설정·부트스트랩 캐시를 모두 비운다. 메뉴와 admin.config.set 이 호출한다. */
function clearConfigCache() {
  __configMemo = null;
  invalidateTable_(SHEETS.CONFIG);
  try {
    CacheService.getScriptCache().removeAll(CACHE_KEYS);
  } catch (e) {
    console.warn('cache clear failed: ' + e);
  }
}

function confStr_(key, fallback) {
  var v = getConfig_()[key];
  return (v === undefined || v === '') ? fallback : v;
}

function confBool_(key, fallback) {
  var v = getConfig_()[key];
  if (v === undefined || v === '') return fallback;
  return /^(true|y|yes|1|on)$/i.test(String(v));
}

function confInt_(key, fallback) {
  var n = parseInt(getConfig_()[key], 10);
  return isNaN(n) ? fallback : n;
}

// ---------------------------------------------------------------- 유틸

function nowIso_() {
  return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/** 시트 셀에서 읽은 값(Date 또는 문자열)을 ISO 문자열로 정규화한다. */
function toIso_(value) {
  if (!value && value !== 0) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, TZ, "yyyy-MM-dd'T'HH:mm:ssXXX");
  }
  return String(value).trim();
}

/** 시트 셀을 'HH:mm' 로 정규화한다 (Timeline 의 시작/종료). */
function toHm_(value) {
  if (!value && value !== 0) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, TZ, 'HH:mm');
  }
  return String(value).trim();
}

function str_(v) {
  return (v === null || v === undefined) ? '' : String(v).trim();
}

function bool_(v) {
  return /^(true|y|yes|1|on|예|사용)$/i.test(str_(v));
}

/**
 * `PREFIX + 0패딩 숫자` 형식의 다음 ID를 만든다.
 * 기존 값 중 최대 숫자 + 1 이므로 중간 행을 지워도 충돌하지 않는다.
 * 반드시 스크립트 락 안에서 호출할 것.
 */
function nextId_(sheetName, column, prefix, pad) {
  return padId_(prefix, maxIdNumber_(readTable_(sheetName), column, prefix) + 1, pad);
}

/** 이미 읽어 둔 행 목록에서 가장 큰 번호를 찾는다. 시트를 다시 읽지 않는다. */
function maxIdNumber_(rows, column, prefix) {
  var re = new RegExp('^' + prefix + '(\\d+)$');
  var max = 0;
  rows.forEach(function (r) {
    var m = String(r[column] || '').match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return max;
}

/** 번호를 자리수에 맞춰 'P0007' 꼴로 만든다. */
function padId_(prefix, n, pad) {
  var s = String(n);
  while (s.length < pad) s = '0' + s;
  return prefix + s;
}

/** 쓰기 작업 직렬화. 동시 요청이 같은 행을 깨뜨리지 않게 한다. */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    throw new AppError('SERVER_ERROR', '요청이 몰리고 있습니다. 잠시 후 다시 시도해 주세요.');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- 로그

function logEvent_(action, actor, target, result, detail) {
  try {
    appendRow_(SHEETS.LOG, {
      '일시': nowIso_(),
      '액션': action,
      '행위자': str_(actor),
      '대상': str_(target),
      '결과': str_(result),
      '상세': typeof detail === 'string' ? detail : JSON.stringify(detail || '')
    });
  } catch (e) {
    // 로그 실패가 본 작업을 막지 않게 한다.
    console.error('logEvent_ failed: ' + e);
  }
}
