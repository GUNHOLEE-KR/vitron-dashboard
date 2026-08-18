-- 005 장기 부재(장기출장·휴직·파견) 기간 관리
--
-- 왜 필요한가 — 장기 출장자는 업무를 입력할 수 없는데, 집계에는 재직자로 들어간다.
-- 그 한 사람 때문에 회사 1인 평균이 내려가고 최소값이 그 사람으로 고정돼
-- 평균·최대·최소가 전부 실제와 어긋난다.
--
-- 왜 컬럼이 아니라 테이블인가 — 부재는 한 사람에게 여러 번, 사유도 여러 가지로 생긴다.
-- 컬럼 두 개로 두면 두 번째 출장부터 기록할 곳이 없다.
--
-- ⚠ 스키마 변경은 admin 계정으로 해야 한다 (앱 계정은 테이블 소유자가 아니다).
--   새 테이블을 만들었으면 앱 계정에 GRANT 하는 것을 잊지 말 것 —
--   안 하면 화면이 권한 오류로 조용히 비어 보인다.

CREATE TABLE IF NOT EXISTS worker_absences (
  id         SERIAL PRIMARY KEY,
  -- 직원을 지우면 부재 기록도 함께 사라진다. 남아 있어도 가리킬 사람이 없다.
  worker_id  INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  kind       VARCHAR(20) NOT NULL,
  from_date  DATE NOT NULL,
  -- 비워 두면 «진행 중» — 언제 돌아올지 모르는 파견·휴직이 실제로 있다.
  to_date    DATE,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT worker_absences_kind_check
    CHECK (kind IN ('장기출장', '휴직', '파견')),
  -- 끝이 시작보다 앞설 수 없다. 입력 실수를 DB 에서 막는다.
  CONSTRAINT worker_absences_range_check
    CHECK (to_date IS NULL OR to_date >= from_date)
);

CREATE INDEX IF NOT EXISTS idx_worker_absences_worker ON worker_absences (worker_id);
CREATE INDEX IF NOT EXISTS idx_worker_absences_range  ON worker_absences (from_date, to_date);

-- 앱 계정 권한. 테이블과 시퀀스 둘 다 줘야 INSERT 가 된다.
GRANT SELECT, INSERT, UPDATE, DELETE ON worker_absences TO "vitron-dashboard";
GRANT USAGE, SELECT ON SEQUENCE worker_absences_id_seq TO "vitron-dashboard";
