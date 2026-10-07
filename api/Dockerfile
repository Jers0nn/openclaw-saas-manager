# Container image for the SaaS Manager API — for platforms that deploy
# containers (Railway, Fly.io, a VPS…). Render can use render.yaml instead.
# Contains no secrets: DATABASE_URL and API_KEYS are provided at runtime.

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY migrations ./migrations
USER node
EXPOSE 3000
# Apply pending migrations, then replace the shell with the server so it
# receives SIGTERM directly for graceful shutdown.
CMD ["sh", "-c", "node node_modules/node-pg-migrate/bin/node-pg-migrate.js up --migrations-dir migrations && exec node dist/server.js"]
