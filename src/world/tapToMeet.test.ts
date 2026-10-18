// Tap-to-meet on /world?demo=1, the pure parts: which demo families are drawn (the radar's entry wins, the others at
// their demo spot with the radar's band / bearing / ring rules), when they can be tapped (canMeet), the ONE request a
// tap sends (walkRequest "meet" = arrive: true), and how its answer is read (the walk's own walkStep).
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/api", () => ({ api: {}, ApiError: class extends Error {} })); // no network in these tests

import type { SmoothParent } from "./useNearby";
import { DEMO_CONTROLS_PX, demoFamilies, radarLift, ringPxFor } from "./useNearby";
import { canMeet, walkNoteText, walkRequest, walkStep, type MeetGate } from "./useDemoWalk";
import { demoFix } from "./people";
import { destination } from "../../base44/shared/c/geo.ts";

const LAYOUT = { mpp: 0.99, halfW: 147, halfH: 300 };
const onGrid = (n: number) => Math.abs(n % 4) === 0;
const radarEntry = (over: Partial<SmoothParent> & Pick<SmoothParent, "parentId" | "name">): SmoothParent => ({
  sprite: "parent_b",
  band: "100-300m",
  x: 0,
  y: 120,
  fading: false,
  ...over,
});

describe("demoFamilies: every other demo family is drawn", () => {
  it("Olivia's tab with an empty radar: Caesar and Freja at their demo spots, no request behind them", () => {
    const out = demoFamilies("jo", demoFix("jo"), [], { layout: LAYOUT });
    expect(out.map((p) => p.key)).toEqual(["mina", "sam"]);
    const [caesar, freja] = out;
    expect(caesar).toMatchObject({ parentId: "seed:mina", name: "Caesar", key: "mina", parked: true, band: "100-300m", distanceM: 120, fading: false });
    expect(freja).toMatchObject({ parentId: "seed:sam", name: "Freja", key: "sam", parked: true, band: "100-300m", distanceM: 235 });
    // Caesar stands 120 m due south of Olivia's spot: straight below me, on the 300 m ring pulled in to the phone
    expect(Math.abs(caesar.x)).toBeLessThan(1);
    expect(caesar.y).toBe(300);
    // Freja is south-east (200 m east of Caesar)
    expect(freja.x).toBeGreaterThan(0);
    expect(freja.y).toBeGreaterThan(0);
    for (const p of out) {
      expect(onGrid(p.x) && onGrid(p.y)).toBe(true);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(LAYOUT.halfW);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(LAYOUT.halfH);
    }
  });

  it("never draws me: Caesar's tab gets Olivia (due north) and Freja (due east)", () => {
    const out = demoFamilies("mina", demoFix("mina"), [], { layout: LAYOUT });
    expect(out.map((p) => p.key)).toEqual(["jo", "sam"]);
    const [olivia, freja] = out;
    expect(olivia.y).toBeLessThan(0);
    expect(Math.abs(olivia.x)).toBeLessThan(1);
    expect(freja.x).toBeGreaterThan(0);
    expect(Math.abs(freja.y)).toBeLessThan(8);
  });

  it("the real radar entry wins: no duplicate, it is only tagged with its seed key", () => {
    const radar = [radarEntry({ parentId: "p_sam", name: "Freja", band: "25-100m", x: 40, y: 60, distanceM: 80 })];
    const out = demoFamilies("jo", demoFix("jo"), radar, { layout: LAYOUT });
    expect(out.filter((p) => p.key === "sam")).toEqual([{ ...radar[0], key: "sam", parked: false }]);
    expect(out.filter((p) => p.parked).map((p) => p.key)).toEqual(["mina"]);
  });

  it("a cached real id matches the radar entry even under another name (a db that wasn't RESET to the new names)", () => {
    const radar = [radarEntry({ parentId: "p_sam", name: "Sam" })];
    const out = demoFamilies("jo", demoFix("jo"), radar, { layout: LAYOUT, ids: { sam: "p_sam" } });
    expect(out.find((p) => p.parentId === "p_sam")?.key).toBe("sam");
    expect(out.some((p) => p.parentId === "seed:sam")).toBe(false);
  });

  it("a fading radar entry still wins until it is gone (no second Freja while she fades out)", () => {
    const radar = [radarEntry({ parentId: "p_sam", name: "Freja", fading: true })];
    const out = demoFamilies("jo", demoFix("jo"), radar, { layout: LAYOUT });
    expect(out.filter((p) => p.key === "sam")).toHaveLength(1);
  });

  it("anyone else on the radar (a joined family) is kept as is and gets no key: not tappable", () => {
    const radar = [radarEntry({ parentId: "p_kai", name: "Kai" })];
    const out = demoFamilies("jo", demoFix("jo"), radar, { layout: LAYOUT });
    expect(out[0]).toEqual({ ...radar[0], parked: false });
    expect(out[0].key).toBeUndefined();
  });

  it("a demo spot beyond the 300 m radar isn't drawn; no position yet → only the radar", () => {
    const far = destination(demoFix("mina"), 270, 1000); // 1 km west of the lawn
    expect(demoFamilies("jo", far, [], { layout: LAYOUT })).toEqual([]);
    const radar = [radarEntry({ parentId: "p_sam", name: "Freja" })];
    expect(demoFamilies("jo", null, radar, { layout: LAYOUT })).toEqual([{ ...radar[0], key: "sam", parked: false }]);
  });

  it("standing 10 m north of a family (after a tap) puts them right below me, inside the 25 m ring", () => {
    const here = destination(demoFix("sam"), 0, 10);
    const freja = demoFamilies("jo", here, [], { layout: LAYOUT }).find((p) => p.key === "sam");
    expect(freja).toMatchObject({ band: "<25m", distanceM: 10, parked: true });
    expect(Math.abs(freja!.x)).toBeLessThan(1);
    expect(freja!.y).toBe(48); // the sprite's minimum radius: never on top of my avatar
    expect(ringPxFor("<25m", LAYOUT.mpp)).toBeLessThan(48);
  });

  it("a 375×812 phone (stage 375×553 under the demo nav): the raised radar keeps every family above the walk controls", () => {
    const stage = { w: 375, h: 553 };
    const stageCy = Math.round(stage.h / 2);
    const lift = radarLift(true, stageCy);
    expect(lift).toBe(DEMO_CONTROLS_PX / 2);
    expect(radarLift(false, stageCy)).toBe(0); // real GPS: the stage centre, as before
    const cy = stageCy - lift;
    const layout = { mpp: 0.99, halfW: Math.round(stage.w / 2) - 48, halfH: cy - 56 }; // = WorldScreen's layout
    const controlsTop = stage.h - DEMO_CONTROLS_PX; // stage px
    for (const meKey of ["jo", "mina", "sam"] as const) {
      for (const p of demoFamilies(meKey, demoFix(meKey), [], { layout })) {
        // .ns: a 64 px sprite with its name tag, drawn from y - 32 to y + 44 around (cx + x, cy + y)
        expect(cy + p.y - 32, `${p.name} on ${meKey}'s phone`).toBeGreaterThanOrEqual(0);
        expect(cy + p.y + 44, `${p.name} on ${meKey}'s phone`).toBeLessThanOrEqual(controlsTop);
      }
    }
    // the one that used to hide: Caesar, 120 m due south of Olivia, straight below her and above the hint
    const caesar = demoFamilies("jo", demoFix("jo"), [], { layout }).find((p) => p.key === "mina")!;
    expect(Math.abs(caesar.x)).toBeLessThan(1);
    expect(caesar.y).toBeGreaterThanOrEqual(48);
  });
});

