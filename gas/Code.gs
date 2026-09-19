/**
 * Code.gs — 웹앱 진입점 및 라우팅
 *
 * PLC 정동 가을캠프 · 신앙탐험대
 * 명세: docs-dev/spec/API.md
 *
 * 배포: 새 배포 → 웹 앱 → 실행 계정 "나" / 액세스 권한 "모든 사용자"
 *
 * CORS 주의: GAS 는 응답 헤더를 지정할 수 없어 preflight 를 통과시킬 수 없다.
 * 프론트는 반드시 Content-Type: text/plain 으로 POST 해야 한다(단순 요청 → preflight 없음).
 */

// ---------------------------------------------------------------- 진입점

function doGet(e) {
  var params = (e && e.parameter) || {};
  __reqStart = Date.now();
  try {
    if (params.action === 'bootstrap' || !params.action) {
      return jsonOk_(bootstrap_());
    }
    if (params.action === 'health') {
      return jsonOk_({ ok: true, serverTime: nowIso_() });
    }
    throw new AppError('BAD_REQUEST', 'GET 으로는 지원하지 않는 액션입니다: ' + params.action);
  } catch (err) {
    return jsonErr_(err);
  }
}

function doPost(e) {
  var body;
  __reqStart = Date.now();
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (parseErr) {
    return jsonErr_(new AppError('BAD_REQUEST', '요청 형식이 올바르지 않습니다.'));
  }
  try {
    return jsonOk_(route_(str_(body.action), body));
  } catch (err) {
    return jsonErr_(err);
  }
}

// ---------------------------------------------------------------- 라우팅

function route_(action, body) {
  switch (action) {
    // ---- 공개
    case 'bootstrap':      return bootstrap_();
    case 'auth.login':     return login_(body);
    case 'admin.login':    return adminLogin_(body);

    // ---- 참가자
    case 'me':             return meHandler_(body);
    case 'progress.list':  return progressList_(requireUser_(body));
    case 'progress.set':   return progressSet_(requireUser_(body), body);
    case 'journal.list':   return journalList_(requireUser_(body), body);
    case 'journal.create': return journalCreate_(requireUser_(body), body);
    case 'journal.update': return journalUpdate_(requireUser_(body), body);
    case 'journal.delete': return journalDelete_(requireUser_(body), body);
    case 'fee.status':     return feeStatus_(requireUser_(body));

    // ---- 관리자
    case 'admin.journal.pending': return journalPending_(requireAdmin_(body));
    case 'admin.journal.review':  return journalReview_(requireAdmin_(body), body);
    case 'admin.journal.update':  return journalUpdate_(requireAdmin_(body), body);
    case 'admin.journal.delete':  return journalDelete_(requireAdmin_(body), body);
    case 'admin.progress.board':  return progressBoard_(requireAdmin_(body));
    case 'admin.fee.board':       return feeBoard_(requireAdmin_(body));
    case 'admin.config.set':      return configSet_(requireAdmin_(body), body);

    default:
      throw new AppError('BAD_REQUEST', '알 수 없는 요청입니다: ' + action);
  }
}

// ---------------------------------------------------------------- 응답
//
// 🔴 응답에 **서버가 실제로 쓴 시간(ms)** 을 싣는다.
//
// 실측(D-030)은 브라우저에서 잰 왕복 시간뿐이라, 30초가 걸렸을 때 서버가 30초를 쓴
// 것인지 대기열에서 기다린 것인지 **구분할 방법이 없었다.** 둘은 고치는 곳이 다르다.
// 값 하나를 얹는 비용으로 그 구분이 생긴다.

var __reqStart = 0;

/** 이 실행이 시작된 뒤 지난 시간(ms). 진입점 밖에서 불리면 null. */
function elapsedMs_() {
  return __reqStart ? (Date.now() - __reqStart) : null;
}

