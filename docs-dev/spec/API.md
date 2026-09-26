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
  "labels": { "audience": "캠프 대상", "session": "참여 일자", "group": "조 배정",
              "feeStatus": "입금 여부", "insurance": "여행자 보험 가입", "course": "배정 코스", ... },
  "sessions": [ { "label": "10/31(토)", "date": "2026-10-31" },
                { "label": "11/07(토)", "date": "2026-11-07" } ],
  "checkpoints": [ { "code": "CP1", "order": 1, "name": "배재학당역사박물관", ... } ],
  "notices": [ { "id": "N001", "target": "전체", "title": "...", "body": "...", "pinned": true } ],
  "timeline": { "10/31(토)": [ { "start": "09:30", "end": "09:50", "title": "...", ... } ],
                "11/07(토)": [ ... ] },
  "serverTime": "2026-10-31T09:12:00+09:00"
}
```

`labels` 는 마스터시트의 헤더 이름을 그대로 내려보냅니다. 화면의 항목 이름이 전부 여기서 나오므로,
`gas/Sheets.gs` 의 `COL` 을 고치면 앱 문구도 자동으로 따라갑니다.

#### `health`
배포가 살아 있는지 확인하는 용도. **GET 전용**이며 시트를 읽지 않습니다.
```jsonc
// GET {API_BASE}?action=health
// data
{ "ok": true, "serverTime": "2026-10-31T09:12:00+09:00",
  "versions": { "Auth.gs": "v15", "Code.gs": "v15", "Journal.gs": "v15",
                "MasterSync.gs": "v15", "Mirror.gs": "v15", "Setup.gs": "v15", "Sheets.gs": "v15" } }
```
브라우저에서 `{API_BASE}?action=health` 를 열었을 때 이 JSON 이 보이면 배포·권한 설정이
정상입니다. HTML 이 보이면 웹 앱 접근 권한이 `모든 사용자` 가 아닙니다 (`DEPLOY.md` 참고).

`versions` 는 **붙여넣은 `.gs` 파일마다의 버전**입니다 (D-049). 배포 뒤 이걸 보면 빠뜨린
파일이 드러납니다. 값이 `null` 이면 버전 표시가 생기기 전의 옛 파일입니다.

#### `auth.login`
```jsonc
{ "action": "auth.login", "session": "10/31(토)", "name": "홍길동", "phoneLast4": "5678" }
// data
{ "token": "eyJ...", "expiresAt": "...", "me": { /* me 와 동일 + sessionCorrected */ } }
```

- `session` 은 **선택**입니다. 후보를 좁히는 힌트로만 쓰이며, 참가자가 다른 날짜를 골라도
  명단이 맞으면 실제 배정된 날짜로 로그인됩니다. 이때 `me.sessionCorrected = true` 가 옵니다.
- `name` 은 마스터시트의 구분번호를 뗀 이름(`이승천`)도, 붙은 이름(`이승천7377`)도 받습니다.
- `phoneLast4` 는 기본적으로 `연락처` 의 마지막 4자리입니다.
  `Config.LOGIN_ALLOW_NAME_DIGITS=TRUE` 인 동안에만 이름 뒤에 붙은 4자리도 대체로 인정합니다 —
  연락처가 임시값인 기간용 임시 조치이며, 실제 연락처를 채우면 `FALSE` 로 내려야 합니다 (D-003).

---

### 참가자 (토큰 필요)

#### `me`
본인 + 소속 조 + (조장이면) 조원 목록.
```jsonc
{
  "participant": { "id": "P0001", "name": "홍길동", "audience": "청년부",
                   "session": "10/31(토)", "role": "조장", "group": "1조",
                   "feeStatus": "완납", "insurance": "가입완료" },
  "team": { "session": "10/31(토)", "group": "1조", "name": "1조 배재", "color": "#984534",
            "leaderName": "김캠티", "meetingPoint": "PL교회 본당 앞",
            "course": "C코스(보구여관 시작)", "route": ["CP3","CP4","CP1","CP2"] },
  "isLeader": true,
  "mode": "leader",          // station | leader | member | ops (v16, D-051)
  "station": null,           // mode=station 이면 { "code": "CP1", "name": "배재학당역사박물관" }
  "members": [ { "id": "P0002", "name": "이조원", "role": "일반",
                 "feeStatus": "미납", "insurance": "미가입" } ]
}
```
`members` 는 `isLeader=true` 일 때만 채워집니다. `연락처`는 어떤 경우에도 포함되지 않습니다.
이름은 마스터시트의 구분번호가 제거된 표시용 이름입니다.
`isLeader` 는 **조가 있고** `역할` 이 `조장` / `스태프` / `교역자` 중 하나일 때 참입니다 (v16 — `사역자` 는 `교역자` 로 바뀌었고, 조 없는 스태프·교역자는 조장이 아닙니다).

**`mode`** (v16, D-051)

| mode | 조건 | 앱 |
|---|---|---|
| `station` | 역할 `스태프` + `담당 지점` | 코스 탭 = **내 지점** (`station.*`) |
| `leader` | 조 있음 + 조장·스태프·교역자 | 지금 그대로 |
| `member` | 조 있음 + 일반, 또는 조 없는 일반 | 지금 그대로 (조 없으면 "조 미배정") |
| `ops` | 조 없음 + 교역자·스태프 | 코스 탭 = **진행** (`ops.board`, 읽기 전용) |

조 없는 교역자·스태프는 `참여 일자` 를 비울 수 있습니다 — **전 회차**. `participant.session` 에는
오늘 날짜의 활성 회차(없으면 다음, 없으면 마지막)가 실립니다.

#### `progress.list`
소속 조의 4개 지점 진행 상태.
```jsonc
{ "action": "progress.list", "token": "..." }
// data: [ { "checkpoint": "CP1", "status": "완료", "arrivedAt": "...", "completedAt": "...",
//           "score": 8, "scoreSource": "스태프" } ]
```
`scoreSource` (v16) — 점수를 넣은 쪽: `스태프` / `조장` / `관리자` / `''`.
🔴 사본(Supabase `progress_cache`)에는 이 열이 없습니다 — 미러에서 읽은 목록에는 `scoreSource` 가 빠집니다.

#### `progress.set` — **조장 전용**
```jsonc
{ "action": "progress.set", "token": "...", "checkpoint": "CP1",
  "status": "완료", "score": 8, "memo": "" }
