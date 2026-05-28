# 바이트론 이앤에스 업무 현황 대시보드

직원별 일간/주간/월간/연간 업무 기록 및 Jira 연동 대시보드.

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
