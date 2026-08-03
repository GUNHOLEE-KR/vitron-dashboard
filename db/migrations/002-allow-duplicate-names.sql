-- ============================================================
-- 002. 동명이인 등록 허용 (2026-08-03)
--
-- 문제: workers.name 에 UNIQUE 제약이 있어 같은 이름의 직원을
--       두 번째로 등록할 수 없었다. (duplicate key ... workers_name_key)
--       001 에서 worker_id 기반으로 바꿨지만, 등록 자체가 막혀 있어
--       동명이인 대응이 실제로는 동작하지 않는 상태였다.
--
-- 조치: 이름 단독 UNIQUE → (이름, 입사일) 복합 UNIQUE 로 교체한다.
--       · 같은 이름 + 다른 입사일  → 등록 허용 (동명이인)
--       · 같은 이름 + 같은 입사일  → 거부 (같은 사람을 두 번 넣는 실수 방지)
--
-- 식별자는 여전히 id 다. 이름·입사일은 표시와 중복 방지에만 쓴다.
-- (입사일을 식별자로 쓰면 오타를 정정하는 순간 기록 연결이 끊어진다)
-- ============================================================

ALTER TABLE workers DROP CONSTRAINT IF EXISTS workers_name_key;

-- 입사일이 NULL 인 행이 여러 개면 UNIQUE 가 걸리지 않으므로(NULL 은 서로 다르게 취급),
-- 아래 제약은 "입사일이 있는 직원"에 대해서만 실질적으로 작동한다.
ALTER TABLE workers
  ADD CONSTRAINT workers_name_hired_at_key UNIQUE (name, hired_at);

-- [검증] 제약 목록 확인 — workers_name_hired_at_key 가 보여야 한다
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'workers'::regclass AND contype = 'u';
