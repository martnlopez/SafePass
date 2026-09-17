import { useEffect, useMemo, useRef, useState } from "react"
import { TEST_META, scoreToZ, type BatteryResult, type TestKey } from "../lib/data"

const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min

// ---------------------------------------------------------------------------
// Battery orchestrator
// ---------------------------------------------------------------------------

type Phase = { kind: "intro"; i: number } | { kind: "run"; i: number }

export default function CognitiveTest({
  fichaId,
  onComplete,
}: {
  fichaId: string
  onComplete: (r: BatteryResult) => void
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "intro", i: 0 })
  const [elapsed, setElapsed] = useState(0)
  const results = useRef<{ key: TestKey; name: string; score: number; detail: string }[]>([])
  const startedAt = useRef(Date.now())

  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 500)
    return () => clearInterval(id)
  }, [])

  function finishTest(score: number, detail: string) {
    const meta = TEST_META[phase.i]
    results.current[phase.i] = { key: meta.key, name: meta.name, score, detail }
    if (phase.i + 1 >= TEST_META.length) {
      const scores = results.current.map((r) => r.score)
      const global = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      onComplete({ fichaId, score: global, z: scoreToZ(global), breakdown: results.current })
    } else {
      setPhase({ kind: "intro", i: phase.i + 1 })
    }
  }

  const meta = TEST_META[phase.i]
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0")
  const ss = String(elapsed % 60).padStart(2, "0")

  return (
    // Viewport Lock: h-screen + justify-between fija header/centro/footer en 100vh (cero scroll en tótem 16:9)
    // Canvas: p-6 (24px) safe-area para evitar clipping en el borde inferior de pantallas de faena
    <div className="flex h-screen w-full flex-col justify-between bg-[color:var(--color-ink)] p-6">

      {/* HUD Header: max-w-6xl constriñe el panel en tótems anchos; mobile cae a max-w-md */}
      <div className="mx-auto w-full max-w-md md:max-w-2xl lg:max-w-6xl">
        <header className="flex items-center justify-between rounded-xl border border-[color:var(--color-slate-line)] bg-[color:var(--color-steel)] px-4 py-3.5 lg:px-6 lg:py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-[color:var(--color-semi)] font-mono text-sm font-800 text-[color:var(--color-ink)] lg:h-10 lg:w-10">
              SP
            </div>
            <div className="leading-tight">
              {/* Ley 19.628: sesión identificada solo por Ficha ID — nombre/RUT viven fuera de la UI del trabajador */}
              <p className="font-mono text-base font-700 tracking-wide text-white">{fichaId}</p>
              <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-[color:var(--color-fog)]">
                Ficha operador
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4 lg:gap-6">
            {/* Progress counter · Accent #FFAE00 — posición en la evaluación (n de 5) */}
            <p className="font-mono text-lg font-800 text-[color:var(--color-semi)] lg:text-xl">
              Test {meta.n} <span className="text-[color:var(--color-fog)]">de {TEST_META.length}</span>
            </p>
            <span className="hidden h-8 w-px bg-[color:var(--color-slate-line)] lg:block" />
            {/* Session timer · tabular-nums evita reflow horizontal al tickear cada segundo */}
            <p className="font-mono text-lg font-800 tabular-nums text-white lg:text-xl">
              {mm}:{ss}
            </p>
          </div>
        </header>

        {/* Segmented progress: completado #22C55E / activo #FFAE00 / pendiente #1E283A */}
        <div className="mt-3 flex w-full gap-1.5">
          {TEST_META.map((t, idx) => (
            <div
              key={t.key}
              className={`h-2 flex-1 rounded-full transition-colors ${
                idx < phase.i
                  ? "bg-[color:var(--color-apt)]"
                  : idx === phase.i
                    ? "bg-[color:var(--color-semi)]"
                    : "bg-[color:var(--color-steel-2)]"
              }`}
            />
          ))}
        </div>
      </div>

      {/* Stage area: overflow-hidden garantiza que ningún test desborde el viewport bloqueado */}
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col overflow-hidden py-4 md:max-w-2xl lg:max-w-3xl">
        {phase.kind === "intro" ? (
          <Intro
            key={`intro-${phase.i}`}
            i={phase.i}
            onStart={() => setPhase({ kind: "run", i: phase.i })}
          />
        ) : (
          <div key={`run-${phase.i}`} className="flex flex-1 flex-col">
            {meta.key === "figuras" && <FigurasTest onDone={finishTest} />}
            {meta.key === "pvt" && <PvtTest onDone={finishTest} />}
            {meta.key === "gonogo" && <GoNoGoTest onDone={finishTest} />}
            {meta.key === "memoria" && <MemoriaTest onDone={finishTest} />}
            {meta.key === "tracking" && <TrackingTest onDone={finishTest} />}
          </div>
        )}
      </div>

      {/* ③ FOOTER — ayuda / estado ─────────────────────────── */}
      <div className="mx-auto w-full max-w-md lg:max-w-6xl">
        <p className="text-center font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--color-fog)]">
          Mantén el ritmo · responde con precisión · un intento base por turno
        </p>
      </div>
    </div>
  )
}

