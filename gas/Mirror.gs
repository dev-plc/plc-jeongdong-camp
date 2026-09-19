/**
 * Mirror.gs — 공개 데이터를 Supabase 로 단방향 복제한다 (D-032)
 *
 * **원장은 시트다.** 여기서 만드는 것은 버리고 다시 만들 수 있는 **읽기 캐시**다.
 * 앱은 이 미러를 먼저 읽고, 없거나 낡았으면 지금까지처럼 GAS 로 온다.
 * 그래서 미러가 죽어도 앱은 돈다 — 그 폴백이 이 구조의 전제다.
 *
 * 1단계 대상은 `bootstrap_()` 이 내려보내는 공개 데이터뿐이다(실측 4.5KB).
 * **개인정보(명단)와 쓰기(진행·일지)는 올리지 않는다.**
 *
 * 설정: 스크립트 속성 `SUPABASE_URL` · `SUPABASE_SERVICE_KEY`
 *       (둘 중 하나라도 비면 **아무 일도 하지 않는다** — 설정 전에도 안전하다)
 */

/** 미러가 쓰는 테이블·행. 공개 데이터는 한 행이면 충분하다. */
var MIRROR_TABLE = 'app_cache';
var MIRROR_KEY = 'bootstrap';

/** 진행 사본 테이블 (D-038). 조·지점 단위 행이라 JSONB 한 덩어리가 아니다. */
var MIRROR_PROGRESS_TABLE = 'progress_cache';

function mirrorConfig_() {
  var props = PropertiesService.getScriptProperties();
  return {
    url: str_(props.getProperty('SUPABASE_URL')).replace(/\/+$/, ''),
    key: str_(props.getProperty('SUPABASE_SERVICE_KEY'))
  };
}

/**
 * Supabase 인증 헤더.
 *
 * 🔴 Supabase 는 키 체계가 둘이다.
 *  · **옛 형식(JWT)**: `eyJhbGci...` — 키 자체가 역할을 담은 JWT 다.
 *    PostgREST 가 이걸 디코드해 역할을 정하므로 `Authorization: Bearer` 로도 보내야 한다.
 *  · **새 형식**: `sb_secret_...` / `sb_publishable_...` — JWT 가 아니다.
 *    역할은 서버가 키로 판별한다. **Bearer 로 보내면 JWT 파싱에 실패할 수 있다.**
 *
 * 그래서 `apikey` 는 항상 보내고, `Authorization` 은 **JWT 처럼 생겼을 때만** 붙인다.
 * 두 형식 모두에서 동작한다 (D-032).
 */
function supabaseAuthHeaders_(key) {
  var headers = { apikey: key };
  if (/^eyJ/.test(key)) headers.Authorization = 'Bearer ' + key;
  return headers;
}

/** 미러를 쓸 수 있는 상태인가. 설정이 없으면 조용히 끈다(에러 아님). */
function mirrorEnabled_() {
  var c = mirrorConfig_();
  return !!(c.url && c.key);
}

/**
 * 공개 데이터를 통째로 밀어 넣는다(upsert).
 *
 * **전량 덮어쓰기다.** 증분 계산은 이 규모(4.5KB)에서 복잡도가 이득보다 크다.
 * 몇 번 돌아도 결과가 같으므로 재시도·중복 실행이 안전하다.
 *
 * 🔴 **실패해도 던지지 않는다.** 이 함수는 onEdit 안에서도 불린다.
 * 미러 때문에 사람이 시트를 고치는 일이 막히면 안 된다. 실패는 Log 에 남긴다.
 *
 * @return {boolean} 실제로 밀어 넣었으면 true
 */
/**
 * 한 테이블에 행을 밀어 넣는다(upsert).
 *
 * 🔴 **실패해도 던지지 않는다.** 미러는 사본이고 원장은 시트다. 미러 때문에
 * 사람이 시트를 고치거나 조장이 진행을 기록하는 일이 막히면 안 된다.
 * 실패는 `Log` 시트에만 남긴다.
 *
 * `mirrorPush` 와 `mirrorProgressPush_` 가 같이 쓴다 — 같은 일을 하는 코드가
 * 둘이면 하나는 반드시 낡는다.
 *
 * @return {boolean} 실제로 밀어 넣었으면 true
 */
