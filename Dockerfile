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

# 연산 서버. Node 24가 TypeScript를 그대로 실행하므로 별도 번들 단계가 없다.
# 코어는 브라우저와 완전히 같은 파일을 쓴다.
FROM node:24-alpine AS api

WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0

# 코어가 런타임에 실제로 부르는 외부 패키지는 earcut 하나뿐이지만,
# 잠금 파일로 설치해야 브라우저에서 쓰는 버전과 어긋나지 않는다.
# three는 로더와 뷰어에서만 쓰므로 서버 경로에서는 불러오지 않는다.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY src ./src
COPY server ./server

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.ts"]

FROM nginx:1.27-alpine AS runtime

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
