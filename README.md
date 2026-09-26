# PLC 정동 가을캠프 — 신앙탐험대

역사와 신앙의 현장을 직접 걸으며 배우는 **PLC 성경적세계관 캠프** 의 현장 앱입니다.
참가자는 자기 조의 답사 코스와 일정을 보고, 조장은 지점별 진행을 기록하며,
모두가 탐험일지(사진·소감)를 남깁니다.

- **일정**: 2026. 10. 24(토) · 2026. 10. 31(토) — 청년부/장년부는 두 날짜에 나뉘어 참여합니다
- **코스**: 배재학당역사박물관 · 러시아 공사관과 킹스로드 · 보구여관 터 · 이화여고 박물관
  (조마다 배정 코스 A~D 로 시작 지점이 다릅니다 — 현장 혼잡 분산)

## 스택

```
브라우저 → Cloudflare → GitHub Pages (docs/)      … 정적 화면
        → Google Apps Script Web App (/exec)      … API
                       → Google Sheets            … 데이터 원장
                       → Google Drive             … 탐험일지 사진
```

서버도 빌드 도구도 없습니다. `docs/` 를 그대로 올리고 GAS 하나를 배포하면 끝입니다.
(`classfinder.plch.kr` 과 같은 구조)

## 폴더

```
docs/                     GitHub Pages 로 서비스되는 정적 앱
  index.html              참가자 앱
  admin.html              운영 콘솔 (PIN)
  demo.html               ⭐ 서버 없이 클릭해 보는 화면 미리보기 (생성물)
  assets/css/app.css      브랜드 토큰 + 전체 스타일
  assets/js/config.js     ⚠ 배포 후 API_BASE 를 여기에 넣습니다
  assets/js/api.js        GAS 통신 계층
  assets/js/ui.js         DOM·토스트·사진 리사이즈 유틸
  assets/js/app.js        참가자 화면 로직
  assets/js/admin.js      운영 콘솔 로직

gas/                      Apps Script 프로젝트 (편집기에 붙여넣기)
  Code.gs                 진입점 · 라우팅 · 진행/회비/관리자 보드
  Auth.gs                 로그인 · 토큰 · 권한
  Sheets.gs               시트 접근 레이어 + 스키마 정의
  Journal.gs              탐험일지 (작성/수정/삭제/검수)
  Setup.gs                최초 세팅 · 명단 점검 도구 · 메뉴
  MasterSync.gs           행정팀 탭 간 명단 동기화 + 헤더 검증
  appsscript.json         매니페스트

tools/
  build-demo.js           docs/demo.html 생성기

docs-dev/                 개발·운영 문서 (배포되지 않음)
  plan/                   원본 업무 계획서 PDF
  brand/                  브랜드 가이드 (컬러·서체·엘리먼트)
  spec/                   시트 스키마 · API 명세 · 결정사항(ADR) · 백로그 · 명단 CSV 템플릿
  ops/                    배포 가이드
```

## 화면 먼저 보기

GAS 배포 전에도 `docs/demo.html` 하나만 열면 전 화면을 클릭해 볼 수 있습니다.
참가자 앱 ↔ 운영 콘솔, 조장 ↔ 일반 참가자 시점을 상단 바에서 전환합니다(운영 콘솔 PIN: `000000`).

```bash
python3 -m http.server 8080 --directory docs   # → http://localhost:8080/demo.html
```

앱 코드를 고친 뒤에는 `node tools/build-demo.js` 로 데모를 다시 만듭니다.
데모는 실제 `app.css` / `api.js` / `ui.js` / `app.js` / `admin.js` 를 그대로 인라인하고
`fetch` 만 가짜 백엔드에 물리므로, 화면이 실제와 어긋나지 않습니다.

이 데모는 **아티팩트로도 올라가 있습니다** — 운영진에게는 이 링크를 보냅니다.
<https://claude.ai/artifact/DQQvR4awqr3iAXfcYZHdTM>
다시 만들었으면 **거기에도 다시 올려야 합니다.** 안 그러면 링크만 옛 화면으로 남습니다
(실제로 3주간 그랬습니다 — D-046).

## 시작하기

1. **[`docs-dev/ops/DEPLOY.md`](docs-dev/ops/DEPLOY.md)** 를 따라 GAS 를 배포하고
   `docs/assets/js/config.js` 의 `API_BASE` 를 채웁니다.
2. Apps Script 편집기에서 `setupSpreadsheet()` 을 한 번 실행하면 시트 10개가 만들어집니다.
3. 행정팀 마스터시트를 `Participants` 에 그대로 붙여넣고(헤더가 동일합니다),
   스프레드시트 메뉴 `🧭 캠프 앱` 에서 **참가자ID 채우기 → 조 목록 동기화 → 명단 점검** 을 실행합니다.
