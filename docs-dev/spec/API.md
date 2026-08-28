# API 명세 (GAS Web App)

엔드포인트는 **하나**입니다: 배포된 `https://script.google.com/macros/s/{DEPLOY_ID}/exec`

## 호출 규약

- **읽기 전용 공개 데이터**는 `GET ?action=bootstrap` 로도 받을 수 있습니다(초기 로딩 1회).
- **나머지는 전부 POST**, 본문은 JSON 문자열, `Content-Type: text/plain;charset=utf-8`.
  - GAS 웹앱은 응답 헤더를 지정할 수 없어 CORS preflight를 통과시킬 수 없습니다.
    `text/plain` 은 단순 요청(simple request)이라 preflight가 발생하지 않고,
    최종 리다이렉트 응답에 `Access-Control-Allow-Origin: *` 이 붙어 정상 동작합니다.
  - 따라서 `Content-Type: application/json` 을 쓰면 **안 됩니다.**
- 인증이 필요한 액션은 본문에 `token` 을 넣습니다.

```js
fetch(API_BASE, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify({ action: 'me', token })
})
```

## 응답 형태

```jsonc
// 성공
{ "ok": true, "data": { ... } }
// 실패
{ "ok": false, "error": { "code": "UNAUTHORIZED", "message": "다시 로그인해 주세요." } }
```

### 에러 코드

| 코드 | 의미 | 프론트 처리 |
|---|---|---|
| `BAD_REQUEST` | 필수 파라미터 누락/형식 오류 | 폼에 메시지 표시 |
| `NOT_FOUND` | 명단에 없음 | "운영진 문의" 안내 |
| `AMBIGUOUS` | 이름+뒷4자리 중복 (동명이인) | "운영진 문의" 안내 |
| `LOCKED` | 로그인 실패 누적 잠금 | 남은 시간 표시 |
| `UNAUTHORIZED` | 토큰 없음/만료/위조 | 토큰 삭제 후 로그인 화면 |
| `FORBIDDEN` | 권한 없음 (조장/관리자 전용) | 버튼 숨김 + 토스트 |
| `CLOSED` | 기능이 닫혀 있음 (`*_OPEN=FALSE`) | 안내 문구 |
| `TOO_LARGE` | 사진 용량 초과 | 재촬영/리사이즈 안내 |
| `SERVER_ERROR` | 그 외 | 재시도 안내 |

---

## 액션 목록

### 공개 (토큰 불필요)

#### `bootstrap`
앱 초기 로딩. 개인정보 없음.
```jsonc
{ "action": "bootstrap" }
// data
{
  "config": { "CAMP_NAME": "...", "GALLERY_SCOPE": "ALL", "SHOW_FEE": true, ... },
  "sessions": [ { "label": "10/24(토)", "date": "2026-10-24" },
                { "label": "10/31(토)", "date": "2026-10-31" } ],
  "checkpoints": [ { "code": "CP1", "order": 1, "name": "배재학당역사박물관", ... } ],
  "notices": [ { "id": "N001", "target": "전체", "title": "...", "body": "...", "pinned": true } ],
  "timeline": { "10/24(토)": [ { "start": "09:30", "end": "09:50", "title": "...", ... } ],
                "10/31(토)": [ ... ] },
  "serverTime": "2026-10-24T09:12:00+09:00"
}
```

#### `auth.login`
```jsonc
{ "action": "auth.login", "session": "10/24(토)", "name": "홍길동", "phoneLast4": "5678" }
// data
{ "token": "eyJ...", "expiresAt": "...", "me": { /* me 와 동일 + sessionCorrected */ } }
```

- `session` 은 **선택**입니다. 후보를 좁히는 힌트로만 쓰이며, 참가자가 다른 날짜를 골라도
  명단이 맞으면 실제 배정된 날짜로 로그인됩니다. 이때 `me.sessionCorrected = true` 가 옵니다.
- `name` 은 마스터시트의 구분번호를 뗀 이름(`이승천`)도, 붙은 이름(`이승천7377`)도 받습니다.
- `phoneLast4` 는 `연락처` 의 마지막 4자리 또는 이름 뒤에 붙은 4자리 중 하나면 통과합니다 (D-003).

---

### 참가자 (토큰 필요)

#### `me`
본인 + 소속 조 + (조장이면) 조원 목록.
```jsonc
{
  "participant": { "id": "P0001", "name": "홍길동", "audience": "청년부",
                   "session": "10/24(토)", "role": "조장", "group": "1조",
                   "feeStatus": "완납", "insurance": "가입완료" },
  "team": { "session": "10/24(토)", "group": "1조", "name": "1조 배재", "color": "#984534",
            "leaderName": "김캠티", "meetingPoint": "PL교회 본당 앞",
            "course": "C코스(보구여관 시작)", "route": ["CP3","CP4","CP1","CP2"] },
  "isLeader": true,
  "members": [ { "id": "P0002", "name": "이조원", "role": "일반",
                 "feeStatus": "미납", "insurance": "미가입" } ]
}
```
`members` 는 `isLeader=true` 일 때만 채워집니다. `연락처`는 어떤 경우에도 포함되지 않습니다.
이름은 마스터시트의 구분번호가 제거된 표시용 이름입니다.
`isLeader` 는 `역할` 이 `조장` / `스태프` / `사역자` 중 하나일 때 참입니다.

