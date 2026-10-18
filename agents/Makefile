# agents/Makefile — Part C (Agents & Messages)
PY ?= python3

install:
	$(PY) -m pip install -r requirements.txt

test:
	$(PY) -m pytest -q tests

demo:            ## whole story offline, no Base44 / Photon
	$(PY) local_demo.py

mina jo sam:     ## one live agent each (needs BASE44_URL, AGENT_KEY, TEAM_SECRET in env or .env)
	set -a; [ -f .env ] && . ./.env; set +a; $(PY) closet_agent.py --parent $@

addresses:       ## print the three agent addresses for B's seed (no network)
	@for p in mina jo sam; do $(PY) -c "import os,sys; from uagents import Agent; p='$$p'; print(p, Agent(name=p+'-closet', seed=f\"relay-{p}-{os.environ.get('TEAM_SECRET','dev')}\").address)"; done

.PHONY: install test demo mina jo sam addresses
