# intentionally-broken-workspace

A deliberately broken workspace for demos + tests. It contains:

- a **dependency cycle** (`cycle-a ↔ cycle-b`)
- a **boundary-rule** target (`workbench.config.mjs`)
- a **broken exports map** + missing build output (`broken-exports`)
- a **missing dependency** (`missing-dep`)

Try:

```bash
package-workbench scan . --pretty
package-workbench graph . --pretty   # shows the cycle + violations
package-workbench ci .               # exits non-zero
```
