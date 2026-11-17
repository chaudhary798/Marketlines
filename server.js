// MarketLens server: real crypto prices (Binance public data) + forex (Twelve Data or ExchangeRate-API fallback)
// Needs Node 18+. No npm packages required.
const http = require("http"), fs = require("fs"), path = require("path");
const PORT = process.env.PORT || 3000;
const KEY = process.env.TWELVE_DATA_KEY || ""; // optional, enables minute-level forex
const B = "https://data-api.binance.vision/api/v3", N = 80, MIN = 60000;

const C = [["BTC","Bitcoin"],["ETH","Ethereum"],["BNB","BNB"],["SOL","Solana"],["XRP","XRP"],
  ["ADA","Cardano"],["DOGE","Dogecoin"],["AVAX","Avalanche"],["LINK","Chainlink"],["TON","Toncoin"]];
const FX = ["EUR/USD","GBP/USD","USD/JPY","USD/PKR","AUD/USD","USD/CHF"];

const mk = (s, n, t, src) => ({ s, n, t, src, h: [], o: null, u: 0 });
const M = C.map(c => mk(c[0], c[1], "c", "Binance"))
  .concat(FX.map(p => mk(p, p.replace("/", " / "), "f", KEY ? "Twelve Data" : "ExchangeRate-API (daily)")));
const bySym = Object.fromEntries(M.map(m => [m.s, m]));
const dec = p => (p >= 100 ? 2 : p >= 1 ? 4 : 5);

async function j(u) {
  const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(u + " -> " + r.status);
  return r.json();
}

// Add a price: update the latest point every call, start a new point once a minute
function push(m, price, open) {
  if (!isFinite(price)) return;
  const now = Date.now();
  if (!m.h.length || now - m.u >= MIN) { m.h.push(price); if (m.h.length > N) m.h.shift(); m.u = now; }
  else m.h[m.h.length - 1] = price;
  if (open) m.o = open; else if (m.o == null) m.o = price;
}

async function seedCrypto() {
  for (const [s] of C) {
    try {
      const k = await j(`${B}/klines?symbol=${s}USDT&interval=1m&limit=${N}`);
      bySym[s].h = k.map(x => +x[4]); bySym[s].u = Date.now();
    } catch (e) { console.error("seed", s, e.message); }
  }
}
async function pollCrypto() {
  try {
    const syms = encodeURIComponent(JSON.stringify(C.map(c => c[0] + "USDT")));
    const d = await j(`${B}/ticker/24hr?symbols=${syms}`);
    d.forEach(t => push(bySym[t.symbol.replace("USDT", "")], +t.lastPrice, +t.openPrice));
  } catch (e) { console.error("crypto", e.message); }
}
async function pollForex() {
  try {
    if (KEY) {
      const d = await j(`https://api.twelvedata.com/price?symbol=${FX.join(",")}&apikey=${KEY}`);
      FX.forEach(p => d[p] && push(bySym[p], +d[p].price));
    } else {
      const r = (await j("https://open.er-api.com/v6/latest/USD")).rates;
      FX.forEach(p => { const [a, b] = p.split("/"); push(bySym[p], (a === "USD" ? 1 : 1 / r[a]) * (b === "USD" ? 1 : r[b])); });
    }
  } catch (e) { console.error("forex", e.message); }
}

(async () => {
  await seedCrypto(); await pollCrypto(); await pollForex();
  setInterval(pollCrypto, 5000);
  setInterval(pollForex, KEY ? MIN : 10 * MIN);
})();

http.createServer((req, res) => {
  if (req.url.startsWith("/api/markets")) {
    const out = M.filter(m => m.h.length).map(m => ({ s: m.s, n: m.n, t: m.t, src: m.src, o: m.o, h: m.h, d: dec(m.h[m.h.length - 1]) }));
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end(JSON.stringify(out));
  }
  fs.readFile(path.join(__dirname, "public", "index.html"), (e, data) => {
    if (e) { res.writeHead(500); return res.end("index.html missing"); }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(data);
  });
}).listen(PORT, () => console.log("MarketLens running on port " + PORT));
