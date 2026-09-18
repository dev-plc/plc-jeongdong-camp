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

/** 미러가 쓰는 테이블·행. 1단계는 한 행이면 충분하다. */
var MIRROR_TABLE = 'app_cache';
var MIRROR_KEY = 'bootstrap';

function mirrorConfig_() {
  var props = PropertiesService.getScriptProperties();
  return {
    url: str_(props.getProperty('SUPABASE_URL')).replace(/\/+$/, ''),
    key: str_(props.getProperty('SUPABASE_SERVICE_KEY'))
  };
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
function mirrorPush() {
  if (!mirrorEnabled_()) return false;

  var c = mirrorConfig_();
  try {
    var res = UrlFetchApp.fetch(c.url + '/rest/v1/' + MIRROR_TABLE, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        apikey: c.key,
        Authorization: 'Bearer ' + c.key,
        // 같은 key 가 이미 있으면 덮어쓴다. 없으면 만든다.
        Prefer: 'resolution=merge-duplicates'
      },
      payload: JSON.stringify([{
        key: MIRROR_KEY,
        value: bootstrap_(),            // 앱이 받는 것과 **같은 것**을 보낸다
        updated_at: nowIso_()           // 앱이 신선도를 판단하는 근거
      }]),
      muteHttpExceptions: true
    });

    var code = res.getResponseCode();
    if (code >= 200 && code < 300) return true;

    logEvent_('mirror.push', 'SYSTEM', MIRROR_KEY, 'HTTP_' + code,
      String(res.getContentText()).slice(0, 300));
    return false;

  } catch (e) {
    logEvent_('mirror.push', 'SYSTEM', MIRROR_KEY, 'ERROR', String(e && e.message));
    return false;
  }
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
  return ok;
}

/** 하루 1회 트리거를 건다. 중복 등록을 막기 위해 기존 것을 지우고 새로 만든다. */
function installMirrorTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'mirrorDaily') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('mirrorDaily').timeBased().everyDays(1).atHour(4).create();

  var msg = mirrorEnabled_()
    ? '✅ 매일 04시에 미러를 갱신합니다.\n(정지 방지 ping 을 겸합니다)'
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
