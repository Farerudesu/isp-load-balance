# ISP Load Balancer

A zero-dependency Node.js proxy that distributes outbound traffic across multiple network interfaces (e.g. Wi-Fi + Ethernet + USB tethering) using weighted round-robin load balancing, with automatic interface discovery, health monitoring, and a real-time dashboard.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)
![Platform](https://img.shields.io/badge/Platform-Windows-0078D4?logo=windows&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-f0c040)
![Dependencies](https://img.shields.io/badge/Dependencies-None-brightgreen)

---

## Features

- **Automatic interface discovery** — detects all active IPv4 interfaces on startup and at runtime, no manual IP configuration required
- **Weighted round-robin** — distributes connections proportionally across all healthy interfaces; equal weight by default (50/50, 33/33/33, etc.)
- **Configurable traffic ratios** — adjust per-interface weights via the dashboard (50/50, 60/40, 70/30, 80/20, 90/10)
- **Automatic failover** — unhealthy interfaces are removed from the pool; traffic resumes automatically upon recovery
- **Full byte tracking** — accurately measures throughput for both HTTP and HTTPS (CONNECT tunnel) traffic in both directions
- **Real-time dashboard** — per-interface bandwidth graphs, speed in KB/s or Mbps, request counts, and data totals
- **Hotspot-compatible** — binds to `0.0.0.0`, allowing connected mobile devices to route traffic through the proxy
- **Zero dependencies** — built entirely on Node.js built-in modules (`http`, `net`, `os`, `url`)

---

## Requirements

- [Node.js](https://nodejs.org) v18 or higher
- Windows 10 or Windows 11
- Two or more active network interfaces connected to different ISPs

---

## Installation

```bash
git clone https://github.com/YOUR_USERNAME/isp-load-balancer.git
cd isp-load-balancer
```

No `npm install` required.

---

## Quick Start

### 1. Equalize interface metrics (PowerShell — Administrator)

Prevents Windows from routing all traffic through a single preferred interface:

```powershell
Set-NetIPInterface -InterfaceAlias "Wi-Fi" -InterfaceMetric 10
Set-NetIPInterface -InterfaceAlias "Ethernet 8" -InterfaceMetric 10
```

To list all interface names on your system:

```powershell
Get-NetIPInterface -AddressFamily IPv4 | Select InterfaceAlias, InterfaceMetric
```

### 2. Start the proxy

```bash
node proxy.js
```

Expected output:

```
[Scan] New interface detected: Wi-Fi (192.168.3.196)
[Scan] New interface detected: Ethernet 8 (192.168.30.70)
[Health] 2/2 active: Wi-Fi(192.168.3.196), Ethernet 8(192.168.30.70)
Proxy:     http://127.0.0.1:8080
Dashboard: http://127.0.0.1:3000
```

### 3. Configure the system proxy (PowerShell)

```powershell
$reg = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings"
Set-ItemProperty $reg ProxyEnable -Value 1
Set-ItemProperty $reg ProxyServer -Value "127.0.0.1:8080"
```

To disable:

```powershell
Set-ItemProperty $reg ProxyEnable -Value 0
```

### 4. Open the dashboard

```
http://127.0.0.1:3000
```

---

## Dashboard

The dashboard provides a live view of all detected interfaces and updates every second.

| Element | Description |
|---|---|
| Interface card | Name, IP address, online/offline status |
| Bandwidth graph | Rolling 60-second KB/s history per interface |
| Speed display | Current throughput in KB/s, MB/s, or Mbps (toggle) |
| Traffic ratio | Preset buttons to adjust load distribution |
| Total card | Aggregate requests, combined speed, and total data transferred |

---

## Mobile Hotspot Support

The proxy listens on `0.0.0.0`, making it accessible to any device connected to a Windows Mobile Hotspot.

**1. Enable Windows Mobile Hotspot**

Settings → Network & Internet → Mobile Hotspot → On

**2. Allow inbound connections on port 8080 (PowerShell — Administrator)**

```powershell
New-NetFirewallRule -DisplayName "ISP Load Balancer" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow
```

**3. Find the hotspot gateway IP**

```powershell
ipconfig
```

Look for the `Local Area Connection*` adapter — the IPv4 address is typically `192.168.137.1`.

**4. Configure proxy on the mobile device**

In the device's Wi-Fi settings, set a manual proxy:

- **Host:** `192.168.137.1`
- **Port:** `8080`

All traffic from the mobile device will now be load balanced across the PC's network interfaces.

---

## Configuration

All options are defined in the `CONFIG` object at the top of `proxy.js`:

```js
const CONFIG = {
  PROXY_PORT: 8080,
  DASHBOARD_PORT: 3000,
  CHECK_INTERVAL: 8000,
  CHECK_HOST: 'www.gstatic.com',
  EXCLUDE_PREFIXES: ['192.168.137.', '172.', '10.0.0.'],
};
```

| Option | Default | Description |
|---|---|---|
| `PROXY_PORT` | `8080` | Port the proxy server listens on |
| `DASHBOARD_PORT` | `3000` | Port the dashboard UI listens on |
| `CHECK_INTERVAL` | `8000` | Interval in ms between health checks and interface rescans |
| `CHECK_HOST` | `www.gstatic.com` | Host used to verify internet connectivity per interface |
| `EXCLUDE_PREFIXES` | `['192.168.137.', ...]` | IP prefixes excluded from load balancing (hotspot, VPN, virtual adapters) |

---

## Architecture

```
┌──────────────────┐        ┌────────────────────────────┐
│  Browser / App   │──────▶ │   Proxy  (0.0.0.0:8080)   │
│  Mobile Device   │        │                            │
└──────────────────┘        │   Weighted round-robin     │
                            │   ┌────────────────────┐   │
                            │   │  Interface pool    │   │
                            │   │  Wi-Fi      ✓  w=1 │   │
                            │   │  Ethernet   ✓  w=1 │   │
                            │   └────────────────────┘   │
                            └────────────┬───────────────┘
                                         │
                            ┌────────────┴────────────┐
                            ▼                         ▼
                       via Wi-Fi IP            via Ethernet IP
                            │                         │
                            ▼                         ▼
                          ISP 1                     ISP 2
```

**How it works:**

1. On startup, `os.networkInterfaces()` enumerates all non-loopback IPv4 interfaces, excluding configured prefixes
2. Each interface undergoes a connectivity check by binding an HTTP request to its local IP
3. Only interfaces that successfully reach the health-check host are added to the active pool
4. Incoming proxy requests are routed round-robin across the pool, weighted proportionally
5. Every `CHECK_INTERVAL` ms, the interface list is rescanned and all health checks are re-evaluated
6. HTTPS traffic is handled via the HTTP CONNECT method; byte counters track data in both directions

---

## Limitations

| Capability | Supported |
|---|---|
| Load balance HTTP and HTTPS traffic | ✅ |
| Automatic interface discovery at runtime | ✅ |
| Automatic failover and recovery | ✅ |
| Configurable traffic ratio per interface | ✅ |
| Mobile device support via hotspot | ✅ |
| Bandwidth aggregation for a single TCP connection | ❌ |
| Redirecting traffic from apps that bypass the system proxy | ❌ |

> Single-connection bandwidth cannot be aggregated at the application layer. Each new connection is assigned to the next interface in the pool. The throughput benefit is realized across multiple concurrent connections.

---

## Project Structure

```
isp-load-balancer/
├── proxy.js        # Proxy server, health monitor, and dashboard
├── package.json    # Project metadata
└── README.md       # Documentation
```

---

## Contributing

Contributions are welcome. Some areas for improvement:

- [ ] JSON-based configuration file
- [ ] Per-application routing rules
- [ ] Windows startup service integration
- [ ] Automated interface speed detection for dynamic weighting
- [ ] Export traffic statistics to CSV

---

## License

MIT — free to use, modify, and distribute.
