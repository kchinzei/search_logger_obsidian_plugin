//    The MIT License (MIT)
//    Copyright (c) Kiyo Chinzei (kchinzei@gmail.com)
//
//     Permission is hereby granted, free of charge, to any person obtaining a copy
//    of this software and associated documentation files (the "Software"), to deal
//    in the Software without restriction, including without limitation the rights
//    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//    copies of the Software, and to permit persons to whom the Software is
//    furnished to do so, subject to the following conditions:
//    The above copyright notice and this permission notice shall be included in
//    all copies or substantial portions of the Software.
//    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
//    THE SOFTWARE.

import {
  App,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  Notice,
} from 'obsidian';
import { createServer, IncomingMessage, ServerResponse, Server } from 'http';

interface SearchLoggerSettings {
  /** The Markdown file (in your vault root or subfolder) where lines will be appended. */
  logFileName: string;
  /** Stem of logFileName, Given by the user preference. */
  logFileUserPref: string;
  /** The port on localhost where this plugin listens for incoming search‐logging requests. */
  port: number;
  /** If true, write new lines at the top of the file; if false, append to the bottom. */
  prependMode: boolean;
}

const DEFAULT_SETTINGS: SearchLoggerSettings = {
  logFileName: 'SearchLog.md',
  logFileUserPref: 'SearchLog',
  port: 27123,
  prependMode: false,
};

const MAX_RECENT = 3;
const MIN_PORT = 1024;
const MAX_PORT = 65535;

export default class SearchLoggerPlugin extends Plugin {
  settings: SearchLoggerSettings;

  /** Circular buffer of recent queries (max length = MAX_RECENT). */
  private recentQueries: string[] = [];

  /** HTTP server instance reference, in case we want to close on unload. */
  public server: Server | null = null; // Made public so Settings tab can access it

  async onload() {
    // 1. load or initialize settings
    await this.loadSettings();

    // 2. Immediately validate the current file name and alert if invalid
    // Validate filename on startup
    const initialFileError = this.validateLogFileName(
      this.settings.logFileName,
    );
    if (initialFileError) {
      new Notice(`SearchLogger ⚠ ${initialFileError}`);
    }

    // 3. Validate port range on startup (availability will be checked when plugin tries to listen)
    const initialPortError = this.validatePort(this.settings.port);
    if (initialPortError) {
      new Notice(`SearchLogger ⚠ ${initialPortError}`);
    }

    // 4. Add a settings tab so the user can change logFileName
    this.addSettingTab(new SearchLoggerSettingTab(this.app, this));

    // 4. start the HTTP listener on port 27123
    const port = this.settings.port;
    this.server = createServer(this.createHttpHandler());
    this.server.listen(port, () => {
      console.log(`SearchLogger listening on http://localhost:${port}`);
    });
  }

