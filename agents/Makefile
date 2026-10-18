# agents/Makefile — Part C (Agents & Messages). Run from agents/: `make venv test demo`, then `make live`.
# Uses agents/.venv when it exists (macOS/Linux bin/, Windows Scripts/), else python3.
PY ?= $(if $(wildcard .venv/bin/python),.venv/bin/python,$(if $(wildcard .venv/Scripts/python.exe),.venv/Scripts/python.exe,python3))

venv:            ## agents/.venv with everything in requirements.txt
	python3 -m venv .venv || python -m venv .venv
	$(MAKE) install

install:
	$(PY) -m pip install -r requirements.txt

test:            ## offline, ~2 s
	$(PY) -m pytest -q tests

demo:            ## whole story offline (mock app, same Bureau wiring as `make live`), ends LOCAL DEMO PASS
	$(PY) local_demo.py

live-check:      ## 3 read-only calls against the live app: parent ids, pets, registered addresses
	$(PY) live_bureau.py --check

live:            ## mina + jo + sam in one Bureau against the live app (AGENT_KEY from env, .env or ../.env.local)
	$(PY) live_bureau.py

addresses:       ## the three agent addresses for B's seed secrets MINA_AGENT / JO_AGENT / SAM_AGENT (no network)
	$(PY) live_bureau.py --addresses

mina jo sam:     ## one agent with an Agentverse mailbox (needs the Agentverse login once; see agent_readme.md)
	set -a; [ -f .env ] && . ./.env; set +a; $(PY) closet_agent.py --parent $@

.PHONY: venv install test demo live-check live addresses mina jo sam
