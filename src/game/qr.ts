/**
 * Tiny QR Code model 2 encoder, byte mode only, so an invite can be scanned.
 * No dependency. Returns null when the text does not fit in a version-20 symbol.
 */

const ECC_PER: number[][] = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26],
]
const ECC_BLOCKS: number[][] = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16],
]
/** L = 1, M = 0, matching the format-bit field. */
const FORMAT_BITS = [1, 0]
const MAX_VERSION = 20

export function qrModules(text: string): boolean[][] | null {
  const data = new TextEncoder().encode(text)
  const picked = pickVersion(data.length)
  if (!picked) return null
  const bits = byteBits(data, picked.version)
  const words = bitsToCodewords(bits, dataCodewords(picked.version, picked.ecl))
  const modules = Array.from({ length: picked.size }, () => Array.from({ length: picked.size }, () => false))
  const fn = Array.from({ length: picked.size }, () => Array.from({ length: picked.size }, () => false))
  drawFunction(modules, fn, picked.version, picked.size)
  drawCodewords(modules, fn, eccAndInterleave(words, picked.version, picked.ecl), picked.size)
  let bestMask = 0
  let bestScore = Number.POSITIVE_INFINITY
  let best: boolean[][] | null = null
  for (let mask = 0; mask < 8; mask++) {
    const copy = modules.map((row) => row.slice())
    applyMask(copy, fn, mask)
    drawFormat(copy, fn, picked.size, FORMAT_BITS[picked.ecl] ?? 1, mask)
    const score = penalty(copy)
    if (score < bestScore) {
      bestScore = score
      bestMask = mask
      best = copy
    }
  }
  if (!best) return null
  applyMask(modules, fn, bestMask)
  drawFormat(modules, fn, picked.size, FORMAT_BITS[picked.ecl] ?? 1, bestMask)
  return modules
}

export function drawQr(canvas: HTMLCanvasElement, text: string): boolean {
  const modules = qrModules(text)
  const ctx = canvas.getContext('2d')
  if (!modules || !ctx) {
    canvas.hidden = true
    return false
  }
  const quiet = 4
  const scale = Math.max(2, Math.min(4, Math.floor(300 / (modules.length + quiet * 2))))
  const size = (modules.length + quiet * 2) * scale
  canvas.width = size
  canvas.height = size
  canvas.hidden = false
  ctx.fillStyle = '#f4f1e4'
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = '#14180f'
  for (let y = 0; y < modules.length; y++) {
    const row = modules[y] ?? []
    for (let x = 0; x < row.length; x++) {
      if (row[x]) ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale)
    }
  }
  return true
}

function pickVersion(nbytes: number): { version: number; ecl: number; size: number } | null {
  for (const ecl of [1, 0]) {
    for (let version = 1; version <= MAX_VERSION; version++) {
      const capacity = dataCodewords(version, ecl) * 8
      if (capacity >= bitsNeeded(nbytes, version)) return { version, ecl, size: version * 4 + 17 }
    }
  }
  return null
}

function bitsNeeded(nbytes: number, version: number): number {
  return 4 + (version <= 9 ? 8 : 16) + nbytes * 8
}

function dataCodewords(version: number, ecl: number): number {
  return Math.floor(rawModules(version) / 8) - (ECC_PER[ecl]?.[version] ?? 0) * (ECC_BLOCKS[ecl]?.[version] ?? 0)
}

function rawModules(version: number): number {
  let result = (16 * version + 128) * version + 64
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2
    result -= (25 * numAlign - 10) * numAlign - 55
    if (version >= 7) result -= 36
  }
  return result
}

function byteBits(data: Uint8Array, version: number): number[] {
  const bits: number[] = []
  pushBits(bits, 0b0100, 4)
  pushBits(bits, data.length, version <= 9 ? 8 : 16)
  for (const byte of data) pushBits(bits, byte, 8)
  return bits
}

function pushBits(bits: number[], value: number, len: number): void {
  for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1)
}

