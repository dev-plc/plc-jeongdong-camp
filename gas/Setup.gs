/**
 * Setup.gs — 최초 1회 실행하는 시트 생성/점검 스크립트
 *
 * 편집기에서 setupSpreadsheet() 를 실행하면 10개 탭과 헤더, 데이터 검증, 시드 데이터를 만든다.
 * 이미 있는 탭은 헤더만 보강하고 데이터는 건드리지 않는다(여러 번 실행해도 안전).
 */

function setupSpreadsheet() {
  var ss = getSpreadsheet_();
  ss.setSpreadsheetTimeZone(TZ);

  Object.keys(SCHEMA).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    ensureHeaders_(sh, SCHEMA[name]);
    sh.setFrozenRows(1);
  });

  seedConfig_();
  seedCheckpoints_();
  seedCourses_();
  seedTimeline_();
  applyValidation_();
  autoResize_();

  // 토큰 서명 키가 없으면 만들어 둔다.
  getTokenSecret_();

  var pin = PropertiesService.getScriptProperties().getProperty('ADMIN_PIN');
  var msg = [
    '✅ 시트 준비 완료.',
    '',
    '남은 작업:',
    pin ? '  · ADMIN_PIN 설정됨' : '  ⚠ 스크립트 속성에 ADMIN_PIN 을 추가하세요 (6자리 이상)',
    '  · Config 시트의 DRIVE_FOLDER_ID 에 사진 저장용 Drive 폴더 ID 입력',
    '  · Participants 시트에 행정팀 마스터시트를 붙여넣기 (헤더가 같아야 합니다)',
    '  · 참가자ID 채우기 실행 → 명단 점검 실행',
    '  · Checkpoints 의 주소·위도·경도는 1차 사전답사 결과로 검증 후 채울 것',
    '  · 배포 → 웹 앱 → 실행: 나 / 액세스: 모든 사용자'
  ].join('\n');
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
    var missing = headers.filter(function (h) { return existing.indexOf(h) < 0; });
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
    ['SESSION_1', '10/24(토)', '1차 참여 일자 — 명단의 "참여 일자" 표기와 글자까지 같아야 함'],
    ['SESSION_1_DATE', '2026-10-24', '1차 실제 날짜'],
    ['SESSION_2', '10/31(토)', '2차 참여 일자'],
    ['SESSION_2_DATE', '2026-10-31', '2차 실제 날짜'],
    ['GALLERY_SCOPE', 'ALL', '탐험일지 공개 범위: ALL(전체) / TEAM(같은 조) / SELF(본인만)'],
    ['JOURNAL_REQUIRE_APPROVAL', 'TRUE', 'TRUE면 승인된 일지만 갤러리에 노출'],
    ['JOURNAL_OPEN', 'TRUE', 'FALSE면 일지 작성/수정 차단'],
    ['PROGRESS_OPEN', 'TRUE', 'FALSE면 조장의 지점 체크 차단'],
    ['SHOW_FEE', 'TRUE', '회비 상태 화면 노출 여부'],
    ['DRIVE_FOLDER_ID', '', '⚠ 탐험일지 사진이 저장될 Drive 폴더 ID — 반드시 입력'],
    ['TOKEN_TTL_HOURS', '12', '로그인 유지 시간(시간)'],
    ['LOGIN_MAX_ATTEMPTS', '5', '10분 내 최대 로그인 실패 횟수'],
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
 * 10/24 은 교육(오전)부터, 10/31 은 오후 답사만 진행한다.
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
function applyValidation_() {
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
  sh.getRange(2, col, Math.max(sh.getMaxRows() - 1, 1)).setDataValidation(rule);
}

function autoResize_() {
  Object.keys(SCHEMA).forEach(function (name) {
    var sh = getSheet_(name);
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
  var courseNames = readTable_(SHEETS.COURSES).map(function (r) { return str_(r['코스명']); });

  var seen = {};
  var dup = [], missing = [], badSession = [], noLeader = [], courseMismatch = [], badCourse = [];

  rows.forEach(function (r) {
    var name = str_(r[COL.NAME]);
    var parsed = splitName_(name);
    var last4 = phoneLast4_(r[COL.PHONE]);

    if (!last4 && !parsed.digits) {
      missing.push('행 ' + r.__row + ' (' + name + '): 연락처 없음 — 로그인 불가');
    }
    if (!str_(r['참가자ID'])) {
      missing.push('행 ' + r.__row + ' (' + name + '): 참가자ID 없음 — "참가자ID 채우기" 실행 필요');
    }
    var session = str_(r[COL.SESSION]);
    if (!session) {
      badSession.push('행 ' + r.__row + ' (' + name + '): 참여 일자 미배정 — 로그인 불가');
    } else if (sessionList.indexOf(session) < 0) {
      badSession.push('행 ' + r.__row + ' (' + name + '): 참여 일자 "' + session + '" 가 Config 의 SESSION_1/2 와 다름');
    }
    var course = str_(r[COL.COURSE]);
    if (course && courseNames.indexOf(course) < 0) {
      badCourse.push('행 ' + r.__row + ' (' + name + '): 배정 코스 "' + course + '" 가 Courses 시트에 없음');
    }

    // 로그인 키 충돌: 이름(끝 4자리 뗀 것) + 뒷4자리.
    // 연락처 뒷자리와 이름 뒤 구분번호가 같으면 후보가 겹치므로 중복 제거 후 검사한다.
    var digits = [last4, parsed.digits].filter(String).filter(function (d, i, arr) {
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

  var out = [];
  out.push('참가자 ' + rows.length + '명, 조 ' + Object.keys(groups).length + '개');
  out.push('');
  block_(out, dup, '❌ 로그인 충돌 (해당 인원은 로그인 불가)', '✅ 로그인 충돌 없음');
  block_(out, missing, '⚠ 필수값 누락', '✅ 필수값 누락 없음');
  block_(out, badSession, '⚠ 참여 일자 문제', '✅ 참여 일자 정상');
  block_(out, badCourse, '⚠ 배정 코스 오타', '✅ 배정 코스 정상');
  block_(out, courseMismatch, '⚠ 조 안에서 배정 코스 불일치', '✅ 조별 배정 코스 일관됨');
  block_(out, noLeader, '⚠ 조장 없는 조', '✅ 모든 조에 조장 있음');

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
    var filled = 0;
    readTable_(SHEETS.PARTICIPANTS).forEach(function (r) {
      if (str_(r['참가자ID']) || !str_(r[COL.NAME])) return;
      var patch = { '참가자ID': nextId_(SHEETS.PARTICIPANTS, '참가자ID', 'P', 4) };
      if (!str_(r['등록일시'])) patch['등록일시'] = nowIso_();
      updateRow_(SHEETS.PARTICIPANTS, r.__row, patch);
      filled++;
    });
    var msg = filled + '건에 참가자ID를 채웠습니다.';
    console.log(msg);
    alert_(msg);
    return filled;
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

/** 스프레드시트 메뉴에 운영 도구를 붙인다. */
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('🧭 정동캠프')
      .addItem('초기 세팅 실행', 'setupSpreadsheet')
      .addItem('참가자ID 채우기', 'fillParticipantIds')
      .addItem('조 목록 동기화', 'syncTeams')
      .addItem('명단 점검', 'checkDuplicates')
      .addSeparator()
      .addItem('설정 캐시 비우기', 'clearConfigCache')
      .addToUi();
  } catch (e) { /* UI 없는 컨텍스트 */ }
}
