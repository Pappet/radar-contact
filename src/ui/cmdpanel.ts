/**
 * Click panel for the selected aircraft (SPEC §11.4): heading rose, altitude
 * stepper and speed presets. It builds the same Command objects the console
 * produces — there is only one way into the sim.
 *
 */

import type { Command, TurnDirection } from '../sim/commands';
import { angleDiff, normalizeDeg } from '../sim/geo';
import type { Palette } from '../radar/theme';

/** What the panel needs to know about the selected aircraft. */
export interface PanelView {
  callsign: string;
  type: string;
  /** Runway of the active ILS, for the approach button (SPEC §11.4). */
  runway: string;
  /** True once the tower may take the aircraft (SPEC §7). */
  canHandOff: boolean;
  /** True once the ILS clearance has been given. */
  clearedIls: boolean;
  /** Fix the aircraft is holding at, while it holds (M4). */
  holdingAt?: string;
  /** Current values, as the radar shows them. */
  altitude: number;
  heading: number;
  ias: number;
  /** What the controller has assigned. */
  targetAltitude: number;
  targetHeading?: number;
  targetSpeed: number;
}

export interface CommandPanelOptions {
  onCommands: (callsign: string, commands: Command[]) => void;
}

export interface CommandPanel {
  update(view: PanelView | null): void;
  setPalette(palette: Palette): void;
}

const ROSE_SIZE = 132;
const ALTITUDE_STEP_FT = 1000;
const MIN_ALTITUDE_FT = 1000;
const MAX_ALTITUDE_FT = 60000;
const SPEED_PRESETS = [160, 180, 200, 220];

const clampAltitude = (ft: number): number =>
  Math.min(MAX_ALTITUDE_FT, Math.max(MIN_ALTITUDE_FT, Math.round(ft / 100) * 100));

