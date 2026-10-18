"""base44_client — the agent's only way to touch the app (via C's agentApi + sendImessage).

Every call is `POST https://<slug>.base44.app/functions/<name>` with header
`x-agent-key`. One class, async, aiohttp. `local_demo.py` and the tests swap in
`MockBase44` (same method names), so the agent code never imports aiohttp
directly.

Rate limit: the Base44 Free plan gives the WHOLE team roughly 10 function calls a
minute. Give every client in one process the same `CallBudget` and it will (a)
spread calls under a per-minute cap and (b) stop everyone for a while when the
app answers 429 / "Rate limit exceeded" — a 429 is never retried on the spot.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from collections import deque
from typing import Any, Callable, Deque, Dict, List, Optional

log = logging.getLogger("base44")

# B's error codes (base44/shared/types.ts ErrorCode). cbridge formats B errors as "<action>: <code>: <message>".
ERROR_CODES = {
    "bad_request", "not_found", "forbidden", "invalid_transition", "not_resellable",
    "not_eligible", "already_open", "expired", "payment_failed", "internal",
}
_CODE_RX = re.compile(r"(?:^|:\s)(" + "|".join(sorted(ERROR_CODES)) + r"):\s")
_RATE_RX = re.compile(r"rate.?limit|too many requests", re.I)


class Base44Error(RuntimeError):
    """A call the app refused. `status` is the HTTP status, `code` B's ErrorCode when known."""

    def __init__(self, message: str, status: Optional[int] = None, code: Optional[str] = None):
        super().__init__(message)
        self.status = status
        self.code = code


class RateLimited(Base44Error):
    """HTTP 429 / "Rate limit exceeded". Nothing was done; try again after `retry_after` seconds."""

    def __init__(self, message: str, retry_after: Optional[float] = None):
        super().__init__(message, status=429, code="rate_limited")
        self.retry_after = retry_after


def error_code(status: Optional[int], data: Any) -> Optional[str]:
    """B's code from either `{error: {code, message}}` (B's functions) or `{error: "act: code: msg"}` (C's handle())."""
    err = data.get("error") if isinstance(data, dict) else data
    if isinstance(err, dict) and err.get("code"):
        return str(err["code"])
    m = _CODE_RX.search(str(err or ""))
    if m:
        return m.group(1)
    return {400: "bad_request", 403: "forbidden", 404: "not_found"}.get(status or 0)


def is_rate_limited(status: Optional[int], body: Any) -> bool:
    if status == 429:
        return True
    err = body.get("error") if isinstance(body, dict) else body
    if isinstance(err, dict):
        err = f"{err.get('code', '')} {err.get('message', '')}"
    return bool(_RATE_RX.search(str(err or "")))


def _seconds(v: Optional[str]) -> Optional[float]:
    try:
        return max(0.0, float(v)) if v else None
    except ValueError:
        return None


class CallBudget:
    """At most `per_min` calls in any rolling 60 s, shared by every client that holds it.

    `penalize()` (called on a 429) blocks every call for Retry-After seconds, or 15 s → 30 s → 60 s → 120 s
    on repeated strikes; one successful call resets the strikes.
    """

    def __init__(self, per_min: int = 8, clock: Callable[[], float] = time.monotonic):
        self.per_min = max(1, int(per_min))
        self.clock = clock
        self.stamps: Deque[float] = deque()
        self.blocked_until = 0.0
        self.strikes = 0
        self.used = 0  # total calls spent (for logs)

    def _prune(self, now: float) -> None:
        while self.stamps and now - self.stamps[0] >= 60.0:
            self.stamps.popleft()

    def available(self) -> int:
        now = self.clock()
        if now < self.blocked_until:
            return 0
        self._prune(now)
        return self.per_min - len(self.stamps)

    def wait_s(self) -> float:
        """Seconds until the next call may go out (0 = now)."""
        now = self.clock()
        if now < self.blocked_until:
            return self.blocked_until - now
        self._prune(now)
        if len(self.stamps) < self.per_min:
            return 0.0
        return max(0.0, self.stamps[0] + 60.0 - now)

    async def acquire(self) -> None:
        while True:
            w = self.wait_s()
            if w <= 0:
                self.stamps.append(self.clock())
                self.used += 1
                return
            await asyncio.sleep(min(w, 5.0) + 0.05)

    def penalize(self, retry_after: Optional[float] = None) -> float:
        self.strikes += 1
        wait = retry_after if retry_after else min(120.0, 15.0 * 2 ** (self.strikes - 1))
        self.blocked_until = max(self.blocked_until, self.clock() + wait)
        return wait

    def ok(self) -> None:
        self.strikes = 0


