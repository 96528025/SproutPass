"""Visa leg of the payment protocol.

The agents never hold Cybersource keys. They call your existing server
(the Hono app that already signs Cybersource requests):

  POST VISA_AUTH_URL   {amountCents, reference, description}
       -> {"status": "AUTHORIZED", "processorId": "<cybersource id>"}
       server: POST /pts/v2/payments with processingInformation.capture=false
  GET  VISA_VERIFY_URL?id=<processorId>&amountCents=<n>
       -> {"status": "AUTHORIZED", "amountCents": n}
       server: GET /pts/v2/payments/{id} (or its own payments table)

With the env vars unset (local test), both functions simulate and label the id SIMULATED-.
"""

from __future__ import annotations

import os
from uuid import uuid4

import aiohttp

AUTH_URL = os.getenv("VISA_AUTH_URL")
VERIFY_URL = os.getenv("VISA_VERIFY_URL")
TOKEN = os.getenv("VISA_SERVER_TOKEN", "")


async def visa_authorize(amount_cents: int, reference: str, description: str) -> str:
    if not AUTH_URL:
        return f"SIMULATED-{uuid4().hex[:10]}"
    async with aiohttp.ClientSession() as s:
        async with s.post(AUTH_URL, json={"amountCents": amount_cents, "reference": reference,
                                          "description": description},
                          headers={"Authorization": f"Bearer {TOKEN}"},
                          timeout=aiohttp.ClientTimeout(total=15)) as r:
            data = await r.json()
            if data.get("status") != "AUTHORIZED":
                raise RuntimeError(f"Visa authorization failed: {data}")
            return data["processorId"]


async def visa_verify(transaction_id: str, amount_cents: int) -> bool:
    if not VERIFY_URL:
        return transaction_id.startswith("SIMULATED-")
    async with aiohttp.ClientSession() as s:
        async with s.get(VERIFY_URL, params={"id": transaction_id, "amountCents": amount_cents},
                         headers={"Authorization": f"Bearer {TOKEN}"},
                         timeout=aiohttp.ClientTimeout(total=15)) as r:
            data = await r.json()
            return data.get("status") == "AUTHORIZED" and int(data.get("amountCents", -1)) == amount_cents
