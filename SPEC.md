# SPEC — Radar Contact (v1)

Bau-Spezifikation für ein realistisches 2D-Approach-Control-Radarspiel im Browser. Dieses Dokument ist self-contained: alles Nötige steht hier. Meilensteine in §14, Nicht-Ziele in §15.

## §1 Spielidee

Der Spieler ist Anfluglotse. Flugzeuge erscheinen über Einflugpunkten (STARs) am Sektorrand und müssen per Funkanweisungen (Heading, Höhe, Speed) gestaffelt, sequenziert und auf das ILS der aktiven Piste geführt werden, dann an den Tower übergeben. Kernregeln: 3 NM oder 1000 ft Staffelung, Wake-Turbulence-Abstände auf dem Final, Mindesthöhen (MVA). Das Radar aktualisiert nur alle 4 Sekunden — der Spieler sieht Snapshots, nicht die Wahrheit. Sessionende nach konfigurierbarer Dauer → Debriefing mit Score.

## §2 Stack & Projektstruktur

Vite `vanilla-ts`, TypeScript strict, Vitest. Canvas 2D für das Radar, DOM für Panels. Bei den devDependencies mindestens `vite@7` und `vitest@3` — ältere Majors ziehen eine esbuild-Kette mit bekannten Advisories nach. Struktur:

```
src/
  sim/            # pure Logik, keine Browser-APIs
    constants.ts    # alle Aviation-Konstanten aus dieser SPEC
    state.ts        # SimState, tick(), Snapshot-Pipeline; re-exportiert den RNG
    rng.ts          # seeded RNG (Mulberry32) — eigenes Modul, damit state.ts
                    #   und pilot.ts einander nicht zyklisch importieren
    geo.ts          # Vec2, Winkel- und Vektormathematik auf dem NM-Grid (§4)
    events.ts       # SimEvent, SimEventRecord und die Event-Senke (§3)
    aircraft.ts     # AircraftState, Typ-Profile laden
    physics.ts      # §5
    pilot.ts        # §6
    commands.ts     # Command-Union, dispatch()
    phases.ts       # §7 FSM
    separation.ts   # §8
    scenario.ts     # Spawning, Airport laden/validieren
  radar/          # Canvas
    transform.ts    # NM ↔ Screen, Pan/Zoom — reine Mathematik (§4)
    theme.ts        # Paletten (§9)
    scope.ts, maps.ts, blips.ts, labels.ts, tools.ts   # §9
  ui/             # DOM
    parser.ts       # Konsolengrammatik plus Kommando-Referenz (§11.3, §11.6)
    help.ts         # Hilfe-Overlay (§11.6)
    layout.ts, radio.ts, console.ts, cmdpanel.ts, debrief.ts  # §11
  audio/          # §12 (erst M5)
    sfx.ts, tts.ts
  phraseology.ts  # §10
  data/
    aircraft.json   # §13.1
    airports/training-west.json  # §13.2
  main.ts         # Loop & Verdrahtung §3
```

## §3 Zeitmodell & Loop

- `requestAnimationFrame` treibt Rendering und UI. Simulation über Accumulator: 1 Tick = 1 s Spielzeit. Zeitraffer ×1/×2/×4 (mehr Ticks pro Realsekunde), Pause möglich.
- Alle 4 Sim-Sekunden entsteht ein `RadarSnapshot` (Positionen, Höhen, GS, Trails: die letzten 6 Snapshot-Positionen, Label-Offsets). Das Canvas zeichnet ausschließlich den letzten Snapshot. STCA-Blinken, Selektion, Label-Drag laufen mit 60 fps darüber.
- RNG: Mulberry32, Seed pro Session (anzeigbar). Gleicher Seed + Szenario + Command-Historie ⇒ identischer Verlauf.
- SimEvents (Queue pro Tick) verbinden Sim mit UI/Audio:

```ts
type SimEvent =
  | { kind: 'transmission'; from: 'atc' | 'pilot'; callsign: string; text: string }
  | { kind: 'separationLoss'; a: string; b: string }
  | { kind: 'stca'; pairs: [string, string][] }
  | { kind: 'goAround'; callsign: string; reason: 'notEstablished' | 'tooHigh' | 'spacing' }
  | { kind: 'handoffComplete'; callsign: string }
  | { kind: 'mvaViolation'; callsign: string }
  | { kind: 'spawned'; callsign: string; star: string };
```

