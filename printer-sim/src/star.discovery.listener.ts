import * as dgram from "dgram";
import { config } from "./env";
import { getInterfaceInfo, getLocalIPv4 } from "./network.util";
import { buildDiscoveryResponse, isDiscoveryQuery, isStructuredDiscoveryQuery } from "./star.protocol";

const DISCOVERY_PORT = 22222;

/** Answers Star Micronics' UDP broadcast discovery protocol so this machine shows up in
 * Square's native "Quick setup" printer scan exactly like a real Star network printer would —
 * see star.protocol.ts for where this protocol was reverse-engineered from. */
export function startStarDiscoveryResponder(): dgram.Socket {
  const ip = getLocalIPv4();
  const { netmask, mac } = getInterfaceInfo(ip);
  const model = config.STAR_MODEL_NAME;
  const response = buildDiscoveryResponse({ ip, mac, model, netmask });

  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

  socket.on("message", (data, rinfo) => {
    if (!isDiscoveryQuery(data)) return;
    const kind = isStructuredDiscoveryQuery(data) ? "structured" : "loose";
    console.log(
      `[star-discovery] ${kind} query from ${rinfo.address}:${rinfo.port} — responding as "${model}" @ ${ip}`
    );
    socket.send(response, rinfo.port, rinfo.address, (err) => {
      if (err) console.error("[star-discovery] failed to send response:", err);
    });
  });

  socket.on("error", (err) => console.error("[star-discovery] socket error:", err));

  socket.bind(DISCOVERY_PORT, () => {
    socket.setBroadcast(true);
    console.log(`[star-discovery] listening on UDP ${DISCOVERY_PORT}, advertising "${model}" at ${ip} (mac ${mac})`);
  });

  return socket;
}
