import { formatMoney } from '@demo/core';

export const PriceTag = (cents) => `<span class="price">${formatMoney(cents)}</span>`;
