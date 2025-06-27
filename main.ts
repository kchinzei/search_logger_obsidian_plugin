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
  /** Stem of logFileName, Given by the user preference. */
  logFileUserPref: string;
  /** Computed: Full file name (with .md extension). Not persisted. */
  logFileName?: string;
  /** The port on localhost where this plugin listens for incoming search‐logging requests. */
  port: number;
  /** If true, write new lines at the top of the file; if false, append to the bottom. */
  prependMode: boolean;
}

const SEARCH_LOG = 'SearchLog';

const DEFAULT_SETTINGS: SearchLoggerSettings = {
  logFileUserPref: SEARCH_LOG,
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
  public server: Server | null = null;

  get logFileName(): string {
    return this.getLogFileNameFrom(this.settings.logFileUserPref);
  }

  set logFileName(name: string) {
    const trimmed = name.trim();
    this.settings.logFileUserPref = trimmed.toLowerCase().endsWith('.md')
      ? trimmed.slice(0, -3)
      : trimmed;
  }

  async onload() {
    await this.loadSettings();

    this.app.workspace.onLayoutReady(async () => {
      const initialFileError = this.validateLogFileName(this.logFileName);
      if (initialFileError) {
        new Notice(`SearchLogger ⚠ ${initialFileError}`);
      } else {
        await this.initLogFile(this.logFileName);
      }

      const initialPortError = this.validatePort(this.settings.port);
      if (initialPortError) {
        new Notice(`SearchLogger ⚠ ${initialPortError}`);
      }

      this.addSettingTab(new SearchLoggerSettingTab(this.app, this));

      const port = this.settings.port;
      this.server = createServer(this.createHttpHandler());
      this.server.listen(port, () => {
        console.log(`SearchLogger listening on http://localhost:${port}`);
      });

      this.addCommand({
        id: 'open-search-log',
        name: 'Open Log Note',
        callback: async () => {
          const file = this.app.vault.getAbstractFileByPath(this.logFileName);
          try {
            const leaf = this.app.workspace.getLeaf(true);
            await leaf.openFile(file);
          } catch (err) {
            console.error('[SearchLogger] Failed to open file:', err);
            new Notice(`❌ Failed to open: ${err}`);
          }
        },
      });
    });
  }

  onunload() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

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

      if (req.method === 'POST' && req.url === '/log') {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', async () => {
          try {
            const { query, url, timestamp } = JSON.parse(body);

            if (this.recentQueries.includes(query)) {
              res.writeHead(200, {
                'Access-Control-Allow-Origin': '*',
              });
              return res.end();
            }

            const effective = this.logFileName;

            const formatted = this.formatTimestamp(timestamp);
            const line = `- ${formatted}\t— [${query}](${url})\n`;

            const af = this.app.vault.getAbstractFileByPath(effective);
            if (!af) {
              await this.app.vault.create(effective, line);
            } else if (af instanceof TFile) {
              if (this.settings.prependMode) {
                const oldContent = await this.app.vault.read(af);
                const newContent = line + oldContent;
                await this.app.vault.modify(af, newContent);
              } else {
                await this.app.vault.append(af, line);
              }
            } else {
              console.warn(
                `SearchLogger: “${effective}” exists but is a folder. Skipping.`,
              );
            }

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

  getLogFileNameFrom(input: string): string {
    const trimmed = input.trim();
    return trimmed.toLowerCase().endsWith('.md') ? trimmed : `${trimmed}.md`;
  }

  validateLogFileName(name: string): string | null {
    const trimmed = name.trim();
    if (!trimmed) {
      return 'Log note name cannot be empty.';
    }
    if (trimmed.endsWith('/')) {
      return 'Log note name must not end with a slash.';
    }

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

    const af = this.app.vault.getAbstractFileByPath(trimmed);
    if (af && af instanceof TFolder) {
      return `'${trimmed}' exists but a folder.`;
    }

    return null;
  }

  async initLogFile(path: string): Promise<void> {
    try {
      const af = this.app.vault.getAbstractFileByPath(path);
      if (!af) {
        await this.app.vault.create(path, '');
        new Notice(`Created new log note: ${path}`);
      }
    } catch (err) {
      console.error('initLogFile failed:', err);
      throw err;
    }
  }

  validatePort(port: number): string | null {
    if (!Number.isInteger(port)) {
      return 'Port must be an integer.';
    }
    if (port < MIN_PORT || port > MAX_PORT) {
      return `Port (${port}) must be between ${MIN_PORT} and ${MAX_PORT}.`;
    }
    return null;
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

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

    let fileErrorEl: HTMLElement;
    new Setting(containerEl)
      .setName('Log note name')
      .setDesc(
        'Type a name with or without “.md”. We’ll append “.md” if you omit it.',
      )
      .addText((text) => {
        const inputEl = text.inputEl;
        text
          .setPlaceholder(SEARCH_LOG)
          .setValue(this.plugin.settings.logFileUserPref)
          .onChange(async (rawValue) => {
            const computed = this.plugin.getLogFileNameFrom(rawValue);
            const fileError = this.plugin.validateLogFileName(computed);
            if (fileError) {
              fileErrorEl.setText(`⚠ ${fileError}`);
              fileErrorEl.setAttr('style', 'color: var(--text-error);');
              inputEl.setAttr('style', 'color: var(--text-error);');
              return;
            }

            fileErrorEl.setText('');
            inputEl.style.color = '';
            this.plugin.logFileName = rawValue;
            await this.plugin.initLogFile(this.plugin.logFileName);
            await this.plugin.saveSettings();
          });

        fileErrorEl = containerEl.createDiv({
          cls: 'searchlogger-error-message',
        });
        fileErrorEl.setText('');
        fileErrorEl.setAttr('style', 'font-size: 0.9em; margin-top: 4px;');
      });

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

            const rangeError = this.plugin.validatePort(portCandidate);
            if (rangeError) {
              portErrorEl.setText(`⚠ ${rangeError}`);
              portErrorEl.setAttr('style', 'color: var(--text-error);');
              inputEl.style.color = 'var(--text-error)';
              return;
            }

            portErrorEl.setText('');

            const oldPort = this.plugin.settings.port;
            const oldServer = this.plugin.server;

            if (oldServer) {
              oldServer.close();
              this.plugin.server = null;
            }

            let newServer: Server | null = null;
            try {
              newServer = createServer(this.plugin.createHttpHandler());
              await new Promise<void>((resolve, reject) => {
                newServer!.once('error', (err: any) => reject(err));
                newServer!.once('listening', () => resolve());
                newServer!.listen(portCandidate);
              });

              this.plugin.server = newServer;
              this.plugin.settings.port = portCandidate;
              await this.plugin.saveSettings();
              portErrorEl.setText('');
              inputEl.style.color = '';
              console.log(
                `SearchLogger now listening on http://localhost:${portCandidate}`,
              );
            } catch (err: any) {
              const msg =
                err.code === 'EADDRINUSE'
                  ? `Port ${portCandidate} is already in use.`
                  : `Failed to bind port ${portCandidate}: ${err.message}`;
              portErrorEl.setText(`⚠ ${msg}`);
              portErrorEl.setAttr('style', 'color: var(--text-error);');
              inputEl.style.color = 'var(--text-error)';

              if (newServer) {
                newServer.close();
                newServer = null;
              }
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

    new Setting(containerEl)
      .setName('Prepend mode')
      .setDesc(
        'When ON, search terms are inserted at the top of the log; ' +
          'when OFF, search terms are appended at the bottom. ' +
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