const INTRO_COPY: Record<number, { tag: string; how: string }> = {
  0: { tag: "5 repeticiones", how: "Toca lo más rápido posible la figura idéntica a la figura objetivo mostrada arriba." },
  1: { tag: "5 repeticiones", how: "La pantalla estará en negro. Cuando aparezca el contador brillante, toca de inmediato. No te adelantes." },
  2: { tag: "15 estímulos", how: "Toca cuando el casquete sea VERDE (Go). No toques si es ROJO (No-Go)." },
  3: { tag: "Secuencia de 3 a 5", how: "Memoriza las casillas que se iluminan y repítelas en el mismo orden." },
  4: { tag: "20 segundos", how: "Toca los números del 1 al 6 en orden ascendente mientras cambian de posición." },
}

function Intro({ i, onStart }: { i: number; onStart: () => void }) {
  const meta = TEST_META[i]
  const copy = INTRO_COPY[i]
  return (
    <div className="fade-up flex flex-1 flex-col items-center justify-center text-center">
      {/* Protocol tag · Accent #FFAE00 — parámetros de la prueba (repeticiones/estímulos/duración) */}
      <span className="inline-flex items-center gap-2 rounded-full border border-[color:var(--color-semi)]/40 bg-[color:var(--color-semi)]/12 px-4 py-1.5 font-mono text-xs font-700 uppercase tracking-[0.2em] text-[color:var(--color-semi)]">
        {copy.tag}
      </span>
      {/* Stage badge 80x80 · Surface #1E283A — número legible a distancia en tótem */}
      <div className="mt-6 grid h-20 w-20 place-items-center rounded-2xl border border-[color:var(--color-slate-line)] bg-[color:var(--color-steel-2)] font-mono text-4xl font-800 text-white">
        {meta.n}
      </div>
      <h2 className="mt-6 text-3xl font-800 tracking-tight text-white lg:text-4xl">{meta.name}</h2>
      <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--color-fog)]">
        {meta.metric}
      </p>
      {/* Instrucción text-lg: legibilidad prioritaria — comprensión previa reduce falsos negativos */}
      <p className="mt-6 max-w-md text-lg leading-relaxed text-[color:var(--color-fog)]">{copy.how}</p>
      {/* Primary CTA · Touch Target 76px | Action #FFAE00 — dimensionado para guantes de faena */}
      <button
        onClick={onStart}
        className="mt-10 h-[76px] w-full max-w-xl rounded-xl bg-[color:var(--color-semi)] text-xl font-800 uppercase tracking-wide text-[color:var(--color-ink)] transition-all hover:bg-[color:var(--color-semi-dim)] active:scale-[0.99]"
      >
        Comenzar prueba
      </button>
    </div>
  )
}

type DoneFn = (score: number, detail: string) => void

// ---------------------------------------------------------------------------
// Test 1 · Selección de Figuras Rápidas
// ---------------------------------------------------------------------------

const SYMBOLS = ["▲", "●", "■", "◆", "★", "⬟"]
function makeRound() {
  const opts = [...SYMBOLS].sort(() => Math.random() - 0.5).slice(0, 4)
  const target = opts[rand(0, opts.length - 1)]
  return { options: [...opts].sort(() => Math.random() - 0.5), target }
}

