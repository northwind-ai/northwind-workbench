import { clamp } from '@nxdemo/util';

export const volume = (raw: number): number => clamp(raw, 0, 100);
