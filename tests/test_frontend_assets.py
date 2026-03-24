from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP_JS = (ROOT / "stamp_workbench" / "static" / "app.js").read_text(encoding="utf-8")
STYLES_CSS = (ROOT / "stamp_workbench" / "static" / "styles.css").read_text(encoding="utf-8")


def test_frontend_messages_are_not_rendered_with_unsafe_dynamic_innerhtml():
    assert "elements.workspaceMessage.innerHTML = `<div class=\"message-card" not in APP_JS
    assert "elements.pipelineCanvas.innerHTML = `<div class=\"message-card error\">" not in APP_JS
    assert "createMessageCard(`Failed to load workbench: ${error.message}`, \"error\")" in APP_JS


def test_polling_does_not_use_overlapping_intervals():
    assert "window.setInterval" not in APP_JS
    assert "window.setTimeout(poll, 1500)" in APP_JS
    assert "queueRunRefresh" in APP_JS


def test_config_picker_and_modal_accessibility_regressions_are_covered():
    assert 'elements.configFileInput.value = "";' in APP_JS
    assert "trapSaveModalFocus" in APP_JS
    assert "node.inert = disabled" in APP_JS


def test_mobile_reorder_controls_are_present_in_assets():
    assert "cell-order-button" in APP_JS
    assert ".cell-order-button" in STYLES_CSS


def test_imported_advanced_config_is_merged_with_catalog_defaults():
    assert "function mergeDeep(base, override)" in APP_JS
    assert "state.advancedConfig = mergeDeep(" in APP_JS


def test_run_button_uses_local_missing_input_checks_instead_of_validate_endpoint():
    assert '"/api/validate"' not in APP_JS
    assert "collectMissingInputErrors" in APP_JS
    assert "Fill the missing required inputs before running." in APP_JS


def test_preprocessing_ui_does_not_expose_cache_directory():
    assert '"cache_dir"' not in APP_JS


def test_task_inspector_does_not_create_other_settings_panel():
    assert '"Other Settings"' not in APP_JS
    assert "const unmatched = [];" in APP_JS


def test_runtime_sampling_fields_are_not_split_from_paths_panel():
    assert "const TASK_PANEL_DEFS" not in APP_JS
    assert "title: `${task.title.toUpperCase()} SETTINGS`" in APP_JS
    assert 'groupFields(visibleFields, TASK_PANEL_DEFS)' not in APP_JS
