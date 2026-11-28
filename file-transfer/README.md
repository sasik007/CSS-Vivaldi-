# Szybki Transfer

Aplikacja na **Androida** i **Windows** do szybkiego przerzucania plików i tekstu między telefonem a komputerem w tej samej sieci Wi‑Fi. Nie potrzebuje internetu, konta ani chmury: dane idą prosto z urządzenia na urządzenie.

## Instalacja

1. Wejdź w zakładkę **Releases** w tym repozytorium i otwórz wersję „Szybki Transfer (najnowsza wersja)”.
2. **Telefon:** pobierz `SzybkiTransfer.apk` i zainstaluj. Android poprosi o zgodę na instalację z nieznanego źródła.
3. **Komputer:** pobierz `SzybkiTransfer-Windows.zip`, rozpakuj go i uruchom `szybki_transfer.exe`.
   Przy pierwszym uruchomieniu Zapora Windows zapyta o dostęp. Zaznacz **Sieci prywatne** i kliknij „Zezwalaj”.

Paczki budują się same w GitHub Actions przy każdej zmianie w folderze `file-transfer/`.

## Jak używać

- Uruchom aplikację na obu urządzeniach. Po kilku sekundach każde z nich pojawi się na liście „Urządzenia w sieci” u drugiego.
- **Wyślij pliki:** zaznacz urządzenie i naciśnij „Wyślij pliki”. Na komputerze wystarczy też **przeciągnąć pliki lub folder na okno**.
- **Wyślij tekst lub link:** przycisk ze schowkiem. Pole wypełnia się zawartością schowka, a po drugiej stronie tekst trafia od razu do schowka.
- Odebrane pliki trafiają do **Pobrane/Szybki Transfer**. Kliknięcie pozycji na liście otwiera plik.

Jeśli urządzenia się nie widzą (niektóre routery blokują rozgłaszanie), kliknij ikonę 🔗 przy „Urządzenia w sieci” i wpisz adres IP drugiego urządzenia. Adres jest widoczny na dole jego ekranu.

## Bezpieczeństwo

Aplikacja przyjmuje pliki od każdego urządzenia w tej samej sieci, na którym też działa Szybki Transfer. W domowym Wi‑Fi to nie problem. W sieci publicznej (kawiarnia, hotel) wyłącz odbiór w menu ⋮ → „Odbieraj pliki”.

## Szczegóły techniczne

- Flutter, jeden kod na Androida i Windows.
- Wykrywanie: rozgłoszenia UDP na porcie 47821, a do tego bezpośrednia odpowiedź, więc wystarczy, że jedna strona odbierze broadcast.
- Przesyłanie: HTTP na porcie 47820, strumieniowo, więc działa też dla bardzo dużych plików.
- Testy: `flutter test` (prawdziwy przesył plików i wykrywanie między dwiema instancjami).
