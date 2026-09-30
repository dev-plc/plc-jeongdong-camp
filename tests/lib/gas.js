/**
 * GAS 모의 환경 — `gas/*.gs` 일곱 개를 Apps Script 처럼 **한 전역**에 올린다.
 *
 * 흉내 내는 것은 코드가 실제로 부르는 서비스뿐이다 (grep 으로 뽑은 목록).
 *   시트 = 메모리 2차원 배열. 값 메서드(getValues/setValues/appendRow/deleteRow …)만 진짜로 동작하고,
 *   서식·드롭다운·자동 크기 같은 나머지는 Proxy 가 "부르면 자기 자신을 돌려주는" no-op 으로 받는다.
 *
 * 🔴 Apps Script 는 요청마다 새로 실행된다 — 전역 캐시(`var __x = {}`)가 요청 사이에 남지 않는다.
 *    그래서 post()/get() 앞에서 `.gs` 에 적힌 `var __이름 = 초기값;` 을 다시 돌린다.
 *    이걸 빼면 한 요청에서 읽은 시트가 다음 요청에 그대로 남아, 운영에서는 안 나는 통과·실패가 생긴다.
 *
 * 쓰는 법:
 *   const G = require('../lib/gas').load();        // 새 시트 · 새 전역
 *   G.run('setupSpreadsheet()');
 *   G.post({ action: 'auth.login', name, phoneLast4 });
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const GAS_DIR = path.join(__dirname, '..', '..', 'gas');
/** Apps Script 프로젝트의 파일 순서. 전역 초기화가 이 순서로 돈다. */
const FILES = ['Sheets.gs', 'Auth.gs', 'Journal.gs', 'Code.gs', 'Setup.gs', 'MasterSync.gs', 'Mirror.gs'];
const ADMIN_PIN = '778899';
const DRIVE_FOLDER = 'FOLDER_OK';

// ------------------------------------------------------------------ 공통 no-op

/** 무엇을 부르든 자기 자신을 돌려준다. 서식·검증·보호처럼 결과를 안 쓰는 호출용. */
function chain(extra) {
  const target = Object.assign(function () {}, extra || {});
  const p = new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'then' || typeof k === 'symbol') return undefined;
      return () => p;
    },
    apply() { return p; }
  });
  return p;
}

// ------------------------------------------------------------------ 시트

let ID_SEQ = 0;

function makeSheet(name, ss) {
  const sheet = { name, id: ++ID_SEQ, rows: [], frozen: 0 };

  const cell = (r, c) => (sheet.rows[r - 1] && sheet.rows[r - 1][c - 1] !== undefined ? sheet.rows[r - 1][c - 1] : '');
  const put = (r, c, v) => {
    while (sheet.rows.length < r) sheet.rows.push([]);
    const row = sheet.rows[r - 1];
    while (row.length < c) row.push('');
    row[c - 1] = v === undefined || v === null ? '' : v;
  };
  const filled = (v) => v !== '' && v !== null && v !== undefined;
  const lastRow = () => {
    for (let r = sheet.rows.length; r >= 1; r--) if ((sheet.rows[r - 1] || []).some(filled)) return r;
    return 0;
  };
  const lastCol = () => sheet.rows.reduce((m, row) => {
    for (let c = row.length; c >= 1; c--) if (filled(row[c - 1])) return Math.max(m, c);
    return m;
  }, 0);

  function range(r, c, nr, nc) {
    nr = nr || 1; nc = nc || 1;
    if (r < 1 || c < 1 || nr < 1 || nc < 1) throw new Error('범위가 잘못되었습니다: ' + [r, c, nr, nc]);
    const api = {
      getRow: () => r, getColumn: () => c, getNumRows: () => nr, getNumColumns: () => nc,
      getLastRow: () => r + nr - 1, getLastColumn: () => c + nc - 1,
      getSheet: () => api_,
      getValues() {
        const out = [];
        for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(cell(r + i, c + j)); out.push(row); }
        return out;
      },
      getDisplayValues() { return api.getValues().map(row => row.map(v => String(v))); },
      setValues(v) {
        if (v.length !== nr || v.some(row => row.length !== nc)) {
          throw new Error(`데이터의 행/열 수(${v.length}x${v[0] && v[0].length})가 범위(${nr}x${nc})와 다릅니다.`);
        }
        v.forEach((row, i) => row.forEach((x, j) => put(r + i, c + j, x)));
        return p;
      },
      getValue: () => cell(r, c),
      setValue(v) { put(r, c, v); return p; },
      clearContent() { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (sheet.rows[r + i - 1]) put(r + i, c + j, ''); return p; }
    };
    const p = chain(api);
    return p;
  }

  const api_ = chain({
    getName: () => sheet.name,
    setName: (n) => { sheet.name = n; return api_; },
    getSheetId: () => sheet.id,
    getParent: () => ss,
    getLastRow: lastRow,
    getLastColumn: lastCol,
    getMaxRows: () => Math.max(1000, sheet.rows.length),
    getMaxColumns: () => Math.max(26, lastCol()),
    getFrozenRows: () => sheet.frozen,
    setFrozenRows: (n) => { sheet.frozen = n; return api_; },
    getRange: range,
    getDataRange: () => range(1, 1, Math.max(lastRow(), 1), Math.max(lastCol(), 1)),
    appendRow(row) { const r = lastRow() + 1; row.forEach((v, j) => put(r, j + 1, v)); return api_; },
    deleteRow(i) { sheet.rows.splice(i - 1, 1); return api_; },
    deleteRows(i, n) { sheet.rows.splice(i - 1, n); return api_; },
    clearContents() { sheet.rows = []; return api_; },
    clear() { sheet.rows = []; return api_; },
    __rows: sheet.rows,
    __data: () => sheet.rows
  });
  return api_;
}

