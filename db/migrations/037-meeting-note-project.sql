-- 037 참석자 발표 내용에 «프로젝트» (2026-09-08 지시)
--
-- 어제 만든 발표 내용은 「한 회의 · 한 사람 · 한 칸」 이었다. 실제로 한 사람이
-- 여러 프로젝트를 나눠 보고하므로 한 칸에 다 뭉쳐 적을 수밖에 없었고, 그러면
-- 「이 프로젝트 얘기가 어느 회의에서 누구 입에서 나왔나」 를 되짚을 수가 없다.
--
-- 사용자 지시 — 「입력할 때도 jira 의 어떤 일감에 관한 내용이다를 선택하고 입력하게
-- 해서, 나중에 회의록에서 인원별로 보기 · 프로젝트별로 보기가 만들어지면 좋겠다」
--
-- 🔑 고르는 단위는 «상위업무(프로젝트) 하나» 다 (사용자 결정). 안건 등록과 «같은 목록·
--    같은 방식» 이라 배울 것이 없고, 프로젝트별 보기가 곧바로 된다.
-- 🔑 안건(agenda_items)과 «똑같은 두 칸» 을 쓴다 —
--      parent_key  = Jira 키 (「고정업무」처럼 키가 없는 것도 있다)
--      parent_text = 고른 «전체 문구» 또는 목록에 없어 직접 적은 것
--    이름을 맞춰 두면 나중에 안건과 발표 내용을 한 자리에서 묶을 수 있다.
--
-- 🔴 열쇠가 «한 사람» 에서 «한 사람 × 한 프로젝트» 로 넓어진다.
--    ⚠ 그냥 UNIQUE (meeting_id, worker_id, parent_text) 로 두면 «안 막힌다» —
--      NULL 은 서로 같지 않아서, 프로젝트를 안 고른 줄이 얼마든지 쌓인다.
--      036 의 CHECK 함정과 같은 뿌리(3값 논리)다. coalesce 로 빈 글자를 만들어 잠근다.
--
-- 🔑 어제 적힌 것은 «그대로 둔다». parent_text 가 NULL 이면 「프로젝트 미지정」이고,
--    화면은 그것을 따로 묶어 보여 준다 — 지우거나 억지로 붙이지 않는다.
--
-- ⚠ admin 계정으로 실행한다. 앱 계정은 테이블 소유자가 아니라 ALTER 가 거부된다.
--   docker exec -i postgres psql -U admin -d <DB> -f 037-meeting-note-project.sql
--
-- ⚠ 되돌리기
--     DROP INDEX idx_meeting_notes_key;
--     DELETE FROM meeting_notes a USING meeting_notes b      -- 한 사람 한 줄로 줄인 뒤라야
--      WHERE a.meeting_id=b.meeting_id AND a.worker_id=b.worker_id AND a.id>b.id;
--     ALTER TABLE meeting_notes ADD CONSTRAINT meeting_notes_meeting_id_worker_id_key
--       UNIQUE (meeting_id, worker_id);
--     ALTER TABLE meeting_notes DROP COLUMN parent_key, DROP COLUMN parent_text;

ALTER TABLE meeting_notes
  ADD COLUMN IF NOT EXISTS parent_key  VARCHAR(50),
  ADD COLUMN IF NOT EXISTS parent_text VARCHAR(300);

COMMENT ON COLUMN meeting_notes.parent_key IS
  '이 발표 내용이 어느 Jira 상위업무(프로젝트)에 관한 것인가. 「고정업무」처럼 키가 없는 것도 있다.';
COMMENT ON COLUMN meeting_notes.parent_text IS
  '프로젝트의 «전체 문구». 목록에 없어 직접 적은 것도 여기 담긴다. 비어 있으면 「프로젝트 미지정」.';

-- ── 열쇠를 넓힌다 ───────────────────────────────────────────
-- 036 이 만든 「한 사람 한 줄」 제약을 떼고, 「한 사람 × 한 프로젝트」로 다시 건다.
ALTER TABLE meeting_notes
  DROP CONSTRAINT IF EXISTS meeting_notes_meeting_id_worker_id_key;

-- 🔴 coalesce 필수 — NULL 끼리는 서로 같지 않아 «중복이 막히지 않는다».
CREATE UNIQUE INDEX IF NOT EXISTS idx_meeting_notes_key
  ON meeting_notes (meeting_id, worker_id, coalesce(parent_text, ''));

-- 프로젝트별로 훑을 때 쓴다.
CREATE INDEX IF NOT EXISTS idx_meeting_notes_project
  ON meeting_notes (meeting_id, parent_text);

-- ⚠ 새 표가 아니라 칸만 더했으므로 GRANT 는 036 의 것이 그대로 유효하다.

-- ── 확인 ─────────────────────────────────────────────────────
SELECT '새 칸' AS t, column_name, data_type
  FROM information_schema.columns
 WHERE table_name = 'meeting_notes' AND column_name IN ('parent_key', 'parent_text')
 ORDER BY column_name;
SELECT '옛 제약' AS t, count(*) AS 남은_것
  FROM pg_constraint
 WHERE conname = 'meeting_notes_meeting_id_worker_id_key';
SELECT '새 열쇠' AS t, indexname FROM pg_indexes
 WHERE tablename = 'meeting_notes' AND indexname IN ('idx_meeting_notes_key', 'idx_meeting_notes_project')
 ORDER BY indexname;
SELECT '발표 내용' AS t, count(*) AS 전체, count(parent_text) AS 프로젝트_있음
  FROM meeting_notes;
