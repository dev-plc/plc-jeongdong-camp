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
  BOOTSTRAP_TTL: 5 * 60 * 1000
};
