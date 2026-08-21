/**
 * Radio log (SPEC §11.2): append-only, ATC and pilot visually distinct,
 * auto-scroll that steps aside when the controller has scrolled up.
 */

import { formatSimClock } from './layout';

export interface RadioLog {
  append(at: number, from: 'atc' | 'pilot', text: string): void;
  note(at: number, text: string): void;
}

export function createRadioLog(pane: HTMLElement): RadioLog {
  const list = document.createElement('div');
  list.className = 'radio-list';
  pane.appendChild(list);

  let stickToBottom = true;
  pane.addEventListener('scroll', () => {
    const distance = pane.scrollHeight - pane.scrollTop - pane.clientHeight;
    stickToBottom = distance < 24;
  });

  function push(at: number, cssClass: string, text: string): void {
    const line = document.createElement('div');
    line.className = `radio-line ${cssClass}`;

    const time = document.createElement('span');
    time.className = 'radio-time';
    time.textContent = formatSimClock(at);

    const body = document.createElement('span');
    body.className = 'radio-text';
    body.textContent = text;

    line.append(time, body);
    list.appendChild(line);
    if (stickToBottom) pane.scrollTop = pane.scrollHeight;
  }

  return {
    append(at, from, text) {
      push(at, from === 'atc' ? 'from-atc' : 'from-pilot', text);
    },
    note(at, text) {
      push(at, 'note', text);
    },
  };
}
