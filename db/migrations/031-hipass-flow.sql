-- 031 하이패스를 «흐름» 으로 잇는다 (2026-09-06 지시)
--
-- 지금까지 하이패스는 기능이 따로 놀았다. 올리고, 각자 실적에 붙이고 — 그것으로 끝이라
-- 「관리자가 직원별로 정리하고 → 알리고 → 직원이 확인하고 → 대표이사가 확정한다」 는
-- 업무 순서를 담을 자리가 아예 없었다 (사용자 지적 7번).
--
-- 🔑 «통행 낱건» 에 상태를 단다. 사람별 합계가 아니라 건별인 까닭은 —
--    직원이 「이 건은 내 것이 아니다」 를 짚어 되물을 수 있어야 하기 때문이다(지시 5번).
--
-- 🔑 «worker_id 칸은 만들지 않는다» (사용자 결정).
--    누구 것인지는 지금처럼 «실적(actual_id)» 으로만 정한다. 통행에 사람을 직접 달면
--    금액의 정본이 실적과 둘로 갈라져, 「출장 내역 없는 청구」 가 생길 수 있다.
--    그날 실적이 없는 통행은 관리자가 그 직원에게 «실적 입력을 요청» 한다.
--
-- 흐름
--   ① 엑셀 올리기        (있던 것)
--   ② 관리자 정리        차량별·직원별·일자별로 보고 미배정을 없앤다
--   ③ 건별 골라 메일     notified_at 이 찍힌다            ← 이 마이그레이션
--   ④ 직원 확인          worker_state = claimed / disputed ← 이 마이그레이션
--   ⑤ 대표이사 확정      final_state  = confirmed / rejected ← 이 마이그레이션
--   ⑥ 월 정산 1차 안내 → 2차 입금 확인   (있던 것)
--
-- ⚠ admin 계정으로 실행한다. 앱 계정은 테이블 소유자가 아니라 ALTER 가 거부된다.
--   docker exec -i postgres psql -U admin -d <DB> -f 031-hipass-flow.sql
--
-- ⚠ 되돌리기 — 아래 한 줄이면 원래대로 돌아간다(통행 자료는 그대로 남는다).
--     ALTER TABLE hipass_tolls
--       DROP COLUMN notified_at, DROP COLUMN notified_by,
--       DROP COLUMN worker_state, DROP COLUMN worker_note, DROP COLUMN worker_at,
--       DROP COLUMN final_state,  DROP COLUMN final_by,   DROP COLUMN final_at;

-- ── ③ 메일을 보낸 자취 ───────────────────────────────────────
-- 🔑 「보냈는지」 를 화면에서 볼 수 있어야 같은 사람에게 두 번 보내지 않는다 (지시 3번).
--    보낸 «시각» 을 남긴다 — boolean 으로 두면 언제 보냈는지를 영영 알 수 없다.
ALTER TABLE hipass_tolls
  ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notified_by INTEGER;          -- kpi_users.id (보낸 사람)

COMMENT ON COLUMN hipass_tolls.notified_at IS
  '이 통행을 직원에게 메일로 알린 시각. NULL 이면 아직 안 알렸다.';

-- ── ④ 직원의 대답 ───────────────────────────────────────────
-- none      아직 아무 말 없음
-- claimed   「맞습니다 — 정산해 주십시오」
-- disputed  「틀립니다」 + 사유(worker_note)
ALTER TABLE hipass_tolls
  ADD COLUMN IF NOT EXISTS worker_state VARCHAR(10) NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS worker_note  VARCHAR(300),
  ADD COLUMN IF NOT EXISTS worker_at    TIMESTAMPTZ;

ALTER TABLE hipass_tolls DROP CONSTRAINT IF EXISTS hipass_tolls_worker_state_chk;
ALTER TABLE hipass_tolls
  ADD CONSTRAINT hipass_tolls_worker_state_chk
  CHECK (worker_state IN ('none', 'claimed', 'disputed'));

COMMENT ON COLUMN hipass_tolls.worker_state IS
  'none 아직 / claimed 직원이 맞다고 함 / disputed 직원이 정정 요청';
COMMENT ON COLUMN hipass_tolls.worker_note IS
  '정정 요청 사유. 대표이사가 이것을 보고 판단한다.';

-- ── ⑤ 대표이사의 최종 판정 ──────────────────────────────────
-- pending    아직
-- confirmed  이대로 정산한다
-- rejected   이 건은 빼야 한다 — 실적에서 떼라는 뜻이다
ALTER TABLE hipass_tolls
  ADD COLUMN IF NOT EXISTS final_state VARCHAR(10) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS final_by    INTEGER,                  -- kpi_users.id
  ADD COLUMN IF NOT EXISTS final_at    TIMESTAMPTZ;

ALTER TABLE hipass_tolls DROP CONSTRAINT IF EXISTS hipass_tolls_final_state_chk;
ALTER TABLE hipass_tolls
  ADD CONSTRAINT hipass_tolls_final_state_chk
  CHECK (final_state IN ('pending', 'confirmed', 'rejected'));

COMMENT ON COLUMN hipass_tolls.final_state IS
  'pending 아직 / confirmed 이대로 정산 / rejected 이 건은 뺀다';

-- ── 찾아보기 ─────────────────────────────────────────────────
-- 「아직 안 알린 것」·「아직 확정 안 된 것」 을 세는 것이 화면의 주된 조회다.
CREATE INDEX IF NOT EXISTS idx_hipass_notified ON hipass_tolls (notified_at);
CREATE INDEX IF NOT EXISTS idx_hipass_states   ON hipass_tolls (final_state, worker_state);

-- ⚠ 새 «표» 를 만든 것이 아니라 칸만 더했으므로 GRANT 는 이미 유효하다.
--   (025 에서 hipass_tolls 에 SELECT/INSERT/UPDATE/DELETE 를 주었다)

-- ── 확인 ─────────────────────────────────────────────────────
SELECT '칸' AS t, column_name, data_type, column_default
  FROM information_schema.columns
 WHERE table_name = 'hipass_tolls'
   AND column_name IN ('notified_at','notified_by','worker_state','worker_note',
                       'worker_at','final_state','final_by','final_at')
 ORDER BY column_name;
SELECT '현황' AS t, worker_state, final_state, count(*)
  FROM hipass_tolls GROUP BY worker_state, final_state ORDER BY 2, 3;
