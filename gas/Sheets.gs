/**
 * ────────────────────────────────────────────────────────────────
 * Sheets.gs · v16 · 2026-09-26
 * ────────────────────────────────────────────────────────────────
 * 변경 이력 (최근 5건 — 전체는 docs-dev/spec/DECISIONS.md · git log)
 *  v16   2026-09-26  교역자·담당 지점·점수출처·수상 열, 지금 회차 (D-051·052)
 *  v15   2026-09-26  파일 버전 표시 시작
 *  v14   2026-09-22  공지를 운영콘솔에서 쓴다
 *  —     2026-09-19  진행 기록이 왜 8.5초인지 구간별로 잰다
 *  —     2026-09-19  이미 쌓인 ISO 글자도 날짜로 바꾼다
 *
 * 버전: vN = GAS 배포 번호. vN.k = 서버는 vN 그대로 두고 앱·도구만 고친 k번째.
 *       — 는 버전 기록을 시작하기 전(v12 이전)의 변경.
 * 🔴 이 파일을 고치면 맨 위 줄(이름·버전·날짜)과 이력을 함께 고친다 (CLAUDE.md).
 * ────────────────────────────────────────────────────────────────
 */
var VERSION_SHEETS = 'v16';   // 헤더의 버전과 같아야 한다. health 가 이 값을 알려 준다.

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
  ROLE: '역할',                 // 일반 / 조장 / 스태프 / 교역자
  INSURANCE: '여행자 보험 가입',
  COURSE: '배정 코스',          // A코스(배재 시작) …
  NOTE: '비고',
  STATION: '담당 지점'          // 거점 스태프만. 지점코드(CP1…) — D-051
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
    '등록일시', COL.STATION
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
    '도착시각', '완료시각', '퀴즈점수', '기록자ID', '메모', '수정일시',
    '점수출처'                // 스태프 / 조장 / 관리자 — 점수를 넣은 쪽 (D-052)
  ],
  Journal: [
    '일지ID', COL.SESSION, COL.GROUP, '참가자ID', '작성자명', '지점코드', '내용',
    '사진ID', '사진URL', '상태', '반려사유',
    '작성일시', '수정일시', '수정자ID', '검토자', '검토일시',
    '수상'                    // ★ 사진 수상작 (D-052)
  ],
  Notices: ['공지ID', '대상', '제목', '내용', '고정', '게시일시', '종료일시'],
  Timeline: [COL.SESSION, '순번', '시작', '종료', '내용', '장소', '비고'],
  Log: ['일시', '액션', '행위자', '대상', '결과', '상세']
};

/** 상태/역할 등 열거값 — 데이터 검증과 코드가 공유한다. */
var ENUM = {
  AUDIENCE: ['청년부', '장년부'],
  ROLE: ['일반', '조장', '스태프', '교역자'],
  FEE: ['미납', '완납', '면제'],
  FEE_AMOUNT: ['20000', '30000'],
  INSURANCE: ['미가입', '가입완료'],
  PROGRESS: ['대기', '도착', '완료'],
  JOURNAL: ['대기', '승인', '반려', '삭제']
};

/** **조가 있을 때** 조장 권한을 갖는 역할. 스태프·교역자도 현장에서 대신 기록해야 할 때가 있다. */
var LEADER_ROLES = ['조장', '스태프', '교역자'];

/**
 * 조 없이도 앱을 쓰는 운영 역할 (D-051).
 *
 * 🔴 "운영진" 이라는 가짜 조를 만들지 않는다. 가짜 조는 진행 보드(0/4 카드),
 * 명단 점검("조장이 없음"), 조 목록 동기화, 회비 보드에 전부 새어 나가고,
 * 스태프가 코스 없는 조의 조장이 된다. 조가 없으면 **역할**로 모드를 정한다.
 */
var OPS_ROLES = ['스태프', '교역자'];

function isOpsRole_(role) {
  return OPS_ROLES.indexOf(str_(role)) >= 0;
}

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
 * 부서 목록 — Config `AUDIENCES`(쉼표로 구분). 없으면 청년부·장년부 (D-053).
 * 다음 캠프 부서가 달라도 코드를 고치지 않는다. 드롭다운·공지 대상·콘솔 필터가 따라온다.
 */
