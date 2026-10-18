import { afterEach, beforeEach, expect, it, vi } from "vitest";

let success: PositionCallback;
let failure: PositionErrorCallback;
let get: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal("window", { isSecureContext: true });
  get = vi.fn((s: PositionCallback, e: PositionErrorCallback) => { success = s; failure = e; });
  vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: get } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const err = (code: number) => ({ code }) as GeolocationPositionError;

it("requests location synchronously from the tap and shares duplicate taps", async () => {
  const { requestGeo } = await import("./useGeoPermission");
  const a = requestGeo();
  expect(get).toHaveBeenCalledOnce();
  expect(requestGeo()).toBe(a);
  success({} as GeolocationPosition);
  expect(await a).toBe("granted");
});
it("distinguishes permission denial from a GPS timeout", async () => {
  const { requestGeo } = await import("./useGeoPermission");
  const a = requestGeo(); failure(err(1)); expect(await a).toBe("denied");
  const b = requestGeo(); failure(err(3)); expect(await b).toBe("timeout");
});
it("lets a fresh request recover after denial", async () => {
  const { requestGeo } = await import("./useGeoPermission");
  const a = requestGeo(); failure(err(1)); await a;
  const b = requestGeo(); success({} as GeolocationPosition);
  expect(await b).toBe("granted"); expect(get).toHaveBeenCalledTimes(2);
});
it("settles an ignored prompt without letting its late callback override a retry", async () => {
  const { requestGeo } = await import("./useGeoPermission");
  const a = requestGeo(); const late = success;
  await vi.advanceTimersByTimeAsync(30_000); expect(await a).toBe("timeout");
  const b = requestGeo(); failure(err(1)); expect(await b).toBe("denied");
  late({} as GeolocationPosition);
  const c = requestGeo(); failure(err(3)); expect(await c).toBe("timeout");
});
it("explains insecure or embedded-policy blocks without pretending to prompt", async () => {
  const { requestGeo } = await import("./useGeoPermission");
  vi.stubGlobal("window", { isSecureContext: false });
  expect(await requestGeo()).toBe("insecure");
  vi.stubGlobal("window", { isSecureContext: true });
  vi.stubGlobal("document", { permissionsPolicy: { allowsFeature: () => false } });
  expect(await requestGeo()).toBe("blocked");
  expect(get).not.toHaveBeenCalled();
});
it("handles browsers with no geolocation or a throwing implementation", async () => {
  const { requestGeo } = await import("./useGeoPermission");
  get.mockImplementation(() => { throw new Error("unavailable"); });
  expect(await requestGeo()).toBe("unavailable");
  vi.stubGlobal("navigator", {});
  expect(await requestGeo()).toBe("unavailable");
});
