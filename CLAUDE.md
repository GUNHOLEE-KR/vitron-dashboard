# 바이트론 이앤에스 업무 현황 대시보드

직원별 일간/주간/월간/연간 업무 기록 및 Jira 연동 대시보드.

## ⚠️ 대화·작업 규칙 (최우선 — 반드시 준수)

이 규칙은 기기·세션·경로와 무관하게 항상 적용된다. (이 파일이 git으로 모든 기기에 동기화되므로 새 기기·새 로그인에서도 자동 적용)

1. **말투 — 항상 공손한 존댓말.** 반말("~할게", "~할까?", "~이야") 절대 금지. 문장 종결은 "~합니다 / ~하겠습니다 / ~할까요?" 형태로.
2. **파일 편집 전 반드시 확인.** 아무리 간단한 수정이라도 계획·원인을 먼저 설명하고 "진행할까요?"로 동의를 받은 뒤에만 Edit/Write를 사용한다. "간단해서", "명백한 버그라서" 같은 예외 없음.
3. **수정 후 동작 검증 후 보고.** 브라우저/앱에서 실제 동작을 확인한 뒤 결과를 보고한다.
4. **수정 완료 후 push.** 작업이 끝나면 `git add` → `commit` → `push` 까지 수행한다.

## 기술 스택
- **Frontend**: React + Vite (단일 파일 구조 — `src/App.jsx`)
- **Backend**: Supabase (DB + Edge Function)
- **배포**: Vercel (main 브랜치 push 시 자동 배포)
- **GitHub**: https://github.com/GUNHOLEE-KR/vitron-dashboard

## 주요 파일 구조
```
src/
  App.jsx                  # 전체 UI (컴포넌트 분리 없이 단일 파일)
  repositories/
    workerRepo.js          # 직원 CRUD
    historyRepo.js         # 업무 기록 CRUD
    jiraRepo.js            # Jira 동기화 및 이슈 관리
  db/supabase.js           # Supabase 클라이언트
supabase/
  functions/sync-jira/     # Jira API → Supabase 동기화 Edge Function
```

## Supabase 테이블
- `workers` — 직원 정보 (name, active, hired_at, resigned_at)
- `work_history` — 업무 기록 (worker_name, work_date, work_hour, work_text)
- `jira_issues` — Jira 이슈 캐시 (jira_key, summary, parent_key, full_text)

## Jira 동기화
- Supabase Edge Function(`sync-jira`)을 POST로 호출
- 로컬 개발: Vite 프록시(`/jira-api`) 사용
- 배포 환경: Vercel API Route(`/api/jira-proxy`) 사용
- 동기화 중 토스트는 `duration=0`으로 완료 전까지 계속 표시

## 개발 서버
```powershell
npm run dev   # http://localhost:5173
```
`.claude/launch.json`에 서버 설정 있음 — Preview 도구로 브라우저 테스트 가능.

## 주의사항
- `App.jsx`는 의도적으로 단일 파일 구조 유지 (분리 금지)
- 탭 구성: 오늘 업무 / 일간 / 주간 / 월간 / 연간 / 설정
- 직원 필터는 기간별로 재직 여부를 판단 (`workersForPeriod` 함수)
