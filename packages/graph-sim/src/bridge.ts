import type { RefactorSuggestion } from "@package-workbench/core";
import type { GraphMutation } from "./types";

/**
 * AI integration: turn a Refactor Architect suggestion into graph mutations, so
 * "Preview refactor" updates the editor with the suggested change applied. Maps
 * the strategies that correspond to a concrete graph edit; returns [] for ones
 * that don't (the caller can fall back to the suggestion's own visualization).
 */
export function mutationsFromRefactor(
  suggestion: RefactorSuggestion,
): GraphMutation[] {
  const target = suggestion.targetPackages[0];
  switch (suggestion.strategy) {
    case "split_package":
    case "isolate_runtime_layer": {
      const [types, runtime, services] = suggestion.newPackages;
      if (!target || !types || !runtime || !services) return [];
      return [
        { type: "split_node", id: target, parts: { types, runtime, services } },
      ];
    }
    case "merge_packages": {
      if (suggestion.targetPackages.length < 2) return [];
      return [
        {
          type: "merge_nodes",
          ids: suggestion.targetPackages,
          into: suggestion.newPackages[0] ?? suggestion.targetPackages[0]!,
        },
      ];
    }
    case "move_dependency":
    case "introduce_boundary": {
      // The suggestion targets a forbidden/back edge between two packages.
      const [from, to] = suggestion.targetPackages;
      if (!from || !to) return [];
      return [{ type: "remove_edge", from, to }];
    }
    default:
      return [];
  }
}
