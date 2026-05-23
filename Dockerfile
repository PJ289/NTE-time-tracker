FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js dashboard.html dashboard.css dashboard.js favicon.ico bg.png ./

RUN chown -R node:node /app
USER node

EXPOSE 28183

CMD ["node", "server.js"]
