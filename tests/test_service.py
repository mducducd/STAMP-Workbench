import importlib
import sys
from pathlib import Path


def _make_stamp_root(base: Path) -> Path:
    (base / "src" / "stamp").mkdir(parents=True)
    (base / "pyproject.toml").write_text("[project]\nname='stamp'\n", encoding="utf-8")
    return base


def test_terminal_manager_does_not_execute_shell_operators(tmp_path):
    import stamp_workbench.service as service

    root = _make_stamp_root(tmp_path / "repo")
    service.set_repo_root(root)
    marker = tmp_path / "owned.txt"

    terminal = service.TerminalManager()
    terminal.run(f"echo hacked > {marker}")

    assert not marker.exists()


def test_repo_root_is_explicit_and_not_captured_at_import_time(tmp_path):
    import stamp_workbench.service as service

    first_root = _make_stamp_root(tmp_path / "repo-a")
    second_root = _make_stamp_root(tmp_path / "repo-b")

    service.set_repo_root(first_root)
    first_terminal = service.TerminalManager()
    assert first_terminal.snapshot()["cwd"] == str(first_root)

    service.set_repo_root(second_root)
    second_terminal = service.TerminalManager()
    assert second_terminal.snapshot()["cwd"] == str(second_root)


def test_catalog_import_does_not_probe_hardware(monkeypatch):
    import importlib as importlib_module
    import subprocess as subprocess_module

    called = {"torch": False, "nvidia": False}
    real_import_module = importlib_module.import_module

    def fake_import_module(name, package=None):
        if name == "torch":
            called["torch"] = True
            raise AssertionError("torch import should be lazy")
        return real_import_module(name, package)

    def fake_check_output(*args, **kwargs):
        called["nvidia"] = True
        raise AssertionError("nvidia-smi probe should be lazy")

    monkeypatch.setattr(importlib_module, "import_module", fake_import_module)
    monkeypatch.setattr(subprocess_module, "check_output", fake_check_output)

    sys.modules.pop("stamp_workbench.catalog", None)
    importlib.import_module("stamp_workbench.catalog")

    assert called == {"torch": False, "nvidia": False}
