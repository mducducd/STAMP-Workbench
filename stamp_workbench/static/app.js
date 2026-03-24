const state = {
  catalog: null,
  blocks: [],
  advancedConfig: null,
  selectedBlockId: null,
  inspectorPanels: {},
  validation: null,
  runs: [],
  activeRunId: null,
  activeRun: null,
  transientRunningBlockId: null,
  terminalMessage: "No run started yet.",
  terminalMessageTimer: null,
  terminal: { cwd: "", history: [] },
  pollingHandle: null,
  pollingEnabled: false,
  runRefreshLock: null,
  draggedTaskSection: null,
  draggedBlockId: null,
  saveModalRestoreFocus: null,
  sidebarView: "library",
  sidebarQuery: "",
};

const elements = {
  workbench: document.getElementById("workbench"),
  mainStack: document.getElementById("main-stack"),
  workspacePill: document.getElementById("workspace-pill"),
  runtimePill: document.getElementById("runtime-pill"),
  environmentSummary: document.getElementById("environment-summary"),
  taskPalette: document.getElementById("task-palette"),
  templateList: document.getElementById("template-list"),
  libraryPane: document.getElementById("library-pane"),
  templatesPane: document.getElementById("templates-pane"),
  configPane: document.getElementById("config-pane"),
  sidebarViewButtons: Array.from(document.querySelectorAll("[data-sidebar-view]")),
  configFileInput: document.getElementById("config-file-input"),
  configDropzone: document.getElementById("config-dropzone"),
  loadConfigButton: document.getElementById("load-config-button"),
  saveButton: document.getElementById("save-button"),
  reviewButton: document.getElementById("review-button"),
  inspectorSelection: document.getElementById("inspector-selection"),
  blockInspector: document.getElementById("block-inspector"),
  advancedConfig: document.getElementById("advanced-config"),
  clearButton: document.getElementById("clear-button"),
  workspaceSummary: document.getElementById("workspace-summary"),
  workspaceMessage: document.getElementById("workspace-message"),
  pipelineCanvas: document.getElementById("pipeline-canvas"),
  runButton: document.getElementById("run-button"),
  runPill: document.getElementById("run-pill"),
  runList: document.getElementById("run-list"),
  saveModal: document.getElementById("save-modal"),
  saveModalClose: document.getElementById("save-modal-close"),
  saveCancelButton: document.getElementById("save-cancel-button"),
  saveConfirmButton: document.getElementById("save-confirm-button"),
  saveFilename: document.getElementById("save-filename"),
  saveOutputDir: document.getElementById("save-output-dir"),
  saveSectionList: document.getElementById("save-section-list"),
  saveModalCount: document.getElementById("save-modal-count"),
  saveModalMessage: document.getElementById("save-modal-message"),
  resizerLeftMain: document.getElementById("resizer-left-main"),
  resizerMainRight: document.getElementById("resizer-main-right"),
  themeToggle: document.getElementById("theme-toggle"),
};

const LAYOUT_STORAGE = {
  left: "workbench.leftColPx",
  right: "workbench.rightColPx",
};

const THEME_STORAGE = "workbench.theme";

function initTheme() {
  const saved = localStorage.getItem(THEME_STORAGE) || "dark";
  applyTheme(saved);
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  if (elements.themeToggle) {
    elements.themeToggle.textContent = theme === "light" ? "☽" : "☀";
    elements.themeToggle.title = theme === "light" ? "Switch to dark theme" : "Switch to light theme";
  }
  localStorage.setItem(THEME_STORAGE, theme);
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme || "dark";
  applyTheme(current === "dark" ? "light" : "dark");
}

const TASK_COMMANDS = {
  preprocessing: "preprocess",
  slide_encoding: "encode_slides",
  patient_encoding: "encode_patients",
  training: "train",
  crossval: "crossval",
  deployment: "deploy",
  statistics: "statistics",
  heatmaps: "heatmaps",
};

const TASK_META = {
  preprocessing:     { icon: "▦",  color: "#5ecad4" },
  slide_encoding:    { icon: "⬡",  color: "#7b8dff" },
  patient_encoding:  { icon: "◎",  color: "#a78bfa" },
  training:          { icon: "⚡", color: "#f4a84a" },
  crossval:          { icon: "↺",  color: "#52c99a" },
  deployment:        { icon: "⬆",  color: "#4db6f0" },
  statistics:        { icon: "∑",  color: "#f47da5" },
  heatmaps:          { icon: "◫",  color: "#f4826e" },
};

const ADVANCED_PANEL_DEFS = [
  {
    id: "training_setup",
    title: "Training Setup",
    defaultOpen: true,
    matcher: () => true,
  },
];

function makeId() {
  return window.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function replaceChildren(element, ...nodes) {
  element.replaceChildren(...nodes.filter(Boolean));
}

function createMessageCard(text, tone = "info") {
  const card = document.createElement("div");
  card.className = `message-card ${tone}`;
  card.textContent = String(text || "");
  return card;
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await response.json() : null;

  if (!response.ok) {
    const error = new Error(payload?.error || payload?.errors?.join("\n") || response.statusText);
    error.payload = payload;
    error.status = response.status;
    throw error;
  }

  return payload;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeDeep(base, override) {
  if (!isPlainObject(base)) {
    return deepClone(override);
  }

  const result = deepClone(base);
  if (!isPlainObject(override)) {
    return result;
  }

  for (const [key, value] of Object.entries(override)) {
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = mergeDeep(result[key], value);
    } else {
      result[key] = deepClone(value);
    }
  }

  return result;
}

function defaultParamsFor(section) {
  const task = state.catalog.tasks[section];
  const params = {};
  for (const field of task.fields) {
    if (field.default !== null && field.default !== undefined) {
      params[field.name] = deepClone(field.default);
    } else if (field.kind === "boolean") {
      params[field.name] = false;
    } else if (field.kind === "list") {
      params[field.name] = [];
    } else {
      params[field.name] = "";
    }
  }
  return params;
}

function makeBlock(section) {
  return {
    id: makeId(),
    section,
    enabled: true,
    ui: {
      multiTarget: false,
      showRuntime: false,
      autoCreateSlideTable: false,
    },
    params: defaultParamsFor(section),
  };
}

function pipelinePayload() {
  return {
    blocks: state.blocks.map((block) => ({
      id: block.id,
      section: block.section,
      enabled: block.enabled,
      params: block.params,
      ui: block.ui,
    })),
    advanced_config: state.advancedConfig,
  };
}

function insertBlock(section, index = state.blocks.length) {
  const block = makeBlock(section);
  const safeIndex = Math.max(0, Math.min(index, state.blocks.length));
  state.blocks.splice(safeIndex, 0, block);
  state.selectedBlockId = block.id;
  renderAll();
  return true;
}

function selectedBlock() {
  return state.blocks.find((block) => block.id === state.selectedBlockId) || null;
}

function statusClass(status) {
  if (["completed"].includes(status)) return "good";
  if (["queued", "running", "terminating", "stopping"].includes(status)) return "info";
  if (["warning", "stopped"].includes(status)) return "warn";
  if (["failed", "terminated"].includes(status)) return "bad";
  return "info";
}

function runPillClass(status) {
  if (status === "completed") return "pill-good";
  if (["running", "queued", "terminating", "stopping"].includes(status)) return "pill-run";
  if (status === "stopped") return "pill-warn";
  if (["failed", "terminated"].includes(status)) return "pill-bad";
  return "pill-idle";
}

function matchesSidebarQuery(...values) {
  const query = state.sidebarQuery.trim().toLowerCase();
  if (!query) {
    return true;
  }
  return values
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query));
}

function blockHealthState(task, block) {
  const health = validateBlockLocally(task, block);
  if (!block.enabled) {
    return { label: "Disabled", tone: "warn", health };
  }
  if (isActiveRunForBlock(block)) {
    return { label: "Running", tone: "info", health };
  }
  if (isPendingBlock(block)) {
    return { label: "Waiting", tone: "warn", health };
  }
  if (health.ready) {
    return { label: "Ready", tone: "good", health };
  }
  return { label: "Missing inputs", tone: "warn", health };
}

function highlightFieldNamesForSection(section) {
  const shared = ["wsi_dir", "output_dir", "feat_dir", "feature_dir", "clini_table", "slide_table"];
  const perSection = {
    preprocessing: ["wsi_dir", "output_dir", "extractor", "device", "max_workers", "default_slide_mpp"],
    slide_encoding: ["feat_dir", "output_dir", "encoder", "agg_feat_dir", "device"],
    patient_encoding: ["feat_dir", "slide_table", "encoder", "task", "patient_label"],
    training: ["output_dir", "feature_dir", "clini_table", "task", "ground_truth_label"],
    crossval: ["output_dir", "feature_dir", "clini_table", "task", "ground_truth_label"],
    deployment: ["output_dir", "feature_dir", "clini_table", "task", "ground_truth_label"],
    statistics: ["output_dir", "clini_table", "ground_truth_label", "task"],
    heatmaps: ["output_dir", "feature_dir", "wsi_dir", "checkpoint_path", "default_slide_mpp"],
  };
  return [...new Set([...(perSection[section] || []), ...shared])];
}

function summarizeBlockFields(task, block, limit = 5) {
  const orderedNames = highlightFieldNamesForSection(block.section);
  const orderedFields = orderedNames
    .map((name) => task.fields.find((field) => field.name === name))
    .filter(Boolean);
  const seen = new Set(orderedFields.map((field) => field.name));
  const fields = [
    ...orderedFields,
    ...task.fields.filter((field) => !seen.has(field.name) && hasDisplayValue(field, block.params[field.name])),
  ];
  return fields
    .filter((field) => hasDisplayValue(field, block.params[field.name]))
    .slice(0, limit);
}

function friendlyValue(field, value) {
  if (field.kind === "boolean") {
    return value ? "yes" : "no";
  }
  if (field.kind === "list") {
    if (Array.isArray(value)) {
      return value.join(", ");
    }
    return value || "unset";
  }
  if (value === undefined || value === null || value === "") {
    return "unset";
  }
  return String(value);
}

