// The SDK client loads in mock mode too (src/agent/client.ts imports it): there its analytics must stay off,
// since the mock has no Base44 backend. Real mode keeps the SDK's default.
import { afterEach, describe, expect, it, vi } from "vitest";

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn((_config: Record<string, unknown>) => ({})) }));
vi.mock("@base44/sdk", () => ({ createClient, getAccessToken: () => null }));

async function configFor(useMock: string | undefined) {
  vi.resetModules();
  createClient.mockClear();
  vi.stubEnv("VITE_USE_MOCK", useMock);
  await import("./base44Client");
  expect(createClient).toHaveBeenCalledTimes(1);
  return createClient.mock.calls[0][0];
}

afterEach(() => { vi.unstubAllEnvs(); });

describe("base44Client", () => {
  it("turns the SDK's analytics off in mock mode", async () => {
    expect((await configFor("1")).analytics).toEqual({ enabled: false });
  });

  it("leaves analytics to the SDK default in real mode", async () => {
    expect(await configFor(undefined)).not.toHaveProperty("analytics");
    expect(await configFor("0")).not.toHaveProperty("analytics");
  });
});
