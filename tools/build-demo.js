#!/usr/bin/env node
/**
 * ────────────────────────────────────────────────────────────────
 * build-demo.js · v15 · 2026-09-26
 * ────────────────────────────────────────────────────────────────
 * 변경 이력 (최근 5건 — 전체는 docs-dev/spec/DECISIONS.md · git log)
 *  v15   2026-09-26  파일 버전 표시 시작
 *  v14   2026-09-22  공지를 운영콘솔에서 쓴다
 *  v12   2026-09-22  반려된 일지를 다시 낼 수 있게 + 운영콘솔 편의 네 가지
 *  —     2026-09-17  회차 활성/비활성 스위치 + 관리자 콘솔 회차 필터
 *  —     2026-09-17  demo.html 을 생성기로 다시 만들어 드리프트 제거
 *
 * 버전: vN = GAS 배포 번호. vN.k = 서버는 vN 그대로 두고 앱·도구만 고친 k번째.
 *       — 는 버전 기록을 시작하기 전(v12 이전)의 변경.
 * 🔴 이 파일을 고치면 맨 위 줄(이름·버전·날짜)과 이력을 함께 고친다 (CLAUDE.md).
 * ────────────────────────────────────────────────────────────────
 */

/**
 * build-demo.js — docs/demo.html 생성기
 *
 * 목적: GAS 배포 없이도 화면을 클릭해 볼 수 있는 단일 HTML 을 만든다.
 * 방식: 실제 앱 코드(css/api/ui/app/admin)를 **그대로** 인라인하고,
 *       fetch 만 가로채 가짜 백엔드에 물린다. 화면 로직을 복제하지 않으므로
 *       앱을 고치면 이 파일을 다시 만들기만 하면 데모도 같이 최신이 된다.
 *
 * 실행: node tools/build-demo.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const read = (p) => fs.readFileSync(path.join(DOCS, p), 'utf8');

/**
 * 앱 스크립트는 끝에서 DOMContentLoaded 에 init 을 건다.
 * 데모는 한 페이지에 참가자 앱과 운영 콘솔을 모두 싣고 하나만 띄우므로,
 * 자동 실행 대신 레지스트리에 등록만 하도록 그 한 줄을 바꾼다.
 */
function deferInit(src, key) {
  const line = "document.addEventListener('DOMContentLoaded', init);";
  if (!src.includes(line)) {
    throw new Error(`init 등록 줄을 찾지 못했습니다 (${key}). build-demo.js 를 함께 고쳐 주세요.`);
  }
  return src.replace(line, `window.__DEMO_APPS['${key}'] = init;`);
}

const css = read('assets/css/app.css');
const apiJs = read('assets/js/api.js');
const uiJs = read('assets/js/ui.js');
const appJs = deferInit(read('assets/js/app.js'), 'participant');
const adminJs = deferInit(read('assets/js/admin.js'), 'admin');
const markSvg = read('assets/img/mark.svg');
const faviconSvg = read('assets/img/favicon.svg');

const dataUri = (svg) => 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');

const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#984534">
<meta name="robots" content="noindex, nofollow">
<title>정동, 신앙탐험대</title>

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@400;700&family=Noto+Sans+KR:wght@400;500;700&display=swap">
<link rel="icon" href="${dataUri(faviconSvg)}" type="image/svg+xml">

<style>
${css}
</style>

