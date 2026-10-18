// OWNER: B1. Handlers for demo + stats functions. Pure TS (see closet.ts header).
import type { Db } from "../db.ts";
import type { DemoClockReq, DemoClockRes, RelayStats } from "../types.ts";
import type { SeedEnv } from "../seed.ts";

const todo = (n: string): never => { throw new Error(`${n}: TODO(B1)`); };

export async function demoReset(_db: Db, _env: SeedEnv): Promise<{ ok: true }> { return todo("demoReset"); }
export async function demoClock(_db: Db, _body: DemoClockReq): Promise<DemoClockRes> { return todo("demoClock"); }
export async function getStats(_db: Db): Promise<RelayStats> { return todo("getStats"); }
