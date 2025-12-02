import fs from "fs";
import fetch from "node-fetch";
import axios from "axios";

/*
  generate-raw-grouped.js 
  - MODE SEDERHANA: 
    1. Mengambil semua channel (Lokal + Eksternal).
    2. Melewati semua cek online (Semua dianggap aktif).
    3. Menggunakan NAMA ASLI channel (Tidak diubah).
    4. Menjadikan satu kategori tunggal "ALL CHANNELS".
*/

// --- KONFIGURASI SUMBER ---
const LOCAL_M3U_FILES = ["live.m3u", "bw.m3u"]; 
const SOURCE_M3US = [
  "https://getch.semar.my.id/",
  "https://bakulwifi.my.id/bw.m3u"
];

// Nama Grup Tunggal untuk semua channel
const SINGLE_GROUP_NAME = "SPORT CHANNELS";

// ======================= HELPER FUNCTIONS =======================

async function fetchText(url) {
  try {
    const res = await fetch(url, { timeout: 15000 });
    if (!res.ok) return "";
    return await res.text();
  } catch (e) {
    console.error("fetchText error for", url, e.message);
    return "";
  }
}

// Fungsi ekstraksi yang mempertahankan semua atribut asli
function extractChannelsFromM3U(m3u) {
  const lines = m3u.split(/\r?\n/);
  const channels = [];
  
  let currentExtInf = null;
  let currentVlcOpts = [];
  
  for (const l of lines) {
    const trimmedLine = l.trim();

    if (trimmedLine.startsWith("#EXTINF")) {
      currentExtInf = trimmedLine;
      currentVlcOpts = []; 

    } else if (trimmedLine.startsWith("#EXTVLCOPT") || trimmedLine.startsWith("#KODIPROP")) {
      currentVlcOpts.push(trimmedLine);
      
    } else if (currentExtInf && (trimmedLine.startsWith("http") || trimmedLine.startsWith("rtmp") || trimmedLine.startsWith("udp"))) {
      
      channels.push({ 
          extinf: currentExtInf, // Baris EXTINF asli (berisi nama asli)
          url: trimmedLine,
          vlcOpts: [...currentVlcOpts] 
      });
      
      currentExtInf = null; 
      currentVlcOpts = [];
    }
  }
  return channels;
}

// ========================== MAIN ==========================

async function main() {
  console.log("Starting script: Original Names, No Filter, Single Group...");

  let allChannels = [];
  
  // 1. Ambil dari file lokal
  for (const localFile of LOCAL_M3U_FILES) {
      try {
          const content = fs.readFileSync(localFile, 'utf8');
          allChannels = allChannels.concat(extractChannelsFromM3U(content));
          console.log(`Loaded from ${localFile}`);
      } catch (e) {
          console.error(`Skipping missing local file: ${localFile}`);
      }
  }

  // 2. Ambil dari URL eksternal
  for (const src of SOURCE_M3US) {
    const content = await fetchText(src);
    if (content) {
        allChannels = allChannels.concat(extractChannelsFromM3U(content));
        console.log(`Loaded from URL: ${src}`);
    }
  }
  
  console.log(`Total channels found: ${allChannels.length}`);

  // 3. Tulis Output (Tanpa Cek Online, Tanpa Ubah Nama)
  const generatedTime = new Date().toISOString();
  const output = [`#EXTM3U url-version="${generatedTime}"`]; 
  
  // Header Grup (Opsional, agar terlihat rapi di atas)
  output.push(`\n#EXTINF:-1 group-title="${SINGLE_GROUP_NAME}", === DAFTAR CHANNEL (${allChannels.length}) ===`);
  output.push("http://localhost/info"); // Dummy URL untuk header

  for (const ch of allChannels) {
    // Tulis header stream (User-Agent, dll)
    if (ch.vlcOpts.length > 0) output.push(...ch.vlcOpts);
    
    // UBAH HANYA GROUP-TITLE, PERTAHANKAN NAMA ASLI
    // Regex ini mengganti group-title="..." dengan group-title="ALL CHANNELS"
    // Sisanya (termasuk tvg-id, tvg-logo, dan Nama Channel di akhir) TETAP ASLI.
    let newExtInf = ch.extinf;
    
    if (newExtInf.includes('group-title="')) {
        newExtInf = newExtInf.replace(/group-title="[^"]*"/, `group-title="${SINGLE_GROUP_NAME}"`);
    } else {
        // Jika tidak ada group-title, sisipkan setelah -1
        newExtInf = newExtInf.replace('#EXTINF:-1', `#EXTINF:-1 group-title="${SINGLE_GROUP_NAME}"`);
    }

    output.push(newExtInf);
    output.push(ch.url);
  }
  
  // 4. Simpan File
  const FILENAME_M3U = "live-raw-grouped.m3u"; 
  const FILENAME_STATS = "live-raw-stats.json";

  fs.writeFileSync(FILENAME_M3U, output.join("\n") + "\n");

  const stats = {
    totalChannels: allChannels.length,
    generatedAt: generatedTime
  };

  fs.writeFileSync(FILENAME_STATS, JSON.stringify(stats, null, 2));

  console.log("=== DONE ===");
  console.log(`Generated ${FILENAME_M3U} with ${allChannels.length} channels.`);
  console.log(`Group Name: ${SINGLE_GROUP_NAME}`);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
