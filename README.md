# Radar Contact

Realistisches 2D-Approach-Radar-Spiel im Browser. TypeScript, Vite, Canvas 2D, keine Runtime-Dependencies, kein Backend.

- **SPEC.md** — vollständige Bau-Spezifikation (Physik, Verfahren, Phraseologie, Daten, Meilensteine M0–M5)
- **CLAUDE.md** — Projektregeln und Architektur-Invarianten für Claude Code

## Status

**M0 (Gerüst) und M1 (Ein Flieger) sind fertig.** Spielbar ist damit: ein
hartkodiert gespawnter A320 auf der AMIKI 1A, der sich per Konsole vektorieren
lässt. Das Radarbild friert im 4-Sekunden-Takt ein.

Als Nächstes M2 (Verkehr): Airport-Validierung, Spawn-Schedule, STAR-Phase,
Klick-Panel, Separation/STCA/MVA.

## Entwicklung

```bash
npm install
npm run dev        # Dev-Server, dann http://localhost:5173
npm test           # Vitest (sim/, phraseology, Parser, Transform)
npm run typecheck  # tsc --noEmit
npm run build      # statischer Build nach dist/
```

Seed festlegen (reproduzierbarer Verlauf): `http://localhost:5173/?seed=1234`.

### Bedienung

- **Konsole** (unten rechts, immer fokussierbar): `CALLSIGN CMD [CMD ...]`,
  z. B. `SWR34K L270 D50 S220`. Tab vervollständigt Callsigns, ↑/↓ blättert
  durch die History. Verfügbar in M1: `L270` / `R270` / `H270` (Heading links /
  rechts / kürzester Weg), `D50` / `C120` (Sink-/Steigflug in 100 ft),
  `S180` / `SN` (Speed / normal). `DCT`, `ILS`, `TWR`, `SQ` kommen mit M2–M4.
- **Radar**: Ziehen auf leerem Grund schwenkt, Mausrad zoomt um den Cursor,
  Klick auf Blip oder Label selektiert, Ziehen am Label verschiebt den
  Datenblock.
- **Kopfzeile**: Sim-Uhr, Zeitraffer ×1/×2/×4, Pause, Theme-Umschalter
  (classic/modern), Seed.

## Loslegen

Claude Code im Repo-Root starten und beauftragen:

```
Lies zuerst CLAUDE.md und SPEC.md vollständig. Setze das Projekt auf
und implementiere die Meilensteine M0 und M1 gemäß SPEC §14. Halte die
Architektur-Invarianten strikt ein. Schreibe die geforderten Tests,
prüfe mit npx tsc --noEmit und npm test, und beende mit Statusbericht
und Startanleitung.
```

Danach meilensteinweise weiter (M2, M3, …) — nach jedem Meilenstein kurz selbst fliegen, bevor der nächste beauftragt wird. Entscheidungen, die unterwegs fallen, in die SPEC zurückschreiben.
