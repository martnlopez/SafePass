import { pino, type Logger } from "pino"

export type { Logger }

// Nunca registrar credenciales ni datos personales
const REDACT = ["req.headers.authorization", "req.headers.cookie", "pin", "*.pin"]

export function createLogger(level: string, pretty: boolean): Logger {
  return pino({
    level,
    redact: { paths: REDACT, censor: "[REDACTED]" },
    ...(pretty ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss" } } } : {}),
  })
}
