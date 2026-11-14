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
