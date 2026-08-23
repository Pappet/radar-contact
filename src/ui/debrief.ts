/** Debriefing screen at the end of a session (SPEC §11.5). */

import type { SimEventRecord } from '../sim/events';
import { notableEvents, type SessionSummary } from '../score';
import { formatSimClock } from './layout';

export interface Debrief {
  show(summary: SessionSummary, records: SimEventRecord[]): void;
  isVisible(): boolean;
}

function describe(record: SimEventRecord): { text: string; good: boolean } {
  const event = record.event;
  switch (event.kind) {
    case 'handoffComplete':
      return { text: `${event.callsign} handed to tower`, good: true };
    case 'separationLoss':
      return { text: `Separation lost — ${event.a} / ${event.b}`, good: false };
    case 'mvaViolation':
      return { text: `${event.callsign} below minimum vectoring altitude`, good: false };
    case 'goAround':
      return { text: `${event.callsign} went around (${event.reason})`, good: false };
    default:
      return { text: event.kind, good: true };
  }
}

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;

export function createDebrief(mount: HTMLElement): Debrief {
  const overlay = document.createElement('div');
  overlay.className = 'help-overlay debrief-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="help-backdrop"></div>
    <div class="help-dialog debrief-dialog" role="dialog" aria-modal="true" aria-label="Debriefing">
      <header class="help-head">
        <h2>Session over</h2>
        <span class="debrief-score" data-ref="score"></span>
      </header>
      <p class="help-lead" data-ref="headline"></p>
      <table class="help-table" data-ref="tally"></table>
      <section class="help-section">
        <h3>What happened</h3>
        <div class="debrief-events" data-ref="events"></div>
      </section>
      <p class="help-lead help-dim">Reload the page to fly the sector again.</p>
    </div>
  `;
  mount.appendChild(overlay);

  const pick = <T extends HTMLElement>(ref: string): T => {
    const el = overlay.querySelector<T>(`[data-ref="${ref}"]`);
    if (!el) throw new Error(`Debrief element missing: ${ref}`);
    return el;
  };

  return {
    isVisible: () => !overlay.hidden,
    show(summary, records) {
      const scoreEl = pick('score');
      scoreEl.textContent = `${summary.score > 0 ? '+' : ''}${summary.score}`;
      scoreEl.classList.toggle('is-negative', summary.score < 0);

      const average =
        summary.averageTimeInSector === null
          ? '—'
          : formatSimClock(summary.averageTimeInSector).replace(/^00:/, '');
      pick('headline').textContent =
        `${plural(summary.handoffs, 'clean handoff')}, average ${average} in the sector.`;

      const tally = pick('tally');
      tally.replaceChildren();
      const lines: [string, string][] = [
        ['Handed to tower', `${summary.handoffs} × +100`],
        ['Landed without handoff', `${summary.landedWithoutHandoff} × 0`],
        ['Separation lost', `${summary.separationLosses} × −1000`],
        ['Below MVA', `${summary.mvaViolations} × −300`],
        ['Go-arounds', `${summary.goArounds} × −200`],
        ['Still airborne at the bell', `${summary.stillAirborne}`],
      ];
      for (const [label, value] of lines) {
        const row = document.createElement('tr');
        const left = document.createElement('td');
        left.className = 'help-key';
        left.textContent = label;
        const right = document.createElement('td');
        right.className = 'help-what';
        right.textContent = value;
        row.append(left, right);
        tally.appendChild(row);
      }

      const events = pick('events');
      events.replaceChildren();
      const notable = notableEvents(records);
      if (notable.length === 0) {
        const quiet = document.createElement('p');
        quiet.className = 'help-lead help-dim';
        quiet.textContent = 'Nothing worth reporting — a quiet session.';
        events.appendChild(quiet);
      }
      for (const record of notable) {
        const { text, good } = describe(record);
        const line = document.createElement('div');
        line.className = `debrief-line ${good ? 'is-good' : 'is-bad'}`;

        const time = document.createElement('span');
        time.className = 'radio-time';
        time.textContent = formatSimClock(record.at);

        const body = document.createElement('span');
        body.textContent = text;

        line.append(time, body);
        events.appendChild(line);
      }

      overlay.hidden = false;
    },
  };
}
