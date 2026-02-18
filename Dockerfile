FROM node:22-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN node ace build

EXPOSE 3333

CMD ["node", "build/bin/server.js"]