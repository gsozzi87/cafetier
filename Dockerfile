FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json ./
RUN bun install --production

COPY server.ts api.ts db.ts ./
COPY index.html styles.css app.js manifest.json logo.png ./

RUN mkdir -p public /data /data/uploads
RUN cp index.html styles.css app.js manifest.json logo.png public/

ENV DB_PATH=/data/cafetier.db
ENV UPLOAD_PATH=/data/uploads
ENV PORT=3000

EXPOSE 3000

CMD ["bun", "run", "server.ts"]
