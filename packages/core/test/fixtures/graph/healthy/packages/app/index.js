// Imports @h/core directly even though only @h/ui and @h/auth are declared —
// exercises import-level discovery (this edge is "undeclared").
import { thing } from '@h/core';

export const start = () => thing;
