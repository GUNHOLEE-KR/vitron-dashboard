-- 029 주 사용자가 «개인 카드» 로 내는 하이패스 (2026-09-05 지시)
--
-- 법인차량인데 하이패스만 «주 사용자 개인 카드» 로 달려 있는 차가 있다.
--   24구 7598 카니발 — 윤기곤
--   129누 9183 QM6  — 이건호
-- 이 차의 통행료는 회사 카드가 아니라 «그 사람 주머니» 에서 나간다. 그런데 지금까지
-- 법인차량 업무 통행료는 정산 어디에도 담기지 않아, 낸 사람이 돌려받을 길이 없었다.
--
-- 🔑 규칙 (사용자 결정) — 돈이 «두 갈래» 로 흐른다.
--    ① 회사 → 주 사용자 : 그 차의 통행 가운데 «실적에 붙은» 것 전부를 지급한다.
--       업무든, 남이 개인 사용한 것이든 상관없다 — 어차피 그 사람 카드로 나갔다.
--    ② 사용 직원 → 회사 : 개인 사용분은 지금까지처럼 그 직원이 회사에 입금한다.
--       (주 사용자는 자기 차를 「차량 개인 사용」 으로 신청하지 않으므로 자기에게
--        청구되는 일은 없다.)
--    주 사용자가 평소 출퇴근·개인 용도로 지난 통행은 «실적에 붙지 않으므로» 지급되지
--    않는다. 정산 화면의 낱건 표에서 골라 지울 수도 있다.
--
-- ⚠ admin 계정으로 실행한다. 앱 계정은 테이블 소유자가 아니라 ALTER 가 거부된다.
--   docker exec -i postgres psql -U admin -d <DB> -f 029-hipass-personal-card.sql

-- ── ① 차량에 「하이패스 개인카드」 표시 ──────────────────────
ALTER TABLE schedule_vehicles
  ADD COLUMN IF NOT EXISTS hipass_personal_card BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN schedule_vehicles.hipass_personal_card IS
  '하이패스를 주 사용자(assigned_worker_id)의 개인 카드로 낸다. '
  '켜면 이 차의 통행료를 회사가 그 사람에게 지급한다. '
  '주 사용자가 없으면 켤 수 없다 — 줄 사람이 없다.';

-- 🔑 줄 사람이 없는데 「지급」이 켜져 있으면 그 돈은 갈 곳을 잃는다.
--    화면과 서버에서도 막지만, 마지막 빗장은 DB 에 둔다.
ALTER TABLE schedule_vehicles
  DROP CONSTRAINT IF EXISTS schedule_vehicles_hipass_card_owner_chk;
ALTER TABLE schedule_vehicles
  ADD CONSTRAINT schedule_vehicles_hipass_card_owner_chk
  CHECK (NOT hipass_personal_card OR assigned_worker_id IS NOT NULL);

-- 현재 해당 차량 (2026-09-05 사용자 지정)
UPDATE schedule_vehicles SET hipass_personal_card = TRUE
 WHERE plate IN ('24구 7598', '129누 9183') AND assigned_worker_id IS NOT NULL;

-- ── ② 정산에 「대납 지급」 자리 ───────────────────────────────
-- 1차 안내에서 금액을 박제하므로 이 값도 함께 남겨야 한다.
ALTER TABLE schedule_settlements
  ADD COLUMN IF NOT EXISTS card_toll_amount INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN schedule_settlements.card_toll_amount IS
  '주 사용자가 개인 카드로 대신 낸 하이패스. 회사가 그 사람에게 지급한다 '
  '(자차 하이패스 환급과 같은 방향 — 회사 → 직원).';

-- ── 확인 ─────────────────────────────────────────────────────
SELECT '차량' AS t, name, plate, assigned_worker_id, hipass_personal_card
  FROM schedule_vehicles WHERE hipass_personal_card;
SELECT '정산' AS t, column_name FROM information_schema.columns
 WHERE table_name = 'schedule_settlements' AND column_name = 'card_toll_amount';
