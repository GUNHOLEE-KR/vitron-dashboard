-- 033 휴가 「기타」에 사유를 적을 자리 (2026-09-07 지시)
--
-- 휴가 종류는 연차·반차·병가·포상·기타 다섯인데, 「기타」에 «무엇인지» 를 적을 곳이
-- 없었다. 「예비군 참석」·「경조」 처럼 사람이 알아야 할 것이 그대로 사라진다
-- (사용자 지적) — 달력에도 메일에도 그냥 「기타」로만 뜬다.
--
-- 🔑 종류(vacation_type)는 그대로 두고 «설명» 만 따로 담는다.
--    종류 칸에 「예비군」 을 넣으면 집계가 갈라져 「기타」 합계를 못 센다
--    (반차를 종류에 담지 않은 것과 같은 까닭 — 004 의 메모 참고).
-- 🔑 「기타」 가 아닌 종류에도 담을 수 있게 «막지 않는다». 병가에 「입원」 처럼
--    덧붙이고 싶을 수 있고, 막아 두면 그때 또 칸을 늘려야 한다.
--
-- ⚠ admin 계정으로 실행한다. 앱 계정은 테이블 소유자가 아니라 ALTER 가 거부된다.
--   docker exec -i postgres psql -U admin -d <DB> -f 033-vacation-note.sql
--
-- ⚠ 되돌리기
--     ALTER TABLE schedule_plans DROP COLUMN vacation_note;

ALTER TABLE schedule_plans
  ADD COLUMN IF NOT EXISTS vacation_note VARCHAR(100);

COMMENT ON COLUMN schedule_plans.vacation_note IS
  '휴가 사유를 사람 말로 적어 둔 것 (예: 예비군 참석). 종류(vacation_type)와 «따로» 둔다 — '
  '종류에 담으면 집계가 갈라져 「기타」 합계를 셀 수 없다.';

-- ⚠ 새 표가 아니라 칸만 더했으므로 GRANT 는 003 의 것이 그대로 유효하다.

-- ── 확인 ─────────────────────────────────────────────────────
SELECT '칸' AS t, column_name, data_type, character_maximum_length AS 길이
  FROM information_schema.columns
 WHERE table_name = 'schedule_plans' AND column_name = 'vacation_note';
SELECT '휴가 현황' AS t, vacation_type AS 종류, count(*) AS 건수
  FROM schedule_plans WHERE use_type = 'vacation'
 GROUP BY 1, 2 ORDER BY 2;
