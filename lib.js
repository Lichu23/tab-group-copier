// Shared by the popup and the background service worker.

export const NO_GROUP = -1; // chrome.tabGroups.TAB_GROUP_ID_NONE

export const COLORS = {
  grey: "#9aa0a6",
  blue: "#8ab4f8",
  red: "#f28b82",
  yellow: "#fdd663",
  green: "#81c995",
  pink: "#ff8bcb",
  purple: "#c58af9",
  cyan: "#78d9ec",
  orange: "#fcad70",
};
export const COLOR_NAMES = Object.keys(COLORS);

export const DEFAULTS = {
  enabled: false,
  threshold: 3,
  bannerDismissed: false,
  rules: [], // { name, color, domains: string[] }
};

/* ---------- settings ---------- */

export async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  const s = { ...DEFAULTS, ...(settings || {}) };
  s.threshold = Math.min(10, Math.max(2, Number(s.threshold) || DEFAULTS.threshold));
  s.rules = Array.isArray(s.rules) ? s.rules : [];
  return s;
}

export async function updateSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

/* ---------- ignored tabs (tabs the user ungrouped by hand) ---------- */

export async function getIgnored() {
  const { ignoredTabs } = await chrome.storage.session.get("ignoredTabs");
  return new Set(ignoredTabs || []);
}

export async function addIgnored(tabId) {
  const set = await getIgnored();
  if (set.has(tabId)) return;
  set.add(tabId);
  await chrome.storage.session.set({ ignoredTabs: [...set] });
}

export async function removeIgnored(tabId) {
  const set = await getIgnored();
  if (!set.delete(tabId)) return;
  await chrome.storage.session.set({ ignoredTabs: [...set] });
}

/* ---------- recently closed groups ---------- */

const MAX_CLOSED = 10;

// Remember what every group contains, so we still know it after the user closes the group.
export async function refreshSnapshot() {
  const [groups, tabs] = await Promise.all([chrome.tabGroups.query({}), chrome.tabs.query({})]);
  const snap = {};
  for (const g of groups) snap[g.id] = { title: g.title || "", color: g.color, tabs: [] };
  for (const t of tabs) {
    if (t.groupId === NO_GROUP || !snap[t.groupId] || !/^https?:/.test(t.url || "")) continue;
    snap[t.groupId].tabs.push({ id: t.id, url: t.url, title: t.title || "" });
  }
  await chrome.storage.session.set({ groupSnapshot: snap });
}

export async function getClosedGroups() {
  const { closedGroups } = await chrome.storage.local.get("closedGroups");
  return Array.isArray(closedGroups) ? closedGroups : [];
}

export async function removeClosedGroup(id) {
  const list = await getClosedGroups();
  await chrome.storage.local.set({ closedGroups: list.filter((g) => g.id !== id) });
}

// Called when Chrome removes a group. If its tabs are gone too, the group was closed
// (not just ungrouped), so keep it in the "recently closed" list.
export async function saveIfClosed(groupId) {
  const { groupSnapshot } = await chrome.storage.session.get("groupSnapshot");
  const entry = groupSnapshot && groupSnapshot[groupId];
  if (!entry || entry.tabs.length === 0) return;

  const alive = await Promise.all(entry.tabs.map((t) => chrome.tabs.get(t.id).then(() => true, () => false)));
  if (alive.some(Boolean)) return; // tabs still open: the group was ungrouped, not closed

  const list = await getClosedGroups();
  list.unshift({
    id: Date.now(),
    title: entry.title,
    color: entry.color,
    tabs: entry.tabs.map(({ url, title }) => ({ url, title })),
  });
  await chrome.storage.local.set({ closedGroups: list.slice(0, MAX_CLOSED) });
}

// Open the saved tabs again and put them in a group in the given window.
export async function reopenClosedGroup(entry, windowId) {
  const created = [];
  for (const t of entry.tabs) created.push(await chrome.tabs.create({ windowId, url: t.url, active: false }));
  const groupId = await chrome.tabs.group({ tabIds: created.map((t) => t.id), createProperties: { windowId } });
  await chrome.tabGroups.update(groupId, { title: entry.title, color: entry.color });
  await removeClosedGroup(entry.id);
}

/* ---------- domain helpers (pure) ---------- */

// "https://www.GitHub.com/x" -> "github.com". Returns "" if it isn't a valid domain.
export function normalizeDomain(input) {
  let d = String(input).trim().toLowerCase();
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // scheme
  d = d.split(/[/?#]/)[0]; // path, query, hash
  d = d.replace(/:\d+$/, ""); // port
  d = d.replace(/^\*\./, "").replace(/^www\./, "");
  return /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(d) ? d : "";
}

// Hostname of an http(s) URL without "www.", or null for chrome://, file://, etc.
export function getHost(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

// A rule for "github.com" also matches "gist.github.com".
export function findRule(host, rules) {
  return rules.find((r) => r.domains.some((d) => host === d || host.endsWith("." + d)));
}

export function colorFor(text) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLOR_NAMES[h % COLOR_NAMES.length];
}

/* ---------- grouping ---------- */

// Applies the rules and the threshold to the ungrouped tabs of one window.
// Returns how many tabs were moved into groups.
// Custom rules always apply. Grouping by domain (threshold) only runs when the user turned it on,
// or when forced with includeDomains (the "Group my open tabs now" button).
export async function organizeWindow(windowId, { respectIgnored = true, includeDomains } = {}) {
  const settings = await getSettings();
  const useDomains = includeDomains ?? settings.enabled;
  const ignored = respectIgnored ? await getIgnored() : new Set();
  const tabs = await chrome.tabs.query({ windowId });
  const groups = await chrome.tabGroups.query({ windowId });

  const groupByTitle = new Map();
  for (const g of groups) if (g.title && !groupByTitle.has(g.title)) groupByTitle.set(g.title, g.id);

  // Bucket ungrouped tabs by target group title.
  const buckets = new Map();
  for (const tab of tabs) {
    if (tab.pinned || tab.groupId !== NO_GROUP || ignored.has(tab.id)) continue;
    const host = getHost(tab.url || tab.pendingUrl || "");
    if (!host) continue;

    const rule = findRule(host, settings.rules);
    if (!rule && !useDomains) continue;
    const title = rule ? rule.name : host;
    if (!buckets.has(title)) {
      buckets.set(title, {
        title,
        color: rule ? rule.color : colorFor(host),
        min: rule ? 1 : settings.threshold, // rules group right away
        tabIds: [],
      });
    }
    buckets.get(title).tabIds.push(tab.id);
  }

  let moved = 0;
  for (const b of buckets.values()) {
    const existing = groupByTitle.get(b.title);
    if (existing !== undefined) {
      await chrome.tabs.group({ groupId: existing, tabIds: b.tabIds });
      moved += b.tabIds.length;
    } else if (b.tabIds.length >= b.min) {
      const groupId = await chrome.tabs.group({
        tabIds: b.tabIds,
        createProperties: { windowId },
      });
      await chrome.tabGroups.update(groupId, { title: b.title, color: b.color });
      groupByTitle.set(b.title, groupId);
      moved += b.tabIds.length;
    }
  }
  return moved;
}
