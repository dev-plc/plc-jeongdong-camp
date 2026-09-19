/**
 * Setup.gs — 최초 1회 실행하는 시트 생성/점검 스크립트
 *
 * 편집기에서 setupSpreadsheet() 를 실행하면 10개 탭과 헤더, 데이터 검증, 시드 데이터를 만든다.
 * 이미 있는 탭은 헤더만 보강하고 데이터는 건드리지 않는다(여러 번 실행해도 안전).
 */

/**
 * 시각 칸 서식만 다시 입힌다 (D-040).
 *
 * 이미 쓰던 시트는 그 칸들이 ISO 문자열을 담고 있어 '일반'·'텍스트' 서식이다.
 * 초기 세팅을 다시 돌리지 않고 이것만 눌러 통일할 수 있게 메뉴에 둔다.
 */
function fixTimeFormats() {
  var n = applyTimeFormats_();
  var msg = n
    ? '✅ 시각 칸 ' + n + '개의 표기를 통일했습니다.\n형식: ' + TIME_FORMAT +
      '\n\n이미 들어 있던 값이 글자로 남아 있으면, 그 칸은 새로 기록될 때부터 바뀝니다.'
    : '⚠ 시각 칸을 찾지 못했습니다. 먼저 "초기 세팅 실행" 을 해 주세요.';
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { console.log(msg); }
  return n;
}

function setupSpreadsheet() {
  var ss = getSpreadsheet_();
  ss.setSpreadsheetTimeZone(TZ);

  Object.keys(SCHEMA).forEach(function (logical) {
    // 행정팀 원장이 이미 `마스터` 탭으로 있으면 Participants 를 새로 만들지 않는다.
    var name = resolveSheetName_(logical);
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    ensureHeaders_(sh, SCHEMA[logical]);
    sh.setFrozenRows(1);
  });
  invalidateHeaders_(); // 헤더가 바뀌었으니 열 번호 캐시를 버린다

  seedConfig_();
  seedCheckpoints_();
  seedCourses_();
  seedTimeline_();
  applyValidation_();
  applyTimeFormats_();     // 시각 칸을 사람이 읽을 수 있게 (D-040)
  autoResize_();

  // 토큰 서명 키가 없으면 만들어 둔다.
  getTokenSecret_();

  var pin = PropertiesService.getScriptProperties().getProperty('ADMIN_PIN');
  var skipped = __validationSkipped.length
    ? ['', '⚠ 드롭다운을 못 넣은 열 ' + __validationSkipped.length + '개:',
       '  ' + __validationSkipped.join(', '),
       '  (이미 시트에 드롭다운이 걸려 있는 열입니다. 앱 동작에는 지장 없습니다)']
    : [];
  var msg = [
    '✅ 시트 준비 완료.',
    '',
    '남은 작업:',
    pin ? '  · ADMIN_PIN 설정됨' : '  ⚠ 스크립트 속성에 ADMIN_PIN 을 추가하세요 (6자리 이상)',
    '  · Config 시트의 DRIVE_FOLDER_ID 에 사진 저장용 Drive 폴더 ID 입력',
    '  · 원장 탭: ' + resolveSheetName_('Participants') + ' (헤더가 스키마와 같아야 합니다)',
    '  · 참가자ID 채우기 → 조 목록 동기화 → 명단 점검 순으로 실행',
    '  · Checkpoints 의 주소·위도·경도는 1차 사전답사 결과로 검증 후 채울 것',
    '  · 배포 → 웹 앱 → 실행: 나 / 액세스: 모든 사용자'
  ].concat(skipped).join('\n');
  console.log(msg);
  alert_(msg);
}

/** UI 가 없는 실행 컨텍스트(트리거·웹앱)에서도 죽지 않게 감싼다. */
function alert_(msg) {
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* UI 없음 */ }
}

/** 헤더가 없으면 쓰고, 빠진 헤더가 있으면 뒤에 덧붙인다. 기존 열은 옮기지 않는다. */
function ensureHeaders_(sh, headers) {
  var lastCol = sh.getLastColumn();
  var existing = lastCol > 0
    ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); })
    : [];

  if (existing.filter(String).length === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    // 별칭으로 이미 있는 열(`연락처` ↔ `핸드폰`)은 '없는 것'으로 치면 안 된다.
    // 그대로 덧붙이면 빈 중복 열이 생기고, 값이 없는 쪽이 우선돼 로그인이 조용히 막힌다.
    var missing = headers.filter(function (h) {
      if (existing.indexOf(h) >= 0) return false;
      var alts = COL_ALIASES[h] || [];
      for (var i = 0; i < alts.length; i++) {
        if (existing.indexOf(alts[i]) >= 0) return false;
      }
      return true;
    });
    if (missing.length) {
      sh.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
    }
  }
  var width = Math.max(sh.getLastColumn(), headers.length);
  sh.getRange(1, 1, 1, width)
    .setFontWeight('bold')
    .setBackground('#984534')
    .setFontColor('#ffffff');
}

// ---------------------------------------------------------------- 시드

