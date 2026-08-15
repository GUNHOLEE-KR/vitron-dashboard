-- ============================================================
-- 003-schedule.sql — 스케줄표 (계획·실적·차량·정산)
--
--   설계서: docs/design/스케줄표_설계.md (3판, 2026-08-15 확정)
--
-- ⚠ admin 계정으로 실행한다. 앱 계정(vitron-dashboard)은 테이블 소유자가
--    아니라 CREATE/ALTER 가 거부된다.
--
--      ssh root@vitron-nas
--      docker exec -i postgres psql -U admin -d vitron_dashboard < 003-schedule.sql
--
-- ⚠ FK 제약은 걸지 않는다(기존 work_history 와 같은 방침).
--    직원·차량·장소를 지워도 과거 기록은 남아야 한다.
--
-- ⚠ NUMERIC 컬럼은 pg 드라이버가 «문자열» 로 준다. 백엔드에
--    types.setTypeParser(1700, parseFloat) 를 넣지 않으면 거리 합산이
--    문자열 이어붙이기가 된다(KPI 에서 실제로 겪은 사고).
-- ============================================================

-- ── 장소 목록 ────────────────────────────────────────────────
-- 지도 API 를 쓰지 않는다. 거리·시간을 한 번 입력해 계속 재사용한다.
CREATE TABLE IF NOT EXISTS schedule_places (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(200) NOT NULL UNIQUE,   -- 예: 삼양화학 인천공장
  address      VARCHAR(300),
  distance_km  NUMERIC(6,1),                   -- 회사 → 장소 편도
  travel_min   INTEGER,                        -- 편도 소요시간(분)
  category     VARCHAR(20),                    -- 사무실 / 고객사 / 현장 / 기타
  memo         TEXT,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_by   INTEGER,                        -- workers.id (누가 등록했나)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 차량 (법인차 + 자차 통합) ─────────────────────────────────
-- 자차 환급을 «차량별 연비» 로 계산해야 하므로 한 표에서 관리한다.
CREATE TABLE IF NOT EXISTS schedule_vehicles (
  id              SERIAL PRIMARY KEY,
  kind            VARCHAR(10) NOT NULL DEFAULT 'company',
  name            VARCHAR(50) NOT NULL,        -- Model Y / 카니발 / QM6 / 자차 차종
  plate           VARCHAR(20),                 -- 번호판 (자차는 선택)
  owner_worker_id INTEGER,                     -- 자차일 때 소유 직원
  fuel_type       VARCHAR(10),                 -- 전기 / 가솔린 / 디젤 / LPG
  rate_per_km     INTEGER,                     -- 법인차 개인사용 단가(원/km)
  km_per_liter    NUMERIC(4,1),                -- 자차 연비(km/L) — 주유 한도 계산
  memo            TEXT,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT schedule_vehicles_kind_chk CHECK (kind IN ('company','own'))
);

-- 같은 번호판을 두 번 넣는 실수만 막는다(번호판 없는 자차는 여러 건 허용).
CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_vehicles_plate
  ON schedule_vehicles (plate) WHERE plate IS NOT NULL;

-- ── 계획 ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schedule_plans (
  id              SERIAL PRIMARY KEY,
  worker_id       INTEGER NOT NULL,
  plan_date       DATE    NOT NULL,
  slot            VARCHAR(10) NOT NULL DEFAULT 'allday',  -- allday/am/pm/time
  start_time      TIME,
  end_time        TIME,
  use_type        VARCHAR(10) NOT NULL DEFAULT 'business', -- business/personal
  place_id        INTEGER,                     -- 개인 사용이면 비운다
  place_text      VARCHAR(200),                -- 목록에 없을 때 직접 입력
  purpose         VARCHAR(200),                -- 개인 사용이면 비운다
  transport       VARCHAR(20) NOT NULL DEFAULT 'office',
  vehicle_id      INTEGER,
  est_distance_km NUMERIC(6,1),                -- 장소에서 자동 채움
  est_travel_min  INTEGER,
  round_trip      BOOLEAN NOT NULL DEFAULT TRUE,
  status          VARCHAR(10) NOT NULL DEFAULT 'planned', -- planned/done/changed/canceled
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT schedule_plans_slot_chk      CHECK (slot IN ('allday','am','pm','time')),
  CONSTRAINT schedule_plans_use_type_chk  CHECK (use_type IN ('business','personal')),
  CONSTRAINT schedule_plans_transport_chk CHECK (transport IN ('office','company_car','own_car','transit')),
  CONSTRAINT schedule_plans_status_chk    CHECK (status IN ('planned','done','changed','canceled'))
);

CREATE INDEX IF NOT EXISTS idx_schedule_plans_date        ON schedule_plans (plan_date);
CREATE INDEX IF NOT EXISTS idx_schedule_plans_worker      ON schedule_plans (worker_id);
CREATE INDEX IF NOT EXISTS idx_schedule_plans_date_worker ON schedule_plans (plan_date, worker_id);
CREATE INDEX IF NOT EXISTS idx_schedule_plans_vehicle     ON schedule_plans (vehicle_id, plan_date);

-- ── 실적 ────────────────────────────────────────────────────
-- 계기판 칸은 두지 않는다(운행일지는 이 시스템 범위 밖 — 설계서 1.1절).
-- 나중에 세무 자료가 필요해지면 odo_start / odo_end 를 추가하면 된다.
CREATE TABLE IF NOT EXISTS schedule_actuals (
  id           SERIAL PRIMARY KEY,
  plan_id      INTEGER,                        -- NULL 허용 — 계획 없이 생긴 일
  worker_id    INTEGER NOT NULL,
  work_date    DATE    NOT NULL,
  as_planned   BOOLEAN NOT NULL DEFAULT TRUE,
  use_type     VARCHAR(10) NOT NULL DEFAULT 'business',
  place_id     INTEGER,
  place_text   VARCHAR(200),
  purpose      VARCHAR(200),
  transport    VARCHAR(20) NOT NULL DEFAULT 'office',
  vehicle_id   INTEGER,
  distance_km  NUMERIC(6,1),                   -- 주행거리 = 정산 근거
  toll_fee     INTEGER NOT NULL DEFAULT 0,     -- 하이패스
  transit_fee  INTEGER NOT NULL DEFAULT 0,     -- 대중교통비
  fuel_fee     INTEGER NOT NULL DEFAULT 0,     -- 주유·충전 실비(법인차 업무용)
  memo         TEXT,
  locked       BOOLEAN NOT NULL DEFAULT FALSE, -- 정산 완료된 달은 수정 잠금
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT schedule_actuals_use_type_chk  CHECK (use_type IN ('business','personal')),
  CONSTRAINT schedule_actuals_transport_chk CHECK (transport IN ('office','company_car','own_car','transit'))
);

CREATE INDEX IF NOT EXISTS idx_schedule_actuals_date        ON schedule_actuals (work_date);
CREATE INDEX IF NOT EXISTS idx_schedule_actuals_worker      ON schedule_actuals (worker_id);
CREATE INDEX IF NOT EXISTS idx_schedule_actuals_date_worker ON schedule_actuals (work_date, worker_id);
CREATE INDEX IF NOT EXISTS idx_schedule_actuals_vehicle     ON schedule_actuals (vehicle_id, work_date);
CREATE INDEX IF NOT EXISTS idx_schedule_actuals_plan        ON schedule_actuals (plan_id);

-- ── 월 정산 상태 ─────────────────────────────────────────────
-- 금액·리터는 «승인 시점 값을 박아» 둔다. 나중에 단가나 연비가 바뀌어도
-- 지난 정산액이 흔들리지 않게 하기 위함이다(KPI 점수와 같은 방침).
CREATE TABLE IF NOT EXISTS schedule_settlements (
  id               SERIAL PRIMARY KEY,
  ym               CHAR(7) NOT NULL,           -- 2026-08
  worker_id        INTEGER NOT NULL,
  personal_km      NUMERIC(7,1) NOT NULL DEFAULT 0,  -- 개인 사용 거리
  personal_amount  INTEGER      NOT NULL DEFAULT 0,  -- 회사에 입금할 금액
  toll_amount      INTEGER      NOT NULL DEFAULT 0,  -- 개인 사용 하이패스
  own_car_km       NUMERIC(7,1) NOT NULL DEFAULT 0,  -- 자차 업무 거리
  own_car_liter    NUMERIC(6,2) NOT NULL DEFAULT 0,  -- 환급 주유 한도(리터)
  transit_amount   INTEGER      NOT NULL DEFAULT 0,  -- 대중교통 실비
  status           VARCHAR(10)  NOT NULL DEFAULT 'open', -- open/settled
  settled_by       INTEGER,                    -- kpi_users.id (승인자)
  settled_at       TIMESTAMPTZ,
  memo             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT schedule_settlements_status_chk CHECK (status IN ('open','settled')),
  CONSTRAINT schedule_settlements_ym_worker_key UNIQUE (ym, worker_id)
);

CREATE INDEX IF NOT EXISTS idx_schedule_settlements_ym ON schedule_settlements (ym);

-- ── 정산 승인 권한 ───────────────────────────────────────────
-- ⚠ kpi_users.role 에 새 등급을 만들지 않는다. 이 표는 KPI 추적 시스템과
--   함께 쓰므로, KPI 가 모르는 role 값이 들어가면 그 계정이 권한 없는
--   사용자로 취급될 수 있다. 그래서 «허가» 를 컬럼으로 따로 둔다.
--   대표이사(고광용 · sinoko@vi-tron.com) 만 TRUE.
ALTER TABLE kpi_users
  ADD COLUMN IF NOT EXISTS can_approve_settlement BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 법인차량 4대 초기 등록 ───────────────────────────────────
-- 단가는 전부 100원/km. Model Y·QM6 는 정산기준 문서 근거, 카니발 2대는
-- 문서가 없어 «우선 동일 적용» 하고 설정 화면에서 바꿀 수 있게 한다.
-- 카니발·QM6 의 연료 종류는 문서에 없어 비워 둔다(설정에서 채운다).
INSERT INTO schedule_vehicles (kind, name, plate, fuel_type, rate_per_km, memo)
VALUES
  ('company', 'Model Y', '15도 3955', '전기', 100, '정산기준: 전비 5.0km/kWh × 347.2원/kWh = 70원 + 소모품 30원'),
  ('company', 'QM6',     '129누 9183', NULL,  100, '정산기준 문서 기준 100원/km'),
  ('company', '카니발',   '24구 7598',  NULL,  100, '정산기준 문서 없음 — 우선 동일 적용'),
  ('company', '카니발',   '3422',       NULL,  100, '정산기준 문서 없음 — 우선 동일 적용')
ON CONFLICT DO NOTHING;

-- ── 앱 계정 권한 ─────────────────────────────────────────────
-- 앱 계정은 테이블 소유자가 아니므로 권한을 따로 준다.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  schedule_places, schedule_vehicles, schedule_plans,
  schedule_actuals, schedule_settlements
  TO "vitron-dashboard";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "vitron-dashboard";
GRANT SELECT ON kpi_users TO "vitron-dashboard";   -- 정산 화면 로그인용(읽기만)
