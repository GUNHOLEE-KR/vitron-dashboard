-- ============================================================
-- 042-mixed-transport.sql — 복합 이동과 «항목별» 이동 실비 (2026-09-24 지시)
--
--   ⚠ admin 계정으로 실행한다.
--      scp db/migrations/042-mixed-transport.sql root@vitron-nas:/tmp/
--      ssh root@vitron-nas 'docker exec -i postgres psql -U admin \
--        -d vitron_dashboard -v ON_ERROR_STOP=1 -f /dev/stdin < /tmp/042-mixed-transport.sql'
--
-- 왜
--   사용자가 든 실제 사례 — 「공영(환승)주차장에 법인차량을 대고, KTX 를 타고 가서,
--   현장에서 다시 버스나 택시를 탄다」. 이동 수단이 한 칸이라 «법인차량» 으로 적으면
--   실적 창에 주행거리·하이패스·주유만 나오고 KTX·택시비를 적을 자리가 «아예 없었다».
--   그 돈은 조용히 사라진다.
--
-- 🔑 이동 수단은 «여전히 하나» 다 (사용자 확인). 배차 겹침·달력 아이콘·정산·장소
--    묶기가 모두 transport 한 칸을 보고 있어, 여러 값으로 바꾸면 다섯 군데를 함께
--    고쳐야 하고 하나만 놓쳐도 «배차 겹침이 조용히 안 잡히는» 쪽으로 틀어진다.
--    그래서 「복합」은 수단을 밀어내지 않고 «옆에» 선다 — 법인차량이 눌린 채로
--    복합이 함께 켜진다.
--
-- 🔑 합계(transit_fee)는 그대로 둔다. 정산은 그 칸만 더하므로 계산식이 안 바뀐다.
--    항목(transit_items)은 «무엇에 썼나» 를 남기는 내역이다.
--    🔴 합계를 «조회할 때마다 다시 더하지» 않는다 — 휴가 시간(vacation_hours)과
--       같은 원칙이다. 다시 더하면 나중에 항목을 손대는 순간 이미 확정된 지난
--       정산 금액까지 소급해 달라진다.
-- ============================================================

-- ── 복합 이동 표시 ──────────────────────────────────────────
-- 「이 날은 여러 수단이었다」. 달력 배지에 🧾 가 주 수단 아이콘과 «함께» 붙는다.
ALTER TABLE schedule_plans   ADD COLUMN IF NOT EXISTS mixed_transport BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE schedule_actuals ADD COLUMN IF NOT EXISTS mixed_transport BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN schedule_plans.mixed_transport IS
  '여러 수단을 섞은 이동. transport 를 밀어내지 않는다 — 법인차량이면서 복합일 수 있다.';

-- ── 이동 실비 «항목별» 내역 ─────────────────────────────────
-- [{"label":"환승주차장 주차비","amount":3000}, {"label":"KTX 서울→동대구","amount":23700}]
--
-- 🔑 표를 따로 파지 않는다. 이 내역은 «늘 그 실적과 함께» 읽고 쓰며, 내역만 가로질러
--    조회할 일이 없다. 표를 만들면 조인·권한·지우기 규칙이 따라붙는데 얻는 것이 없다.
-- ⚠ 항목 이름은 자유 입력이다 (사용자 지시). 목록으로 묶으면 「어디에도 안 맞는 것」이
--   반드시 생긴다 — 휴가 «사유» 를 종류에 넣지 않은 것과 같은 판단이다.
ALTER TABLE schedule_actuals ADD COLUMN IF NOT EXISTS transit_items JSONB;

COMMENT ON COLUMN schedule_actuals.transit_items IS
  '이동 실비 내역 [{label, amount}, …]. 합계는 transit_fee 에 «계산해서 저장» 한다. '
  '비어 있으면 종전처럼 금액만 적은 기록이다(지난 기록은 그대로 살아 있다).';

-- 내역이 «배열» 이 아니면 화면이 map 을 돌리다 죽는다. 담는 자리에서 막는다.
ALTER TABLE schedule_actuals DROP CONSTRAINT IF EXISTS schedule_actuals_transit_items_chk;
ALTER TABLE schedule_actuals ADD CONSTRAINT schedule_actuals_transit_items_chk
  CHECK (transit_items IS NULL OR jsonb_typeof(transit_items) = 'array');

-- ── 확인 ─────────────────────────────────────────────────────
\echo '=== 더해진 칸 ==='
SELECT table_name, column_name, data_type, column_default
  FROM information_schema.columns
 WHERE (table_name = 'schedule_plans'   AND column_name = 'mixed_transport')
    OR (table_name = 'schedule_actuals' AND column_name IN ('mixed_transport','transit_items'))
 ORDER BY table_name, column_name;

\echo '=== 지난 기록은 그대로인가 (transit_fee 가 있는 실적) ==='
SELECT count(*) AS 금액_있는_실적, count(transit_items) AS 내역_있는_실적
  FROM schedule_actuals WHERE transit_fee > 0;
