-- ============================================================
-- 1. DB 및 사용자 생성 (postgres 슈퍼유저로 실행)
-- ============================================================
CREATE USER vitron WITH PASSWORD 'your_password_here';
CREATE DATABASE vitron_dashboard OWNER vitron;
GRANT ALL PRIVILEGES ON DATABASE vitron_dashboard TO vitron;

-- ============================================================
-- 2. 아래부터는 vitron_dashboard DB에 접속 후 실행
-- ============================================================

-- 직원 테이블
CREATE TABLE IF NOT EXISTS workers (
  -- id 가 직원의 진짜 식별자다. 이름·입사일은 바뀔 수 있으므로 참조에 쓰지 않는다.
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT true,
  hired_at    DATE,
  resigned_at DATE,
  -- 회사 메일 주소. KPI 추적 시스템(8083)이 로그인 아이디로 쓴다.
  email       VARCHAR(200),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 이름 단독 UNIQUE 는 동명이인을 막아버린다. (이름, 입사일) 조합으로 바꿔
  -- 동명이인은 허용하고 완전 중복(같은 이름·같은 입사일)만 거부한다.
  CONSTRAINT workers_name_hired_at_key UNIQUE (name, hired_at)
);

-- 이미 만들어진 DB 에도 컬럼을 더한다 (이 파일은 여러 번 실행돼도 안전해야 한다)
ALTER TABLE workers ADD COLUMN IF NOT EXISTS email VARCHAR(200);

-- 업무 기록 테이블
CREATE TABLE IF NOT EXISTS work_history (
  id          SERIAL PRIMARY KEY,
  -- worker_id 가 실제 식별자다. 이름·입사일이 수정돼도 연결이 끊어지지 않는다.
  -- FK 는 의도적으로 걸지 않는다 — 직원을 삭제해도 과거 기록은 남아야 한다.
  worker_id   INTEGER,
  -- worker_name 은 기록 당시의 이름을 보존하는 용도로 함께 남긴다.
  worker_name VARCHAR(100) NOT NULL,
  work_date   DATE NOT NULL,
  work_hour   VARCHAR(20),
  work_text   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_history_date         ON work_history (work_date);
CREATE INDEX IF NOT EXISTS idx_work_history_worker       ON work_history (worker_name);
CREATE INDEX IF NOT EXISTS idx_work_history_worker_id    ON work_history (worker_id);
CREATE INDEX IF NOT EXISTS idx_work_history_date_worker  ON work_history (work_date, worker_name);
CREATE INDEX IF NOT EXISTS idx_work_history_date_worker_id ON work_history (work_date, worker_id);

-- Jira 이슈 캐시 테이블
CREATE TABLE IF NOT EXISTS jira_issues (
  id         SERIAL PRIMARY KEY,
  jira_key   VARCHAR(50) NOT NULL UNIQUE,
  summary    TEXT,
  parent_key VARCHAR(50),
  full_text  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 권한 부여 (vitron_dashboard DB 접속 후)
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO vitron;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO vitron;