function audiences_() {
  var list = confStr_('AUDIENCES', '').split(/[,，\/]/)
    .map(function (x) { return String(x).trim(); }).filter(String);
  return list.length ? list : ENUM.AUDIENCE.slice();
}

/** 오늘 날짜(서울). 테스트가 갈아 끼울 수 있게 한 곳에 둔다. */
function todayStr_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

/**
 * "지금" 회차 — 오늘 날짜의 활성 회차, 없으면 **다음** 활성 회차, 없으면 마지막 활성 회차.
 * 날짜가 없는 회차는 날짜 있는 회차가 하나도 없을 때만 쓴다. 활성 회차가 없으면 ''.
 */
function currentSessionLabel_() {
  var act = sessions_().filter(function (s) { return s.active; });
  if (!act.length) return '';
  var dated = act.filter(function (s) { return s.date; })
    .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  if (!dated.length) return act[0].label;
  var today = todayStr_();
  for (var i = 0; i < dated.length; i++) {
    if (dated[i].date >= today) return dated[i].label;   // 오늘이거나 다음
  }
  return dated[dated.length - 1].label;
}

/**
 * 이 사람의 회차.
 *
 * 🔴 조 없는 교역자·스태프는 `참여 일자` 를 **비워 두면 전 회차**다 (D-051).
 * 한 사람 = 한 행이라, 두 회차를 다 일해도 같은 이름·번호가 두 행이 되지 않는다
 * (두 행이면 날짜 선택을 뺀 뒤 로그인이 `AMBIGUOUS` 로 막힌다). 그때는 지금 회차를 쓴다.
 */
function effectiveSession_(row) {
  var s = str_(row[COL.SESSION]);
  if (s) return s;
  if (isOpsRole_(row[COL.ROLE]) && !str_(row[COL.GROUP])) return currentSessionLabel_();
  return '';
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

/**
 * 행을 **실제로** 지운다 (D-048).
 *
 * 🔴 지우면 뒤 행의 번호가 한 칸씩 당겨진다. 캐시에 든 `__row` 가 전부 어긋나므로
 * 반드시 버린다. 부르는 쪽은 이 뒤에 들고 있던 행 번호를 쓰면 안 된다.
 *
 * 일지는 `상태=삭제` 로 남기지만(D-009) `Notices` 에는 `상태` 칸이 없고,
 * 잘못 올린 공지가 흔적으로 남을 이유도 없다.
 */
function deleteRow_(sheetName, rowIndex) {
  getSheet_(sheetName).deleteRow(rowIndex);
  invalidateTable_(sheetName);
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
    if (!key) return;
    var raw = r['값'];
    // 🔴 날짜 셀은 Date 객체로 온다. 그냥 String() 을 씌우면
    //    "Sat Oct 31 2026 00:00:00 GMT+0900 (한국 표준시)" 가 된다.
    //    이 값이 sessions_() 의 date 로 나가고, `일정 변경`(Setup.gs)이 그것을
    //    프롬프트 기본값으로 보여 줘 **다시 Config 에 써지기까지 한다.**
    conf[key] = (raw instanceof Date)
      ? Utilities.formatDate(raw, TZ, 'yyyy-MM-dd')
      : String(raw === null || raw === undefined ? '' : raw).trim();
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

/**
 * **통신용** 시각. 앱과 미러가 파싱하는 값이라 ISO 를 유지한다.
 * 시트 셀에는 쓰지 않는다 — 그쪽은 `nowStamp_()` 다.
 */
function nowIso_() {
  return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/**
 * **시트용** 시각. 문자열이 아니라 **진짜 Date** 를 넣는다 (D-040).
 *
 * 예전에는 `2026-09-19T10:12:31+09:00` 이라는 ISO 문자열을 셀에 그대로 넣었다.
 * 읽기 어렵고, 텍스트라 정렬·필터·수식이 전부 안 먹었다.
 *
 * Date 로 넣으면 셀 서식(`TIME_FORMAT`)대로 보이고 진짜 날짜로 동작한다.
 * 읽는 쪽은 전부 `toIso_` 를 거치므로 통신 형식은 하나도 바뀌지 않는다.
 */
function nowStamp_() {
  return new Date();
}

/** 시각 칸의 표시 서식. 모든 탭에서 **같아야** 한다. */
var TIME_FORMAT = 'yyyy-mm-dd hh:mm:ss';

/** 탭별 시각 칸. 여기 없는 칸은 서식을 건드리지 않는다. */
var TIME_COLUMNS = {
  Participants: ['등록일시'],
  Progress: ['도착시각', '완료시각', '수정일시'],
  Journal: ['작성일시', '수정일시', '검토일시'],
  Notices: ['게시일시', '종료일시'],
  Log: ['일시']
};

/**
 * 시각 칸에 표시 서식을 입힌다.
 *
 * 🔴 **이미 쓰던 시트에도 돌려야 한다.** 그 칸들은 예전에 ISO 문자열이 들어가
 * 있어서 '일반' 또는 '텍스트' 서식이다. 서식을 안 고치면 Date 를 넣어도
 * 엉뚱하게 보인다. 그래서 메뉴에도 넣는다.
 *
 * `Timeline` 의 시작·종료는 **시각(HH:mm)** 이지 시점이 아니므로 대상이 아니다.
 */
function applyTimeFormats_() {
  var ss = getSpreadsheet_();
  var touched = 0;

  Object.keys(TIME_COLUMNS).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    var idx = headerIndex_(name);
    var rows = Math.max(sh.getMaxRows() - 1, 1);

    TIME_COLUMNS[name].forEach(function (col) {
      if (!idx[col]) return;
      sh.getRange(2, idx[col], rows, 1).setNumberFormat(TIME_FORMAT);
      touched++;
    });
  });
  return touched;
}

/** `2026-09-19T10:12:31+09:00` 처럼 우리가 예전에 써 넣던 ISO 글자인가. */
var ISO_TEXT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[+-]\d{2}:\d{2}|Z)?$/;

