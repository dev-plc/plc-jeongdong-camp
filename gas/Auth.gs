/**
 * Auth.gs — 인증 / 토큰 / 권한
 *
 * 로그인: 이름 + 연락처 뒷 4자리 (D-003). 참여 일자는 후보를 좁히는 힌트로만 쓴다.
 * 토큰:   payload.signature — HMAC-SHA256, 무상태. GAS 에는 세션 저장소가 없다.
 */

/** 앱 전역 에러. code 는 docs-dev/spec/API.md 의 에러 코드 표와 1:1. */
function AppError(code, message) {
  this.name = 'AppError';
  this.code = code;
  this.message = message || code;
}
AppError.prototype = Object.create(Error.prototype);

// ---------------------------------------------------------------- 이름 / 연락처 정규화

/** 이름 비교용 정규화: 공백 제거 + 소문자화. "홍 길동" 과 "홍길동" 을 같게 본다. */
function normalizeName_(name) {
  return str_(name).replace(/\s+/g, '').toLowerCase();
}

/**
 * 마스터시트는 동명이인 구분을 위해 이름 뒤에 번호 4자리를 붙여 적는다 (예: "이승천7377").
 * 참가자에게 "이승천7377" 을 입력하라고 할 수는 없으므로,
 * 저장된 이름을 { full, base, digits } 로 분해해 둘 다 매칭에 쓴다.
 */
function splitName_(stored) {
  var raw = str_(stored);
  var m = raw.match(/^(.*?)[\s-]*(\d{4})$/);
  if (m && normalizeName_(m[1])) {
    return { full: normalizeName_(raw), base: normalizeName_(m[1]), digits: m[2] };
  }
  return { full: normalizeName_(raw), base: normalizeName_(raw), digits: '' };
}

/** 연락처에서 숫자만 남기고 뒤 4자리를 뽑는다. */
function phoneLast4_(phone) {
  var digits = str_(phone).replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : '';
}

/**
 * 이름 + 뒷 4자리가 이 참가자와 맞는지.
 *
 * 기본은 **연락처 뒷 4자리**만 인정한다.
 * `Config.LOGIN_ALLOW_NAME_DIGITS = TRUE` 인 동안에만 이름 뒤에 붙은 4자리(`이승천7377`)도
 * 대체 수단으로 받아 준다 — 명단에 연락처가 아직 임시값인 기간용 임시 조치다.
 *
 * ⚠ 실제 연락처를 다 채운 뒤에는 반드시 `FALSE` 로 내려야 한다.
 *   이름 뒤 4자리는 명단을 본 사람이면 누구나 알 수 있어, 켜 둔 채로는 사실상 이름만으로
 *   로그인되는 것과 같다. (docs-dev/spec/DECISIONS.md D-003)
 */
function matchesParticipant_(row, typedName, typedLast4) {
  var name = splitName_(row[COL.NAME]);
  var typed = normalizeName_(typedName);
  if (typed !== name.full && typed !== name.base) return false;

  var candidates = [phoneLast4_(row[COL.PHONE])];
  if (confBool_('LOGIN_ALLOW_NAME_DIGITS', true) && name.digits) {
    candidates.push(name.digits);
  }
  return candidates.filter(String).indexOf(typedLast4) >= 0;
}

/** 화면에 보여줄 이름 — 뒤에 붙은 구분용 4자리는 떼고 보여준다. */
function displayName_(stored) {
  var raw = str_(stored);
  var m = raw.match(/^(.*?)[\s-]*\d{4}$/);
  return m && str_(m[1]) ? str_(m[1]) : raw;
}

// ---------------------------------------------------------------- 토큰

function getTokenSecret_() {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('TOKEN_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('TOKEN_SECRET', secret);
  }
  return secret;
}

function sign_(payloadB64) {
  var raw = Utilities.computeHmacSha256Signature(payloadB64, getTokenSecret_());
  return Utilities.base64EncodeWebSafe(raw).replace(/=+$/, '');
}

/** 타이밍 공격을 피하기 위한 상수 시간 비교. */
function safeEquals_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * 토큰 페이로드는 { pid, exp } 뿐이다.
 * 역할·조·참여일자는 담지 않는다 — 발급 후 명단이 바뀌면 어긋나기도 하고,
 * 권한 판단은 어차피 요청마다 시트를 다시 읽어서 하기 때문이다(requireUser_).
 * 덕분에 페이로드가 ASCII 로만 이뤄져 인코딩 문제도 생기지 않는다.
 */
