const $ = (s) => document.querySelector(s);
const statusEl = $("#status"), resultsEl = $("#results");

function setStatus(msg, err = false) { statusEl.textContent = msg; statusEl.className = err ? "err" : ""; }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function fmt(sec) { return sec ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}` : ""; }

// --- zakładki
document.querySelectorAll(".tab").forEach(t => t.onclick = () => {
  document.querySelectorAll(".tab, .panel").forEach(e => e.classList.remove("active"));
  t.classList.add("active");
  $("#tab-" + t.dataset.tab).classList.add("active");
});

const LINK_NAMES = { apple_music: "Apple Music", spotify: "Spotify", youtube_music: "YT Music",
  youtube: "YouTube", deezer: "Deezer", tidal: "Tidal" };

function renderResults(list) {
  resultsEl.innerHTML = "";
  list.forEach((s, i) => {
    const links = Object.entries(s.links || {}).filter(([, u]) => u)
      .map(([k, u]) => `<a class="btn ghost small" href="${esc(u)}" target="_blank" rel="noopener">${LINK_NAMES[k] || k}</a>`).join("");
    resultsEl.insertAdjacentHTML("beforeend", `
      <article class="song ${i === 0 ? "best" : ""}">
        <div class="top">
          ${s.cover ? `<img src="${esc(s.cover)}" alt="">` : ""}
          <div><h3>${esc(s.title)}</h3>
            <div class="meta">${esc(s.artist)}<br>${esc(s.album || "")} ${s.year ? "· " + esc(s.year) : ""} ${s.duration ? "· " + fmt(s.duration) : ""}</div>
          </div>
        </div>
        ${s.preview ? `<audio controls preload="none" src="${esc(s.preview)}"></audio>` : ""}
        <div class="links">${links}</div>
      </article>`);
  });
}

async function api(url, opts) {
  const r = await fetch(url, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Błąd ${r.status}`);
  return data;
}

// --- link TikTok
$("#form-link").onsubmit = async (e) => {
  e.preventDefault();
  const url = $("#tt-url").value.trim(), btn = $("#form-link button[type=submit]");
  btn.disabled = true; resultsEl.innerHTML = ""; $("#video-box").innerHTML = "";
  setStatus("⏳ Analizuję film i szukam piosenki…");
  try {
    const d = await api("/api/tiktok", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
    const snd = d.sound;
    $("#video-box").innerHTML = `
      <div class="video">
        ${d.video.thumbnail ? `<img src="${esc(d.video.thumbnail)}" alt="" referrerpolicy="no-referrer">` : ""}
        <div class="info">
          <p><b>${esc(d.video.uploader || "")}</b> — ${esc((d.video.title || "").slice(0, 140))}</p>
          <p><span class="badge">Dźwięk</span>${esc(snd.track || "?")} ${snd.artist ? "· " + esc(snd.artist) : ""}</p>
          ${d.recognized ? `<p><span class="badge">Rozpoznano</span><b>${esc(d.recognized.artist)} — ${esc(d.recognized.title)}</b></p>` : ""}
          <p><a class="btn" href="/api/download?url=${encodeURIComponent(url)}">⬇️ Pobierz dźwięk z TikToka (MP3)</a></p>
        </div>
      </div>`;
    if (d.results.length) {
      setStatus(`✅ Pełna wersja: znaleziono ${d.results.length} wyników dla „${d.query}”`);
      renderResults(d.results);
    } else if (snd.original) {
      setStatus("To „oryginalny dźwięk” i nie udało się go rozpoznać. Spróbuj zakładki 🎙️ albo 🔍 z fragmentem tekstu.", true);
    } else {
      setStatus("Nie znaleziono pełnej wersji. Spróbuj wyszukać ręcznie w zakładce 🔍.", true);
      $("#q").value = `${snd.artist} ${snd.track}`.trim();
    }
  } catch (err) { setStatus("❌ " + err.message, true); }
  btn.disabled = false;
};

// --- wyszukiwanie
$("#form-search").onsubmit = async (e) => {
  e.preventDefault();
  setStatus("⏳ Szukam…"); resultsEl.innerHTML = "";
  try {
    const d = await api("/api/search?q=" + encodeURIComponent($("#q").value));
    setStatus(d.results.length ? `Znaleziono ${d.results.length} utworów` : "Nic nie znaleziono 😕", !d.results.length);
    renderResults(d.results);
  } catch (err) { setStatus("❌ " + err.message, true); }
};

// --- rozpoznawanie (mikrofon / plik)
async function recognize(blob, name) {
  setStatus("⏳ Rozpoznaję piosenkę…"); resultsEl.innerHTML = "";
  const fd = new FormData(); fd.append("audio", blob, name);
  try {
    const d = await api("/api/recognize", { method: "POST", body: fd });
    if (!d.recognized) return setStatus("Nie rozpoznano utworu — spróbuj nagrać głośniej lub dłużej.", true);
    setStatus(`✅ To: ${d.recognized.artist} — ${d.recognized.title}`);
    renderResults(d.results.length ? d.results : [{ ...d.recognized, links: { shazam: d.recognized.shazam_url } }]);
  } catch (err) { setStatus("❌ " + err.message, true); }
}

const recBtn = $("#btn-rec");
if (recBtn) recBtn.onclick = async () => {
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { return setStatus("❌ Brak dostępu do mikrofonu.", true); }
  const rec = new MediaRecorder(stream), chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  rec.onstop = () => {
    stream.getTracks().forEach(t => t.stop());
    recBtn.classList.remove("recording"); recBtn.disabled = false; recBtn.textContent = "🎙️ Nagrywaj i rozpoznaj";
    recognize(new Blob(chunks, { type: rec.mimeType }), "mic.webm");
  };
  rec.start(); recBtn.classList.add("recording"); recBtn.disabled = true;
  let left = 10;
  recBtn.textContent = `🔴 Słucham… ${left}s`;
  const t = setInterval(() => {
    left--; recBtn.textContent = `🔴 Słucham… ${left}s`;
    if (left <= 0) { clearInterval(t); rec.stop(); }
  }, 1000);
};

const fileIn = $("#file-in");
if (fileIn) fileIn.onchange = () => fileIn.files[0] && recognize(fileIn.files[0], fileIn.files[0].name);

// --- wklejanie ze schowka (telefon)
$("#btn-paste").onclick = async () => {
  try {
    const t = await navigator.clipboard.readText();
    const m = t.match(/https?:\/\/\S*tiktok\.com\/\S+/i);
    $("#tt-url").value = m ? m[0] : t.trim();
    if (m) $("#form-link").requestSubmit();
  } catch { $("#tt-url").focus(); }
};

// --- instalowalna aplikacja (PWA)
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
