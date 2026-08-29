/**
 * The radar scope (SPEC §9): one canvas, device-pixel correct, pan/zoom,
 * selection and label drag. It renders snapshots only — never live positions.
 */

import { vec2, type Vec2 } from '../sim/geo';
import type { Airport } from '../sim/scenario';
import type { RadarContact, RadarSnapshot } from '../sim/state';
import { blipScreenPos, drawBlip, drawTrail, hitsBlip } from './blips';
import { drawLabel, labelRect, rectContains } from './labels';
import { createMapLayer } from './maps';
import { THEMES, type ThemeName } from './theme';
import { drawMeasurement } from './tools';
import {
  createTransform,
  fitScale,
  panByPixels,
  screenToNm,
  zoomAt,
  type Transform,
  type Viewport,
} from './transform';

export interface ScopeCallbacks {
  onSelect?: (id: string | null) => void;
  onLabelDrag?: (id: string, offset: Vec2) => void;
}

export interface Scope {
  render(snapshot: RadarSnapshot | null): void;
  setTheme(theme: ThemeName): void;
  setSelected(id: string | null): void;
  getSelected(): string | null;
  destroy(): void;
}

type Drag =
  | { mode: 'pan'; last: Vec2; moved: boolean }
  | { mode: 'label'; id: string; grab: Vec2; start: Vec2 };

/** Right-drag state of the measuring tool (SPEC §9, M4). */
interface Measure {
  from: Vec2;
  to: Vec2;
}

