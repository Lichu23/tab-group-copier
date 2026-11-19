import {
  COLORS,
  COLOR_NAMES,
  getSettings,
  updateSettings,
  normalizeDomain,
  getHost,
  parseLinks,
  addLinksToGroup,
  createGroupWithLinks,
  MAX_LINKS,
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

// Put already-open tabs that match the rules into their groups (explicit user action).
async function applyRules() {
  try {
    const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
    for (const w of windows) await organizeWindow(w.id, { respectIgnored: false });
  } catch {
    /* best effort */
  }
}

function setDot(dot, color, hollow = false) {
  const value = COLORS[color] || COLORS.grey;
  if (hollow) {
    dot.classList.add("hollow");
    dot.style.borderColor = value;
  } else {
    dot.style.background = value;
  }
}

/* ---------------- main view: everything at a glance ---------------- */

async function showGroups() {
  setHeader({ text: "Tab Groups", gear: true });
  content.replaceChildren();

  const settings = await getSettings();
  const [groups, closed] = await Promise.all([chrome.tabGroups.query({}), getClosedGroups()]);
  const counts = await Promise.all(groups.map((g) => chrome.tabs.query({ groupId: g.id })));

  if (!settings.enabled && !settings.bannerDismissed) content.append(buildBanner());

  const toolbar = el("div", "toolbar");
  const newBtn = el("button", "btn full", "+ New group");
  newBtn.type = "button";
  newBtn.addEventListener("click", () => showEditor(null));
  toolbar.append(newBtn);
  content.append(toolbar);

  const openTitles = new Set(groups.map((g) => g.title));
  const dormant = settings.rules.filter((r) => !openTitles.has(r.name));

  if (groups.length === 0 && dormant.length === 0) {
    const empty = el("div", "empty");
    empty.append(el("p", "empty-text", "No tab groups found."));
    const open = el("button", "btn", "Open settings");
    open.type = "button";
    open.addEventListener("click", () => showSettings());
    empty.append(open);
    content.append(empty);
  }

  groups.forEach((group, i) => {
    const rule = settings.rules.find((r) => r.name === group.title);
    const n = counts[i].length;
    content.append(
      buildGroupRow({
        name: group.title || "Untitled group",
        color: group.color,
        rule,
        meta: `${n} ${n === 1 ? "tab" : "tabs"}`,
        onClick: () => showGroup(group.id),
      })
    );
  });

  // Rules whose group isn't open right now stay visible so they can still be edited.
  for (const rule of dormant) {
    content.append(
      buildGroupRow({
        name: rule.name,
        color: rule.color,
        rule,
        meta: "not open",
        hollow: true,
        onClick: () => showEditor(rule.name),
      })
    );
  }

  if (closed.length > 0) {
    content.append(el("h2", "section-title list-title", "Recently closed"));
    for (const entry of closed) content.append(buildClosedRow(entry));
  }
}

function ruleSummary(rule) {
  const extra = rule.domains.length - 1;
  return `⚡ ${rule.domains[0]}${extra > 0 ? ` +${extra}` : ""}`;
}

function buildGroupRow({ name, color, rule, meta, hollow = false, onClick }) {
  const row = el("button", "row");
  row.type = "button";

  const dot = el("span", "dot");
  setDot(dot, color, hollow);

  const info = el("div", "tab-info");
  info.append(el("div", "tab-title", name));
  if (rule && rule.domains.length > 0) info.append(el("div", "tab-url", ruleSummary(rule)));

  row.append(dot, info, el("span", "count", meta), el("span", "chev", "›"));
  row.addEventListener("click", onClick);
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
  setDot(dot, entry.color);

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

/* ---------------- shared form pieces ---------------- */

function buildSwatches(initial, onPick) {
  const box = el("div", "swatches");
  box.setAttribute("role", "group");
  box.setAttribute("aria-label", "Group color");
  const buttons = COLOR_NAMES.map((c) => {
    const b = el("button", "swatch");
    b.type = "button";
    b.style.background = COLORS[c];
    b.setAttribute("aria-label", c);
    b.setAttribute("aria-pressed", String(c === initial));
    b.addEventListener("click", () => {
      buttons.forEach((x, i) => x.setAttribute("aria-pressed", String(COLOR_NAMES[i] === c)));
      onPick(c);
    });
    return b;
  });
  box.append(...buttons);
  return box;
}

// Chip list of sites + an input to add more.
// onChange(nextList, addedDomains) may be async; return a string to reject the change with that message.
function buildDomainEditor(initial, onChange) {
  let list = [...initial];
  const root = el("div", "domains");
  root.append(el("span", "field-label", "Auto-add tabs from"));

  const chips = el("div", "chips");
  const row = el("div", "add-row");
  const input = el("input", "input domain-input");
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = "example.com";
  input.setAttribute("aria-label", "Add a site");
  const addBtn = el("button", "btn small", "Add");
  addBtn.type = "button";
  row.append(input, addBtn);

  const useCurrent = el("button", "btn small", "Use current tab");
  useCurrent.type = "button";
  const preview = el("p", "hint");
  preview.setAttribute("role", "status");
  const error = el("p", "error");
  error.setAttribute("role", "alert");

  function renderChips() {
    chips.replaceChildren();
    if (list.length === 0) chips.append(el("span", "hint", "No sites yet."));
    for (const d of list) {
      const chip = el("span", "chip");
      chip.append(el("span", "chip-text", d));
      const rm = el("button", "chip-x", "✕");
      rm.type = "button";
      rm.setAttribute("aria-label", `Remove ${d}`);
      rm.addEventListener("click", () => commit(list.filter((x) => x !== d), []));
      chip.append(rm);
      chips.append(chip);
    }
  }

  async function commit(next, added) {
    const err = await onChange(next, added);
    if (err) {
      error.textContent = err;
      return false;
    }
    error.textContent = "";
    list = next;
    renderChips();
    return true;
  }

  async function tryAdd(raw) {
    const tokens = raw.split(/[\s,]+/).filter(Boolean);
    if (tokens.length === 0) return;
    const bad = tokens.find((t) => !normalizeDomain(t));
    if (bad) {
      error.textContent = `"${bad}" isn't a valid domain.`;
      return;
    }
    const added = [...new Set(tokens.map(normalizeDomain))].filter((d) => !list.includes(d));
    if (added.length === 0 || (await commit([...list, ...added], added))) {
      input.value = "";
      preview.textContent = "";
      error.textContent = "";
    }
  }

  input.addEventListener("input", () => {
    const hosts = [...new Set(input.value.split(/[\s,]+/).filter(Boolean).map(normalizeDomain).filter(Boolean))];
    preview.textContent = hosts.length ? `Will match ${hosts.join(", ")} and subdomains.` : "";
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      tryAdd(input.value);
    }
  });
  addBtn.addEventListener("click", () => tryAdd(input.value));
  useCurrent.addEventListener("click", async () => {
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const host = getHost(active?.url || "");
    if (!host) {
      error.textContent = "The current tab isn't a regular website.";
      return;
    }
    tryAdd(host);
  });

  renderChips();
  root.append(chips, row, useCurrent, preview, error);
  return root;
}

/* ---------------- group view (an open group) ---------------- */

async function showGroup(groupId) {
  let group;
  try {
    group = await chrome.tabGroups.get(groupId);
  } catch {
    return showGroups();
  }
  const settings = await getSettings();
  const rule = settings.rules.find((r) => r.name === group.title);

  setHeader({ text: group.title || "Untitled group", back: true, copyAll: true });
  content.replaceChildren();
  let color = group.color;

  const wrap = el("div", "settings");
  const error = el("p", "error");
  error.setAttribute("role", "alert");

  // Name
  const nameLabel = el("label", "stack");
  nameLabel.append(el("span", "field-label", "Name"));
  const name = el("input", "input");
  name.type = "text";
  name.maxLength = 40;
  name.autocomplete = "off";
  name.value = group.title || "";
  nameLabel.append(name);
  name.addEventListener("change", async () => {
    const next = name.value.trim();
    if (!next || next === group.title) {
      name.value = group.title || "";
      return;
    }
    const fresh = await getSettings();
    if (fresh.rules.some((r) => r.name === next && r.name !== group.title)) {
      error.textContent = `A rule named "${next}" already exists.`;
      name.value = group.title || "";
      return;
    }
    await chrome.tabGroups.update(group.id, { title: next });
    if (rule) await updateSettings({ rules: fresh.rules.map((r) => (r.name === group.title ? { ...r, name: next } : r)) });
    showGroup(group.id);
  });

  // Color
  const swatches = buildSwatches(group.color, async (c) => {
    color = c;
    await chrome.tabGroups.update(group.id, { color: c });
    const fresh = await getSettings();
    if (fresh.rules.some((r) => r.name === group.title)) {
      await updateSettings({ rules: fresh.rules.map((r) => (r.name === group.title ? { ...r, color: c } : r)) });
    }
  });

  // Sites that auto-join this group (the rule)
  const domainEditor = buildDomainEditor(rule ? rule.domains : [], async (next, added) => {
    if (!group.title) return "Name the group first.";
    const fresh = await getSettings();
    for (const d of added) {
      const owner = fresh.rules.find((r) => r.name !== group.title && r.domains.includes(d));
      if (owner) return `${d} is already used by "${owner.name}".`;
    }
    const rules = [...fresh.rules];
    const idx = rules.findIndex((r) => r.name === group.title);
    if (next.length === 0) {
      if (idx >= 0) rules.splice(idx, 1);
    } else if (idx >= 0) {
      rules[idx] = { ...rules[idx], domains: next };
    } else {
      if (rules.length >= MAX_RULES) return "Rule limit reached.";
      rules.push({ name: group.title, color, domains: next });
    }
    await updateSettings({ rules });
    await applyRules();
    await fillTabs();
  });

  const linksAdder = buildLinksAdder(group, () => fillTabs());

  wrap.append(nameLabel, swatches, error, domainEditor, linksAdder);

  const tabsTitle = el("h2", "section-title list-title", "Tabs");
  const tabsBox = el("div");
  content.append(wrap, tabsTitle, tabsBox);

  async function fillTabs() {
    currentTabs = await chrome.tabs.query({ groupId: group.id });
    copyAllBtn.hidden = currentTabs.length === 0;
    tabsTitle.textContent = `Tabs (${currentTabs.length})`;
    const otherGroups = (await chrome.tabGroups.query({})).filter((g) => g.id !== group.id);
    tabsBox.replaceChildren();
    if (currentTabs.length === 0) tabsBox.append(el("p", "empty", "This group has no tabs."));
    for (const tab of currentTabs) tabsBox.append(buildTabItem(tab, group, otherGroups));
  }
  await fillTabs();
}

// Textarea where a list of links is pasted, plus a preview list of what was understood.
// getExisting() -> Set of URLs already present (skipped). onChange(count) fires after every refresh.
// Returns { root, getLinks(), reset(), setStatus(text), focus() }.
// onSubmit (optional): called on Enter; Shift+Enter inserts a new line.
function buildLinksPicker({ getExisting = () => new Set(), onChange = () => {}, onSubmit } = {}) {
  const root = el("div", "links-picker");

  const input = el("textarea", "input links-input");
  input.rows = 2;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = "Paste one link or many (one per line)";
  input.setAttribute("aria-label", "Links to add");

  const status = el("p", "hint");
  status.setAttribute("role", "status");
  const list = el("ul", "links-list");
  list.hidden = true;

  let links = [];

  function analyze() {
    const existing = getExisting();
    const { items } = parseLinks(input.value);
    let accepted = 0;
    return items.map((item) => {
      if (item.status === "invalid") return { ...item, label: "not a link" };
      if (item.status === "repeated") return { ...item, label: "repeated" };
      if (existing.has(item.url)) return { ...item, status: "skip", label: "already in group" };
      if (accepted >= MAX_LINKS) return { ...item, status: "skip", label: `over the ${MAX_LINKS} limit` };
      accepted++;
      return item;
    });
  }

  function removeAt(index, items) {
    input.value = items
      .filter((_, i) => i !== index)
      .map((i) => i.raw)
      .join("\n");
    refresh();
    input.focus();
  }

  function refresh() {
    const items = analyze();
    links = items.filter((i) => i.status === "ok").map((i) => i.url);

    list.replaceChildren();
    list.hidden = items.length === 0;
    items.forEach((item, index) => {
      const ok = item.status === "ok";
      const row = el("li", ok ? "link-row" : "link-row skipped");
      row.append(el("span", "link-mark", ok ? "✓" : "⚠"));
      const text = el("span", "link-text", ok ? item.url : item.raw);
      text.title = ok ? item.url : item.raw;
      row.append(text);
      if (!ok) row.append(el("span", "link-reason", item.label));
      const rm = el("button", "chip-x", "✕");
      rm.type = "button";
      rm.setAttribute("aria-label", `Remove ${item.raw}`);
      rm.addEventListener("click", () => removeAt(index, items));
      row.append(rm);
      list.append(row);
    });

    const skipped = items.length - links.length;
    status.textContent = items.length
      ? `${links.length} ${links.length === 1 ? "link" : "links"} ready${skipped ? ` · ${skipped} skipped` : ""}`
      : "";
    onChange(links.length);
  }

  input.addEventListener("input", refresh);
  if (onSubmit) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        onSubmit();
      }
    });
  }
  root.append(input, status, list);
  refresh();

  return {
    root,
    getLinks: () => links,
    reset() {
      input.value = "";
      refresh();
    },
    setStatus(text) {
      status.textContent = text;
    },
    focus: () => input.focus(),
  };
}

