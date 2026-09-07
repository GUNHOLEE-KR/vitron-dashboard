-- 035 휴가를 «시간» 으로 센다 (2026-09-07 지시)
--
-- 여태는 「종일 1일 / 반차 0.5일」 두 값뿐이었다(mailer.vacDays). 반차보다 짧게
-- 쓰는 일이 실제로 있는데 담을 수가 없었다.
--
-- 🔑 사용자 결정
--    · 1휴가 = 8시간, 1시간 단위
--    · 시작·끝 «시각» 을 받아 시스템이 계산한다 — «식사시간은 뺀다»
--    · 기존 기록은 종일 8시간 · 반차 4시간 으로 환산한다
--    · 「반차」 단추는 없앤다 (시간으로 적으면 되므로)
--
-- 🔑 «계산해서 저장» 한다. 조회할 때마다 다시 세면 근무·점심 시각을 바꾸는 순간
--    지난 기록의 시간까지 소급해 달라진다 — 이미 결재된 휴가가 흔들리면 안 된다.
--
-- ⚠ admin 계정으로 실행한다. 앱 계정은 테이블 소유자가 아니라 ALTER 가 거부된다.
--   docker exec -i postgres psql -U admin -d <DB> -f 035-vacation-hours.sql
--
-- ⚠ 되돌리기
--     ALTER TABLE schedule_plans DROP COLUMN vacation_hours;

ALTER TABLE schedule_plans
  ADD COLUMN IF NOT EXISTS vacation_hours INTEGER;

COMMENT ON COLUMN schedule_plans.vacation_hours IS
  '이 휴가가 몇 «시간» 인가. 저장할 때 계산해 둔다(근무 09:00~18:00 · 점심 12:00~13:00 제외). '
  '1휴가 = 8시간. 종일은 8, 시각을 지정하면 그 사이에서 점심을 뺀 시간.';

-- ── 기존 기록 환산 (지시) ────────────────────────────────────
-- 종일 → 8시간, 그 밖(오전·오후 반차) → 4시간.
-- ⚠ 이미 값이 있는 줄은 건드리지 않는다 — 다시 돌려도 덮어쓰지 않게 한다.
UPDATE schedule_plans
   SET vacation_hours = CASE WHEN slot = 'allday' THEN 8 ELSE 4 END
 WHERE use_type = 'vacation' AND vacation_hours IS NULL;

CREATE INDEX IF NOT EXISTS idx_plans_vacation_hours
  ON schedule_plans (worker_id, plan_date) WHERE use_type = 'vacation';

-- ⚠ 새 표가 아니라 칸만 더했으므로 GRANT 는 003 의 것이 그대로 유효하다.

-- ── 확인 ─────────────────────────────────────────────────────
SELECT '칸' AS t, column_name, data_type
  FROM information_schema.columns
 WHERE table_name = 'schedule_plans' AND column_name = 'vacation_hours';
SELECT '환산 결과' AS t, slot AS 시간대, vacation_hours AS 시간, count(*) AS 건수
  FROM schedule_plans WHERE use_type = 'vacation'
 GROUP BY 2, 3 ORDER BY 2;
SELECT '빠진 것' AS t, count(*) AS 시간_없는_휴가
  FROM schedule_plans WHERE use_type = 'vacation' AND vacation_hours IS NULL;
