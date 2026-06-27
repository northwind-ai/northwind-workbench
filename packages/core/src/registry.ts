import type {
  HealthCheck,
  PackageInfo,
  Plugin,
  ScenarioDefinition,
  WorkspaceAdapter,
} from "@package-workbench/plugin-sdk";

/**
 * Collects contributions from all registered plugins. Checks/validators and
 * scenarios are resolved *per package* so a plugin's `supports(pkg)` predicate
 * can gate them (e.g. an Nx plugin only contributes to Nx projects).
 *
 * Resolution order: plugins are applied in registration order and later
 * registrations win on id collisions for checks (so a private repo can override
 * a built-in). Adapters preserve order so the most specific (nx, pnpm) is probed
 * before the generic npm one.
 */
export class PluginHost {
  readonly plugins: Plugin[] = [];
  private readonly adapterList: WorkspaceAdapter[] = [];

  constructor(plugins: Plugin[] = []) {
    for (const p of plugins) this.register(p);
  }

  register(plugin: Plugin): void {
    this.plugins.push(plugin);
    for (const a of plugin.adapters ?? []) this.adapterList.push(a);
  }

  get adapters(): readonly WorkspaceAdapter[] {
    return this.adapterList;
  }

  /** Does this plugin apply to `pkg`? A throwing/false `supports()` excludes it. */
  private applies(plugin: Plugin, pkg: PackageInfo): boolean {
    if (typeof plugin.supports !== "function") return true;
    try {
      return plugin.supports(pkg) !== false;
    } catch {
      return false; // a buggy predicate must not crash the run — just opt out
    }
  }

  /** A plugin's checks + validators are one bucket (the same concept). */
  private pluginChecks(plugin: Plugin): HealthCheck[] {
    return [...(plugin.checks ?? []), ...(plugin.validators ?? [])];
  }

  /** Checks/validators that apply to `pkg`, deduped by id (later plugin wins). */
  checksFor(pkg: PackageInfo): HealthCheck[] {
    const byId = new Map<string, HealthCheck>();
    for (const plugin of this.plugins) {
      if (!this.applies(plugin, pkg)) continue;
      for (const c of this.pluginChecks(plugin)) byId.set(c.id, c);
    }
    return [...byId.values()];
  }

  /** Scenarios contributed by plugins that support `pkg`, deduped by id. */
  scenariosFor(pkg: PackageInfo): ScenarioDefinition[] {
    const byId = new Map<string, ScenarioDefinition>();
    for (const plugin of this.plugins) {
      if (!this.applies(plugin, pkg)) continue;
      for (const s of plugin.scenarios ?? []) byId.set(s.id, s);
    }
    return [...byId.values()];
  }

  /** All checks regardless of package gating — for introspection/back-compat. */
  get checks(): readonly HealthCheck[] {
    const byId = new Map<string, HealthCheck>();
    for (const plugin of this.plugins)
      for (const c of this.pluginChecks(plugin)) byId.set(c.id, c);
    return [...byId.values()];
  }
}