function issueToken_(claims) {
  var ttlHours = confInt_('TOKEN_TTL_HOURS', 12);
  var payload = { pid: claims.pid, exp: Date.now() + ttlHours * 3600 * 1000 };
  var b64 = Utilities.base64EncodeWebSafe(JSON.stringify(payload));
  return { token: b64 + '.' + sign_(b64), expiresAt: new Date(payload.exp).toISOString() };
}

function verifyToken_(token) {
  var parts = str_(token).split('.');
  if (parts.length !== 2) throw new AppError('UNAUTHORIZED', '다시 로그인해 주세요.');
  if (!safeEquals_(sign_(parts[0]), parts[1])) {
    throw new AppError('UNAUTHORIZED', '다시 로그인해 주세요.');
  }
  var payload;
  try {
    payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
  } catch (e) {
    throw new AppError('UNAUTHORIZED', '다시 로그인해 주세요.');
  }
  if (!payload.exp || payload.exp < Date.now()) {
    throw new AppError('UNAUTHORIZED', '로그인이 만료되었습니다. 다시 로그인해 주세요.');
  }
  return payload;
}

// ---------------------------------------------------------------- 로그인

/**
 * 이름 + 뒷4자리로 참가자를 찾는다.
 *
 * 시도 횟수 제한은 **의도적으로 두지 않는다**(D-003).
 * 무차별 시도가 가능해지지만, 명단에 없는 사람은 어차피 아무것도 못 하고,
 * 현장에서 참가자가 잠겨 못 들어오는 비용이 더 크다는 판단이다.
 * 실패는 Log 시트에 남으므로 이상 징후는 사후에 확인할 수 있다.
 *
 * 참여 일자는 **후보를 좁히는 힌트**일 뿐, 필수 조건이 아니다.
 * 참가자가 자기 날짜를 헷갈려 고른 경우에도 명단이 맞으면 들어오게 하고,
 * 실제 배정된 날짜로 로그인시킨다(sessionCorrected 로 알려 준다).
 */
function login_(body) {
  var hintSession = str_(body.session);
  var name = str_(body.name);
  var last4 = str_(body.phoneLast4).replace(/\D/g, '');

  if (!name) throw new AppError('BAD_REQUEST', '이름을 입력해 주세요.');
  if (last4.length !== 4) throw new AppError('BAD_REQUEST', '연락처 뒷 4자리를 입력해 주세요.');

  var matches = readTable_(SHEETS.PARTICIPANTS).filter(function (r) {
    return matchesParticipant_(r, name, last4);
  });

  if (matches.length === 0) {
    logEvent_('auth.login', name, '', 'NOT_FOUND', '');
    throw new AppError('NOT_FOUND', '명단에서 찾지 못했습니다. 이름과 연락처를 확인하시거나 운영진에게 문의해 주세요.');
  }

  // 동명이인이면 고른 날짜로 한 번 더 좁혀 본다.
  if (matches.length > 1 && hintSession) {
    var narrowed = matches.filter(function (r) { return str_(r[COL.SESSION]) === hintSession; });
    if (narrowed.length === 1) matches = narrowed;
  }
  if (matches.length > 1) {
    logEvent_('auth.login', name, '', 'AMBIGUOUS', matches.length + '건');
    throw new AppError('AMBIGUOUS', '같은 이름·번호가 여러 건 등록되어 있습니다. 운영진에게 문의해 주세요.');
  }

  var p = matches[0];
  if (!str_(p[COL.SESSION])) {
    throw new AppError('BAD_REQUEST', '참여 일자가 아직 배정되지 않았습니다. 운영진에게 문의해 주세요.');
  }
  // 🔴 비활성 회차는 **로그인을 막는다.** 사전답사가 끝나면 이걸로 끈다 (D-031).
  // 명단은 그대로 두므로 되돌리는 것은 Config 한 칸이다.
  if (!isActiveSession_(str_(p[COL.SESSION]))) {
    logEvent_('auth.login', name, str_(p[COL.SESSION]), 'SESSION_INACTIVE', '');
    throw new AppError('FORBIDDEN',
      '지금은 열려 있지 않은 회차입니다(' + str_(p[COL.SESSION]) + ').\n운영진에게 문의해 주세요.');
  }
  if (!str_(p['참가자ID'])) {
    throw new AppError('SERVER_ERROR', '참가자 ID가 비어 있습니다. 운영진에게 문의해 주세요. (fillParticipantIds 실행 필요)');
  }

  var issued = issueToken_({ pid: str_(p['참가자ID']) });
  logEvent_('auth.login', str_(p['참가자ID']), '', 'OK', '');

  var me = buildMe_(p);
  me.sessionCorrected = !!(hintSession && hintSession !== str_(p[COL.SESSION]));
  return { token: issued.token, expiresAt: issued.expiresAt, me: me };
}

