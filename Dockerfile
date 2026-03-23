FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++ gcc

COPY package*.json ./
RUN npm install

COPY . .

RUN mkdir -p /data

ENV DB_PATH=/data/cafetier.db
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "run", "start"]
