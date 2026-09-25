-- 048 — 카카오톡 «친구에게 보내기» (2026-09-25)
-- ============================================================
-- 047 은 「나에게 보내기」 — 받는 사람이 연결하면 그 사람의 「나와의 채팅」 으로 갔다.
-- 사용자 결정(2026-09-25): «이건호 카카오 계정에서 대표이사(친구)에게» 보낸다.
--   · 보내는 사람 = .env 의 KAKAO_SENDER (로그인 아이디)
--   · 받는 사람   = 대표이사 (테스트 서버는 KAKAO_TO_TEST)
--   · 둘이 같거나 KAKAO_SENDER 가 없으면 예전처럼 「나에게 보내기」
--
-- 🔑 친구 메시지는 받는 사람을 «카카오 사용자 번호 → 친구 목록의 uuid» 로 찾는다.
--    그래서 연결할 때 그 사람의 카카오 사용자 번호를 적어 둔다(kakao_user_id).
--    카카오 규칙상 «받는 사람도» 우리 앱에 한 번 연결(카카오 로그인)해야 친구 목록에 보인다.
-- 🔑 scopes — 그 연결이 어떤 동의를 받았나. 보내는 사람은 「친구 목록」(friends)이 있어야 한다.
--    없으면 화면이 「다시 연결」 을 권한다.
--
-- 표를 새로 만들지 않으므로 GRANT 는 다시 줄 필요가 없다.

ALTER TABLE kakao_links ADD COLUMN IF NOT EXISTS kakao_user_id BIGINT;
ALTER TABLE kakao_links ADD COLUMN IF NOT EXISTS scopes        TEXT;

COMMENT ON COLUMN kakao_links.kakao_user_id IS
  '카카오 사용자 번호(/v2/user/me 의 id). 친구 목록에서 받는 사람을 찾는 열쇠다.';
COMMENT ON COLUMN kakao_links.scopes IS
  '연결 때 받은 동의(카카오 토큰 응답의 scope, 공백 구분). friends 가 있어야 친구에게 보낼 수 있다.';

\echo '=== 더한 칸 ==='
SELECT column_name, data_type FROM information_schema.columns
 WHERE table_name = 'kakao_links' AND column_name IN ('kakao_user_id', 'scopes')
 ORDER BY 1;
