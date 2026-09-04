-- 027 하이패스 «올린 파일» 을 근거 자료로 보관한다 (2026-09-04 지시)
--
-- 여태는 파일을 읽어 통행만 남기고 «파일 자체는 버렸다». 그래서 나중에
-- 「이 금액의 근거가 무엇이냐」 를 물으면 내놓을 것이 없었다.
--
-- 🔑 파일은 «DB 에» 담는다. 백엔드 컨테이너에는 볼륨이 없어 파일로 두면
--    재배포할 때마다 사라진다. DB 에 두면 NAS 의 DB 백업에 함께 들어간다.
--    크기도 문제가 아니다 — 파일 하나 16KB, 차량 5대 × 12개월이면 연 1MB 남짓.
--
-- 이 표가 생기면 근거가 끝까지 이어진다:
--   정산 금액 → 그 사람 실적의 하이패스 → 붙은 통행 낱건 → 올린 파일 → 원본 엑셀
--
-- ⚠ admin 계정으로 실행한다.
--   docker exec -i postgres psql -U admin -d <DB> -f 027-hipass-uploads.sql

CREATE TABLE IF NOT EXISTS hipass_uploads (
  id            SERIAL PRIMARY KEY,
  vehicle_id    INTEGER NOT NULL,
  filename      VARCHAR(200),
  -- 원본 그대로. ⚠ 확장자가 `.xls` 여도 속은 xlsx 라 내려줄 때 그 사실을 알아야 한다.
  content       BYTEA NOT NULL,
  byte_size     INTEGER NOT NULL DEFAULT 0,
  -- 파일 머리말의 「사용기간 : 20260705 ~ 20260904」 를 읽어 둔다.
  -- 🔑 화면이 「무엇을 올렸는지」 를 파일 이름이 아니라 «기간» 으로 말할 수 있어야 한다.
  --    이름은 내려받을 때마다 (1)(2) 가 붙어 근거가 되지 못한다.
  period_from   DATE,
  period_to     DATE,
  rows_parsed   INTEGER NOT NULL DEFAULT 0,
  rows_inserted INTEGER NOT NULL DEFAULT 0,
  amount_total  INTEGER NOT NULL DEFAULT 0,
  uploaded_by   INTEGER,                    -- kpi_users.id
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hipass_uploads_vehicle ON hipass_uploads (vehicle_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_hipass_uploads_period  ON hipass_uploads (period_from, period_to);

COMMENT ON TABLE hipass_uploads IS
  '하이패스 명세 원본. 근거 자료로 남긴다 — 지우는 것은 사람이 손으로만 한다(자동 삭제 없음).';
COMMENT ON COLUMN hipass_uploads.content IS
  '올린 파일 그대로. 확장자가 .xls 여도 속은 xlsx(ZIP)인 경우가 있다.';

-- 통행이 «어느 파일에서 왔는지» — 이것이 있어야 근거가 이어진다.
-- ⚠ 손으로 넣은 것(manual)은 파일이 없으므로 NULL 이다.
ALTER TABLE hipass_tolls
  ADD COLUMN IF NOT EXISTS upload_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_hipass_tolls_upload ON hipass_tolls (upload_id);

COMMENT ON COLUMN hipass_tolls.upload_id IS
  '이 통행이 담겨 있던 hipass_uploads.id. 손으로 넣은 건은 NULL.';

-- ── 앱 계정 권한 ─────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON hipass_uploads TO "vitron-dashboard";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "vitron-dashboard";

-- ── 확인 ─────────────────────────────────────────────────────
SELECT '올린 파일' AS t, count(*) FROM hipass_uploads;
SELECT '통행 칸'   AS t, column_name FROM information_schema.columns
 WHERE table_name = 'hipass_tolls' AND column_name = 'upload_id';
