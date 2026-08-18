-- 007 Jira 이슈 캐시에 «상태» 추가
--
-- 업무 입력 화면의 선택 목록에 Jira 에서 이미 종료한 업무까지 그대로 떴다.
-- 원인은 단순하다 — 동기화가 status 를 아예 받아오지 않았고, 이 표에도 담을 칸이 없었다.
-- (2026-08-19 실측: 캐시 302건 중 완료가 120건. 상위업무 32건 중 7건이 완료였다)
--
-- 상태 이름(status_name)과 분류(status_category)를 함께 담는다.
--   · status_name     = 「완료」「진행 중」처럼 프로젝트마다 다른 표시 이름
--   · status_category = new / indeterminate / done  ← 판정은 «반드시 이 값»으로 한다
-- 상태 이름은 프로젝트 설정에 따라 바뀔 수 있어 판정 근거로 쓰면 조용히 어긋난다.
-- KPI 추적 시스템의 kpi_jira_issues 도 같은 이유로 두 값을 함께 담고 있다.
--
-- ⚠ 수동 추가 업무(MANUAL-…)는 Jira 에 없으므로 두 칸 모두 NULL 이다.
--    NULL 은 «완료가 아님» 으로 다룬다 — 고정업무(주간회의 등)가 목록에서 사라지면 안 된다.
--
-- ⚠ 앱 계정(vitron-dashboard)은 이 표의 소유자가 아니라 ALTER 가 거부된다. admin 으로 적용할 것.

ALTER TABLE jira_issues ADD COLUMN IF NOT EXISTS status_name     VARCHAR(50);
ALTER TABLE jira_issues ADD COLUMN IF NOT EXISTS status_category VARCHAR(20);

-- 목록을 그릴 때마다 완료 여부로 거르므로 인덱스를 하나 둔다.
CREATE INDEX IF NOT EXISTS idx_jira_issues_status_category ON jira_issues (status_category);
