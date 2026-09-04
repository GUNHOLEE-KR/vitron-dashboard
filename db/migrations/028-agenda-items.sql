-- 028 「안건」 — 회의에서 나온 것·확인할 것을 기한과 함께 관리한다 (2026-09-04 지시)
--
-- 회의에서 나온 안건이나 진행 중인 프로젝트에서 확인해야 할 것들이 여태 갈 곳이
-- 없었다. Jira 이슈로 만들기엔 작고, 말로만 남기면 기한도 완료 여부도 흐려진다.
--
-- 🔑 «대시보드에 적고, 키울 것만 Jira 로 올린다»(사용자 결정).
--    적는 문턱이 낮아야 실제로 적힌다 — 대시보드는 전 직원이 매일 여는 화면이다.
--
-- ■ 완료는 «두 단계» 다 (지시)
--     done      담당자가 「했다」 고 표시
--     confirmed 관리자가 확인 → 이때 Jira 이슈도 «완료» 로 넘긴다
--   한 단계로 두면 「했다는데 정말 됐나」 를 물어볼 자리가 없다.
--
-- ⚠ admin 계정으로 실행한다.
--   docker exec -i postgres psql -U admin -d <DB> -f 028-agenda-items.sql

CREATE TABLE IF NOT EXISTS agenda_items (
  id              SERIAL PRIMARY KEY,
  title           VARCHAR(200) NOT NULL,
  detail          TEXT,

  owner_worker_id INTEGER,                    -- 담당자 (workers.id)
  due_date        DATE,                       -- 기한. 비워 둘 수 있다

  -- open 대기 / doing 진행 / done 담당자 완료 / confirmed 관리자 확인 / hold 보류
  status          VARCHAR(12) NOT NULL DEFAULT 'open',

  -- ── 어느 프로젝트 일인가 ──
  -- 🔑 업무 입력과 «같은 목록» 에서 고른다(Jira 상위업무). 그래야 나중에 그 프로젝트로
  --    묶어 볼 수 있고, Jira 로 올릴 때 상위(에픽)로 그대로 쓴다.
  -- ⚠ 목록에는 「고정업무」처럼 Jira 에 «없는» 항목(MANUAL-…)도 섞여 있다.
  --   그런 것은 Jira 상위로 쓸 수 없어, 올릴 때 상위 없이 올린다.
  parent_key      VARCHAR(40),                -- jira_issues.jira_key
  parent_text     VARCHAR(200),               -- 목록에 없을 때 직접 적은 것

  source          VARCHAR(200),               -- 어디서 나왔나 (예: 9/4 주간회의)

  -- ── Jira 로 올린 뒤 ──
  jira_key        VARCHAR(40),
  jira_synced_at  TIMESTAMPTZ,

  created_by      INTEGER,                    -- kpi_users.id
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_at         TIMESTAMPTZ,
  done_by         INTEGER,
  confirmed_at    TIMESTAMPTZ,
  confirmed_by    INTEGER,

  CONSTRAINT agenda_items_status_chk
    CHECK (status IN ('open', 'doing', 'done', 'confirmed', 'hold'))
);

CREATE INDEX IF NOT EXISTS idx_agenda_owner  ON agenda_items (owner_worker_id, status);
CREATE INDEX IF NOT EXISTS idx_agenda_due    ON agenda_items (due_date);
CREATE INDEX IF NOT EXISTS idx_agenda_parent ON agenda_items (parent_key);

COMMENT ON TABLE agenda_items IS
  '회의 안건·확인할 것. 기한과 완료를 관리하고, 키울 것만 Jira 로 올린다.';
COMMENT ON COLUMN agenda_items.status IS
  'open 대기 / doing 진행 / done 담당자 완료 / confirmed 관리자 확인(=Jira 도 완료) / hold 보류';
COMMENT ON COLUMN agenda_items.parent_key IS
  'Jira 상위업무 키. MANUAL-… 은 Jira 에 없는 항목이라 상위로 쓸 수 없다.';

-- ── 앱 계정 권한 ─────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON agenda_items TO "vitron-dashboard";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "vitron-dashboard";

-- ── 확인 ─────────────────────────────────────────────────────
SELECT '안건' AS t, count(*) FROM agenda_items;
SELECT '상태' AS t, pg_get_constraintdef(oid) AS def
  FROM pg_constraint WHERE conname = 'agenda_items_status_chk';
