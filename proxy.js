const http = require('http');
const https = require('https');
const net = require('net');
const url = require('url');
const os = require('os');

const CONFIG = {
  PROXY_PORT: 8080,
  DASHBOARD_PORT: 3000,
  CHECK_INTERVAL: 8000,
  CHECK_HOST: 'www.gstatic.com',
};

process.on('uncaughtException', (err) => console.error('[Error]', err.message));
process.on('unhandledRejection', (err) => console.error('[Rejection]', err));

function scanInterfaces() {
  const ifaces = os.networkInterfaces();
  const found = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        found.push({ name, ip: addr.address });
      }
    }
  }
  return found;
}

let interfaces = [];
let counter = 0;

const HISTORY_LEN = 60;
setInterval(() => {
  for (const iface of interfaces) {
    const prev = iface._lastBytes || 0;
    const delta = iface.bytes - prev;
    iface._lastBytes = iface.bytes;
    iface.history.push(Math.round(delta / 1024 * 10) / 10);
    if (iface.history.length > HISTORY_LEN) iface.history.shift();
  }
}, 1000);

function getAliveInterfaces() {
  return interfaces.filter(i => i.alive);
}

function getNextInterface() {
  const alive = getAliveInterfaces();
  if (alive.length === 0) return null;
  const pick = alive[counter % alive.length];
  counter++;
  return pick;
}

function checkHealth(iface) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: CONFIG.CHECK_HOST, path: '/', localAddress: iface.ip, timeout: 4000 },
      (res) => {
        iface.alive = res.statusCode < 500;
        iface.lastCheck = new Date().toISOString();
        res.resume();
        resolve();
      }
    );
    req.on('error', () => {
      iface.alive = false;
      iface.lastCheck = new Date().toISOString();
      resolve();
    });
    req.on('timeout', () => { req.destroy(); });
  });
}

async function rescanAndCheck() {
  const found = scanInterfaces();
  for (const f of found) {
    const exists = interfaces.find(i => i.ip === f.ip);
    if (!exists) {
      interfaces.push({ name: f.name, ip: f.ip, alive: false, requests: 0, bytes: 0, lastCheck: null, history: [], _lastBytes: 0 });
      console.log(`[Scan] New interface detected: ${f.name} (${f.ip})`);
    }
  }
  interfaces = interfaces.filter(i => found.find(f => f.ip === i.ip));
  await Promise.all(interfaces.map(checkHealth));
  const alive = getAliveInterfaces();
  console.log(`[Health] ${alive.length}/${interfaces.length} active: ${alive.map(i => `${i.name}(${i.ip})`).join(', ') || 'none'}`);
}

rescanAndCheck();
setInterval(rescanAndCheck, CONFIG.CHECK_INTERVAL);

const proxy = http.createServer((req, res) => {
  const iface = getNextInterface();
  if (!iface) { res.writeHead(503); res.end('All ISP connections are down.'); return; }

  const parsed = url.parse(req.url);
  const options = {
    host: parsed.hostname,
    port: parsed.port || 80,
    path: parsed.path,
    method: req.method,
    headers: req.headers,
    localAddress: iface.ip,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    iface.requests++;
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.on('data', (chunk) => {
      iface.bytes += chunk.length;
      res.write(chunk);
    });
    proxyRes.on('end', () => res.end());
  });

  proxyReq.on('error', (err) => {
    console.error(`[HTTP] Error via ${iface.name}:`, err.message);
    if (!res.headersSent) { res.writeHead(502); res.end('Proxy error: ' + err.message); }
  });

  req.on('data', (chunk) => { iface.bytes += chunk.length; });
  req.pipe(proxyReq);
});

proxy.on('connect', (req, clientSocket, head) => {
  const iface = getNextInterface();
  if (!iface) { clientSocket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n'); return; }

  const [hostname, port] = req.url.split(':');

  const serverSocket = net.connect({ host: hostname, port: parseInt(port) || 443, localAddress: iface.ip }, () => {
    iface.requests++;
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head && head.length) {
      iface.bytes += head.length;
      serverSocket.write(head);
    }

    serverSocket.on('data', (chunk) => { iface.bytes += chunk.length; });
    clientSocket.on('data', (chunk) => { iface.bytes += chunk.length; });

    serverSocket.pipe(clientSocket, { end: false });
    clientSocket.pipe(serverSocket, { end: false });
  });

  serverSocket.on('error', (err) => {
    console.error(`[HTTPS] Error via ${iface.name}:`, err.message);
    clientSocket.destroy();
  });

  clientSocket.on('error', () => serverSocket.destroy());
  clientSocket.on('close', () => serverSocket.destroy());
  serverSocket.on('close', () => clientSocket.destroy());
});

proxy.listen(CONFIG.PROXY_PORT, '127.0.0.1', () => {
  console.log(`Proxy: http://127.0.0.1:${CONFIG.PROXY_PORT}`);
  console.log(`Dashboard: http://127.0.0.1:${CONFIG.DASHBOARD_PORT}`);
});

