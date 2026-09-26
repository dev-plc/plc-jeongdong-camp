/**
 * ────────────────────────────────────────────────────────────────
 * admin.js · v16 · 2026-09-26
 * ────────────────────────────────────────────────────────────────
 * 변경 이력 (최근 5건 — 전체는 docs-dev/spec/DECISIONS.md · git log)
 *  v16   2026-09-26  진행 칸 정정, 🏆 시상, 일지 일괄 승인 (D-052)
 *  v15.1 2026-09-26  진행표를 조별 카드로 + 40분 무소식 ⚠ (D-050)
 *  v15   2026-09-26  파일 버전 표시 시작
 *  v14   2026-09-22  공지를 운영콘솔에서 쓴다
 *  v12   2026-09-22  반려된 일지를 다시 낼 수 있게 + 운영콘솔 편의 네 가지
 *
 * 버전: vN = GAS 배포 번호. vN.k = 서버는 vN 그대로 두고 앱·도구만 고친 k번째.
 *       — 는 버전 기록을 시작하기 전(v12 이전)의 변경.
 * 🔴 이 파일을 고치면 맨 위 줄(이름·버전·날짜)과 이력을 함께 고친다 (CLAUDE.md).
 * ────────────────────────────────────────────────────────────────
 */

/**
 * admin.js — 운영 콘솔 (관리자 PIN)
 *
 * 화면: 일지 검수 / 공지 / 진행 현황 / 시상 / 회비 / 설정
 * 참가자 앱과 같은 브라우저에서 동시에 쓰는 일이 많으므로 토큰 저장 키를 분리한다.
 * (api.js 가 APP_CONFIG.TOKEN_KEY 를 호출 시점에 읽으므로 여기서 덮어써도 안전하다.)
 */
