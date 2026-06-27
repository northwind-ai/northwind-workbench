# Security Policy

## Supported Versions

The latest released version receives security fixes. Older versions are best-effort.

## Reporting a Vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately via GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
(Security → Report a vulnerability) or email **security@packageworkbench.dev**.

Please include:

- A description of the issue and its impact
- Steps to reproduce (a minimal repo helps)
- Affected version(s)

We aim to acknowledge within **3 business days** and to provide a remediation timeline
after triage. We'll credit reporters in the release notes unless you prefer otherwise.

## Security model & threat notes

Package Workbench **executes code from the workspace it scans**, by design:

- `runtime_import_check` imports a package's entry in a child Node process.
- `scenario_runner_check` runs plugin-contributed scenarios in-process.
- Plugins are loaded and run **in-process with full trust** (v1 model).

Therefore: **only run Package Workbench on repositories and plugins you trust**, the same
way you would run `pnpm install` or that repo's tests. Mitigations in place: child-process
isolation + timeouts for runtime imports, and all plugin filesystem/exec access is routed
through a capability object (`PluginContext`) to enable future sandboxing.

The Electron app keeps the renderer fully sandboxed (`contextIsolation`, `sandbox`, no
`nodeIntegration`, a strict CSP); all privileged work happens in the main process behind a
narrow IPC bridge.
