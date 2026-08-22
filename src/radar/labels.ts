/**
 * Data blocks (SPEC §9): three monospace lines, attached to the blip by a
 * leader line and draggable to a free spot.
 */

import { VS_ARROW_THRESHOLD_FPM } from '../sim/constants';
import type { Vec2 } from '../sim/geo';
import type { RadarContact } from '../sim/state';
import type { Palette } from './theme';

export const LABEL_FONT = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
export const LABEL_LINE_HEIGHT = 12;
const LABEL_PADDING = 3;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function hundreds(ft: number): string {
  return String(Math.round(ft / 100)).padStart(3, '0');
}

/** `SWR34K` / `074↓ 22` / `A320 ↦50` */
export function labelLines(c: RadarContact): [string, string, string] {
  const arrow = c.vs > VS_ARROW_THRESHOLD_FPM ? '↑' : c.vs < -VS_ARROW_THRESHOLD_FPM ? '↓' : ' ';
  const gs = String(Math.round(c.gs / 10)).padStart(2, '0');
  return [
    c.callsign,
    `${hundreds(c.altitude)}${arrow} ${gs}`,
    `${c.type} ↦${Math.round(c.targetAltitude / 100)}`,
  ];
}

/** Screen rectangle of the data block; `blip` is the blip in screen px. */
export function labelRect(ctx: CanvasRenderingContext2D, c: RadarContact, blip: Vec2): Rect {
  ctx.font = LABEL_FONT;
  const lines = labelLines(c);
  const width = Math.max(...lines.map((line) => ctx.measureText(line).width));
  return {
    x: blip.x + c.labelOffset.x - LABEL_PADDING,
    y: blip.y + c.labelOffset.y - LABEL_LINE_HEIGHT,
    width: width + LABEL_PADDING * 2,
    height: LABEL_LINE_HEIGHT * lines.length + LABEL_PADDING,
  };
}

export function rectContains(rect: Rect, p: Vec2): boolean {
  return (
    p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height
  );
}

/** Point on the label box the leader line should attach to. */
function leaderAnchor(rect: Rect, blip: Vec2): Vec2 {
  const cx = Math.min(Math.max(blip.x, rect.x), rect.x + rect.width);
  const cy = Math.min(Math.max(blip.y, rect.y), rect.y + rect.height);
  return { x: cx, y: cy };
}

export function drawLabel(
  ctx: CanvasRenderingContext2D,
  c: RadarContact,
  blip: Vec2,
  palette: Palette,
  options: { selected: boolean; alarm: boolean },
): void {
  const rect = labelRect(ctx, c, blip);
  const color = options.alarm ? palette.alarm : options.selected ? palette.accent : palette.text;

  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const anchor = leaderAnchor(rect, blip);
  ctx.moveTo(blip.x, blip.y);
  ctx.lineTo(anchor.x, anchor.y);
  ctx.stroke();

  if (options.selected) {
    ctx.strokeStyle = palette.accent;
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width, rect.height);
  }

  ctx.font = LABEL_FONT;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color;
  labelLines(c).forEach((line, i) => {
    ctx.fillText(line, rect.x + LABEL_PADDING, rect.y + LABEL_LINE_HEIGHT * (i + 1) - 2);
  });
}
