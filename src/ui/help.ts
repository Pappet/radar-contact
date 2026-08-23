/**
 * In-game help (SPEC §11.6). The command list is built from
 * COMMAND_REFERENCE, so it always matches what the parser accepts.
 */

import { COMMAND_REFERENCE, type CommandDoc } from './parser';

export interface HelpOverlay {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
}

interface Shortcut {
  keys: string;
  what: string;
}

const RADAR_HELP: Shortcut[] = [
  { keys: 'Drag', what: 'Pan the picture' },
  { keys: 'Wheel', what: 'Zoom around the cursor' },
  { keys: 'Click blip', what: 'Select the aircraft' },
  { keys: 'Drag label', what: 'Move the data block aside' },
  { keys: 'Click ground', what: 'Deselect' },
];

const PANEL_HELP: Shortcut[] = [
  { keys: 'Click rose', what: 'Turn onto that heading, short way' },
  { keys: 'Alt-click', what: 'Turn the other way round' },
  { keys: '− / +', what: 'Cleared altitude by 1000 ft' },
  { keys: 'Type + Enter', what: 'Altitude directly (5000 or 50)' },
  { keys: '160 … SN', what: 'Speed presets' },
];

const CONSOLE_HELP: Shortcut[] = [
  { keys: 'Tab', what: 'Complete the callsign' },
  { keys: '↑ / ↓', what: 'Earlier transmissions' },
  { keys: '? or HELP', what: 'Open this help' },
  { keys: 'F1', what: 'Open it from anywhere' },
  { keys: 'Esc', what: 'Close it' },
];

/**
 * Rows are built through the DOM rather than innerHTML: the syntax column
 * contains angle brackets like "L<hdg>", which markup would swallow.
 */
function fillTable(table: HTMLElement, entries: { key: string; what: string; pending?: string }[]): void {
  for (const entry of entries) {
    const row = document.createElement('tr');
    if (entry.pending) row.className = 'is-pending';

    const key = document.createElement('td');
    key.className = 'help-key';
    key.textContent = entry.key;

    const what = document.createElement('td');
    what.className = 'help-what';
    what.textContent = entry.what;
    if (entry.pending) {
      const badge = document.createElement('span');
      badge.className = 'help-pending';
      badge.textContent = entry.pending;
      what.append(' ', badge);
    }

    row.append(key, what);
    table.appendChild(row);
  }
}

const asEntries = (items: Shortcut[]) => items.map((i) => ({ key: i.keys, what: i.what }));

const asCommandEntries = (docs: CommandDoc[]) =>
  docs.map((doc) => ({
    key: doc.syntax,
    what: doc.meaning,
    ...(doc.comingIn ? { pending: doc.comingIn } : {}),
  }));

export function createHelpOverlay(mount: HTMLElement): HelpOverlay {
  const available = COMMAND_REFERENCE.filter((doc) => !doc.comingIn);
  const pending = COMMAND_REFERENCE.filter((doc) => doc.comingIn);

  const overlay = document.createElement('div');
  overlay.className = 'help-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="help-backdrop" data-ref="backdrop"></div>
    <div class="help-dialog" role="dialog" aria-modal="true" aria-label="Help">
      <header class="help-head">
        <h2>Controls</h2>
        <button class="btn" data-ref="close" aria-label="Close help">Esc</button>
      </header>

      <section class="help-section">
        <h3>Radio</h3>
        <p class="help-lead">
          Type <code>CALLSIGN</code> followed by one or more commands, then Enter.
          Case does not matter, and several commands go out as one transmission:
          <code>SWR34K L270 D50 S180</code>. The pilot reads back after two to six
          seconds — until then nothing has changed.
        </p>
        <table class="help-table" data-ref="cmd-available"></table>
        <p class="help-lead help-dim">Written down, not built yet:</p>
        <table class="help-table" data-ref="cmd-pending"></table>
      </section>

      <div class="help-columns">
        <section class="help-section">
          <h3>Radar</h3>
          <table class="help-table is-shortcuts" data-ref="radar"></table>
        </section>
        <section class="help-section">
          <h3>Aircraft panel</h3>
          <table class="help-table is-shortcuts" data-ref="panel"></table>
        </section>
        <section class="help-section">
          <h3>Console</h3>
          <table class="help-table is-shortcuts" data-ref="console"></table>
        </section>
      </div>

      <section class="help-section">
        <h3>Reading a data block</h3>
        <pre class="help-block">SWR34K
074↓ 22
A320 ↦50</pre>
        <p class="help-lead">
          Callsign · altitude in hundreds of feet with climb/descent arrow and
          ground speed in tens of knots · type and cleared altitude. The picture
          refreshes every four seconds, so what you see is always a little old.
        </p>
      </section>
    </div>
  `;
  mount.appendChild(overlay);

  const pick = <T extends HTMLElement>(ref: string): T => {
    const el = overlay.querySelector<T>(`[data-ref="${ref}"]`);
    if (!el) throw new Error(`Help element missing: ${ref}`);
    return el;
  };

  fillTable(pick('cmd-available'), asCommandEntries(available));
  fillTable(pick('cmd-pending'), asCommandEntries(pending));
  fillTable(pick('radar'), asEntries(RADAR_HELP));
  fillTable(pick('panel'), asEntries(PANEL_HELP));
  fillTable(pick('console'), asEntries(CONSOLE_HELP));

  const api: HelpOverlay = {
    open() {
      overlay.hidden = false;
    },
    close() {
      overlay.hidden = true;
    },
    toggle() {
      overlay.hidden = !overlay.hidden;
    },
    isOpen() {
      return !overlay.hidden;
    },
  };

  pick('close').addEventListener('click', () => api.close());
  pick('backdrop').addEventListener('click', () => api.close());

  return api;
}