// "Add links" field of an open group: paste one or many links, each opens in the background and joins it.
function buildLinksAdder(group, onAdded) {
  const box = el("div", "links-adder");
  box.append(el("span", "field-label", "Add links"));

  const addBtn = el("button", "btn primary", "Add links to group");
  addBtn.type = "button";
  addBtn.disabled = true;

  const picker = buildLinksPicker({
    getExisting: () => new Set(currentTabs.map((t) => t.url || t.pendingUrl).filter(Boolean)),
    onChange(n) {
      addBtn.textContent = n > 0 ? `Add ${n} ${n === 1 ? "link" : "links"} to group` : "Add links to group";
      addBtn.disabled = n === 0;
    },
    onSubmit: () => addBtn.click(),
  });

  addBtn.addEventListener("click", async () => {
    const urls = picker.getLinks();
    if (urls.length === 0 || addBtn.disabled) return;
    addBtn.disabled = true;
    let message;
    try {
      const added = await addLinksToGroup(group.id, group.windowId, urls);
      message = `Added ${added} ${added === 1 ? "link" : "links"}.`;
      picker.reset();
    } catch {
      message = "Could not add all links.";
    }
    await onAdded();
    picker.setStatus(message);
  });

  box.append(picker.root, addBtn);
  return box;
}

