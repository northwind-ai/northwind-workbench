import type {
  ChatAnswer,
  Confidence,
  Evidence,
  RetrievedContext,
  SuggestedAction,
  WorkbenchKnowledge,
} from "./types";

/**
 * The offline heuristic reasoning engine (required). Turns retrieved context into
 * a grounded {@link ChatAnswer} per query type. Every claim is backed by a fact
 * from the knowledge bundle and cited as evidence — it never invents data, and
 * confidence reflects how much supporting data was actually available.
 */

const HEURISTIC = "heuristic";

export function reasonHeuristic(
  ctx: RetrievedContext,
  knowledge: WorkbenchKnowledge,
): ChatAnswer {
  switch (ctx.intent.type) {
    case "failure":
      return failure(ctx, knowledge);
    case "health":
      return health(ctx, knowledge);
    case "dependency":
      return dependency(ctx, knowledge);
    case "architecture":
      return architecture(ctx, knowledge);
    case "regression":
      return regression(ctx, knowledge);
    case "refactor":
      return refactor(ctx, knowledge);
    case "performance":
      return performance(ctx, knowledge);
    default:
      return general(ctx, knowledge);
  }
}

// ---- helpers -----------------------------------------------------------------

function make(
  ctx: RetrievedContext,
  answer: string,
  evidence: Evidence[],
  confidence: Confidence,
  actions: SuggestedAction[],
  references: string[],
): ChatAnswer {
  return {
    question: ctx.intent.question,
    intent: ctx.intent.type,
    answer,
    evidence,
    confidence,
    suggestedActions: actions,
    references,
    provider: HEURISTIC,
  };
}

const ev = (source: string, text: string): Evidence => ({ source, text });

/** Safe-fix actions for a package, from the auto-fix plan. */
function fixActions(
  knowledge: WorkbenchKnowledge,
  packageId: string,
): SuggestedAction[] {
  return (knowledge.fixPlan?.candidates ?? [])
    .filter((c) => c.packageId === packageId && c.safety !== "dangerous")
    .slice(0, 3)
    .map((c) => ({ title: c.description }));
}

/** Refactor actions touching a package, from the refactor plan. */
function refactorActions(
  knowledge: WorkbenchKnowledge,
  packageId: string,
): SuggestedAction[] {
  return (knowledge.refactor?.suggestions ?? [])
    .filter((s) => s.targetPackages.includes(packageId))
    .slice(0, 2)
    .map((s) => ({ title: s.title }));
}

// ---- per-type reasoning ------------------------------------------------------

function failure(
  ctx: RetrievedContext,
  knowledge: WorkbenchKnowledge,
): ChatAnswer {
  const f = ctx.focus[0];
  if (!f)
    return make(
      ctx,
      "I could not find the package you mean. Try naming it explicitly.",
      [],
      "low",
      [],
      [],
    );

  const issueCount = f.issues.length + (f.scenarioFailures > 0 ? 1 : 0);
  const answer =
    issueCount === 0
      ? `${f.name} looks healthy (score ${f.score}/100) — no failing checks.`
      : `${f.name} health score is ${f.score}/100 due to ${issueCount} issue${issueCount > 1 ? "s" : ""}.`;

  const evidence: Evidence[] = f.issues.map((i) => ev("health", i));
  if (f.scenarioFailures > 0)
    evidence.push(ev("scenario", `${f.scenarioFailures} scenario failure(s)`));

  const actions = [
    ...fixActions(knowledge, f.id),
    ...refactorActions(knowledge, f.id),
  ];
  const confidence: Confidence = issueCount > 0 ? "high" : "medium";
  return make(ctx, answer, evidence, confidence, actions, [f.id]);
}

function health(
  ctx: RetrievedContext,
  knowledge: WorkbenchKnowledge,
): ChatAnswer {
  const f = ctx.focus[0];
  if (!f) {
    const s = knowledge.run.summary;
    return make(
      ctx,
      `Workspace health is ${s.averageScore}/100 — ${s.passed} passing, ${s.warned} warning, ${s.failed} failing package(s).`,
      [ev("health", `Average score ${s.averageScore}/100`)],
      "high",
      [],
      [],
    );
  }
  const answer =
    `${f.name} scores ${f.score}/100 (${f.status}).` +
    (f.issues.length
      ? ` ${f.issues.length} open issue(s).`
      : " No open issues.");
  return make(
    ctx,
    answer,
    f.issues.map((i) => ev("health", i)),
    "high",
    fixActions(knowledge, f.id),
    [f.id],
  );
}

