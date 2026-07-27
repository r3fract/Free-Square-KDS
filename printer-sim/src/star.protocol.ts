/**
 * Star Micronics discovery (UDP:22222) + ASB status (TCP:9101) protocol implementation.
 *
 * Ported from real, verified byte-level reverse engineering published at
 * github.com/gnaunited/tsp143-bridge (`star_discovery.py`, `stario_proto.py`,
 * `research/notes-asb-states.md`, `research/notes-9101-lifecycle.md`) — captured byte-for-byte
 * against a real Star TSP143IIILAN (chassis-stamped TSP100IIILAN, firmware V2.2). Square's own
 * recommended network printer hardware is this same Star product family, and a real printer on
 * this LAN was confirmed to be found instantly by Square's own "Quick setup" auto-discovery —
 * strong evidence Square's discovery is this same StarIO broadcast protocol, not mDNS.
 *
 * The 302-byte discovery response template below is used verbatim except for the
 * device-specific fields documented at each patch site, exactly mirroring that project's
 * approach: the goal is for Square's native discovery/pairing flow to see a response
 * indistinguishable from the real hardware.
 */

const DISCOVERY_MAGIC = Buffer.from("STR_BCAST", "ascii"); // 9 bytes
const REQUEST_VERSION_PREFIX = Buffer.from("RQ1.", "ascii");
const REQUEST_VERSION_OFFSET = 0x10;

/** The well-formed 28-byte query real Star printers require:
 *   0x00..0x0F  "STR_BCAST" + 7 NUL     (magic + 16-byte cell)
 *   0x10..0x17  "RQ1.0.0\0"             (request version)
 *   0x18..0x19  0x00 0x1C               (length = 28, big-endian)
 *   0x1A..0x1B  request id              (arbitrary, not echoed)
 */
export function isStructuredDiscoveryQuery(data: Buffer): boolean {
  if (data.length < 28) return false;
  if (!data.subarray(0, 9).equals(DISCOVERY_MAGIC)) return false;
  if (!data.subarray(9, 0x10).equals(Buffer.alloc(7))) return false;
  if (!data.subarray(REQUEST_VERSION_OFFSET, REQUEST_VERSION_OFFSET + 4).equals(REQUEST_VERSION_PREFIX)) {
    return false;
  }
  if (!data.subarray(0x18, 0x1a).equals(Buffer.from([0x00, 0x1c]))) return false;
  return true;
}

/** Accept the well-formed 28-byte form, or (as a loose fallback for our own test tooling)
 * anything simply containing the STR_BCAST magic. */
export function isDiscoveryQuery(data: Buffer): boolean {
  return isStructuredDiscoveryQuery(data) || data.includes(DISCOVERY_MAGIC);
}

// Template captured byte-for-byte from a real Star TSP100IIILAN (firmware V2.2) — see
// star_discovery.py's build_response() in the source repo cited above.
const RESPONSE_TEMPLATE_HEX =
  "5354525f424341535400000000000000" + // 0x00: "STR_BCAST" header
  "5253312e302e3100012e00220074008a" + // 0x10: "RS1.0.1" version + offset table
  "012c00525453503130304c414e000000" + // 0x20: offset table + short model name
  "0000000056322e320000000056322e32" + // 0x30: firmware versions "V2.2"
  "00000000200000000000000031000011" + // 0x40: flags + MAC start
  "6213deef00000000c0a8008444484350" + // 0x50: MAC + IP + "DHCP"
  "000000000000000000000000ffffff00" + // 0x60: padding + subnet mask
  "c0a80001001631000000000000000000" + // 0x70: gateway + port/flags
  "0000000030003100310000a253746172" + // 0x80: flags + "Star" manufacturer
  "00000000000000000000000000000000" + // 0x90: manufacturer padding
  "00000000000000000000000053544152" + // 0xA0: padding + "STAR" command set
  "00000000000000000000000000000000" + // 0xB0: command set padding
  "00000000000000000000000054535031" + // 0xC0: padding + full model name
  "34334949494c414e20285354525f542d" + // 0xD0: "43IIILAN (STR_T-"
  "30303129000000000000000000000000" + // 0xE0: "001)" + padding
  "00000000000000000000000000000000" + // 0xF0: model name padding
  "0000000000000000000000005052494e" + // 0x100: padding + "PRIN"
  "54455200000000000000000000000000" + // 0x110: "TER" + padding
  "0000000000000000000000000002"; // 0x120: class padding + trailer

