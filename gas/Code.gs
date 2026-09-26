/**
 * ────────────────────────────────────────────────────────────────
 * Code.gs · v15 · 2026-09-26
 * ────────────────────────────────────────────────────────────────
 * 변경 이력 (최근 5건 — 전체는 docs-dev/spec/DECISIONS.md · git log)
 *  v15   2026-09-26  파일 버전 표시 · health 가 파일별 버전을 알려 준다
 *  v13   2026-09-22  공지를 운영콘솔에서 쓴다
 *  v13   2026-09-22  설정을 바꾸면 사본도 민다
 *  v12   2026-09-22  반려된 일지를 다시 낼 수 있게 + 운영콘솔 편의 네 가지
 *  —     2026-09-19  진행 기록을 묶어서 보낸다
 *
 * 버전: vN = GAS 배포 번호. vN.k = 서버는 vN 그대로 두고 앱·도구만 고친 k번째.
 *       — 는 버전 기록을 시작하기 전(v12 이전)의 변경.
 * 🔴 이 파일을 고치면 맨 위 줄(이름·버전·날짜)과 이력을 함께 고친다 (CLAUDE.md).
 * ────────────────────────────────────────────────────────────────
 */
var VERSION_CODE = 'v15';   // 헤더의 버전과 같아야 한다. health 가 이 값을 알려 준다.

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
      return jsonOk_({ ok: true, serverTime: nowIso_(), versions: fileVersions_() });
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

/**
 * 붙여넣은 `.gs` 파일들의 버전 (D-049).
 *
 * 🔴 **파일 하나를 빠뜨리고 배포하는 일을 잡으려고 둔다.** v13 은 `Sheets.gs` 가 빠진 채
 * 나갔고, 공지 삭제만 `deleteRow_ is not defined` 로 터질 뻔했다 — 나머지는 멀쩡해서
 * 늦게 발견되는 종류다. 배포 뒤 `?action=health` 를 열면 파일마다 버전이 보인다.
 *
 * 값이 `null` 이면 그 파일은 **버전 표시가 생기기 전의 옛 파일**이다. 다시 붙여넣는다.
 * `typeof` 로 묻는 이유: 옛 파일에는 상수 자체가 없어 그냥 읽으면 여기서 터진다.
 */
