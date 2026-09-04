-- 025 하이패스 사용내역 (2026-09-04 지시)
--
-- 하이패스는 조회 API 가 없다. 그래서 «엑셀을 내려받아 올리는» 방식으로 간다.
--   법인차량  대표이사 또는 권한 받은 직원이 «한 번» 올리면 전 직원이 그 자료에서
--             자기가 다녀온 건만 골라 쓴다 (법인카드 명세라 각자 받을 수 없다)
--   자차      본인이 자기 것을 올린다 (개인 카드라 본인만 받을 수 있다)
--
-- ⚠ admin 계정으로 실행한다. 앱 계정은 테이블 소유자가 아니라 ALTER 가 거부된다.
--   docker exec -i postgres psql -U admin -d <DB> -f 025-hipass-tolls.sql

-- ── ① 차량에 하이패스 카드번호 ───────────────────────────────
-- 🔴 내려받은 파일 «어디에도» 어느 차인지가 없다. 번호판 칸이 없고 「카드별명」은
--    비어 있다. 있는 것은 마스킹된 카드번호(0140-****-**68-0799)뿐이라, 그것을
--    차량에 붙여 두고 대조한다. 등록돼 있지 않으면 올릴 때 차량을 고르게 한다.
ALTER TABLE schedule_vehicles
  ADD COLUMN IF NOT EXISTS hipass_card VARCHAR(30);

COMMENT ON COLUMN schedule_vehicles.hipass_card IS
  '하이패스 카드번호. 마스킹된 그대로 넣어 둔다(0140-****-**68-0799). '
  '내려받은 엑셀에 차량 표시가 없어, 이 값으로 «어느 차인지» 를 가린다.';

-- ── ② 통행 내역 ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hipass_tolls (
  id           SERIAL PRIMARY KEY,
  vehicle_id   INTEGER NOT NULL,            -- schedule_vehicles.id
  used_at      TIMESTAMPTZ NOT NULL,        -- 거래일시 (매칭 기준)
  entry_at     TIMESTAMPTZ,                 -- 입구일시
  exit_at      TIMESTAMPTZ,                 -- 출구일시
  gate_in      VARCHAR(60),                 -- 입구 (발안)
  gate_out     VARCHAR(60),                 -- 출구 (매송)
  amount       INTEGER NOT NULL DEFAULT 0,  -- 청구금액(원)
  card_no      VARCHAR(40),
  note         VARCHAR(120),                -- 비고 (…정상 / …할증 / …출퇴근할인)

  -- 어느 실적에 붙였나. NULL 이면 «아직 아무도 가져가지 않은» 통행이다.
  -- 🔑 같은 날 같은 차를 둘이 썼을 수 있어 «사람이 골라» 붙인다(지시).
  actual_id    INTEGER,
  claimed_by   INTEGER,                     -- kpi_users.id
  claimed_at   TIMESTAMPTZ,

  manual       BOOLEAN NOT NULL DEFAULT FALSE,  -- 손으로 넣은 것(자동으로 못 잡는 건)
  source_file  VARCHAR(200),
  uploaded_by  INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 🔑 같은 파일을 두 번 올려도 겹치지 않게 한다.
--    ⚠ 파일의 «번호» 칸은 열쇠로 쓸 수 없다 — 내려받을 때마다 1부터 다시 매겨진다
--      (사용자 지적: 「파일이름이나 정렬 방식은 다운로드 받을 때마다 달라서」).
--      한 통행을 실제로 가리키는 것은 차량 + 거래일시 + 입구 + 출구 + 금액이다.
--    ⚠ 손으로 넣은 것은 뺀다 — 시각을 정확히 모른 채 적을 수 있어, 막으면 오히려
--      「같은 구간을 두 번 지난 날」 을 넣지 못한다.
CREATE UNIQUE INDEX IF NOT EXISTS idx_hipass_dedup
  ON hipass_tolls (vehicle_id, used_at, coalesce(gate_in, ''), coalesce(gate_out, ''), amount)
  WHERE NOT manual;

CREATE INDEX IF NOT EXISTS idx_hipass_vehicle_date ON hipass_tolls (vehicle_id, used_at);
CREATE INDEX IF NOT EXISTS idx_hipass_actual       ON hipass_tolls (actual_id);

COMMENT ON TABLE hipass_tolls IS
  '하이패스 통행 내역. 엑셀에서 읽어 쌓아 두고, 작업자가 자기 실적에 골라 붙인다.';

-- ── ③ 자차 업무 하이패스를 정산에 담을 자리 ──────────────────
-- 🔴 지금까지 «개인 사용» 의 하이패스만 청구에 더하고 있었다.
--    자차로 업무를 다녀온 하이패스는 어디에도 반영되지 않아, 직원이 자기 돈으로 낸
--    통행료를 돌려받을 길이 없었다 (2026-09-04 확인).
--    사용자 결정 — «자차 업무 하이패스는 전액 회사 청구»(회사 → 직원).
ALTER TABLE schedule_settlements
  ADD COLUMN IF NOT EXISTS own_toll_amount INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN schedule_settlements.own_toll_amount IS
  '자차로 업무 다녀온 하이패스. 회사가 직원에게 전액 돌려준다(대중교통 실비와 같은 성격).';
COMMENT ON COLUMN schedule_settlements.toll_amount IS
  '개인 사용 하이패스. 직원이 회사에 입금하는 쪽이다 — own_toll_amount 와 방향이 반대다.';

-- ── ④ 앱 계정 권한 ───────────────────────────────────────────
-- ⚠ 새 표를 만들었으면 반드시 준다. 안 하면 화면이 권한 오류로 조용히 비어 보인다.
GRANT SELECT, INSERT, UPDATE, DELETE ON hipass_tolls TO "vitron-dashboard";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "vitron-dashboard";

-- ── 확인 ─────────────────────────────────────────────────────
SELECT '표'   AS t, count(*) AS rows FROM hipass_tolls;
SELECT '칸'   AS t, column_name FROM information_schema.columns
 WHERE table_name = 'schedule_vehicles' AND column_name = 'hipass_card';
SELECT '정산' AS t, column_name FROM information_schema.columns
 WHERE table_name = 'schedule_settlements' AND column_name = 'own_toll_amount';
