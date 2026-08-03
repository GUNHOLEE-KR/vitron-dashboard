#!/bin/sh
# NAS(vitron-nas) 배포 스크립트
#
# 사용법:  cd /volume1/docker-build && ./deploy.sh
#
# 소스를 갱신한 뒤 이 스크립트만 실행하면 이미지 재빌드부터 컨테이너 교체까지 끝난다.
# 프로젝트 이름을 vitron-dashboard 로 고정해 기존 컨테이너를 그대로 이어받는다.

set -e
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "오류: .env 파일이 없습니다. .env.example 을 복사해 값을 채워 주세요."
  exit 1
fi

echo "[1/3] 이미지 빌드 및 컨테이너 교체"
docker compose -p vitron-dashboard up -d --build

echo "[2/3] 사용하지 않는 이미지 정리"
docker image prune -f

echo "[3/3] 상태 확인"
docker compose -p vitron-dashboard ps
echo ""
echo "완료: http://vitron-nas:8082"
