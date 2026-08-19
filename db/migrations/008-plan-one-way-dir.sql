-- 008 편도 일정에 «방향»(출발/복귀) 추가
--
-- 왕복은 사무실에서 나갔다 돌아오는 하루라 방향을 따질 것이 없다.
-- 그런데 편도는 「사무실 → 현장」인지 「현장 → 사무실」인지에 따라
-- 그 사람이 하루를 어디서 시작해 어디서 끝내는지가 달라진다.
-- 달력만 보고는 알 수 없어 매번 물어봐야 했다 (2026-08-19 요청).
--
--   · 출발 = 사무실에서 그 장소로 간다
--   · 복귀 = 그 장소에서 사무실로 돌아온다
--
-- ⚠ 왕복이면 이 값은 NULL 이다. 방향이 없는 것이 «비어 있음»과 같은 뜻이라
--    굳이 '왕복' 같은 값을 따로 두지 않는다.
-- ⚠ 거리·정산에는 영향이 없다. 편도는 방향과 무관하게 편도 1회분이다.
--
-- 실행: docker exec -it postgres psql -U admin -d vitron_dashboard -f 008-plan-one-way-dir.sql
--       (앱 계정 vitron-dashboard 는 테이블 소유자가 아니라 ALTER TABLE 이 거부된다)

ALTER TABLE schedule_plans
  ADD COLUMN IF NOT EXISTS one_way_dir VARCHAR(10);

-- 값은 둘뿐이다. 오타로 엉뚱한 값이 들어가면 화면이 조용히 아무것도 안 보여 준다.
ALTER TABLE schedule_plans
  DROP CONSTRAINT IF EXISTS schedule_plans_one_way_dir_chk;
ALTER TABLE schedule_plans
  ADD CONSTRAINT schedule_plans_one_way_dir_chk
  CHECK (one_way_dir IS NULL OR one_way_dir IN ('출발', '복귀'));

COMMENT ON COLUMN schedule_plans.one_way_dir IS
  '편도 일정의 방향 — 출발(사무실→장소) / 복귀(장소→사무실). 왕복이면 NULL';
