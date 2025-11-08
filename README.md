# Search Logger Plugin for Obsidian

It is a companion of [Search Logger browser extension](https://github.com/kchinzei/search_logger). It receives search terms from Search Logger and saves into Obsidian note.

## How to use

Currently it is in a development stage - you need to install `node` in your PC.

## Installation

You also need to setup [Search Logger browser extension](https://github.com/kchinzei/search_logger) for your browser.

- Clone this repo.
- Make sure your NodeJS is at least v16 (`node --version`).
- `npm i` or `yarn` to install dependencies.
- `npm run dev` to start compilation in watch mode.

### Manually installing the plugin

- Copy over `main.js`, `styles.css`, `manifest.json` to your vault `VaultFolder/.obsidian/plugins/seach-logger/`.

## Setup

- Go Obsidian >> Preferences... >> Community plugins
  Find 'Search Logger' and turn on.
- Go 'Search Logger Settings'
	- Log note name: Filename of a note. '.md' is automatically appeded.
	- Listener port: local server port number. You must match it with that in the browser extension.
	- Prepend mode: When on, new entries are inserted at the top of the note. It can make Obsidian slow the the log growing very long.

## Tips

You can add a hotkey to open the log note. From menu
  **Preferences → Hotkeys → "Search Logger: Open Log Note"**
 to add a hotkey combination.