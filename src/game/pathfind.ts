const SQRT2 = 1.41421356237

const DIRS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
]

function heuristic(x: number, y: number, gx: number, gy: number): number {
  const dx = Math.abs(x - gx)
  const dy = Math.abs(y - gy)
  return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy)
}

class MinHeap {
  private nodes: number[] = []
  private pri: number[] = []

  get length(): number {
    return this.nodes.length
  }

  push(node: number, priority: number): void {
    this.nodes.push(node)
    this.pri.push(priority)
    this.up(this.nodes.length - 1)
  }

  pop(): number {
    const top = this.nodes[0] ?? 0
    const lastN = this.nodes.pop()
    const lastP = this.pri.pop()
    if (this.nodes.length > 0 && lastN !== undefined && lastP !== undefined) {
      this.nodes[0] = lastN
      this.pri[0] = lastP
      this.down(0)
    }
    return top
  }

  private up(i: number): void {
    while (i > 0) {
      const p = (i - 1) >> 1
      if ((this.pri[i] ?? 0) >= (this.pri[p] ?? 0)) break
      this.swap(i, p)
      i = p
    }
  }

  private down(i: number): void {
    const n = this.nodes.length
    for (;;) {
      let best = i
      const l = i * 2 + 1
      const r = l + 1
      if (l < n && (this.pri[l] ?? 0) < (this.pri[best] ?? 0)) best = l
      if (r < n && (this.pri[r] ?? 0) < (this.pri[best] ?? 0)) best = r
      if (best === i) break
      this.swap(i, best)
      i = best
    }
  }

  private swap(a: number, b: number): void {
    const nA = this.nodes[a] ?? 0
    const nB = this.nodes[b] ?? 0
    const pA = this.pri[a] ?? 0
    const pB = this.pri[b] ?? 0
    this.nodes[a] = nB
    this.nodes[b] = nA
    this.pri[a] = pB
    this.pri[b] = pA
  }
}

export function findPath(
  blocked: Uint8Array,
  w: number,
  h: number,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
  penalty?: Uint8Array,
): Array<{ tx: number; ty: number }> | null {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h
  if (!inside(sx, sy) || !inside(gx, gy)) return null
  const at = (x: number, y: number) => y * w + x
  if (blocked[at(sx, sy)] || blocked[at(gx, gy)]) return null
  if (sx === gx && sy === gy) return []

  const open = new MinHeap()
  const gScore = new Float32Array(w * h)
  gScore.fill(Number.POSITIVE_INFINITY)
  const came = new Int32Array(w * h)
  came.fill(-1)
  const closed = new Uint8Array(w * h)
  const start = at(sx, sy)
  gScore[start] = 0
  open.push(start, heuristic(sx, sy, gx, gy))

  while (open.length > 0) {
    const cur = open.pop()
    if (closed[cur]) continue
    const cx = cur % w
    const cy = (cur / w) | 0
    if (cx === gx && cy === gy) {
      const path: Array<{ tx: number; ty: number }> = []
      let p = cur
      while (p !== start && p !== -1) {
        path.push({ tx: p % w, ty: (p / w) | 0 })
        p = came[p] ?? -1
      }
      path.reverse()
      return smoothPath(blocked, w, h, [{ tx: sx, ty: sy }, ...path], penalty).slice(1)
    }
    closed[cur] = 1
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx
      const ny = cy + dy
      if (!inside(nx, ny)) continue
      const ni = at(nx, ny)
      if (blocked[ni] || closed[ni]) continue
      if (dx !== 0 && dy !== 0) {
        if (blocked[at(cx + dx, cy)] || blocked[at(cx, cy + dy)]) continue
      }
      const ng = (gScore[cur] ?? Infinity) + cost + (penalty?.[ni] ?? 0)
      if (ng >= (gScore[ni] ?? Infinity)) continue
      gScore[ni] = ng
      came[ni] = cur
      open.push(ni, ng + heuristic(nx, ny, gx, gy))
    }
  }
  return null
}

function smoothPath(
  blocked: Uint8Array,
  w: number,
  h: number,
  path: Array<{ tx: number; ty: number }>,
  penalty?: Uint8Array,
): Array<{ tx: number; ty: number }> {
  if (path.length <= 2) return path
  const out: Array<{ tx: number; ty: number }> = []
  const first = path[0]
  if (!first) return path
  out.push(first)
  let anchor = 0
  for (let i = 2; i < path.length; i++) {
    const from = path[anchor]
    const to = path[i]
    if (!from || !to || !segmentOpen(blocked, w, h, from, to, penalty)) {
      const mid = path[i - 1]
      if (mid) out.push(mid)
      anchor = i - 1
    }
  }
  const last = path[path.length - 1]
  if (last) out.push(last)
  return out
}

