-- 011. 차량에 «전용 사용자» 를 둔다 (2026-08-25)
-- ============================================================
-- 상용(전용 배정) 차량이 있다. 늘 같은 사람이 타는 차라서 배차를 다툴 일이 없고,
-- 그 사람이 그 차를 잡았다는 사실은 대표이사에게 알릴 것이 못 된다.
--   이건호  → QM6 (129누 9183)
--   윤기곤  → 카니발 (24구 7598)
--
-- 🔑 이것을 코드에 박지 않고 칸으로 둔 이유 = 배정은 «바뀐다».
--    사람이 나가거나 차를 바꾸면 그때마다 배포해야 한다면 결국 낡은 채로 남는다.
--    [설정] 탭 차량 관리에서 고를 수 있게 한다.
--
-- ⚠ owner_worker_id(자차 소유자) 와 다른 값이다.
--    owner  = 「그 사람의 «개인» 차」 — 정산에서 연비로 환급한다
--    assigned = 「회사 차인데 그 사람 «전용»」 — 소유는 회사, 알림만 뺀다
--
-- ⚠ admin 계정으로 실행할 것 (앱 계정은 테이블 소유자가 아니라 ALTER 가 거부된다)

ALTER TABLE schedule_vehicles
  ADD COLUMN IF NOT EXISTS assigned_worker_id INTEGER REFERENCES workers(id) ON DELETE SET NULL;

COMMENT ON COLUMN schedule_vehicles.assigned_worker_id IS
  '전용 사용자. 이 사람이 이 차로 잡은 일정은 차량 예약 알림 메일을 보내지 않는다.';

-- 현재 배정 (2026-08-25 사용자 지정)
UPDATE schedule_vehicles v
   SET assigned_worker_id = w.id
  FROM workers w
 WHERE v.plate = '129누 9183' AND w.name = '이건호';

UPDATE schedule_vehicles v
   SET assigned_worker_id = w.id
  FROM workers w
 WHERE v.plate = '24구 7598' AND w.name = '윤기곤';