export function createScope(
  container: HTMLElement,
  airport: Airport,
  callbacks: ScopeCallbacks = {},
): Scope {
  const canvas = document.createElement('canvas');
  canvas.className = 'radar-canvas';
  container.appendChild(canvas);

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context unavailable');
  const ctx: CanvasRenderingContext2D = context;

  const mapLayer = createMapLayer(airport);
  let theme: ThemeName = 'classic';
  let viewport: Viewport = { width: container.clientWidth || 800, height: container.clientHeight || 600 };
  let transform: Transform = createTransform(vec2(0, 8), fitScale(viewport, 90));
  let dpr = window.devicePixelRatio || 1;
  let snapshot: RadarSnapshot | null = null;
  let selectedId: string | null = null;
  let drag: Drag | null = null;
  /** Active right-drag, or the last finished measurement to keep showing. */
  let measure: Measure | null = null;

  function resize(): void {
    viewport = {
      width: container.clientWidth || viewport.width,
      height: container.clientHeight || viewport.height,
    };
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(viewport.width * dpr));
    canvas.height = Math.max(1, Math.round(viewport.height * dpr));
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
  }

  function pointerPos(ev: MouseEvent): Vec2 {
    const rect = canvas.getBoundingClientRect();
    return vec2(ev.clientX - rect.left, ev.clientY - rect.top);
  }

  /** Topmost contact whose label or blip covers the point. */
  function hitTest(point: Vec2): { contact: RadarContact; onLabel: boolean } | null {
    if (!snapshot) return null;
    for (let i = snapshot.contacts.length - 1; i >= 0; i -= 1) {
      const contact = snapshot.contacts[i];
      if (!contact) continue;
      const blip = blipScreenPos(transform, viewport, contact);
      if (rectContains(labelRect(ctx, contact, blip), point)) return { contact, onLabel: true };
      if (hitsBlip(blip, point)) return { contact, onLabel: false };
    }
    return null;
  }

  /** The contact whose blip sits under the point — labels do not count. */
  function blipAt(point: Vec2): RadarContact | null {
    if (!snapshot) return null;
    for (let i = snapshot.contacts.length - 1; i >= 0; i -= 1) {
      const contact = snapshot.contacts[i];
      if (!contact) continue;
      if (hitsBlip(blipScreenPos(transform, viewport, contact), point)) return contact;
    }
    return null;
  }

  function select(id: string | null): void {
    if (selectedId === id) return;
    selectedId = id;
    callbacks.onSelect?.(id);
  }

  function onPointerDown(ev: PointerEvent): void {
    const point = pointerPos(ev);

    // SPEC §9: the right button measures from blip to blip.
    if (ev.button === 2) {
      const hit = blipAt(point);
      measure = {
        from: hit ? hit.pos : screenToNm(transform, viewport, point),
        to: hit ? hit.pos : screenToNm(transform, viewport, point),
      };
      canvas.setPointerCapture(ev.pointerId);
      return;
    }
    if (ev.button !== 0) return;

    measure = null; // a left click clears the finished measurement
    const hit = hitTest(point);
    canvas.setPointerCapture(ev.pointerId);

    if (hit && hit.onLabel) {
      select(hit.contact.id);
      drag = {
        mode: 'label',
        id: hit.contact.id,
        grab: point,
        start: { ...hit.contact.labelOffset },
      };
      return;
    }
    if (hit) {
      select(hit.contact.id);
      drag = null;
      return;
    }
    drag = { mode: 'pan', last: point, moved: false };
  }

  function onPointerMove(ev: PointerEvent): void {
    if (measure) {
      // Snap onto a blip when the cursor comes near one.
      const point = pointerPos(ev);
      const hit = blipAt(point);
      measure.to = hit ? hit.pos : screenToNm(transform, viewport, point);
      return;
    }
    if (!drag) return;
    const point = pointerPos(ev);

    if (drag.mode === 'pan') {
      const dx = point.x - drag.last.x;
      const dy = point.y - drag.last.y;
      if (Math.abs(dx) > 0 || Math.abs(dy) > 0) drag.moved = true;
      transform = panByPixels(transform, dx, dy);
      drag.last = point;
      return;
    }

    const offset = vec2(
      drag.start.x + (point.x - drag.grab.x),
      drag.start.y + (point.y - drag.grab.y),
    );
    callbacks.onLabelDrag?.(drag.id, offset);
  }

  function onPointerUp(ev: PointerEvent): void {
    if (canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId);
    // A finished measurement stays on the scope until the next left click.
    if (ev.button === 2) return;
    if (drag?.mode === 'pan' && !drag.moved) select(null);
    drag = null;
  }

  function onPointerLeave(): void {
    // Losing the pointer mid-drag must not leave a stray line behind.
    measure = null;
    drag = null;
  }

  function onContextMenu(ev: MouseEvent): void {
    ev.preventDefault();
  }

  function onWheel(ev: WheelEvent): void {
    ev.preventDefault();
    const factor = Math.exp(-ev.deltaY * 0.0015);
    transform = zoomAt(transform, viewport, pointerPos(ev), factor);
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerLeave);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('contextmenu', onContextMenu);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  return {
    render(next) {
      snapshot = next;
      const palette = THEMES[theme];

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = palette.bg;
      ctx.fillRect(0, 0, viewport.width, viewport.height);

      mapLayer.draw(ctx, transform, viewport, palette, theme, dpr);
      if (!snapshot) return;

      for (const contact of snapshot.contacts) {
        drawTrail(ctx, contact, transform, viewport, palette);
      }
      // SPEC §9: the STCA blink runs at 60 fps over the frozen picture.
      const blinkOn = Math.floor(performance.now() / 500) % 2 === 0;

      for (const contact of snapshot.contacts) {
        const options = {
          selected: contact.id === selectedId,
          alarm: contact.alert === 'conflict' || (contact.alert === 'stca' && blinkOn),
        };
        drawBlip(ctx, contact, transform, viewport, palette, options);
        drawLabel(ctx, contact, blipScreenPos(transform, viewport, contact), palette, options);
      }

      // SPEC §9: the measuring tool draws on top of everything.
      if (measure) drawMeasurement(ctx, measure, transform, viewport, palette);
    },
    setTheme(next) {
      theme = next;
    },
    setSelected(id) {
      select(id);
    },
    getSelected() {
      return selectedId;
    },
    destroy() {
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerLeave);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('wheel', onWheel);
      canvas.remove();
    },
  };
}
