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

import { Plugin, TFile, TFolder, Notice } from "obsidian";
import { createServer, Server } from "http";

import {
  SearchLoggerSettings,
  DEFAULT_SETTINGS,
  getLogFileNameFrom,
  validatePort,
} from "./settings";
import { createHttpHandler } from "./loggingServer";
import SearchLoggerSettingTab from "./searchLoggerSettingTab";
import { initI18nFromObsidian, t } from "./i18n";

export default class SearchLoggerPlugin extends Plugin {
  settings: SearchLoggerSettings;

  /** Circular buffer of recent queries (max length = MAX_RECENT). */
  public recentQueries: string[] = [];

  /** HTTP server instance reference, in case we want to close on unload. */
  public server: Server | null = null;

  get logFileName(): string {
    return getLogFileNameFrom(this.settings.logFileUserPref);
  }

  set logFileName(name: string) {
    const trimmed = name.trim();
    this.settings.logFileUserPref = trimmed.toLowerCase().endsWith(".md")
      ? trimmed.slice(0, -3)
      : trimmed;
  }

  async onload() {
    await this.loadSettings();

    initI18nFromObsidian();
    this.app.workspace.onLayoutReady(async () => {
      // Validate / init log file
      const initialFileError = this.validateLogFileName(this.logFileName);
      if (initialFileError) {
        new Notice(`SearchLogger ⚠ ${initialFileError}`);
      } else {
        await this.initLogFile(this.logFileName);
      }

      // Validate port
      const initialPortError = validatePort(this.settings.port);
      if (initialPortError) {
        new Notice(`SearchLogger ⚠ ${initialPortError}`);
      }

      // Settings tab
      this.addSettingTab(new SearchLoggerSettingTab(this.app, this));

      // HTTP server
      const port = this.settings.port;
      this.server = createServer(
        createHttpHandler({
          app: this.app,
          getLogFileName: () => this.logFileName,
          getPrependMode: () => this.settings.prependMode,
          recentQueries: this.recentQueries,
        }),
      );
      this.server.listen(port, () => {
        console.log(`SearchLogger listening on http://localhost:${port}`);
      });

      // Command: open log
      this.addCommand({
        id: "open-search-log",
        name: t("hotkey.command.name"),
        callback: async () => {
          const file = this.app.vault.getAbstractFileByPath(this.logFileName);
          try {
            const leaf = this.app.workspace.getLeaf(true);
            await leaf.openFile(file as TFile);
          } catch (err) {
            console.error("[SearchLogger] Failed to open file:", err);
            new Notice(t("hotkey.error.note.openfail", { err }));
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

  // --- Obsidian-specific helpers that depend on this.app ---

  validateLogFileName(name: string): string | null {
    const trimmed = name.trim();
    if (!trimmed) {
      return t("settings.error.note.name.rule1");
    }
    if (trimmed.endsWith("/")) {
      return t("settings.error.note.name.rule2");
    }

    const parts = trimmed.split("/");
    if (parts.length > 1) {
      const parentPath = parts.slice(0, -1).join("/");
      const parent = this.app.vault.getAbstractFileByPath(parentPath);
      if (!parent) {
        return t("settings.error.note.folder.rule1", { PARENT: parentPath });
      }
      if (!(parent instanceof TFolder)) {
        return t("settings.error.note.folder.rule2", { PARENT: parentPath });
      }
    }

    const af = this.app.vault.getAbstractFileByPath(trimmed);
    if (af && af instanceof TFolder) {
      return t("settings.error.note.name.rule3", { PATH: trimmed });
    }

    return null;
  }

  async initLogFile(path: string): Promise<void> {
    try {
      const af = this.app.vault.getAbstractFileByPath(path);
      if (!af) {
        await this.app.vault.create(path, "");
        new Notice(t("notice.newlog.saved", { PATH: path }));
      }
    } catch (err) {
      console.error("initLogFile failed:", err);
      throw err;
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  // Re-expose the pure helper so settings tab can call it via plugin
  getLogFileNameFrom(input: string): string {
    return getLogFileNameFrom(input);
  }
}
