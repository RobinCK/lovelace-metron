import type { RawConfig } from '../../core/base-card';
import * as cfg from '../../core/config';
import { readNumber } from '../../core/entities';
import type { HomeAssistant } from '../../types/ha';

export type Price = string | number;

export const parsePrice = (raw: RawConfig, key: string): Price | undefined =>
  cfg.entity(raw, key) ?? cfg.optionalNumber(raw, key);

export const priceOf = (hass: HomeAssistant, price: Price | undefined): number | undefined => {
  if (price === undefined) return undefined;
  if (typeof price === 'number') return price;

  return readNumber(hass, price);
};

export const currencyOf = (
  hass: HomeAssistant,
  configured: string | undefined,
): string | undefined => configured ?? hass.config?.currency;