function panelStateKey(scope, panelId) {
  return `${scope}:${panelId}`;
}

function isPanelOpen(scope, panelId, defaultOpen = false) {
  const key = panelStateKey(scope, panelId);
  if (Object.hasOwn(state.inspectorPanels, key)) {
    return state.inspectorPanels[key];
  }
  return defaultOpen;
}

function setPanelOpen(scope, panelId, nextOpen) {
  state.inspectorPanels[panelStateKey(scope, panelId)] = nextOpen;
}

function groupFields(fields, definitions) {
  const grouped = definitions.map((definition) => ({ ...definition, fields: [] }));
  const unmatched = [];
  for (const field of fields) {
    const bucket = grouped.find((definition) => definition.matcher(field));
    if (bucket) {
      bucket.fields.push(field);
    } else {
      unmatched.push(field);
    }
  }
  const nonEmpty = grouped.filter((group) => group.fields.length > 0);
  if (unmatched.length > 0) {
    if (nonEmpty.length > 0) {
      nonEmpty[nonEmpty.length - 1].fields.push(...unmatched);
    } else {
      nonEmpty.push({
        id: "settings",
        title: "Settings",
        defaultOpen: true,
        fields: unmatched,
      });
    }
  }
  return nonEmpty;
}

function readStoredPx(key) {
  try {
    const raw = window.localStorage.getItem(key);
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch (_error) {
    return null;
  }
}

function writeStoredPx(key, value) {
  try {
    window.localStorage.setItem(key, String(Math.round(value)));
  } catch (_error) {
    // Ignore storage failures.
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function applyStoredLayout() {
  const left = readStoredPx(LAYOUT_STORAGE.left);
  const right = readStoredPx(LAYOUT_STORAGE.right);
  if (left) {
    elements.workbench.style.setProperty("--left-col", `${left}px`);
  }
  if (right) {
    elements.workbench.style.setProperty("--right-col", `${right}px`);
  }
}

function initResizer(handle, side) {
  handle.addEventListener("pointerdown", (event) => {
    if (window.matchMedia("(max-width: 1120px)").matches) {
      return;
    }

    event.preventDefault();
    const startX = event.clientX;
    const styles = getComputedStyle(elements.workbench);
    const startLeft = parseFloat(styles.getPropertyValue("--left-col")) || 360;
    const startRight = parseFloat(styles.getPropertyValue("--right-col")) || 420;
    const total = elements.workbench.getBoundingClientRect().width;
    const centerMin = 540;
    const resizerWidth = 24;

    handle.classList.add("dragging");
    document.body.classList.add("is-resizing");

    const onMove = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      if (side === "left") {
        const maxLeft = total - startRight - centerMin - resizerWidth;
        const next = clamp(startLeft + delta, 280, maxLeft);
        elements.workbench.style.setProperty("--left-col", `${next}px`);
      } else {
        const maxRight = total - startLeft - centerMin - resizerWidth;
        const next = clamp(startRight - delta, 320, maxRight);
        elements.workbench.style.setProperty("--right-col", `${next}px`);
      }
    };

    const onUp = () => {
      const computed = getComputedStyle(elements.workbench);
      const currentLeft = parseFloat(computed.getPropertyValue("--left-col")) || startLeft;
      const currentRight = parseFloat(computed.getPropertyValue("--right-col")) || startRight;
      writeStoredPx(LAYOUT_STORAGE.left, currentLeft);
      writeStoredPx(LAYOUT_STORAGE.right, currentRight);
      handle.classList.remove("dragging");
      document.body.classList.remove("is-resizing");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  });
}

function createMetaPill(label, tone = "info") {
  const pill = document.createElement("span");
  pill.className = `meta-pill ${tone}`;
  pill.textContent = label;
  return pill;
}

function setButtonContent(button, icon, label, { spinning = false } = {}) {
  replaceChildren(button);
  const iconSpan = document.createElement("span");
  iconSpan.className = `cell-action-icon${spinning ? " spinning" : ""}`;
  iconSpan.textContent = icon;

  const labelSpan = document.createElement("span");
  labelSpan.textContent = label;

  button.append(iconSpan, labelSpan);
}

function parseListInput(raw, presentation = "csv") {
  const text = String(raw || "");
  if (presentation === "lines") {
    return text.split("\n").map((item) => item.trim()).filter(Boolean);
  }
  return text.split(",").map((item) => item.trim()).filter(Boolean);
}

function clearTerminalMessageTimer() {
  if (!state.terminalMessageTimer) {
    return;
  }
  window.clearTimeout(state.terminalMessageTimer);
  state.terminalMessageTimer = null;
}

function terminalMessageMeta(message) {
  const text = String(message || "");
  if (/failed|error/i.test(text)) {
    return { tone: "error", dismissMs: 0 };
  }
  if (/warning/i.test(text)) {
    return { tone: "warning", dismissMs: 0 };
  }
  if (/loaded|saved|ready to start|started\.|created\.|cleared/i.test(text)) {
    return { tone: "success", dismissMs: 3200 };
  }
  return { tone: "info", dismissMs: 0 };
}

function setTerminalMessage(message) {
  clearTerminalMessageTimer();
  state.terminalMessage = message;
  renderWorkspaceMessage();

  const { dismissMs } = terminalMessageMeta(message);
  if (message && dismissMs > 0) {
    state.terminalMessageTimer = window.setTimeout(() => {
      state.terminalMessage = "No run selected.";
      state.terminalMessageTimer = null;
      renderWorkspaceMessage();
    }, dismissMs);
  }
}

function getPathSuggestions(fieldName, excludeBlockId) {
  const seen = new Set();
  const suggestions = [];
  for (const block of state.blocks) {
    if (block.id === excludeBlockId) continue;
    const val = String(block.params?.[fieldName] ?? "").trim();
    if (val && !seen.has(val)) {
      seen.add(val);
      suggestions.push(val);
    }
  }
  return suggestions;
}

function createFieldEditor({ field, value, onChange, disabled = false, helpOverride = null, blockId = null }) {
  const wrapper = document.createElement("div");
  wrapper.className = "field";
  if (field.kind === "list" || field.help || field.kind === "path") {
    wrapper.classList.add("full-span");
  }

  const label = document.createElement("label");
  label.textContent = field.label + (field.required ? " *" : "");
  wrapper.append(label);

  let input;
  if (field.kind === "select") {
    input = document.createElement("select");
    const current = value ?? "";
    for (const optionValue of field.options || []) {
      const option = document.createElement("option");
      option.value = optionValue;
      option.textContent = optionValue === "" ? "Auto" : optionValue;
      if (String(optionValue) === String(current)) {
        option.selected = true;
      }
      input.append(option);
    }
    input.addEventListener("change", () => onChange(input.value));
  } else if (field.kind === "boolean") {
    input = document.createElement("select");
    const current = Boolean(value);
    for (const optionValue of [true, false]) {
      const option = document.createElement("option");
      option.value = optionValue ? "true" : "false";
      option.textContent = optionValue ? "true" : "false";
      if (optionValue === current) {
        option.selected = true;
      }
      input.append(option);
    }
    input.addEventListener("change", () => onChange(input.value === "true"));
  } else if (field.kind === "list") {
    input = document.createElement("textarea");
    input.placeholder = field.placeholder || (field.presentation === "lines" ? "one value per line" : "comma,separated");
    input.value = Array.isArray(value)
      ? value.join(field.presentation === "lines" ? "\n" : ",")
      : value || "";
    input.addEventListener("input", () => onChange(parseListInput(input.value, field.presentation)));
  } else {
    input = document.createElement("input");
    input.type = field.kind === "integer" || field.kind === "number" ? "number" : "text";
    input.placeholder = field.placeholder || "";
    input.value = value ?? "";
    if (field.kind === "number") {
      input.step = "any";
    }
    input.addEventListener("input", () => {
      if (field.kind === "integer") {
        onChange(input.value === "" ? "" : Number.parseInt(input.value, 10));
        return;
      }
      if (field.kind === "number") {
        onChange(input.value === "" ? "" : Number(input.value));
        return;
      }
      onChange(input.value);
    });
  }

  input.disabled = disabled;
  wrapper.append(input);

  if (helpOverride || field.help) {
    const help = document.createElement("div");
    help.className = "field-help";
    help.textContent = helpOverride || field.help;
    wrapper.append(help);
  }

  if (field.kind === "path") {
    const suggestions = getPathSuggestions(field.name, blockId);

    if (suggestions.length > 0) {
      const dropdown = document.createElement("ul");
      dropdown.className = "path-suggestions";
      dropdown.setAttribute("role", "listbox");

      function buildItems(filter) {
        dropdown.innerHTML = "";
        const filtered = filter
          ? suggestions.filter((s) => s.toLowerCase().includes(filter.toLowerCase()))
          : suggestions;
        for (const s of filtered) {
          const li = document.createElement("li");
          li.className = "path-suggestion-item";
          li.setAttribute("role", "option");
          li.textContent = s;
          li.addEventListener("mousedown", (e) => {
            e.preventDefault();
            input.value = s;
            onChange(s);
            dropdown.classList.remove("open");
          });
          dropdown.append(li);
        }
        dropdown.classList.toggle("open", filtered.length > 0);
      }

      input.addEventListener("focus", () => buildItems(input.value));
      input.addEventListener("input", () => buildItems(input.value));
      input.addEventListener("blur", () => {
        // slight delay so mousedown on item fires first
        setTimeout(() => dropdown.classList.remove("open"), 120);
      });
      input.addEventListener("keydown", (e) => {
        const items = [...dropdown.querySelectorAll(".path-suggestion-item")];
        const active = dropdown.querySelector(".path-suggestion-item.active");
        const idx = items.indexOf(active);
        if (e.key === "ArrowDown") {
          e.preventDefault();
          const next = items[(idx + 1) % items.length];
          active?.classList.remove("active");
          next?.classList.add("active");
          next?.scrollIntoView({ block: "nearest" });
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          const prev = items[(idx - 1 + items.length) % items.length];
          active?.classList.remove("active");
          prev?.classList.add("active");
          prev?.scrollIntoView({ block: "nearest" });
        } else if (e.key === "Enter" && active) {
          e.preventDefault();
          input.value = active.textContent;
          onChange(active.textContent);
          dropdown.classList.remove("open");
        } else if (e.key === "Escape") {
          dropdown.classList.remove("open");
        }
      });

      wrapper.style.position = "relative";
      wrapper.append(dropdown);
    }

    if (suggestions.length > 0) {
      const meta = document.createElement("div");
      meta.className = "field-meta";
      meta.textContent = `${suggestions.length} suggestion${suggestions.length > 1 ? "s" : ""} from other cells.`;
      wrapper.append(meta);
    }
  }

  return wrapper;
}

function blockFieldNames(block) {
  return new Set(state.catalog.tasks[block.section].fields.map((field) => field.name));
}

function supportsAutoSlideTable(block) {
  const names = blockFieldNames(block);
  return names.has("slide_table") && names.has("clini_table") && (names.has("feature_dir") || names.has("feat_dir"));
}

function slideTableFeatureDir(block) {
  return block.params.feature_dir || block.params.feat_dir || "";
}

function slideTableAutoCreateMissing(block) {
  const missing = [];
  if (!String(block.params.clini_table || "").trim()) {
    missing.push("Clinical Table");
  }
  if (!String(slideTableFeatureDir(block) || "").trim()) {
    missing.push("Feature Directory");
  }
  if (!String(block.params.patient_label || "").trim()) {
    missing.push("Patient Column");
  }
  if (!String(block.params.filename_label || "").trim()) {
    missing.push("Filename Column");
  }
  return missing;
}

function createSlideTableEditor(field, block) {
  const wrapper = document.createElement("div");
  wrapper.className = "field full-span slide-table-field";

  const label = document.createElement("label");
  label.textContent = field.label + (field.required ? " *" : "");
  wrapper.append(label);

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = field.placeholder || "";
  input.value = block.params[field.name] ?? "";
  input.disabled = Boolean(block.ui?.autoCreateSlideTable);
  input.addEventListener("input", () => {
    block.params[field.name] = input.value;
    renderPipeline();
  });
  wrapper.append(input);

  if (block.ui?.autoCreateSlideTable) {
    const meta = document.createElement("div");
    meta.className = "field-meta";
    meta.textContent = "This path will be generated automatically right before STAMP runs.";
    wrapper.append(meta);
  }

  if (!supportsAutoSlideTable(block)) {
    return wrapper;
  }

  const toggle = document.createElement("label");
  toggle.className = "field-toggle";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = Boolean(block.ui?.autoCreateSlideTable);
  checkbox.addEventListener("change", () => {
    block.ui = block.ui || {};
    block.ui.autoCreateSlideTable = checkbox.checked;
    renderInspector();
    renderPipeline();
  });
  const toggleText = document.createElement("span");
  toggleText.textContent = "Auto create slide table";
  toggle.append(checkbox, toggleText);
  wrapper.append(toggle);

  if (!checkbox.checked) {
    return wrapper;
  }

  const helper = document.createElement("div");
  helper.className = "slide-table-helper";

  const copy = document.createElement("div");
  copy.className = "field-help";
  copy.textContent = "A temp slide_table.csv will be created automatically right before STAMP runs, using the current Clinical Table, Feature Directory, Patient Column, and Filename Column.";
  helper.append(copy);

  const missing = slideTableAutoCreateMissing(block);
  if (missing.length > 0) {
    const warning = document.createElement("div");
    warning.className = "field-help slide-table-warning";
    warning.textContent = `Missing: ${missing.join(", ")}`;
    helper.append(warning);
  }
  wrapper.append(helper);

  return wrapper;
}

function blockTask(block) {
  return block.params.task || "classification";
}

function fieldVisibleForBlock(field, block) {
  const task = blockTask(block);
  if (field.name === "status_label" || field.name === "time_label") {
    return task === "survival";
  }
  if (field.name === "categories") {
    return task === "classification";
  }
  if (field.name === "ground_truth_label") {
    return task !== "survival";
  }
  return true;
}

function isMultiTargetBlock(block) {
  return blockTask(block) === "classification" && Boolean(block.ui?.multiTarget);
}

function pipelineRequiresBarspoon() {
  return state.blocks.some((block) => (
    ["training", "crossval", "deployment", "statistics"].includes(block.section)
    && isMultiTargetBlock(block)
  ));
}

function createGroundTruthEditor(field, block) {
  const wrapper = document.createElement("div");
  wrapper.className = "field full-span multi-target-field";

  const label = document.createElement("label");
  label.textContent = field.label + (field.required ? " *" : "");
  wrapper.append(label);

  const task = blockTask(block);
  const isClassification = task === "classification";
  const multiTarget = isMultiTargetBlock(block);

  if (isClassification) {
    const toggle = document.createElement("label");
    toggle.className = "field-toggle";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = multiTarget;
    checkbox.addEventListener("change", () => {
      block.ui = block.ui || {};
      block.ui.multiTarget = checkbox.checked;
      if (checkbox.checked) {
        const values = Array.isArray(block.params.ground_truth_label)
          ? block.params.ground_truth_label
          : parseListInput(block.params.ground_truth_label || "", "csv");
        block.params.ground_truth_label = values;
      } else {
        const first = Array.isArray(block.params.ground_truth_label)
          ? (block.params.ground_truth_label[0] || "")
          : String(block.params.ground_truth_label || "");
        block.params.ground_truth_label = first;
      }
      if (pipelineRequiresBarspoon()) {
        state.advancedConfig.model_name = "barspoon";
      } else if (!state.advancedConfig.model_name) {
        state.advancedConfig.model_name = "vit";
      }
      renderInspector();
      renderAdvancedConfig();
      renderPipeline();
    });
    const toggleText = document.createElement("span");
    toggleText.textContent = "Multi-target";
    toggle.append(checkbox, toggleText);
    wrapper.append(toggle);
  }

  const input = isClassification && multiTarget
    ? document.createElement("textarea")
    : document.createElement("input");

  if (input.tagName === "TEXTAREA") {
    input.placeholder = "KRAS,BRAF,NRAS";
    input.value = Array.isArray(block.params.ground_truth_label)
      ? block.params.ground_truth_label.join(",")
      : block.params.ground_truth_label || "";
    input.addEventListener("input", () => {
      block.params.ground_truth_label = parseListInput(input.value, "csv");
      if (pipelineRequiresBarspoon()) {
        state.advancedConfig.model_name = "barspoon";
        renderAdvancedConfig();
      }
      renderPipeline();
    });
  } else {
    input.type = "text";
    input.placeholder = "KRAS";
    input.value = Array.isArray(block.params.ground_truth_label)
      ? (block.params.ground_truth_label[0] || "")
      : (block.params.ground_truth_label || "");
    input.addEventListener("input", () => {
      block.params.ground_truth_label = input.value;
      renderPipeline();
    });
  }

  wrapper.append(input);

  const help = document.createElement("div");
  help.className = "field-help";
  help.textContent = isClassification && multiTarget
    ? "Separate labels with commas. The pipeline will feed them as a list and lock Model Backbone to barspoon."
    : "Use one label for regression or single-target classification.";
  wrapper.append(help);

  return wrapper;
}

function fieldKindFromValue(value) {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return "text";
}

function createModelParamEditor(modelName, paramName, value) {
  const pseudoField = {
    name: paramName,
    label: paramName.replaceAll("_", " "),
    kind: fieldKindFromValue(value),
    help: "",
    required: false,
    placeholder: "",
  };
  const editor = createFieldEditor({
    field: pseudoField,
    value,
    onChange: (nextValue) => {
      state.advancedConfig.model_params[modelName][paramName] = nextValue;
    },
  });
  editor.classList.add("model-param-field");
  return editor;
}

function renderTopbar() {
  const env = state.catalog.environment;
  const activeCount = state.blocks.filter((block) => block.enabled).length;
  const cellText = state.blocks.length === 0 ? "No cells" : `${activeCount}/${state.blocks.length} active cells`;
  elements.workspacePill.className = `pill ${activeCount > 0 ? "pill-good" : "pill-idle"}`;
  elements.workspacePill.textContent = cellText;
  elements.runtimePill.textContent = `${env.devices.join(" / ")} | Python ${env.python}`;
  elements.environmentSummary.textContent = `${env.platform} | ${env.cwd}`;
}

function renderTaskPalette() {
  replaceChildren(elements.taskPalette);
  for (const [section, task] of Object.entries(state.catalog.tasks)) {
    if (!matchesSidebarQuery(task.title, task.summary, TASK_COMMANDS[section], section)) {
      continue;
    }
    const meta = TASK_META[section] || { icon: "◆", color: "#97aabd" };
    const card = document.createElement("article");
    card.className = "palette-card";
    card.dataset.section = section;
    card.draggable = true;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Add ${task.title} task`);

    const iconChip = document.createElement("div");
    iconChip.className = "palette-icon";
    iconChip.textContent = meta.icon;
    iconChip.style.setProperty("--task-color", meta.color);

    const body = document.createElement("div");
    body.className = "palette-body";
    const title = document.createElement("h4");
    title.textContent = task.title;
    const summary = document.createElement("p");
    summary.textContent = task.summary;
    body.append(title, summary);

    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "ghost palette-add";
    addButton.setAttribute("aria-label", `Add ${task.title} task`);
    addButton.textContent = "+";
    addButton.addEventListener("click", (event) => {
      event.stopPropagation();
      addBlock(section);
    });

    card.addEventListener("click", () => addBlock(section));
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      addBlock(section);
    });
    card.addEventListener("dragstart", (event) => {
      state.draggedTaskSection = section;
      card.classList.add("dragging");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("text/plain", `task:${section}`);
      }
    });
    card.addEventListener("dragend", () => {
      state.draggedTaskSection = null;
      card.classList.remove("dragging");
      clearDropTargets();
    });

    card.append(iconChip, body, addButton);
    elements.taskPalette.append(card);
  }

  if (!elements.taskPalette.children.length) {
    elements.taskPalette.append(createMessageCard("No tasks match the current search.", "warning"));
  }
}

function renderTemplates() {
  replaceChildren(elements.templateList);
  for (const template of state.catalog.templates) {
    if (!matchesSidebarQuery(template.title, template.description, ...(template.sections || []))) {
      continue;
    }
    const card = document.createElement("article");
    card.className = "template-card";
    const head = document.createElement("div");
    head.className = "template-head";
    const copy = document.createElement("div");
    copy.className = "template-copy";
    const title = document.createElement("h4");
    title.textContent = template.title;
    const description = document.createElement("p");
    description.textContent = template.description;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ghost template-apply";
    button.textContent = "Apply";
    button.addEventListener("click", () => applyTemplate(template));
    copy.append(title, description);
    head.append(copy, button);
    card.append(head);
    elements.templateList.append(card);
  }

  if (!elements.templateList.children.length) {
    elements.templateList.append(createMessageCard("No templates match the current search.", "warning"));
  }
}

function renderSidebarView() {
  const views = {
    library: elements.libraryPane,
    templates: elements.templatesPane,
    config: elements.configPane,
  };

  Object.entries(views).forEach(([view, pane]) => {
    pane.hidden = view !== state.sidebarView;
  });

  elements.sidebarViewButtons.forEach((button) => {
    const active = button.dataset.sidebarView === state.sidebarView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });

}

function renderAdvancedConfig() {
  if (!state.advancedConfig.model_name) {
    state.advancedConfig.model_name = "vit";
  }
  const forceBarspoon = pipelineRequiresBarspoon();
  if (forceBarspoon) {
    state.advancedConfig.model_name = "barspoon";
  }
  replaceChildren(elements.advancedConfig);
  const grouped = groupFields(state.catalog.advanced_fields, ADVANCED_PANEL_DEFS);
  for (const panel of grouped) {
    const body = document.createElement("div");
    body.className = "field-grid inspector-field-grid compact-advanced-grid";
    for (const field of panel.fields) {
      const isLockedModel = field.name === "model_name" && forceBarspoon;
      const editor = createFieldEditor({
        field,
        value: state.advancedConfig[field.name],
        onChange: (value) => {
          state.advancedConfig[field.name] = value;
          if (field.name === "model_name") {
            renderAdvancedConfig();
          }
        },
        disabled: isLockedModel,
        helpOverride: isLockedModel
          ? "Locked to barspoon because a classification cell is using multi-target labels."
          : null,
      });
      editor.classList.remove("full-span");
      editor.classList.add("compact-field");
      if (field.name === "model_name" || field.name === "accelerator") {
        editor.classList.add("compact-field-wide");
      }
      body.append(editor);
    }
    elements.advancedConfig.append(createInspectorPanel("advanced", panel, body));
  }

  const modelName = state.advancedConfig.model_name;
  const modelParams = state.advancedConfig.model_params?.[modelName];
  if (modelName && modelParams) {
    const paramsBody = document.createElement("div");
    paramsBody.className = "field-grid inspector-field-grid compact-advanced-grid";
    for (const [paramName, paramValue] of Object.entries(modelParams)) {
      const editor = createModelParamEditor(modelName, paramName, paramValue);
      if (typeof paramValue === "number" || typeof paramValue === "boolean") {
        editor.classList.add("compact-field");
      } else {
        editor.classList.add("compact-field-wide");
      }
      paramsBody.append(editor);
    }
    elements.advancedConfig.append(
      createInspectorPanel(
        "advanced",
        {
          id: `model_params_${modelName}`,
          title: `${modelName} Hyperparameters`,
          defaultOpen: true,
          fields: Object.keys(modelParams).map((name) => ({ name })),
        },
        paramsBody,
      ),
    );
  }
}

function renderWorkspaceSummary() {
  replaceChildren(elements.workspaceSummary);
  if (state.blocks.length === 0) {
    return;
  }

  const overview = document.createElement("div");
  overview.className = "workspace-overview";
  const readyCount = state.blocks.filter((block) => {
    const task = state.catalog.tasks[block.section];
    return validateBlockLocally(task, block).ready;
  }).length;

  overview.append(
    createMetaPill(`${state.blocks.length} cells in flow`, "info"),
    createMetaPill(`${state.blocks.filter((block) => block.enabled).length} active`, "good"),
    createMetaPill(`${readyCount} ready`, readyCount === state.blocks.length ? "good" : "warn"),
  );

  const rail = document.createElement("div");
  rail.className = "pipeline-rail";

  state.blocks.forEach((block, index) => {
    const task = state.catalog.tasks[block.section];
    const status = blockHealthState(task, block);
    const meta = TASK_META[block.section] || { icon: "◆", color: "#97aabd" };

    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `pipeline-chip ${block.id === state.selectedBlockId ? "active" : ""}`;
    chip.addEventListener("click", () => {
      state.selectedBlockId = block.id;
      renderPipeline();
      renderInspector();
      chip.scrollIntoView({ block: "nearest", inline: "nearest" });
    });

    const icon = document.createElement("span");
    icon.className = "pipeline-chip-icon";
    icon.textContent = meta.icon;
    icon.style.setProperty("--task-color", meta.color);

    const label = document.createElement("span");
    label.className = "pipeline-chip-label";
    label.textContent = task.title;

    const statePill = document.createElement("span");
    statePill.className = `pipeline-chip-state ${status.tone}`;
    statePill.textContent = status.label;

    chip.append(icon, label, statePill);
    rail.append(chip);

    if (index < state.blocks.length - 1) {
      const arrow = document.createElement("span");
      arrow.className = "pipeline-rail-arrow";
      arrow.textContent = "→";
      rail.append(arrow);
    }
  });

  elements.workspaceSummary.append(overview, rail);
}

function renderWorkspaceMessage() {
  const text = state.terminalMessage || "";
  const shouldHide = !text || text === "No run selected." || text === "No run started yet.";
  elements.workspaceMessage.hidden = shouldHide;
  if (shouldHide) {
    replaceChildren(elements.workspaceMessage);
    return;
  }

  const { tone } = terminalMessageMeta(text);
  replaceChildren(elements.workspaceMessage, createMessageCard(text, tone));
}

function hasDisplayValue(field, value) {
  if (field.kind === "boolean") {
    return value === true;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return value !== undefined && value !== null && value !== "";
}

function renderBlockSummary(task, block) {
  const summary = document.createElement("div");
  summary.className = "cell-summary-stack";

  const chips = document.createElement("div");
  chips.className = "cell-summary";

  const status = blockHealthState(task, block);
  chips.append(createMetaPill(status.label, status.tone));

  const fields = summarizeBlockFields(task, block);
  if (fields.length === 0) {
    chips.append(createMetaPill("No parameters filled yet", "warn"));
  } else {
    for (const field of fields) {
      chips.append(createMetaPill(`${field.label}: ${friendlyValue(field, block.params[field.name])}`, "info"));
    }
  }

  summary.append(chips);

  const runtime = runtimeForBlock(block);
  const footer = document.createElement("div");
  footer.className = "cell-summary-subline";
  if (runtime) {
    footer.textContent = `${runtime.command} · ${runtime.status}`;
  } else if (status.health.missing.length > 0) {
    footer.textContent = `Missing: ${status.health.missing.join(", ")}`;
  } else if (!block.enabled) {
    footer.textContent = "This cell is disabled and will be skipped.";
  } else {
    footer.textContent = "Configured and ready for the active pipeline.";
  }
  summary.append(footer);

  return summary;
}

function createInspectorPanel(scope, panel, content) {
  const details = document.createElement("details");
  details.className = "inspector-panel";
  details.open = isPanelOpen(scope, panel.id, panel.defaultOpen);
  details.addEventListener("toggle", () => {
    setPanelOpen(scope, panel.id, details.open);
    const toggle = details.querySelector(".inspector-panel-toggle");
    if (toggle) {
      toggle.textContent = details.open ? "▾" : "▸";
    }
  });

  const head = document.createElement("summary");
  head.className = "inspector-panel-head";

  const title = document.createElement("div");
  title.className = "inspector-panel-title";
  title.textContent = panel.title;

  const count = document.createElement("div");
  count.className = "inspector-panel-count";
  count.textContent = `${panel.fields.length}`;

  const toggle = document.createElement("div");
  toggle.className = "inspector-panel-toggle";
  toggle.textContent = details.open ? "▾" : "▸";

  head.append(title, count, toggle);
  details.append(head, content);
  return details;
}

function validateBlockLocally(task, block) {
  const missing = [];
  for (const field of task.fields) {
    if (!field.required) {
      continue;
    }
    const value = block.params[field.name];
    if (
      field.name === "slide_table"
      && block.ui?.autoCreateSlideTable
      && supportsAutoSlideTable(block)
    ) {
      continue;
    }
    const emptyList = Array.isArray(value) && value.length === 0;
    const emptyString = value === undefined || value === null || value === "";
    if (emptyList || emptyString) {
      missing.push(field.label);
    }
  }
  return {
    ready: missing.length === 0,
    missing,
  };
}

function collectMissingInputErrors(blocks) {
  const errors = [];
  let firstInvalidBlockId = null;

  for (const block of blocks) {
    const task = state.catalog.tasks[block.section];
    const health = validateBlockLocally(task, block);
    if (health.ready) {
      continue;
    }

    const index = state.blocks.findIndex((candidate) => candidate.id === block.id);
    const label = index === -1 ? task.title : `Cell ${index + 1} (${task.title})`;
    errors.push(`${label} is missing: ${health.missing.join(", ")}`);
    if (!firstInvalidBlockId) {
      firstInvalidBlockId = block.id;
    }
  }

  return { errors, firstInvalidBlockId };
}

function showMissingInputAlert(errors, firstInvalidBlockId) {
  state.validation = {
    valid: false,
    errors,
    warnings: [],
    config_preview: state.validation?.config_preview || "",
  };
  if (firstInvalidBlockId) {
    state.selectedBlockId = firstInvalidBlockId;
  }
  renderPipeline();
  renderInspector();
  setTerminalMessage(`[workbench] Fill the missing required inputs before running.\n${errors.join("\n")}`);
}

function reviewPipelineInputs() {
  const enabledBlocks = state.blocks.filter((block) => block.enabled);
  if (!enabledBlocks.length) {
    setTerminalMessage("[workbench] Add at least one enabled cell before reviewing the pipeline.");
    return;
  }

  const { errors, firstInvalidBlockId } = collectMissingInputErrors(enabledBlocks);
  if (errors.length) {
    showMissingInputAlert(errors, firstInvalidBlockId);
    return;
  }

  state.validation = {
    valid: true,
    errors: [],
    warnings: [],
    config_preview: state.validation?.config_preview || "",
  };
  renderPipeline();
  renderInspector();
  setTerminalMessage("[workbench] All enabled cells have the required inputs. The pipeline is ready to run.");
}

function renderInspector() {
  const block = selectedBlock();
  replaceChildren(elements.blockInspector);

  if (!block) {
    elements.inspectorSelection.textContent = "No cell selected";
    elements.blockInspector.className = "inspector-body empty-state";
    elements.blockInspector.textContent = "Select a pipeline cell to edit its settings.";
    return;
  }

  const index = state.blocks.findIndex((item) => item.id === block.id);
  const task = state.catalog.tasks[block.section];
  const health = validateBlockLocally(task, block);
  elements.inspectorSelection.textContent = `Cell ${index + 1} · ${task.title}`;
  elements.blockInspector.className = "inspector-body";

  const stack = document.createElement("div");
  stack.className = "inspector-stack";

  const lead = document.createElement("div");
  lead.className = "inspector-lead";
  const taskMeta = TASK_META[block.section] || { icon: "◆", color: "#97aabd" };
  const leadIcon = document.createElement("div");
  leadIcon.className = "inspector-lead-icon";
  leadIcon.textContent = taskMeta.icon;
  leadIcon.style.setProperty("--task-color", taskMeta.color);
  const leadBody = document.createElement("div");
  leadBody.className = "inspector-lead-body";
  const leadTitle = document.createElement("div");
  leadTitle.className = "inspector-kicker";
  leadTitle.textContent = task.title;
  const leadText = document.createElement("p");
  leadText.className = "inspector-copy";
  leadText.textContent = task.summary;
  leadBody.append(leadTitle, leadText);
  const leadStatus = blockHealthState(task, block);
  const leadBadge = createMetaPill(leadStatus.label, leadStatus.tone);
  leadBadge.classList.add("inspector-lead-status");
  lead.append(leadIcon, leadBody, leadBadge);

  const meta = document.createElement("div");
  meta.className = "meta-row";
  meta.append(
    createMetaPill(`Cell ${index + 1}`, "info"),
    createMetaPill(TASK_COMMANDS[block.section], "info"),
    createMetaPill(block.enabled ? "Active" : "Disabled", block.enabled ? "good" : "warn"),
    createMetaPill(health.ready ? "Ready to run" : "Missing inputs", health.ready ? "good" : "warn"),
  );

  const toolbar = document.createElement("div");
  toolbar.className = "inspector-toolbar";

  const toggleButton = document.createElement("button");
  toggleButton.type = "button";
  toggleButton.className = "ghost";
  toggleButton.textContent = block.enabled ? "Disable Cell" : "Enable Cell";
  toggleButton.addEventListener("click", () => {
    block.enabled = !block.enabled;
    renderTopbar();
    renderPipeline();
    renderInspector();
  });

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "ghost";
  removeButton.textContent = "Remove Cell";
  removeButton.addEventListener("click", () => removeBlock(block.id));

  toolbar.append(toggleButton, removeButton);

  const visibleFields = task.fields.filter((field) => fieldVisibleForBlock(field, block));
  const grid = document.createElement("div");
  grid.className = "inspector-group-stack";
  const panelBody = document.createElement("div");
  panelBody.className = "field-grid inspector-field-grid";
  for (const field of visibleFields) {
    let editor;
    if (field.name === "ground_truth_label") {
      editor = createGroundTruthEditor(field, block);
    } else if (field.name === "slide_table") {
      editor = createSlideTableEditor(field, block);
    } else {
      editor = createFieldEditor({
        field,
        value: block.params[field.name],
        blockId: block.id,
        onChange: (value) => {
          block.params[field.name] = value;
          if (field.name === "task") {
            if (value !== "classification" && block.ui) {
              block.ui.multiTarget = false;
            }
            if (pipelineRequiresBarspoon()) {
              state.advancedConfig.model_name = "barspoon";
            } else if (!state.advancedConfig.model_name || state.advancedConfig.model_name === "") {
              state.advancedConfig.model_name = "vit";
            }
            renderAdvancedConfig();
            renderInspector();
          }
          renderPipeline();
        },
      });
    }
    panelBody.append(editor);
  }
  grid.append(createInspectorPanel(`block:${block.id}`, {
    id: "settings",
    title: `${task.title.toUpperCase()} SETTINGS`,
    defaultOpen: true,
    fields: visibleFields,
  }, panelBody));

  const note = document.createElement("div");
  note.className = "inspector-note";
  note.textContent = health.ready
    ? "This cell is configured. Changes save automatically as you edit."
    : `Missing required inputs: ${health.missing.join(", ")}. Fill these fields before running the pipeline.`;

  stack.append(lead, meta, toolbar, grid, note);
  elements.blockInspector.append(stack);
}

function renderPipeline() {
  renderWorkspaceSummary();
  replaceChildren(elements.pipelineCanvas);

  if (state.blocks.length === 0) {
    elements.pipelineCanvas.append(createDropSlot(0, true));
    return;
  }

  elements.pipelineCanvas.append(createDropSlot(0));

  state.blocks.forEach((block, index) => {
    const task = state.catalog.tasks[block.section];
    const blockRunning = isActiveRunForBlock(block);
    const blockPending = isPendingBlock(block);
    const blockDisabled = !block.enabled;
    const taskMeta = TASK_META[block.section] || { icon: "◆", color: "#97aabd" };
    const card = document.createElement("article");
    card.className = `cell-card ${block.id === state.selectedBlockId ? "selected" : ""} ${blockPending ? "pending" : ""} ${blockDisabled ? "disabled" : ""}`;
    card.dataset.section = block.section;
    card.style.setProperty("--task-color", taskMeta.color);
    card.tabIndex = 0;
    card.draggable = true;

    card.addEventListener("click", (event) => {
      if (event.target.closest("button, input, textarea, select, a")) {
        return;
      }
      state.selectedBlockId = block.id;
      renderPipeline();
      renderInspector();
    });
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      state.selectedBlockId = block.id;
      renderPipeline();
      renderInspector();
    });
    card.addEventListener("dragstart", (event) => {
      state.draggedBlockId = block.id;
      card.classList.add("dragging");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", `block:${block.id}`);
      }
    });
    card.addEventListener("dragend", () => {
      state.draggedBlockId = null;
      card.classList.remove("dragging");
      clearDropTargets();
    });
    card.addEventListener("dragenter", (event) => {
      const payload = dragPayloadFromEvent(event);
      if (!payload) {
        return;
      }
      event.preventDefault();
      const target = cardDropIndex(card, index, event);
      clearDropTargets();
      card.classList.add(target.position === "before" ? "drop-before" : "drop-after");
      elements.pipelineCanvas.classList.add("drop-active");
    });
    card.addEventListener("dragover", (event) => {
      const payload = dragPayloadFromEvent(event);
      if (!payload) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = payload.kind === "block" ? "move" : "copy";
      }
      const target = cardDropIndex(card, index, event);
      clearDropTargets();
      card.classList.add(target.position === "before" ? "drop-before" : "drop-after");
      elements.pipelineCanvas.classList.add("drop-active");
    });
    card.addEventListener("dragleave", (event) => {
      if (event.relatedTarget && card.contains(event.relatedTarget)) {
        return;
      }
      card.classList.remove("drop-before", "drop-after");
      if (!elements.pipelineCanvas.querySelector(".drop-slot.active, .cell-card.drop-before, .cell-card.drop-after")) {
        elements.pipelineCanvas.classList.remove("drop-active");
      }
    });
    card.addEventListener("drop", (event) => {
      const payload = dragPayloadFromEvent(event);
      if (!payload) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const target = cardDropIndex(card, index, event);
      applyDropPayload(payload, target.index);
    });

    const shell = document.createElement("div");
    shell.className = "cell-shell";

    const main = document.createElement("div");
    main.className = "cell-main";

    const head = document.createElement("div");
    head.className = "cell-head";
    const headLead = document.createElement("div");
    headLead.className = "cell-head-lead";
    const runIconButton = document.createElement("button");
    runIconButton.type = "button";
    runIconButton.className = `cell-head-run ${blockRunning ? "running" : "idle"}`;
    runIconButton.setAttribute("aria-label", blockRunning ? `Stop ${task.title} step` : `Run ${task.title} step`);
    runIconButton.title = blockRunning ? "Stop step" : "Run step";
    runIconButton.textContent = blockRunning ? "■" : "▶";
    runIconButton.addEventListener("click", (event) => {
      event.stopPropagation();
      runSingleBlock(block);
    });

    const copy = document.createElement("div");
    copy.className = "cell-head-copy";
    const titleRow = document.createElement("div");
    titleRow.className = "cell-title-row";
    const indexBadge = document.createElement("span");
    indexBadge.className = "cell-index-badge";
    indexBadge.textContent = `#${index + 1}`;
    const title = document.createElement("h3");
    title.textContent = task.title;
    titleRow.append(indexBadge, title);

    const subtitle = document.createElement("p");
    subtitle.textContent = task.summary;
    copy.append(titleRow, subtitle);
    headLead.append(runIconButton, copy);

    const status = blockHealthState(task, block);
    const statusPill = createMetaPill(status.label, status.tone);
    statusPill.classList.add("cell-status-pill");
    head.append(headLead, statusPill);
    main.append(head);
    main.append(renderBlockSummary(task, block));

    if (block.ui?.showRuntime) {
      main.append(renderBlockRuntime(block));
    }

    const footer = document.createElement("div");
    footer.className = "cell-footer";

    const primaryActions = document.createElement("div");
    primaryActions.className = "cell-footer-actions";

    const runtimeButton = document.createElement("button");
    runtimeButton.type = "button";
    runtimeButton.className = "ghost cell-action-button";
    setButtonContent(runtimeButton, ">_", block.ui?.showRuntime ? "Hide Terminal" : "Show Terminal");
    runtimeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      block.ui = block.ui || {};
      block.ui.showRuntime = !block.ui.showRuntime;
      renderPipeline();
    });

    primaryActions.append(runtimeButton);

    const secondaryActions = document.createElement("div");
    secondaryActions.className = "cell-footer-actions cell-footer-actions-secondary";

    const enableButton = document.createElement("button");
    enableButton.type = "button";
    enableButton.className = "ghost cell-action-button";
    setButtonContent(enableButton, block.enabled ? "⊘" : "✓", block.enabled ? "Disable" : "Enable");
    enableButton.addEventListener("click", (event) => {
      event.stopPropagation();
      block.enabled = !block.enabled;
      renderPipeline();
      renderInspector();
      renderTopbar();
    });

    const moveUpButton = document.createElement("button");
    moveUpButton.type = "button";
    moveUpButton.className = "ghost cell-order-button";
    moveUpButton.setAttribute("aria-label", `Move ${task.title} cell up`);
    moveUpButton.title = "Move cell up";
    moveUpButton.textContent = "↑";
    moveUpButton.disabled = index === 0;
    moveUpButton.addEventListener("click", (event) => {
      event.stopPropagation();
      moveBlock(index, index - 1);
    });

    const moveDownButton = document.createElement("button");
    moveDownButton.type = "button";
    moveDownButton.className = "ghost cell-order-button";
    moveDownButton.setAttribute("aria-label", `Move ${task.title} cell down`);
    moveDownButton.title = "Move cell down";
    moveDownButton.textContent = "↓";
    moveDownButton.disabled = index === state.blocks.length - 1;
    moveDownButton.addEventListener("click", (event) => {
      event.stopPropagation();
      moveBlock(index, index + 1);
    });

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "ghost cell-remove-icon cell-action-button";
    removeButton.setAttribute("aria-label", `Remove ${task.title} cell`);
    removeButton.title = "Remove cell";
    setButtonContent(removeButton, "×", "Remove");
    removeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      removeBlock(block.id);
    });

    secondaryActions.append(enableButton, moveUpButton, moveDownButton, removeButton);
    footer.append(primaryActions, secondaryActions);
    main.append(footer);

    shell.append(main);
    card.append(shell);
    elements.pipelineCanvas.append(card);
    elements.pipelineCanvas.append(createDropSlot(index + 1));
  });
}