function bitsToCodewords(bits: number[], count: number): number[] {
  const out = bits.slice()
  const terminator = Math.min(4, count * 8 - out.length)
  for (let i = 0; i < terminator; i++) out.push(0)
  while (out.length % 8 !== 0) out.push(0)
  const bytes: number[] = []
  for (let i = 0; i < out.length; i += 8) {
    let byte = 0
    for (let b = 0; b < 8; b++) byte = (byte << 1) | (out[i + b] ?? 0)
    bytes.push(byte)
  }
  for (let pad = 0; bytes.length < count; pad++) bytes.push(pad % 2 === 0 ? 0xec : 0x11)
  return bytes.slice(0, count)
}

function eccAndInterleave(data: number[], version: number, ecl: number): number[] {
  const numBlocks = ECC_BLOCKS[ecl]?.[version] ?? 1
  const blockEcc = ECC_PER[ecl]?.[version] ?? 1
  const raw = Math.floor(rawModules(version) / 8)
  const numShort = numBlocks - (raw % numBlocks)
  const shortLen = Math.floor(raw / numBlocks)
  const divisor = rsDivisor(blockEcc)
  const blocks: number[][] = []
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const take = shortLen - blockEcc + (i < numShort ? 0 : 1)
    const dat = data.slice(k, k + take)
    k += dat.length
    const ecc = rsRemainder(dat, divisor)
    if (i < numShort) dat.push(0)
    blocks.push(dat.concat(ecc))
  }
  const result: number[] = []
  const span = blocks[0]?.length ?? 0
  for (let i = 0; i < span; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortLen - blockEcc || j >= numShort) result.push(block[i] ?? 0)
    })
  }
  return result
}

function rsDivisor(degree: number): number[] {
  const result = Array.from({ length: degree }, () => 0)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = rsMul(result[j] ?? 0, root)
      if (j + 1 < result.length) result[j] ^= result[j + 1] ?? 0
    }
    root = rsMul(root, 0x02)
  }
  return result
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = divisor.map(() => 0)
  for (const byte of data) {
    const factor = byte ^ (result.shift() ?? 0)
    result.push(0)
    divisor.forEach((coef, i) => {
      result[i] = (result[i] ?? 0) ^ rsMul(coef, factor)
    })
  }
  return result
}

function rsMul(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z & 0xff
}

function drawFunction(modules: boolean[][], fn: boolean[][], version: number, size: number): void {
  for (let i = 0; i < size; i++) {
    setFn(modules, fn, 6, i, i % 2 === 0)
    setFn(modules, fn, i, 6, i % 2 === 0)
  }
  drawFinder(modules, fn, 3, 3, size)
  drawFinder(modules, fn, size - 4, 3, size)
  drawFinder(modules, fn, 3, size - 4, size)
  const align = alignmentPositions(version, size)
  for (let i = 0; i < align.length; i++) {
    for (let j = 0; j < align.length; j++) {
      if (i === 0 && j === 0) continue
      if (i === 0 && j === align.length - 1) continue
      if (i === align.length - 1 && j === 0) continue
      drawAlign(modules, fn, align[i] ?? 0, align[j] ?? 0)
    }
  }
  drawFormat(modules, fn, size, 1, 0)
  drawVersion(modules, fn, version, size)
}

function alignmentPositions(version: number, size: number): number[] {
  if (version === 1) return []
  const numAlign = Math.floor(version / 7) + 2
  const step = Math.floor((version * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2
  const result = [6]
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos)
  return result
}

function drawFinder(modules: boolean[][], fn: boolean[][], x: number, y: number, size: number): void {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const xx = x + dx
      const yy = y + dy
      if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue
      const dist = Math.max(Math.abs(dx), Math.abs(dy))
      setFn(modules, fn, xx, yy, dist !== 2 && dist !== 4)
    }
  }
}

function drawAlign(modules: boolean[][], fn: boolean[][], x: number, y: number): void {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) setFn(modules, fn, x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
  }
}

