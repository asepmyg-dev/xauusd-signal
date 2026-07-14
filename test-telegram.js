/**
 * Test Paksa Notifikasi Telegram
 * ---------------------------------------------------------------
 * Script ini TIDAK menghitung sinyal apa pun — cuma mengirim satu
 * pesan tes ke Telegram, untuk memastikan jalur Bot Token & Chat ID
 * sudah benar. Aman dijalankan kapan saja tanpa mempengaruhi data
 * signal.json / history.json yang asli.
 */

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

async function main() {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error('TELEGRAM_BOT_TOKEN atau TELEGRAM_CHAT_ID belum diset di Secrets.');
    process.exit(1);
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      parse_mode: 'HTML',
      text:
        '🧪 <b>TES NOTIFIKASI BERHASIL</b>\n\n' +
        'Kalau kamu terima pesan ini, artinya Bot Token dan Chat ID sudah tersambung dengan benar.\n' +
        'Notifikasi sinyal asli (STRONG_BUY/STRONG_SELL) akan dikirim otomatis lewat jalur yang sama ini.\n\n' +
        'Waktu tes: ' + new Date().toISOString()
    })
  });

  const data = await res.json();
  if (!data.ok) {
    console.error('Gagal kirim pesan:', JSON.stringify(data));
    process.exit(1);
  }
  console.log('Pesan tes berhasil dikirim ke Telegram!');
}

main().catch(err => { console.error(err); process.exit(1); });
