# Launch checklist

Run through this before tagging a public release.

## Code quality

- [ ] `pnpm install` clean on a fresh clone
- [ ] `pnpm typecheck` passes (all packages)
- [ ] `pnpm test` passes
- [ ] `pnpm lint` passes (Prettier)
- [ ] `pnpm build` builds every package (ESM/CJS/DTS)

## CLI

- [ ] `package-workbench --help` lists all commands
- [ ] `scan` / `runtime` / `graph` / `scenarios` / `report` / `ci` / `plugins` all run on a real repo
- [ ] `ci` exits non-zero on a regression and zero on a clean run
- [ ] Works under npm, pnpm, and yarn workspaces

## Example repositories

- [ ] `examples/simple-ts-package` — scans healthy
- [ ] `examples/pnpm-workspace` — graph builds, layered, acyclic
- [ ] `examples/nx-workspace` — Nx adapter discovers + classifies projects
- [ ] `examples/intentionally-broken-workspace` — surfaces cycles, missing deps, bad exports

## Desktop app

- [ ] `pnpm dev` launches; onboarding → Open Repository / Try Example works
- [ ] Command palette (Ctrl/Cmd+K), theme toggle (light/dark/system), filtering all work
- [ ] Runtime / Scenarios / Dependency Graph / History views render
- [ ] Renderer crash shows the fallback screen and recovers (not a white screen)
- [ ] "Open Logs Folder" opens the log directory

## Packaging (`pnpm package`)

- [ ] Windows: `.exe` installer + portable build run and install
- [ ] macOS: `.dmg` mounts and the app launches (x64 + arm64)
- [ ] Linux: `.AppImage` runs; `.deb` installs
- [ ] App icon + product name "Package Workbench" correct
- [ ] Version in artifact names matches `apps/desktop/package.json`

## Docs & meta

- [ ] README accurate; all doc links resolve
- [ ] CHANGELOG updated for the version
- [ ] LICENSE present (Apache-2.0); SECURITY/CONTRIBUTING/CoC present
- [ ] Issue + PR templates render on GitHub

## Release pipeline

- [ ] CI workflow green on `main`
- [ ] Tagging `v*` triggers the release workflow and uploads installers to the GitHub Release
- [ ] Reproducible: same tag → same artifacts (modulo signatures)

## Post-tag

- [ ] Download each installer from the Release and smoke-test
- [ ] Verify the published npm `package-workbench` CLI installs and runs