<style>
/* ---- 데모 전용 UI. 실제 앱에는 없는 부분입니다. ---- */
.demobar {
  position: fixed; left: 0; right: 0; top: 0; z-index: 90;
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
  padding: 8px 12px;
  background: #2c2320; color: #fff;
  font-size: 12px; line-height: 1.4;
}
.demobar__tag {
  padding: 2px 8px; border-radius: 999px;
  background: rgba(255,255,255,.16); font-weight: 700; letter-spacing: .04em;
}
.demobar__label { opacity: .7; margin-left: 4px; }
.demobar__group { display: flex; gap: 4px; }
.demobar button {
  padding: 5px 10px; border: 1px solid rgba(255,255,255,.28); border-radius: 999px;
  background: none; color: #fff; font-family: inherit; font-size: 12px; cursor: pointer;
}
.demobar button.is-on { background: #984534; border-color: #984534; font-weight: 700; }
.demobar__note { flex-basis: 100%; opacity: .62; font-size: 11px; }
body { padding-top: var(--demobar-h, 76px); }
.appbar { top: var(--demobar-h, 76px); }
@media (max-width: 520px) { .demobar { font-size: 11px; } }
</style>
</head>
<body>

<div class="demobar" id="demobar">
  <span class="demobar__tag">DEMO</span>
  <span class="demobar__group">
    <button type="button" data-mode="participant">참가자 앱</button>
    <button type="button" data-mode="admin">운영 콘솔</button>
  </span>
  <span class="demobar__label">로그인 계정</span>
  <span class="demobar__group" id="personaGroup">
    <button type="button" data-persona="leader">조장</button>
    <button type="button" data-persona="member">일반 참가자</button>
    <button type="button" data-persona="staff">스태프</button>
    <button type="button" data-persona="pastor">교역자</button>
  </span>
  <p class="demobar__note" id="demoNote"></p>
</div>

<header class="appbar">
  <div class="appbar__inner">
    <img class="appbar__mark" src="${dataUri(markSvg)}" alt="" aria-hidden="true">
    <div>
      <p class="appbar__sub" id="brandSub">PLC 성경적세계관 캠프</p>
      <h1 class="appbar__title" id="brandTitle">정동, 신앙탐험대</h1>
    </div>
  </div>
  <p class="ticker" id="ticker" hidden></p>
</header>

<main id="view" class="view">
  <p class="loading">불러오는 중…</p>
</main>

<nav class="tabbar" id="tabbar" hidden aria-label="주 메뉴"></nav>

<div id="toast" class="toast" role="status" aria-live="polite"></div>

<script>
/* ============================================================
   가짜 백엔드 — GAS /exec 응답을 흉내 낸다.
   실제 배포에서는 이 블록이 없고 진짜 서버가 같은 모양으로 응답한다.
   ============================================================ */
(function () {
  'use strict';

  var API = 'https://demo.invalid/exec';
  window.__DEMO_API = API;
  window.__DEMO_APPS = {};

  var LABELS = {
    audience: '캠프 대상', session: '참여 일자', name: '이름',
    gender: '성별', age: '나이', phone: '연락처',
    feeAmount: '회비 대상(2만/3만)', feeStatus: '입금 여부',
    group: '조 배정', role: '역할', insurance: '여행자 보험 가입',
    course: '배정 코스', note: '비고'
  };

  var CONFIG = {
    CAMP_NAME: '정동, 신앙탐험대',
    CAMP_SUBTITLE: 'PLC 성경적세계관 캠프',
    GALLERY_SCOPE: 'ALL',
    JOURNAL_REQUIRE_APPROVAL: true,
    JOURNAL_OPEN: true,
    PROGRESS_OPEN: true,
    SHOW_FEE: true,
    NOTICE_TICKER: '09:30까지 PL교회 본당 앞으로 모여 주세요'
  };

  // 회차는 Config 가 정한다(D-026). 세 번째는 **비활성**이라 관리자 필터에
  // '비활성' 으로 뜨고 그 회차 참가자는 로그인할 수 없다(D-031).
  var SESSIONS = [
    { n: 1, label: '10/31(토)', date: '2026-10-31', active: true },
    { n: 2, label: '11/07(토)', date: '2026-11-07', active: true },
    { n: 3, label: '사전답사(10/11)', date: '2026-10-11', active: false }
  ];

  var CHECKPOINTS = [
    { code: 'CP1', order: 1, name: '배재학당역사박물관',
      summary: '아펜젤러가 세운 한국 최초의 근대식 중등교육기관',
      description: '1885년 아펜젤러가 시작한 배재학당의 자리입니다. 근대 교육과 선교가 어떻게 함께 시작되었는지 확인합니다.',
      mission: '배재학당의 설립 연도와 교훈을 찾아 적어 보세요.',
      quizUrl: 'https://smore.im/', photoUrl: '', openHours: '10:00–17:00, 월요일 휴관',
      lat: null, lng: null },
    { code: 'CP2', order: 2, name: '러시아 공사관과 킹스로드',
      summary: '아관파천의 현장과 고종이 걸었던 길',
      description: '구 러시아공사관 탑과 덕수궁으로 이어지는 길입니다. 격동기 조선의 정세와 그 속의 신앙 공동체를 봅니다.',
      mission: '공사관 건물에서 지금 남아 있는 부분은 어디까지인지 확인해 보세요.',
      quizUrl: '', photoUrl: '', openHours: '상시 개방', lat: null, lng: null },
    { code: 'CP3', order: 3, name: '보구여관 터',
      summary: '한국 최초의 여성 전용 병원이 있던 자리',
      description: '1887년 스크랜턴이 세운 여성 전용 병원입니다. 의료 선교가 여성의 삶을 어떻게 바꾸었는지 살펴봅니다.',
      mission: '보구여관이라는 이름의 뜻을 찾아보세요.',
      quizUrl: '', photoUrl: '', openHours: '', lat: null, lng: null },
    { code: 'CP4', order: 4, name: '이화여고 박물관',
      summary: '이화학당에서 시작된 한국 여성 교육의 출발점',
      description: '메리 스크랜턴이 학생 한 명으로 시작한 이화학당입니다. 심슨기념관에 남은 흔적을 따라갑니다.',
      mission: '이화학당의 첫 학생 이름을 찾아보세요.',
      quizUrl: 'https://smore.im/', photoUrl: '', openHours: '10:00–16:00', lat: null, lng: null }
  ];

  var TIMELINE = {
    '10/31(토)': [
      { start: '09:30', end: '09:50', title: '도착 · 등록 · 조편성 확인', place: 'PL교회', note: '명찰/조 배정표 배부' },
      { start: '09:50', end: '10:20', title: '오프닝 (OT + 찬양)', place: 'PL교회', note: '전체 모임' },
      { start: '10:20', end: '11:10', title: '강의 1챕터', place: 'PL교회', note: '' },
      { start: '11:10', end: '11:20', title: '쉬는 시간', place: '', note: '' },
      { start: '11:20', end: '12:10', title: '강의 2챕터', place: 'PL교회', note: '' },
      { start: '12:10', end: '12:40', title: '조별 나눔', place: 'PL교회', note: '나눔 질문지 활용' },
      { start: '12:40', end: '13:30', title: '점심식사', place: 'PL교회 인근', note: '조별 이동/식사' },
      { start: '13:30', end: '14:00', title: '이동 (노량진역 → 시청역)', place: '지하철 1호선', note: '약 30분' },
      { start: '14:00', end: '16:10', title: '정동 답사', place: '정동 일대', note: '조별 배정 코스 순서대로' },
      { start: '16:25', end: '17:00', title: '마무리 모임 — 소감 나눔', place: '인근 카페', note: '' }
    ],
    '11/07(토)': [
      { start: '13:00', end: '13:30', title: '당일 세부일정 OT', place: 'PL교회', note: '등록 & 이름표 배부' },
      { start: '13:30', end: '14:00', title: '이동 (노량진역 → 시청역)', place: '지하철 1호선', note: '약 30분' },
      { start: '14:00', end: '16:10', title: '정동 답사', place: '정동 일대', note: '조별 배정 코스 순서대로' },
      { start: '16:25', end: '17:00', title: '마무리 모임 — 소감 나눔', place: '인근 카페', note: '' }
    ]
  };

  var NOTICES = [
    { id: 'N1', target: '전체', title: '점심 도시락 안내', pinned: true,
      body: '도시락은 조별로 한 번에 받습니다. 조장이 인원수를 확인해 주세요.', publishedAt: '2026-10-20T09:00:00+09:00' },
    { id: 'N2', target: '10/31(토)', title: '교통카드 지참', pinned: false,
      body: '지하철 이동이 있습니다. 교통카드를 꼭 챙겨 주세요.', publishedAt: '2026-10-19T09:00:00+09:00' }
  ];

  // ---- 사람 / 조 -------------------------------------------------------
  var PEOPLE = {
    leader: {
      participant: { id: 'P0002', name: '김캠티', audience: '청년부', session: '10/31(토)',
                     role: '조장', group: '1조', feeStatus: '완납', insurance: '가입완료' },
      team: { session: '10/31(토)', group: '1조', name: '1조 배재', color: '#984534',
              leaderName: '김캠티', meetingPoint: 'PL교회 본당 앞',
              course: 'C코스(보구여관 시작)', route: ['CP3', 'CP4', 'CP1', 'CP2'] },
      isLeader: true, isAdmin: false,
      members: [
        { id: 'P0002', name: '김캠티', role: '조장', feeStatus: '완납', insurance: '가입완료' },
        { id: 'P0001', name: '이승천', role: '일반', feeStatus: '미납', insurance: '미가입' },
        { id: 'P0007', name: '한지민', role: '일반', feeStatus: '완납', insurance: '가입완료' },
        { id: 'P0008', name: '오세훈', role: '일반', feeStatus: '완납', insurance: '가입완료' }
      ]
    },
    member: {
      participant: { id: 'P0001', name: '이승천', audience: '청년부', session: '10/31(토)',
                     role: '일반', group: '1조', feeStatus: '미납', insurance: '미가입' },
      team: { session: '10/31(토)', group: '1조', name: '1조 배재', color: '#984534',
              leaderName: '김캠티', meetingPoint: 'PL교회 본당 앞',
              course: 'C코스(보구여관 시작)', route: ['CP3', 'CP4', 'CP1', 'CP2'] },
      isLeader: false, isAdmin: false,
      members: []
    },
    // 거점 스태프 — 조 없이 담당 지점만 (D-051)
    staff: {
      participant: { id: 'P0031', name: '정스태', audience: '', session: '10/31(토)',
                     role: '스태프', group: '', feeStatus: '면제', insurance: '가입완료' },
      team: null, mode: 'station', station: { code: 'CP1', name: '배재학당역사박물관' },
      isLeader: false, isAdmin: false, members: []
    },
    // 교역자 — 조 없이 전체 진행을 읽기만 (D-051)
    pastor: {
      participant: { id: 'P0041', name: '최교역', audience: '', session: '10/31(토)',
                     role: '교역자', group: '', feeStatus: '면제', insurance: '가입완료' },
      team: null, mode: 'ops', station: null,
      isLeader: false, isAdmin: false, members: []
    }
  };
  PEOPLE.leader.mode = 'leader';
  PEOPLE.member.mode = 'member';

  function persona() {
    try { return sessionStorage.getItem('demo_persona') || 'leader'; } catch (e) { return 'leader'; }
  }
  function me() { return PEOPLE[persona()] || PEOPLE.leader; }

  // ---- 가변 상태 -------------------------------------------------------
  //
  // 🔴 진행은 **조별 칸 한 벌**에 둔다. 조장 코스·스태프 지점·교역자 진행·콘솔이 모두 여기서
  //    읽고 쓴다 — 화면마다 따로 두면 데모에서 서로 다른 말을 한다.
  var TEAMS = [
    { session: '10/31(토)', group: '1조', audience: '청년부', name: '1조 배재', leaderName: '김캠티', memberCount: 4,
      course: 'C코스(보구여관 시작)', route: ['CP3', 'CP4', 'CP1', 'CP2'],
      cells: {
        CP3: { status: '완료', arrivedAt: '2026-10-31T14:00:00+09:00', completedAt: '2026-10-31T14:24:00+09:00', score: 9, scoreSource: '스태프' },
        CP4: { status: '도착', arrivedAt: '2026-10-31T14:36:00+09:00', completedAt: '', score: null, scoreSource: '' }
      } },
    { session: '10/31(토)', group: '2조', audience: '청년부', name: '2조 정동', leaderName: '윤지한', memberCount: 5,
      course: 'A코스(배재 시작)', route: ['CP1', 'CP2', 'CP3', 'CP4'],
      cells: {
        CP1: { status: '완료', arrivedAt: '2026-10-31T14:02:00+09:00', completedAt: '2026-10-31T14:26:00+09:00', score: 10, scoreSource: '스태프' },
        CP2: { status: '완료', arrivedAt: '2026-10-31T14:38:00+09:00', completedAt: '2026-10-31T15:00:00+09:00', score: 8, scoreSource: '조장' },
        CP3: { status: '도착', arrivedAt: '2026-10-31T15:12:00+09:00', completedAt: '', score: null, scoreSource: '' }
      } },
    { session: '10/31(토)', group: '3조', audience: '청년부', name: '3조 이화', leaderName: '박민수', memberCount: 5,
      course: 'B코스(러시아 시작)', route: ['CP2', 'CP3', 'CP4', 'CP1'],
      cells: {
        CP2: { status: '완료', arrivedAt: '2026-10-31T14:05:00+09:00', completedAt: '2026-10-31T14:30:00+09:00', score: 7, scoreSource: '스태프' },
        CP3: { status: '완료', arrivedAt: '2026-10-31T14:38:00+09:00', completedAt: '2026-10-31T14:58:00+09:00', score: 9, scoreSource: '스태프' },
        CP4: { status: '완료', arrivedAt: '2026-10-31T15:03:00+09:00', completedAt: '2026-10-31T15:20:00+09:00', score: 8, scoreSource: '스태프' }
      } },
    { session: '10/31(토)', group: '4조', audience: '청년부', name: '4조 정동길', leaderName: '서하준', memberCount: 4,
      course: 'A코스(배재 시작)', route: ['CP1', 'CP2', 'CP3', 'CP4'],
      cells: {
        CP1: { status: '완료', arrivedAt: '2026-10-31T13:40:00+09:00', completedAt: '2026-10-31T14:00:00+09:00', score: 9, scoreSource: '스태프' },
        CP2: { status: '완료', arrivedAt: '2026-10-31T14:08:00+09:00', completedAt: '2026-10-31T14:28:00+09:00', score: 10, scoreSource: '스태프' },
        CP3: { status: '완료', arrivedAt: '2026-10-31T14:36:00+09:00', completedAt: '2026-10-31T14:56:00+09:00', score: 8, scoreSource: '조장' },
        CP4: { status: '완료', arrivedAt: '2026-10-31T15:00:00+09:00', completedAt: '2026-10-31T15:18:00+09:00', score: 9, scoreSource: '스태프' }
      } },
    { session: '11/07(토)', group: '1조', audience: '장년부', name: '1조', leaderName: '이휘영', memberCount: 6,
      course: 'A코스(배재 시작)', route: ['CP1', 'CP2', 'CP3', 'CP4'], cells: {} }
  ];
  var MY_TEAM = TEAMS[0];

  function listFor(t) {
    return t.route.map(function (code, i) {
      var c = t.cells[code] || {};
      return { checkpoint: code, visitOrder: i + 1, status: c.status || '대기',
               arrivedAt: c.arrivedAt || '', completedAt: c.completedAt || '',
               score: c.score === undefined ? null : c.score, scoreSource: c.scoreSource || '', memo: '' };
    });
  }

  /** 서버 writeProgress_ 와 같은 규칙 — 최초 시각만, 대기는 비움, 스태프 점수 우선 (D-052). */
  function writeCell(t, code, it, actor) {
    var c = t.cells[code] || (t.cells[code] = { status: '대기', arrivedAt: '', completedAt: '', score: null, scoreSource: '' });
    // 기기 시각(서울)으로 찍는다 — 고정 문자열이면 화면의 "N분 전" 이 미래가 된다
    var now = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 19) + '+09:00';
    if (it.status) {
      c.status = it.status;
      if (it.status === '대기') { c.arrivedAt = ''; c.completedAt = ''; }
      else {
        if (!c.arrivedAt) c.arrivedAt = now;
        if (it.status === '완료' && !c.completedAt) c.completedAt = now;
      }
    }
    if (it.score !== undefined && !(actor === '조장' && c.scoreSource === '스태프')) {
      c.score = it.score === '' || it.score === null ? null : Number(it.score);
      c.scoreSource = c.score === null ? '' : actor;
    }
  }

  function boardData() {
    return { checkpoints: CHECKPOINTS.map(function (c) { return { code: c.code, name: c.name }; }), teams: TEAMS };
  }

  function stationBoard() {
    var st = me().station;
    var cp = CHECKPOINTS.filter(function (c) { return c.code === st.code; })[0];
    var nameOf = {};
    CHECKPOINTS.forEach(function (c) { nameOf[c.code] = c.name; });
    var teams = TEAMS.filter(function (t) { return t.session === me().participant.session && t.route.indexOf(st.code) >= 0; })
      .map(function (t) {
        var i = t.route.indexOf(st.code), c = t.cells[st.code] || {}, prev = i > 0 ? t.route[i - 1] : '';
        return { group: t.group, name: t.name, leaderName: t.leaderName, memberCount: t.memberCount,
                 visitOrder: i + 1, prevName: prev ? nameOf[prev] : '', prevStatus: prev ? ((t.cells[prev] || {}).status || '대기') : '',
                 status: c.status || '대기', arrivedAt: c.arrivedAt || '', completedAt: c.completedAt || '',
                 score: c.score === undefined ? null : c.score, scoreSource: c.scoreSource || '' };
      })
      .sort(function (a, b) { return (a.visitOrder - b.visitOrder) || (parseInt(a.group, 10) - parseInt(b.group, 10)); });
    return { session: me().participant.session,
             checkpoint: { code: cp.code, name: cp.name, mission: cp.mission, quizUrl: cp.quizUrl }, teams: teams };
  }

  var seq = 100;

  /** 데모용 사진 — 색 바탕에 글자 한 줄. 외부 요청 없이 보인다. */
  function PH(bg, label) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">' +
      '<rect width="400" height="300" fill="' + bg + '"/>' +
      '<text x="200" y="160" font-size="28" text-anchor="middle" fill="#fff" font-family="sans-serif">' + label + '</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  var journals = [
    { id: 'J0001', session: '10/31(토)', group: '1조', authorId: 'P0007', authorName: '한지민',
      checkpoint: 'CP3', text: '보구여관 터 표석 앞에서. 병원이 있던 자리라는 걸 안내판을 보고서야 알았다.\\n이름의 뜻이 "여성을 널리 구제한다"라는 게 오래 남는다.',
      photoUrl: PH('#984534', '보구여관 터 표석'), status: '승인', rejectReason: '',
      createdAt: '2026-10-31T14:20:00+09:00', updatedAt: '' },
    { id: 'J0002', session: '10/31(토)', group: '1조', authorId: 'P0008', authorName: '오세훈',
      checkpoint: 'CP4', text: '심슨기념관 계단. 학생 한 명으로 시작했다는 이야기가 계속 맴돈다.',
      photoUrl: '', status: '승인', rejectReason: '',
      createdAt: '2026-10-31T14:52:00+09:00', updatedAt: '' },
    { id: 'J0003', session: '10/31(토)', group: '2조', authorId: 'P0011', authorName: '박서준',
      checkpoint: 'CP1', text: '배재학당 교훈을 찾았다. 欲爲大者 當爲人役 — 크고자 하거든 남을 섬기라.',
      photoUrl: PH('#3f7d5a', '배재학당 교훈'), status: '승인', rejectReason: '',
      createdAt: '2026-10-31T14:05:00+09:00', updatedAt: '' },
    { id: 'J0004', session: '10/31(토)', group: '3조', authorId: 'P0015', authorName: '최유나',
      checkpoint: 'CP2', text: '킹스로드를 걸으며. 고종이 걸었던 길이라는 게 실감이 안 난다.',
      photoUrl: PH('#6b5d57', '킹스로드'), status: '대기', rejectReason: '',
      createdAt: '2026-10-31T15:10:00+09:00', updatedAt: '' },
    { id: 'J0005', session: '10/31(토)', group: '4조', authorId: 'P0021', authorName: '서하준',
      checkpoint: 'CP4', text: '넷이 다 같이 완주! 심슨기념관 앞에서.',
      photoUrl: PH('#b8863b', '4조 완주'), status: '승인', rejectReason: '',
      createdAt: '2026-10-31T15:22:00+09:00', updatedAt: '' },
    { id: 'J0006', session: '10/31(토)', group: '2조', authorId: 'P0012', authorName: '정하늘',
      checkpoint: 'CP2', text: '러시아 공사관 탑. 생각보다 작았다.',
      photoUrl: PH('#7a3729', '공사관 탑'), status: '대기', rejectReason: '',
      createdAt: '2026-10-31T15:20:00+09:00', updatedAt: '' }
  ];

  function decorate(j) {
    var m = me();
    var mine = j.authorId === m.participant.id;
    var sameTeam = j.session === m.participant.session && j.group === m.participant.group;
    return Object.assign({}, j, {
      isMine: mine,
      canEdit: mine || (m.isLeader && sameTeam)
    });
  }

  function galleryList() {
    var m = me();
    return journals
      .filter(function (j) { return j.status !== '삭제'; })
      .filter(function (j) { return j.status === '승인' || j.authorId === m.participant.id; })
      .filter(function (j) { return j.session === m.participant.session; })
      .map(decorate);
  }

  // ---- 라우팅 ----------------------------------------------------------
  function handle(body) {
    switch (body.action) {
      case 'bootstrap':
        return { config: CONFIG, labels: LABELS, sessions: SESSIONS, checkpoints: CHECKPOINTS,
                 notices: NOTICES, timeline: TIMELINE, serverTime: '2026-10-31T14:40:00+09:00' };

      case 'auth.login': {
        var m = me();
        if (String(body.phoneLast4 || '').length !== 4) {
          return { __error: { code: 'BAD_REQUEST', message: '연락처 뒷 4자리를 입력해 주세요.' } };
        }
        return { token: 'demo-token', expiresAt: '',
                 me: Object.assign({}, m, { sessionCorrected: false }) };
      }

      case 'me': return Object.assign({}, me(), { isAdmin: false });

      case 'progress.list':
        if (!me().team) return { __error: { code: 'NOT_FOUND', message: '배정된 조가 없습니다.' } };
        return listFor(MY_TEAM);

      // 🔴 앱은 **묶음**(items)으로 보낸다(D-045). 예전 데모는 단건만 받아 조장 버튼이 되돌아갔다.
      case 'progress.set': {
        if (!me().isLeader) return { __error: { code: 'FORBIDDEN', message: '조장만 기록할 수 있습니다.' } };
        (Array.isArray(body.items) ? body.items : [body]).forEach(function (it) {
          writeCell(MY_TEAM, it.checkpoint, it, '조장');
        });
        return listFor(MY_TEAM);
      }

      case 'station.board':
        if (me().mode !== 'station') return { __error: { code: 'FORBIDDEN', message: '담당 지점이 있는 스태프만 쓸 수 있습니다.' } };
        return stationBoard();

      case 'station.set': {
        if (me().mode !== 'station') return { __error: { code: 'FORBIDDEN', message: '담당 지점이 있는 스태프만 쓸 수 있습니다.' } };
        var sess = me().participant.session, code = me().station.code;
        var bad = null;
        (body.items || []).forEach(function (it) {
          var t = TEAMS.filter(function (x) { return x.session === sess && x.group === it.group; })[0];
          if (!t || t.route.indexOf(code) < 0) { bad = it.group; return; }
          writeCell(t, code, it, '스태프');
        });
        if (bad) return { __error: { code: 'FORBIDDEN', message: bad + ' 은(는) 이 지점을 지나는 조가 아닙니다.' } };
        return stationBoard();
      }

      case 'ops.board': {
        if (me().mode !== 'ops' && me().mode !== 'station') return { __error: { code: 'FORBIDDEN', message: '교역자·스태프만 볼 수 있습니다.' } };
        var s0 = me().participant.session;
        return { session: s0, checkpoints: boardData().checkpoints,
                 teams: TEAMS.filter(function (t) { return t.session === s0; }) };
      }

      case 'journal.list': {
        var m2 = me();
        var items;
        if (body.scope === 'mine') {
          items = journals.filter(function (j) { return j.authorId === m2.participant.id && j.status !== '삭제'; }).map(decorate);
        } else if (body.scope === 'team') {
          if (!m2.isLeader) return { __error: { code: 'FORBIDDEN', message: '조장만 볼 수 있습니다.' } };
          items = journals.filter(function (j) {
            return j.group === m2.participant.group && j.session === m2.participant.session && j.status !== '삭제';
          }).map(decorate);
        } else {
          items = galleryList();
        }
        return { items: items, total: items.length, nextCursor: null,
                 galleryScope: CONFIG.GALLERY_SCOPE, requiresApproval: CONFIG.JOURNAL_REQUIRE_APPROVAL };
      }

      case 'journal.create': {
        var m3 = me();
        if (!body.text && !body.photo) {
          return { __error: { code: 'BAD_REQUEST', message: '소감이나 사진 중 하나는 있어야 합니다.' } };
        }
        var created = {
          id: 'J' + (++seq), session: m3.participant.session, group: m3.participant.group,
          authorId: m3.participant.id, authorName: m3.participant.name,
          checkpoint: body.checkpoint || '', text: body.text || '',
          photoUrl: body.photo ? ('data:' + body.photo.mimeType + ';base64,' + body.photo.dataBase64) : '',
          status: CONFIG.JOURNAL_REQUIRE_APPROVAL ? '대기' : '승인', rejectReason: '',
          createdAt: '2026-10-31T15:30:00+09:00', updatedAt: ''
        };
        journals = [created].concat(journals);
        return decorate(created);
      }

      case 'journal.update': {
        var target = journals.filter(function (j) { return j.id === body.id; })[0];
        if (!target) return { __error: { code: 'NOT_FOUND', message: '해당 일지를 찾을 수 없습니다.' } };
        if (!decorate(target).canEdit) {
          return { __error: { code: 'FORBIDDEN', message: '본인 또는 조장, 관리자만 수정할 수 있습니다.' } };
        }
        if (body.text !== undefined) target.text = body.text;
        if (body.checkpoint !== undefined) target.checkpoint = body.checkpoint;
        if (body.removePhoto) target.photoUrl = '';
        if (body.photo) target.photoUrl = 'data:' + body.photo.mimeType + ';base64,' + body.photo.dataBase64;
        if (!target.text && !target.photoUrl) {
          return { __error: { code: 'BAD_REQUEST', message: '소감이나 사진 중 하나는 남겨야 합니다.' } };
        }
        if (CONFIG.JOURNAL_REQUIRE_APPROVAL && target.status === '승인') target.status = '대기';
        return decorate(target);
      }

      case 'journal.delete':
        journals = journals.filter(function (j) { return j.id !== body.id; });
        return { id: body.id, status: '삭제' };

      case 'fee.status': {
        var m4 = me();
        return { me: { status: m4.participant.feeStatus }, members: m4.isLeader
          ? m4.members.map(function (x) { return { id: x.id, name: x.name, status: x.feeStatus }; })
          : [] };
      }

      // ---- 관리자 --------------------------------------------------------
      case 'admin.login':
        if (String(body.pin) !== '000000') {
          return { __error: { code: 'UNAUTHORIZED', message: 'PIN 이 올바르지 않습니다. (데모 PIN: 000000)' } };
        }
        return { token: 'demo-admin-token', expiresAt: '', isAdmin: true };

      case 'admin.journal.pending': {
        var pending = journals.filter(function (j) { return j.status === '대기'; })
          .map(function (j) { return Object.assign({}, j, { isMine: false, canEdit: true }); });
        return { items: pending, total: pending.length };
      }

      // 운영콘솔은 전체 목록을 한 번 받아 두고, 상태 거르기는 앱이 한다 (D-046).
      case 'admin.journal.list': {
        var all = journals.filter(function (j) { return j.status !== '삭제'; })
          .slice()
          .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); })
          .map(function (j) { return Object.assign({}, j, { isMine: false, canEdit: true }); });
        return { items: all, total: all.length };
      }

      case 'admin.journal.review': {
        var t2 = journals.filter(function (j) { return j.id === body.id; })[0];
        if (!t2) return { __error: { code: 'NOT_FOUND', message: '찾을 수 없습니다.' } };
        t2.status = body.decision;
        t2.rejectReason = body.decision === '반려' ? (body.reason || '') : '';
        return Object.assign({}, t2, { isMine: false, canEdit: true });
      }

      case 'admin.journal.delete':
        journals = journals.filter(function (j) { return j.id !== body.id; });
        return { id: body.id, status: '삭제' };

      // 공지 관리 (D-048). 이미 있는 NOTICES 배열을 원장으로 쓴다.
      case 'admin.notice.list': {
        var nlist = NOTICES.map(function (n) {
          return Object.assign({ endsAt: '', status: '게시중' }, n);
        });
        return { items: nlist, total: nlist.length,
                 targets: ['전체', '청년부', '장년부'].concat(SESSIONS.map(function (s) { return s.label; })) };
      }

      case 'admin.notice.save': {
        var saved;
        if (body.id) {
          saved = NOTICES.filter(function (n) { return n.id === body.id; })[0];
          if (!saved) return { __error: { code: 'NOT_FOUND', message: '찾을 수 없습니다.' } };
        } else {
          saved = { id: 'N' + (++seq), publishedAt: '2026-10-24T15:30:00+09:00' };
          NOTICES.unshift(saved);
        }
        saved.target = body.target || '전체';
        saved.title = body.title || '';
        saved.body = body.body || '';
        saved.pinned = !!body.pinned;
        saved.endsAt = body.endsAt || '';
        if (!saved.title && !saved.body) {
          return { __error: { code: 'BAD_REQUEST', message: '제목이나 내용 중 하나는 있어야 합니다.' } };
        }
        return Object.assign({ status: '게시중' }, saved);
      }

      case 'admin.notice.delete': {
        var before = NOTICES.length;
        NOTICES = NOTICES.filter(function (n) { return n.id !== body.id; });
        if (NOTICES.length === before) {
          return { __error: { code: 'NOT_FOUND', message: '찾을 수 없습니다.' } };
        }
        return { id: body.id };
      }

      case 'admin.progress.board':
        return boardData();

      case 'admin.progress.set': {
        var tt = TEAMS.filter(function (x) { return x.session === body.session && x.group === body.group; })[0];
        if (!tt) return { __error: { code: 'NOT_FOUND', message: '명단에 없는 조입니다.' } };
        writeCell(tt, body.checkpoint, body, '관리자');
        return boardData();
      }

      case 'admin.journal.reviewBatch': {
        var ok2 = [], skip = [];
        (body.ids || []).forEach(function (id) {
          var j = journals.filter(function (x) { return x.id === id; })[0];
          if (!j || j.status !== '대기') { skip.push(id); return; }
          j.status = '승인'; j.rejectReason = ''; ok2.push(id);
        });
        return { approved: ok2, skipped: skip };
      }

      case 'admin.journal.award': {
        var ja = journals.filter(function (x) { return x.id === body.id; })[0];
        if (!ja) return { __error: { code: 'NOT_FOUND', message: '찾을 수 없습니다.' } };
        if (body.award && (ja.status !== '승인' || !ja.photoUrl)) {
          return { __error: { code: 'BAD_REQUEST', message: '승인된 사진 글만 수상작으로 지정할 수 있습니다.' } };
        }
        ja.award = !!body.award;
        return Object.assign({}, ja, { isMine: false, canEdit: true });
      }

      case 'admin.fee.board':
        return {
          summary: { 완납: 14, 미납: 4, 면제: 1, 합계: 19, 예상수입: 460000, 수납액: 340000 },
          teams: [
            { label: '10/31(토) 1조', session: '10/31(토)', group: '1조', audience: '청년부', 완납: 3, 미납: 1, 면제: 0, 미가입: 1, unpaid: ['이승천'] },
            { label: '10/31(토) 2조', session: '10/31(토)', group: '2조', audience: '청년부', 완납: 4, 미납: 1, 면제: 0, 미가입: 0, unpaid: ['정하늘'] },
            { label: '10/31(토) 3조', session: '10/31(토)', group: '3조', audience: '청년부', 완납: 4, 미납: 1, 면제: 0, 미가입: 2, unpaid: ['강도현'] },
            { label: '11/07(토) 1조', session: '11/07(토)', group: '1조', audience: '장년부', 완납: 3, 미납: 1, 면제: 1, 미가입: 0, unpaid: ['서지우'] }
          ]
        };

      case 'admin.config.set':
        CONFIG[body.key] = body.value === 'TRUE' ? true : (body.value === 'FALSE' ? false : body.value);
        return {
          CAMP_NAME: CONFIG.CAMP_NAME, CAMP_SUBTITLE: CONFIG.CAMP_SUBTITLE,
          GALLERY_SCOPE: CONFIG.GALLERY_SCOPE, JOURNAL_REQUIRE_APPROVAL: CONFIG.JOURNAL_REQUIRE_APPROVAL,
          JOURNAL_OPEN: CONFIG.JOURNAL_OPEN, PROGRESS_OPEN: CONFIG.PROGRESS_OPEN,
          SHOW_FEE: CONFIG.SHOW_FEE, NOTICE_TICKER: CONFIG.NOTICE_TICKER
        };

      default:
        return { __error: { code: 'BAD_REQUEST', message: '알 수 없는 요청: ' + body.action } };
    }
  }

  window.__DEMO_CALLS = [];

  // fetch 만 가로챈다. 앱 코드는 손대지 않는다.
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (url, options) {
    if (String(url) !== API) {
      return realFetch ? realFetch(url, options) : Promise.reject(new Error('offline'));
    }
    var body = {};
    try { body = JSON.parse((options && options.body) || '{}'); } catch (e) { /* 무시 */ }
    window.__DEMO_CALLS.push(body.action);   // 데모에서 요청 수를 눈으로 셀 수 있게
    var data = handle(body);
    var payload = (data && data.__error) ? { ok: false, error: data.__error } : { ok: true, data: data };
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve({ ok: true, text: function () { return Promise.resolve(JSON.stringify(payload)); } });
      }, 160); // 실제 GAS 왕복 느낌을 살짝 흉내
    });
  };
})();
</script>