function currentStage(run) {
  if (!run) {
    return null;
  }
  return run.stages.find((stage) => stage.status === "running")
    || run.stages.find((stage) => stage.status === "failed")
    || run.stages.find((stage) => stage.status === "terminated")
    || run.stages.find((stage) => stage.status === "pending")
    || run.stages[run.stages.length - 1]
    || null;
}

function renderRunPanel() {
  const run = state.activeRun;
  elements.runPill.className = `pill ${runPillClass(run?.status || "idle")}`;
  elements.runPill.textContent = run?.status || "Idle";

  replaceChildren(elements.runList);
  if (state.runs.length === 0) {
    const empty = document.createElement("div");
    empty.className = "workspace-empty";
    const text = document.createElement("p");
    text.textContent = "No runs yet.";
    empty.append(text);
    elements.runList.append(empty);
  } else {
    for (const entry of state.runs) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "run-card";
      card.addEventListener("click", async () => {
        state.activeRunId = entry.run_id;
        await refreshRunState();
      });

      const top = document.createElement("div");
      top.className = "run-top";
      const name = document.createElement("strong");
      name.textContent = entry.run_id;
      const pill = document.createElement("span");
      pill.className = `meta-pill ${statusClass(entry.status)}`;
      pill.textContent = entry.status;
      top.append(name, pill);

      const desc = document.createElement("p");
      const label = entry.scope === "block" && entry.block_title ? `${entry.block_title}: ` : "";
      desc.textContent = label + entry.stages.map((stage) => stage.command).join(" -> ");
      card.append(top, desc);
      elements.runList.append(card);
    }
  }

  const canRun = state.blocks.some((block) => block.enabled);
  const runnable = Boolean(run && ["running", "queued", "stopping", "terminating"].includes(run.status));
  const runIcon = elements.runButton.querySelector(".button-icon");
  const runText = elements.runButton.querySelector("span:last-child");
  if (runnable) {
    elements.runButton.classList.add("danger");
    elements.runButton.classList.remove("primary");
    if (runIcon) runIcon.textContent = "■";
    if (runText) runText.textContent = "Interrupt";
    elements.runButton.disabled = false;
  } else {
    elements.runButton.classList.add("primary");
    elements.runButton.classList.remove("danger");
    if (runIcon) runIcon.textContent = "▶";
    if (runText) runText.textContent = "Run All";
    elements.runButton.disabled = !canRun;
  }
}