/**
 * 이미 들어 있는 ISO **글자**를 진짜 Date 로 바꾼다 (D-040 보강).
 *
 * 서식만 입히면 **새로 기록되는 값부터** 바뀐다. 그런데 이미 쌓인 값이 계속
 * 글자로 남아 있으면 그건 통일이 아니다 — 같은 칸에 두 가지가 섞인다.
 * 그래서 한 번에 바꾼다.
 *
 * 🔴 **모양만 바꾸는 것이 아니라 값의 型을 바꾸는 것**이라 원장을 건드린다.
 * 안전하게 두는 조건 셋:
 *   · ISO 형식에 **정확히** 맞는 글자만 건드린다. 운영진이 손으로 적은 메모는 그대로 둔다
 *   · 가리키는 시점은 **똑같다** — 표기만 바뀐다
 *   · 여러 번 돌려도 같다 (Date 는 건너뛴다)
 */
function convertTimeTextToDates_() {
  var ss = getSpreadsheet_();
  var changed = 0;

  Object.keys(TIME_COLUMNS).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    var last = sh.getLastRow();
    if (last < 2) return;
    var idx = headerIndex_(name);

    TIME_COLUMNS[name].forEach(function (col) {
      if (!idx[col]) return;
      var range = sh.getRange(2, idx[col], last - 1, 1);
      var values = range.getValues();
      var hit = 0;

      for (var i = 0; i < values.length; i++) {
        var v = values[i][0];
        if (typeof v !== 'string') continue;          // 이미 Date 거나 빈 칸
        var t = v.trim();
        if (!ISO_TEXT.test(t)) continue;              // 우리가 쓴 형식이 아니다 → 손대지 않는다
        var d = new Date(t);
        if (isNaN(d.getTime())) continue;             // 파싱이 안 되면 그대로 둔다
        values[i][0] = d;
        hit++;
      }

      if (hit) { range.setValues(values); changed += hit; }
    });
  });

  if (changed) invalidateHeaders_();
  return changed;
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

/**
 * 구간별 소요 시간을 한 줄로. `Log` 탭의 `상세` 칸에 들어간다 (D-043).
 * 새 화면도 새 통신 형식도 만들지 않고, 이미 있는 자리에 남긴다.
 */
function timingText_(t) {
  return Object.keys(t).map(function (k) { return k + '=' + t[k]; }).join(' ');
}

function logEvent_(action, actor, target, result, detail) {
  try {
    appendRow_(SHEETS.LOG, {
      '일시': nowStamp_(),
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