/** Config 는 비어 있는 키만 채운다. 이미 운영 중인 값은 덮어쓰지 않는다. */
function seedConfig_() {
  var defaults = [
    ['CAMP_NAME', '정동, 신앙탐험대', '앱 상단 타이틀'],
    ['CAMP_SUBTITLE', 'PLC 성경적세계관 캠프', '부제'],
    ['SESSION_1', '10/31(토)', '1차 참여 일자(청년부) — 명단의 "참여 일자" 표기와 글자까지 같아야 함'],
    ['SESSION_1_DATE', '2026-10-31', '1차 실제 날짜'],
    ['SESSION_2', '11/07(토)', '2차 참여 일자(장년부)'],
    ['SESSION_2_DATE', '2026-11-07', '2차 실제 날짜'],
    ['GALLERY_SCOPE', 'ALL', '탐험일지 공개 범위: ALL(전체) / TEAM(같은 조) / SELF(본인만)'],
    ['JOURNAL_REQUIRE_APPROVAL', 'TRUE', 'TRUE면 승인된 일지만 갤러리에 노출'],
    ['JOURNAL_OPEN', 'TRUE', 'FALSE면 일지 작성/수정 차단'],
    ['PROGRESS_OPEN', 'TRUE', 'FALSE면 조장의 지점 체크 차단'],
    ['SHOW_FEE', 'TRUE', '회비 상태 화면 노출 여부'],
    ['DRIVE_FOLDER_ID', '', '⚠ 탐험일지 사진이 저장될 Drive 폴더 ID — 반드시 입력'],
    ['TOKEN_TTL_HOURS', '12', '로그인 유지 시간(시간)'],
    ['LOGIN_ALLOW_NAME_DIGITS', 'TRUE',
      '⚠ 연락처가 임시값인 동안만 TRUE. 실제 연락처를 다 채우면 FALSE 로 내릴 것 (명단 점검이 알려줌)'],
    ['PHOTO_MAX_BYTES', '4000000', '사진 1장 최대 바이트'],
    ['NOTICE_TICKER', '', '앱 상단 한 줄 공지. 비우면 숨김']
  ];

  var existing = {};
  readTable_(SHEETS.CONFIG).forEach(function (r) { existing[str_(r['키'])] = true; });

  defaults.forEach(function (row) {
    if (!existing[row[0]]) {
      appendRow_(SHEETS.CONFIG, { '키': row[0], '값': row[1], '설명': row[2] });
    }
  });
  clearConfigCache();
}

/**
 * 기획안의 답사 4개 지점.
 * 주소는 초안이고 위도/경도는 비워 둔다 — 1차 사전답사에서 확인한 값으로 채울 것.
 */
function seedCheckpoints_() {
  if (readTable_(SHEETS.CHECKPOINTS).length > 0) return;

  var rows = [
    {
      '지점코드': 'CP1', '기본순번': 1, '지점명': '배재학당역사박물관',
      '주소': '서울 중구 서소문로11길 19 (답사 시 확인)',
      '한줄소개': '아펜젤러가 세운 한국 최초의 근대식 중등교육기관',
      '현장설명': '1885년 아펜젤러가 시작한 배재학당의 자리. 근대 교육과 선교가 어떻게 함께 시작되었는지 확인합니다.',
      '미션': '배재학당의 설립 연도와 교훈을 찾아 적어 보세요.',
      '체류시간분': 25
    },
    {
      '지점코드': 'CP2', '기본순번': 2, '지점명': '러시아 공사관과 킹스로드',
      '주소': '서울 중구 정동길 41-11 (답사 시 확인)',
      '한줄소개': '아관파천의 현장과 고종이 걸었던 길',
      '현장설명': '구 러시아공사관 탑과 덕수궁으로 이어지는 길. 격동기 조선의 정세와 그 속의 신앙 공동체를 봅니다.',
      '미션': '공사관 건물에서 지금 남아 있는 부분은 어디까지인지 확인해 보세요.',
      '체류시간분': 25
    },
    {
      '지점코드': 'CP3', '기본순번': 3, '지점명': '보구여관 터',
      '주소': '서울 중구 정동 일대 (답사 시 확인)',
      '한줄소개': '한국 최초의 여성 전용 병원이 있던 자리',
      '현장설명': '1887년 스크랜턴이 세운 여성 전용 병원. 의료 선교가 여성의 삶을 어떻게 바꾸었는지 살펴봅니다.',
      '미션': '보구여관이라는 이름의 뜻을 찾아보세요.',
      '체류시간분': 25
    },
    {
      '지점코드': 'CP4', '기본순번': 4, '지점명': '이화여고 박물관',
      '주소': '서울 중구 정동길 26 (답사 시 확인)',
      '한줄소개': '이화학당에서 시작된 한국 여성 교육의 출발점',
      '현장설명': '메리 스크랜턴이 학생 한 명으로 시작한 이화학당. 심슨기념관에 남은 흔적을 따라갑니다.',
      '미션': '이화학당의 첫 학생 이름을 찾아보세요.',
      '체류시간분': 25
    }
  ];
  rows.forEach(function (r) { appendRow_(SHEETS.CHECKPOINTS, r); });
}

/**
 * 배정 코스 — 조마다 시작 지점을 달리해 현장 혼잡을 분산한다(기획안 리스크 대응).
 * 코스명은 마스터시트의 "배정 코스" 표기와 같아야 하지만, 앞글자(A/B/C/D)만 같아도 매칭된다.
 */
function seedCourses_() {
  if (readTable_(SHEETS.COURSES).length > 0) return;

  [
    ['A코스(배재 시작)', 'CP1,CP2,CP3,CP4'],
    ['B코스(러시아 시작)', 'CP2,CP3,CP4,CP1'],
    ['C코스(보구여관 시작)', 'CP3,CP4,CP1,CP2'],
    ['D코스(이화여고 시작)', 'CP4,CP1,CP2,CP3']
  ].forEach(function (c) {
    appendRow_(SHEETS.COURSES, { '코스명': c[0], '방문 순서': c[1], '비고': '' });
  });
}

