-- 030 「회의록」 — 안건을 회의 아래로 묶는다 (2026-09-05 지시)
--
-- 어제 만든 「안건」은 낱건 목록이라 «어느 회의에서 나왔는지» 가 남지 않았다.
-- 출처를 글자로 적는 칸(source)이 있었지만 「9/4 주간회의」처럼 사람마다 다르게
-- 적혀 묶어 볼 수 없었다. 회의록을 실물로 두고 안건을 그 아래에 건다.
--
-- 🔑 «회의록을 쓰면서 그 자리에서 안건이 생긴다»(사용자 결정).
--    회의 내용은 본문에 적고, 할 일이 된 것만 안건으로 떼어 기한·담당을 붙인다.
--    키울 것은 거기서 다시 Jira 로 올린다 — 어제 만든 길을 그대로 쓴다.
--
-- 🔑 기존 안건은 «그대로 둔다»(지시). meeting_id 가 비어 있으면 「회의 없는 안건」이다.
--
-- ⚠ admin 계정으로 실행한다.
--   docker exec -i postgres psql -U admin -d <DB> -f 030-meetings.sql

CREATE TABLE IF NOT EXISTS meetings (
  id             SERIAL PRIMARY KEY,
  title          VARCHAR(200) NOT NULL,       -- 예: 9월 1주 주간회의
  met_on         DATE NOT NULL,               -- 회의 날짜
  place          VARCHAR(200),                -- 회의실·화상 등

  -- 참석자. 🔑 이름이 아니라 «번호» 로 둔다 — 사람 이름은 바뀌고, 동명이인이 있다.
  --    화면은 이미 직원 목록을 들고 있으므로 이름은 그때 붙인다(조인이 필요 없다).
  attendee_ids   INTEGER[] NOT NULL DEFAULT '{}',
  -- 사외 참석자처럼 명단에 없는 사람. 글자로 남긴다.
  attendee_text  VARCHAR(300),

  body           TEXT,                        -- 논의 내용 (회의록 본문)

  created_by     INTEGER,                     -- kpi_users.id
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meetings_date ON meetings (met_on DESC);

COMMENT ON TABLE meetings IS
  '회의록. 본문에 논의 내용을 적고, 할 일이 된 것은 agenda_items 로 떼어 단다.';

-- ── 안건을 회의에 건다 ───────────────────────────────────────
-- 🔴 ON DELETE SET NULL — 회의록을 지워도 «안건은 남는다».
--    안건에는 기한·담당·Jira 가 걸려 있어, 회의록을 지웠다고 함께 사라지면
--    남의 할 일이 조용히 없어진다. 회의만 떨어지고 「회의 없는 안건」이 된다.
ALTER TABLE agenda_items
  ADD COLUMN IF NOT EXISTS meeting_id INTEGER REFERENCES meetings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agenda_meeting ON agenda_items (meeting_id);

COMMENT ON COLUMN agenda_items.meeting_id IS
  '어느 회의에서 나왔나. 비어 있으면 회의와 무관한 안건이다(2026-09-04 이전에 적힌 것 포함).';

-- ── 앱 계정 권한 ─────────────────────────────────────────────
-- ⚠ 새 표를 만들었으면 반드시 준다. 안 하면 화면이 권한 오류로 조용히 비어 보인다.
GRANT SELECT, INSERT, UPDATE, DELETE ON meetings TO "vitron-dashboard";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "vitron-dashboard";

-- ── 확인 ─────────────────────────────────────────────────────
SELECT '회의록' AS t, count(*) FROM meetings;
SELECT '안건칸' AS t, column_name FROM information_schema.columns
 WHERE table_name = 'agenda_items' AND column_name = 'meeting_id';
