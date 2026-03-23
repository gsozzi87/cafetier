FROM oven/bun:1-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++ gcc

COPY package.json bun.lock* ./
RUN bun install --production

COPY . .
RUN mkdir -p /data

ENV DB_PATH=/data/cafetier.db
ENV PORT=3000

EXPOSE 3000

CMD ["bun", "run", "server.ts"]
