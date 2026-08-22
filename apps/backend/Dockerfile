# 빌드 컨텍스트는 저장소 루트다: docker build -f apps/backend/Dockerfile .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json turbo.json ./
COPY packages ./packages
COPY apps/backend ./apps/backend

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @ai-lint/backend build
# 마이그레이션 SQL은 번들에 들어가지 않는다. 실행 파일 옆에 둬야 import.meta.url로 찾는다.
RUN cp -r apps/backend/src/db/migrations apps/backend/dist/migrations

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0

# 의존성을 전부 번들에 넣었으므로 런타임에는 node_modules가 없다.
COPY --from=build /app/apps/backend/dist ./dist

USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
