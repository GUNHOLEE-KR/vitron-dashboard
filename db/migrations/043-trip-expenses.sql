-- ============================================================
-- 043-trip-expenses.sql — 출장 경비(법인카드 사용 내역) (2026-09-24 지시)
--
--   ⚠ admin 계정으로 실행한다. 새 표를 만들었으면 앱 계정에 GRANT 하는 것을 잊지 말 것 —
--     안 하면 화면이 권한 오류로 «조용히 비어» 보인다.
--
--      scp db/migrations/043-trip-expenses.sql root@vitron-nas:/tmp/
--      ssh root@vitron-nas 'docker exec -i postgres psql -U admin \
--        -d vitron_dashboard -v ON_ERROR_STOP=1 -f /dev/stdin < /tmp/043-trip-expenses.sql'
--
-- 왜 새 표인가
--   실적(schedule_actuals)에는 하이패스·주유·이동 실비 세 칸뿐이다. 출장에서 쓴
--   식비·숙박비·접대비를 담을 자리가 없고, 무엇보다 «어느 프로젝트에 썼는가» 를
--   적을 축이 일정 쪽에는 아예 없다.
--
-- 🔴 월 정산(schedule_settlements)에는 «합치지 않는다» (사용자와 합의).
--    저것은 「회사에 입금 / 회사가 환급」이고 이것은 「이미 법인카드로 나간 돈」이라
--    성격이 다르다. 합치면 정산 금액이 틀어진다 — 이 표는 조회·집계 전용이다.
--
-- 🔑 승인 절차를 두지 않는다 (사용자 지시). 적으면 그대로 기록이다.
--    구매 요청(purchase_requests)과 다른 점이다 — 저것은 «사기 전» 결재이고
--    이것은 «이미 쓴 것» 의 기록이다.
-- ============================================================

CREATE TABLE IF NOT EXISTS trip_expenses (
  id            SERIAL PRIMARY KEY,

  -- 🔑 FK 는 걸지 않는다 — 이 저장소의 다른 표와 같은 규칙이다. 사람이 퇴사해
  --    목록에서 빠져도 «누가 얼마를 썼는가» 는 남아야 한다.
  worker_id     INTEGER NOT NULL,              -- workers.id (쓴 사람)
  spent_on      DATE    NOT NULL,              -- 쓴 날
  amount        INTEGER NOT NULL DEFAULT 0,    -- 원

  kind          VARCHAR(20) NOT NULL DEFAULT 'etc',
  merchant      VARCHAR(200),                  -- 가맹점
  pay_method    VARCHAR(20) NOT NULL DEFAULT 'corp_card',

  -- ── 프로젝트 ────────────────────────────────────────────
  -- 🔑 키와 «이름» 을 함께 담는다 (meeting_notes 와 같은 방식). Jira 동기화가
  --    제목을 바꿔도 지난 기록의 표시가 흔들리지 않고, Jira 에 없는 항목
  --    (고정업무 같은 MANUAL-…)도 적을 수 있다.
  -- ⚠ 프로젝트는 «선택» 이다 (사용자 결정) — 프로젝트에 매이지 않는 경비가 있다.
  -- ⚠ 화면 주의: 프로젝트 목록은 «완료된 것을 감춘다». 완료된 프로젝트로 적어 둔
  --   기록을 열면 고르개가 조용히 빈칸이 되고 저장하는 순간 날아간다 —
  --   안건·회의록에서 이미 두 번 겪은 함정이다. 고른 값은 목록에 남겨 둘 것.
  parent_key    VARCHAR(40),
  parent_text   VARCHAR(200),

  note          TEXT,

  -- ── 영수증 (선택) ───────────────────────────────────────
  -- 🔑 파일은 «DB 에» 담는다. 백엔드 컨테이너에는 볼륨이 없어 파일로 두면
  --    재배포할 때마다 사라진다(하이패스 원본과 같은 판단, 027 참고).
  -- 🔴 nginx 의 client_max_body_size 가 없으면 기본 «1MB» 라 휴대폰 사진이
  --    413 으로 잘린다. nginx.conf 를 함께 고쳐야 한다 — 하이패스 엑셀은
  --    16KB 라 여태 걸린 적이 없었을 뿐이다.
  receipt       BYTEA,
  receipt_name  VARCHAR(200),
  receipt_type  VARCHAR(100),                  -- image/jpeg 등
  receipt_size  INTEGER,

  created_by    INTEGER,                       -- kpi_users.id (누가 넣었나)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 종류를 «사유» 로 쓰지 않는다. 구체적인 것은 merchant·note 에 적는다 —
  -- 휴가 종류·차량 이력에서 정한 것과 같은 원칙이다.
  CONSTRAINT trip_expenses_kind_chk CHECK (kind IN
    ('meal',       -- 식비
     'lodging',    -- 숙박
     'transport',  -- 교통 (KTX·항공·택시 등)
     'fuel',       -- 주유·충전
     'entertain',  -- 접대
     'supply',     -- 소모품·자재
     'etc')),
  CONSTRAINT trip_expenses_pay_chk CHECK (pay_method IN
    ('corp_card',      -- 법인카드
     'personal_card',  -- 개인카드 (나중에 돌려받는 것)
     'cash')),
  -- 음수가 들어가면 누적이 조용히 줄어든다 (구매 요청과 같은 규칙)
  CONSTRAINT trip_expenses_amount_chk CHECK (amount >= 0),
  CONSTRAINT trip_expenses_receipt_chk CHECK (receipt_size IS NULL OR receipt_size >= 0)
);

COMMENT ON TABLE trip_expenses IS
  '출장 경비 — 법인카드 등으로 이미 쓴 돈의 기록. 승인 절차 없음. '
  '월 정산(schedule_settlements)과 «합치지 않는다» — 성격이 다르다.';
COMMENT ON COLUMN trip_expenses.parent_text IS
  'Jira 상위업무 이름. 키와 함께 담아 동기화로 제목이 바뀌어도 지난 표시가 흔들리지 않게 한다.';
COMMENT ON COLUMN trip_expenses.receipt IS
  '영수증 원본(선택). 컨테이너에 볼륨이 없어 파일로 두면 재배포마다 사라진다.';

-- 자주 뽑는 것 = 「이 달에 누가 얼마」 · 「이 프로젝트에 얼마」
CREATE INDEX IF NOT EXISTS idx_trip_expenses_date    ON trip_expenses (spent_on DESC);
CREATE INDEX IF NOT EXISTS idx_trip_expenses_worker  ON trip_expenses (worker_id, spent_on DESC);
CREATE INDEX IF NOT EXISTS idx_trip_expenses_project ON trip_expenses (parent_key, spent_on DESC)
  WHERE parent_key IS NOT NULL;

-- ── 앱 계정 권한 ─────────────────────────────────────────────
-- 🔴 빠뜨리면 화면이 «권한 오류로 조용히 비어» 보인다.
GRANT SELECT, INSERT, UPDATE, DELETE ON trip_expenses TO "vitron-dashboard";
GRANT USAGE, SELECT ON SEQUENCE trip_expenses_id_seq TO "vitron-dashboard";

-- ── 확인 ─────────────────────────────────────────────────────
\echo '=== 만들어진 칸 ==='
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_name = 'trip_expenses'
 ORDER BY ordinal_position;

\echo '=== 앱 계정 권한 ==='
SELECT string_agg(privilege_type, ',' ORDER BY privilege_type) AS grants
  FROM information_schema.table_privileges
 WHERE grantee = 'vitron-dashboard' AND table_name = 'trip_expenses';
