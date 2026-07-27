/**
 * mDNS/Bonjour advertisement + passive query logging.
 *
 * Square explicitly supports AirPrint for wireless printers, and its printer-setup "scan for
 * devices" flow almost certainly relies on standard mDNS/Bonjour service discovery rather than
 * a proprietary broadcast — so an un-advertised plain TCP/HTTP listener (what tcp.listener.ts
 * / http.listener.ts provide on their own) won't show up in that scan at all.
 *
 * This module does two things:
 *  1. Logs EVERY mDNS query seen on the LAN, regardless of service type — this is the
 *     diagnostic payoff: if Square's scan asks for something other than the service types we
 *     guessed below (e.g. a Star-/Epson-proprietary service name), it'll show up here and we
 *     can add a responder for it.
 *  2. Responds to a best-effort guess at relevant service types — both the plain form
 *     (`_ipp._tcp.local`) and the AirPrint-style subtype form (`_universal._sub._ipp._tcp.local`,
 *     what Apple devices actually browse for "driverless" printers per RFC 6763 §7.1) — with a
 *     PTR/SRV/TXT/A record pointing at our ESC/POS TCP listener. `_pdl-datastream._tcp` is the
 *     actual standard Bonjour service type for raw "AppSocket"/JetDirect printing on port 9100
 *     (what CUPS/AirPrint bridges use); `_printer._tcp` and `_ipp._tcp`/`_ipps._tcp` are added
 *     as a hedge since they're the classic Bonjour "shared printer" types, though we don't
 *     implement IPP itself — if Square actually tries to speak IPP after discovering us via
 *     one of those names, it'll likely fail (no IPP responder exists), which is itself useful
 *     diagnostic information (watch for a stray connection attempt on port 631 or in the
 *     capture logs).
 *
 * Not covered: proprietary UDP broadcast discovery that isn't mDNS-shaped (e.g. Star
 * Micronics' own discovery protocol, if Square/the printer profile uses that instead). If
 * nothing here helps, the next step is a raw packet capture (Wireshark) during Square's scan
 * to see what it actually sends.
 */
import multicastDns from "multicast-dns";
import { config } from "./env";
import { getLocalIPv4 } from "./network.util";

const INSTANCE_NAME = "printer-sim";
const HOSTNAME = "printer-sim.local";

const BASE_SERVICE_TYPES = [
  "_pdl-datastream._tcp.local",
  "_printer._tcp.local",
  "_ipp._tcp.local",
  "_ipps._tcp.local",
];

/** Given a query name, returns the base service type to respond under, if this query is
 * either a plain match on one of BASE_SERVICE_TYPES, or an AirPrint-style
 * `<subtype>._sub.<baseType>` subtype query for one of them. */
function matchBaseType(queryName: string): { baseType: string; subtypeName: string | null } | null {
  if (BASE_SERVICE_TYPES.includes(queryName)) return { baseType: queryName, subtypeName: null };

  const subMatch = queryName.match(/^(.+)\._sub\.(_[^.]+\._(?:tcp|udp)\.local)$/);
  if (subMatch) {
    const baseType = subMatch[2];
    if (BASE_SERVICE_TYPES.includes(baseType)) return { baseType, subtypeName: queryName };
  }
  return null;
}

function timestamp(): string {
  return new Date().toISOString();
}

const KNOWN_PRINTER_IP = "10.0.0.131";

// Confirmed-irrelevant background chatter from unrelated LAN devices (HomeKit, AirPlay,
// Chromecast, sleep-proxy, reverse-DNS noise, etc.) — suppressed from the console so anything
// actually printer-related stands out. A record is only ever suppressed if it does NOT
// mention the known printer's IP, so nothing real gets hidden.
const NOISE_PATTERNS = [
  /_companion-link\._tcp/,
  /_rdlink\._tcp/,
  /_hap\._(tcp|udp)/,
  /_airplay\._tcp/,
  /_raop\._tcp/,
  /_sleep-proxy\._udp/,
  /_googlecast\._tcp/,
  /_d2d\._tcp/,
  /_device-info\._tcp/,
  /_network_permission_detector\._tcp/,
  /_spotify-connect\._tcp/,
  /^lb\._dns-sd\._udp\.local$/,
  /^_services\._dns-sd\._udp\.local$/,
  /\.in-addr\.arpa$/,
  /\.ip6\.arpa$/i,
  /^(Bedroom|Family room TV|localhost-2|homeassistant|Sonos-[0-9A-F]+)\.local$/i,
];

