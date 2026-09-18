/**
 * api.js — GAS 웹앱 통신 계층
 *
 * CORS: GAS 는 응답 헤더를 지정할 수 없어 preflight 를 통과시키지 못한다.
 * Content-Type 을 text/plain 으로 보내 "단순 요청"으로 만들면 preflight 없이 통과한다.
 * application/json 으로 바꾸면 즉시 깨진다.
 */
(function (global) {
  'use strict';

  var CFG = global.APP_CONFIG;

  // ---------------------------------------------------------------- 응답 시간 측정
  //
  // `DATABASE.md` 에 넘어갈 기준을 수치로 적어 뒀는데(부트스트랩 3초, me·progress.list
  // 2초) **재는 방법이 없었다.** 기준을 적어 두고 재지 않으면 기준이 없는 것과 같다.
  //
  // **항상 기록한다.** 비용은 타임스탬프 하나와 배열 push 다. 캠프 당일 느리면
  // 그때 이미 데이터가 쌓여 있어야 한다 — 그제서야 켜면 늦다 (D-030).
  // 보여 주는 것만 ?perf=1 로 토글한다(UI.perfPanel).

  var PERF_KEY = 'plc_jd_perf';
  var PERF_MAX = 200;          // 최근 N건만. 메모리·localStorage 폭주 방지
  var perfLog = [];

  /** 기준선. DATABASE.md 의 '넘어갈 기준' 과 같은 값이어야 한다. */
  var PERF_BUDGET = {
    'bootstrap': 3000, 'bootstrap:supabase': 3000,   // 미러가 빨라졌는지 나란히 본다
    'me': 2000, 'progress.list': 2000
  };

  (function loadPerf() {
    try {
      var raw = localStorage.getItem(PERF_KEY);
      if (raw) perfLog = JSON.parse(raw) || [];
    } catch (e) { perfLog = []; }
  })();

  function perfSave() {
    try { localStorage.setItem(PERF_KEY, JSON.stringify(perfLog)); } catch (e) { /* 시크릿 모드 등 */ }
  }

  function now() {
    return (global.performance && global.performance.now)
      ? global.performance.now() : Date.now();
  }

  /**
   * 한 건 기록. 실패도 남긴다 — **느린 실패가 오히려 중요한 신호**다.
   * cached=true 인 건은 표본에서 빠진다(perfSummary 참고).
   */
  function perfRecord(action, ms, ok, cached) {
    perfLog.push({ a: action, ms: Math.round(ms), ok: !!ok, c: !!cached, t: Date.now() });
    if (perfLog.length > PERF_MAX) perfLog = perfLog.slice(-PERF_MAX);
    perfSave();
  }

  function median(nums) {
    if (!nums.length) return 0;
    var s = nums.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
  }

  /**
   * 액션별 요약.
   *
   * 🔴 **캐시 히트는 표본에서 뺀다.** bootstrap 은 sessionStorage 에 담아 두므로
   * 그대로 세면 0ms 가 섞여 **중앙값이 거짓이 된다.** 캐시 건수는 따로만 보여 준다.
   */
  function perfSummary() {
    var by = {};
    perfLog.forEach(function (e) {
      if (!by[e.a]) by[e.a] = { action: e.a, samples: [], cached: 0, failed: 0 };
      if (e.c) { by[e.a].cached++; return; }      // ← 표본에 넣지 않는다
      by[e.a].samples.push(e.ms);
      if (!e.ok) by[e.a].failed++;
    });

    return Object.keys(by).map(function (k) {
      var r = by[k];
      var budget = PERF_BUDGET[r.action] || null;
      var max = r.samples.length ? Math.max.apply(null, r.samples) : 0;
      return {
        action: r.action,
        count: r.samples.length,
        cached: r.cached,
        failed: r.failed,
        median: median(r.samples),
        max: max,
        budget: budget,
        // 기준이 있는 액션만 판정한다. 표본이 없으면 판정하지 않는다(null).
        within: (budget && r.samples.length) ? (max <= budget) : null
      };
    }).sort(function (a, b) { return a.action < b.action ? -1 : 1; });
  }

  /** 현장에서 폰으로 복사해 갈 수 있는 텍스트. 이게 없으면 실측이 안 남는다. */
  function perfText() {
    var rows = perfSummary();
    var net = (global.navigator && global.navigator.connection &&
               global.navigator.connection.effectiveType) || '';
    var out = ['[정동캠프 응답 시간 실측]',
               new Date().toLocaleString('ko-KR') + (net ? ' · ' + net : ''), ''];
    if (!rows.length) {
      out.push('(측정된 요청이 없습니다)');
      return out.join('\n');
    }
    rows.forEach(function (r) {
      var line = r.action + ' — ' + r.count + '건 · 중앙 ' + r.median + 'ms · 최대 ' + r.max + 'ms';
      if (r.budget) line += ' · 기준 ' + r.budget + 'ms ' + (r.within ? 'OK' : '초과');
      if (r.failed) line += ' · 실패 ' + r.failed + '건';
      if (r.cached) line += ' · 캐시 ' + r.cached + '건(표본 제외)';
      out.push(line);
    });
    return out.join('\n');
  }

  function getToken() {
    try { return localStorage.getItem(CFG.TOKEN_KEY) || ''; } catch (e) { return ''; }
  }
  function setToken(token) {
    try {
      if (token) localStorage.setItem(CFG.TOKEN_KEY, token);
      else localStorage.removeItem(CFG.TOKEN_KEY);
    } catch (e) { /* 시크릿 모드 등 */ }
  }

  function ApiError(code, message) {
    this.name = 'ApiError';
    this.code = code;
    this.message = message;
  }
  ApiError.prototype = Object.create(Error.prototype);

  /** 액션 호출. 인증이 필요한 액션은 토큰을 자동으로 실어 보낸다. */
  function call(action, payload, options) {
    var opts = options || {};
    var body = Object.assign({ action: action }, payload || {});
    if (!opts.anonymous && !body.token) {
      var t = getToken();
      if (t) body.token = t;
    }

    if (!CFG.API_BASE || CFG.API_BASE.indexOf('REPLACE_WITH') >= 0) {
      return Promise.reject(new ApiError(
        'SERVER_ERROR',
        '아직 서버 주소가 설정되지 않았습니다. (docs/assets/js/config.js 의 API_BASE)'
      ));
    }

    var started = now();
    var mark = function (ok) { perfRecord(action, now() - started, ok, false); };

    return fetch(CFG.API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow'
    })
      .then(function (res) { return res.text(); })
      .then(function (text) {
        var json;
        try {
          json = JSON.parse(text);
        } catch (e) {
          // GAS 가 오류 HTML 을 돌려주는 경우(권한/배포 문제)
          throw new ApiError('SERVER_ERROR', '서버 응답을 읽지 못했습니다. 배포 설정을 확인해 주세요.');
        }
        if (!json.ok) {
          var err = json.error || {};
          if (err.code === 'UNAUTHORIZED') setToken('');
          throw new ApiError(err.code || 'SERVER_ERROR', err.message || '오류가 발생했습니다.');
        }
        mark(true);
        return json.data;
      })
      .catch(function (e) {
        mark(false);
        if (e instanceof ApiError) throw e;
        throw new ApiError('SERVER_ERROR', '네트워크 연결을 확인해 주세요.');
      });
  }

  /**
   * Supabase 읽기 미러에서 공개 데이터를 가져온다 (D-032).
   *
   * 실패·비어 있음·**낡음** 중 하나라도면 null 을 돌려주고 호출부가 GAS 로 간다.
   * 🔴 낡은 것을 그냥 쓰지 않는 것이 핵심이다 — 미러가 멈춘 채 옛 공지를 계속
   * 보여 주는 쪽이 미러가 죽는 것보다 나쁘다.
   */
  function bootstrapFromMirror() {
    if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) return Promise.resolve(null);

    var started = now();
    var url = CFG.SUPABASE_URL.replace(/\/+$/, '') +
      '/rest/v1/app_cache?key=eq.bootstrap&select=value,updated_at';

    var ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, CFG.MIRROR_TIMEOUT) : null;

    return fetch(url, {
      headers: { apikey: CFG.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + CFG.SUPABASE_ANON_KEY },
      signal: ctrl ? ctrl.signal : undefined
    })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (rows) {
        if (timer) clearTimeout(timer);
        var row = rows && rows[0];
        if (!row || !row.value) return null;

        var age = Date.now() - new Date(row.updated_at).getTime();
        if (!(age >= 0) || age > CFG.MIRROR_MAX_AGE) return null;   // 낡았다 → 버린다

        perfRecord('bootstrap:supabase', now() - started, true, false);
        return row.value;
      })
      .catch(function () {
        if (timer) clearTimeout(timer);
        perfRecord('bootstrap:supabase', now() - started, false, false);
        return null;   // 던지지 않는다. 호출부가 GAS 로 간다.
      });
  }

  /**
   * bootstrap 은 공개 데이터라 sessionStorage 에 잠깐 캐시한다.
   * 캐시가 없으면 **미러 → GAS** 순으로 간다. 미러가 없거나 낡으면 예전 그대로다.
   */
  function bootstrap(force) {
    var KEY = 'plc_jd_bootstrap';
    if (!force) {
      try {
        var raw = sessionStorage.getItem(KEY);
        if (raw) {
          var cached = JSON.parse(raw);
          if (Date.now() - cached.at < CFG.BOOTSTRAP_TTL) {
            // 캐시 히트도 남기되 **표본에서는 뺀다.** 0ms 를 같이 세면 중앙값이 거짓이 된다.
            perfRecord('bootstrap', 0, true, true);
            return Promise.resolve(cached.data);
          }
        }
      } catch (e) { /* 캐시 없음 */ }
    }

    var remember = function (data) {
      try { sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), data: data })); } catch (e) { /* 무시 */ }
      return data;
    };

    return bootstrapFromMirror().then(function (mirrored) {
      if (mirrored) return remember(mirrored);
      return call('bootstrap', {}, { anonymous: true }).then(remember);
    });
  }

  global.API = {
    call: call,
    bootstrap: bootstrap,
    perf: {
      list: function () { return perfLog.slice(); },
      summary: perfSummary,
      text: perfText,
      budgets: PERF_BUDGET,
      clear: function () { perfLog = []; perfSave(); }
    },
    getToken: getToken,
    setToken: setToken,
    ApiError: ApiError,

    login: function (session, name, phoneLast4) {
      return call('auth.login', { session: session, name: name, phoneLast4: phoneLast4 }, { anonymous: true })
        .then(function (data) { setToken(data.token); return data; });
    },
    logout: function () {
      setToken('');
      try { sessionStorage.clear(); } catch (e) { /* 무시 */ }
    },
    me: function () { return call('me'); },
    progressList: function () { return call('progress.list'); },
    progressSet: function (checkpoint, status, score, memo) {
      return call('progress.set', { checkpoint: checkpoint, status: status, score: score, memo: memo });
    },
    journalList: function (scope, cursor, limit) {
      return call('journal.list', { scope: scope, cursor: cursor || 0, limit: limit || 30 });
    },
    journalCreate: function (payload) { return call('journal.create', payload); },
    journalUpdate: function (payload) { return call('journal.update', payload); },
    journalDelete: function (id) { return call('journal.delete', { id: id }); },
    feeStatus: function () { return call('fee.status'); }
  };
})(window);
