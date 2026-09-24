-- ============================================================
-- 044-project-profit.sql — 프로젝트 손익 관리 1단계: 계약금액 · 인건비 단가 (2026-09-25 지시)
--
--   ⚠ admin 계정으로 실행한다. 새 표를 만들었으면 앱 계정에 GRANT 하는 것을 잊지 말 것 —
--     안 하면 화면이 권한 오류로 «조용히 비어» 보인다.
--
--      scp db/migrations/044-project-profit.sql root@vitron-nas:/tmp/
--      ssh root@vitron-nas 'docker exec -i postgres psql -U admin \
--        -d vitron_dashboard -v ON_ERROR_STOP=1 -f /dev/stdin < /tmp/044-project-profit.sql'
--
-- 무엇인가
--   대표이사 전용 「손익」 탭이 쓰는 두 표. 손익 = 계약금액 − (인건비 + 경비 + 이동 + 구매).
--   경비(trip_expenses)·이동(schedule_actuals)·구매(purchase_requests)는 이미 있고,
--   «매출» 과 «사람의 시간값» 을 담을 자리만 없었다.
--
-- 🔴 두 표 모두 «대표이사만» 읽고 쓴다. 서버가 직책(workers.position = '대표이사')으로
--    막는다 — can_approve_settlement 로 막으면 안 된다. 지금 그 값이 참인 사람이
--    둘이라(임시 승인 권한을 받은 이건호) 전 직원의 시간당 단가가 새어 나간다.
-- ============================================================

-- ── 계약금액 — «이력» 을 남긴다 (사용자 지시) ──────────────────
-- 🔑 고치지 않고 «한 줄씩 쌓는다». 변경 계약이 생기면 새 줄을 넣고, 가장 최근 줄이
--    지금 계약이다. 고쳐 쓰면 「처음에 얼마였다가 언제 얼마로 바뀌었나」가 사라진다.
-- 🔑 금액 기준은 «공급가(부가세 뺀 금액)» 다 (사용자 지시). 입력은 받은 그대로 두고
--    부가세 포함 여부를 체크로 받아, 공급가를 «계산해 저장» 한다 — 볼 때마다
--    다시 나누면 반올림 규칙을 바꾸는 순간 지난 손익이 소급해 달라진다
--    (transit_fee · vacation_hours 와 같은 원칙).
CREATE TABLE IF NOT EXISTS project_contracts (
  id             SERIAL PRIMARY KEY,

  -- 프로젝트 = Jira 상위업무. 키와 «이름» 을 함께 담는다 (trip_expenses 와 같은 방식) —
  -- 동기화가 제목을 바꿔도 지난 표시가 흔들리지 않는다.
  parent_key     VARCHAR(40),
  parent_text    VARCHAR(200) NOT NULL,

  amount         BIGINT  NOT NULL,              -- 입력한 금액 그대로 (원)
  vat_included   BOOLEAN NOT NULL DEFAULT FALSE,-- 위 금액에 부가세가 들어 있는가
  supply_amount  BIGINT  NOT NULL,              -- 공급가 = 포함이면 round(금액 ÷ 1.1)
  contract_date  DATE    NOT NULL DEFAULT CURRENT_DATE,
  kind           VARCHAR(10) NOT NULL DEFAULT 'initial',
  note           TEXT,

  created_by     INTEGER,                       -- kpi_users.id
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT project_contracts_kind_chk   CHECK (kind IN ('initial',   -- 최초 계약
                                                          'change')),  -- 변경 계약
  CONSTRAINT project_contracts_amount_chk CHECK (amount >= 0 AND supply_amount >= 0)
);

COMMENT ON TABLE project_contracts IS
  '프로젝트 계약금액 이력. 고치지 않고 쌓는다 — 가장 최근(계약일·번호 순) 줄이 지금 계약이다.';
COMMENT ON COLUMN project_contracts.supply_amount IS
  '공급가(부가세 뺀 금액). 손익은 이 값으로 계산한다. 계산해 «저장» 한다 — 소급 변동 방지.';

-- 🔑 «프로젝트 하나» 를 가르는 열쇠 = coalesce(parent_key, parent_text).
--    키가 없는 것(고정업무 같은 MANUAL 항목)도 있기 때문이다.
CREATE INDEX IF NOT EXISTS idx_project_contracts_project
  ON project_contracts (coalesce(parent_key, parent_text), contract_date DESC, id DESC);

-- ── 인건비 단가 — 사람별 «시간당» (사용자 지시) ────────────────
-- 🔑 단가가 바뀌어도 «지난 달 인건비는 그때 단가로» 계산해야 한다. 그래서 값 하나가
--    아니라 «적용 시작일» 을 단 이력으로 둔다. 그날 적용되는 단가 =
--    그날 이전(같은 날 포함) 가운데 가장 늦게 시작한 줄.
-- 🔴 UNIQUE 의 두 칸을 모두 NOT NULL 로 둔다. NULL 이 섞이면 «안 막힌다» —
--    하이패스 CHECK · 발표 내용 UNIQUE 에서 두 번 겪은 3값 논리 함정이다.
CREATE TABLE IF NOT EXISTS worker_hourly_rates (
  id             SERIAL PRIMARY KEY,
  worker_id      INTEGER NOT NULL,              -- workers.id (FK 없음 — 퇴사해도 이력은 남는다)
  hourly_rate    INTEGER NOT NULL,              -- 원/시간
  effective_from DATE    NOT NULL,
  note           TEXT,

  created_by     INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT worker_hourly_rates_rate_chk CHECK (hourly_rate >= 0),
  CONSTRAINT worker_hourly_rates_uniq     UNIQUE (worker_id, effective_from)
);

COMMENT ON TABLE worker_hourly_rates IS
  '사람별 시간당 인건비 단가 이력. 그날 적용 단가 = 그날 이전 가운데 가장 늦게 시작한 줄. 대표이사 전용.';

-- ── 앱 계정 권한 ─────────────────────────────────────────────
-- 🔴 빠뜨리면 화면이 «권한 오류로 조용히 비어» 보인다.
GRANT SELECT, INSERT, UPDATE, DELETE ON project_contracts   TO "vitron-dashboard";
GRANT SELECT, INSERT, UPDATE, DELETE ON worker_hourly_rates TO "vitron-dashboard";
GRANT USAGE, SELECT ON SEQUENCE project_contracts_id_seq   TO "vitron-dashboard";
GRANT USAGE, SELECT ON SEQUENCE worker_hourly_rates_id_seq TO "vitron-dashboard";

-- ── 확인 ─────────────────────────────────────────────────────
\echo '=== 만들어진 표 ==='
SELECT table_name FROM information_schema.tables
 WHERE table_name IN ('project_contracts', 'worker_hourly_rates') ORDER BY 1;

\echo '=== 앱 계정 권한 (두 표 모두 4가지가 있어야 한다) ==='
SELECT table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS grants
  FROM information_schema.table_privileges
 WHERE grantee = 'vitron-dashboard'
   AND table_name IN ('project_contracts', 'worker_hourly_rates')
 GROUP BY table_name ORDER BY table_name;
