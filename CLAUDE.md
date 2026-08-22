# Radar Contact — Projektregeln

Realistisches 2D-Approach-Radar-Spiel im Browser. Vollständige Spezifikation: **SPEC.md** — sie ist die Wahrheit für alle fachlichen Fragen (Physikwerte, Phraseologie, Verfahren, Meilensteine).

## Stack

TypeScript (strict), Vite (vanilla-ts), Canvas 2D, DOM-Panels, Vitest. **Keine Runtime-Dependencies** ohne Rückfrage (einzige vorab genehmigte Ausnahme: `zod` für JSON-Validierung, optional). Kein Framework, kein Backend, Persistenz nur via localStorage.

## Architektur-Invarianten (nicht verhandelbar)

1. `src/sim/` importiert **niemals** DOM-, Canvas- oder sonstige Browser-APIs. Reine, deterministische Logik.
2. Kein `Math.random()` in `src/sim/` — ausschließlich der seeded RNG aus `sim/rng.ts` (über `sim/state.ts` re-exportiert).
3. Fixed Timestep: 1 Sim-Tick = 1 s Spielzeit (Accumulator-Pattern). Zeitraffer erhöht Ticks/Realsekunde, ändert nie die Tick-Länge. Pilot-Verzögerungen laufen in Sim-Zeit.
4. Das Radar rendert ausschließlich **Snapshots** (alle 4 Sim-Sekunden eingefroren). Niemals Live-Positionen zeichnen oder interpolieren. Separation wird dagegen jede Sim-Sekunde auf Live-Daten geprüft. Einzige Ausnahme sind reine Darstellungswerte ohne Flugbezug: der Label-Offset wird beim Ziehen sofort in den aktuellen Snapshot geschrieben (SPEC §9). Position, Höhe, GS und VS bleiben eingefroren.
5. Ein Command-Pfad: Klick-UI und Konsole erzeugen identische `Command`-Objekte → `dispatch(callsign, commands)`. Keine Seiteneingänge in die Sim.
6. Funksprech-Wissen liegt nur in `src/phraseology.ts`.
7. Airports und Flugzeugtypen sind Daten (`src/data/*.json`), nie Code. Alle Aviation-Konstanten (Separationsminima, Turn Rate, Wake-Matrix …) in `src/sim/constants.ts`.

## Arbeitsweise

- Meilensteinweise nach SPEC.md (M0–M5), in Reihenfolge. Nichts aus späteren Meilensteinen vorziehen.
- Ein Meilenstein gilt als fertig, wenn seine Definition-of-Done-Punkte erfüllt sind, `npx tsc --noEmit` sauber ist und `npm test` grün.
- Nach jedem Meilenstein: kurzer Statusbericht (was fertig, was offen, wie manuell testen).
- Bei Widersprüchen oder Lücken in der SPEC: kurz nachfragen statt still umdeuten.

## Befehle

- `npm run dev` — Dev-Server
- `npm test` — Vitest, kein Browser-Harness. Getestet wird `sim/` und `phraseology.ts`; dazu die zwei Einheiten, die die DoD von M0/M1 verlangt und die deshalb DOM-frei bleiben: `radar/transform.ts` und `ui/parser.ts` (SPEC §14). `radar/`, `ui/` und `audio/` bleiben sonst ungetestet.
- `npm run typecheck` — `tsc --noEmit`
- `npm run build` — Typecheck plus statischer Build nach `dist/`

## Konventionen

- Code, Bezeichner und UI-Texte auf Englisch; Funksprüche in ICAO-Phraseologie (SPEC §10).
- Koordinaten in NM (kartesisch, y = Nord), Höhen in ft, Speeds in kt. Pixel existieren nur in `src/radar/` — einzige Ausnahme ist `AircraftState.labelOffset`, der laut SPEC §4 im State liegt und in Screen-Pixeln zählt.
- Schlanke Module und Funktionen statt Klassenhierarchien; Discriminated Unions für Commands/Events/Phasen.
