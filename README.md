# Radar Contact

Realistisches 2D-Approach-Radar-Spiel im Browser. TypeScript, Vite, Canvas 2D, keine Runtime-Dependencies, kein Backend.

- **SPEC.md** — vollständige Bau-Spezifikation (Physik, Verfahren, Phraseologie, Daten, Meilensteine M0–M5)
- **CLAUDE.md** — Projektregeln und Architektur-Invarianten für Claude Code

## Status

**M0–M3 sind fertig** (M3 „Spielbar" via PR #7): Eine volle Session ist von
Spawn bis Debriefing spielbar — Verkehr über Spawn-Schedule und STAR-Phasen,
Vektorieren per Konsole und Klick-Panel, Separation/STCA/MVA, ILS-FSM mit
LOC/GS-Capture, Go-Around, Handoff an den Tower, Wind, Score nach §11.5.

Als Nächstes M4 (Handwerk): Wake-Staffelung auf dem Final, Hearback-Errors,
`HOLD`, `DCT`, Messwerkzeug, Feinschliff Labels/Panels.

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
  durch die History. Verfügbar: `L270` / `R270` / `H270` (Heading links /
  rechts / kürzester Weg), `D50` / `C120` (Sink-/Steigflug in 100 ft),
  `S180` / `SN` (Speed / normal), `DCT <FIX>` (Direct), `HOLD <FIX>`
  (Racetrack am Fix), `ILS14` und `TWR`.
- **Radar**: Ziehen auf leerem Grund schwenkt, Mausrad zoomt um den Cursor,
  Klick auf Blip oder Label selektiert, Ziehen am Label verschiebt den
  Datenblock. Rechtsklick-Drag von Blip zu Blip misst Distanz und Peilung.
- **Kopfzeile**: Sim-Uhr, Zeitraffer ×1/×2/×4, Pause, Theme-Umschalter
  (classic/modern), Seed.
- **Hearback-Errors** (Piloten verhören sich mit 3 % Chance je Freigabe):
  abschaltbar oder erhöhbar über `?hearback=0` bis `?hearback=1`.

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
