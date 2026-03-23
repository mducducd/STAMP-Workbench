# STAMP Workbench

**Workbench** is a notebook-style web UI for [STAMP](https://github.com/KatherLab/STAMP) that lets users compose drag-and-drop pathology pipelines, edit task-specific parameters in an inspector, import/export YAML configs, run stages step by step or end to end, and monitor per-cell runtime logs — without touching the CLI directly.

---

## Requirements

- A cloned and installed [STAMP](https://github.com/KatherLab/STAMP) environment
- A STAMP branch that already exposes the `stamp workbench` command
- Python ≥ 3.11

---

## Installation

Inside your STAMP clone:

```bash
uv sync
uv pip install git+https://github.com/mducducd/STAMP-Workbench.git
```

After the package is installed, launch the app through STAMP:

```bash
stamp workbench --host 127.0.0.1 --port 8010
```

Then open the printed URL in your browser.

## Repository structure

```
STAMP-Workbench/
├── pyproject.toml               # standalone package definition
└── stamp_workbench/
    ├── __init__.py
    ├── catalog.py          # task/field definitions for all STAMP pipeline stages
    ├── __main__.py         # `python -m stamp_workbench`
    ├── server.py           # HTTP server + direct package entry point
    ├── service.py          # pipeline validation, execution, run monitoring
    └── static/
        ├── index.html
        ├── app.js
        └── styles.css
```

For direct debugging, the package also exposes:

```bash
stamp-workbench --host 127.0.0.1 --port 8010
```

The recommended user flow remains:

```bash
uv pip install git+https://github.com/mducducd/STAMP-Workbench.git
stamp workbench
```

---

## License

Same as [STAMP](https://github.com/KatherLab/STAMP) — MIT.
