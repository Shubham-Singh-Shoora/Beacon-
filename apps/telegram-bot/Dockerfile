# Build from the repository root:
# docker build -f apps/telegram-bot/Dockerfile -t beacon-bot .
FROM node:22-bookworm-slim
RUN corepack enable && corepack prepare pnpm@10.23.0 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter @beacon/telegram-bot... \
    && mkdir -p /state && chown node:node /state
ENV NODE_ENV=production
ENV BEACON_SUBSCRIPTIONS_PATH=/state/telegram-subscriptions.json
USER node
CMD ["pnpm", "bot:start"]
