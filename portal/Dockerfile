# 바이트론 업무 포털 — 빌드 결과를 얹고 API 를 넘겨준다.
#
# ⚠ 빌드는 «PC 에서» 한다(`npx vite build --config vite.portal.config.js`).
#   컨테이너 안에서 빌드하려면 src/shared 까지 보내야 하는데, 그러면 대시보드
#   소스 전체가 포털 이미지에 들어간다. 결과물만 얹는 편이 가볍고 분명하다.
#   그래서 push-portal.ps1 이 «빌드 → 전송 → 교체» 순으로 돈다.
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist/ /usr/share/nginx/html/
