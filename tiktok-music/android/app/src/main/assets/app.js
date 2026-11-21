// Music Finder — logika interfejsu. Sieć i pobieranie obsługuje Java (obiekt `Android`).
const $ = (s) => document.querySelector(s);
const statusEl = $("#status"), resultsEl = $("#results");
const TT_RE = /https?:\/\/[^\s]*tiktok\.com\/[^\s]+/i;

function setStatus(msg, err = false) { statusEl.textContent = msg; statusEl.className = err ? "err" : ""; }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function fmt(sec) { return sec ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}` : ""; }

// --- most do Javy: wywołania asynchroniczne
const pending = {};
let seq = 0;
window.__cb = (id, ok, text) => { const p = pending[id]; delete pending[id]; if (p) ok ? p.res(text) : p.rej(new Error(text)); };
function call(method, ...args) {
  return new Promise((res, rej) => { const id = ++seq; pending[id] = { res, rej }; Android[method](id, ...args); });
}

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
    apple: r.trackViewUrl,
  }));
}

function ytSearch(q) {
  return "https://www.youtube.com/results?search_query=" + encodeURIComponent(q.trim());
}
function ytButton(q, label = "▶ Szukaj całej piosenki w YouTube") {
  return `<button class="btn yt" data-open="${esc(ytSearch(q))}">${label}</button>`;
}

function storeLinks(s) {
  const q = `${s.artist} ${s.title}`.trim(), e = encodeURIComponent(q);
  return [
    ["▶ YouTube", ytSearch(q)],
    ["Spotify", `https://open.spotify.com/search/${e}`],
    ["YT Music", `https://music.youtube.com/search?q=${e}`],
    ["Apple Music", s.apple],
    ["Deezer", `https://www.deezer.com/search/${e}`],
  ].filter(([, u]) => u);
}

function renderResults(list) {
  resultsEl.innerHTML = "";
  list.forEach((s, i) => {
    const links = storeLinks(s).map(([n, u], j) =>
      `<button class="btn ${j === 0 ? "yt" : "ghost"} small" data-open="${esc(u)}">${n}</button>`).join("");
    resultsEl.insertAdjacentHTML("beforeend", `
      <article class="song ${i === 0 ? "best" : ""}">
        <div class="top">
          ${s.cover ? `<img src="${esc(s.cover)}" alt="">` : ""}
          <div><h3>${esc(s.title)}</h3>
            <div class="meta">${esc(s.artist)}<br>${esc(s.album || "")}${s.year ? " · " + esc(s.year) : ""}${s.duration ? " · " + fmt(s.duration) : ""}</div>
          </div>
        </div>
        ${s.preview ? `<audio controls preload="none" src="${esc(s.preview)}"></audio>` : ""}
        <div class="links">${links}</div>
      </article>`);
  });
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-open]");
  if (b) Android.openUrl(b.dataset.open);
});
document.addEventListener("play", (e) => {  // tylko jeden odsłuch naraz
  document.querySelectorAll("audio").forEach(a => a !== e.target && a.pause());
}, true);

// --- TikTok
let current = null;

function isOriginal(m) {
  const t = (m.title || "").toLowerCase();
  return !t || m.original || /original sound|oryginalny dźwięk|son original|sonido original/.test(t);
}

async function analyze(url) {
  showTab("link");
  $("#tt-url").value = url;
  $("#btn-find").disabled = true; resultsEl.innerHTML = ""; $("#video-box").innerHTML = "";
  setStatus("⏳ Otwieram film na TikToku…");
  try {
    const d = JSON.parse(await call("tiktok", url));
    current = d;
    const m = d.music || {}, orig = isOriginal(m);
    const canDl = !!(m.playUrl || d.videoUrl);
    // dla „oryginalnego dźwięku” szukamy po opisie filmu (często jest tam tytuł piosenki)
    const ytQuery = orig ? (d.desc || "").replace(/#\S+/g, "").trim() + " song" : `${m.author || ""} ${m.title}`;
    $("#video-box").innerHTML = `
      <div class="video">
        ${m.cover || d.cover ? `<img src="${esc(m.cover || d.cover)}" alt="">` : ""}
        <div class="info">
          <p><b>@${esc(d.author || "")}</b> — ${esc((d.desc || "").slice(0, 120))}</p>
          <p><span class="badge">Dźwięk</span>${esc(m.title || "?")}${m.author ? " · " + esc(m.author) : ""}</p>
          <p>${ytButton(ytQuery, orig ? "▶ Szukaj w YouTube" : undefined)}</p>
          ${canDl ? `<p><button class="btn ghost" id="btn-dl">⬇️ Pobierz urywek z TikToka</button></p>` : ""}
        </div>
      </div>`;
    if (canDl) $("#btn-dl").onclick = downloadCurrent;

    if (orig) {
      setStatus("To „oryginalny dźwięk” bez tytułu piosenki. Pobierz go albo rozpoznaj w zakładce 🎙️.", true);
      return;
    }
    const query = `${m.author || ""} ${m.title}`.trim();
    setStatus("⏳ Szukam pełnej wersji…");
    let res = await searchSongs(query);
    if (!res.length && m.author) res = await searchSongs(m.title);
    $("#q").value = query;
    if (res.length) { setStatus(`✅ Pełna wersja „${m.title}”:`); renderResults(res); }
    else setStatus("Nie znaleziono pełnej wersji w katalogu. Spróbuj 🔍 Szukaj z innym zapisem.", true);
  } catch (err) {
    setStatus("❌ " + err.message, true);
  } finally {
    $("#btn-find").disabled = false;
  }
}

async function downloadCurrent() {
  const d = current; if (!d) return;
  const m = d.music || {};
  const name = (isOriginal(m) ? `tiktok-${d.author || ""}-${d.id || ""}` : `${m.author ? m.author + " - " : ""}${m.title}`)
    .replace(/[\\/:*?"<>|]+/g, "").trim().slice(0, 80) || "tiktok";
  const btn = $("#btn-dl"); btn.disabled = true; btn.textContent = "⏳ Pobieram…";
  try {
    const msg = await call("download", m.playUrl || "", d.videoUrl || "", name);
    btn.textContent = "✅ " + msg;
  } catch (err) {
    btn.disabled = false; btn.textContent = "⬇️ Spróbuj pobrać ponownie";
    setStatus("❌ " + err.message, true);
  }
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
  setStatus("⏳ Szukam…"); resultsEl.innerHTML = "";
  try {
    const r = await searchSongs($("#q").value);
    setStatus(r.length ? `Znaleziono ${r.length} utworów` : "Nic nie znaleziono 😕", !r.length);
    renderResults(r);
  } catch (err) { setStatus("❌ " + err.message, true); }
};

$("#btn-yt").onclick = () => {
  const q = $("#q").value.trim();
  if (!q) return $("#q").focus();
  Android.openUrl(ytSearch(q));
};

$("#btn-rec").onclick = () => Android.recognize();
