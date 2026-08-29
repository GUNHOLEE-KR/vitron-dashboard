-- 021 사람마다 자기 주소로 메일을 보낸다 (2026-08-29)
--
-- 「보내는 사람 메일주소를 각자 작업자 메일 주소로」 지시.
--
-- 🔑 왜 앱 비밀번호를 «받아서 보관» 하는가
--    다음(카카오) 스마트워크는 로그인한 계정이 «가진» 주소만 From 에 허용한다.
--    실측(2026-08-25): 남의 주소를 From 에 넣으면 본문을 보내는 순간
--      550 5.7.0 no permitted from-header address
--    로 끊긴다. 계정에 다른 주소를 별칭으로 붙이는 기능도 없음을 확인했다(2026-08-29).
--    그러니 «각자 자기 계정으로 접속해서 보내는» 길밖에 없고, 그러려면 각자의
--    SMTP 앱 비밀번호가 필요하다.
--
-- 🔑 왜 서버에 두는가 (2026-08-29 사용자 결정)
--    이 앱은 사내망 http 다(nginx listen 80, 쿠키에 Secure 를 못 붙인다).
--    그래서 브라우저→서버로 보내는 값은 평문으로 흐른다. 그렇다면
--      · 서버 보관   = 등록할 때 «한 번» 만 흐른다
--      · 매번 입력   = 완료 처리할 때마다 흐른다
--      · PC 에 저장  = 매번 흐르는 데다 여덟 대에 «평문» 으로 남는다
--    서버에 두는 쪽이 노출이 가장 적다. 게다가 서버는 이미 MAIL_PASS 로
--    앱 비밀번호를 «평문» 으로 하나 갖고 있다 — 이번에는 암호화해서 넣는다.
--
-- ⚠ secret 은 AES-256-GCM 결과다. 열쇠는 DB 가 아니라 .env 의 MAIL_CRED_KEY 에 있다.
--   DB 만 새어 나가도 풀리지 않는다. 반대로 «열쇠를 잃으면 전원이 다시 등록» 해야 한다.
--
-- ⚠ user_id 는 kpi_users.id 다. 외래키를 걸지 않는 이유는 그 표를 KPI 와 함께 쓰기
--   때문이다 — 이쪽에서 건 제약이 저쪽의 계정 삭제를 막으면 안 된다.
--   계정이 지워지면 여기 줄만 남는데, 로그인할 수 없으니 쓰이지 않는다.

CREATE TABLE IF NOT EXISTS mail_senders (
  user_id    INTEGER PRIMARY KEY,          -- kpi_users.id
  smtp_user  VARCHAR(100) NOT NULL,        -- 접속 «아이디». 주소가 아니다 (예: gunholee76)
  secret     TEXT         NOT NULL,        -- AES-256-GCM — iv:tag:암호문 (모두 hex)
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE mail_senders IS
  '사람마다의 SMTP 접속 정보. 이 사람이 한 일은 이 계정으로 «본인 주소에서» 보낸다.';
COMMENT ON COLUMN mail_senders.smtp_user IS
  '다음 접속 아이디. 메일 주소와 다르다 — 주소는 kpi_users.login_id 를 쓴다.';
COMMENT ON COLUMN mail_senders.secret IS
  'AES-256-GCM 으로 봉한 앱 비밀번호. 열쇠는 .env 의 MAIL_CRED_KEY 다.';

-- 앱 계정은 표 주인이 아니므로 권한을 따로 준다 (003 마이그레이션과 같은 방식).
GRANT SELECT, INSERT, UPDATE, DELETE ON mail_senders TO "vitron-dashboard";

SELECT '등록된 발송 계정' AS t, count(*) FROM mail_senders;