function buildTabItem(tab, group, otherGroups) {
  const url = tab.url || tab.pendingUrl || "";
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
  return item;
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
    showGroup(group.id); // falls back to the groups list when the group is now empty
  });
  return select;
}

copyAllBtn.addEventListener("click", async () => {
  const text = currentTabs.map((t) => t.url || t.pendingUrl).filter(Boolean).join("\n");
  flash(copyAllBtn, "Copied ✓", await copyText(text), "Copy all");
});

/* ---------------- rule editor (new group, or a rule whose group isn't open) ---------------- */

async function showEditor(ruleName) {
  const settings = await getSettings();
  const existing = ruleName === null ? null : settings.rules.find((r) => r.name === ruleName);
  if (ruleName !== null && !existing) return showGroups();

  setHeader({ text: existing ? existing.name : "New group", back: true });
  content.replaceChildren();

  let color = existing ? existing.color : "blue";
  let domains = existing ? [...existing.domains] : [];

  const wrap = el("div", "settings");
  const nameLabel = el("label", "stack");
  nameLabel.append(el("span", "field-label", "Name"));
  const name = el("input", "input");
  name.type = "text";
  name.maxLength = 40;
  name.autocomplete = "off";
  name.placeholder = "Work";
  name.value = existing ? existing.name : "";
  nameLabel.append(name);

  const swatches = buildSwatches(color, (c) => (color = c));
  const domainEditor = buildDomainEditor(domains, (next) => {
    domains = next;
  });
  // Links pasted here open as tabs in this group when you press Save.
  const linksBox = el("div", "links-adder");
  linksBox.append(el("span", "field-label", "Links to open in this group"));
  const picker = buildLinksPicker();
  linksBox.append(picker.root);

  const error = el("p", "error");
  error.setAttribute("role", "alert");

  const actions = el("div", "banner-actions editor-actions");
  const save = el("button", "btn primary", "Save");
  save.type = "button";
  const cancel = el("button", "btn", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", showGroups);
  actions.append(save, cancel);

  if (existing) {
    const del = el("button", "btn danger", "Delete");
    del.type = "button";
    del.addEventListener("click", async () => {
      const fresh = await getSettings();
      await updateSettings({ rules: fresh.rules.filter((r) => r.name !== existing.name) });
      showGroups();
    });
    actions.append(del);
  }

  save.addEventListener("click", async () => {
    const groupName = name.value.trim();
    if (!groupName) return (error.textContent = "Give the group a name."), name.focus();
    const links = picker.getLinks();
    if (domains.length === 0 && links.length === 0) return (error.textContent = "Add at least one site or link.");

    const fresh = await getSettings();
    const self = existing ? existing.name : null;
    if (fresh.rules.some((r) => r.name === groupName && r.name !== self)) {
      return (error.textContent = `A rule named "${groupName}" already exists.`);
    }
    for (const d of domains) {
      const owner = fresh.rules.find((r) => r.name !== self && r.domains.includes(d));
      if (owner) return (error.textContent = `${d} is already used by "${owner.name}".`);
    }
    if (!existing && domains.length > 0 && fresh.rules.length >= MAX_RULES) {
      return (error.textContent = "Rule limit reached.");
    }

    // Sites make a rule; a group made only from pasted links needs none.
    let rules = fresh.rules;
    if (domains.length > 0) {
      const entry = { name: groupName, color, domains };
      rules = existing ? rules.map((r) => (r.name === self ? entry : r)) : [...rules, entry];
    } else if (existing) {
      rules = rules.filter((r) => r.name !== self);
    }

    save.disabled = true;
    error.textContent = "";
    try {
      await updateSettings({ rules });
      if (links.length > 0) {
        const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
        await createGroupWithLinks({ title: groupName, color, urls: links, windowId: win.id });
      }
    } catch {
      save.disabled = false;
      return (error.textContent = "Could not open all the links.");
    }
    await applyRules();
    showGroups();
  });

  wrap.append(nameLabel, swatches, domainEditor, linksBox, error, actions);
  content.append(wrap);
  queueMicrotask(() => (existing ? domainEditor.querySelector(".domain-input") : name).focus());
}

/* ---------------- settings (global only) ---------------- */

async function showSettings() {
  setHeader({ text: "Settings", back: true });
  content.replaceChildren();
  const settings = await getSettings();
  const wrap = el("div", "settings");

  // Master toggle
  const toggleRow = el("label", "field-row");
  const toggle = el("input", "switch");
  toggle.type = "checkbox";
  toggle.setAttribute("role", "switch");
  toggle.checked = settings.enabled;
  toggle.addEventListener("change", () => updateSettings({ enabled: toggle.checked }));
  const info = el("span", "info", "ⓘ");
  const infoText =
    "Groups tabs from the same site once you have this many ungrouped ones. Sites you added to a group always join it, even when this is off. Tabs you ungroup by hand are left alone.";
  info.title = infoText;
  info.tabIndex = 0;
  info.setAttribute("role", "img");
  info.setAttribute("aria-label", infoText);
  const toggleLabel = el("span", "field-label", "Auto-group by domain ");
  toggleLabel.append(info);
  toggleRow.append(toggleLabel, toggle);

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

  const status = el("p", "hint");
  status.setAttribute("role", "status");
  const now = el("button", "btn primary full", "Group my open tabs now");
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

  wrap.append(el("h2", "section-title", "Auto-group"), toggleRow, thresholdRow, now, status);
  content.append(wrap);
}

backBtn.addEventListener("click", showGroups);
settingsBtn.addEventListener("click", () => showSettings());

showGroups();
