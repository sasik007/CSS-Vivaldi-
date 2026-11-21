# 🎵 Music Finder — aplikacja na Androida

Usłyszałeś fajny urywek na TikToku? W TikToku kliknij **Udostępnij → Music Finder**,
a aplikacja znajdzie **całą piosenkę**. Działa sama na telefonie, **bez serwera i bez komputera**.

## Instalacja

1. Na telefonie otwórz **Releases** tego repozytorium na GitHubie: https://github.com/sasik007/CSS-Vivaldi-/releases
2. W najnowszej wersji rozwiń **Assets** → pobierz **MusicFinder.apk**.
3. Otwórz plik i zainstaluj. Android zapyta o zgodę na „instalowanie nieznanych aplikacji”, więc zezwól przeglądarce.

## Co potrafi

- **Udostępnianie z TikToka:** wybierasz Udostępnij → Music Finder (albo Kopiuj link i 📋 Wklej w aplikacji). Aplikacja odczytuje, jaki dźwięk jest w filmie, i od razu szuka pełnej wersji. Dostajesz 30-sekundowy odsłuch i przyciski do **Spotify, YouTube Music, YouTube, Apple Music i Deezer**.
- **⬇️ Pobierz dźwięk:** zapisuje dźwięk z filmu w folderze **Pobrane/Music Finder**.
- **🔍 Szukaj:** po tytule lub wykonawcy.
- **🎙️ Rozpoznaj:** dla „oryginalnych dźwięków” bez nazwy otwiera Shazam albo wyszukiwanie piosenek Google.

## Jak to działa w środku

- Aplikacja otwiera stronę filmu w ukrytej przeglądarce wewnątrz siebie i odczytuje z niej dane dźwięku. Dzięki temu nie potrzebuje żadnego serwera.
- Pełne wersje utworów wyszukuje w publicznym katalogu iTunes.
- Kod: `android/` (Java + interfejs HTML w `android/app/src/main/assets`).
- APK buduje się automatycznie przez GitHub Actions (`.github/workflows/android-apk.yml`) po każdej zmianie w `android/`.

## Uwagi

- Gdy TikTok zmieni wygląd swojej strony, odczyt może przestać działać i trzeba będzie zaktualizować aplikację.
- Pełne utwory są chronione prawem autorskim, więc aplikacja kieruje do legalnych serwisów. Dźwięk z TikToka pobieraj tylko na własny użytek.
- To wersja instalowana spoza Sklepu Play. Przy aktualizacji może być konieczne odinstalowanie poprzedniej wersji.