export function createCommandPanel(
  pane: HTMLElement,
  options: CommandPanelOptions,
): CommandPanel {
  pane.innerHTML = `
    <div class="panel-empty" data-ref="empty">No aircraft selected</div>
    <div class="panel-body" data-ref="body" hidden>
      <div class="panel-head">
        <span class="panel-callsign" data-ref="callsign"></span>
        <span class="panel-type" data-ref="type"></span>
        <span class="panel-holding" data-ref="holding" hidden></span>
      </div>
      <div class="panel-grid">
        <canvas class="panel-rose" data-ref="rose"
                width="${ROSE_SIZE}" height="${ROSE_SIZE}"
                title="Click = turn the short way, Alt-click = turn the other way"></canvas>
        <div class="panel-controls">
          <div class="panel-row">
            <button class="btn" data-ref="alt-down">−</button>
            <input class="panel-alt" data-ref="alt-input" inputmode="numeric"
                   autocomplete="off" spellcheck="false" title="Altitude in feet, Enter to clear" />
            <button class="btn" data-ref="alt-up">+</button>
          </div>
          <div class="panel-row panel-speeds" data-ref="speeds"></div>
          <div class="panel-row">
            <button class="btn" data-ref="ils"></button>
            <button class="btn" data-ref="twr" title="Contact tower">TWR</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const pick = <T extends HTMLElement>(ref: string): T => {
    const el = pane.querySelector<T>(`[data-ref="${ref}"]`);
    if (!el) throw new Error(`Command panel element missing: ${ref}`);
    return el;
  };

  const empty = pick('empty');
  const body = pick('body');
  const callsignEl = pick('callsign');
  const typeEl = pick('type');
  const holdingEl = pick('holding');
  const rose = pick<HTMLCanvasElement>('rose');
  const altInput = pick<HTMLInputElement>('alt-input');
  const speedsRow = pick('speeds');
  const ilsButton = pick<HTMLButtonElement>('ils');
  const towerButton = pick<HTMLButtonElement>('twr');

  let view: PanelView | null = null;
  let palette: Palette | null = null;
  /**
   * What the controller has clicked but the pilot has not read back yet.
   * Without it a second step within the reaction delay would repeat the first
   * one instead of adding to it.
   */
  let pendingAltitude: number | null = null;

  const send = (...commands: Command[]): void => {
    if (view) options.onCommands(view.callsign, commands);
  };

  // --- heading rose ---
  const roseCtx = rose.getContext('2d');

  function drawRose(): void {
    if (!roseCtx || !palette) return;
    const r = ROSE_SIZE / 2;
    roseCtx.clearRect(0, 0, ROSE_SIZE, ROSE_SIZE);
    roseCtx.lineWidth = 1;
    roseCtx.font = '9px ui-monospace, monospace';
    roseCtx.textAlign = 'center';
    roseCtx.textBaseline = 'middle';
    // The map colour is too dark against the panel, so the dial is drawn in
    // the text colour and dimmed instead.
    roseCtx.strokeStyle = palette.text;
    roseCtx.fillStyle = palette.text;
    roseCtx.globalAlpha = 0.35;

    roseCtx.beginPath();
    roseCtx.arc(r, r, r - 12, 0, Math.PI * 2);
    roseCtx.stroke();

    for (let deg = 0; deg < 360; deg += 30) {
      const rad = ((deg - 90) * Math.PI) / 180;
      const inner = r - 18;
      const outer = r - 12;
      roseCtx.beginPath();
      roseCtx.moveTo(r + Math.cos(rad) * inner, r + Math.sin(rad) * inner);
      roseCtx.lineTo(r + Math.cos(rad) * outer, r + Math.sin(rad) * outer);
      roseCtx.stroke();
      if (deg % 90 === 0) {
        roseCtx.globalAlpha = 0.7;
        roseCtx.fillText(
          String(deg === 0 ? 36 : deg / 10).padStart(2, '0'),
          r + Math.cos(rad) * (r - 5),
          r + Math.sin(rad) * (r - 5),
        );
        roseCtx.globalAlpha = 0.35;
      }
    }

    roseCtx.globalAlpha = 1;
    if (!view) return;

    // Assigned heading first, current heading on top of it.
    if (view.targetHeading !== undefined) {
      const rad = ((view.targetHeading - 90) * Math.PI) / 180;
      roseCtx.strokeStyle = palette.accent;
      roseCtx.lineWidth = 2;
      roseCtx.beginPath();
      roseCtx.moveTo(r, r);
      roseCtx.lineTo(r + Math.cos(rad) * (r - 20), r + Math.sin(rad) * (r - 20));
      roseCtx.stroke();
    }

    const rad = ((view.heading - 90) * Math.PI) / 180;
    roseCtx.strokeStyle = palette.text;
    roseCtx.lineWidth = 1;
    roseCtx.beginPath();
    roseCtx.moveTo(r, r);
    roseCtx.lineTo(r + Math.cos(rad) * (r - 26), r + Math.sin(rad) * (r - 26));
    roseCtx.stroke();
  }

  rose.addEventListener('click', (ev) => {
    if (!view) return;
    const rect = rose.getBoundingClientRect();
    const dx = ev.clientX - rect.left - rect.width / 2;
    const dy = ev.clientY - rect.top - rect.height / 2;
    if (Math.hypot(dx, dy) < 8) return; // dead zone in the middle

    const deg = normalizeDeg(Math.round((Math.atan2(dx, -dy) * 180) / Math.PI / 5) * 5);
    // Alt-click sends the aircraft round the other way (SPEC §11.4).
    let turn: TurnDirection = 'auto';
    if (ev.altKey) turn = angleDiff(view.heading, deg) >= 0 ? 'L' : 'R';
    send({ kind: 'heading', deg, turn });
  });

  // --- altitude ---
  const stepAltitude = (direction: 1 | -1): void => {
    if (!view) return;
    const from = pendingAltitude ?? view.targetAltitude;
    const base = Math.round(from / ALTITUDE_STEP_FT) * ALTITUDE_STEP_FT;
    const ft = clampAltitude(base + direction * ALTITUDE_STEP_FT);
    pendingAltitude = ft;
    render();
    send({ kind: 'altitude', ft });
  };

  pick<HTMLButtonElement>('alt-up').addEventListener('click', () => stepAltitude(1));
  pick<HTMLButtonElement>('alt-down').addEventListener('click', () => stepAltitude(-1));

  altInput.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    const entered = Number(altInput.value.trim());
    if (!Number.isFinite(entered) || entered <= 0) return;
    // Both "5000" and "50" (hundreds of feet, as on the console) are accepted.
    const ft = clampAltitude(entered < 1000 ? entered * 100 : entered);
    pendingAltitude = ft;
    altInput.blur();
    send({ kind: 'altitude', ft });
  });

  // --- speed ---
  for (const kt of SPEED_PRESETS) {
    const button = document.createElement('button');
    button.className = 'btn';
    button.textContent = String(kt);
    button.addEventListener('click', () => send({ kind: 'speed', kt }));
    speedsRow.appendChild(button);
  }
  const normalButton = document.createElement('button');
  normalButton.className = 'btn';
  normalButton.textContent = 'SN';
  normalButton.title = 'Resume normal speed';
  normalButton.addEventListener('click', () => send({ kind: 'speed', kt: 'normal' }));
  speedsRow.appendChild(normalButton);

  ilsButton.addEventListener('click', () => {
    if (view) send({ kind: 'ils', runway: view.runway });
  });
  towerButton.addEventListener('click', () => send({ kind: 'handoff' }));

  function render(): void {
    if (!view) {
      body.hidden = true;
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    body.hidden = false;

    callsignEl.textContent = view.callsign;
    typeEl.textContent = `${view.type} · ${Math.round(view.altitude)} ft · ${Math.round(view.ias)} kt`;

    // The hold is procedure state the data block cannot show (SPEC §11.4).
    holdingEl.textContent = view.holdingAt ? `HOLD ${view.holdingAt}` : '';
    holdingEl.hidden = !view.holdingAt;

    // Never fight the controller for the input they are typing in.
    if (document.activeElement !== altInput) {
      altInput.value = String(pendingAltitude ?? view.targetAltitude);
    }
    altInput.classList.toggle('pending', pendingAltitude !== null);

    for (const button of speedsRow.children) {
      const label = button.textContent ?? '';
      const active =
        label === 'SN' ? false : Math.round(view.targetSpeed) === Number(label);
      button.classList.toggle('active', active);
    }

    ilsButton.textContent = `ILS ${view.runway}`;
    ilsButton.classList.toggle('active', view.clearedIls);
    // The tower only takes an established aircraft inside ten miles (SPEC §7).
    towerButton.disabled = !view.canHandOff;

    drawRose();
  }

  return {
    update(next) {
      // A new aircraft, or the pilot catching up, clears the pending clearance.
      if (next?.callsign !== view?.callsign) pendingAltitude = null;
      else if (next && pendingAltitude !== null && next.targetAltitude === pendingAltitude) {
        pendingAltitude = null;
      }
      view = next;
      render();
    },
    setPalette(next) {
      palette = next;
      drawRose();
    },
  };
}
