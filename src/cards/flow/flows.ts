export type FlowNode = 'solar' | 'grid' | 'battery' | 'home';

export interface PowerBalance {
  readonly solar: number;
  readonly grid: number;
  readonly battery: number;
  readonly home: number;
}

export interface Flow {
  readonly from: FlowNode;
  readonly to: FlowNode;
  readonly value: number;
}

const positive = (value: number): number => Math.max(0, value);

export const deriveHome = (solar: number, grid: number, battery: number): number =>
  positive(solar + grid + battery);

export const computeFlows = (balance: PowerBalance): Flow[] => {
  const solar = positive(balance.solar);
  const home = positive(balance.home);
  const gridIn = positive(balance.grid);
  const gridOut = positive(-balance.grid);
  const batteryOut = positive(balance.battery);
  const batteryIn = positive(-balance.battery);

  const solarToHome = Math.min(solar, home);
  const homeLeft = home - solarToHome;
  const batteryToHome = Math.min(batteryOut, homeLeft);
  const gridToHome = Math.min(gridIn, homeLeft - batteryToHome);
  const solarLeft = solar - solarToHome;
  const solarToBattery = Math.min(solarLeft, batteryIn);
  const solarToGrid = Math.min(solarLeft - solarToBattery, gridOut);
  const gridToBattery = Math.min(gridIn - gridToHome, batteryIn - solarToBattery);
  const batteryToGrid = Math.min(batteryOut - batteryToHome, gridOut - solarToGrid);

  const flows: Flow[] = [
    { from: 'solar', to: 'home', value: solarToHome },
    { from: 'solar', to: 'battery', value: solarToBattery },
    { from: 'solar', to: 'grid', value: solarToGrid },
    { from: 'battery', to: 'home', value: batteryToHome },
    { from: 'battery', to: 'grid', value: batteryToGrid },
    { from: 'grid', to: 'home', value: gridToHome },
    { from: 'grid', to: 'battery', value: gridToBattery },
  ];

  return flows.filter((flow) => flow.value > 0.5);
};

export interface Autonomy {
  readonly hours: number;
  readonly energy: number;
}

export const computeAutonomy = (
  soc: number | undefined,
  capacityKwh: number | undefined,
  reservePercent: number,
  loadWatts: number,
): Autonomy | undefined => {
  if (soc === undefined || !capacityKwh || capacityKwh <= 0) return undefined;

  const energy = (Math.max(0, soc - reservePercent) / 100) * capacityKwh;

  if (loadWatts <= 1) return { hours: Number.POSITIVE_INFINITY, energy };

  return { hours: energy / (loadWatts / 1000), energy };
};
