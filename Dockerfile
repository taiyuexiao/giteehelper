FROM node:26-alpine

WORKDIR /app
ARG BASE_PATH=/
ENV VITE_BASE_PATH=$BASE_PATH
COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787
CMD ["npm", "run", "start"]