4. GitHub Settings → Pages 에서 `main` 브랜치 `/docs` 를 소스로 지정합니다.

## 문서

| 문서 | 내용 |
|---|---|
| [구조 안내 (운영진용)](docs-dev/ops/ARCHITECTURE.md) | **코드를 안 읽는 사람용** — 시트와 앱의 관계, 일지가 기록되는 방식, 바꾸면 뭐가 따라 바뀌나, 함정 |
| [시트 스키마](docs-dev/spec/SHEET-SCHEMA.md) | 10개 탭의 컬럼 정의, 마스터시트 연동, 초기 세팅 순서 |
| [API 명세](docs-dev/spec/API.md) | 액션 목록, 요청/응답, 에러 코드 |
| [결정사항 (ADR)](docs-dev/spec/DECISIONS.md) | 인증 방식·공개 범위·회비 처리 등 확정된 판단과 그 이유 |
| [추가 작업 예정](docs-dev/spec/BACKLOG.md) | 아직 안 만든 것 — 진행 현황 실시간 파악, 버전 기반 자동 새로고침 |
| [DB 도입 설계](docs-dev/spec/DATABASE.md) | 읽기 미러 구조, **Firebase vs Supabase 비교**, 이번엔 안 넣는 이유, 넘어갈 기준 수치 |
| [브랜드 가이드](docs-dev/brand/BRAND.md) | 붉은벽돌 `#984534` / 회색담벼락 `#c2c2c2`, 서체, 그래픽 |
| [배포 가이드](docs-dev/ops/DEPLOY.md) | GAS · Pages · Cloudflare 설정과 당일 운영 메모 |

## 확정된 주요 결정

| | 결정 | 근거 |
|---|---|---|
| 로그인 | 이름 + **연락처 뒷 4자리** | 운영 부담 최소. 연락처 전문은 API 응답에 절대 포함하지 않음 |
| 회차 구분 | **참여 일자**(10/31·11/07) | `캠프 대상`(청년부/장년부)과 독립적인 축 — 청년부 11/07 참여자가 실제로 있음 |
| 탐험일지 공개 | **전체 공개** + 관리자 승인 큐 | 몰입도 우선. `Config` 한 줄로 *조 단위* 전환 가능 |
| 일지 수정·삭제 | 작성자 본인 / 소속 조장 / 전체 관리자 | 소프트 삭제(감사 보존), 승인본 수정 시 재승인 |
| 회비 | **조회 전용** | 수납·정산은 행정가가 시트에서. 앱에 쓰기 경로 없음 |
| 진행 기록 | 조 단위, **조장만** 기록 | 80명 개인 체크인은 현장 병목. 조 = `(참여 일자, 조 배정)` |
| 시트 헤더 | 마스터시트 표기 **그대로** | 행정팀이 자기 시트를 복사·붙여넣기 하는 흐름을 그대로 살림 |
| 화면 문구 | 시트 헤더를 **따라감** | `COL` 을 고치면 앱 라벨도 같이 바뀜 — 시트와 앱에서 부르는 이름이 항상 일치 |

자세한 배경은 [결정사항 문서](docs-dev/spec/DECISIONS.md)에 있습니다.

## 마스터시트 연동

`Participants` 시트는 행정팀 마스터시트와 헤더가 같습니다 — 값만 그대로 붙여넣으면 됩니다.
템플릿: [`docs-dev/spec/participants-template.csv`](docs-dev/spec/participants-template.csv)

이름 뒤에 붙은 동명이인 구분번호(`이승천7377`)는 앱이 알아서 처리합니다.
참가자는 `이승천` 으로 입력해도 되고, 연락처가 아직 임시값인 행은 이름 뒤 4자리로 로그인됩니다.
화면에 보이는 이름에서는 구분번호가 자동으로 제거됩니다.

## 운영 중 바꿀 수 있는 것

배포 없이 `Config` 시트(또는 `/admin.html` → 설정)에서 즉시 바뀝니다.

- 참여 일자(`SESSION_1` / `SESSION_2` / …) — 날짜가 바뀌어도 배포 불필요.
  회차를 더 늘리는 것도 시트 메뉴 `회차 추가` 로 가능합니다(사전답사 리허설 등)
- 탐험일지 공개 범위 (`전체 / 같은 조 / 본인만`)
- 일지 작성·조장 진행 기록 열고 닫기
- 일지 승인 필요 여부
- 회비 상태 노출 여부
- 상단 한 줄 공지