  onunload() {
    // Gracefully close the HTTP server if it was started
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  /**
   * Handler factory for createServer. Contains POST /log logic, including deduplication.
   */
  public createHttpHandler() {
    return (req: IncomingMessage, res: ServerResponse) => {
      if (req.method === 'OPTIONS') {
        res.writeHead(200, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        });
        return res.end();
      }

      // only handle POST /log
      if (req.method === 'POST' && req.url === '/log') {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', async () => {
          try {
            const { query, url, timestamp } = JSON.parse(body);

            // 1) Deduplication: if the same query was among recentQueries, skip logging
            if (this.recentQueries.includes(query)) {
              // Respond 200 even if we skip
              res.writeHead(200, {
                'Access-Control-Allow-Origin': '*',
              });
              return res.end();
            }

            // 2) Compute “effective” filename and write
            const rawName = this.settings.logFileName.trim();
            const effective = rawName.toLowerCase().endsWith('.md')
              ? rawName
              : `${rawName}.md`;

            // 3) Format timestamp and build Markdown line
            const formatted = this.formatTimestamp(timestamp);
            const line = `- ${formatted}\t— [${query}](${url})\n`;

            // 4) Locate or create the file in the vault
            const af = this.app.vault.getAbstractFileByPath(effective);
            if (!af) {
              await this.app.vault.create(effective, line);
            } else if (af instanceof TFile) {
              if (this.settings.prependMode) {
                // PREPEND: read + modify entire file
                const oldContent = await this.app.vault.read(af);
                const newContent = line + oldContent;
                await this.app.vault.modify(af, newContent);
              } else {
                // APPEND (original behavior)
                await this.app.vault.append(af, line);
              }
            } else {
              console.warn(
                `SearchLogger: “${effective}” exists but is a folder. Skipping.`,
              );
            }

            // 5) Push this query into recentQueries, maintaining length <= MAX_RECENT
            this.recentQueries.push(query);
            if (this.recentQueries.length > MAX_RECENT) {
              this.recentQueries.shift();
            }

            res.writeHead(200, {
              'Access-Control-Allow-Origin': '*',
            });
          } catch (e) {
            console.error('SearchLogger: failed to parse/write:', e);
            res.writeHead(400, {
              'Access-Control-Allow-Origin': '*',
            });
          }
          res.end();
        });
      } else {
        res.writeHead(404, {
          'Access-Control-Allow-Origin': '*',
        });
        res.end();
      }
    };
  }

  /**
   * Format JavaScript‐millisecond timestamp into “YYYY-MM-DD HH:MM” in local time.
   */
  private formatTimestamp(ms: number): string {
    const d = new Date(ms);
    const pad = (n: number) => n.toString().padStart(2, '0');

    const year = d.getFullYear();
    const month = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const hour = pad(d.getHours());
    const minute = pad(d.getMinutes());

    return `${year}-${month}-${day} ${hour}:${minute}`;
  }

  /**
   * Validate the user‐provided log‐file name.
   *  - no trailing slash
   *  - parent folder exists (if any) and is a folder
   *  - effective path not an existing folder
   * Returns `null` if the name is valid, otherwise returns an error string.
   */
  validateLogFileName(name: string): string | null {
    const trimmed = name.trim();
    if (!trimmed) {
      return 'Log file name cannot be empty.';
    }
    // Disallow trailing slash
    if (trimmed.endsWith('/')) {
      return 'Log file name must not end with a slash.';
    }

    // Split into path components to check parent folder, if any
    const parts = trimmed.split('/');
    if (parts.length > 1) {
      const parentPath = parts.slice(0, -1).join('/');
      const parent = this.app.vault.getAbstractFileByPath(parentPath);
      if (!parent) {
        return `Parent folder '${parentPath}' does not exist.`;
      }
      if (!(parent instanceof TFolder)) {
        return `Parent '${parentPath}' exists but is not a folder.`;
      }
    }

    // Check if the target exists
    const af = this.app.vault.getAbstractFileByPath(trimmed);
    if (af) {
      if (af instanceof TFolder) {
        return `'${trimmed}' exists but is a folder, not a file.`;
      }
      // If it's a TFile, assume append/create will succeed. If vault is unwritable,
      // that error will show up at write‐time; we trust Obsidian’s permissions here.
    }

    return null;
  }

  /**
   * Returns filename with '.md' appended if user did not provide an extension.
   */
  appendExtension(stem: string, ext: string): string {
    const parts = stem.split('/');
    const last = parts[parts.length - 1];
    if (last.length > 0 && !last.includes('.')) {
      return stem + ext;
    }
    return stem;
  }

  /**
   * Validate that the chosen port is a positive integer within [1024–65535].
   * (No availability check here; that’s done by attempting to listen.)
   * Returns `null` if valid, or an error string if invalid.
   */
  validatePort(port: number): string | null {
    if (!Number.isInteger(port)) {
      return 'Port must be an integer.';
    }
    if (port < MIN_PORT || port > MAX_PORT) {
      return `Port (${port}) must be between ${MIN_PORT} and ${MAX_PORT}.`;
    }
    // We could check “is port already in use,” but that’s platform‐specific; skip here.
    return null;
  }

  // ---------------------------
  // Settings Persistence
  // ---------------------------
  /** Load saved settings (or fall back to defaults). */
  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  /** Save current settings. */
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

// ---------------------------
// Settings Tab Implementation
// ---------------------------
class SearchLoggerSettingTab extends PluginSettingTab {
  plugin: SearchLoggerPlugin;