/** A shortcut may cross open ground. Soft unit costs stay on the detour instead of being cut. */
function segmentOpen(
  blocked: Uint8Array,
  w: number,
  h: number,
  a: { tx: number; ty: number },
  b: { tx: number; ty: number },
  penalty?: Uint8Array,
): boolean {
  if (!rayClear(blocked, w, h, a, b)) return false
  if (!penalty) return true
  let x = a.tx
  let y = a.ty
  const dx = Math.abs(b.tx - a.tx)
  const dy = Math.abs(b.ty - a.ty)
  const sx = a.tx < b.tx ? 1 : -1
  const sy = a.ty < b.ty ? 1 : -1
  let err = dx - dy
  for (let guard = 0; guard <= dx + dy + 1; guard++) {
    if (!(x === a.tx && y === a.ty) && !(x === b.tx && y === b.ty) && (penalty[y * w + x] ?? 0) > 0) return false
    if (x === b.tx && y === b.ty) return true
    const e2 = 2 * err
    if (e2 > -dy) {
      err -= dy
      x += sx
    }
    if (e2 < dx) {
      err += dx
      y += sy
    }
  }
  return true
}

/** True when the tile segment does not cross a blocked cell or a blocked corner. */
export function rayClear(
  blocked: Uint8Array,
  w: number,
  h: number,
  a: { tx: number; ty: number },
  b: { tx: number; ty: number },
): boolean {
  let x = a.tx
  let y = a.ty
  const dx = Math.abs(b.tx - a.tx)
  const dy = Math.abs(b.ty - a.ty)
  const sx = a.tx < b.tx ? 1 : -1
  const sy = a.ty < b.ty ? 1 : -1
  let err = dx - dy
  const guardMax = dx + dy + 4
  for (let guard = 0; guard < guardMax; guard++) {
    if (x === b.tx && y === b.ty) return true
    const e2 = 2 * err
    const prevX = x
    const prevY = y
    if (e2 > -dy) {
      err -= dy
      x += sx
    }
    if (e2 < dx) {
      err += dx
      y += sy
    }
    if (x !== prevX && y !== prevY) {
      const sideA = prevY * w + x
      const sideB = y * w + prevX
      if (
        x < 0 ||
        y < 0 ||
        prevX < 0 ||
        prevY < 0 ||
        x >= w ||
        y >= h ||
        prevX >= w ||
        prevY >= h ||
        blocked[sideA] ||
        blocked[sideB]
      ) {
        return false
      }
    }
    if (x < 0 || y < 0 || x >= w || y >= h || blocked[y * w + x]) return false
  }
  return false
}

/**
 * True when a shot from tile A to tile B does not cross gray rock.
 * The start tile and the destination tile do not themselves block the shot,
 * so a worker can still chip the rock they are standing next to.
 */
export function rockShotClear(
  tiles: Uint8Array,
  w: number,
  h: number,
  a: { tx: number; ty: number },
  b: { tx: number; ty: number },
): boolean {
  if (a.tx === b.tx && a.ty === b.ty) return true
  let x = a.tx
  let y = a.ty
  const dx = Math.abs(b.tx - a.tx)
  const dy = Math.abs(b.ty - a.ty)
  const sx = a.tx < b.tx ? 1 : -1
  const sy = a.ty < b.ty ? 1 : -1
  let err = dx - dy
  const rock = (tx: number, ty: number) => {
    if (tx === a.tx && ty === a.ty) return false
    if (tx === b.tx && ty === b.ty) return false
    if (tx < 0 || ty < 0 || tx >= w || ty >= h) return true
    return tiles[ty * w + tx] === 1
  }
  const guardMax = dx + dy + 4
  for (let guard = 0; guard < guardMax; guard++) {
    if (x === b.tx && y === b.ty) return true
    const e2 = 2 * err
    const prevX = x
    const prevY = y
    if (e2 > -dy) {
      err -= dy
      x += sx
    }
    if (e2 < dx) {
      err += dx
      y += sy
    }
    if (x !== prevX && y !== prevY && (rock(x, prevY) || rock(prevX, y))) return false
    if (rock(x, y)) return false
  }
  return false
}
