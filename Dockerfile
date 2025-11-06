FROM node:22-slim AS base
WORKDIR /app
COPY package.json package-lock.json ./

FROM base AS prod-deps
RUN --mount=type=cache,id=npm,target=/root/.npm \
    npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM base AS build
RUN --mount=type=cache,id=npm,target=/root/.npm \
    npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && \
    apt-get install -y --no-install-recommends xvfb xauth fonts-dejavu fonts-liberation && \
    rm -rf /var/lib/apt/lists/*
COPY --from=prod-deps /app/node_modules ./node_modules
RUN npx playwright install --with-deps chromium
COPY --from=build /app/dist ./dist
COPY entrypoint.sh /app/entrypoint.sh

RUN chmod +x /app/entrypoint.sh
CMD /app/entrypoint.sh
