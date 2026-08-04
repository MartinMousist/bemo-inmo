# Poner Bemo INMO en producción

> Los artefactos están escritos y probados hasta donde se puede sin servidor:
> las imágenes compilan, el compose valida y el backup corre. **Lo que NO está
> verificado es un deploy real**, porque no hay dónde hacerlo. Cuando exista el
> servidor, esta guía se sigue y se corrige lo que falle — y ese día se cierra
> el punto del roadmap, no antes.

## Lo que hace falta

| Qué | Para qué | Costo aproximado |
|---|---|---|
| Un VPS con 2 GB de RAM | Corre todo: base, API, front y backup | ~USD 6–12/mes |
| Un dominio | El certificado se emite contra él | ~USD 15/año |
| Un bucket S3, R2 o Spaces | Las fotos de las propiedades | Centavos |
| *(opcional)* Una API key de Google | Ubicar las propiedades en el mapa | Ver `.env.example` |

Con 2 GB alcanza para una inmobiliaria de 500 propiedades: los números medidos
están en la etapa 10 del roadmap. Postgres es el que más memoria pide.

## 1. El servidor

```bash
# En un Debian/Ubuntu limpio
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"   # cerrar sesión y volver a entrar
```

Sólo tres puertos abiertos hacia afuera: **22** (SSH), **80** y **443**. La base
**no** publica ningún puerto — `docker-compose.prod.yml` no le pone `ports` a
propósito. Si algún día hace falta un cliente de SQL, se llega por un túnel SSH:

```bash
ssh -L 5432:localhost:5432 usuario@servidor
```

## 2. El DNS

Un registro `A` del dominio apuntando a la IP del servidor. **Antes** de
levantar: Caddy pide el certificado al arrancar, y si el DNS todavía no resolvió
falla y reintenta con espera creciente.

## 3. El `.env.prod`

```bash
cp .env.example .env.prod
chmod 600 .env.prod          # sólo el dueño: adentro está todo
```

Lo que hay que completar sí o sí:

```bash
DOMINIO=app.tudominio.com.ar
ACME_EMAIL=vos@tudominio.com.ar     # donde avisan si un certificado va a vencer

DB_NAME=bemo_inmo
DB_OWNER_USER=inmo_owner
DB_OWNER_PASSWORD=$(openssl rand -base64 32)
DB_APP_USER=inmo_app
DB_APP_PASSWORD=$(openssl rand -base64 32)

# Mínimo 32 caracteres. La app no levanta si es más corto.
JWT_SECRET=$(openssl rand -base64 48)

S3_ENDPOINT=https://…
S3_BUCKET=bemo-inmo
S3_ACCESS_KEY=…
S3_SECRET_KEY=…
S3_PUBLIC_URL=https://…          # con la que el NAVEGADOR ve los archivos

BACKUP_DIR=/var/backups/bemo-inmo
```

**Generá cada secreto con `openssl`, no a mano.** Una contraseña elegida por una
persona en un `.env` de producción es la que va a estar en la próxima filtración
de contraseñas comunes.

## 4. Levantar

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f api
```

Las migraciones corren solas al arrancar la API: viajan **dentro de la imagen**,
así que el schema y el código no pueden quedar desfasados. El seed de demo no
está en la imagen de producción y además `env.ts` lo rechaza con
`NODE_ENV=production` — dos cerraduras para lo mismo, a propósito.

La primera cuenta se crea desde `https://app.tudominio.com.ar/registrar`.

## 5. Comprobar que quedó bien

```bash
# TLS y redirección
curl -sI http://app.tudominio.com.ar | head -1        # 308 → https
curl -s https://app.tudominio.com.ar/v1/health | jq

# Las cabeceras de seguridad
curl -sI https://app.tudominio.com.ar | grep -iE 'strict-transport|x-frame|x-content'

# La base NO se ve desde afuera. Tiene que dar timeout o "refused".
nc -zv app.tudominio.com.ar 5432
```

Y una prueba que no se hace con `curl`: **entrar, cargar una propiedad y ver que
la foto suba**. Es lo que confirma que S3 está bien configurado, y es lo primero
que falla cuando el `S3_PUBLIC_URL` quedó apuntando al endpoint interno.

## 6. El backup

Corre solo, todos los días a las 03:00, y **se verifica restaurando**: cada dump
se levanta en una base descartable y se cuentan las filas de seis tablas. Si eso
falla, el archivo queda marcado `.INVALIDO` y lo grita en el log.

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod logs backup | tail -20
ls -lh /var/backups/bemo-inmo/
```

**Los backups van a otro lado.** Un backup en el mismo disco que la base no es
un backup: es una copia que se pierde con el mismo incidente. Con `rclone` a
cualquier lado:

```bash
# En el crontab del host
0 5 * * * rclone sync /var/backups/bemo-inmo remoto:bemo-inmo-backups
```

### Restaurar

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod stop api
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T db \
  pg_restore -U inmo_owner -d bemo_inmo --clean --if-exists --no-owner --no-acl \
  < /var/backups/bemo-inmo/bemo-inmo-AAAAMMDD-HHMMSS.dump
docker compose -f docker-compose.prod.yml --env-file .env.prod start api
```

**Probalo una vez, con el sistema andando y sin urgencia.** Un procedimiento de
restauración que sólo se lee no es un procedimiento: es un texto.

## 7. Actualizar

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

Las migraciones nuevas corren al arrancar. Una migración ya aplicada que cambió
hace **fallar** el arranque en vez de seguir: es la señal de que dev y
producción tienen schemas distintos, y seguir sería empeorarlo.

Antes de una actualización que toque el schema, un backup a mano:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec backup \
  sh -c 'BACKUP_AL_ARRANCAR=true /scripts/backup-programado.sh' &
```

## Si algún día hay dos instancias de la API

Poner `RATE_LIMIT_EN_BASE=true` — ya es el default con `NODE_ENV=production`,
pero conviene que sea explícito. Con el contador en la memoria de cada proceso,
dos réplicas llevan cuentas separadas y **el límite de intentos se duplica en
silencio**, que es la peor forma de que un control de seguridad deje de
funcionar.

## Lo que este deploy NO resuelve

Dicho de frente, porque son las preguntas que van a aparecer:

- **No hay alta disponibilidad.** Una sola instancia de cada cosa. Si el
  servidor se cae, el sistema está caído hasta que vuelva. Para una inmobiliaria
  eso suele estar bien; conviene decirlo antes y no después.
- **No hay servicio de errores.** Los logs salen en JSON con su `requestId`,
  listos para un agregador, pero no hay ninguno conectado.
- **No hay métricas.** No se sabe cuántos requests entran ni cuánto tardan.
- **El envío de correos y de WhatsApp sigue sin proveedor.** Los avisos se
  generan y se ven adentro de la app; no salen solos.
