/**
 * Loop and wiring (SPEC §3). requestAnimationFrame drives rendering; the
 * simulation runs on an accumulator with a fixed one-second tick.
 *
 * M1 flies a single hardcoded arrival — the spawn schedule of the airport file
 * is wired up in M2 (SPEC §14).
 */

import './style.css';
import { TICK_SECONDS } from './sim/constants';
import { dispatch } from './sim/commands';
import { CALM } from './sim/physics';
import { spawnAircraft, TRAINING_WEST } from './sim/scenario';
import { createSimState, drainEvents, emit, setLabelOffset, tick } from './sim/state';
import { bearingTo } from './sim/geo';
import { createScope } from './radar/scope';
import { THEME_NAMES, THEMES, type ThemeName } from './radar/theme';
import { buildLayout, formatSimClock, TIME_SCALES, type TimeScale } from './ui/layout';
import { createRadioLog } from './ui/radio';
import { createConsole } from './ui/console';
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

function main(): void {
  const mount = document.querySelector<HTMLElement>('#app');
  if (!mount) throw new Error('#app missing');

  const airport = TRAINING_WEST;
  const layout = buildLayout(mount);
  const radio = createRadioLog(layout.radioPane);

  const state = createSimState({
    seed: seedFromLocation(),
    // M1 runs without wind; the profile is live from M3 (SPEC §14).
    wind: CALM,
    fixes: airport.fixes,
    towerFreq: airport.towerFreq,
  });

  const scope = createScope(layout.scopePane, airport, {
    onSelect: (id) => {
      const ac = state.aircraft.find((a) => a.id === id);
      layout.selectionPane.textContent = ac
        ? `Selected ${ac.callsign} · ${ac.type} · ${Math.round(ac.altitude)} ft · ${Math.round(ac.ias)} kt`
        : 'No aircraft selected';
      if (ac) commandConsole.setPrefill(`${ac.callsign} `);
    },
    onLabelDrag: (id, offset) => setLabelOffset(state, id, offset),
  });

  const commandConsole = createConsole(layout.consolePane, {
    callsigns: () => state.aircraft.filter((ac) => ac.onFrequency).map((ac) => ac.callsign),
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
      const dispatched = dispatch(state, result.callsign, result.commands);
      commandConsole.setHint(
        dispatched.ok ? `${dispatched.callsign} — transmitted` : `No contact: ${result.callsign}`,
      );
    },
  });

  // --- M1 test traffic: one A320 inbound on the AMIKI 1A arrival. ---
  const amiki = airport.fixes['AMIKI'] ?? { x: -30, y: 2 };
  const oktav = airport.fixes['OKTAV'] ?? { x: -14, y: 8 };
  spawnAircraft(state, {
    callsign: 'SWR34K',
    type: 'A320',
    pos: amiki,
    altitude: 8000,
    heading: bearingTo(amiki, oktav),
    ias: 250,
    targetAltitude: 8000,
    star: 'AMIKI 1A',
  });

  let theme: ThemeName = 'classic';
  let timeScale: TimeScale = 1;
  let paused = false;

  applyTheme(theme);
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
    layout.themeButton.textContent = `Theme: ${theme}`;
  });
  syncRateButtons();

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
      if (record.event.kind === 'transmission') {
        radio.append(record.at, record.event.from, record.event.text);
      }
    }

    layout.clock.textContent = formatSimClock(state.time);
    scope.render(state.snapshot);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
  commandConsole.focus();
}

main();
