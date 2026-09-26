/**
 * ────────────────────────────────────────────────────────────────
 * config.js · v15 · 2026-09-26
 * ────────────────────────────────────────────────────────────────
 * 변경 이력 (최근 5건 — 전체는 docs-dev/spec/DECISIONS.md · git log)
 *  v15   2026-09-26  파일 버전 표시 시작
 *  —     2026-09-19  진행을 미러에서 읽는다
 *  —     2026-09-18  요청에 시간 상한을 둔다
 *  —     2026-09-18  Supabase publishable 키를 넣어 읽기 미러를 실제로…
 *  —     2026-09-18  일시적 장애를 한 번 재시도하고, 원인을 나눠 말한다
 *
 * 버전: vN = GAS 배포 번호. vN.k = 서버는 vN 그대로 두고 앱·도구만 고친 k번째.
 *       — 는 버전 기록을 시작하기 전(v12 이전)의 변경.
 * 🔴 이 파일을 고치면 맨 위 줄(이름·버전·날짜)과 이력을 함께 고친다 (CLAUDE.md).
 * ────────────────────────────────────────────────────────────────
 */

/**
 * config.js — 배포 환경 설정
 *
 * ⚠ API_BASE 는 GAS 웹앱을 배포한 뒤 받은 /exec URL 로 바꿔야 한다.
 *   Apps Script 편집기 → 배포 → 새 배포 → 웹 앱
 *     · 실행 계정: 나
 *     · 액세스 권한: 모든 사용자
 *   코드를 고칠 때마다 "배포 관리 → 편집 → 버전: 새 버전" 을 해야 반영된다.
 */
window.APP_CONFIG = {
  API_BASE: 'https://script.google.com/macros/s/AKfycbyLVkTS5tqMAY_2XXKINFkO_7ecBrWryUFMqOLmAV0EMKUhLsjzvgvX3bE_qQYFu3Ha0A/exec',

  // 로그인 토큰을 담아 둘 localStorage 키
  TOKEN_KEY: 'plc_jd_token',

  // 업로드 전 클라이언트 리사이즈 기준 (긴 변 px / JPEG 품질)
  PHOTO_MAX_EDGE: 1600,
  PHOTO_QUALITY: 0.8,

  // ---- 요청 시간 상한 (D-036) ----
  // 서버 실측(Apps Script 실행 로그)은 최대 6.3초였는데 폰에서는 61초까지 걸렸다.
  // 잃어버린 시간은 전송·대기 쪽이고, 원인과 무관하게 **화면이 멎는 시간**은 묶어야 한다.
  // 🔴 0 으로 두면 상한이 사라지고 예전 동작(무한정 대기) 그대로다. 되돌리는 한 줄.
  REQUEST_TIMEOUT: 15000,
  // 사진이 실린 요청은 전송 자체가 오래 걸리는 것이 정상이다.
  // 15초로 자르면 4G 에서 일지 사진이 아예 안 올라간다.
  UPLOAD_TIMEOUT: 60000,

  // bootstrap 캐시 유지 시간(ms). 공지·타임라인이 자주 바뀌지 않으므로 짧게만 잡는다.
  BOOTSTRAP_TTL: 5 * 60 * 1000,

  // ---- Supabase 읽기 미러 (D-032). 공개 데이터만 올라간다 ----
  // 🔴 SUPABASE_URL 을 비우면 **즉시 예전 동작(GAS 경로)으로 돌아간다.**
  //    되돌리는 방법이 이 한 줄이라는 점이 이 구조의 전제다.
  // anon key 는 공개 전제의 키다. RLS 가 막으므로 정적 파일에 있어도 된다.
  SUPABASE_URL: 'https://zkxnyimfhyxyewozabka.supabase.co',
  // publishable 키. **공개를 전제로 한 키**라 이 저장소(공개)에 있어도 된다 —
  // app_cache 는 RLS 정책(select 만)과 테이블 권한(grant select)으로 두 겹으로 막혀 있고,
  // 올라가는 것도 bootstrap_() 의 공개 데이터뿐이다(명단·연락처는 들어가지 않는다).
  // 🔴 `sb_secret_…`(service_role)는 **절대 여기 넣지 않는다.** RLS·GRANT 를 모두
  //   우회하는 전권 키다. 그 키는 GAS 스크립트 속성에만 둔다.
  SUPABASE_ANON_KEY: 'sb_publishable_FUADV8bojaFvFlr_D4RILA_vpB-jLpC',
  // 미러가 이보다 낡았으면 **버리고 GAS 로 간다.** 하루 1회 갱신 + 시차 여유.
  // 미러가 멈춘 채 낡은 값을 조용히 주는 것이 정지보다 나쁘다.
  MIRROR_MAX_AGE: 26 * 60 * 60 * 1000,
  // 진행 사본의 신선도 기준 (D-042). 주기 동기화가 **모든 행**을 다시 쓰므로,
  // 가장 새로운 행의 시각이 곧 동기화의 심박이다. 평소(하루 1회)에도 통과하도록
  // bootstrap 과 같은 기준을 쓴다. 캠프 모드(10분)면 실제 지연은 10분 이내다.
  MIRROR_PROGRESS_MAX_AGE: 26 * 60 * 60 * 1000,
  MIRROR_TIMEOUT: 2500
};
