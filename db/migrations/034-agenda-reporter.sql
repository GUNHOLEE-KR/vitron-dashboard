-- 034 안건에 «보고자» (2026-09-07 지시)
--
-- 안건에는 «담당자»(owner_worker_id)만 있었다. 회의에서는 「누가 맡아 하는가」와
-- 「누가 회의에서 보고하는가」가 다를 때가 있다 (사용자 지적).
--
-- 🔑 Jira 는 «자동화하지 않는다» (사용자 결정).
--    Jira 에 보고자 필드를 채우려면 계정을 매핑해야 하고 그 품이 얻는 것보다 크다.
--    대신 Jira 로 올릴 때 «제목 뒤에 _보고자이름» 을 붙인다 — 목록에서 바로 보인다.
--
-- ⚠ admin 계정으로 실행한다. 앱 계정은 테이블 소유자가 아니라 ALTER 가 거부된다.
--   docker exec -i postgres psql -U admin -d <DB> -f 034-agenda-reporter.sql
--
-- ⚠ 되돌리기
--     ALTER TABLE agenda_items DROP COLUMN reporter_worker_id;

ALTER TABLE agenda_items
  ADD COLUMN IF NOT EXISTS reporter_worker_id INTEGER;

COMMENT ON COLUMN agenda_items.reporter_worker_id IS
  '회의에서 이 안건을 «보고할» 사람. 담당자(owner_worker_id)와 다를 수 있다. '
  'Jira 로 올릴 때 제목 뒤에 _이름 으로 붙는다.';

CREATE INDEX IF NOT EXISTS idx_agenda_reporter ON agenda_items (reporter_worker_id);

-- ⚠ 새 표가 아니라 칸만 더했으므로 GRANT 는 030 의 것이 그대로 유효하다.

-- ── 확인 ─────────────────────────────────────────────────────
SELECT '칸' AS t, column_name, data_type
  FROM information_schema.columns
 WHERE table_name = 'agenda_items' AND column_name = 'reporter_worker_id';
SELECT '안건' AS t, count(*) AS 전체,
       count(reporter_worker_id) AS 보고자_있음
  FROM agenda_items;
