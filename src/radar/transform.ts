/**
 * The NM ↔ screen transform (SPEC §4). Pure math, no canvas involved, so the
 * pan/zoom behaviour is unit-testable.
 *
 * Screen coordinates are CSS pixels with the origin top-left and y pointing
 * down; the NM grid has y pointing north, so the y axis is mirrored.
 */

import { vec2, type Vec2 } from '../sim/geo';

export interface Viewport {
  width: number;
  height: number;
}

export interface Transform {
  /** NM position shown at the centre of the viewport. */
  center: Vec2;
  pxPerNm: number;
}

export const MIN_PX_PER_NM = 1.5;
export const MAX_PX_PER_NM = 32;

export function clampScale(pxPerNm: number): number {
  return Math.min(MAX_PX_PER_NM, Math.max(MIN_PX_PER_NM, pxPerNm));
}

export function createTransform(center: Vec2, pxPerNm: number): Transform {
  return { center: { ...center }, pxPerNm: clampScale(pxPerNm) };
}

export function nmToScreen(t: Transform, vp: Viewport, p: Vec2): Vec2 {
  return vec2(
    vp.width / 2 + (p.x - t.center.x) * t.pxPerNm,
    vp.height / 2 - (p.y - t.center.y) * t.pxPerNm,
  );
}

export function screenToNm(t: Transform, vp: Viewport, p: Vec2): Vec2 {
  return vec2(
    t.center.x + (p.x - vp.width / 2) / t.pxPerNm,
    t.center.y - (p.y - vp.height / 2) / t.pxPerNm,
  );
}

/** Drag the map: moving the mouse right moves the world right. */
export function panByPixels(t: Transform, dxPx: number, dyPx: number): Transform {
  return {
    center: vec2(t.center.x - dxPx / t.pxPerNm, t.center.y + dyPx / t.pxPerNm),
    pxPerNm: t.pxPerNm,
  };
}

/**
 * Zoom by `factor` while keeping the NM position under `anchor` (a screen
 * point) pinned. Honours the scale limits — a clamped zoom still holds the
 * anchor.
 */
export function zoomAt(t: Transform, vp: Viewport, anchor: Vec2, factor: number): Transform {
  const scale = clampScale(t.pxPerNm * factor);
  const world = screenToNm(t, vp, anchor);
  return {
    center: vec2(
      world.x - (anchor.x - vp.width / 2) / scale,
      world.y + (anchor.y - vp.height / 2) / scale,
    ),
    pxPerNm: scale,
  };
}

/** Scale that fits a box of `spanNm` (width and height) into the viewport. */
export function fitScale(vp: Viewport, spanNm: number): number {
  return clampScale(Math.min(vp.width, vp.height) / spanNm);
}