function dependency(
  ctx: RetrievedContext,
  knowledge: WorkbenchKnowledge,
): ChatAnswer {
  const f = ctx.focus[0];
  if (!f)
    return make(
      ctx,
      "Name a package and I will show what depends on it.",
      [],
      "low",
      [],
      [],
    );
  if (!knowledge.graph)
    return make(
      ctx,
      "The dependency graph has not been analyzed yet.",
      [],
      "low",
      [],
      [f.id],
    );

  const dependents = ctx.related
    .filter((r) => r.relation === "dependent")
    .map((r) => r.id);
  const dependencies = ctx.related
    .filter((r) => r.relation === "dependency")
    .map((r) => r.id);
  const node = knowledge.graph.nodes.find((n) => n.id === f.id);

  const answer =
    `${dependents.length} package(s) depend on ${f.name}` +
    (dependents.length
      ? `: ${dependents.slice(0, 10).join(", ")}${dependents.length > 10 ? ", …" : ""}.`
      : ".") +
    (dependencies.length
      ? ` It depends on ${dependencies.length} package(s).`
      : "");

  const evidence: Evidence[] = [
    ev("graph", `Direct dependents: ${dependents.length}`),
  ];
  if (node)
    evidence.push(
      ev(
        "graph",
        `Transitive dependents: ${node.metrics.transitiveDependents}, fan-out: ${node.metrics.fanOut}`,
      ),
    );

  return make(
    ctx,
    answer,
    evidence,
    "high",
    [],
    [f.id, ...dependents.slice(0, 10)],
  );
}

function architecture(
  ctx: RetrievedContext,
  knowledge: WorkbenchKnowledge,
): ChatAnswer {
  const problems = knowledge.refactor?.problems ?? [];
  if (ctx.focus[0] && knowledge.graph) {
    const f = ctx.focus[0];
    const node = knowledge.graph.nodes.find((n) => n.id === f.id);
    const cyc = ctx.cycles.filter((c) => c.includes(f.id)).length;
    const answer = `${f.name} has fan-in ${node?.metrics.fanIn ?? 0}, fan-out ${node?.metrics.fanOut ?? 0}${cyc ? `, and ${cyc} cycle(s)` : ""}.`;
    const evidence: Evidence[] = [ev("graph", answer)];
    return make(
      ctx,
      answer,
      evidence,
      node ? "high" : "low",
      refactorActions(knowledge, f.id),
      [f.id],
    );
  }

  if (problems.length === 0)
    return make(
      ctx,
      "No clear architectural problems detected.",
      [],
      knowledge.graph ? "high" : "low",
      [],
      [],
    );
  const top = problems.slice(0, 3);
  const answer = `Top architectural concern${top.length > 1 ? "s" : ""}: ${top.map((p) => `${p.kind.replace(/_/g, " ")} (${p.packageId ?? p.packages?.[0] ?? "?"})`).join("; ")}.`;
  const evidence = top.flatMap((p) => p.evidence.map((e) => ev("graph", e)));
  const actions = (knowledge.refactor?.suggestions ?? [])
    .slice(0, 2)
    .map((s) => ({ title: s.title }));
  return make(
    ctx,
    answer,
    evidence,
    "high",
    actions,
    top.map((p) => p.packageId ?? p.packages?.[0] ?? "").filter(Boolean),
  );
}

function regression(
  ctx: RetrievedContext,
  knowledge: WorkbenchKnowledge,
): ChatAnswer {
  const delta = knowledge.delta;
  if (delta && (delta.regressions.length > 0 || delta.scoreDelta !== 0)) {
    const answer =
      `Since the baseline, the score moved ${delta.scoreDelta >= 0 ? "+" : ""}${delta.scoreDelta}` +
      (delta.regressions.length
        ? ` with ${delta.regressions.length} regression(s).`
        : " with no new regressions.");
    const evidence = delta.regressions
      .slice(0, 6)
      .map((r) => ev("history", `[${r.severity}] ${r.detail}`));
    const actions = delta.regressions
      .slice(0, 1)
      .map((r) => ({ title: `Investigate: ${r.detail}` }));
    return make(
      ctx,
      answer,
      evidence,
      "high",
      actions,
      delta.regressions
        .map((r) => r.packageId)
        .filter((x): x is string => Boolean(x)),
    );
  }

  // CI instability: packages that fail most often across history.
  const history = knowledge.history ?? [];
  if (history.length >= 2) {
    const flaky = flakiestPackages(history);
    if (flaky.length > 0) {
      const answer = `The most CI-unstable package(s): ${flaky
        .slice(0, 3)
        .map((f) => `${f.id} (failed in ${f.count}/${history.length} runs)`)
        .join(", ")}.`;
      return make(
        ctx,
        answer,
        flaky
          .slice(0, 3)
          .map((f) =>
            ev(
              "history",
              `${f.id} failed in ${f.count} of ${history.length} runs`,
            ),
          ),
        "medium",
        [],
        flaky.map((f) => f.id),
      );
    }
  }
  return make(
    ctx,
    "No baseline or history is available to compare against, so I cannot identify regressions yet. Run a CI snapshot first.",
    [],
    "low",
    [],
    [],
  );
}

