-- 022 공용 메일 계정을 화면에서 고친다 (2026-08-29)
--
-- 「입력 및 수정 버튼을 만들어서 사용자가 등록할 수 있게」 지시.
--
-- 🔴 왜 필요해졌는가 — 2026-08-29 저녁에 다음 SMTP 가 갑자기 535 로 막혔다.
--    개발 PC 와 NAS 운영 «양쪽» 이 같은 값으로 동시에 거부됐다. 앱 비밀번호를 다시
--    받아야 하는데, 그러려면 `.env` 를 «네 곳» 손으로 고쳐야 했다 —
--    개발 PC · NAS 운영 · NAS 테스트 · (신설될) 의견 접수.
--    한 곳만 빠뜨리면 그쪽 메일만 조용히 안 가고 아무도 모른다.
--
-- 🔑 왜 .env 가 아니라 DB 인가
--    · `.env` 는 컨테이너가 «켜질 때» 한 번 읽는다. 화면에서 고칠 길이 없고,
--      고쳐도 컨테이너를 다시 만들어야 반영된다
--    · DB 에 두면 저장하는 즉시 반영되고, 같은 DB 를 보는 모든 서비스가 함께 쓴다
--    ⚠ `.env` 는 «지우지 않는다». DB 가 비어 있으면 지금처럼 그쪽으로 떨어진다 —
--      비상용이자, 이 표를 만들기 전 상태와의 호환이다.
--
-- ⚠ 비밀번호는 mail_senders 와 «같은 방식» 으로 봉한다 (AES-256-GCM,
--   열쇠는 .env 의 MAIL_CRED_KEY). 방식을 둘로 두면 한쪽만 고치게 된다.
--
-- ⚠ 한 줄짜리 표다. id 를 1 로 못 박고 CHECK 로 막는다 —
--   두 줄이 되면 「어느 것이 진짜인가」를 아무도 알 수 없다.

CREATE TABLE IF NOT EXISTS mail_account (
  id         INTEGER PRIMARY KEY DEFAULT 1,
  smtp_user  VARCHAR(100) NOT NULL,       -- 접속 아이디 (주소가 아니다)
  secret     TEXT         NOT NULL,       -- AES-256-GCM — iv:tag:암호문
  from_addr  VARCHAR(100) NOT NULL,       -- 메일에 찍히는 보내는 주소
  updated_by INTEGER,                     -- kpi_users.id — 누가 마지막으로 고쳤나
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT mail_account_one_row CHECK (id = 1)
);

COMMENT ON TABLE mail_account IS
  '회사 공용 메일 계정. 여기 값이 있으면 .env 의 MAIL_* 보다 «먼저» 쓰인다.';
COMMENT ON COLUMN mail_account.secret IS
  'AES-256-GCM 으로 봉한 앱 비밀번호. 열쇠는 .env 의 MAIL_CRED_KEY 다.';
COMMENT ON COLUMN mail_account.updated_by IS
  '마지막으로 고친 사람. 메일이 멈췄을 때 「누가 언제 바꿨나」를 물을 수 있어야 한다.';

-- 앱 계정은 표 주인이 아니므로 권한을 따로 준다.
GRANT SELECT, INSERT, UPDATE, DELETE ON mail_account TO "vitron-dashboard";

SELECT '공용 메일 계정' AS t, count(*) FROM mail_account;
