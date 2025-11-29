import fs from "fs";
import fetch from "node-fetch";
import axios from "axios";

/*
  generate-live-pro.js 
  - Mengambil channel dan mengecek status (Online/Offline).
  - MENGINKLUSI EXTVLCOPT/KODIPROP untuk meningkatkan keberhasilan streaming.
  - Mengambil jadwal event sepak bola hari ini dan 2 hari mendatang dari TheSportsDB.
  - Menghasilkan M3U dengan pengelompokan event cerdas.
*/

const SOURCE_M3US = [
  "https://getch.semar.my.id/",
  "https://bakulwifi.my.id/bw.m3u",
  "https://bakulwifi.my.id/live.m3u"
];
const MAX_DAYS_AHEAD = 2;

// ======================= HELPER FUNCTIONS =======================

function formatDateForM3U(date) {
  const d = new Date(date);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function getFutureDates() {
  const dates = [];
  for (let i = 0; i <= MAX_DAYS_AHEAD; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    dates.push({
      apiDate: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
      m3uDate: d
    });
  }
  return dates;
}

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

async function headOk(url) {
  try {
    const res = await axios.head(url, { 
        timeout: 7000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
            'Referer': 'https://www.google.com'
        }
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

/**
 * MODIFIKASI: Mengekstrak EXTVLCOPT dan KODIPROP sebelum URL.
 */
function extractChannelsFromM3U(m3u) {
  const lines = m3u.split(/\r?\n/);
  const channels = [];
  
  let currentExtInf = null;
  let currentVlcOpts = [];
  
  for (const l of lines) {
    const trimmedLine = l.trim();

    if (trimmedLine.startsWith("#EXTINF")) {
      // Ini adalah tag EXTINF baru.
      currentExtInf = trimmedLine;
      currentVlcOpts = []; // Reset options untuk channel baru

    } else if (trimmedLine.startsWith("#EXTVLCOPT") || trimmedLine.startsWith("#KODIPROP")) {
      // Kumpulkan semua options/props.
      currentVlcOpts.push(trimmedLine);
      
    } else if (trimmedLine.startsWith("http") && currentExtInf) {
      // Ini adalah URL stream, jadi channel sudah lengkap.
      const namePart = currentExtInf.split(",")[1] || currentExtInf;
      
      channels.push({ 
          extinf: currentExtInf, 
          name: namePart.trim(), 
          url: trimmedLine,
          // Simpan semua options/props sebagai satu string
          vlcOpts: currentVlcOpts.join('\n') 
      });
      
      currentExtInf = null; // Reset state
      currentVlcOpts = [];
    }
    // Abaikan baris lain (seperti komentar atau #EXTM3U)
  }
  return channels;
}


async function fetchUpcomingEvents() {
    const dates = getFutureDates();
    let allEvents = [];

    for (const d of dates) {
        const url = `https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${d.apiDate}&s=Soccer`;
        const txt = await fetchText(url);
        if (txt) {
            try {
                const events = JSON.parse(txt).events || [];
                events.forEach(ev => ev.m3uDate = d.m3uDate);
                allEvents = allEvents.concat(events);
            } catch (e) {
                console.error("Error parsing events for", d.apiDate, e.message);
            }
        }
    }
    return allEvents;
}

function buildEventKeywords(events) {
  const kwMap = new Map();

  events.forEach(ev => {
    const dateKey = formatDateForM3U(ev.m3uDate);
    const eventName = `${ev.strHomeTeam} vs ${ev.strAwayTeam} (${ev.strTime} WIB)`;
    
    if (!kwMap.has(dateKey)) {
        kwMap.set(dateKey, { keywords: new Set(), events: [] });
    }

    const entry = kwMap.get(dateKey);
    entry.events.push(eventName);
    
    // Tambahkan kata kunci pencocokan
    if (ev.strHomeTeam) entry.keywords.add(ev.strHomeTeam.toLowerCase());
    if (ev.strAwayTeam) entry.keywords.add(ev.strAwayTeam.toLowerCase());
    if (ev.strLeague) entry.keywords.add(ev.strLeague.toLowerCase());
  });

  return kwMap;
}

function channelMatchesKeywords(channelName, keywordsSet) {
  const ln = channelName.toLowerCase();
  for (const k of keywordsSet) {
    if (ln.includes(k.toLowerCase())) return true;
  }
  return false;
}

// ========================== MAIN ==========================

async function main() {
  console.log("Starting generate-live-pro.js (Full Automation Mode)...");

  // --- Langkah 1: Ambil dan Verifikasi Semua Channel ---
  let allChannels = [];
  for (const src of SOURCE_M3US) {
    const m3u = await fetchText(src);
    if (m3u) allChannels = allChannels.concat(extractChannelsFromM3U(m3u));
  }

  const uniqueChannelsMap = new Map();
  for (const c of allChannels) {
    if (!uniqueChannelsMap.has(c.url)) {
      uniqueChannelsMap.set(c.url, c);
    }
  }

  const unique = Array.from(uniqueChannelsMap.values());
  console.log("Total unique channels found:", unique.length);

  // --- Langkah 2: Pre-check Status Online ---
  const onlineChannels = [];
  const onlineCheckPromises = unique.map(async (ch) => {
    const ok = await headOk(ch.url);
    if (ok) {
        onlineChannels.push(ch);
    } 
  });

  await Promise.all(onlineCheckPromises);
  console.log("Total channels verified as ONLINE:", onlineChannels.length);


  // --- Langkah 3: Ambil Jadwal Event & Kelompokkan ---
  const events = await fetchUpcomingEvents();
  const eventsByDate = buildEventKeywords(events);

  // --- Langkah 4: Kumpulkan Hasil Output ke Grup-grup ---
  const output = ["#EXTM3U"];
  const addedUrls = new Set();
  
  // A. Grup LIVE EVENT (Events Hari Ini)
  const todayDateKey = formatDateForM3U(new Date());
  output.push(`\n#EXTINF:-1 group-title="⚽ LIVE EVENT - ${todayDateKey}", SEDANG BERLANGSUNG`);
  let liveEventCount = 0;

  if (eventsByDate.has(todayDateKey)) {
    const todayEvents = eventsByDate.get(todayDateKey).keywords;
    for (const ch of onlineChannels) {
        if (!addedUrls.has(ch.url) && channelMatchesKeywords(ch.name, todayEvents)) {
            // Tulis EXTVLCOPT sebelum EXTINF
            if (ch.vlcOpts) output.push(ch.vlcOpts);
            
            output.push(ch.extinf.replace(/group-title="[^"]*"/g, `group-title="⚽ LIVE EVENT - ${todayDateKey}"`));
            output.push(ch.url);
            addedUrls.add(ch.url);
            liveEventCount++;
        }
    }
  }

  // B. Grup UPCOMING EVENTS
  let upcomingEventCount = 0;
  for (const [dateKey, data] of eventsByDate) {
    if (dateKey !== todayDateKey) {
        // Tambahkan Header Tanggal Event Mendatang
        output.push(`\n#EXTINF:-1 group-title="📅 UPCOMING EVENTS", ${dateKey}`);
        
        // Tambahkan list pertandingan sebagai placeholder dalam M3U
        data.events.slice(0, 5).forEach(e => {
            output.push(`#EXTINF:-1 tvg-name="UPCOMING EVENT", ${e}`);
        });
        
        // Tambahkan channel yang cocok dengan event mendatang
        for (const ch of onlineChannels) {
            if (!addedUrls.has(ch.url) && channelMatchesKeywords(ch.name, data.keywords)) {
                // Tulis EXTVLCOPT sebelum EXTINF
                if (ch.vlcOpts) output.push(ch.vlcOpts);
                
                output.push(ch.extinf.replace(/group-title="[^"]*"/g, `group-title="📅 UPCOMING EVENTS"`));
                output.push(ch.url);
                addedUrls.add(ch.url);
                upcomingEventCount++;
            }
        }
    }
  }

  // C. Grup ALL ONLINE CHANNELS (Semua Channel Online lainnya)
  output.push(`\n#EXTINF:-1 group-title="⭐ SPORTS CHANNEL", ${onlineChannels.length - addedUrls.size} Channel Aktif Lainnya`);
  let allOnlineCount = 0;
  for (const ch of onlineChannels) {
    if (!addedUrls.has(ch.url)) {
        // Tulis EXTVLCOPT sebelum EXTINF
        if (ch.vlcOpts) output.push(ch.vlcOpts);
        
        // Mengganti nama grup umum menjadi "⭐ SPORTS CHANNEL"
        output.push(ch.extinf.replace(/group-title="[^"]*"/g, `group-title="⭐ SPORTS CHANNEL"`));
        output.push(ch.url);
        addedUrls.add(ch.url);
        allOnlineCount++;
    }
  }
  
  // --- Langkah 5: Tulis file M3U dan Statistik ---
  const FILENAME_M3U = "live-event-pro.m3u";
  const FILENAME_STATS = "live-event-pro-stats.json";

  fs.writeFileSync(FILENAME_M3U, output.join("\n") + "\n");

  const stats = {
    fetched: allChannels.length,
    unique: unique.length,
    onlineTotal: onlineChannels.length,
    onlineLiveEvent: liveEventCount,
    onlineUpcoming: upcomingEventCount,
    onlineGeneral: allOnlineCount,
    generatedAt: new Date().toISOString()
  };

  fs.writeFileSync(FILENAME_STATS, JSON.stringify(stats, null, 2));

  console.log("\n=== SUMMARY ===");
  console.log("Total Channels Verified Online:", onlineChannels.length);
  console.log("Channels in 'LIVE EVENT' group:", liveEventCount);
  console.log("Channels in 'UPCOMING EVENTS' group:", upcomingEventCount);
  console.log("Channels in 'SPORTS CHANNEL' group:", allOnlineCount);
  console.log("Generated", FILENAME_M3U);
  console.log("Stats saved to", FILENAME_STATS);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
