import {
  COLORS,
  COLOR_NAMES,
  getSettings,
  updateSettings,
  normalizeDomain,
  getHost,
  organizeWindow,
  getClosedGroups,
  removeClosedGroup,
  reopenClosedGroup,
} from "./lib.js";

const content = document.getElementById("content");
const title = document.getElementById("title");
const backBtn = document.getElementById("back");
const copyAllBtn = document.getElementById("copy-all");
const settingsBtn = document.getElementById("settings");

const MAX_RULES = 30;
let currentTabs = [];

// Build DOM with textContent only (tab titles/URLs/rule names are untrusted data).
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function flash(button, label, ok, original) {
  button.textContent = ok ? label : "Failed";
  setTimeout(() => (button.textContent = original), 1200);
}

function setHeader({ text, back = false, copyAll = false, gear = false }) {
  title.textContent = text;
  backBtn.hidden = !back;
  copyAllBtn.hidden = !copyAll;
  settingsBtn.hidden = !gear;
}

/* ---------------- groups list ---------------- */

async function showGroups() {
  setHeader({ text: "Tab Groups", gear: true });
  content.replaceChildren();

  const settings = await getSettings();
  if (!settings.enabled && !settings.bannerDismissed) content.append(buildBanner());

  const groups = await chrome.tabGroups.query({});
  const closed = await getClosedGroups();
  if (groups.length === 0) {
    content.append(el("p", "empty", "No tab groups found."));
  }

  for (const group of groups) {
    const tabs = await chrome.tabs.query({ groupId: group.id });
    const row = el("button", "row");
    row.type = "button";

    const dot = el("span", "dot");
    dot.style.background = COLORS[group.color] || COLORS.grey;

    row.append(
      dot,
      el("span", "name", group.title || "Untitled group"),
      el("span", "count", `${tabs.length} ${tabs.length === 1 ? "tab" : "tabs"}`)
    );
    row.addEventListener("click", () => showTabs(group));
    content.append(row);
  }

  if (closed.length > 0) {
    content.append(el("h2", "section-title closed-title", "Recently closed"));
    for (const entry of closed) content.append(buildClosedRow(entry));
  }
}

