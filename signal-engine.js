/**
 * XAUUSD Confluence Signal Engine (versi gratis, tanpa TradingView Premium)
 * ---------------------------------------------------------------
 * Mengambil candle XAU/USD dari Twelve Data (API gratis), menghitung
 * MACD, RSI, EMA trend filter, Bollinger Bands, dan Volume Pressure
 * (proksi dominasi buyer/seller) SENDIRI di JavaScript — tidak butuh
 * TradingView Premium/webhook sama sekali.
 *
 * Dijalankan otomatis via GitHub Actions (lihat .github/workflows/signal.yml)
 */

const fs = require('fs');
const path = require('path');

// ================== KONFIGURASI ==================
const TWELVE_DATA_API_KEY = process.env.TWELVE_DATA_API_KEY;
const TELEGRAM_BOT_TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID    = process.env.TELEGRAM_CHAT_ID;

const SYMBOL     = 'XAU/USD';
const INTERVAL   = '15min';      // 1min, 5min, 15min, 1h, 4h, 1day
const OUTPUTSIZE = 250;          // jumlah candle historis diambil

const MACD_FAST = 12, MACD_SLOW = 26, MACD_SIGNAL = 9;
const RSI_LEN = 14, RSI_OB = 70, RSI_OS = 30;
const MA_FAST_LEN = 50, MA_SLOW_LEN = 200;
const BB_LEN = 20, BB_MULT = 2.0;
const VOL_LOOKBACK = 20, VOL_THRESHOLD = 70;
const SCORE_THRESHOLD = 4; // minimal skor 0-5 untuk sinyal kuat
// ===================================================

async function fetchCandles() {
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(SYMBOL)}&interval=${INTERVAL}&outputsize=${OUTPUTSIZE}&apikey=${TWELVE_DATA_API_KEY}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.status === 'error') throw new Error('Twelve Data error: ' + json.message);
  // Twelve Data returns newest-first; balik jadi oldest-first untuk perhitungan indikator
  return json.values.map(v => ({
    time: v.datetime,
    open: parseFloat(v.open),
    high: parseFloat(v.high),
    low: parseFloat(v.low),
    close: parseFloat(v.close),
    volume: v.volume ? parseFloat(v.volume) : null
  })).reverse();
}

// === Indikator dasar ===
function ema(values, len) {
  const k = 2 / (len + 1);
  const out = new Array(values.length).fill(null);
  let prev = values.slice(0, len).reduce((a, b) => a + b, 0) / len;
  out[len - 1] = prev;
  for (let i = len; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function sma(values, len) {
  const out = new Array(values.length).fill(null);
  for (let i = len - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - len + 1; j <= i; j++) sum += values[j];
    out[i] = sum / len;
  }
  return out;
}

function stdev(values, len) {
  const out = new Array(values.length).fill(null);
  for (let i = len - 1; i < values.length; i++) {
    const slice = values.slice(i - len + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / len;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / len;
    out[i] = Math.sqrt(variance);
  }
  return out;
}

function rsi(closes, len) {
  const out = new Array(closes.length).fill(null);
  let gains = 0, losses = 0;
  for (let i = 1; i <= len; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / len, avgLoss = losses / len;
  out[len] = 100 - 100 / (1 + (avgLoss === 0 ? 100 : avgGain / avgLoss));
  for (let i = len + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (len - 1) + gain) / len;
    avgLoss = (avgLoss * (len - 1) + loss) / len;
    out[i] = 100 - 100 / (1 + (avgLoss === 0 ? 100 : avgGain / avgLoss));
  }
  return out;
}

function macd(closes, fastLen, slowLen, signalLen) {
  const emaFast = ema(closes, fastLen);
  const emaSlow = ema(closes, slowLen);
  const macdLine = closes.map((_, i) => (emaFast[i] !== null && emaSlow[i] !== null) ? emaFast[i] - emaSlow[i] : null);
  const validMacd = macdLine.filter(v => v !== null);
  const signalRaw = ema(validMacd, signalLen);
  const offset = macdLine.length - validMacd.length;
  const signalLine = new Array(macdLine.length).fill(null);
  for (let i = 0; i < signalRaw.length; i++) signalLine[offset + i] = signalRaw[i];
  const hist = macdLine.map((v, i) => (v !== null && signalLine[i] !== null) ? v - signalLine[i] : null);
  return { macdLine, signalLine, hist };
}

function last(arr) { return arr[arr.length - 1]; }
function prevOf(arr) { return arr[arr.length - 2]; }

async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' })
  });
}