function supabaseUpsert_(table, rows, tag, target) {
  if (!mirrorEnabled_()) return false;
  if (!rows || !rows.length) return true;      // 보낼 것이 없으면 성공으로 친다

  var c = mirrorConfig_();
  try {
    var res = UrlFetchApp.fetch(c.url + '/rest/v1/' + table, {
      method: 'post',
      contentType: 'application/json',
      headers: (function () {
        var h = supabaseAuthHeaders_(c.key);
        // 기본키가 같은 행이 이미 있으면 덮어쓴다. 없으면 만든다.
        h.Prefer = 'resolution=merge-duplicates';
        return h;
      })(),
      payload: JSON.stringify(rows),
      muteHttpExceptions: true
    });

    var code = res.getResponseCode();
    if (code >= 200 && code < 300) return true;

    logEvent_(tag, 'SYSTEM', str_(target), 'HTTP_' + code,
      String(res.getContentText()).slice(0, 300));
    return false;

  } catch (e) {
    logEvent_(tag, 'SYSTEM', str_(target), 'ERROR', String(e && e.message));
    return false;
  }
}

/**
 * 조건에 맞는 행을 지운다. `supabaseUpsert_` 와 같은 규칙 — **절대 안 던진다.**
 *
 * 🔴 `query` 없이 부르지 않는다. PostgREST 에서 조건 없는 DELETE 는 표를 통째로
 * 비우는 것이라, 실수 한 번이 사본 전체를 날린다.
 */
