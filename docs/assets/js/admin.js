/**
 * admin.js — 운영 콘솔 (관리자 PIN)
 *
 * 화면: 일지 검수 / 진행 현황 / 회비 / 설정
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
    cache: { review: null, progress: null, fee: null }
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
    else if (state.view === 'progress') renderProgress();
    else if (state.view === 'fee') renderFee();
    else if (state.view === 'settings') renderSettings();
  }

  function setView(html) { $('#view').innerHTML = html; }

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
      return state.jstatus === '전체' || it.status === state.jstatus;
    });
    var waiting = data.items.filter(function (it) { return it.status === '대기'; }).length;

    setView(
      '<section class="section-head"><h2>탐험일지 관리</h2>' +
        '<p class="hint">검수 대기 ' + waiting + '건 · 전체 ' + data.total + '건. ' +
        '승인해야 갤러리에 보입니다. 초상권·개인정보가 드러나는 사진은 반려해 주세요.</p></section>' +
      statusFilterHtml() +
      (items.length
        ? '<div class="grid">' + items.map(reviewCard).join('') + '</div>'
        : '<p class="empty">해당하는 일지가 없습니다.</p>')
    );
    bindStatusFilter(function () { paintReview(data); });
    $('#view').addEventListener('click', onReviewClick);
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

  // ------------------------------------------------------------ 진행 현황

  function renderProgress() { loadThenPaint('progress', 'admin.progress.board', paintProgress); }

  function paintProgress(board) {
        var teams = board.teams.filter(function (t) {
          return matchesAudience(t.audience) && matchesSession(t.session);
        });

        setView(
          '<section class="section-head"><h2>' + esc(L('group', '조 배정')) + '별 진행 현황</h2>' +
            '<p class="hint">조장이 기록한 도착·완료 상태입니다. 조마다 배정 코스가 달라 방문 순서가 다릅니다.</p></section>' +
          sessionFilterHtml() +
          audienceFilterHtml() +
          (teams.length
            ? '<div class="card"><div class="table-scroll"><table class="admin-table">' +
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
              '</tbody></table></div></div>'
            : '<p class="empty">' + (state.audience === '전체'
                ? '명단에 조가 배정된 참가자가 아직 없습니다.'
                : esc(state.audience) + '에 배정된 조가 없습니다.') + '</p>')
        );
        bindSessionFilter(function () { paintProgress(board); });
        bindAudienceFilter(function () { paintProgress(board); });
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
        invalidate('review'); invalidate('progress'); invalidate('fee');
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