// ---------------------------------------------------------------- 컨텍스트

/**
 * 토큰에서 현재 사용자 컨텍스트를 만든다.
 * 토큰에는 pid 만 들어 있으므로 권한 판단은 항상 시트를 다시 읽어서 한다.
 */
function requireUser_(body) {
  var payload = verifyToken_(body && body.token);
  if (payload.pid === 'ADMIN') {
    return { isAdmin: true, isLeader: true, pid: 'ADMIN', session: '', group: '', teamKey: '', row: null };
  }
  var p = findParticipantById_(payload.pid);
  if (!p) throw new AppError('UNAUTHORIZED', '명단에서 확인되지 않습니다. 운영진에게 문의해 주세요.');

  return {
    isAdmin: false,
    isLeader: isLeaderRow_(p),
    pid: str_(p['참가자ID']),
    name: displayName_(p[COL.NAME]),
    audience: str_(p[COL.AUDIENCE]),
    session: str_(p[COL.SESSION]),
    group: str_(p[COL.GROUP]),
    teamKey: rowTeamKey_(p),
    role: str_(p[COL.ROLE]),
    row: p
  };
}

function requireAdmin_(body) {
  // PIN 직접 전달도 허용한다(관리자 콘솔의 1회성 조회).
  if (body && body.pin) {
    assertAdminPin_(body.pin);
    return { isAdmin: true, isLeader: true, pid: 'ADMIN', session: '', group: '', teamKey: '', row: null };
  }
  var ctx = requireUser_(body);
  if (!ctx.isAdmin) throw new AppError('FORBIDDEN', '관리자만 사용할 수 있습니다.');
  return ctx;
}

function assertAdminPin_(pin) {
  var expected = PropertiesService.getScriptProperties().getProperty('ADMIN_PIN');
  if (!expected) throw new AppError('SERVER_ERROR', 'ADMIN_PIN 스크립트 속성이 설정되지 않았습니다.');
  if (!safeEquals_(str_(pin), expected)) {
    logEvent_('admin.login', 'ADMIN', '', 'FAIL', '');
    throw new AppError('UNAUTHORIZED', 'PIN 이 올바르지 않습니다.');
  }
}

function adminLogin_(body) {
  assertAdminPin_(body.pin);
  var issued = issueToken_({ pid: 'ADMIN' });
  logEvent_('admin.login', 'ADMIN', '', 'OK', '');
  return { token: issued.token, expiresAt: issued.expiresAt, isAdmin: true };
}

// ---------------------------------------------------------------- 조회 헬퍼

function findParticipantById_(pid) {
  var target = str_(pid);
  if (!target) return null;
  var rows = readTable_(SHEETS.PARTICIPANTS);
  for (var i = 0; i < rows.length; i++) {
    if (str_(rows[i]['참가자ID']) === target) return rows[i];
  }
  return null;
}

/** (참여 일자, 조 배정) 으로 Teams 행을 찾는다. 없으면 null — 조 메타는 선택 사항이다. */
function findTeam_(session, group) {
  var key = teamKey_(session, group);
  var rows = readTable_(SHEETS.TEAMS);
  for (var i = 0; i < rows.length; i++) {
    if (rowTeamKey_(rows[i]) === key) return rows[i];
  }
  return null;
}

function isLeaderRow_(participant) {
  return LEADER_ROLES.indexOf(str_(participant[COL.ROLE])) >= 0;
}

