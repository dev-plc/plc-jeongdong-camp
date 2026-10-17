/**
 * ────────────────────────────────────────────────────────────────
 * ui.js · v20.5 · 2026-10-17
 * ────────────────────────────────────────────────────────────────
 * 변경 이력 (최근 5건 — 전체는 docs-dev/spec/DECISIONS.md · git log)
 *  v20.5 2026-10-17  지도 주소 검색어 다듬기 — 괄호 메모·"대한민국" 을 뺀다 (D-061)
 *  v20.4 2026-10-17  미션 여러 줄 · ※ 주의 줄 강조 · 지도는 좌표 → 주소 → 이름 순 (D-061)
 *  v20.2 2026-10-17  조별 카드: 조를 숫자 순서로(10조는 9조 다음) · 지점을 한 줄씩 이름 전체로 (D-059)
 *  v20.1 2026-10-16  알림 5초(오류 6초) · 전화번호 링크 (D-058)
 *  v15   2026-09-26  파일 버전 표시 시작
 *
 * 버전: vN = GAS 배포 번호. vN.k = 서버는 vN 그대로 두고 앱·도구만 고친 k번째.
 *       — 는 버전 기록을 시작하기 전(v12 이전)의 변경.
 * 🔴 이 파일을 고치면 맨 위 줄(이름·버전·날짜)과 이력을 함께 고친다 (CLAUDE.md).
 * ────────────────────────────────────────────────────────────────
 */

/**
 * ui.js — DOM / 토스트 / 다이얼로그 / 사진 리사이즈 유틸
 */
