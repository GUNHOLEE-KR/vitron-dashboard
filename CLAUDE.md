# 바이트론 이앤에스 업무 현황 대시보드

직원별 일간/주간/월간/연간 업무 기록 및 Jira 연동 대시보드.

## ⚠️ 대화·작업 규칙 (최우선 — 반드시 준수)

이 규칙은 기기·세션·경로와 무관하게 항상 적용된다. (이 파일이 git으로 모든 기기에 동기화되므로 새 기기·새 로그인에서도 자동 적용)

1. **말투 — 항상 공손한 존댓말.** 반말("~할게", "~할까?", "~이야") 절대 금지. 문장 종결은 "~합니다 / ~하겠습니다 / ~할까요?" 형태로.
2. **파일 편집 전 반드시 확인.** 아무리 간단한 수정이라도 계획·원인을 먼저 설명하고 "진행할까요?"로 동의를 받은 뒤에만 Edit/Write를 사용한다. "간단해서", "명백한 버그라서" 같은 예외 없음.
   - **승인 게이트(2026-07-17 추가)**: Write/Edit/커밋/push 직전에 반드시 자문한다 — *"직전 사용자 메시지에 명시적 실행 지시(하자/해줘/진행/응/번호 선택)가 있는가?"* 없으면(질문·감상·설명이면) **도구를 쓰지 않고 답변만 하고 턴을 끝낸다.** 사용자의 질문은 승인이 아니라 추가 질문이다. 제안으로 끝나는 턴은 반드시 도구 호출 없이 끝난다. 승인 1번은 그 작업 1건에만 유효하며 다음 작업으로 확대 적용하지 않는다.
3. **수정 후 동작 검증 후 보고.** 브라우저/앱에서 실제 동작을 확인한 뒤 결과를 보고한다.
4. **수정 완료 후 push.** 작업이 끝나면 `git add` → `commit` → `push` 까지 수행한다.

## 기술 스택
- **Frontend**: React + Vite (단일 파일 구조 — `src/App.jsx`)
- **Backend**: Node.js + Express (`server/index.js`)
- **DB**: 사내 PostgreSQL (`vitron-nas:5432`, DB `vitron_dashboard`)
- **배포**: 사내 NAS Docker (`http://vitron-nas:8082`) — 아래 배포 절차 참고
- **저장소**: 사내 Gitea 주 저장소 + GitHub 백업 (`git push` 한 번에 양쪽 전송)
  - 주: `http://vitron-nas:8084/GunhoLee/vitron-dashboard` (origin)
  - 백업: `https://github.com/GUNHOLEE-KR/vitron-dashboard` (origin push 대상에 포함, 별칭 `github`)
  - ⚠️ Git 저장소는 **배포 경로에 없다.** `push-to-nas.ps1` 이 로컬 커밋을 직접
    tar 로 묶어 NAS 에 보내므로, push 하지 않아도 배포되고 저장소를 옮겨도 배포는 영향 없다

> Supabase·Vercel 은 2026-06-02 에 걷어냈다. `supabase/`·`api/` 폴더는 잔재이며 사용하지 않는다.

## 주요 파일 구조
```
src/
  App.jsx                  # 전체 UI (컴포넌트 분리 없이 단일 파일)
  repositories/            # 백엔드 REST API 호출 (fetch)
    workerRepo.js          # 직원 CRUD
    historyRepo.js         # 업무 기록 CRUD
    jiraRepo.js            # Jira 동기화·이슈 관리·토큰 만료 조회
server/
  index.js                 # Express REST API + Jira 동기화 (단일 파일)
db/init.sql                # PostgreSQL 스키마 (테이블 3개)
Dockerfile.frontend        # React 빌드 → nginx
Dockerfile.backend         # Node.js API 서버
nginx.conf                 # /api/* → backend 프록시, 타임아웃 300초
docker-compose.yml         # 프론트(8082) + 백엔드 2개 컨테이너
deploy.sh                  # NAS 배포 스크립트
```

## PostgreSQL 테이블
- `workers` — 직원 정보 (name, active, hired_at, resigned_at)
- `work_history` — 업무 기록 (worker_name, work_date, work_hour, work_text)
- `jira_issues` — Jira 이슈 캐시 (jira_key, summary, parent_key, full_text)