/**
 * 기획안 4장의 당일 타임라인.
 * 10/31 은 교육(오전)부터, 11/07 은 오후 답사만 진행한다.
 * 확정 시 시트에서 직접 수정하면 앱에 바로 반영된다.
 */
function seedTimeline_() {
  if (readTable_(SHEETS.TIMELINE).length > 0) return;

  var afternoon = [
    ['13:30', '14:00', '이동 (노량진역 → 시청역)', '지하철 1호선', '도보·환승 포함 약 30분'],
    ['14:00', '14:25', '① 첫 번째 지점', '', '조별 배정 코스에 따라 순서가 다릅니다'],
    ['14:25', '14:35', '이동', '', ''],
    ['14:35', '15:00', '② 두 번째 지점', '', '조별 관람 + 현장 설명'],
    ['15:00', '15:10', '이동', '', ''],
    ['15:10', '15:35', '③ 세 번째 지점', '', '조별 관람 + 현장 설명'],
    ['15:35', '15:45', '이동', '', ''],
    ['15:45', '16:10', '④ 네 번째 지점', '', '조별 관람 + 현장 설명'],
    ['16:10', '16:25', '이동 (인근 카페로)', '', ''],
    ['16:25', '17:00', '마무리 모임 — 소감 나눔 및 정리', '인근 카페', '카페 대관 사전 협의 필요']
  ];

  var full = [
    ['09:30', '09:50', '도착 · 등록 · 조편성 확인', 'PL교회', '명찰/조 배정표 배부'],
    ['09:50', '10:20', '오프닝 (OT + 찬양)', 'PL교회', '30분, 전체 모임'],
    ['10:20', '11:10', '강의 1챕터', 'PL교회', '50분'],
    ['11:10', '11:20', '쉬는 시간', '', '10분'],
    ['11:20', '12:10', '강의 2챕터', 'PL교회', '50분'],
    ['12:10', '12:40', '조별 나눔 (통합)', 'PL교회', '나눔 질문지 활용 — 답사 전 기대감 형성'],
    ['12:40', '13:30', '점심식사', 'PL교회 인근', '조별 이동/식사']
  ].concat(afternoon);

  var afternoonOnly = [
    ['13:00', '13:30', '당일 세부일정 OT', 'PL교회', '등록 & 이름표 배부']
  ].concat(afternoon);

  var list = sessions_();
  if (list[0]) writeTimeline_(list[0].label, full);
  if (list[1]) writeTimeline_(list[1].label, afternoonOnly);
}

function writeTimeline_(session, rows) {
  rows.forEach(function (r, i) {
    var obj = { '순번': i + 1, '시작': r[0], '종료': r[1], '내용': r[2], '장소': r[3], '비고': r[4] };
    obj[COL.SESSION] = session;
    appendRow_(SHEETS.TIMELINE, obj);
  });
}

// ---------------------------------------------------------------- 데이터 검증

/** 행정가가 오타로 잘못된 값을 넣지 않도록 드롭다운을 건다. */
/**
 * 드롭다운(데이터 검증)을 넣는다. **실패해도 세팅을 멈추지 않는다.**
 *
 * 행정팀이 이미 시트에서 드롭다운을 걸어 둔 열에는 구글시트가 **'열 유형'** 을 적용하는데,
 * 그런 열에는 스크립트가 데이터 검증을 덮어쓸 수 없다
 * ("이 작업은 유형이 적용된 열의 셀에서 사용할 수 없습니다").
 * 드롭다운은 입력 실수를 줄이는 편의 기능일 뿐 앱 동작에는 필요 없으므로,
 * 막힌 열은 건너뛰고 어디가 막혔는지만 알려 준다.
 */
var __validationSkipped = [];

function applyValidation_() {
  __validationSkipped = [];
  var sessionList = sessionLabels_();
  var courseList = readTable_(SHEETS.COURSES).map(function (r) { return str_(r['코스명']); }).filter(String);

  dropdown_(SHEETS.PARTICIPANTS, COL.AUDIENCE, ENUM.AUDIENCE);
  dropdown_(SHEETS.PARTICIPANTS, COL.SESSION, sessionList);
  dropdown_(SHEETS.PARTICIPANTS, COL.ROLE, ENUM.ROLE);
  dropdown_(SHEETS.PARTICIPANTS, COL.FEE_STATUS, ENUM.FEE);
  dropdown_(SHEETS.PARTICIPANTS, COL.INSURANCE, ENUM.INSURANCE);
  dropdown_(SHEETS.PARTICIPANTS, COL.COURSE, courseList);
  dropdown_(SHEETS.TEAMS, COL.SESSION, sessionList);
  dropdown_(SHEETS.PROGRESS, '상태', ENUM.PROGRESS);
  dropdown_(SHEETS.JOURNAL, '상태', ENUM.JOURNAL);
  dropdown_(SHEETS.NOTICES, '대상', ['전체'].concat(ENUM.AUDIENCE).concat(sessionList));
  dropdown_(SHEETS.TIMELINE, COL.SESSION, sessionList);
}

function dropdown_(sheetName, header, values) {
  if (!values || !values.length) return;
  var sh = getSheet_(sheetName);
  var col = headerIndex_(sheetName)[header];
  if (!col) return;
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(false).build();

  try {
    sh.getRange(2, col, Math.max(sh.getMaxRows() - 1, 1)).setDataValidation(rule);
    // GAS 는 쓰기를 모아 뒀다가 다음 읽기 때 내보낸다. flush 를 안 하면 예외가
    // **다음 함수의 읽기 지점**에서 터져 이 try 가 못 잡고 세팅 전체가 죽는다.
    // (실제로 headerIndex_ 안에서 터지는 것처럼 보고돼 원인을 찾기 어려웠다.)
    SpreadsheetApp.flush();
  } catch (e) {
    __validationSkipped.push(sheetName + ' → ' + header);
  }
}

