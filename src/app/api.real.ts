// OWNER: B4. Real adapter over the Base44 SDK. Starter: replace every TODO.
//   - functions: base44.functions.invoke(name, payload) → unwrap; map { error } → ApiError
//   - uploads:   Base44 UploadFile integration → { url }
//   - realtime:  base44.entities[entity].subscribe(cb) → returns unsubscribe
// Use the Base44 client the React template already creates (src/api/… in the template) — don't make a second one.
import type { Api } from "./api";

const todo = (name: string) => () => { throw new Error(`api.real.${name} not implemented yet (B4)`); };

export const realApi: Api = {
  getCloset: todo("getCloset") as Api["getCloset"],
  recordPurchase: todo("recordPurchase") as Api["recordPurchase"],
  listItem: todo("listItem") as Api["listItem"],
  withdrawListing: todo("withdrawListing") as Api["withdrawListing"],
  upsertNeed: todo("upsertNeed") as Api["upsertNeed"],
  resolveNudge: todo("resolveNudge") as Api["resolveNudge"],
  decideProposal: todo("decideProposal") as Api["decideProposal"],
  payProposal: todo("payProposal") as Api["payProposal"],
  demoClock: todo("demoClock") as Api["demoClock"],
  demoReset: todo("demoReset") as Api["demoReset"],
  getStats: todo("getStats") as Api["getStats"],
  selfTest: todo("selfTest") as Api["selfTest"],
  suggestCondition: todo("suggestCondition") as Api["suggestCondition"],
  uploadPhoto: todo("uploadPhoto") as Api["uploadPhoto"],
  subscribe: todo("subscribe") as Api["subscribe"],
};
