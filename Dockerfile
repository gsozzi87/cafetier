FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json ./
RUN bun install --production

COPY server.ts db.ts api.ts ./
RUN mkdir -p public /data /data/uploads
COPY index.html manifest.json ./public/
COPY logo.png ./public/

ENV DB_PATH=/data/cafetier.db
ENV UPLOAD_PATH=/data/uploads
ENV PORT=3000

EXPOSE 3000

CMD ["bun", "run", "server.ts"]
