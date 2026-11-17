const COLORS = {
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

const content = document.getElementById("content");
const title = document.getElementById("title");
const backBtn = document.getElementById("back");
const copyAllBtn = document.getElementById("copy-all");

let currentTabs = [];

// Build DOM with textContent only (tab titles/URLs are untrusted data).
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

async function showGroups() {
  title.textContent = "Tab Groups";
  backBtn.hidden = true;
  copyAllBtn.hidden = true;
  content.replaceChildren();

  const groups = await chrome.tabGroups.query({});
  if (groups.length === 0) {
    content.append(el("p", "empty", "No tab groups found."));
    return;
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
}

async function showTabs(group) {
  title.textContent = group.title || "Untitled group";
  backBtn.hidden = false;
  copyAllBtn.hidden = false;
  content.replaceChildren();

  currentTabs = await chrome.tabs.query({ groupId: group.id });
  if (currentTabs.length === 0) {
    content.append(el("p", "empty", "This group has no tabs."));
    copyAllBtn.hidden = true;
    return;
  }

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

    item.append(info, copyBtn);
    content.append(item);
  }
}

copyAllBtn.addEventListener("click", async () => {
  const text = currentTabs.map((t) => t.url).filter(Boolean).join("\n");
  flash(copyAllBtn, "Copied ✓", await copyText(text), "Copy all");
});

backBtn.addEventListener("click", showGroups);

showGroups();
