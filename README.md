# Tab Group Copier

A small Chrome extension that lets you browse your tab groups and copy the links of their tabs, one at a time or all at once.

Chrome's native tab group menu can't be extended by extensions, so this adds its own popup instead.

## Features

- Click the extension icon to see all your tab groups (color, name and tab count).
- Click a group to see its tabs (title and URL).
- Copy icon next to each tab copies that tab's URL.
- **Copy all** copies every URL in the group, one per line.
- Auto-group by domain: once you have N ungrouped tabs from the same site (default 3), they are grouped as `github.com`. Off by default, turn it on from the banner or the settings (gear icon).
- Everything in one list: open groups, their auto-add sites (⚡) and groups whose rule has no open tabs. Click a group to rename it, change its color, edit its sites, copy links or move tabs.
- Auto-add sites: add sites to a group (e.g. `github.com`, `gitlab.com` → "Dev") and matching tabs join it immediately. Subdomains match too, paths are ignored, and it works even when auto-group by domain is off. "Use current tab" adds the active tab's site.
- "+ New group" creates a named, colored group with its sites before any tab is open.
- Move any tab to another group (or out of its group) from the group's tab list.
- Recently closed groups can be reopened from the popup.
- "Group my open tabs now" applies the rules and threshold to everything already open.
- Tabs you ungroup by hand are left alone until they are closed.
- Light and dark theme, follows your system setting.

## Install (developer mode)

1. Download or clone this repository.
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the project folder.
5. Pin the extension from the puzzle-piece menu.

## Usage

1. Click the extension icon.
2. Pick a group.
3. Use the copy icon on a single tab, or **Copy all** for the whole group.
4. **Back** returns to the groups list.

## Permissions

| Permission  | Why                                              |
| ----------- | ------------------------------------------------ |
| `tabs`      | Read the title and URL of the tabs in a group.   |
| `tabGroups` | List, create and name your tab groups.           |
| `storage`   | Save your settings and custom rules locally.     |

The extension doesn't send any data anywhere. Everything stays in your browser.

## Project structure

```
manifest.json   Extension config (Manifest V3)
background.js   Service worker: auto-groups tabs as they load
lib.js          Shared settings, domain matching and grouping logic
popup.html      Popup markup
popup.css       Popup styles
popup.js        Groups list, tabs list, copy logic and settings screen
```

## License

MIT
