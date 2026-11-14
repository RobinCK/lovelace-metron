# Metron

A collection of Home Assistant Lovelace cards for energy, gas and solar data: live flows,
history, statistics, money, forecasts and analysis. Every card reads entities you already have,
uses Home Assistant long-term statistics where history matters, follows the active theme and is
translated (English and Ukrainian; any text can be overridden).

## Installation

### HACS

1. Open HACS → three dots → **Custom repositories**.
2. Add `https://github.com/RobinCK/lovelace-metron` with type **Dashboard**.
3. Install **Metron** and reload the browser.

### Manual

1. Download `metron.js` from the latest release.
2. Copy it to `config/www/metron.js`.
3. Add a dashboard resource `/local/metron.js` with type **JavaScript module**.

## Common options

Every card accepts these options:

| Option     | Type            | Default           | Description                                                                |
| ---------- | --------------- | ----------------- | -------------------------------------------------------------------------- |
| `title`    | string \| false | translated title  | Card title. `false` hides the header text.                                 |
| `language` | `en` \| `uk`    | Home Assistant UI | Language of the card texts.                                                |
| `labels`   | map             | —                 | Override any text by its translation key, e.g. `flow.home: House`.         |
| `colors`   | map             | theme-aware       | `solar`, `home`, `battery`, `grid`, `gas`, `warning`, `cold`, `ok` colors. |

Colors can also be set globally from a theme with `metron-solar-color`, `metron-home-color`,
`metron-battery-color`, `metron-grid-color`, `metron-gas-color`, `metron-warning-color`,
`metron-cold-color` and `metron-ok-color`.

Power sensors may report W or kW, energy sensors Wh, kWh or MWh, gas m³, L or ft³ — values are
converted automatically.

## Cards

### Energy flow — `custom:metron-flow-card`

Power flows between solar, grid, battery and home as a Sankey diagram. With the grid on it shows
battery and grid panels; during an outage it switches to battery autonomy with the time left, the
shortfall until sunrise and the load that would get you there.

```yaml
type: custom:metron-flow-card
solar: sensor.deye_pv_power
grid: sensor.deye_grid_power
battery: sensor.deye_battery_power
battery_soc: sensor.deye_battery_soc
home: sensor.deye_load_power
grid_status: binary_sensor.deye_grid_connected
battery_capacity: 16
battery_reserve: 10
battery_name: SE-F16-C
battery_temperature: sensor.deye_battery_temperature
solar_strings:
  - sensor.deye_pv1_power
  - sensor.deye_pv2_power
grid_frequency: sensor.deye_grid_frequency
grid_voltages:
  - sensor.grid_l1_voltage
  - sensor.grid_l2_voltage
  - sensor.grid_l3_voltage
```

| Option                | Default   | Description                                                                  |
| --------------------- | --------- | ---------------------------------------------------------------------------- |
| `solar`               | —         | Solar power.                                                                 |
| `grid`                | —         | Grid power, positive = import.                                               |
| `battery`             | —         | Battery power, positive = discharge.                                         |
| `home`                | derived   | Home power. Derived from the balance when omitted.                           |
| `battery_soc`         | —         | Battery state of charge, %.                                                  |
| `invert_grid`         | `false`   | Flip the grid sign if your sensor reports export as positive.                |
| `invert_battery`      | `false`   | Flip the battery sign if your sensor reports charge as positive.             |
| `grid_status`         | —         | Binary sensor / switch that is `on` while the grid is present.               |
| `invert_grid_status`  | `false`   | Use when the sensor is `on` during an outage.                                |
| `battery_capacity`    | —         | Usable capacity, kWh. Enables time to full / reserve and autonomy.           |
| `battery_reserve`     | `10`      | Reserve SOC, %.                                                              |
| `battery_name`        | —         | Shown in the battery panel title.                                            |
| `battery_temperature` | —         | Battery temperature sensor.                                                  |
| `solar_strings`       | —         | List of string power sensors (`entity`, optional `name`).                    |
| `grid_frequency`      | —         | Grid frequency sensor.                                                       |
| `grid_voltages`       | —         | List of phase voltage sensors (`entity`, optional `name`).                   |
| `voltage_min` / `max` | `207/253` | Allowed voltage range; values within `voltage_margin` (5 V) are highlighted. |
| `sun`                 | `sun.sun` | Sun entity for sunrise / sunset.                                             |
| `height`              | `216`     | Maximum Sankey height, px.                                                   |
| `animate`             | `true`    | Animated dots along the flows.                                               |
| `show_panels`         | `true`    | Battery and grid panels below the diagram.                                   |

### Status chips — `custom:metron-status-card`

A compact strip of entities. Each chip can show a progress bar, battery segments, phase marks and
a secondary line.

