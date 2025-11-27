//    The MIT License (MIT)
//    Copyright (c) Kiyo Chinzei
//    ...

export interface SearchLoggerSettings {
  /** Stem of logFileName, Given by the user preference. */
  logFileUserPref: string;
  /** Computed: Full file name (with .md extension). Not persisted. */
  logFileName?: string;
  /** The port on localhost where this plugin listens for incoming search‐logging requests. */
  port: number;
  /** If true, write new lines at the top of the file; if false, append to the bottom. */
  prependMode: boolean;
}

import { t } from "./i18n";
export const SEARCH_LOG = "SearchLog";

export const DEFAULT_SETTINGS: SearchLoggerSettings = {
  logFileUserPref: SEARCH_LOG,
  port: 27123,
  prependMode: true,
};

export const MAX_RECENT = 3;
export const MIN_PORT = 1024;
export const MAX_PORT = 65535;
export const FROM_PARAM_KEY = "from";
export const FROM_PARAM_VALUE = "search-logger";

export function getLogFileNameFrom(input: string): string {
  const trimmed = input.trim();
  return trimmed.toLowerCase().endsWith(".md") ? trimmed : `${trimmed}.md`;
}

export function validatePort(port: number): string | null {
  if (!Number.isInteger(port)) {
    return t("settings.error.port_is_int");
  }
  if (port < MIN_PORT || port > MAX_PORT) {
    return t("settings.error.port_out_range", {
      PORT: port,
      MIN_PORT,
      MAX_PORT,
    });
  }
  return null;
}

export function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, "0");

  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hour = pad(d.getHours());
  const minute = pad(d.getMinutes());

  return `${year}-${month}-${day} ${hour}:${minute}`;
}
