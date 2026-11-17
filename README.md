# Tab Group Copier

A small Chrome extension that lets you browse your tab groups and copy the links of their tabs, one at a time or all at once.

Chrome's native tab group menu can't be extended by extensions, so this adds its own popup instead.

## Features

- Click the extension icon to see all your tab groups (color, name and tab count).
- Click a group to see its tabs (title and URL).
- Copy icon next to each tab copies that tab's URL.
- **Copy all** copies every URL in the group, one per line.
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
| `tabGroups` | List your tab groups and read their name/color.  |

The extension doesn't send any data anywhere. Everything stays in your browser.

## Project structure

```
manifest.json   Extension config (Manifest V3)
popup.html      Popup markup
popup.css       Popup styles
popup.js        Groups list, tabs list and copy logic
```

## License

MIT
