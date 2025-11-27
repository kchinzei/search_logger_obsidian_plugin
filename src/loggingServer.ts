//    The MIT License (MIT)
//    ...

import { App, TFile } from "obsidian";
import { IncomingMessage, ServerResponse } from "http";
import { MAX_RECENT } from "./settings";
// import { FROM_PARAM_KEY, FROM_PARAM_VALUE } from "./settings";

export interface LogContext {
  app: App;
  /** Current full log file path (with .md). */
  getLogFileName(): string;
  /** Whether we prepend (true) or append (false). */
  getPrependMode(): boolean;
  /** Circular buffer of recent queries (mutated in-place). */
  recentQueries: string[];
}

/**
 * HTTP handler factory for Search Logger.
 * Completely stateless except for the `recentQueries` array and vault writes.
 */
export function createHttpHandler(ctx: LogContext) {
  const { app, getLogFileName, getPrependMode, recentQueries } = ctx;

  return (req: IncomingMessage, res: ServerResponse) => {
    // CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      return res.end();
    }

    if (req.method === "POST" && req.url === "/log") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        try {
          const { query, url, timestamp } = JSON.parse(body);

          /*
          // ✅ Ignore if search originated from Obsidian
          const parsedUrl = new URL(url);
          const from = parsedUrl.searchParams.get(FROM_PARAM_KEY);
          if (from === FROM_PARAM_VALUE) {
            console.log('SearchLogger: Skipping query from Obsidian click');
            res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
            return res.end();
          }
          */

          // De-duplicate recent queries
          if (recentQueries.includes(query)) {
            res.writeHead(200, {
              "Access-Control-Allow-Origin": "*",
            });
            return res.end();
          }

          /*
          // ✅ Append &from=obsidian
          parsedUrl.searchParams.set(FROM_PARAM_KEY, FROM_PARAM_VALUE);
          const finalUrl = parsedUrl.toString();
          */

          const effective = getLogFileName();
          // const formatted = formatTimestamp(timestamp);
          // const line = `- ${formatted}\t— [${query}](${finalUrl})\n`;
          const line = `- ${timestamp}\t— ${query} [↗️](${url})\n`;

          const af = app.vault.getAbstractFileByPath(effective);
          if (!af) {
            await app.vault.create(effective, line);
          } else if (af instanceof TFile) {
            if (getPrependMode()) {
              const oldContent = await app.vault.read(af);
              const newContent = line + oldContent;
              await app.vault.modify(af, newContent);
            } else {
              await app.vault.append(af, line);
            }
          } else {
            console.warn(
              `SearchLogger: “${effective}” exists but is a folder. Skipping.`,
            );
          }

          // Maintain circular buffer
          recentQueries.push(query);
          if (recentQueries.length > MAX_RECENT) {
            recentQueries.shift();
          }

          res.writeHead(200, {
            "Access-Control-Allow-Origin": "*",
          });
        } catch (e) {
          console.error("SearchLogger: failed to parse/write:", e);
          res.writeHead(400, {
            "Access-Control-Allow-Origin": "*",
          });
        }
        res.end();
      });
    } else {
      res.writeHead(404, {
        "Access-Control-Allow-Origin": "*",
      });
      res.end();
    }
  };
}
