// Adaptive-test helpers. 3PL item-response model.
//   P(θ) = c + (1 - c) / (1 + exp(-1.7 * a * (θ - b)))
// Fisher information per item:
//   I(θ) = (1.7 * a)^2 * Q(θ)/P(θ) * ((P(θ) - c) / (1 - c))^2
// We use these to pick the next item by maximum information at the current
// θ̂ estimate. Items without IRT params fall back to a difficulty-band heuristic.

interface IrtItem {
  questionId: string
  a: number | null
  b: number | null
  c: number | null
  difficultyBand: string
}

const D = 1.7

export function prob3pl(theta: number, a: number, b: number, c: number): number {
  const z = D * a * (theta - b)
  const p = c + (1 - c) / (1 + Math.exp(-z))
  return Math.max(1e-6, Math.min(1 - 1e-6, p))
}

export function information(theta: number, a: number, b: number, c: number): number {
  const p = prob3pl(theta, a, b, c)
  const q = 1 - p
  const num = (p - c) / (1 - c)
  return (D * a) ** 2 * (q / p) * num * num
}

function bandHeuristicInfo(theta: number, band: string): number {
  // L1=easy, L2=medium, L3=hard. Convert band to a pseudo-b and use default a=1, c=0.2.
  const b = band === 'L1' ? -1 : band === 'L3' ? 1 : 0
  return information(theta, 1, b, 0.2)
}

export function pickNextItem(
  theta: number,
  candidates: IrtItem[],
  excludeIds: ReadonlySet<string>
): IrtItem | null {
  let best: IrtItem | null = null
  let bestInfo = -Infinity
  for (const item of candidates) {
    if (excludeIds.has(item.questionId)) continue
    const info =
      item.a !== null && item.b !== null
        ? information(theta, item.a, item.b, item.c ?? 0.2)
        : bandHeuristicInfo(theta, item.difficultyBand)
    if (info > bestInfo) {
      bestInfo = info
      best = item
    }
  }
  return best
}

// Closed-form θ update by Newton-Raphson on the log-likelihood.
// Used to refresh θ̂ after each response in adaptive mode.
export function updateTheta(
  prior: number,
  responses: { a: number; b: number; c: number; correct: boolean }[]
): number {
  if (responses.length === 0) return prior
  let theta = prior
  for (let iter = 0; iter < 25; iter++) {
    let g = 0
    let h = 0
    for (const r of responses) {
      const p = prob3pl(theta, r.a, r.b, r.c)
      const q = 1 - p
      const w = D * r.a * ((p - r.c) / (1 - r.c))
      g += w * ((r.correct ? 1 : 0) - p)
      h += -w * w * (q / p)
    }
    if (Math.abs(h) < 1e-9) break
    const step = g / h
    theta -= step
    if (Math.abs(step) < 1e-4) break
  }
  return Math.max(-4, Math.min(4, theta))
}

export function thetaToScaled(theta: number): number {
  const scaled = Math.round(500 + 100 * theta)
  return Math.max(100, Math.min(900, scaled))
}