```yaml
type: custom:metron-status-card
chips:
  - entity: sensor.deye_pv_power
    name: Solar
    color: solar
    progress: sensor.deye_day_pv_energy
    progress_max: sensor.solar_forecast_today
    secondary: '{percent} % of forecast'
  - entity: sensor.deye_load_power
    color: home
  - entity: sensor.deye_battery_soc
    color: battery
    power: sensor.deye_battery_power
  - entity: sensor.deye_grid_power
    color: grid
    direction: true
    phases:
      - binary_sensor.grid_l1
      - binary_sensor.grid_l2
      - binary_sensor.grid_l3
```

Chip and tile options:

| Option            | Description                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------- |
| `entity`          | Main entity (required).                                                                   |
| `name` / `icon`   | Defaults to the entity name and icon.                                                     |
| `color`           | `solar`, `home`, `battery`, `grid`, `gas`, `warn`, `cold`, `ok` or any CSS color.         |
| `invert`          | Flip the sign of the value.                                                               |
| `digits`          | Fixed number of decimals.                                                                 |
| `secondary`       | Entity (shown as value) or text. `{percent}` is replaced with the progress percentage.    |
| `secondary_label` | Prefix for an entity secondary line, e.g. `outside`.                                      |
| `power`           | Battery power entity: shows `+2.46 kW · charging` (positive = discharge, `invert_power`). |
| `direction`       | Treat the value as signed grid power: shows the absolute value and import / export.       |
| `progress`        | Entity or number. Alone it is a percentage; with `progress_max` it is divided by the max. |
| `progress_max`    | Entity or number used as the progress maximum.                                            |
| `progress_style`  | `bar` or `segments` (battery entities default to segments).                               |
| `phases`          | Phase entities: binary sensors or voltages, shown as colored L1 L2 L3.                    |
| `sparkline`       | Tiles only: 24 hourly bars for today from long-term statistics.                           |

Card options: `chips` (list), `min_width` (minimum chip width, px, default `104`).

### Tiles — `custom:metron-tile-card`

A grid of tiles using the same item options as the status chips.

```yaml
type: custom:metron-tile-card
title: Energy
show_time: true
columns: 2
tiles:
  - entity: sensor.deye_pv_power
    color: solar
    secondary: sensor.deye_day_pv_energy
    sparkline: true
  - entity: sensor.indoor_temperature
    color: cold
    secondary: sensor.outdoor_temperature
    secondary_label: outside
```

### Live power — `custom:metron-live-card`

Bars for every step over the last minutes, the current value and the peak. Signed entities (grid,
battery) are drawn around a center line.

```yaml
type: custom:metron-live-card
minutes: 60
step: 1
entities:
  - entity: sensor.deye_pv_power
    color: solar
  - entity: sensor.deye_load_power
    color: home
  - entity: sensor.deye_battery_power
    color: battery
    invert: true
  - entity: sensor.deye_grid_power
    color: grid
```

Options: `entities` (`entity`, `name`, `color`, `invert`, `max`), `minutes` (`60`), `step`
(minutes per bar, `1`), `height` (row height, `36`).

### Consumers — `custom:metron-devices-card`

Power now and energy today per device, the share of each device, 24 hourly bars and a run state
(running for, always on, finished at, idle). With a total power or energy sensor the remainder is
shown as an unaccounted row.

```yaml
type: custom:metron-devices-card
total_power: sensor.deye_load_power
total_energy: sensor.deye_day_load_energy
devices:
  - name: Water heater
    power: sensor.boiler_power
    energy: sensor.boiler_energy
    icon: mdi:water-boiler
  - name: Washing machine
    power: sensor.washer_power
    cycle: true
  - name: Network
    power: sensor.network_power
    note: UniFi, NVR
```

| Option             | Default  | Description                                                                         |
| ------------------ | -------- | ----------------------------------------------------------------------------------- |
| `devices`          | —        | `name`, `power`, `energy`, `icon`, `color`, `threshold`, `status`, `note`, `cycle`. |
| `total_power`      | —        | House power sensor for the header and the unaccounted row.                          |
| `total_energy`     | —        | House energy sensor (any counter) for the unaccounted row.                          |
| `threshold`        | `10`     | Power above which a device counts as running, W.                                    |
| `sort`             | `energy` | `energy`, `power` or `none`.                                                        |
| `sparkline`        | `true`   | Hourly bars for today.                                                              |
| `show_unaccounted` | `true`   | Show the remainder when a total is configured.                                      |

Energy today comes from long-term statistics, so lifetime counters and daily meters both work.
Without an energy sensor the energy is integrated from 5-minute power statistics. A `status`
entity replaces the run state text, `cycle: true` shows when the last run finished.

### Energy sensors for statistics cards

