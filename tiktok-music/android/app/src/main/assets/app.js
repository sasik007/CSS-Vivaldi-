// Music Finder — logika interfejsu. Sieć i pobieranie obsługuje Java (obiekt `Android`).
const $ = (s) => document.querySelector(s);
const statusEl = $("#status"), resultsEl = $("#results");
const TT_RE = /https?:\/\/[^\s]*tiktok\.com\/[^\s]+/i;

function setStatus(msg, err = false) { statusEl.textContent = msg; statusEl.className = err ? "err" : ""; }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function fmt(sec) { sec = Math.round(sec || 0); return sec ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}` : ""; }
function fmtSize(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.round(b / 1024) + " KB"; }

// --- most do Javy: wywołania asynchroniczne
const pending = {};
let seq = 0;
window.__cb = (id, ok, text) => { const p = pending[id]; delete pending[id]; if (p) ok ? p.res(text) : p.rej(new Error(text)); };
window.__progress = (id, label) => { const p = pending[id]; if (p && p.onProgress) p.onProgress(label); };
function call(method, ...args) { return callP(null, method, ...args); }
function callP(onProgress, method, ...args) {
  return new Promise((res, rej) => { const id = ++seq; pending[id] = { res, rej, onProgress }; Android[method](id, ...args); });
}

// --- przełączniki źródeł
const src = { itunes: true, youtube: true, openverse: true, archive: true };
try { Object.assign(src, JSON.parse(localStorage.getItem("sources") || "{}")); } catch {}
document.querySelectorAll("[data-src]").forEach(cb => {
  cb.checked = !!src[cb.dataset.src];
  cb.onchange = () => {
    src[cb.dataset.src] = cb.checked;
    try { localStorage.setItem("sources", JSON.stringify(src)); } catch {}
  };
});

// --- zakładki
function showTab(name) {
  document.querySelectorAll(".tab, .panel").forEach(e => e.classList.remove("active"));
  document.querySelector(`.tab[data-tab="${name}"]`).classList.add("active");
  $("#tab-" + name).classList.add("active");
}
document.querySelectorAll(".tab").forEach(t => t.onclick = () => showTab(t.dataset.tab));

// --- wyszukiwanie pełnych utworów (katalog iTunes, bez klucza)
async function searchSongs(term) {
  if (!term.trim()) return [];
  const url = "https://itunes.apple.com/search?" + new URLSearchParams({ term, entity: "song", limit: 15, country: "PL" });
  const data = JSON.parse(await call("httpGet", url));
  return (data.results || []).map(r => ({
    title: r.trackName, artist: r.artistName, album: r.collectionName,
    cover: (r.artworkUrl100 || "").replace("100x100", "300x300"), preview: r.previewUrl,
    duration: Math.round((r.trackTimeMillis || 0) / 1000), year: (r.releaseDate || "").slice(0, 4),
    apple: r.trackViewUrl, genre: r.primaryGenreName, explicit: r.trackExplicitness === "explicit",
    trackNo: r.trackNumber, trackCount: r.trackCount, date: (r.releaseDate || "").slice(0, 10),
  }));
}

function ytSearch(q) {
  return "https://www.youtube.com/results?search_query=" + encodeURIComponent(q.trim());
}
function ytButton(q, label = "▶ Odtwórz całą piosenkę") {
  return `<button class="btn yt" data-play="${esc(q.trim())}">${label}</button>`;
}

// --- pełne utwory na wolnych licencjach (legalne pobieranie)
function ccName(code, ver) {
  code = (code || "").toLowerCase();
  if (code === "cc0") return "CC0 (domena publiczna)";
  if (code === "pdm") return "Domena publiczna";
  return `CC ${code.toUpperCase()}${ver ? " " + ver : ""}`;
}
const LOSSLESS = /flac|wav|aiff?|alac/i;
/** Najlepszy wariant pliku: bezstratny > najwyższy bitrate. */
function bestVariant(r) {
  const all = [{ url: r.url, filetype: r.filetype, bit_rate: r.bit_rate }, ...(r.alt_files || [])].filter(f => f && f.url);
  const score = f => (LOSSLESS.test(f.filetype || "") ? 1e7 : 0) + (f.bit_rate || 0);
  return all.sort((x, y) => score(y) - score(x))[0];
}
async function searchOpenverse(q) {
  const url = "https://api.openverse.org/v1/audio/?" + new URLSearchParams({ q, page_size: 12 });
  const data = JSON.parse(await call("httpGet", url));
  return (data.results || []).filter(r => r.url).map(r => ({ ...r, ...bestVariant(r) })).map(r => ({
    kind: "file", title: r.title, artist: r.creator, source: SOURCE_NAMES[r.source] || r.source || r.provider,
    license: ccName(r.license, r.license_version), licenseUrl: r.license_url,
    url: r.url, format: (r.filetype || "").toUpperCase() + (r.bit_rate ? ` · ${Math.round(r.bit_rate / 1000)} kbps` : "") + (LOSSLESS.test(r.filetype || "") ? " (bezstratny)" : ""),
    duration: (r.duration || 0) / 1000,
    cover: r.thumbnail, page: r.foreign_landing_url,
  }));
}
async function searchArchive(q) {
  const query = `(${q}) AND mediatype:audio AND licenseurl:*creativecommons*`;
  const url = "https://archive.org/advancedsearch.php?" + new URLSearchParams({ q: query, rows: 8, output: "json" })
    + "&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=licenseurl";
  const data = JSON.parse(await call("httpGet", url));
  return ((data.response || {}).docs || []).map(d => {
    const lm = (d.licenseurl || "").match(/licenses\/([a-z-]+)\/([\d.]+)/i) || (d.licenseurl || "").match(/(zero|publicdomain)/i);
    return {
      kind: "archive", id: d.identifier, title: d.title, artist: [].concat(d.creator || "").join(", "),
      source: "Internet Archive", license: lm ? (lm[2] ? ccName(lm[1], lm[2]) : "CC0 (domena publiczna)") : "Creative Commons",
      licenseUrl: d.licenseurl, cover: `https://archive.org/services/img/${d.identifier}`,
      page: `https://archive.org/details/${d.identifier}`,
    };
  });
}
function safeName(s) { return (s || "").replace(/[\\/:*?"<>|]+/g, "").trim().slice(0, 80) || "utwor"; }
function dlButton(url, name) {
  return `<button class="btn small" data-dl="${esc(url)}" data-name="${esc(safeName(name))}">⬇️ Pobierz cały utwór</button>`;
}
function renderFree(list) {
  const box = $("#free");
  if (!list.length) { box.innerHTML = (src.openverse || src.archive) ? `<p class="hint">⬇️ Brak tego utworu w darmowych, legalnych źródłach do pobrania.</p>` : ""; return; }
  box.innerHTML = `<h2 class="sec">⬇️ Pełne utwory do pobrania <small>(wolne licencje)</small></h2><div class="grid">` + list.map(s => `
    <article class="song free">
      <div class="top">
        ${s.cover ? `<img src="${esc(s.cover)}" alt="" onerror="this.remove()">` : ""}
        <div><h3>${esc(s.title)}</h3><div class="meta">${esc(s.artist || "")}</div></div>
      </div>
      <dl class="facts">
        <dt>🌐 Źródło</dt><dd>${esc(s.source || "")}</dd>
        <dt>📜 Licencja</dt><dd>${s.licenseUrl ? `<a href="#" data-open="${esc(s.licenseUrl)}">${esc(s.license)}</a>` : esc(s.license)}</dd>
        ${s.duration ? `<dt>⏱ Czas</dt><dd><b>${fmt(s.duration)}</b> (cały utwór)</dd>` : ""}
        ${s.format ? `<dt>🎵 Format</dt><dd>${esc(s.format)}</dd>` : ""}
      </dl>
      ${s.url ? `<audio controls preload="none" src="${esc(s.url)}"></audio>` : ""}
      <div class="links">
        ${s.url ? dlButton(s.url, `${s.artist ? s.artist + " - " : ""}${s.title}`) : ""}
        ${s.kind === "archive" ? `<button class="btn small" data-ia="${esc(s.id)}">📂 Pokaż utwory</button>` : ""}
        ${s.page ? `<button class="btn ghost small" data-open="${esc(s.page)}">Strona</button>` : ""}
      </div>
      <div class="ia-tracks"></div>
      <div class="dl-info"></div>
    </article>`).join("") + `</div>`;
}
function parseLen(v) {  // "187.3" albo "02:10" / "1:02:10"
  if (!v) return 0;
  if (String(v).includes(":")) return String(v).split(":").reduce((a, x) => a * 60 + (parseFloat(x) || 0), 0);
  return parseFloat(v) || 0;
}
const SOURCE_NAMES = { jamendo: "Jamendo", ccmixter: "ccMixter", wikimedia_audio: "Wikimedia", freesound: "Freesound" };
async function showArchiveTracks(btn) {
  const card = btn.closest(".song"), box = card.querySelector(".ia-tracks"), id = btn.dataset.ia;
  btn.disabled = true; box.textContent = "⏳ Wczytuję utwory…";
  try {
    const meta = JSON.parse(await call("httpGet", "https://archive.org/metadata/" + encodeURIComponent(id)));
    // najlepszy format każdego utworu: FLAC > VBR MP3 > 320 kbps > 256 > 192 > 128 > inne MP3/OGG
    const rank = f => { const x = (f.format || "").toLowerCase();
      return x.includes("flac") ? 100 : x === "vbr mp3" ? 90 : x.includes("320") ? 80 : x.includes("256") ? 70
        : x.includes("192") ? 60 : x.includes("128") ? 40 : x.includes("mp3") ? 30 : x.includes("ogg") ? 20 : 0; };
    const byTrack = new Map();
    for (const f of meta.files || []) {
      if (!rank(f) || /^(spectrogram|png|jpeg)/i.test(f.format || "")) continue;
      const key = (f.title || f.name.replace(/\.[^.]+$/, "")).toLowerCase();
      const cur = byTrack.get(key);
      if (!cur || rank(f) > rank(cur)) byTrack.set(key, f);
    }
    const files = [...byTrack.values()].slice(0, 40);
    if (!files.length) { box.textContent = "Brak plików audio w tej pozycji."; return; }
    const artist = [].concat((meta.metadata || {}).creator || "").join(", ");
    box.innerHTML = `<ol class="tracks">` + files.map(f => {
      const len = parseLen(f.length), t = f.title || f.name.replace(/\.[^.]+$/, "");
      return `<li><span>${esc(t)}${len ? ` <small>${fmt(len)}</small>` : ""} <small>· ${esc(f.format)}</small></span>
        ${dlButton(`https://archive.org/download/${encodeURIComponent(id)}/${encodeURIComponent(f.name)}`, `${artist ? artist + " - " : ""}${t}`)}</li>`;
    }).join("") + `</ol>`;
  } catch (err) { box.textContent = "❌ " + err.message; btn.disabled = false; }
}
async function downloadFull(btn) {
  const card = btn.closest(".song"), info = card.querySelector(".dl-info");
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = "⏳ Pobieram…";
  try {
    const i = JSON.parse(await callP(l => btn.textContent = "⏳ " + l, "downloadFile", btn.dataset.dl, btn.dataset.name));
    btn.textContent = "✅ Zapisano";
    info.innerHTML = fileInfoHtml(i);
  } catch (err) {
    btn.disabled = false; btn.textContent = label;
    setStatus("❌ " + err.message, true);
  }
}

let lastCatalog = [], lastFree = [];

// Czy darmowy utwór to naprawdę ta piosenka (a nie coś o podobnej nazwie)?
function norm(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\(.*?\)|\[.*?\]/g, " ").replace(/\b(feat|ft)\..*$/, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
function isSameSong(f, t) {
  const ft = norm(f.title), tt = norm(t.title);
  if (!ft || !tt || !(ft === tt || ft.startsWith(tt + " ") || tt.startsWith(ft + " "))) return false;
  if (!t.artist) return true;
  const fa = norm(f.artist), ta = norm(t.artist);
  return !!fa && (fa.includes(ta) || ta.includes(fa) || ta.split(" ").some(w => w.length > 2 && fa.split(" ").includes(w)));
}

/** Czas + przycisk „Pobierz cały” na karcie (Teraz na TikToku / film z linku). */
async function updateFullUI(target, ytQuery) {
  const best = lastCatalog[0];
  const t = best ? { title: best.title, artist: best.artist } : target;
  const match = t && t.title ? lastFree.find(f => f.url && isSameSong(f, t)) : null;

  const btn = $("#np-full");
  if (btn) {
    if (match) {
      btn.disabled = false;
      btn.textContent = `⬇️ Pobierz cały utwór · ${match.format || ""}`;
      btn.title = `${match.source} · ${match.license}`;
      btn.onclick = () => downloadFullTo(btn, match.url, `${match.artist ? match.artist + " - " : ""}${match.title}`);
      $("#np-full-src").textContent = `Legalne źródło: ${match.source} · ${match.license}`;
    } else {
      btn.disabled = true;
      btn.textContent = "⬇️ Pobierz cały";
      $("#np-full-src").textContent = (src.openverse || src.archive)
        ? "Nie znaleziono tej piosenki w legalnych, darmowych źródłach."
        : "Włącz Openverse w ⚙️ Źródłach, żeby szukać całych utworów.";
    }
  }

  const el = $("#full-len");
  if (!el) return;
  const song = best || match;
  if (song && song.duration) {
    el.innerHTML = `<span class="badge">⏱ Cała piosenka</span><b>${fmt(song.duration)}</b> <small class="muted">(${esc(song.artist || "")} — ${esc(song.title)})</small>`;
    return;
  }
  // brak w katalogu → przybliżony czas z pierwszego wyniku YouTube
  el.innerHTML = `<span class="badge">⏱ Czas</span><small class="muted">sprawdzam na YouTube…</small>`;
  try {
    const v = JSON.parse(await call("youtubeSearch", ytQuery)).find(x => x.length);
    el.innerHTML = v
      ? `<span class="badge">⏱ Czas</span><b>~${esc(v.length)}</b> <small class="muted">(wg YouTube: ${esc(v.title)})</small>`
      : `<span class="badge">⏱ Czas</span><small class="muted">nieznany</small>`;
  } catch { el.innerHTML = `<span class="badge">⏱ Czas</span><small class="muted">nieznany</small>`; }
}

/** Otwiera piosenkę w aplikacji YouTube Music (tam z Premium: ⬇️ Pobierz offline). */
async function openInYtMusic(btn) {
  const q = btn.dataset.ytm, label = btn.textContent;
  btn.disabled = true; btn.textContent = "⏳ Otwieram YouTube Music…";
  let url = "https://music.youtube.com/search?q=" + encodeURIComponent(q);
  try {
    const v = JSON.parse(await call("youtubeSearch", q))[0];
    if (v) url = "https://music.youtube.com/watch?v=" + v.id;
  } catch {}
  Android.openUrl(url);
  btn.disabled = false; btn.textContent = label;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-ytm]");
  if (b) openInYtMusic(b);
});

function fullButtonHtml(q) {
  return `<p><button class="btn ytm" data-ytm="${esc(q)}">⬇️ Pobierz w YouTube Music</button>
    <small class="muted">Otwiera piosenkę w YouTube Music — z Premium pobierzesz ją tam offline.</small></p>
    <p><button class="btn full" id="np-full" disabled>⬇️ Pobierz cały — szukam…</button>
    <small class="muted" id="np-full-src"></small></p><div id="np-file"></div>`;
}

async function downloadFullTo(btn, url, name) {
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = "⏳ Pobieram…";
  try {
    const i = JSON.parse(await callP(l => btn.textContent = "⏳ " + l, "downloadFile", url, safeName(name)));
    btn.textContent = "✅ Zapisano cały utwór";
    $("#np-file").innerHTML = fileInfoHtml(i);
  } catch (err) {
    btn.disabled = false; btn.textContent = label;
    setStatus("❌ " + err.message, true);
  }
}
/** Długość całej piosenki na karcie „Teraz na TikToku” / filmu z linku. */
function showFullLength(song) {
  const el = $("#full-len");
  if (!el) return;
  el.innerHTML = song && song.duration
    ? `<span class="badge">⏱ Cała piosenka</span><b>${fmt(song.duration)}</b> <small class="muted">(${esc(song.artist)} — ${esc(song.title)})</small>`
    : "";
}

/** Szuka we wszystkich włączonych źródłach. */
async function searchAll(q, title = q, fallback = "") {
  lastCatalog = [];
  $("#q").value = q;
  resultsEl.innerHTML = ""; $("#free").innerHTML = "";
  setStatus("⏳ Szukam pełnej wersji…");
  const catalog = !src.itunes ? Promise.resolve(0) : (async () => {
    let r = await searchSongs(q);
    if (!r.length && fallback) r = await searchSongs(fallback);
    renderResults(r);
    lastCatalog = r;
    return r.length;
  })().catch(() => 0);
  const freeJobs = [];
  if (src.openverse) freeJobs.push(searchOpenverse(fallback || q).catch(() => []));
  if (src.archive) freeJobs.push(searchArchive(fallback || q).catch(() => []));
  lastFree = [];
  const free = Promise.all(freeJobs).then(l => { const all = l.flat(); lastFree = all; renderFree(all); return all.length; });
  const [n, f] = await Promise.all([catalog, free]);
  const parts = [];
  if (src.itunes) parts.push(`${n} w katalogu`);
  if (src.openverse || src.archive) parts.push(`${f} do pobrania`);
  if (n || f) setStatus(`✅ „${title}”: ${parts.join(", ")}`);
  else setStatus(src.youtube ? "Nic nie znaleziono w katalogu — kliknij ▶ Odtwórz, poszukamy na YouTube." : "Nic nie znaleziono 😕", true);
}

function storeLinks(s) {
  const q = `${s.artist} ${s.title}`.trim(), e = encodeURIComponent(q);
  return [
    ["YouTube", ytSearch(q)],
    ["Spotify", `https://open.spotify.com/search/${e}`],
    ["YT Music", `https://music.youtube.com/search?q=${e}`],
    ["Apple Music", s.apple],
    ["Deezer", `https://www.deezer.com/search/${e}`],
  ].filter(([, u]) => u);
}

function renderResults(list) {
  resultsEl.innerHTML = "";
  list.forEach((s, i) => {
    const links =
      storeLinks(s).map(([n, u]) => `<button class="btn ghost small" data-open="${esc(u)}">${n}</button>`).join("");
    resultsEl.insertAdjacentHTML("beforeend", `
      <article class="song ${i === 0 ? "best" : ""}">
        <div class="top">
          ${s.cover ? `<img src="${esc(s.cover)}" alt="">` : ""}
          <div><h3>${esc(s.title)}</h3>
            <div class="meta">${esc(s.artist)}${s.explicit ? ' <span class="tag">E</span>' : ""}</div>
          </div>
        </div>
        <dl class="facts">
          ${s.duration ? `<dt>⏱ Czas</dt><dd><b>${fmt(s.duration)}</b> (cała piosenka)</dd>` : ""}
          ${s.album ? `<dt>💿 Album</dt><dd>${esc(s.album)}${s.trackNo ? ` · utwór ${s.trackNo}/${s.trackCount || "?"}` : ""}</dd>` : ""}
          ${s.genre ? `<dt>🎼 Gatunek</dt><dd>${esc(s.genre)}</dd>` : ""}
          ${s.date ? `<dt>📅 Wydano</dt><dd>${esc(s.date)}</dd>` : ""}
        </dl>
        ${s.preview ? `<audio controls preload="none" src="${esc(s.preview)}"></audio>` : ""}
        <div class="links">${links}</div>
      </article>`);
  });
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-open]");
  if (b) Android.openUrl(b.dataset.open);
  const p = e.target.closest("[data-play]");
  if (p) playYouTube(p.dataset.play);
  const d = e.target.closest("[data-dl]");
  if (d) downloadFull(d);
  const ia = e.target.closest("[data-ia]");
  if (ia) showArchiveTracks(ia);
  if (b || p || d || ia) e.preventDefault();
});

