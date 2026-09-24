FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DATA_DIR=/app/data
COPY package.json server.mjs ./
COPY dist ./dist
RUN mkdir -p /app/data
EXPOSE 8080
CMD ["node", "server.mjs"]