```
`status` 는 `대기|도착|완료`. 상태 전이 시각(`도착시각`/`완료시각`)은 서버가 찍습니다.
`Config.PROGRESS_OPEN=FALSE` 면 `CLOSED`. 묶음은 `{ items: [ {checkpoint, status, score?}, … ] }` (D-045).

🔴 **스태프 점수 우선** (v16, D-052) — `점수출처=스태프` 인 지점에 조장이 점수를 보내면 **점수만 무시**하고
상태는 기록합니다(거절하면 같은 묶음의 도착·완료까지 날아갑니다). 응답 목록의 `score`·`scoreSource` 로 앱이 알립니다.
`Progress` 에 `점수출처` 열이 없으면 점수가 든 요청은 `SERVER_ERROR` — `초기 세팅 실행` 을 다시 돌리라는 뜻입니다.

#### `station.board` — **거점 스태프**(`mode=station`) 전용 (v16)
```jsonc
{ "action": "station.board", "token": "..." }
// data
{ "session": "10/31(토)",
  "checkpoint": { "code": "CP1", "name": "…", "mission": "…", "quizUrl": "…" },
  "teams": [ { "group": "2조", "name": "2조 정동", "leaderName": "…", "memberCount": 5,
               "visitOrder": 1, "prevName": "", "prevStatus": "",
               "status": "완료", "arrivedAt": "…", "completedAt": "…", "score": 10, "scoreSource": "스태프" } ] }
```
내 회차에서 **이 지점을 지나는 조**만, 이 지점에 오는 순서(`visitOrder`)대로. `prevStatus` 가 `완료` 면 "오는 중".

#### `station.set` — 거점 스태프 전용 (v16)
```jsonc
{ "action": "station.set", "token": "...", "items": [ { "group": "3조", "status": "도착" },
                                                     { "group": "2조", "score": 9 } ] }