function supabaseDelete_(table, query, tag, target) {
  if (!mirrorEnabled_()) return false;
  if (!query) return false;

  var c = mirrorConfig_();
  try {
    var res = UrlFetchApp.fetch(c.url + '/rest/v1/' + table + '?' + query, {
      method: 'delete',
      headers: supabaseAuthHeaders_(c.key),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code >= 200 && code < 300) return true;

    logEvent_(tag, 'SYSTEM', str_(target), 'HTTP_' + code,
      String(res.getContentText()).slice(0, 300));
    return false;
  } catch (e) {
    logEvent_(tag, 'SYSTEM', str_(target), 'ERROR', String(e && e.message));
    return false;
  }
}

function mirrorPush() {
  return supabaseUpsert_(MIRROR_TABLE, [{
    key: MIRROR_KEY,
    value: bootstrap_(),            // 앱이 받는 것과 **같은 것**을 보낸다
    updated_at: nowIso_()           // 앱이 신선도를 판단하는 근거
  }], 'mirror.push', MIRROR_KEY);
}

/**
 * 한 조의 진행을 DB 사본에 밀어 넣는다 (D-038).
 *
 * **원장은 시트다.** 이 함수는 시트에 이미 들어간 값을 사본에 옮길 뿐이고,
 * 실패해도 `progress.set` 은 성공이다 — 단계 C 의 주기 동기화가 맞춘다.
 *
 * 🔴 **반드시 락 밖에서 부른다.** `withLock_` 은 `getScriptLock()` 이라
 * 스크립트 전체를 직렬화한다. 락 안에서 네트워크를 기다리면 캠프 당일
 * 다른 조장 여덟 명이 그만큼 줄을 선다.
 *
 * @param {string} session 회차 라벨
 * @param {string} team 조 이름
 * @param {Array} rows `progressList_` 가 돌려준 목록 그대로
 */
function mirrorProgressPush_(session, team, rows) {
  if (!mirrorEnabled_()) return false;

  var now = nowIso_();
  var payload = (rows || []).map(function (p) {
    return {
      session: str_(session),
      team: str_(team),
      checkpoint: str_(p.checkpoint),
      status: str_(p.status) || '대기',
      // 🔴 빈 시각은 '' 가 아니라 null 이다. timestamptz 에 '' 를 넣으면 거절당한다.
      arrived_at: str_(p.arrivedAt) || null,
      completed_at: str_(p.completedAt) || null,
      score: (p.score === undefined || p.score === '') ? null : p.score,
      memo: str_(p.memo),
      updated_at: now
    };
  });

  return supabaseUpsert_(MIRROR_PROGRESS_TABLE, payload,
    'mirror.progress', str_(session) + '/' + str_(team));
}

/**
 * 하루 1회 트리거가 부른다. **정지 방지(ping)와 재푸시를 겸한다.**
 *
 * Supabase 무료 프로젝트는 활동이 없으면 정지된다. 캠프는 몇 주 쉬었다가
 * 그날 아침 반드시 돌아야 하므로 이게 최우선 위험이다.
 * 요청 자체가 활동이므로 **재푸시가 곧 ping 이다** — 별도 ping 함수를 두지 않는다.
 * 같은 일을 하는 코드가 둘이면 하나는 반드시 낡는다.
 *
 * 덤으로 `updated_at` 이 매일 새로워져, 앱의 신선도 가드(26시간)를 통과시킨다.
 * 이 트리거가 죽으면 앱은 미러를 버리고 GAS 로 돌아간다 — 조용히 낡지 않는다.
 */
function mirrorDaily() {
  clearConfigCache();     // 낡은 캐시를 밀지 않도록 먼저 비운다
  var ok = mirrorPush();
  if (!ok && mirrorEnabled_()) {
    logEvent_('mirror.daily', 'SYSTEM', MIRROR_KEY, 'FAILED', '');
  }
  // 진행 사본 정합 (D-041). 공개 데이터와 한 함수에서 같이 한다 —
  // 같은 일을 하는 트리거가 둘이면 하나는 반드시 낡는다.
  return mirrorProgressSync() && ok;
}

/**
 * 진행 사본을 **시트 기준으로** 맞춘다 (D-041).
 *
 * 단계 B 의 `mirrorProgressPush_` 는 upsert 라 **지우지 못한다.** 시트에서 사라진
 * 행이 DB 에 남는다. 그래서 이 함수가 선택이 아니라 필수다.
 *
 * 순서가 중요하다.
 *   ① 시트 전량을 `updated_at = 지금` 으로 upsert
 *   ② `updated_at < 지금` 인 행을 지운다 ← 시트에 없는 행만 남아 있다
 *
 * 🔴 **먼저 지우고 넣지 않는다.** 그러면 그 사이에 읽는 사람에게 빈 표가 간다.
 * 이 순서면 표가 한순간도 비지 않는다.
 *
 * 실패해도 던지지 않는다. 원장은 시트다.
 */
function mirrorProgressSync() {
  if (!mirrorEnabled_()) return false;

  var stamp = nowIso_();
  var rows = readTable_(SHEETS.PROGRESS).map(function (r) {
    return {
      session: str_(r[COL.SESSION]),
      team: str_(r[COL.GROUP]),
      checkpoint: str_(r['지점코드']),
      status: str_(r['상태']) || '대기',
      arrived_at: toIso_(r['도착시각']) || null,
      completed_at: toIso_(r['완료시각']) || null,
      score: r['퀴즈점수'] === '' || r['퀴즈점수'] === null || r['퀴즈점수'] === undefined
        ? null : Number(r['퀴즈점수']),
      memo: str_(r['메모']),
      updated_at: stamp
    };
  }).filter(function (x) { return x.session && x.team && x.checkpoint; });

  var pushed = supabaseUpsert_(MIRROR_PROGRESS_TABLE, rows, 'mirror.sync', 'progress');
  if (!pushed) return false;

  // 이제 stamp 보다 낡은 행은 **시트에 없는 행**뿐이다.
  var swept = supabaseDelete_(MIRROR_PROGRESS_TABLE,
    'updated_at=lt.' + encodeURIComponent(stamp), 'mirror.sweep', 'progress');

  // 동기화가 언제 돌았는지 남긴다. 앱이 사본의 신선도를 판단하는 근거다(단계 D).
  supabaseUpsert_(MIRROR_TABLE, [{
    key: 'progress_meta',
    value: { syncedAt: stamp, rows: rows.length },
    updated_at: stamp
  }], 'mirror.sync', 'progress_meta');

  return swept;
}

/**
 * `mirrorDaily` 에 걸린 트리거를 모두 지운다.
 *
 * 핸들러 이름이 `mirrorDaily` 인 이유는 **이미 운영진이 그 이름으로 트리거를
 * 걸어 뒀기 때문**이다. 이름을 바꾸면 그 트리거가 조용히 죽는다.
 */
function clearMirrorTriggers_() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'mirrorDaily') { ScriptApp.deleteTrigger(t); n++; }
  });
  return n;
}

