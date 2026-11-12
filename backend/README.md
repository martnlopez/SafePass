# SafePass API

Capa de servicio entre la app (web/PWA) y **Supabase**. La app llama a esta API; la API verifica el
token de Supabase Auth del usuario y llama a Supabase **con ese mismo token**, así que los permisos
(RLS) y las reglas de negocio (descansos, sesiones de evaluación, pase de un solo uso, revocación)
siguen viviendo en un solo lugar: la base (`../supabase/migrations`). Aquí no se duplican.

**Stack:** Node.js 20.19+ · Express 5 · TypeScript · Zod 4 · supabase-js · Vitest.

## Arquitectura

```
HTTP ──► app.ts (helmet · CORS · log con X-Request-Id · límite de tasa · no-store)
          └─► routes ──► authenticateAppUser (token de Supabase)
                          └─► Controller ──► Service ──► Repository ──► Supabase
```

| Capa | Hace | No hace |
|---|---|---|
| `controllers/` | Lee la petición, valida la forma con Zod estricto, elige el código HTTP (201 + `Location`, 200 en el reintento idempotente, 204) | Reglas ni acceso a datos |
| `services/` | Traduce los códigos de las reglas de la base a HTTP (401/403/404/422/429/503) | Conocer `req/res` ni Supabase |
| `repositories/` | Único que conoce Supabase: timeout explícito, token del usuario, mapeo de filas | Reglas de negocio ni HTTP |

`tests/architecture.test.ts` falla si una capa importa lo que no debe.

## Ejecutar

```bash
cd backend
npm install
cp .env.example .env      # completa SUPABASE_URL y SUPABASE_PUBLISHABLE_KEY
npm run dev               # http://localhost:3000
```

| Script | Qué hace |
|---|---|
| `npm run dev` | Servidor con recarga automática |
| `npm run build` / `npm start` | Compila a `dist/` y ejecuta (producción) |
| `npm run typecheck` | Verifica tipos |
| `npm test` | Pruebas de contrato y de capas |

## Variables de entorno

Ver [`.env.example`](./.env.example). Las obligatorias son `SUPABASE_URL` y
`SUPABASE_PUBLISHABLE_KEY` (solo la clave **publicable**: el backend nunca usa `service_role`).
En producción, `CORS_ORIGINS` debe listar los orígenes de la app, sin `*`, y `TRUST_PROXY` debe ser
el número de saltos del proxy (en Render: `1`). Si falta algo, el servidor no arranca y dice qué
variable es, sin mostrar valores.

## Contrato

Las rutas, los errores y los esquemas están en [`openapi.yaml`](./openapi.yaml) y en
[`../docs/CONTRATO-API.md`](../docs/CONTRATO-API.md). Resumen:

- Todo bajo `/api/v1/app/*` y `Authorization: Bearer <token de Supabase>`.
- Errores `{ error: { code, message, details?, requestId } }`; `X-Request-Id` en cada respuesta.
- `POST /app/evaluation-sessions/{id}/result` es idempotente por sesión.
- `GET /health` (vivo) y `GET /health/ready` (Supabase responde).

## Seguridad

- El token se verifica con Supabase (`getClaims`) antes de cualquier operación; sin token válido, 401.
- RLS aplica siempre: cada usuario solo ve lo suyo y el supervisor lo que le corresponde.
- Cuerpos con `strictObject`: un campo de más responde 400.
- `helmet`, CORS por lista de orígenes, límite de tasa por IP, respuestas `no-store`.
- Los logs no incluyen `Authorization`, cookies ni PIN.
- Si Supabase no responde, 503 con `Retry-After` (el cliente reintenta con espera creciente).

## Docker

`Dockerfile` en dos etapas, usuario sin privilegios y healthcheck contra `/health`.