⚠️ `DATE` 타입은 `pg` 가 Date 객체로 바꿔 프론트의 `slice(0,7)` 를 깨뜨린다.
`server/index.js` 에서 `types.setTypeParser(1082, …)` 로 문자열 유지 중이니 제거하지 말 것.

## Jira 동기화
- 프론트 → 백엔드 `POST /api/jira-sync` → Jira REST API → PostgreSQL
- 토큰은 서버 환경변수에만 있으므로 **로그인 없이 누구나 동기화 가능**
- 검색은 신형 `/rest/api/3/search/jql` + `nextPageToken` 페이지네이션
  (구형 `/rest/api/3/search` 는 Atlassian 이 제거해 410)
- 조회 0건이면 **기존 목록을 지우지 않고 중단** (전량 삭제 사고 방지)
- 페이지 100장·이슈 2만 건 상한 + 토큰 반복 감지 — 메모리 고갈 방지
- 동기화 중 토스트는 `duration=0`으로 완료 전까지 계속 표시

### Jira API 토큰
- Atlassian 정책상 **최대 유효기간 365일**, 무기한 토큰 없음
- 만료일 조회 API 가 없어 `.env` 의 `JIRA_TOKEN_EXPIRES=YYYY-MM-DD` 에 직접 기록
- 만료 30일 전부터 화면 상단 배너 + 설정 탭에 남은 일수 표시
- 갱신 시 `.env`(NAS 는 `/volume1/docker-build/.env`) 교체 후 `./deploy.sh`

## 개발 서버
백엔드와 프론트를 **둘 다** 띄워야 한다. Vite 가 `/api` 를 3001 로 프록시한다.
```powershell
cd server; node index.js   # 백엔드 :3001 (.env 는 프로젝트 루트에서 읽음)
npm run dev                # 프론트 :5173
```
`.claude/launch.json`에 서버 설정 있음 — Preview 도구로 브라우저 테스트 가능.

## 배포 (사내 NAS)
**PC 에서 이 한 줄이면 끝난다.** (압축 → 전송 → 원격 빌드·교체까지 자동)
```powershell
.\push-to-nas.ps1
```
- 커밋된 내용(git HEAD)만 배포된다. 미커밋 변경이 있으면 경고하고 확인을 받는다
- 비밀번호를 두 번(scp·ssh) 묻는다. SSH 키를 등록하면 생략된다
- NAS 소스 폴더 `/volume1/docker-build`, 실제 빌드는 그 안의 `deploy.sh` 가 수행
- 수동으로 할 경우: `git archive --format=tar.gz -o vitron-src.tar.gz HEAD` → `scp`
  → NAS 에서 `tar -xzf vitron-src.tar.gz && ./deploy.sh`

### 배포 관련 주의사항
- NAS 에는 `git` 이 없다 (그래서 파일 전송 방식)
- Portainer 스택(`vitron-dashboard`)으로 등록돼 있고 컨테이너 이름을 이어받는다.
  Portainer 화면에는 Editor 가 안 뜨므로 **갱신은 항상 위 스크립트/`deploy.sh` 로 한다**
  (Portainer UI 에서 스택을 Update 하면 옛 정의로 되돌아갈 수 있다)
- `.env` 는 git 에 없다. NAS 의 `/volume1/docker-build/.env` 를 그대로 유지한다
  (tar 에 포함되지 않으므로 배포해도 덮어써지지 않는다)
- ⚠️ **`.ps1` 은 UTF-8 BOM 으로 저장해야 한다.** BOM 이 없으면 PowerShell 5.1 이
  ANSI 로 읽어 한글이 깨지고 파싱 오류가 난다
- ⚠️ **`.sh` 는 LF 로 유지해야 한다.** CRLF 면 NAS 에서 bad interpreter 오류가 난다
  (`.gitattributes` 로 고정해 둠)

## 주의사항
- `App.jsx`는 의도적으로 단일 파일 구조 유지 (분리 금지)
- 탭 구성: 오늘 업무 / 일간 / 주간 / 월간 / 연간 / 설정
- 직원 필터는 기간별로 재직 여부를 판단 (`workersForPeriod` 함수)
