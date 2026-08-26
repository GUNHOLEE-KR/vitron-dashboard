-- ============================================================
-- 018-vacation-approval.sql — 휴가 신청·승인 (2026-08-26)
--
--   ⚠ admin 계정으로 실행한다. 앱 계정은 표의 주인이 아니라 ALTER 가 거부된다.
--
--      scp db/migrations/018-vacation-approval.sql root@vitron-nas:/tmp/
--      ssh root@vitron-nas "docker exec -i postgres \
--        psql -U admin -d vitron_dashboard -v ON_ERROR_STOP=1 -f /dev/stdin \
--        < /tmp/018-vacation-approval.sql"
--
-- 왜 새 표를 만들지 않는가
--   휴가는 이미 schedule_plans 의 한 줄(use_type='vacation')이고,
--   «승인» 은 그 줄의 상태다. 표를 나누면 조회마다 조인이 붙고,
--   「승인은 남았는데 계획이 지워진」 고아 행이 생긴다.
-- ============================================================

ALTER TABLE schedule_plans
  ADD COLUMN IF NOT EXISTS approval       VARCHAR(10),   -- pending / approved / rejected
  ADD COLUMN IF NOT EXISTS approved_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by_id INTEGER,       -- kpi_users.id
  ADD COLUMN IF NOT EXISTS reject_reason  VARCHAR(200);

COMMENT ON COLUMN schedule_plans.approval IS
  '휴가에만 쓴다. pending=신청 · approved=승인 · rejected=반려. NULL 이면 승인 제도 밖(업무 일정이거나 제도 이전 기록)';
COMMENT ON COLUMN schedule_plans.reject_reason IS
  '반려 사유. 반려는 사람에게 「왜」 를 알려야 하는 일이라 한 줄을 함께 받는다.';

ALTER TABLE schedule_plans DROP CONSTRAINT IF EXISTS schedule_plans_approval_chk;
ALTER TABLE schedule_plans ADD  CONSTRAINT schedule_plans_approval_chk
  CHECK (approval IS NULL OR approval IN ('pending','approved','rejected'));

-- 🔑 FK 를 걸지 않는다. 승인한 계정이 나중에 지워져도 «누가 승인했다» 는 기록은
--    남아야 한다 — 이 저장소가 worker_id 에 FK 를 안 거는 것과 같은 이유다.

-- 「승인 대기」 목록을 자주 뽑으므로 그 줄만 색인한다
CREATE INDEX IF NOT EXISTS idx_plans_approval_pending
  ON schedule_plans (approval, plan_date) WHERE approval = 'pending';

-- ⚠ 이미 들어 있는 휴가는 손대지 않는다(현재 0건이지만 규칙을 적어 둔다).
--   제도가 없던 때의 것이라 소급 승인을 요구하지 않는다. NULL = 「해당 없음」.

\echo '=== 적용 결과 ==='
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_name = 'schedule_plans'
   AND column_name IN ('approval','approved_at','approved_by_id','reject_reason')
 ORDER BY column_name;