function fileVersions_() {
  return {
    'Auth.gs':       typeof VERSION_AUTH       !== 'undefined' ? VERSION_AUTH       : null,
    'Code.gs':       typeof VERSION_CODE       !== 'undefined' ? VERSION_CODE       : null,
    'Journal.gs':    typeof VERSION_JOURNAL    !== 'undefined' ? VERSION_JOURNAL    : null,
    'MasterSync.gs': typeof VERSION_MASTERSYNC !== 'undefined' ? VERSION_MASTERSYNC : null,
    'Mirror.gs':     typeof VERSION_MIRROR     !== 'undefined' ? VERSION_MIRROR     : null,
    'Setup.gs':      typeof VERSION_SETUP      !== 'undefined' ? VERSION_SETUP      : null,
    'Sheets.gs':     typeof VERSION_SHEETS     !== 'undefined' ? VERSION_SHEETS     : null
  };
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
    case 'station.board':  return stationBoard_(requireUser_(body));
    case 'station.set':    return stationSet_(requireUser_(body), body);
    case 'ops.board':      return opsBoard_(requireUser_(body));

    // ---- 관리자
    case 'admin.journal.pending': return journalPending_(requireAdmin_(body));
    case 'admin.journal.list':    return journalAll_(requireAdmin_(body));
    case 'admin.journal.review':  return journalReview_(requireAdmin_(body), body);
    case 'admin.journal.update':  return journalUpdate_(requireAdmin_(body), body);
    case 'admin.journal.delete':  return journalDelete_(requireAdmin_(body), body);
    case 'admin.journal.reviewBatch': return journalReviewBatch_(requireAdmin_(body), body);
    case 'admin.journal.award':   return journalAward_(requireAdmin_(body), body);
    case 'admin.notice.list':     return noticeAll_(requireAdmin_(body));
    case 'admin.notice.save':     return noticeSave_(requireAdmin_(body), body);
    case 'admin.notice.delete':   return noticeDelete_(requireAdmin_(body), body);
    case 'admin.progress.board':  return progressBoard_(requireAdmin_(body));
    case 'admin.progress.set':    return adminProgressSet_(requireAdmin_(body), body);
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

// ---------------------------------------------------------------- 공지 관리 (D-048)
//
// `activeNotices_` 는 **지금 보이는 것만** 준다. 운영콘솔은 예약·종료된 것까지 봐야
// 고치고 지울 수 있다 — `journalPending_` 과 `journalAll_` 의 관계와 같다 (D-046).

/** 공지 하나를 앱이 쓰는 모양으로. `activeNotices_` 와 같은 칸을 쓴다. */
function serializeNotice_(r, now) {
  var from = r['게시일시'] ? new Date(toIso_(r['게시일시'])) : null;
  var to = r['종료일시'] ? new Date(toIso_(r['종료일시'])) : null;

  // 상태는 **서버가 정한다.** 화면이 날짜를 다시 해석하면 둘이 어긋난다.
  var status = '게시중';
  if (from && !isNaN(from) && from > now) status = '예약';
  else if (to && !isNaN(to) && to < now) status = '종료';

  return {
    id: str_(r['공지ID']),
    target: str_(r['대상']) || '전체',
    title: str_(r['제목']),
    body: str_(r['내용']),
    pinned: bool_(r['고정']),
    publishedAt: toIso_(r['게시일시']),
    endsAt: toIso_(r['종료일시']),
    status: status
  };
}

/** 앱에서 고를 수 있는 대상. 시트 드롭다운(`applyValidation_`)과 **같은 목록**이다. */
function noticeTargets_() {
  return ['전체'].concat(ENUM.AUDIENCE).concat(sessionLabels_());
}

function noticeAll_(ctx) {
  var now = new Date();
  var items = readTable_(SHEETS.NOTICES)
    .filter(function (r) { return str_(r['제목']) || str_(r['내용']); })
    .map(function (r) { return serializeNotice_(r, now); })
    .sort(function (a, b) {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.publishedAt.localeCompare(a.publishedAt);
    });
  return { items: items, total: items.length, targets: noticeTargets_() };
}

/** `id` 가 없으면 새로 만들고, 있으면 고친다. */
function noticeSave_(ctx, body) {
  var title = str_(body.title);
  var text = str_(body.body);
  // 제목도 내용도 없으면 `activeNotices_` 가 걸러 버려 **보이지 않는 유령 행**이 된다.
  if (!title && !text) throw new AppError('BAD_REQUEST', '제목이나 내용 중 하나는 있어야 합니다.');

  var target = str_(body.target) || '전체';
  if (noticeTargets_().indexOf(target) < 0) {
    throw new AppError('BAD_REQUEST', '대상이 올바르지 않습니다: ' + target);
  }

  var id = str_(body.id);
  var patch = {
    '대상': target,
    '제목': title,
    '내용': text,
    '고정': body.pinned ? 'TRUE' : 'FALSE'
  };
  // 🔴 `종료일시` 는 **보냈을 때만** 건드린다. 안 보낸 키를 덮어쓰지 않는 규칙 그대로다
  //    (D-037). 빈 문자열은 "무기한으로 되돌린다" 는 뜻이라 그대로 넣는다.
  if (body.endsAt !== undefined) {
    patch['종료일시'] = str_(body.endsAt) ? new Date(str_(body.endsAt)) : '';
  }

  var saved = withLock_(function () {
    if (id) {
      var row = null;
      readTable_(SHEETS.NOTICES).forEach(function (r) { if (str_(r['공지ID']) === id) row = r; });
      if (!row) throw new AppError('NOT_FOUND', '해당 공지를 찾을 수 없습니다.');
      // `게시일시` 는 패치에 없다 → 시트에 넣어 둔 예약 시각이 그대로 남는다.
      updateRow_(SHEETS.NOTICES, row.__row, patch);
      logEvent_('admin.notice.save', 'ADMIN', id, 'UPDATE', title);
    } else {
      id = nextId_(SHEETS.NOTICES, '공지ID', 'N', 3);
      patch['공지ID'] = id;
      patch['게시일시'] = nowStamp_();      // 만들면 바로 게시다. 예약은 시트에서.
      appendRow_(SHEETS.NOTICES, patch);
      logEvent_('admin.notice.save', 'ADMIN', id, 'CREATE', title);
    }
    // 🔴 `bootstrap_` 은 300초 캐시다. 이걸 안 비우면 **낡은 사본을 밀어 버린다** —
    //    테스트가 빈 공지 목록이 나가는 것을 잡았다 (D-047 과 같은 실수).
    clearConfigCache();
    var out = null;
    readTable_(SHEETS.NOTICES).forEach(function (r) { if (str_(r['공지ID']) === id) out = r; });
    return serializeNotice_(out, new Date());
  });

  // 🔴 공지는 bootstrap 에 실려 간다. 안 밀면 참가자 화면은 최대 26시간 옛 공지를
  //    본다 (D-047). 락 **밖**이다 (D-044).
  mirrorPush();
  return saved;
}

function noticeDelete_(ctx, body) {
  var id = str_(body.id);
  if (!id) throw new AppError('BAD_REQUEST', '공지를 지정해 주세요.');

  var out = withLock_(function () {
    var row = null;
    readTable_(SHEETS.NOTICES).forEach(function (r) { if (str_(r['공지ID']) === id) row = r; });
    if (!row) throw new AppError('NOT_FOUND', '해당 공지를 찾을 수 없습니다.');
    // 일지와 달리 소프트 삭제가 아니다 — `Notices` 에는 `상태` 칸이 없고,
    // 잘못 올린 공지가 흔적으로 남을 이유도 없다.
    deleteRow_(SHEETS.NOTICES, row.__row);
    clearConfigCache();        // 낡은 bootstrap 을 밀지 않는다 (D-047)
    logEvent_('admin.notice.delete', 'ADMIN', id, 'OK', str_(row['제목']));
    return { id: id };
  });

  mirrorPush();          // 락 밖 (D-047)
  return out;
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
  if (!ctx.group) {
    throw new AppError('NOT_FOUND', (ctx.mode === 'station' || ctx.mode === 'ops')
      ? '스태프·교역자는 코스 대신 "내 지점"·"진행" 화면을 씁니다.'
      : '배정된 조가 없습니다. 운영진에게 문의해 주세요.');
  }
  return progressListFor_(ctx.session, ctx.group, ctx.row);
}

/**
 * 한 조의 코스 순서대로 진행. 조장 화면·사본 푸시·지점 기록이 같이 쓴다.
 * fallbackRow 는 조원 중 누구도 코스가 비어 있을 때 쓰는 본인 행(조장 화면)이다.
 */
function progressListFor_(session, group, fallbackRow) {
  var members = teamMembers_(session, group);
  var route = routeFor_(courseNameOf_(members, fallbackRow));
  var key = teamKey_(session, group);

  var byCp = {};
  readTable_(SHEETS.PROGRESS).forEach(function (r) {
    if (rowTeamKey_(r) === key) byCp[str_(r['지점코드'])] = r;
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
      // 점수를 넣은 쪽 (D-052). 조장 화면은 '스태프' 면 칸을 잠근다.
      // 🔴 사본(progress_cache)에는 이 열이 없다 — Supabase 스키마를 건드리지 않으려고.
      scoreSource: r ? str_(r['점수출처']) : '',
      memo: r ? str_(r['메모']) : ''
    };
  });
}

