#!/bin/sh
# NAS(vitron-nas) 배포 스크립트
#
# 사용법:
#   cd /volume1/docker-build             && ./deploy.sh                    운영
#   cd /volume1/docker-build-dashboard-test && ./deploy.sh vitron-dashboard-test  테스트
#
# 소스를 갱신한 뒤 이 스크립트만 실행하면 이미지 재빌드부터 컨테이너 교체까지 끝난다.
#
# 🔑 프로젝트 이름을 «인자» 로 받는다. 고정해 두면 테스트 스택이 운영 컨테이너를
#    그대로 이어받아 갈아 끼워 버린다. 안 주면 운영이다.
# 🔑 포트·이미지 태그·DB 이름은 그 폴더의 .env 가 정한다 (docker-compose.yml 참고).

set -e
cd "$(dirname "$0")"

PROJECT="${1:-vitron-dashboard}"

if [ ! -f .env ]; then
  echo "오류: .env 파일이 없습니다. .env.example 을 복사해 값을 채워 주세요."
  exit 1
fi

# 어디에 올리는지 사람이 보고 멈출 수 있어야 한다
PORT=$(grep -E '^FRONTEND_PORT=' .env | cut -d= -f2)
DBNAME=$(grep -E '^DB_NAME=' .env | cut -d= -f2)
echo "대상: $PROJECT  (포트 ${PORT:-8082} · DB ${DBNAME:-?})"

echo "[1/3] 이미지 빌드 및 컨테이너 교체"
docker compose -p "$PROJECT" up -d --build

echo "[2/3] 사용하지 않는 이미지 정리"
docker image prune -f

echo "[3/3] 상태 확인"
docker compose -p "$PROJECT" ps
echo ""
echo "완료: http://vitron-nas:${PORT:-8082}"
