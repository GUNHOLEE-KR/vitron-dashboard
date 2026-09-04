-- 026 「이동」 — 현장에서 복귀하지 않고 «다른 현장으로 바로» 가는 일정 (2026-09-04 지시)
--
-- 편도 방향은 여태 둘뿐이었다.
--   출발 = 사무실 → 그 장소 / 복귀 = 그 장소 → 사무실
-- 그런데 출장지에서 복귀하지 않고 다음 출장지로 곧장 가는 날이 생겼다. 그 하루는
-- 사무실을 거치지 않으므로 위 둘 중 어느 것으로도 적을 수 없었다.
--
--   이동 = 장소 A → 장소 B (사무실을 거치지 않는다)
--
-- 🔴 여기서 걸리는 것은 «단추» 가 아니라 «거리» 다.
--    schedule_places.distance_km 는 「회사 → 장소」 편도 하나뿐이라, 현장 A 에서
--    현장 B 까지가 얼마인지는 어디에도 없고 두 값을 더하거나 빼서 구할 수도 없다.
--    그래서 «장소 쌍» 거리표를 따로 둔다. 한 번 찾아 넣으면 계속 재사용한다.
--
-- ⚠ admin 계정으로 실행한다. 앱 계정은 테이블 소유자가 아니라 ALTER 가 거부된다.
--   docker exec -i postgres psql -U admin -d <DB> -f 026-plan-move-between-places.sql

-- ── ① 방향에 「이동」 을 더한다 ───────────────────────────────
ALTER TABLE schedule_plans
  DROP CONSTRAINT IF EXISTS schedule_plans_one_way_dir_chk;
ALTER TABLE schedule_plans
  ADD CONSTRAINT schedule_plans_one_way_dir_chk
  CHECK (one_way_dir IS NULL OR one_way_dir IN ('출발', '복귀', '이동'));

COMMENT ON COLUMN schedule_plans.one_way_dir IS
  '편도 일정의 방향 — 출발(사무실→장소) / 복귀(장소→사무실) / 이동(장소→장소). 왕복이면 NULL';

-- ── ② 출발지 ─────────────────────────────────────────────────
-- 🔑 place_id 는 여태 «그 일정의 장소» 하나였다. 이동은 어디서 어디로인지가
--    필요하므로 «출발지» 를 더한다. place_id 는 그대로 «도착지» 로 읽는다 —
--    뜻을 바꾸면 지난 일정 전부를 다시 해석해야 한다.
-- ⚠ 이동이 아닌 일정에서는 NULL 이다. 서버가 그렇게 지운다.
ALTER TABLE schedule_plans
  ADD COLUMN IF NOT EXISTS from_place_id INTEGER;

COMMENT ON COLUMN schedule_plans.from_place_id IS
  '「이동」일 때의 출발 장소. 도착지는 place_id 다. 그 밖의 일정에서는 NULL.';

CREATE INDEX IF NOT EXISTS idx_schedule_plans_from_place ON schedule_plans (from_place_id);

-- ── ③ 장소 쌍 거리 ───────────────────────────────────────────
-- 「인천공장 → 위례」 를 한 번만 찾아 두면 다음부터 저절로 채워진다.
CREATE TABLE IF NOT EXISTS place_distances (
  id             SERIAL PRIMARY KEY,
  from_place_id  INTEGER NOT NULL,
  to_place_id    INTEGER NOT NULL,
  distance_km    NUMERIC(6,1) NOT NULL,
  travel_min     INTEGER,
  -- 어디서 온 값인가 — manual(사람이 지도 보고 적음) / google(자동 계산)
  -- 🔑 섞이면 「이 숫자를 믿어도 되나」 를 판단할 수 없다.
  source         VARCHAR(10) NOT NULL DEFAULT 'manual',
  updated_by     INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT place_distances_source_chk CHECK (source IN ('manual', 'google')),
  -- 같은 장소끼리는 거리가 없다. 넣으면 0km 짜리 줄이 쌓여 목록만 지저분해진다.
  CONSTRAINT place_distances_not_same_chk CHECK (from_place_id <> to_place_id)
);

-- 🔑 «한 쌍은 한 줄» 이다. A→B 를 찾으면 B→A 로도 쓴다 —
--    실무에서 두 방향 거리가 다르지 않고, 두 줄로 두면 한쪽만 고쳐져 조용히 어긋난다.
--    그래서 작은 id 를 앞에 두는 «정규화된 쌍» 으로 유일하게 만든다.
--    (조회하는 쪽이 least/greatest 로 맞춰 찾는다)
CREATE UNIQUE INDEX IF NOT EXISTS idx_place_distances_pair
  ON place_distances (least(from_place_id, to_place_id), greatest(from_place_id, to_place_id));

COMMENT ON TABLE place_distances IS
  '장소와 장소 사이 거리. 「이동」 일정이 쓴다. 한 쌍은 한 줄이고 방향을 가리지 않는다.';

-- ── ④ 앱 계정 권한 ───────────────────────────────────────────
-- ⚠ 새 표를 만들었으면 반드시 준다. 안 하면 화면이 권한 오류로 조용히 비어 보인다.
GRANT SELECT, INSERT, UPDATE, DELETE ON place_distances TO "vitron-dashboard";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "vitron-dashboard";

-- ── 확인 ─────────────────────────────────────────────────────
SELECT '방향' AS t, pg_get_constraintdef(oid) AS def
  FROM pg_constraint WHERE conname = 'schedule_plans_one_way_dir_chk';
SELECT '출발지' AS t, column_name FROM information_schema.columns
 WHERE table_name = 'schedule_plans' AND column_name = 'from_place_id';
SELECT '쌍 거리' AS t, count(*) FROM place_distances;
