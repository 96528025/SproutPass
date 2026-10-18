// Function plumbing. The ONLY shared file that imports npm:/base44: modules.
// entry.ts files use this; logic.ts files must NOT import it (so they stay testable in Node).
import { createClientFromRequest } from "npm:@base44/sdk";
import { secrets } from "base44:runtime";
import { HttpError } from "./errors.ts";

export { HttpError };

export function ok(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export function fail(code: string, message: string, status = 400): Response {
  return Response.json({ error: { code, message } }, { status });
}

/** Service-role entity client (bypasses RLS). Pass `sr.entities` into logic.ts handlers. */
// deno-lint-ignore no-explicit-any
export function serviceRole(req: Request): any {
  return createClientFromRequest(req).asServiceRole;
}

export function isAgentCall(req: Request): boolean {
  const key = secrets.get("AGENT_KEY");
  return Boolean(key) && req.headers.get("x-agent-key") === key;
}

/**
 * Wrap a logic handler: parses JSON, runs it with service-role entities, maps errors.
 *   export default wrap(async (db, body, req) => handleListItem(db, body));
 */
export function wrap<B, R>(
  // deno-lint-ignore no-explicit-any
  fn: (db: any, body: B, req: Request) => Promise<R>,
  opts: { agentOnly?: boolean } = {},
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    try {
      if (opts.agentOnly && !isAgentCall(req)) throw new HttpError("forbidden", "agent key required", 403);
      let body = {} as B;
      try { body = (await req.json()) as B; } catch { /* empty body */ }
      const sr = serviceRole(req);
      return ok(await fn(sr.entities, body, req));
    } catch (e) {
      if (e instanceof HttpError) return fail(e.code, e.message, e.status);
      const msg = e instanceof Error ? e.message : String(e);
      return fail("internal", msg, 500);
    }
  };
}
