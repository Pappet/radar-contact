/**
 * Loop and wiring (SPEC §3). requestAnimationFrame drives rendering; the
 * simulation runs on an accumulator with a fixed one-second tick.
 */

import './style.css';
import { TICK_SECONDS } from './sim/constants';
import { dispatch, type Command } from './sim/commands';
import { CALM } from './sim/physics';
import { AirportValidationError, loadTrainingWest, type Airport } from './sim/scenario';
import { createSimState, drainEvents, emit, setLabelOffset, tick } from './sim/state';
import { createScope } from './radar/scope';
import { THEME_NAMES, THEMES, type ThemeName } from './radar/theme';
import { buildLayout, formatSimClock, TIME_SCALES, type TimeScale } from './ui/layout';
import { createRadioLog } from './ui/radio';
import { createConsole } from './ui/console';
import { createCommandPanel, type PanelView } from './ui/cmdpanel';
import { createHelpOverlay } from './ui/help';
import { pilotSayAgain } from './phraseology';

const MAX_TICKS_PER_FRAME = 60;

function seedFromLocation(): number {
  const fromUrl = new URLSearchParams(window.location.search).get('seed');
  const parsed = fromUrl ? Number(fromUrl) : Number.NaN;
  return Number.isFinite(parsed) ? parsed | 0 : (Date.now() & 0x7fffffff) || 1;
}

function applyTheme(theme: ThemeName): void {
  const palette = THEMES[theme];
  const style = document.documentElement.style;
  style.setProperty('--bg', palette.bg);
  style.setProperty('--map', palette.map);
  style.setProperty('--text', palette.text);
  style.setProperty('--accent', palette.accent);
  style.setProperty('--alarm', palette.alarm);
}

/** A broken airport file must say what is wrong, not fail silently (SPEC §13.2). */
function reportLoadFailure(mount: HTMLElement, error: unknown): void {
  const issues =
    error instanceof AirportValidationError
      ? error.issues
      : [error instanceof Error ? error.message : String(error)];
  mount.innerHTML = `
    <div class="fatal">
      <h1>Airport data rejected</h1>
      <p>training-west.json did not pass validation:</p>
      <ul></ul>
    </div>
  `;
  const list = mount.querySelector('ul');
  for (const issue of issues) {
    const item = document.createElement('li');
    item.textContent = issue;
    list?.appendChild(item);
  }
}

function main(): void {
  const mount = document.querySelector<HTMLElement>('#app');
  if (!mount) throw new Error('#app missing');

  let airport: Airport;
  try {
    airport = loadTrainingWest();
  } catch (error) {
    reportLoadFailure(mount, error);
    return;
  }

  const layout = buildLayout(mount);
  const radio = createRadioLog(layout.radioPane);

  const state = createSimState({
    seed: seedFromLocation(),
    airport,
    // Wind stays calm until M3 (SPEC §14).
    wind: CALM,
  });

  const transmit = (callsign: string, commands: Command[]): void => {
    const result = dispatch(state, callsign, commands);
    commandConsole.setHint(
      result.ok ? `${result.callsign} — transmitted` : `No contact: ${callsign}`,
    );
  };

  const panel = createCommandPanel(layout.selectionPane, { onCommands: transmit });

  const scope = createScope(layout.scopePane, airport, {
    onSelect: (id) => {
      selectedId = id;
      const ac = state.aircraft.find((a) => a.id === id);
      if (ac) commandConsole.setPrefill(`${ac.callsign} `);
      updatePanel();
    },
    onLabelDrag: (id, offset) => setLabelOffset(state, id, offset),
  });

  const help = createHelpOverlay(mount);

  const commandConsole = createConsole(layout.consolePane, {
    callsigns: () => state.aircraft.filter((ac) => ac.onFrequency).map((ac) => ac.callsign),
    onHelp: () => help.open(),
    onSubmit: (result) => {
      if (!result.ok) {
        // SPEC §11.3: anything the parser cannot read gets a "say again".
        emit(state, {
          kind: 'transmission',
          from: 'pilot',
          callsign: result.callsign ?? '',
          text: pilotSayAgain(result.callsign ?? 'station calling'),
        });
        commandConsole.setHint(result.message);
        return;
      }
      transmit(result.callsign, result.commands);
    },
  });

  let selectedId: string | null = null;

  function updatePanel(): void {
    const ac = state.aircraft.find((a) => a.id === selectedId);
    if (!ac || ac.phase === 'DONE') {
      panel.update(null);
      return;
    }
    const view: PanelView = {
      callsign: ac.callsign,
      type: ac.type,
      altitude: ac.altitude,
      heading: ac.heading,
      ias: ac.ias,
      targetAltitude: ac.target.altitude,
      targetSpeed: ac.target.speed,
      ...(ac.target.heading ? { targetHeading: ac.target.heading.deg } : {}),
    };
    panel.update(view);
  }

  let theme: ThemeName = 'classic';
  let timeScale: TimeScale = 1;
  let paused = false;

  applyTheme(theme);
  panel.setPalette(THEMES[theme]);
  layout.seedLabel.textContent = `seed ${state.seed}`;

  function syncRateButtons(): void {
    layout.speedButtons.forEach((button) => {
      const scale = Number(button.dataset['scale']);
      button.classList.toggle('active', !paused && scale === timeScale);
    });
    layout.pauseButton.textContent = paused ? 'Resume' : 'Pause';
    layout.pauseButton.classList.toggle('active', paused);
  }

  layout.speedButtons.forEach((button, index) => {
    button.addEventListener('click', () => {
      timeScale = TIME_SCALES[index] ?? 1;
      paused = false;
      syncRateButtons();
    });
  });
  layout.pauseButton.addEventListener('click', () => {
    paused = !paused;
    syncRateButtons();
  });
  layout.themeButton.addEventListener('click', () => {
    theme = THEME_NAMES[(THEME_NAMES.indexOf(theme) + 1) % THEME_NAMES.length] ?? 'classic';
    applyTheme(theme);
    scope.setTheme(theme);
    panel.setPalette(THEMES[theme]);
    layout.themeButton.textContent = `Theme: ${theme}`;
  });
  syncRateButtons();

  layout.helpButton.addEventListener('click', () => help.toggle());
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'F1') {
      ev.preventDefault();
      help.toggle();
      return;
    }
    if (ev.key === 'Escape' && help.isOpen()) {
      ev.preventDefault();
      help.close();
    }
  });

  let lastFrame = performance.now();
  let accumulator = 0;

  function frame(now: number): void {
    const elapsed = Math.min((now - lastFrame) / 1000, 0.25);
    lastFrame = now;

    if (!paused) {
      accumulator += elapsed * timeScale;
      let ticks = 0;
      while (accumulator >= TICK_SECONDS && ticks < MAX_TICKS_PER_FRAME) {
        tick(state);
        accumulator -= TICK_SECONDS;
        ticks += 1;
      }
    }

    for (const record of drainEvents(state)) {
      const event = record.event;
      switch (event.kind) {
        case 'transmission':
          radio.append(record.at, event.from, event.text);
          break;
        case 'separationLoss':
          radio.note(record.at, `SEPARATION LOSS — ${event.a} / ${event.b}`);
          break;
        case 'mvaViolation':
          radio.note(record.at, `MVA — ${event.callsign} below minimum vectoring altitude`);
          break;
        default:
          // STCA blinks on the scope; spawns announce themselves on the radio.
          break;
      }
    }

    layout.clock.textContent = formatSimClock(state.time);
    scope.render(state.snapshot);
    updatePanel();
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
  commandConsole.focus();
}

main();