function isRunnableRunStatus(status) {
  return ["queued", "running", "stopping", "terminating"].includes(status);
}

function isActiveRunForBlock(block) {
  return Boolean(
    state.transientRunningBlockId === block.id
    || (
      state.activeRun
      && state.activeRun.block_id === block.id
      && isRunnableRunStatus(state.activeRun.status)
    ),
  );
}

function hasActiveSingleBlockRun() {
  return Boolean(
    state.transientRunningBlockId
    || (
      state.activeRun
      && state.activeRun.scope === "block"
      && state.activeRun.block_id
      && isRunnableRunStatus(state.activeRun.status)
    ),
  );
}

function isPendingBlock(block) {
  return Boolean(
    hasActiveSingleBlockRun()
    && (
      state.transientRunningBlockId
        ? state.transientRunningBlockId !== block.id
        : state.activeRun.block_id !== block.id
    ),
  );
}

function syncRuntimeVisibilityFromRun() {
  const run = state.activeRun;
  if (!run) {
    return;
  }

  if (run.scope === "block") {
    const block = state.blocks.find((item) => item.id === run.block_id);
    if (block) {
      block.ui = block.ui || {};
      block.ui.showRuntime = true;
    }
    return;
  }

  const enabledBlocks = state.blocks.filter((item) => item.enabled);
  let lastVisibleStage = -1;
  run.stages.forEach((stage, index) => {
    if (stage.status && stage.status !== "pending") {
      lastVisibleStage = index;
    }
  });

  enabledBlocks.forEach((block, index) => {
    if (index <= lastVisibleStage) {
      block.ui = block.ui || {};
      block.ui.showRuntime = true;
    }
  });
}

