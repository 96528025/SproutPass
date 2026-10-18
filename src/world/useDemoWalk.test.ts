// The demo walk's reading of one demoWalk answer (useDemoWalk's pure walkStep) and the Toast it shows when nothing
// pops: nothing on either list fits, or the pair met a moment ago (C's pair cooldown).
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/api", () => ({ api: {}, ApiError: class extends Error {} })); // no network in these tests

import { waitLabel, walkNoteText, walkStep } from "./useDemoWalk";

const JO = "p_jo";
const SAM = "p_sam";

describe("walkStep", () => {
  it("a meeting that fits (or might: no flag) arrives as before; the scene pops through useEncounter", () => {
    expect(walkStep({ distanceM: 20, encounters: [{ peerId: JO, hasMatch: true }] }, "walking", JO)).toEqual({ next: "arrive" });
    expect(walkStep({ distanceM: 20, encounters: [{ peerId: JO }] }, "walking", JO)).toEqual({ next: "arrive" });
    expect(walkStep({ distanceM: 20, encounters: [{ peerId: JO, hasMatch: true }] }, "arrived", JO)).toEqual({ next: "hold" });
    // one that fits beats one that doesn't
    expect(walkStep({ distanceM: 20, encounters: [{ peerId: SAM, hasMatch: false }, { peerId: JO, hasMatch: true }] }, "walking", JO).next).toBe("arrive");
  });

  it("nothing fits with the target: stop to show the shared negotiation", () => {
    expect(walkStep({ distanceM: 20, encounters: [{ peerId: JO, hasMatch: false }] }, "walking", JO)).toEqual({
      next: "arrive",
    });
    expect(walkStep({ distanceM: 19, encounters: [{ peerId: JO, hasMatch: false }] }, "arrived", JO).next).toBe("hold");
  });

  it("passing someone with no match still shows their meeting", () => {
    expect(walkStep({ distanceM: 60, encounters: [{ peerId: SAM, hasMatch: false }] }, "walking", JO)).toEqual({
      next: "arrive",
    });
  });

  it("at the target, a pair still in its cooldown ends the walk with the wait", () => {
    expect(walkStep({ distanceM: 20, encounters: [], cooldown: [{ peerId: JO, retryInS: 80 }] }, "walking", JO)).toEqual({
      next: "done", note: { kind: "cooldown", peerId: JO, retryInS: 80 },
    });
    expect(walkStep({ distanceM: 19, encounters: [], cooldown: [{ peerId: SAM, retryInS: 5 }, { peerId: JO, retryInS: 45 }] }, "arrived", JO).note)
      .toEqual({ kind: "cooldown", peerId: JO, retryInS: 45 });
  });

  it("a cooldown with someone passed on the way (still > 25 m out) doesn't stop the walk", () => {
    expect(walkStep({ distanceM: 60, encounters: [], cooldown: [{ peerId: SAM, retryInS: 30 }] }, "walking", JO)).toEqual({ next: "walk" });
  });

  it("no meeting yet: walk on, arrive at 25 m, keep holding after", () => {
    expect(walkStep({ distanceM: 40, encounters: [] }, "walking", JO)).toEqual({ next: "walk" });
    expect(walkStep({ distanceM: 25, encounters: [] }, "walking", JO)).toEqual({ next: "arrive" });
    expect(walkStep({ distanceM: 24, encounters: [] }, "arrived", JO)).toEqual({ next: "hold" });
    expect(walkStep({}, "walking", JO)).toEqual({ next: "walk" }); // an odd answer never ends the walk by itself
  });
});

describe("the walk's Toast", () => {
  it("m:ss from a minute up, seconds below", () => {
    expect(waitLabel(80)).toBe("1:20");
    expect(waitLabel(60)).toBe("1:00");
    expect(waitLabel(119.2)).toBe("2:00");
    expect(waitLabel(45)).toBe("45 s");
    expect(waitLabel(-3)).toBe("0 s");
  });

  it("says who they met and why nothing popped", () => {
    expect(walkNoteText({ kind: "no_fit", peerId: JO, name: "Olivia" })).toBe("You met Olivia. Nothing on either list fits right now.");
    expect(walkNoteText({ kind: "cooldown", peerId: JO, name: "Olivia", retryInS: 80 })).toBe(
      "You met Olivia a moment ago. Your pets can meet again in 1:20.",
    );
    expect(walkNoteText({ kind: "cooldown", peerId: SAM, name: "Freja", retryInS: 45 })).toBe(
      "You met Freja a moment ago. Your pets can meet again in 45 s.",
    );
    expect(walkNoteText({ kind: "no_fit", peerId: "p_x", name: null })).toBe("You met another family. Nothing on either list fits right now.");
  });
});
