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
        return json.data;
      })
      .catch(function (e) {
        if (e instanceof ApiError) throw e;
        throw new ApiError('SERVER_ERROR', '네트워크 연결을 확인해 주세요.');
      });
  }

  /** bootstrap 은 공개 데이터라 sessionStorage 에 잠깐 캐시한다. */
  function bootstrap(force) {
    var KEY = 'plc_jd_bootstrap';
    if (!force) {
      try {
        var raw = sessionStorage.getItem(KEY);
        if (raw) {
          var cached = JSON.parse(raw);
          if (Date.now() - cached.at < CFG.BOOTSTRAP_TTL) return Promise.resolve(cached.data);
        }
      } catch (e) { /* 캐시 없음 */ }
    }
    return call('bootstrap', {}, { anonymous: true }).then(function (data) {
      try { sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), data: data })); } catch (e) { /* 무시 */ }
      return data;
    });
  }

  global.API = {
    call: call,
    bootstrap: bootstrap,
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
