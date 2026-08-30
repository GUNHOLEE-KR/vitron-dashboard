#!/bin/sh
# 바이트론 의견 접수 배포 — NAS 에서 이 하나만 돌리면 끝난다.
#
# 사용법:  cd /volume1/docker-build-feedback && ./deploy.sh
#
# 🔑 대시보드·KPI·포털과 «별개 스택» 이라 이것을 돌려도 그 셋은 건드리지 않는다.

set -e
cd "$(dirname "$0")"

# .env 가 없으면 메일을 못 보낸다. 빌드를 다 마친 뒤에 알면 시간을 버리므로 먼저 본다.
if [ ! -f .env ]; then
  echo "오류: .env 가 없습니다. MAIL_* 와 FEEDBACK_MAIL_TO 를 넣어 주세요."
  exit 1
fi

echo "[1/3] 이미지 빌드 및 컨테이너 교체"
docker compose -p vitron-feedback up -d --build

echo "[2/3] 사용하지 않는 이미지 정리"
docker image prune -f

echo "[3/3] 상태 확인"
docker compose -p vitron-feedback ps
echo ""
echo "완료: http://vitron-nas:8086/widget.js"