// --- odtwarzacz YouTube w aplikacji (oficjalny odtwarzacz osadzony)
let ytApi = null, ytPlayer = null, ytList = [], ytIdx = 0, ytQuery = "";
function loadYtApi() {
  if (ytApi) return ytApi;
  ytApi = new Promise((res, rej) => {
    window.onYouTubeIframeAPIReady = res;
    const sc = document.createElement("script");
    sc.src = "https://www.youtube.com/iframe_api";
    sc.onerror = () => { ytApi = null; rej(new Error("Nie można załadować odtwarzacza YouTube")); };
    document.head.appendChild(sc);
  });
  return ytApi;
}
function ytShow(i) {
  ytIdx = i;
  const v = ytList[i];
  $("#yt-title").textContent = v.title + (v.length ? `  ·  ⏱ ${v.length}` : "");
  if (ytPlayer) ytPlayer.loadVideoById(v.id);
  else ytPlayer = new YT.Player("yt", {
    videoId: v.id, width: "100%", height: "100%",
    playerVars: { autoplay: 1, playsinline: 1, rel: 0 },
    events: { onError: () => {  // np. film zablokowany do osadzania → następny
      if (ytIdx + 1 < ytList.length) ytShow(ytIdx + 1);
      else setStatus("Tego utworu nie da się odtworzyć w aplikacji — kliknij „Otwórz w YouTube”.", true);
    } },
  });
}
async function playYouTube(query) {
  ytQuery = query;
  const box = $("#player-box");
  box.hidden = false;
  $("#yt-title").textContent = "⏳ Szukam na YouTube: " + query;
  box.scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    const [list] = await Promise.all([call("youtubeSearch", query).then(JSON.parse), loadYtApi()]);
    ytList = list;
    ytShow(0);
  } catch (err) {
    $("#yt-title").textContent = "❌ " + err.message;
  }
}
$("#yt-next").onclick = () => ytList.length && ytShow((ytIdx + 1) % ytList.length);
$("#yt-open").onclick = () => Android.openUrl(ytList[ytIdx] ? "https://www.youtube.com/watch?v=" + ytList[ytIdx].id : ytSearch(ytQuery));
$("#yt-close").onclick = () => { if (ytPlayer) ytPlayer.stopVideo(); $("#player-box").hidden = true; };
document.addEventListener("play", (e) => {  // tylko jeden odsłuch naraz
  document.querySelectorAll("audio").forEach(a => a !== e.target && a.pause());
}, true);

