-- 036 회의록 — «작성자» · «서식» · «참석자별 입력란» (2026-09-07 지시)
--
-- 세 가지를 한 번에 담는다. 셋 다 회의록 한 표에 걸리는 일이라 갈라 두면
-- 마이그레이션 순서만 늘고 얻는 것이 없다.
--
-- ── ① 작성자 ────────────────────────────────────────────────
-- 여태는 «로그인한 사람»(created_by)이 곧 작성자였다. 실제로는 회의에 못 온
-- 사람의 회의록을 대신 적어 주는 일이 있어 「실제 작성한 사람」과 어긋난다
-- (사용자 지적 — 「회의록 작성하는 실제 인원 저장」).
-- 🔑 created_by 는 «누가 이 줄을 넣었나» 로 그대로 둔다. 지우기 권한이 여기에
--    걸려 있어 뜻을 바꾸면 남의 회의록을 지울 수 있게 된다.
--
-- ── ② 서식 있는 본문 ────────────────────────────────────────
-- 🔑 body(글자) 는 «지우지 않는다». body_html 이 주인이 되고 body 는 태그를 뗀
--    사본으로 남긴다 — 검색(제목·본문 훑기)과 옛 회의록이 그대로 살아 있어야 한다.
--    body_html 이 비어 있으면 화면은 body 를 글자 그대로 보여 준다.
--
-- ── ③ 참석자별 입력란 ───────────────────────────────────────
-- 「컨플루언스처럼 여럿이 동시에」는 실시간 협업 편집이라 사내에서 감당이 안 된다.
-- 🔑 대신 «사람마다 자기 칸» 을 둔다(사용자 채택). 각자 자기 줄만 고치므로
--    부딪힐 일이 없고, 볼 때는 본문 아래에 이어 붙여 «한 박스» 로 보인다.
--
-- 🔴 meeting_notes 는 ON DELETE CASCADE 다 — agenda_items 와 «반대» 다.
--    안건에는 기한·담당·Jira 가 걸려 있어 회의가 지워져도 남겨야 하지만,
--    발표 내용은 «회의록 본문의 일부» 다. 본문이 지워지는데 조각만 떠돌면
--    누구 것인지도, 무슨 회의였는지도 알 수 없는 글이 남는다.
--
-- ⚠ admin 계정으로 실행한다. 앱 계정은 테이블 소유자가 아니라 ALTER 가 거부된다.
--   docker exec -i postgres psql -U admin -d <DB> -f 036-meeting-notes.sql
--
-- ⚠ 되돌리기
--     DROP TABLE meeting_notes;
--     ALTER TABLE meetings DROP COLUMN author_worker_id,
--                          DROP COLUMN author_text,
--                          DROP COLUMN body_html;

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS author_worker_id INTEGER,
  ADD COLUMN IF NOT EXISTS author_text      VARCHAR(100),
  ADD COLUMN IF NOT EXISTS body_html        TEXT;

COMMENT ON COLUMN meetings.author_worker_id IS
  '회의록을 «실제로 적은» 사람 (workers.id). 넣은 사람(created_by)과 다를 수 있다.';
COMMENT ON COLUMN meetings.author_text IS
  '직원 명단에 없는 작성자를 글자로 적은 것. author_worker_id 와 «둘 중 하나» 만 쓴다.';
COMMENT ON COLUMN meetings.body_html IS
  '서식이 있는 본문(HTML). 이것이 주인이고 body 는 태그를 뗀 사본이다 — 검색이 body 를 훑는다.';

-- ── 참석자별 입력란 ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meeting_notes (
  id          SERIAL PRIMARY KEY,
  meeting_id  INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  -- 🔑 사람은 «번호» 로 둔다 (meetings.attendee_ids 와 같은 까닭 — 이름은 바뀐다).
  worker_id   INTEGER NOT NULL,
  body_html   TEXT,
  body        TEXT,                       -- 태그를 뗀 사본. 검색용.
  updated_by  INTEGER,                    -- kpi_users.id — 마지막으로 손댄 사람
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 🔑 한 회의에서 한 사람은 한 칸이다. 이 제약이 곧 «부딪히지 않는» 근거다.
  UNIQUE (meeting_id, worker_id)
);

CREATE INDEX IF NOT EXISTS idx_meeting_notes_meeting ON meeting_notes (meeting_id);

COMMENT ON TABLE meeting_notes IS
  '회의록의 «참석자별 발표 내용». 사람마다 자기 칸만 고치므로 동시 편집이 필요 없다. '
  '볼 때는 본문 아래에 이어 붙여 한 박스로 보인다. 회의록을 지우면 함께 지워진다.';

-- ── 앱 계정 권한 ─────────────────────────────────────────────
-- ⚠ 새 표를 만들었으면 반드시 준다. 안 하면 화면이 권한 오류로 조용히 비어 보인다.
GRANT SELECT, INSERT, UPDATE, DELETE ON meeting_notes TO "vitron-dashboard";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "vitron-dashboard";

-- ── 확인 ─────────────────────────────────────────────────────
SELECT '회의록 새 칸' AS t, column_name, data_type
  FROM information_schema.columns
 WHERE table_name = 'meetings'
   AND column_name IN ('author_worker_id', 'author_text', 'body_html')
 ORDER BY column_name;
SELECT '참석자별 입력란' AS t, count(*) AS 줄 FROM meeting_notes;
SELECT '옛 회의록' AS t, count(*) AS 전체,
       count(body) AS 본문_있음, count(body_html) AS 서식_있음
  FROM meetings;
