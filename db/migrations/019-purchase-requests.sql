-- ============================================================
-- 019-purchase-requests.sql — 구매 요청 · 승인 · 이력 (2026-08-26)
--
--   ⚠ admin 계정으로 실행한다. 앱 계정은 표의 주인이 아니라 CREATE 가 거부된다.
--
--      scp db/migrations/019-purchase-requests.sql root@vitron-nas:/tmp/
--      ssh root@vitron-nas "docker exec -i postgres \
--        psql -U admin -d vitron_dashboard -v ON_ERROR_STOP=1 -f /dev/stdin \
--        < /tmp/019-purchase-requests.sql"
--
-- 왜 새 표인가
--   휴가는 이미 있던 «일정 한 줄» 에 상태를 붙이는 것이었지만, 구매는 붙일 곳이
--   아예 없다. 일정도 실적도 아니고 금액과 링크를 담아야 한다.
-- ============================================================

CREATE TABLE IF NOT EXISTS purchase_requests (
  id            SERIAL PRIMARY KEY,

  -- 누가 요청했나. 🔑 FK 는 걸지 않는다 — 계정이나 직원이 지워져도
  --   «누가 무엇을 샀는가» 는 남아야 한다(이 저장소의 다른 표와 같은 규칙).
  requester_id  INTEGER,                       -- kpi_users.id
  worker_id     INTEGER,                       -- workers.id (이름 표시·집계용)

  item_name     VARCHAR(200) NOT NULL,         -- 물품명
  qty           NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price    INTEGER NOT NULL DEFAULT 0,    -- 원
  -- 🔑 금액을 «저장할 때 확정» 한다. 수량·단가로 언제든 다시 곱할 수 있지만,
  --    그러면 반올림이 화면·서버·집계에서 제각각 될 수 있다. 돈은 한 곳에서만 정한다.
  amount        INTEGER NOT NULL DEFAULT 0,

  link          TEXT,                          -- 구매 링크
  used_for      VARCHAR(200),                  -- 사용처
  note          TEXT,                          -- 기타

  status        VARCHAR(10) NOT NULL DEFAULT 'pending',   -- pending/approved/rejected
  approved_at   TIMESTAMPTZ,
  approved_by_id INTEGER,                      -- kpi_users.id
  reject_reason VARCHAR(200),

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT purchase_requests_status_chk
    CHECK (status IN ('pending','approved','rejected')),
  -- 수량·단가에 음수가 들어가면 누적 금액이 조용히 줄어든다
  CONSTRAINT purchase_requests_qty_chk   CHECK (qty > 0),
  CONSTRAINT purchase_requests_price_chk CHECK (unit_price >= 0)
);

COMMENT ON TABLE  purchase_requests IS '구매 요청과 그 결재. 승인된 것이 곧 구매 이력이다.';
COMMENT ON COLUMN purchase_requests.amount IS
  '수량 × 단가를 저장 시점에 확정한 금액(원). 집계는 이 칸만 더한다.';
COMMENT ON COLUMN purchase_requests.reject_reason IS
  '반려 사유. 반려는 사람에게 「왜」 를 알려야 하는 일이라 한 줄을 함께 받는다.';

-- 「승인 대기」와 「이 달에 얼마 썼나」 를 자주 뽑는다
CREATE INDEX IF NOT EXISTS idx_purchase_status  ON purchase_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_worker  ON purchase_requests (worker_id, created_at DESC);

-- 앱 계정이 쓸 수 있어야 한다. 표의 주인이 admin 이라 권한을 따로 준다.
GRANT SELECT, INSERT, UPDATE, DELETE ON purchase_requests TO "vitron-dashboard";
GRANT USAGE, SELECT ON SEQUENCE purchase_requests_id_seq TO "vitron-dashboard";

\echo '=== 적용 결과 ==='
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_name = 'purchase_requests'
 ORDER BY ordinal_position;
