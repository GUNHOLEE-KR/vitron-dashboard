-- 023 본인 계정 발송이 실패한 사실을 남긴다 (2026-08-29)
--
-- 「각자 자신의 메일로 먼저 시도해 보고, 발송이 안 되면 앱 비밀번호 등록이 잘못됐다고
--   알려서 바로잡도록 권고한다」 지시.
--
-- 🔴 왜 필요한가
--    앱 비밀번호는 메일 쪽에서 바꾸거나 회수되면 «그때부터 조용히» 막힌다.
--    서버 로그에만 남기면 그 사람의 보고만 계속 실패하는데 아무도 모른다 —
--    나중에 KPI 에서 「보고 누락」으로 잡히고서야 드러난다.
--    그러니 실패한 사실을 사람에게 되돌려 주어야 한다.
--
-- 🔑 실패해도 «메일을 버리지 않는다». 본인 계정이 막히면 회사 공용 계정으로 다시
--    보내 보고서가 사라지지 않게 한다. 대신 이 칸에 자국을 남겨 화면이 띠를 띄운다.
--    ⚠ 예전 주석에는 「실패해도 공용으로 몰래 보내지 않는다」고 적어 두었는데,
--      그 걱정(누구 일인지 모르게 된다)은 공용 발송이 «표시 이름과 답장 주소를
--      본인으로» 두므로 실제로는 생기지 않는다. 반대로 보고가 사라지는 손해는 크다.
--      «몰래» 가 문제였으므로 «알리고» 보낸다.
--
-- ⚠ 성공하면 두 칸을 비운다. 안 비우면 고친 뒤에도 띠가 계속 떠서, 사람이 띠를
--   무시하는 법을 배우게 된다.

ALTER TABLE mail_senders ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE mail_senders ADD COLUMN IF NOT EXISTS failed_at  TIMESTAMPTZ;

COMMENT ON COLUMN mail_senders.last_error IS
  '본인 계정으로 보내다 실패한 마지막 사유. 성공하면 비운다.';
COMMENT ON COLUMN mail_senders.failed_at IS
  '그 실패가 언제였나. 화면 배너가 이 값을 보여 준다.';

SELECT '발송 실패 표시가 있는 사람' AS t, count(*) FROM mail_senders WHERE last_error IS NOT NULL;
