-- 013. 차량마다 «자기 색» 을 박아 둔다 (2026-08-25)
-- ============================================================
-- 직원 색(`012`)과 같은 문제였다. 차량은 아예 «전부 같은 색» 이었다 —
-- 법인차 4대가 모두 주황(#f59e0b), 자차는 모두 보라(#8b5cf6) 로 하드코딩돼
-- 배차표에서 색만 보고는 어느 차인지 전혀 알 수 없었다.
--
-- 🔑 직원과 같은 방식 — «계산» 이 아니라 «값». 비우면 기본색으로 되돌아간다.
--
-- ⚠ admin 계정으로 실행할 것

ALTER TABLE schedule_vehicles ADD COLUMN IF NOT EXISTS color VARCHAR(7);

COMMENT ON COLUMN schedule_vehicles.color IS
  '달력·배차표에서 이 차량을 나타내는 색(#rrggbb). 비우면 기본색.';

UPDATE schedule_vehicles SET color = c.hex
  FROM (VALUES
    ('24구 7598',  '#f59e0b'),   -- 카니발 — 앰버
    ('3422',       '#0891b2'),   -- 카니발 — 시안
    ('15도 3955',  '#16a34a'),   -- Model Y — 초록
    ('129누 9183', '#e11d48')    -- QM6 — 로즈
  ) AS c(pl, hex)
 WHERE schedule_vehicles.plate = c.pl;
