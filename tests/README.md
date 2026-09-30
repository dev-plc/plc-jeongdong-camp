# tests — 저장소 안의 테스트

2026-09-29 컨테이너 재시작으로 scratchpad 에만 있던 테스트(약 1,070건)가 사라졌다.
커밋하지 않은 테스트는 테스트가 아니다 — 그래서 여기에 다시 세웠다.

```
node tests/run.js           # 전부 (약 45초)
node tests/run.js server    # 서버만 — 1초 안쪽. .gs 를 고쳤으면 이것부터
node tests/run.js app       # 앱 통신 계층(api.js)만 — 브라우저 없이
node tests/run.js db        # Supabase SQL — 로컬 Postgres 에 그대로 적용
node tests/run.js ui        # 화면만 (docs/demo.html + Chromium)
node tests/run.js tools     # 버전 헤더 · 생성물 · 비밀 키
node tests/run.js -v        # 스위트 출력을 전부 본다
```

하나라도 실패하거나 스위트가 죽으면 1 로 끝난다. 외부 패키지를 설치하지 않는다 —
`node` 와 (화면만) 전역 Playwright·Chromium, (DB 만) 로컬 Postgres(`/usr/lib/postgresql/*/bin`)면 된다.
없으면 그 스위트는 **건너뜀** 으로 따로 세고, 통과로 치지 않는다.

## 무엇을 보나

| 파일 | 내용 |
|---|---|
| `server/health.test.js` | 파일 끝 표시 (D-054) — v16 `Setup.gs` 잘림 사고를 재현해 `problems` 가 잡는지 |
| `server/roles.test.js` | 조 없는 교역자·스태프, 담당 지점, 공란 회차, 동명 회차 행 (D-051) |
| `server/progress.test.js` | 스태프 점수 우선, 지점·회차는 서버가 정함, 배치 전부-아니면-전무, 정정·일괄 승인·시상 (D-045·052) |
| `server/people.test.js` | 명단 사본(D-055) — 누가 올라가나(공란 제외), 연락처 원문 없음, 키 = 로그인 규칙, 사본 `me` = GAS `me`, 끄면 지움 |
| `app/api.test.js` | `api.js` 사본 경로와 폴백(404·500·null·시간 초과·WebCrypto 없음 → GAS) |
| `db/people.test.js` | `docs-dev/ops/supabase-people.sql` 을 로컬 Postgres 에: anon 은 표를 못 읽음, 함수, 30분 조건, **끝-끝**(앱 → SQL → GAS) |
| `server/core.test.js` | 초기 세팅, 로그인·토큰, 일지 흐름, 공지(v13 사고), 회비, 설정 오타, 사본 실패 |
| `ui/demo-a.test.js` | 홈 지금·다음, 코스 다음 동작·접기, 조별 카드·40분 ⚠ (D-050) |
| `ui/demo-b.test.js` | 스태프 내 지점, 교역자 진행(읽기 전용), 조장 점수 칸 (D-051·052) |
| `ui/smoke.test.js` | 페르소나 넷 × 탭 전부 + 콘솔 탭 전부: JS 오류·오류 토스트·가로 넘침·13px 미만 글자 |
| `tools.test.js` | `check-versions` 가 어긋남을 막는지(사본에서), `demo.html`·`?v=` 가 최신인지, 비밀 키가 없는지 |

## 어떻게 도나

- **서버** — `lib/gas.js` 가 `gas/*.gs` 일곱 개를 Apps Script 처럼 한 전역에 올리고,
  시트·속성·캐시·Drive·UrlFetch 를 메모리로 흉내 낸다. 🔴 요청마다 `.gs` 의 `var __캐시 = …` 를
  다시 초기화한다 — Apps Script 는 요청마다 새로 실행되기 때문이다(빼면 테스트가 실제로 틀린다).
- **화면** — `lib/browser.js` 가 `docs/` 를 띄우고 `demo.html` 을 연다. 시계는 `page.clock` 으로
  고정하고 `timezoneId: 'Asia/Seoul'` 을 준다(안 주면 headless 가 UTC 라 시각이 9시간 어긋난다).
  데모는 생성물이므로 **앱을 고쳤으면 `node tools/build-demo.js` 뒤에** 돌린다.

## 옛 스위트 이름

`docs-dev/spec/DECISIONS.md` 에 나오는 `browser.js` · `demo-check.js` · `test-mirror.js` · `test.js` 등은
**사라진 옛 스위트**다(원본 없음). 그 결정의 핵심 회귀(점수 보존 D-039, 사본 실패 D-032·038,
공지 삭제 v13 등)는 위 스위트로 다시 막았지만, 전부 옮긴 것은 아니다. 옛 스위트가 막던 곳을 고칠 때는
여기에 테스트가 있는지 먼저 보고, 없으면 그 커밋에서 더한다.

## 규칙

- 🔴 **가짜 이름·가짜 번호만** (`010-1000-…`, `010-2000-…`). 실제 명단·연락처는 절대 넣지 않는다 — 공개 저장소다.
  `sb_secret_` 는 `sb_secret_TEST_ONLY` 만 쓴다 (`tools.test.js` 가 다른 값을 막는다).
- **되돌려서 무는지 본다.** 고친 줄을 빼고 돌려 실패하는지 확인한 뒤 커밋한다.
  (2026-09-30 확인: `fileProblems_` 끝 분기, 스태프 우선, 공란 회차, END 검사, 공지 삭제, 배치 검증, 13px 하한 — 모두 실패로 바뀐다.)
- 새 기능은 스위트를 더하거나 늘린다. 새 탭은 `ui/smoke.test.js` 목록에 더한다.
- `tests/` 는 버전 헤더 대상(`check-versions` 의 `FILES`)이 아니다 — 배포물이 아니다.
