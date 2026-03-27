FROM oven/bun:1-alpine

WORKDIR /app

# Install better-sqlite3 build dependencies
RUN apk add --no-cache python3 make g++ gcc

COPY package.json bun.lock* ./
RUN bun install --production

COPY . .

# Create data directory for SQLite
RUN mkdir -p /data

ENV DB_PATH=/data/cafetier.db
ENV PORT=3000

EXPOSE 3000

CMD ["bun", "run", "src/server.ts"]
