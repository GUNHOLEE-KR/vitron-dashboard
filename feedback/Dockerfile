# 바이트론 의견 접수 — 위젯을 내려 주고 메일을 보낸다.
#
# ⚠ 빌드 단계가 없다. widget.js 는 브라우저가 그대로 읽는 순수 JS 라
#   번들러를 태우지 않는다 — 붙이는 제품의 빌드 설정과 무관해야 하기 때문이다.
FROM node:20-alpine
# alpine 에는 시간대 데이터가 없어 TZ 를 지정해도 UTC 로 동작한다.
# 로그의 시각이 9시간 어긋나면 「언제 들어온 의견인지」를 맞출 수 없다.
RUN apk add --no-cache tzdata && \
    cp /usr/share/zoneinfo/Asia/Seoul /etc/localtime && \
    echo "Asia/Seoul" > /etc/timezone
ENV TZ=Asia/Seoul
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY server.js ./
COPY public/ ./public/
EXPOSE 3003
CMD ["node", "server.js"]
