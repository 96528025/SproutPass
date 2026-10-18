// base44/functions/selfTest/entry.ts
import { wrap } from "../../shared/http.ts";
import { selfTest } from "../../shared/logic/demo.ts";
export default wrap(() => selfTest());   // runs on a fresh in-memory seed, never the live data
