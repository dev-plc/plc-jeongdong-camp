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
    editing: null        // 수정 중인 일지 id
  };

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

    if (state.view === 'home') renderHome();
    else if (state.view === 'course') renderCourse();
    else if (state.view === 'journal') renderJournal();
    else if (state.view === 'me') renderMe();
  }

  function setView(html) {
    $('#view').innerHTML = html;
    $('#view').scrollTop = 0;
  }

  // ------------------------------------------------------------ 로그인

  function renderLogin() {
    var c = (state.boot && state.boot.config) || {};
    setView(
      '<section class="hero">' +
        '<p class="hero__eyebrow">역사와 신앙의 현장을 직접 걸으며 배우는</p>' +
        '<h1 class="hero__title">' + esc(c.CAMP_NAME || '정동, 신앙탐험대') + '</h1>' +
        '<p class="hero__sub">' + esc(c.CAMP_SUBTITLE || 'PLC 성경적세계관 캠프') + '</p>' +
      '</section>' +
      '<form id="loginForm" class="card card--form" autocomplete="off">' +
        '<h2 class="card__title">참가자 확인</h2>' +
        '<p class="hint">신청하신 ' + esc(L('name', '이름')) + '과(와) ' +
          esc(L('phone', '연락처')) + ' 뒷 4자리로 들어갑니다.</p>' +
        '<label class="field"><span class="field__label">' + esc(L('name', '이름')) + '</span>' +
          '<input class="input" type="text" name="name" placeholder="홍길동" required></label>' +
        '<label class="field"><span class="field__label">' + esc(L('phone', '연락처')) + ' 뒷 4자리</span>' +
          '<input class="input" type="tel" name="last4" inputmode="numeric" pattern="[0-9]{4}" ' +
          'maxlength="4" placeholder="5678" required></label>' +
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
      API.login(
        '',
        form.name.value.trim(),
        form.last4.value.trim()
      )
        .then(function (data) {
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

  function renderHome() {
    var me = state.me;
    var team = me.team;
    var notices = (state.boot.notices || []).filter(function (n) {
      return n.target === '전체' ||
        n.target === me.participant.session ||
        n.target === me.participant.audience;
    });
    var rows = (state.boot.timeline && state.boot.timeline[me.participant.session]) || [];

    setView(
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
      '</section>' +

      (notices.length ? '<section class="card"><h2 class="card__title">공지</h2>' +
        notices.map(function (n) {
          return '<article class="notice' + (n.pinned ? ' notice--pinned' : '') + '">' +
            '<h3>' + esc(n.title) + '</h3>' +
            '<p>' + nl2br(esc(n.body)) + '</p></article>';
        }).join('') + '</section>' : '') +

      '<section class="card"><h2 class="card__title">오늘 일정</h2>' +
        (rows.length
          ? '<ol class="timeline">' + rows.map(function (r) {
              return '<li class="timeline__row">' +
                '<span class="timeline__time">' + esc(r.start) + (r.end ? '–' + esc(r.end) : '') + '</span>' +
                '<span class="timeline__body"><strong>' + esc(r.title) + '</strong>' +
                (r.place ? '<em>' + esc(r.place) + '</em>' : '') +
                (r.note ? '<span class="timeline__note">' + esc(r.note) + '</span>' : '') +
                '</span></li>';
            }).join('') + '</ol>'
          : '<p class="empty">일정이 아직 등록되지 않았습니다.</p>') +
      '</section>'
    );
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
        paintCourse();
      })
      .catch(function (err) {
        setView('<p class="empty">' + esc(err.message) + '</p>');
      });
  }

  function paintCourse() {
    var byCode = {};
    (state.boot.checkpoints || []).forEach(function (c) { byCode[c.code] = c; });
    var canEdit = state.me.isLeader && state.boot.config.PROGRESS_OPEN;

    var cards = state.progress.map(function (p) {
      var cp = byCode[p.checkpoint] || { name: p.checkpoint };
      var mapUrl = cp.lat && cp.lng
        ? 'https://map.kakao.com/link/map/' + encodeURIComponent(cp.name) + ',' + cp.lat + ',' + cp.lng
        : 'https://map.kakao.com/link/search/' + encodeURIComponent(cp.name);

      // 화면은 이미 바뀌었지만 아직 서버에 안 갔다 — 그 사실을 숨기지 않는다.
      // data-score 는 **표시가 아니라 확인용**이다. 점수·메모는 화면에 안 나와서
      // 상태 변경이 그 값을 지우던 버그가 오래 드러나지 않았다(D-039).
      // 테스트와 현장 점검이 값을 볼 수 있게 속성 하나만 싣는다.
      return '<article class="cp cp--' + statusClass(p.status) + (p.pending ? ' is-saving' : '') + '"' +
        ' data-score="' + esc(p.score === null || p.score === undefined ? '' : p.score) + '">' +
        '<header class="cp__head">' +
          '<span class="cp__no">' + p.visitOrder + '</span>' +
          '<div><h3 class="cp__name">' + esc(cp.name) + '</h3>' +
          (cp.summary ? '<p class="cp__sum">' + esc(cp.summary) + '</p>' : '') + '</div>' +
          '<span class="chip chip--' + statusClass(p.status) + '">' + esc(p.status) +
          (p.pending ? ' · 저장 중' : '') + '</span>' +
        '</header>' +
        (cp.description ? '<p class="cp__desc">' + nl2br(esc(cp.description)) + '</p>' : '') +
        (cp.mission ? '<p class="cp__mission"><strong>미션</strong> ' + esc(cp.mission) + '</p>' : '') +
        (p.arrivedAt || p.completedAt
          ? '<p class="cp__times">' +
            (p.arrivedAt ? '도착 ' + esc(UI.hhmm(p.arrivedAt)) : '') +
            (p.completedAt ? ' · 완료 ' + esc(UI.hhmm(p.completedAt)) : '') + '</p>'
          : '') +
        '<div class="cp__links">' +
          '<a class="btn btn--ghost btn--sm" href="' + esc(mapUrl) + '" target="_blank" rel="noopener">지도</a>' +
          (cp.quizUrl
            ? '<a class="btn btn--ghost btn--sm" href="' + esc(cp.quizUrl) + '" target="_blank" rel="noopener">퀴즈 열기</a>'
            : '') +
          (cp.openHours ? '<span class="cp__hours">' + esc(cp.openHours) + '</span>' : '') +
        '</div>' +
        (canEdit
          ? '<div class="cp__actions" data-cp="' + esc(p.checkpoint) + '">' +
            ['대기', '도착', '완료'].map(function (s) {
              return '<button type="button" class="btn btn--sm' +
                (p.status === s ? ' btn--primary' : ' btn--ghost') +
                '" data-status="' + s + '">' + s + '</button>';
            }).join('') +
            '</div>'
          : '') +
        '</article>';
    }).join('');

    setView(
      '<section class="section-head"><h2>답사 코스</h2>' +
        '<p class="hint">우리 조 순서대로 표시됩니다.' +
        (state.me.isLeader
          ? (state.boot.config.PROGRESS_OPEN ? ' 조장은 각 지점 상태를 기록할 수 있습니다.' : ' 진행 기록은 마감되었습니다.')
          : ' 상태는 조장이 기록합니다.') + '</p></section>' +
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

  var progressSeq = 0;      // 늦게 온 옛 응답이 새 화면을 덮지 않게 한다

  /**
   * 서버가 할 일을 **그대로** 흉내 낸다 (gas/Code.gs 의 progressSet_).
   * 규칙이 어긋나면 응답이 왔을 때 화면이 튄다.
   *
   * · 도착·완료는 **최초 시각만** 남긴다 (되돌렸다 다시 눌러도 처음 시각 유지)
   * · 대기는 둘 다 비운다
   * · 🔴 점수·메모는 **건드리지 않는다.** 보내지 않았으니 서버도 손대지 않는다.
   *   (예전에는 서버가 덮어써서 여기서도 비웠다 — 그 손실을 서버에서 고쳤다.)
   */
  function applyProgressLocal(list, code, status) {
    var now = UI.localIso();
    return list.map(function (p) {
      if (p.checkpoint !== code) return p;
      var next = Object.assign({}, p, { status: status, pending: true });
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

  function onProgressClick(e) {
    var btn = e.target.closest('[data-status]');
    if (!btn) return;
    var wrap = btn.closest('[data-cp]');
    var code = wrap.getAttribute('data-cp');
    var status = btn.getAttribute('data-status');

    var previous = state.progress;          // 롤백용
    var seq = ++progressSeq;

    state.progress = applyProgressLocal(state.progress, code, status);
    paintCourse();

    API.progressSet(code, status)
      .then(function (list) {
        if (seq !== progressSeq) return;    // 더 최신 요청이 있다 → 옛 응답은 버린다
        state.progress = list;              // 권위는 서버다
        paintCourse();
        toast('기록했습니다: ' + status);
      })
      .catch(function (err) {
        if (seq !== progressSeq) return;
        state.progress = previous;          // 🔴 되돌린다
        paintCourse();
        toast(err.message, 'error');
      });
  }

  function statusClass(status) {
    return status === '완료' ? 'done' : status === '도착' ? 'here' : 'wait';
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
            esc(me.team ? me.team.name : '미배정') + '</dd></div>' +
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
