import { MetronDevicesCard } from './cards/devices/devices-card';
import { MetronFlowCard } from './cards/flow/flow-card';
import { MetronLiveCard } from './cards/live/live-card';
import { MetronStatusCard } from './cards/status/status-card';
import { MetronTileCard } from './cards/tile/tile-card';

export interface CardDefinition {
  readonly type: string;
  readonly element: CustomElementConstructor;
  readonly name: string;
  readonly description: string;
}

export const CARDS: readonly CardDefinition[] = [
  {
    type: 'metron-flow-card',
    element: MetronFlowCard,
    name: 'Metron · Energy flow',
    description:
      'Power flows between solar, grid, battery and home, with battery autonomy when the grid is off.',
  },
  {
    type: 'metron-status-card',
    element: MetronStatusCard,
    name: 'Metron · Status chips',
    description: 'A compact row of entities with progress bars, battery segments and phase marks.',
  },
  {
    type: 'metron-tile-card',
    element: MetronTileCard,
    name: 'Metron · Tiles',
    description: 'A grid of entity tiles with optional hourly sparklines for today.',
  },
  {
    type: 'metron-live-card',
    element: MetronLiveCard,
    name: 'Metron · Live power',
    description: 'Minute-by-minute bars for the last hour with current and peak values.',
  },
  {
    type: 'metron-devices-card',
    element: MetronDevicesCard,
    name: 'Metron · Consumers',
    description: 'Device power and energy today with shares, hourly sparklines and run states.',
  },
];
