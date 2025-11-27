//    The MIT License (MIT)
//    ...

import { App, PluginSettingTab, Setting } from "obsidian";
import { createServer, Server } from "http";
import { t } from "./i18n";
import type SearchLoggerPlugin from "./main";
import {
  SEARCH_LOG,
  DEFAULT_SETTINGS,
  MIN_PORT,
  MAX_PORT,
  validatePort,
} from "./settings";
import { createHttpHandler } from "./loggingServer";

export default class SearchLoggerSettingTab extends PluginSettingTab {
  plugin: SearchLoggerPlugin;

  constructor(app: App, plugin: SearchLoggerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: t("settings.title") });

    // --- Log file name setting ---
    let fileErrorEl: HTMLElement;
    new Setting(containerEl)
      .setName(t("settings.note.name"))
      .setDesc(t("settings.note.desc"))
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
              fileErrorEl.setAttr("style", "color: var(--text-error);");
              inputEl.setAttr("style", "color: var(--text-error);");
              return;
            }

            fileErrorEl.setText("");
            inputEl.style.color = "";
            this.plugin.logFileName = rawValue;
            await this.plugin.initLogFile(this.plugin.logFileName);
            await this.plugin.saveSettings();
          });

        fileErrorEl = containerEl.createDiv({
          cls: "searchlogger-error-message",
        });
        fileErrorEl.setText("");
        fileErrorEl.setAttr("style", "font-size: 0.9em; margin-top: 4px;");
      });

    // --- Port setting ---
    let portErrorEl: HTMLElement;
    new Setting(containerEl)
      .setName(t("settings.port.name"))
      .setDesc(t("settings.port.desc", { MIN_PORT, MAX_PORT }))
      .addText((text) => {
        const inputEl = text.inputEl;
        text
          .setPlaceholder(String(DEFAULT_SETTINGS.port))
          .setValue(String(this.plugin.settings.port))
          .onChange(async (rawValue) => {
            const trimmed = rawValue.trim();
            const parsed = parseInt(trimmed, 10);
            const portCandidate = Number.isNaN(parsed) ? -1 : parsed;

            const rangeError = validatePort(portCandidate);
            if (rangeError) {
              portErrorEl.setText(`⚠ ${rangeError}`);
              portErrorEl.setAttr("style", "color: var(--text-error);");
              inputEl.style.color = "var(--text-error)";
              return;
            }

            portErrorEl.setText("");

            const oldPort = this.plugin.settings.port;
            const oldServer = this.plugin.server;

            if (oldServer) {
              oldServer.close();
              this.plugin.server = null;
            }

            let newServer: Server | null = null;
            try {
              newServer = createServer(
                createHttpHandler({
                  app: this.plugin.app,
                  getLogFileName: () => this.plugin.logFileName,
                  getPrependMode: () => this.plugin.settings.prependMode,
                  recentQueries: this.plugin.recentQueries,
                }),
              );

              await new Promise<void>((resolve, reject) => {
                newServer!.once("error", (err: any) => reject(err));
                newServer!.once("listening", () => resolve());
                newServer!.listen(portCandidate);
              });

              this.plugin.server = newServer;
              this.plugin.settings.port = portCandidate;
              await this.plugin.saveSettings();
              portErrorEl.setText("");
              inputEl.style.color = "";
              console.log(
                `SearchLogger now listening on http://localhost:${portCandidate}`,
              );
            } catch (err: any) {
              const msg =
                err.code === "EADDRINUSE"
                  ? t("settings.error.port_used", { PORT: portCandidate })
                  : t("settings.error.port_openfail", {
                      PORT: portCandidate,
                      MSG: err.message,
                    });
              portErrorEl.setText(`⚠ ${msg}`);
              portErrorEl.setAttr("style", "color: var(--text-error);");
              inputEl.style.color = "var(--text-error)";

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
          cls: "searchlogger-error-message",
        });
        portErrorEl.setText("");
        portErrorEl.setAttr("style", "font-size: 0.9em; margin-top: 4px;");
      });

    // --- Prepend mode toggle ---
    new Setting(containerEl)
      .setName(t("settings.prepend.name"))
      .setDesc(t("settings.prepend.desc"))
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
