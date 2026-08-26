#!/bin/sh
# 바이트론 업무 포털 배포 — NAS 에서 이 하나만 돌리면 끝난다.
#
# 사용법:  cd /volume1/docker-build-portal && ./deploy.sh
#
# 🔑 대시보드·KPI 와 «별개 스택» 이라 이것을 돌려도 그 둘은 건드리지 않는다.

set -e
cd "$(dirname "$0")"

echo "[1/3] 이미지 빌드 및 컨테이너 교체"
docker compose -p vitron-portal up -d --build

echo "[2/3] 사용하지 않는 이미지 정리"
docker image prune -f

echo "[3/3] 상태 확인"
docker compose -p vitron-portal ps
echo ""
echo "완료: http://vitron-nas/ERP  (직접 주소 http://vitron-nas:8085)"
