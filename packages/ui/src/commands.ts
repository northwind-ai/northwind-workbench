import { fuzzyRank } from "./fuzzy";

/**
 * Command-palette model. Commands are plain descriptors with a `run` callback;
 * `filterCommands` ranks them fuzzily over title + keywords. The desktop builds
 * the concrete list (wiring `run` to real actions); this stays pure + testable.
 */

export type CommandGroup =
  | "Navigation"
  | "Actions"
  | "Packages"
  | "View"
  | "Help";

export interface Command {
  id: string;
  title: string;
  subtitle?: string;
  group: CommandGroup;
  /** Extra search terms (aliases). */
  keywords?: string[];
  /** Human shortcut hint, e.g. "Ctrl+R". */
  shortcut?: string;
  run: () => void;
  /** Hide from the palette without removing (e.g. unavailable in current state). */
  disabled?: boolean;
}

const searchKey = (c: Command): string =>
  `${c.title} ${(c.keywords ?? []).join(" ")} ${c.group}`;

/** Rank commands by fuzzy relevance to `query`. Empty query → input order (enabled only). */
export function filterCommands(commands: Command[], query: string): Command[] {
  const enabled = commands.filter((c) => !c.disabled);
  if (!query.trim()) return enabled;
  return fuzzyRank(query, enabled, searchKey).map((r) => r.item);
}

/** Group commands for sectioned rendering, preserving rank order within a group. */
export function groupCommands(
  commands: Command[],
): Array<{ group: CommandGroup; commands: Command[] }> {
  const order: CommandGroup[] = [
    "Actions",
    "Navigation",
    "View",
    "Packages",
    "Help",
  ];
  const byGroup = new Map<CommandGroup, Command[]>();
  for (const c of commands) {
    if (!byGroup.has(c.group)) byGroup.set(c.group, []);
    byGroup.get(c.group)!.push(c);
  }
  return order
    .filter((g) => byGroup.has(g))
    .map((group) => ({ group, commands: byGroup.get(group)! }));
}
