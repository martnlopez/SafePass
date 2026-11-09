# SafePass API

API REST de **SafePass**, un sistema de control de aptitud cognitiva y prevención de fatiga para faenas mineras. Registra las pruebas neurocognitivas **PVT-B** rendidas en tótems de garita, calcula un **dictamen semafórico** (VERDE / AMARILLO / ROJO) y entrega al supervisor HSE un panel para revisar, autorizar re-evaluaciones y anular resultados de forma justificada.

**Stack:** Node.js 20.19+ · Express 5 · TypeScript 7 · Zod 4 · Prisma 7 (adaptador `pg`) · PostgreSQL 14+ · Argon2id · JWT · Vitest

---

## Índice

1. [Arquitectura](#arquitectura)
2. [Estructura de carpetas](#estructura-de-carpetas)
3. [Puesta en marcha paso a paso](#puesta-en-marcha-paso-a-paso)
4. [Scripts](#scripts)
5. [Referencia de la API](#referencia-de-la-api)
6. [Reglas de negocio](#reglas-de-negocio)
7. [Seguridad y protección de datos](#seguridad-y-protección-de-datos)
8. [Despliegue a producción](#despliegue-a-producción)
9. [Solución de problemas](#solución-de-problemas)

---

## Arquitectura

Arquitectura en **3 capas** con dependencias en un solo sentido:

```
HTTP ──► routes ──► middlewares (helmet, CORS, rate limit, JWT, RBAC)
                        │
                        ▼
                 ┌─────────────┐   Captura req/res, valida DTO con Zod,
                 │ Controllers │   responde con el código HTTP semántico.
                 └──────┬──────┘
                        ▼
                 ┌─────────────┐   Lógica de negocio: dictamen semafórico,
                 │  Services   │   reglas de re-evaluación, cifrado, seudonimización,
                 └──────┬──────┘   bloqueo de cuentas, auditoría.
                        ▼
                 ┌──────────────┐  Único acceso a PostgreSQL (Prisma). Devuelven
                 │ Repositories │  tipos de dominio, no modelos de Prisma.
                 └──────────────┘
```

- Los **services** no importan Prisma: dependen de interfaces de repositorio (`WorkerRepository`, `EvaluationRepository`, …).
- `src/container.ts` arma las dependencias a mano (repositorios → servicios → controllers). Los tests inyectan repositorios en memoria y un reloj controlado.
- Los errores de dominio (`AppError`) se traducen a JSON en un único `errorHandler`.

## Estructura de carpetas

```
backend/
├── prisma/
│   ├── schema.prisma            Modelos Worker, Totem, Evaluation, AuditLog
│   ├── migrations/              SQL versionado (incluye trigger de auditoría y CHECKs)
│   └── seed.ts                  Crea la cuenta ADMIN (y cuentas demo opcionales)
├── scripts/
│   ├── generate-keys.ts         Genera JWT_SECRET, PIN_PEPPER y claves de cifrado
│   └── create-totem.ts          Registra un tótem y muestra su clave una sola vez
├── src/
│   ├── config/env.ts            Variables de entorno validadas con Zod al arrancar
│   ├── lib/                     crypto (AES-256-GCM + HMAC) · pin (Argon2id) · tokens (JWT)
│   │                            · rut (módulo 11) · logger (pino) · prisma
│   ├── errors/app-error.ts      Errores HTTP semánticos y de dominio
│   ├── middlewares/             authenticate/authorize/requireTotemKey · rate-limiters · error-handler
│   ├── schemas/                 DTOs Zod (auth, workers, evaluations, paginación)
│   ├── controllers/             auth · worker · evaluation · health
│   ├── services/                auth · worker · evaluation · scoring · audit · health
│   ├── repositories/            worker · evaluation · totem · audit-log · health
│   ├── routes/index.ts          Rutas /api/v1 y matriz RBAC
│   ├── types/                   Tipos de dominio y de autenticación
│   ├── generated/prisma/        Cliente Prisma (generado, no se versiona)
│   ├── container.ts             Inyección de dependencias
│   ├── app.ts                   Configuración de Express
│   └── server.ts                Arranque y apagado ordenado
├── tests/                       Vitest + Supertest (sin base de datos)
├── docker-compose.yml           PostgreSQL local
├── prisma.config.ts             Configuración de Prisma 7
├── .env.example                 Todas las variables, comentadas
├── package.json · tsconfig.json · tsconfig.build.json · vitest.config.ts
```

## Puesta en marcha paso a paso

### Requisitos

- **Node.js 20.19 o superior** (Prisma 7 lo exige). Comprueba con `node -v`.
- **PostgreSQL 14+**: con Docker (recomendado) o una instalación propia.

### 1. Clonar e instalar

```bash
git clone <url-del-repositorio> safepass
cd safepass/SafePass-main/backend
npm install
```

`npm install` ejecuta `prisma generate` automáticamente (script `postinstall`).

### 2. Configurar variables de entorno

```bash
cp .env.example .env
npm run keys:generate
```

Copia las cuatro líneas que imprime `keys:generate` (`JWT_SECRET`, `PIN_PEPPER`, `FIELD_ENCRYPTION_KEY`, `BLIND_INDEX_KEY`) dentro de `.env`. Luego completa:

- `POSTGRES_PASSWORD` y la misma clave dentro de `DATABASE_URL`.
- `SEED_ADMIN_RUT`, `SEED_ADMIN_NAME` y `SEED_ADMIN_PIN` (6 dígitos, no triviales).

> ⚠️ `.env` nunca se sube al repositorio. Respalda `FIELD_ENCRYPTION_KEY` y `PIN_PEPPER` en un gestor de secretos: si se pierden, los RUT cifrados son irrecuperables y todos los PIN dejan de ser válidos.

La API valida todas las variables al arrancar y, si falta o sobra algo, indica qué corregir sin mostrar valores.

### 3. Levantar PostgreSQL

**Con Docker:**

```bash
docker compose up -d
```

**Sin Docker:** crea una base de datos y un usuario en tu PostgreSQL y ajusta `DATABASE_URL` en `.env`.

### 4. Crear las tablas (migraciones)

```bash
npm run prisma:deploy
```

Aplica `prisma/migrations/`: tablas, índices, el trigger que hace la bitácora de solo inserción y los CHECK de rangos. Si más adelante modificas `schema.prisma`, crea una migración nueva con `npm run prisma:migrate -- --name descripcion_del_cambio`.

### 5. Cargar datos iniciales

```bash
npm run db:seed
npm run totem:create -- --name "Garita Norte" --location "Acceso principal"
```

- El seed crea la cuenta **ADMIN** definida en `.env`. Con `SEED_DEMO_WORKERS=true` también crea cuentas ficticias (`TRB-0512` operador, `TRB-0513` supervisora, `TRB-0431` operadora) con `SEED_DEMO_PIN`.
- `totem:create` muestra **una sola vez** la clave del dispositivo (`<id>.<secreto>`). Configúrala en el tótem como header `X-Totem-Key`. En la base de datos solo queda su hash SHA-256.

### 6. Ejecutar

```bash
npm run dev          # desarrollo con recarga automática → http://localhost:3000
```

Comprueba que responde:

```bash
curl http://localhost:3000/health/ready
```

Respuesta esperada: `{"status":"ok","database":"up"}`.

### 7. Tests

```bash
npm test             # 33 tests: reglas de negocio, RBAC, validación, cifrado, rate limit
npm run typecheck
```

Los tests usan repositorios en memoria y secretos aleatorios, así que no requieren base de datos ni `.env`.

## Scripts

| Script | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo con recarga (`tsx watch`) |
| `npm run dev:once` | Servidor de desarrollo sin recarga |
| `npm run build` | Genera el cliente Prisma y compila a `dist/` |
| `npm start` | Ejecuta la versión compilada (`dist/server.js`) |
| `npm test` / `npm run test:watch` | Tests con Vitest |
| `npm run typecheck` | Verificación de tipos de todo el proyecto |
| `npm run prisma:deploy` | Aplica migraciones pendientes (usar en todos los entornos) |
| `npm run prisma:migrate` | Crea una migración nueva tras cambiar `schema.prisma` (solo desarrollo) |
| `npm run prisma:generate` | Regenera el cliente Prisma |
| `npm run prisma:studio` | Explorador visual de la base de datos |
| `npm run db:seed` | Crea la cuenta ADMIN (y las demo, si se piden) |
| `npm run totem:create -- --name "…"` | Registra un tótem y muestra su clave |
| `npm run keys:generate` | Genera secretos aleatorios para `.env` |

## Referencia de la API

Base: `http://localhost:3000/api/v1` · JSON · autenticación `Authorization: Bearer <token>`.

### Endpoints y permisos (RBAC)

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| `POST` | `/auth/login` | Público (rate limit) | Login del panel: Ficha ID + PIN → JWT (solo SUPERVISOR y ADMIN) |
| `POST` | `/auth/totem/session` | `X-Totem-Key` (rate limit) | Abre una sesión de evaluación para un trabajador → token TOTEM |
| `GET` | `/auth/me` | SUPERVISOR · ADMIN | Usuario autenticado |
| `POST` | `/workers` | ADMIN | Crear operador (PIN con hash, RUT cifrado) |
| `GET` | `/workers` | SUPERVISOR · ADMIN | Listar, filtrado por `crew`, `role` e `includeInactive`; paginado |
| `GET` | `/workers/:id` | SUPERVISOR · ADMIN | Detalle por UUID |
| `PUT` | `/workers/:id` | ADMIN | Actualizar datos, cuadrilla, rol, estado o restablecer PIN |
| `DELETE` | `/workers/:id` | ADMIN | Soft-delete (desactivación) |
| `POST` | `/evaluations` | TOTEM | Registrar las métricas de la prueba (el servidor calcula el dictamen) |
| `GET` | `/evaluations` | SUPERVISOR · ADMIN | Listado para el dashboard: `status`, `from`, `to`, `totemId`, `workerId`, `includeVoided`; paginado |
| `GET` | `/evaluations/:id` | SUPERVISOR · ADMIN | Detalle, con la observación descifrada |
| `PUT` | `/evaluations/:id` | SUPERVISOR · ADMIN | Decisión, observación y ajuste justificado del dictamen |
| `DELETE` | `/evaluations/:id` | ADMIN | Anulación justificada (body `{ "reason": "…" }`) |
| `GET` | `/health`, `/health/ready` | Público | Proceso vivo / base de datos disponible |

**Paginación obligatoria** en todos los `GET` de listado: `page` (por defecto 1) y `pageSize` (por defecto 20, máximo 100). La respuesta tiene esta forma:

```json
{ "data": [ … ], "meta": { "page": 1, "pageSize": 20, "total": 57, "totalPages": 3 } }
```

### Flujo en el tótem

```bash
# 1. El trabajador se identifica en el tótem → token de sesión (10 min, sin datos de identidad)
curl -X POST http://localhost:3000/api/v1/auth/totem/session \
  -H "Content-Type: application/json" -H "X-Totem-Key: $TOTEM_KEY" \
  -d '{"fichaId":"TRB-0512","pin":"<pin>"}'

# 2. Al terminar la prueba, el tótem envía solo métricas crudas
curl -X POST http://localhost:3000/api/v1/evaluations \
  -H "Content-Type: application/json" -H "Authorization: Bearer $SESSION_TOKEN" \
  -d '{"meanLatencyMs":380,"medianReactionTimeMs":360,"omissions":5,"falseStarts":0,"totalStimuli":35,"durationSeconds":180}'
```

```json
{ "id": "…", "score": 71, "status": "AMARILLO", "scoringVersion": "pvtb-1.0",
  "nextStep": { "action": "DESCANSO_Y_REEVALUACION", "retestAvailableAt": "2026-09-29T08:05:00.000Z" } }
```

### Flujo del supervisor

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login -H "Content-Type: application/json" \
  -d '{"fichaId":"TRB-0513","pin":"<pin>"}' | jq -r .accessToken)

# Casos NO APTO del turno
curl "http://localhost:3000/api/v1/evaluations?status=ROJO&from=2026-09-28T00:00:00-03:00&pageSize=50" \
  -H "Authorization: Bearer $TOKEN"

# Autorizar un segundo intento
curl -X PUT http://localhost:3000/api/v1/evaluations/<id> -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"decision":"AUTORIZAR_REEVALUACION","note":"Descanso de 30 min e hidratación"}'
```

Decisiones posibles: `AUTORIZAR_REEVALUACION`, `REASIGNACION_TAREA`, `DERIVACION_POLICLINICO`, `SUSPENSION_TURNO`.

### Errores

Todas las respuestas de error tienen el mismo formato:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Los datos enviados no son válidos",
             "details": [{ "path": "pin", "message": "El PIN debe tener exactamente 6 dígitos" }],
             "requestId": "3f0c…" } }
```

| HTTP | Cuándo |
|---|---|
| `200` / `201` | Éxito. `201` al crear, con header `Location` |
| `400` | DTO inválido, campos no permitidos, JSON mal formado, paginación fuera de rango |
| `401` | Sin token, token inválido o vencido, credenciales incorrectas, clave de tótem inválida |
| `403` | Rol sin permiso, operador en el panel, cuenta desactivada, re-evaluación pendiente de autorización (ROJO) |
| `404` | Recurso o ruta inexistente |
| `409` | Ficha ID o RUT duplicados, sesión de tótem ya usada, evaluación ya anulada |
| `413` | Cuerpo mayor que `JSON_BODY_LIMIT` |
| `429` | Rate limit, cuenta bloqueada por intentos fallidos o descanso AMARILLO. Incluye `Retry-After` |
| `500` | Error no controlado (sin detalles internos; buscar por `requestId` en el log) |

## Reglas de negocio

### Dictamen semafórico (`src/services/scoring.service.ts`)

El tótem envía **métricas crudas**. El puntaje y el dictamen **siempre los calcula el servidor**: un cliente no puede enviar `score` ni `status`.

- **Precisión** = 1 − (omisiones + falsas partidas) / estímulos. Es el *performance score* de Basner & Dinges.
- **Latencia**: 250 ms o menos obtiene el puntaje máximo; 500 ms o más no suma.
- **Puntaje** = 100 × (0,6 × precisión + 0,4 × factor de latencia).

| Puntaje | Dictamen | Significado |
|---|---|---|
| 80 – 100 | `VERDE` | Apto |
| 60 – 79 | `AMARILLO` | Re-evaluación tras descanso preventivo |
| 0 – 59 | `ROJO` | No apto |

Los tramos son los mismos que muestra el tótem. Los pesos y umbrales son **referenciales** y deben validarse con un estudio psicométrico. Si cambias la fórmula, sube `SCORING_VERSION`: cada evaluación guarda la versión con la que se calculó.

### Re-evaluación

| Último resultado | ¿Puede volver a rendir? |
|---|---|
| `VERDE` | Sí |
| `AMARILLO` | Después de `RETEST_COOLDOWN_MINUTES` (5 min). Antes → `429` con `Retry-After` |
| `ROJO` | **Sin temporizador**: solo si el supervisor registra `AUTORIZAR_REEVALUACION` (si no → `403`) |
| Decisión `SUSPENSION_TURNO` o `DERIVACION_POLICLINICO` | Solo con una nueva autorización del supervisor |

- Una evaluación **anulada** deja de contar para estas reglas y no aparece en el listado, salvo con `includeVoided=true`.
- Cada sesión de tótem registra **una sola** evaluación. Un reenvío responde `409`.
- El supervisor puede cambiar el dictamen vigente (`status`) solo si incluye una observación. El dictamen original del algoritmo (`computedStatus`) nunca se modifica.

## Seguridad y protección de datos

**Autenticación y autorización**
- JWT HS256 con algoritmo fijo, `issuer` y `audience` obligatorios, y las claims validadas con Zod.
- En cada petición, el rol del staff se lee de nuevo desde la base de datos: desactivar o degradar una cuenta aplica de inmediato, aunque el usuario tenga un token vigente.
- Los tótems se autentican con una clave de dispositivo (`X-Totem-Key`). Los trabajadores se autentican con Ficha ID + PIN. El token de sesión dura 10 minutos y solo lleva el **seudónimo** del trabajador.
- Hay bloqueo de cuenta tras `LOGIN_MAX_ATTEMPTS` intentos fallidos, con un contador atómico en la base de datos.
- El mensaje de error es el mismo si la ficha no existe o si el PIN es incorrecto, y ambos casos toman el mismo tiempo de respuesta. Así no se pueden enumerar fichas.

**Ley 19.628 / Ley 21.719 (datos sensibles de salud)**
- **PIN:** se guarda como Argon2id (19 MiB, t=2) sobre HMAC-SHA256(PIN, `PIN_PEPPER`). El pepper vive fuera de la base de datos, así que filtrar la BD no basta para descubrir los PIN por fuerza bruta. Los PIN triviales se rechazan.
- **Seudonimización:** `evaluations.subject_id` es un UUID v4 aleatorio (`workers.pseudonym_id`), sin clave foránea. Las evaluaciones no guardan id, RUT ni Ficha ID. Solo SUPERVISOR y ADMIN pueden re-identificar, a través de la API, y esa consulta queda auditada.
- **Cifrado de campos:** el RUT y las observaciones del supervisor se cifran con AES-256-GCM, usando AAD por campo. La unicidad del RUT se controla con un índice ciego HMAC.
- **Minimización:** SUPERVISOR ve el RUT enmascarado (`**.***.678-5`) y solo ADMIN lo ve completo. El listado de evaluaciones no incluye observaciones. La API nunca devuelve hashes ni seudónimos.
- **Bitácora:** `audit_logs` registra accesos y cambios (quién, qué, cuándo, IP y `requestId`), sin PIN, RUT ni métricas. Un **trigger en la BD** impide `UPDATE` y `DELETE`.

**Anti-scraping y endurecimiento**
- `helmet`, CORS restringido a `CORS_ORIGINS`, `Cache-Control: no-store` en toda la API y límite de tamaño del cuerpo.
- **Rate limit** general por IP, en login (cuenta solo intentos fallidos) y en el envío de evaluaciones (por tótem). Las respuestas llevan las cabeceras estándar `RateLimit`.
- **Paginación obligatoria** con máximo de 100 resultados por página.
- `z.strictObject` rechaza campos no declarados, lo que evita la asignación masiva de campos como `pinHash` o `role`.
- **Logs** estructurados con `pino`, con redacción de `Authorization`, `X-Totem-Key`, `pin` y `rut`, y un id de correlación `X-Request-Id`.
- **Secretos:** ninguno está en el código. Todos vienen de `.env`, validados al arrancar.

## Despliegue a producción

1. `NODE_ENV=production`, con `CORS_ORIGINS` explícito (la API no arranca si falta o incluye `*`).
2. Guarda los secretos en un gestor (Vault, AWS/GCP Secret Manager, Azure Key Vault), no en archivos del servidor.
3. HTTPS obligatorio: termina TLS en un proxy o balanceador y ajusta `TRUST_PROXY` al número de saltos.
4. `npm ci && npm run build && npm run prisma:deploy && npm start`.
5. Con más de una réplica, usa un store compartido para el rate limit (p. ej. `rate-limit-redis`).
6. Usa un usuario de PostgreSQL con permisos mínimos y conexión con `sslmode=require`.
7. Configura `/health` como sonda de *liveness* y `/health/ready` como sonda de *readiness*.
8. Define una política de retención para `evaluations` y `audit_logs` según los Términos y Condiciones.

## Solución de problemas

| Síntoma | Solución |
|---|---|
| `Configuración inválida. Revisa tu archivo .env` | El mensaje indica qué variable falta o es inválida. Las claves de cifrado deben ser 32 bytes en base64 (`npm run keys:generate`) |
| `Cannot find module '../generated/prisma/client.js'` | Ejecuta `npm run prisma:generate` |
| `P1001: Can't reach database server` | PostgreSQL no está arriba o `DATABASE_URL` no coincide (`docker compose ps`) |
| `P3005: The database schema is not empty` | La BD ya tiene tablas creadas fuera de las migraciones. Usa una BD vacía o sigue la guía de *baselining* de Prisma |
| `429 ACCOUNT_LOCKED` | Espera `LOGIN_LOCKOUT_MINUTES`, o un ADMIN puede restablecer el PIN con `PUT /workers/:id` (`{"pin":"…"}`), lo que también desbloquea la cuenta |
| `npm warn install-scripts … argon2` (npm 11+) | Es solo un aviso: `argon2` trae binarios precompilados para Windows, macOS y Linux. Si falla al cargar, ejecuta `npm install-scripts approve argon2` y reinstala |
