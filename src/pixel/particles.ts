// A5: canvas particle system for the golden-flower celebration.
// Integer positions only, simulated and drawn at 12 fps steps (not every rAF), pooled, capped at 160 live,
// one rAF loop per canvas. Under prefers-reduced-motion createBurst draws a single static ring of 8 flowers.
import { SPRITES, type SpriteName } from "@/pixel/sprites";

export type BurstKind = "flowers" | "petals" | "sparkle";
export interface BurstOptions {
  /** CSS-pixel position inside the canvas (the canvas's width/height attributes are its CSS size). */
  x: number;
  y: number;
  kind: BurstKind;
  count: number;
}

export const MAX_LIVE = 160;
const TICK_MS = 1000 / 12;
const RING_RADIUS = 56;

interface Kind {
  sprite: SpriteName;
  scale: number;
}
const KINDS: Record<BurstKind, Kind> = {
  flowers: { sprite: "fx_flower", scale: 3 },
  petals: { sprite: "fx_petal", scale: 2 },
  sparkle: { sprite: "fx_sparkle", scale: 2 },
};

interface Particle {
  live: boolean;
  burst: number;
  kind: BurstKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  phase: number;
}

const prefersReduced = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const images = new Map<SpriteName, HTMLImageElement>();
function image(name: SpriteName): HTMLImageElement | null {
  let img = images.get(name);
  if (!img) {
    img = new Image();
    img.src = SPRITES[name].src;
    images.set(name, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

/** Math.random is fine here: the burst is decoration, not state */
const rnd = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));
const FLUTTER = [-4, 0, 4, 0];

class Engine {
  pool: Particle[] = Array.from({ length: MAX_LIVE }, () => ({
    live: false, burst: 0, kind: "flowers" as BurstKind, x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 0, phase: 0,
  }));
  rings: { burst: number; x: number; y: number }[] = [];
  raf = 0;
  last = 0;
  acc = 0;
  nextBurst = 1;
  ctx: CanvasRenderingContext2D | null;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d");
    canvas.style.imageRendering = "pixelated";
  }

  liveCount() {
    let n = 0;
    for (const p of this.pool) if (p.live) n++;
    return n;
  }

  spawn(burst: number, o: BurstOptions) {
    let free = MAX_LIVE - this.liveCount();
    const w = this.canvas.width;
    for (const p of this.pool) {
      if (free <= 0 || o.count <= 0) break;
      if (p.live) continue;
      free--;
      o.count--;
      p.live = true;
      p.burst = burst;
      p.kind = o.kind;
      p.age = 0;
      p.phase = rnd(0, 3);
      if (o.kind === "flowers") {
        // fan outwards (biased upwards), slow down by drag, then hold and blink out
        const sp = rnd(3, 6);
        const dir = rnd(0, 15); // 16 headings, integer maths below
        const dx = [4, 4, 3, 2, 0, -2, -3, -4, -4, -4, -3, -2, 0, 2, 3, 4][dir];
        const dy = [0, -2, -3, -4, -4, -4, -3, -2, 0, 2, 3, 4, 4, 4, 3, 2][dir];
        p.x = o.x;
        p.y = o.y;
        p.vx = Math.round((dx * sp) / 2);
        p.vy = Math.round((dy * sp) / 2) - 2;
        p.life = rnd(30, 44);
      } else if (o.kind === "petals") {
        p.x = o.x + rnd(-w / 2, w / 2);
        p.y = o.y - rnd(0, 200);
        p.vx = 0;
        p.vy = rnd(2, 4) * 2;
        p.life = 1000; // dies when it leaves the canvas
      } else {
        p.x = o.x + rnd(-40, 40);
        p.y = o.y + rnd(-40, 24);
        p.vx = 0;
        p.vy = 0;
        p.age = -rnd(0, 6); // staggered start
        p.life = rnd(5, 9);
      }
    }
  }

  step() {
    const h = this.canvas.height;
    for (const p of this.pool) {
      if (!p.live) continue;
      p.age++;
      if (p.kind === "flowers") {
        p.x += p.vx;
        p.y += p.vy;
        // drag: halve every 3 ticks, then a lazy drift down
        if (p.age % 3 === 0) {
          p.vx = Math.trunc(p.vx / 2);
          p.vy = Math.trunc(p.vy / 2);
        }
        if (p.vx === 0 && p.vy === 0 && p.age % 6 === 0) p.y += 4;
      } else if (p.kind === "petals") {
        p.y += p.vy;
        p.x += FLUTTER[(p.age + p.phase) & 3];
        if (p.y > h + 32) p.live = false;
      }
      if (p.age >= p.life) p.live = false;
    }
    if (this.liveCount() === 0 && this.rings.length === 0) this.halt();
  }

  draw() {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const r of this.rings) this.ring(ctx, r.x, r.y);
    for (const p of this.pool) {
      if (!p.live || p.age < 0) continue;
      const k = KINDS[p.kind];
      const def = SPRITES[k.sprite];
      const img = image(k.sprite);
      if (!img) continue;
      const anim = Object.values(def.anims)[0]!;
      let frame: number;
      if (p.kind === "flowers") {
        if (p.life - p.age < 8 && p.age % 2 === 0) continue; // blink out (dither), no opacity tween
        frame = Math.min(anim.len - 1, Math.floor(p.age / 2)); // bloom once, then hold
      } else if (p.kind === "petals") {
        frame = Math.floor((p.age + p.phase) / 3) % anim.len; // 2-frame flutter
      } else {
        frame = p.age % anim.len;
      }
      const fs = def.frame;
      const size = fs * k.scale;
      ctx.drawImage(img, (anim.start + frame) * fs, 0, fs, fs, Math.round(p.x - size / 2), Math.round(p.y - size / 2), size, size);
    }
  }

  ring(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
    const img = image("fx_flower");
    if (!img) return;
    const k = KINDS.flowers;
    const fs = SPRITES.fx_flower.frame;
    const size = fs * k.scale;
    const last = SPRITES.fx_flower.anims.bloom!.len - 1;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const x = Math.round((cx + Math.cos(a) * RING_RADIUS) / 4) * 4;
      const y = Math.round((cy + Math.sin(a) * RING_RADIUS) / 4) * 4;
      ctx.drawImage(img, last * fs, 0, fs, fs, x - size / 2, y - size / 2, size, size);
    }
  }

  frame = (t: number) => {
    this.raf = requestAnimationFrame(this.frame);
    if (!this.last) this.last = t;
    this.acc += t - this.last;
    this.last = t;
    if (this.acc < TICK_MS) return;
    this.acc = Math.min(this.acc % TICK_MS, TICK_MS); // never catch up in a burst after a stall
    this.step();
    this.draw();
  };

  start() {
    if (this.raf) return;
    this.last = 0;
    this.acc = TICK_MS; // draw the first frame immediately
    this.raf = requestAnimationFrame(this.frame);
  }

  halt() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
    engines.delete(this.canvas);
  }
}

const engines = new WeakMap<HTMLCanvasElement, Engine>();

export function createBurst(canvas: HTMLCanvasElement, opts: BurstOptions): { stop(): void } {
  let engine = engines.get(canvas);
  if (!engine) {
    engine = new Engine(canvas);
    engines.set(canvas, engine);
  }
  const eng = engine;
  const id = eng.nextBurst++;

  if (prefersReduced()) {
    // static ring of 8 flowers; no loop, no petals or sparkles
    if (opts.kind === "flowers") {
      eng.rings.push({ burst: id, x: opts.x, y: opts.y });
      const redraw = () => eng.draw();
      redraw();
      // sprite may still be loading on first use
      images.get("fx_flower")?.addEventListener("load", redraw, { once: true });
    }
  } else {
    eng.spawn(id, { ...opts });
    eng.start();
  }

  return {
    stop() {
      for (const p of eng.pool) if (p.burst === id) p.live = false;
      eng.rings = eng.rings.filter((r) => r.burst !== id);
      if (eng.liveCount() === 0 && eng.rings.length === 0) eng.halt();
      else if (!eng.raf) eng.draw();
    },
  };
}