function runtimeForBlock(block) {
  const run = state.activeRun;
  if (!run) {
    return null;
  }

  if (run.scope === "block") {
    if (run.block_id !== block.id) {
      return null;
    }
    return {
      runId: run.run_id,
      status: run.status,
      command: run.stages[0]?.command || TASK_COMMANDS[block.section],
      logs: run.logs || [],
      warnings: run.warnings || [],
      errors: run.errors || [],
    };
  }

  const enabledBlocks = state.blocks.filter((item) => item.enabled);
  const stageIndex = enabledBlocks.findIndex((item) => item.id === block.id);
  if (stageIndex === -1 || stageIndex >= run.stages.length) {
    return null;
  }

  const stage = run.stages[stageIndex];
  return {
    runId: run.run_id,
    status: stage.status || run.status,
    command: stage.command || TASK_COMMANDS[block.section],
    logs: stage.logs || [],
    warnings: stageIndex === 0 ? (run.warnings || []) : [],
    errors: stage.status === "failed" || stage.status === "terminated" ? (run.errors || []) : [],
  };
}

function renderBlockRuntime(block) {
  const runtime = runtimeForBlock(block);
  const panel = document.createElement("div");
  panel.className = "cell-runtime";

  const output = document.createElement("pre");
  output.className = "terminal-output cell-runtime-output";

  if (!runtime) {
    output.textContent = block.enabled
      ? "No runtime attached to this cell yet."
      : "This disabled cell has no runtime in the current run.";
  } else {
    const warnings = runtime.warnings?.length ? `\n[warnings]\n${runtime.warnings.join("\n")}` : "";
    const errors = runtime.errors?.length ? `\n[errors]\n${runtime.errors.join("\n\n")}` : "";
    output.textContent = (runtime.logs.join("\n") || "Waiting for stage output...") + warnings + errors;
  }

  panel.append(output);
  return panel;
}

