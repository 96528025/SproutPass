// Sound design for the nine SfxNames. Notes are semitones from A4 (A4 = 0): C5 = 3, E5 = 7, G5 = 10, C6 = 15.
import { normalise, note, render, writeWav, type Voice } from "./sfx";
import { out } from "./lib";

const sq = (at: number, dur: number, f: number, extra: Partial<Voice> = {}): Voice => ({ at, dur, f, wave: "square", duty: 0.5, ...extra });

const SOUNDS: Record<string, { voices: Voice[]; db?: number }> = {
  // power-on chime: C-E-G-C arpeggio over a soft triangle pad
  start: {
    voices: [
      sq(0.0, 0.1, note(3), { vol: 0.8, duty: 0.25 }),
      sq(0.1, 0.1, note(7), { vol: 0.8, duty: 0.25 }),
      sq(0.2, 0.1, note(10), { vol: 0.8, duty: 0.25 }),
      sq(0.3, 0.32, note(15), { vol: 0.9, duty: 0.25, r: 0.2, vib: 3 }),
      { at: 0.3, dur: 0.32, f: note(3), wave: "tri", vol: 0.6, r: 0.2 },
    ],
  },
  // soft typewriter tick: very short triangle, quick decay
  blip: { voices: [{ at: 0, dur: 0.03, f: note(15), f2: note(14), wave: "tri", a: 0.002, d: 0.02, s: 0.2, r: 0.01 }], db: -9 },
  // two rising notes
  alert: { voices: [sq(0, 0.09, note(3), { duty: 0.25 }), sq(0.11, 0.16, note(10), { duty: 0.25, r: 0.06 })] },
  select: { voices: [sq(0, 0.06, note(12), { f2: note(16), duty: 0.125, r: 0.03 })] },
  // major third up (C5 -> E5), second note held
  accept: { voices: [sq(0, 0.08, note(3), { duty: 0.25 }), sq(0.09, 0.22, note(7), { duty: 0.25, r: 0.1 })] },
  // minor third down (C5 -> A4)
  decline: { voices: [sq(0, 0.09, note(3), { duty: 0.5 }), sq(0.1, 0.24, note(0), { duty: 0.5, r: 0.12 })] },
  // classic coin: B5 -> E6
  coin: { voices: [sq(0, 0.07, note(14), { duty: 0.25 }), sq(0.07, 0.28, note(19), { duty: 0.25, r: 0.16 })] },
  // ~2 s victory jingle (original): rising pentatonic run, a falling answer, then a bright held chord
  jingle: {
    voices: (() => {
      const lead: [number, number][] = [ // [semis, beats] at 0.13 s per beat
        [7, 1], [10, 1], [12, 1], [15, 1], // E5 G5 A5 C6
        [12, 1], [10, 1], [7, 1], [10, 1], // A5 G5 E5 G5
        [15, 1.5], [19, 0.5], // C6 E6
      ];
      const v: Voice[] = [];
      let t = 0;
      for (const [n, b] of lead) {
        v.push(sq(t, b * 0.13 * 0.9, note(n), { duty: 0.25, vol: 0.7, vib: 1.5, r: 0.05 }));
        t += b * 0.13;
      }
      // bass: triangle roots under every two beats
      [[-9, 4], [-5, 4], [-2, 2]].reduce((at, [n, b]) => { v.push({ at, dur: b * 0.13, f: note(n), wave: "tri", vol: 0.8, r: 0.05 }); return at + b * 0.13; }, 0);
      // final chord, held
      const end = t;
      for (const n of [3, 7, 10, 15]) v.push({ at: end, dur: 0.5, f: note(n), wave: "square", duty: 0.25, vol: 0.35, r: 0.3, vib: 2 });
      v.push({ at: end, dur: 0.5, f: note(-9), wave: "tri", vol: 0.7, r: 0.3 });
      return v;
    })(),
  },
  // quiet footstep: a few ms of low-passed noise
  step: { voices: [{ at: 0, dur: 0.025, f: 0, wave: "noise", lp: 0.18, a: 0.001, d: 0.02, s: 0.1, r: 0.015 }], db: -14 },
};

export default function build() {
  for (const [name, s] of Object.entries(SOUNDS)) writeWav(out("public/sfx", `${name}.wav`), normalise(render(s.voices, 0.01), s.db ?? -3));
  console.log(`sfx: ${Object.keys(SOUNDS).length} wav files written`);
}

if (process.argv[1]?.endsWith("sfx-build.ts")) build();
