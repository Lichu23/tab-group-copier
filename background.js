import {
  NO_GROUP,
  addIgnored,
  removeIgnored,
  organizeWindow,
  getSettings,
  refreshSnapshot,
  saveIfClosed,
} from "./lib.js";

const DEBOUNCE_MS = 400;
const SNAPSHOT_MS = 1000;
const BADGE_MS = 4000;

const timers = new Map(); // windowId -> timeout
let queue = Promise.resolve(); // serialize runs so groups aren't created twice
let snapshotTimer;

function showBadge(count) {
  chrome.action.setBadgeBackgroundColor({ color: "#1a73e8" });
  chrome.action.setBadgeText({ text: `+${count}` });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), BADGE_MS);
}

function schedule(windowId) {
  clearTimeout(timers.get(windowId));
  timers.set(
    windowId,
    setTimeout(() => {
      timers.delete(windowId);
      queue = queue
        .then(async () => {
          const settings = await getSettings();
          // Custom rules work on their own; the toggle only controls grouping by domain.
          if (!settings.enabled && settings.rules.length === 0) return;
          const moved = await organizeWindow(windowId);
          if (moved > 0) showBadge(moved);
        })
        .catch((err) => console.warn("auto-group failed:", err));
    }, DEBOUNCE_MS)
  );
}

// Debounced so that, when a group is closed, its removal is handled before the snapshot is refreshed.
function scheduleSnapshot() {
  clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => refreshSnapshot().catch(() => {}), SNAPSHOT_MS);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // The user pulled the tab out of its group: leave it alone from now on.
  if (changeInfo.groupId === NO_GROUP) {
    addIgnored(tabId);
    scheduleSnapshot();
    return;
  }
  if (changeInfo.url || changeInfo.title || changeInfo.groupId !== undefined) scheduleSnapshot();
  if (changeInfo.url || changeInfo.status === "complete") schedule(tab.windowId);
});

chrome.tabs.onCreated.addListener(scheduleSnapshot);
chrome.tabs.onAttached.addListener(scheduleSnapshot);
chrome.tabs.onRemoved.addListener((tabId) => {
  removeIgnored(tabId);
  scheduleSnapshot();
});

chrome.tabGroups.onCreated.addListener(scheduleSnapshot);
chrome.tabGroups.onUpdated.addListener(scheduleSnapshot);
chrome.tabGroups.onRemoved.addListener((group) => {
  queue = queue.then(() => saveIfClosed(group.id)).catch((err) => console.warn("save closed group failed:", err));
});

chrome.runtime.onStartup.addListener(() => chrome.action.setBadgeText({ text: "" }));
chrome.runtime.onInstalled.addListener(() => refreshSnapshot().catch(() => {}));
refreshSnapshot().catch(() => {});
