/**
 * The static sector map (SPEC §9): range rings, fixes, MVA sectors and the
 * extended centerline. Drawn into an offscreen canvas and only rebuilt when
 * the view or the theme changes — every other frame is a blit.
 */

import { polarToVec, add, scale, type Vec2 } from '../sim/geo';
import type { Airport } from '../sim/scenario';
import type { Palette, ThemeName } from './theme';
import { nmToScreen, type Transform, type Viewport } from './transform';

const RING_STEP_NM = 10;
const RING_MAX_NM = 60;
const CENTERLINE_NM = 15;
export const MAP_FONT = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export interface MapLayer {
  draw(
    target: CanvasRenderingContext2D,
    t: Transform,
    vp: Viewport,
    palette: Palette,
    theme: ThemeName,
    dpr: number,
  ): void;
}

function centroid(polygon: Vec2[]): Vec2 {
  const sum = polygon.reduce((acc, p) => add(acc, p), { x: 0, y: 0 });
  return scale(sum, 1 / Math.max(polygon.length, 1));
}

function drawRings(ctx: CanvasRenderingContext2D, t: Transform, vp: Viewport, palette: Palette): void {
  const center = nmToScreen(t, vp, { x: 0, y: 0 });
  ctx.strokeStyle = palette.map;
  ctx.fillStyle = palette.map;
  ctx.lineWidth = 1;

  for (let nm = RING_STEP_NM; nm <= RING_MAX_NM; nm += RING_STEP_NM) {
    const r = nm * t.pxPerNm;
    ctx.beginPath();
    ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillText(`${nm}`, center.x + 3, center.y - r + 11);
  }
}

function drawCenterline(
  ctx: CanvasRenderingContext2D,
  airport: Airport,
  t: Transform,
  vp: Viewport,
  palette: Palette,
): void {
  const runway = airport.runways[0];
  if (!runway) return;

  // The final approach course points at the threshold, so the extended
  // centerline runs outbound on the reciprocal.
  const outbound = runway.course + 180;
  const thr = runway.thr;

  ctx.strokeStyle = palette.map;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const start = nmToScreen(t, vp, thr);
  const end = nmToScreen(t, vp, add(thr, polarToVec(outbound, CENTERLINE_NM)));
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();

  // Mile marks, every mile, longer every five.
  const across = polarToVec(outbound + 90, 1);
  for (let nm = 1; nm <= CENTERLINE_NM; nm += 1) {
    const onCourse = add(thr, polarToVec(outbound, nm));
    const half = nm % 5 === 0 ? 0.7 : 0.35;
    const a = nmToScreen(t, vp, add(onCourse, scale(across, half)));
    const b = nmToScreen(t, vp, add(onCourse, scale(across, -half)));
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  // Runway stub in the accent colour, drawn along the landing direction.
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 2;
  const rwyEnd = nmToScreen(t, vp, add(thr, polarToVec(runway.course, 1.6)));
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(rwyEnd.x, rwyEnd.y);
  ctx.stroke();
}

function drawMva(
  ctx: CanvasRenderingContext2D,
  airport: Airport,
  t: Transform,
  vp: Viewport,
  palette: Palette,
): void {
  ctx.strokeStyle = palette.map;
  ctx.fillStyle = palette.map;
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);

  for (const sector of airport.mva) {
    if (sector.polygon.length < 2) continue;
    ctx.beginPath();
    sector.polygon.forEach((p, i) => {
      const s = nmToScreen(t, vp, p);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    ctx.closePath();
    ctx.stroke();

    const label = nmToScreen(t, vp, centroid(sector.polygon));
    ctx.setLineDash([]);
    ctx.fillText(`MVA ${sector.minAlt}`, label.x - 22, label.y);
    ctx.setLineDash([6, 4]);
  }

  ctx.setLineDash([]);
}

function drawFixes(
  ctx: CanvasRenderingContext2D,
  airport: Airport,
  t: Transform,
  vp: Viewport,
  palette: Palette,
): void {
  ctx.strokeStyle = palette.text;
  ctx.fillStyle = palette.text;
  ctx.lineWidth = 1;

  for (const [name, pos] of Object.entries(airport.fixes)) {
    const s = nmToScreen(t, vp, pos);
    const r = 5;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y - r);
    ctx.lineTo(s.x + r, s.y + r * 0.8);
    ctx.lineTo(s.x - r, s.y + r * 0.8);
    ctx.closePath();
    ctx.stroke();
    ctx.fillText(name, s.x + 8, s.y + 4);
  }
}

export function createMapLayer(airport: Airport): MapLayer {
  let cache: HTMLCanvasElement | null = null;
  let cacheKey = '';

  return {
    draw(target, t, vp, palette, theme, dpr) {
      const key = [
        theme,
        dpr,
        vp.width,
        vp.height,
        t.pxPerNm.toFixed(4),
        t.center.x.toFixed(4),
        t.center.y.toFixed(4),
      ].join('|');

      if (!cache || cacheKey !== key) {
        cache = cache ?? document.createElement('canvas');
        cache.width = Math.max(1, Math.round(vp.width * dpr));
        cache.height = Math.max(1, Math.round(vp.height * dpr));
        const ctx = cache.getContext('2d');
        if (!ctx) return;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, vp.width, vp.height);
        ctx.font = MAP_FONT;
        ctx.textBaseline = 'alphabetic';

        drawRings(ctx, t, vp, palette);
        drawMva(ctx, airport, t, vp, palette);
        drawCenterline(ctx, airport, t, vp, palette);
        drawFixes(ctx, airport, t, vp, palette);

        cacheKey = key;
      }

      target.drawImage(cache, 0, 0, vp.width, vp.height);
    },
  };
}
