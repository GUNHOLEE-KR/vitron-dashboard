-- ============================================================
-- 040-transport-modes.sql — 차량 없는 출장: 이동 수단을 넓힌다 (2026-09-24 지시)
--
--   ⚠ admin 계정으로 실행한다. 앱 계정은 표의 주인이 아니라 ALTER 가 거부된다.
--
--      scp db/migrations/040-transport-modes.sql root@vitron-nas:/tmp/
--      ssh root@vitron-nas 'docker exec -i postgres psql -U admin \
--        -d vitron_dashboard -v ON_ERROR_STOP=1 -f /dev/stdin < /tmp/040-transport-modes.sql'
--
-- 왜
--   고를 수 있는 이동 수단이 «법인차량 · 자차 · 대중교통» 셋뿐이었다. 차를 쓰지 않고
--   가는 출장(도보·택시·렌터카·남의 차 얻어 타기)을 적을 자리가 없어 셋 중 하나로
--   억지로 밀어 넣거나 사무실 내근으로 적히고 있었다.
--
-- 🔑 새 수단은 «차량을 잡지 않는다»(needsVehicle=false). 그래서 배차 겹침 검사·
--    배차표에 걸리지 않는다 — 회사 차를 쓴 것이 아니기 때문이다.
--
-- ⚠ 'office'(사무실)와 'none'(이동 없음 — 휴가)은 «고르는 수단이 아니다».
--   장소·유형이 정하는 값이라 화면 목록(OUT_TRANSPORTS)에 두지 않는다.
--   여기 CHECK 에는 이미 들어가 있으므로 그대로 둔다.
--
-- ⚠ 3값 논리 — 이 저장소가 CHECK 에서 NULL 때문에 뚫린 적이 있다(하이패스 031).
--   다만 transport 는 «NOT NULL DEFAULT 'office'» 라 NULL 이 들어올 수 없어
--   IN 만으로 막힌다. 같은 함정이 아니다(확인하고 적는다).
-- ============================================================

\echo '=== 전: 지금 쓰이고 있는 값 ==='
SELECT 'plans' AS src, transport, count(*) FROM schedule_plans GROUP BY 1,2
UNION ALL
SELECT 'actuals', transport, count(*) FROM schedule_actuals GROUP BY 1,2
ORDER BY 1,2;

-- ── 계획 ────────────────────────────────────────────────────
ALTER TABLE schedule_plans DROP CONSTRAINT IF EXISTS schedule_plans_transport_chk;
ALTER TABLE schedule_plans ADD CONSTRAINT schedule_plans_transport_chk
  CHECK (transport IN (
    'office',       -- 사무실 내근 (장소가 정한다)
    'none',         -- 이동 없음 (휴가)
    'company_car',  -- 법인차량
    'own_car',      -- 자차
    'transit',      -- 대중교통
    'taxi',         -- 택시
    'rental',       -- 렌터카
    'other_car',    -- 타사 차량 동승 (고객사·협력사 차를 얻어 탔다)
    'walk',         -- 도보
    'etc'           -- 기타
  ));

-- ── 실적 ────────────────────────────────────────────────────
-- 🔴 «양쪽» 을 고쳐야 한다. 계획만 넓히면 계획은 저장되는데 실적을 만드는 순간
--    CHECK 위반으로 죽는다 — 그때는 이미 계획이 들어가 있어 되돌리기가 성가시다.
ALTER TABLE schedule_actuals DROP CONSTRAINT IF EXISTS schedule_actuals_transport_chk;
ALTER TABLE schedule_actuals ADD CONSTRAINT schedule_actuals_transport_chk
  CHECK (transport IN (
    'office','none','company_car','own_car','transit',
    'taxi','rental','other_car','walk','etc'
  ));

COMMENT ON COLUMN schedule_plans.transport IS
  '이동 수단. office·none 은 고르는 값이 아니라 장소·유형이 정한다. '
  'taxi·rental·other_car·walk·etc 는 차량을 잡지 않는다(2026-09-24 추가).';

\echo '=== 후: 새 제약 ==='
SELECT conrelid::regclass AS tbl, pg_get_constraintdef(oid) AS def
  FROM pg_constraint
 WHERE conname IN ('schedule_plans_transport_chk','schedule_actuals_transport_chk')
 ORDER BY 1;
