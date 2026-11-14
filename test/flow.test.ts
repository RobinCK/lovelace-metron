import { describe, expect, it } from 'vitest';
import { computeAutonomy, computeFlows, deriveHome } from '../src/cards/flow/flows';
import { layoutSankey, spread } from '../src/cards/flow/sankey';

describe('computeFlows', () => {
  it('splits solar between home, battery and grid export', () => {
    const flows = computeFlows({ solar: 9840, grid: -4120, battery: -2460, home: 3260 });

    expect(flows).toEqual([
      { from: 'solar', to: 'home', value: 3260 },
      { from: 'solar', to: 'battery', value: 2460 },
      { from: 'solar', to: 'grid', value: 4120 },
    ]);
  });

  it('covers the home from battery and grid at night', () => {
    const flows = computeFlows({ solar: 0, grid: 500, battery: 1500, home: 2000 });

    expect(flows).toEqual([
      { from: 'battery', to: 'home', value: 1500 },
      { from: 'grid', to: 'home', value: 500 },
    ]);
  });

  it('charges the battery from the grid', () => {
    const flows = computeFlows({ solar: 0, grid: 3000, battery: -2000, home: 1000 });

    expect(flows).toEqual([
      { from: 'grid', to: 'home', value: 1000 },
      { from: 'grid', to: 'battery', value: 2000 },
    ]);
  });

  it('derives the home load from the balance', () => {
    expect(deriveHome(5000, -1000, -1500)).toBe(2500);
    expect(deriveHome(0, -10, 0)).toBe(0);
  });
});

describe('computeAutonomy', () => {
  it('uses the energy above the reserve', () => {
    const autonomy = computeAutonomy(61, 16, 10, 2060);

    expect(autonomy?.energy).toBeCloseTo(8.16);
    expect(autonomy?.hours).toBeCloseTo(3.961, 2);
  });

  it('is unlimited without a load and unknown without a capacity', () => {
    expect(computeAutonomy(50, 16, 10, 0)?.hours).toBe(Number.POSITIVE_INFINITY);
    expect(computeAutonomy(50, undefined, 10, 1000)).toBeUndefined();
  });
});

describe('sankey layout', () => {
  it('keeps ribbons inside their nodes', () => {
    const flows = computeFlows({ solar: 9840, grid: -4120, battery: -2460, home: 3260 });
    const layout = layoutSankey(flows, 200, 10);
    const solar = layout.left[0];

    expect(layout.left).toHaveLength(1);
    expect(layout.right.map((node) => node.id)).toEqual(['home', 'battery', 'grid']);
    expect(solar?.h).toBeCloseTo(
      layout.ribbons.reduce((total, ribbon) => total + ribbon.h, 0),
      5,
    );
  });

  it('spreads labels without overlap', () => {
    const centers = spread([10, 20, 190], 60, 200);

    expect(centers[0]).toBeGreaterThanOrEqual(30);
    expect((centers[1] ?? 0) - (centers[0] ?? 0)).toBeGreaterThanOrEqual(60);
    expect(centers[2]).toBeLessThanOrEqual(170);
  });
});

import { dipCounts, repeatingWindow, yieldDeviation } from '../src/cards/strings/analysis';

describe('string analysis', () => {
  it('compares yields per kWp against the median', () => {
    const deviation = yieldDeviation([7.5, 7.1, 7.2, 6.1], [5.6, 5.6, 5.6, 5.6]);

    expect(deviation[3]).toBeCloseTo(6.1 / 7.15 - 1, 3);
  });

  it('finds a repeating dip window', () => {
    const day = [
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 0.4, 0.4, 1],
    ];
    const counts = dipCounts([day, day, day], [1, 1, 1], 0.25);

    expect(counts[2]).toEqual([0, 3, 3, 0]);
    expect(repeatingWindow(counts[2] ?? [], 2)).toEqual({ from: 1, to: 3, days: 3 });
  });
});
