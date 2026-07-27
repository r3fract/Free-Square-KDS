/** Verifies star.protocol.ts's byte-building logic in isolation — no network needed. */
import {
  buildDiscoveryResponse,
  buildEtbExecutedAsbFrame,
  buildStatusResponse,
  containsEtbMarker,
  isDiscoveryQuery,
  isStatusQuery,
  isStructuredDiscoveryQuery,
} from "./star.protocol";
import { consumeCurrentAsbFrame, recordPrintJobEtb } from "./star.state";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

// --- Discovery query validation ---
const structuredQuery = Buffer.concat([
  Buffer.from("STR_BCAST", "ascii"),
  Buffer.alloc(7),
  Buffer.from("RQ1.0.0\0", "ascii"),
  Buffer.from([0x00, 0x1c]),
  Buffer.from([0x64, 0x31]),
]);
assert(structuredQuery.length === 28, "synthetic structured query is 28 bytes");
assert(isStructuredDiscoveryQuery(structuredQuery), "recognizes well-formed structured query");
assert(isDiscoveryQuery(structuredQuery), "isDiscoveryQuery accepts structured query");

const looseQuery = Buffer.from("STR_BCAST", "ascii");
assert(!isStructuredDiscoveryQuery(looseQuery), "rejects loose query as structured");
assert(isDiscoveryQuery(looseQuery), "isDiscoveryQuery accepts loose fallback query");
assert(!isDiscoveryQuery(Buffer.from("not a printer query")), "rejects unrelated data");

// --- Discovery response construction ---
const response = buildDiscoveryResponse({
  ip: "10.0.0.170",
  mac: "AA:BB:CC:DD:EE:FF",
  model: "printer-sim",
  netmask: "255.255.255.0",
});
assert(response.length === 302, `discovery response is 302 bytes (got ${response.length})`);
assert(response.subarray(0, 9).toString("ascii") === "STR_BCAST", "response starts with STR_BCAST magic");
assert(response.subarray(0x24, 0x24 + 11).toString("ascii") === "printer-sim", "short model name patched at 0x24");
assert(response.subarray(0x4e, 0x54).toString("hex") === "aabbccddeeff", "MAC patched at 0x4E");
assert(response.subarray(0x58, 0x5c).join(".") === "10.0.0.170", "IP patched at 0x58");
assert(response.subarray(0x6c, 0x70).join(".") === "255.255.255.0", "netmask patched at 0x6C");
assert(response.subarray(0x70, 0x74).join(".") === "10.0.0.1", "gateway defaulted to .1 at 0x70");
const fullModelIdentifier = "printer-sim (STR_T-001)";
assert(
  response.subarray(0xcc, 0xcc + fullModelIdentifier.length).toString("ascii") === fullModelIdentifier,
  "full model identifier patched at 0xCC"
);
assert(response[0xcc + fullModelIdentifier.length] === 0x00, "full model identifier is null-padded after its length");

// --- Status protocol ---
const query51 = Buffer.concat([Buffer.from([0x32]), Buffer.alloc(50)]);
assert(query51.length === 51, "synthetic status query is 51 bytes");
assert(isStatusQuery(query51), "recognizes 0x32-prefixed status query");
assert(!isStatusQuery(Buffer.from([0x00])), "rejects non-0x32-prefixed data");

const statusResp = buildStatusResponse();
assert(statusResp.length === 22, `status response is 22 bytes (got ${statusResp.length})`);
assert(
  statusResp.subarray(0, 11).equals(statusResp.subarray(11, 22)),
  "status response is the idle ASB frame doubled"
);
assert(statusResp[0] === 0x23 && statusResp[1] === 0x86, "ASB frame header/version bytes correct (0x23, 0x86)");

// --- ETB marker detection + executed-frame encoding ---
const realCapturedTestPrint = Buffer.from(
  "1b2a724200000000000000001b1d030400001700000000000000000000000000000000000000000000000000000000",
  "hex"
);
assert(containsEtbMarker(realCapturedTestPrint), "detects ETB (0x17) byte in a real captured test-print job");
assert(!containsEtbMarker(Buffer.from([0x1b, 0x40, 0x0a])), "does not false-positive on ETB-free data");

const etbFrame = buildEtbExecutedAsbFrame(1);
assert(etbFrame.length === 11, "ETB-executed frame is 11 bytes");
assert(etbFrame[2] === 0x02, "ETB-executed frame sets byte2 bit1 (etb_executed)");
assert(etbFrame[7] === 0x02, "counter=1 encodes to byte7=0x02 per the documented bit layout");
const etbFrame7 = buildEtbExecutedAsbFrame(7);
assert(etbFrame7[7] === 0x0e, "counter=7 encodes to byte7=0x0E (verified pair from research notes)");
const etbFrame31 = buildEtbExecutedAsbFrame(31);
assert(etbFrame31[7] === 0x6e, "counter=31 encodes to byte7=0x6E (verified pair from research notes)");

// --- Shared state: reports etb_executed for a window of time, then reverts to idle ---
const idleBefore = consumeCurrentAsbFrame();
assert(idleBefore[2] === 0x00, "reports idle before any print job is recorded");
recordPrintJobEtb();
const afterEtb = consumeCurrentAsbFrame();
assert(afterEtb[2] === 0x02, "reports etb_executed on the poll immediately after a print job");
const stillWithinWindow = consumeCurrentAsbFrame();
assert(stillWithinWindow[2] === 0x02, "still reports etb_executed on a second poll within the window (not single-consume)");

console.log("\nALL PASS");