#### `progress.list`
소속 조의 4개 지점 진행 상태.
```jsonc
{ "action": "progress.list", "token": "..." }
// data: [ { "checkpoint": "CP1", "status": "완료", "arrivedAt": "...", "completedAt": "...", "score": 8 } ]
```

#### `progress.set` — **조장 전용**
```jsonc
{ "action": "progress.set", "token": "...", "checkpoint": "CP1",
  "status": "완료", "score": 8, "memo": "" }
```
`status` 는 `대기|도착|완료`. 상태 전이 시각(`도착시각`/`완료시각`)은 서버가 찍습니다.
`Config.PROGRESS_OPEN=FALSE` 면 `CLOSED`.

#### `journal.list`
```jsonc
{ "action": "journal.list", "token": "...", "scope": "gallery", "cursor": 0, "limit": 30 }
```
- `scope: "gallery"` — `Config.GALLERY_SCOPE` 에 따라 `ALL`(같은 **참여 일자** 전체) /
  `TEAM`(같은 조) / `SELF`(본인) 범위의 **승인된** 일지.
  `JOURNAL_REQUIRE_APPROVAL=FALSE` 면 `대기` 도 포함. 승인 전이라도 본인 글은 본인에게 보입니다.
- `scope: "mine"` — 본인 일지 전부(상태 무관, `삭제` 제외).
- `scope: "team"` — **조장 전용**. 조원 일지 전부(상태 무관, `삭제` 제외).
- 응답 항목에는 `canEdit` 불리언이 포함됩니다(작성자 본인 또는 조장이면 `true`).

#### `journal.create`
```jsonc
{ "action": "journal.create", "token": "...", "checkpoint": "CP2",
  "text": "러시아공사관 앞에서...",
  "photo": { "name": "a.jpg", "mimeType": "image/jpeg", "dataBase64": "..." } }
```
`photo` 는 선택. 텍스트나 사진 중 하나는 있어야 합니다. `Config.JOURNAL_OPEN=FALSE` 면 `CLOSED`.

#### `journal.update` — 작성자 본인 / 소속 조장 / 관리자 (D-009)
```jsonc
{ "action": "journal.update", "token": "...", "id": "J0012",
  "text": "수정한 소감", "checkpoint": "CP2",
  "photo": { ... },      // 새 사진으로 교체
  "removePhoto": true }  // 사진만 삭제
```
승인 상태였다면 `대기` 로 되돌아갑니다(관리자 수정 제외).

#### `journal.delete` — 작성자 본인 / 소속 조장 / 관리자 (D-009)
```jsonc
{ "action": "journal.delete", "token": "...", "id": "J0012" }
```
소프트 삭제(`상태=삭제`) + Drive 사진 휴지통 이동.

#### `fee.status`
```jsonc
{ "action": "fee.status", "token": "..." }
// data
{ "me": { "status": "완납" },
  "members": [ { "id": "P0002", "name": "이조원", "status": "미납" } ] }  // 조장만
```
금액·납부일·납부수단은 반환하지 않습니다 (D-005).

---

### 관리자 (PIN 필요)

모든 관리자 액션은 `pin` 또는 관리자 토큰(`token`)을 받습니다.

| 액션 | 설명 |
|---|---|
| `admin.login` | `{ pin }` → 관리자 토큰 |
| | 관리자 토큰은 참가자 앱과 저장 키가 분리되어 있어 한 브라우저에서 동시에 쓸 수 있습니다 |
| `admin.journal.pending` | 승인 대기 목록 |
| `admin.journal.review` | `{ id, decision: "승인"\|"반려", reason }` |
| `admin.journal.update` / `admin.journal.delete` | 참가자용과 동일하나 전 범위 |
| `admin.progress.board` | 전 조 진행 현황 보드 — 조는 Teams 가 아니라 **명단에 실제로 존재하는 (참여 일자, 조 배정) 조합**에서 뽑습니다 |
| `admin.fee.board` | 회비·보험 현황 집계 (읽기). 수납액/예상수입 합계 포함 |
| `admin.config.set` | `{ key, value }` — `Config` 값 변경 |

---

## 레이트 리밋 / 보안 메모

- `auth.login` 은 **이름 기준** 10분 슬라이딩 윈도우로 `LOGIN_MAX_ATTEMPTS` 회 실패 시 잠금
  (`CacheService` 사용, 서버 재시작과 무관하게 10분 후 자동 해제).
- 토큰은 `payload.서명` 형식. 서명은 `HMAC-SHA256(TOKEN_SECRET)`. payload 는 `{ pid, exp }` 뿐입니다.
  역할·조·회차를 토큰에 담지 않는 이유: 발급 후 명단이 바뀌면 어긋나고, 권한 판단은 요청마다
  시트를 다시 읽어서 하기 때문입니다. 서명 검증은 **상수 시간 비교**로 합니다.
- 쓰기 액션은 `LockService.getScriptLock()` 으로 직렬화해 동시 기록 시 행이 깨지지 않게 합니다.
- 연락처 전체는 참가자용 어떤 응답에도 포함되지 않습니다.
