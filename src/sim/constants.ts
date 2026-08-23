/**
 * All aviation constants live here (SPEC §5, §6, §9).
 * Nothing tuneable about flight physics or procedures belongs anywhere else.
 */

// --- Time model (SPEC §3) ---
/** One simulation tick equals one second of game time. */
export const TICK_SECONDS = 1;
/** A frozen radar picture is produced every N sim seconds. */
export const SNAPSHOT_INTERVAL_S = 4;
/** Number of past snapshot positions kept per contact. */
export const TRAIL_LENGTH = 6;

// --- Turn performance (SPEC §5.2) ---
/** Standard rate turn ceiling in °/s. */
export const MAX_TURN_RATE_DEG_PER_S = 3.0;
/** Numerator of the 25° bank rate-of-turn approximation: rate = 508 / TAS. */
export const TURN_RATE_BANK_FACTOR = 508;

// --- Speed changes (SPEC §5.3) ---
/** IAS change in level flight, kt per second. */
export const IAS_RATE_LEVEL_KT_PER_S = 1.0;
/** IAS change while descending, kt per second ("slow down or go down"). */
export const IAS_RATE_DESCENDING_KT_PER_S = 0.5;

// --- Vertical (SPEC §5.4) ---
/** Descent rate factor applied while the aircraft is also decelerating. */
export const DESCENT_RATE_DECEL_FACTOR = 0.6;

// --- Atmosphere and wind (SPEC §5.5) ---
/** TAS gain per 1000 ft of altitude: TAS = IAS × (1 + 0.02 × alt/1000). */
export const TAS_GAIN_PER_1000_FT = 0.02;
/** Upper anchor of the wind profile; above this the wind stays constant. */
export const WIND_PROFILE_TOP_FT = 10000;

// --- Speed restrictions (SPEC §5) ---
export const SPEED_RESTRICTION_ALT_FT = 10000;
export const SPEED_RESTRICTION_IAS_KT = 250;
/** "Resume normal speed" above the restriction altitude is capped here. */
export const NORMAL_SPEED_HIGH_KT = 280;

// --- Pilot model (SPEC §6) ---
export const PILOT_DELAY_MEAN_S = 3.5;
export const PILOT_DELAY_SIGMA_S = 1.0;
export const PILOT_DELAY_MIN_S = 2;
export const PILOT_DELAY_MAX_S = 6;

// --- Separation (SPEC §8) ---
/** Horizontal minimum between two aircraft. */
export const SEPARATION_HORIZONTAL_NM = 3.0;
/** Vertical minimum; a pair is only in conflict when both are breached. */
export const SEPARATION_VERTICAL_FT = 1000;
/** Pairs are only watched below this altitude. */
export const SEPARATION_CEILING_FT = 15000;

// --- Short term conflict alert (SPEC §8) ---
/** How far ahead the linear extrapolation looks. */
export const STCA_LOOKAHEAD_S = 120;
/** Step width of that extrapolation. */
export const STCA_STEP_S = 4;

// --- Minimum vectoring altitude (SPEC §8) ---
/** Tolerance below the sector minimum before it counts as a violation. */
export const MVA_BUFFER_FT = 100;

// --- Navigation (SPEC §7) ---
/** Distance at which a fix counts as passed and the next one becomes active. */
export const FIX_CAPTURE_RADIUS_NM = 1.0;

// --- ILS approach (SPEC §7) ---
/** Height of the 3° glidepath per NM from the threshold. */
export const GLIDEPATH_FT_PER_NM = 318;
/** Lateral tolerance for capturing the localizer. */
export const LOC_CAPTURE_LATERAL_NM = 0.5;
/** Largest intercept angle that still captures. */
export const LOC_CAPTURE_ANGLE_DEG = 30;
/** Band below the glidepath in which it is captured, so an aircraft far
 *  below stays level until the path comes down to it. */
export const GS_CAPTURE_BAND_FT = 200;
/** Correction applied per NM of lateral offset while tracking the localizer. */
export const LOC_CORRECTION_DEG_PER_NM = 12;
/** Largest correction angle away from the approach course. */
export const LOC_CORRECTION_MAX_DEG = 20;
/** Distance at which notEstablished and tooHigh are judged. */
export const APPROACH_GATE_NM = 6;
/** How far above the glidepath is too high at the gate. */
export const GATE_MAX_ABOVE_FT = 300;
/** From here the pilot is at final approach speed at the latest. */
export const FINAL_SPEED_NM = 5;
/** Missed approach levels off here before the controller takes over. */
export const MISSED_APPROACH_ALT_FT = 4000;
/** A handoff is only accepted established and inside this distance. */
export const HANDOFF_MAX_NM = 10;
/** The aircraft leaves the sector here, landed or handed over. */
export const TOUCHDOWN_NM = 1;
/** In-trail spacing on the final is judged from here inwards. */
export const SPACING_CHECK_NM = 4;

// --- Session and score (SPEC §11.5) ---
/** Default session length in sim seconds. */
export const SESSION_LENGTH_S = 30 * 60;
export const SCORE_HANDOFF = 100;
export const SCORE_SEPARATION_LOSS = -1000;
export const SCORE_MVA_VIOLATION = -300;
export const SCORE_GO_AROUND = -200;

// --- Display conventions (SPEC §9) ---
/** Below this vertical speed the data block shows no climb/descent arrow. */
export const VS_ARROW_THRESHOLD_FPM = 300;