/**
 * 한 건의 변경을 검증해 정규화한다. **배치의 한 항목**도 이걸 거친다.
 *
 * 🔴 한 건이라도 걸리면 배치 전체를 거절한다(호출부에서 던진다). 일부만 들어가면
 * 화면과 시트가 어긋나고, 그걸 되돌릴 방법이 없다.
 *
 * statusOptional — 스태프·관리자는 **점수만** 고칠 수 있다(상태는 그대로).
 */
function normalizeProgressItem_(item, statusOptional) {
  var status = str_(item.status);
  if (status || !statusOptional) {
    if (ENUM.PROGRESS.indexOf(status) < 0) {
      throw new AppError('BAD_REQUEST', '상태는 대기/도착/완료 중 하나여야 합니다.');
    }
  }
  var code = statusOptional && item.checkpoint === undefined ? '' : normalizeCheckpoint_(item.checkpoint);
  if (!code && !statusOptional) throw new AppError('BAD_REQUEST', '지점을 선택해 주세요.');

  // 🔴 **안 보냄 ≠ 비우기** (D-039).
  //
  // 앱은 상태만 보내고, JSON 은 값이 undefined 인 키를 싣지 않는다. 예전 코드는
  // 안 보낸 경우에도 퀴즈점수·메모를 '' 로 덮어, 조장이 상태를 누를 때마다
  // 운영진이 시트에 적어 둔 값이 지워졌다. 키가 없으면 손대지 않는다.
  var hasScore = item.score !== undefined;
  var hasMemo = item.memo !== undefined;

  var score = '';
  if (hasScore && item.score !== null && item.score !== '') {
    var n = Number(item.score);
    if (isNaN(n) || n < 0 || n > 100) throw new AppError('BAD_REQUEST', '점수는 0~100 사이여야 합니다.');
    score = n;
  }
  if (!status && !hasScore && !hasMemo) throw new AppError('BAD_REQUEST', '바꿀 내용이 없습니다.');
  return { code: code, status: status, hasScore: hasScore, score: score,
           hasMemo: hasMemo, memo: str_(item.memo) };
}

