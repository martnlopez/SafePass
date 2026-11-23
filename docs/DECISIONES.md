# Registro de decisiones de arquitectura (SafePass)

Cada decisión: contexto, criterios, elegido y **"reconsideraríamos si…"** (condiciones medibles).

## D7 · Una sola API: la app pasa por el backend (reemplaza a D1) — 2026-11-10

**Contexto.** El prompt de arquitectura pide una API para todos los clientes (§8.3) y una sola
fuente de verdad (§1). Con D1, la app y los tótems usaban contratos y bases distintas.

| Criterio | App → Supabase directo (D1) | App → API SafePass → Supabase (D7) |
|---|---|---|
| Contrato para web, tótem e integradores | Dos | Uno (`/api/v1`, OpenAPI) |
| Dónde viven las reglas | Base (RLS + RPC) | **La misma base**: el backend reenvía el token del usuario y no duplica reglas |
| Formato de error, límites de tasa, correlación (`X-Request-Id`) | Los de Supabase | Los del contrato propio |
| Operación | Solo Supabase | Supabase + un servidor Node (más piezas) |
| Latencia | 1 salto | 2 saltos |

**Elegido:** la app usa `/api/v1/app/*` para el perfil, el test, los pases y las decisiones. El
backend verifica el token de Supabase Auth y llama a Supabase **con ese mismo token** (patrón BFF,
§8.4: adapta y orquesta, no decide). Sigue directo a Supabase solo lo que la API no puede dar:
el **inicio de sesión** (Supabase Auth es el proveedor de identidad) y los **paneles en vivo del
supervisor** (Realtime: el backend no tiene canal de empuje).
**Reconsideraríamos si:** el doble salto se vuelve un problema de latencia medido; o se agrega un
canal en vivo al backend (SSE/WebSocket), en cuyo caso los paneles también pasarían por la API.
**Deuda de D1 pagada:** el sistema antiguo del tótem y el panel HSE se eliminó (ver D8).

## D1 · La app habla directo con Supabase (reemplazada por D7)

**Contexto (2026-11-09).** Equipo de 1–3 personas, sin plataforma de operación propia. La app
necesita autenticación, datos con permisos por fila y avisos en tiempo real.

| Criterio | Supabase directo (RLS + RPC) | App → Express → BD |
|---|---|---|
| Esfuerzo de operación | Bajo (servicio gestionado) | Alto (servidor, despliegue, guardia) |
| Reglas en el servidor | Sí: RLS, triggers y RPC `SECURITY DEFINER` | Sí: capa de servicios |
| Tiempo real | Incluido (Realtime) | Hay que construirlo |
| Pruebas automáticas de reglas | Más difíciles (SQL) | Fáciles (41 pruebas en Vitest) |
| Portabilidad | Atada a Supabase/PostgreSQL | Alta |

**Elegido:** Supabase directo para la app; el backend Express queda para tótems e integradores.
**Reconsideraríamos si:** aparece un integrador externo que necesita un contrato REST estable;
las reglas de negocio superan lo mantenible en SQL; o se exige auditoría/log centralizado que
Supabase no cubre.

**Deuda reconocida:** hay dos modelos para lo mismo (Supabase: `apto/semi/no` y 6 decisiones;
Express: `VERDE/AMARILLO/ROJO` y 4 decisiones), lo que va contra "una fuente de verdad" (§1).
Pago por cuotas: (1) definir el vocabulario canónico en `docs/CONTRATO-API.md`; (2) cuando el
tótem use Express, que lea y escriba la misma base que Supabase; (3) retirar el modelo duplicado.

## D2 · Monolito (no microservicios)

Señales medidas (§7.4): 1 equipo pequeño · sin fila de despliegue · sin módulo con carga o
certificación dispar · ritmos de cambio parejos → **todas en verde**. Prerrequisitos para
distribuir: observabilidad centralizada ✗, orquestación ✗ (CI ✓ desde 2026-11-10).
**Elegido:** monolito bien capeado (controller → service → repository, verificado por
`backend/tests/architecture.test.ts`).
**Reconsideraríamos si:** el equipo supera 8 personas con la fila de despliegue doliendo; un
módulo exige hardware o certificación propia; o el ritmo de cambio de un dominio se separa de
forma sostenida.

## D3 · PWA (no app nativa ni multiplataforma)

La app corre en tótems y teléfonos de faena; necesita instalación sencilla y actualización
inmediata, no push ni acceso profundo al dispositivo (solo cámara para el QR, disponible en web).
**Elegido:** PWA (manifiesto + service worker que cachea solo archivos estáticos).
**Reconsideraríamos si:** se requieren notificaciones push confiables, modo sin señal completo
o integración con hardware del tótem (lectores, kiosco bloqueado a nivel de sistema).

## D4 · Autoridad del test en el servidor

