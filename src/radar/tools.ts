/**
 * The measuring tool (SPEC §9, M4): a right-drag from one blip to another
 * draws the distance in NM and the bearing between them. The drawing helpers
 * live here; the scope owns the pointer interaction and snaps to blips.
 *
 * Endpoints are kept in NM, so a measurement stays correct while panning and
 * zooming — like everything else on the scope it is drawn from world data.
 */

import { bearingTo, distanceNm, type Vec2 } from '../sim/geo';
import type { Palette } from './theme';
import { nmToScreen, type Transform, type Viewport } from './transform';

export interface Measurement {
  /** NM, where the drag started. */
  from: Vec2;
  /** NM, where it ended or where the cursor currently is. */
  to: Vec2;
}

/** "12.4 NM · 245°" — one decimal mile, the bearing from the first point. */
export function measureText(m: Measurement): string {
  const bearing = Math.round(bearingTo(m.from, m.to)) % 360;
  return `${distanceNm(m.from, m.to).toFixed(1)} NM · ${String(bearing).padStart(3, '0')}°`;
}

/** Endpoint dot for the anchors; the caller sets the fill style. */
function dot(ctx: CanvasRenderingContext2D, at: Vec2): void {
  ctx.beginPath();
  ctx.arc(at.x, at.y, 2.5, 0, Math.PI * 2);
  ctx.fill();
}

export function drawMeasurement(
  ctx: CanvasRenderingContext2D,
  m: Measurement,
  t: Transform,
  vp: Viewport,
  palette: Palette,
): void {
  const a = nmToScreen(t, vp, m.from);
  const b = nmToScreen(t, vp, m.to);

  ctx.strokeStyle = palette.accent;
  ctx.fillStyle = palette.accent;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.setLineDash([]);
  dot(ctx, a);
  dot(ctx, b);

  const text = measureText(m);
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.textBaseline = 'middle';
  const width = ctx.measureText(text).width;

  // Keep the readout on screen: flip it to the left when it would clip.
  const right = b.x + 10 + width > vp.width;
  const x = right ? b.x - 10 - width : b.x + 10;
  const y = Math.max(10, Math.min(vp.height - 10, b.y));

  // Dark backing so the numbers stay readable over map and labels.
  ctx.fillStyle = palette.bg;
  ctx.globalAlpha = 0.75;
  ctx.fillRect(x - 3, y - 8, width + 6, 16);
  ctx.globalAlpha = 1;
  ctx.fillStyle = palette.accent;
  ctx.fillText(text, x, y);
}