function autoResize_() {
  Object.keys(SCHEMA).forEach(function (logical) {
    var sh = getSheet_(logical);
    sh.autoResizeColumns(1, Math.max(sh.getLastColumn(), 1));
  });
}

// ---------------------------------------------------------------- 점검

/**
 * 명단이 앱에서 제대로 동작하는지 미리 점검한다.
 * 캠프 전날에 한 번 돌려 보는 것을 권한다.
 */
function checkDuplicates() {
  var rows = readTable_(SHEETS.PARTICIPANTS).filter(function (r) { return str_(r[COL.NAME]); });
  var sessionList = sessionLabels_();
  // 비활성 회차에 사람이 있으면 그 사람은 **로그인이 막힌다.** 조용히 두면 안 된다 (D-031).
  var inactiveList = sessions_().filter(function (x) { return !x.active; })
    .map(function (x) { return x.label; });
  var courseNames = readTable_(SHEETS.COURSES).map(function (r) { return str_(r['코스명']); });

  var seen = {};
  var dup = [], missing = [], badSession = [], noLeader = [], courseMismatch = [], badCourse = [];
  var inactive = [];
  var audienceBySession = {};   // 회차별 부서 분포 — 1:1 원칙과 어긋나는지 보기 위함

  // 같은 연락처가 여러 행에 반복되면 아직 채우지 않은 임시값으로 본다.
  var phoneCount = {};
  var noPhone = 0;
  rows.forEach(function (r) {
    var digits = str_(r[COL.PHONE]).replace(/\D/g, '');
    if (!digits) { noPhone++; return; }
    phoneCount[digits] = (phoneCount[digits] || 0) + 1;
  });
  var placeholders = Object.keys(phoneCount).filter(function (p) { return phoneCount[p] >= 3; });
  var placeholderRows = placeholders.reduce(function (n, p) { return n + phoneCount[p]; }, 0);

  rows.forEach(function (r) {
    var name = str_(r[COL.NAME]);
    var parsed = splitName_(name);
    var last4 = phoneLast4_(r[COL.PHONE]);

    if (!last4 && !(confBool_('LOGIN_ALLOW_NAME_DIGITS', true) && parsed.digits)) {
      missing.push('행 ' + r.__row + ' (' + name + '): 연락처 없음 — 로그인 불가');
    }
    if (!str_(r['참가자ID'])) {
      missing.push('행 ' + r.__row + ' (' + name + '): 참가자ID 없음 — "참가자ID 채우기" 실행 필요');
    }
    var session = str_(r[COL.SESSION]);
    if (!session) {
      badSession.push('행 ' + r.__row + ' (' + name + '): 참여 일자 미배정 — 로그인 불가');
    } else if (sessionList.indexOf(session) < 0) {
      badSession.push('행 ' + r.__row + ' (' + name + '): 참여 일자 "' + session +
        '" 가 Config 의 회차 목록에 없음 (' + sessionList.join(' / ') + ')');
    }
    if (session && inactiveList.indexOf(session) >= 0) {
      inactive.push('행 ' + r.__row + ' (' + name + '): "' + session + '" 는 비활성 회차 — 로그인 불가');
    }
    if (session && sessionList.indexOf(session) >= 0) {
      var aud = str_(r[COL.AUDIENCE]);
      if (aud) {
        if (!audienceBySession[session]) audienceBySession[session] = {};
        audienceBySession[session][aud] = (audienceBySession[session][aud] || 0) + 1;
      }
    }

    var course = str_(r[COL.COURSE]);
    if (course && courseNames.indexOf(course) < 0) {
      badCourse.push('행 ' + r.__row + ' (' + name + '): 배정 코스 "' + course + '" 가 Courses 시트에 없음');
    }

    // 로그인 키 충돌: 이름(끝 4자리 뗀 것) + 뒷4자리.
    // 실제로 인정되는 후보만 본다. 연락처 뒷자리와 이름 뒤 구분번호가 같으면 겹치므로 중복 제거.
    var candidates = [last4];
    if (confBool_('LOGIN_ALLOW_NAME_DIGITS', true)) candidates.push(parsed.digits);
    var digits = candidates.filter(String).filter(function (d, i, arr) {
      return arr.indexOf(d) === i;
    });
    digits.forEach(function (d) {
      var key = parsed.base + '|' + d;
      if (seen[key] && seen[key] !== r.__row) {
        var line = '행 ' + seen[key] + ' 과 행 ' + r.__row + ': ' + parsed.base + ' / ****' + d;
        if (dup.indexOf(line) < 0) dup.push(line);
      } else {
        seen[key] = r.__row;
      }
    });
  });

  // 조별 점검: 조장 존재 여부, 배정 코스 일관성
  var groups = {};
  rows.forEach(function (r) {
    var session = str_(r[COL.SESSION]);
    var group = str_(r[COL.GROUP]);
    if (!session || !group) return;
    var key = session + ' ' + group;
    if (!groups[key]) groups[key] = { leaders: 0, courses: {} };
    if (str_(r[COL.ROLE]) === '조장') groups[key].leaders++;
    var c = str_(r[COL.COURSE]);
    if (c) groups[key].courses[c] = true;
  });
  Object.keys(groups).sort().forEach(function (key) {
    if (groups[key].leaders === 0) noLeader.push(key + ': 조장이 없음 — 진행 기록을 할 사람이 없습니다');
    var cs = Object.keys(groups[key].courses);
    if (cs.length > 1) courseMismatch.push(key + ': 배정 코스가 섞여 있음 (' + cs.join(' / ') + ')');
  });

  // 로그인 방식 점검 — 임시 연락처 여부에 따라 안내가 달라진다 (D-003)
  var allowNameDigits = confBool_('LOGIN_ALLOW_NAME_DIGITS', true);
  var loginNotes = [];
  if (placeholderRows) {
    loginNotes.push('연락처가 임시값으로 보이는 행 ' + placeholderRows + '건 (같은 번호 반복: ' +
      placeholders.map(function (p) { return '****' + p.slice(-4); }).join(', ') + ')');
  }
  if (noPhone) loginNotes.push('연락처가 비어 있는 행 ' + noPhone + '건');

  if (allowNameDigits && !placeholderRows && !noPhone) {
    loginNotes.push('✅ 연락처가 모두 실제 값으로 보입니다 → Config 의 LOGIN_ALLOW_NAME_DIGITS 를 ' +
      'FALSE 로 내리세요. 켜 둔 채로는 명단을 본 사람이 이름 뒤 4자리로 로그인할 수 있습니다.');
  } else if (allowNameDigits) {
    loginNotes.push('LOGIN_ALLOW_NAME_DIGITS=TRUE — 이름 뒤 4자리로도 로그인됩니다(임시 조치). ' +
      '연락처를 다 채우면 FALSE 로 내리세요.');
  } else {
    loginNotes.push('LOGIN_ALLOW_NAME_DIGITS=FALSE — 연락처 뒷 4자리로만 로그인됩니다.');
  }

  var out = [];
  out.push('참가자 ' + rows.length + '명, 조 ' + Object.keys(groups).length + '개');
  out.push('');
  out.push('[로그인]');
  loginNotes.forEach(function (n) { out.push('   · ' + n); });
  out.push('');
  block_(out, dup, '❌ 로그인 충돌 (해당 인원은 로그인 불가)', '✅ 로그인 충돌 없음');
  block_(out, missing, '⚠ 필수값 누락', '✅ 필수값 누락 없음');
  block_(out, badSession, '⚠ 참여 일자 문제', '✅ 참여 일자 정상');
  block_(out, inactive, '⚠ 비활성 회차 인원 (로그인 불가)', '✅ 비활성 회차에 배정된 인원 없음');
  block_(out, badCourse, '⚠ 배정 코스 오타', '✅ 배정 코스 정상');
  block_(out, courseMismatch, '⚠ 조 안에서 배정 코스 불일치', '✅ 조별 배정 코스 일관됨');
  block_(out, noLeader, '⚠ 조장 없는 조', '✅ 모든 조에 조장 있음');

  // 부서=일자 1:1 이 운영 원칙이지만 예외 인원이 있을 수 있다(D-016).
  // 그래서 **차단이 아니라 알림**이다. 섞였다는 사실만 보여 주고 판단은 사람이 한다.
  var mixed = [];
  Object.keys(audienceBySession).forEach(function (session) {
    var counts = audienceBySession[session];
    var names = Object.keys(counts);
    if (names.length <= 1) return;
    names.sort(function (a, b) { return counts[b] - counts[a]; });
    var detail = names.map(function (n) { return n + ' ' + counts[n] + '명'; }).join(', ');
    mixed.push(session + ': ' + detail + '  (주로 ' + names[0] + ')');
  });
  block_(out, mixed, 'ℹ 한 회차에 두 부서가 섞여 있음 — 의도한 것이면 무시하세요',
    '✅ 회차별 부서 단일');

  var text = out.join('\n');
  console.log(text);
  alert_(text);
  return text;
}