function drawFormat(modules: boolean[][], fn: boolean[][], size: number, formatBits: number, mask: number): void {
  const data = (formatBits << 3) | mask
  let rem = data
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  const bits = ((data << 10) | rem) ^ 0x5412
  for (let i = 0; i <= 5; i++) setFn(modules, fn, 8, i, bit(bits, i))
  setFn(modules, fn, 8, 7, bit(bits, 6))
  setFn(modules, fn, 8, 8, bit(bits, 7))
  setFn(modules, fn, 7, 8, bit(bits, 8))
  for (let i = 9; i < 15; i++) setFn(modules, fn, 14 - i, 8, bit(bits, i))
  for (let i = 0; i < 8; i++) setFn(modules, fn, size - 1 - i, 8, bit(bits, i))
  for (let i = 8; i < 15; i++) setFn(modules, fn, 8, size - 15 + i, bit(bits, i))
  setFn(modules, fn, 8, size - 8, true)
}

function drawVersion(modules: boolean[][], fn: boolean[][], version: number, size: number): void {
  if (version < 7) return
  let rem = version
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
  const bits = (version << 12) | rem
  for (let i = 0; i < 18; i++) {
    const on = bit(bits, i)
    const a = size - 11 + (i % 3)
    const b = Math.floor(i / 3)
    setFn(modules, fn, a, b, on)
    setFn(modules, fn, b, a, on)
  }
}

function drawCodewords(modules: boolean[][], fn: boolean[][], data: number[], size: number): void {
  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vert : vert
        if (!fn[y]?.[x] && i < data.length * 8) {
          const row = modules[y]
          if (row) row[x] = bit(data[i >>> 3] ?? 0, 7 - (i & 7))
          i++
        }
      }
    }
  }
}

function applyMask(modules: boolean[][], fn: boolean[][], mask: number): void {
  for (let y = 0; y < modules.length; y++) {
    for (let x = 0; x < modules.length; x++) {
      if (fn[y]?.[x]) continue
      let invert = false
      if (mask === 0) invert = (x + y) % 2 === 0
      else if (mask === 1) invert = y % 2 === 0
      else if (mask === 2) invert = x % 3 === 0
      else if (mask === 3) invert = (x + y) % 3 === 0
      else if (mask === 4) invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0
      else if (mask === 5) invert = (x * y) % 2 + (x * y) % 3 === 0
      else if (mask === 6) invert = ((x * y) % 2 + (x * y) % 3) % 2 === 0
      else invert = ((x + y) % 2 + (x * y) % 3) % 2 === 0
      if (invert) {
        const row = modules[y]
        if (row) row[x] = !row[x]
      }
    }
  }
}

function penalty(modules: boolean[][]): number {
  const size = modules.length
  let result = 0
  for (let y = 0; y < size; y++) result += runPenalty(modules[y] ?? [])
  for (let x = 0; x < size; x++) {
    const col: boolean[] = []
    for (let y = 0; y < size; y++) col.push(Boolean(modules[y]?.[x]))
    result += runPenalty(col)
  }
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const color = modules[y]?.[x]
      if (color === modules[y]?.[x + 1] && color === modules[y + 1]?.[x] && color === modules[y + 1]?.[x + 1]) result += 3
    }
  }
  let dark = 0
  for (const row of modules) for (const cell of row) if (cell) dark++
  const total = size * size
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1
  result += k * 10
  return result
}

function runPenalty(line: boolean[]): number {
  let result = 0
  let color = false
  let run = 0
  for (const cell of line) {
    if (cell === color) {
      run++
      if (run === 5) result += 3
      else if (run > 5) result++
    } else {
      color = cell
      run = 1
    }
  }
  return result
}

function setFn(modules: boolean[][], fn: boolean[][], x: number, y: number, dark: boolean): void {
  const row = modules[y]
  const mark = fn[y]
  if (!row || !mark) return
  row[x] = dark
  mark[x] = true
}

function bit(value: number, i: number): boolean {
  return ((value >>> i) & 1) !== 0
}
