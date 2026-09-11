# 배포 가이드

`classfinder.plch.kr` 과 같은 구조입니다: **정적 프론트(GitHub Pages) + Cloudflare + GAS 백엔드**.

```
브라우저 ──HTTPS──> Cloudflare ──> GitHub Pages (docs/)   … 화면
    └────POST(text/plain)────> GAS Web App (/exec) ──> Google Sheets / Drive   … 데이터
```

---

## 1. 백엔드 (Google Apps Script)

### 1-0. 🔴 먼저 — 앱용 시트를 행정 DB 에서 분리하세요

행정 DB(`2026 정동 가을캠프`)의 **신청 폼 응답 탭에는 주민등록번호가 들어 있습니다.**
앱은 그 탭을 읽지 않지만, **웹앱을 같은 스프레드시트에 붙이면 스크립트가 그 탭까지
읽을 수 있는 상태**가 됩니다. 권한을 아예 열지 않는 것이 안전합니다.

**옮길 탭** (캠프 운영에 쓰는 것 전부 — 서로 동기화되므로 같이 가야 합니다)

- `마스터` (참가자 통합 관리)
- `회비관리`
- `조편성`
- `조별 이동 타임테이블`

**남길 탭** (행정 DB 원본에 그대로)

- 신청 폼 응답 (주민등록번호 포함)
- 교회 등록정보

**절차**

1. 새 스프레드시트를 만듭니다 → 이름: `PLC 정동캠프 2026`
2. 원본에서 위 4개 탭을 우클릭 → **다른 스프레드시트로 복사** → 새 문서 선택
3. 원본의 해당 탭은 지우거나, 새 시트를 보는 `IMPORTRANGE` 로 바꿔 둡니다
   (행정팀이 한 곳에서 계속 보려면 이 방법. 단 **IMPORTRANGE 는 보기 전용**이라
   명단 수정은 새 시트에서 해야 합니다 — 이 점을 행정팀과 먼저 합의하세요)
4. 앱스 스크립트는 **새 스프레드시트**에 붙입니다 (아래 1-1)

> 신청 폼에서 명단으로 옮길 때 주민등록번호·이메일은 **가져오지 마세요.**
> 앱 스키마에 그 열이 없으므로 실수로 붙여넣지 않는 한 들어가지 않습니다.

### 1-1. 스프레드시트와 스크립트 만들기

1. 위에서 만든 스프레드시트를 엽니다 (이름: `PLC 정동캠프 2026`)
2. 확장 프로그램 → Apps Script
3. `gas/` 안의 파일을 같은 이름으로 붙여넣기
   (`Code.gs` `Auth.gs` `Sheets.gs` `Journal.gs` `Setup.gs` `MasterSync.gs`, 그리고 `appsscript.json`)

   > ⚠ **`MasterSync.gs` 를 빠뜨리면 에러 없이 조용히** 시트 메뉴에서 `🔄 동기화 관리` 가
   > 사라집니다. `Setup.gs` 의 `onOpen` 이 이 파일의 함수를 `typeof` 로 확인한 뒤 부르기
   > 때문에, 없으면 실패하지 않고 메뉴만 안 붙습니다. 행정팀이 쓰던 마스터시트 동기화가
   > 통째로 멈추므로 붙여넣기 목록에서 빠지지 않게 하세요.
   - `appsscript.json` 이 안 보이면: 프로젝트 설정 → "`appsscript.json` 매니페스트 파일 표시" 체크
4. 저장 → 함수 목록에서 `setupSpreadsheet` 선택 → 실행 → 권한 승인 (탭 10개가 생성됩니다)

### 1-2. 스크립트 속성

프로젝트 설정 → 스크립트 속성:

| 속성 | 값 |
|---|---|
| `ADMIN_PIN` | 운영진 공유용 PIN (6자리 이상, 숫자만 아니어도 됨) |
| `TOKEN_SECRET` | 비워 두면 첫 실행 때 자동 생성됨 |

> `ADMIN_PIN` 을 시트가 아니라 스크립트 속성에 두는 이유: 시트 편집 권한이 있는 사람 전원에게
> 노출되는 걸 막기 위해서입니다.

### 1-3. Drive 폴더

1. Drive에 `정동캠프-탐험일지-사진` 폴더 생성
2. 폴더 URL의 `folders/` 뒤 문자열이 폴더 ID
3. `Config` 시트의 `DRIVE_FOLDER_ID` 에 붙여넣기

> **권한 메모**: 앱은 관리자가 직접 만든 폴더에 접근해야 하므로 `drive` 스코프를 씁니다
> (`drive.file` 은 앱이 만든 파일만 볼 수 있어 폴더 지정이 불가능합니다).
> 갤러리에서 `<img>` 로 바로 읽어야 해서 업로드된 사진은 **링크가 있는 사람은 볼 수 있음**으로
> 전환됩니다. 조직 정책으로 링크 공개가 막혀 있으면 사진은 저장되지만 썸네일이 뜨지 않습니다 —
> 그 경우 운영 계정을 개인 Google 계정으로 바꾸거나, 관리자에게 예외를 요청하세요.

### 1-4. 배포

배포 → 새 배포 → 유형: **웹 앱**

| 항목 | 값 |
|---|---|
| 설명 | `v1` |
| 실행 계정 | **나** |
| 액세스 권한 | **모든 사용자** |

발급된 `https://script.google.com/macros/s/.../exec` 를 복사합니다.

