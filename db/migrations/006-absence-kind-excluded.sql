-- 006 부재 사유에 「집계 제외」 추가
--
-- 대표이사처럼 애초에 업무 기록·평가의 대상이 아닌 사람이 있다.
-- 부재(장기출장·휴직·파견)와 성격은 다르지만, «그 기간을 집계에서 뺀다» 는
-- 처리 방식이 똑같아 같은 표를 쓴다. 새 구조를 만들면 두 벌을 관리해야 한다.
--
-- 기간을 열어 두면(to_date 비움) 계속 제외된다.

ALTER TABLE worker_absences DROP CONSTRAINT IF EXISTS worker_absences_kind_check;
ALTER TABLE worker_absences ADD  CONSTRAINT worker_absences_kind_check
  CHECK (kind IN ('장기출장', '휴직', '파견', '집계 제외'));
