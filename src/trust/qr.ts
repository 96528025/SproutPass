// OWNER: B6 (trust UI). A tiny QR code encoder (no dependency): byte mode, error correction level M,
// versions 1–6 (up to 106 bytes), which is plenty for "SMSTO:+13105550123:hi". Used by /bag/pet so a judge on a
// laptop can scan the pet's iMessage number with their phone. Follows ISO/IEC 18004 (the same steps as Nayuki's
// reference implementation): data bits → Reed–Solomon blocks → interleave → place → best of the 8 masks.

/** ECC level M, versions 1–6: [data codewords per block, number of blocks, EC codewords per block]. */
const M_BLOCKS: Record<number, { data: number; blocks: number; ec: number }> = {
  1: { data: 16, blocks: 1, ec: 10 },
  2: { data: 28, blocks: 1, ec: 16 },
  3: { data: 44, blocks: 1, ec: 26 },
  4: { data: 32, blocks: 2, ec: 18 },
  5: { data: 43, blocks: 2, ec: 24 },
  6: { data: 27, blocks: 4, ec: 16 },
};
/** Alignment pattern centre (both axes) for versions 2–6; version 1 has none. */
const ALIGN: Record<number, number> = { 2: 18, 3: 22, 4: 26, 5: 30, 6: 34 };
const FORMAT_BITS_M = 0; // ECC level M = 00

export interface QrMatrix {
  size: number;
  version: number;
  /** modules[y][x], true = dark */
  modules: boolean[][];
}

// ---------------------------------------------------------------- Reed–Solomon over GF(256), polynomial 0x11D

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

export function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

export function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor); });
  }
  return result;
}

// ---------------------------------------------------------------- data → codewords

/** The data codewords (mode, count, bytes, terminator, padding) for a version. */
export function dataCodewords(bytes: Uint8Array, version: number): number[] {
  const { data, blocks } = M_BLOCKS[version];
  const capacityBits = data * blocks * 8;
  const bits: number[] = [];
  const put = (val: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(0b0100, 4); // byte mode
  put(bytes.length, 8); // versions 1–9: 8-bit count
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, capacityBits - bits.length)); // terminator
  put(0, (8 - (bits.length % 8)) % 8); // to a byte boundary
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) put(pad, 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  return out;
}

/** Split into blocks, add Reed–Solomon codewords, interleave (all blocks are the same length for M, v1–6). */
export function finalCodewords(data: number[], version: number): number[] {
  const { data: perBlock, blocks, ec } = M_BLOCKS[version];
  const divisor = rsDivisor(ec);
  const dataBlocks: number[][] = [];
  for (let b = 0; b < blocks; b++) dataBlocks.push(data.slice(b * perBlock, (b + 1) * perBlock));
  const ecBlocks = dataBlocks.map((d) => rsRemainder(d, divisor));
  const out: number[] = [];
  for (let i = 0; i < perBlock; i++) for (const d of dataBlocks) out.push(d[i]);
  for (let i = 0; i < ec; i++) for (const e of ecBlocks) out.push(e[i]);
  return out;
}

// ---------------------------------------------------------------- the matrix

class Grid {
  readonly modules: boolean[][];
  readonly isFunction: boolean[][];
  constructor(readonly size: number) {
    this.modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    this.isFunction = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  }
  fn(x: number, y: number, dark: boolean) {
    this.modules[y][x] = dark;
    this.isFunction[y][x] = true;
  }
}

function drawFunctionPatterns(g: Grid, version: number) {
  const n = g.size;
  for (let i = 0; i < n; i++) { g.fn(6, i, i % 2 === 0); g.fn(i, 6, i % 2 === 0); } // timing
  for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) { // finders + separators
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        g.fn(x, y, d !== 2 && d !== 4);
      }
    }
  }
  const a = ALIGN[version];
  if (a) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) g.fn(a + dx, a + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  drawFormatBits(g, 0); // reserve the format areas (redrawn with the chosen mask)
}

