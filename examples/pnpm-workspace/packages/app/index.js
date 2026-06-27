import { PriceTag } from '@demo/ui';
import { formatMoney } from '@demo/core';

export const render = () => PriceTag(1999) + formatMoney(500);
