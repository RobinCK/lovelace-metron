import type { Flow, FlowNode } from './flows';

export interface NodeBox {
  readonly id: FlowNode;
  readonly value: number;
  readonly y: number;
  readonly h: number;
}

export interface Ribbon {
  readonly from: FlowNode;
  readonly to: FlowNode;
  readonly value: number;
  readonly y0: number;
  readonly y1: number;
  readonly h: number;
}

export interface SankeyLayout {
  readonly left: readonly NodeBox[];
  readonly right: readonly NodeBox[];
  readonly ribbons: readonly Ribbon[];
}

export const LEFT_ORDER: readonly FlowNode[] = ['solar', 'grid', 'battery'];
export const RIGHT_ORDER: readonly FlowNode[] = ['home', 'battery', 'grid', 'loss'];

const total = (flows: readonly Flow[], pick: (flow: Flow) => boolean): number =>
  flows.filter(pick).reduce((sum, flow) => sum + flow.value, 0);

const place = (
  order: readonly FlowNode[],
  valueOf: (node: FlowNode) => number,
  scale: number,
  height: number,
  gap: number,
): NodeBox[] => {
  const nodes = order.map((id) => ({ id, value: valueOf(id) })).filter((node) => node.value > 0);
  const used = nodes.reduce((sum, node) => sum + node.value * scale, 0) + gap * (nodes.length - 1);
  let y = Math.max(0, (height - used) / 2);

  return nodes.map((node) => {
    const box = { ...node, y, h: node.value * scale };

    y += box.h + gap;

    return box;
  });
};

const indexIn = (order: readonly FlowNode[], node: FlowNode): number => order.indexOf(node);

export const layoutSankey = (flows: readonly Flow[], height: number, gap: number): SankeyLayout => {
  const outOf = (node: FlowNode): number => total(flows, (flow) => flow.from === node);
  const into = (node: FlowNode): number => total(flows, (flow) => flow.to === node);
  const leftCount = LEFT_ORDER.filter((node) => outOf(node) > 0).length;
  const rightCount = RIGHT_ORDER.filter((node) => into(node) > 0).length;
  const sumLeft = LEFT_ORDER.reduce((sum, node) => sum + outOf(node), 0);
  const sumRight = RIGHT_ORDER.reduce((sum, node) => sum + into(node), 0);
  const usable = height - gap * Math.max(0, Math.max(leftCount, rightCount) - 1);
  const scale = usable / Math.max(sumLeft, sumRight, 1);
  const left = place(LEFT_ORDER, outOf, scale, height, gap);
  const right = place(RIGHT_ORDER, into, scale, height, gap);
  const leftCursor = new Map(left.map((node) => [node.id, node.y]));
  const rightCursor = new Map(right.map((node) => [node.id, node.y]));
  const y0 = new Map<Flow, number>();
  const y1 = new Map<Flow, number>();

  [...flows]
    .sort(
      (a, b) =>
        indexIn(LEFT_ORDER, a.from) - indexIn(LEFT_ORDER, b.from) ||
        indexIn(RIGHT_ORDER, a.to) - indexIn(RIGHT_ORDER, b.to),
    )
    .forEach((flow) => {
      const start = leftCursor.get(flow.from) ?? 0;

      y0.set(flow, start);
      leftCursor.set(flow.from, start + flow.value * scale);
    });

  [...flows]
    .sort(
      (a, b) =>
        indexIn(RIGHT_ORDER, a.to) - indexIn(RIGHT_ORDER, b.to) ||
        indexIn(LEFT_ORDER, a.from) - indexIn(LEFT_ORDER, b.from),
    )
    .forEach((flow) => {
      const start = rightCursor.get(flow.to) ?? 0;

      y1.set(flow, start);
      rightCursor.set(flow.to, start + flow.value * scale);
    });

  return {
    left,
    right,
    ribbons: flows.map((flow) => ({
      from: flow.from,
      to: flow.to,
      value: flow.value,
      y0: y0.get(flow) ?? 0,
      y1: y1.get(flow) ?? 0,
      h: flow.value * scale,
    })),
  };
};

const shift = (layout: SankeyLayout, offset: number): SankeyLayout => ({
  left: layout.left.map((node) => ({ ...node, y: node.y + offset })),
  right: layout.right.map((node) => ({ ...node, y: node.y + offset })),
  ribbons: layout.ribbons.map((ribbon) => ({
    ...ribbon,
    y0: ribbon.y0 + offset,
    y1: ribbon.y1 + offset,
  })),
});

export type LabelSize = (node: NodeBox) => number;

export const layoutWithLabels = (
  flows: readonly Flow[],
  height: number,
  gap: number,
  leftSize: LabelSize,
  rightSize: LabelSize,
): SankeyLayout => {
  const overhang = (node: NodeBox | undefined, size: LabelSize, top: boolean): number => {
    if (!node) return 0;

    const center = node.y + node.h / 2;

    return Math.max(0, size(node) / 2 - (top ? center : height - center));
  };
  let layout = layoutSankey(flows, height, gap);
  let top = 0;
  let bottom = 0;

  for (let pass = 0; pass < 3; pass++) {
    const extraTop = Math.max(
      overhang(layout.left[0], leftSize, true),
      overhang(layout.right[0], rightSize, true),
    );
    const extraBottom = Math.max(
      overhang(layout.left[layout.left.length - 1], leftSize, false),
      overhang(layout.right[layout.right.length - 1], rightSize, false),
    );

    if (extraTop + extraBottom < 0.5) break;

    top += extraTop;
    bottom += extraBottom;
    layout = shift(layoutSankey(flows, Math.max(0, height - top - bottom), gap), top);
  }

  return layout;
};

export const ribbonPath = (ribbon: Ribbon, x0: number, x1: number): string => {
  const mid = (x0 + x1) / 2;
  const top0 = ribbon.y0;
  const top1 = ribbon.y1;
  const bottom0 = ribbon.y0 + ribbon.h;
  const bottom1 = ribbon.y1 + ribbon.h;

  return [
    `M${x0},${top0.toFixed(2)}`,
    `C${mid},${top0.toFixed(2)} ${mid},${top1.toFixed(2)} ${x1},${top1.toFixed(2)}`,
    `L${x1},${bottom1.toFixed(2)}`,
    `C${mid},${bottom1.toFixed(2)} ${mid},${bottom0.toFixed(2)} ${x0},${bottom0.toFixed(2)}`,
    'Z',
  ].join(' ');
};

export const spread = (
  centers: readonly number[],
  size: number | readonly number[],
  height: number,
): number[] => {
  const result = [...centers];
  const half = (index: number): number =>
    (typeof size === 'number' ? size : (size[index] ?? size[0] ?? 0)) / 2;

  for (let index = 0; index < result.length; index++) {
    const floor = index === 0 ? half(0) : (result[index - 1] ?? 0) + half(index - 1) + half(index);

    result[index] = Math.max(result[index] ?? 0, floor);
  }

  for (let index = result.length - 1; index >= 0; index--) {
    const ceiling =
      index === result.length - 1
        ? height - half(index)
        : (result[index + 1] ?? 0) - half(index + 1) - half(index);

    result[index] = Math.min(result[index] ?? 0, ceiling);
  }

  return result;
};
