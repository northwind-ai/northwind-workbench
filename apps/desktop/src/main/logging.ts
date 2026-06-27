import { dirname } from "node:path";
import log from "electron-log/main";

/**
 * Centralised logging built on electron-log. Logs go to the console (dev) and a
 * rotating file under the OS log directory (prod). `log.initialize()` also wires
 * a renderer→main bridge so renderer logs land in the same file.
 *
 * Levels: debug · info · warn · error.
 */
log.initialize();
log.transports.file.level = process.env.PW_DEBUG ? "debug" : "info";
log.transports.console.level = "debug";
log.transports.file.maxSize = 5 * 1024 * 1024; // 5 MB before rotation

export const logger = log;

/** Absolute path to the directory holding the log files. */
export function logDir(): string {
  try {
    return dirname(log.transports.file.getFile().path);
  } catch {
    return "";
  }
}