function FigurasTest({ onDone }: { onDone: DoneFn }) {
  const REPS = 5
  const rounds = useMemo(() => Array.from({ length: REPS }, makeRound), [])
  const [i, setI] = useState(0)
  const [flash, setFlash] = useState<"ok" | "bad" | null>(null)
  const roundStart = useRef(Date.now())
  const correct = useRef(0)
  const rtSum = useRef(0)

  useEffect(() => {
    roundStart.current = Date.now()
  }, [i])

  const cur = rounds[i]

  function answer(sym: string) {
    if (flash) return
    const rt = Date.now() - roundStart.current
    const right = sym === cur.target
    if (right) {
      correct.current += 1
      rtSum.current += rt
    }
    setFlash(right ? "ok" : "bad")
    setTimeout(() => {
      setFlash(null)
      if (i + 1 >= REPS) {
        const acc = correct.current / REPS
        const avgRt = correct.current ? rtSum.current / correct.current : 2500
        const speed = Math.max(0, Math.min(1, (2000 - avgRt) / 1400))
        onDone(Math.round((acc * 0.7 + speed * 0.3) * 100), `Precisión ${Math.round(acc * 100)}% · TR ${Math.round(avgRt)}ms`)
      } else setI((n) => n + 1)
    }, 420)
  }

  return (
    <>
      {/* Viewport Lock: max-h-[60vh] reserva alto para header+footer y evita scroll en la grilla 2x2 */}
      <div className="flex max-h-[60vh] flex-1 flex-col items-center justify-center gap-6">
        <div className="text-center">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-[color:var(--color-fog)]">Figura objetivo</p>
          {/* Target 80x80 · glyph 48px #FFFFFF sobre #1E283A — anclaje visual de referencia */}
          <div
            key={i}
            className="scale-in mx-auto mt-3 grid h-20 w-20 place-items-center rounded-2xl border-2 border-[color:var(--color-semi)]/50 bg-[color:var(--color-steel-2)]"
          >
            <span className="text-[48px] leading-none text-white">{cur.target}</span>
          </div>
        </div>
        {/* Grid 2x2 · aspect-square + max-w-[440px] ≈ 200px/tarjeta con gap-4 — target amplio, footprint compacto */}
        {/* Feedback state: acierto #22C55E, borde objetivo #FFAE00 en hover/press, glyph a scale-105 */}
        <div className="grid w-full max-w-[440px] grid-cols-2 gap-4">
          {cur.options.map((sym, idx) => (
            <button
              key={sym + idx}
              onClick={() => answer(sym)}
              className={`group grid aspect-square w-full place-items-center rounded-2xl border-2 transition-all active:scale-[0.98] ${
                flash && sym === cur.target
                  ? "border-[color:var(--color-apt)] bg-[color:var(--color-apt)]/15"
                  : flash === "bad" && sym !== cur.target
                    ? "border-[color:var(--color-slate-line)] bg-[color:var(--color-steel)] opacity-40"
                    : "border-[color:var(--color-slate-line)] bg-[color:var(--color-steel)] hover:border-[color:var(--color-semi)] hover:bg-[color:var(--color-steel-2)]"
              }`}
            >
              <span className="text-[60px] leading-none text-white transition-transform duration-150 group-hover:scale-105 group-active:scale-105">
                {sym}
              </span>
            </button>
          ))}
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Test 2 · PVT Táctil
// ---------------------------------------------------------------------------

function PvtTest({ onDone }: { onDone: DoneFn }) {
  const REPS = 5
  const [rep, setRep] = useState(0)
  const [state, setState] = useState<"wait" | "go" | "early">("wait")
  const [ms, setMs] = useState(0)
  const goAt = useRef(0)
  const rts = useRef<number[]>([])
  const lapses = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const raf = useRef<number>(undefined)

  useEffect(() => {
    setState("wait")
    timer.current = setTimeout(() => {
      goAt.current = Date.now()
      setState("go")
      const tick = () => {
        setMs(Date.now() - goAt.current)
        raf.current = requestAnimationFrame(tick)
      }
      raf.current = requestAnimationFrame(tick)
    }, rand(1500, 3800))
    return () => {
      clearTimeout(timer.current)
      if (raf.current) cancelAnimationFrame(raf.current)
    }
  }, [rep])

  function tap() {
    if (state === "wait") {
      // false start
      clearTimeout(timer.current)
      setState("early")
      lapses.current += 1
      setTimeout(next, 700)
      return
    }
    if (state === "go") {
      if (raf.current) cancelAnimationFrame(raf.current)
      const rt = Date.now() - goAt.current
      rts.current.push(rt)
      if (rt > 500) lapses.current += 1
      next()
    }
  }

  function next() {
    if (rep + 1 >= REPS) {
      const valid = rts.current.length ? rts.current : [600]
      const avg = valid.reduce((a, b) => a + b, 0) / valid.length
      const speed = Math.max(0, Math.min(1, (600 - avg) / 400))
      const penalty = Math.min(0.4, lapses.current * 0.12)
      onDone(Math.round(Math.max(0, speed - penalty) * 100), `TR medio ${Math.round(avg)}ms · ${lapses.current} lapsos`)
    } else setRep((r) => r + 1)
  }

  return (
    // Latency Threshold PVT: TR > 500ms cuenta como lapso; estado GO vira a #22C55E (señal de reacción)
    <button
      onClick={tap}
      className={`mt-4 grid min-h-[58vh] w-full flex-1 place-items-center rounded-3xl border-2 transition-colors ${
        state === "go"
          ? "border-[color:var(--color-apt)] bg-[color:var(--color-apt)]/10"
          : state === "early"
            ? "border-[color:var(--color-no)] bg-[color:var(--color-no)]/10"
            : "border-[color:var(--color-slate-line)] bg-black"
      }`}
    >
      <div className="text-center">
        {state === "wait" && (
          <p className="font-mono text-sm uppercase tracking-[0.3em] text-[color:var(--color-fog)]">Espera la señal…</p>
        )}
        {state === "go" && (
          <span className="font-mono text-7xl font-800 tabular-nums text-[color:var(--color-apt)] drop-shadow-[0_0_24px_rgba(34,197,94,0.6)]">
            {ms}
          </span>
        )}
        {state === "early" && (
          <p className="font-mono text-lg font-700 uppercase tracking-wider text-[color:var(--color-no)]">
            Muy pronto
          </p>
        )}
        <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--color-fog)]">
          Repetición {rep + 1} / {REPS}
        </p>
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Test 3 · Go / No-Go
// ---------------------------------------------------------------------------

function GoNoGoTest({ onDone }: { onDone: DoneFn }) {
  const TOTAL = 15
  const seq = useMemo(() => Array.from({ length: TOTAL }, () => Math.random() < 0.65), []) // true = Go
  const [i, setI] = useState(0)
  const [shown, setShown] = useState(true)
  const answered = useRef(false)
  const hits = useRef(0) // correct Go taps
  const goCount = useRef(seq.filter(Boolean).length)
  const noGoCount = useRef(seq.filter((g) => !g).length)
  const falseAlarms = useRef(0)
  const misses = useRef(0)
  const advance = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    answered.current = false
    setShown(true)
    advance.current = setTimeout(() => {
      // evaluate no-response
      if (!answered.current) {
        if (seq[i]) misses.current += 1 // missed a Go
      }
      setShown(false)
      setTimeout(() => {
        if (i + 1 >= TOTAL) finish()
        else setI((n) => n + 1)
      }, 260)
    }, 1000)
    return () => clearTimeout(advance.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i])

  function tap() {
    if (answered.current || !shown) return
    answered.current = true
    if (seq[i]) hits.current += 1
    else falseAlarms.current += 1
  }

  function finish() {
    const faRate = noGoCount.current ? falseAlarms.current / noGoCount.current : 0
    const hitRate = goCount.current ? hits.current / goCount.current : 0
    const score = Math.round(Math.max(0, hitRate * 0.5 + (1 - faRate) * 0.5) * 100)
    onDone(score, `Aciertos ${Math.round(hitRate * 100)}% · Falsos + ${Math.round(faRate * 100)}%`)
  }

  const isGo = seq[i]

  return (
    <div className="flex flex-1 flex-col">
      <div className="mt-4 flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--color-fog)]">
        <span>Estímulo {i + 1} / {TOTAL}</span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[color:var(--color-apt)]" /> Go
          <span className="ml-2 h-2 w-2 rounded-full bg-[color:var(--color-no)]" /> No-Go
        </span>
      </div>
      <button
        onClick={tap}
        className={`mt-4 grid min-h-[55vh] w-full flex-1 place-items-center rounded-3xl border-2 transition-colors active:scale-[0.99] ${
          shown && isGo
            ? "border-[color:var(--color-apt)] bg-[color:var(--color-apt)]/10"
            : shown
              ? "border-[color:var(--color-no)] bg-[color:var(--color-no)]/10"
              : "border-[color:var(--color-slate-line)] bg-[color:var(--color-steel)]"
        }`}
      >
        {shown && (
          <div
            key={i}
            className="scale-in grid h-52 w-52 place-items-center rounded-full shadow-2xl"
            style={{
              background: isGo ? "var(--color-apt)" : "var(--color-no)",
              boxShadow: `0 0 80px ${isGo ? "rgba(34,197,94,0.55)" : "rgba(239,68,68,0.55)"}`,
            }}
          >
            {/* casquete / helmet glyph */}
            <svg viewBox="0 0 64 40" className="h-20 w-20" fill="var(--color-ink)">
              <path d="M32 4C18 4 6 14 6 30v4h52v-4C58 14 46 4 32 4Zm0 6c8 0 14 5 17 12H15c3-7 9-12 17-12Z" />
              <rect x="4" y="32" width="56" height="6" rx="3" />
            </svg>
          </div>
        )}
      </button>
      <p className="mt-4 text-center font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--color-fog)]">
        Toca solo en VERDE
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Test 4 · Memoria de Trabajo (3x3)
// ---------------------------------------------------------------------------

function MemoriaTest({ onDone }: { onDone: DoneFn }) {
  const LEVELS = [3, 4, 5]
  const [level, setLevel] = useState(0)
  const [seq, setSeq] = useState<number[]>([])
  const [lit, setLit] = useState<number | null>(null)
  const [mode, setMode] = useState<"show" | "input">("show")
  const [input, setInput] = useState<number[]>([])
  const [wrong, setWrong] = useState(false)
  const passed = useRef(0)
  const maxSpan = useRef(0)

  useEffect(() => {
    const len = LEVELS[level]
    const s = Array.from({ length: len }, () => rand(0, 8))
    setSeq(s)
    setInput([])
    setMode("show")
    let step = 0
    const play = () => {
      if (step >= s.length) {
        setLit(null)
        setMode("input")
        return
      }
      setLit(s[step])
      setTimeout(() => {
        setLit(null)
        step += 1
        setTimeout(play, 220)
      }, 520)
    }
    const t = setTimeout(play, 600)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level])

  function finish() {
    const score = Math.round((passed.current / LEVELS.length) * 100)
    onDone(score, `Span máx. ${maxSpan.current} casillas · ${passed.current}/${LEVELS.length} niveles`)
  }

  function tap(cell: number) {
    if (mode !== "input") return
    const next = [...input, cell]
    setInput(next)
    const idx = next.length - 1
    if (seq[idx] !== cell) {
      setWrong(true)
      setTimeout(() => {
        setWrong(false)
        if (level + 1 >= LEVELS.length) finish()
        else setLevel((l) => l + 1)
      }, 500)
      return
    }
    if (next.length === seq.length) {
      passed.current += 1
      maxSpan.current = Math.max(maxSpan.current, seq.length)
      setTimeout(() => {
        if (level + 1 >= LEVELS.length) finish()
        else setLevel((l) => l + 1)
      }, 450)
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <p className="mt-6 text-center font-mono text-sm uppercase tracking-[0.25em] text-[color:var(--color-semi)]">
        {mode === "show" ? "Observa la secuencia" : "Repite la secuencia"}
      </p>
      <p className="mt-1 text-center font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--color-fog)]">
        Nivel {level + 1} · {LEVELS[level]} casillas
      </p>
      <div className="mt-auto mb-auto grid grid-cols-3 gap-3">
        {Array.from({ length: 9 }).map((_, c) => {
          const active = lit === c
          const chosen = mode === "input" && input.includes(c)
          return (
            <button
              key={c}
              onClick={() => tap(c)}
              className={`aspect-square min-h-[80px] rounded-2xl border transition-all duration-150 active:scale-95 ${
                active
                  ? "border-[color:var(--color-semi)] bg-[color:var(--color-semi)] shadow-[0_0_30px_rgba(245,158,11,0.6)]"
                  : wrong && chosen
                    ? "border-[color:var(--color-no)] bg-[color:var(--color-no)]/25"
                    : chosen
                      ? "border-[color:var(--color-apt)] bg-[color:var(--color-apt)]/20"
                      : "border-[color:var(--color-slate-line)] bg-[color:var(--color-steel)]"
              }`}
            />
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Test 5 · Tracking Numérico (20s)
// ---------------------------------------------------------------------------

function scatter(): { x: number; y: number }[] {
  // 6 non-overlapping positions in a 0-100 grid area
  const spots: { x: number; y: number }[] = []
  let guard = 0
  while (spots.length < 6 && guard < 400) {
    guard++
    const p = { x: rand(6, 74), y: rand(6, 78) }
    if (spots.every((s) => Math.hypot(s.x - p.x, s.y - p.y) > 32)) spots.push(p)
  }
  while (spots.length < 6) spots.push({ x: rand(6, 74), y: rand(6, 78) })
  return spots
}

function TrackingTest({ onDone }: { onDone: DoneFn }) {
  const DURATION = 20
  const [next, setNext] = useState(1)
  const [pos, setPos] = useState(scatter)
  const [left, setLeft] = useState(DURATION)
  const [bad, setBad] = useState<number | null>(null)
  const cycles = useRef(0)
  const errors = useRef(0)
  const done = useRef(false)

  useEffect(() => {
    const id = setInterval(() => setLeft((l) => l - 1), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (left <= 0 && !done.current) {
      done.current = true
      const partial = (next - 1) / 6
      const total = cycles.current + partial
      const speed = Math.min(1, total / 3.5) // ~3.5 full runs = top
      const penalty = Math.min(0.35, errors.current * 0.05)
      onDone(Math.round(Math.max(0, speed - penalty) * 100), `${cycles.current} series · ${errors.current} errores`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left])

  function tap(n: number) {
    if (done.current) return
    if (n === next) {
      if (n === 6) {
        cycles.current += 1
        setNext(1)
      } else setNext(n + 1)
      setPos(scatter())
    } else {
      errors.current += 1
      setBad(n)
      setTimeout(() => setBad(null), 250)
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="mt-4 flex items-center justify-between">
        <p className="font-mono text-sm text-[color:var(--color-fog)]">
          Siguiente: <span className="text-lg font-800 text-[color:var(--color-semi)]">{next}</span>
        </p>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-wider text-[color:var(--color-fog)]">Tiempo</span>
          <span className={`font-mono text-lg font-800 tabular-nums ${left <= 5 ? "text-[color:var(--color-no)]" : "text-[color:var(--color-mist)]"}`}>
            {String(Math.max(0, left)).padStart(2, "0")}s
          </span>
        </div>
      </div>
      {/* Playfield · Surface #161F30 — scatter con separación mínima ~32u previene toques adyacentes accidentales */}
      <div className="relative mt-4 min-h-[58vh] w-full flex-1 overflow-hidden rounded-3xl border-2 border-[color:var(--color-slate-line)] bg-[color:var(--color-steel)]">
        {/* Node · Touch Target 76px + label 30px — óptimo dedo/guante fino sin superposición de nodos */}
        {/* Active target: anillo #FFAE00 3px; error transitorio #EF4444 (250ms) */}
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <button
            key={n}
            onClick={() => tap(n)}
            style={{ left: `${pos[n - 1].x}%`, top: `${pos[n - 1].y}%` }}
            className={`absolute grid h-[76px] w-[76px] place-items-center rounded-full font-mono text-[30px] font-800 leading-none tabular-nums transition-all duration-200 active:scale-90 ${
              bad === n
                ? "border-2 border-[color:var(--color-no)] bg-[color:var(--color-no)]/25 text-[color:var(--color-no)]"
                : n === next
                  ? "border-[3px] border-[color:var(--color-semi)] bg-[color:var(--color-semi)]/15 text-white shadow-[0_0_24px_rgba(255,174,0,0.45)]"
                  : "border-2 border-[color:var(--color-slate-line)] bg-[color:var(--color-steel-2)] text-white"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <p className="mt-4 text-center font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--color-fog)]">
        Series completadas: {cycles.current}
      </p>
    </div>
  )
}
