FROM oven/bun:1-alpine

RUN apk add --no-cache python3 make g++ gcc

WORKDIR /app

COPY package.json ./
RUN bun install --production

COPY server.ts db.ts api.ts ./
RUN mkdir -p public
COPY index.html manifest.json ./public/
COPY logo.png ./public/ 2>/dev/null || true

RUN mkdir -p /data

ENV DB_PATH=/data/cafetier.db
ENV PORT=3000

EXPOSE 3000

CMD ["bun", "run", "server.ts"]
