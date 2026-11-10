# SAFEPASS - Sistema de Control de Aptitud Cognitiva

> Para empresas mineras que buscan reducir accidentes laborales por fatiga, SAFEPASS es una plataforma de evaluación neurocognitiva que entrega un diagnóstico de aptitud operativa en menos de 5 minutos antes del inicio de cada turno.

## Integrantes del Equipo
* Ricardo Moreno - `@ricardomorenom`
* Martin Lopez - `@martnlopez`
* Carlos Bernales - `@velo0o0`

## Prototipo Navegable
* [Acceder al Prototipo Navegable](https://www.figma.com/make/KWkNwNUc0n31CNZiBMTSvn/Cognitive-Aptitude-Evaluation-UI?t=gRiIrbmpGvLO9aSp-20&fullscreen=1)

## Documentación del Proyecto
* [Documento de Propuesta (PDF)](./docs/propuesta.pdf)
* [Láminas de Presentación (PDF)](./docs/presentacion.pdf)
* [Mapa del Producto / Arquitectura de Información](./docs/mapa_producto.png)
* [Diagrama de Arquitectura Técnica](./docs/arquitectura_tecnica.png)

## Ejecutar el frontend

El frontend se conecta directamente a **Supabase** (organización SafePass, proyecto `Safepass`):
login por Ficha ID + PIN con Supabase Auth, y evaluaciones, decisiones del supervisor y pases
guardados en PostgreSQL con reglas de seguridad (RLS) por usuario.

1. Instala las dependencias: `npm install`
2. Copia `.env.example` como `.env.local` y completa `VITE_SUPABASE_URL` y
   `VITE_SUPABASE_PUBLISHABLE_KEY` (Supabase → Project Settings → API).
3. Inicia el servidor de desarrollo: `npm run dev` → http://localhost:5173

### Base de datos

El esquema está versionado en [`supabase/migrations`](./supabase/migrations):

| Tabla | Contenido |
|---|---|
| `workers` | Perfil de cada Ficha ID (nombre, cargo, empresa, turno, rol `worker` / `supervisor`) |
| `evaluations` | Resultado de cada batería: puntaje 0-100, estado, desglose y hora de finalización |
| `decisions` | Decisiones del supervisor y su comentario; los NO APTO generan "Revisión pendiente" automáticamente |
| `access_passes` | Pases de acceso emitidos por el servidor (vencen 12 h después del test APTO) |

Reglas que aplica el servidor, aunque se modifique el frontend:
- Cada trabajador solo ve sus propios datos; el supervisor ve todo.
- La evaluación solo se registra dentro de una sesión del servidor (`start_evaluation` →
  `submit_evaluation`): un envío por sesión, mínimo 60 s y máximo 30 min. No se puede insertar
  directamente en `evaluations`, y el puntaje lo calcula el servidor desde el desglose.
- SEMI-APTO: descanso de 5 min antes de volver a rendir.
- NO APTO: no puede volver a rendir hasta que el supervisor lo autorice; el re-test autorizado
  exige 15 min de descanso.
- El pase solo se emite con un resultado APTO vigente o un Pase Excepcional del supervisor,
  que es de un solo uso.
- El supervisor valida el pase en el servidor (`validate_pass`): queda **revocado** si la cuenta
  se desactivó, si hubo una decisión posterior a su emisión o si una evaluación posterior no fue APTA.
- Ningún supervisor puede registrar decisiones sobre su propia evaluación.

Pendiente en el panel de Supabase (no se versiona en el repo): desactivar el registro público,
activar CAPTCHA y límites de inicio de sesión, y la protección contra contraseñas filtradas.
