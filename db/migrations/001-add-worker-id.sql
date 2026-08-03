-- ============================================================
-- 001. work_history 에 worker_id 추가 (2026-08-03)
--
-- 목적: 동명이인을 구분하고, 이름·입사일이 수정돼도 기록 연결이
--       끊어지지 않게 한다. (이름은 개명·오타 정정으로 바뀔 수 있다)
--
-- worker_name 은 지우지 않고 남긴다 —
--   ① 문제가 생겨도 이름으로 되돌릴 수 있다
--   ② 기록 당시의 이름이 무엇이었는지 보존된다
--   ③ 직원을 삭제해도 기록에 이름이 남는다
--
-- 실행 전 확인: 동명이인이 있으면 이름 매칭이 불확실하므로
--               아래 첫 쿼리로 반드시 점검할 것.
-- ============================================================

-- [점검] 동명이인이 있는가? 결과가 있으면 수동 확인이 필요하다
SELECT name, COUNT(*) AS cnt
FROM workers
GROUP BY name
HAVING COUNT(*) > 1;

-- [1] 컬럼 추가
ALTER TABLE work_history ADD COLUMN IF NOT EXISTS worker_id INTEGER;

-- [2] 기존 기록을 이름으로 매칭해 채운다
UPDATE work_history h
SET worker_id = w.id
FROM workers w
WHERE h.worker_name = w.name
  AND h.worker_id IS NULL;

-- [3] 조회용 인덱스
CREATE INDEX IF NOT EXISTS idx_work_history_worker_id ON work_history (worker_id);
CREATE INDEX IF NOT EXISTS idx_work_history_date_worker_id
  ON work_history (work_date, worker_id);

-- [검증] 채워지지 않은 행이 있는가? 0 이어야 한다
SELECT COUNT(*) AS unmatched FROM work_history WHERE worker_id IS NULL;

-- 외래키(FK)는 의도적으로 걸지 않는다.
-- 직원을 삭제해도 과거 업무 기록은 남아야 하기 때문이다.
-- SERIAL 은 삭제된 id 를 재사용하지 않으므로 다른 사람과 섞이지 않는다.
