-- 010 공휴일표 (2026-08-24)
--
-- 왜 필요한가
-- ------------
-- 지금까지 「영업일」을 «주말만 뺀 날»로 셌다. 전 직원에게 같은 분모라 순위에는
-- 영향이 없어서 공휴일을 일부러 따지지 않았다. 그런데 «휴일 근무 시간»을 따로
-- 보여 달라는 요구가 생기면서 «어느 날이 휴일인가»를 알아야 해졌다.
--
-- 어디에 쓰이나
-- --------------
--   ① 야간·휴일 근무 판정  — 공휴일에 적은 기록은 전부 휴일 근무다
--   ② 가동일 계산          — 영업일에서 공휴일도 뺀다 (KPI 총괄 분석의 모든 비율의 분모)
--
-- 🔑 자동으로 받아 온 것(auto)과 손으로 넣은 것(manual)을 «구분해 둔다».
--    구분이 없으면 다음 동기화가 손댄 것을 덮어 다음날 아침에 사라진다.
--
-- ⚠ 이 표가 생기면 가동일이 줄어 기록 충실도와 「회사 평균 대비」가 올라간다.
--   지난 분기 숫자가 달라진다 (2026-08-24 사용자 확인 — 시험 운영이라 무관).

BEGIN;

CREATE TABLE IF NOT EXISTS holidays (
  holiday_date  DATE PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  -- auto   = 외부 달력에서 받아 온 것. 동기화가 갱신·삭제한다
  -- manual = 사람이 넣은 것. 🔑 동기화가 절대 건드리지 않는다
  source        VARCHAR(10)  NOT NULL DEFAULT 'auto'
                CHECK (source IN ('auto', 'manual')),
  -- 「공휴일이지만 우리 회사는 근무한다」 — 빼지 않고 «근무일로 되돌리는» 표시.
  -- 지우지 않고 남겨 두는 이유는, 지우면 다음 동기화가 다시 넣기 때문이다.
  is_working    BOOLEAN      NOT NULL DEFAULT false,
  note          TEXT,
  synced_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays (holiday_date);

-- 앱 계정에 권한을 준다.
-- ⚠ 이것을 빼면 화면이 «권한 오류로 조용히 비어» 보인다 (전에 겪은 함정).
GRANT SELECT, INSERT, UPDATE, DELETE ON holidays TO "vitron-dashboard";

-- 창립기념일 — 노동절(5/1)과 같은 날이라 휴무일이 늘지는 않는다.
-- 이름만 함께 보이게 해 둔다 (2026-08-24 사용자 확인).
INSERT INTO holidays (holiday_date, name, source, note)
VALUES ('2026-05-01', '노동절 · 창립기념일', 'manual', '창립기념일이 노동절과 같은 날이다')
ON CONFLICT (holiday_date) DO NOTHING;

SELECT count(*) AS rows FROM holidays;

COMMIT;
