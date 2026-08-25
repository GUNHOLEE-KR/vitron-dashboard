-- 작업 완료 보고 — 보냈는가 · 안 보냈으면 왜 (2026-08-26)
--
-- 왜 기록하는가
--   완료 보고는 «당일에 처리한 것만» 보낸다(2026-08-26 사용자 결정).
--   그러면 당일에 처리하지 않은 건은 보고가 안 나가는데, 그 사실이 어디에도
--   남지 않으면 「보고가 없었다」와 「일을 안 했다」를 구분할 수 없다.
--   그래서 «누락» 을 데이터로 남긴다 — 나중에 KPI 가 이것을 센다.
--
-- 🔑 「안 보냄」의 이유를 갈라 둔다. 사람 잘못(늦게 입력)과 시스템 잘못(메일 실패)을
--    한 칸에 뭉치면, 메일 서버가 죽은 날의 건이 전부 개인 감점으로 넘어간다.
--
-- ⚠ 출장처럼 늦게 복귀해 늦어진 것은 감점 대상이 아니다(사용자 방침).
--    그 판정은 KPI 쪽에서 transport·use_type 을 보고 하므로 여기서는 «사실만» 적는다.

ALTER TABLE schedule_actuals
  ADD COLUMN IF NOT EXISTS reported_at  TIMESTAMPTZ,      -- 보고 메일을 보낸 시각. NULL = 안 보냄
  ADD COLUMN IF NOT EXISTS report_skip  VARCHAR(20);      -- 안 보낸 이유

COMMENT ON COLUMN schedule_actuals.reported_at IS
  '작업 완료 보고 메일을 실제로 보낸 시각. NULL 이면 report_skip 을 본다.';
COMMENT ON COLUMN schedule_actuals.report_skip IS
  'late = 작업일 당일이 아니어서 안 보냄(누락) · failed = 메일 발송 실패 · mail_off = 메일 설정 없음';

-- ⚠ 값을 채우지 않는다. 이 칸이 생기기 «전» 의 실적은 보고 제도가 없던 때의 것이라
--   누락으로도 발송으로도 볼 수 없다. NULL/NULL 이 「해당 없음」 이라는 뜻이다.
--   KPI 가 셀 때는 created_at 이 이 마이그레이션 이후인 것만 세야 한다.

ALTER TABLE schedule_actuals
  DROP CONSTRAINT IF EXISTS schedule_actuals_report_skip_chk;
ALTER TABLE schedule_actuals
  ADD CONSTRAINT schedule_actuals_report_skip_chk
  CHECK (report_skip IS NULL OR report_skip IN ('late', 'failed', 'mail_off'));

-- 누락 집계는 「그날 것인가」를 자주 물으므로 색인을 둔다
CREATE INDEX IF NOT EXISTS idx_actuals_report_skip
  ON schedule_actuals (report_skip) WHERE report_skip IS NOT NULL;