/**
 * 진행 행을 쓴다 — 조장·스태프·관리자가 **같은 규칙**으로 (D-052).
 * entries: [{ session, group, code, status?, hasScore, score, hasMemo, memo }]
 * actor:   '조장' | '스태프' | '관리자' — 점수를 넣으면 `점수출처` 에 남는다.
 *
 * 🔴 **스태프 점수가 우선이다.** 조장이 스태프가 넣은 점수를 바꾸려 하면 **점수만** 무시하고
 *    상태는 기록한다. 거절(throw)하면 같은 배치로 보낸 도착·완료까지 날아간다 — 배치는
 *    전부 아니면 전무다(D-045). 무시한 지점코드를 돌려주고, 응답 목록의 점수·출처로
 *    앱이 칸을 잠근다.
 *
 * 락은 **행의 읽고-고치고-쓰기만** 잡는다. 목록·사본은 호출부가 락 밖에서 한다 (D-044).
 */
function writeProgress_(actor, pid, entries, T) {
  var t0 = Date.now();
  var ignored = [];

  withLock_(function () {
    var tLock = Date.now();
    T.lock = tLock - t0;

    // 🔴 `점수출처` 열이 없으면 updateRow_ 가 **조용히 버린다** → 스태프 우선이 깨진다.
    //    배포 뒤 `초기 세팅 실행` 을 안 돌린 상태다. 점수 쓰기만 막고 알린다.
    if (!headerIndex_(SHEETS.PROGRESS)['점수출처'] &&
        entries.some(function (e) { return e.hasScore; })) {
      throw new AppError('SERVER_ERROR',
        'Progress 탭에 "점수출처" 열이 없습니다. 운영진이 메뉴 "초기 세팅 실행" 을 다시 실행해야 합니다.');
    }

    var rows = readTable_(SHEETS.PROGRESS);
    var existingByKey = {};
    rows.forEach(function (r) {
      existingByKey[rowTeamKey_(r) + '#' + str_(r['지점코드'])] = r;
    });
    // 🔴 번호는 **이미 읽은 행에서** 한 번만 구한다.
    //    `nextId_` 는 시트를 다시 읽고, `appendRow_` 가 캐시를 비우므로,
    //    루프 안에서 부르면 새 행마다 **락을 쥔 채** 전량 재읽기가 생긴다 (D-044).
    var seq = maxIdNumber_(rows, '기록ID', 'PR');
    T.read = Date.now() - tLock;

    var tWrite = Date.now();
    var now = nowStamp_();

    entries.forEach(function (e) {
      var existing = existingByKey[teamKey_(e.session, e.group) + '#' + e.code];

      // `updateRow_` 는 현재 행을 먼저 읽고 patch 에 있는 키만 덮어쓴다.
      // 그래서 **키를 빼면 기존 값이 그대로 남는다.**
      var patch = { '기록자ID': pid, '수정일시': now };
      if (e.status) {
        patch['상태'] = e.status;
        // 최초 도착·완료 시각만 남긴다(되돌렸다 다시 눌러도 처음 시각 유지).
        if (e.status === '도착' || e.status === '완료') {
          if (!existing || !str_(existing['도착시각'])) patch['도착시각'] = now;
        }
        if (e.status === '완료') {
          if (!existing || !str_(existing['완료시각'])) patch['완료시각'] = now;
        }
        if (e.status === '대기') {
          patch['도착시각'] = '';
          patch['완료시각'] = '';
        }
      }
      if (e.hasScore) {
        if (actor === '조장' && existing && str_(existing['점수출처']) === '스태프') {
          ignored.push(e.code);
        } else {
          patch['퀴즈점수'] = e.score;
          patch['점수출처'] = e.score === '' ? '' : actor;
        }
      }
      if (e.hasMemo) patch['메모'] = e.memo;

      if (existing) {
        updateRow_(SHEETS.PROGRESS, existing.__row, patch);
      } else {
        if (!patch['상태']) patch['상태'] = '대기';     // 점수만 먼저 들어온 지점
        patch['기록ID'] = padId_('PR', ++seq, 4);
        patch[COL.SESSION] = e.session;
        patch[COL.GROUP] = e.group;
        patch['지점코드'] = e.code;
        appendRow_(SHEETS.PROGRESS, patch);
      }
    });
    T.write = Date.now() - tWrite;
  });
  return ignored;
}

