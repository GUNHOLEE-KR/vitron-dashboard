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
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL UNIQUE,
  active      BOOLEAN NOT NULL DEFAULT true,
  hired_at    DATE,
  resigned_at DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 업무 기록 테이블
CREATE TABLE IF NOT EXISTS work_history (
  id          SERIAL PRIMARY KEY,
  worker_name VARCHAR(100) NOT NULL,
  work_date   DATE NOT NULL,
  work_hour   VARCHAR(20),
  work_text   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_history_date      ON work_history (work_date);
CREATE INDEX IF NOT EXISTS idx_work_history_worker    ON work_history (worker_name);
CREATE INDEX IF NOT EXISTS idx_work_history_date_worker ON work_history (work_date, worker_name);

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
