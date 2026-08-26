# 바이트론 업무 포털 — 정적 화면 + API 넘겨주기
# 빌드 단계가 없다. 파일을 얹고 nginx 설정만 바꿔 끼운다.
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/index.html
