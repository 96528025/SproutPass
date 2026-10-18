// From the Base44 template (base44Client.js). Only src/app/api.real.ts should import this.
import { createClient } from "@base44/sdk";
import { appParams } from "@/lib/app-params";

const { appId, token, functionsVersion, appBaseUrl } = appParams;

export const base44 = createClient({
  appId,
  token,
  functionsVersion,
  serverUrl: "",
  appBaseUrl,
  // src/agent/client.ts imports this statically, so it loads in mock mode too, where there is no Base44 backend:
  // the SDK's analytics batches would 404 on /api/apps/undefined/analytics. Real mode keeps the SDK default.
  ...(import.meta.env.VITE_USE_MOCK === "1" ? { analytics: { enabled: false } } : {}),
});
