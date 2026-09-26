/**
 * ────────────────────────────────────────────────────────────────
 * app.js · v16 · 2026-09-26
 * ────────────────────────────────────────────────────────────────
 * 변경 이력 (최근 5건 — 전체는 docs-dev/spec/DECISIONS.md · git log)
 *  v16   2026-09-26  내 지점·진행 화면, 역할 카드, 조장 점수 칸 (D-051·052)
 *  v15.1 2026-09-26  홈 "지금·다음" 카드, 코스 다음 동작 버튼·접기 (D-050)
 *  v15   2026-09-26  파일 버전 표시 시작
 *  v12   2026-09-22  반려된 일지를 다시 낼 수 있게 + 운영콘솔 편의 네 가지
 *  —     2026-09-19  진행 기록을 묶어서 보낸다
 *
 * 버전: vN = GAS 배포 번호. vN.k = 서버는 vN 그대로 두고 앱·도구만 고친 k번째.
 *       — 는 버전 기록을 시작하기 전(v12 이전)의 변경.
 * 🔴 이 파일을 고치면 맨 위 줄(이름·버전·날짜)과 이력을 함께 고친다 (CLAUDE.md).
 * ────────────────────────────────────────────────────────────────
 */

/**
 * app.js — 참가자 앱 화면 로직
 *
 * 화면: 로그인 / 홈 / 코스 / 탐험일지 / 내정보
 * 서버 통신은 전부 API.* 를 거친다. 권한 판단은 서버가 최종이며,
 * 여기서 버튼을 숨기는 건 편의일 뿐 보안 경계가 아니다.
 */
