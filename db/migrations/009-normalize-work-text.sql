-- 009 업무명의 «공백 모양» 을 하나로 맞춘다 (2026-08-24)
--
-- 왜 필요한가
-- ------------
-- 업무 기록을 저장할 때는 서버가 공백을 눌러 왔는데(앞뒤 제거 · 연속 공백 한 칸),
-- Jira 업무명을 담을 때는 누르지 않았다. 그래서 «고르는 값» 과 «저장되는 값» 이
-- 달라져 한 업무가 두 줄로 갈라졌다.
--
--   [VITRON-231] 설계 화면 구현     한 칸   56건   ← 최근 저장분
--   [VITRON-231]  설계 화면 구현    두 칸   45건   ← 예전 저장분  (Jira 쪽 정본이 두 칸)
--
-- 서버 코드는 양쪽을 같은 규칙으로 맞췄다. 이 파일은 «이미 어긋난 것» 을 한 번 정리한다.
-- 이후로는 다시 갈라지지 않는다.
--
-- ⚠ 글자는 바뀌지 않는다. 앞뒤 공백과 연속 공백만 정리한다.
-- ⚠ 되돌리는 문은 없다 — 원래 공백이 몇 칸이었는지 알 수 없기 때문이다.
--    필요하면 실행 전에 두 표를 백업해 두십시오.

BEGIN;

-- 고치기 «전» 건수 (실행 기록에 남는다)
SELECT 'before' AS phase,
       (SELECT count(*) FROM jira_issues
         WHERE full_text ~ '\s\s' OR full_text <> btrim(full_text))  AS jira_bad,
       (SELECT count(*) FROM work_history
         WHERE work_text ~ '\s\s' OR work_text <> btrim(work_text))  AS history_bad;

-- ① Jira 업무명
UPDATE jira_issues
   SET full_text = btrim(regexp_replace(full_text, '\s+', ' ', 'g'))
 WHERE full_text ~ '\s\s' OR full_text <> btrim(full_text);

-- ② 업무 기록
UPDATE work_history
   SET work_text = btrim(regexp_replace(work_text, '\s+', ' ', 'g'))
 WHERE work_text ~ '\s\s' OR work_text <> btrim(work_text);

-- 고치기 «후» 건수 — 둘 다 0 이어야 한다
SELECT 'after' AS phase,
       (SELECT count(*) FROM jira_issues
         WHERE full_text ~ '\s\s' OR full_text <> btrim(full_text))  AS jira_bad,
       (SELECT count(*) FROM work_history
         WHERE work_text ~ '\s\s' OR work_text <> btrim(work_text))  AS history_bad;

-- 갈라져 있던 업무가 한 줄로 합쳐졌는지 확인
SELECT 'merged' AS phase, work_text, count(*) AS n
  FROM work_history
 WHERE work_text LIKE '%VITRON-231%'
 GROUP BY work_text;

COMMIT;
