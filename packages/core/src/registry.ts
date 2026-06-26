import type { HealthCheck, Plugin, WorkspaceAdapter } from '@package-workbench/plugin-sdk';

/**
 * Collects contributions from all registered plugins into flat registries.
 * Later registrations win on id collisions for checks (lets a private repo
 * override a built-in), while adapters preserve registration order so the most
 * specific adapter (nx, pnpm) is probed before the generic npm one.
 */
export class PluginHost {
  readonly plugins: Plugin[] = [];
  private readonly adapterList: WorkspaceAdapter[] = [];
  private readonly checkMap = new Map<string, HealthCheck>();

  constructor(plugins: Plugin[] = []) {
    for (const p of plugins) this.register(p);
  }

  register(plugin: Plugin): void {
    this.plugins.push(plugin);
    for (const a of plugin.adapters ?? []) this.adapterList.push(a);
    for (const c of plugin.checks ?? []) this.checkMap.set(c.id, c);
  }

  get adapters(): readonly WorkspaceAdapter[] {
    return this.adapterList;
  }

  get checks(): readonly HealthCheck[] {
    return [...this.checkMap.values()];
  }
}
