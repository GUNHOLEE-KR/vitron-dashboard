-- 038 밀려 있던 «지난 날짜» 휴가를 정리 기록으로 돌린다 (2026-09-10 지시)
--
-- 🔑 스키마 변경이 아니라 «자료 정리» 다. 그래도 여기 남기는 까닭은,
--    운영 자료를 손댄 일은 무엇을 왜 바꿨는지 되짚을 수 있어야 하기 때문이다.
--
-- ── 왜 ──────────────────────────────────────────────────────
-- 2026-09-10 에 「지난 날짜 휴가·공가는 신청이 아니라 «정리» 다」 규칙을 넣었다
-- (메일 없이 그 자리에서 승인). 그 규칙은 «앞으로 넣는 것» 에만 걸리므로,
-- 그전에 지난 날짜로 들어와 승인 대기에 묶여 있던 것들이 그대로 남았다.
-- 실측 = 다섯 건, 전부 윤인철(worker_id 5) 연차이고 전부 이미 지나간 날이다.
--     224  2026-06-12
--     220~223  2026-08-18 ~ 08-21
--
-- ── 어떻게 ──────────────────────────────────────────────────
-- 🔴 approved_by_id 는 «비운 채로» 둔다 — 사람이 승인한 것이 아니다.
--    이 한 칸이 「지난 날짜 정리(자동)」와 「사람이 승인」을 가른다(CLAUDE.md 참고).
-- 🔴 plan_date < CURRENT_DATE 를 조건에 «반드시» 둔다. 빼면 앞으로의 신청까지
--    승인해 버린다 — 결재를 건너뛰는 사고가 된다.
-- ⚠ 이 SQL 로는 메일이 나가지 않는다(메일은 앱이 보낸다). 그것이 의도다 —
--   몇 달 지난 휴가의 승인 메일이 이제 와서 가면 받는 쪽이 더 혼란스럽다.
--
-- ⚠ admin 계정으로 실행한다.
--   docker exec -i postgres psql -U admin -d <DB> -f 038-vacation-backfill-approve.sql
--
-- ⚠ 되돌리기 — 아래 다섯 줄을 대기로 되돌린다
--     UPDATE schedule_plans SET approval='pending', approved_at=NULL
--      WHERE id IN (220,221,222,223,224);

\echo '=== 바꾸기 «전» ==='
SELECT p.id, p.plan_date, w.name, p.vacation_type, p.approval, p.approved_by_id
  FROM schedule_plans p LEFT JOIN workers w ON w.id = p.worker_id
 WHERE p.approval = 'pending'
 ORDER BY p.plan_date;

BEGIN;

UPDATE schedule_plans
   SET approval = 'approved',
       approved_at = now(),
       approved_by_id = NULL,      -- 🔴 사람이 승인한 것이 아니다
       updated_at = now()
 WHERE approval = 'pending'
   AND use_type = 'vacation'
   AND plan_date < CURRENT_DATE;   -- 🔴 앞날은 절대 건드리지 않는다

\echo '=== 바꾼 뒤 — 대기에 «앞날만» 남아야 한다 ==='
SELECT count(*) AS 남은_대기 FROM schedule_plans WHERE approval = 'pending';
SELECT count(*) AS 지난날짜_대기 FROM schedule_plans
 WHERE approval = 'pending' AND plan_date < CURRENT_DATE;

COMMIT;

\echo '=== 결과 ==='
SELECT p.id, p.plan_date, w.name, p.vacation_type, p.approval,
       p.approved_by_id, p.approved_at
  FROM schedule_plans p LEFT JOIN workers w ON w.id = p.worker_id
 WHERE p.id IN (220, 221, 222, 223, 224)
 ORDER BY p.plan_date;

\echo '=== 승인 갈래 세어 보기 (셋이 갈리는지) ==='
SELECT CASE
         WHEN approval IS NULL              THEN '승인 제도 밖'
         WHEN approval = 'approved' AND approved_by_id IS NULL THEN '지난 날짜 정리(자동)'
         WHEN approval = 'approved'         THEN '사람이 승인'
         ELSE approval
       END AS 갈래, count(*)
  FROM schedule_plans
 GROUP BY 1 ORDER BY 2 DESC;