async function main() {
  const candles = await fetchCandles();
  const closes = candles.map(c => c.close);
  const opens = candles.map(c => c.open);

  const { hist } = macd(closes, MACD_FAST, MACD_SLOW, MACD_SIGNAL);
  const rsiArr = rsi(closes, RSI_LEN);
  const emaFastArr = ema(closes, MA_FAST_LEN);
  const emaSlowArr = ema(closes, MA_SLOW_LEN);
  const basisArr = sma(closes, BB_LEN);
  const devArr = stdev(closes, BB_LEN);

  const i = closes.length - 1;
  const histNow = hist[i], histPrev = hist[i - 1];
  const rsiNow = rsiArr[i];
  const emaFastNow = emaFastArr[i], emaSlowNow = emaSlowArr[i];
  const basisNow = basisArr[i], devNow = devArr[i];
  const upperBB = basisNow + BB_MULT * devNow;
  const lowerBB = basisNow - BB_MULT * devNow;
  const bbWidth = (upperBB - lowerBB) / basisNow;

  const bbWidthArr = closes.map((_, idx) => {
    if (basisArr[idx] === null || devArr[idx] === null) return null;
    return (2 * BB_MULT * devArr[idx]) / basisArr[idx];
  }).filter(v => v !== null);
  const bbWidthAvg = bbWidthArr.slice(-50).reduce((a, b) => a + b, 0) / Math.min(50, bbWidthArr.length);
  const notSqueeze = bbWidth >= bbWidthAvg * 0.7;

  // Volume Pressure (proksi order book). Kalau volume tidak tersedia dari API
  // (umum untuk forex/gold OTC), fallback pakai hitungan candle naik vs turun.
  const hasVolume = candles.some(c => c.volume !== null && c.volume > 0);
  let buyPressurePct;
  const windowSlice = candles.slice(-VOL_LOOKBACK);
  if (hasVolume) {
    const upVol = windowSlice.filter(c => c.close > c.open).reduce((a, c) => a + c.volume, 0);
    const downVol = windowSlice.filter(c => c.close < c.open).reduce((a, c) => a + c.volume, 0);
    const total = upVol + downVol;
    buyPressurePct = total > 0 ? (upVol / total) * 100 : 50;
  } else {
    const upCount = windowSlice.filter(c => c.close > c.open).length;
    buyPressurePct = (upCount / windowSlice.length) * 100;
  }
  const sellPressurePct = 100 - buyPressurePct;

  const macdBull = histNow > 0 && histNow > histPrev;
  const macdBear = histNow < 0 && histNow < histPrev;
  const rsiBull = rsiNow > 50 && rsiNow < RSI_OB;
  const rsiBear = rsiNow < 50 && rsiNow > RSI_OS;
  const trendBull = emaFastNow > emaSlowNow && closes[i] > emaFastNow;
  const trendBear = emaFastNow < emaSlowNow && closes[i] < emaFastNow;
  const volBull = buyPressurePct >= VOL_THRESHOLD;
  const volBear = sellPressurePct >= VOL_THRESHOLD;

  const bullScore = [macdBull, rsiBull, trendBull, notSqueeze, volBull].filter(Boolean).length;
  const bearScore = [macdBear, rsiBear, trendBear, notSqueeze, volBear].filter(Boolean).length;

  const signal = bullScore >= SCORE_THRESHOLD ? 'STRONG_BUY' : bearScore >= SCORE_THRESHOLD ? 'STRONG_SELL' : 'NEUTRAL';
  const trend = trendBull ? 'UP' : trendBear ? 'DOWN' : 'SIDEWAYS';

  const record = {
    time: new Date().toISOString(),
    ticker: 'XAUUSD',
    signal,
    price: closes[i].toFixed(2),
    bull_score: bullScore,
    bear_score: bearScore,
    buy_pressure_pct: buyPressurePct.toFixed(2),
    sell_pressure_pct: sellPressurePct.toFixed(2),
    rsi: rsiNow.toFixed(2),
    macd_hist: histNow.toFixed(4),
    trend,
    volume_source: hasVolume ? 'volume' : 'candle_direction_fallback'
  };

  const outDir = path.join(__dirname, 'data');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'signal.json'), JSON.stringify(record, null, 2));

  const historyPath = path.join(outDir, 'history.json');
  let history = [];
  if (fs.existsSync(historyPath)) history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
  history.push(record);
  if (history.length > 100) history = history.slice(-100);
  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));

  console.log('Signal:', record);

  if (signal !== 'NEUTRAL') {
    const emoji = signal === 'STRONG_BUY' ? '🟢' : '🔴';
    await sendTelegram(
      `${emoji} <b>XAUUSD ${signal.replace('_', ' ')}</b>\n` +
      `Harga: ${record.price}\n` +
      `Skor Bull/Bear: ${bullScore}/${bearScore}\n` +
      `RSI: ${record.rsi} | Trend: ${trend}\n` +
      `Volume Pressure (buy): ${record.buy_pressure_pct}% (${record.volume_source})\n` +
      `Waktu: ${record.time}`
    );
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