class Base44Client:
    def __init__(self, base_url: Optional[str] = None, agent_key: Optional[str] = None, timeout_s: float = 20.0,
                 budget: Optional[CallBudget] = None):
        self.base_url = (base_url or os.environ.get("BASE44_URL", "")).rstrip("/")
        self.agent_key = agent_key or os.environ.get("AGENT_KEY", "")
        self.timeout_s = timeout_s
        self.budget = budget
        self._session = None
        if not self.base_url or not self.agent_key:
            log.warning("BASE44_URL / AGENT_KEY not set — only local_demo will work")

    async def _sess(self):
        if self._session is None:
            import aiohttp  # imported lazily so the mocked client needs no aiohttp

            self._session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=self.timeout_s),
                headers={"x-agent-key": self.agent_key, "content-type": "application/json"},
            )
        return self._session

    async def close(self):
        if self._session is not None:
            await self._session.close()
            self._session = None

    async def call(self, fn: str, payload: Dict[str, Any]) -> Any:
        import aiohttp

        sess = await self._sess()
        url = f"{self.base_url}/functions/{fn}"
        what = f"{fn}:{payload.get('action')}" if fn == "agentApi" else fn
        for attempt in range(2):
            if self.budget is not None:
                await self.budget.acquire()
            try:
                async with sess.post(url, json=payload) as r:
                    status, text, retry_after = r.status, await r.text(), _seconds(r.headers.get("Retry-After"))
            except (aiohttp.ClientError, asyncio.TimeoutError) as e:  # network blip → one retry
                if attempt == 1:
                    raise Base44Error(f"{what}: {type(e).__name__}: {e}") from e
                await asyncio.sleep(1.0)
                continue
            try:
                data: Any = json.loads(text) if text else None
            except ValueError:
                data = None
            body = data if data is not None else text[:300]
            if is_rate_limited(status, body):
                wait = self.budget.penalize(retry_after) if self.budget is not None else retry_after
                raise RateLimited(f"{what} {status}: rate limited (backing off {wait or 0:.0f}s)", retry_after=wait)
            if status >= 400 or (isinstance(data, dict) and data.get("error")):
                raise Base44Error(f"{what} {status}: {body}", status=status, code=error_code(status, data))
            if data is None:
                raise Base44Error(f"{what} {status}: not JSON: {text[:120]!r}", status=status)
            if self.budget is not None:
                self.budget.ok()
            return data
        raise Base44Error(f"{what}: gave up")  # unreachable

    # ---- agentApi actions -------------------------------------------------
    async def api(self, action: str, **args) -> Any:
        return await self.call("agentApi", {"action": action, **args})

    async def claim_inbox(self, parent_id: Optional[str], agent_address: str, limit: int = 5) -> List[Dict[str, Any]]:
        """parent_id=None claims the oldest pending rows of EVERY parent (one call for a whole Bureau)."""
        args: Dict[str, Any] = {"agentAddress": agent_address, "limit": limit}
        if parent_id:
            args["parentId"] = parent_id
        r = await self.api("claimInbox", **args)
        return list((r or {}).get("rows") or [])

    async def complete(self, inbox_id: str) -> None:
        await self.api("complete", inboxId=inbox_id)

    async def lookup_parent(self, name: str) -> Dict[str, Any]:
        """{id, name, pet, agentAddress} for a seed name ("mina")."""
        return await self.api("lookupParent", name=name)

    async def register_agent(self, parent_id: str, agent_address: str) -> Dict[str, Any]:
        return await self.api("registerAgent", parentId=parent_id, agentAddress=agent_address)

    async def get_state(self, parent_id: str, peer_of: Optional[str] = None) -> Dict[str, Any]:
        args = {"parentId": parent_id}
        if peer_of:
            args["peerOf"] = peer_of
        return await self.api("getState", **args)

    async def fit(self, **args) -> Dict[str, Any]:
        return await self.api("fit", **args)

    async def suggest_condition(self, image_url: str, item_name: str = "") -> Dict[str, Any]:
        return await self.api("suggestCondition", imageUrl=image_url, itemName=item_name)

    async def create_proposal(self, **args) -> Dict[str, Any]:
        return await self.api("createProposal", **args)

    async def no_match(self, encounter_id: str) -> None:
        await self.api("noMatch", encounterId=encounter_id)

    async def append_turn(self, encounter_id: str, turn: Dict[str, Any]) -> None:
        await self.api("appendTurn", encounterId=encounter_id, turn=turn)

    async def now(self) -> Dict[str, Any]:
        return await self.api("now")

    async def bind_asi_user(self, parent_id: str, code: str, asi_address: str) -> Dict[str, Any]:
        return await self.api("bindAsiUser", parentId=parent_id, code=code, asiAddress=asi_address)

    # pass-through to B (agentApi → shared/cbridge.ts → B's handlers, in-process)
    async def list_item(self, **args) -> Dict[str, Any]:
        """→ B's Listing at the top level, plus {listing, item}."""
        return await self.api("listItem", **args)

    async def resolve_nudge(self, nudge_id: str, decision: str) -> Dict[str, Any]:
        """decision: sell | keep | later (cbridge maps later → B's snooze). → {nudge, next, itemId}"""
        return await self.api("resolveNudge", nudgeId=nudge_id, decision=decision)

    async def decide_proposal(self, proposal_id: str, parent_id: str, decision: str) -> Dict[str, Any]:
        return await self.api("decideProposal", proposalId=proposal_id, parentId=parent_id, decision=decision)

    async def pay_proposal(self, proposal_id: str, parent_id: str) -> Dict[str, Any]:
        """→ {proposal, item} (B's PayProposalRes). Demo payment, no real charge."""
        return await self.api("payProposal", proposalId=proposal_id, parentId=parent_id)

    # ---- iMessage ---------------------------------------------------------
    async def send_imessage(self, parent_id: str, text: str, image_url: Optional[str] = None) -> Dict[str, Any]:
        """Also mirrors the line into PetLine, so the in-app pet says it even with iMessage off."""
        payload: Dict[str, Any] = {"parentId": parent_id, "text": text}
        if image_url:
            payload["imageUrl"] = image_url
        return await self.call("sendImessage", payload)
