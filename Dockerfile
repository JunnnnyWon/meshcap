# 빌드 단계. 결과물은 정적 파일뿐이라 실행 이미지에 node를 남길 이유가 없다.
FROM node:24-alpine AS build

WORKDIR /app

# 스크린샷용으로만 쓰는 playwright가 설치 중에 브라우저를 내려받으면
# 이미지 빌드가 몇 분씩 길어진다. 빌드에는 필요 없는 단계다.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts index.html ./
COPY bench ./bench
COPY src ./src

# 타입 검사와 단위 테스트를 통과해야 이미지가 만들어진다.
RUN npm test && npm run build

FROM nginx:1.27-alpine AS runtime

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