function renderAll() {
  renderTopbar();
  renderTaskPalette();
  renderTemplates();
  renderSidebarView();
  renderAdvancedConfig();
  renderWorkspaceMessage();
  renderPipeline();
  renderInspector();
  renderRunPanel();
}

function addBlock(section) {
  insertBlock(section);
}

function saveCandidates() {
  const sectionCounts = new Map();
  for (const block of state.blocks) {
    sectionCounts.set(block.section, (sectionCounts.get(block.section) || 0) + 1);
  }

  const seenBySection = new Map();
  return state.blocks.map((block, index) => {
    const seen = seenBySection.get(block.section) || 0;
    seenBySection.set(block.section, seen + 1);
    return {
      blockId: block.id,
      section: block.section,
      title: state.catalog.tasks[block.section].title,
      index,
      duplicateIndex: seen + 1,
      duplicateCount: sectionCounts.get(block.section) || 1,
      enabled: block.enabled,
    };
  });
}

function setSaveModalMessage(message = "", tone = "muted") {
  elements.saveModalMessage.className = `modal-message ${tone} small`;
  elements.saveModalMessage.textContent = message;
}

function focusableNodes(container) {
  return Array.from(
    container.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((node) => {
    return !node.hidden && node.getAttribute("aria-hidden") !== "true";
  });
}

function setBackgroundInteractivity(disabled) {
  Array.from(document.body.children)
    .filter((node) => node instanceof HTMLElement && node !== elements.saveModal)
    .forEach((node) => {
      node.inert = disabled;
      if (disabled) {
        node.setAttribute("aria-hidden", "true");
      } else {
        node.removeAttribute("aria-hidden");
      }
    });
}

function trapSaveModalFocus(event) {
  const nodes = focusableNodes(elements.saveModal);
  if (nodes.length === 0) {
    event.preventDefault();
    elements.saveModal.focus();
    return;
  }

  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  const active = document.activeElement;

  if (event.shiftKey && (active === first || active === elements.saveModal)) {
    event.preventDefault();
    last.focus();
    return;
  }

  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

function setSaveModalOpen(isOpen) {
  if (isOpen) {
    state.saveModalRestoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    elements.saveModal.hidden = false;
    elements.saveModal.tabIndex = -1;
    setBackgroundInteractivity(true);
    window.requestAnimationFrame(() => {
      const target = focusableNodes(elements.saveModal)[0] || elements.saveModal;
      target.focus();
    });
    return;
  }

  elements.saveModal.hidden = true;
  setBackgroundInteractivity(false);
  setSaveModalMessage("");
  const restoreTarget = state.saveModalRestoreFocus;
  state.saveModalRestoreFocus = null;
  restoreTarget?.focus();
}

function openSaveModal() {
  const candidates = saveCandidates();
  if (candidates.length === 0) {
    setTerminalMessage("[workbench] Add at least one cell before exporting a config.");
    return;
  }

  replaceChildren(elements.saveSectionList);
  const seenCheckedSections = new Set();
  for (const candidate of candidates) {
    const label = document.createElement("label");
    label.className = "save-section-option";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = candidate.blockId;
    checkbox.dataset.section = candidate.section;
    const shouldCheck = !seenCheckedSections.has(candidate.section);
    checkbox.checked = shouldCheck;
    if (shouldCheck) {
      seenCheckedSections.add(candidate.section);
    }
    checkbox.addEventListener("change", () => {
      if (!checkbox.checked) {
        return;
      }
      elements.saveSectionList
        .querySelectorAll(`input[type="checkbox"][data-section="${candidate.section}"]`)
        .forEach((peer) => {
          if (peer !== checkbox) {
            peer.checked = false;
          }
        });
    });

    const copy = document.createElement("div");
    copy.className = "save-section-copy";

    const title = document.createElement("div");
    title.className = "save-section-title";
    title.textContent = candidate.title;

    const titleRow = document.createElement("div");
    titleRow.className = "save-section-title-row";

    const indexBadge = document.createElement("span");
    indexBadge.className = "save-section-index";
    indexBadge.textContent = `${candidate.index + 1}`;

    const meta = document.createElement("div");
    meta.className = "save-section-meta";
    const cellLabel = `Cell ${candidate.index + 1}`;
    if (candidate.duplicateCount > 1) {
      meta.textContent = `${cellLabel} · ${candidate.duplicateIndex}/${candidate.duplicateCount} for this task`;
    } else {
      meta.textContent = `${cellLabel} · ${candidate.enabled ? "enabled" : "disabled"}`;
    }

    titleRow.append(indexBadge, title);
    copy.append(titleRow, meta);
    label.append(checkbox, copy);
    elements.saveSectionList.append(label);
  }

  elements.saveModalCount.textContent = `${candidates.length} pipeline cell${candidates.length === 1 ? "" : "s"}`;
  elements.saveFilename.value = elements.saveFilename.value?.trim() || "config.yaml";
  if (!elements.saveOutputDir.value.trim()) {
    elements.saveOutputDir.value = state.catalog.environment.cwd;
  }
  setSaveModalMessage("");
  setSaveModalOpen(true);
}

function closeSaveModal() {
  setSaveModalOpen(false);
}

async function saveConfigFile() {
  const selectedBlockIds = Array.from(
    elements.saveSectionList.querySelectorAll('input[type="checkbox"]:checked'),
  ).map((input) => input.value);

  if (selectedBlockIds.length === 0) {
    setSaveModalMessage("Select at least one task cell to save.", "warning");
    return;
  }

  const outputDir = elements.saveOutputDir.value.trim();
  const filename = elements.saveFilename.value.trim() || "config.yaml";
  if (!outputDir) {
    setSaveModalMessage("Enter an output directory.", "warning");
    return;
  }

  elements.saveConfirmButton.disabled = true;
  setSaveModalMessage("Exporting config...", "success");
  try {
    const payload = await request("/api/export-config", {
      method: "POST",
      body: JSON.stringify({
        ...pipelinePayload(),
        selected_block_ids: selectedBlockIds,
        output_dir: outputDir,
        filename,
      }),
    });
    const warningText = payload.warnings?.length ? `\n${payload.warnings.join("\n")}` : "";
    setTerminalMessage(`[workbench] Exported config to ${payload.path}.${warningText}`);
    closeSaveModal();
  } catch (error) {
    setSaveModalMessage(error.message, "error");
  } finally {
    elements.saveConfirmButton.disabled = false;
  }
}

async function loadConfigFile(file) {
  if (!file) {
    setTerminalMessage("[workbench] Choose a config.yaml file first.");
    return;
  }

  try {
    setTerminalMessage(`[workbench] Loading ${file.name}...`);
    const content = await file.text();
    const payload = await request("/api/import-config", {
      method: "POST",
      body: JSON.stringify({
        content,
        filename: file.name,
      }),
    });

    state.blocks = (payload.blocks || []).map((block) => ({
      ...block,
      enabled: block.enabled !== false,
      ui: {
        multiTarget: Boolean(block.ui?.multiTarget),
        autoCreateSlideTable: Boolean(block.ui?.autoCreateSlideTable),
      },
    }));
    state.selectedBlockId = state.blocks[0]?.id || null;
    state.advancedConfig = mergeDeep(
      state.catalog.advanced_defaults,
      payload.advanced_config || {},
    );
    state.validation = null;
    renderAll();

    const warningText = payload.warnings?.length ? `\n${payload.warnings.join("\n")}` : "";
    setTerminalMessage(
      `[workbench] Loaded ${payload.source}. Imported ${state.blocks.length} pipeline cell(s).${warningText}`,
    );
  } catch (error) {
    setTerminalMessage(`[workbench] Failed to load config.\n${error.message}`);
  }
}

function openConfigPicker() {
  elements.configFileInput.value = "";
  elements.configFileInput.click();
}

function applyTemplate(template) {
  state.blocks = template.sections.map((section) => makeBlock(section));
  state.selectedBlockId = state.blocks[0]?.id || null;
  state.validation = null;
  renderAll();
}

function moveBlock(fromIndex, toIndex) {
  if (toIndex < 0 || toIndex >= state.blocks.length) {
    return;
  }
  const [block] = state.blocks.splice(fromIndex, 1);
  state.blocks.splice(toIndex, 0, block);
  renderAll();
}

function reorderBlock(blockId, toIndex) {
  const fromIndex = state.blocks.findIndex((block) => block.id === blockId);
  if (fromIndex === -1) {
    return;
  }
  const [block] = state.blocks.splice(fromIndex, 1);
  const adjustedIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
  const safeIndex = Math.max(0, Math.min(adjustedIndex, state.blocks.length));
  state.blocks.splice(safeIndex, 0, block);
  state.selectedBlockId = block.id;
  renderAll();
}

function removeBlock(blockId) {
  state.blocks = state.blocks.filter((block) => block.id !== blockId);
  if (state.selectedBlockId === blockId) {
    state.selectedBlockId = state.blocks[0]?.id || null;
  }
  renderAll();
}

function clearDropTargets() {
  document.querySelectorAll(".drop-slot.active, .notebook-canvas.drop-active, .cell-card.dragging, .cell-card.drop-before, .cell-card.drop-after").forEach((node) => {
    node.classList.remove("active");
    node.classList.remove("drop-active");
    node.classList.remove("dragging");
    node.classList.remove("drop-before");
    node.classList.remove("drop-after");
  });
}

function dragPayloadFromEvent(event) {
  const fromTransfer = event.dataTransfer?.getData("text/plain");
  if (fromTransfer?.startsWith("task:")) {
    return { kind: "task", value: fromTransfer.slice(5) };
  }
  if (fromTransfer?.startsWith("block:")) {
    return { kind: "block", value: fromTransfer.slice(6) };
  }
  if (state.draggedBlockId) {
    return { kind: "block", value: state.draggedBlockId };
  }
  if (state.draggedTaskSection) {
    return { kind: "task", value: state.draggedTaskSection };
  }
  return null;
}

function applyDropPayload(payload, index) {
  if (!payload) {
    return;
  }
  clearDropTargets();
  if (payload.kind === "block") {
    const blockId = payload.value;
    state.draggedBlockId = null;
    reorderBlock(blockId, index);
    return;
  }
  state.draggedTaskSection = null;
  insertBlock(payload.value, index);
}

function cardDropIndex(card, index, event) {
  const rect = card.getBoundingClientRect();
  const insertBefore = event.clientY < rect.top + (rect.height / 2);
  return {
    index: insertBefore ? index : index + 1,
    position: insertBefore ? "before" : "after",
  };
}

function createDropSlot(index, isEmpty = false) {
  const slot = document.createElement("div");
  slot.className = `drop-slot ${isEmpty ? "empty-drop" : ""}`;
  slot.innerHTML = isEmpty
    ? "<div class=\"empty-drop-copy\"><h3>Start Building</h3><p>Drag a task from the left library into this workspace, or click a task to create the first cell.</p></div>"
    : "";

  slot.addEventListener("dragenter", (event) => {
    const payload = dragPayloadFromEvent(event);
    if (!payload) {
      return;
    }
    event.preventDefault();
    slot.classList.add("active");
    elements.pipelineCanvas.classList.add("drop-active");
  });

  slot.addEventListener("dragover", (event) => {
    const payload = dragPayloadFromEvent(event);
    if (!payload) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = payload.kind === "block" ? "move" : "copy";
    }
    slot.classList.add("active");
    elements.pipelineCanvas.classList.add("drop-active");
  });

  slot.addEventListener("dragleave", (event) => {
    if (event.relatedTarget && slot.contains(event.relatedTarget)) {
      return;
    }
    slot.classList.remove("active");
    if (!elements.pipelineCanvas.querySelector(".drop-slot.active")) {
      elements.pipelineCanvas.classList.remove("drop-active");
    }
  });

  slot.addEventListener("drop", (event) => {
    const payload = dragPayloadFromEvent(event);
    if (!payload) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    applyDropPayload(payload, index);
  });

  return slot;
}

async function runPipeline() {
  const { errors, firstInvalidBlockId } = collectMissingInputErrors(
    state.blocks.filter((block) => block.enabled),
  );
  if (errors.length) {
    showMissingInputAlert(errors, firstInvalidBlockId);
    return;
  }
  state.validation = null;
  setTerminalMessage("[workbench] Creating run...");
  try {
    const run = await request("/api/runs", {
      method: "POST",
      body: JSON.stringify(pipelinePayload()),
    });
    state.activeRunId = run.run_id;
    state.blocks.forEach((block) => {
      if (block.enabled) {
        block.ui = block.ui || {};
        block.ui.showRuntime = true;
      }
    });
    setTerminalMessage(`[workbench] Run ${run.run_id} created. Waiting for stage output...`);
    await refreshRunState();
  } catch (error) {
    state.validation = {
      valid: false,
      errors: [error.message],
      warnings: [],
      config_preview: state.validation?.config_preview || "",
    };
    setTerminalMessage(`[workbench] Failed to create run.\n${state.validation.errors.join("\n")}`);
  }
}

async function runSingleBlock(block) {
  const task = state.catalog.tasks[block.section];

  if (isActiveRunForBlock(block)) {
    state.transientRunningBlockId = block.id;
    renderPipeline();
    setTerminalMessage(`[workbench] Terminating ${task.title} cell...`);
    try {
      await request(`/api/runs/${state.activeRun.run_id}/terminate`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      state.transientRunningBlockId = null;
      await refreshRunState();
    } catch (error) {
      state.transientRunningBlockId = null;
      renderPipeline();
      setTerminalMessage(`[workbench] Failed to terminate ${task.title} cell.\n${error.message}`);
    }
    return;
  }

  const blockCheck = collectMissingInputErrors([block]);
  if (blockCheck.errors.length) {
    showMissingInputAlert(blockCheck.errors, block.id);
    return;
  }

  state.validation = null;
  state.transientRunningBlockId = block.id;
  block.ui = block.ui || {};
  block.ui.showRuntime = true;
  renderPipeline();
  setTerminalMessage(`[workbench] Starting ${task.title} cell...`);
  try {
    const run = await request("/api/runs", {
      method: "POST",
      body: JSON.stringify({
        blocks: [{
          id: block.id,
          section: block.section,
          enabled: true,
          params: block.params,
        }],
        advanced_config: state.advancedConfig,
        scope: "block",
        block_id: block.id,
        block_title: task.title,
      }),
    });
    state.activeRunId = run.run_id;
    setTerminalMessage(`[workbench] ${task.title} cell started. Waiting for stage output...`);
    await refreshRunState();
  } catch (error) {
    state.transientRunningBlockId = null;
    renderPipeline();
    setTerminalMessage(`[workbench] Failed to run ${task.title} cell.\n${error.message}`);
  }
}

async function startRun() {
  if (state.activeRun && state.activeRun.status === "stopped") {
    setTerminalMessage(`[workbench] Restarting run ${state.activeRun.run_id}...`);
    try {
      await request(`/api/runs/${state.activeRun.run_id}/start`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await refreshRunState();
      return;
    } catch (error) {
      state.validation = {
        valid: false,
        errors: [error.message],
        warnings: [],
        config_preview: state.validation?.config_preview || "",
      };
      setTerminalMessage(`[workbench] Failed to restart run.\n${state.validation.errors.join("\n")}`);
      return;
    }
  }
  setTerminalMessage("[workbench] Starting a new run...");
  await runPipeline();
}

async function stopRun() {
  if (!state.activeRunId) {
    return;
  }
  try {
    await request(`/api/runs/${state.activeRunId}/stop`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    await refreshRunState();
  } catch (error) {
    state.validation = { valid: false, errors: [error.message], warnings: [], config_preview: "" };
    setTerminalMessage(`[workbench] Failed to stop run.\n${state.validation.errors.join("\n")}`);
  }
}

async function terminateRun() {
  if (!state.activeRunId) {
    return;
  }
  try {
    await request(`/api/runs/${state.activeRunId}/terminate`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    await refreshRunState();
  } catch (error) {
    state.validation = { valid: false, errors: [error.message], warnings: [], config_preview: "" };
    setTerminalMessage(`[workbench] Failed to terminate run.\n${state.validation.errors.join("\n")}`);
  }
}

async function handleRunAllButton() {
  if (state.activeRun && ["running", "queued", "stopping", "terminating"].includes(state.activeRun.status)) {
    await terminateRun();
    return;
  }
  await startRun();
}

function queueRunRefresh(task) {
  const previous = state.runRefreshLock || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  state.runRefreshLock = next;
  return next;
}

async function refreshRunState() {
  return queueRunRefresh(async () => {
    const payload = await request("/api/runs");
    const runs = payload.runs || [];
    const activeRunning = runs.find((run) => isRunnableRunStatus(run.status));
    let nextActiveRunId = state.activeRunId;
    if (!nextActiveRunId) {
      nextActiveRunId = activeRunning?.run_id || null;
    } else if (!runs.some((run) => run.run_id === nextActiveRunId)) {
      nextActiveRunId = activeRunning?.run_id || null;
    }

    let nextActiveRun = null;
    if (nextActiveRunId) {
      try {
        nextActiveRun = await request(`/api/runs/${nextActiveRunId}`);
      } catch (_error) {
        nextActiveRun = null;
      }
    }

    state.runs = runs;
    state.activeRunId = nextActiveRunId;
    state.activeRun = nextActiveRun;
    syncRuntimeVisibilityFromRun();
    if (!state.activeRun || !isRunnableRunStatus(state.activeRun.status)) {
      state.transientRunningBlockId = null;
    }
    renderRunPanel();
    renderPipeline();
  });
}

function startPolling() {
  if (state.pollingHandle) {
    window.clearTimeout(state.pollingHandle);
  }
  state.pollingEnabled = true;

  const poll = async () => {
    state.pollingHandle = null;
    try {
      await refreshRunState();
    } catch (_error) {
      // Keep the current UI state if polling fails.
    } finally {
      if (state.pollingEnabled) {
        state.pollingHandle = window.setTimeout(poll, 1500);
      }
    }
  };

  state.pollingHandle = window.setTimeout(poll, 1500);
}

function stopPolling() {
  state.pollingEnabled = false;
  if (state.pollingHandle) {
    window.clearTimeout(state.pollingHandle);
    state.pollingHandle = null;
  }
}

function wireEvents() {
  elements.saveButton.addEventListener("click", () => openSaveModal());
  elements.reviewButton.addEventListener("click", () => reviewPipelineInputs());
  elements.saveModalClose.addEventListener("click", () => closeSaveModal());
  elements.saveCancelButton.addEventListener("click", () => closeSaveModal());
  elements.saveConfirmButton.addEventListener("click", () => saveConfigFile());
  elements.saveModal.addEventListener("click", (event) => {
    if (event.target instanceof HTMLElement && event.target.dataset.closeSaveModal === "true") {
      closeSaveModal();
    }
  });
  window.addEventListener("keydown", (event) => {
    if (!elements.saveModal.hidden) {
      if (event.key === "Escape") {
        closeSaveModal();
        return;
      }
      if (event.key === "Tab") {
        trapSaveModalFocus(event);
      }
    }
  });
  elements.configDropzone.addEventListener("click", (event) => {
    if (event.target.closest("button")) {
      return;
    }
    openConfigPicker();
  });
  elements.configDropzone.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    openConfigPicker();
  });
  elements.loadConfigButton.addEventListener("click", (event) => {
    event.stopPropagation();
    openConfigPicker();
  });
  elements.configFileInput.addEventListener("change", () => {
    const file = elements.configFileInput.files?.[0];
    if (file) {
      loadConfigFile(file).finally(() => {
        elements.configFileInput.value = "";
      });
    }
  });
  elements.configDropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    elements.configDropzone.classList.add("is-dragover");
  });
  elements.configDropzone.addEventListener("dragleave", (event) => {
    if (event.relatedTarget && elements.configDropzone.contains(event.relatedTarget)) {
      return;
    }
    elements.configDropzone.classList.remove("is-dragover");
  });
  elements.configDropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    elements.configDropzone.classList.remove("is-dragover");
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      loadConfigFile(file);
    }
  });
  elements.clearButton.addEventListener("click", () => {
    clearTerminalMessageTimer();
    state.blocks = [];
    state.selectedBlockId = null;
    state.validation = null;
    state.terminalMessage = "No run selected.";
    renderAll();
  });
  elements.runButton.addEventListener("click", () => handleRunAllButton());
  elements.themeToggle.addEventListener("click", () => toggleTheme());
  elements.sidebarViewButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.sidebarView = button.dataset.sidebarView || "library";
      renderSidebarView();
    });
  });
}

async function bootstrap() {
  const payload = await request("/api/bootstrap");
  state.catalog = payload;
  state.blocks = [];
  state.advancedConfig = deepClone(payload.advanced_defaults);
  state.runs = payload.runs || [];
  state.activeRunId = state.runs.find((run) => isRunnableRunStatus(run.status))?.run_id || null;
  if (!state.activeRunId) {
    state.terminalMessage = "No run selected.";
  }
  applyStoredLayout();
  renderAll();
  if (state.activeRunId) {
    await refreshRunState();
  }
  startPolling();
}

function init() {
  initTheme();
  wireEvents();
  initResizer(elements.resizerLeftMain, "left");
  initResizer(elements.resizerMainRight, "right");
  bootstrap().catch((error) => {
    replaceChildren(
      elements.pipelineCanvas,
      createMessageCard(`Failed to load workbench: ${error.message}`, "error"),
    );
  });
}

window.addEventListener("beforeunload", stopPolling);
window.addEventListener("DOMContentLoaded", init);