/** 하루 1회 트리거를 건다. 중복 등록을 막기 위해 기존 것을 지우고 새로 만든다. */
function installMirrorTrigger() {
  clearMirrorTriggers_();
  ScriptApp.newTrigger('mirrorDaily').timeBased().everyDays(1).atHour(4).create();

  var msg = mirrorEnabled_()
    ? '✅ 매일 04시에 미러를 갱신합니다.\n(정지 방지 ping 과 진행 사본 정합을 겸합니다)'
    : '⚠ 트리거는 걸었지만 SUPABASE_URL / SUPABASE_SERVICE_KEY 가 비어 있습니다.\n' +
      '스크립트 속성에 넣기 전까지는 아무 일도 하지 않습니다.';
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { console.log(msg); }
}

/** 메뉴에서 지금 당장 한 번 밀어 본다. 설정이 맞는지 확인하는 용도. */
function mirrorPushNow() {
  if (!mirrorEnabled_()) {
    var no = '⚠ 스크립트 속성에 SUPABASE_URL / SUPABASE_SERVICE_KEY 를 먼저 넣어 주세요.';
    try { SpreadsheetApp.getUi().alert(no); } catch (e) { console.log(no); }
    return false;
  }
  clearConfigCache();
  var ok = mirrorPush();
  var msg = ok
    ? '✅ 미러를 갱신했습니다.'
    : '❌ 미러 갱신에 실패했습니다. Log 탭에서 mirror.push 행을 확인해 주세요.';
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { console.log(msg); }
  return ok;
}

/**
 * 🔴 **캠프 당일에만** 10분 동기화를 켠다 (D-041).
 *
 * 평소에는 하루 1회로 충분하다 — 공개 데이터는 캠프 전에 확정되고, 진행 사본은
 * 쓸 때마다 즉시 밀린다(단계 B). 변경이 없어도 계속 도는 것은 낭비다(D-017).
 *
 * 캠프 당일만 다르다. 운영진이 시트에서 진행을 직접 고치는 일이 생기고,
 * 그건 앱을 거치지 않으므로 **주기 동기화만이 사본에 옮긴다.**
 * 끝나면 반드시 끈다 — 그래서 끄는 메뉴를 같이 둔다.
 */
function installCampSync() {
  clearMirrorTriggers_();
  ScriptApp.newTrigger('mirrorDaily').timeBased().everyMinutes(10).create();

  var msg = '✅ 캠프 모드: 10분마다 동기화합니다.\n\n' +
    '🔴 캠프가 끝나면 "캠프 모드 끄기" 를 눌러 주세요.\n' +
    '   평소에 10분마다 도는 것은 낭비입니다.';
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { console.log(msg); }
  return true;
}

/** 캠프 모드를 끄고 평소(하루 1회)로 되돌린다. */
function stopCampSync() {
  clearMirrorTriggers_();
  ScriptApp.newTrigger('mirrorDaily').timeBased().everyDays(1).atHour(4).create();

  var msg = '✅ 평소대로 돌아왔습니다. 매일 04시에 한 번 갱신합니다.';
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { console.log(msg); }
  return true;
}