(function () {
  'use strict';

  APP_CONFIG.TOKEN_KEY = 'plc_jd_admin_token';

  var $ = UI.$, esc = UI.esc, nl2br = UI.nl2br, toast = UI.toast;

  var state = {
    boot: null, view: 'review', authed: false,
    audience: '전체', session: '전체',
    jstatus: '대기',        // 일지 관리의 상태 필터. 기본은 지금 하던 일(검수대기)
    // 🔴 화면당 한 번만 가져오고, 필터는 **이 데이터로** 돈다 (D-046).
    //    예전에는 필터를 누를 때마다 서버를 다시 불렀다.
    editingNotice: null,   // 수정 중인 공지 id (null 이면 새로 쓰기)
    photoOnly: false,      // 일지 관리 — 사진 있는 글만 (D-052)
    present: false,        // 시상 — 크게 보기(발표용)
    cache: { review: null, progress: null, fee: null, notice: null, awards: null }
  };

  /** 항목 이름은 서버가 내려주는 마스터시트 헤더를 그대로 쓴다(bootstrap.labels). */
  function L(key, fallback) {
    var labels = (state.boot && state.boot.labels) || {};
    return labels[key] || fallback;
  }

  function init() {
    UI.perfPanel();          // ?perf=1 일 때만 뜬다 (D-030)
    $('#tabbar').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-view]');
      if (!btn) return;
      // 🔴 탭을 옮기면 그 화면 캐시를 버린다. "다시 보려고 눌렀는데 옛 값" 이면 안 된다.
      state.view = btn.getAttribute('data-view');
      state.cache[state.view] = null;
      state.editingNotice = null;
      state.present = false;
      document.body.classList.remove('is-present');
      render();
    });

    API.bootstrap(true)
      .then(function (boot) {
        state.boot = boot;
        if (!API.getToken()) return null;
        // 토큰이 아직 유효한지 가벼운 호출로 확인한다.
        return API.call('admin.journal.pending').then(function () { state.authed = true; });
      })
      .catch(function () { state.authed = false; })
      .then(render);
  }

  function render() {
    $('#tabbar').hidden = !state.authed;
    if (!state.authed) { renderLogin(); return; }

    UI.$$('#tabbar [data-view]').forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-view') === state.view);
    });

    if (state.view === 'review') renderReview();
    else if (state.view === 'notice') renderNotice();
    else if (state.view === 'progress') renderProgress();
    else if (state.view === 'awards') renderAwards();
    else if (state.view === 'fee') renderFee();
    else if (state.view === 'settings') renderSettings();
  }

  /**
   * 🔴 **클릭 핸들러는 `setView` 가 소유한다** (D-048).
   *
   * `#view` 는 살아남고 `innerHTML` 만 갈리므로, 그릴 때마다 `addEventListener` 를
   * 부르면 리스너가 **쌓인다.** 일지 검수에서 상태 필터를 세 번 누르고 승인을
   * 누르면 승인 요청이 세 번 나갔다 — 공지 삭제 테스트가 모달 두 개로 이것을 잡았다.
   * 이전 것을 떼고 새로 단다.
   */
  var viewClick = null;

  function setView(html, onClick) {
    var v = $('#view');
    if (viewClick) v.removeEventListener('click', viewClick);
    viewClick = onClick || null;
    v.innerHTML = html;
    if (viewClick) v.addEventListener('click', viewClick);
  }

  /**
   * 🔴 **가져오기와 그리기를 나눈다** (D-046).
   *
   * 예전에는 필터 버튼이 `renderProgress`(가져오기 + 그리기)를 불러서, 부서를
   * 바꿀 때마다 서버를 다시 쳤다. 이제 화면당 한 번만 가져오고 필터는 캐시로 돈다.
   *
   * @param {string} key   state.cache 의 키 (화면 이름)
   * @param {string} action 서버 액션
   * @param {Function} paint 캐시를 받아 그리는 함수
   */
  function loadThenPaint(key, action, paint) {
    if (state.cache[key]) { paint(state.cache[key]); return; }
    setView('<p class="loading">불러오는 중…</p>');
    API.call(action)
      .then(function (data) { state.cache[key] = data; paint(data); })
      .catch(function (err) { setView('<p class="empty">' + esc(err.message) + '</p>'); });
  }

  /** 쓰기 뒤에는 캐시를 버린다. 옛 목록을 그리면 화면이 거짓말한다. */
  function invalidate(key) { state.cache[key] = null; }

  /**
   * 부서 필터.
   * 원칙은 부서=일자 1:1 이지만 예외 인원이 섞일 수 있어(D-016) 조가 `혼합` 으로
   * 잡힐 수 있다. `혼합` 조는 어느 부서를 골라도 보이게 해서 누락되지 않도록 한다.
   */
  function audienceFilterHtml() {
    return '<div class="tabs" id="audienceFilter">' +
      ['전체', '청년부', '장년부'].map(function (a) {
        return '<button type="button" class="tab' + (state.audience === a ? ' is-active' : '') +
          '" data-audience="' + esc(a) + '">' + esc(a) + '</button>';
      }).join('') +
      '</div>';
  }

  function bindAudienceFilter(rerender) {
    var el = $('#audienceFilter');
    if (!el) return;
    el.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-audience]');
      if (!btn) return;
      state.audience = btn.getAttribute('data-audience');
      rerender();
    });
  }

  function matchesAudience(value) {
    if (state.audience === '전체') return true;
    var v = String(value || '');
    return v === state.audience || v.indexOf('혼합') >= 0 || v.indexOf(state.audience) >= 0;
  }

  // ---------------------------------------------------------------- 회차 필터
  //
  // 부서 필터만 있어서 사전답사를 따로 볼 수가 없었다. 회차는 Config 가 정하므로
  // 목록을 박지 않고 boot.sessions 를 그대로 쓴다 — 회차를 늘려도 따라온다 (D-026).
  // 기본값은 **전체**다. 지금까지의 동작과 같아 놀랄 일이 없다 (D-031).

  function sessionFilterHtml() {
    var list = (state.boot && state.boot.sessions) || [];
    if (list.length < 2) return '';   // 회차가 하나뿐이면 고를 것이 없다

    return '<div class="tabs" id="sessionFilter">' +
      '<button type="button" class="tab' + (state.session === '전체' ? ' is-active' : '') +
        '" data-session="전체">전체</button>' +
      list.map(function (s) {
        // 비활성 회차도 **보여 준다.** 운영진은 데이터를 계속 확인해야 한다.
        return '<button type="button" class="tab' +
          (state.session === s.label ? ' is-active' : '') +
          (s.active === false ? ' is-off' : '') +
          '" data-session="' + esc(s.label) + '">' + esc(s.label) +
          (s.active === false ? '<small>비활성</small>' : '') + '</button>';
      }).join('') +
      '</div>';
  }

  function bindSessionFilter(rerender) {
    var el = $('#sessionFilter');
    if (!el) return;
    el.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-session]');
      if (!btn) return;
      state.session = btn.getAttribute('data-session');
      rerender();
    });
  }

  function matchesSession(value) {
    if (state.session === '전체') return true;
    return String(value || '') === state.session;
  }

  // ------------------------------------------------------------ 로그인

  function renderLogin() {
    setView(
      '<form id="pinForm" class="card card--form" autocomplete="off">' +
        '<h2 class="card__title">관리자 확인</h2>' +
        '<p class="hint">운영진에게 공유된 PIN 을 입력해 주세요.</p>' +
        '<label class="field"><span class="field__label">PIN</span>' +
          '<input class="input" type="password" name="pin" inputmode="numeric" autocomplete="off" required></label>' +
        '<button class="btn btn--primary btn--block" type="submit">들어가기</button>' +
      '</form>'
    );

    $('#pinForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = e.target.querySelector('button');
      UI.setBusy(btn, true, '확인 중…');
      API.call('admin.login', { pin: e.target.pin.value }, { anonymous: true })
        .then(function (data) {
          API.setToken(data.token);
          state.authed = true;
          render();
        })
        .catch(function (err) {
          UI.setBusy(btn, false);
          toast(err.message, 'error');
        });
    });
  }

  // ------------------------------------------------------------ 일지 검수

  // 🔴 예전에는 `admin.journal.pending`(대기만)을 불러서 **승인·반려된 글을 아예
  // 볼 수 없었다.** 잘못 올라간 사진을 뒤늦게 지우려 해도 방법이 없었다 (D-046).
  var JSTATUS = [['대기', '검수 대기'], ['전체', '전체'], ['승인', '승인'], ['반려', '반려']];

  function statusFilterHtml() {
    // 회차·부서 필터와 **같은 모양**으로. 새 스타일을 만들지 않는다.
    return '<div class="tabs" id="statusFilter">' +
      JSTATUS.map(function (pair) {
        return '<button type="button" class="tab' +
          (state.jstatus === pair[0] ? ' is-active' : '') +
          '" data-jstatus="' + esc(pair[0]) + '">' + esc(pair[1]) + '</button>';
      }).join('') + '</div>';
  }

  function bindStatusFilter(repaint) {
    var el = $('#statusFilter');
    if (!el) return;
    el.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-jstatus]');
      if (!btn) return;
      state.jstatus = btn.getAttribute('data-jstatus');
      repaint();
    });
  }

  function renderReview() { loadThenPaint('review', 'admin.journal.list', paintReview); }

  function paintReview(data) {
    var items = data.items.filter(function (it) {
      return (state.jstatus === '전체' || it.status === state.jstatus) &&
        (!state.photoOnly || it.photoUrl);
    });
    var waiting = data.items.filter(function (it) { return it.status === '대기'; }).length;
    // 🔴 일괄 승인은 **지금 보이는** 대기 글만 — 필터로 걸러 둔 글까지 승인하면 안 된다 (D-052)
    var shownWaiting = items.filter(function (it) { return it.status === '대기'; });

    setView(
      '<section class="section-head"><h2>탐험일지 관리</h2>' +
        '<p class="hint">검수 대기 ' + waiting + '건 · 전체 ' + data.total + '건. ' +
        '승인해야 갤러리에 보입니다. 초상권·개인정보가 드러나는 사진은 반려해 주세요.</p></section>' +
      statusFilterHtml() +
      '<div class="review-tools">' +
        '<button type="button" class="tab' + (state.photoOnly ? ' is-active' : '') + '" data-act="photoOnly">📷 사진 있는 글만</button>' +
        (shownWaiting.length > 1
          ? '<button type="button" class="btn btn--primary btn--sm" data-act="bulk" data-count="' + shownWaiting.length + '">' +
              '보이는 대기 ' + shownWaiting.length + '건 모두 승인</button>'
          : '') +
      '</div>' +
      (items.length
        ? '<div class="grid">' + items.map(reviewCard).join('') + '</div>'
        : '<p class="empty">해당하는 일지가 없습니다.</p>'),
      onReviewClick
    );
    bindStatusFilter(function () { paintReview(data); });
  }

  function reviewCard(item) {
    // 상태에 따라 할 수 있는 일이 다르다. 승인된 글에 '승인' 버튼을 또 두지 않는다.
    var acts = [];
    if (item.status !== '승인') {
      acts.push('<button type="button" class="btn btn--primary btn--sm" data-act="approve">승인</button>');
    }
    if (item.status !== '반려') {
      acts.push('<button type="button" class="btn btn--ghost btn--sm btn--danger-text" data-act="reject">반려</button>');
    }
    acts.push('<button type="button" class="btn btn--ghost btn--sm btn--danger-text" data-act="delete">삭제</button>');

    return '<article class="jcard" data-id="' + esc(item.id) + '" data-status="' + esc(item.status) + '">' +
      (item.photoUrl
        ? '<a class="jcard__photo" href="' + esc(item.photoUrl) + '" target="_blank" rel="noopener">' +
          '<img loading="lazy" src="' + esc(item.photoUrl) + '" alt="일지 사진"></a>'
        : '') +
      '<div class="jcard__body">' +
        '<p class="jcard__meta"><strong>' + esc(item.authorName) + '</strong> · ' +
          esc(item.session) + ' ' + esc(item.group) + ' · ' +
          '<time>' + esc(UI.prettyDateTime(item.createdAt)) + '</time> · ' +
          '<span class="chip chip--' + (item.status === '승인' ? 'done'
            : item.status === '반려' ? 'reject' : 'wait') + '">' + esc(item.status) + '</span></p>' +
        (item.text ? '<p class="jcard__text">' + nl2br(esc(item.text)) + '</p>' : '') +
        (item.status === '반려' && item.rejectReason
          ? '<p class="jcard__reject">반려 사유: ' + esc(item.rejectReason) + '</p>' : '') +
        '<div class="jcard__actions">' + acts.join('') + '</div>' +
      '</div>' +
    '</article>';
  }

  function onReviewClick(e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var act0 = btn.getAttribute('data-act');
    if (act0 === 'photoOnly') { state.photoOnly = !state.photoOnly; paintReview(state.cache.review); return; }
    if (act0 === 'bulk') { bulkApprove(btn); return; }
    var card = btn.closest('[data-id]');
    var id = card.getAttribute('data-id');
    var act = btn.getAttribute('data-act');

    if (act === 'approve') {
      submitReview(card, btn, { id: id, decision: '승인' });
    } else if (act === 'reject') {
      var reason = prompt('반려 사유를 적어 주세요. (작성자에게 보입니다)');
      if (reason === null) return;
      submitReview(card, btn, { id: id, decision: '반려', reason: reason });
    } else if (act === 'delete') {
      UI.confirmDialog('이 일지를 삭제할까요?\n사진도 함께 휴지통으로 갑니다.', '삭제').then(function (yes) {
        if (!yes) return;
        API.call('admin.journal.delete', { id: id })
          .then(function () { invalidate('review'); renderReview(); toast('삭제했습니다.'); })
          .catch(function (err) { toast(err.message, 'error'); });
      });
    }
  }

  /** 보이는 대기 글을 한 번에 승인 (D-052). 요청 하나 · 락 한 번. */
  function bulkApprove(btn) {
    var ids = UI.$$('#view .jcard[data-status="대기"]').map(function (el) { return el.getAttribute('data-id'); });
    if (!ids.length) return;
    UI.confirmDialog('보이는 대기 글 ' + ids.length + '건을 모두 승인할까요?\n승인하면 갤러리에 보입니다.', '모두 승인')
      .then(function (yes) {
        if (!yes) return;
        UI.setBusy(btn, true, '승인 중…');
        API.call('admin.journal.reviewBatch', { ids: ids, decision: '승인' })
          .then(function (r) {
            invalidate('review');
            renderReview();
            toast(r.approved.length + '건 승인했습니다.' +
              (r.skipped.length ? ' (' + r.skipped.length + '건은 이미 처리돼 건너뜀)' : ''));
          })
          .catch(function (err) { UI.setBusy(btn, false); toast(err.message, 'error'); });
      });
  }

  function submitReview(card, btn, payload) {
    UI.setBusy(btn, true, '처리 중…');
    API.call('admin.journal.review', payload)
      .then(function () {
        // 🔴 캐시를 버리고 다시 불러온다. 상태가 바뀌었으니 옛 목록을 그리면 거짓말이다.
        invalidate('review');
        renderReview();
        toast(payload.decision + ' 처리했습니다.');
      })
      .catch(function (err) { UI.setBusy(btn, false); toast(err.message, 'error'); });
  }

  // ------------------------------------------------------------ 공지 (D-048)
  //
  // 예전에는 `Config` 의 **상단 한 줄 공지**만 콘솔에서 고칠 수 있었다. 홈의 공지 카드는
  // `Notices` 탭에서 오는데, 그걸 쓰려면 시트를 열어야 했다 — 캠프 당일 폰으로는 무리다.

  function renderNotice() { loadThenPaint('notice', 'admin.notice.list', paintNotice); }

  function paintNotice(data) {
    var editing = state.editingNotice
      ? data.items.filter(function (n) { return n.id === state.editingNotice; })[0]
      : null;

    setView(
      '<section class="section-head"><h2>공지</h2>' +
        '<p class="hint">참가자 홈 화면에 카드로 뜹니다. 앱바 아래 <strong>한 줄 띠</strong>는 ' +
        '설정 탭의 "상단 한 줄 공지" 로 따로 관리합니다.</p></section>' +
      noticeFormHtml(data.targets, editing) +
      (data.items.length
        ? '<div class="grid">' + data.items.map(noticeCard).join('') + '</div>'
        : '<p class="empty">아직 올린 공지가 없습니다.</p>'),
      onNoticeClick
    );

    bindNoticeForm(data);
  }

  function noticeFormHtml(targets, editing) {
    var n = editing || {};
    return '<form id="noticeForm" class="card card--form">' +
      '<h2 class="card__title">' + (editing ? '공지 수정' : '새 공지') + '</h2>' +
      '<label class="field"><span class="field__label">대상</span>' +
        '<select class="input" name="target">' +
          (targets || ['전체']).map(function (t) {
            return '<option value="' + esc(t) + '"' +
              ((n.target || '전체') === t ? ' selected' : '') + '>' + esc(t) + '</option>';
          }).join('') +
        '</select></label>' +
      '<label class="field"><span class="field__label">제목</span>' +
        '<input class="input" type="text" name="title" maxlength="60" ' +
        'value="' + esc(n.title || '') + '" placeholder="점심 도시락 안내"></label>' +
      '<label class="field"><span class="field__label">내용</span>' +
        '<textarea class="input" name="body" rows="3" maxlength="500">' + esc(n.body || '') + '</textarea></label>' +
      '<label class="check"><input type="checkbox" name="pinned"' + (n.pinned ? ' checked' : '') + '> ' +
        '맨 위에 고정</label>' +
      '<label class="field"><span class="field__label">종료일시 <em>(비우면 무기한)</em></span>' +
        '<input class="input" type="datetime-local" name="endsAt" ' +
        'value="' + esc(toLocalInput(n.endsAt)) + '"></label>' +
      '<button class="btn btn--primary btn--block" type="submit">' +
        (editing ? '저장' : '올리기') + '</button>' +
      (editing
        ? '<button type="button" class="btn btn--ghost btn--block" data-act="cancel">취소</button>'
        : '') +
      // 🔴 대상은 앱에서 한 번 더 걸린다. 이걸 모르면 "올렸는데 안 보인다" 가 된다.
      '<p class="hint">대상이 <strong>전체</strong>가 아니면 그 ' +
        esc(L('session', '참여 일자')) + ' · ' + esc(L('audience', '캠프 대상')) +
        ' 참가자에게만 보입니다.</p>' +
      '</form>';
  }

  /** '2026-09-30T10:00:00+09:00' → '2026-09-30T10:00' (datetime-local 이 받는 모양) */
  function toLocalInput(iso) {
    var m = String(iso || '').match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
    return m ? m[1] + 'T' + m[2] : '';
  }

  function noticeCard(n) {
    var cls = n.status === '게시중' ? 'done' : n.status === '예약' ? 'wait' : 'reject';
    return '<article class="jcard" data-id="' + esc(n.id) + '" data-status="' + esc(n.status) + '">' +
      '<div class="jcard__body">' +
        '<p class="jcard__meta">' +
          '<span class="chip chip--' + cls + '">' + esc(n.status) + '</span> ' +
          '<strong>' + esc(n.target) + '</strong>' +
          (n.pinned ? ' · 📌 고정' : '') +
          (n.endsAt ? ' · ~' + esc(UI.prettyDateTime(n.endsAt)) : '') +
        '</p>' +
        (n.title ? '<h3 class="card__title">' + esc(n.title) + '</h3>' : '') +
        (n.body ? '<p class="jcard__text">' + nl2br(esc(n.body)) + '</p>' : '') +
        '<div class="jcard__actions">' +
          '<button type="button" class="btn btn--ghost btn--sm" data-act="edit">수정</button>' +
          '<button type="button" class="btn btn--ghost btn--sm btn--danger-text" data-act="delete">삭제</button>' +
        '</div>' +
      '</div>' +
    '</article>';
  }

  function bindNoticeForm(data) {
    var form = $('#noticeForm');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = form.querySelector('button[type="submit"]');
      UI.setBusy(btn, true, '저장 중…');
      API.call('admin.notice.save', {
        id: state.editingNotice || '',
        target: form.target.value,
        title: form.title.value.trim(),
        body: form.body.value.trim(),
        pinned: form.pinned.checked,
        endsAt: form.endsAt.value          // 빈 문자열이면 무기한으로 되돌린다
      })
        .then(function () {
          state.editingNotice = null;
          invalidate('notice');            // 옛 목록을 그리면 화면이 거짓말한다 (D-046)
          renderNotice();
          toast('공지를 올렸습니다.');
        })
        .catch(function (err) { UI.setBusy(btn, false); toast(err.message, 'error'); });
    });
  }

  function onNoticeClick(e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var act = btn.getAttribute('data-act');

    if (act === 'cancel') {
      state.editingNotice = null;
      paintNotice(state.cache.notice);     // 서버를 다시 부르지 않는다
      return;
    }
    var card = btn.closest('[data-id]');
    if (!card) return;
    var id = card.getAttribute('data-id');

    if (act === 'edit') {
      state.editingNotice = id;
      paintNotice(state.cache.notice);
      $('#view').scrollTop = 0;
      return;
    }
    if (act === 'delete') {
      UI.confirmDialog('이 공지를 지울까요?\n참가자 화면에서 바로 사라집니다.', '삭제').then(function (yes) {
        if (!yes) return;
        API.call('admin.notice.delete', { id: id })
          .then(function () {
            if (state.editingNotice === id) state.editingNotice = null;
            invalidate('notice');
            renderNotice();
            toast('지웠습니다.');
          })
          .catch(function (err) { toast(err.message, 'error'); });
      });
    }
  }

  // ------------------------------------------------------------ 진행 현황

  function renderProgress() { loadThenPaint('progress', 'admin.progress.board', paintProgress); }

  // 조별 카드는 교역자 화면과 같이 쓰므로 ui.js 에 있다 (UI.teamGrid, D-051).
  var STALE_MIN = UI.STALE_MIN;

  function progressTable(board, teams) {
    return '<div class="table-scroll"><table class="admin-table">' +
      '<thead><tr><th>' + esc(L('session', '참여 일자')) + '</th>' +
      '<th>' + esc(L('audience', '캠프 대상')) + '</th>' +
      '<th>' + esc(L('group', '조 배정')) + '</th><th>조장</th><th>인원</th>' +
      board.checkpoints.map(function (c) { return '<th>' + esc(c.name) + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      teams.map(function (t) {
        return '<tr>' +
          '<td>' + esc(t.session) + '</td>' +
          '<td>' + esc(t.audience || '—') + '</td>' +
          '<td>' + esc(t.name) + '</td>' +
          '<td>' + esc(t.leaderName || '—') + '</td>' +
          '<td>' + t.memberCount + '</td>' +
          board.checkpoints.map(function (c) {
            var cell = t.cells[c.code];
            var visit = t.route.indexOf(c.code);
            var order = visit >= 0 ? '<small>' + (visit + 1) + '번째</small><br>' : '';
            if (!cell) return '<td>' + order + '<span class="chip chip--wait">대기</span></td>';
            var cls = cell.status === '완료' ? 'done' : cell.status === '도착' ? 'here' : 'wait';
            var time = UI.hhmm(cell.completedAt || cell.arrivedAt);
            return '<td>' + order + '<span class="chip chip--' + cls + '">' + esc(cell.status) + '</span>' +
              (time ? ' <small>' + esc(time) + '</small>' : '') + '</td>';
          }).join('') +
        '</tr>';
      }).join('') +
      '</tbody></table></div>';
  }

  function paintProgress(board) {
        var teams = board.teams.filter(function (t) {
          return matchesAudience(t.audience) && matchesSession(t.session);
        });
        var grid = UI.teamGrid(teams, board.checkpoints, { showSession: state.session === '전체', editable: true });

        setView(
          '<section class="section-head"><h2>' + esc(L('group', '조 배정')) + '별 진행 현황</h2>' +
            '<p class="hint">조마다 배정 코스 순서대로 보입니다. 완주 전인데 ' + STALE_MIN +
            '분 넘게 새 기록이 없으면 ⚠ 가 붙습니다. 점수 옆 ✓ 는 스태프가 확인한 점수 · 칸을 누르면 고칠 수 있습니다.</p></section>' +
          sessionFilterHtml() +
          audienceFilterHtml() +
          (teams.length
            ? grid.html +
              '<details class="card board-table"><summary>표로 보기</summary>' +
                progressTable(board, teams) + '</details>'
            : '<p class="empty">' + (state.audience === '전체'
                ? '명단에 조가 배정된 참가자가 아직 없습니다.'
                : esc(state.audience) + '에 배정된 조가 없습니다.') + '</p>'),
          onProgressEdit
        );
        bindSessionFilter(function () { paintProgress(board); });
        bindAudienceFilter(function () { paintProgress(board); });
  }

  /**
   * 진행 칸 정정 (D-052). 예전에는 시트에서만 고칠 수 있었고, 시트 편집은 사본에 안 가서
   * 조장 화면이 옛 값을 보였다(캠프 모드가 필요했다). 여기서 고치면 사본까지 밀린다.
   */
  function onProgressEdit(e) {
    var btn = e.target.closest('[data-edit-code]');
    if (!btn) return;
    var board = state.cache.progress;
    var session = btn.getAttribute('data-edit-session');
    var group = btn.getAttribute('data-edit-group');
    var code = btn.getAttribute('data-edit-code');
    var team = board.teams.filter(function (t) { return t.session === session && t.group === group; })[0];
    var cp = board.checkpoints.filter(function (c) { return c.code === code; })[0] || { name: code };
    if (!team) return;
    var cell = team.cells[code] || {};
    var cur = cell.status || '대기';
    var hasScore = cell.score !== null && cell.score !== undefined && cell.score !== '';

    var wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.innerHTML =
      '<form class="modal__panel" id="cellForm" role="dialog" aria-modal="true">' +
        '<p class="modal__msg"><strong>' + esc(team.name) + '</strong> · ' + esc(cp.name) + '<br>' +
          '<span class="hint">' + esc(session) + ' · 지금 ' + esc(cur) +
          (hasScore ? ' · ' + esc(cell.score) + '점(' + esc(cell.scoreSource || '?') + ')' : '') + '</span></p>' +
        '<div class="seg">' + ['대기', '도착', '완료'].map(function (st) {
          return '<label class="seg__item"><input type="radio" name="status" value="' + st + '"' +
            (st === cur ? ' checked' : '') + '><span>' + st + '</span></label>';
        }).join('') + '</div>' +
        '<label class="field" style="margin-top:14px"><span class="field__label">퀴즈 점수 <em>(비우면 지웁니다)</em></span>' +
          '<input class="input" name="score" type="number" inputmode="numeric" min="0" max="100" value="' +
          (hasScore ? esc(cell.score) : '') + '"></label>' +
        '<p class="hint">여기서 넣은 점수는 "관리자" 출처로 남고, 조장·스태프 화면에도 바로 반영됩니다.</p>' +
        '<div class="modal__actions">' +
          '<button type="button" class="btn btn--ghost" data-act="cancel">취소</button>' +
          '<button type="submit" class="btn btn--primary">저장</button>' +
        '</div>' +
      '</form>';
    document.body.appendChild(wrap);

    function close() { wrap.remove(); }
    wrap.addEventListener('click', function (ev) {
      if (ev.target === wrap || ev.target.getAttribute('data-act') === 'cancel') close();
    });
    wrap.querySelector('#cellForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = ev.target;
      var status = (f.querySelector('input[name="status"]:checked') || {}).value;
      var raw = String(f.score.value).trim();
      var payload = { session: session, group: group, checkpoint: code };
      if (status && status !== cur) payload.status = status;
      var oldScore = hasScore ? String(cell.score) : '';
      if (raw !== oldScore) {
        var n = Number(raw);
        if (raw !== '' && (isNaN(n) || n < 0 || n > 100)) { toast('점수는 0~100 사이로 넣어 주세요.', 'error'); return; }
        payload.score = raw === '' ? '' : n;
      }
      if (payload.status === undefined && payload.score === undefined) { close(); return; }
      var submit = f.querySelector('button[type="submit"]');
      UI.setBusy(submit, true, '저장 중…');
      API.call('admin.progress.set', payload)
        .then(function (data) {
          close();
          state.cache.progress = data;
          paintProgress(data);
          toast(team.name + ' · ' + cp.name + ' 고쳤습니다.');
        })
        .catch(function (err) { UI.setBusy(submit, false); toast(err.message, 'error'); });
    });
  }

  // ------------------------------------------------------------ 🏆 시상 (D-052)
  //
  // 시상은 분야별이다(운영자 결정): 퀴즈 점수 · 소요 시간 · 사진(운영진이 ★ 지정).
  // 새 서버 집계를 만들지 않는다 — 진행 보드와 일지 목록을 **그대로** 받아 여기서 센다.
  // 같은 데이터를 두 곳에서 집계하면 하나는 반드시 어긋난다.

  function renderAwards() {
    if (state.cache.awards) { paintAwards(state.cache.awards); return; }
    setView('<p class="loading">불러오는 중…</p>');
    Promise.all([API.call('admin.progress.board'), API.call('admin.journal.list')])
      .then(function (r) {
        state.cache.awards = { board: r[0], journals: r[1].items || [] };
        paintAwards(state.cache.awards);
      })
      .catch(function (err) { setView('<p class="empty">' + esc(err.message) + '</p>'); });
  }

  /** 동점은 같은 순위 (1, 2, 2, 4). */
  function withRanks(list, key) {
    var rank = 0, prev = null;
    return list.map(function (x, i) {
      if (prev === null || x[key] !== prev) { rank = i + 1; prev = x[key]; }
      return Object.assign({ rank: rank }, x);
    });
  }

  function quizRanking(teams) {
    return withRanks(teams.map(function (t) {
      var sum = 0, n = 0, src = {};
      t.route.forEach(function (code) {
        var c = t.cells[code];
        if (!c || c.score === null || c.score === undefined || c.score === '') return;
        sum += Number(c.score); n++;
        var s = c.scoreSource || '미상';
        src[s] = (src[s] || 0) + 1;
      });
      return { team: t, sum: sum, n: n, total: t.route.length, src: src };
    }).filter(function (x) { return x.n > 0; })
      .sort(function (a, b) { return (b.sum - a.sum) || (b.n - a.n); }), 'sum');
  }

  /** 첫 지점 도착 → 마지막 지점 완료. **네 곳 모두 완료한 조만** — 출발 시차와 무관하다. */
  function timeRanking(teams) {
    return withRanks(teams.map(function (t) {
      var first = '', last = '', done = 0;
      t.route.forEach(function (code) {
        var c = t.cells[code] || {};
        if (c.status === '완료') done++;
        if (c.arrivedAt && (!first || c.arrivedAt < first)) first = c.arrivedAt;
        if (c.completedAt && c.completedAt > last) last = c.completedAt;
      });
      var ok = t.route.length > 0 && done === t.route.length && first && last;
      var min = ok ? Math.round((new Date(last) - new Date(first)) / 60000) : null;
      return { team: t, min: min, first: first, last: last };
    }).filter(function (x) { return x.min !== null && x.min >= 0; })
      .sort(function (a, b) { return a.min - b.min; }), 'min');
  }

  function durText(min) {
    var h = Math.floor(min / 60), m = min % 60;
    return (h ? h + '시간 ' : '') + m + '분';
  }

  function paintAwards(data) {
    var teams = data.board.teams.filter(function (t) { return matchesSession(t.session); });
    var showSession = state.session === '전체';
    var quiz = quizRanking(teams);
    var time = timeRanking(teams);
    var photos = data.journals.filter(function (j) {
      return j.status === '승인' && j.photoUrl && matchesSession(j.session);
    }).sort(function (a, b) { return (b.award ? 1 : 0) - (a.award ? 1 : 0); });
    var starred = photos.filter(function (j) { return j.award; });
    var top = state.present ? 3 : Infinity;
    var label = function (t) { return (showSession ? esc(t.session) + ' ' : '') + esc(t.name); };

    var quizHtml = quiz.length
      ? '<ol class="rank">' + quiz.filter(function (x) { return x.rank <= top; }).map(function (x) {
          var needCheck = Object.keys(x.src).some(function (k) { return k !== '스태프'; });
          return '<li class="rank__row"><span class="rank__no">' + x.rank + '</span>' +
            '<span class="rank__name">' + label(x.team) + '</span>' +
            '<span class="rank__val">' + x.sum + '점</span>' +
            (state.present ? '' : '<span class="rank__meta">' + x.n + '/' + x.total + '곳 · ' +
              Object.keys(x.src).map(function (k) { return esc(k) + ' ' + x.src[k]; }).join(' · ') +
              (needCheck ? ' · <strong>조장·관리자 입력 포함 — 확인</strong>' : '') + '</span>') +
            '</li>';
        }).join('') + '</ol>'
      : '<p class="empty">아직 입력된 점수가 없습니다.</p>';

    var timeHtml = time.length
      ? '<ol class="rank">' + time.filter(function (x) { return x.rank <= top; }).map(function (x) {
          return '<li class="rank__row"><span class="rank__no">' + x.rank + '</span>' +
            '<span class="rank__name">' + label(x.team) + '</span>' +
            '<span class="rank__val">' + durText(x.min) + '</span>' +
            (state.present ? '' : '<span class="rank__meta">' + esc(UI.hhmm(x.first)) + ' → ' + esc(UI.hhmm(x.last)) + '</span>') +
            '</li>';
        }).join('') + '</ol>' +
        (state.present ? '' : '<p class="hint">완주 전 ' + (teams.length - time.length) + '개 조는 순위에 없습니다.</p>')
      : '<p class="empty">네 곳을 모두 마친 조가 아직 없습니다.</p>';

    var shownPhotos = state.present ? starred : photos;
    var photoHtml = shownPhotos.length
      ? '<div class="award-grid">' + shownPhotos.map(function (j) {
          return '<figure class="award-photo' + (j.award ? ' is-award' : '') + '" data-id="' + esc(j.id) + '">' +
            '<img loading="lazy" src="' + esc(j.photoUrl) + '" alt="' + esc(j.authorName) + ' 사진">' +
            '<figcaption>' + (showSession ? esc(j.session) + ' ' : '') + esc(j.group) + ' · ' + esc(j.authorName) +
              (state.present ? '' : ' <button type="button" class="btn btn--sm ' + (j.award ? 'btn--primary' : 'btn--ghost') +
                '" data-award="' + (j.award ? '0' : '1') + '">' + (j.award ? '★ 수상' : '☆ 지정') + '</button>') +
            '</figcaption></figure>';
        }).join('') + '</div>'
      : '<p class="empty">' + (state.present ? '★ 수상작을 아직 고르지 않았습니다.' : '승인된 사진이 없습니다.') + '</p>';

    setView(
      '<section class="section-head"><h2>🏆 시상</h2>' +
        (state.present ? '' : '<p class="hint">분야별 — 퀴즈 점수 합계 · 소요 시간(첫 도착 → 마지막 완료, 네 곳 모두 마친 조만) · ' +
          '사진(★ 를 눌러 수상작 지정). 발표 때는 "크게 보기".</p>') + '</section>' +
      (state.present ? '' : sessionFilterHtml()) +
      '<div class="review-tools">' +
        '<button type="button" class="btn btn--sm ' + (state.present ? 'btn--primary' : 'btn--ghost') + '" data-present>' +
          (state.present ? '닫기' : '크게 보기') + '</button>' +
        (state.present ? '' : '<button type="button" class="btn btn--ghost btn--sm" data-reload>새로고침</button>') +
      '</div>' +
      '<section class="card award"><h3 class="card__title">🧩 퀴즈 점수</h3>' + quizHtml + '</section>' +
      '<section class="card award"><h3 class="card__title">⏱ 소요 시간</h3>' + timeHtml + '</section>' +
      '<section class="card award"><h3 class="card__title">📷 사진' +
        (state.present ? '' : ' <span class="hint">★ ' + starred.length + '장</span>') + '</h3>' + photoHtml + '</section>',
      onAwardsClick
    );
    bindSessionFilter(function () { paintAwards(data); });
  }

  function onAwardsClick(e) {
    if (e.target.closest('[data-present]')) {
      state.present = !state.present;
      document.body.classList.toggle('is-present', state.present);
      paintAwards(state.cache.awards);
      return;
    }
    if (e.target.closest('[data-reload]')) { invalidate('awards'); renderAwards(); return; }
    var btn = e.target.closest('[data-award]');
    if (!btn) return;
    var id = btn.closest('[data-id]').getAttribute('data-id');
    var on = btn.getAttribute('data-award') === '1';
    UI.setBusy(btn, true, '…');
    API.call('admin.journal.award', { id: id, award: on })
      .then(function (j) {
        state.cache.awards.journals = state.cache.awards.journals.map(function (x) {
          return x.id === j.id ? Object.assign({}, x, { award: j.award }) : x;
        });
        invalidate('review');
        paintAwards(state.cache.awards);
        toast(on ? '★ 수상작으로 지정했습니다.' : '지정을 풀었습니다.');
      })
      .catch(function (err) { UI.setBusy(btn, false); toast(err.message, 'error'); });
  }

  // ------------------------------------------------------------ 회비

  function renderFee() { loadThenPaint('fee', 'admin.fee.board', paintFee); }

  function paintFee(data) {
        var sum = data.summary;
        var teams = data.teams.filter(function (t) {
          return matchesAudience(t.audience) && matchesSession(t.session);
        });

        setView(
          '<section class="section-head"><h2>' + esc(L('feeStatus', '입금 여부')) + ' 현황</h2>' +
            '<p class="hint">수납 입력은 시트에서 합니다. 이 화면은 조회 전용입니다.</p></section>' +
          '<section class="card"><h2 class="card__title">전체</h2><dl class="kv">' +
            '<div><dt>완납</dt><dd>' + (sum['완납'] || 0) + '명</dd></div>' +
            '<div><dt>미납</dt><dd>' + (sum['미납'] || 0) + '명</dd></div>' +
            '<div><dt>면제</dt><dd>' + (sum['면제'] || 0) + '명</dd></div>' +
            '<div><dt>합계</dt><dd>' + (sum['합계'] || 0) + '명</dd></div>' +
            '<div><dt>수납액</dt><dd>' + won(sum['수납액']) + ' / ' + won(sum['예상수입']) + '</dd></div>' +
          '</dl><p class="hint">전체 합계는 필터와 무관하게 전원 기준입니다.</p></section>' +
          sessionFilterHtml() +
          audienceFilterHtml() +
          '<div class="card"><div class="table-scroll"><table class="admin-table">' +
            '<thead><tr><th>' + esc(L('session', '참여 일자')) + ' · ' + esc(L('group', '조 배정')) + '</th>' +
            '<th>' + esc(L('audience', '캠프 대상')) + '</th>' +
            '<th>완납</th><th>미납</th><th>면제</th>' +
            '<th>' + esc(L('insurance', '여행자 보험 가입')) + ' 미가입</th><th>미납자</th></tr></thead><tbody>' +
            teams.map(function (t) {
              return '<tr><td>' + esc(t.label) + '</td>' +
                '<td>' + esc(t.audience || '—') + '</td>' +
                '<td>' + (t['완납'] || 0) + '</td>' +
                '<td>' + (t['미납'] || 0) + '</td>' +
                '<td>' + (t['면제'] || 0) + '</td>' +
                '<td>' + (t['미가입'] || 0) + '</td>' +
                '<td>' + esc(t.unpaid.join(', ')) + '</td></tr>';
            }).join('') +
          '</tbody></table></div></div>'
        );
        bindSessionFilter(function () { paintFee(data); });
        bindAudienceFilter(function () { paintFee(data); });
  }

  function won(n) {
    return (Number(n) || 0).toLocaleString('ko-KR') + '원';
  }

  // ------------------------------------------------------------ 설정

  var TOGGLES = [
    ['JOURNAL_OPEN', '탐험일지 작성 열기'],
    ['PROGRESS_OPEN', '조장 진행 기록 열기'],
    ['JOURNAL_REQUIRE_APPROVAL', '일지 승인 필요'],
    ['SHOW_FEE', '회비 상태 노출']
  ];

  function renderSettings() {
    var c = state.boot.config;
    setView(
      '<section class="section-head"><h2>운영 설정</h2>' +
        '<p class="hint">배포 없이 바로 반영됩니다. 시트의 Config 탭과 같은 값입니다.</p></section>' +

      '<section class="card"><h2 class="card__title">탐험일지 공개 범위</h2>' +
        '<p class="hint">현재: <strong>' + esc(scopeLabel(c.GALLERY_SCOPE)) + '</strong></p>' +
        '<div class="seg" id="scopeSeg">' +
          [['ALL', '전체 공개'], ['TEAM', '같은 조만'], ['SELF', '본인만']].map(function (s) {
            return '<label class="seg__item"><input type="radio" name="scope" value="' + s[0] + '"' +
              (c.GALLERY_SCOPE === s[0] ? ' checked' : '') + '><span>' + s[1] + '</span></label>';
          }).join('') +
        '</div>' +
        '<p class="hint">전체 공개는 같은 ' + esc(L('session', '참여 일자')) + ' 안에서만 보입니다. ' +
          esc(L('audience', '캠프 대상')) + '이 달라도 같은 날 참여했다면 서로 보입니다.</p>' +
      '</section>' +

      '<section class="card"><h2 class="card__title">기능 열기 / 닫기</h2>' +
        '<ul class="members">' + TOGGLES.map(function (t) {
          return '<li><span>' + esc(t[1]) + '</span>' +
            '<button type="button" class="btn btn--sm ' + (c[t[0]] ? 'btn--primary' : 'btn--ghost') +
            '" data-toggle="' + t[0] + '">' + (c[t[0]] ? '켜짐' : '꺼짐') + '</button></li>';
        }).join('') + '</ul></section>' +

      '<section class="card"><h2 class="card__title">상단 한 줄 공지</h2>' +
        '<p class="hint">앱바 바로 아래 띠입니다. 홈 화면의 <strong>공지 카드</strong>는 ' +
          '<strong>공지</strong> 탭에서 따로 관리합니다.</p>' +
        '<label class="field"><input class="input" id="tickerInput" type="text" maxlength="120" ' +
          'value="' + esc(c.NOTICE_TICKER || '') + '" placeholder="비우면 숨겨집니다"></label>' +
        '<button type="button" class="btn btn--primary btn--block" id="tickerSave">저장</button>' +
      '</section>' +

      '<button type="button" class="btn btn--ghost btn--block" id="logoutBtn">로그아웃</button>'
    );

    $('#scopeSeg').addEventListener('change', function (e) {
      if (e.target.name !== 'scope') return;
      setConfig('GALLERY_SCOPE', e.target.value, '공개 범위를 바꿨습니다: ' + scopeLabel(e.target.value));
    });

    UI.$$('[data-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-toggle');
        var next = !state.boot.config[key];
        setConfig(key, next ? 'TRUE' : 'FALSE', null, btn);
      });
    });

    $('#tickerSave').addEventListener('click', function () {
      setConfig('NOTICE_TICKER', $('#tickerInput').value.trim(), '공지를 저장했습니다.', $('#tickerSave'));
    });

    $('#logoutBtn').addEventListener('click', function () {
      API.logout();
      state.authed = false;
      render();
    });
  }

  function scopeLabel(scope) {
    return scope === 'TEAM' ? '같은 조만' : scope === 'SELF' ? '본인만' : '전체 공개';
  }

  function setConfig(key, value, message, btn) {
    if (btn) UI.setBusy(btn, true, '…');
    API.call('admin.config.set', { key: key, value: value })
      .then(function (config) {
        state.boot.config = config;
        try { sessionStorage.removeItem('plc_jd_bootstrap'); } catch (e) { /* 무시 */ }
        // 설정이 바뀌면 다른 화면의 표도 달라질 수 있다(마감 여부·라벨 등).
        invalidate('review'); invalidate('progress'); invalidate('fee'); invalidate('notice');
        renderSettings();
        toast(message || '저장했습니다.');
      })
      .catch(function (err) {
        if (btn) UI.setBusy(btn, false);
        toast(err.message, 'error');
      });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
