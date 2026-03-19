# 🌐 ISP Load Balancer

A lightweight Node.js proxy that automatically load balances traffic across multiple network interfaces (e.g. WiFi + Ethernet) on Windows — with **auto-detection**, **50:50 round-robin**, **auto-failover**, and a **live dashboard**.

> No third-party dependencies. Pure Node.js built-ins only.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-green?logo=node.js)
![Platform](https://img.shields.io/badge/Platform-Windows-blue?logo=windows)
![License](https://img.shields.io/badge/License-MIT-yellow)

---

## ✨ Features

- **Auto-detect interfaces** — no need to hardcode IPs, scans all active network interfaces automatically
- **50:50 round-robin** — distributes requests evenly across all online interfaces
- **Auto-failover** — if one ISP goes down, all traffic automatically routes to the remaining ones
- **Health checks** — pings each interface every 8 seconds to detect connectivity changes
- **Live dashboard** — real-time monitoring of requests and data per interface
- **HTTPS support** — handles CONNECT tunneling for HTTPS traffic
- **Zero dependencies** — uses only Node.js built-in modules (`http`, `net`, `os`, `url`)

---

## 📋 Requirements

- [Node.js](https://nodejs.org) v18 or higher
- Windows 10/11
- Two or more active network interfaces (e.g. WiFi + Ethernet/USB tethering)

---

## 🚀 Quick Start

### 1. Clone the repo

```bash
git clone https://github.com/YOUR_USERNAME/isp-load-balancer.git
cd isp-load-balancer
```

### 2. Set equal metric on both interfaces (PowerShell as Admin)

This ensures Windows doesn't prefer one interface over the other:

```powershell
Set-NetIPInterface -InterfaceAlias "Wi-Fi" -InterfaceMetric 10
Set-NetIPInterface -InterfaceAlias "Ethernet 8" -InterfaceMetric 10
```

> Replace interface names with yours. Run `Get-NetIPInterface` to see all interface names.

### 3. Run the proxy

```bash
node proxy.js
```

You should see:
```
[Scan] Interface baru ditemukan: Wi-Fi (192.168.3.196)
[Scan] Interface baru ditemukan: Ethernet 8 (192.168.30.70)
[Health] 2/2 interface online: Wi-Fi(192.168.3.196), Ethernet 8(192.168.30.70)
✅ Proxy running at http://127.0.0.1:8080
📊 Dashboard at http://127.0.0.1:3000
```

### 4. Set Windows system proxy

Run in PowerShell (no admin required):

```powershell
$reg = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings"
Set-ItemProperty $reg ProxyEnable -Value 1
Set-ItemProperty $reg ProxyServer -Value "127.0.0.1:8080"
```

To disable the proxy later:

```powershell
$reg = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings"
Set-ItemProperty $reg ProxyEnable -Value 0
```

### 5. Open the dashboard

```
http://127.0.0.1:3000
```

---

## 📊 Dashboard

The live dashboard shows:

- All detected network interfaces with their IP
- Online/Offline status per interface (updated every 2s)
- Request count and data transferred per interface
- Visual distribution bar showing the load split
- Total requests and data across all interfaces

---

## ⚙️ Configuration

Edit the `CONFIG` object at the top of `proxy.js`:

```js
const CONFIG = {
  PROXY_PORT: 8080,        // Port for the proxy server
  DASHBOARD_PORT: 3000,    // Port for the dashboard UI
  CHECK_INTERVAL: 8000,    // Health check interval in ms
  CHECK_HOST: 'www.gstatic.com', // Host used for connectivity checks
};
```

---

## 🔧 How It Works

```
┌─────────────┐     HTTP/HTTPS      ┌──────────────────────┐
│   Browser   │ ──────────────────► │  Proxy (port 8080)   │
│  or App     │                     │                      │
└─────────────┘                     │  Round-robin picker  │
                                    │  ┌────────────────┐  │
                                    │  │ Interface pool │  │
                                    │  │  WiFi   ✅     │  │
                                    │  │  Eth    ✅     │  │
                                    │  └────────────────┘  │
                                    └──────┬───────────────┘
                                           │
                              ┌────────────┴────────────┐
                              ▼                         ▼
                         via WiFi IP              via Ethernet IP
                       (192.168.x.x)             (192.168.x.x)
                              │                         │
                              ▼                         ▼
                           ISP 1                     ISP 2
```

1. On startup, scans all non-loopback IPv4 interfaces via `os.networkInterfaces()`
2. Performs a health check on each by making an HTTP request bound to that interface's local IP
3. Only interfaces that successfully reach the internet are added to the pool
4. Incoming proxy requests are distributed round-robin across all healthy interfaces
5. Every 8 seconds, re-scans and re-checks — handles IP changes and new connections automatically

---

## ⚠️ Limitations

| Feature | Supported |
|---|---|
| Load balance HTTP/HTTPS from browser | ✅ |
| Auto-detect new interfaces at runtime | ✅ |
| Auto-failover when ISP goes down | ✅ |
| Aggregate bandwidth for a single connection | ❌ |
| Redirect traffic from apps that ignore system proxy | ❌ |

> **Note:** This is an application-layer proxy. It cannot aggregate bandwidth for a single TCP connection (e.g. one file download won't use both ISPs at once). The benefit is across multiple connections — each new request goes to the next ISP in the pool.

---

## 📁 Project Structure

```
isp-load-balancer/
├── proxy.js        # Main proxy + dashboard server
├── package.json    # Project metadata
└── README.md       # Documentation
```

---

## 🤝 Contributing

Pull requests are welcome! Some ideas:

- [ ] Weighted load balancing (e.g. 70:30 based on speed)
- [ ] Per-app routing rules
- [ ] Windows startup / auto-run as service
- [ ] JSON config file support
- [ ] Bandwidth speed test per interface

---

## 📄 License

MIT — free to use, modify, and distribute.
