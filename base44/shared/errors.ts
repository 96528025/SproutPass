// Pure: safe to import from logic.ts and from tests.
export class HttpError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

export const bad = (msg: string) => new HttpError("bad_request", msg, 400);
export const notFound = (what: string) => new HttpError("not_found", `${what} not found`, 404);
export const forbidden = (msg: string) => new HttpError("forbidden", msg, 403);
export const invalid = (msg: string) => new HttpError("invalid_transition", msg, 409);
