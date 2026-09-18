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

  // bootstrap 캐시 유지 시간(ms). 공지·타임라인이 자주 바뀌지 않으므로 짧게만 잡는다.
  BOOTSTRAP_TTL: 5 * 60 * 1000,

  // ---- Supabase 읽기 미러 (D-032). 공개 데이터만 올라간다 ----
  // 🔴 SUPABASE_URL 을 비우면 **즉시 예전 동작(GAS 경로)으로 돌아간다.**
  //    되돌리는 방법이 이 한 줄이라는 점이 이 구조의 전제다.
  // anon key 는 공개 전제의 키다. RLS 가 막으므로 정적 파일에 있어도 된다.
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  // 미러가 이보다 낡았으면 **버리고 GAS 로 간다.** 하루 1회 갱신 + 시차 여유.
  // 미러가 멈춘 채 낡은 값을 조용히 주는 것이 정지보다 나쁘다.
  MIRROR_MAX_AGE: 26 * 60 * 60 * 1000,
  MIRROR_TIMEOUT: 2500
};