export function formatBits(mask: number): number {
  const data = (FORMAT_BITS_M << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function drawFormatBits(g: Grid, mask: number) {
  const bits = formatBits(mask);
  const bit = (i: number) => ((bits >>> i) & 1) !== 0;
  const n = g.size;
  for (let i = 0; i <= 5; i++) g.fn(8, i, bit(i));
  g.fn(8, 7, bit(6));
  g.fn(8, 8, bit(7));
  g.fn(7, 8, bit(8));
  for (let i = 9; i < 15; i++) g.fn(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) g.fn(n - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) g.fn(8, n - 15 + i, bit(i));
  g.fn(8, n - 8, true); // the dark module
}

function drawCodewords(g: Grid, data: number[]) {
  const n = g.size;
  let i = 0;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < n; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? n - 1 - vert : vert;
        if (!g.isFunction[y][x] && i < data.length * 8) {
          g.modules[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
      }
    }
  }
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(g: Grid, mask: number) {
  const f = MASKS[mask];
  for (let y = 0; y < g.size; y++) {
    for (let x = 0; x < g.size; x++) if (!g.isFunction[y][x] && f(x, y)) g.modules[y][x] = !g.modules[y][x];
  }
}

/** The standard penalty (lower scans better): runs, 2×2 blocks, finder look-alikes, dark balance. */
export function penalty(m: boolean[][]): number {
  const n = m.length;
  let score = 0;
  const line = (get: (i: number) => boolean) => {
    let run = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && get(i) === get(i - 1)) run++;
      else { if (run >= 5) score += 3 + (run - 5); run = 1; }
    }
    const pattern = [true, false, true, true, true, false, true];
    for (let i = 0; i + 7 <= n; i++) {
      if (!pattern.every((p, k) => get(i + k) === p)) continue;
      const lightBefore = [1, 2, 3, 4].every((k) => i - k < 0 || !get(i - k));
      const lightAfter = [0, 1, 2, 3].every((k) => i + 7 + k >= n || !get(i + 7 + k));
      if (lightBefore || lightAfter) score += 40;
    }
  };
  for (let y = 0; y < n; y++) line((x) => m[y][x]);
  for (let x = 0; x < n; x++) line((y) => m[y][x]);
  for (let y = 0; y + 1 < n; y++) {
    for (let x = 0; x + 1 < n; x++) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
    }
  }
  const dark = m.reduce((a, row) => a + row.filter(Boolean).length, 0);
  score += 10 * Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5);
  return score;
}

/** Encode text (UTF-8) as a QR code, ECC level M. Throws when it doesn't fit version 6 (106 bytes). */
export function encodeQr(text: string, forceMask?: number): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  const version = [1, 2, 3, 4, 5, 6].find((v) => (M_BLOCKS[v].data * M_BLOCKS[v].blocks * 8) - 12 >= bytes.length * 8);
  if (!version) throw new Error("Too long for a small QR code.");
  const size = version * 4 + 17;
  const codewords = finalCodewords(dataCodewords(bytes, version), version);

  let best: { mask: number; modules: boolean[][]; score: number } | null = null;
  for (const mask of forceMask === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [forceMask]) {
    const g = new Grid(size);
    drawFunctionPatterns(g, version);
    drawCodewords(g, codewords);
    applyMask(g, mask);
    drawFormatBits(g, mask);
    const score = penalty(g.modules);
    if (!best || score < best.score) best = { mask, modules: g.modules, score };
  }
  return { size, version, modules: best!.modules };
}

/** An SVG path ("M x y h1 v1 h-1 z" per dark module) with a 4-module quiet zone; viewBox = 0 0 (size+8) (size+8). */
export function qrPath(q: QrMatrix, quiet = 4): string {
  const parts: string[] = [];
  for (let y = 0; y < q.size; y++) {
    for (let x = 0; x < q.size; x++) if (q.modules[y][x]) parts.push(`M${x + quiet} ${y + quiet}h1v1h-1z`);
  }
  return parts.join("");
}
