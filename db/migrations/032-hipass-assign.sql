-- 032 하이패스 배정을 «자동» 으로, 손은 «고치는 데» 만 (2026-09-06 지시)
--
-- 사용자 정리 —
--   「엑셀 파일과 직원이 입력한 스케줄을 통해서 «자동으로 배정» 되는 게 기본이다.
--    그런데 스케줄을 잘못 입력하거나 사정이 생겨 다른 직원에게 보내거나
--    청구·정산할 필요가 없을 경우가 있어서, 생성된 목록을 «수정» 하는 기능이 필요하다」
--
-- 🔑 여태는 자동이 아니었다. 025 의 메모대로 «사람이 골라» 붙였다 —
--    「같은 날 같은 차를 둘이 썼을 수 있어」 가 그 까닭이었다.
--    그 걱정은 «둘 이상이 쓴 날» 에만 해당한다. 한 사람만 쓴 날은 기계가 붙이면 된다.
--    그래서 자동을 기본으로 두고, 애매한 날만 사람에게 남긴다.
--
-- ⚠ admin 계정으로 실행한다. 앱 계정은 테이블 소유자가 아니라 ALTER 가 거부된다.
--   docker exec -i postgres psql -U admin -d <DB> -f 032-hipass-assign.sql
--
-- ⚠ 되돌리기 (자료는 그대로 남는다)
--     ALTER TABLE hipass_tolls
--       DROP CONSTRAINT IF EXISTS hipass_tolls_one_owner_chk,
--       DROP CONSTRAINT IF EXISTS hipass_tolls_billed_kind_chk,
--       DROP COLUMN billed_worker_id, DROP COLUMN billed_kind,
--       DROP COLUMN billed_by, DROP COLUMN billed_at,
--       DROP COLUMN excluded, DROP COLUMN exclude_reason,
--       DROP COLUMN auto_assigned;

-- ── ① 실적이 «없는» 사람에게 손으로 넘기기 ────────────────────
-- 넘길 곳이 늘 실적인 것은 아니다. 그 사람이 그날 실적을 안 넣었을 수도 있고,
-- 애초에 실적으로 남길 일이 아닐 수도 있다. 그럴 때 사람에게 직접 건다.
ALTER TABLE hipass_tolls
  ADD COLUMN IF NOT EXISTS billed_worker_id INTEGER,          -- workers.id
  ADD COLUMN IF NOT EXISTS billed_kind      VARCHAR(10),      -- deposit / refund
  ADD COLUMN IF NOT EXISTS billed_by        INTEGER,          -- kpi_users.id
  ADD COLUMN IF NOT EXISTS billed_at        TIMESTAMPTZ;

COMMENT ON COLUMN hipass_tolls.billed_worker_id IS
  '손으로 넘긴 대상. 실적이 없는 사람에게 걸 때 쓴다. actual_id 와 «함께» 있을 수 없다.';
COMMENT ON COLUMN hipass_tolls.billed_kind IS
  'deposit 직원이 회사에 입금 / refund 회사가 직원에게 환급. 방향을 사람이 정한다.';

-- 🔴🔑 이 빗장이 이 마이그레이션의 핵심이다.
--    통행은 셋 중 «하나» 다 — 실적에 붙었거나 / 손으로 사람에게 걸었거나 / 아직 아무것도.
--    둘 다이면 같은 돈이 «두 번» 세어진다. 화면과 서버에서도 막지만 마지막은 DB 에 둔다.
ALTER TABLE hipass_tolls DROP CONSTRAINT IF EXISTS hipass_tolls_one_owner_chk;
ALTER TABLE hipass_tolls
  ADD CONSTRAINT hipass_tolls_one_owner_chk
  CHECK (actual_id IS NULL OR billed_worker_id IS NULL);

-- 넘길 사람을 정했으면 «방향» 도 반드시 있어야 한다. 없으면 어느 쪽 돈인지 모른다.
-- 🔴 «IN 만 쓰면 막지 못한다» — 실측으로 잡았다(2026-09-06).
--    billed_kind 가 NULL 이면  NULL IN ('deposit','refund') → FALSE 가 아니라 «NULL» 이고,
--    CHECK 는 «FALSE 일 때만» 막으므로 그대로 통과한다(SQL 3값 논리).
--    그러면 「방향 없는 청구」 가 생기고, 정산은 그것을 조용히 «입금» 으로 세어 버린다.
--    그래서 coalesce 로 NULL 을 «값» 으로 끌어내려 FALSE 가 되게 한다.
ALTER TABLE hipass_tolls DROP CONSTRAINT IF EXISTS hipass_tolls_billed_kind_chk;
ALTER TABLE hipass_tolls
  ADD CONSTRAINT hipass_tolls_billed_kind_chk
  CHECK (billed_worker_id IS NULL OR coalesce(billed_kind, '') IN ('deposit', 'refund'));

-- ── ② 정산 «제외» ───────────────────────────────────────────
-- 🔑 지우는 것이 아니다 (사용자 확인). 지우면 근거가 사라지고, 같은 파일을 다시 올리면
--    되살아나기까지 한다(중복 판정이 파일 번호가 아니라 차량+일시+구간+금액이라서).
--    그래서 «기록·근거·누구 것이었나» 는 그대로 두고 «금액 합산에서만» 뺀다.
ALTER TABLE hipass_tolls
  ADD COLUMN IF NOT EXISTS excluded       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS exclude_reason VARCHAR(200);

COMMENT ON COLUMN hipass_tolls.excluded IS
  '정산에서 뺀다. 기록은 남는다 — 지우기와 다르다. 실적의 toll_fee 합산에서 빠진다.';

-- ── ③ 자동으로 붙은 것인지 ──────────────────────────────────
-- 🔑 「자동 배정 다시 돌리기」 가 «사람이 정한 것» 을 덮어쓰면 안 된다.
--    자동으로 붙은 것만 다시 손볼 수 있게 표시를 남긴다.
ALTER TABLE hipass_tolls
  ADD COLUMN IF NOT EXISTS auto_assigned BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN hipass_tolls.auto_assigned IS
  '기계가 붙였다. 사람이 고치면 FALSE 가 되어 자동 배정이 다시 건드리지 않는다.';

CREATE INDEX IF NOT EXISTS idx_hipass_billed   ON hipass_tolls (billed_worker_id);
CREATE INDEX IF NOT EXISTS idx_hipass_excluded ON hipass_tolls (excluded);

-- ⚠ 새 «표» 가 아니라 칸만 더했으므로 GRANT 는 025 의 것이 그대로 유효하다.

-- ── 확인 ─────────────────────────────────────────────────────
SELECT '칸' AS t, column_name, data_type, column_default
  FROM information_schema.columns
 WHERE table_name = 'hipass_tolls'
   AND column_name IN ('billed_worker_id','billed_kind','billed_by','billed_at',
                       'excluded','exclude_reason','auto_assigned')
 ORDER BY column_name;
SELECT '빗장' AS t, conname FROM pg_constraint
 WHERE conrelid = 'hipass_tolls'::regclass
   AND conname IN ('hipass_tolls_one_owner_chk','hipass_tolls_billed_kind_chk');
SELECT '현황' AS t,
       count(*) FILTER (WHERE actual_id IS NOT NULL)        AS 실적에_붙음,
       count(*) FILTER (WHERE billed_worker_id IS NOT NULL) AS 손으로_걺,
       count(*) FILTER (WHERE excluded)                     AS 정산_제외,
       count(*)                                             AS 전체
  FROM hipass_tolls;
