-- ============================================================
-- 041-vehicle-care.sql — 차량 관리: 정비·검사·보험 이력과 만료 알림 (2026-09-24 지시)
--
--   ⚠ admin 계정으로 실행한다. 새 표를 만들었으면 앱 계정에 GRANT 하는 것을 잊지 말 것 —
--     안 하면 화면이 권한 오류로 «조용히 비어» 보인다.
--
--      scp db/migrations/041-vehicle-care.sql root@vitron-nas:/tmp/
--      ssh root@vitron-nas 'docker exec -i postgres psql -U admin \
--        -d vitron_dashboard -v ON_ERROR_STOP=1 -f /dev/stdin < /tmp/041-vehicle-care.sql'
--
-- 왜 새 표인가
--   schedule_vehicles 에는 «정산에 필요한 것» 만 있다 — 단가·연비·하이패스 카드·색.
--   정비를 언제 했는지, 보험이 언제 끝나는지를 담을 칸이 아예 없어 아무도 모르고
--   있다가 지나간다. 차량 한 줄에 칸을 더하는 방법은 «이력» 을 담을 수 없어(한 대에
--   여러 번 일어난다) 표를 따로 둔다.
--
-- 🔑 «법인차량만» 이다 (사용자 결정 2026-09-24). 자차의 정비·보험은 회사가 관리할
--    일이 아니다. 표에는 vehicle_id 만 두고, 화면과 서버가 kind='company' 로 거른다.
--    🔴 FK 를 걸지 않는 것은 이 저장소의 다른 표와 같은 규칙이다 — 차를 처분해
--       목록에서 빼도 «그 차에 얼마를 썼나» 는 남아야 한다.
--
-- 🔑 필수는 «차량과 날짜» 뿐이다 (사용자 지시 — 나머지는 자유 입력).
--    적을 것이 없어서 기록 자체를 안 남기는 것이 가장 나쁘다.
-- ============================================================

-- ── 차량에 일어난 일 (정비·검사·주유·세차·사고·기타) ─────────
CREATE TABLE IF NOT EXISTS vehicle_events (
  id             SERIAL PRIMARY KEY,
  vehicle_id     INTEGER NOT NULL,              -- schedule_vehicles.id (FK 없음 — 위 설명)

  -- 🔑 종류를 «사유» 로 쓰지 않는다. 「엔진오일」을 종류에 넣으면 집계가 갈라져
  --    「정비」 합계를 셀 수 없다 — 휴가 종류에서 이미 겪은 함정이다.
  --    구체적인 것은 title 에 적는다.
  kind           VARCHAR(20) NOT NULL DEFAULT 'maintenance',
  event_date     DATE    NOT NULL,              -- 언제 있었나

  title          VARCHAR(200),                  -- 「엔진오일·에어컨 필터」 같은 한 줄
  vendor         VARCHAR(200),                  -- 정비소·주유소
  amount         INTEGER,                       -- 원. 비워 둘 수 있다
  odo_km         INTEGER,                       -- 그때 주행거리(계기판)

  -- 다음에 언제/몇 km 에 해야 하는가. 이것이 있어야 «미리» 알릴 수 있다.
  next_due_date  DATE,
  next_due_km    INTEGER,

  note           TEXT,

  -- 🔑 어디까지 알렸는지 «그 기한을 적어» 둔다. 날짜만 적으면 매일 다시 보내고,
  --    보냈다는 표시만 두면 기한이 바뀌어도(정비를 미뤘다) 다시 알리지 못한다.
  --    IS DISTINCT FROM 으로 비교한다 — NULL 끼리도 제대로 갈린다.
  alerted_for    DATE,
  alerted_at     TIMESTAMPTZ,

  created_by     INTEGER,                       -- kpi_users.id
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT vehicle_events_kind_chk CHECK (kind IN
    ('maintenance',  -- 정비·수리
     'inspection',   -- 정기검사
     'fuel',         -- 주유·충전
     'wash',         -- 세차
     'accident',     -- 사고
     'etc')),
  -- 금액에 음수가 들어가면 누적이 조용히 줄어든다 (구매 요청과 같은 규칙)
  CONSTRAINT vehicle_events_amount_chk CHECK (amount IS NULL OR amount >= 0),
  CONSTRAINT vehicle_events_odo_chk    CHECK (odo_km IS NULL OR odo_km >= 0)
);

