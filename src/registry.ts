import { MetronBaseloadCard } from './cards/baseload/baseload-card';
import { MetronBudgetCard } from './cards/budget/budget-card';
import { MetronCalendarCard } from './cards/calendar/calendar-card';
import { MetronClockCard } from './cards/clock/clock-card';
import { MetronCorridorCard } from './cards/corridor/corridor-card';
import { MetronDevicesCard } from './cards/devices/devices-card';
import { MetronDurationCard } from './cards/duration/duration-card';
import { MetronEnergyDayCard } from './cards/energy-day/energy-day-card';
import { MetronExpansionCard } from './cards/expansion/expansion-card';
import { MetronFlowCard } from './cards/flow/flow-card';
import { MetronForecastAccuracyCard } from './cards/forecast-accuracy/forecast-accuracy-card';
import { MetronForecastCard } from './cards/forecast/forecast-card';
import { MetronGasCard } from './cards/gas/gas-card';
import { MetronHistoryCard } from './cards/history/history-card';
import { MetronLiveCard } from './cards/live/live-card';
import { MetronLossesCard } from './cards/losses/losses-card';
import { MetronMoneyCard } from './cards/money/money-card';
import { MetronNightsCard } from './cards/nights/nights-card';
import { MetronProfileCard } from './cards/profile/profile-card';
import { MetronSeasonCard } from './cards/season/season-card';
import { MetronSkyCard } from './cards/sky/sky-card';
import { MetronSolarYearCard } from './cards/solar-year/solar-year-card';
import { MetronStatsCard } from './cards/stats/stats-card';
import { MetronStatusCard } from './cards/status/status-card';
import { MetronStringsCard } from './cards/strings/strings-card';
import { MetronTariffCard } from './cards/tariff/tariff-card';
import { MetronTileCard } from './cards/tile/tile-card';
import { MetronWeekAheadCard } from './cards/week-ahead/week-ahead-card';
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
  {
    type: 'metron-gas-card',
    element: MetronGasCard,
    name: 'Metron · Gas',
    description:
      'Monthly gas use with temperatures, degree-days, specific use and boiler run time.',
  },
  {
    type: 'metron-season-card',
    element: MetronSeasonCard,
    name: 'Metron · Heating season',
    description: 'Cumulative gas for the heating season against last season with a forecast.',
  },
  {
    type: 'metron-money-card',
    element: MetronMoneyCard,
    name: 'Metron · Money',
    description:
      'Electricity and gas bill of the month with net metering, export income and savings.',
  },
  {
    type: 'metron-tariff-card',
    element: MetronTariffCard,
    name: 'Metron · Tariff zones',
    description:
      'What your import would cost on time-of-use plans, including a battery shift scenario.',
  },
  {
    type: 'metron-budget-card',
    element: MetronBudgetCard,
    name: 'Metron · Monthly limit',
    description: 'Cumulative import, consumption or gas against a monthly budget with a forecast.',
  },
  {
    type: 'metron-losses-card',
    element: MetronLossesCard,
    name: 'Metron · Losses',
    description:
      'Energy lost in conversion stages such as stabilizers, inverters and battery cycles.',
  },
  {
    type: 'metron-forecast-card',
    element: MetronForecastCard,
    name: 'Metron · Solar forecast',
    description: 'Solar forecast for the next days with the typical load and the surplus window.',
  },
  {
    type: 'metron-forecast-accuracy-card',
    element: MetronForecastAccuracyCard,
    name: 'Metron · Forecast accuracy',
    description:
      'Daily solar forecast against actual production with the mean error, bias and correction.',
  },
  {
    type: 'metron-week-ahead-card',
    element: MetronWeekAheadCard,
    name: 'Metron · Week ahead',
    description: 'Seven days of weather with expected solar, gas use and planned outages.',
  },
  {
    type: 'metron-sky-card',
    element: MetronSkyCard,
    name: 'Metron · Sun and sky',
    description:
      'The sun path for today, cloud cover by hour, day length and solar output against the best hour.',
  },
  {
    type: 'metron-clock-card',
    element: MetronClockCard,
    name: 'Metron · Day clock',
    description:
      'Hourly solar production and home consumption around a 24-hour dial with the forecast.',
  },
  {
    type: 'metron-strings-card',
    element: MetronStringsCard,
    name: 'Metron · PV strings',
    description:
      'Per-string production today against the median, with repeating dips that hint at shade.',
  },
  {
    type: 'metron-baseload-card',
    element: MetronBaseloadCard,
    name: 'Metron · Base load',
    description:
      'The night minimum of the house by day, step changes and what the always-on load is made of.',
  },
  {
    type: 'metron-nights-card',
    element: MetronNightsCard,
    name: 'Metron · Nights on battery',
    description:
      'Battery charge in the evening against the overnight minimum and the grid import of every night.',
  },
  {
    type: 'metron-duration-card',
    element: MetronDurationCard,
    name: 'Metron · Load duration',
    description:
      'How many hours the house spends at each load level, with phase peaks against the limit.',
  },
  {
    type: 'metron-corridor-card',
    element: MetronCorridorCard,
    name: 'Metron · Normal corridor',
    description:
      'Today by hour against the usual range of the same weekday, with time spent outside it.',
  },
  {
    type: 'metron-expansion-card',
    element: MetronExpansionCard,
    name: 'Metron · Solar expansion',
    description:
      'A year model of more panels or a bigger battery: self-sufficiency, import and money.',
  },
];
