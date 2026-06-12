FROM node:20-alpine
WORKDIR /app
COPY package.json .
RUN npm install --omit=dev
COPY server.js dashboard.html ./
ENV PORT=8799
EXPOSE 8799
CMD ["node", "server.js"]
