# 🎵 Music Finder — aplikacja na telefon (Android)

Usłyszałeś fajny urywek na TikToku? W TikToku kliknij **Udostępnij → Music Finder**,
a aplikacja znajdzie **całą piosenkę**.

## Co potrafi

- **Udostępnianie z TikToka:** w TikToku wybierasz **Udostępnij → Music Finder** (albo kopiujesz link i klikasz 📋 Wklej). Aplikacja odczytuje nazwę dźwięku. Gdy to tylko „oryginalny dźwięk”, rozpoznaje utwór po audio, tak jak Shazam. Pokazuje pełną wersję z odsłuchem 30 s i przyciskami do Spotify / YouTube Music / Apple Music / Deezer / Tidal.
- **⬇️ Pobierz:** zapisuje dźwięk z filmu jako MP3 w folderze *Pobrane*.
- **🎙️ Nagraj urywek:** rozpoznawanie przez mikrofon telefonu albo z pliku.
- **🔍 Szukaj:** po tytule, wykonawcy lub fragmencie.

## Jak to działa

Aplikacja ma dwie części:

1. **Serwer** (folder `tiktok-music/`): odczytuje dźwięk z TikToka i go rozpoznaje. Telefon sam tego nie zrobi, bo TikTok blokuje takie zapytania z aplikacji.
2. **Aplikacja na telefon:** plik **APK** albo instalacja ze strony przez Chrome.

## Krok 1 — serwer za darmo na Render.com (raz, ok. 5 minut)

1. Załóż darmowe konto na https://render.com (najprościej „Sign in with GitHub”).
2. **New → Web Service** → wybierz repozytorium `CSS-Vivaldi-`.
3. Ustaw:
   - **Branch:** gałąź z aplikacją (np. `claude/tiktok-music-downloader-1wh7on` albo `main` po scaleniu)
   - **Root Directory:** `tiktok-music`
   - **Runtime / Language:** `Docker`
   - **Instance type:** `Free`
4. Kliknij **Deploy**. Po kilku minutach dostaniesz adres, np. `https://music-finder-xxxx.onrender.com`.

> Darmowy serwer zasypia po 15 minutach bez użycia. Pierwsze otwarcie po przerwie trwa około 30–60 sekund.

## Krok 2 — aplikacja na telefon

**Opcja A — APK (zalecane):**
1. Na telefonie otwórz stronę repozytorium na GitHubie → **Releases** → pobierz **MusicFinder.apk**.
2. Zainstaluj (zezwól przeglądarce na „instalowanie nieznanych aplikacji”).
3. Przy pierwszym uruchomieniu wpisz adres serwera z kroku 1.

Możesz też zbudować APK z już wpisanym adresem: GitHub → **Actions → Build Music Finder APK → Run workflow** i wpisz adres serwera.

**Opcja B — bez APK:** otwórz adres serwera w **Chrome** na telefonie → menu ⋮ → **Zainstaluj aplikację**. Ta wersja też pojawi się w menu „Udostępnij” w TikToku.

## Bez hostingu — komputer w domu

```bash
pip install -r requirements.txt
HOST=0.0.0.0 python app.py          # Windows (PowerShell): $env:HOST="0.0.0.0"; python app.py
```

W aplikacji wpisz adres komputera w sieci Wi-Fi, np. `http://192.168.1.10:5000`. Działa tylko w tej samej sieci i gdy komputer jest włączony.

## Uwagi

- Gdy TikTok coś zmieni i linki przestaną działać, zrób na Renderze **Manual Deploy → Clear build cache & deploy**. To zainstaluje najnowszy yt-dlp.
- Rozpoznawanie dźwięku korzysta z nieoficjalnej biblioteki `shazamio`. Gdy przestanie działać, reszta aplikacji działa dalej.
- Pełne utwory są chronione prawem autorskim, więc aplikacja kieruje do legalnych serwisów, gdzie można ich słuchać lub je kupić. Dźwięk z TikToka pobieraj tylko na własny użytek.
