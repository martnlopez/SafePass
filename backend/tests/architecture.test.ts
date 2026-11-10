import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Linter de fronteras entre capas (prompt de arquitectura §6.2 y §6.12):
 * la flecha controller → service → repository nunca sube ni salta.
 * Si alguien rompe una frontera, esta prueba falla en CI.
 */
const SRC = join(import.meta.dirname, "..", "src")

function importsOf(dir: string): { file: string; imports: string[] }[] {
  return readdirSync(join(SRC, dir))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => {
      const code = readFileSync(join(SRC, dir, f), "utf8")
      const imports = [...code.matchAll(/^\s*import\s[^'"]*["']([^"']+)["']/gm)].map((m) => m[1] ?? "")
      return { file: `${dir}/${f}`, imports }
    })
}

function violations(dir: string, forbidden: RegExp[]): string[] {
  return importsOf(dir).flatMap(({ file, imports }) =>
    imports.filter((i) => forbidden.some((re) => re.test(i))).map((i) => `${file} importa ${i}`),
  )
}

describe("arquitectura en capas", () => {
  it("los controllers no tocan datos (ni ORM ni repositories)", () => {
    expect(violations("controllers", [/repositories\//, /generated\/prisma/, /lib\/prisma/, /^@prisma\//])).toEqual([])
  })

  it("los services no conocen HTTP ni el ORM", () => {
    expect(
      violations("services", [/^express$/, /controllers\//, /middlewares\//, /generated\/prisma/, /lib\/prisma/, /^@prisma\//]),
    ).toEqual([])
  })

  it("los repositories no conocen reglas de negocio ni HTTP", () => {
    expect(violations("repositories", [/services\//, /controllers\//, /middlewares\//, /^express$/])).toEqual([])
  })
})