COMMENT ON TABLE  vehicle_events IS
  '법인차량에 일어난 일의 이력. 종류는 집계 단위이고, 구체적인 내용은 title 에 적는다.';
COMMENT ON COLUMN vehicle_events.alerted_for IS
  '이미 알린 기한. 이 값과 next_due_date 가 «다를 때만» 다시 알린다.';

CREATE INDEX IF NOT EXISTS idx_vehicle_events_vehicle
  ON vehicle_events (vehicle_id, event_date DESC);
-- 「곧 해야 할 것」 을 뽑는 길
CREATE INDEX IF NOT EXISTS idx_vehicle_events_due
  ON vehicle_events (next_due_date) WHERE next_due_date IS NOT NULL;

-- ── 보험 ────────────────────────────────────────────────────
-- 한 대에 해마다 한 줄씩 쌓인다. 「지금 유효한 것」 은 end_date 가 가장 늦은 줄이다.
CREATE TABLE IF NOT EXISTS vehicle_insurances (
  id             SERIAL PRIMARY KEY,
  vehicle_id     INTEGER NOT NULL,

  insurer        VARCHAR(100),                  -- 보험사
  policy_no      VARCHAR(100),                  -- 증권번호
  start_date     DATE,
  end_date       DATE,                          -- 🔑 알림은 이 칸을 본다
  premium        INTEGER,                       -- 보험료(원)
  driver_scope   VARCHAR(100),                  -- 운전자 범위 (자유 입력)
  note           TEXT,

  alerted_for    DATE,
  alerted_at     TIMESTAMPTZ,

  created_by     INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT vehicle_insurances_premium_chk CHECK (premium IS NULL OR premium >= 0),
  -- 시작이 끝보다 뒤면 기간이 아니다. 둘 다 있을 때만 본다.
  CONSTRAINT vehicle_insurances_period_chk
    CHECK (start_date IS NULL OR end_date IS NULL OR start_date <= end_date)
);

COMMENT ON TABLE vehicle_insurances IS
  '법인차량 보험. 한 대에 해마다 한 줄씩 쌓이고, 「지금 것」 은 end_date 가 가장 늦은 줄이다.';

CREATE INDEX IF NOT EXISTS idx_vehicle_insurances_vehicle
  ON vehicle_insurances (vehicle_id, end_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_vehicle_insurances_end
  ON vehicle_insurances (end_date) WHERE end_date IS NOT NULL;

-- ── 앱 계정 권한 ─────────────────────────────────────────────
-- 🔴 빠뜨리면 화면이 «권한 오류로 조용히 비어» 보인다.
GRANT SELECT, INSERT, UPDATE, DELETE ON vehicle_events     TO "vitron-dashboard";
GRANT SELECT, INSERT, UPDATE, DELETE ON vehicle_insurances TO "vitron-dashboard";
GRANT USAGE, SELECT ON SEQUENCE vehicle_events_id_seq      TO "vitron-dashboard";
GRANT USAGE, SELECT ON SEQUENCE vehicle_insurances_id_seq  TO "vitron-dashboard";

-- ── 확인 ─────────────────────────────────────────────────────
\echo '=== 만들어진 표 ==='
SELECT table_name FROM information_schema.tables
 WHERE table_name IN ('vehicle_events','vehicle_insurances')
 ORDER BY 1;

\echo '=== 앱 계정 권한 ==='
SELECT table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS grants
  FROM information_schema.table_privileges
 WHERE grantee = 'vitron-dashboard'
   AND table_name IN ('vehicle_events','vehicle_insurances')
 GROUP BY table_name ORDER BY table_name;
