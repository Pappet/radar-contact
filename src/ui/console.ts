/**
 * The command console (SPEC §11.3): Tab completes callsigns, ↑/↓ walk the
 * history, Enter submits. Parsing itself lives in parser.ts.
 */

import { parseCommandLine, type ParseResult } from './parser';

export interface ConsoleOptions {
  /** Callsigns currently on frequency, for Tab completion. */
  callsigns: () => string[];
  onSubmit: (result: ParseResult, raw: string) => void;
}

export interface CommandConsole {
  focus(): void;
  setHint(text: string): void;
  setPrefill(text: string): void;
}

export function createConsole(pane: HTMLElement, options: ConsoleOptions): CommandConsole {
  pane.innerHTML = `
    <div class="console-hint" data-ref="hint">CALLSIGN then commands — L270 R090 H360 D50 C120 S180 SN</div>
    <div class="console-row">
      <span class="console-prompt">&gt;</span>
      <input class="console-input" data-ref="input" type="text" spellcheck="false"
             autocomplete="off" placeholder="SWR34K L270 D50" />
    </div>
  `;

  const inputEl = pane.querySelector<HTMLInputElement>('[data-ref="input"]');
  const hintEl = pane.querySelector<HTMLElement>('[data-ref="hint"]');
  if (!inputEl || !hintEl) throw new Error('Console markup incomplete');
  const input: HTMLInputElement = inputEl;
  const hint: HTMLElement = hintEl;

  const history: string[] = [];
  let historyIndex = 0;

  function completeCallsign(): void {
    const value = input.value;
    const [first, ...rest] = value.split(/\s+/);
    if (rest.length > 0 || !first) return;

    const prefix = first.toUpperCase();
    const matches = options.callsigns().filter((cs) => cs.startsWith(prefix));
    if (matches.length === 1 && matches[0]) input.value = `${matches[0]} `;
    else if (matches.length > 1) hint.textContent = matches.join('  ');
  }

  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Tab') {
      ev.preventDefault();
      completeCallsign();
      return;
    }
    if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
      if (history.length === 0) return;
      ev.preventDefault();
      historyIndex =
        ev.key === 'ArrowUp'
          ? Math.max(0, historyIndex - 1)
          : Math.min(history.length, historyIndex + 1);
      input.value = history[historyIndex] ?? '';
      return;
    }
    if (ev.key === 'Enter') {
      const raw = input.value.trim();
      if (!raw) return;
      history.push(raw);
      historyIndex = history.length;
      input.value = '';
      options.onSubmit(parseCommandLine(raw), raw);
    }
  });

  return {
    focus: () => input.focus(),
    setHint: (text) => {
      hint.textContent = text;
    },
    setPrefill: (text) => {
      input.value = text;
      input.focus();
    },
  };
}
