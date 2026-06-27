# Installation

Package Workbench ships as a **CLI** (run in any repo or CI) and a **desktop app**.

## CLI

Install as a dev dependency in the repo you want to validate:

```bash
pnpm add -D package-workbench       # or: npm i -D / yarn add -D
```

Then run it via your package runner:

```bash
pnpm package-workbench scan .       # or: npx package-workbench scan .
```

Or install globally:

```bash
npm install -g package-workbench
package-workbench --help
```

**Requirements:** Node.js ≥ 18.18. The CLI is cross-platform (Windows, macOS, Linux).

## Desktop app

Download the installer for your OS from the [Releases](https://github.com/<org>/package-workbench/releases) page:

| OS      | Artifact                                                             |
| ------- | -------------------------------------------------------------------- |
| Windows | `Package Workbench-<version>-x64.exe` (installer) or `…portable.exe` |
| macOS   | `Package Workbench-<version>-<arch>.dmg` (or `.zip`)                 |
| Linux   | `Package Workbench-<version>-x86_64.AppImage` or `.deb`              |

> macOS/Windows binaries are unsigned during early releases — you may need to allow the app
> in Gatekeeper / SmartScreen.

## From source

```bash
git clone https://github.com/<org>/package-workbench
cd package-workbench
pnpm install
pnpm dev          # run the desktop app
pnpm cli -- scan .   # run the CLI from source
```

## Security note

Package Workbench executes code from the workspace it scans (runtime import checks,
scenarios, plugins). Only run it on repositories you trust — see [SECURITY.md](../SECURITY.md).
Set `PW_NO_RUNTIME=1` to disable code execution, leaving only static checks.
