-- ============================================================
-- 047-kakao-expense.sql — 경비를 카카오톡으로 «골라서» 보내기 (2026-09-25 지시)
--
--   ⚠ admin 계정으로 실행한다. 새 표(kakao_links)는 앱 계정에 GRANT 한다.
--
--      scp db/migrations/047-kakao-expense.sql root@vitron-nas:/tmp/
--      ssh root@vitron-nas 'docker exec -i postgres psql -U admin \
--        -d vitron_dashboard -v ON_ERROR_STOP=1 -f /dev/stdin < /tmp/047-kakao-expense.sql'
--
-- 무엇
--   무료 카카오 「나에게 보내기」 — 받을 사람이 자기 카카오 계정을 «한 번 연결» 해 두면
--   서버가 그 사람의 「나와의 채팅」 으로 보낸다(사용자 선택 — 알림톡은 유료·사전 심사).
--   받는 사람 = 대표이사 (테스트 서버는 KAKAO_TO_TEST 에 적은 사람 — 사용자 지시).
--
-- 🔑 보내는 때 (사용자 지시): 경비를 등록·수정·삭제할 때 «보내지 않는다».
--    「미전송」 목록에서 체크한 것만 [보내기] 로 보낸다.
-- ============================================================

-- ── 연결 정보 — 사람마다 한 줄 ──────────────────────────────
-- 🔑 토큰은 «봉해서» 담는다 (mailcred.seal — MAIL_CRED_KEY). DB 만 새어도 풀리지 않는다.
--    열쇠는 메일 발송 계정과 같은 것을 쓴다 — 두 벌이면 한쪽만 바뀌어 어긋난다.
-- 🔑 refresh 토큰은 약 두 달이면 끝난다. 서버가 «하루 한 번» 갱신해 두어 끊기지 않게 하고,
--    끝내 끊기면 last_error 에 남겨 화면이 붉게 알린다 — 조용히 멈추면 아무도 모른다.
CREATE TABLE IF NOT EXISTS kakao_links (
  user_id            INTEGER PRIMARY KEY,        -- kpi_users.id (연결한 사람 = 받는 사람)
  access_token       TEXT NOT NULL,              -- 봉한 값
  access_expires_at  TIMESTAMPTZ NOT NULL,
  refresh_token      TEXT NOT NULL,              -- 봉한 값
  refresh_expires_at TIMESTAMPTZ,
  connected_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  refreshed_at       TIMESTAMPTZ,
  last_ok_at         TIMESTAMPTZ,                -- 마지막으로 보내기에 성공한 때
  last_error         TEXT,                       -- 마지막 실패 사유 (성공하면 비운다)
  last_error_at      TIMESTAMPTZ
);

COMMENT ON TABLE kakao_links IS
  '카카오 「나에게 보내기」 연결. 토큰은 mailcred 로 봉해 담는다. 연결한 사람이 곧 받는 사람이다.';

-- ── 경비: 언제 보냈나 ───────────────────────────────────────
-- 🔑 「보냈나」 가 아니라 «언제» 를 적는다. 보낸 뒤 고치면 updated_at > kakao_sent_at 이 되어
--    「수정됨」 으로 미전송 목록에 다시 올라온다 — 대표이사가 고치기 전 금액만 알고 있으면 안 된다.
-- ⚠ 보낼 때는 updated_at 을 «건드리지 않는다». 건드리면 보낸 순간 「수정됨」 이 된다.
ALTER TABLE trip_expenses ADD COLUMN IF NOT EXISTS kakao_sent_at TIMESTAMPTZ;
ALTER TABLE trip_expenses ADD COLUMN IF NOT EXISTS kakao_sent_by INTEGER;   -- kpi_users.id

COMMENT ON COLUMN trip_expenses.kakao_sent_at IS
  '카카오톡으로 보낸 때. NULL = 미전송, updated_at 이 더 늦으면 「보낸 뒤 수정됨」.';

-- ── 앱 계정 권한 ─────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON kakao_links TO "vitron-dashboard";

-- ── 확인 ─────────────────────────────────────────────────────
\echo '=== 표 · 칸 ==='
SELECT table_name, column_name FROM information_schema.columns
 WHERE (table_name = 'kakao_links' AND column_name IN ('user_id', 'refresh_token', 'last_error'))
    OR (table_name = 'trip_expenses' AND column_name IN ('kakao_sent_at', 'kakao_sent_by'))
 ORDER BY 1, 2;
\echo '=== 앱 계정 권한 ==='
SELECT string_agg(privilege_type, ',' ORDER BY privilege_type) AS grants
  FROM information_schema.table_privileges
 WHERE grantee = 'vitron-dashboard' AND table_name = 'kakao_links';