describe("canMeet: the families are buttons only while nothing else is on", () => {
  const idle: MeetGate = { demo: true, meId: "p_jo", encounterUp: false, walking: false, paused: false };

  it("demo mode, my id known, nothing on: tappable", () => {
    expect(canMeet(idle)).toBe(true);
  });

  it("not outside demo mode, nor before the closet loads", () => {
    expect(canMeet({ ...idle, demo: false })).toBe(false);
    expect(canMeet({ ...idle, meId: null })).toBe(false);
  });

  it("not while a meeting is on screen, a walk (or a tap) is running, or a trade is live / celebrating", () => {
    expect(canMeet({ ...idle, encounterUp: true })).toBe(false);
    expect(canMeet({ ...idle, walking: true })).toBe(false);
    expect(canMeet({ ...idle, paused: true })).toBe(false);
  });
});

describe("a tap sends ONE arrive call, read like a walk step", () => {
  it("walkRequest: meet = arrive (no step), walk = 20 m, hold = 1 m", () => {
    expect(walkRequest("p_jo", "p_sam", "meet")).toEqual({ parentId: "p_jo", targetParentId: "p_sam", arrive: true });
    expect(walkRequest("p_jo", "p_sam", "walk")).toEqual({ parentId: "p_jo", targetParentId: "p_sam", stepM: 20 });
    expect(walkRequest("p_jo", "p_sam", "hold")).toEqual({ parentId: "p_jo", targetParentId: "p_sam", stepM: 1 });
  });

  it("a meeting (match or no match) arrives: the hold ticks wait for the scene", () => {
    expect(walkStep({ distanceM: 10, encounters: [{ peerId: "p_sam", hasMatch: true }] }, "walking", "p_sam")).toEqual({ next: "arrive" });
    expect(walkStep({ distanceM: 10, encounters: [{ peerId: "p_mina", hasMatch: false }] }, "walking", "p_mina")).toEqual({ next: "arrive" });
    // no meeting started on this call (e.g. the agents' fallback still has to run): arrived all the same, hold on
    expect(walkStep({ distanceM: 10, encounters: [] }, "walking", "p_sam")).toEqual({ next: "arrive" });
  });

  it("a pair still in its cooldown ends the tap with the existing Toast", () => {
    const step = walkStep({ distanceM: 10, encounters: [], cooldown: [{ peerId: "p_sam", retryInS: 80 }] }, "walking", "p_sam");
    expect(step).toEqual({ next: "done", note: { kind: "cooldown", peerId: "p_sam", retryInS: 80 } });
    expect(walkNoteText({ ...step.note!, kind: "cooldown", retryInS: 80, name: "Freja" })).toBe(
      "You met Freja a moment ago. Your pets can meet again in 1:20.",
    );
  });

  it("an answer still far out (a backend that ignores arrive) just walks on", () => {
    expect(walkStep({ distanceM: 115, encounters: [] }, "walking", "p_sam")).toEqual({ next: "walk" });
  });
});