/**
 * 조장 전용. (참여 일자, 조 배정, 지점코드) 당 1행을 upsert 한다.
 *
 * 🔴 **여러 건을 한 번에 받는다** (D-045).
 *
 * 예전에는 지점 하나 누를 때마다 한 요청이었다. 실측에서 연타하면 `lock` 이
 * 126 → 1,464 → 2,978 → 4,541ms 로 **쌓였다** — 각 요청이 락을 쥔 만큼 다음이
 * 줄을 선다. 그리고 요청당 고정비(스프레드시트 열기·인증·읽기·목록)가 2.5~4초라,
 * 그걸 **N번 내는 것**이 진짜 비용이었다.
 *
 * 묶으면 그 고정비를 한 번만 낸다. Classfinder 의 `batch` 와 같은 생각이다.
 * 단건 `{checkpoint, status}` 도 그대로 받는다 — 옛 앱이 새 서버에 붙어도 돈다.
 */
function progressSet_(ctx, body) {
  if (!confBool_('PROGRESS_OPEN', true)) {
    throw new AppError('CLOSED', '진행 기록이 마감되었습니다.');
  }
  if (!ctx.isLeader) throw new AppError('FORBIDDEN', '조장만 기록할 수 있습니다.');
  if (!ctx.group) throw new AppError('NOT_FOUND', '배정된 조가 없습니다.');

  var raw = Array.isArray(body.items) ? body.items : [body];
  if (!raw.length) throw new AppError('BAD_REQUEST', '기록할 지점이 없습니다.');

  // 🔴 **전부 먼저 검증한다.** 쓰기 중간에 던지면 일부만 들어간 채로 끝난다.
  var items = raw.map(function (it) { return normalizeProgressItem_(it, false); });

  // 같은 지점이 두 번 오면 **마지막이 이긴다.** 앱의 큐도 같은 규칙이다.
  var byCode = {};
  items.forEach(function (it) { byCode[it.code] = it; });
  var codes = Object.keys(byCode);
  var entries = codes.map(function (code) {
    return Object.assign({ session: ctx.session, group: ctx.group }, byCode[code]);
  });

  var T = { auth: __authMs, n: codes.length };
  var t0 = Date.now();

  // 🔴 시트가 먼저, DB 가 나중 (D-038).
  var ignored = writeProgress_('조장', ctx.pid, entries, T);

  // 목록 만들기는 그냥 읽기다 — 락이 지켜야 할 것이 아니다 (D-044).
  var tList = Date.now();
  var list = progressList_(ctx);
  T.list = Date.now() - tList;

  // 사본. **실패해도 여기서 끝나지 않는다** — 원장(시트)에는 이미 들어갔고,
  // 주기 동기화가 맞춘다. mirrorProgressPush_ 는 절대 던지지 않는다.
  // 🔴 배치당 **한 번**이다. 건별로 밀면 배치의 이득이 사라진다.
  var tMirror = Date.now();
  mirrorProgressPush_(ctx.session, ctx.group, list);
  T.mirror = Date.now() - tMirror;

  // 🔴 기록도 락 **밖에서** 한다. 로그 쓰기도 시트 쓰기라, 락 안에 두면
  //    다른 조장이 그만큼 더 기다린다 (D-038 과 같은 이유).
  T.total = Date.now() - t0;
  logEvent_('progress.set', ctx.pid, ctx.teamKey + '/' + codes.join(','),
    (codes.length === 1 ? (byCode[codes[0]].status || '점수') : codes.length + '건') +
      (ignored.length ? ' · 스태프 점수 유지 ' + ignored.join(',') : ''),
    timingText_(T));

  return list;
}

