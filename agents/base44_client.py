"""base44_client — the agent's only way to touch the app (via C's agentApi + sendImessage).

Every call is `POST https://<slug>.base44.app/functions/<name>` with header
`x-agent-key`. One class, async, aiohttp. `local_demo.py` swaps in a mocked
subclass with the same method names, so the agent code never imports aiohttp
directly.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Dict, List, Optional

log = logging.getLogger("base44")


class Base44Error(RuntimeError):
    pass


class Base44Client:
    def __init__(self, base_url: Optional[str] = None, agent_key: Optional[str] = None, timeout_s: float = 15.0):
        self.base_url = (base_url or os.environ.get("BASE44_URL", "")).rstrip("/")
        self.agent_key = agent_key or os.environ.get("AGENT_KEY", "")
        self.timeout_s = timeout_s
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
        sess = await self._sess()
        url = f"{self.base_url}/functions/{fn}"
        for attempt in range(3):
            try:
                async with sess.post(url, json=payload) as r:
                    data = await r.json(content_type=None)
                    if r.status >= 400 or (isinstance(data, dict) and data.get("error")):
                        raise Base44Error(f"{fn} {r.status}: {data}")
                    return data
            except Base44Error:
                raise
            except Exception as e:  # network blip → retry with backoff
                if attempt == 2:
                    raise Base44Error(f"{fn}: {e}") from e
                await asyncio.sleep(0.5 * (attempt + 1))

    # ---- agentApi actions -------------------------------------------------
    async def api(self, action: str, **args) -> Any:
        return await self.call("agentApi", {"action": action, **args})

    async def claim_inbox(self, parent_id: str, agent_address: str, limit: int = 5) -> List[Dict[str, Any]]:
        r = await self.api("claimInbox", parentId=parent_id, agentAddress=agent_address, limit=limit)
        return r.get("rows", [])

    async def complete(self, inbox_id: str) -> None:
        await self.api("complete", inboxId=inbox_id)

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

    # pass-through to B
    async def list_item(self, **args) -> Dict[str, Any]:
        return await self.api("listItem", **args)

    async def resolve_nudge(self, nudge_id: str, decision: str) -> Dict[str, Any]:
        return await self.api("resolveNudge", nudgeId=nudge_id, decision=decision)

    async def decide_proposal(self, proposal_id: str, parent_id: str, decision: str) -> Dict[str, Any]:
        return await self.api("decideProposal", proposalId=proposal_id, parentId=parent_id, decision=decision)

    async def pay_proposal(self, proposal_id: str, parent_id: str) -> Dict[str, Any]:
        return await self.api("payProposal", proposalId=proposal_id, parentId=parent_id)

    # ---- iMessage ---------------------------------------------------------
    async def send_imessage(self, parent_id: str, text: str, image_url: Optional[str] = None) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"parentId": parent_id, "text": text}
        if image_url:
            payload["imageUrl"] = image_url
        return await self.call("sendImessage", payload)
