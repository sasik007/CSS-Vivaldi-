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
const src = { itunes: true, youtube: true, openverse: true, archive: true, autodetails2: false, comments: true };
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
  document.body.dataset.tab = name;
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

let lastTarget = null, lastYt = null;
/** Pierwszy film z YouTube, którego tytuł zawiera tytuł piosenki (i ew. wykonawcę). */
async function findYtMatch(t, q) {
  lastYt = null;
  if (!t || !t.title || !q) return null;
  try {
    const list = JSON.parse(await call("youtubeSearch", q));
    const tt = norm(t.title), ta = norm((t.artist || "").replace(/\b(feat|ft)\.?.*$/i, ""));
    lastYt = list.find(v => { const n = norm(v.title); return n.includes(tt) && (!ta || n.includes(ta)); })
      || list.find(v => norm(v.title).includes(tt)) || null;
  } catch {}
  return lastYt;
}
/** Wynik z katalogu tylko jeśli to naprawdę ta piosenka (tytuł/wykonawca się zgadzają). */
function verifiedBest(t) {
  if (!t || !t.title) return null;
  return lastCatalog.find(r => isSameSong(r, t) || (t.artist && isSameSong(r, { title: t.artist, artist: t.title }))) || null;
}

/** Czyste zapytanie do YouTube: bez emotek, #tagów, @wzmianek i „oryginalny dźwięk”. */
function cleanQuery(q) {
  return stripEmoji(q || "")
    .replace(/#\S+|@\S+/g, " ")
    .replace(/\b(oryginalny dźwięk|dźwięk oryginalny|original sound|son original|sonido original|som original|wykonawcy|użytkownika)\b/gi, " ")
    .replace(/\((?:cover|remix|sped up|slowed[^)]*|nightcore|karaoke|tiktok[^)]*)\)/gi, " ")
    .replace(/\b(cover|sped up|slowed)\b/gi, " ")
    .replace(/[|•–—\-_:;,"„”“]+/g, " ")
    .replace(/\s+/g, " ").trim();
}
/** Ustawia zapytanie YouTube na karcie; pusty = brak tytułu (przyciski nieaktywne). */
function setYtQuery(q) {
  q = cleanQuery(q);
  const box = $("#video-box");
  box.querySelectorAll("[data-yt-search]").forEach(b => {
    b.disabled = !q;
    if (q) b.dataset.open = ytSearch(q); else delete b.dataset.open;
  });
  box.querySelectorAll("[data-ytm]").forEach(b => { b.disabled = !q; b.dataset.ytm = q; });
  const lab = $("#yt-q");
  if (lab) lab.innerHTML = q ? `🔎 szuka: <b>${esc(q)}</b>` : `Brak tytułu piosenki — użyj 🎙️ Rozpoznaj (Shazam).`;
  return q;
}

/** Czas + przycisk „Pobierz cały” na karcie (Teraz na TikToku / film z linku). */
async function updateFullUI(target, ytQuery) {
  lastTarget = target;
  lastYt = null;
  const best = verifiedBest(target);
  const t = best ? { title: best.title, artist: best.artist } : target;
  if (best && $("#np-title")) { $("#np-title").textContent = best.title; $("#np-artist").textContent = best.artist; }
  // najdokładniejsze zapytanie: potwierdzony utwór z katalogu > tytuł z opisu/dźwięku
  ytQuery = setYtQuery(best ? `${best.artist} ${best.title}` : (t && t.title ? `${t.artist || ""} ${t.title}` : ytQuery));
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
    findYtMatch(t, ytQuery);  // w tle: dokładny film dla „Pobierz w YouTube”
    el.innerHTML = `<span class="badge">⏱ Cała piosenka</span><b>${fmt(song.duration)}</b> <small class="muted">${best ? "z katalogu" : esc(song.source || "")}</small>`;
    return;
  }
  // brak w katalogu → YouTube, ale tylko film, którego tytuł zawiera tytuł piosenki
  el.innerHTML = `<span class="badge">⏱ Cała piosenka</span><small class="muted">sprawdzam na YouTube…</small>`;
  const yt = await findYtMatch(t, ytQuery);
  el.innerHTML = yt && yt.length
    ? `<span class="badge">⏱ Cała piosenka</span><b>${esc(yt.length)}</b> <small class="muted">z YouTube</small>`
    : `<span class="badge">⏱ Cała piosenka</span><small class="muted">nieznana — nie znaleziono tego utworu</small>`;
}

