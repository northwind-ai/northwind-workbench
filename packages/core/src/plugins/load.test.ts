import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadWorkspacePlugins } from "./load";

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../test/fixtures/plugins",
);

describe("loadWorkspacePlugins", () => {
  it("loads plugins listed in workbench.config and records load failures without throwing", async () => {
    const { plugins, errors, configFile } = await loadWorkspacePlugins(
      join(FIXTURES, "with-config"),
    );
    expect(configFile).toMatch(/workbench\.config\.mjs$/);
    expect(plugins.map((p) => p.name)).toContain("Fixture plugin");
    // The missing plugin becomes an error entry, not a crash.
    expect(errors.some((e) => e.source.includes("does-not-exist"))).toBe(true);
  });

  it("returns no plugins (and no error) when there is no config", async () => {
    const { plugins, errors } = await loadWorkspacePlugins(join(FIXTURES));
    expect(plugins).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it("keeps inline plugin objects passed as extras", async () => {
    const extra = {
      id: "x",
      name: "Extra",
      version: "0.0.0",
      supports: () => true,
    };
    const { plugins } = await loadWorkspacePlugins(
      join(FIXTURES, "with-config"),
      [extra],
    );
    expect(plugins.map((p) => p.name)).toContain("Extra");
  });
});