// ---------------------------------------------------------------- 거점 스태프 (D-051·052)

/** 담당 지점. 지점코드가 틀렸으면 명확히 알린다 — 조용히 빈 화면이면 현장에서 못 고친다. */
function stationCheckpoint_(ctx) {
  if (ctx.mode !== 'station') {
    throw new AppError('FORBIDDEN', '담당 지점이 있는 스태프만 쓸 수 있습니다.');
  }
  var cp = checkpoints_().filter(function (c) { return c.code === ctx.station; })[0];
  if (!cp) {
    throw new AppError('BAD_REQUEST', '담당 지점 "' + ctx.station + '" 이 지점 목록에 없습니다. 운영진에게 문의해 주세요.');
  }
  return cp;
}

function naturalGroupCmp_(a, b) {
  var na = parseInt(a, 10), nb = parseInt(b, 10);
  if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

/**
 * 내 지점 기준 — 내 회차의 **이 지점을 지나는 모든 조**를, 이 지점에 오는 순서대로.
 * 직전 지점 상태를 같이 준다: 직전 지점을 끝냈으면 "오는 중" 이다.
 */
function stationBoard_(ctx) {
  var cp = stationCheckpoint_(ctx);
  var board = progressBoardData_();
  var nameOf = {};
  board.checkpoints.forEach(function (c) { nameOf[c.code] = c.name; });

  var teams = board.teams
    .filter(function (t) { return t.session === ctx.session && t.route.indexOf(cp.code) >= 0; })
    .map(function (t) {
      var i = t.route.indexOf(cp.code);
      var cell = t.cells[cp.code] || {};
      var prevCode = i > 0 ? t.route[i - 1] : '';
      return {
        group: t.group,
        name: t.name,
        leaderName: t.leaderName,
        memberCount: t.memberCount,
        visitOrder: i + 1,
        prevName: prevCode ? (nameOf[prevCode] || prevCode) : '',
        prevStatus: prevCode ? ((t.cells[prevCode] || {}).status || '대기') : '',
        status: cell.status || '대기',
        arrivedAt: cell.arrivedAt || '',
        completedAt: cell.completedAt || '',
        score: cell.score === undefined ? null : cell.score,
        scoreSource: cell.scoreSource || ''
      };
    })
    .sort(function (a, b) {
      return (a.visitOrder - b.visitOrder) || naturalGroupCmp_(a.group, b.group);
    });

  return {
    session: ctx.session,
    checkpoint: { code: cp.code, name: cp.name, mission: cp.mission, quizUrl: cp.quizUrl },
    teams: teams
  };
}

/**
 * 스태프 기록. 지점·회차는 **로그인한 사람에게서** 정한다 — 요청이 다른 지점을 말해도 무시한다.
 * items: [{ group, status?, score? }]
 */
function stationSet_(ctx, body) {
  if (!confBool_('PROGRESS_OPEN', true)) {
    throw new AppError('CLOSED', '진행 기록이 마감되었습니다.');
  }
  var cp = stationCheckpoint_(ctx);
  var raw = Array.isArray(body.items) ? body.items : [body];
  if (!raw.length) throw new AppError('BAD_REQUEST', '기록할 조가 없습니다.');

  // 🔴 이 지점을 지나는 **내 회차** 조만. 다른 회차·코스에 없는 조는 거절한다.
  var mine = {};
  progressBoardData_().teams.forEach(function (t) {
    if (t.session === ctx.session && t.route.indexOf(cp.code) >= 0) mine[t.group] = true;
  });

  var byGroup = {};
  raw.forEach(function (it) {
    var group = str_(it.group);
    if (!mine[group]) {
      throw new AppError('FORBIDDEN', group + ' 은(는) ' + ctx.session + ' 에 이 지점(' + cp.name + ')을 지나는 조가 아닙니다.');
    }
    var n = normalizeProgressItem_({ status: it.status, score: it.score, memo: it.memo }, true);
    n.code = cp.code;
    byGroup[group] = Object.assign({ session: ctx.session, group: group }, n);
  });
  var groups = Object.keys(byGroup);
  var entries = groups.map(function (g) { return byGroup[g]; });

  var T = { auth: __authMs, n: groups.length };
  var t0 = Date.now();
  writeProgress_('스태프', ctx.pid, entries, T);

  // 조장 화면은 사본에서 읽는다(D-042) — 스태프가 쓴 것도 **조마다** 밀어 둔다.
  groups.forEach(function (g) {
    mirrorProgressPush_(ctx.session, g, progressListFor_(ctx.session, g, null));
  });
  T.total = Date.now() - t0;
  logEvent_('station.set', ctx.pid, ctx.session + '/' + cp.code + '/' + groups.join(','),
    groups.length === 1 ? (entries[0].status || '점수') : groups.length + '건', timingText_(T));

  return stationBoard_(ctx);
}

/** 교역자·스태프 — 내 회차 전체 진행을 **읽기만** (D-051). 관리 기능은 운영 콘솔(PIN). */
function opsBoard_(ctx) {
  if (ctx.mode !== 'ops' && ctx.mode !== 'station') {
    throw new AppError('FORBIDDEN', '교역자·스태프만 볼 수 있습니다.');
  }
  var board = progressBoardData_();
  return {
    session: ctx.session,
    checkpoints: board.checkpoints,
    teams: board.teams.filter(function (t) { return t.session === ctx.session; })
  };
}

/**
 * 운영 콘솔에서 칸 하나를 고친다 (D-052). 시트를 직접 고치면 사본에 안 가서(캠프 모드가 필요했다)
 * 여기서 고치면 **사본까지** 밀린다. body: { session, group, checkpoint, status?, score? }
 */
function adminProgressSet_(ctx, body) {
  var session = str_(body.session);
  var group = str_(body.group);
  var exists = allTeams_().some(function (t) { return t.session === session && t.group === group; });
  if (!exists) throw new AppError('NOT_FOUND', '명단에 없는 조입니다: ' + session + ' ' + group);

  var n = normalizeProgressItem_(body, true);
  if (!n.code) throw new AppError('BAD_REQUEST', '지점을 선택해 주세요.');
  var entry = Object.assign({ session: session, group: group }, n);

  var T = { n: 1 };
  writeProgress_('관리자', 'ADMIN', [entry], T);
  mirrorProgressPush_(session, group, progressListFor_(session, group, null));
  logEvent_('admin.progress.set', 'ADMIN', session + '|' + group + '/' + n.code,
    (n.status || '') + (n.hasScore ? ' 점수=' + n.score : ''), timingText_(T));
  return progressBoardData_();
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
function progressBoard_(ctx) { return progressBoardData_(); }

function progressBoardData_() {
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
      score: r['퀴즈점수'] !== '' ? Number(r['퀴즈점수']) : null,
      scoreSource: str_(r['점수출처'])
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

    // 조 없는 교역자·스태프는 '미배정' 이 아니라 운영진이다 (D-051)
    var ops = !str_(r[COL.GROUP]) && isOpsRole_(r[COL.ROLE]);
    var session = str_(r[COL.SESSION]) || (ops ? '전 회차' : '(일자 미정)');
    var group = str_(r[COL.GROUP]) || (ops ? '운영진' : '(조 미배정)');
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

  var out = withLock_(function () {
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

  // 🔴 **사본도 함께 민다** (D-047).
  //
  // 앱은 bootstrap 을 **미러 → GAS** 순으로 읽는다. 시트 쪽 캐시만 비우면
  // 참가자 화면은 최대 26시간 동안 옛 설정을 그린다 — 일지를 닫았는데 화면엔
  // 작성 폼이 그대로 있고, 올리면 그제서야 `CLOSED` 가 뜬다.
  //
  // 락 **밖**이다. `withLock_` 은 스크립트 전체를 직렬화하므로 그 안에서
  // 네트워크를 기다리면 다른 사람이 그만큼 줄을 선다 (D-044).
  mirrorPush();

  return out;
}
