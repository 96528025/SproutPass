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
});
