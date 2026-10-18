// A tiny sfxr-style synthesizer: square / triangle / saw / sine / noise voices with ADSR and pitch slide,
// mixed into a mono Float32 buffer, peak-normalised, written as 44.1 kHz 16-bit PCM WAV.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const SR = 44100;
export type Wave = "square" | "tri" | "saw" | "sine" | "noise";

export interface Voice {
  at: number;        // start time, seconds
  dur: number;       // seconds (note on)
  f: number;         // start frequency Hz (ignored for noise)
  f2?: number;       // end frequency (linear slide over dur)
  wave: Wave;
  duty?: number;     // square duty 0..1
  vol?: number;      // 0..1
  a?: number; d?: number; s?: number; r?: number; // ADSR: attack, decay (s), sustain level, release (s)
  vib?: number;      // vibrato depth in Hz at ~6 Hz
  lp?: number;       // one-pole lowpass coefficient 0..1 (1 = off); noise tick uses it
}

export function render(voices: Voice[], tail = 0.05): Float32Array {
  const end = Math.max(...voices.map((v) => v.at + v.dur + (v.r ?? 0.03))) + tail;
  const buf = new Float32Array(Math.ceil(end * SR));
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  for (const v of voices) {
    const a = v.a ?? 0.004, d = v.d ?? 0.02, s = v.s ?? 0.7, r = v.r ?? 0.03, vol = v.vol ?? 1;
    const n0 = Math.floor(v.at * SR), n = Math.floor((v.dur + r) * SR);
    let phase = 0, lpState = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      let env: number;
      if (t < a) env = t / a;
      else if (t < a + d) env = 1 - (1 - s) * ((t - a) / d);
      else if (t < v.dur) env = s;
      else env = s * Math.max(0, 1 - (t - v.dur) / r);
      const prog = Math.min(1, t / v.dur);
      const f = v.f + ((v.f2 ?? v.f) - v.f) * prog + (v.vib ? Math.sin(2 * Math.PI * 6 * t) * v.vib : 0);
      phase += f / SR;
      phase -= Math.floor(phase);
      let x: number;
      switch (v.wave) {
        case "square": x = phase < (v.duty ?? 0.5) ? 1 : -1; break;
        case "tri": x = 4 * Math.abs(phase - 0.5) - 1; break;
        case "saw": x = 2 * phase - 1; break;
        case "sine": x = Math.sin(2 * Math.PI * phase); break;
        default: x = rnd();
      }
      if (v.lp !== undefined) { lpState += v.lp * (x - lpState); x = lpState; }
      if (n0 + i < buf.length) buf[n0 + i] += x * env * vol;
    }
  }
  return buf;
}

/** Peak-normalise to `db` dBFS (default -3). */
export function normalise(buf: Float32Array, db = -3): Float32Array {
  let peak = 0;
  for (const x of buf) peak = Math.max(peak, Math.abs(x));
  const g = peak > 0 ? 10 ** (db / 20) / peak : 1;
  return buf.map((x) => x * g);
}

export function writeWav(path: string, buf: Float32Array) {
  const data = Buffer.alloc(buf.length * 2);
  buf.forEach((x, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x)) * 32767), i * 2));
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.concat([h, data]));
}

const hz = (semis: number) => 440 * 2 ** (semis / 12); // semitones from A4
export const note = hz;
