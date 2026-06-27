import { useEffect, useMemo, useRef, useState } from "react";
import { filterCommands, groupCommands, type Command } from "./commands";

export interface CommandPaletteProps {
  open: boolean;
  commands: Command[];
  onClose: () => void;
  placeholder?: string;
}

/**
 * A Raycast/Linear-style command palette: fuzzy search, grouped results, full
 * keyboard control (↑/↓ to move, Enter to run, Esc to close). Rendered as a modal
 * overlay; all command logic comes from the pure `commands` module.
 */
export function CommandPalette({
  open,
  commands,
  onClose,
  placeholder = "Type a command or search…",
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const flat = useMemo(
    () => filterCommands(commands, query),
    [commands, query],
  );
  const groups = useMemo(() => groupCommands(flat), [flat]);

  // Reset + focus when opened.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, flat.length - 1)));
  }, [flat.length]);

  if (!open) return null;

  const run = (cmd: Command | undefined): void => {
    if (!cmd) return;
    onClose();
    cmd.run();
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(flat.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(flat[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  // Map a command back to its flat index for highlight + click.
  const indexOf = (cmd: Command): number => flat.indexOf(cmd);

  return (
    <div
      className="pw-cmdk"
      role="dialog"
      aria-modal="true"
      onMouseDown={onClose}
    >
      <div className="pw-cmdk__panel" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="pw-cmdk__input"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Command palette"
        />
        <div className="pw-cmdk__list" ref={listRef}>
          {flat.length === 0 && (
            <div className="pw-cmdk__empty">No matching commands</div>
          )}
          {groups.map(({ group, commands: cmds }) => (
            <div key={group} className="pw-cmdk__group">
              <div className="pw-cmdk__grouplabel">{group}</div>
              {cmds.map((cmd) => {
                const i = indexOf(cmd);
                return (
                  <button
                    key={cmd.id}
                    className={`pw-cmdk__item${i === active ? " is-active" : ""}`}
                    onMouseMove={() => setActive(i)}
                    onClick={() => run(cmd)}
                  >
                    <span className="pw-cmdk__title">{cmd.title}</span>
                    {cmd.subtitle && (
                      <span className="pw-cmdk__subtitle">{cmd.subtitle}</span>
                    )}
                    {cmd.shortcut && (
                      <kbd className="pw-cmdk__kbd">{cmd.shortcut}</kbd>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
