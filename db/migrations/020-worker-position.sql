-- 020 직원 직책 (2026-08-29)
--
-- 「직원 관리에서 직책을 등록하고, 대표이사로 등록한 사람만 대표이사로 처리한다」
-- 는 지시. 직책 목록은 여덟 단계다 —
--   대표이사 · 이사 · 부장 · 차장 · 과장 · 대리 · 주임 · 사원
--
-- 🔑 왜 `kpi_users.rank_title` 을 쓰지 않고 새 칸을 파는가 (2026-08-29 사용자 결정)
--    그 표는 KPI 추적 시스템과 «함께 쓰는» 표이고, 짝인 `rank_order` 는 KPI 에서
--    단순한 정렬값이 아니라 «서열» 그 자체다. 세 곳에 쓰인다:
--      · canSeeAllReviews = (rank_order === 1)          대표이사만 모든 평가를 본다
--      · WHERE u.rank_order > 나의 rank_order            나보다 아래인 사람만 평가한다
--      · rank_order BETWEEN f.rank_from AND f.rank_to    평가 양식을 서열 구간으로 배정
--    지금 값은 «직책 단위» 가 아니라 «사람 하나하나의 서열 번호» 다 —
--    부장이 둘인데 이건호 2, 윤기곤 3 으로 서로 다르다.
--    직책을 그 칸에 밀어 넣으면 둘이 같은 번호가 되어 서로를 평가할 수 없게 되고,
--    평가 양식 배정도 조용히 달라진다. 그래서 «따로» 둔다.
--    ⚠ 이 마이그레이션은 kpi_users 를 건드리지 않는다. KPI 평가는 그대로다.
--
-- ⚠ 직책은 `workers` 에 둔다 — 계정(kpi_users)이 아니라 «사람» 의 속성이고,
--   퇴사자(박승우·김태현)처럼 계정이 없는 직원에게도 붙을 수 있어야 한다.
--   workers 는 업무 대시보드가 주인인 표라 칸을 더해도 KPI 에 영향이 없다.

ALTER TABLE workers ADD COLUMN IF NOT EXISTS position VARCHAR(20);

COMMENT ON COLUMN workers.position IS
  '직책. 대표이사/이사/부장/차장/과장/대리/주임/사원 중 하나. '
  'KPI 서열(kpi_users.rank_order)과는 별개다 — 그쪽은 평가 권한·양식 배정에 쓰인다.';

-- 지금 값을 옮겨 심는다. 빈 칸으로 두면 관리자가 여덟 명을 손으로 다시 넣어야 하고,
-- 그 사이 「대표이사가 아무도 없는」 상태가 생긴다.
-- ⚠ 계정이 있는 사람만 옮겨진다. 계정 없는 퇴사자는 비어 있는 채로 남는다(의도).
UPDATE workers w
   SET position = u.rank_title
  FROM kpi_users u
 WHERE u.worker_id = w.id
   AND u.rank_title IS NOT NULL
   AND w.position IS NULL;

-- 확인 — 대표이사가 «정확히 한 명» 인가, 옮겨지지 않은 재직자가 있는가
SELECT '직책' AS t, w.id, w.name, w.position, w.active
  FROM workers w ORDER BY w.active DESC, w.id;

SELECT '대표이사 수' AS t, count(*) FROM workers WHERE position = '대표이사' AND active;

SELECT '직책이 비어 있는 재직자' AS t, count(*) FROM workers WHERE position IS NULL AND active;