<script>
window.APP_CONFIG = {
  API_BASE: window.__DEMO_API,
  TOKEN_KEY: 'plc_jd_token',
  PHOTO_MAX_EDGE: 1600,
  PHOTO_QUALITY: 0.8,
  BOOTSTRAP_TTL: 1
};
</script>

<script>
${apiJs}
</script>
<script>
${uiJs}
</script>
<script>
${appJs}
</script>
<script>
${adminJs}
</script>

<script>
/* ---- 데모 셸: 모드/계정 전환 ---- */
(function () {
  'use strict';

  function get(key, fallback) {
    try { return sessionStorage.getItem(key) || fallback; } catch (e) { return fallback; }
  }
  function set(key, value) {
    try { sessionStorage.setItem(key, value); } catch (e) { /* 무시 */ }
  }

  var mode = get('demo_mode', 'participant');
  var who = get('demo_persona', 'leader');

  // 참가자 앱과 운영 콘솔은 토큰 저장 키가 다르다. 실제 앱과 동일하게 맞춘다.
  window.APP_CONFIG.TOKEN_KEY = (mode === 'admin') ? 'plc_jd_admin_token' : 'plc_jd_token';

  var bar = document.getElementById('demobar');
  var note = document.getElementById('demoNote');

  Array.prototype.forEach.call(bar.querySelectorAll('[data-mode]'), function (b) {
    b.classList.toggle('is-on', b.getAttribute('data-mode') === mode);
    b.addEventListener('click', function () {
      set('demo_mode', b.getAttribute('data-mode'));
      location.reload();
    });
  });

  Array.prototype.forEach.call(bar.querySelectorAll('[data-persona]'), function (b) {
    b.classList.toggle('is-on', b.getAttribute('data-persona') === who);
    b.addEventListener('click', function () {
      set('demo_persona', b.getAttribute('data-persona'));
      try { localStorage.removeItem('plc_jd_token'); } catch (e) { /* 무시 */ }
      location.reload();
    });
  });

  document.getElementById('personaGroup').hidden = (mode === 'admin');
  bar.querySelector('.demobar__label').hidden = (mode === 'admin');

  note.textContent = (mode === 'admin')
    ? '운영 콘솔 데모입니다. PIN 은 000000. 실제 데이터는 저장되지 않고 새로고침하면 초기화됩니다.'
    : '이름·연락처는 아무 값이나 넣어도 들어갑니다(뒷자리는 숫자 4자리). 실제 데이터는 저장되지 않습니다.';

  // 데모바 높이만큼 본문을 내린다(줄바꿈되는 경우까지 맞춘다).
  function syncBarHeight() {
    document.documentElement.style.setProperty('--demobar-h', bar.offsetHeight + 'px');
  }
  syncBarHeight();
  window.addEventListener('resize', syncBarHeight);

  // 탭바 구성은 모드마다 다르다.
  var tabs = (mode === 'admin')
    ? [['review', '✅', '일지 검수'], ['notice', '📢', '공지'], ['progress', '🧭', '진행 현황'],
       ['fee', '💳', '회비'], ['settings', '⚙️', '설정']]
    : [['home', '🏛', '홈'], ['course', '🧭', '코스'], ['journal', '📓', '탐험일지'], ['me', '👤', '내 정보']];

  document.getElementById('tabbar').innerHTML = tabs.map(function (t, i) {
    return '<button type="button" data-view="' + t[0] + '" class="tabbar__btn' + (i === 0 ? ' is-active' : '') + '">' +
      '<span class="tabbar__icon" aria-hidden="true">' + t[1] + '</span><span>' + t[2] + '</span></button>';
  }).join('');

  var init = window.__DEMO_APPS[mode];
  if (init) init();
})();
</script>

</body>
</html>
`;

const outPath = path.join(DOCS, 'demo.html');
fs.writeFileSync(outPath, html, 'utf8');
console.log('docs/demo.html 생성 완료 — ' + (Buffer.byteLength(html, 'utf8') / 1024).toFixed(0) + 'KB');