Cards that work with history read **long-term statistics** of energy counters. Every option takes
one entity or a list. Anything you leave out is taken from the Home Assistant **energy dashboard**
(`energy_dashboard: false` turns this off), so with a configured energy dashboard these cards work
without any options.

| Option                     | Description                                                       |
| -------------------------- | ----------------------------------------------------------------- |
| `solar_energy`             | Solar production counter(s).                                      |
| `home_energy`              | Home consumption counter(s). Derived from the balance if omitted. |
| `grid_import_energy`       | Energy taken from the grid.                                       |
| `grid_export_energy`       | Energy sent to the grid.                                          |
| `battery_charge_energy`    | Energy into the battery.                                          |
| `battery_discharge_energy` | Energy out of the battery.                                        |
| `energy_dashboard`         | Fill missing sources from the energy dashboard. Default `true`.   |

Counters can be daily meters or lifetime totals. The ongoing hour is added from the live state.

### Energy day — `custom:metron-energy-day-card`

Half-hour production above the axis and consumption below it, the solar forecast for the rest of
the day, where the energy came from and where it went, self-sufficiency, self-consumption and the
solar peak. Arrows switch days.

```yaml
type: custom:metron-energy-day-card
solar_power: sensor.deye_pv_power
home_power: sensor.deye_load_power
```

| Option                  | Default | Description                                                                |
| ----------------------- | ------- | -------------------------------------------------------------------------- |
| `solar_power`           | —       | Power sensor for the half-hour profile and the peak (5-minute statistics). |
| `home_power`            | —       | Power sensor for the consumption profile.                                  |
| `solar_forecast`        | `auto`  | `auto` uses the energy dashboard forecast, `off` hides it.                 |
| `solar_forecast_entity` | —       | Sensor with today's forecast in kWh for the summary line.                  |
| `slot_minutes`          | `30`    | `30` or `60`.                                                              |
| `navigation`            | `true`  | Day arrows.                                                                |

Without power sensors the profile is built from hourly energy.

### Metrics — `custom:metron-stats-card`

Self-consumption, self-sufficiency and the net grid balance as gauges, with totals and a
comparison with the same part of the previous period.

```yaml
type: custom:metron-stats-card
period: month
```

Options: `period` (`day`, `week`, `month`, `year`; default `month`), `compare` (`true`).

### Month history — `custom:metron-history-card`

Daily bars for a month split by source (solar, battery, grid), the average line, the maximum and
the change against the previous month. `mode: production` splits solar production into self-used,
battery and export instead.

Options: `mode` (`consumption` / `production`), `navigation` (`true`), `height` (`120`).

### Year by months — `custom:metron-year-card`

Generation and consumption per month for the last year and the net grid balance per month.

Options: `months` (`12`), `height` (`100`).

### Period comparison — `custom:metron-week-compare-card`

This week until now against the same span of last week, as rows with a diverging bar per metric.

```yaml
type: custom:metron-week-compare-card
period: week
gas: sensor.gas_meter
grid_status: binary_sensor.deye_grid_connected
metrics: [generation, consumption, import, export, self_sufficiency, gas, outage]
```

Options: `period` (`day`, `week`, `month`, `year`), `metrics` (any of `generation`, `consumption`,
`import`, `export`, `self_sufficiency`, `self_consumption`, `gas`, `outage`), `gas` (gas counter),
`grid_status` and `invert_grid_status` (for hours without grid), `scale` (bar scale, %, `60`).

### Daily calendar — `custom:metron-calendar-card`

A month calendar with a ring per day. Self-sufficiency is colored by level; energy metrics are
relative to the best day of the month. With `grid_status` days with outages get a mark.

Options: `metric` (`self_sufficiency`, `self_consumption`, `solar`, `home`, `import`, `export`),
`high` / `low` (`70` / `40`), `grid_status`, `invert_grid_status`, `navigation`, `first_weekday`
(`1` = Monday, `0` = Sunday).

### Load profile — `custom:metron-profile-card`

Average power by weekday and hour over the last weeks, the peak, the night base load and the
average daily consumption on weekdays and weekends.

Options: `entity` (power sensor or energy counter; home consumption from the energy sensors when
omitted), `weeks` (`4`), `color`, `night_start` / `night_end` (`1` / `5`), `first_weekday`.

### Solar year — `custom:metron-solar-year-card`

A year of daily solar production as a calendar heatmap with the year total, the best and the
average day.

Options: `entity` (solar energy counter; energy sensors when omitted), `weeks` (`53`), `good_day`
(kWh, counts the days above it), `max` (kWh for the full color), `color`, `first_weekday`.

## Development

```bash
npm install
npm run build      # dist/metron.js
npm run lint
npm run typecheck
npm test
```

## License

MIT