```
지점·회차는 **로그인한 스태프에게서** 정합니다 — 요청에 지점을 적어도 무시합니다. 이 지점을 지나지 않는 조가
하나라도 있으면 묶음 전체를 `FORBIDDEN`. 상태 없이 점수만 보낼 수 있습니다. 응답은 갱신된 `station.board`.
조마다 사본을 밀어 조장 화면(미러에서 읽음)에도 바로 보입니다.

#### `ops.board` — 교역자·스태프(`mode=ops|station`) (v16)
`admin.progress.board` 와 같은 모양을 **내 회차로 거른 읽기 전용**. `{ session, checkpoints, teams }`.
관리 기능(정정·검수·공지)은 운영 콘솔(PIN)에서만.

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
**승인 또는 반려** 상태였다면 `대기` 로 되돌아가고 옛 `반려사유` 는 지워집니다
(관리자 수정과 `JOURNAL_REQUIRE_APPROVAL=FALSE` 는 제외). 반려된 글을 고쳐 다시 내는
길입니다 — 예전에는 `승인` 일 때만 되돌려서 반려본은 다시 낼 수 없었습니다 (D-046).

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
| `admin.journal.pending` | 승인 대기 목록 (`상태 = 대기`) |
| `admin.journal.list` | **삭제를 뺀 전체 목록**, 최신순 (D-046). 상태 거르기는 앱이 받아 둔 데이터로 합니다 |
| `admin.journal.review` | `{ id, decision: "승인"\|"반려", reason }` |
| `admin.journal.reviewBatch` | `{ ids: [...], decision: "승인" }` (v16) — **대기 글만** 한 번의 락으로 승인, 나머지는 건너뜀. → `{ approved, skipped }`. 일괄 반려는 없습니다 |
| `admin.journal.award` | `{ id, award: true\|false }` (v16) — ★ 사진 수상작. **승인된 사진 글만** 지정 가능. 목록 항목에 `award` |
| `admin.journal.update` / `admin.journal.delete` | 참가자용과 동일하나 전 범위 |
| `admin.notice.list` | 공지 **전부** — 예약·종료된 것까지, `targets`(고를 수 있는 대상) 동봉 (D-048) |
| `admin.notice.save` | `{ id?, target, title, body, pinned, endsAt? }` — `id` 가 없으면 만들고 있으면 고칩니다. `게시일시` 는 만들 때만 찍고 이후 건드리지 않습니다 |
| `admin.notice.delete` | `{ id }` — 행을 **실제로 지웁니다**(일지와 달리 소프트 삭제가 아닙니다) |
| `admin.progress.board` | 전 조 진행 현황 보드 — 조는 Teams 가 아니라 **명단에 실제로 존재하는 (참여 일자, 조 배정) 조합**에서 뽑습니다. 칸에 `scoreSource` (v16) |
| `admin.progress.set` | `{ session, group, checkpoint, status?, score? }` (v16) — 칸 정정. 출처 `관리자`, 스태프 점수도 고칩니다. 사본까지 밀고 갱신된 보드를 돌려줍니다 |
| `admin.fee.board` | 회비·보험 현황 집계 (읽기). 수납액/예상수입 합계 포함 |
| `admin.config.set` | `{ key, value, note?, allowNew? }` — `Config` 값 변경. `note` 는 `설명` 열에 함께 기록됩니다. 반환: `publicConfig_()` (반영 후 공개 설정 전체). 설정·부트스트랩 캐시를 함께 비웁니다.<br>**없는 키는 거절됩니다** — 오타로 새 키가 조용히 생기는 것을 막기 위해서입니다(비슷한 키를 제안). 새 키를 정말 추가하려면 `allowNew: true` |

---

## 레이트 리밋 / 보안 메모

- `auth.login` 에 **시도 횟수 제한은 없습니다**(D-003). 현장에서 참가자가 잠기는 비용이
  무차별 시도로 얻을 수 있는 것(같은 조 진행 상황·일지)보다 크다고 판단했습니다.
  실패는 `Log` 시트에 남으므로 사후 확인은 됩니다.
- 토큰은 `payload.서명` 형식. 서명은 `HMAC-SHA256(TOKEN_SECRET)`. payload 는 `{ pid, exp }` 뿐입니다.
  역할·조·회차를 토큰에 담지 않는 이유: 발급 후 명단이 바뀌면 어긋나고, 권한 판단은 요청마다
  시트를 다시 읽어서 하기 때문입니다. 서명 검증은 **상수 시간 비교**로 합니다.
- 쓰기 액션은 `LockService.getScriptLock()` 으로 직렬화해 동시 기록 시 행이 깨지지 않게 합니다.
- 연락처 전체는 참가자용 어떤 응답에도 포함되지 않습니다.