/** 같은 (참여 일자, 조 배정) 에 속한 참가자들. */
function teamMembers_(session, group) {
  var key = teamKey_(session, group);
  if (!str_(session) || !str_(group)) return [];
  return readTable_(SHEETS.PARTICIPANTS).filter(function (r) { return rowTeamKey_(r) === key; });
}

/** 참가자 응답 객체. 연락처는 어떤 경우에도 넣지 않는다(D-003). */
function buildMe_(p) {
  var session = str_(p[COL.SESSION]);
  var group = str_(p[COL.GROUP]);
  var team = findTeam_(session, group);
  var leader = isLeaderRow_(p);
  var members = teamMembers_(session, group);

  var out = {
    participant: {
      id: str_(p['참가자ID']),
      name: displayName_(p[COL.NAME]),
      audience: str_(p[COL.AUDIENCE]),
      session: session,
      role: str_(p[COL.ROLE]) || '일반',
      group: group,
      feeStatus: str_(p[COL.FEE_STATUS]) || '미납',
      insurance: str_(p[COL.INSURANCE])
    },
    team: group ? {
      session: session,
      group: group,
      name: team ? (str_(team['조이름']) || group) : group,
      color: (team && str_(team['색상'])) || '#984534',
      meetingPoint: team ? str_(team['집결장소']) : '',
      leaderName: leaderNameOf_(members),
      course: courseNameOf_(members, p),
      route: routeFor_(courseNameOf_(members, p))
    } : null,
    isLeader: leader,
    members: []
  };

  if (leader && group) {
    out.members = members.map(function (r) {
      return {
        id: str_(r['참가자ID']),
        name: displayName_(r[COL.NAME]),
        role: str_(r[COL.ROLE]) || '일반',
        feeStatus: str_(r[COL.FEE_STATUS]) || '미납',
        insurance: str_(r[COL.INSURANCE])
      };
    });
  }
  return out;
}

function leaderNameOf_(members) {
  for (var i = 0; i < members.length; i++) {
    if (str_(members[i][COL.ROLE]) === '조장') return displayName_(members[i][COL.NAME]);
  }
  return '';
}

/**
 * 조의 배정 코스. 조원들이 같은 값을 갖는 게 정상이므로 첫 번째 값을 쓰고,
 * 비어 있으면 요청자 본인 행의 값으로 되돌아간다.
 * (조원 간 값이 어긋나면 checkDuplicates() 가 경고한다.)
 */
function courseNameOf_(members, fallbackRow) {
  for (var i = 0; i < members.length; i++) {
    var c = str_(members[i][COL.COURSE]);
    if (c) return c;
  }
  return fallbackRow ? str_(fallbackRow[COL.COURSE]) : '';
}

/**
 * 배정 코스명을 지점코드 배열로 바꾼다 (D-007).
 * Courses 시트의 `코스명` 과 정확히 일치하거나, 앞글자(A/B/C/D)가 같으면 매칭한다.
 * 못 찾으면 Checkpoints 의 기본순번 순서로 되돌린다.
 */
function routeFor_(courseName) {
  var fallback = defaultRoute_();
  var name = str_(courseName);
  if (!name) return fallback;

  var rows = readTable_(SHEETS.COURSES);
  var hit = null;
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (str_(row['코스명']) === name) { hit = row; break; }
    if (!hit && courseLetter_(row['코스명']) && courseLetter_(row['코스명']) === courseLetter_(name)) hit = row;
  }
  if (!hit) return fallback;

  var seq = str_(hit['방문 순서']).split(/[,\s]+/).filter(String);
  var valid = seq.filter(function (code) { return fallback.indexOf(code) >= 0; });
  // 중복 없이 전체 지점을 덮을 때만 사용한다.
  if (valid.length === fallback.length && new Set(valid).size === fallback.length) return valid;
  return fallback;
}

function courseLetter_(name) {
  var m = str_(name).match(/^([A-Za-z])/);
  return m ? m[1].toUpperCase() : '';
}

function defaultRoute_() {
  return readTable_(SHEETS.CHECKPOINTS)
    .filter(function (r) { return str_(r['지점코드']); })
    .slice()
    .sort(function (a, b) { return (parseInt(a['기본순번'], 10) || 0) - (parseInt(b['기본순번'], 10) || 0); })
    .map(function (r) { return str_(r['지점코드']); });
}
