// From the Base44 template (app-params.js), typed.
import { getAccessToken } from "@base44/sdk";

const isNode = typeof window === "undefined";

const isClearAccessTokenRequested = () =>
  !isNode && new URLSearchParams(window.location.search).get("clear_access_token") === "true";

const clearStoredAccessToken = () => {
  window.localStorage.removeItem("base44_access_token");
  window.localStorage.removeItem("token");
};

const getAppParams = () => {
  if (isClearAccessTokenRequested()) {
    clearStoredAccessToken();
  }
  return {
    appId: import.meta.env.VITE_BASE44_APP_ID as string,
    token: getAccessToken() ?? undefined,
    functionsVersion: import.meta.env.VITE_BASE44_FUNCTIONS_VERSION as string | undefined,
    appBaseUrl: import.meta.env.VITE_BASE44_APP_BASE_URL as string | undefined,
  };
};

export const appParams = {
  ...getAppParams(),
};
