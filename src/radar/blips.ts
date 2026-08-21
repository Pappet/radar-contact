/** Trails and blips (SPEC §9). Everything here draws snapshot data only. */

import type { Vec2 } from '../sim/geo';
import type { RadarContact } from '../sim/state';
import type { Palette } from './theme';
import { nmToScreen, type Transform, type Viewport } from './transform';

const BLIP_SIZE = 5;

export function blipScreenPos(t: Transform, vp: Viewport, c: RadarContact): Vec2 {
  return nmToScreen(t, vp, c.pos);
}

/** Older trail dots are drawn smaller and dimmer. */
export function drawTrail(
  ctx: CanvasRenderingContext2D,
  c: RadarContact,
  t: Transform,
  vp: Viewport,
  palette: Palette,
): void {
  const history = c.trail.slice(0, -1);
  history.forEach((p, i) => {
    const age = (i + 1) / (history.length + 1);
    const size = 1 + 2 * age;
    const s = nmToScreen(t, vp, p);
    ctx.globalAlpha = 0.15 + 0.5 * age;
    ctx.fillStyle = palette.text;
    ctx.fillRect(s.x - size / 2, s.y - size / 2, size, size);
  });
  ctx.globalAlpha = 1;
}

export function drawBlip(
  ctx: CanvasRenderingContext2D,
  c: RadarContact,
  t: Transform,
  vp: Viewport,
  palette: Palette,
  options: { selected: boolean; alarm: boolean },
): void {
  const s = blipScreenPos(t, vp, c);
  ctx.fillStyle = options.alarm ? palette.alarm : options.selected ? palette.accent : palette.text;
  ctx.fillRect(s.x - BLIP_SIZE / 2, s.y - BLIP_SIZE / 2, BLIP_SIZE, BLIP_SIZE);
}

export function hitsBlip(screenPos: Vec2, point: Vec2, tolerance = 8): boolean {
  return Math.abs(screenPos.x - point.x) <= tolerance && Math.abs(screenPos.y - point.y) <= tolerance;
}