> ⚠ **코드를 고친 뒤에는 반드시 "배포 관리 → 편집(연필) → 버전: 새 버전 → 배포"** 를 해야
> 반영됩니다. 저장만으로는 `/exec` 이 바뀌지 않습니다. URL 은 그대로 유지됩니다.

---

## 2. 프론트엔드 (GitHub Pages)

1. `docs/assets/js/config.js` 의 `API_BASE` 를 위 `/exec` URL 로 교체 후 커밋·푸시
2. GitHub 저장소 → Settings → Pages
   - Source: **Deploy from a branch**
   - Branch: `main` / 폴더: **`/docs`**
3. 1~2분 뒤 `https://dev-plc.github.io/plc-jeongdong-camp/` 에서 확인

`docs/.nojekyll` 이 있어 Jekyll 빌드를 건너뜁니다(언더스코어로 시작하는 파일이 없어도 빌드가 빨라짐).

### 화면 주소

| 주소 | 용도 |
|---|---|
| `/` | 참가자 앱 |
| `/admin.html` | 운영 콘솔 (PIN) |

`admin.html` 에는 `noindex` 가 걸려 있지만 **주소를 아는 사람은 접근할 수 있습니다.**
실제 보호는 PIN 이므로 PIN 관리를 느슨하게 하지 마세요.

---

## 3. Cloudflare (커스텀 도메인)

`classfinder.plch.kr` 과 같은 방식입니다.

1. Cloudflare DNS에 CNAME 추가
   - 이름: `jeongdong` (원하는 서브도메인)
   - 대상: `dev-plc.github.io`
   - 프록시: **켬(주황 구름)**
2. 저장소에 `docs/CNAME` 파일을 만들고 안에 도메인 한 줄만 적기

   ```
   jeongdong.plch.kr
   ```

3. GitHub Settings → Pages → Custom domain 에 같은 도메인 입력, `Enforce HTTPS` 체크
4. Cloudflare SSL/TLS 모드는 **Full** 이상

> 도메인이 확정되지 않아 `docs/CNAME` 은 아직 만들지 않았습니다. 정해지면 위 2번만 하면 됩니다.

### 캐시

Cloudflare가 정적 파일을 캐시하므로 배포 후 화면이 안 바뀌면
Cloudflare 대시보드 → Caching → **Purge Everything** 을 한 번 실행하세요.

---

## 4. 배포 후 점검 (체크리스트)

- [ ] `/exec?action=health` 를 브라우저에서 열어 `{"ok":true,...}` 가 나오는지
- [ ] `/exec?action=bootstrap` 에 checkpoints 4개와 timeline 이 들어 있는지
- [ ] 앱 첫 화면에 참여 일자 두 개(10/31·11/07)가 보이는지
- [ ] 테스트 참가자로 로그인되는지 — 이름 뒤 구분번호를 빼고 입력해도 되는지
- [ ] 일부러 다른 날짜를 골라 로그인 → 실제 배정 일자로 들어가며 안내가 뜨는지
- [ ] 조장 계정으로 코스 화면에서 `도착` → `완료` 버튼이 눌리고 시트에 기록되는지
- [ ] 사진 1장 올려 보고 Drive 폴더에 파일이 생기는지
- [ ] `/admin.html` PIN 로그인 → 승인 대기에 그 사진이 뜨는지 → 승인 후 갤러리에 보이는지
- [ ] 갤러리 공개 범위를 `같은 조만` 으로 바꿔 보고, 다른 조 계정에서 안 보이는지
- [ ] **실제 연락처를 다 채운 뒤** `Config.LOGIN_ALLOW_NAME_DIGITS = FALSE` 로 내렸는지
      (명단 점검이 시점을 알려줍니다 — 켜 둔 채로는 이름 뒤 4자리로 로그인됩니다)

---

## 5. 캠프 당일 운영 메모

- **회차 사이**: 10/31 종료 후 11/07 준비 시 `Progress` / `Journal` 을 지우지 마세요.
  `참여 일자` 컬럼으로 분리되어 있어 서로 섞이지 않습니다.
  같은 "1조" 라도 날짜가 다르면 별개의 조로 처리됩니다.
- **일지 마감**: 캠프 종료 후 `Config.JOURNAL_OPEN = FALSE` 로 작성을 닫습니다.
- **시상 발표(주일)** 전까지 `admin.html` 진행 현황 표를 그대로 화면에 띄우면 집계 자료가 됩니다.
- **장애 시**: GAS 가 멈추면 조장들은 종이 체크리스트로 전환하고, 나중에 시트에 직접 입력하면
  앱 화면이 동일하게 복구됩니다. 앱은 시트의 뷰일 뿐 원장이 아닙니다.

---

## 6. 로컬에서 화면만 보기

```bash
python3 -m http.server 8080 --directory docs
# http://localhost:8080
```

`API_BASE` 가 배포 URL을 가리키므로 실데이터에 붙습니다. 화면만 만지려면 배포 전 URL 그대로 두면
"서버 주소가 설정되지 않았습니다" 안내가 뜹니다.

## 7. clasp (선택)

로컬에서 GAS를 직접 밀어 넣고 싶다면:

```bash
npm i -g @google/clasp
clasp login
cd gas
cp .clasp.json.example .clasp.json   # scriptId 를 채운 뒤
clasp push
```

`scriptId` 는 Apps Script 편집기 → 프로젝트 설정 → 스크립트 ID 에서 확인합니다.
