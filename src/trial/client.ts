import { base44 } from "../api/base44Client";
export async function trialCall<T>(name: string, body: object = {}): Promise<T> {
  const r = await base44.functions.invoke(name, body as Record<string, unknown>);
  if (r.data?.error) throw new Error(r.data.error.message ?? "Couldn't save. Please try again.");
  return r.data as T;
}
