// OWNER: B4. Real adapter over the Base44 SDK.
//   - functions: base44.functions.invoke(name, payload) → raw axios response; unwrap .data, map { error } → ApiError
//   - uploads:   Core.UploadFile integration → { url } (big photos shrunk to ≤1280 px first: phones upload faster)
//   - realtime:  base44.entities[entity].subscribe(cb) → returns unsubscribe
// The client is imported lazily so the mock build and vitest never construct the SDK.
import type { Api, EntityEvent, Unsubscribe } from "./api";
import { ApiError } from "./api";
import type { EntityName } from "./types";
import { shrinkForUpload } from "./photo";

type Base44 = typeof import("@/api/base44Client").base44;
let clientPromise: Promise<Base44> | null = null;
const client = () => (clientPromise ??= import("@/api/base44Client").then((m) => m.base44));

const CODE_BY_STATUS: Record<number, string> = { 400: "bad_request", 403: "forbidden", 404: "not_found", 409: "invalid_transition" };

/** Map whatever the SDK threw (AxiosError from functions, Base44Error from integrations) to ApiError. */
export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  const err = e as { response?: { status?: number; data?: unknown }; status?: number; data?: unknown; message?: string };
  const status = err?.response?.status ?? err?.status;
  const body = (err?.response?.data ?? err?.data) as { error?: unknown; message?: string } | string | undefined;
  const fnError = typeof body === "object" && body ? body.error : undefined;
  if (fnError && typeof fnError === "object") {
    const { code, message } = fnError as { code?: string; message?: string };
    return new ApiError(code ?? CODE_BY_STATUS[status ?? 0] ?? "internal", message ?? code ?? "Something went wrong.");
  }
  if (status) {
    const message = (typeof fnError === "string" && fnError) || (typeof body === "object" && body?.message) || err?.message || `Server error (${status})`;
    return new ApiError(CODE_BY_STATUS[status] ?? "internal", message);
  }
  return new ApiError("network", "Can't reach the server. Check the connection and try again.");
}

async function fn<T>(name: string, payload: object = {}): Promise<T> {
  const base44 = await client();
  let res: { data?: unknown; status?: number };
  try {
    res = await base44.functions.invoke(name, payload as Record<string, unknown>);
  } catch (e) {
    throw toApiError(e);
  }
  const data = res?.data as { error?: { code?: string; message?: string } } | undefined;
  if (data && typeof data === "object" && data.error && typeof data.error === "object") {
    throw new ApiError(data.error.code ?? "internal", data.error.message ?? "Something went wrong.");
  }
  return data as T;
}

export const realApi: Api = {
  getCloset: (ref) => fn("getCloset", ref),
  recordPurchase: (req) => fn("recordPurchase", req),
  listItem: (req) => fn("listItem", req),
  withdrawListing: (req) => fn("withdrawListing", req),
  upsertNeed: (req) => fn("upsertNeed", req),
  resolveNudge: (req) => fn("resolveNudge", req),
  decideProposal: (req) => fn("decideProposal", req),
  payProposal: (req) => fn("payProposal", req),
  getParties: (req) => fn("getParties", req),
  updatePresence: (req) => fn("updatePresence", req),
  listNearby: (req) => fn("listNearby", req),
  demoWalk: (req) => fn("demoWalk", req),
  getTrust: (ref) => fn("getTrust", ref),
  setMandate: (req) => fn("setMandate", req),
  passkeyRegisterOptions: (req) => fn("passkeyRegisterOptions", req),
  passkeyRegisterVerify: (req) => fn("passkeyRegisterVerify", req),
  passkeyAuthOptions: (req) => fn("passkeyAuthOptions", req),
  analyzeItemPhoto: (req) => fn("analyzeItemPhoto", req),
  getImpact: (ref) => fn("getImpact", ref ?? {}),
  demoClock: (req) => fn("demoClock", req ?? {}),
  demoReset: () => fn("demoReset"),
  getStats: () => fn("getStats"),
  selfTest: () => fn("selfTest"),

  // C's function; until it's deployed (or if it fails) the pet just doesn't suggest.
  suggestCondition: async (req) => {
    try {
      const r = await fn<{ condition?: unknown; note?: unknown }>("suggestCondition", req);
      const condition = r?.condition === "like_new" || r?.condition === "gently_used" || r?.condition === "well_loved" ? r.condition : undefined;
      return { condition, note: typeof r?.note === "string" ? r.note : undefined };
    } catch (e) {
      console.info("[relay] suggestCondition unavailable:", toApiError(e).message);
      return {};
    }
  },

  uploadPhoto: async (file) => {
    const base44 = await client();
    try {
      const res = (await base44.integrations.Core.UploadFile({ file: await shrinkForUpload(file) })) as { file_url?: string };
      if (!res?.file_url) throw new ApiError("internal", "Upload didn't return a URL.");
      return { url: res.file_url };
    } catch (e) {
      throw toApiError(e);
    }
  },

  subscribe: <T>(entity: EntityName, cb: (e: EntityEvent<T>) => void): Unsubscribe => {
    let stop: Unsubscribe | null = null;
    let cancelled = false;
    void client()
      .then((base44) => {
        if (cancelled) return;
        stop = base44.entities[entity].subscribe((ev: { type: EntityEvent<T>["type"]; id: string; data: T }) =>
          cb({ type: ev.type, id: ev.id, data: ev.data }));
      })
      .catch((e) => console.warn(`[relay] realtime ${entity} unavailable:`, e));
    return () => {
      cancelled = true;
      stop?.();
    };
  },
};