function jsonOk_(data) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, data: data, ms: elapsedMs_() }))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonErr_(err) {
  var code = (err && err.code) || 'SERVER_ERROR';
  var message = (err && err.message) || '알 수 없는 오류가 발생했습니다.';
  if (code === 'SERVER_ERROR') console.error(err && err.stack ? err.stack : err);
  return ContentService
    .createTextOutput(JSON.stringify({
      ok: false, error: { code: code, message: message }, ms: elapsedMs_()
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------- bootstrap

/**
 * 앱 초기 로딩용 공개 데이터. 개인정보는 포함하지 않는다.
 *
 * 가장 자주 불리는 요청이면서 시트 4개(Checkpoints·Notices·Timeline·Config)를 읽는다.
 * 개인정보가 없어 사용자별로 다를 것이 없으므로 **요청 간 5분 캐시**를 둔다.
 * `serverTime` 만 캐시 밖에서 매번 새로 채운다 — 캐시된 시각을 내려보내면 안 된다.
 *
 * 공지·타임라인을 고친 뒤 즉시 반영하려면 메뉴 → "설정 캐시 비우기".
 * `admin.config.set` 은 이 캐시도 함께 비운다(clearConfigCache).
 */
function bootstrap_() {
  var cached = cacheGet_('bootstrap_v1');
  if (cached) {
    cached.serverTime = nowIso_();
    return cached;
  }

  var data = {
    config: publicConfig_(),
    labels: labels_(),
    sessions: sessions_(),
    checkpoints: checkpoints_(),
    notices: activeNotices_(),
    timeline: timeline_(),
    serverTime: nowIso_()
  };
  cachePut_('bootstrap_v1', data, 300);
  return data;
}

/**
 * 화면에 쓰는 항목 이름을 마스터시트 헤더 그대로 내려보낸다.
 * 행정팀이 시트에서 부르는 이름과 앱에서 보는 이름을 일치시키기 위해서다.
 * 헤더를 바꾸면(= Sheets.gs 의 COL 을 고치면) 앱 문구도 자동으로 따라간다.
 */
function labels_() {
  // 별칭이 걸린 열은 **시트에 실제로 적힌 이름**을 내려보낸다.
  // 명단에 '핸드폰' 이라 적혀 있으면 화면에도 '핸드폰' 이라고 떠야
  // 행정팀과 참가자가 같은 말을 쓰게 된다.
  var h = function (canonical) { return actualHeader_(SHEETS.PARTICIPANTS, canonical); };
  return {
    audience: COL.AUDIENCE,
    session: COL.SESSION,
    name: COL.NAME,
    gender: COL.GENDER,
    age: h(COL.AGE),
    phone: h(COL.PHONE),
    feeAmount: COL.FEE_AMOUNT,
    feeStatus: COL.FEE_STATUS,
    group: COL.GROUP,
    role: COL.ROLE,
    insurance: COL.INSURANCE,
    course: COL.COURSE,
    note: COL.NOTE
  };
}

/** Config 중 프론트에 내려도 되는 값만 화이트리스트로 추린다. */
function publicConfig_() {
  return {
    CAMP_NAME: confStr_('CAMP_NAME', '정동, 신앙탐험대'),
    CAMP_SUBTITLE: confStr_('CAMP_SUBTITLE', 'PLC 성경적세계관 캠프'),
    GALLERY_SCOPE: confStr_('GALLERY_SCOPE', 'ALL').toUpperCase(),
    JOURNAL_REQUIRE_APPROVAL: confBool_('JOURNAL_REQUIRE_APPROVAL', true),
    JOURNAL_OPEN: confBool_('JOURNAL_OPEN', true),
    PROGRESS_OPEN: confBool_('PROGRESS_OPEN', true),
    SHOW_FEE: confBool_('SHOW_FEE', true),
    NOTICE_TICKER: confStr_('NOTICE_TICKER', '')
  };
}

function checkpoints_() {
  return readTable_(SHEETS.CHECKPOINTS)
    .filter(function (r) { return str_(r['지점코드']); })
    .sort(function (a, b) { return (parseInt(a['기본순번'], 10) || 0) - (parseInt(b['기본순번'], 10) || 0); })
    .map(function (r) {
      return {
        code: str_(r['지점코드']),
        order: parseInt(r['기본순번'], 10) || 0,
        name: str_(r['지점명']),
        address: str_(r['주소']),
        lat: parseFloat(r['위도']) || null,
        lng: parseFloat(r['경도']) || null,
        stayMinutes: parseInt(r['체류시간분'], 10) || null,
        summary: str_(r['한줄소개']),
        description: str_(r['현장설명']),
        mission: str_(r['미션']),
        quizUrl: str_(r['퀴즈URL']),
        photoUrl: str_(r['사진URL']),
        openHours: str_(r['운영시간'])
      };
    });
}

function activeNotices_() {
  var now = new Date();
  return readTable_(SHEETS.NOTICES)
    .filter(function (r) {
      if (!str_(r['제목']) && !str_(r['내용'])) return false;
      var from = r['게시일시'] ? new Date(toIso_(r['게시일시'])) : null;
      var to = r['종료일시'] ? new Date(toIso_(r['종료일시'])) : null;
      if (from && !isNaN(from) && from > now) return false;
      if (to && !isNaN(to) && to < now) return false;
      return true;
    })
    .map(function (r) {
      return {
        id: str_(r['공지ID']),
        target: str_(r['대상']) || '전체',
        title: str_(r['제목']),
        body: str_(r['내용']),
        pinned: bool_(r['고정']),
        publishedAt: toIso_(r['게시일시'])
      };
    })
    .sort(function (a, b) {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.publishedAt.localeCompare(a.publishedAt);
    });
}

/** 참여 일자별 타임라인. { '10/31(토)': [...], '11/07(토)': [...] } */
function timeline_() {
  var out = {};
  // 비활성 회차는 앱 입장에서 없는 회차다. 일정표도 내려보내지 않는다 (D-031).
  activeSessionLabels_().forEach(function (label) { out[label] = []; });

  readTable_(SHEETS.TIMELINE)
    .filter(function (r) { return out.hasOwnProperty(str_(r[COL.SESSION])); })
    .sort(function (a, b) { return (parseInt(a['순번'], 10) || 0) - (parseInt(b['순번'], 10) || 0); })
    .forEach(function (r) {
      out[str_(r[COL.SESSION])].push({
        order: parseInt(r['순번'], 10) || 0,
        start: toHm_(r['시작']),
        end: toHm_(r['종료']),
        title: str_(r['내용']),
        place: str_(r['장소']),
        note: str_(r['비고'])
      });
    });
  return out;
}

// ---------------------------------------------------------------- me

function meHandler_(body) {
  var ctx = requireUser_(body);
  if (ctx.isAdmin) return { participant: null, team: null, isLeader: true, isAdmin: true, members: [] };
  var me = buildMe_(ctx.row);
  me.isAdmin = false;
  return me;
}

// ---------------------------------------------------------------- 진행 (조 단위, 조장 기록)

function progressList_(ctx) {
  if (ctx.isAdmin) throw new AppError('BAD_REQUEST', '관리자는 admin.progress.board 를 사용하세요.');
  if (!ctx.group) throw new AppError('NOT_FOUND', '배정된 조가 없습니다. 운영진에게 문의해 주세요.');

  var members = teamMembers_(ctx.session, ctx.group);
  var route = routeFor_(courseNameOf_(members, ctx.row));

  var byCp = {};
  readTable_(SHEETS.PROGRESS).forEach(function (r) {
    if (rowTeamKey_(r) === ctx.teamKey) byCp[str_(r['지점코드'])] = r;
  });

  return route.map(function (code, i) {
    var r = byCp[code];
    return {
      checkpoint: code,
      visitOrder: i + 1,
      status: r ? (str_(r['상태']) || '대기') : '대기',
      arrivedAt: r ? toIso_(r['도착시각']) : '',
      completedAt: r ? toIso_(r['완료시각']) : '',
      score: r && r['퀴즈점수'] !== '' ? Number(r['퀴즈점수']) : null,
      memo: r ? str_(r['메모']) : ''
    };
  });
}

/** 조장 전용. (참여 일자, 조 배정, 지점코드) 당 1행을 upsert 한다. */
function progressSet_(ctx, body) {
  if (!confBool_('PROGRESS_OPEN', true)) {
    throw new AppError('CLOSED', '진행 기록이 마감되었습니다.');
  }
  if (!ctx.isLeader) throw new AppError('FORBIDDEN', '조장만 기록할 수 있습니다.');
  if (!ctx.group) throw new AppError('NOT_FOUND', '배정된 조가 없습니다.');

  var status = str_(body.status);
  if (ENUM.PROGRESS.indexOf(status) < 0) {
    throw new AppError('BAD_REQUEST', '상태는 대기/도착/완료 중 하나여야 합니다.');
  }
  var code = normalizeCheckpoint_(body.checkpoint);
  if (!code) throw new AppError('BAD_REQUEST', '지점을 선택해 주세요.');

  // 🔴 **안 보냄 ≠ 비우기.**
  //
  // 앱은 `API.progressSet(code, status)` 로 두 인자만 보내고, JSON 은 값이
  // undefined 인 키를 아예 싣지 않는다. 그런데 예전 코드는 안 보낸 경우에도
  // 퀴즈점수·메모를 '' 로 덮었다 — 조장이 상태를 누를 때마다 운영진이 시트에
  // 적어 둔 값이 지워졌다. 코스 화면이 그 둘을 안 그려서 드러나지 않았다.
  //
  // 키가 없으면 손대지 않고, null·'' 를 **명시적으로** 보내면 지운다.
  // 운영진이 점수를 지우고 싶을 때는 지울 수 있어야 한다.
  var hasScore = body.score !== undefined;
  var hasMemo = body.memo !== undefined;

  var score = '';
  if (hasScore && body.score !== null && body.score !== '') {
    var n = Number(body.score);
    if (isNaN(n) || n < 0 || n > 100) throw new AppError('BAD_REQUEST', '점수는 0~100 사이여야 합니다.');
    score = n;
  }

  // 🔴 **안을 쪼개 잰다** (D-043).
  //
  // 이 요청만 서버에서 8.5초가 걸린다. 다른 액션은 0.6~2.5초다. 사본 비용은
  // A/B 로 882ms 임을 확인했으니 그것으로는 설명이 안 된다. 어디가 먹는지
  // 모르는 채로 고치면 엉뚱한 데를 건드린다 — 재고 나서 고친다.
  //
  // 걸린 시간은 `Log` 탭의 `상세` 칸에 남는다. 새 화면도, 새 통신 형식도 필요 없다.
  var T = { auth: __authMs };     // route_ 가 먼저 부른 requireUser_ 가 쓴 시간
  var t0 = Date.now();

  // 🔴 시트가 먼저, DB 가 나중 (D-038).
  //    락은 **한 행의 읽고-고치고-쓰기만** 잡는다. 목록 만들기와 사본 밀어 넣기는
  //    락을 놓은 뒤에 한다 (D-044).
  withLock_(function () {
    var tLock = Date.now();
    T.lock = tLock - t0;

    var existing = null;
    readTable_(SHEETS.PROGRESS).forEach(function (r) {
      if (rowTeamKey_(r) === ctx.teamKey && str_(r['지점코드']) === code) existing = r;
    });
    T.read = Date.now() - tLock;

    var now = nowStamp_();
    // `updateRow_` 는 현재 행을 먼저 읽고 patch 에 있는 키만 덮어쓴다.
    // 그래서 **키를 빼면 기존 값이 그대로 남는다.**
    var patch = {
      '상태': status,
      '기록자ID': ctx.pid,
      '수정일시': now
    };
    if (hasScore) patch['퀴즈점수'] = score;
    if (hasMemo) patch['메모'] = str_(body.memo);
    // 최초 도착·완료 시각만 남긴다(되돌렸다 다시 눌러도 처음 시각 유지).
    if (status === '도착' || status === '완료') {
      if (!existing || !str_(existing['도착시각'])) patch['도착시각'] = now;
    }
    if (status === '완료') {
      if (!existing || !str_(existing['완료시각'])) patch['완료시각'] = now;
    }
    if (status === '대기') {
      patch['도착시각'] = '';
      patch['완료시각'] = '';
    }

    var tWrite = Date.now();
    if (existing) {
      updateRow_(SHEETS.PROGRESS, existing.__row, patch);
    } else {
      patch['기록ID'] = nextId_(SHEETS.PROGRESS, '기록ID', 'PR', 4);
      patch[COL.SESSION] = ctx.session;
      patch[COL.GROUP] = ctx.group;
      patch['지점코드'] = code;
      appendRow_(SHEETS.PROGRESS, patch);
    }
    T.write = Date.now() - tWrite;

  });

  // 🔴 목록 만들기를 **락 밖으로** 뺐다 (D-044).
  //
  // 실측에서 `lock` 이 연타할수록 126 → 1,464 → 2,978 → 4,541ms 로 쌓였다.
  // 한 사람이 빠르게 눌러도 경합이 난다 — 각 요청이 락을 쥔 시간만큼 다음이 줄을 선다.
  // 락이 지켜야 하는 것은 **한 행의 읽고-고치고-쓰기**뿐이고, 목록 만들기는
  // 그냥 읽기다. 밖으로 빼면 락 보유 시간이 절반 아래로 줄고 대기도 따라 준다.
  var tList = Date.now();
  var list = progressList_(ctx);
  T.list = Date.now() - tList;

  // 사본. **실패해도 여기서 끝나지 않는다** — 원장(시트)에는 이미 들어갔고,
  // 주기 동기화가 맞춘다. mirrorProgressPush_ 는 절대 던지지 않는다.
  var tMirror = Date.now();
  mirrorProgressPush_(ctx.session, ctx.group, list);
  T.mirror = Date.now() - tMirror;

  // 🔴 기록은 락 **밖에서** 한다. 로그 쓰기도 시트 쓰기라, 락 안에 두면
  //    다른 조장이 그만큼 더 기다린다 (D-038 과 같은 이유).
  T.total = Date.now() - t0;
  logEvent_('progress.set', ctx.pid, ctx.teamKey + '/' + code, status, timingText_(T));

  return list;
}

// ---------------------------------------------------------------- 회비 (읽기 전용, D-005)

function feeStatus_(ctx) {
  if (!confBool_('SHOW_FEE', true)) throw new AppError('CLOSED', '회비 조회가 닫혀 있습니다.');
  if (ctx.isAdmin) throw new AppError('BAD_REQUEST', '관리자는 admin.fee.board 를 사용하세요.');

  var out = { me: { status: str_(ctx.row[COL.FEE_STATUS]) || '미납' }, members: [] };
  if (ctx.isLeader && ctx.group) {
    out.members = teamMembers_(ctx.session, ctx.group).map(function (r) {
      // 금액·납부일은 내려보내지 않는다.
      return {
        id: str_(r['참가자ID']),
        name: displayName_(r[COL.NAME]),
        status: str_(r[COL.FEE_STATUS]) || '미납'
      };
    });
  }
  return out;
}

// ---------------------------------------------------------------- 관리자 보드

/**
 * 조는 Teams 시트가 아니라 **명단에 실제로 존재하는 (참여 일자, 조 배정) 조합**에서 뽑는다.
 * 행정팀이 Teams 를 안 채워도 보드가 비지 않게 하기 위해서다.
 */
function allTeams_() {
  var byKey = {};
  readTable_(SHEETS.PARTICIPANTS).forEach(function (r) {
    var session = str_(r[COL.SESSION]);
    var group = str_(r[COL.GROUP]);
    if (!session || !group) return;

    var key = teamKey_(session, group);
    if (!byKey[key]) byKey[key] = { key: key, session: session, group: group, audiences: {} };

    var audience = str_(r[COL.AUDIENCE]);
    if (audience) byKey[key].audiences[audience] = (byKey[key].audiences[audience] || 0) + 1;
  });

  return Object.keys(byKey).sort().map(function (key) {
    var t = byKey[key];
    return { key: t.key, session: t.session, group: t.group, audience: dominantAudience_(t.audiences) };
  });
}

/**
 * 조의 대표 부서. 원칙은 부서=일자 1:1 이지만 예외 인원이 섞일 수 있어(D-016),
 * 다수 부서를 대표로 쓰고 실제로 섞였으면 `혼합` 으로 표시한다.
 */
function dominantAudience_(counts) {
  var names = Object.keys(counts);
  if (!names.length) return '';
  if (names.length === 1) return names[0];

  names.sort(function (a, b) { return counts[b] - counts[a]; });
  return counts[names[0]] === counts[names[1]] ? '혼합' : names[0] + ' 외';
}

/**
 * 전 조 진행 현황.
 *
 * 조마다 teamMembers_·findTeam_·routeFor_ 를 다시 부르면 조 수 × 명단 크기만큼
 * 훑게 된다(조 32개면 O(N×M)). 그래서 **참가자·Teams·Progress 를 각각 한 번만 훑어
 * 인덱스로 만든 뒤** 조회한다.
 */
function progressBoard_(ctx) {
  var codes = defaultRoute_();
  var names = {};
  checkpoints_().forEach(function (c) { names[c.code] = c.name; });

  // --- 한 번씩만 훑어 인덱스를 만든다
  var membersByTeam = {};
  readTable_(SHEETS.PARTICIPANTS).forEach(function (r) {
    var key = rowTeamKey_(r);
    (membersByTeam[key] = membersByTeam[key] || []).push(r);
  });

  var teamRowByKey = {};
  readTable_(SHEETS.TEAMS).forEach(function (r) { teamRowByKey[rowTeamKey_(r)] = r; });

  var cellsByTeam = {};
  readTable_(SHEETS.PROGRESS).forEach(function (r) {
    var key = rowTeamKey_(r);
    (cellsByTeam[key] = cellsByTeam[key] || {})[str_(r['지점코드'])] = {
      status: str_(r['상태']) || '대기',
      arrivedAt: toIso_(r['도착시각']),
      completedAt: toIso_(r['완료시각']),
      score: r['퀴즈점수'] !== '' ? Number(r['퀴즈점수']) : null
    };
  });

  // 같은 코스명은 방문 순서 변환을 한 번만 한다
  var routeByCourse = {};
  function routeCached_(course) {
    if (!(course in routeByCourse)) routeByCourse[course] = routeFor_(course);
    return routeByCourse[course];
  }

  return {
    checkpoints: codes.map(function (c) { return { code: c, name: names[c] || c }; }),
    teams: allTeams_().map(function (t) {
      var members = membersByTeam[t.key] || [];
      var teamRow = teamRowByKey[t.key];
      var course = courseNameOf_(members, null);
      return {
        session: t.session,
        group: t.group,
        audience: t.audience,
        name: teamRow ? (str_(teamRow['조이름']) || t.group) : t.group,
        leaderName: leaderNameOf_(members),
        memberCount: members.length,
        course: course,
        route: routeCached_(course),
        cells: cellsByTeam[t.key] || {}
      };
    })
  };
}

function feeBoard_(ctx) {
  var rows = readTable_(SHEETS.PARTICIPANTS);
  var summary = { 미납: 0, 완납: 0, 면제: 0, 합계: 0, 예상수입: 0, 수납액: 0 };
  var byTeam = {};

  rows.forEach(function (r) {
    if (!str_(r[COL.NAME])) return;

    var st = str_(r[COL.FEE_STATUS]) || '미납';
    if (summary[st] === undefined) summary[st] = 0;
    summary[st]++;
    summary['합계']++;

    var amount = parseInt(String(r[COL.FEE_AMOUNT]).replace(/\D/g, ''), 10) || 0;
    if (st !== '면제') summary['예상수입'] += amount;
    if (st === '완납') summary['수납액'] += amount;

    var session = str_(r[COL.SESSION]) || '(일자 미정)';
    var group = str_(r[COL.GROUP]) || '(조 미배정)';
    var key = session + ' ' + group;
    if (!byTeam[key]) {
      byTeam[key] = {
        label: key, session: session, group: group,
        audience: str_(r[COL.AUDIENCE]),
        미납: 0, 완납: 0, 면제: 0, unpaid: [], 미가입: 0
      };
    }
    if (byTeam[key][st] === undefined) byTeam[key][st] = 0;
    byTeam[key][st]++;
    if (st === '미납') byTeam[key].unpaid.push(displayName_(r[COL.NAME]));
    if (str_(r[COL.INSURANCE]) !== '가입완료') byTeam[key]['미가입']++;
  });

  return {
    summary: summary,
    teams: Object.keys(byTeam).sort().map(function (k) { return byTeam[k]; })
  };
}

/** 대소문자·언더스코어를 무시하고 가장 비슷한 기존 키를 찾는다. 없으면 빈 문자열. */
function nearestKey_(key, known) {
  var norm = function (v) { return String(v).toUpperCase().replace(/[^A-Z0-9]/g, ''); };
  var target = norm(key);
  var best = '';
  var bestScore = 0;
  known.forEach(function (k) {
    var c = norm(k);
    if (c === target) { best = k; bestScore = 999; return; }
    // 부분문자열 비교로는 **한 글자 누락**(PROGRES_OPEN ← PROGRESS_OPEN)을 못 잡는다.
    // 가장 흔한 오타가 그것이므로 편집 거리를 쓴다.
    var d = editDistance_(c, target);
    var score = 100 - d;
    if (d <= 2 && score > bestScore) { best = k; bestScore = score; }
  });
  return best;
}

/** 레벤슈타인 거리. 설정 키는 짧아서 이 정도면 충분하다. */
function editDistance_(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  var prev = [];
  for (var j = 0; j <= b.length; j++) prev[j] = j;

  for (var i = 1; i <= a.length; i++) {
    var cur = [i];
    for (var k = 1; k <= b.length; k++) {
      cur[k] = Math.min(
        prev[k] + 1,                                        // 삭제
        cur[k - 1] + 1,                                     // 삽입
        prev[k - 1] + (a.charAt(i - 1) === b.charAt(k - 1) ? 0 : 1)  // 치환
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

function configSet_(ctx, body) {
  var key = str_(body.key);
  if (!key) throw new AppError('BAD_REQUEST', '키를 입력해 주세요.');

  return withLock_(function () {
    var rows = readTable_(SHEETS.CONFIG);
    var target = null;
    rows.forEach(function (r) { if (str_(r['키']) === key) target = r; });

    // 오타로 새 키가 조용히 생기는 것을 막는다.
    // PROGRESS_OPEN 을 PROGRES_OPEN 으로 잘못 치면 에러 없이 새 행이 생기고
    // 원래 설정은 그대로 남는다 — "분명히 껐는데 왜 안 꺼지지?" 가 된다.
    // 일부러 새 키를 넣을 때만 allowNew 로 뚫는다.
    if (!target && !body.allowNew) {
      var known = rows.map(function (r) { return str_(r['키']); }).filter(String);
      var hint = nearestKey_(key, known);
      throw new AppError('BAD_REQUEST',
        '없는 설정 키입니다: ' + key +
        (hint ? '\n혹시 "' + hint + '" 를 찾으셨나요?' : '') +
        '\n새 키를 정말 추가하려면 allowNew 를 함께 보내세요.');
    }

    if (target) {
      updateRow_(SHEETS.CONFIG, target.__row, { '값': str_(body.value) });
    } else {
      appendRow_(SHEETS.CONFIG, { '키': key, '값': str_(body.value), '설명': str_(body.note) });
    }
    clearConfigCache();
    logEvent_('admin.config.set', 'ADMIN', key, 'OK', str_(body.value));
    return publicConfig_();
  });
}