// --- TikTok
let current = null;
window.grabFailed = () => {
  const btn = $("#np-dl");
  if (btn) { btn.disabled = false; btn.textContent = "⬇️ Pobierz urywek"; }
  setStatus("Nie udało się automatycznie skopiować linku. W TikToku: Udostępnij → Kopiuj link i wróć — pobierze się samo.", true);
};
let autoDownloadAt = 0;

function isOriginal(m) {
  const t = (m.title || "").toLowerCase();
  return !t || m.original || /original sound|oryginalny dźwięk|son original|sonido original/.test(t);
}

async function analyze(url) {
  showTab("link");
  $("#tt-url").value = url;
  $("#btn-find").disabled = true; resultsEl.innerHTML = ""; $("#free").innerHTML = ""; $("#video-box").innerHTML = "";
  setStatus("⏳ Otwieram film na TikToku…");
  try {
    const d = JSON.parse(await call("tiktok", url));
    current = d;
    const m = d.music || {}, orig = isOriginal(m);
    const canDl = !!(m.playUrl || d.videoUrl);
    // dla „oryginalnego dźwięku” szukamy po opisie filmu (często jest tam tytuł piosenki)
    const ytQuery = orig ? (hintQuery(d.desc) || (d.desc || "").replace(/#\S+/g, "").trim() || m.author || m.title) : `${m.author || ""} ${m.title}`;
    $("#video-box").innerHTML = `
      <div class="video">
        ${m.cover || d.cover ? `<img src="${esc(m.cover || d.cover)}" alt="">` : ""}
        <div class="info">
          <p><b>@${esc(d.author || "")}</b> — ${esc((d.desc || "").slice(0, 120))}</p>
          <p><span class="badge">Dźwięk</span>${esc(m.title || "?")}${m.author ? " · " + esc(m.author) : ""}</p>
          ${m.duration ? `<p><span class="badge">⏱ Urywek</span><b>${fmt(m.duration)}</b></p>` : ""}
          <p id="full-len"><span class="badge">⏱ Cała piosenka</span><small class="muted">sprawdzam…</small></p>
          <div class="row np-actions">
            <button class="btn ghost" data-open="${esc(ytSearch(ytQuery))}">🔎 Szukaj w YouTube</button>
            ${canDl ? `<button class="btn ghost" id="btn-dl">⬇️ Pobierz urywek</button>` : ""}
          </div>
          <div id="file-info"></div>
          ${fullButtonHtml(ytQuery)}
        </div>
      </div>`;
    if (canDl) $("#btn-dl").onclick = downloadCurrent;
    const autoDl = canDl && autoDownloadAt && Date.now() - autoDownloadAt < 5 * 60_000;
    if (autoDl) autoDownloadAt = 0;

    if (orig) {
      // „oryginalny dźwięk” — spróbuj po hashtagach z opisu filmu
      const ph = parseHint(d.desc);
      const hq = ph.q;
      current.hint = hq;
      current.hintTag = ph;
      if (hq) await searchAll(hq, `${hq} (z opisu filmu)`);
      else setStatus("To „oryginalny dźwięk” bez tytułu piosenki. Pobierz go albo rozpoznaj w zakładce 🎙️.", true);
    } else {
      await searchAll(`${m.author || ""} ${m.title}`.trim(), m.title, m.author ? m.title : "");
    }
    await updateFullUI(orig ? { title: (current.hintTag || {}).title || "", artist: (current.hintTag || {}).artist || "" } : { title: m.title, artist: m.author }, ytQuery);
    // „Pobierz urywek” z „Teraz na TikToku” → po skopiowaniu linku pobieramy od razu
    if (autoDl) downloadCurrent();
  } catch (err) {
    setStatus("❌ " + err.message, true);
  } finally {
    $("#btn-find").disabled = false;
  }
}

/** Prawdziwy tytuł i wykonawca do nazwy pliku i tagów (zamiast „TikTok”). */
function songTag(d) {
  const m = d.music || {};
  if (!isOriginal(m)) return { title: m.title, artist: m.author || "" };
  const best = lastCatalog[0];
  if (best) return { title: best.title, artist: best.artist };
  if (d.hintTag && d.hintTag.title) return { title: d.hintTag.title, artist: d.hintTag.artist };
  return { title: m.title || "Oryginalny dźwięk", artist: m.author || d.author || "" };
}

async function downloadCurrent() {
  const d = current; if (!d) return;
  const m = d.music || {};
  const tag = songTag(d);
  const name = safeName(`${tag.artist ? tag.artist + " - " : ""}${tag.title}`);
  const btn = $("#btn-dl"); btn.disabled = true; btn.textContent = "⏳ Pobieram…";
  try {
    const i = JSON.parse(await callP(l => btn.textContent = "⏳ " + l, "download", m.playUrl || "", d.videoUrl || "", name, tag.title, tag.artist));
    btn.textContent = "✅ Zapisano";
    $("#file-info").innerHTML = fileInfoHtml(i);
  } catch (err) {
    btn.disabled = false; btn.textContent = "⬇️ Spróbuj pobrać ponownie";
    setStatus("❌ " + err.message, true);
  }
}

function fileInfoHtml(i) {
    const ch = i.channels === 1 ? "mono" : i.channels === 2 ? "stereo" : i.channels ? i.channels + " kanały" : "";
    return `
      <dl class="facts file">
        <dt>📁 Plik</dt><dd>${esc(i.path)}</dd>
        <dt>🎵 Format</dt><dd><b>${esc(i.format || "?")}</b>${i.codec && i.codec !== i.format ? ` (kodek ${esc(i.codec)})` : ""}</dd>
        ${i.kbps ? `<dt>📶 Jakość</dt><dd>${i.kbps} kbps${i.sampleRate ? ` · ${(i.sampleRate / 1000).toFixed(1)} kHz` : ""}${ch ? " · " + ch : ""}</dd>` : ""}
        ${i.duration ? `<dt>⏱ Czas</dt><dd>${fmt(i.duration)}</dd>` : ""}
        ${i.size ? `<dt>💾 Rozmiar</dt><dd>${fmtSize(i.size)}</dd>` : ""}
      </dl>`;
}

$("#form-link").onsubmit = (e) => {
  e.preventDefault();
  const v = $("#tt-url").value, m = v.match(TT_RE);
  if (!m) return setStatus("To nie wygląda na link do TikToka.", true);
  analyze(m[0]);
};

$("#btn-paste").onclick = () => {
  const t = Android.clipboard() || "", m = t.match(TT_RE);
  if (m) analyze(m[0]);
  else { $("#tt-url").value = t.trim(); setStatus("W schowku nie ma linku do TikToka.", true); }
};

// wywoływane z Javy, gdy ktoś udostępni film z TikToka do aplikacji
window.handleShared = (text) => {
  const m = (text || "").match(TT_RE);
  if (m) analyze(m[0]); else setStatus("Udostępniony tekst nie zawiera linku do TikToka.", true);
};

$("#form-search").onsubmit = async (e) => {
  e.preventDefault();
  await searchAll($("#q").value.trim());
};

$("#btn-yt").onclick = () => {
  const q = $("#q").value.trim();
  if (!q) return $("#q").focus();
  Android.openUrl(ytSearch(q));
};

// --- „Teraz na TikToku” (z usługi wykrywania)
// Hashtagi z opisu → podpowiedź tytułu („#SonicRush #DanceMusic” → „Sonic Rush”)
const GENERIC_TAGS = /^(fyp|fy|foryou|foryoupage|fypシ|viral|trend|trending|dlaciebie|dc|xyzbca|music|muzyka|dance|dancemusic|song|remix|edit|capcut|tiktok|polska|pl|funny|love|explore|viralvideo|parati|pourtoi)$/i;
/** Z opisu filmu: najpierw wzór „Wykonawca – Tytuł”, potem hashtagi. */
function parseHint(hint) {
  for (let line of (hint || "").split(/\n/)) {
    line = line.replace(/[\p{Extended_Pictographic}\uFE0F]/gu, " ").split(/\s[|•]\s|…|\.\.\./)[0].replace(/#\S+/g, "").trim();
    const m = line.match(/^(.{2,60}?)\s+[–—-]\s+(.{2,60}?)\s*$/);
    if (m && !/^@/.test(m[1])) {
      const artist = m[1].trim(), title = m[2].replace(/["“”„]/g, "").trim();
      return { q: `${artist.replace(/\b(feat|ft)\.?.*$/i, "").trim()} ${title}`, artist, title };
    }
  }
  const tags = [...(hint || "").matchAll(/#([\p{L}\p{N}_]+)/gu)].map(m => m[1]).filter(t => !GENERIC_TAGS.test(t));
  const words = tags.slice(0, 2).map(t => t.replace(/_/g, " ").replace(/([a-ząćęłńóśźż])([A-ZĄĆĘŁŃÓŚŹŻ])/g, "$1 $2"));
  const q = words.join(" ").trim();
  return { q, artist: "", title: q };
}
function hintQuery(hint) { return parseHint(hint).q; }
function originalAuthor(title) {
  const m = title.match(/(?:użytkownika|original sound\s*-|oryginalny dźwięk\s*-|son original\s*-|sonido original\s*-)\s*(.+)$/i);
  return m ? m[1].replace(/[^\p{L}\p{N} _.-]/gu, "").trim() : "";
}

window.handleNowPlaying = async (title, hint = "") => {
  showTab("link");
  resultsEl.innerHTML = ""; $("#free").innerHTML = "";
  const orig = /original sound|oryginalny dźwięk|dźwięk oryginalny|son original|sonido original/i.test(title);
  const ph = orig ? parseHint(hint) : null;
  const hq = ph ? ph.q : "";
  const q = orig ? (hq || originalAuthor(title) || title) : title.replace(/\s+-\s+/g, " ");
  $("#video-box").innerHTML = `
    <div class="video"><div class="info">
      <p><span class="badge">🎧 Teraz na TikToku</span><b>${esc(title)}</b></p>
      ${orig ? `<p class="muted">To „oryginalny dźwięk” bez tytułu.${hq ? ` Z opisu filmu: <b>${esc(ph.artist ? ph.artist + " – " + ph.title : hq)}</b>` : ""}</p>` : ""}
      <p id="full-len"><span class="badge">⏱ Cała piosenka</span><small class="muted">sprawdzam…</small></p>
      <div class="row np-actions">
        <button class="btn ghost" data-open="${esc(ytSearch(q))}">🔎 Szukaj w YouTube</button>
        <button class="btn ghost" id="np-dl">⬇️ Pobierz urywek</button>
      </div>
      ${fullButtonHtml(q)}
    </div></div>`;
  $("#np-dl").onclick = () => {
    autoDownloadAt = Date.now();
    const btn = $("#np-dl");
    btn.disabled = true; btn.textContent = "⏳ Pobieram link z TikToka…";
    setStatus("⏳ Kopiuję link do filmu w TikToku — za chwilę wrócę i pobiorę.");
    if (!Android.grabTikTokLink()) {
      btn.disabled = false; btn.textContent = "⬇️ Pobierz urywek";
      setStatus("👉 W TikToku: Udostępnij → Kopiuj link, potem wróć tutaj — pobieranie ruszy samo.");
      Android.backToTikTok();
    }
  };
  if (orig && !hq) {
    lastCatalog = []; lastFree = [];
    setStatus("To „oryginalny dźwięk” bez tytułu — spróbuj 🎙️ Rozpoznaj (Shazam) albo 🔎 Szukaj w YouTube.", true);
    return updateFullUI(null, q);
  }
  await searchAll(q, title);
  const parts = title.split(/\s+-\s+/);
  await updateFullUI(orig ? { title: ph.title, artist: ph.artist } : { title: parts[0], artist: parts.slice(1).join(" ") }, q);
};

// --- baner włączenia wykrywania
let setupHidden = false;
try { setupHidden = localStorage.getItem("setupHidden") === "1"; } catch {}
window.refreshSetup = () => { $("#setup").hidden = setupHidden || Android.watcherEnabled(); };
$("#btn-setup").onclick = () => Android.openWatcherSettings();
$("#app-settings").onclick = (e) => { e.preventDefault(); Android.openAppSettings(); };
$("#btn-setup-hide").onclick = () => {
  setupHidden = true; $("#setup").hidden = true;
  try { localStorage.setItem("setupHidden", "1"); } catch {}
};
refreshSetup();

$("#btn-rec").onclick = () => Android.recognize();

// --- diagnostyka wykrywania
$("#btn-np").onclick = () => {
  if (!Android.watcherEnabled()) { $("#setup").hidden = false; setupHidden = false; return Android.openWatcherSettings(); }
  Android.refreshNowPlaying();
  setTimeout(() => { if (!$("#video-box").textContent.includes("Teraz na TikToku")) setStatus("Jeszcze nic nie wykryto — włącz film na TikToku i spróbuj ponownie. Jeśli nie działa: 🔧 Diagnostyka.", true); }, 600);
};
$("#btn-diag").onclick = () => {
  const d = JSON.parse(Android.watcherDebug() || "{}"), sc = d.scan || {};
  const ago = (s) => s < 0 ? "nigdy" : s < 60 ? `${s} s temu` : `${Math.round(s / 60)} min temu`;
  const lines = [
    `Usługa włączona: ${d.enabled ? "TAK" : "NIE ← włącz w Ułatwieniach dostępu"}`,
    `Ostatni odczyt TikToka: ${ago(d.scanAgo)}`,
    `Wykryty dźwięk: ${d.title ? `„${d.title}” (${ago(d.titleAgo)})` : "brak"}`,
    `Okna TikToka: ${sc.windows ?? "-"}, elementów: ${sc.nodes ?? "-"}`,
    `Telefon: ${d.device || "?"}, Android ${d.android || "?"}`,
    ``,
    `Kandydaci na nazwę dźwięku (✓ = użyty, bo jest na ekranie):`,
    ...((sc.candidates || []).map(t => "  " + t)),
    ``,
    `Napisy widoczne na ekranie TikToka:`,
    ...((sc.texts || []).map(t => "• " + t)),
  ];
  const el = $("#diag");
  el.textContent = lines.join("\n");
  el.hidden = false;
};