function makeSpreadsheet() {
  const sheets = [];
  const ss = chain({
    getId: () => 'SS_TEST',
    getName: () => '가을캠프 (테스트)',
    getUrl: () => 'https://docs.google.com/spreadsheets/d/SS_TEST',
    getSheetByName: (n) => sheets.find(s => s.getName() === n) || null,
    getSheets: () => sheets.slice(),
    insertSheet(n) {
      if (sheets.some(s => s.getName() === n)) throw new Error('이미 있는 시트 이름: ' + n);
      const s = makeSheet(n, ss); sheets.push(s); return s;
    },
    deleteSheet(s) { const i = sheets.indexOf(s); if (i >= 0) sheets.splice(i, 1); },
    toast(msg) { UI_LOG.push({ toast: msg }); },
    getSpreadsheetTimeZone: () => 'Asia/Seoul'
  });
  return ss;
}

// ------------------------------------------------------------------ 날짜 (Asia/Seoul = +09:00 고정, 서머타임 없음)

function formatDate(date, tz, fmt) {
  const t = date.getTime();
  const k = new Date(t + 9 * 3600 * 1000);
  const two = (n) => String(n).padStart(2, '0');
  const parts = {
    yyyy: String(k.getUTCFullYear()), MM: two(k.getUTCMonth() + 1), dd: two(k.getUTCDate()),
    HH: two(k.getUTCHours()), mm: two(k.getUTCMinutes()), ss: two(k.getUTCSeconds()), XXX: '+09:00'
  };
  // 'T' 처럼 작은따옴표 안은 글자 그대로
  return fmt.split(/('[^']*')/).map(seg => seg.startsWith("'")
    ? seg.slice(1, -1)
    : seg.replace(/yyyy|MM|dd|HH|mm|ss|XXX/g, m => parts[m])).join('');
}

// ------------------------------------------------------------------ 바이트·Base64

const toBuf = (v) => Buffer.isBuffer(v) ? v : Array.isArray(v) || ArrayBuffer.isView(v) ? Buffer.from(Array.from(v).map(b => b & 0xff)) : Buffer.from(String(v), 'utf8');
const signed = (buf) => Array.from(buf).map(b => (b > 127 ? b - 256 : b));  // GAS 는 byte[] (−128~127)

function blob(bytes, mime, name) {
  const buf = toBuf(bytes || []);
  return { getBytes: () => signed(buf), getDataAsString: () => buf.toString('utf8'),
           getContentType: () => mime || '', getName: () => name || '', setName(n) { name = n; return this; } };
}

// ------------------------------------------------------------------ 기록 (테스트가 들여다본다)

let UI_LOG = [];

/**
 * 새 전역을 만든다.
 * @param {object} [opt]
 *   patch   — { 'Setup.gs': src => src.slice(…) } 처럼 붙여넣기 사고를 흉내 낸다
 *   props   — 스크립트 속성 추가(기본: ADMIN_PIN)
 *   fetch   — (url, opts) => { code, body } 로 UrlFetchApp 응답을 정한다(기본 200, '[]')
 *   ui      — false 면 getUi() 가 던진다(웹앱·트리거처럼)
 */
