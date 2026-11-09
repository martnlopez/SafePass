// Distribución aleatoria de los nodos del Test 5 (Tracking Numérico) sin colisiones.
// Trabaja en píxeles reales del área de juego: el círculo mide NODE_SIZE px en
// cualquier pantalla, así que la separación también debe medirse en px.

export const NODE_SIZE = 76 // diámetro del círculo (touch target)
export const NODE_GAP = 20 // separación mínima entre bordes de dos círculos
export const EDGE_PADDING = 12 // margen entre un círculo y el borde del área

export interface Point {
  x: number // centro, px
  y: number // centro, px
}

const MIN_CENTER_DISTANCE = NODE_SIZE + NODE_GAP
const RADIUS = NODE_SIZE / 2
const ROUNDS = 40
const TRIES_PER_ROUND = 250

const randBetween = (min: number, max: number) => min + Math.random() * (max - min)

/**
 * `count` centros aleatorios dentro de un área `width` × `height` (px) tales que:
 *  - ningún círculo sale del área (más EDGE_PADDING),
 *  - la distancia entre centros es ≥ NODE_SIZE + NODE_GAP (sin superposición ni roce).
 * Muestreo por rechazo: si una posición colisiona se descarta y se recalcula; si tras
 * varias rondas no hay espacio, usa una grilla con desplazamiento aleatorio que
 * garantiza la separación.
 */
export function scatter(width: number, height: number, count = 6): Point[] {
  const minX = RADIUS + EDGE_PADDING
  const maxX = width - RADIUS - EDGE_PADDING
  const minY = RADIUS + EDGE_PADDING
  const maxY = height - RADIUS - EDGE_PADDING
  if (maxX < minX || maxY < minY) return jitteredGrid(width, height, count)

  for (let round = 0; round < ROUNDS; round++) {
    const spots: Point[] = []
    for (let tries = 0; tries < TRIES_PER_ROUND && spots.length < count; tries++) {
      const p = { x: randBetween(minX, maxX), y: randBetween(minY, maxY) }
      if (spots.every((s) => Math.hypot(s.x - p.x, s.y - p.y) >= MIN_CENTER_DISTANCE)) spots.push(p)
    }
    if (spots.length === count) return spots
  }
  return jitteredGrid(width, height, count)
}

/** Grilla (3×2 horizontal / 2×3 vertical) con desplazamiento aleatorio dentro de cada celda */
function jitteredGrid(width: number, height: number, count: number): Point[] {
  const landscape = width >= height
  const cols = landscape ? Math.ceil(count / 2) : 2
  const rows = Math.ceil(count / cols)
  const cellW = (width - 2 * EDGE_PADDING) / cols
  const cellH = (height - 2 * EDGE_PADDING) / rows
  // Cuánto puede moverse el centro sin acercarse a la celda vecina más de lo permitido
  const jitterX = Math.max(0, (cellW - MIN_CENTER_DISTANCE) / 2)
  const jitterY = Math.max(0, (cellH - MIN_CENTER_DISTANCE) / 2)

  const cells = Array.from({ length: cols * rows }, (_, i) => i).sort(() => Math.random() - 0.5)
  return cells.slice(0, count).map((i) => ({
    x: EDGE_PADDING + cellW * ((i % cols) + 0.5) + randBetween(-jitterX, jitterX),
    y: EDGE_PADDING + cellH * (Math.floor(i / cols) + 0.5) + randBetween(-jitterY, jitterY),
  }))
}

/** Menor distancia entre centros (para verificación) */
export function minDistance(points: Point[]): number {
  let min = Infinity
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++)
      min = Math.min(min, Math.hypot(points[i]!.x - points[j]!.x, points[i]!.y - points[j]!.y))
  return min
}
