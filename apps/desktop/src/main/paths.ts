import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

/**
 * ESM-safe replacement for `__dirname`. The desktop builds as ESM (the package
 * is `"type": "module"`), so `__dirname` is not defined in the bundled main
 * process — it must be derived from `import.meta.url`. After bundling, this
 * resolves to the main bundle's directory (`out/main`).
 */
export const mainDir = dirname(fileURLToPath(import.meta.url));