function refactor(
  ctx: RetrievedContext,
  knowledge: WorkbenchKnowledge,
): ChatAnswer {
  const top = knowledge.refactor?.suggestions[0];
  if (!top)
    return make(
      ctx,
      "No conservative refactor improves the architecture right now.",
      [],
      knowledge.refactor ? "high" : "low",
      [],
      [],
    );
  const i = top.impact;
  const bits = [
    i.cycleReduction > 0
      ? `${Math.round(i.cycleReductionPct * 100)}% fewer cycles`
      : "",
    i.healthScoreDelta !== 0
      ? `${i.healthScoreDelta >= 0 ? "+" : ""}${i.healthScoreDelta} health`
      : "",
  ].filter(Boolean);
  const answer = `Refactor first: ${top.title}${bits.length ? ` — expected ${bits.join(", ")}.` : "."}`;
  const evidence: Evidence[] = [
    ev("refactor", top.explanation.why),
    ev("refactor", top.explanation.howItHelps),
  ];
  const actions: SuggestedAction[] = top.steps
    .slice(0, 3)
    .map((s) => ({ title: s }));
  return make(ctx, answer, evidence, "high", actions, top.targetPackages);
}

function performance(
  ctx: RetrievedContext,
  knowledge: WorkbenchKnowledge,
): ChatAnswer {
  const sizes = (knowledge.intel?.sizes ?? [])
    .filter((s) => s.measured)
    .sort((a, b) => b.totalBytes - a.totalBytes);
  if (sizes.length === 0)
    return make(
      ctx,
      "No built package sizes are available — build the packages, then ask again.",
      [],
      "low",
      [],
      [],
    );
  const top = sizes.slice(0, 3);
  const kb = (b: number) => `${Math.round(b / 1024)} KB`;
  const answer = `Largest package(s): ${top.map((s) => `${s.packageName} (${kb(s.totalBytes)})`).join(", ")}.`;
  const evidence = top.map((s) =>
    ev(
      "size",
      `${s.packageName}: ${kb(s.totalBytes)} across ${s.fileCount} file(s)`,
    ),
  );
  return make(
    ctx,
    answer,
    evidence,
    "high",
    [],
    top.map((s) => s.packageId),
  );
}

function general(
  ctx: RetrievedContext,
  knowledge: WorkbenchKnowledge,
): ChatAnswer {
  const s = knowledge.run.summary;
  const grade = knowledge.graph
    ? ` Graph grade ${knowledge.graph.health.grade}.`
    : "";
  const worst = [...knowledge.run.reports].sort((a, b) => a.score - b.score)[0];
  const answer = `This workspace has ${s.totalPackages} package(s) at ${s.averageScore}/100 average health (${s.failed} failing).${grade}`;
  const evidence: Evidence[] = [
    ev("health", `${s.passed} pass · ${s.warned} warn · ${s.failed} fail`),
  ];
  if (worst && worst.score < 100)
    evidence.push(
      ev("health", `Lowest: ${worst.package.name} at ${worst.score}/100`),
    );
  return make(
    ctx,
    answer,
    evidence,
    "medium",
    [],
    worst ? [worst.package.id] : [],
  );
}

function flakiestPackages(
  history: WorkbenchKnowledge["history"] = [],
): Array<{ id: string; count: number }> {
  const counts = new Map<string, number>();
  for (const run of history) {
    for (const p of run.packages) {
      if (p.status === "fail") counts.set(p.id, (counts.get(p.id) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count);
}
