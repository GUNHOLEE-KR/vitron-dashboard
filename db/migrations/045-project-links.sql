-- ============================================================
-- 045-project-links.sql — 프로젝트 손익 2단계: 일정·구매에 «프로젝트» 를 단다 (2026-09-25 지시)
--
--   ⚠ admin 계정으로 실행한다 (기존 표에 칸만 더하므로 GRANT 는 다시 줄 필요가 없다).
--
--      scp db/migrations/045-project-links.sql root@vitron-nas:/tmp/
--      ssh root@vitron-nas 'docker exec -i postgres psql -U admin \
--        -d vitron_dashboard -v ON_ERROR_STOP=1 -f /dev/stdin < /tmp/045-project-links.sql'
--
-- 왜
--   손익의 원가 가운데 «이동 비용»(schedule_actuals 의 이동 실비·하이패스·주유)과
--   «구매»(purchase_requests)는 어느 프로젝트에 쓴 돈인지 적을 칸이 없었다.
--   경비(trip_expenses)만 043 에서 처음부터 프로젝트를 달고 나왔다.
-- ============================================================

-- ── 일정 계획: 프로젝트 «여러 개 + 비율» ─────────────────────
-- 🔑 한 번 나가서 여기저기 다니는 날이 있다 (사용자 지시). 두 길로 받는다.
--    ① 곳마다 계획을 따로 넣으면(「이동」 구간 등) 계획마다 프로젝트를 고른다
--    ② 하루를 계획 한 건으로 넣으면 프로젝트를 «여러 개» 고르고 비용을 «비율» 로 나눈다
--    값의 꼴 = [{"parent_key":"VITRON-9","parent_text":"[VITRON-9] …","share":60}, …]
--    share 는 «정수 %» 이고 합이 100 이다 — 서버가 맞춰 저장한다(화면 값을 믿지 않는다).
-- 🔑 실적(schedule_actuals)이 아니라 «계획» 에 단다. 실적은 plan_id 로 계획을 따라간다.
--    계획 없는 실적은 「공통(간접)」 으로 모인다.
-- ⚠ 업무(business) 일정에만 뜻이 있다. 개인 사용·휴가는 서버가 비운다 — 장소를
--    지우는 것과 같은 규칙이다(개인 사용의 행선지는 사생활).
ALTER TABLE schedule_plans ADD COLUMN IF NOT EXISTS projects JSONB;

-- 배열이 아닌 것이 들어오면 비율 계산이 조용히 0 이 된다 (042 transit_items 와 같은 빗장)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'schedule_plans_projects_chk') THEN
    ALTER TABLE schedule_plans ADD CONSTRAINT schedule_plans_projects_chk
      CHECK (projects IS NULL OR jsonb_typeof(projects) = 'array');
  END IF;
END $$;

COMMENT ON COLUMN schedule_plans.projects IS
  '이 일정이 쓴 프로젝트와 비율 [{parent_key,parent_text,share}] — share 는 정수 %, 합 100. '
  '업무 일정만. 실적의 이동 비용이 이 비율대로 프로젝트에 나뉜다.';

-- ── 구매 요청: 프로젝트 «하나» (선택) ────────────────────────
-- 🔑 없는 경우도 있다 (사용자 지시 — 사무용품처럼 프로젝트에 매이지 않는 구매).
--    키와 «이름» 을 함께 담는다(trip_expenses 와 같은 방식).
ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS parent_key  VARCHAR(40);
ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS parent_text VARCHAR(200);

COMMENT ON COLUMN purchase_requests.parent_text IS
  '이 구매를 쓴 프로젝트(Jira 상위업무, 선택). 승인된 것만 손익 원가에 들어간다.';

CREATE INDEX IF NOT EXISTS idx_purchase_project ON purchase_requests (parent_key)
  WHERE parent_key IS NOT NULL;

-- ── 확인 ─────────────────────────────────────────────────────
\echo '=== 더한 칸 ==='
SELECT table_name, column_name, data_type
  FROM information_schema.columns
 WHERE (table_name = 'schedule_plans'    AND column_name = 'projects')
    OR (table_name = 'purchase_requests' AND column_name IN ('parent_key', 'parent_text'))
 ORDER BY 1, 2;

\echo '=== 빗장 ==='
SELECT conname FROM pg_constraint WHERE conname = 'schedule_plans_projects_chk';