Die Queue führt jedes Event mit seiner Sim-Zeit, weil ein Frame bei Zeitraffer mehrere Ticks rechnet und Funkprotokoll (§11.2) wie Debriefing (§11.5) exakte Zeitstempel brauchen:

```ts
interface SimEventRecord { at: number; event: SimEvent }   // at = Sim-Zeit in s
```

Der `SimState` trägt den geladenen Airport als Ganzes (Fixes, STARs, MVA-Sektoren, Tower-Frequenz, offener Spawn-Schedule), damit alle Prüfungen aus derselben Quelle lesen. Das Windprofil bleibt bewusst daneben und still, bis M3 es einschaltet (§14).

## §4 Koordinaten & Datenmodell

Kartesisches NM-Grid, Ursprung = Schwelle der Piste 14, x = Ost, y = Nord. Screen-Transform (Pan/Zoom) nur in `radar/transform.ts` (reine Mathematik, ohne DOM) und `radar/scope.ts` (Anwendung aufs Canvas); alles andere rechnet ausschließlich in NM.

```ts
interface AircraftState {
  id: string; callsign: string; type: string;      // Key in aircraft.json
  pos: Vec2; altitude: number;                     // NM, ft
  heading: number; track: number;                  // ° true
  ias: number; tas: number; gs: number; vs: number;// kt, kt, kt, ft/min
  target: { heading?: { deg: number; turn: 'L' | 'R' | 'auto' };
            altitude: number; speed: number; directTo?: string };
  phase: Phase;                                    // §7
  wake: 'L' | 'M' | 'H';
  squawk: string; onFrequency: boolean;
  clearedIls?: string;
  pilot: { queue: { cmds: Command[]; executeAt: number }[]; hearbackTaken?: Command[] };
  spawnedAt: number; labelOffset: Vec2;
  route: string[];                                 // noch zu fliegende Fixes der STAR (§7)
  star?: string;                                   // Name der STAR, für die Erstanmeldung (§10)
  trail: Vec2[];                                   // letzte Snapshot-Positionen (§3)
}

type Command =
  | { kind: 'heading'; deg: number; turn: 'L' | 'R' | 'auto' }
  | { kind: 'altitude'; ft: number }
  | { kind: 'speed'; kt: number | 'normal' }
  | { kind: 'direct'; fix: string }
  | { kind: 'ils'; runway: string }
  | { kind: 'hold'; fix: string }        // M4
  | { kind: 'handoff' }
  | { kind: 'squawk'; code: string };
```

## §5 Physik (pro Tick, Reihenfolge einhalten)

