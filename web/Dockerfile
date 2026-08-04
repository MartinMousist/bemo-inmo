# Imagen de producción del front.
#
# El resultado NO es un servidor Node: son archivos estáticos servidos por
# Caddy, que además hace de proxy hacia la API y resuelve el certificado. Un
# proceso de Node sirviendo un `index.html` es un proceso de más para vigilar.

FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# El typecheck corre ACÁ y no sólo en CI: una imagen de producción que compila
# con errores de tipos es una imagen que no debería existir.
RUN npx vue-tsc --noEmit && npx vite build

FROM caddy:2-alpine AS runtime

# Los assets llevan hash en el nombre (los pone Vite), así que se pueden
# cachear para siempre. El `index.html` NO: es el que apunta a los assets
# nuevos después de cada deploy.
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile

EXPOSE 80 443
