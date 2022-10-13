FROM node:18.4.0-alpine3.16

ENV NODE_ENV=production

RUN apk add --update --no-cache nodejs npm

COPY package*.json /app/

WORKDIR /app

RUN npm install --omit=dev

COPY app.js ./

USER node

CMD ["npm", "start"]