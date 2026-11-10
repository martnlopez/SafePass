# API SafePass (Express + Prisma). Imagen en dos etapas: compila con todas las
# dependencias y ejecuta solo con las de producción, como usuario sin privilegios.
# Los secretos NO se copian: se entregan como variables de entorno al ejecutar
# (ver .env.example). Las migraciones se aplican aparte, antes de desplegar:
#   docker build --target build -t safepass-api-build . && \
#   docker run --rm -e DATABASE_URL=... safepass-api-build npx prisma migrate deploy

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# postinstall ejecuta "prisma generate" (no necesita conexión a la base)
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
USER node
EXPOSE 3000
# Sondeo de vida contra /health (sin dependencias extra: fetch nativo de Node)
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/server.js"]
