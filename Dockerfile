FROM oven/bun:1-alpine

RUN apk add --no-cache python3 make g++ gcc

WORKDIR /app

COPY package.json ./
RUN bun install --production

COPY src/ ./src/
COPY public/ ./public/

RUN mkdir -p /data

ENV DB_PATH=/data/cafetier.db
ENV PORT=3000

EXPOSE 3000

CMD ["bun", "run", "src/server.ts"]
