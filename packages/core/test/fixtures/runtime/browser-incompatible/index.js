import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

export const readConfig = (path) => readFileSync(path, 'utf8');
export const run = (cmd) => spawn(cmd);
