-- 039 — 법인차량 «동승» (2026-09-14)
-- ════════════════════════════════════════════════════════════
-- 한 대의 차로 둘 이상이 함께 가는 날을 적을 자리가 없었다. 서버·달력·배차표가 모두
-- 「같은 날 같은 차 = 겹침」 으로만 판정해, 함께 타려고 둘 다 등록하면 겹침 경고가 떴다
-- (운영 2026-09-16·17 윤인철·이건호 Model Y).
--
-- 🔑 carpool_group — 함께 타는 계획들이 «같은 값» 을 갖는다. 값은 처음 잡은 계획의 번호다.
--    묶음의 «대표»(차량 거리·하이패스가 붙는 사람)는 살아 있는 구성원 중 번호가 가장
--    작은 계획이다 — 먼저 예약한 사람 (사용자 결정).
--    FK 를 두지 않는다. 대표 일정을 지워도 묶음은 남고 다음 사람이 대표가 된다.
-- ⚠ 날짜나 차량이 바뀐 계획은 서버가 묶음에서 뺀다 — 같은 차가 아니면 동승이 아니다.

ALTER TABLE schedule_plans ADD COLUMN IF NOT EXISTS carpool_group INT;

CREATE INDEX IF NOT EXISTS idx_schedule_plans_carpool
    ON schedule_plans (carpool_group) WHERE carpool_group IS NOT NULL;

-- 운영에 이미 들어간 두 날을 묶는다 (사용자 결정 — 먼저 등록한 윤인철이 대표).
-- 🔑 번호만 믿지 않는다. 날짜·차량이 같고 사람이 맞을 때만 묶는다 — 테스트 DB 에서는
--    같은 번호가 다른 일정일 수 있어 아무 일도 일어나지 않아야 한다.
UPDATE schedule_plans p
   SET carpool_group = g.anchor
  FROM (VALUES (272, 278), (273, 279)) AS g(anchor, rider)
 WHERE p.id IN (g.anchor, g.rider)
   AND EXISTS (
         SELECT 1
           FROM schedule_plans a
           JOIN schedule_plans r ON r.id = g.rider
           JOIN workers wa ON wa.id = a.worker_id
           JOIN workers wr ON wr.id = r.worker_id
          WHERE a.id = g.anchor
            AND a.plan_date  = r.plan_date
            AND a.vehicle_id = r.vehicle_id
            AND wa.name = '윤인철'
            AND wr.name = '이건호');
