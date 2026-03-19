# ISP Load Balancer

A zero-dependency Node.js proxy that distributes outbound traffic across multiple network interfaces (e.g. Wi-Fi + Ethernet + USB tethering) using round-robin load balancing, with automatic interface discovery, health monitoring, and a real-time dashboard.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)
![Platform](https://img.shields.io/badge/Platform-Windows-0078D4?logo=windows&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-f0c040)
![Dependencies](https://img.shields.io/badge/Dependencies-None-brightgreen)

---

## Features

- **Automatic interface discovery**  detects all active IPv4 interfaces on startup and at runtime; no manual IP configuration required
- **Round-robin load balancing** distributes connections evenly across all healthy interfaces (50/50, 33/33/33, etc. — scales automatically with interface count)
- **Automatic failover** unhealthy interfaces are excluded from the pool; traffic resumes through them automatically upon recovery
- **Full byte tracking** accurately measures throughput for both HTTP and HTTPS (CONNECT tunnel) traffic in both upload and download directions
- **Real-time dashboard** per-interface bandwidth graphs, speed readout in KB/s, MB/s, or Mbps, request counts, and cumulative data totals
- **Hotspot-compatible** binds to `0.0.0.0`, allowing mobile devices connected via Windows Mobile Hotspot to route traffic through the proxy
- **Zero dependencies** built entirely on Node.js built-in modules (`http`, `net`, `os`, `url`)

---

## Requirements

- [Node.js](https://nodejs.org) v18 or higher
- Windows 10 or Windows 11
- Two or more active network interfaces connected to different ISPs

---

## Installation

```bash
git clone https://github.com/Farerudesu/isp-load-balance.git
cd isp-load-balance
```

No `npm install` required.

---

## Quick Start

### 1. Equalize interface metrics - PowerShell (Administrator)

Prevents Windows from routing all traffic through a single preferred interface:

```powershell
Set-NetIPInterface -InterfaceAlias "Wi-Fi" -InterfaceMetric 10
Set-NetIPInterface -InterfaceAlias "Ethernet 8" -InterfaceMetric 10
```

To list all interface names on your system:

```powershell
Get-NetIPInterface -AddressFamily IPv4 | Select InterfaceAlias, InterfaceMetric
```
Alternatively use Properties panel on Network Settings in Control Panel

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

### 3. Configure the system proxy — PowerShell

```powershell
$reg = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings"
Set-ItemProperty $reg ProxyEnable -Value 1
Set-ItemProperty $reg ProxyServer -Value "127.0.0.1:8080"
```

To disable:

```powershell
Set-ItemProperty $reg ProxyEnable -Value 0
```

Alternatively change Proxy within the system settings on Windows 

### 4. Open the dashboard

```
http://127.0.0.1:3000
```

---

## Dashboard

<img width="1918" height="826" alt="image" src="https://github.com/user-attachments/assets/5b7c72cb-3da7-4d0a-b9f4-2a61a4eaa81e" />


---

## Mobile Hotspot Support

The proxy binds to `0.0.0.0`, making it reachable from any device on the same local network, including devices connected via Windows Mobile Hotspot.

**1. Enable Windows Mobile Hotspot**

Settings → Network & Internet → Mobile Hotspot → On

**2. Allow inbound connections on port 8080 — PowerShell (Administrator)**

```powershell
New-NetFirewallRule -DisplayName "ISP Load Balancer" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow
```

**3. Find the hotspot gateway IP**

```powershell
ipconfig
```

Look for the `Local Area Connection*` adapter - the IPv4 address is typically `192.168.137.1`.

**4. Configure the proxy on the mobile device**

In the device's Wi-Fi advanced settings, set a manual proxy:

- **Host:** `192.168.137.1`
- **Port:** `8080`

All traffic from the mobile device will be load balanced across the PC's network interfaces.

---

## Configuration

All options are in the `CONFIG` object at the top of `proxy.js`:

```js
const CONFIG = {
  PROXY_PORT: 8080,
  DASHBOARD_PORT: 3000,
  CHECK_INTERVAL: 8000,
  CHECK_HOST: 'www.gstatic.com',
};
```

| Option | Default | Description |
|---|---|---|
| `PROXY_PORT` | `8080` | Port the proxy server listens on |
| `DASHBOARD_PORT` | `3000` | Port the dashboard UI listens on |
| `CHECK_INTERVAL` | `8000` | Interval in ms between health checks and interface rescans |
| `CHECK_HOST` | `www.gstatic.com` | Host used to verify internet reachability per interface |

---

## Architecture

```
┌──────────────────┐        ┌───────────────────────────┐
│  Browser / App   │──────▶ │   Proxy  (0.0.0.0:8080)  │
│  Mobile Device   │        │                           │
└──────────────────┘        │     Round-robin pool      │
                            │  ┌─────────────────────┐  │
                            │  │  Wi-Fi       ✓      │  │
                            │  │  Ethernet    ✓      │  │
                            │  │  USB Tether  ✓      │  │
                            │  └─────────────────────┘  │
                            └───────────┬───────────────┘
                                        │
                           ┌────────────┴────────────┐
                           ▼                         ▼
                      via Wi-Fi IP           via Ethernet IP
                           │                         │
                           ▼                         ▼
                         ISP 1                     ISP 2
```

**Request lifecycle:**

1. `os.networkInterfaces()` enumerates all non-loopback IPv4 interfaces on startup
2. Each interface is health-checked by binding an HTTP request to its local IP address
3. Interfaces that successfully reach `CHECK_HOST` are added to the active pool
4. Incoming proxy requests are assigned round-robin to the next available interface
5. Every `CHECK_INTERVAL` ms, the interface list is rescanned and all health checks repeat
6. HTTPS traffic uses the HTTP CONNECT method; byte counters track data in both directions per connection

---

## Limitations

| Capability | Supported |
|---|---|
| Load balance HTTP and HTTPS traffic | ✅ |
| Automatic interface discovery at runtime | ✅ |
| Automatic failover and recovery | ✅ |
| Support for 3+ interfaces with auto-adjusted ratio | ✅ |
| Mobile device support via hotspot | ✅ |
| Bandwidth aggregation for a single TCP connection | ❌ |
| Intercepting traffic from apps that bypass system proxy | ❌ |

> Single-connection bandwidth cannot be aggregated at the application layer. Each new connection is assigned to the next interface in the pool. The throughput benefit is realized across multiple concurrent connections — for example, a browser opening many parallel requests, or a download manager with multiple threads.

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

- [ ] JSON-based external configuration file
- [ ] Per-application routing rules
- [ ] Windows startup service integration
- [ ] Automated speed detection for dynamic interface weighting
- [ ] Traffic statistics export to CSV

---

## License

MIT — free to use, modify, and distribute.