(function () {
  'use strict';

  var $ = UI.$, esc = UI.esc, nl2br = UI.nl2br, toast = UI.toast;

  /**
   * 항목 이름은 서버가 내려주는 마스터시트 헤더를 그대로 쓴다.
   * 행정팀이 시트에서 부르는 이름과 앱 문구를 일치시키기 위해서다(bootstrap.labels).
   */
  function L(key, fallback) {
    var labels = (state.boot && state.boot.labels) || {};
    return labels[key] || fallback;
  }

  var state = {
    boot: null,          // bootstrap 응답 (config / checkpoints / notices / timeline)
    me: null,            // me 응답
    view: 'home',
    progress: [],
    journal: { items: [], total: 0, nextCursor: null, scope: 'gallery' },
    fee: null,
    pendingPhoto: null,  // 작성 폼에 붙인 사진
    editing: null,       // 수정 중인 일지 id
    station: null,       // 거점 스태프 — station.board 응답 (D-051)
    stationAll: false    // 거점 스태프가 '전체 진행 보기' 를 연 상태
  };

  /**
   * 모드 (D-051). 서버가 정한다 — 여기서는 화면만 바꾼다.
   *   leader·member — 조가 있는 사람. 지금 그대로.
   *   station       — 담당 지점이 있는 스태프. 코스 탭이 '내 지점'.
   *   ops           — 조 없는 교역자·스태프. 코스 탭이 '진행'(읽기 전용).
   */
  function modeOf(me) { return (me && me.mode) || (me && me.isLeader ? 'leader' : 'member'); }

  // ------------------------------------------------------------ 부팅

  function init() {
    bindChrome();
    UI.perfPanel();          // ?perf=1 일 때만 뜬다 (D-030)
    API.bootstrap()
      .then(function (boot) {
        state.boot = boot;
        applyBrand(boot.config);
        return API.getToken() ? API.me() : null;
      })
      .then(function (me) {
        state.me = me;
        render();
      })
      .catch(function (err) {
        state.me = null;
        render();
        if (err.code !== 'UNAUTHORIZED') toast(err.message, 'error');
      });
  }

  function applyBrand(config) {
    if (!config) return;
    document.title = config.CAMP_NAME + ' · ' + config.CAMP_SUBTITLE;
    $('#brandTitle').textContent = config.CAMP_NAME;
    $('#brandSub').textContent = config.CAMP_SUBTITLE;

    var ticker = $('#ticker');
    if (config.NOTICE_TICKER) {
      ticker.textContent = config.NOTICE_TICKER;
      ticker.hidden = false;
    } else {
      ticker.hidden = true;
    }
  }

  function bindChrome() {
    $('#tabbar').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-view]');
      if (!btn) return;
      go(btn.getAttribute('data-view'));
    });
  }

  function go(view) {
    state.view = view;
    state.editing = null;
    state.stationAll = false;     // 탭을 누르면 스태프는 늘 '내 지점' 부터
    render();
  }

  // ------------------------------------------------------------ 렌더 진입점

  function render() {
    var loggedIn = !!state.me;
    $('#tabbar').hidden = !loggedIn;
    document.body.classList.toggle('is-auth', loggedIn);

    if (!loggedIn) {
      renderLogin();
      return;
    }
    UI.$$('#tabbar [data-view]').forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-view') === state.view);
    });
    syncCourseTab();

    var mode = modeOf(state.me);
    if (state.view === 'home') renderHome();
    else if (state.view === 'course') {
      if (mode === 'station' && !state.stationAll) renderStation();
      else if (mode === 'station' || mode === 'ops') renderBoard();
      else renderCourse();
    }
    else if (state.view === 'journal') renderJournal();
    else if (state.view === 'me') renderMe();
  }

  /** 코스 탭의 이름·아이콘을 모드에 맞춘다. 탭 자리는 그대로(data-view="course"). */
  var COURSE_TAB = {
    station: ['📍', '내 지점'],
    ops: ['📊', '진행']
  };
  function syncCourseTab() {
    var btn = UI.$('#tabbar [data-view="course"]');
    if (!btn) return;
    var t = COURSE_TAB[modeOf(state.me)] || ['🧭', '코스'];
    var spans = btn.querySelectorAll('span');
    if (spans.length >= 2) { spans[0].textContent = t[0]; spans[1].textContent = t[1]; }
  }

  function setView(html) {
    $('#view').innerHTML = html;
    $('#view').scrollTop = 0;
  }

  // ------------------------------------------------------------ 로그인

  // ---------------------------------------------------------------- 로그인 기억
  //
  // 토큰 TTL 이 12시간이라 **캠프 당일 아침에 조장 전원이 다시 로그인**한다.
  // 그때 이름과 뒷 4자리를 다시 치게 하지 않는다.
  //
  // 🔴 뒷 4자리는 사실상 비밀번호다. 개인 폰을 전제로 저장하되,
  // **로그아웃하면 지운다** — 로그아웃은 "이 기기를 남에게 넘긴다" 는 신호다.
  // 토큰 만료로 다시 로그인하는 경우에는 그대로 남는다.
  var REMEMBER_KEY = 'plc_jd_login';

  function rememberedLogin() {
    try { return JSON.parse(localStorage.getItem(REMEMBER_KEY) || 'null') || {}; }
    catch (e) { return {}; }
  }
  function rememberLogin(name, last4) {
    try { localStorage.setItem(REMEMBER_KEY, JSON.stringify({ name: name, last4: last4 })); }
    catch (e) { /* 시크릿 모드 등 */ }
  }
  function forgetLogin() {
    try { localStorage.removeItem(REMEMBER_KEY); } catch (e) { /* 무시 */ }
  }

  function renderLogin() {
    var c = (state.boot && state.boot.config) || {};
    var saved = rememberedLogin();
    setView(
      '<section class="hero">' +
        // 캠프마다 바뀌는 문구는 Config 에서 (D-053)
        (c.CAMP_TAGLINE ? '<p class="hero__eyebrow">' + esc(c.CAMP_TAGLINE) + '</p>' : '') +
        '<h1 class="hero__title">' + esc(c.CAMP_NAME || '캠프') + '</h1>' +
        (c.CAMP_SUBTITLE ? '<p class="hero__sub">' + esc(c.CAMP_SUBTITLE) + '</p>' : '') +
      '</section>' +
      '<form id="loginForm" class="card card--form" autocomplete="off">' +
        '<h2 class="card__title">참가자 확인</h2>' +
        '<p class="hint">신청하신 ' + esc(L('name', '이름')) + '과(와) ' +
          esc(L('phone', '연락처')) + ' 뒷 4자리로 들어갑니다.</p>' +
        '<label class="field"><span class="field__label">' + esc(L('name', '이름')) + '</span>' +
          '<input class="input" type="text" name="name" placeholder="홍길동" required' +
          ' value="' + esc(saved.name || '') + '"></label>' +
        '<label class="field"><span class="field__label">' + esc(L('phone', '연락처')) + ' 뒷 4자리</span>' +
          '<input class="input" type="tel" name="last4" inputmode="numeric" pattern="[0-9]{4}" ' +
          'maxlength="4" placeholder="5678" required' +
          ' value="' + esc(saved.last4 || '') + '"></label>' +
        '<button class="btn btn--primary btn--block" type="submit">입장하기</button>' +
        '<p class="hint hint--center">명단에서 찾지 못하면 운영진에게 문의해 주세요.</p>' +
      '</form>'
    );

    $('#loginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var form = e.target;
      var btn = form.querySelector('button[type="submit"]');
      UI.setBusy(btn, true, '확인 중…');

      // 회차는 보내지 않는다. 로그인은 이름 + 뒷 4자리로 하고,
      // 참여 일자는 명단에서 읽는다 (D-027).
      var name = form.name.value.trim();
      var last4 = form.last4.value.trim();

      API.login('', name, last4)
        .then(function (data) {
          rememberLogin(name, last4);   // 성공한 값만 기억한다
          state.me = data.me;
          state.view = 'home';
          render();
          toast(data.me.participant.name + '님 환영합니다. (' +
            data.me.participant.session + ')');
        })
        .catch(function (err) {
          UI.setBusy(btn, false);
          toast(err.message, 'error');
        });
    });
  }

  // ------------------------------------------------------------ 홈

  // ------------------------------------------------------------ 홈 — 지금 · 다음 (D-050)
  //
  // 🔴 홈이 "지금 뭐 하고, 어디로 가지?" 에 답하지 않았다. 하루 일정을 같은 무게로 늘어놓기만
  // 했다. 당일 가장 많이 여는 화면이니 맨 위에 **지금 · 다음** 을 둔다.
  // "지금" 은 **폰 시계**다(UI.localDate · 이 파일의 nowMinutes). serverTime 을 쓰지 않는다.

  function nowMinutes() {
    var d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }

  /** 오늘 일정에서 지금 항목과 다음 항목. 종료가 비면 다음 항목 시작까지로 본다. */
  function timelineNow(rows, nowMin) {
    var cur = null, next = null;
    for (var i = 0; i < rows.length; i++) {
      var st = UI.hmToMin(rows[i].start);
      if (st === null) continue;
      var en = UI.hmToMin(rows[i].end);
      if (en === null && rows[i + 1]) en = UI.hmToMin(rows[i + 1].start);
      if (st <= nowMin && (en === null ? true : nowMin < en)) cur = i;
      if (st > nowMin && next === null) next = i;
    }
    return { cur: cur, next: next };
  }

  /** 두 날짜('YYYY-MM-DD') 사이 날 수 */
  function daysBetween(from, to) {
    return Math.round((new Date(to + 'T00:00:00') - new Date(from + 'T00:00:00')) / 86400000);
  }

  function nowCardHtml(rows, sessionLabel, sessionDate) {
    if (!sessionDate) return '';
    var diff = daysBetween(UI.localDate(), sessionDate);
    if (diff < 0) return '';                         // 지난 회차 — 보일 것이 없다
    if (diff > 0) {
      return '<section class="card now-card now-card--dday"><p class="now-card__line">' +
        '<strong>D-' + diff + '</strong> ' + esc(sessionLabel) + '</p></section>';
    }

    var t = timelineNow(rows, nowMinutes());
    var line;
    if (t.cur !== null) {
      var r = rows[t.cur];
      line = '<p class="now-card__label">지금</p>' +
        '<p class="now-card__line"><strong>' + esc(r.title) + '</strong> ' +
        '<span class="now-card__time">' + esc(r.start) + (r.end ? '–' + esc(r.end) : '') + '</span>' +
        (r.place ? ' · ' + esc(r.place) : '') + '</p>';
    } else if (t.next !== null) {
      // 첫 일정 전, 또는 두 일정 사이(예: 답사 끝 16:10 ~ 마무리 16:25)
      var n = rows[t.next];
      line = '<p class="now-card__label">곧 시작</p>' +
        '<p class="now-card__line"><strong>' + esc(n.title) + '</strong> ' +
        '<span class="now-card__time">' + esc(n.start) + '</span>' +
        (n.place ? ' · ' + esc(n.place) : '') + '</p>';
    } else {
      line = '<p class="now-card__line">오늘 일정이 끝났습니다. 수고하셨습니다!</p>';
    }
    var after = (t.cur !== null && t.next !== null)
      ? '<p class="now-card__next">다음 · ' + esc(rows[t.next].start) + ' ' + esc(rows[t.next].title) + '</p>'
      : '';
    return '<section class="card now-card" id="nowCard">' + line + after +
      '<p class="now-card__course" id="nowCourse" hidden></p></section>';
  }

  /** 당일에만 코스 진행을 읽어 홈 카드에 채운다. 미러에서 읽으므로 가볍다(D-042). */
  function fillNowCourse() {
    var el = $('#nowCourse');
    if (!el || !state.me.team) return;
    var paint = function (list) {
      var box = $('#nowCourse');
      if (!box || !list || !list.length) return;
      var done = list.filter(function (p) { return p.status === '완료'; }).length;
      var next = nextCheckpoint(list);
      var nameOf = {};
      (state.boot.checkpoints || []).forEach(function (c) { nameOf[c.code] = c.name; });
      box.innerHTML = '코스 ' + done + '/' + list.length +
        (next ? ' · 다음 <strong>' + esc(nameOf[next.checkpoint] || next.checkpoint) + '</strong>' : ' · 완주!') +
        ' <button type="button" class="btn btn--text" id="goCourse">코스 보기</button>';
      box.hidden = false;
      $('#goCourse').addEventListener('click', function () { go('course'); });
    };
    if (state.progress && state.progress.length) { paint(state.progress); return; }
    API.progressList(state.me.team)
      .then(function (list) { state.progress = list; lastServerList = list; paint(list); })
      .catch(function () { /* 홈 보조 정보다 — 실패해도 조용히 둔다 */ });
  }

  function renderHome() {
    var me = state.me;
    var team = me.team;
    var notices = (state.boot.notices || []).filter(function (n) {
      return n.target === '전체' ||
        n.target === me.participant.session ||
        n.target === me.participant.audience;
    });
    var rows = (state.boot.timeline && state.boot.timeline[me.participant.session]) || [];
    var sess = (state.boot.sessions || []).filter(function (x) { return x.label === me.participant.session; })[0];
    var sessionDate = sess ? sess.date : '';
    var isToday = sessionDate && sessionDate === UI.localDate();
    var curRow = isToday ? timelineNow(rows, nowMinutes()).cur : null;

    var mode = modeOf(me);
    setView(
      nowCardHtml(rows, me.participant.session, sessionDate) +
      (mode === 'station' || mode === 'ops' ? roleCardHtml(me) :
      '<section class="card card--team" style="--team-color:' + esc(team ? team.color : '#984534') + '">' +
        '<p class="card__eyebrow">' + esc(me.participant.audience || '') +
          (me.participant.audience ? ' · ' : '') + esc(me.participant.session) + '</p>' +
        '<h2 class="card__title">' + esc(team ? team.name : '조 미배정') + '</h2>' +
        '<dl class="kv">' +
          '<div><dt>' + esc(L('name', '이름')) + '</dt><dd>' + esc(me.participant.name) +
            (me.isLeader ? ' <span class="badge">조장</span>' : '') + '</dd></div>' +
          (team && team.leaderName ? '<div><dt>조장</dt><dd>' + esc(team.leaderName) + '</dd></div>' : '') +
          (team && team.meetingPoint ? '<div><dt>집결</dt><dd>' + esc(team.meetingPoint) + '</dd></div>' : '') +
        '</dl>' +
        (team
          ? '<p class="card__foot">' + (team.course ? esc(L('course', '배정 코스')) + ' · ' + esc(team.course) + '<br>' : '') +
            esc(routeNames(team.route).join(' → ')) + '</p>'
          : '') +
      '</section>') +

      (notices.length ? '<section class="card"><h2 class="card__title">공지</h2>' +
        notices.map(function (n) {
          return '<article class="notice' + (n.pinned ? ' notice--pinned' : '') + '">' +
            '<h3>' + esc(n.title) + '</h3>' +
            '<p>' + nl2br(esc(n.body)) + '</p></article>';
        }).join('') + '</section>' : '') +

      '<section class="card"><h2 class="card__title">오늘 일정</h2>' +
        (rows.length
          ? '<ol class="timeline">' + rows.map(function (r, i) {
              return '<li class="timeline__row' + (i === curRow ? ' is-now' : '') + '">' +
                '<span class="timeline__time">' + esc(r.start) + (r.end ? '–' + esc(r.end) : '') + '</span>' +
                '<span class="timeline__body"><strong>' + esc(r.title) + '</strong>' +
                (r.place ? '<em>' + esc(r.place) + '</em>' : '') +
                (r.note ? '<span class="timeline__note">' + esc(r.note) + '</span>' : '') +
                '</span></li>';
            }).join('') + '</ol>'
          : '<p class="empty">일정이 아직 등록되지 않았습니다.</p>') +
      '</section>'
    );
    if (isToday) fillNowCourse();
    var goRole = $('#goRole');
    if (goRole) goRole.addEventListener('click', function () { state.stationAll = false; go('course'); });
  }

  /** 조 없는 교역자·스태프의 홈 카드 — 조 카드 자리 (D-051). */
  function roleCardHtml(me) {
    var st = me.station;
    var isStation = modeOf(me) === 'station';
    return '<section class="card card--team card--role">' +
      '<p class="card__eyebrow">' + esc(me.participant.session) + ' · 운영진</p>' +
      '<h2 class="card__title">' + esc(me.participant.role || '운영진') +
        (isStation && st ? ' · ' + esc(st.name || st.code) : '') + '</h2>' +
      '<dl class="kv">' +
        '<div><dt>' + esc(L('name', '이름')) + '</dt><dd>' + esc(me.participant.name) + '</dd></div>' +
        (isStation && st ? '<div><dt>담당</dt><dd>' + esc(st.name || st.code) + ' (' + esc(st.code) + ')</dd></div>' : '') +
      '</dl>' +
      '<p class="card__foot">' +
        (isStation
          ? '이 지점에 오는 조의 도착·완료·퀴즈 점수를 기록합니다. '
          : '모든 조의 진행을 볼 수 있습니다(읽기 전용). 검수·공지·정정은 운영 콘솔에서 PIN 으로. ') +
        '<button type="button" class="btn btn--text" id="goRole">' + (isStation ? '내 지점 열기' : '진행 보기') + '</button>' +
      '</p>' +
    '</section>';
  }

  function routeNames(route) {
    var byCode = {};
    (state.boot.checkpoints || []).forEach(function (c) { byCode[c.code] = c.name; });
    return (route || []).map(function (code) { return byCode[code] || code; });
  }

  // ------------------------------------------------------------ 코스

  function renderCourse() {
    setView('<p class="loading">불러오는 중…</p>');
    // 조 정보를 같이 넘기면 미러에서 먼저 읽는다 (D-042). 미러가 없거나 낡으면 GAS.
    API.progressList(state.me && state.me.team)
      .then(function (list) {
        state.progress = list;
        lastServerList = list;              // 되돌림 기준
        paintCourse();
      })
      .catch(function (err) {
        setView('<p class="empty">' + esc(err.message) + '</p>');
      });
  }

  /**
   * 조장이 누를 버튼 (D-050).
   *
   * 🔴 예전에는 `대기 / 도착 / 완료` 세 버튼이 같은 크기로 나란히 있고, **현재 상태가 진한 색**
   * 이었다. 아직 안 간 지점은 `대기` 가 칠해져 **눌러야 할 버튼처럼** 보였고, 한 번 잘못 누르면
   * 도착 기록이 지워졌다. 이제 버튼은 **다음 동작 하나**다. 상태는 칩으로만 보인다.
   *
   * 되돌리기는 작은 글자 버튼이고 확인창을 거친다 — 도착 취소는 **최초 도착 시각을 지운다.**
   * 버튼에는 지금처럼 **목표 상태**를 `data-status` 로 단다. 그래서 `queueProgress` 이하
   * (낙관적 반영·배치·되돌림)는 그대로다.
   */
  var NEXT_ACTION = {
    '대기': { status: '도착', label: '도착했어요' },
    '도착': { status: '완료', label: '완료했어요' }
  };
  var UNDO_ACTION = {
    '도착': { status: '대기', label: '도착 취소', ask: '도착 기록을 지울까요?\n도착 시각도 함께 지워집니다.' },
    '완료': { status: '도착', label: '완료 취소', ask: '완료를 취소할까요?\n도착 상태로 돌아갑니다.' }
  };

  function courseActions(p) {
    var next = NEXT_ACTION[p.status];
    var undo = UNDO_ACTION[p.status];
    if (!next && !undo) return '';
    return '<div class="cp__actions" data-cp="' + esc(p.checkpoint) + '">' +
      (next
        ? '<button type="button" class="btn btn--primary cp__next" data-status="' + next.status + '">' +
            esc(next.label) + '</button>'
        : '') +
      (undo
        ? '<button type="button" class="btn btn--text cp__undo" data-status="' + undo.status + '"' +
            ' data-ask="' + esc(undo.ask) + '">' + esc(undo.label) + '</button>'
        : '') +
      '</div>';
  }

  /**
   * 퀴즈 점수 (D-052). 조장도 넣을 수 있지만 **스태프가 넣은 점수가 우선**이다 —
   * 출처가 스태프면 칸을 잠근다. 도착 전에는 점수 칸을 보이지 않는다.
   */
  function scoreHtml(p, canEdit) {
    var has = p.score !== null && p.score !== undefined && p.score !== '';
    if (p.scoreSource === '스태프' && has) {
      return '<p class="cp__score is-locked">퀴즈 <strong>' + esc(p.score) + '점</strong> · 스태프 확인</p>';
    }
    if (canEdit && p.status !== '대기') {
      return '<div class="cp__score" data-cp="' + esc(p.checkpoint) + '">' +
        '<label>퀴즈 점수 <input class="input input--score" type="number" inputmode="numeric" min="0" max="100"' +
          ' value="' + (has ? esc(p.score) : '') + '" aria-label="퀴즈 점수"></label>' +
        '<button type="button" class="btn btn--ghost btn--sm" data-score-save>저장</button>' +
        (has && p.scoreSource === '관리자' ? '<span class="hint">운영진이 고친 점수</span>' : '') +
      '</div>';
    }
    return has ? '<p class="cp__score">퀴즈 <strong>' + esc(p.score) + '점</strong></p>' : '';
  }

  /** 코스 순서상 아직 완료하지 않은 첫 지점. 모두 완료면 null. */
  function nextCheckpoint(list) {
    for (var i = 0; i < list.length; i++) if (list[i].status !== '완료') return list[i];
    return null;
  }

  function paintCourse() {
    var byCode = {};
    (state.boot.checkpoints || []).forEach(function (c) { byCode[c.code] = c; });
    var canEdit = state.me.isLeader && state.boot.config.PROGRESS_OPEN;
    var next = nextCheckpoint(state.progress);
    var done = state.progress.filter(function (p) { return p.status === '완료'; }).length;

    var cards = state.progress.map(function (p) {
      var cp = byCode[p.checkpoint] || { name: p.checkpoint };
      var mapUrl = cp.lat && cp.lng
        ? 'https://map.kakao.com/link/map/' + encodeURIComponent(cp.name) + ',' + cp.lat + ',' + cp.lng
        : 'https://map.kakao.com/link/search/' + encodeURIComponent(cp.name);
      var isNext = next && next.checkpoint === p.checkpoint;
      var times = (p.arrivedAt ? '도착 ' + esc(UI.hhmm(p.arrivedAt)) : '') +
        (p.completedAt ? ' · 완료 ' + esc(UI.hhmm(p.completedAt)) : '');

      var head =
        '<span class="cp__no">' + p.visitOrder + '</span>' +
        '<div><h3 class="cp__name">' + esc(cp.name) + '</h3>' +
        (p.status === '완료'
          ? '<p class="cp__sum">' + times + '</p>'
          : (cp.summary ? '<p class="cp__sum">' + esc(cp.summary) + '</p>' : '')) + '</div>' +
        '<span class="chip chip--' + statusClass(p.status) + '">' + esc(p.status) +
        (p.pending ? ' · 저장 중' : '') + '</span>';

      var body =
        (cp.description ? '<p class="cp__desc">' + nl2br(esc(cp.description)) + '</p>' : '') +
        (cp.mission ? '<p class="cp__mission"><strong>미션</strong> ' + esc(cp.mission) + '</p>' : '') +
        (times && p.status !== '완료' ? '<p class="cp__times">' + times + '</p>' : '') +
        '<div class="cp__links">' +
          '<a class="btn btn--ghost btn--sm" href="' + esc(mapUrl) + '" target="_blank" rel="noopener">지도</a>' +
          (cp.quizUrl
            ? '<a class="btn btn--ghost btn--sm" href="' + esc(cp.quizUrl) + '" target="_blank" rel="noopener">퀴즈 열기</a>'
            : '') +
          (cp.openHours ? '<span class="cp__hours">' + esc(cp.openHours) + '</span>' : '') +
        '</div>' +
        scoreHtml(p, canEdit) +
        (canEdit ? courseActions(p) : '');

      // 화면은 이미 바뀌었지만 아직 서버에 안 갔다 — 그 사실을 숨기지 않는다.
      // data-score 는 **표시가 아니라 확인용**이다(D-039). 테스트와 현장 점검이 값을 본다.
      var attrs = ' id="cp-' + esc(p.checkpoint) + '" data-code="' + esc(p.checkpoint) + '"' +
        ' data-status="' + esc(p.status) + '"' +
        ' data-score="' + esc(p.score === null || p.score === undefined ? '' : p.score) + '"';
      var cls = 'cp cp--' + statusClass(p.status) + (p.pending ? ' is-saving' : '') + (isNext ? ' cp--next' : '');

      // 🔴 **다음 지점과 진행 중(도착)인 지점만 펼친다.** 나머지는 한 줄로 접는다 —
      // 네 곳을 다 펼치면 화면이 3,600px 이 되어 조장이 걸으면서 스크롤로 찾았다.
      // 접힌 카드도 누르면 펼쳐지고 버튼이 그대로 있다(순서를 바꿔 갈 때를 위해).
      if (!isNext && p.status !== '도착') {
        return '<details class="' + cls + '"' + attrs + '>' +
          '<summary class="cp__head">' + head + '</summary>' + body + '</details>';
      }
      return '<article class="' + cls + '"' + attrs + '>' +
        '<header class="cp__head">' + head + '</header>' + body + '</article>';
    }).join('');

    var total = state.progress.length;
    var summary = total
      ? '<a class="course-summary" href="' + (next ? '#cp-' + esc(next.checkpoint) : '#') + '">' +
          '<span class="course-summary__count">진행 ' + done + '/' + total + '</span>' +
          (next
            ? '<span>다음: ' + next.visitOrder + '. ' +
                esc((byCode[next.checkpoint] || { name: next.checkpoint }).name) + '</span>'
            : '<span>🎉 네 곳 모두 완료했습니다</span>') +
        '</a>'
      : '';

    setView(
      '<section class="section-head"><h2>답사 코스</h2>' +
        '<p class="hint">우리 조 순서대로 표시됩니다.' +
        (state.me.isLeader
          ? (state.boot.config.PROGRESS_OPEN ? ' 도착하면 "도착했어요", 끝나면 "완료했어요" 를 눌러 주세요.' : ' 진행 기록은 마감되었습니다.')
          : ' 상태는 조장이 기록합니다.') + '</p></section>' +
      summary +
      (cards || '<p class="empty">코스 정보가 없습니다.</p>')
    );

    if (canEdit) {
      $('#view').addEventListener('click', onProgressClick);
    }
  }

  // ---------------------------------------------------------------- 진행 기록
  //
  // 🔴 **화면을 먼저 바꾸고 전송은 뒤에서 한다** (낙관적 UI).
  //
  // 예전에는 버튼을 잠그고 서버를 기다렸다. 실측에서 이 요청이 최대 61초까지
  // 걸렸고, 그동안 조장은 멎은 화면을 보고 있었다. 현장에서 쓸 수 없다.
  //
  // 대신 누르는 즉시 반영하고, **실패하면 되돌린다.** 화면이 거짓말한 채로
  // 남지 않는 것이 이 구조의 전제다.

  /**
   * 서버가 할 일을 **그대로** 흉내 낸다 (gas/Code.gs 의 progressSet_).
   * 규칙이 어긋나면 응답이 왔을 때 화면이 튄다.
   *
   * · 도착·완료는 **최초 시각만** 남긴다 (되돌렸다 다시 눌러도 처음 시각 유지)
   * · 대기는 둘 다 비운다
   * · 🔴 점수·메모는 **건드리지 않는다.** 보내지 않았으니 서버도 손대지 않는다.
   *   (예전에는 서버가 덮어써서 여기서도 비웠다 — 그 손실을 서버에서 고쳤다.)
   */
  function applyProgressLocal(list, code, status, extra) {
    var now = UI.localIso();
    return list.map(function (p) {
      if (p.checkpoint !== code) return p;
      var next = Object.assign({}, p, { status: status, pending: true });
      // 점수는 보낸 때만. 스태프 점수는 서버가 지키므로 화면도 건드리지 않는다 (D-052).
      if (extra && extra.score !== undefined && p.scoreSource !== '스태프') {
        next.score = extra.score === '' ? null : extra.score;
        next.scoreSource = extra.score === '' ? '' : '조장';
      }
      if (status === '대기') {
        next.arrivedAt = '';
        next.completedAt = '';
        return next;
      }
      if (!next.arrivedAt) next.arrivedAt = now;
      if (status === '완료' && !next.completedAt) next.completedAt = now;
      return next;
    });
  }

  // ---------------------------------------------------------------- 보내기 큐
  //
  // 🔴 **앞 요청이 도는 동안 모은다** (D-045).
  //
  // 예전에는 버튼 하나에 요청 하나였다. 실측에서 연타하면 서버의 `lock` 이
  // 126 → 1,464 → 2,978 → 4,541ms 로 **쌓였다** — 각 요청이 락을 쥔 만큼 다음이
  // 줄을 선다. 요청당 고정비(스프레드시트 열기·인증·읽기)도 2.5~4초씩 따로 냈다.
  //
  // 🔴 고정 디바운스(예: 800ms)를 두지 않는다. 한가할 때 공연히 느려지고 바쁠 때는
  // 여전히 모자란다. "앞 요청이 끝날 때까지 모은다" 는 **한가하면 0ms, 느리면
  // 최대한 묶는다** 를 알아서 한다 — 왕복 3초 동안 탭이 쌓이는 지금 문제에 맞는다.

  var sendQueue = {};        // 지점코드 → {status, score?}. 같은 지점은 필드를 합치고 마지막 값이 남는다
  var sending = false;       // 요청이 도는 중인가

  // 🔴 되돌릴 곳은 **마지막 서버 응답**이다. 화면 스냅샷이 아니다.
  //
  // 처음에는 배치 직전의 화면을 찍어 뒀는데, 그 화면에 **앞 배치의 '저장 중'
  // 표시가 남아 있으면** 되돌릴 때 그것까지 복원돼 영영 안 지워진다.
  // 테스트가 이걸 잡았다. 서버가 준 목록은 언제나 깨끗하다.
  var lastServerList = [];
  var lastStatusBefore = {};   // 토스트 문구용 — 점수만 저장했는지 구분

  function queueProgress(code, status, extra) {
    // 🔴 같은 지점이면 **필드를 합친다.** 점수를 저장한 뒤 바로 '완료' 를 누르면
    //    점수가 사라지면 안 된다 — 상태만 덮어쓰고 점수는 남긴다.
    sendQueue[code] = Object.assign({}, sendQueue[code], { status: status }, extra || {});
    state.progress = applyProgressLocal(state.progress, code, status, extra);
    paintCourse();

    if (!sending) flushProgress();
  }

  function flushProgress() {
    var codes = Object.keys(sendQueue);
    if (!codes.length) { sending = false; return; }

    var items = codes.map(function (c) {
      var q = sendQueue[c];
      var it = { checkpoint: c, status: q.status };
      if (q.score !== undefined) it.score = q.score;
      return it;
    });
    sendQueue = {};
    sending = true;
    lastStatusBefore = {};
    lastServerList.forEach(function (p) { lastStatusBefore[p.checkpoint] = p.status; });

    API.progressSetBatch(items)
      .then(function (list) {
        state.progress = list;              // 권위는 서버다
        lastServerList = list;
        paintCourse();
        // 스태프가 이미 확인한 점수는 서버가 그대로 둔다 — 조용히 넘기지 않는다.
        var kept = items.filter(function (it) {
          if (it.score === undefined) return false;
          var p = list.filter(function (x) { return x.checkpoint === it.checkpoint; })[0];
          return p && p.scoreSource === '스태프' && String(p.score) !== String(it.score);
        });
        if (kept.length) toast('스태프가 확인한 점수는 바꿀 수 없습니다. 상태만 기록했습니다.', 'error');
        else toast(items.length === 1
          ? (items[0].score !== undefined && items[0].status === (lastStatusBefore[items[0].checkpoint] || items[0].status)
              ? '점수를 저장했습니다.' : '기록했습니다: ' + items[0].status)
          : items.length + '곳을 기록했습니다.');
      })
      .catch(function (err) {
        // 🔴 배치 전체를 되돌린다. 일부만 남기면 화면이 거짓말한다.
        state.progress = lastServerList;
        sendQueue = {};                     // 실패한 뒤 쌓인 것까지 버린다 — 화면도 그 이전이다
        paintCourse();
        toast(err.message, 'error');
      })
      .then(function () { sending = false; flushProgress(); });
  }

  // 🔴 앱이 닫히거나 가려질 때 큐가 남아 있으면 기록이 날아간다.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden' && !sending) flushProgress();
  });

  function onProgressClick(e) {
    var save = e.target.closest('[data-score-save]');
    if (save) {
      var box = save.closest('[data-cp]');
      var input = box && box.querySelector('input');
      if (!input) return;
      var raw = String(input.value).trim();
      var n = Number(raw);
      if (raw !== '' && (isNaN(n) || n < 0 || n > 100)) { toast('점수는 0~100 사이로 넣어 주세요.', 'error'); return; }
      var code0 = box.getAttribute('data-cp');
      var cur = state.progress.filter(function (p) { return p.checkpoint === code0; })[0];
      if (!cur) return;
      queueProgress(code0, cur.status, { score: raw === '' ? '' : n });
      return;
    }
    // 카드 자체에도 data-status(현재 상태)가 달려 있다 — 버튼만 잡는다.
    var btn = e.target.closest('button[data-status]');
    if (!btn) return;
    var wrap = btn.closest('[data-cp]');
    if (!wrap) return;
    var code = wrap.getAttribute('data-cp');
    var target = btn.getAttribute('data-status');
    var ask = btn.getAttribute('data-ask');
    if (!ask) { queueProgress(code, target); return; }
    // 되돌리기는 기록을 지우므로 한 번 묻는다.
    UI.confirmDialog(ask, btn.textContent).then(function (yes) {
      if (yes) queueProgress(code, target);
    });
  }

  function statusClass(status) {
    return status === '완료' ? 'done' : status === '도착' ? 'here' : 'wait';
  }

  // ------------------------------------------------------------ 거점 스태프 · 내 지점 (D-051)
  //
  // 지점 하나를 맡은 스태프가 **이 지점에 오는 모든 조**를 본다. 조장 화면과 달리
  // 낙관적 반영·묶어 보내기를 쓰지 않는다 — 스태프는 연타하지 않고, 조가 여럿이라
  // 누른 조의 버튼만 잠그는 편이 헷갈리지 않는다. 응답은 갱신된 목록이다.

  var ST_NEXT = {
    '대기': { status: '도착', label: '도착 확인' },
    '도착': { status: '완료', label: '완료' }
  };
  var ST_UNDO = {
    '도착': { status: '대기', label: '도착 취소', ask: '도착 기록을 지울까요?\n도착 시각도 함께 지워집니다.' },
    '완료': { status: '도착', label: '완료 취소', ask: '완료를 취소할까요?\n도착 상태로 돌아갑니다.' }
  };

  function renderStation() {
    setView('<p class="loading">불러오는 중…</p>');
    API.call('station.board')
      .then(function (b) { state.station = b; paintStation(); })
      .catch(function (err) { setView('<p class="empty">' + esc(err.message) + '</p>'); });
  }

  function paintStation() {
    var b = state.station;
    var cp = b.checkpoint;
    var canEdit = state.boot.config.PROGRESS_OPEN;
    var n = b.teams.length;
    var here = b.teams.filter(function (t) { return t.status !== '대기'; }).length;
    var done = b.teams.filter(function (t) { return t.status === '완료'; }).length;

    setView(
      '<section class="section-head"><h2>📍 ' + esc(cp.name) + '</h2>' +
        '<p class="hint">' + esc(b.session) + ' · 이 지점에 오는 순서대로입니다. 조가 오면 "도착 확인", ' +
        '미션·퀴즈가 끝나면 "완료". 스태프가 넣은 점수가 조장 점수보다 우선합니다.</p></section>' +
      (cp.mission ? '<p class="cp__mission"><strong>미션</strong> ' + esc(cp.mission) + '</p>' : '') +
      '<div class="station-bar">' +
        '<span class="course-summary__count">도착 ' + here + '/' + n + ' · 완료 ' + done + '/' + n + '</span>' +
        (cp.quizUrl ? '<a class="btn btn--ghost btn--sm" href="' + esc(cp.quizUrl) + '" target="_blank" rel="noopener">퀴즈</a>' : '') +
        '<button type="button" class="btn btn--ghost btn--sm" data-st="refresh">새로고침</button>' +
        '<button type="button" class="btn btn--ghost btn--sm" data-st="all">전체 진행</button>' +
      '</div>' +
      (canEdit ? '' : '<p class="empty">진행 기록이 마감되었습니다.</p>') +
      (n ? '<div id="stationList">' + b.teams.map(function (t) { return stationRow(t, canEdit); }).join('') + '</div>'
         : '<p class="empty">이 지점을 지나는 조가 없습니다.</p>')
    );
    $('#view').addEventListener('click', onStationClick);
  }

  function stationRow(t, canEdit) {
    var next = ST_NEXT[t.status];
    var undo = ST_UNDO[t.status];
    var has = t.score !== null && t.score !== undefined && t.score !== '';
    var where = t.status !== '대기' ? ''
      : t.visitOrder === 1 ? '첫 지점'
      : t.prevStatus === '완료' ? '🚶 오는 중 — ' + esc(t.prevName) + ' 완료'
      : esc(t.prevName) + ' ' + esc(t.prevStatus);
    var times = (t.arrivedAt ? '도착 ' + esc(UI.hhmm(t.arrivedAt)) : '') +
      (t.completedAt ? ' · 완료 ' + esc(UI.hhmm(t.completedAt)) : '');

    return '<article class="st-row st-row--' + statusClass(t.status) + '" data-group="' + esc(t.group) + '">' +
      '<header class="st-row__head">' +
        '<span class="cp__no">' + t.visitOrder + '</span>' +
        '<div><strong>' + esc(t.name) + '</strong>' +
          '<span class="team-card__meta">조장 ' + esc(t.leaderName || '—') + ' · ' + t.memberCount + '명' +
            (where ? ' · ' + where : '') + (times ? ' · ' + times : '') + '</span></div>' +
        '<span class="chip chip--' + statusClass(t.status) + '">' + esc(t.status) + '</span>' +
      '</header>' +
      (canEdit
        ? '<div class="st-row__actions">' +
            (next ? '<button type="button" class="btn btn--primary" data-st="set" data-status="' + next.status + '">' +
              esc(next.label) + '</button>' : '') +
            (undo ? '<button type="button" class="btn btn--text" data-st="set" data-status="' + undo.status + '"' +
              ' data-ask="' + esc(undo.ask) + '">' + esc(undo.label) + '</button>' : '') +
          '</div>' +
          (t.status !== '대기' || has
            ? '<div class="cp__score">' +
                '<label>퀴즈 점수 <input class="input input--score" type="number" inputmode="numeric" min="0" max="100"' +
                  ' value="' + (has ? esc(t.score) : '') + '" aria-label="' + esc(t.name) + ' 퀴즈 점수"></label>' +
                '<button type="button" class="btn btn--ghost btn--sm" data-st="score">저장</button>' +
                (has && t.scoreSource && t.scoreSource !== '스태프'
                  ? '<span class="hint">' + esc(t.scoreSource) + ' 입력 — 확인 후 저장하면 스태프 점수가 됩니다</span>' : '') +
              '</div>'
            : '')
        : (has ? '<p class="cp__score">퀴즈 <strong>' + esc(t.score) + '점</strong></p>' : '')) +
    '</article>';
  }

  function onStationClick(e) {
    if (state.view !== 'course' || modeOf(state.me) !== 'station' || state.stationAll) return;
    var btn = e.target.closest('[data-st]');
    if (!btn) return;
    var act = btn.getAttribute('data-st');
    if (act === 'refresh') { renderStation(); return; }
    if (act === 'all') { state.stationAll = true; render(); return; }

    var row = btn.closest('[data-group]');
    if (!row) return;
    var item = { group: row.getAttribute('data-group') };
    if (act === 'set') {
      item.status = btn.getAttribute('data-status');
    } else if (act === 'score') {
      var raw = String(row.querySelector('input').value).trim();
      var n = Number(raw);
      if (raw !== '' && (isNaN(n) || n < 0 || n > 100)) { toast('점수는 0~100 사이로 넣어 주세요.', 'error'); return; }
      item.score = raw === '' ? '' : n;
    } else return;

    var ask = btn.getAttribute('data-ask');
    (ask ? UI.confirmDialog(ask, btn.textContent) : Promise.resolve(true)).then(function (yes) {
      if (!yes) return;
      UI.$$('button', row).forEach(function (b) { b.disabled = true; });
      UI.setBusy(btn, true, '저장 중…');
      API.call('station.set', { items: [item] })
        .then(function (b) {
          state.station = b;
          paintStation();
          toast(item.status ? item.group + ' ' + item.status : item.group + ' 점수 저장');
        })
        .catch(function (err) {
          UI.$$('button', row).forEach(function (b) { b.disabled = false; });
          UI.setBusy(btn, false);
          toast(err.message, 'error');
        });
    });
  }

  // ------------------------------------------------------------ 진행 (교역자·스태프, 읽기 전용)

  function renderBoard() {
    setView('<p class="loading">불러오는 중…</p>');
    API.call('ops.board')
      .then(paintBoard)
      .catch(function (err) { setView('<p class="empty">' + esc(err.message) + '</p>'); });
  }

  function paintBoard(b) {
    var isStation = modeOf(state.me) === 'station';
    var grid = UI.teamGrid(b.teams, b.checkpoints, {});
    setView(
      '<section class="section-head"><h2>진행 현황</h2>' +
        '<p class="hint">' + esc(b.session) + ' · 조마다 코스 순서대로입니다. 완주 전인데 ' + UI.STALE_MIN +
        '분 넘게 새 기록이 없으면 ⚠ 가 붙습니다. 점수 옆 ✓ 는 스태프가 확인한 점수입니다. ' +
        '<strong>읽기 전용</strong>입니다.</p></section>' +
      '<div class="station-bar">' +
        '<button type="button" class="btn btn--ghost btn--sm" data-board="refresh">새로고침</button>' +
        (isStation ? '<button type="button" class="btn btn--ghost btn--sm" data-board="back">내 지점으로</button>' : '') +
      '</div>' +
      (b.teams.length ? grid.html : '<p class="empty">이 회차에 배정된 조가 없습니다.</p>') +
      (state.me.participant.role === '교역자'
        ? '<p class="hint hint--center">진행 정정·일지 검수·공지는 운영 콘솔에서 합니다.</p>' +
          '<a class="btn btn--ghost btn--block" href="admin.html">운영 콘솔 열기 (PIN)</a>'
        : '')
    );
    $('#view').addEventListener('click', onBoardClick);
  }

  function onBoardClick(e) {
    if (state.view !== 'course') return;
    var btn = e.target.closest('[data-board]');
    if (!btn) return;
    if (btn.getAttribute('data-board') === 'back') { state.stationAll = false; render(); return; }
    renderBoard();
  }

  // ------------------------------------------------------------ 탐험일지

  function renderJournal() {
    var scopeTabs = [['gallery', '갤러리'], ['mine', '내 일지']];
    if (state.me.isLeader) scopeTabs.push(['team', '우리 조']);

    setView(
      '<section class="section-head"><h2>탐험일지</h2>' +
        '<p class="hint" id="scopeHint"></p></section>' +
      (state.boot.config.JOURNAL_OPEN ? journalFormHtml() : '<p class="empty">일지 작성이 마감되었습니다.</p>') +
      '<div class="tabs" id="scopeTabs">' +
        scopeTabs.map(function (t) {
          return '<button type="button" class="tab' + (state.journal.scope === t[0] ? ' is-active' : '') +
            '" data-scope="' + t[0] + '">' + t[1] + '</button>';
        }).join('') +
      '</div>' +
      '<div id="journalList"><p class="loading">불러오는 중…</p></div>'
    );

    $('#scopeTabs').addEventListener('click', function (e) {
      var tab = e.target.closest('[data-scope]');
      if (!tab) return;
      state.journal.scope = tab.getAttribute('data-scope');
      renderJournal();
    });

    if (state.boot.config.JOURNAL_OPEN) bindJournalForm();
    loadJournal(0);
  }

  function journalFormHtml() {
    var cps = state.boot.checkpoints || [];
    return '<form id="journalForm" class="card card--form">' +
      '<h2 class="card__title">오늘의 기록 남기기</h2>' +
      '<label class="field"><span class="field__label">어느 지점인가요? <em>(선택)</em></span>' +
        '<select class="input" name="checkpoint">' +
          '<option value="">지점 없이 자유롭게</option>' +
          cps.map(function (c) {
            return '<option value="' + esc(c.code) + '">' + esc(c.name) + '</option>';
          }).join('') +
        '</select></label>' +
      '<label class="field"><span class="field__label">소감</span>' +
        '<textarea class="input" name="text" rows="4" maxlength="1000" ' +
        'placeholder="현장에서 보고 느낀 것을 적어 주세요."></textarea></label>' +
      '<div class="field">' +
        '<span class="field__label">사진 <em>(선택)</em></span>' +
        // 🔴 입력이 둘이다. 하나에 capture 를 붙이면 그 입력은 **카메라만** 열고
        // 갤러리 선택지를 아예 없앤다. 예전에는 입력이 하나뿐이라 버튼 글씨가
        // '사진 선택 / 촬영' 인데 선택이 안 됐다 (D-027).
        '<div class="filepick-row">' +
          '<label class="filepick"><input type="file" name="photoShot" accept="image/*" ' +
            'capture="environment" hidden><span>📷 촬영</span></label>' +
          '<label class="filepick"><input type="file" name="photoPick" accept="image/*" hidden>' +
            '<span>🖼 갤러리에서 선택</span></label>' +
        '</div>' +
        '<div id="photoPreview" class="photo-preview" hidden>' +
          '<img alt="선택한 사진 미리보기">' +
          '<button type="button" class="btn btn--ghost btn--sm" id="photoClear">사진 빼기</button>' +
        '</div>' +
      '</div>' +
      '<button class="btn btn--primary btn--block" type="submit">올리기</button>' +
      (state.boot.config.JOURNAL_REQUIRE_APPROVAL
        ? '<p class="hint hint--center">올린 글은 운영진 확인 후 갤러리에 보입니다.</p>' : '') +
      '</form>';
  }

  function bindJournalForm() {
    var form = $('#journalForm');
    // 촬영·갤러리 두 입력을 똑같이 다룬다. 어느 쪽으로 넣었든 결과는 사진 한 장이다.
    var inputs = [].slice.call(form.querySelectorAll('input[type="file"]'));
    var preview = $('#photoPreview');

    inputs.forEach(function (input) {
      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        if (!file) return;
        UI.resizePhoto(file)
          .then(function (photo) {
            state.pendingPhoto = photo;
            preview.querySelector('img').src = photo.previewUrl;
            preview.hidden = false;
          })
          .catch(function (err) {
            input.value = '';
            toast(err.message, 'error');
          });
      });
    });

    $('#photoClear').addEventListener('click', function () {
      state.pendingPhoto = null;
      // 둘 다 비운다. 하나만 비우면 같은 사진을 다시 골랐을 때 change 가 안 뜬다.
      inputs.forEach(function (input) { input.value = ''; });
      preview.hidden = true;
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = form.text.value.trim();
      if (!text && !state.pendingPhoto) {
        toast('소감이나 사진 중 하나는 있어야 합니다.', 'error');
        return;
      }
      var btn = form.querySelector('button[type="submit"]');
      UI.setBusy(btn, true, '올리는 중…');

      API.journalCreate({
        checkpoint: form.checkpoint.value,
        text: text,
        photo: state.pendingPhoto
          ? {
              name: state.pendingPhoto.name,
              mimeType: state.pendingPhoto.mimeType,
              dataBase64: state.pendingPhoto.dataBase64
            }
          : null
      })
        .then(function () {
          form.reset();
          state.pendingPhoto = null;
          preview.hidden = true;
          UI.setBusy(btn, false);
          toast(state.boot.config.JOURNAL_REQUIRE_APPROVAL ? '올렸습니다. 운영진 확인 후 공개됩니다.' : '올렸습니다.');
          loadJournal(0);
        })
        .catch(function (err) {
          UI.setBusy(btn, false);
          toast(err.message, 'error');
        });
    });
  }

  function loadJournal(cursor) {
    API.journalList(state.journal.scope, cursor)
      .then(function (data) {
        state.journal.items = cursor ? state.journal.items.concat(data.items) : data.items;
        state.journal.total = data.total;
        state.journal.nextCursor = data.nextCursor;
        paintJournalList(data);
      })
      .catch(function (err) {
        var list = $('#journalList');
        if (list) list.innerHTML = '<p class="empty">' + esc(err.message) + '</p>';
      });
  }

  function paintJournalList(meta) {
    var list = $('#journalList');
    if (!list) return;

    var hint = $('#scopeHint');
    if (hint && state.journal.scope === 'gallery') {
      hint.textContent = meta.galleryScope === 'TEAM'
        ? '같은 조의 기록이 보입니다.'
        : meta.galleryScope === 'SELF'
          ? '내가 올린 기록만 보입니다.'
          : '같은 회차 참가자 전체의 기록이 보입니다.';
    } else if (hint) {
      hint.textContent = '';
    }

    if (!state.journal.items.length) {
      list.innerHTML = '<p class="empty">아직 올라온 기록이 없습니다. 첫 기록을 남겨 보세요.</p>';
      return;
    }

    list.innerHTML =
      '<div class="grid">' + state.journal.items.map(journalCardHtml).join('') + '</div>' +
      (state.journal.nextCursor !== null
        ? '<button type="button" class="btn btn--ghost btn--block" id="moreBtn">더 보기</button>'
        : '');

    var more = $('#moreBtn');
    if (more) {
      more.addEventListener('click', function () {
        UI.setBusy(more, true, '불러오는 중…');
        loadJournal(state.journal.nextCursor);
      });
    }
    list.addEventListener('click', onJournalAction);
  }

  function journalCardHtml(item) {
    if (state.editing === item.id) return journalEditHtml(item);

    var cpName = '';
    (state.boot.checkpoints || []).forEach(function (c) { if (c.code === item.checkpoint) cpName = c.name; });

    return '<article class="jcard" data-id="' + esc(item.id) + '">' +
      (item.photoUrl
        ? '<a class="jcard__photo" href="' + esc(item.photoUrl) + '" target="_blank" rel="noopener">' +
          '<img loading="lazy" src="' + esc(item.photoUrl) + '" alt="' + esc(item.authorName) + '님의 탐험일지 사진"></a>'
        : '') +
      '<div class="jcard__body">' +
        '<p class="jcard__meta">' +
          '<strong>' + esc(item.authorName) + '</strong>' +
          (cpName ? ' · ' + esc(cpName) : '') +
          ' · <time>' + esc(UI.prettyDateTime(item.createdAt)) + '</time>' +
          (item.status !== '승인' ? ' <span class="chip chip--' +
            (item.status === '반려' ? 'reject' : 'wait') + '">' + esc(item.status) + '</span>' : '') +
        '</p>' +
        (item.text ? '<p class="jcard__text">' + nl2br(esc(item.text)) + '</p>' : '') +
        (item.status === '반려' && item.rejectReason
          ? '<p class="jcard__reject">반려 사유: ' + esc(item.rejectReason) + '</p>' : '') +
        (item.canEdit
          ? '<div class="jcard__actions">' +
            '<button type="button" class="btn btn--ghost btn--sm" data-act="edit">수정</button>' +
            '<button type="button" class="btn btn--ghost btn--sm btn--danger-text" data-act="delete">삭제</button>' +
            (!item.isMine ? '<span class="jcard__role">조장 권한</span>' : '') +
            '</div>'
          : '') +
      '</div>' +
    '</article>';
  }

  function journalEditHtml(item) {
    var cps = state.boot.checkpoints || [];
    return '<article class="jcard jcard--editing" data-id="' + esc(item.id) + '">' +
      '<div class="jcard__body">' +
        '<h3 class="card__title">기록 수정</h3>' +
        '<label class="field"><span class="field__label">지점</span>' +
          '<select class="input" data-field="checkpoint">' +
            '<option value="">지점 없음</option>' +
            cps.map(function (c) {
              return '<option value="' + esc(c.code) + '"' +
                (c.code === item.checkpoint ? ' selected' : '') + '>' + esc(c.name) + '</option>';
            }).join('') +
          '</select></label>' +
        '<label class="field"><span class="field__label">소감</span>' +
          '<textarea class="input" rows="4" maxlength="1000" data-field="text">' + esc(item.text) + '</textarea></label>' +
        (item.photoUrl
          ? '<label class="check"><input type="checkbox" data-field="removePhoto"> 사진 삭제</label>'
          : '') +
        '<label class="filepick filepick--sm"><input type="file" accept="image/*" data-field="photo" hidden>' +
          '<span>사진 교체</span></label>' +
        '<p class="hint" data-role="photoName"></p>' +
        (state.boot.config.JOURNAL_REQUIRE_APPROVAL && item.status === '승인'
          ? '<p class="hint">수정하면 다시 운영진 확인을 거칩니다.</p>' : '') +
        '<div class="jcard__actions">' +
          '<button type="button" class="btn btn--primary btn--sm" data-act="save">저장</button>' +
          '<button type="button" class="btn btn--ghost btn--sm" data-act="cancel">취소</button>' +
        '</div>' +
      '</div>' +
    '</article>';
  }

  function onJournalAction(e) {
    var btn = e.target.closest('[data-act]');
    var card = e.target.closest('[data-id]');
    if (!card) return;
    var id = card.getAttribute('data-id');

    // 수정 폼 안의 사진 선택
    if (e.target.matches('[data-field="photo"]')) return;

    if (!btn) return;
    var act = btn.getAttribute('data-act');

    if (act === 'edit') {
      state.editing = id;
      paintJournalList({ galleryScope: state.boot.config.GALLERY_SCOPE });
      bindEditPhoto(id);
      return;
    }
    if (act === 'cancel') {
      state.editing = null;
      state.pendingPhoto = null;
      paintJournalList({ galleryScope: state.boot.config.GALLERY_SCOPE });
      return;
    }
    if (act === 'delete') {
      UI.confirmDialog('이 기록을 삭제할까요?\n사진도 함께 지워집니다.', '삭제').then(function (yes) {
        if (!yes) return;
        API.journalDelete(id)
          .then(function () {
            state.journal.items = state.journal.items.filter(function (i) { return i.id !== id; });
            paintJournalList({ galleryScope: state.boot.config.GALLERY_SCOPE });
            toast('삭제했습니다.');
          })
          .catch(function (err) { toast(err.message, 'error'); });
      });
      return;
    }
    if (act === 'save') {
      var payload = {
        id: id,
        text: card.querySelector('[data-field="text"]').value.trim(),
        checkpoint: card.querySelector('[data-field="checkpoint"]').value
      };
      var removeBox = card.querySelector('[data-field="removePhoto"]');
      if (removeBox && removeBox.checked) payload.removePhoto = true;
      if (state.pendingPhoto) {
        payload.photo = {
          name: state.pendingPhoto.name,
          mimeType: state.pendingPhoto.mimeType,
          dataBase64: state.pendingPhoto.dataBase64
        };
      }

      UI.setBusy(btn, true, '저장 중…');
      API.journalUpdate(payload)
        .then(function (updated) {
          state.editing = null;
          state.pendingPhoto = null;
          state.journal.items = state.journal.items.map(function (i) { return i.id === id ? updated : i; });
          paintJournalList({ galleryScope: state.boot.config.GALLERY_SCOPE });
          toast('수정했습니다.');
        })
        .catch(function (err) {
          UI.setBusy(btn, false);
          toast(err.message, 'error');
        });
    }
  }

  function bindEditPhoto(id) {
    var card = document.querySelector('.jcard--editing[data-id="' + CSS.escape(id) + '"]');
    if (!card) return;
    var input = card.querySelector('[data-field="photo"]');
    var label = card.querySelector('[data-role="photoName"]');
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;
      UI.resizePhoto(file)
        .then(function (photo) {
          state.pendingPhoto = photo;
          label.textContent = '새 사진 선택됨 · ' + Math.round(photo.approxBytes / 1024) + 'KB';
        })
        .catch(function (err) { toast(err.message, 'error'); });
    });
  }

  // ------------------------------------------------------------ 내 정보

  function renderMe() {
    var me = state.me;
    var showFee = state.boot.config.SHOW_FEE;

    setView(
      '<section class="card">' +
        '<h2 class="card__title">내 정보</h2>' +
        '<dl class="kv">' +
          '<div><dt>' + esc(L('name', '이름')) + '</dt><dd>' + esc(me.participant.name) + '</dd></div>' +
          '<div><dt>' + esc(L('audience', '캠프 대상')) + '</dt><dd>' +
            esc(me.participant.audience || '-') + '</dd></div>' +
          '<div><dt>' + esc(L('session', '참여 일자')) + '</dt><dd>' +
            esc(me.participant.session) + '</dd></div>' +
          '<div><dt>' + esc(L('group', '조 배정')) + '</dt><dd>' +
            esc(me.team ? me.team.name : (modeOf(me) === 'station' || modeOf(me) === 'ops' ? '운영진 (조 없음)' : '미배정')) + '</dd></div>' +
          (me.station ? '<div><dt>담당 지점</dt><dd>' + esc(me.station.name || me.station.code) + '</dd></div>' : '') +
          '<div><dt>' + esc(L('role', '역할')) + '</dt><dd>' + esc(me.participant.role) + '</dd></div>' +
          '<div><dt>' + esc(L('insurance', '여행자 보험 가입')) + '</dt><dd>' +
            esc(me.participant.insurance || '확인 중') + '</dd></div>' +
        '</dl>' +
      '</section>' +
      (showFee ? '<section class="card" id="feeCard"><h2 class="card__title">' +
        esc(L('feeStatus', '입금 여부')) + '</h2><p class="loading">불러오는 중…</p></section>' : '') +
      (me.isLeader && me.members.length
        ? '<section class="card"><h2 class="card__title">우리 조 (' + me.members.length + '명)</h2>' +
          '<ul class="members">' + me.members.map(function (m) {
            return '<li><span>' + esc(m.name) + '</span>' +
              (m.role !== '일반' ? '<span class="badge">' + esc(m.role) + '</span>' : '') +
              (showFee ? '<span class="chip chip--' + feeClass(m.feeStatus) + '">' + esc(m.feeStatus) + '</span>' : '') +
              '</li>';
          }).join('') + '</ul></section>'
        : '') +
      '<button type="button" class="btn btn--ghost btn--block" id="logoutBtn">로그아웃</button>'
    );

    $('#logoutBtn').addEventListener('click', function () {
      UI.confirmDialog('로그아웃할까요?', '로그아웃').then(function (yes) {
        if (!yes) return;
        API.logout();
        forgetLogin();          // 기기를 넘기는 신호로 본다
        state.me = null;
        state.view = 'home';
        render();
      });
    });

    if (showFee) {
      API.feeStatus()
        .then(function (fee) {
          var card = $('#feeCard');
          if (!card) return;
          card.innerHTML = '<h2 class="card__title">' + esc(L('feeStatus', '입금 여부')) + '</h2>' +
            '<p class="fee"><span class="chip chip--' + feeClass(fee.me.status) + '">' +
            esc(fee.me.status) + '</span></p>' +
            '<p class="hint">회비 수납은 운영진이 관리합니다. 문의는 행정팀으로 부탁드립니다.</p>';
        })
        .catch(function (err) {
          var card = $('#feeCard');
          if (card) card.innerHTML = '<h2 class="card__title">' + esc(L('feeStatus', '입금 여부')) +
            '</h2><p class="empty">' + esc(err.message) + '</p>';
        });
    }
  }

  function feeClass(status) {
    return status === '완납' ? 'done' : status === '면제' ? 'here' : 'wait';
  }

  // ------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', init);
})();