(function (global) {
  'use strict';

  var CFG = global.APP_CONFIG;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /** 문자열을 HTML 에 안전하게 넣기 위한 이스케이프. 사용자 입력은 전부 이걸 통과시킨다. */
  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    }

  /** 줄바꿈을 <br> 로. 반드시 esc() 이후에 쓴다. */
  function nl2br(escaped) {
    return String(escaped).replace(/\n/g, '<br>');
  }

  /**
   * 전화번호를 눌러 거는 링크로. 반드시 esc() 이후에 쓴다 (nl2br 와 같은 규칙).
   * 010-1234-5678 · 01012345678 · 02-123-4567 · 031.123.4567 — 구분자는 앞뒤가 같아야 한다.
   * 숫자에 붙은 번호(날짜·시각 일부)는 건드리지 않는다.
   */
  function telLinks(escaped) {
    return String(escaped).replace(/(^|[^\d])(0\d{1,2})([-.]?)(\d{3,4})\3(\d{4})(?!\d)/g,
      function (all, pre, a, sep, b, c) {
        return pre + '<a class="tel" href="tel:' + a + b + c + '">' + a + sep + b + sep + c + '</a>';
      });
  }

  /**
   * 지점 미션 (D-061). 시트 `미션` 칸에 줄을 바꿔 적은 그대로 보인다.
   * `※` 나 `*` 로 시작하는 줄(주의·범위)은 눈에 띄게 한다 — 미션 카드의 빨간 글씨와 같은 역할.
   */
  function missionHtml(text) {
    var lines = String(text === null || text === undefined ? '' : text).replace(/\r/g, '').split('\n');
    var body = lines.map(function (line) {
      var t = line.trim();
      if (!t) return '';
      return /^[※*]/.test(t) ? '<span class="cp__mission-note">' + esc(t) + '</span>' : esc(t);
    }).filter(String).join('<br>');
    return body ? '<p class="cp__mission"><strong>미션</strong> ' + body + '</p>' : '';
  }

  /**
   * 지점 지도 링크 (D-061) — 카카오맵.
   * 시트에 위도·경도가 있으면 **그 자리에 핀**, 없으면 **주소로**, 주소도 없으면 이름으로 찾는다.
   * 이름 검색은 "보구여관" 이 마곡의 이대서울병원 보구녀관으로 가는 식으로 엉뚱한 곳이 먼저 뜬다.
   */
  function mapUrl(cp) {
    var name = (cp && cp.name) || '';
    var lat = Number(cp && cp.lat), lng = Number(cp && cp.lng);
    if (lat && lng && isFinite(lat) && isFinite(lng)) {
      return 'https://map.kakao.com/link/map/' + encodeURIComponent(name) + ',' + lat + ',' + lng;
    }
    var q = cleanAddress((cp && cp.address) || '') || name;
    return 'https://map.kakao.com/link/search/' + encodeURIComponent(q);
  }

  /**
   * 주소 칸을 검색어로 다듬는다 (D-061).
   * 시트 주소에 "(답사 시 확인)" 같은 **괄호 메모**가 붙어 있었고, 구글 지도에서 복사하면 앞에
   * "대한민국" 이 붙는다 — 둘 다 카카오 검색을 엉뚱한 곳으로 보낸다. 다듬어서 비면 이름으로 찾는다.
   */
  function cleanAddress(addr) {
    return String(addr)
      .replace(/[(（][^)）]*[)）]/g, ' ')
      .replace(/^\s*대한민국\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // 걸으면서 보면 3초는 짧다 — 오류는 더 오래 둔다 (D-058)
  var TOAST_MS = 5000, TOAST_ERROR_MS = 6000;
  var toastTimer = null;
  function toast(message, kind) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.className = 'toast show' + (kind ? ' toast--' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, kind === 'error' ? TOAST_ERROR_MS : TOAST_MS);
  }

  /** window.confirm 대체. Promise<boolean> */
  function confirmDialog(message, confirmLabel) {
    return new Promise(function (resolve) {
      var wrap = document.createElement('div');
      wrap.className = 'modal';
      wrap.innerHTML =
        '<div class="modal__panel" role="dialog" aria-modal="true">' +
        '<p class="modal__msg">' + nl2br(esc(message)) + '</p>' +
        '<div class="modal__actions">' +
        '<button type="button" class="btn btn--ghost" data-act="cancel">취소</button>' +
        '<button type="button" class="btn btn--danger" data-act="ok">' + esc(confirmLabel || '확인') + '</button>' +
        '</div></div>';
      document.body.appendChild(wrap);

      function close(result) {
        wrap.remove();
        document.removeEventListener('keydown', onKey);
        resolve(result);
      }
      function onKey(e) { if (e.key === 'Escape') close(false); }

      wrap.addEventListener('click', function (e) {
        var act = e.target.getAttribute('data-act');
        if (act === 'ok') close(true);
        else if (act === 'cancel' || e.target === wrap) close(false);
      });
      document.addEventListener('keydown', onKey);
      wrap.querySelector('[data-act="ok"]').focus();
    });
  }

  function setBusy(button, busy, busyLabel) {
    if (!button) return;
    if (busy) {
      button.dataset.label = button.textContent;
      button.textContent = busyLabel || '처리 중…';
      button.disabled = true;
    } else {
      if (button.dataset.label) button.textContent = button.dataset.label;
      button.disabled = false;
    }
  }

  /**
   * 사진을 업로드 전에 줄인다.
   * 원본 그대로 보내면 GAS 요청 한도와 Drive 용량을 금방 먹고, 현장 LTE 에서 업로드가 느리다.
   * 긴 변 PHOTO_MAX_EDGE px, JPEG 품질 PHOTO_QUALITY 로 맞춘다.
   */
  function resizePhoto(file) {
    return new Promise(function (resolve, reject) {
      if (!file) {
        reject(new Error('사진을 선택해 주세요.'));
        return;
      }
      // 🔴 file.type 으로 미리 거르지 않는다.
      //
      // 예전 코드는 `!/^image\//.test(file.type)` 로 막았다. 그런데 안드로이드
      // 갤러리·클라우드 피커는 타입을 **빈 값이나 application/octet-stream** 으로
      // 넘긴다. 그러면 사진을 골랐는데도 "이미지 파일만 올릴 수 있습니다" 가 떴다.
      // 카메라 촬영은 항상 image/jpeg 라 이 구멍이 드러나지 않았다 (D-027).
      //
      // 브라우저는 blob 을 **바이트로 판별해** 디코드한다(확인함 — 타입이
      // application/octet-stream 인 PNG 도 그대로 열린다). 판단의 주인은 디코더다.
      // 이미지가 아니면 아래 img.onerror 가 받는다.
      var url = URL.createObjectURL(file);
      var img = new Image();

      img.onload = function () {
        var maxEdge = CFG.PHOTO_MAX_EDGE;
        var scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        var w = Math.round(img.width * scale);
        var h = Math.round(img.height * scale);

        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);

        var dataUrl = canvas.toDataURL('image/jpeg', CFG.PHOTO_QUALITY);
        var base64 = dataUrl.split(',')[1];
        resolve({
          name: file.name || 'photo.jpg',
          mimeType: 'image/jpeg',
          dataBase64: base64,
          previewUrl: dataUrl,
          approxBytes: Math.round(base64.length * 0.75)
        });
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('사진을 읽지 못했습니다. 이미지 파일인지 확인하고 다시 시도해 주세요.'));
      };
      img.src = url;
    });
  }

  /** '2026-10-31T14:05:00+09:00' → '14:05' */
  function hhmm(iso) {
    if (!iso) return '';
    var m = String(iso).match(/T(\d{2}):(\d{2})/);
    return m ? m[1] + ':' + m[2] : '';
  }

  /**
   * 기기 로컬 시각을 ISO 로 만든다.
   *
   * 🔴 `toISOString()` 을 쓰면 안 된다 — 그건 UTC 라, `hhmm()` 이 `T(HH):(MM)` 만
   * 읽으므로 **9시간 어긋난 시각**이 화면에 뜬다. 낙관적 UI 가 서버 응답 전에
   * 시각을 보여 줄 때 쓰이므로, 잠깐이라도 틀린 시각을 보여 주면 안 된다.
   */
  function localIso(date) {
    var d = date || new Date();
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    var off = -d.getTimezoneOffset();          // 분. 한국이면 540
    var sign = off >= 0 ? '+' : '-';
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) +
      'T' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()) +
      sign + p2(Math.floor(Math.abs(off) / 60)) + ':' + p2(Math.abs(off) % 60);
  }

  // ---------------------------------------------------------------- 지금 기준 (D-050)
  //
  // 🔴 **"지금" 은 폰 시계로 판단한다.** bootstrap 의 `serverTime` 을 쓰면 안 된다 —
  // 미러에서 받은 bootstrap 은 **마지막 푸시 시각**을 싣고 있어 몇 시간 전일 수 있다.
  // 폰 시계는 통신사 시각에 맞춰져 있어 이 용도로는 충분하다.

  /** 기기 기준 오늘 'YYYY-MM-DD'. 회차 날짜(`sessions[].date`)와 견준다. */
  function localDate(date) {
    return localIso(date).slice(0, 10);
  }

  /** '09:30' → 570 (자정부터 분). 형식이 아니면 null. */
  function hmToMin(hm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || '').trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }

  /** ISO 시각이 지금부터 몇 분 전인지. 폰 시계가 조금 늦어 미래로 나오면 0. */
  function minutesSince(iso, nowMs) {
    if (!iso) return null;
    var t = new Date(iso).getTime();
    if (isNaN(t)) return null;
    var d = Math.floor(((nowMs === undefined ? Date.now() : nowMs) - t) / 60000);
    return d < 0 ? 0 : d;
  }

  /** 12 → '12분 전', 75 → '1시간 15분 전' */
  function agoText(min) {
    if (min === null || min === undefined) return '';
    if (min < 1) return '방금';
    if (min < 60) return min + '분 전';
    var h = Math.floor(min / 60), r = min % 60;
    return h + '시간 ' + (r ? r + '분 ' : '') + '전';
  }

  /** '2026-10-31T14:05:00+09:00' → '10월 31일 14:05' */
  function prettyDateTime(iso) {
    if (!iso) return '';
    var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!m) return String(iso);
    return Number(m[2]) + '월 ' + Number(m[3]) + '일 ' + m[4] + ':' + m[5];
  }

  // ---------------------------------------------------------------- 실측 패널
  //
  // `?perf=1` 일 때만 뜬다. 쿼리가 없으면 **DOM 에 아예 만들지 않는다** —
  // 참가자에게는 흔적도 보이지 않는다.
  // 기록 자체는 api.js 가 항상 하고 있다. 여기는 보여 주기만 한다 (D-030).

  var PERF_ON_KEY = 'plc_jd_perf_on';

  /** ?perf=1 로 켜고 ?perf=0 으로 끈다. 한 번 켜면 화면을 옮겨도 유지된다. */
  function perfEnabled() {
    var q = null;
    try {
      q = new URLSearchParams(global.location.search).get('perf');
    } catch (e) { /* 아주 오래된 브라우저 */ }

    if (q === '1' || q === 'on') {
      try { localStorage.setItem(PERF_ON_KEY, '1'); } catch (e) { /* 무시 */ }
      return true;
    }
    if (q === '0' || q === 'off') {
      try { localStorage.removeItem(PERF_ON_KEY); } catch (e) { /* 무시 */ }
      return false;
    }
    try { return localStorage.getItem(PERF_ON_KEY) === '1'; } catch (e) { return false; }
  }

  function perfRows() {
    return (global.API && global.API.perf) ? global.API.perf.summary() : [];
  }

  function perfRender(box) {
    var rows = perfRows();
    var net = (global.navigator && global.navigator.connection &&
               global.navigator.connection.effectiveType) || '';
    var total = rows.reduce(function (a, r) { return a + r.count; }, 0);

    var body = rows.length
      ? '<table class="perf__table">' + rows.map(function (r) {
          var mark = r.within === null ? '' : (r.within ? '✓' : '✗');
          // 🔴 서버 시간을 중앙값 옆에 붙인다. 이 둘의 차이가 대기·전송 시간이고,
          //    그 차이를 봐야 고칠 곳(코드냐 대기열이냐)이 정해진다.
          var srv = r.srvCount ? '<span class="perf__srv">/' + r.srvMedian + '</span>' : '';
          var codes = Object.keys(r.codes || {});
          var fail = r.failed
            ? '<td class="perf__fail">실패 ' + r.failed +
              (codes.length ? ' ' + esc(codes.join('·')) : '') + '</td>'
            : '<td>' + (r.budget ? mark + ' 기준 ' + r.budget : '') + '</td>';
          return '<tr class="' + (r.within === false ? 'is-over' : '') + '">' +
            '<th>' + esc(r.action) + '</th>' +
            '<td>' + r.count + '건</td>' +
            '<td>중앙 ' + r.median + srv + '</td>' +
            '<td>최대 ' + r.max + '</td>' +
            fail +
            '</tr>';
        }).join('') + '</table>'
      : '<p class="perf__empty">아직 측정된 요청이 없습니다.</p>';

    box.querySelector('.perf__head').textContent =
      '측정 ' + total + '건' + (net ? ' · ' + net : '');
    box.querySelector('.perf__body').innerHTML = body;
  }

  /**
   * 현장에서 폰으로 눌러 카톡에 붙여 넣을 수 있어야 실측이 실제로 남는다.
   * navigator.clipboard 는 비보안 컨텍스트에서 없을 수 있어 폴백을 둔다.
   */
  function perfCopy(text) {
    if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
      global.navigator.clipboard.writeText(text)
        .then(function () { toast('측정 결과를 복사했습니다.'); })
        .catch(function () { perfCopyFallback(text); });
      return;
    }
    perfCopyFallback(text);
  }

  function perfCopyFallback(text) {
    var ta = document.createElement('textarea');
    ta.className = 'perf__copy';
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    var done = false;
    try { done = document.execCommand('copy'); } catch (e) { done = false; }
    document.body.removeChild(ta);
    toast(done ? '측정 결과를 복사했습니다.' : '복사하지 못했습니다. 화면을 캡처해 주세요.',
      done ? undefined : 'error');
  }

  /**
   * 패널이 화면 요소를 **가리지 않게** 자리를 잡는다.
   *
   * 고정 위치라 그냥 두면 아래쪽 버튼을 덮어 **눌리지 않는다.**
   * (로그인 버튼이 실제로 그렇게 막혔고 브라우저 테스트가 잡아냈다.)
   * 탭바 위로 올리고, 본문 아래쪽에 패널 높이만큼 여백을 준다 — 데모바와 같은 방식.
   */
  function perfFit(box) {
    var tabbar = $('#tabbar');
    var tabH = (tabbar && !tabbar.hidden) ? tabbar.offsetHeight : 0;
    var root = document.documentElement;

    if (box.hidden) {
      root.style.setProperty('--perf-bottom', '8px');
      document.body.style.paddingBottom = '';
      return;
    }
    root.style.setProperty('--perf-bottom', (tabH + 8) + 'px');
    document.body.style.paddingBottom = (tabH + box.offsetHeight + 16) + 'px';
  }

  function perfPanel() {
    if (!perfEnabled()) return null;
    if ($('#perfPanel')) return $('#perfPanel');

    var box = document.createElement('div');
    box.id = 'perfPanel';
    box.className = 'perf';
    box.innerHTML =
      '<p class="perf__head"></p>' +
      '<div class="perf__body"></div>' +
      '<div class="perf__actions">' +
        '<button type="button" data-perf="copy">복사</button>' +
        '<button type="button" data-perf="clear">비우기</button>' +
        '<button type="button" data-perf="close">닫기</button>' +
      '</div>';
    document.body.appendChild(box);

    box.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-perf]');
      if (!btn) return;
      var act = btn.getAttribute('data-perf');
      if (act === 'copy') perfCopy(global.API.perf.text());
      else if (act === 'clear') { global.API.perf.clear(); perfRender(box); }
      else if (act === 'close') { box.hidden = true; perfFit(box); }
    });

    perfRender(box);
    perfFit(box);
    // 요청이 끝날 때마다 다시 그린다. 폴링이 가장 단순하고, 패널이 떠 있을 때만 돈다.
    setInterval(function () {
      if (box.hidden) return;
      perfRender(box);
      perfFit(box);
    }, 1000);
    return box;
  }

  // ------------------------------------------------------------ 조별 진행 카드
  //
  // 운영 콘솔(D-050)과 교역자 화면(D-051)이 **같은 카드**를 쓴다. 한쪽만 고치면
  // 두 화면이 다른 말을 한다.

  // 🔴 **완주 전인데 이만큼 새 기록이 없으면 ⚠** (D-050).
  //    업무계획서 일정이 지점 체류 25분 + 이동 10분이다. 그걸 넘기면 늦거나 길을 잃은 조다.
  var STALE_MIN = 40;

  /**
   * 조별 카드.
   *
   * 🔴 예전 표는 폰에서 **진행 칸이 화면 밖**이었다 — 일자·대상·조·조장·인원 다섯 칸이 폭을
   * 먹었다. 당일 운영진은 폰을 본다. 카드 한 장에 조의 네 지점을 코스 순서대로 한 줄에 놓고,
   * 마지막 기록이 몇 분 전인지 보인다.
   *
   * opts.showSession — 회차 필터가 '전체' 일 때만 회차를 적는다.
   * opts.editable    — 운영 콘솔: 칸을 누르면 정정 창 (D-052). 교역자 화면은 읽기 전용.
   */
  function teamCard(t, checkpoints, opts) {
    var o = opts || {};
    var nameOf = {};
    checkpoints.forEach(function (c) { nameOf[c.code] = c.name; });

    var done = 0, last = '';
    var steps = t.route.map(function (code, i) {
      var cell = t.cells[code] || {};
      var status = cell.status || '대기';
      if (status === '완료') done++;
      [cell.arrivedAt, cell.completedAt].forEach(function (x) { if (x && x > last) last = x; });
      var cls = status === '완료' ? 'done' : status === '도착' ? 'here' : 'wait';
      var time = hhmm(cell.completedAt || cell.arrivedAt);
      // 🔴 지점은 **한 줄에 하나씩, 이름 전체**로 (D-059). 네 칸을 가로로 늘어놓으면
      // 3열 카드에서 칸이 80px 남짓이라 "러…·보…" 로 잘려 어느 지점인지 알 수 없었다.
      var inner =
        '<span class="step__no">' + (i + 1) + '</span>' +
        '<span class="step__name">' + esc(nameOf[code] || code) + '</span>' +
        '<span class="step__state">' + esc(status) + (time ? ' ' + esc(time) : '') + '</span>';
      var title = (nameOf[code] || code) + ' · ' + status;
      return '<li class="step step--' + cls + '" title="' + esc(title) + '">' +
        (o.editable
          ? '<button type="button" class="step__btn step__row" data-edit-session="' + esc(t.session) +
              '" data-edit-group="' + esc(t.group) + '" data-edit-code="' + esc(code) + '">' + inner + '</button>'
          : '<span class="step__row">' + inner + '</span>') +
        '</li>';
    }).join('');

    var total = t.route.length;
    var finished = total > 0 && done === total;
    var ago = minutesSince(last, o.nowMs);
    var stale = !finished && ago !== null && ago >= STALE_MIN;

    return '<article class="team-card' + (stale ? ' is-stale' : '') + (finished ? ' is-done' : '') + '"' +
      ' data-team="' + esc(t.session + ' ' + t.group) + '">' +
      '<header class="team-card__head">' +
        '<div><strong>' + esc(t.name) + '</strong>' +
          '<span class="team-card__meta">' +
            (o.showSession ? esc(t.session) + ' · ' : '') +
            '조장 ' + esc(t.leaderName || '—') + ' · ' + t.memberCount + '명</span></div>' +
        '<span class="chip chip--' + (finished ? 'done' : done ? 'here' : 'wait') + '">' +
          done + '/' + total + '</span>' +
      '</header>' +
      (total ? '<ol class="steps">' + steps + '</ol>' : '<p class="hint">배정 코스가 없습니다.</p>') +
      '<p class="team-card__last">' +
        (last
          ? (stale ? '⚠ ' : '') + '마지막 기록 ' + esc(hhmm(last)) + ' · ' + esc(agoText(ago))
          : '아직 기록 없음') +
      '</p>' +
    '</article>';
  }

  /** 카드 묶음 + 맨 위 경고 줄. 반환: { html, stale } */
  /**
   * 조를 **숫자 순서로** (D-059). 서버는 "회차|조" 글자로 정렬해 "10조" 가 "1조" 앞에 왔다.
   * 회차 순서는 받은 그대로 두고, 같은 회차 안에서 조 번호로 줄 세운다. 번호가 없는 조는 뒤로.
   */
  function groupNo(g) {
    var m = /\d+/.exec(String(g === null || g === undefined ? '' : g));
    return m ? parseInt(m[0], 10) : Infinity;
  }
  function sortTeams(teams) {
    var rank = {}, n = 0;
    teams.forEach(function (t) { if (!rank.hasOwnProperty(t.session)) rank[t.session] = n++; });
    return teams.slice().sort(function (a, b) {
      var d = rank[a.session] - rank[b.session];
      if (d) return d;
      var ga = groupNo(a.group), gb = groupNo(b.group);
      if (ga !== gb) return ga < gb ? -1 : 1;
      return String(a.group) < String(b.group) ? -1 : String(a.group) > String(b.group) ? 1 : 0;
    });
  }

  function teamGrid(teams, checkpoints, opts) {
    var stale = 0;
    var nowMs = (opts && opts.nowMs) || Date.now();
    var cards = sortTeams(teams).map(function (t) {
      var html = teamCard(t, checkpoints, Object.assign({}, opts, { nowMs: nowMs }));
      if (html.indexOf(' is-stale') > 0) stale++;
      return html;
    }).join('');
    return {
      stale: stale,
      html: (stale ? '<p class="team-alert">⚠ ' + stale + '개 조가 ' + STALE_MIN + '분 넘게 소식이 없습니다.</p>' : '') +
        '<div class="team-grid">' + cards + '</div>'
    };
  }

  global.UI = {
    $: $, $$: $$, esc: esc, nl2br: nl2br, telLinks: telLinks, missionHtml: missionHtml, mapUrl: mapUrl,
    toast: toast, confirmDialog: confirmDialog, setBusy: setBusy,
    resizePhoto: resizePhoto, hhmm: hhmm, localIso: localIso, prettyDateTime: prettyDateTime,
    localDate: localDate, hmToMin: hmToMin, minutesSince: minutesSince, agoText: agoText,
    perfPanel: perfPanel, perfEnabled: perfEnabled,
    STALE_MIN: STALE_MIN, teamCard: teamCard, teamGrid: teamGrid, sortTeams: sortTeams
  };
})(window);
