import { describe, expect, it } from 'vitest';
import {
  clampScale,
  createTransform,
  MAX_PX_PER_NM,
  MIN_PX_PER_NM,
  nmToScreen,
  panByPixels,
  screenToNm,
  zoomAt,
  type Transform,
  type Viewport,
} from '../src/radar/transform';

const vp: Viewport = { width: 800, height: 600 };
const base: Transform = createTransform({ x: 0, y: 0 }, 8);

describe('NM ↔ screen', () => {
  it('puts the transform centre in the middle of the viewport', () => {
    expect(nmToScreen(base, vp, { x: 0, y: 0 })).toEqual({ x: 400, y: 300 });
  });

  it('maps north up and east right', () => {
    expect(nmToScreen(base, vp, { x: 10, y: 0 })).toEqual({ x: 480, y: 300 });
    expect(nmToScreen(base, vp, { x: 0, y: 10 })).toEqual({ x: 400, y: 220 });
  });

  it('round-trips through screen space', () => {
    const t = createTransform({ x: -12, y: 7 }, 5.5);
    const nm = { x: 23.75, y: -4.25 };
    const back = screenToNm(t, vp, nmToScreen(t, vp, nm));
    expect(back.x).toBeCloseTo(nm.x, 9);
    expect(back.y).toBeCloseTo(nm.y, 9);
  });

  it('pans the world with the pointer', () => {
    const panned = panByPixels(base, 80, -40);
    // Dragging right by 80 px at 8 px/NM moves the view 10 NM west.
    expect(panned.center.x).toBeCloseTo(-10, 9);
    expect(panned.center.y).toBeCloseTo(-5, 9);
    expect(panned.pxPerNm).toBe(base.pxPerNm);
  });
});

describe('zoom around the cursor', () => {
  const anchor = { x: 620, y: 180 };

  it('keeps the NM position under the cursor pinned', () => {
    const before = screenToNm(base, vp, anchor);
    const zoomed = zoomAt(base, vp, anchor, 1.25);
    const after = screenToNm(zoomed, vp, anchor);
    expect(zoomed.pxPerNm).toBeCloseTo(10, 9);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('holds the anchor when zooming out as well', () => {
    const before = screenToNm(base, vp, anchor);
    const after = screenToNm(zoomAt(base, vp, anchor, 0.5), vp, anchor);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('respects the scale limits and still holds the anchor', () => {
    const before = screenToNm(base, vp, anchor);
    const zoomed = zoomAt(base, vp, anchor, 1000);
    expect(zoomed.pxPerNm).toBe(MAX_PX_PER_NM);
    const after = screenToNm(zoomed, vp, anchor);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);

    expect(zoomAt(base, vp, anchor, 0.0001).pxPerNm).toBe(MIN_PX_PER_NM);
    expect(clampScale(1000)).toBe(MAX_PX_PER_NM);
    expect(clampScale(0)).toBe(MIN_PX_PER_NM);
  });

  it('is reversible around the same anchor', () => {
    const there = zoomAt(base, vp, anchor, 2);
    const back = zoomAt(there, vp, anchor, 0.5);
    expect(back.pxPerNm).toBeCloseTo(base.pxPerNm, 9);
    expect(back.center.x).toBeCloseTo(base.center.x, 9);
    expect(back.center.y).toBeCloseTo(base.center.y, 9);
  });
});
