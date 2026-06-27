import { join } from "node:path";
import { defineCheck, pass, skip, warn } from "@package-workbench/plugin-sdk";
import { CheckId } from "../check-ids";

/**
 * Missing peers are the silent killer: things install and compile, then break at
 * runtime in the consumer. We check whether each declared peer is resolvable
 * from the package or the workspace root. Missing peers are a WARN (hoisting and
 * optional peers make hard failures too noisy).
 */
export const missingPeerDependencies = defineCheck({
  id: CheckId.missingPeerDependencies,
  label: "Peer dependencies resolvable",
  description:
    "Every required peer dependency is installed in the package or workspace root.",
  severity: "high",
  weight: 1,

  async run({ package: pkg, workspace, host }) {
    const peers = pkg.peerDependencies;
    const names = Object.keys(peers);
    if (names.length === 0) return skip("No peer dependencies declared");

    const meta = pkg.manifest.peerDependenciesMeta ?? {};
    const missing: string[] = [];
    for (const name of names) {
      if (meta[name]?.optional) continue;
      const inPkg = await host.fileExists(
        join(pkg.root, "node_modules", name, "package.json"),
      );
      const inRoot = await host.fileExists(
        join(workspace.root, "node_modules", name, "package.json"),
      );
      if (!inPkg && !inRoot) missing.push(`${name}@${peers[name]}`);
    }

    if (missing.length > 0) {
      return warn("high", `${missing.length} required peer(s) not resolvable`, {
        details:
          "Install these where the package is consumed, or they will fail at runtime.",
        evidence: missing,
      });
    }
    return pass(`All ${names.length} peer(s) resolvable`);
  },
});