function block_(out, items, badTitle, okTitle) {
  if (items.length) {
    out.push(badTitle + ' — ' + items.length + '건:');
    items.forEach(function (i) { out.push('   · ' + i); });
  } else {
    out.push(okTitle);
  }
  out.push('');
}

/** 참가자 ID 가 비어 있는 행에 ID 를 채운다. 명단을 붙여넣기로 옮긴 뒤 실행. */
function fillParticipantIds() {
  return withLock_(function () {
    var rows = readTable_(SHEETS.PARTICIPANTS);
    var targets = rows.filter(function (r) {
      return !str_(r['참가자ID']) && str_(r[COL.NAME]);
    });

    if (targets.length) {
      // 다음 번호는 **루프 밖에서 한 번만** 구하고 메모리에서 올린다.
      // 예전에는 행마다 nextId_ 를 불렀는데, updateRow_ 가 캐시를 무효화하는 바람에
      // 다음 행에서 명단 전체를 다시 읽었다 — 160명이면 시트 전체 읽기가 160회였다.
      var seq = maxIdNumber_(rows, '참가자ID', 'P');

      // 대상 행이 흩어져 있어도 한 덩어리로 읽어 고치고 한 번에 되쓴다.
      var idx = headerIndex_(SHEETS.PARTICIPANTS);
      var cols = [idx['참가자ID'], idx['등록일시']].filter(function (c) { return c; });
      var from = Math.min.apply(null, cols);
      var to = Math.max.apply(null, cols);
      var first = targets[0].__row;
      var last = targets[targets.length - 1].__row;

      var range = getSheet_(SHEETS.PARTICIPANTS)
        .getRange(first, from, last - first + 1, to - from + 1);
      var block = range.getValues();
      var now = nowStamp_();

      targets.forEach(function (r) {
        var line = block[r.__row - first];
        line[idx['참가자ID'] - from] = padId_('P', ++seq, 4);
        if (idx['등록일시'] && !str_(r['등록일시'])) line[idx['등록일시'] - from] = now;
      });

      range.setValues(block);
      invalidateTable_(SHEETS.PARTICIPANTS);
    }

    var msg = targets.length + '건에 참가자ID를 채웠습니다.';
    console.log(msg);
    alert_(msg);
    return targets.length;
  });
}