const dashboard = http.createServer((req, res) => {
  if (req.url === '/api/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    const totalReq   = interfaces.reduce((s, i) => s + i.requests, 0);
    const totalBytes = interfaces.reduce((s, i) => s + i.bytes, 0);

    const clean = interfaces.map(({ _lastBytes, ...rest }) => rest);
    res.end(JSON.stringify({ interfaces: clean, total: { requests: totalReq, bytes: totalBytes } }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(getDashboardHTML());
});

dashboard.listen(CONFIG.DASHBOARD_PORT, '127.0.0.1');

function getDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ISP Load Balancer</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Space+Grotesk:wght@300;500;700&display=swap');
:root{--bg:#07070f;--panel:#0f0f1a;--border:#1a1a2e;--dead:#ff3355;--text:#e0e0f0;--muted:#555570;}
*{margin:0;padding:0;box-sizing:border-box;}
body{background:var(--bg);color:var(--text);font-family:'Space Grotesk',sans-serif;min-height:100vh;padding:28px 32px;}
header{display:flex;align-items:baseline;gap:12px;margin-bottom:6px;}
h1{font-size:1rem;font-weight:300;letter-spacing:.2em;text-transform:uppercase;color:var(--muted);}
h1 span{color:#00ff88;font-weight:700;}
.subtitle{font-size:.72rem;color:var(--muted);margin-bottom:28px;}
.subtitle b{color:#888;}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;margin-bottom:14px;}
.card{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:22px;position:relative;overflow:hidden;transition:border-color .3s;}
.card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:var(--ac);}
.card.dead{border-color:#ff335522;}
.card.dead::before{background:var(--dead);}
.clabel{font-size:.65rem;letter-spacing:.15em;text-transform:uppercase;color:var(--muted);margin-bottom:5px;}
.cname{font-size:.92rem;font-weight:700;margin-bottom:3px;}
.cip{font-family:'JetBrains Mono',monospace;font-size:.72rem;color:var(--muted);margin-bottom:12px;}
.badge-status{display:inline-flex;align-items:center;gap:5px;font-size:.72rem;padding:3px 10px;border-radius:20px;margin-bottom:16px;}
.badge-status.alive{background:rgba(0,255,136,.08);color:#00ff88;}
.badge-status.dead{background:rgba(255,51,85,.1);color:var(--dead);}
.badge-status::before{content:'';width:5px;height:5px;border-radius:50%;background:currentColor;animation:pulse 1.5s infinite;}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.2}}
.stats-row{display:flex;gap:20px;margin-bottom:14px;}
.stat{flex:1;}
.slabel{font-size:.65rem;color:var(--muted);margin-bottom:3px;}
.sval{font-family:'JetBrains Mono',monospace;font-size:1.1rem;font-weight:700;color:var(--ac);}
.speed{font-family:'JetBrains Mono',monospace;font-size:.78rem;color:var(--muted);margin-bottom:10px;}
.speed b{color:var(--ac);}
canvas{width:100%!important;height:60px!important;display:block;}
.pbar-wrap{background:var(--border);border-radius:3px;height:4px;margin-top:12px;overflow:hidden;}
.pbar{height:100%;border-radius:3px;background:var(--ac);transition:width .5s ease;}
.total-card{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;}
.total-card .sval{font-size:1.6rem;color:var(--text);}
.proxy-badge{background:var(--border);border-radius:6px;padding:5px 12px;font-family:'JetBrains Mono',monospace;font-size:.72rem;color:var(--muted);}
.proxy-badge span{color:#00ff88;}
footer{margin-top:20px;font-size:.65rem;color:var(--muted);text-align:center;}
</style>
</head>
<body>
<header><h1>ISP Load Balancer <span>Live</span></h1></header>
<p class="subtitle">Interface: <b id="icount">scanning...</b> &nbsp;·&nbsp; Refreshes every second &nbsp;·&nbsp; <button id="unit-toggle" onclick="useMbps=!useMbps;this.textContent=useMbps?'Switch to KB/s':'Switch to Mbps'" style="background:#1a1a2e;border:1px solid #2a2a4e;color:#888;padding:2px 10px;border-radius:10px;font-size:.68rem;cursor:pointer;font-family:inherit">Switch to Mbps</button></p>
<div class="cards" id="cards"><p style="color:var(--muted);padding:20px">🔍 Scanning...</p></div>
<footer>Round-robin · Auto-failover · HTTP + HTTPS byte tracking</footer>

<script>
const COLORS=['#00ff88','#0088ff','#ff9900','#cc44ff','#ff4488','#00ddff'];
const HISTORY=60;
const canvases={};

function fmt(b){
  if(b<1024)return b+' B';
  if(b<1048576)return(b/1024).toFixed(1)+' KB';
  if(b<1073741824)return(b/1048576).toFixed(2)+' MB';
  return(b/1073741824).toFixed(2)+' GB';
}

let useMbps=false;
function fmtSpeed(kbps){
  if(useMbps) return (kbps*8/1024).toFixed(2)+' Mbps';
  if(kbps>=1024) return (kbps/1024).toFixed(2)+' MB/s';
  return kbps.toFixed(1)+' KB/s';
}

function drawGraph(canvas,history,color){
  const dpr=window.devicePixelRatio||1;
  const W=canvas.offsetWidth,H=60;
  canvas.width=W*dpr;canvas.height=H*dpr;
  const ctx=canvas.getContext('2d');
  ctx.scale(dpr,dpr);
  ctx.clearRect(0,0,W,H);

  if(!history||history.length<2)return;

  const max=Math.max(...history,0.1);
  const pts=history.slice(-HISTORY);
  const step=W/(HISTORY-1);

  const grad=ctx.createLinearGradient(0,0,0,H);
  grad.addColorStop(0,color+'44');
  grad.addColorStop(1,color+'00');
  ctx.beginPath();
  ctx.moveTo(0,H);
  pts.forEach((v,i)=>ctx.lineTo(i*step,H-(v/max)*(H-4)));
  ctx.lineTo((pts.length-1)*step,H);
  ctx.closePath();
  ctx.fillStyle=grad;
  ctx.fill();

  ctx.beginPath();
  pts.forEach((v,i)=>{
    const x=i*step,y=H-(v/max)*(H-4);
    i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
  });
  ctx.strokeStyle=color;
  ctx.lineWidth=1.5;
  ctx.stroke();
}

async function refresh(){
  try{
    const r=await fetch('/api/stats');
    const d=await r.json();
    const ifaces=d.interfaces||[];
    const totalReq=d.total.requests||1;

    document.getElementById('icount').textContent=
      ifaces.length+' interface ('+ifaces.filter(i=>i.alive).length+' online)';

    const grid=document.getElementById('cards');

    ifaces.forEach((iface,idx)=>{
      const color=COLORS[idx%COLORS.length];
      const pct=Math.round(iface.requests/totalReq*100);
      const history=iface.history||[];
      const curSpeed=history.length?history[history.length-1]:0;
      const id='card-'+idx;

      let card=document.getElementById(id);
      if(!card){
        card=document.createElement('div');
        card.id=id;
        grid.appendChild(card);
      }

      const placeholder=grid.querySelector('p');
      if(placeholder)placeholder.remove();

      card.className='card'+(iface.alive?'':' dead');
      card.style.setProperty('--ac',iface.alive?color:'var(--dead)');
      card.innerHTML=\`
        <div class="clabel">Interface \${idx+1}</div>
        <div class="cname">\${iface.name}</div>
        <div class="cip">\${iface.ip}</div>
        <div class="badge-status \${iface.alive?'alive':'dead'}">\${iface.alive?'Online':'Offline'}</div>
        <div class="stats-row">
          <div class="stat"><div class="slabel">Requests</div><div class="sval">\${iface.requests.toLocaleString()}</div></div>
          <div class="stat"><div class="slabel">Total Data</div><div class="sval">\${fmt(iface.bytes)}</div></div>
        </div>
        <div class="speed">Speed: <b>\${fmtSpeed(curSpeed)}</b></div>
        <canvas id="cv-\${idx}"></canvas>
        <div class="pbar-wrap"><div class="pbar" style="width:\${pct}%"></div></div>
      \`;

      requestAnimationFrame(()=>{
        const cv=document.getElementById('cv-'+idx);
        if(cv)drawGraph(cv,history,iface.alive?color:'#ff3355');
      });
    });

    let i=ifaces.length;
    while(document.getElementById('card-'+i)){
      document.getElementById('card-'+i).remove();
      i++;
    }

    let totalCard=document.getElementById('total-card');
    if(!totalCard){
      totalCard=document.createElement('div');
      totalCard.id='total-card';
      totalCard.className='card total-card';
      grid.appendChild(totalCard);
    }
    const totalSpeed=d.interfaces.reduce((s,i)=>{
      const h=i.history||[];
      return s+(h.length?h[h.length-1]:0);
    },0);
    totalCard.innerHTML=\`
      <div><div class="slabel">Total Requests</div><div class="sval">\${d.total.requests.toLocaleString()}</div></div>
      <div><div class="slabel">Combined Speed</div><div class="sval" id="total-speed">\${fmtSpeed(totalSpeed)}</div></div>
      <div class="proxy-badge">Proxy <span>127.0.0.1:8080</span></div>
      <div><div class="slabel">Total Data</div><div class="sval">\${fmt(d.total.bytes)}</div></div>
    \`;
  }catch(e){}
}

refresh();
setInterval(refresh,1000);
</script>
</body>
</html>`;
}
