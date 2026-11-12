# Publicar SafePass (gratis): Cloudflare Pages + Render + Supabase

```
Navegador ──► App en Cloudflare Pages ──► API en Render ──► Supabase (datos y login)
              (safepass.pages.dev)         (safepass-api.onrender.com)
```

**Cómo se conectan la app y el backend:** con dos variables que se apuntan entre sí.

| Dónde | Variable | Valor |
|---|---|---|
| Cloudflare Pages (app) | `VITE_API_URL` | dirección de Render + `/api/v1` |
| Render (API) | `CORS_ORIGINS` | dirección de Cloudflare Pages |

El orden importa: primero Render (para tener su dirección), después Cloudflare Pages, y al final
se vuelve a Render a poner la dirección de la app.

Los nombres de los botones pueden variar un poco: los paneles cambian seguido.

## Paso 1 · Backend en Render (panel en inglés)

1. Entra a https://render.com y crea una cuenta con **GitHub**.
2. **New → Blueprint** → elige el repositorio `SafePass-1` (autoriza a Render a verlo, es privado).
3. Render lee `render.yaml` y pide tres valores:
   - `SUPABASE_URL` → el mismo de tu `.env.local` (`VITE_SUPABASE_URL`).
   - `SUPABASE_PUBLISHABLE_KEY` → el mismo de tu `.env.local` (`VITE_SUPABASE_PUBLISHABLE_KEY`).
   - `CORS_ORIGINS` → por ahora `https://safepass.pages.dev` (se corrige en el paso 3).
4. **Apply**. Espera a que diga **Live** (unos 3–5 minutos).
5. Copia la dirección del servicio, p. ej. `https://safepass-api.onrender.com`, y comprueba que
   `https://safepass-api.onrender.com/health` responde `{"status":"ok",…}`.

## Paso 2 · App en Cloudflare Pages

1. Entra a https://dash.cloudflare.com → menú **Workers y Pages** → **Crear** → pestaña
   **Pages** → **Conectar a Git** → autoriza GitHub y elige `SafePass-1`.
2. Configuración de compilación:

   | Campo | Valor |
   |---|---|
   | Nombre del proyecto | `safepass` (define la dirección `safepass.pages.dev`) |
   | Rama de producción | `main` |
   | Valor preestablecido del marco | `Vite` (o Ninguno) |
   | Comando de compilación | `npm run build` |
   | Directorio de salida | `dist` |
   | Directorio raíz | (vacío) |

3. En **Variables de entorno** agrega:

   | Nombre | Valor |
   |---|---|
   | `NODE_VERSION` | `22` |
   | `VITE_SUPABASE_URL` | el de tu `.env.local` |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | el de tu `.env.local` |
   | `VITE_API_URL` | `https://safepass-api.onrender.com/api/v1` (tu dirección de Render) |
   | `VITE_TURNSTILE_SITE_KEY` | la clave del sitio de Turnstile |

4. **Guardar e implementar**. Al terminar, copia la dirección, p. ej. `https://safepass.pages.dev`.

> Si cambias una variable, hay que volver a compilar (**Implementaciones → Reintentar
> implementación**): las variables `VITE_` se graban en la app al compilar.

Las cabeceras de seguridad (anti-clickjacking, HSTS, etc.) salen de `public/_headers`.

## Paso 3 · Cerrar el círculo

1. **Render** → servicio `safepass-api` → **Environment** → `CORS_ORIGINS` = la dirección exacta
   de la app (con `https://`, sin barra final) → **Save** (se reinicia solo).
2. **Cloudflare → Turnstile →** tu widget → **Nombres de host** → agrega `safepass.pages.dev`
   (sin `https://`).

## Paso 4 · Probar

Abre la dirección de la app en Chrome o Edge, ingresa con una ficha, rinde el test, genera el
pase y valídalo con la cuenta supervisora.

| Si ves… | Causa probable |
|---|---|
| "Sin conexión con el servidor SafePass" | Render está despertando (plan gratis: ~1 min tras 15 min sin uso) o `VITE_API_URL` está mal |
| Error de CORS en la consola | `CORS_ORIGINS` no coincide exactamente con la dirección de la app |
| Verificación de seguridad con código 110200 | Falta el dominio de la app en el widget de Turnstile |
| "Ficha ID o PIN incorrectos" con el PIN correcto | `VITE_SUPABASE_PUBLISHABLE_KEY` mal copiada |
| Falla la compilación en Cloudflare | Falta `NODE_VERSION=22` |

- Usa siempre la dirección principal (`safepass.pages.dev`). Las direcciones de vista previa
  (`abc123.safepass.pages.dev`) no están en `CORS_ORIGINS` ni en Turnstile y no podrán ingresar.
- **Antes de una presentación:** abre `…onrender.com/health` unos minutos antes para despertar
  el backend.

## Si el proyecto escala

- Backend: pasar Render al plan de pago (no se duerme); no hay que migrar nada.
- Dominio propio: se agrega en Cloudflare Pages (**Dominios personalizados**) y luego en
  `CORS_ORIGINS` y en Turnstile.
- PIN distinto por persona antes de usarlo con trabajadores reales.
