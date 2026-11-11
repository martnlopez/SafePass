# Publicar SafePass (gratis): Vercel + Render + Supabase

```
Navegador ──► App en Vercel ──► API en Render ──► Supabase (datos y login)
              (safepass.vercel.app)  (safepass-api.onrender.com)
```

**Cómo se conectan Vercel y Render:** con dos variables que se apuntan entre sí.

| Dónde | Variable | Valor |
|---|---|---|
| Vercel (app) | `VITE_API_URL` | dirección de Render + `/api/v1` |
| Render (API) | `CORS_ORIGINS` | dirección de Vercel |

El orden importa: primero Render (para tener su dirección), después Vercel, y al final se vuelve
a Render a poner la dirección de Vercel.

## Paso 1 · Backend en Render

1. Entra a https://render.com y crea una cuenta con **GitHub**.
2. **New → Blueprint** → elige el repositorio `SafePass-1` (autoriza a Render a verlo, es privado).
3. Render lee `render.yaml` y pide tres valores:
   - `SUPABASE_URL` → el mismo de tu `.env.local` (`VITE_SUPABASE_URL`).
   - `SUPABASE_PUBLISHABLE_KEY` → el mismo de tu `.env.local` (`VITE_SUPABASE_PUBLISHABLE_KEY`).
   - `CORS_ORIGINS` → por ahora `https://safepass.vercel.app` (se corrige en el paso 3).
4. **Apply**. Espera a que diga **Live** (unos 3–5 minutos).
5. Copia la dirección del servicio, p. ej. `https://safepass-api.onrender.com`, y comprueba que
   `https://safepass-api.onrender.com/health` responde `{"status":"ok",…}`.

## Paso 2 · App en Vercel

1. Entra a https://vercel.com con **GitHub** → **Add New → Project** → importa `SafePass-1`.
2. Deja lo que detecta (Vite). En **Environment Variables** agrega:

   | Nombre | Valor |
   |---|---|
   | `VITE_SUPABASE_URL` | el de tu `.env.local` |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | el de tu `.env.local` |
   | `VITE_API_URL` | `https://safepass-api.onrender.com/api/v1` (tu dirección de Render) |
   | `VITE_TURNSTILE_SITE_KEY` | la clave del sitio de Cloudflare Turnstile |

3. **Deploy**. Al terminar, copia la dirección de la app, p. ej. `https://safepass-1.vercel.app`.

> Si cambias una variable en Vercel, hay que volver a publicar (**Deployments → Redeploy**):
> las variables `VITE_` se graban en la app al compilar.

## Paso 3 · Cerrar el círculo

1. **Render** → servicio `safepass-api` → **Environment** → `CORS_ORIGINS` = la dirección exacta
   de Vercel (con `https://`, sin barra final) → **Save** (se reinicia solo).
2. **Cloudflare → Turnstile →** tu widget → **Nombres de host** → agrega el dominio de Vercel
   (solo `safepass-1.vercel.app`, sin `https://`).

## Paso 4 · Probar

Abre la dirección de Vercel en Chrome o Edge, ingresa con una ficha, rinde el test, genera el
pase y valídalo con la cuenta supervisora.

| Si ves… | Causa probable |
|---|---|
| "Sin conexión con el servidor SafePass" | Render está despertando (plan gratis: ~1 min tras 15 min sin uso) o `VITE_API_URL` está mal |
| Error de CORS en la consola | `CORS_ORIGINS` no coincide exactamente con la dirección de Vercel |
| Verificación de seguridad con código 110200 | Falta el dominio de Vercel en el widget de Turnstile |
| "Ficha ID o PIN incorrectos" con el PIN correcto | `VITE_SUPABASE_PUBLISHABLE_KEY` mal copiada en Vercel |

**Antes de una presentación:** abre `…onrender.com/health` unos minutos antes para despertar el
backend.

## Qué queda fuera de este despliegue

- La base propia del backend (`DATABASE_URL`) no se usa: las rutas del tótem y del panel HSE
  responden 503. La app completa funciona sobre Supabase.
- Para uso real: PIN distinto por persona y dominio propio.
