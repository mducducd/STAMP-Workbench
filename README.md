# STAMP Workbench

**Workbench** is a notebook-style web UI for [STAMP](https://github.com/KatherLab/STAMP) that lets users compose drag-and-drop pathology pipelines, edit task-specific parameters in an inspector, import/export YAML configs, run stages step by step or end to end, and monitor per-cell runtime logs — without touching the CLI directly.

---

## Requirements

- A cloned and installed [STAMP](https://github.com/KatherLab/STAMP) environment (`uv sync` already run)
- Python ≥ 3.11

---

## Installation

### Option A — via STAMP's built-in extra (recommended)

Inside your STAMP clone:

```bash
uv sync --extra stamp-workbench && stamp-workbench inject
```

This installs `stamp-workbench` into the active environment and copies the `workbench/` folder directly into your STAMP repository root.

### Option B — manually with pip

```bash
pip install git+https://github.com/mducducd/STAMP-Workbench.git
stamp-workbench inject          # copies workbench/ into the current directory
```

---

## Running

After injection, start the server from your STAMP clone root:

```bash
python workbench/server.py
```

Or use the installed entry point directly (no injection needed):

```bash
stamp-workbench                                   # serves on http://127.0.0.1:8010
stamp-workbench serve --host 0.0.0.0 --port 8010
```

Then open the printed URL in your browser.

---

## Updating

The `workbench/` folder is a plain copy — it is not tracked by STAMP's git.  
To update to a newer version:

```bash
rm -rf workbench/
uv sync --extra stamp-workbench && stamp-workbench inject
```

---

## Repository structure

```
STAMP-Workbench/
├── pyproject.toml          # standalone package definition
└── workbench/
    ├── __init__.py
    ├── catalog.py          # task/field definitions for all STAMP pipeline stages
    ├── server.py           # HTTP server + CLI entry point (inject / serve)
    ├── service.py          # pipeline validation, execution, run monitoring
    └── static/
        ├── index.html
        ├── app.js
        └── styles.css
```

---

## License

Same as [STAMP](https://github.com/KatherLab/STAMP) — MIT.
