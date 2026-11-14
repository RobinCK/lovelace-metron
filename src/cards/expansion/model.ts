export interface MonthInput {
  readonly days: number;
  readonly generation: number;
  readonly consumption: number;
  readonly shape: readonly number[];
}

export interface SystemSize {
  readonly pv: number;
  readonly battery: number;
}

export interface ModelSettings {
  readonly basePv: number;
  readonly loadShape: readonly number[];
  readonly usable: number;
  readonly efficiency: number;
}

export interface MonthResult {
  readonly imported: number;
  readonly exported: number;
}

export interface YearResult {
  readonly months: readonly MonthResult[];
  readonly imported: number;
  readonly exported: number;
  readonly generated: number;
  readonly selfSufficiency: number;
}

const sum = (values: readonly number[]): number =>
  values.reduce((total, value) => total + value, 0);

export const sunShape = (dayLength: number, noon: number): number[] => {
  const rise = noon - dayLength / 2;
  const raw = Array.from({ length: 24 }, (_, hour) => {
    let accumulated = 0;

    for (let step = 0; step < 4; step++) {
      const x = (hour + (step + 0.5) / 4 - rise) / dayLength;

      accumulated += x > 0 && x < 1 ? Math.sin(Math.PI * x) ** 1.3 : 0;
    }

    return accumulated / 4;
  });
  const total = sum(raw);

  return raw.map((value) => (total > 0 ? value / total : 0));
};

export const simulateMonth = (
  month: MonthInput,
  size: SystemSize,
  settings: ModelSettings,
): MonthResult => {
  const daily =
    settings.basePv > 0 ? (month.generation / month.days) * (size.pv / settings.basePv) : 0;
  const load = month.consumption / month.days;
  const loadTotal = sum(settings.loadShape) || 1;
  const usable = size.battery * settings.usable;
  const efficiency = settings.efficiency;
  let soc = usable / 2;
  let imported = 0;
  let exported = 0;

  for (let day = 0; day < 3; day++) {
    imported = 0;
    exported = 0;

    for (let hour = 0; hour < 24; hour++) {
      const net =
        (month.shape[hour] ?? 0) * daily - ((settings.loadShape[hour] ?? 0) / loadTotal) * load;

      if (net >= 0) {
        const charge = Math.min(net, (usable - soc) / efficiency);

        soc += charge * efficiency;
        exported += net - charge;
        continue;
      }

      const discharge = Math.min(-net, soc * efficiency);

      soc -= discharge / efficiency;
      imported += -net - discharge;
    }
  }

  return { imported: imported * month.days, exported: exported * month.days };
};

export const simulateYear = (
  months: readonly MonthInput[],
  size: SystemSize,
  settings: ModelSettings,
): YearResult => {
  const results = months.map((month) => simulateMonth(month, size, settings));
  const imported = sum(results.map((result) => result.imported));
  const consumption = sum(months.map((month) => month.consumption));

  return {
    months: results,
    imported,
    exported: sum(results.map((result) => result.exported)),
    generated:
      settings.basePv > 0
        ? sum(months.map((month) => month.generation)) * (size.pv / settings.basePv)
        : 0,
    selfSufficiency: consumption > 0 ? 1 - imported / consumption : 0,
  };
};

export const monthlyBalance = (
  result: MonthResult,
  price: number,
  exportPrice: number,
  netting: boolean,
): number => {
  if (!netting) return result.exported * exportPrice - result.imported * price;

  const net = result.exported - result.imported;

  return net >= 0 ? net * exportPrice : net * price;
};