function recordData(record: { name: string; type: string }): unknown {
  return "data" in record ? (record as { data: unknown }).data : undefined;
}

function recordMentionsKnownPrinter(record: { name: string; type: string }): boolean {
  const dataStr = JSON.stringify(recordData(record)) ?? "";
  return record.name.includes(KNOWN_PRINTER_IP) || dataStr.includes(KNOWN_PRINTER_IP);
}

function isNoise(name: string): boolean {
  return NOISE_PATTERNS.some((pattern) => pattern.test(name));
}

export function startMdns(): void {
  const ip = getLocalIPv4();
  const mdns = multicastDns();

  // mDNS responses are normally sent to the multicast group (not just unicast to the asker),
  // so the real printer's own service announcement — its actual service type, instance name,
  // port, and TXT records — should be visible here even though we didn't ask the question
  // ourselves. This is the ground truth for what Square's discovery actually expects, instead
  // of guessing at service types.
  mdns.on("response", (response) => {
    try {
      const records = [...response.answers, ...(response.additionals ?? [])];
      for (const record of records) {
        const mentionsPrinter = recordMentionsKnownPrinter(record);
        if (record.type === "OPT" && !mentionsPrinter) continue;
        if (isNoise(record.name) && !mentionsPrinter) continue;
        const flag = mentionsPrinter ? " <<< KNOWN PRINTER (10.0.0.131) >>>" : "";
        console.log(
          `[mdns ${timestamp()}] response: ${record.type} ${record.name} -> ${JSON.stringify(recordData(record))}${flag}`
        );
      }
    } catch (err) {
      console.error("[mdns] error handling response (ignored, capture continues):", err);
    }
  });

  mdns.on("query", (query) => {
    try {
      for (const question of query.questions) {
        if (isNoise(question.name)) continue;
        console.log(`[mdns ${timestamp()}] query seen on LAN: ${question.type} ${question.name}`);
      }

      for (const question of query.questions) {
        const match = matchBaseType(question.name);
        if (!match) continue;

        const serviceInstance = `${INSTANCE_NAME}.${match.baseType}`;
        const answers = [
          // Plain browse: <baseType> PTR <instance>.<baseType>
          { name: match.baseType, type: "PTR" as const, data: serviceInstance },
          {
            name: serviceInstance,
            type: "SRV" as const,
            data: { port: config.PRINTER_TCP_PORT, target: HOSTNAME, weight: 0, priority: 0 },
          },
          {
            name: serviceInstance,
            type: "TXT" as const,
            data: ["txtvers=1", "rp=", `ty=${INSTANCE_NAME}`, "pdl=application/octet-stream"],
          },
          { name: HOSTNAME, type: "A" as const, data: ip },
        ];

        if (match.subtypeName) {
          // RFC 6763 §7.1: subtype browse needs its own PTR, owned by the subtype name,
          // pointing at the SAME service instance name used in the plain browse above.
          answers.unshift({ name: match.subtypeName, type: "PTR" as const, data: serviceInstance });
        }

        mdns.respond({ answers });
        console.log(
          `[mdns ${timestamp()}] responded to ${question.name} as ${serviceInstance} -> ${ip}:${config.PRINTER_TCP_PORT}`
        );
      }
    } catch (err) {
      console.error("[mdns] error handling query (ignored, capture continues):", err);
    }
  });

  console.log(
    `[mdns] advertising "${INSTANCE_NAME}" at ${ip}:${config.PRINTER_TCP_PORT} for ${BASE_SERVICE_TYPES.join(
      ", "
    )} (plain + AirPrint-style _sub. subtypes); logging all other LAN mDNS queries seen`
  );
}
