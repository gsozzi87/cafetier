FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json ./
RUN bun install --production

COPY server.ts db.ts api.ts ./
RUN mkdir -p public
COPY index.html manifest.json ./public/
COPY logo.png ./public/

RUN mkdir -p /data

ENV DB_PATH=/data/cafetier.db
ENV PORT=3000

EXPOSE 3000

CMD ["bun", "run", "server.ts"]
