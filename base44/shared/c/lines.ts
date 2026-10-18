// (C) lines.ts — which Photon iMessage line talks to which parent. Pure: no Deno / npm imports.
//
// On Photon's shared iMessage pool every demo phone gets its OWN assigned number ("Assign a number from the
// shared pool"), and a shared line sends only in a direct space to a peer who has messaged it since the
// assignment. So the pet must answer each parent from the line THAT parent texted:
//   - photonWebhook remembers it per parent (Parent.photonLineUserId = the inbound receivedBy id, together with
//     the inbound space),
//   - sendToParent sends from it, and stays quiet for a parent who hasn't texted their number yet (a shared line
//     can't send the first message, so there is no app-wide fallback line any more).

/** The parent fields photonWebhook caches; all server-only (admin RLS, stripped by publicParent). */
export interface PhotonParentIds {
  photonUserId?: string;      // the parent's own Photon user (sentBy)
  photonSpaceId?: string;     // the direct space between the parent and their line
  photonLineUserId?: string;  // the line the parent texts (receivedBy) — the pet replies from it
}

/** What one inbound message tells us about its sender (see photon.ts parseInbound). */
export interface InboundIds {
  isGroup?: boolean;
  fromUserId?: string;
  spaceId?: string;
  lineUserId?: string;
}

/**
 * The Parent fields to update after an inbound iMessage: only those that changed. The space and the line move
 * together — after a re-assignment to a new pool number the old space would send from the wrong line.
 */
export function inboundParentPatch(parent: PhotonParentIds, msg: InboundIds): PhotonParentIds {
  const patch: PhotonParentIds = {};
  // A family group must never replace the destination for private trade/payment notifications.
  if (msg.isGroup) return patch;
  if (msg.fromUserId && parent.photonUserId !== msg.fromUserId) patch.photonUserId = msg.fromUserId;
  if (msg.spaceId && parent.photonSpaceId !== msg.spaceId) patch.photonSpaceId = msg.spaceId;
  if (msg.lineUserId && parent.photonLineUserId !== msg.lineUserId) patch.photonLineUserId = msg.lineUserId;
  return patch;
}

/** The line to send this parent's pet texts from: the one they texted, or none yet. */
export function senderLineFor(parent: PhotonParentIds): string | undefined {
  return parent.photonLineUserId || undefined;
}

// (B's RESET, base44/shared/seed.ts upsertParents, clears all three when a parent's seeded phone changes.)
