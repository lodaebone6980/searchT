FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

ENV NODE_ENV=production
RUN npm install --omit=dev

COPY . .

EXPOSE 3001

CMD ["node", "src/index.js"]
