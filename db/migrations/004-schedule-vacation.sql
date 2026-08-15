-- ============================================================
-- 004-schedule-vacation.sql — 휴가 등록 + 이동 없는 일정 허용
--
--   설계: docs/design/스케줄표_설계.md
--   ⚠ admin 계정으로 실행한다.
--
--      scp db/migrations/004-schedule-vacation.sql root@vitron-nas:/tmp/
--      ssh root@vitron-nas
--      docker cp /tmp/004-schedule-vacation.sql postgres:/tmp/
--      docker exec postgres psql -U admin -d vitron_dashboard -f /tmp/004-schedule-vacation.sql
--
-- 왜 필요한가
--   스케줄에 «휴가» 를 넣기로 했다. 휴가는 업무도 개인 사용도 아니고
--   이동 수단도 없다. 기존 CHECK 제약이 이를 막고 있어 값을 넓힌다.
-- ============================================================

-- ── 일정 유형에 vacation 추가 ────────────────────────────────
--   business  업무
--   personal  개인 사용 (법인차 개인 이용 — 정산 대상)
--   vacation  휴가
ALTER TABLE schedule_plans   DROP CONSTRAINT IF EXISTS schedule_plans_use_type_chk;
ALTER TABLE schedule_plans   ADD  CONSTRAINT schedule_plans_use_type_chk
  CHECK (use_type IN ('business','personal','vacation'));

ALTER TABLE schedule_actuals DROP CONSTRAINT IF EXISTS schedule_actuals_use_type_chk;
ALTER TABLE schedule_actuals ADD  CONSTRAINT schedule_actuals_use_type_chk
  CHECK (use_type IN ('business','personal','vacation'));

-- ── 이동 수단에 none 추가 ────────────────────────────────────
--   휴가처럼 이동이 아예 없는 일정에 쓴다.
--   («사무실 내근» 은 회사에 있는 것이므로 office 를 그대로 쓴다)
ALTER TABLE schedule_plans   DROP CONSTRAINT IF EXISTS schedule_plans_transport_chk;
ALTER TABLE schedule_plans   ADD  CONSTRAINT schedule_plans_transport_chk
  CHECK (transport IN ('office','company_car','own_car','transit','none'));

ALTER TABLE schedule_actuals DROP CONSTRAINT IF EXISTS schedule_actuals_transport_chk;
ALTER TABLE schedule_actuals ADD  CONSTRAINT schedule_actuals_transport_chk
  CHECK (transport IN ('office','company_car','own_car','transit','none'));

-- ── 휴가 종류 ────────────────────────────────────────────────
-- 연차 / 병가 / 포상 / 기타. 값은 화면 코드(VACATION_TYPES) 한 곳에서 관리하므로
-- 여기서는 CHECK 로 묶지 않는다 — 종류가 늘 때마다 스키마를 고치지 않기 위함이다.
-- 별도 컬럼으로 둔 이유: 나중에 «연차 소진 집계» 를 붙일 수 있게 하려는 것이다.
ALTER TABLE schedule_plans   ADD COLUMN IF NOT EXISTS vacation_type VARCHAR(10);
ALTER TABLE schedule_actuals ADD COLUMN IF NOT EXISTS vacation_type VARCHAR(10);

-- 휴가만 따로 뽑아 보는 조회가 잦을 것이므로 인덱스를 둔다
CREATE INDEX IF NOT EXISTS idx_schedule_plans_use_type
  ON schedule_plans (use_type, plan_date);

-- ── 장소 분류 정리 ───────────────────────────────────────────
-- 「현장」과 「고객사」를 굳이 나눌 이유가 없어 «고객사» 로 합친다.
-- 「사무실」은 장소 목록에 넣지 않는 고정 항목이므로 분류에서도 뺀다.
UPDATE schedule_places SET category = '고객사' WHERE category IN ('현장','사무실');

\echo '=== 적용 결과 ==='
SELECT conname, pg_get_constraintdef(oid) AS 제약
  FROM pg_constraint
 WHERE conrelid IN ('schedule_plans'::regclass,'schedule_actuals'::regclass)
   AND conname LIKE '%chk'
 ORDER BY conname;

SELECT table_name, column_name, data_type
  FROM information_schema.columns
 WHERE column_name = 'vacation_type'
 ORDER BY table_name;