/** Otwiera film z piosenką w aplikacji YouTube (pod filmem: ⬇️ Pobierz — z Premium). */
async function openInYtMusic(btn) {
  const q = btn.dataset.ytm, label = btn.textContent;
  btn.disabled = true; btn.textContent = "⏳ Otwieram YouTube…";
  if (!q) { btn.disabled = false; btn.textContent = label; return; }
  // tylko film, którego tytuł pasuje do piosenki; inaczej lista wyników (bez zgadywania)
  if (!lastYt && lastTarget) await findYtMatch(lastTarget, q);
  const url = lastYt ? "https://www.youtube.com/watch?v=" + lastYt.id : ytSearch(q);
  Android.openUrl(url);
  btn.disabled = false; btn.textContent = label;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-ytm]");
  if (b) openInYtMusic(b);
});

/** Przyciski karty: główny „Pobierz urywek”, YouTube, „Pobierz cały”. */
function actionsHtml(q, clipBtn) {
  return `
    <div class="actions">
      ${clipBtn ? `<span class="span2">${clipBtn}</span>` : ""}
      <button class="btn ytm" data-ytm="${esc(q)}">⬇️ Pobierz w YouTube</button>
      <button class="btn ghost" data-yt-search data-open="${esc(ytSearch(q))}">🔎 Szukaj w YouTube</button>
      <span class="span2"><button class="btn full" id="np-full" disabled>⬇️ Pobierz cały — szukam…</button></span>
    </div>
    <p id="yt-q"></p>
    <small id="np-full-src"></small>
    <div id="np-file"></div>`;
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
let lastSearch = null, npCalls = 0;
async function searchAll(q, title = q, fallback = "") {
  lastSearch = [q, title, fallback];
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
  else setStatus(src.youtube ? "Nic nie znaleziono w katalogu — spróbuj 🔎 Szukaj w YouTube." : "Nic nie znaleziono 😕", true);
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
    const extra = [s.album, s.genre, s.date && s.date.slice(0, 4)].filter(Boolean).map(esc).join(" · ");
    resultsEl.insertAdjacentHTML("beforeend", `
      <article class="song ${i === 0 ? "best" : ""}">
        <div class="top">
          ${s.cover ? `<img src="${esc(s.cover)}" alt="" onerror="this.remove()">` : ""}
          <div><h3>${esc(s.title)}</h3>
            <div class="meta">${esc(s.artist)}${s.explicit ? ' <span class="tag">E</span>' : ""}</div>
            ${extra ? `<div class="extra">${extra}</div>` : ""}
          </div>
          ${s.duration ? `<span class="dur">${fmt(s.duration)}</span>` : ""}
        </div>
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
let autoDownloadAt = 0, grabForModalAt = 0, grabForDetailsAt = 0;
let cardData = null, cardKey = "";   // dane filmu z bieżącej karty „Teraz na TikToku”

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
      <div class="np">
        <div class="np-head">🔗 Film z TikToka · @${esc(d.author || "")}</div>
        <div class="np-main">
          ${m.cover || d.cover ? `<img class="np-cover" src="${esc(m.cover || d.cover)}" alt="" onerror="this.remove()">` : ""}
          <div>
            <h2 class="np-title" id="np-title">${esc(orig ? "Oryginalny dźwięk" : (m.title || "?"))}</h2>
            <div class="np-artist" id="np-artist">${esc(orig ? "" : (m.author || ""))}</div>
          </div>
        </div>
        <div class="np-sub dim">♬ ${esc(m.title || "?")}${d.desc ? ` · ${esc(d.desc.slice(0, 90))}` : ""}</div>
        <div class="facts-list">
          ${m.duration ? `<div class="fact"><span class="badge">⏱ Na TikToku</span><b>${fmt(m.duration)}</b> <small class="muted">cały dźwięk${d.videoDuration ? ` · film ${fmt(d.videoDuration)}` : ""}</small></div>` : ""}
          <div class="fact" id="full-len"><span class="badge">⏱ Cała piosenka</span><small class="muted">sprawdzam…</small></div>
        </div>
        ${actionsHtml(ytQuery, canDl ? `<button class="btn primary wide" id="btn-dl">⬇️ Pobierz urywek</button>` : "")}
        <div id="file-info"></div>
      </div>`;
    if (canDl) $("#btn-dl").onclick = () => openClipModal(null, current);
    const autoDl = canDl && autoDownloadAt && Date.now() - autoDownloadAt < 5 * 60_000;
    if (autoDl) autoDownloadAt = 0;

    const ph = parseHint(d.desc);
    const useCap = !!ph.q && (orig || ph.from !== "Z hashtagów");
    if (useCap) {
      current.hint = ph.q;
      current.hintTag = ph;
      $("#full-len").insertAdjacentHTML("beforebegin", `<div class="fact"><span class="badge">📝 ${esc(ph.from)}</span>${esc(ph.raw || ph.q)}</div>`);
      $("#np-title").textContent = ph.title || ph.q;
      $("#np-artist").textContent = ph.artist || "";
      await searchAll(ph.q, ph.raw || ph.q);
    } else if (orig) {
      setStatus("To „oryginalny dźwięk” bez tytułu piosenki. Pobierz go albo rozpoznaj w zakładce 🎙️.", true);
    } else {
      await searchAll(`${m.author || ""} ${m.title}`.trim(), m.title, m.author ? m.title : "");
    }
    await updateFullUI(useCap ? { title: ph.title, artist: ph.artist } : orig ? null : { title: m.title, artist: m.author }, useCap ? ph.q : ytQuery);
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
  const best = verifiedBest(lastTarget);
  if (best) return { title: best.title, artist: best.artist };
  if (d.hintTag && d.hintTag.title) return { title: d.hintTag.title, artist: d.hintTag.artist };
  if (!isOriginal(m)) return { title: m.title, artist: m.author || "" };
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
  if (!m) return setStatus("Udostępniony tekst nie zawiera linku do TikToka.", true);
  // link skopiowany automatycznie dla danych karty (czas od razu)
  if (grabForDetailsAt && Date.now() - grabForDetailsAt < 60_000) {
    grabForDetailsAt = 0;
    return loadCardDetails(m[0]);
  }
  // link skopiowany po „Pobierz urywek” z karty → okienko z danymi, karta zostaje bez zmian
  if (grabForModalAt && Date.now() - grabForModalAt < 5 * 60_000) {
    grabForModalAt = 0;
    const btn = $("#np-dl");
    if (btn) { btn.disabled = false; btn.textContent = "⬇️ Pobierz urywek"; }
    setStatus("");
    return openClipModal(m[0]);
  }
  analyze(m[0]);
};

// --- okienko: dane kawałka z TikToka → Pobierz / Anuluj → powrót
function closeModal() { $("#modal").hidden = true; $("#sheet").innerHTML = ""; }
window.onBack = () => { if (!$("#modal").hidden) { closeModal(); return true; } return false; };
$("#modal").onclick = (e) => { if (e.target.id === "modal") closeModal(); };

async function openClipModal(url, data) {
  const sheet = $("#sheet");
  $("#modal").hidden = false;
  sheet.innerHTML = `<p>⏳ Wczytuję dane z TikToka… <span id="m-sec" class="muted"></span></p><div class="row"><button class="btn ghost" id="m-cancel">Anuluj</button></div>`;
  $("#m-cancel").onclick = closeModal;
  const t0 = Date.now();
  const timer = setInterval(() => { const el = $("#m-sec"); if (el) el.textContent = Math.round((Date.now() - t0) / 1000) + " s"; else clearInterval(timer); }, 500);
  let d = data;
  try {
    if (!d) d = JSON.parse(await Promise.race([
      call("tiktok", url),
      new Promise((_, rej) => setTimeout(() => rej(new Error("TikTok nie odpowiada. Spróbuj ponownie.")), 30000)),
    ]));
  } catch (err) {
    clearInterval(timer);
    if ($("#modal").hidden) return;
    sheet.innerHTML = `<p class="err">❌ ${esc(err.message)}</p>
      <div class="row m-actions"><button class="btn" id="m-retry">🔄 Spróbuj ponownie</button><button class="btn ghost" id="m-cancel">Zamknij</button></div>`;
    $("#m-cancel").onclick = closeModal;
    $("#m-retry").onclick = () => openClipModal(url);
    return;
  }
  clearInterval(timer);
  if ($("#modal").hidden) return;  // anulowano w międzyczasie
  current = d;
  if (!d.hintTag) { const ph = parseHint(d.desc); if (ph.q && (isOriginal(d.music || {}) || ph.from !== "Z hashtagów")) d.hintTag = ph; }
  const m = d.music || {};
  const tag = songTag(d);
  const name = safeName(`${tag.artist ? tag.artist + " - " : ""}${tag.title}`);
  if (m.duration) window.updateTikTokTime(m.duration);  // uzupełnij czas na karcie

  sheet.innerHTML = `
    <div class="top">
      ${m.cover || d.cover ? `<img src="${esc(m.cover || d.cover)}" alt="" onerror="this.remove()">` : ""}
      <div><h3>${esc(tag.title || "?")}</h3><div class="meta">${esc(tag.artist || "")}</div></div>
    </div>
    <dl class="facts">
      <dt>🎵 Dźwięk</dt><dd>${esc(m.title || "?")}${m.author ? " · " + esc(m.author) : ""}</dd>
      ${m.duration ? `<dt>⏱ Cały dźwięk</dt><dd><b>${fmt(m.duration)}</b> (na TikToku)</dd>` : ""}
      ${d.videoDuration ? `<dt>🎬 Film</dt><dd>${fmt(d.videoDuration)}</dd>` : ""}
      <dt>👤 Autor filmu</dt><dd>@${esc(d.author || "")}</dd>
      <dt>📶 Jakość</dt><dd id="m-q"><small class="muted">sprawdzam…</small></dd>
      <dt>📁 Plik</dt><dd>Pobrane/Music Finder/${esc(name)}</dd>
    </dl>
    <div id="m-info"></div>
    <div class="row m-actions">
      <button class="btn" id="m-dl" ${m.playUrl || d.videoUrl ? "" : "disabled"}>⬇️ Pobierz</button>
      <button class="btn ghost" id="m-cancel">Anuluj</button>
    </div>`;
  $("#m-cancel").onclick = closeModal;
  $("#m-dl").onclick = () => modalDownload(d, name, tag);

  // szacowana jakość przed pobraniem (rozmiar / czas)
  if (m.playUrl) {
    try {
      const p = JSON.parse(await call("probe", m.playUrl));
      const fmtName = /mpeg|mp3/i.test(p.type || "") ? "MP3" : /mp4|m4a|aac/i.test(p.type || "") ? "AAC" : (p.type || "audio");
      const kbps = p.size > 0 && m.duration ? Math.round(p.size * 8 / m.duration / 1000) : 0;
      if ($("#m-q")) $("#m-q").innerHTML = `${fmtName}${kbps ? ` · ~${kbps} kbps` : ""}${p.size > 0 ? ` · ${fmtSize(p.size)}` : ""}
        <br><small class="muted">Aplikacja porówna też ścieżkę z filmu i zapisze całość w najlepszej jakości.</small>`;
    } catch { if ($("#m-q")) $("#m-q").textContent = "najlepsza dostępna (wybór automatyczny)"; }
  } else if ($("#m-q")) $("#m-q").textContent = "ścieżka dźwiękowa z filmu (AAC)";
}

async function modalDownload(d, name, tag) {
  const m = d.music || {}, btn = $("#m-dl");
  btn.disabled = true; $("#m-cancel").textContent = "Zamknij";
  btn.textContent = "⏳ Pobieram…";
  try {
    const i = JSON.parse(await callP(l => { if ($("#m-dl")) $("#m-dl").textContent = "⏳ " + l; },
      "download", m.playUrl || "", d.videoUrl || "", name, tag.title, tag.artist));
    if (!$("#m-dl")) return;
    btn.textContent = "✅ Zapisano";
    $("#m-info").innerHTML = fileInfoHtml(i);
    setStatus(`✅ Zapisano: ${i.path || name}`);
    setTimeout(closeModal, 2500);  // powrót do poprzedniego ekranu
  } catch (err) {
    if (!$("#m-dl")) return;
    btn.disabled = false; btn.textContent = "⬇️ Spróbuj ponownie";
    $("#m-info").innerHTML = `<p class="err">❌ ${esc(err.message)}</p>`;
  }
}

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
const SEARCH_HINT = /^(?:wyszukiwanie|search|szukaj|wyszukaj)\s*[·•:|]\s*(.{2,80})$/i;
const COVER_TAG = /\((?:cover|remix|live|acoustic|official[^)]*|sped up|slowed[^)]*|nightcore|karaoke)\)|\b(?:cover|remix)\b/gi;
const stripEmoji = (t) => t.replace(/[\p{Extended_Pictographic}\uFE0F]/gu, " ").replace(/\s+/g, " ").trim();

