-- ============================================================
-- 046-plan-work-note.sql — 일정의 「메모」 칸 (2026-09-25 지시)
--
--   ⚠ admin 계정으로 실행한다 (기존 표에 칸만 더하므로 GRANT 는 다시 줄 필요가 없다).
--
--      scp db/migrations/046-plan-work-note.sql root@vitron-nas:/tmp/
--      ssh root@vitron-nas 'docker exec -i postgres psql -U admin \
--        -d vitron_dashboard -v ON_ERROR_STOP=1 -f /dev/stdin < /tmp/046-plan-work-note.sql'
--
-- 왜
--   045 뒤로 계획 창의 「업무」 칸은 «프로젝트 고르기» 가 되었다(사용자 지시 — 「무엇을 하러」와
--   프로젝트는 같은 것). 그러자 「다크호스1 «얼라인오류 수정»」 같은 세부 내용을 적을 자리가
--   사라졌다 — 프로젝트를 고르면 달력 글자가 「다크호스 I」 로만 남았다(2026-09-25 확인).
--   → 짧은 메모 칸을 따로 둔다(사용자 선택 (나)).
--
-- 🔑 purpose(달력·메일의 「업무」 글자)는 «만들어진 값» 이다 = 고른 프로젝트 이름 + 직접 적은 글
--    + 이 메모. 따로 두는 까닭은, 다시 열 때 «어디까지가 메모였는지» 를 알아야 하기 때문이다.
-- 🔑 예전 계획(이 칸이 비고 프로젝트도 없는 것)은 화면이 옛 purpose 를 «메모» 로 읽는다 —
--    그래야 프로젝트를 새로 골라도 세부 내용이 남는다.
-- ============================================================

ALTER TABLE schedule_plans ADD COLUMN IF NOT EXISTS work_note VARCHAR(200);

COMMENT ON COLUMN schedule_plans.work_note IS
  '업무의 세부 메모(선택). purpose 는 프로젝트 이름 + 직접 적은 글 + 이 메모를 이어 만든다. 업무 일정만.';

\echo '=== 더한 칸 ==='
SELECT column_name, data_type, character_maximum_length
  FROM information_schema.columns
 WHERE table_name = 'schedule_plans' AND column_name = 'work_note';
