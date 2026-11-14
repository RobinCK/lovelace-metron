import { MetronFlowCard } from './cards/flow/flow-card';

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
];