1. **Pilot-Queue** (§6): fällige Commands werden zu Targets.
2. **Heading:** Drehen Richtung Target mit `rate = min(3.0, 508 / TAS)` °/s (25°-Bank-Limit); Drehrichtung laut Command, bei `auto` kürzester Weg. `directTo` setzt das Target-Heading laufend auf die Peilung zum Fix (Wind driftet, gut genug für v1).
3. **Speed:** IAS Richtung Target, ±1.0 kt/s im Horizontalflug, −0.5 kt/s wenn gleichzeitig gesunken wird.
4. **Höhe:** Richtung Target mit Typ-Rate (aircraft.json); während Verzögerung im Sinkflug gilt Sinkrate × 0.6 („slow down or go down").
5. **Atmosphäre/Wind:** `TAS = IAS × (1 + 0.02 × altitude/1000)`. Wind linear zwischen `surface` (0 ft) und `fl100` (10 000 ft) interpoliert, darüber konstant. GS/Track per Vektoraddition TAS-Vektor + Windvektor.
6. **Position** integrieren (GS, Track).
7. **FSM** prüfen (§7), dann **Separation/STCA/MVA** (§8).

Regeln: Zuweisungen unter 10 000 ft mit IAS > 250 kt lehnt der Pilot ab („unable, speed restriction"). Speeds außerhalb `[vMin, vMax]` des Typs ⇒ „unable" mit dem Grund „aircraft performance". MVA-Unterschreitung führt der Pilot aus (das ist ein Lotsenfehler und wird als Event gewertet, einmal je Flieger).

Geprüft wird die Ausführbarkeit **zum Ausführungszeitpunkt**, also nach der Reaktionsverzögerung (§6) und gegen den Zustand von dann: ein „unable" ist eine Pilotenreaktion, keine Eingabevalidierung. Enthält eine Transmission mehrere Commands, wird der annehmbare Teil normal gelesen und ausgeführt; je Ablehnungsgrund kommt zusätzlich ein „unable".

„resume normal speed" setzt die Zielgeschwindigkeit auf `clamp(vMin, 250 kt, vMax)` unter 10 000 ft und auf `clamp(vMin, 280 kt, vMax)` darüber — unterhalb FL100 gilt die 250-kt-Beschränkung, darüber eine typische Anflug-Reisegeschwindigkeit statt des strukturellen Maximums.

## §6 Pilotenmodell

Reaktionsverzögerung je Transmission: Normalverteilung μ=3.5 s, σ=1 s, geclampt auf [2, 6] (seeded RNG, Sim-Zeit). Ablauf: ATC-Transmission (Event sofort) → nach Delay prüft der Pilot die Ausführbarkeit (§5) → Readback der angenommenen Commands bzw. „unable" je Ablehnungsgrund (Events) → angenommene Commands werden Targets. Hearback-Error (ab M4, Rate konfigurierbar, Default 0.03): genau ein numerischer Wert im Readback und in der Ausführung weicht ab (Höhe ±1000 ft oder Heading ±10°). Eine korrigierende Neuanweisung ist der normale Weg zur Behebung. Die Rate gilt je Transmission (nicht je Command); der Wurf wird pro angenommener Transmission einmal gezogen, nur Heading und Altitude können verhört werden. Im Host konfigurierbar über `?hearback=0…1` (Default aus `sim/constants.ts`), im Test über `SimStateOptions.hearbackErrorRate`.

## §7 Phasen-FSM & ILS

`Phase = 'STAR' | 'VECTOR' | 'CLEARED_ILS' | 'LOC' | 'GS' | 'HANDOFF' | 'GOAROUND' | 'DONE'`

- **STAR:** fliegt die Fixfolge der zugewiesenen STAR mit `entryAlt`. Ein Fix gilt ab 1.0 NM Abstand als überflogen (`FIX_CAPTURE_RADIUS_NM`), dann wird auf den nächsten geschaltet; nach dem letzten Fix hält der Flieger sein Heading, bis der Lotse übernimmt. Jeder Heading-/Direct-Command wechselt zu VECTOR.
- **CLEARED_ILS** (nach `ils`-Command): fliegt aktuelle Targets weiter. **LOC-Capture**, wenn Querabstand zur verlängerten Anfluggrundlinie ≤ 0.5 NM **und** Schnittwinkel ≤ 30°. Danach folgt der Track dem Anflugkurs (137°).
- **GS-Capture** nur von unten: wenn `altitude ≤ 318 × dist_NM` (3°-Gleitpfad, Schwelle = 0 ft). Danach VS so, dass der Gleitpfad gehalten wird; der Pilot reduziert selbstständig auf `vApp`, spätestens ab 5 NM.
- **Go-Around** (Event mit reason): beim Passieren von 6 NM Final wird einmalig beides geprüft — nicht LOC-established ⇒ `notEstablished`, und mehr als 300 ft über dem Gleitpfad (`altitude > 318 × dist_NM + 300`) ⇒ `tooHigh`. Unabhängig davon: unterschreitet der Abstand zum Vordermann auf dem Final die Wake-Matrix bei ≤ 4 NM ⇒ `spacing`. Missed Approach: geradeaus steigen auf 4000 ft, dann Phase VECTOR (Lotse übernimmt wieder).
- **HOLD** (`hold`-Command, M4): published Holding am Fix als Racetrack mit rechtsdrehenden 180°-Kurven. Einlauf: der Flieger fliegt direct zum Fix; beim Überflug (Capture-Radius) wird der überflogene Ground-Track als Einflugkurs genommen und rechts auf den Gegenkurs gedreht. Das Auslaufbein wird genau 1 min als windkorrigierter Track geflogen (Crab wie am Localizer), dann rechts zurück. Das Einlaufbein steuert wieder direct zum Fix und endet am Überflug — so zentriert sich die Haltung selbst statt vom Wind wegdriftet zu werden. Hold ersetzt eine ILS-Freigabe und stellt STAR-Flieger auf VECTOR; umgekehrt beendet jedes Heading-/Direct-/ILS-Kommando die Haltung, während Height und Speed erhalten bleiben. Haltende Flieger bleiben voll in Separation, STCA und MVA.
- **HANDOFF** (`handoff`-Command, erlaubt ab LOC/GS und ≤ 10 NM Final): „contact tower", Flieger fliegt weiter, despawnt bei 1 NM als erfolgreich (`handoffComplete`, Phase DONE). Handoff vergessen ⇒ Flieger landet trotzdem, zählt aber nicht als sauber übergeben (Score §11.4).

## §8 Separation, Wake, STCA, MVA

- **Verstoß** (jede Sim-Sekunde, Live-Daten, paarweise, nur Flieger < 15 000 ft und Phase ≠ DONE): horizontal < 3.0 NM **und** vertikal < 1000 ft ⇒ `separationLoss` (pro Paar entprellt: erneut erst nach Wiederherstellung).
- **Wake in-trail auf dem Final** (beide LOC/GS, gleiche Piste): Mindestabstand hinter H: H 4 / M 5 / L 6 NM; L hinter M: 5 NM; sonst 3 NM.
- **STCA:** alle 4 s, lineare Extrapolation aller Paare 120 s voraus in 4-s-Schritten, beginnend bei t = 0 (ein bereits bestehender Konflikt ist auch eine Warnung); wird irgendwo < 3 NM und < 1000 ft prognostiziert ⇒ `stca`-Event, beide Labels blinken. STCA ist Warnung, kein Verstoß.
- **MVA:** Punkt-in-Polygon gegen `mva[]` des Airports; `altitude < minAlt − 100` ⇒ `mvaViolation` (einmal je Flieger). Flieger auf LOC/GS sind ausgenommen.

## §9 Radar-Rendering

- Ein Canvas, devicePixelRatio-korrekt. Layer: gecachte Karte (Offscreen-Canvas: Range Rings alle 10 NM, Fixes als Dreiecke + Name, MVA-Polygone mit Mindesthöhe, Extended Centerline Piste 14 mit Meilenmarken bis 15 NM) → Trails (6 Punkte, alterend kleiner) → Blips (Quadrat 5 px) → Leader Lines → Labels → Messwerkzeug → STCA-Overlay.
- **Data Block** (Monospace, 3 Zeilen): `SWR34K` / `074↓ 22` (Höhe in 100 ft mit ↑/↓/leer bei |vs| < 300 ft/min; GS in 10 kt) / `A320 ↦50` (Typ + Target-Altitude in 100 ft). Label per Leader Line am Blip, Offset per Drag verschiebbar (persistiert im `AircraftState`). Der Drag schreibt den Offset zusätzlich in den aktuellen Snapshot, damit das Label sofort folgt statt bis zum nächsten Sweep zu warten; Position und Höhe bleiben davon unberührt eingefroren.
- Pan (Drag auf leerem Grund) & Zoom (Mausrad, um Cursor). Hit-Test für Selektion auf Blip und Label.
- **Messwerkzeug:** Rechtsklick-Drag von Blip zu Blip zeigt Distanz (NM, eine Nachkommastelle) und Peilung.
- **Themes** (Palette-Objekt, umschaltbar): `classic` bg `#04140a`, Karte `#0f5132`, Text/Blips `#4ade80`, Akzent `#fbbf24`, Alarm `#ef4444` — `modern` bg `#0b1220`, Karte `#1e293b`, Text `#cbd5e1`, Akzent `#38bdf8`, Alarm `#f87171`.

## §10 Phraseologie (nur in phraseology.ts)

Zahlen: Headings dreistellig („heading 090"); Höhen < 10 000 ft als „4000 feet", ab 10 000 ft als „flight level 110" (Wert/100).

ATC-Transmissions beginnen mit dem Callsign („SWR34K, turn left heading 270"), Readbacks enden damit. Die Tabelle listet nur den Kommandoteil (ATC → Readback = gleiche Elemente in Pilotenwortstellung + Callsign am Ende):

| Command | ATC | Readback |
|---|---|---|
| heading | "turn left/right heading 270" / bei auto: "fly heading 270" | "left heading 270, SWR34K" |
| altitude | "descend/climb (and maintain) 5000 feet" | "descend 5000 feet, SWR34K" |
| speed | "reduce/increase speed 180 knots" / "resume normal speed" | "speed 180 knots, SWR34K" |
| direct | "proceed direct AMIKI" | "direct AMIKI, SWR34K" |
| hold | "hold at AMIKI as published" | "hold at AMIKI, SWR34K" |
| ils | "cleared ILS approach runway 14" | "cleared ILS 14, SWR34K" |
| handoff | "contact tower 118 decimal 1" | "tower 118 decimal 1, SWR34K, good day" |
| squawk | "squawk 4271" | "squawk 4271, SWR34K" |
| Erstanmeldung (spawn) | Pilot: "Approach, SWR34K, AMIKI 1A arrival, descending 9000 feet" → ATC auto: "SWR34K, radar contact" | — |
| unable | — | "unable, {grund}, SWR34K" |

Mehrere Commands in einer Transmission werden mit Kommas gereiht („turn left heading 270, descend 5000 feet").

## §11 UI

**§11.1 Layout:** CSS Grid. Links Radar (dominant, min. 70 % Breite), rechts Spalte: Funkprotokoll (flex, scrollend) → Befehlspanel des selektierten Fliegers → Konsole (unten, immer fokussierbar). Kopfzeile: Sim-Uhr, Zeitraffer/Pause, Theme-Toggle, Seed.

**§11.2 Funkprotokoll:** append-only, Auto-Scroll (aussetzend, wenn der Nutzer hochgescrollt hat), ATC und Piloten farblich unterschieden, Timestamp in Sim-Zeit. Ereignisse ohne Funkspruch, die der Lotse sonst übersähe — Separationsverlust und MVA-Unterschreitung — laufen als dritte, alarmfarbene Kategorie mit; STCA bleibt rein visuell auf dem Radar.

**§11.3 Konsole:** Grammatik `CALLSIGN CMD [CMD ...]`, case-insensitiv. Tab vervollständigt Callsigns, ↑/↓ History. Parser-Fehler ⇒ Pilot-Event „say again". Kommandos:

| Eingabe | Bedeutung |
|---|---|
| `L270` / `R270` / `H270` | turn left/right/auto heading 270 |
| `D50` / `C120` | descend/climb, Wert in 100 ft (5000 / 12 000 ft) |
| `S180` / `SN` | speed 180 / resume normal |
| `DCT AMIKI` | direct AMIKI |
| `HOLD AMIKI` | hold at AMIKI (Racetrack, 1-min-Legs, rechts) |
| `ILS14` | cleared ILS runway 14 |
| `TWR` | handoff |
| `SQ4271` | squawk 4271 |

**§11.4 Klick-Panel:** erscheint bei Selektion; Heading-Rose (Klick = auto-turn, Alt-Klick = Gegenrichtung), Höhen-Stepper (±1000 ft) mit Direktwahl, Speed-Presets (160/180/200/220/SN), Buttons ILS 14 und TWR. Erzeugt dieselben Command-Objekte wie die Konsole.

Der Höhen-Stepper rechnet auf der zuletzt geklickten Freigabe weiter, nicht auf der vom Piloten schon quittierten: zwei Klicks innerhalb der Reaktionsverzögerung (§6) ergeben 2000 ft, nicht zweimal 1000 ft. Solange die Freigabe unquittiert ist, steht sie in Akzentfarbe im Feld.

**§11.5 Score & Debriefing:** +100 je `handoffComplete`; −1000 je `separationLoss`; −300 je `mvaViolation`; −200 je `goAround` mit reason ≠ `spacing` durch Vordermann-Fehler des gleichen Spielers (v1: alle Go-Arounds zählen −200); Landung ohne Handoff: +0. Debriefing-Screen am Sessionende: Score, Zähler je Kategorie, Ø-Zeit im Sektor, Ereignisliste mit Sim-Zeitstempeln.

Sessionende (Default 30 min Sim-Zeit) ist ein harter Schnitt: die Simulation hält an, das Debriefing legt sich über das Radar. Noch fliegender Verkehr zählt weder als übergeben noch als verloren, und die Ø-Zeit im Sektor rechnet nur über abgeschlossene Flüge.

**§11.6 Hilfe:** Ein Overlay zeigt, was der Spieler sonst nirgends sieht: die Kommandos mit Bedeutung, die Maus-Bedienung von Radar und Klick-Panel, die Tastenkürzel der Konsole und die Lesart des Datenblocks. Zu öffnen über den `?`-Button in der Kopfzeile, über F1 oder über `?` bzw. `HELP` in der Konsole; Escape, der Button oder ein Klick auf den Hintergrund schließen es.

Die Kommandoliste wird aus derselben Tabelle erzeugt, die der Parser benutzt (`COMMAND_REFERENCE` in `ui/parser.ts`) — Hilfe und Grammatik können damit nicht auseinanderlaufen. Kommandos, die die SPEC kennt, der aktuelle Meilenstein aber noch nicht gebaut hat, stehen gedimmt mit dem Meilenstein, der sie bringt; der Parser lehnt sie mit genau diesem Text ab statt mit „unknown command". Unter der Eingabezeile steht dauerhaft ein kurzer Hinweis, der nach einer Statusmeldung von selbst zurückkehrt.

## §12 Audio (M5)

Prozedural via Web Audio, keine Assets: Squelch-Klick (15 ms Noise-Burst, Bandpass ~2 kHz) vor/nach jeder Transmission; leises Rausch-Bett (Gain ≤ 0.03, abschaltbar); STCA-Alarm (Zweiklang-Piep). TTS über `speechSynthesis`: pro Flieger eine Voice aus den verfügbaren englischen Stimmen (Rotation), rate 1.05–1.2 und pitch 0.9–1.1 leicht variiert (seeded). Voices laden asynchron (`voiceschanged`) — defensiv behandeln, Fallback: nur Text + SFX. Kein Versuch, speechSynthesis durch Web-Audio-Filter zu routen (geht nicht).

## §13 Daten

**§13.1 `aircraft.json`** — Startbestand:

| type | wake | climb ft/min | descent ft/min | vMin | vApp | vMax |
|---|---|---|---|---|---|---|
| A320 | M | 2200 | 1800 | 160 | 137 | 320 |
| B738 | M | 2100 | 1900 | 160 | 141 | 320 |
| E190 | M | 2300 | 1900 | 150 | 126 | 300 |
| DH8D | M | 1500 | 1500 | 130 | 115 | 245 |
| B77W | H | 2000 | 1700 | 170 | 149 | 320 |

**§13.2 `airports/training-west.json`** — fiktiver Trainingssektor, eine Piste 14 (Anflugkurs 137°, Schwelle im Ursprung). Beim Laden validieren, Fehler klar melden.

```jsonc
{
  "name": "TRAINING WEST", "towerFreq": "118.1",
  "runways": [{ "id": "14", "thr": [0, 0], "course": 137, "gsAngle": 3.0 }],
  "fixes": { "AMIKI": [-30, 2], "NOKRA": [-2, 32], "RILAX": [26, 22], "OKTAV": [-14, 8] },
  "stars": [
    { "name": "AMIKI 1A", "route": ["AMIKI", "OKTAV"], "entryAlt": 8000 },
    { "name": "NOKRA 2B", "route": ["NOKRA", "OKTAV"], "entryAlt": 9000 },
    { "name": "RILAX 1C", "route": ["RILAX"], "entryAlt": 9000 }
  ],
  "mva": [
    { "polygon": [[-45,-45],[45,-45],[45,45],[-45,45]], "minAlt": 3000 },
    { "polygon": [[12,8],[42,8],[42,38],[12,38]], "minAlt": 5000 }
  ],
  "windProfile": { "surface": { "dir": 140, "kt": 8 }, "fl100": { "dir": 210, "kt": 35 } },
  "spawn": [
    { "t": 20,  "callsign": "SWR34K", "type": "A320", "star": "AMIKI 1A" },
    { "t": 140, "callsign": "DLH4TA", "type": "B738", "star": "RILAX 1C" },
    { "t": 260, "callsign": "EZS61B", "type": "A320", "star": "NOKRA 2B" },
    { "t": 380, "callsign": "AUA904", "type": "E190", "star": "AMIKI 1A" },
    { "t": 500, "callsign": "SWR17E", "type": "B77W", "star": "RILAX 1C" },
    { "t": 620, "callsign": "GAC22",  "type": "DH8D", "star": "NOKRA 2B" }
  ]
}
```

MVA-Polygone überlappen: es gilt das Maximum aller Polygone, die den Punkt enthalten. Prozeduraler Endlosmodus (M5): Poisson-Ankünfte, Startintervall μ=120 s, alle 10 min × 0.85 (Untergrenze 45 s); Typ/STAR/Callsign seeded zufällig aus Bestandslisten.

## §14 Meilensteine mit Definition of Done

Getestet wird `sim/` und `phraseology.ts`, ohne Browser-Harness. Die beiden Einheiten, die M0 und M1 zusätzlich abdecken müssen, bleiben deshalb DOM-frei: `radar/transform.ts` (reine Transform-Mathematik) und `ui/parser.ts` (reines Text → `Command[]`). Der Rest von `radar/`, `ui/` und `audio/` bleibt ungetestet.

**M0 — Gerüst.** Vite/TS/Vitest eingerichtet; Koordinatensystem + Transform mit Pan/Zoom; Scope zeigt gecachte Karte des Trainingssektors (Rings, Fixes, MVA, Centerline); Theme umschaltbar. DoD: `npm run dev` zeigt den leeren Sektor; Transform-Unit-Tests (NM↔Screen, Zoom um Cursor) grün.

**M1 — Ein Flieger.** Physik §5 (ohne Wind: Profil vorhanden, aber `kt: 0` im Test-Setup), Snapshot-Pipeline, Blip + Trails + Label + Drag; Konsole mit `L/R/H/D/C/S`; Pilot-Delay + Readback im Funkprotokoll; Erstanmeldung beim Spawn. DoD: manuell ein per Hardcode gespawnter A320 lässt sich vektorieren, Anzeige springt im 4-s-Takt; Tests: Turn-Geometrie (kürzeste Richtung, kein Überschießen), IAS→TAS, Parser inkl. Fehlerfälle.

**M2 — Verkehr.** Szenario-/Airport-Laden mit Validierung, Spawn-Schedule, STAR-Phase, Selektion + Klick-Panel, Separation §8 (ohne Wake), STCA, MVA. DoD: training-west.json läuft; provozierter Konflikt löst STCA und danach separationLoss aus; Tests: Separation-Paarlogik, Punkt-in-Polygon, STCA-Extrapolation.

**M3 — Spielbar (MVP).** ILS-FSM §7 komplett inkl. Go-Around und Handoff; Wind aktiv; Score + Debriefing; Sessionende (Default 30 min Sim-Zeit). Der `spacing`-Go-Around entsteht hier mit dem einfachen 3-NM-Mindestabstand; M4 ersetzt nur die Distanz durch die Wake-Matrix. DoD: eine volle Session ist von Spawn bis Debriefing spielbar; Tests: LOC-Capture aus beiden Seiten + Ablehnung bei > 30°, GS-Capture nur von unten, Go-Around-Trigger.

**M4 — Handwerk.** Wake-Staffelung auf dem Final, Hearback-Errors, `HOLD` (published Holding am Fix: Racetrack, 1-min-Legs, rechts), Messwerkzeug, `DCT`, Feinschliff Labels/Panels. DoD: Tests Wake-Matrix und Hearback-Abweichung; Holding hält Flieger stabil am Fix.

**M5 — Leben.** SFX + TTS §12; prozeduraler Endlosmodus; Events: Squawk-7700-Notfall (Pilot meldet Mayday, erwartet Priorität; Score-Malus, wenn > 5 min bis Handoff) und Windshift-Ereignis (Windprofil dreht über 2 min; rein informativ, kein Bahnwechsel in v1). DoD: Golden-Test — festes Szenario + Seed + Command-Skript ⇒ exakt erwartete Event-Sequenz als Fixture.

## §15 Nicht-Ziele v1

Keine Departures, kein Bahnwechsel, kein QNH/Transition-Handling (Mode-C zeigt direkt Fuß), kein Backend/Multiplayer, kein Szenario-Editor, keine automatische Label-Entzerrung, kein Voice-Input, kein espeak-WASM-Funkfilter (Kandidat für v2).
