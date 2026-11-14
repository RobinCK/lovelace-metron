import { MetronCalendarCard } from './cards/calendar/calendar-card';
import { MetronDevicesCard } from './cards/devices/devices-card';
import { MetronEnergyDayCard } from './cards/energy-day/energy-day-card';
import { MetronFlowCard } from './cards/flow/flow-card';
import { MetronHistoryCard } from './cards/history/history-card';
import { MetronStatsCard } from './cards/stats/stats-card';
import { MetronLiveCard } from './cards/live/live-card';
import { MetronProfileCard } from './cards/profile/profile-card';
import { MetronSolarYearCard } from './cards/solar-year/solar-year-card';
import { MetronStatusCard } from './cards/status/status-card';
import { MetronTileCard } from './cards/tile/tile-card';
import { MetronWeekCompareCard } from './cards/week-compare/week-compare-card';
import { MetronYearCard } from './cards/year/year-card';

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
  {
    type: 'metron-energy-day-card',
    element: MetronEnergyDayCard,
    name: 'Metron · Energy day',
    description:
      'Half-hour production and consumption, forecast, sources and destinations of a day.',
  },
  {
    type: 'metron-stats-card',
    element: MetronStatsCard,
    name: 'Metron · Metrics',
    description:
      'Self-consumption, self-sufficiency and net grid energy for a period with comparison.',
  },
  {
    type: 'metron-history-card',
    element: MetronHistoryCard,
    name: 'Metron · Month history',
    description: 'Daily consumption or production of a month split by source, with averages.',
  },
  {
    type: 'metron-year-card',
    element: MetronYearCard,
    name: 'Metron · Year by months',
    description: 'Monthly generation and consumption for the last year with the net grid balance.',
  },
  {
    type: 'metron-week-compare-card',
    element: MetronWeekCompareCard,
    name: 'Metron · Period comparison',
    description:
      'This week against the same part of last week: energy, self-sufficiency, gas, outages.',
  },
  {
    type: 'metron-calendar-card',
    element: MetronCalendarCard,
    name: 'Metron · Daily calendar',
    description:
      'A month calendar with a ring per day for self-sufficiency or energy, and outage marks.',
  },
  {
    type: 'metron-profile-card',
    element: MetronProfileCard,
    name: 'Metron · Load profile',
    description:
      'Average power by weekday and hour over recent weeks with peak and night base load.',
  },
  {
    type: 'metron-solar-year-card',
    element: MetronSolarYearCard,
    name: 'Metron · Solar year',
    description: 'A year of daily solar production as a calendar heatmap with the best day.',
  },
];