El puntaje, el estado, la hora y la duración los fija el servidor; el cliente solo puede enviar
dentro de una sesión emitida por el servidor (≥ 60 s, un envío por sesión).
**Riesgo residual aceptado:** un cliente programado podría abrir una sesión, esperar y enviar un
desglose falso: el navegador del trabajador no es de fiar (§8.10).
**Reconsideraríamos si (y cómo cerrarlo):** al desplegar en tótems, usar un dispositivo en modo
kiosco administrado y que el servidor reciba los ensayos crudos y calcule cada puntaje.

## D5 · Idempotencia por sesión en vez de cabecera `Idempotency-Key`

El envío del test ya trae una clave natural única generada por el servidor: la sesión
(`p_session_id`, generado por `start_evaluation`). Reenviar con la misma sesión
devuelve la misma evaluación (eco). Una cabecera adicional sería redundante.
**Reconsideraríamos si:** aparecen otras creaciones por POST sin clave natural (p. ej. altas de
pases o decisiones desde un integrador con red inestable): ahí sí, `Idempotency-Key`.

## D6 · Sin cola offline persistente en el dispositivo

Si el envío falla por red, el resultado queda **en memoria** y el trabajador puede pulsar
"Reintentar envío" (además de 3 reintentos automáticos con espera creciente). No se guarda en
`localStorage`: los tótems son compartidos y un resultado de salud no debe quedar en el equipo
para el siguiente trabajador (Ley 19.628 / 21.719).
**Reconsideraríamos si:** la faena opera sin señal por turnos completos; entonces, una cola
cifrada por trabajador y borrada al cerrar sesión.
**Actualización 2026-11-23 (D10):** el resultado sigue solo en memoria, pero ahora se reenvía
solo al volver la señal y el servidor conserva su hora real de término (plazo de 2 h).

## D8 · Se elimina el sistema antiguo del tótem y el panel HSE — 2026-11-12

**Contexto.** El backend traía un primer diseño con su propia base (PostgreSQL + Prisma), su propio
inicio de sesión (JWT) y otro modelo de datos (`VERDE/AMARILLO/ROJO`, prueba PVT única, 4
decisiones). Desde D7 la app no lo usaba, y mantener dos modelos iba contra la fuente única de
verdad (§1).

| Opción | Costo | Resultado |
|---|---|---|
| Dejarlo y documentarlo | Cero ahora | Dos modelos y una base sin uso; confunde y se desactualiza |
| Migrarlo a Supabase | Alto: reescribir tótem y panel | Funcionalidad que hoy nadie usa |
| **Eliminarlo** | Medio, una vez | Un solo modelo, menos superficie de ataque, menos secretos que cuidar |

**Elegido:** eliminarlo. Se retiraron Prisma, la base propia, el JWT propio, Argon2, el cifrado de
RUT, las rutas `/auth/*`, `/workers` y `/evaluations`, y sus ~40 pruebas. El backend quedó en
`/api/v1/app/*` más `/health`, con Supabase como única fuente de datos, y no necesita secretos
propios. El código queda en el historial de git (commit `fc3b456` y anteriores) por si se
recupera.
**Reconsideraríamos si:** se necesita un lector de credenciales o tótem con clave de dispositivo,
o un panel para otra audiencia (por ejemplo HSE de la empresa). Se construiría sobre las mismas
tablas de Supabase y el vocabulario `apto/semi/no`, no sobre el modelo anterior.

## D9 · Resultados sospechosos: señal, no bloqueo — 2026-11-12

El navegador del trabajador nunca es de fiar (§8.10): un programa hecho a medida puede abrir una
sesión, esperar y enviar puntajes inventados. Cerrarlo del todo exige que el servidor puntúe
datos crudos (reescribir los 5 tests) o un dispositivo administrado. Mientras tanto, el servidor
**marca** los resultados atípicos (`flags` en la evaluación) y el panel del supervisor los muestra
como "Revisar"; no bloquea a nadie, porque un falso positivo no debe impedir la entrada a faena.
Las marcas solo las ve el supervisor, para que el trabajador no aprenda dónde está el umbral.
**Reconsideraríamos si:** hay evidencia de abuso real; entonces, puntuar en el servidor.

## D10 · Cortes de señal: envío diferido en memoria (no modo sin señal) — 2026-11-23

**Contexto.** En faena la señal se corta. Hasta ahora, si se cortaba después de empezar el test, el
resultado quedaba en memoria con 3 reintentos y un botón manual, pero el servidor fijaba la hora del
test **al llegar** el envío y rechazaba lo que llegara más de 30 min después de empezar: un test
hecho a las 08:10 que llegaba a las 08:50 se perdía, o quedaba con una hora que no era la real (y
con eso cambiaban el turno, el descanso de SEMI APTO y la vigencia de 12 h del pase).

