import * as os from "os";
import { config } from "./env";

function isLinkLocal(address: string): boolean {
  return address.startsWith("169.254.");
}

/** The real LAN-facing IPv4 address to advertise as this printer. Prefers a routable address
 * over a 169.254.x.x APIPA link-local one (a link-local address means the interface never got
 * a DHCP lease and isn't reachable from anything else on the real LAN — seen in practice on a
 * multi-adapter Windows machine where a VPN adapter's leftover link-local address was picked
 * over the real Ethernet IP). Set ADVERTISE_IP in .env to override outright. */
export function getLocalIPv4(): string {
  if (config.ADVERTISE_IP) return config.ADVERTISE_IP;

  const interfaces = os.networkInterfaces();
  const candidates: string[] = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === "IPv4" && !iface.internal) candidates.push(iface.address);
    }
  }

  const routable = candidates.find((addr) => !isLinkLocal(addr));
  if (routable) return routable;
  if (candidates.length > 0) {
    console.warn(
      `[network] only link-local (169.254.x.x) addresses found (${candidates.join(", ")}) — this ` +
        `is very likely the wrong interface. Set ADVERTISE_IP in .env to override.`
    );
    return candidates[0];
  }
  return "127.0.0.1";
}

export interface InterfaceInfo {
  netmask: string;
  mac: string;
}

/** Netmask + MAC of the network interface actually carrying `ip`, for building protocol
 * responses that need to look like a real device's interface config. Falls back to a plausible
 * /24 + locally-administered MAC if the interface can't be found (e.g. ADVERTISE_IP override
 * doesn't match any local interface). */
export function getInterfaceInfo(ip: string): InterfaceInfo {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === "IPv4" && iface.address === ip) {
        return { netmask: iface.netmask, mac: iface.mac };
      }
    }
  }
  return { netmask: "255.255.255.0", mac: "02:00:00:00:00:01" };
}
