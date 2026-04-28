FROM node:20-alpine
WORKDIR /app
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN mkdir -p output ssh-keys
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["node_modules/.bin/tsx", "src/index.ts"]