function load(opt) {
  opt = opt || {};
  UI_LOG = [];
  const ss = makeSpreadsheet();
  const props = new Map(Object.entries(Object.assign({ ADMIN_PIN }, opt.props || {})));
  const cache = new Map();
  const FETCH = [];
  const DRIVE = { files: [], trashed: [], copies: [] };
  const TRIGGERS = [];
  const answers = [];     // ui.prompt 응답 · ui.alert 버튼 — 테스트가 차례로 넣는다

  const Button = { OK: 'OK', CANCEL: 'CANCEL', YES: 'YES', NO: 'NO', CLOSE: 'CLOSE' };
  const ui = chain({
    Button, ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL', YES_NO: 'YES_NO', YES_NO_CANCEL: 'YES_NO_CANCEL' },
    alert(title, msg, set) {
      UI_LOG.push({ alert: msg === undefined ? title : title + '\n' + msg });
      if (set === undefined && typeof msg !== 'string') return Button.OK;
      return answers.length ? answers.shift() : (/YES/.test(set || msg) ? Button.YES : Button.OK);
    },
    prompt(title, msg) {
      const a = answers.length ? answers.shift() : '';
      UI_LOG.push({ prompt: title + (typeof msg === 'string' ? '\n' + msg : ''), answer: a });
      const cancelled = a === Button.CANCEL;
      return { getSelectedButton: () => (cancelled ? Button.CANCEL : Button.OK), getResponseText: () => (cancelled ? '' : String(a)) };
    },
    createMenu(name) {
      const menu = { name, items: [] };
      UI_LOG.push({ menu });
      const m = chain({
        addItem(label, fn) { menu.items.push([label, fn]); return m; },
        addSeparator() { menu.items.push(['—']); return m; },
        addSubMenu(sub) { menu.items.push(['▸', sub]); return m; },
        addToUi() { return m; }
      });
      return m;
    }
  });

  const sandbox = {
    console: opt.quiet === false ? console : { log() {}, warn() {}, info() {}, error() {} },
    SpreadsheetApp: chain({
      getActiveSpreadsheet: () => ss,
      getActive: () => ss,
      getUi() { if (opt.ui === false) throw new Error('Cannot call SpreadsheetApp.getUi() from this context.'); return ui; },
      flush() {},
      newDataValidation: () => chain()
    }),
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty(k, v) { props.set(k, String(v)); return this; },
        deleteProperty(k) { props.delete(k); return this; },
        getProperties: () => Object.fromEntries(props)
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (cache.has(k) ? cache.get(k) : null),
        put: (k, v) => { cache.set(k, String(v)); },
        remove: (k) => { cache.delete(k); },
        removeAll: (ks) => { ks.forEach(k => cache.delete(k)); }
      })
    },
    LockService: {
      getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {}, hasLock: () => true }),
      getDocumentLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {}, hasLock: () => true })
    },
    Utilities: {
      formatDate,
      getUuid: () => crypto.randomUUID(),
      computeHmacSha256Signature: (v, k) => signed(crypto.createHmac('sha256', toBuf(k)).update(toBuf(v)).digest()),
      base64Encode: (v) => toBuf(v).toString('base64'),
      base64EncodeWebSafe: (v) => toBuf(v).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64Decode: (s) => signed(Buffer.from(String(s), 'base64')),
      base64DecodeWebSafe: (s) => signed(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
      newBlob: blob,
      sleep() {}
    },
    ContentService: {
      MimeType: { JSON: 'JSON', TEXT: 'TEXT' },
      createTextOutput: (t) => { const o = { getContent: () => t, setMimeType: () => o }; return o; }
    },
    DriveApp: {
      Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' },
      Permission: { VIEW: 'VIEW' },
      getFolderById(id) {
        if (id !== DRIVE_FOLDER) throw new Error('폴더 없음: ' + id);
        return chain({
          getId: () => id,
          createFile(b) {
            const f = { id: 'FILE' + (DRIVE.files.length + 1), name: b.getName(), mime: b.getContentType(), bytes: b.getBytes().length };
            DRIVE.files.push(f);
            return chain({ getId: () => f.id, getUrl: () => 'https://drive.google.com/file/d/' + f.id, setSharing() { f.shared = true; } });
          }
        });
      },
      getFileById(id) {
        return chain({
          getId: () => id,
          setTrashed(t) { if (t) DRIVE.trashed.push(id); },
          makeCopy(name, folder) { const c = { id: 'COPY' + (DRIVE.copies.length + 1), name, from: id }; DRIVE.copies.push(c);
            return chain({ getId: () => c.id, getUrl: () => 'https://docs.google.com/spreadsheets/d/' + c.id, getName: () => name }); }
        });
      }
    },
    UrlFetchApp: {
      fetch(url, o) {
        const req = { url, method: (o && o.method) || 'get', headers: (o && o.headers) || {}, payload: o && o.payload };
        FETCH.push(req);
        const res = (opt.fetch && opt.fetch(url, o)) || {};
        return { getResponseCode: () => (res.code || 200), getContentText: () => (res.body === undefined ? '[]' : res.body) };
      }
    },
    ScriptApp: {
      getProjectTriggers: () => TRIGGERS.slice(),
      deleteTrigger: (t) => { const i = TRIGGERS.indexOf(t); if (i >= 0) TRIGGERS.splice(i, 1); },
      newTrigger(fn) {
        const t = { fn, getHandlerFunction: () => fn };
        const b = chain({ create() { TRIGGERS.push(t); return t; } });
        return b;
      }
    }
  };

  const context = vm.createContext(sandbox);
  const resets = [];
  FILES.forEach(f => {
    let src = fs.readFileSync(path.join(GAS_DIR, f), 'utf8');
    if (opt.patch && opt.patch[f]) src = opt.patch[f](src);
    vm.runInContext(src, context, { filename: f });
    // 요청마다 다시 초기화할 전역 캐시 — 이름이 __ 로 시작하는 한 줄짜리 var
    src.replace(/^var (__\w+)\s*=\s*([^;\n]+);/gm, (m, name, init) => { resets.push(`${name} = ${init};`); return m; });
  });
  const resetCode = resets.join('\n');

  const run = (code) => vm.runInContext(code, context);
  /** 새 실행 하나 — 전역 캐시를 비우고 부른다. */
  const fresh = () => run(resetCode);
  const post = (body) => {
    fresh();
    return JSON.parse(run(`doPost({postData:{contents:${JSON.stringify(JSON.stringify(body))}}}).getContent()`));
  };
  const get = (params) => {
    fresh();
    return JSON.parse(run(`doGet({parameter:${JSON.stringify(params || {})}}).getContent()`));
  };
  /** 서버의 "오늘" 을 고정한다 (회차 판정). 요청 간 초기화 대상이 아니므로 유지된다. */
  const setToday = (d) => run(`todayStr_ = function () { return ${JSON.stringify(d)}; }`);
  /** 탭 내용을 [헤더, …행] 그대로 본다. */
  const sheet = (logical) => {
    const name = run(`resolveSheetName_(${JSON.stringify(logical)})`);
    const sh = ss.getSheetByName(name);
    return sh ? sh.__data().map(r => r.slice()) : null;
  };
  /** 명단에 사람을 넣는다: [참여 일자, 이름, 조, 역할, 연락처, 담당 지점, 코스, 부서?] */
  const addPeople = (rows) => {
    fresh();
    run(`${JSON.stringify(rows)}.forEach(function (m) {
      var o = {};
      o[COL.SESSION] = m[0]; o[COL.NAME] = m[1]; o[COL.GROUP] = m[2]; o[COL.ROLE] = m[3];
      o[COL.PHONE] = m[4]; o[COL.STATION] = m[5]; o[COL.COURSE] = m[6]; o[COL.AUDIENCE] = m[7] || '청년부';
      appendRow_(SHEETS.PARTICIPANTS, o);
    });
    fillParticipantIds();
    syncTeams();`);
  };

  return {
    context, run, fresh, post, get, setToday, sheet, addPeople, ss,
    FETCH, DRIVE, TRIGGERS, props, cache, answers,
    get UI() { return UI_LOG; },
    login: (name, last4) => post({ action: 'auth.login', name, phoneLast4: last4 }),
    token(name, last4) { const r = this.login(name, last4); if (!r.ok) throw new Error('로그인 실패: ' + name + ' ' + JSON.stringify(r.error)); return r.data.token; },
    adminToken() { const r = post({ action: 'admin.login', pin: ADMIN_PIN }); if (!r.ok) throw new Error('관리자 로그인 실패'); return r.data.token; }
  };
}

/**
 * 표준 준비: 시트 세팅 · Drive 폴더 · 오늘 = 10/31.
 * 사람은 부르는 쪽이 addPeople 로 넣는다.
 */
function camp(opt) {
  const G = load(opt);
  G.fresh();
  G.run('setupSpreadsheet()');
  G.fresh();
  G.run(`configSet_({isAdmin:true}, {key:'DRIVE_FOLDER_ID', value:${JSON.stringify(DRIVE_FOLDER)}})`);
  G.setToday('2026-10-31');
  return G;
}

module.exports = { load, camp, FILES, GAS_DIR, ADMIN_PIN, DRIVE_FOLDER, formatDate };
