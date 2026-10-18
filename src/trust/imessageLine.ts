// OWNER: B6 (trust UI). Pure helpers for the "Text your pet on iMessage" panel on /bag/pet: which number the
// parent texts to reach their pet, a tap-to-text link and the QR code text.
//
// Where the number comes from (first one wins):
//   1. the server, when getCloset carries a public `imessage: { lineNumber, connected }` (asked of B8 / B5; never
//      the parent's own phone, only the pet's line);
//   2. the build: VITE_PET_LINES = "mina=+13105550111,jo=+13105550112" (the Photon pool numbers per demo parent;
//      they are the pet's numbers, meant to be texted, so they may ship in the page).
// Nothing found → null, and the panel says so instead of guessing.

export interface PetLine {
  /** E.164, e.g. "+13105550111" */
  number: string;
  /** "+1 (310) 555-0111" */
  display: string;
  /** Tap to text: opens Messages with "hi" typed (iOS and Android both read `?&body=`). */
  smsHref: string;
  /** For a QR code: the SMSTO form both phone cameras understand. */
  qrText: string;
  /** true = the parent has texted this line already; null = not known here. */
  connected: boolean | null;
}

/** Any common way of writing a phone number → E.164 ("+13105550111"), or null. US numbers may skip the +1. */
export function normalizeNumber(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  const digits = t.replace(/\D/g, "");
  if (t.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** "+13105550111" → "+1 (310) 555-0111"; other countries stay as written. */
export function displayNumber(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `+1 (${m[1]}) ${m[2]}-${m[3]}` : e164;
}

/** "mina=+13105550111, jo:+1 (310) 555-0112" → { mina: "+13105550111", jo: "+13105550112" }. Bad entries are skipped. */
export function parseLines(env: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof env !== "string") return out;
  for (const part of env.split(/[,;\n]/)) {
    const m = /^\s*([a-z0-9_-]+)\s*[=:]\s*(.+?)\s*$/i.exec(part);
    const n = m ? normalizeNumber(m[2]) : null;
    if (m && n) out[m[1].toLowerCase()] = n;
  }
  return out;
}

/** The server's optional public field, if this build's getCloset has one (closet.imessage or closet.parent.imessage). */
export function serverLine(closet: unknown): { number: string | null; connected: boolean | null } | null {
  if (!closet || typeof closet !== "object") return null;
  const c = closet as { imessage?: unknown; parent?: { imessage?: unknown } };
  const v = (c.imessage ?? c.parent?.imessage) as { lineNumber?: unknown; connected?: unknown } | undefined;
  if (!v || typeof v !== "object") return null;
  return {
    number: normalizeNumber(v.lineNumber),
    connected: typeof v.connected === "boolean" ? v.connected : null,
  };
}

/** The pet's line for this parent, or null when no number is known. */
export function petLine(parentKey: string | null, closet: unknown, env: unknown, firstText = "hi"): PetLine | null {
  const server = serverLine(closet);
  const number = server?.number ?? (parentKey ? parseLines(env)[parentKey.toLowerCase()] : undefined) ?? null;
  if (!number) return null;
  return {
    number,
    display: displayNumber(number),
    smsHref: `sms:${number}?&body=${encodeURIComponent(firstText)}`,
    qrText: `SMSTO:${number}:${firstText}`,
    connected: server?.connected ?? null,
  };
}

/** What the parent can text their pet (B8's inboxFallback understands these; "help" lists them in iMessage too). */
export const PET_COMMANDS: { say: string; does: string }[] = [
  { say: "sell the romper", does: "pass something on (or just send a photo of it)" },
  { say: "status", does: "trades and nudges waiting for you" },
  { say: "accept", does: "say yes to the trade your pet just proposed (or “decline”)" },
  { say: "pay", does: "get a link to approve the payment here in the app" },
  { say: "help", does: "everything your pet understands" },
  { say: "stop", does: "pause your pet's texts (“start” turns them back on)" },
];
