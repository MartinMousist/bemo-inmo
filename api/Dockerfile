# Imagen de producción: multi-stage, sin devDependencies, usuario sin privilegios.

FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
# Las migraciones viajan con la imagen: la misma versión del código y del schema.
COPY --from=build /app/migrations ./migrations

# El seed demo NO se copia: no existe manera de correrlo en producción por accidente.

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/v1/health/live >/dev/null || exit 1

CMD ["node", "dist/main.js"]
