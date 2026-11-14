import type { CustomCardEntry } from './types/ha';

declare global {
  const __METRON_VERSION__: string;

  interface Window {
    customCards?: CustomCardEntry[];
  }
}

export {};
