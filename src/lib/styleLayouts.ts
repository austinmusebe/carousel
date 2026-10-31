import type {
  DisplayMode,
  GeometricCurve,
  GeometricTile,
  RollableMode,
  StyleflowMode,
  WallLayout,
  WallpaperEntry,
} from '../types';

export const STYLEFLOW_MODES: StyleflowMode[] = [
  'depth',
  'geometric',
  'wall',
  'sandy',
  'hand',
  'collection',
  'duel',
];

const ROLLABLE_MODES: RollableMode[] = ['carousel', 'shard', 'card', ...STYLEFLOW_MODES];
const DISPLAY_MODES: DisplayMode[] = [...ROLLABLE_MODES, 'random'];
const TILES: GeometricTile[] = ['hexagon', 'triangle', 'diamond', 'rhombus'];
const CURVES: GeometricCurve[] = ['flat', 'arc', 'wave', 's', 'cylinder'];
const WALLS: WallLayout[] = ['uniform', 'brick', 'masonry', 'justified', 'editorial', 'cylinder'];

export function parseDisplayMode(mode?: string | null): DisplayMode {
  return DISPLAY_MODES.find((m) => m === mode) ?? 'shard';
}

export interface StyleRoll {
  mode: RollableMode;
  tile: GeometricTile;
  curve: GeometricCurve;
  wall: WallLayout;
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

/** Never repeats `previous`, so every reopen visibly changes style. */
export function rollStyle(previous?: RollableMode): StyleRoll {
  return {
    mode: pickRandom(ROLLABLE_MODES.filter((mode) => mode !== previous)),
    tile: pickRandom(TILES),
    curve: pickRandom(CURVES),
    wall: pickRandom(WALLS),
  };
}

export function isStyleflowMode(mode: DisplayMode): mode is StyleflowMode {
  return (STYLEFLOW_MODES as DisplayMode[]).includes(mode);
}

export function isGridMode(mode: StyleflowMode): boolean {
  return mode === 'geometric' || mode === 'wall';
}

export interface LayoutOptions {
  vw: number;
  vh: number;
  tile: GeometricTile;
  curve: GeometricCurve;
  wall: WallLayout;
}

export interface CardPose {
  key: string;
  index: number;
  isActive: boolean;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  rotate: number;
  rotateY: number;
  skew: number;
  opacity: number;
  zIndex: number;
  radius: number;
  clip?: string;
}

export interface GridCell {
  x: number;
  y: number;
  w: number;
  h: number;
  clip?: string;
}

type StripPose = Partial<Omit<CardPose, 'key' | 'index' | 'isActive'>> | null;

const STRIP_RADIUS = 7;
const WALL_GAP = 12;
const GEOMETRIC_ROWS = 4;

const TILE_ASPECT: Record<GeometricTile, number> = {
  triangle: 1.15,
  hexagon: 1.155,
  diamond: 1,
  rhombus: 1.5,
};

function mod(value: number, count: number): number {
  return ((value % count) + count) % count;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function depthPose(o: number, { vh }: LayoutOptions): StripPose {
  const h = Math.min(vh * 0.62, 520);
  const w = h * 1.6;
  const shiftX = -w * 0.12;
  if (o < 0) {
    return o === -1 ? { x: shiftX - w, y: h * 0.1, z: 260, w, h, opacity: 0 } : null;
  }
  const distance = o / (1 + o * 0.16);
  return {
    x: shiftX + distance * w * 0.34,
    y: -distance * h * 0.1,
    z: -distance * 360,
    rotateY: o === 0 ? 0 : -14,
    w,
    h,
    opacity: Math.max(0, 1 - o * 0.11),
    zIndex: 40 - o,
    radius: 10,
  };
}

function duelSize(distance: number, vh: number): { w: number; h: number } {
  const tall = Math.min(vh * 0.66, 560);
  const base = tall * 0.62;
  if (distance === 0) return { w: base * 1.5, h: tall };
  return {
    w: base * 0.5 * Math.max(0.58, 1 - (distance - 1) * 0.1),
    h: tall * Math.max(0.6, 0.82 - distance * 0.05),
  };
}

function duelPose(o: number, { vh }: LayoutOptions): StripPose {
  const gap = 14;
  const distance = Math.abs(o);
  const size = duelSize(distance, vh);
  let x = 0;
  for (let d = 1; d <= distance; d++) {
    x += duelSize(d - 1, vh).w / 2 + gap + duelSize(d, vh).w / 2;
  }
  return {
    ...size,
    x: Math.sign(o) * x,
    y: vh * 0.03,
    skew: -10,
    zIndex: 30 - distance,
    radius: 6,
  };
}

function handPose(o: number, { vh }: LayoutOptions): StripPose {
  const h = Math.min(vh * 0.62, 480);
  const radius = vh * 1.25;
  const angle = (o * 8 * Math.PI) / 180;
  const isActive = o === 0;
  return {
    x: Math.sin(angle) * radius,
    y: (1 - Math.cos(angle)) * radius + vh * 0.13 - (isActive ? 44 : 0),
    w: h * 0.68 * (isActive ? 1.1 : 1),
    h: h * (isActive ? 1.1 : 1),
    rotate: o * 8,
    opacity: Math.abs(o) > 6 ? 0 : 1,
    zIndex: isActive ? 40 : 30 - Math.abs(o),
    radius: 12,
  };
}

function collectionPose(o: number, { vw, vh }: LayoutOptions): StripPose {
  const h = Math.min(vh * 0.66, 540);
  const w = Math.min(h * 1.6, vw * 0.5);
  if (o === 0) return { w, h, zIndex: 40, radius: 12 };

  const side = Math.sign(o);
  const distance = Math.abs(o);
  const pileW = w * 0.62;
  return {
    x: side * (w / 2 + pileW * 0.14 + distance * 26),
    y: distance * 6,
    z: -distance * 20,
    w: pileW,
    h: h * 0.62,
    rotate: side * (distance % 2 === 0 ? -2 : 6),
    opacity: distance > 6 ? 0 : 1 - distance * 0.08,
    zIndex: 30 - distance,
    radius: 10,
  };
}

export function sandyHero({ vw, vh }: Pick<LayoutOptions, 'vw' | 'vh'>) {
  const h = vh * 0.5;
  const w = Math.min(h * 1.78, vw * 0.8);
  return { x: (vw - w) / 2, y: vh * 0.44 - h / 2, w, h };
}

function sandyPose(o: number, { vh }: LayoutOptions): StripPose {
  const h = vh * 0.19;
  const w = h * 0.62;
  const isActive = o === 0;
  return {
    x: o * (w + 12),
    y: vh * 0.335,
    w: w * (isActive ? 1.2 : 1),
    h: h * (isActive ? 1.08 : 1),
    skew: -16,
    zIndex: isActive ? 30 : 20 - Math.abs(o),
    radius: 4,
  };
}

const STRIP_POSES: Record<
  Exclude<StyleflowMode, 'geometric' | 'wall'>,
  { radius: number; pose: (offset: number, options: LayoutOptions) => StripPose }
> = {
  depth: { radius: 8, pose: depthPose },
  duel: { radius: 7, pose: duelPose },
  hand: { radius: 7, pose: handPose },
  collection: { radius: 7, pose: collectionPose },
  sandy: { radius: 12, pose: sandyPose },
};

function geometricCells(count: number, { vh, tile }: LayoutOptions): GridCell[] {
  const gap = 6;
  // Half a row extra, because alternate columns sit half a tile lower
  const h = (vh * 0.74) / (GEOMETRIC_ROWS + 0.5) - gap;
  const w = h * TILE_ASPECT[tile];
  const pitchY = h + gap;

  return Array.from({ length: count }, (_, i) => {
    const col = Math.floor(i / GEOMETRIC_ROWS);
    const row = i % GEOMETRIC_ROWS;
    const y = (row - GEOMETRIC_ROWS / 2 + 0.25) * pitchY + vh * 0.05;

    switch (tile) {
      case 'hexagon':
        return {
          x: col * (w * 0.75 + gap),
          y: y + (col % 2 ? pitchY / 2 : 0),
          w,
          h,
          clip: 'polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)',
        };
      case 'diamond':
        return {
          x: col * (w * 0.5 + gap),
          y: y + (col % 2 ? pitchY / 2 : 0),
          w,
          h,
          clip: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
        };
      case 'rhombus':
        return {
          x: col * (w * 0.75 + gap) - row * w * 0.25,
          y,
          w,
          h,
          clip: 'polygon(25% 0, 100% 0, 75% 100%, 0 100%)',
        };
      default:
        return {
          x: col * (w * 0.5 + gap),
          y,
          w,
          h,
          clip:
            (col + row) % 2
              ? 'polygon(0 0, 100% 0, 50% 100%)'
              : 'polygon(50% 0, 100% 100%, 0 100%)',
        };
    }
  });
}

function aspectOf(entry: WallpaperEntry): number {
  return entry.width > 0 && entry.height > 0 ? clamp(entry.width / entry.height, 0.7, 2) : 1.6;
}

function masonryCells(images: WallpaperEntry[], cols: number, cellW: number): GridCell[] {
  const heights = new Array<number>(cols).fill(0);
  return images.map((entry) => {
    const col = heights.indexOf(Math.min(...heights));
    const h = cellW / aspectOf(entry);
    const cell = { x: col * (cellW + WALL_GAP), y: heights[col], w: cellW, h };
    heights[col] += h + WALL_GAP;
    return cell;
  });
}

function justifiedCells(images: WallpaperEntry[], width: number, rowH: number): GridCell[] {
  const cells: GridCell[] = [];
  let row: WallpaperEntry[] = [];
  let y = 0;

  const flushRow = (fill: boolean) => {
    const gaps = WALL_GAP * (row.length - 1);
    const naturalW = row.reduce((sum, entry) => sum + aspectOf(entry) * rowH, 0);
    const scale = fill ? (width - gaps) / naturalW : 1;
    let x = 0;
    for (const entry of row) {
      const w = aspectOf(entry) * rowH * scale;
      cells.push({ x, y, w, h: rowH * scale });
      x += w + WALL_GAP;
    }
    y += rowH * scale + WALL_GAP;
    row = [];
  };

  for (const entry of images) {
    row.push(entry);
    const rowW = row.reduce((sum, e) => sum + aspectOf(e) * rowH + WALL_GAP, -WALL_GAP);
    if (rowW >= width) flushRow(true);
  }
  if (row.length > 0) flushRow(false);
  return cells;
}

function editorialCells(count: number, cols: number, cellW: number, cellH: number): GridCell[] {
  const taken = new Set<string>();
  const isFree = (col: number, row: number) => col < cols && !taken.has(`${col}:${row}`);

  return Array.from({ length: count }, (_, i) => {
    const span = i % 6 === 0 ? 2 : 1;
    let row = 0;
    let col = 0;
    for (; ; row++) {
      col = 0;
      while (col < cols) {
        const fits =
          span === 1 ||
          (isFree(col, row) &&
            isFree(col + 1, row) &&
            isFree(col, row + 1) &&
            isFree(col + 1, row + 1));
        if (isFree(col, row) && fits) break;
        col++;
      }
      if (col < cols) break;
    }
    for (let c = col; c < col + span; c++) {
      for (let r = row; r < row + span; r++) taken.add(`${c}:${r}`);
    }
    return {
      x: col * (cellW + WALL_GAP),
      y: row * (cellH + WALL_GAP),
      w: span * cellW + (span - 1) * WALL_GAP,
      h: span * cellH + (span - 1) * WALL_GAP,
    };
  });
}

function wallCells(images: WallpaperEntry[], { vw, wall }: LayoutOptions): GridCell[] {
  const width = vw * 0.86;
  const cols = clamp(Math.round(width / 270), 3, 7);
  const cellW = (width - WALL_GAP * (cols - 1)) / cols;
  const cellH = cellW * 0.62;

  let cells: GridCell[];
  if (wall === 'masonry') {
    cells = masonryCells(images, cols, cellW);
  } else if (wall === 'justified') {
    cells = justifiedCells(images, width, cellH);
  } else if (wall === 'editorial') {
    cells = editorialCells(images.length, cols, cellW, cellH);
  } else {
    cells = images.map((_, i) => {
      const row = Math.floor(i / cols);
      const brickShift = wall === 'brick' && row % 2 ? (cellW + WALL_GAP) / 2 : 0;
      return {
        x: (i % cols) * (cellW + WALL_GAP) + brickShift,
        y: row * (cellH + WALL_GAP),
        w: cellW,
        h: cellH,
      };
    });
  }

  // Cells are built from the top-left; poses need centres around the wall's middle
  return cells.map((cell) => ({
    ...cell,
    x: cell.x + cell.w / 2 - width / 2,
    y: cell.y + cell.h / 2,
  }));
}

export function buildGrid(
  mode: StyleflowMode,
  images: WallpaperEntry[],
  options: LayoutOptions
): GridCell[] {
  if (mode === 'geometric') return geometricCells(images.length, options);
  if (mode === 'wall') return wallCells(images, options);
  return [];
}

/** Nearest cell inside a 45-degree cone in the pressed direction, or the next in sequence at an edge. */
export function gridNeighbor(cells: GridCell[], index: number, dx: number, dy: number): number {
  const from = cells[index];
  if (!from) return index;

  let best = mod(index + (dx + dy > 0 ? 1 : -1), cells.length);
  let bestScore = Infinity;
  cells.forEach((cell, i) => {
    const vx = cell.x - from.x;
    const vy = cell.y - from.y;
    const along = vx * dx + vy * dy;
    const across = Math.abs(vx * dy - vy * dx);
    if (i === index || along <= 1 || across > along) return;
    const score = along + across * 2;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

function bendPose(
  cell: GridCell,
  u: number,
  curve: GeometricCurve,
  { vw, vh }: LayoutOptions
): Pick<CardPose, 'x' | 'y' | 'z' | 'rotate' | 'rotateY'> {
  const flat = { x: cell.x, y: cell.y, z: 0, rotate: 0, rotateY: 0 };
  switch (curve) {
    case 'arc':
      return { ...flat, y: cell.y + u * u * vh * 0.14, rotate: u * 7 };
    case 'wave':
      return { ...flat, y: cell.y + Math.sin(u * Math.PI * 1.5) * vh * 0.07 };
    case 's':
      return {
        ...flat,
        y: cell.y + Math.sin(u * Math.PI) * vh * 0.09,
        rotate: Math.cos(u * Math.PI) * 5,
      };
    case 'cylinder': {
      const angle = clamp(u, -1.3, 1.3) * 1.1;
      return {
        ...flat,
        x: Math.sin(angle) * vw * 0.5,
        z: (Math.cos(angle) - 1) * vw * 0.35,
        rotateY: (-angle * 180) / Math.PI,
      };
    }
    default:
      return flat;
  }
}

function gridPoses(
  mode: StyleflowMode,
  cells: GridCell[],
  active: number,
  options: LayoutOptions
): CardPose[] {
  const { vw, vh, curve, wall } = options;
  const origin = cells[active];
  if (!origin) return [];

  const isWall = mode === 'wall';
  const camX = isWall ? 0 : origin.x;
  const camY = isWall ? origin.y : 0;
  const cellCurve: GeometricCurve = isWall ? (wall === 'cylinder' ? 'cylinder' : 'flat') : curve;

  const poses: CardPose[] = [];
  cells.forEach((cell, index) => {
    const x = cell.x - camX;
    const y = cell.y - camY;
    if (Math.abs(x) > vw * 0.68 || Math.abs(y) > vh * 0.75) return;

    const isActive = index === active;
    const scale = isActive && !isWall ? 1.12 : 1;
    poses.push({
      key: `cell-${index}`,
      index,
      isActive,
      ...bendPose({ ...cell, x, y }, x / (vw / 2), cellCurve, options),
      w: cell.w * scale,
      h: cell.h * scale,
      skew: 0,
      opacity: 1,
      zIndex: isActive ? 40 : 10,
      radius: cell.clip ? 0 : 8,
      clip: cell.clip,
    });
  });
  return poses;
}

function stripPoses(
  mode: Exclude<StyleflowMode, 'geometric' | 'wall'>,
  virtualIndex: number,
  count: number,
  options: LayoutOptions
): CardPose[] {
  const { radius, pose } = STRIP_POSES[mode];
  const poses: CardPose[] = [];

  for (let offset = -radius; offset <= radius; offset++) {
    const slot = pose(offset, options);
    if (!slot) continue;
    const vIndex = virtualIndex + offset;
    poses.push({
      x: 0,
      y: 0,
      z: 0,
      w: 0,
      h: 0,
      rotate: 0,
      rotateY: 0,
      skew: 0,
      opacity: 1,
      zIndex: 20,
      radius: STRIP_RADIUS,
      ...slot,
      key: `strip-${vIndex}`,
      index: mod(vIndex, count),
      isActive: offset === 0,
    });
  }
  return poses;
}

export function computePoses(
  mode: StyleflowMode,
  virtualIndex: number,
  count: number,
  cells: GridCell[],
  options: LayoutOptions
): CardPose[] {
  if (count === 0) return [];
  if (mode === 'geometric' || mode === 'wall') {
    return gridPoses(mode, cells, mod(virtualIndex, count), options);
  }
  return stripPoses(mode, virtualIndex, count, options);
}
