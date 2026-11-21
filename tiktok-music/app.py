"""TikTok Music Finder — znajdź pełną piosenkę z urywka na TikToku.

Uruchom:  python app.py   →  http://127.0.0.1:5000
"""
import asyncio
import json
import os
import re
import shutil
import tempfile
import urllib.parse
import urllib.request

from flask import Flask, jsonify, render_template, request, send_file, after_this_request
import yt_dlp

try:
    from shazamio import Shazam
except ImportError:  # rozpoznawanie dźwięku jest opcjonalne
    Shazam = None

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024  # max 25 MB nagrania

TIKTOK_RE = re.compile(r"^https?://([a-z0-9-]+\.)*tiktok\.com/", re.I)
HAS_FFMPEG = shutil.which("ffmpeg") is not None


# ---------------------------------------------------------------- helpers
def http_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode("utf-8"))


def store_links(artist, title):
    q = urllib.parse.quote_plus(f"{artist} {title}".strip())
    return {
        "spotify": f"https://open.spotify.com/search/{urllib.parse.quote(f'{artist} {title}'.strip())}",
        "youtube_music": f"https://music.youtube.com/search?q={q}",
        "youtube": f"https://www.youtube.com/results?search_query={q}",
        "deezer": f"https://www.deezer.com/search/{urllib.parse.quote(f'{artist} {title}'.strip())}",
        "tidal": f"https://listen.tidal.com/search?q={q}",
    }


def search_songs(term, limit=12):
    """Wyszukuje pełne utwory w katalogu iTunes (darmowe, bez klucza API)."""
    if not term.strip():
        return []
    url = "https://itunes.apple.com/search?" + urllib.parse.urlencode(
        {"term": term, "entity": "song", "limit": limit, "country": "PL"}
    )
    data = http_json(url)
    out = []
    for r in data.get("results", []):
        artist, title = r.get("artistName", ""), r.get("trackName", "")
        art = r.get("artworkUrl100", "")
        out.append({
            "title": title,
            "artist": artist,
            "album": r.get("collectionName"),
            "cover": art.replace("100x100", "300x300") if art else None,
            "preview": r.get("previewUrl"),
            "duration": (r.get("trackTimeMillis") or 0) // 1000,
            "year": (r.get("releaseDate") or "")[:4],
            "links": {"apple_music": r.get("trackViewUrl"), **store_links(artist, title)},
        })
    return out


def is_original_sound(name):
    n = (name or "").lower()
    return not n or "original sound" in n or "oryginalny dźwięk" in n or "son original" in n


def recognize_file(path):
    if Shazam is None:
        raise RuntimeError("Brak biblioteki shazamio — zainstaluj: pip install shazamio")

    async def run():
        return await Shazam().recognize(path)

    res = asyncio.run(run())
    track = res.get("track")
    if not track:
        return None
    cover = (track.get("images") or {}).get("coverarthq") or (track.get("images") or {}).get("coverart")
    return {"title": track.get("title"), "artist": track.get("subtitle"), "cover": cover,
            "shazam_url": track.get("url")}


def download_tiktok_audio(url, workdir):
    """Pobiera ścieżkę dźwiękową z filmu TikTok. Zwraca ścieżkę pliku."""
    opts = {
        "format": "bestaudio/best",
        "outtmpl": os.path.join(workdir, "%(id)s.%(ext)s"),
        "quiet": True,
        "noplaylist": True,
    }
    if HAS_FFMPEG:
        opts["postprocessors"] = [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}]
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
    files = [os.path.join(workdir, f) for f in os.listdir(workdir)]
    if not files:
        raise RuntimeError("Nie udało się pobrać dźwięku.")
    return max(files, key=os.path.getsize), info


def safe_name(s):
    return re.sub(r'[\\/:*?"<>|]+', "", s or "").strip()[:80] or "tiktok-audio"


