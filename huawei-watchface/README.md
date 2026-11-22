# Tarcza zegarka Huawei – „GX”

Tarcza w stylu motywu GX z `styles.css` (czarne tło, zielony / niebieski / żółty neon).
Rozdzielczość **466 × 466 px** – Huawei Watch GT 2 / GT 3 / GT 4 (46 mm), Watch 3/4.

## Pliki
| Plik | Opis |
|---|---|
| `watchface.html` | Podgląd na żywo (otwórz w przeglądarce) |
| `png/bg.png` | Tło tarczy |
| `png/hour.png`, `png/minute.png`, `png/second.png` | Wskazówki (przezroczyste PNG, ustawione na 12:00) |
| `png/preview.png` | Obrazek podglądowy |
| `export.js` | Ponowne wygenerowanie PNG po zmianach: `node export.js` (wymaga Playwright) |

## Jak wgrać na zegarek
1. Pobierz **Huawei Theme Studio** (developer.huawei.com → Theme Studio) i utwórz nowy projekt *Watch Face* dla swojego modelu.
2. Jako tło ustaw `png/bg.png`.
3. Dodaj wskazówki godzinową, minutową i sekundową z plików PNG. **Środek obrotu: x = 233, y = 233** (obrazy mają pełny rozmiar 466×466).
4. W ramkach dodaj widżety: data (górna, zielona ramka) i godzina cyfrowa / kroki / bateria (dolna, niebieska ramka).
5. Zbuduj plik `.hwt` i zainstaluj na zegarku przez Theme Studio (tryb dewelopera) lub opublikuj w sklepie Huawei.
