/**
 * Tiny shared in-memory state bridging tcp.listener.ts (sees print jobs on 9100) and
 * star.status.listener.ts (answers status polls on 9101). A real printer's ASB status
 * reports "ETB executed" for a period after processing a job, then reverts to idle — see
 * star.protocol.ts's ETB_BYTE comment and research/notes-asb-states.md. Square appears to hold
 * a print job as "queued/retrying" until it observes that confirmation, so this state must be
 * shared between the two listeners even though they're otherwise independent.
 *
 * Time-windowed rather than single-consume: a status poll can race a print job's connection
 * close event (they're independent TCP connections), so a strict "report it exactly once, to
 * whichever poll happens to land first" risks handing the confirmation to a poll Square
 * doesn't end up trusting, or missing it if a poll arrives a beat before our print handler
 * finishes. A few-second window is far more forgiving and still matches real hardware closely
 * enough (Square's own polling cadence observed elsewhere is roughly 1-2 polls/second).
 */
import { buildEtbExecutedAsbFrame, IDLE_ASB_FRAME_LAN } from "./star.protocol";

const ETB_EXECUTED_WINDOW_MS = 4000;

let etbCounter = 0;
let etbExecutedFrame: Buffer | null = null;
let etbExecutedUntil = 0;

export function recordPrintJobEtb(): void {
  etbCounter = (etbCounter + 1) % 32;
  etbExecutedFrame = buildEtbExecutedAsbFrame(etbCounter);
  etbExecutedUntil = Date.now() + ETB_EXECUTED_WINDOW_MS;
  console.log(
    `[star-state] print job seen (counter=${etbCounter}) — status polls report etb_executed for the next ${ETB_EXECUTED_WINDOW_MS}ms`
  );
}

/** Returns the frame to report on this status poll. Stays "etb_executed" for every poll within
 * the window after a print job, not just the first — see module doc for why. */
export function consumeCurrentAsbFrame(): Buffer {
  if (etbExecutedFrame && Date.now() < etbExecutedUntil) {
    return etbExecutedFrame;
  }
  return IDLE_ASB_FRAME_LAN;
}
