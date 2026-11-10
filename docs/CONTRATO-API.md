# Contrato de la API de SafePass

SafePass expone sus capacidades por **dos contratos**:

| Contrato | Quién lo usa | Fuente de verdad |
|---|---|---|
| **Supabase** (PostgREST + RPC + Realtime) | La app web/PWA de trabajadores y supervisores | Este documento + `supabase/migrations/` |
| **API REST Express** (`/api/v1`) | Tótems e integradores (panel HSE) | [`backend/openapi.yaml`](../backend/openapi.yaml) |

Reglas comunes: el cliente **nunca decide** (puntaje, estado, vigencia del pase y permisos los
calcula el servidor); fechas en UTC; errores con código de máquina + mensaje para la persona.

## 1. Entidades

```
workers (1) ──< evaluations (N)        un trabajador rinde muchas evaluaciones
workers (1) ──< decisions (N)          el supervisor registra decisiones sobre un trabajador
workers (1) ──< access_passes (N)      pases emitidos al trabajador
workers (1) ──< evaluation_sessions (N)  (privada) sesiones abiertas por start_evaluation
evaluation_sessions (1) ── (0..1) evaluations
```

## 2. Inventario — contrato Supabase

| Recurso / función | Operación | Quién | Para qué |
|---|---|---|---|
| `workers` | SELECT | trabajador (propio, cuenta activa) · supervisor (todos) | Perfil y panel |
| `evaluations`, `latest_evaluations` | SELECT | ídem | Historial y panel en vivo |
| `decisions`, `latest_decisions` | SELECT | ídem | Avisos al trabajador y panel |
| `decisions` | INSERT | supervisor activo, **no sobre sí mismo** | Registrar una decisión |
| `access_passes` | SELECT | ídem | Volver a mostrar el pase vigente |
| `rpc/start_evaluation()` → `uuid` | POST | trabajador activo | Abre la sesión del test (aplica descansos y autorizaciones) |
| `rpc/submit_evaluation(p_session_id, p_breakdown)` → evaluación | POST | dueño de la sesión | Registra el resultado; **idempotente por sesión** (`replayed: true` en el eco) |
| `rpc/issue_access_pass()` → pase | POST | trabajador activo | Emite o recupera el pase vigente (idempotente) |
| `rpc/validate_pass(p_code)` → estado | POST | supervisor | Valida un pase: `valid` · `expired` · `revoked` · `invalid` |
| `rpc/start_authorized_retest(p_decision_id)` | POST | trabajador | Consume un re-test autorizado tras el descanso |
| `rpc/mark_decision_seen(p_decision_id)` | POST | trabajador | Marca el aviso como visto |
| Realtime `evaluations`, `decisions` | suscripción | según RLS | Panel del supervisor en vivo |

No hay escritura directa del cliente en `evaluations`, `workers` ni `access_passes`.

## 3. Situaciones y errores — contrato Supabase

| Código (`message`) | Cuándo | ¿Reintentar? | Qué muestra la app |
|---|---|---|---|
| `NOT_AUTHENTICATED` | Sin sesión | No: volver a iniciar sesión | Pantalla de ingreso |
| `ACCOUNT_DISABLED` | Cuenta desactivada | No | "Tu cuenta no está habilitada…" |
| `EVALUATION_TOO_SOON` | < 2 min desde la última evaluación | Sí, después | "Ya registraste una evaluación hace menos de 2 minutos." |
| `RETEST_COOLDOWN` | SEMI-APTO hace < 5 min | Sí, tras el descanso | Cuenta regresiva |
| `SUPERVISOR_AUTHORIZATION_REQUIRED` | NO APTO u otra decisión pendiente | No | "Tu último resultado requiere una indicación…" |
| `TOO_MANY_SESSIONS` | ≥ 10 sesiones en 1 h | No | "Demasiados intentos… avisa a tu supervisor." |
| `EVALUATION_SESSION_INVALID` | Sesión ajena o inexistente | No: iniciar otra | "La sesión de evaluación ya no es válida…" |
| `EVALUATION_TOO_FAST` | Envío < 60 s después de iniciar | No | "La evaluación terminó demasiado rápido…" |
| `EVALUATION_SESSION_EXPIRED` | Envío > 30 min después de iniciar | No | "La evaluación tardó demasiado…" |
| `INVALID_BREAKDOWN` | Desglose con forma inválida | No | "El resultado llegó incompleto…" |
| `RETEST_REST_PENDING` | Re-test antes de 15 min | Sí, tras el descanso | Cuenta regresiva |
| `DECISION_NOT_FOUND` | Decisión inexistente o de otro tipo | No | "La decisión ya no está disponible." |
| `PASS_NOT_ALLOWED` | Sin APTO vigente ni pase excepcional disponible | No | "No hay un resultado APTO vigente…" |
| `SELF_DECISION_NOT_ALLOWED` | Supervisor decide sobre sí mismo | No | "Debe hacerlo otro supervisor." |
| `NOT_ALLOWED` | Rol insuficiente | No | "No tienes permiso…" |
| Red / timeout (15 s) | Sin señal o servidor lento | **Sí, automático** con espera creciente (1 s, 3 s, 7 s) al enviar el test | "Sin conexión…" + botón **Reintentar envío** |

## 4. Contrato REST Express (resumen)

Ver la especificación completa en [`backend/openapi.yaml`](../backend/openapi.yaml). Puntos clave:
`/api/v1` · JWT Bearer para personal y sesión de tótem · `X-Totem-Key` para abrir sesión ·
paginación `page`/`pageSize` (tope 100) con `{ data, meta }` · `201 + Location` al crear ·
`POST /evaluations` idempotente por sesión (`200` + `replayed: true` en el reintento) ·
`429 + Retry-After` · errores `{ error: { code, message, details, requestId } }`.

## 5. Changelog

| Fecha | Cambio | ¿Rompe? |
|---|---|---|
| 2026-11-10 | `submit_evaluation` devuelve la misma evaluación en reintentos (`replayed`) | No (campo nuevo) |
| 2026-11-10 | API REST: `POST /evaluations` responde `200` + eco en reintentos (antes `409`) y agrega `Location`; `Location` de `POST /workers` corregido a `/api/v1/workers/{id}` | Sí para quien esperaba 409 (sin clientes en producción) |
| 2026-11-10 | Evaluaciones solo vía `start_evaluation` / `submit_evaluation`; nuevo `validate_pass`; pase excepcional de un solo uso | Sí (sin clientes externos; la app se actualizó a la vez) |
| 2026-11-09 | Conexión directa de la app a Supabase con RLS | — |