def check_url(url):
    if not TIKTOK_RE.match(url or ""):
        raise ValueError("To nie wygląda na link do TikToka.")


# ---------------------------------------------------------------- routes
@app.get("/")
def index():
    return render_template("index.html", has_shazam=Shazam is not None, has_ffmpeg=HAS_FFMPEG)


@app.post("/api/tiktok")
def api_tiktok():
    """Analizuje link TikTok: odczytuje nazwę dźwięku i szuka pełnej piosenki."""
    url = (request.json or {}).get("url", "").strip()
    try:
        check_url(url)
        with yt_dlp.YoutubeDL({"quiet": True, "noplaylist": True}) as ydl:
            info = ydl.extract_info(url, download=False)
    except ValueError as e:
        return jsonify(error=str(e)), 400
    except Exception as e:
        return jsonify(error=f"Nie udało się odczytać filmu: {e}"), 502

    track = info.get("track") or ""
    artist = ", ".join(info.get("artists") or []) or info.get("artist") or ""
    original = is_original_sound(track)

    recognized = None
    if original and Shazam is not None:
        # dźwięk "oryginalny" — spróbuj rozpoznać piosenkę po samym audio
        with tempfile.TemporaryDirectory() as tmp:
            try:
                path, _ = download_tiktok_audio(url, tmp)
                recognized = recognize_file(path)
            except Exception:
                recognized = None

    if recognized:
        query = f"{recognized['artist']} {recognized['title']}"
    elif not original:
        query = f"{artist} {track}"
    else:
        query = ""

    try:
        results = search_songs(query) if query else []
    except Exception:
        results = []

    return jsonify(
        video={
            "title": info.get("title") or info.get("description"),
            "uploader": info.get("uploader"),
            "thumbnail": info.get("thumbnail"),
            "url": info.get("webpage_url") or url,
        },
        sound={"track": track, "artist": artist, "original": original},
        recognized=recognized,
        query=query,
        results=results,
    )


@app.get("/api/download")
def api_download():
    """Pobiera dźwięk z filmu TikTok (urywek) jako MP3."""
    url = request.args.get("url", "").strip()
    try:
        check_url(url)
    except ValueError as e:
        return jsonify(error=str(e)), 400
    tmp = tempfile.mkdtemp()
    try:
        path, info = download_tiktok_audio(url, tmp)
    except Exception as e:
        shutil.rmtree(tmp, ignore_errors=True)
        return jsonify(error=f"Pobieranie nie powiodło się: {e}"), 502

    @after_this_request
    def cleanup(resp):
        resp.call_on_close(lambda: shutil.rmtree(tmp, ignore_errors=True))
        return resp

    name = safe_name(info.get("track") or info.get("title")) + os.path.splitext(path)[1]
    return send_file(path, as_attachment=True, download_name=name)


@app.get("/api/search")
def api_search():
    q = request.args.get("q", "")
    try:
        return jsonify(results=search_songs(q))
    except Exception as e:
        return jsonify(error=f"Wyszukiwanie nie powiodło się: {e}"), 502


@app.post("/api/recognize")
def api_recognize():
    """Rozpoznaje piosenkę z nagrania (mikrofon / wgrany plik)."""
    f = request.files.get("audio")
    if not f:
        return jsonify(error="Brak pliku audio."), 400
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "clip" + (os.path.splitext(f.filename or "")[1] or ".webm"))
        f.save(path)
        try:
            rec = recognize_file(path)
        except Exception as e:
            return jsonify(error=f"Rozpoznawanie nie powiodło się: {e}"), 502
    if not rec:
        return jsonify(recognized=None, results=[])
    try:
        results = search_songs(f"{rec['artist']} {rec['title']}")
    except Exception:
        results = []
    return jsonify(recognized=rec, results=results)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"\n  🎵  TikTok Music Finder działa →  http://127.0.0.1:{port}\n")
    app.run(host="127.0.0.1", port=port, debug=False)
