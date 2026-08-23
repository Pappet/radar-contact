/** The CSS grid shell (SPEC §11.1). Radar left and dominant, panels right. */

export interface LayoutRefs {
  root: HTMLElement;
  clock: HTMLElement;
  speedButtons: HTMLButtonElement[];
  pauseButton: HTMLButtonElement;
  themeButton: HTMLButtonElement;
  helpButton: HTMLButtonElement;
  seedLabel: HTMLElement;
  scopePane: HTMLElement;
  radioPane: HTMLElement;
  selectionPane: HTMLElement;
  consolePane: HTMLElement;
}

export const TIME_SCALES = [1, 2, 4] as const;
export type TimeScale = (typeof TIME_SCALES)[number];

export function buildLayout(mount: HTMLElement): LayoutRefs {
  mount.innerHTML = `
    <div class="app">
      <header class="topbar">
        <span class="brand">RADAR CONTACT</span>
        <span class="clock" data-ref="clock">00:00:00</span>
        <span class="rate" data-ref="rates"></span>
        <button class="btn" data-ref="pause">Pause</button>
        <span class="spacer"></span>
        <button class="btn" data-ref="help" title="Controls and commands (F1)">? Help</button>
        <button class="btn" data-ref="theme">Theme: classic</button>
        <span class="seed" data-ref="seed"></span>
      </header>
      <main class="scope-pane" data-ref="scope"></main>
      <aside class="side">
        <section class="radio" data-ref="radio"></section>
        <section class="selection" data-ref="selection">No aircraft selected</section>
        <section class="console" data-ref="console"></section>
      </aside>
    </div>
  `;

  const pick = <T extends HTMLElement>(ref: string): T => {
    const el = mount.querySelector<T>(`[data-ref="${ref}"]`);
    if (!el) throw new Error(`Layout element missing: ${ref}`);
    return el;
  };

  const rates = pick<HTMLElement>('rates');
  const speedButtons = TIME_SCALES.map((scale) => {
    const button = document.createElement('button');
    button.className = 'btn rate-btn';
    button.textContent = `×${scale}`;
    button.dataset['scale'] = String(scale);
    rates.appendChild(button);
    return button;
  });

  return {
    root: mount,
    clock: pick('clock'),
    speedButtons,
    pauseButton: pick<HTMLButtonElement>('pause'),
    themeButton: pick<HTMLButtonElement>('theme'),
    helpButton: pick<HTMLButtonElement>('help'),
    seedLabel: pick('seed'),
    scopePane: pick('scope'),
    radioPane: pick('radio'),
    selectionPane: pick('selection'),
    consolePane: pick('console'),
  };
}

/** Sim seconds → HH:MM:SS. */
export function formatSimClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hh = String(Math.floor(total / 3600)).padStart(2, '0');
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}
