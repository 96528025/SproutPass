import { describe, expect, it } from "vitest";
import { createFakeDb } from "./testing/fakeDb.ts";
import { applySeed, seedPlan } from "./seed.ts";
import { demoWalk, updatePresence } from "./c/location.ts";
import { demoHome, haversineM } from "./c/geo.ts";
import { latestPosition } from "../../src/world/walkPosition";

const FIX = { lat: 34.0689, lng: -118.4452, accuracyM: 5, simulated: true };
const deps = (nowMs: number) => ({ nowMs, findMatches: async () => [], fallbackAfterMs: 60_000 });

async function setup() {
  const db = createFakeDb();
  const { parentIds } = await applySeed(db, seedPlan());
  return { db, ids: parentIds };
}

describe("saved walking position", () => {
  it("continues from home, resumes, and changes target without teleporting or changing inventory", async () => {
    const { db, ids } = await setup();
    const before = await db.ClothingItem.list();
    const home = demoHome(await db.Parent.get(ids.sam));
    const first = await demoWalk(db, { parentId: ids.sam, targetParentId: ids.mina, stepM: 20 }, deps(100_000));
    expect(haversineM(home, first.position)).toBeCloseTo(20, 1);
    const resume = await demoWalk(db, { parentId: ids.sam, targetParentId: ids.mina, stepM: 20 }, deps(110_000));
    expect(haversineM(first.position, resume.position)).toBeCloseTo(20, 1);
    const switchTarget = await demoWalk(db, { parentId: ids.sam, targetParentId: ids.jo, stepM: 20 }, deps(120_000));
    expect(haversineM(resume.position, switchTarget.position)).toBeCloseTo(20, 1);
    const reload = await updatePresence(db, { parentId: ids.sam, ...FIX }, deps(130_000));
    expect("position" in reload && reload.position).toMatchObject({ lat: switchTarget.position.lat, lng: switchTarget.position.lng });
    expect(await db.ClothingItem.list()).toEqual(before);
  });

  it("a heartbeat that read an older position cannot overwrite a concurrent walk", async () => {
    const { db, ids } = await setup();
    await updatePresence(db, { parentId: ids.sam, ...FIX }, deps(100_000));
    const update = db.Presence.update.bind(db.Presence);
    let moved: Awaited<ReturnType<typeof demoWalk>> | undefined;
    db.Presence.update = async (id, patch) => {
      // Pause the heartbeat after its read, then let a walk commit first.
      if (!moved && patch.updatedAt === new Date(110_000).toISOString()) {
        moved = await demoWalk(db, { parentId: ids.sam, targetParentId: ids.mina, stepM: 20 }, deps(111_000));
      }
      return update(id, patch);
    };
    const heartbeat = await updatePresence(db, { parentId: ids.sam, ...FIX }, deps(110_000));
    const [saved] = await db.Presence.filter({ parentId: ids.sam });
    expect(saved).toMatchObject({ lat: moved!.position.lat, lng: moved!.position.lng });
    expect("position" in heartbeat && heartbeat.position).toMatchObject({ lat: saved.lat, lng: saved.lng });
  });

  it("displays actual coordinates even when the target has moved, and ignores a late older reply", async () => {
    const { db, ids } = await setup();
    await demoWalk(db, { parentId: ids.mina, targetParentId: ids.sam, stepM: 50 }, deps(100_000));
    const walk = await demoWalk(db, { parentId: ids.jo, targetParentId: ids.mina, stepM: 20 }, deps(110_000));
    const [saved] = await db.Presence.filter({ parentId: ids.jo });
    expect(walk.position).toMatchObject({ lat: saved.lat, lng: saved.lng });
    expect(walk.bearingDeg).not.toBe(180);
    const old = { ...FIX, updatedAt: new Date(100_000).toISOString() };
    expect(latestPosition(walk.position, old)).toEqual(walk.position);
    expect(latestPosition(old, walk.position)).toEqual(walk.position);
  });
});
