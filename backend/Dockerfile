FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3001

# tsx runs TypeScript directly (no build step), so file paths used at runtime stay the same.
CMD ["node_modules/.bin/tsx", "server.ts"]