export interface DiscoveryResponseParams {
  ip: string;
  mac: string; // "AA:BB:CC:DD:EE:FF"
  model: string; // short model name to advertise, e.g. "TSP143III"
  netmask?: string;
  gateway?: string;
}

function ipToBytes(ip: string): Buffer {
  return Buffer.from(ip.split(".").map((s) => Number(s) & 0xff));
}

export function buildDiscoveryResponse(params: DiscoveryResponseParams): Buffer {
  const resp = Buffer.from(RESPONSE_TEMPLATE_HEX, "hex");

  // 0x24: short model name (16 bytes, null-padded)
  resp.fill(0, 0x24, 0x34);
  resp.write(params.model.slice(0, 16), 0x24, "ascii");

  // 0x4E: MAC address (6 bytes)
  Buffer.from(params.mac.replace(/:/g, ""), "hex").copy(resp, 0x4e);

  // 0x58: IP address (4 bytes)
  ipToBytes(params.ip).copy(resp, 0x58);

  // 0x6C: subnet mask (4 bytes)
  ipToBytes(params.netmask ?? "255.255.255.0").copy(resp, 0x6c);

  // 0x70: default gateway (4 bytes) — falls back to "IP with last octet 1", the same
  // convention the source project's fallback uses when a real gateway can't be detected.
  const gateway = params.gateway ?? params.ip.replace(/\.\d+$/, ".1");
  ipToBytes(gateway).copy(resp, 0x70);

  // 0xCC: full model identifier (64 bytes, null-padded) -> "<model> (STR_T-001)"
  resp.fill(0, 0xcc, 0xcc + 64);
  resp.write(`${params.model} (STR_T-001)`.slice(0, 64), 0xcc, "ascii");

  return resp;
}

// ASB (Automatic Status Back) frame — LAN wire form, 11 bytes. Represents an always-clean/idle
// "everything is fine" printer state (cover closed, paper loaded, no errors), byte-identical to
// a real TSP143IIILAN's idle frame per research/notes-asb-states.md:
//   byte 0: 0x23 frame-size header: bits 1-3/5-6 encode the (USB) frame size
//   byte 1: 0x86 version, bit 7 set = LAN wire form (USB form would be 0x06)
//   bytes 2-6: status/sensor bytes, all 0x00 = no errors, no cover-open, paper loaded
//   byte 7: ETB counter (0 here — we don't track ETBs since we always report the same frame)
//   bytes 8-10: reserved / LAN zero-pad
export const IDLE_ASB_FRAME_LAN = Buffer.from([0x23, 0x86, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

// TCP:9101 status queries are a single 0x32 byte followed by 50 zero-padding bytes (51 total) —
// see research/notes-9101-lifecycle.md. The trailing bytes aren't inspected by real printers.
export function isStatusQuery(data: Buffer): boolean {
  return data.length > 0 && data[0] === 0x32;
}

// The real printer answers with the current ASB frame doubled (current state + immediately-
// prior state, one-step history). We don't track two distinct states, so both halves are
// always identical — the source project's own bridge does the same and reports Shopify
// doesn't appear to depend on the two frames differing.
export function buildStatusResponse(frame: Buffer = IDLE_ASB_FRAME_LAN): Buffer {
  return Buffer.concat([frame, frame]);
}

// A literal ASCII ETB (0x17) byte observed at the tail of every real print job captured from
// Square against this listener (e.g. `1b 2a 72 42 00 00 00 00 00 00 1b 1d 03 04 00 00 17`,
// followed only by padding) — Square appears to hold a job as "queued/retrying" until a
// subsequent status poll confirms the ETB was executed (see buildEtbExecutedAsbFrame below),
// which is exactly the ETB-executed/counter mechanism research/notes-asb-states.md documents.
const ETB_BYTE = 0x17;

export function containsEtbMarker(buffer: Buffer): boolean {
  return buffer.includes(ETB_BYTE);
}

// ASB frame reporting "ETB just executed": byte 2 bit 1 (0x02) set, plus the 5-bit ETB
// counter scattered across byte 7 per the documented non-contiguous bit layout:
//   byte7 = ((counter & 0x07) << 1) | ((counter & 0x18) << 2)
export function buildEtbExecutedAsbFrame(counter: number): Buffer {
  const frame = Buffer.from(IDLE_ASB_FRAME_LAN);
  frame[2] = 0x02;
  const c = counter & 0x1f;
  frame[7] = ((c & 0x07) << 1) | ((c & 0x18) << 2);
  return frame;
}
