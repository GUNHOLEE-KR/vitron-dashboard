-- ============================================================
-- 003-schedule-rollback.sql — 스케줄표 테이블 되돌리기
--
--   003-schedule.sql 을 원복한다. admin 계정으로 실행.
--
-- ⚠ 표를 지우면 그 안의 계획·실적·정산 기록도 함께 사라진다.
--    운영에 들어간 뒤에는 쓰지 말고, 도입 단계에서만 사용한다.
-- ============================================================

DROP TABLE IF EXISTS schedule_settlements;
DROP TABLE IF EXISTS schedule_actuals;
DROP TABLE IF EXISTS schedule_plans;
DROP TABLE IF EXISTS schedule_vehicles;
DROP TABLE IF EXISTS schedule_places;

-- 정산 승인 권한 컬럼도 함께 제거한다.
-- (KPI 추적 시스템은 이 컬럼을 쓰지 않으므로 지워도 영향이 없다)
ALTER TABLE kpi_users DROP COLUMN IF EXISTS can_approve_settlement;
