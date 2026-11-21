# 🎵 TikTok Music Finder

Usłyszałeś fajny urywek na TikToku? Ta aplikacja znajdzie **całą piosenkę**.

## Co potrafi

| Zakładka | Co robi |
|---|---|
| 🔗 **Link TikTok** | Wklejasz link do filmu → aplikacja odczytuje nazwę dźwięku, a jeśli to „oryginalny dźwięk”, rozpoznaje utwór po samym audio (jak Shazam). Pokazuje pełną wersję z odsłuchem 30 s i linkami do Spotify / Apple Music / YouTube Music / Deezer / Tidal. Przycisk **⬇️ Pobierz** zapisuje dźwięk z filmu jako MP3. |
| 🎙️ **Nagraj urywek** | Puszczasz urywek przy mikrofonie (albo wgrywasz plik audio/wideo) → rozpoznanie piosenki. |
| 🔍 **Szukaj** | Wpisujesz tytuł, wykonawcę lub fragment → lista pasujących utworów. |

## Uruchomienie

Wymagany **Python 3.10+** (https://python.org) i najlepiej **ffmpeg** (do zapisu MP3).

- **Windows:** dwuklik `start.bat`
- **macOS / Linux:** `./start.sh`

Albo ręcznie:

```bash
pip install -r requirements.txt
python app.py
```

Potem otwórz http://127.0.0.1:5000

> ffmpeg: Windows `winget install ffmpeg`, macOS `brew install ffmpeg`, Linux `sudo apt install ffmpeg`.

## Uwagi

- Gdy TikTok zmieni coś po swojej stronie i linki przestaną działać, zaktualizuj yt-dlp: `pip install -U yt-dlp`.
- Rozpoznawanie dźwięku korzysta z nieoficjalnej biblioteki `shazamio` — jeśli przestanie działać, reszta aplikacji działa dalej.
- Pełne utwory są chronione prawem autorskim, więc aplikacja kieruje do legalnych serwisów (Spotify, Apple Music itd.), gdzie można ich słuchać lub je kupić. Dźwięk z TikToka pobieraj tylko na własny użytek.