/** 명단에 있는 (참여 일자, 조 배정) 조합을 Teams 시트에 만들어 둔다. 이미 있는 조는 건너뛴다. */
function syncTeams() {
  return withLock_(function () {
    var existing = {};
    readTable_(SHEETS.TEAMS).forEach(function (r) { existing[rowTeamKey_(r)] = true; });

    var added = 0;
    allTeams_().forEach(function (t) {
      if (existing[t.key]) return;
      var obj = { '조이름': t.group, '색상': '#984534', '집결장소': '', '비고': '' };
      obj[COL.SESSION] = t.session;
      obj[COL.GROUP] = t.group;
      appendRow_(SHEETS.TEAMS, obj);
      added++;
    });
    var msg = added + '개 조를 Teams 시트에 추가했습니다.';
    console.log(msg);
    alert_(msg);
    return added;
  });
}

/**
 * 스프레드시트 메뉴.
 *
 * ⚠ Apps Script 프로젝트 하나에 `onOpen` 은 **한 개만** 있을 수 있다.
 *   (같은 이름이 여러 파일에 있으면 마지막에 로드된 것만 살아남아 다른 메뉴가 조용히 사라진다)
 *   그래서 행정팀 동기화 스크립트의 메뉴도 여기서 함께 만든다 — MasterSync.gs 참고.
 */
/**
 * 회차를 하나 더 만든다. **사전답사 리허설이 이걸로 돌아간다.**
 *
 * 왜 메뉴인가: `Config` 탭에 `SESSION_3` 두 줄을 손으로 적어도 앱은 읽는다
 * (`sessions_()` 가 키를 훑으므로). 하지만 **`참여 일자` 드롭다운이 안 따라온다** —
 * 명단에서 새 회차를 고를 수가 없다. 그 뒷정리까지 한 번에 하려고 메뉴로 둔다.
 *
 * 사전답사를 특별 취급하지 않는다. **그냥 회차 하나**다. 그래야 로그인·조·지점 체크·
 * 일지가 본 캠프와 똑같은 경로로 돌아가고, 리허설의 의미가 생긴다 (D-026).
 */