**Opciones evaluadas.**

| Criterio | 1 · Envío diferido (elegida) | 2 · Tótem que opera horas sin señal | 3 · Servidor local en faena |
|---|---|---|---|
| Qué resuelve | Cortes durante o después del test | Turnos completos sin señal | Faena aislada completa |
| Inicio de sesión sin señal | No | Sí: credencial QR firmada + PIN verificado en el tótem | Sí: autenticación local |
| Quién decide APTO y firma el pase | El servidor (como hoy) | El tótem, sin conexión | El servidor local |
| Datos de salud en el equipo | Solo en memoria hasta enviarse | Cola cifrada en el tótem | Base de datos en faena |
| Riesgos nuevos | Ninguno relevante (ver análisis) | Robo del tótem (llave y cola), PIN de 6 dígitos atacable sin conexión, descansos y reintentos aplicables solo dentro de cada tótem, pases provisorios falsificables si se filtra la llave | Un servidor más que proteger, parchar y respaldar en terreno; sincronización y conflictos |
| Requisitos | Ninguno | Tótems administrados en modo kiosco, revocación de equipos, validador con firmas | Hardware, instalación y soporte en faena |
| Esfuerzo | 1–2 días | 2–3 semanas | Semanas, más operación continua |

**Elegido (por ahora): opción 1.** Es la que cubre el caso real de hoy (la señal se corta a ratos)
sin mover la autoridad fuera del servidor. Las opciones 2 y 3 cambian el modelo de seguridad: el
tótem o un servidor en faena pasan a decidir quién entra, y eso exige equipos administrados,
llaves, revocación y operación en terreno que el proyecto aún no tiene. Hacerlas a medias
subiría el riesgo, que es justo lo que se quiere evitar.

**Cómo funciona.**
- El inicio de sesión y el comienzo del test siguen requiriendo señal (los emite el servidor).
- Si la señal se corta, el resultado queda **solo en memoria** (nunca en el disco del tótem, D6) y la
  app lo reenvía sola al volver la conexión y cada 20 s. Si la persona intenta salir, se le avisa
  que se perderá. Mientras está pendiente no se puede generar el pase ni reintentar el test.
- La app informa **cuánto duró** el test, medido con un reloj monotónico (no con la hora del
  equipo). El servidor fija la hora de término = inicio de la sesión (hora del servidor) + esa
  duración, acotada a 60–1800 s y nunca mayor que el tiempo real transcurrido. Guarda aparte la
  hora de llegada (`received_at`); el panel del supervisor ordena por llegada (lo que llegó tarde
  queda arriba) y avisa "Recibido HH:MM · sin señal".
- El envío se acepta hasta **2 h** después de abrir la sesión. Pasado eso, hay que repetir el test.

**Por qué no sube el riesgo.** El cliente solo puede mover la hora de término **dentro de su propia
sesión** y nunca después de la llegada, y adelantarla no le da ventaja:
- El pase APTO vence antes, nunca después.
- Los descansos (2 min entre tests y 5 min tras SEMI APTO) se miden con la **hora de llegada**, que
  fija el servidor, no con la de término. Así no se pueden acortar declarando una duración menor.
  Costo aceptado: si un SEMI APTO llega tarde, el descanso corre desde que llegó.
- **Solo vale la sesión de test más reciente:** abrir una nueva invalida las anteriores sin envío, así
  que no se pueden tener sesiones abiertas de antemano para elegir la hora.
- Un NO APTO sigue exigiendo la decisión del supervisor antes de cualquier otro test.
- El puntaje lo sigue calculando el servidor y las marcas de D9 usan la duración acotada (fingir
  240 s exige que pasen 240 s reales).
- Al salir sin señal se borra la sesión del equipo aunque no se pueda avisar al servidor, y lo que
  responda tarde después de salir se descarta: el siguiente trabajador no ve el resultado anterior.

Revisión independiente del cambio (2026-11-23): sin caminos para extender el pase, saltar la
autorización del supervisor ni esquivar las marcas; los hallazgos (descansos medidos con la hora de
término, sesiones múltiples, cierre de sesión sin señal, resultado de otra persona en pantalla tras
salir, reintentos sin plazo, orden del panel) se corrigieron antes de publicar.

**Reconsideraríamos si:** hay faenas con turnos completos sin señal (opción 2, empezando por tótems
administrados y credenciales firmadas); el plazo de 2 h no alcanza de forma medida; o la empresa
cliente ya opera servidores en faena (opción 3).

## Deuda conocida

- Campos de Supabase en español mixto (`ficha_id`, `completed_at`) y de la API en inglés
  (`fichaId`, `completedAt`); la guía de estilo (§4.10) pide uno solo.
- Límite de tasa en memoria: con más de una réplica hay que usar un almacén compartido.