function timeAgo(ms) {
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

function buildClosedRow(entry) {
  const label = entry.title || "Untitled group";
  const row = el("div", "rule");
  const dot = el("span", "dot");
  dot.style.background = COLORS[entry.color] || COLORS.grey;

  const info = el("div", "tab-info");
  info.append(
    el("div", "tab-title", label),
    el("div", "tab-url", `${entry.tabs.length} ${entry.tabs.length === 1 ? "tab" : "tabs"} · ${timeAgo(entry.id)}`)
  );

  const reopen = el("button", "btn small primary", "Reopen");
  reopen.type = "button";
  reopen.setAttribute("aria-label", `Reopen group ${label}`);
  reopen.addEventListener("click", async () => {
    reopen.disabled = true;
    try {
      const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
      await reopenClosedGroup(entry, win.id);
      showGroups();
    } catch {
      reopen.disabled = false;
      reopen.textContent = "Failed";
    }
  });

  const dismiss = el("button", "icon-btn", "✕");
  dismiss.type = "button";
  dismiss.setAttribute("aria-label", `Forget closed group ${label}`);
  dismiss.addEventListener("click", async () => {
    await removeClosedGroup(entry.id);
    showGroups();
  });

  row.append(dot, info, reopen, dismiss);
  return row;
}

function buildBanner() {
  const banner = el("div", "banner");
  banner.append(el("p", "banner-text", "Auto-group tabs by domain?"));
  const actions = el("div", "banner-actions");

  const on = el("button", "btn primary", "Turn on");
  on.type = "button";
  on.addEventListener("click", async () => {
    await updateSettings({ enabled: true, bannerDismissed: true });
    showGroups();
  });

  const no = el("button", "btn", "No thanks");
  no.type = "button";
  no.addEventListener("click", async () => {
    await updateSettings({ bannerDismissed: true });
    banner.remove();
  });

  actions.append(on, no);
  banner.append(actions);
  return banner;
}

/* ---------------- tabs of one group ---------------- */

async function showTabs(group) {
  setHeader({ text: group.title || "Untitled group", back: true, copyAll: true });
  content.replaceChildren();

  currentTabs = await chrome.tabs.query({ groupId: group.id });
  if (currentTabs.length === 0) {
    content.append(el("p", "empty", "This group has no tabs."));
    copyAllBtn.hidden = true;
    return;
  }

  const otherGroups = (await chrome.tabGroups.query({})).filter((g) => g.id !== group.id);

  for (const tab of currentTabs) {
    const url = tab.url || "";
    const item = el("div", "tab");
    const info = el("div", "tab-info");
    const tabTitle = el("div", "tab-title", tab.title || url);
    tabTitle.title = tab.title || url;
    const tabUrl = el("div", "tab-url", url);
    tabUrl.title = url;
    info.append(tabTitle, tabUrl);

    const copyBtn = el("button", "icon-btn", "⧉");
    copyBtn.type = "button";
    copyBtn.setAttribute("aria-label", `Copy link: ${tab.title || url}`);
    copyBtn.addEventListener("click", async () => {
      flash(copyBtn, "✓", await copyText(url), "⧉");
    });

    item.append(info, buildMoveSelect(tab, group, otherGroups), copyBtn);
    content.append(item);
  }
}

// Native <select>: keyboard and screen-reader friendly, no custom menu needed.
function buildMoveSelect(tab, group, otherGroups) {
  const select = el("select", "input move-select");
  select.setAttribute("aria-label", `Move ${tab.title || tab.url || "tab"} to another group`);

  const placeholder = el("option", "", "Move to…");
  placeholder.value = "";
  select.append(placeholder);
  for (const g of otherGroups) {
    const opt = el("option", "", g.title || "Untitled group");
    opt.value = String(g.id);
    select.append(opt);
  }
  const ungroup = el("option", "", "No group");
  ungroup.value = "none";
  select.append(ungroup);

  select.addEventListener("change", async () => {
    if (!select.value) return;
    try {
      if (select.value === "none") await chrome.tabs.ungroup(tab.id);
      else await chrome.tabs.group({ groupId: Number(select.value), tabIds: [tab.id] });
    } catch {
      select.value = "";
      return;
    }
    // The source group disappears when its last tab leaves.
    try {
      showTabs(await chrome.tabGroups.get(group.id));
    } catch {
      showGroups();
    }
  });
  return select;
}

copyAllBtn.addEventListener("click", async () => {
  const text = currentTabs.map((t) => t.url).filter(Boolean).join("\n");
  flash(copyAllBtn, "Copied ✓", await copyText(text), "Copy all");
});

/* ---------------- settings ---------------- */

// editing: null (just the list), "new" (add form) or a rule index (edit form)
async function showSettings(editing = null) {
  setHeader({ text: "Settings", back: true });
  content.replaceChildren();
  const settings = await getSettings();
  const wrap = el("div", "settings");

  // Master toggle
  const toggleRow = el("label", "field-row");
  const toggle = el("input");
  toggle.type = "checkbox";
  toggle.checked = settings.enabled;
  toggle.addEventListener("change", () => updateSettings({ enabled: toggle.checked }));
  toggleRow.append(el("span", "field-label", "Auto-group by domain"), toggle);

  // Threshold
  const thresholdRow = el("label", "field-row");
  const select = el("select", "input");
  for (let n = 2; n <= 10; n++) {
    const opt = el("option", "", `${n} tabs`);
    opt.value = String(n);
    opt.selected = n === settings.threshold;
    select.append(opt);
  }
  select.addEventListener("change", () => updateSettings({ threshold: Number(select.value) }));
  thresholdRow.append(el("span", "field-label", "Group when I have"), select);

  wrap.append(
    toggleRow,
    thresholdRow,
    el(
      "p",
      "hint",
      "Tabs from the same site are grouped once you have this many ungrouped ones. Custom rules below always apply, even when this is off. Tabs you ungroup by hand are left alone."
    )
  );

  // Custom rules
  wrap.append(el("h2", "section-title", "Custom rules"));
  if (settings.rules.length === 0 && editing === null) {
    wrap.append(el("p", "hint", "No rules yet. Example: github.com, gitlab.com → Dev."));
  }

  settings.rules.forEach((rule, index) => {
    if (editing === index) return;
    wrap.append(buildRuleRow(rule, index, settings));
  });

  if (editing !== null) {
    wrap.append(buildRuleForm(editing === "new" ? null : settings.rules[editing], editing, settings));
  } else if (settings.rules.length < MAX_RULES) {
    const add = el("button", "btn", "+ Add rule");
    add.type = "button";
    add.addEventListener("click", () => showSettings("new"));
    wrap.append(add);
  }

  // Group now
  wrap.append(el("h2", "section-title", "Open tabs"));
  const status = el("p", "hint");
  status.setAttribute("role", "status");
  const now = el("button", "btn", "Group my open tabs now");
  now.type = "button";
  now.addEventListener("click", async () => {
    now.disabled = true;
    try {
      const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
      let moved = 0;
      for (const w of windows) {
        moved += await organizeWindow(w.id, { respectIgnored: false, includeDomains: true });
      }
      status.textContent = moved > 0 ? `Grouped ${moved} ${moved === 1 ? "tab" : "tabs"}.` : "Nothing to group.";
    } catch {
      status.textContent = "Could not group tabs.";
    }
    now.disabled = false;
  });
  wrap.append(now, status);

  content.append(wrap);
}

function buildRuleRow(rule, index, settings) {
  const row = el("div", "rule");
  const dot = el("span", "dot");
  dot.style.background = COLORS[rule.color] || COLORS.grey;

  const info = el("div", "tab-info");
  info.append(el("div", "tab-title", rule.name), el("div", "tab-url", rule.domains.join(", ")));

  const edit = el("button", "btn small", "Edit");
  edit.type = "button";
  edit.setAttribute("aria-label", `Edit rule ${rule.name}`);
  edit.addEventListener("click", () => showSettings(index));

  const del = el("button", "btn small", "Delete");
  del.type = "button";
  del.setAttribute("aria-label", `Delete rule ${rule.name}`);
  del.addEventListener("click", async () => {
    await updateSettings({ rules: settings.rules.filter((_, i) => i !== index) });
    showSettings();
  });

  row.append(dot, info, edit, del);
  return row;
}

function buildRuleForm(rule, editing, settings) {
  const form = el("form", "rule-form");
  form.noValidate = true;
  let color = rule ? rule.color : "blue";

  const domainsLabel = el("label", "stack");
  domainsLabel.append(el("span", "field-label", "Domains (comma separated)"));
  const domains = el("input", "input");
  domains.type = "text";
  domains.name = "domains";
  domains.autocomplete = "off";
  domains.spellcheck = false;
  domains.placeholder = "github.com, gitlab.com…";
  domains.value = rule ? rule.domains.join(", ") : "";
  domainsLabel.append(domains);

  // Live preview of what the rule will actually match (paths are dropped).
  const preview = el("p", "hint");
  preview.setAttribute("role", "status");
  const updatePreview = () => {
    const tokens = domains.value.split(/[\s,]+/).filter(Boolean);
    if (tokens.length === 0) return (preview.textContent = "");
    const bad = tokens.find((t) => !normalizeDomain(t));
    if (bad) return (preview.textContent = `"${bad}" isn't a valid domain.`);
    const list = [...new Set(tokens.map(normalizeDomain))];
    const droppedPath = tokens.some((t) => /^[a-z][a-z0-9+.-]*:\/\/|[/?#]/i.test(t));
    preview.textContent =
      `Matches every page on: ${list.join(", ")} (and subdomains).` + (droppedPath ? " Paths are ignored." : "");
  };
  domains.addEventListener("input", updatePreview);

  const useCurrent = el("button", "btn small", "Use current tab");
  useCurrent.type = "button";
  useCurrent.addEventListener("click", async () => {
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const host = getHost(active?.url || "");
    if (!host) {
      error.textContent = "The current tab isn't a regular website.";
      return;
    }
    error.textContent = "";
    const existing = domains.value.split(/[\s,]+/).filter(Boolean).map(normalizeDomain);
    if (!existing.includes(host)) domains.value = [...domains.value.split(/[\s,]+/).filter(Boolean), host].join(", ");
    updatePreview();
    domains.focus();
  });
  domainsLabel.append(preview);

  const nameLabel = el("label", "stack");
  nameLabel.append(el("span", "field-label", "Group name"));
  const name = el("input", "input");
  name.type = "text";
  name.name = "name";
  name.autocomplete = "off";
  name.maxLength = 40;
  name.placeholder = "Dev…";
  name.value = rule ? rule.name : "";
  nameLabel.append(name);

  const swatches = el("div", "swatches");
  swatches.setAttribute("role", "group");
  swatches.setAttribute("aria-label", "Group color");
  const buttons = COLOR_NAMES.map((c) => {
    const b = el("button", "swatch");
    b.type = "button";
    b.style.background = COLORS[c];
    b.setAttribute("aria-label", c);
    b.setAttribute("aria-pressed", String(c === color));
    b.addEventListener("click", () => {
      color = c;
      buttons.forEach((x, i) => x.setAttribute("aria-pressed", String(COLOR_NAMES[i] === c)));
    });
    return b;
  });
  swatches.append(...buttons);

  const error = el("p", "error");
  error.setAttribute("role", "alert");

  const actions = el("div", "banner-actions");
  const save = el("button", "btn primary", "Save rule");
  save.type = "submit";
  const cancel = el("button", "btn", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => showSettings());
  actions.append(save, cancel);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const tokens = domains.value.split(/[\s,]+/).filter(Boolean);
    const normalized = tokens.map(normalizeDomain);
    const groupName = name.value.trim();

    if (tokens.length === 0) return (error.textContent = "Add at least one domain."), domains.focus();
    if (normalized.some((d) => !d)) {
      error.textContent = `"${tokens[normalized.indexOf("")]}" isn't a valid domain.`;
      return domains.focus();
    }
    if (!groupName) return (error.textContent = "Give the group a name."), name.focus();

    const next = { name: groupName, color, domains: [...new Set(normalized)] };
    const rules = [...settings.rules];
    if (editing === "new") rules.push(next);
    else rules[editing] = next;
    await updateSettings({ rules });
    showSettings();
  });

  form.append(domainsLabel, useCurrent, nameLabel, swatches, error, actions);
  updatePreview();
  queueMicrotask(() => domains.focus());
  return form;
}

backBtn.addEventListener("click", showGroups);
settingsBtn.addEventListener("click", () => showSettings());

showGroups();