function addSession() {
  var ui;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {
    throw new Error('이 기능은 시트 메뉴에서 실행해 주세요.');
  }

  var current = sessions_();

  var label = promptFor_(ui, '새 회차의 참여 일자', '');
  if (label === null) return;
  label = str_(label);
  if (!label) { ui.alert('참여 일자를 입력해 주세요.'); return; }

  // 라벨이 겹치면 두 회차의 조가 한 키로 뭉갠다 (D-011).
  var dup = current.filter(function (c) { return c.label === label; });
  if (dup.length) {
    ui.alert('"' + label + '" 는 이미 SESSION_' + dup[0].n + ' 에 있습니다.\n' +
      '회차마다 다른 표기를 쓰세요.');
    return;
  }

  var date = promptFor_(ui, '실제 날짜 (YYYY-MM-DD)', '');
  if (date === null) return;

  var maxN = 0;
  current.forEach(function (c) { if (c.n > maxN) maxN = c.n; });
  var n = maxN + 1;

  // 일정표를 베껴 올 회차. 사전답사는 본 캠프와 동선이 같아 이게 있으면 바로 화면이 뜬다.
  var copyFrom = null;
  if (current.length) {
    var source = current[0];
    var rows = readTable_(SHEETS.TIMELINE).filter(function (r) {
      return str_(r[COL.SESSION]) === source.label;
    });
    if (rows.length) {
      var ans = ui.alert('일정표 복사',
        '"' + source.label + '" 의 일정표 ' + rows.length + '행을 새 회차로 복사할까요?\n' +
        '(복사한 뒤 Timeline 탭에서 시간만 고치면 됩니다)',
        ui.ButtonSet.OK_CANCEL);
      if (ans === ui.Button.OK) copyFrom = rows;
    }
  }

  var confirm = ['이렇게 추가합니다.', '',
    '  키   : SESSION_' + n,
    '  일자 : ' + label,
    '  날짜 : ' + (date || '(비어 있음)'),
    '  일정표: ' + (copyFrom ? copyFrom.length + '행 복사' : '복사 안 함'),
    '', '진행할까요?'].join('\n');
  if (ui.alert('회차 추가', confirm, ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;

  withLock_(function () {
    appendRow_(SHEETS.CONFIG, {
      '키': 'SESSION_' + n, '값': label,
      '설명': n + '차 참여 일자 — 명단의 "' + COL.SESSION + '" 표기와 글자까지 같아야 함'
    });
    appendRow_(SHEETS.CONFIG, {
      '키': 'SESSION_' + n + '_DATE', '값': date, '설명': n + '차 실제 날짜'
    });
    // 끄는 스위치를 **미리 만들어 둔다.** 있어야 있는 줄 안다 (D-031).
    appendRow_(SHEETS.CONFIG, {
      '키': 'SESSION_' + n + '_ACTIVE', '값': 'TRUE',
      '설명': 'FALSE 로 두면 이 회차 참가자는 로그인할 수 없습니다 (명단은 그대로 남습니다)'
    });
  });

  clearConfigCache();          // 새 회차를 곧바로 읽게 한다
  invalidateTable_(SHEETS.CONFIG);

  if (copyFrom) {
    writeTimeline_(label, copyFrom.map(function (r) {
      return [str_(r['시작']), str_(r['종료']), str_(r['내용']), str_(r['장소']), str_(r['비고'])];
    }));
  }

  // 드롭다운에 새 라벨을 넣는다. 이게 이 메뉴의 존재 이유다.
  applyValidation_();

  var out = ['✅ 회차를 추가했습니다.', '',
    'SESSION_' + n + ' = ' + label + (date ? ' (' + date + ')' : ''),
    '끝나면 Config 의 SESSION_' + n + '_ACTIVE 를 FALSE 로 바꾸면 로그인이 막힙니다.'];
  if (copyFrom) out.push('일정표 ' + copyFrom.length + '행을 복사했습니다.');
  if (__validationSkipped.length) {
    out.push('', '⚠ 드롭다운을 못 넣은 열 ' + __validationSkipped.length + '개:');
    out.push('  ' + __validationSkipped.join(', '));
    out.push('  (이미 시트에 드롭다운이 걸려 있는 열입니다. 직접 입력하면 됩니다)');
  }
  out.push('', '다음 순서로 진행하세요.',
    '  1. 마스터에 이 회차로 참가할 사람을 추가하고 "' + COL.SESSION + '" 을 ' + label + ' 로',
    '  2. 참가자ID 채우기',
    '  3. 조 목록 동기화',
    '  4. 명단 점검');
  ui.alert(out.join('\n'));

  return { n: n, label: label, date: date, timeline: copyFrom ? copyFrom.length : 0 };
}

/**
 * 회차 날짜(참여 일자)를 바꾼다.
 *
 * **왜 메뉴로 만들었나**: `seedConfig_` 는 이미 있는 키를 덮어쓰지 않는다.
 * 그래서 `setupSpreadsheet()` 을 한 번 돌린 뒤에는 코드의 날짜를 아무리 고쳐도
 * 시트의 SESSION_1/2 는 그대로다. 일정 변경은 **배포가 아니라 운영 작업**이다 (D-021).
 *
 * **왜 다섯 탭인가**: 참여 일자는 표시값이 아니라 조를 특정하는 복합키의 한 축이다
 * (D-011). Config 만 바꾸면 명단·조·일정표·진행·일지가 전부 옛 라벨에 묶인 채 남아
 * 조가 통째로 사라진 것처럼 보인다.
 */
function changeSchedule() {
  var ui;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {
    throw new Error('이 기능은 시트 메뉴에서 실행해 주세요.');
  }

  // 회차 개수는 Config 가 정한다. 사전답사를 얹어 3회차가 되면 3번 묻는다 (D-026).
  var current = sessions_();
  if (!current.length) { ui.alert('Config 에 회차가 없습니다. 먼저 "회차 추가" 를 실행하세요.'); return; }

  var next = [];
  for (var i = 0; i < current.length; i++) {
    var ord = (i + 1) + '차';
    var label = promptFor_(ui, ord + ' 참여 일자', current[i].label);
    if (label === null) return;
    var date = promptFor_(ui, ord + ' 실제 날짜 (YYYY-MM-DD)', current[i].date);
    if (date === null) return;
    next.push({ n: current[i].n, from: current[i].label, label: label, date: date });
  }

  var blank = next.filter(function (x) { return !x.label; });
  if (blank.length) { ui.alert('참여 일자는 모두 입력해야 합니다.'); return; }

  // 서로 같은 라벨이 있으면 두 회차의 조가 한 키로 뭉갠다 (D-011).
  var seen = {};
  for (var d = 0; d < next.length; d++) {
    if (seen[next[d].label]) {
      ui.alert('참여 일자가 서로 같습니다: "' + next[d].label + '"\n회차마다 다른 값이어야 합니다.');
      return;
    }
    seen[next[d].label] = true;
  }

  // 옛 라벨 → 새 라벨. **반드시 이 맵을 한 번만 적용한다.**
  // 1차를 먼저 치환하고 2차를 치환하면, 새 1차 라벨이 옛 2차 라벨과 같은 경우
  // (10/24·10/31 → 10/31·11/07 이 정확히 그렇다) 두 회차가 한 값으로 뭉갠다.
  var rename = {};
  next.forEach(function (x) { if (x.from && x.from !== x.label) rename[x.from] = x.label; });

  var targets = [SHEETS.PARTICIPANTS, SHEETS.TEAMS, SHEETS.TIMELINE,
                 SHEETS.PROGRESS, SHEETS.JOURNAL];

  // 되돌리기가 없으므로 바뀔 행 수를 먼저 보여 준다.
  var counts = targets.map(function (name) {
    return { name: name, n: countSessionRows_(name, rename) };
  });
  var total = counts.reduce(function (a, c) { return a + c.n; }, 0);

  // 옮겨갈 라벨에 **이미 행이 있으면** 두 무리가 한 회차로 합쳐진다.
  // (예: Timeline 이 이미 새 라벨로 시드돼 있는데 옛 라벨을 그쪽으로 미는 경우)
  // 조용히 합치면 조가 통째로 뒤섞이므로 반드시 먼저 보여 준다.
  var collisions = [];
  targets.forEach(function (name) {
    Object.keys(rename).forEach(function (from) {
      var to = rename[from];
      var n = countSessionRows_(name, keyedMap_(to));
      if (n) collisions.push('  · ' + name + ': "' + to + '" 에 이미 ' + n + '행이 있습니다');
    });
  });

  var lines = ['회차 날짜를 이렇게 바꿉니다.', ''];
  Object.keys(rename).forEach(function (from) { lines.push('  ' + from + '  →  ' + rename[from]); });
  if (!Object.keys(rename).length) lines.push('  (참여 일자 라벨은 그대로. 날짜만 갱신합니다)');
  lines.push('', '바뀌는 행:');
  counts.forEach(function (c) { lines.push('  · ' + c.name + ': ' + c.n + '행'); });
  if (total === 0 && Object.keys(rename).length) {
    lines.push('', '⚠ 바뀔 행이 하나도 없습니다.');
    lines.push('  명단의 참여 일자 표기가 현재 Config 값과 다를 수 있습니다.');
    lines.push('  (Config: ' + current.map(function (c) { return '"' + c.label + '"'; }).join(' / ') + ')');
  }
  if (collisions.length) {
    lines.push('', '⚠ 합쳐질 수 있습니다 — 옮겨갈 회차에 이미 행이 있습니다:');
    collisions.forEach(function (c) { lines.push(c); });
    lines.push('  두 무리가 한 회차로 섞입니다. 의도한 것인지 확인하세요.');
  }
  lines.push('', '되돌리기는 없습니다. 진행할까요?');
  lines.push('(문제가 생기면 파일 → 버전 기록 으로 되돌릴 수 있습니다)');

  if (ui.alert('일정 변경', lines.join('\n'), ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;

  var changed = withLock_(function () {
    var done = targets.map(function (name) {
      return { name: name, n: renameSessionIn_(name, rename) };
    });
    // allowNew: 키가 지워졌더라도 이 내부 호출은 통과해야 한다(오타 방어는 콘솔 입력용).
    next.forEach(function (x) {
      configSet_({ isAdmin: true }, { key: 'SESSION_' + x.n, value: x.label, allowNew: true });
      configSet_({ isAdmin: true }, { key: 'SESSION_' + x.n + '_DATE', value: x.date, allowNew: true });
    });
    return done;
  });

  clearConfigCache();

  var out = ['✅ 일정을 바꿨습니다.', ''];
  next.forEach(function (x, i) { out.push((i + 1) + '차: ' + x.label + ' (' + x.date + ')'); });
  out.push('');
  changed.forEach(function (c) { out.push('  · ' + c.name + ': ' + c.n + '행 수정'); });
  out.push('', '앱에는 즉시 반영됩니다.');
  ui.alert(out.join('\n'));
  return changed;
}

/** 기본값을 채워 보여 주는 입력창. 취소하면 null. */
function promptFor_(ui, label, current) {
  var res = ui.prompt(label, '현재: ' + (current || '(비어 있음)') + '\n\n새 값을 입력하세요.',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return null;
  var v = str_(res.getResponseText());
  return v || str_(current);
}

/** 값 하나만 담은 맵. countSessionRows_ 를 '이 라벨인 행 세기' 로도 쓰기 위한 것. */
function keyedMap_(label) {
  var m = {};
  m[label] = true;
  return m;
}

/** 이 탭에서 rename 대상이 되는 행 수를 센다(쓰지 않는다). */
function countSessionRows_(name, rename) {
  var idx = headerIndex_(name);
  if (!idx[COL.SESSION]) return 0;
  var n = 0;
  readTable_(name).forEach(function (r) {
    if (rename[str_(r[COL.SESSION])]) n++;
  });
  return n;
}

/**
 * 한 탭의 참여 일자 열을 rename 맵대로 바꾼다.
 * 열 하나만 통째로 읽어 고치고 **setValues 한 번**으로 되쓴다
 * (행마다 updateRow_ 를 부르면 fillParticipantIds 에서 겪은 전체 재읽기가 반복된다).
 */
function renameSessionIn_(name, rename) {
  var idx = headerIndex_(name);
  var col = idx[COL.SESSION];
  if (!col) return 0;

  var sh = getSheet_(name);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return 0;

  var range = sh.getRange(2, col, lastRow - 1, 1);
  var values = range.getValues();
  var changed = 0;

  for (var i = 0; i < values.length; i++) {
    var to = rename[str_(values[i][0])];
    if (to) { values[i][0] = to; changed++; }
  }
  if (changed) {
    range.setValues(values);
    invalidateTable_(name);
  }
  return changed;
}

function onOpen() {
  var ui;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {
    return; // UI 없는 컨텍스트
  }

  ui.createMenu('🧭 정동캠프')
    .addItem('초기 세팅 실행', 'setupSpreadsheet')
    .addItem('참가자ID 채우기', 'fillParticipantIds')
    .addItem('조 목록 동기화', 'syncTeams')
    .addItem('명단 점검', 'checkDuplicates')
    .addSeparator()
    .addItem('회차 추가 (사전답사 등)', 'addSession')
    .addItem('일정 변경 (회차 날짜)', 'changeSchedule')
    .addItem('캐시 비우기 (설정·공지·일정)', 'clearConfigCache')
    .addItem('시각 표기 통일', 'fixTimeFormats')
    .addSeparator()
    .addItem('미러 지금 갱신 (Supabase)', 'mirrorPushNow')
    .addItem('미러 자동 갱신 켜기 (하루 1회)', 'installMirrorTrigger')
    .addItem('캠프 모드 켜기 (10분 동기화)', 'installCampSync')
    .addItem('캠프 모드 끄기', 'stopCampSync')
    .addToUi();

  // 행정팀 탭 동기화 도구 (MasterSync.gs). 그 파일을 안 넣었으면 조용히 건너뛴다.
  if (typeof addMasterSyncMenu_ === 'function') addMasterSyncMenu_(ui);
}
