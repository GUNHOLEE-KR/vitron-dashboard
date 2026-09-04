-- 024 정산을 «두 단계» 로 나눈다 (2026-09-04 지시)
--
--   1차  대표이사가 각 직원에게 «정산 금액을 알리는» 메일을 보낸다
--   2차  직원이 입금할 금액이 있으면 «입금을 확인» 하고 완료한다
--
-- 왜 나누는가 —
--   종전에는 [확정] 하나로 「금액 박제 + 실적 잠금」이 한꺼번에 끝났다. 그런데 실제
--   업무는 «알린다» 와 «받았다» 가 다른 시점이고, 그 사이에 직원이 금액을 확인하고
--   입금하는 시간이 있다. 한 단계로 두면 「알렸는데 아직 안 들어온 사람」 을 화면에서
--   구분할 수 없다.
--
-- 🔑 실적 잠금은 «1차» 에서 건다 (사용자 결정).
--    금액을 이미 알렸는데 그 근거(실적)가 바뀌면 안 되기 때문이다.
--    다만 뒤늦게 하이패스 추가 건이 올라오는 일이 있어, «대표이사는» 잠금 해제 없이
--    바로 고칠 수 있게 한다(서버에서 판정 — 이 마이그레이션의 몫은 아니다).
--    2차(완료) 뒤에는 종전대로 잠금 해제를 거쳐야 한다.
--
-- ⚠ admin 계정으로 실행한다. 앱 계정(vitron-dashboard)은 테이블 소유자가 아니라
--   ALTER TABLE 이 거부된다.
--   NAS 에서 :  docker exec -i postgres psql -U admin -d <DB> -f 024-settlement-two-stage.sql
--
-- ⚠ 되돌리기 — 아래 세 줄이면 원래대로 돌아간다(자료는 그대로 남는다).
--     UPDATE schedule_settlements SET status='open' WHERE status='notified';
--     ALTER TABLE schedule_settlements DROP CONSTRAINT schedule_settlements_status_chk;
--     ALTER TABLE schedule_settlements ADD  CONSTRAINT schedule_settlements_status_chk
--       CHECK (status IN ('open','settled'));

-- ── 1차 발송 자취 ────────────────────────────────────────────
-- 🔑 «입금 확인» 시각은 새로 파지 않고 기존 settled_at 을 그대로 쓴다.
--    2차가 곧 완료이므로 칸을 하나 더 두면 둘이 언젠가 어긋난다.
ALTER TABLE schedule_settlements
  ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notified_by INTEGER;      -- kpi_users.id (보낸 사람)

COMMENT ON COLUMN schedule_settlements.notified_at IS
  '1차 — 정산 금액을 직원에게 메일로 알린 시각. 이때 금액이 박제되고 실적이 잠긴다.';
COMMENT ON COLUMN schedule_settlements.notified_by IS
  '1차를 보낸 사람(kpi_users.id). 대표이사 계정으로 나간다.';
COMMENT ON COLUMN schedule_settlements.settled_at IS
  '2차 — 입금까지 확인해 «완료» 로 넘긴 시각. 입금할 금액이 없으면 1차에서 바로 여기까지 온다.';

-- ── 상태에 notified 를 더한다 ────────────────────────────────
-- open(아직) → notified(알림 보냄·입금 대기) → settled(완료)
ALTER TABLE schedule_settlements
  DROP CONSTRAINT IF EXISTS schedule_settlements_status_chk;
ALTER TABLE schedule_settlements
  ADD CONSTRAINT schedule_settlements_status_chk
  CHECK (status IN ('open', 'notified', 'settled'));

COMMENT ON COLUMN schedule_settlements.status IS
  'open 아직 / notified 1차 안내를 보내고 입금 대기 / settled 완료';

-- ── 확인 ─────────────────────────────────────────────────────
-- 지금 있는 자료는 손대지 않는다. 이미 settled 인 것은 그대로 완료로 둔다
-- (예전에 확정한 달을 「입금 확인 안 됨」 으로 되돌리면 안 된다).
SELECT '상태' AS t, status, count(*) FROM schedule_settlements GROUP BY status ORDER BY status;
SELECT '칸'   AS t, column_name FROM information_schema.columns
 WHERE table_name = 'schedule_settlements'
   AND column_name IN ('notified_at', 'notified_by', 'settled_at', 'status')
 ORDER BY column_name;
