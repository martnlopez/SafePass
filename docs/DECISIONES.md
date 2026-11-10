# Registro de decisiones de arquitectura (SafePass)

Cada decisión: contexto, criterios, elegido y **"reconsideraríamos si…"** (condiciones medibles).

## D1 · La app habla directo con Supabase (no a través del backend Express)

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
(`p_session_id` en Supabase, `jti` del token de tótem en Express). Reenviar con la misma sesión
devuelve la misma evaluación (eco). Una cabecera adicional sería redundante.
**Reconsideraríamos si:** aparecen otras creaciones por POST sin clave natural (p. ej. altas de
trabajadores desde un integrador con red inestable): ahí sí, `Idempotency-Key`.

## D6 · Sin cola offline persistente en el dispositivo

Si el envío falla por red, el resultado queda **en memoria** y el trabajador puede pulsar
"Reintentar envío" (además de 3 reintentos automáticos con espera creciente). No se guarda en
`localStorage`: los tótems son compartidos y un resultado de salud no debe quedar en el equipo
para el siguiente trabajador (Ley 19.628 / 21.719).
**Reconsideraríamos si:** la faena opera sin señal por turnos completos; entonces, una cola
cifrada por trabajador y borrada al cerrar sesión.

## Desviaciones conocidas del estilo REST (deuda menor)

- `DELETE /workers/{id}` y `DELETE /evaluations/{id}` **no borran**: desactivan y anulan
  (§3.3 recomienda `PATCH`). Cambiarlo rompe el contrato; se hará con el rito
  expandir → migrar → contraer cuando haya clientes (agregar `PATCH`, medir uso, retirar `DELETE`).
- Campos del backend en inglés (`fullName`, `pageSize`) y de Supabase en español mixto; la guía
  de estilo (§4.10) pide uno solo. Se fijará al unificar los modelos (D1).