  constructor(app: App, plugin: SearchLoggerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Search Logger Settings' });

    // ───────────────────────────────────────────────────────────
    // 1) Log file name setting (inline error under field)
    // ───────────────────────────────────────────────────────────
    let fileErrorEl: HTMLElement;
    new Setting(containerEl)
      .setName('Log file name')
      .setDesc(
        'Type a name with or without “.md”. We’ll append “.md” when writing if you omit it.',
      )
      .addText((text) => {
        const inputEl = text.inputEl;
        text
          .setPlaceholder('SearchLog.md')
          .setValue(this.plugin.settings.logFileName)
          .onChange(async (rawValue) => {
            const candidate = rawValue.trim() || DEFAULT_SETTINGS.logFileName;
            const fileError = this.plugin.validateLogFileName(candidate);

            if (fileError) {
              fileErrorEl.setText(`⚠ ${fileError}`);
              fileErrorEl.setAttr('style', 'color: var(--text-error);');
              inputEl.setAttr('style', 'color: var(--text-error);');
              return;
            }

            // Clear any previous error
            fileErrorEl.setText('');
            inputEl.style.color = '';
            this.plugin.settings.logFileName = candidate;
            await this.plugin.saveSettings();
          });

        fileErrorEl = containerEl.createDiv({
          cls: 'searchlogger-error-message',
        });
        fileErrorEl.setText('');
        fileErrorEl.setAttr('style', 'font-size: 0.9em; margin-top: 4px;');
      });

    // ───────────────────────────────────────────────────────────
    // 2) Port number setting (inline error under field)
    // ───────────────────────────────────────────────────────────
    let portErrorEl: HTMLElement;
    new Setting(containerEl)
      .setName('Listener port')
      .setDesc(
        `Port on localhost where the plugin listens (${MIN_PORT}–${MAX_PORT}).`,
      )
      .addText((text) => {
        const inputEl = text.inputEl;
        text
          .setPlaceholder(String(DEFAULT_SETTINGS.port))
          .setValue(String(this.plugin.settings.port))
          .onChange(async (rawValue) => {
            const trimmed = rawValue.trim();
            const parsed = parseInt(trimmed, 10);
            const portCandidate = Number.isNaN(parsed) ? -1 : parsed;

            // 1) Range-check only
            const rangeError = this.plugin.validatePort(portCandidate);
            if (rangeError) {
              portErrorEl.setText(`⚠ ${rangeError}`);
              portErrorEl.setAttr('style', 'color: var(--text-error);');
              inputEl.style.color = 'var(--text-error)';
              return;
            }

            // Clear inline error for range
            portErrorEl.setText('');

            // 2) Attempt to restart server on new port
            const oldPort = this.plugin.settings.port;
            const oldServer = this.plugin.server;

            // Close old server (if any)
            if (oldServer) {
              oldServer.close();
              this.plugin.server = null;
            }

            // We need to declare newServer in outer scope:
            let newServer: Server | null = null;
            try {
              newServer = createServer(this.plugin.createHttpHandler());
              // Wrap listen in a promise to catch errors (like EADDRINUSE)
              await new Promise<void>((resolve, reject) => {
                newServer!.once('error', (err: any) => reject(err));
                newServer!.once('listening', () => resolve());
                newServer!.listen(portCandidate);
              });

              // Success: bind succeeded
              this.plugin.server = newServer;
              this.plugin.settings.port = portCandidate;
              await this.plugin.saveSettings();
              portErrorEl.setText('');
              inputEl.style.color = '';
              console.log(
                `SearchLogger now listening on http://localhost:${portCandidate}`,
              );
            } catch (err: any) {
              // If binding failed (e.g. EADDRINUSE), show inline error
              const msg =
                err.code === 'EADDRINUSE'
                  ? `Port ${portCandidate} is already in use.`
                  : `Failed to bind port ${portCandidate}: ${err.message}`;
              portErrorEl.setText(`⚠ ${msg}`);
              portErrorEl.setAttr('style', 'color: var(--text-error);');
              inputEl.style.color = 'var(--text-error)';

              // Clean up newServer if it partially existed
              if (newServer) {
                newServer.close();
                newServer = null;
              }
              // Roll back: rebind oldServer on oldPort
              if (oldServer) {
                oldServer.listen(oldPort, () => {
                  this.plugin.server = oldServer;
                  console.log(
                    `SearchLogger reverted to http://localhost:${oldPort}`,
                  );
                });
              }
              text.setValue(String(oldPort));
            }
          });

        portErrorEl = containerEl.createDiv({
          cls: 'searchlogger-error-message',
        });
        portErrorEl.setText('');
        portErrorEl.setAttr('style', 'font-size: 0.9em; margin-top: 4px;');
      });

    // ───────────────────────────────────────────────────────────
    // 3) Prepend vs. Append toggle
    // ───────────────────────────────────────────────────────────
    new Setting(containerEl)
      .setName('Prepend mode')
      .setDesc(
        'When ON, new entries will be inserted at the top of the file; ' +
          'when OFF, entries append at the bottom. ' +
          'Inserting at the top could be slow when the log grows.',
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.prependMode)
          .onChange(async (value) => {
            this.plugin.settings.prependMode = value;
            await this.plugin.saveSettings();
          }),
      );
  }
}
