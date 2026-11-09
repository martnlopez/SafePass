// Genera secretos aleatorios para el archivo .env (cópialos tú mismo; este script no escribe archivos).
//   npm run keys:generate
import { randomBytes } from "node:crypto"

const b64 = (bytes: number) => randomBytes(bytes).toString("base64")
const b64url = (bytes: number) => randomBytes(bytes).toString("base64url")

console.log(
  [
    "# Pega estas líneas en tu .env (una sola vez por entorno; NUNCA las subas al repositorio)",
    `JWT_SECRET=${b64url(48)}`,
    `PIN_PEPPER=${b64url(48)}`,
    `FIELD_ENCRYPTION_KEY=${b64(32)}`,
    `BLIND_INDEX_KEY=${b64(32)}`,
  ].join("\n"),
)