/**
 * Tytuł piosenki z napisów TikToka, w kolejności pewności:
 * 1) podpowiedź TikToka „Wyszukiwanie · …”  2) „Wykonawca – Tytuł”
 * 3) linia z „(cover)/(remix)” albo w cudzysłowie, „Song: …”, „… by …”  4) hashtagi
 */
function parseHint(hint) {
  const lines = (hint || "").split(/\n/).map(stripEmoji).filter(Boolean);
  for (const l of lines) {
    const m = l.match(SEARCH_HINT);
    if (m) { const t = m[1].trim(); return { q: t, artist: "", title: t, raw: t, from: "TikTok podpowiada" }; }
  }
  for (let line of lines) {
    line = line.split(/\s[|•]\s|…|\.\.\./)[0].replace(/#\S+/g, "").trim();
    const m = line.match(/^(.{2,60}?)\s+[–—-]\s+(.{2,60}?)\s*$/);
    if (m && !/^@/.test(m[1])) {
      const artist = m[1].trim(), title = m[2].replace(/["“”„]/g, "").replace(COVER_TAG, "").trim();
      return { q: `${artist.replace(/\b(feat|ft)\.?.*$/i, "").trim()} ${title}`, artist, title, raw: `${artist} – ${m[2].trim()}`, from: "Z opisu filmu" };
    }
  }
  for (let line of lines) {
    line = line.split(/\s[|•]\s|…/)[0].replace(/#\S+/g, "").trim();
    let t = null, artist = "";
    let m;
    if ((m = line.match(/^(?:song|piosenka|utwór|track|muzyka|music|🎵)\s*[:：-]\s*(.{2,80})$/i))) t = m[1];
    else if ((m = line.match(/^(.{2,60}?)\s+by\s+(.{2,40})$/i))) { t = m[1]; artist = m[2]; }
    else if ((m = line.match(/[„"“]([^„"“”]{2,60})[”"]/))) t = m[1];
    else if (COVER_TAG.test(line)) t = line;
    COVER_TAG.lastIndex = 0;
    if (t) {
      t = t.replace(COVER_TAG, "").replace(/\s+/g, " ").trim();
      COVER_TAG.lastIndex = 0;
      if (t.length >= 2) return { q: `${artist} ${t}`.trim(), artist: artist.trim(), title: t, raw: line, from: "Z opisu filmu" };
    }
  }
  const tags = [...(hint || "").matchAll(/#([\p{L}\p{N}_]+)/gu)].map(m => m[1]).filter(t => !GENERIC_TAGS.test(t));
  const words = tags.slice(0, 2).map(t => t.replace(/_/g, " ").replace(/([a-ząćęłńóśźż])([A-ZĄĆĘŁŃÓŚŹŻ])/g, "$1 $2"));
  const q = words.join(" ").trim();
  return { q, artist: "", title: q, raw: words.join(", "), from: "Z hashtagów" };
}
function hintQuery(hint) { return parseHint(hint).q; }
function originalAuthor(title) {
  const m = title.match(/(?:użytkownika|original sound\s*-|oryginalny dźwięk\s*-|son original\s*-|sonido original\s*-)\s*(.+)$/i);
  return m ? m[1].replace(/[^\p{L}\p{N} _.-]/gu, "").trim() : "";
}

function tiktokTimeHtml(sec, video, est) {
  const check = `<button class="btn ghost small" id="tt-check">🔄 Dokładnie</button>`;
  if (sec > 0 && est) return `<span class="badge">⏱ Na TikToku</span><b>~${fmt(sec)}</b> <small class="muted">film</small> ${check}`;
  if (sec > 0) return `<span class="badge">⏱ Na TikToku</span><b>${fmt(sec)}</b> <small class="muted">cały dźwięk${video ? ` · film ${fmt(video)}` : ""}</small>`;
  if (grabForDetailsAt) return `<span class="badge">⏱ Na TikToku</span><small class="muted">⏳ sprawdzam…</small>`;
  return `<span class="badge">⏱ Na TikToku</span><small class="muted">mierzę… (puść film na 2–3 s)</small> <button class="btn ghost small" id="tt-check">🔄 Sprawdź</button>`;
}
window.updateTikTokTime = (sec, video, est) => {
  const el = $("#tt-len");
  if (!el) return;
  if (est && cardData) return;  // mamy już dokładne dane — nie nadpisuj przybliżeniem
  el.innerHTML = tiktokTimeHtml(sec, video, est);
  const b = $("#tt-check");
  if (b) b.onclick = () => grabDetails(cardKey);
};

/** Pobiera dane bieżącego filmu (link przez „Kopiuj link”) — czas od razu na karcie. */
function grabDetails(key) {
  if (key !== cardKey || cardData) return;
  grabForDetailsAt = Date.now();
  window.updateTikTokTime(0);
  if (!Android.grabTikTokLink()) { grabForDetailsAt = 0; window.updateTikTokTime(0); }
}
async function loadCardDetails(url) {
  const key = cardKey;
  try {
    const d = JSON.parse(await call("tiktok", url));
    if (key !== cardKey) return;  // w międzyczasie inny film
    cardData = d;
    const m = d.music || {};
    window.updateTikTokTime(m.duration || d.videoDuration || 0, m.duration ? d.videoDuration : 0);
  } catch (err) {
    if (key === cardKey) { const el = $("#tt-len"); if (el) el.innerHTML = `<span class="badge">⏱ Na TikToku</span><small class="err">${esc(err.message)}</small> <button class="btn ghost small" id="tt-check">🔄</button>`;
      const b = $("#tt-check"); if (b) b.onclick = () => grabDetails(cardKey); }
  }
}

window.handleNowPlaying = async (title, hint = "", dur = 0, est = false) => {
  npCalls++;
  cardKey = title + "|" + hint + "|" + Date.now();
  cardData = null;
  grabForDetailsAt = 0;
  const myKey = cardKey;
  // w okienku obok TikToka: po 1,5 s stabilnego filmu pobierz dane (czas) automatycznie
  if (src.autodetails2 && Android.watcherEnabled() && Android.isMultiWindow && Android.isMultiWindow())
    setTimeout(() => { if (myKey === cardKey && document.visibilityState === "visible" && $("#modal").hidden) grabDetails(myKey); }, 1500);
  showTab("link");
  resultsEl.innerHTML = ""; $("#free").innerHTML = "";
  const orig = /original sound|oryginalny dźwięk|dźwięk oryginalny|son original|sonido original/i.test(title);
  const ph = parseHint(hint);
  // napisy z TikToka mają pierwszeństwo (hashtagi tylko przy „oryginalnym dźwięku”)
  const useCap = !!ph.q && (orig || ph.from !== "Z hashtagów");
  const hq = useCap ? ph.q : "";
  const q = useCap ? ph.q : orig ? "" : title.replace(/\s+-\s+/g, " ");
  const parts0 = title.split(/\s+-\s+/);
  const headTitle = useCap ? (ph.title || ph.q) : orig ? "Nieznany utwór" : parts0[0];
  const headArtist = useCap ? (ph.artist || "") : orig ? "" : parts0.slice(1).join(" ");
  $("#video-box").innerHTML = `
    <div class="np">
      <div class="np-head"><span class="live-dot"></span>Teraz na TikToku</div>
      <div class="np-main"><div>
        <h2 class="np-title" id="np-title">${esc(headTitle)}</h2>
        <div class="np-artist" id="np-artist">${esc(headArtist)}</div>
      </div></div>
      <div class="np-sub">♬ ${esc(title)}${orig && !useCap ? " — brak tytułu piosenki" : ""}</div>
      <div class="facts-list">
        ${useCap ? `<div class="fact"><span class="badge">📝 ${esc(ph.from)}</span>${esc(ph.raw || ph.q)}</div>` : ""}
        <div class="fact" id="tt-len">${tiktokTimeHtml(dur, 0, est)}</div>
        <div class="fact" id="full-len"><span class="badge">⏱ Cała piosenka</span><small class="muted">sprawdzam…</small></div>
      </div>
      ${actionsHtml(q, `<button class="btn primary wide" id="np-dl">⬇️ Pobierz urywek</button>`)}
    </div>`;
  window.updateTikTokTime(dur, 0, est);
  $("#np-dl").onclick = () => {
    if (cardData) return openClipModal(null, cardData);  // dane już są — od razu
    grabForModalAt = Date.now();
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
    await updateFullUI(null, q);
    return maybeComments(myKey);
  }
  await searchAll(q, headArtist ? `${headArtist} – ${headTitle}` : headTitle);
  const parts = title.split(/\s+-\s+/);
  await updateFullUI(useCap ? { title: ph.title, artist: ph.artist } : { title: parts[0], artist: parts.slice(1).join(" ") }, q);
  maybeComments(myKey);
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
    `Pasek postępu filmu: ${sc.range || "-"}`,
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

// --- pociągnij w dół, aby odświeżyć
const ptr = document.createElement("div");
ptr.id = "ptr";
document.body.prepend(ptr);
let ptrStart = null, ptrPull = 0, refreshing = false;
const PTR_MAX = 90, PTR_TRIGGER = 60;
addEventListener("touchstart", (e) => {
  ptrStart = (scrollY <= 0 && $("#modal").hidden && !refreshing) ? e.touches[0].clientY : null;
}, { passive: true });
addEventListener("touchmove", (e) => {
  if (ptrStart == null) return;
  ptrPull = e.touches[0].clientY - ptrStart;
  if (ptrPull <= 0 || scrollY > 0) { ptr.style.height = "0"; return; }
  e.preventDefault();
  const h = Math.min(ptrPull * 0.5, PTR_MAX);
  ptr.style.transition = "none";
  ptr.style.height = h + "px";
  ptr.textContent = h >= PTR_TRIGGER ? "↻ Puść, aby odświeżyć" : "↓ Pociągnij, aby odświeżyć";
}, { passive: false });
addEventListener("touchend", () => {
  if (ptrStart == null) return;
  const h = Math.min(Math.max(ptrPull, 0) * 0.5, PTR_MAX);
  ptrStart = null; ptrPull = 0;
  ptr.style.transition = "";
  if (h >= PTR_TRIGGER) doRefresh(); else ptr.style.height = "0";
});
async function doRefresh() {
  refreshing = true;
  ptr.textContent = "⏳ Odświeżam…";
  ptr.style.height = "48px";
  try {
    refreshSetup();
    const before = npCalls;
    cardData = null;
    Android.refreshNowPlaying();          // ponownie: co gra na TikToku
    await new Promise(r => setTimeout(r, 800));
    if (npCalls === before && lastSearch) await searchAll(...lastSearch);  // albo powtórz ostatnie wyszukiwanie
  } catch (err) {
    setStatus("❌ " + err.message, true);
  } finally {
    setTimeout(() => { ptr.style.height = "0"; refreshing = false; }, 400);
  }
}

// --- ⚙️ ustawienia: rozwiń „Ustawienia i źródła” na dole
$("#btn-settings").onclick = () => {
  const d = $("#sources");
  d.open = true;
  d.scrollIntoView({ behavior: "smooth", block: "start" });
};

// --- komentarze → tytuł piosenki (PL, EN, ES, PT, DE, FR, IT)
const QUESTION_RE = /(jak[aą] to (jest )?piosenk|jak si[eę] nazywa|co to za (piosenk|utw[oó]r|nuta|kawa[lł]ek)|tytu[lł]\s*\?|nazwa\s*\?|what('?s| is) (the|this) song|song name\s*\?|name of (the|this) song|what song|¿?c[oó]mo se llama|nombre de la canci[oó]n\s*\?|qual (é|e) o nome|wie hei[sß]t|welches lied|quel(le)? est (le titre|la chanson)|come si chiama|anyone know)/i;
const KEYWORD_RE = /(?:^|\b)(?:piosenka|utw[oó]r|tytu[lł]|nazwa|nuta|kawa[lł]ek|song|track|title|canci[oó]n|tema|m[uú]sica|can[cç][aã]o|lied|titel|chanson|titre|morceau|canzone|titolo|brano)\s*(?:to|is|es|é|ist|est|è)?\s*[:：=\-–—]?\s+["„“”'«]?([^"„“”'»\n?]{2,70})/i;
const CALLED_RE = /(?:nazywa si[eę]|it'?s called|is called|se llama|chama-se|se chama|hei[sß]t|s'appelle|si chiama)\s*[:：]?\s*["„“”'«]?([^"„“”'»\n?]{2,70})/i;
const BY_RE = /^["„“”'«]?([^"„“”'»\n]{2,50}?)["„“”'»]?\s+(?:by|od|von|de|di|par)\s+([A-ZĄĆĘŁŃÓŚŹŻ0-9@][^\n,.!?]{1,40})$/;
const DASH_RE = /^(.{2,45}?)\s+[-–—]\s+(.{2,55})$/;
const QUOTE_RE = /["„“«]([^"„“”»\n]{2,60})["”»]/;
const NOTE_RE = /^[♬♫♪🎵🎶]\s*(.{2,70})$/u;
const JUNK_RE = /^(\d+([.,]\d+)?\s*(tys\.?|mln|k|m)?|odpowiedz|reply|responder|antworten|répondre|rispondi|zobacz \d+|view \d+|ver \d+|\d+\s*(min|godz|dni|h|d|w|tyg)\.?( temu)?|autor|creator|polubione przez|liked by)$/i;

function cleanTitle(t) {
  return stripEmoji(t || "").replace(/@\S+/g, " ").replace(/#\S+/g, " ")
    .replace(/\b(lol|xd|haha+|pls|plz)\b/gi, " ")
    .replace(/^(to jest|to|it'?s|it is|this is|that'?s|es|é|ist|c'est|è)\s+/i, "")
    .replace(/[!?.,;:]+$/g, "").replace(/\s+/g, " ").trim();
}

/** Zwraca propozycje [{title, artist, q, count}] posortowane od najczęstszej. Pary „A - B” bez ustalonej kolejności. */
function mineComments(texts) {
  const found = new Map();
  const ok = (x) => x.length >= 2 && x.length <= 70 && !/^\d+$/.test(x) && x.split(" ").length <= 9 && !QUESTION_RE.test(x);
  const put = (key, entry) => { const cur = found.get(key); if (cur) cur.count++; else found.set(key, { ...entry, count: 1 }); };
  const addOne = (t) => { t = cleanTitle(t); if (ok(t)) put(norm(t), { title: t, artist: "", single: true }); };
  const addPair = (a, b, ordered) => {   // ordered: a = tytuł, b = wykonawca („X by Y”)
    a = cleanTitle(a); b = cleanTitle(b);
    if (!ok(a) || !ok(b)) return addOne(a + " " + b);
    const key = [norm(a), norm(b)].sort().join("|");
    put(key, ordered ? { title: a, artist: b } : { title: b, artist: a });
  };
  const addVal = (v) => { const d = v.match(DASH_RE), b = v.match(BY_RE); if (d) addPair(d[1], d[2]); else if (b) addPair(b[1], b[2], true); else addOne(v); };

  for (const raw of texts || []) {
    const t = stripEmoji(String(raw)).replace(/\s+/g, " ").trim();
    if (t.length < 3 || t.length > 220 || JUNK_RE.test(t)) continue;
    let m;
    if ((m = String(raw).trim().match(NOTE_RE))) { addVal(m[1]); continue; }
    if (QUESTION_RE.test(t) || /\?\s*$/.test(t)) continue;   // pytanie bez odpowiedzi
    if ((m = t.match(CALLED_RE))) { addVal(m[1]); continue; }
    if ((m = t.match(KEYWORD_RE))) { addVal(m[1]); continue; }
    if ((m = t.match(DASH_RE)) && !/\d{1,2}:\d{2}/.test(t)) { addPair(m[1], m[2]); continue; }
    if ((m = t.match(BY_RE))) { addPair(m[1], m[2], true); continue; }
    if ((m = t.match(QUOTE_RE))) addOne(m[1]);
  }
  // pojedynczy tytuł, który występuje też w parze → dolicz do pary
  for (const [k, e] of [...found]) {
    if (!e.single) continue;
    for (const [k2, e2] of found) {
      if (e2.single || !k2.split("|").includes(k)) continue;
      e2.count += e.count; found.delete(k); break;
    }
  }
  return [...found.values()].map(e => ({ title: e.title, artist: e.artist, q: `${e.artist} ${e.title}`.trim(), count: e.count }))
    .sort((a, b) => b.count - a.count);
}

// --- szukanie tytułu w komentarzach, gdy nic nie znaleziono
let commentsFor = "";
function commentsFactHtml(state) {
  return `<span class="badge">💬 Komentarze</span>` + (state === "busy"
    ? `<small class="muted">⏳ czytam komentarze w TikToku…</small>`
    : `<small class="muted">${state || "ktoś mógł napisać tytuł"}</small> <button class="btn ghost small" id="cm-btn">💬 Szukaj w komentarzach</button>`);
}
function showCommentsFact(state) {
  let el = $("#cm-fact");
  if (!el) {
    const list = $("#video-box .facts-list");
    if (!list) return;
    list.insertAdjacentHTML("beforeend", `<div class="fact" id="cm-fact"></div>`);
    el = $("#cm-fact");
  }
  el.innerHTML = commentsFactHtml(state);
  const b = $("#cm-btn");
  if (b) b.onclick = () => startComments(cardKey);
}
function startComments(key) {
  if (key !== cardKey) return;
  commentsFor = key;
  showCommentsFact("busy");
  if (!Android.readComments || !Android.readComments()) {
    commentsFor = "";
    showCommentsFact("włącz usługę wykrywania w Ułatwieniach dostępu");
  }
}
/** Po nieudanym wyszukaniu: w okienku obok TikToka czytaj komentarze automatycznie, inaczej przycisk. */
function maybeComments(key) {
  if (key !== cardKey || verifiedBest(lastTarget) || !src.comments) return;
  showCommentsFact();
  if (Android.isMultiWindow && Android.isMultiWindow() && Android.watcherEnabled())
    setTimeout(() => { if (key === cardKey && document.visibilityState === "visible" && $("#modal").hidden) startComments(key); }, 1200);
}

window.handleComments = async (texts, opened) => {
  if (!commentsFor || commentsFor !== cardKey) return;
  commentsFor = "";
  if (!opened) return showCommentsFact("nie udało się otworzyć komentarzy");
  const cands = mineComments(texts).slice(0, 4);
  if (!cands.length) return showCommentsFact("nikt nie podał tytułu");
  showCommentsFact("busy");
  // sprawdź propozycje w katalogu — wybierz pierwszą potwierdzoną
  let pick = null, song = null;
  for (const c of cands.slice(0, 3)) {
    try {
      const r = await searchSongs(c.q);
      song = r.find(x => isSameSong(x, c) || isSameSong(x, { title: c.artist, artist: c.title }) || (!c.artist && isSameSong(x, { title: c.title })));
      if (song) { pick = c; break; }
    } catch {}
  }
  if (!pick) pick = cands[0];
  const people = pick.count === 1 ? "1 osoba" : pick.count < 5 ? `${pick.count} osoby` : `${pick.count} osób`;
  const t = song ? { title: song.title, artist: song.artist } : { title: pick.title, artist: pick.artist };
  $("#cm-fact").innerHTML = `<span class="badge">💬 Z komentarzy</span><b>${esc(t.artist ? t.artist + " – " + t.title : t.title)}</b> <small class="muted">(${people})</small>`;
  $("#np-title").textContent = t.title;
  $("#np-artist").textContent = t.artist || "";
  await searchAll(`${t.artist || ""} ${t.title}`.trim(), t.artist ? `${t.artist} – ${t.title}` : t.title);
  await updateFullUI(t, `${t.artist || ""} ${t.title}`.trim());
};
