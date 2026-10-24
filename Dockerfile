FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build:web


FROM node:22-bookworm-slim AS production-dependencies

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev


FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=8080 \
    CONFIG_PATH=/config \
    SONGS_PATH=/songs \
    FRONTEND_PATH=/app/dist/angular/browser

WORKDIR /app

COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=production-dependencies /app/package.json ./package.json
COPY --from=build /app/dist/server ./dist/server
COPY --from=build /app/dist/angular/browser ./dist/angular/browser

COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=production-dependencies /app/package.json ./package.json
COPY --from=build /app/dist/server ./dist/server
COPY --from=build /app/dist/angular ./dist/angular

RUN mkdir -p /config /songs \
    && chown -R node:node /app /config /songs

USER node

EXPOSE 8080

CMD ["node", "dist/server/src-server/server.js"]
