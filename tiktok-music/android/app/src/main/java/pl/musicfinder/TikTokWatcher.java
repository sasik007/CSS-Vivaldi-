package pl.musicfinder;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.graphics.Rect;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;

import org.json.JSONArray;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Usługa ułatwień dostępu działająca TYLKO w aplikacji TikTok (patrz res/xml/tiktok_watcher.xml).
 * Odczytuje z ekranu nazwę dźwięku bieżącego filmu (pasek „♬ …”) i zapamiętuje ją lokalnie,
 * żeby Music Finder mógł ją pokazać. Nic nie jest nigdzie wysyłane.
 * Działa też w trybie okienka / podzielonego ekranu (szuka okna TikToka wśród wszystkich okien).
 */
public class TikTokWatcher extends AccessibilityService {
    static final String PREFS = "mf";
    static final String KEY_TITLE = "np_title";
    static final String KEY_TIME = "np_time";
    /** Hashtagi / opis bieżącego filmu — podpowiedź tytułu przy „oryginalnym dźwięku”. */
    static final String KEY_HINT = "np_hint";
    /** Długość bieżącego filmu w TikToku (s), z paska postępu; 0 = nieznana. */
    static final String KEY_DUR = "np_dur";
    /** true = czas wyliczony z tempa paska postępu (przybliżony). */
    static final String KEY_DUR_EST = "np_dur_est";
    private static final Pattern TIME_PAIR = Pattern.compile("(\\d{1,2}):(\\d{2})\\s*/\\s*(\\d{1,2}):(\\d{2})");
    static final String KEY_DBG = "dbg_json";
    static final String KEY_DBG_TIME = "dbg_time";

    private static final String[] TIKTOK = {"com.zhiliaoapp.musically", "com.ss.android.ugc.trill", "com.zhiliaoapp.musically.go"};

    private static final Pattern LABEL = Pattern.compile(
            "^(?:sound|dźwięk|music|muzyka|audio|utwór|song|original sound)\\s*[:：]\\s*(.+)$",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
    private static final Pattern ORIGINAL = Pattern.compile(
            "original sound|oryginalny dźwięk|dźwięk oryginalny|son original|sonido original|som original",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
    private static final String NOTES = "♬♫♪♩🎵🎶";

    private long lastScan = 0;

    // ---------------------------------------------------------- automatyczne „Udostępnij → Kopiuj link”
    private static TikTokWatcher instance;
    private static final Pattern SHARE_RE = Pattern.compile("^(udostępnij|share|podziel się)", Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
    private static final Pattern COPY_RE = Pattern.compile("^(kopiuj link|skopiuj link|copy link)", Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
    private final Handler h = new Handler(Looper.getMainLooper());
    private int grabStep = 0;

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        instance = this;
    }

    @Override
    public void onDestroy() {
        instance = null;
        h.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    /** Prosi usługę o skopiowanie linku do bieżącego filmu w TikToku. false = usługa wyłączona. */
    /** Czy właśnie trwa „Udostępnij → Kopiuj link”. */
    static boolean isGrabbing() {
        TikTokWatcher w = instance;
        return w != null && w.grabStep != 0;
    }

    static boolean requestCopyLink(boolean tiktokVisible) {
        TikTokWatcher w = instance;
        if (w == null) return false;
        if (w.grabStep != 0) return true;   // już kopiujemy — drugi raz nie
        w.h.post(() -> w.startGrab(tiktokVisible));
        return true;
    }


    private void startGrab(boolean tiktokVisible) {
        h.removeCallbacks(grabTick);
        grabStep = 1;
        grabDeadline = System.currentTimeMillis() + 8000;
        // TikTok widoczny obok (okienko) → od razu; inaczej chwila na przełączenie
        h.postDelayed(grabTick, tiktokVisible ? 50 : 700);
    }

    private final Runnable grabTick = new Runnable() {
        @Override
        public void run() {
            if (grabStep == 0) return;
            if (System.currentTimeMillis() > grabDeadline) { finishGrab(false); return; }
            if (grabStep == 1) {
                if (clickFirst(SHARE_RE)) { grabStep = 2; h.postDelayed(this, 250); }
                else h.postDelayed(this, 200);
            } else if (grabStep == 2) {
                if (clickFirst(COPY_RE)) { grabStep = 3; h.postDelayed(() -> finishGrab(true), 250); }
                else h.postDelayed(this, 150);
            }
        }
    };

    private void finishGrab(boolean ok) {
        if (!ok && grabStep == 2) performGlobalAction(GLOBAL_ACTION_BACK);  // zamknij otwarty panel udostępniania
        grabStep = 0;
        // Music Finder dostaje fokus (w okienku nic się nie przełącza), żeby odczytać skopiowany link
        Intent i = new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
                .putExtra(MainActivity.EXTRA_GRAB, ok);
        try { startActivity(i); } catch (Exception ignored) { }
    }

    /** Klika pierwszy widoczny element TikToka, którego tekst/opis pasuje do wzorca. */
    private boolean clickFirst(Pattern p) {
        try {
            for (AccessibilityWindowInfo w : getWindows()) {
                AccessibilityNodeInfo r = w.getRoot();
                if (r == null || !isTikTok(r.getPackageName())) continue;
                Rect wb = new Rect();
                w.getBoundsInScreen(wb);
                AccessibilityNodeInfo n = find(r, p, wb, 0);
                while (n != null && !n.isClickable()) n = n.getParent();
                if (n != null && n.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true;
            }
        } catch (Exception ignored) { }
        return false;
    }

    private AccessibilityNodeInfo find(AccessibilityNodeInfo n, Pattern p, Rect wb, int depth) {
        if (n == null || depth > 60) return null;
        if (n.isVisibleToUser()) {
            Rect b = new Rect();
            n.getBoundsInScreen(b);
            if (b.width() > 0 && wb.contains(b.centerX(), b.centerY())
                    && (matches(n.getText(), p) || matches(n.getContentDescription(), p))) return n;
        }
        for (int i = 0; i < n.getChildCount(); i++) {
            AccessibilityNodeInfo f = find(n.getChild(i), p, wb, depth + 1);
            if (f != null) return f;
        }
        return null;
    }

    private static boolean matches(CharSequence cs, Pattern p) {
        return cs != null && p.matcher(cs.toString().trim()).find();
    }
    private String best;
    private int bestScore;
    private int nodeCount;
    private final List<String> seen = new ArrayList<>();
    private final List<String> cands = new ArrayList<>();
    private String hint;
    private double durSec;       // najlepsza znaleziona długość filmu
    private int durWidth;        // szerokość paska, z którego ją wzięto
    private String rangeDbg;
    private float rangeCur, rangeMax;   // najszerszy pasek postępu w tym skanie
    // szacowanie długości filmu z tempa przesuwania się paska (między skanami)
    private String estTitle = "";
    private long estStartT = 0;
    private float estStartCur = 0, estLastCur = 0;
    private double estDur = 0;
    private final List<String> captions = new ArrayList<>();
    private static final Pattern UI_TEXT = Pattern.compile(
            "^(zobacz tłumaczenie|więcej|mniej|obserwuj|obserwowani|polub|udostępnij|dodaj komentarz|"
            + "dla ciebie|profil|see translation|more|follow|like|share|add comment|teraz live|live|"
            + "obejmuje multimedia|contains ai|osób opublikowało|people posted)",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
    private final Rect win = new Rect();
    private final Rect tmp = new Rect();

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        long now = System.currentTimeMillis();
        if (now - lastScan < 700) return;
        lastScan = now;

        best = null;
        bestScore = 0;
        nodeCount = 0;
        seen.clear();
        cands.clear();
        hint = null;
        captions.clear();
        durSec = 0;
        durWidth = 0;
        rangeDbg = null;
        rangeMax = 0;
        int windows = 0;

        // 1) wszystkie okna (okienko, podzielony ekran) — szukamy tych należących do TikToka
        try {
            for (AccessibilityWindowInfo w : getWindows()) {
                AccessibilityNodeInfo r = w.getRoot();
                if (r != null && isTikTok(r.getPackageName())) {
                    windows++;
                    w.getBoundsInScreen(win);
                    scan(r, 0);
                }
            }
        } catch (Exception ignored) { }
        // 2) awaryjnie: aktywne okno
        if (windows == 0) {
            try {
                AccessibilityNodeInfo r = getRootInActiveWindow();
                if (r != null && isTikTok(r.getPackageName())) {
                    windows++;
                    r.getBoundsInScreen(win);
                    scan(r, 0);
                }
            } catch (Exception ignored) { }
        }
        if (windows == 0) return;

        SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
        SharedPreferences.Editor e = p.edit();
        // diagnostyka: co widać na ekranie TikToka
        JSONArray dbg = new JSONArray();
        for (String s : seen) dbg.put(s);
        JSONArray cj = new JSONArray();
        for (String s : cands) cj.put(s);
        e.putString(KEY_DBG, "{\"windows\":" + windows + ",\"nodes\":" + nodeCount + ",\"texts\":" + dbg
                + ",\"candidates\":" + cj + ",\"range\":" + org.json.JSONObject.quote(rangeDbg == null ? "brak" : rangeDbg) + "}");
        e.putLong(KEY_DBG_TIME, now);
        if (best != null) {
            String title = clean(best);
            if (!title.isEmpty()) {
                e.putString(KEY_TITLE, title).putLong(KEY_TIME, now);
                // podpowiedzi: opis filmu (np. „DJ Jay feat. Eve – Move On”) + hashtagi
                StringBuilder hb = new StringBuilder();
                for (String c : captions) hb.append(c).append('\n');
                if (hint != null && !captions.contains(hint)) hb.append(hint);
                e.putString(KEY_HINT, hb.toString().trim());
                boolean est = false;
                if (durSec <= 0) {
                    durSec = estimate(title, now);
                    est = durSec > 0;
                }
                e.putLong(KEY_DUR, Math.round(durSec)).putBoolean(KEY_DUR_EST, est);
            }
        }
        e.apply();
    }

    /**
     * Długość filmu z tempa paska: pasek przesuwa się o Δcur w Δt sekund → długość = max·Δt/Δcur.
     * Po zapętleniu / przewinięciu (pasek się cofa) pomiar zaczyna się od nowa.
     */
    private double estimate(String title, long now) {
        if (!title.equals(estTitle)) { estTitle = title; estStartT = 0; estDur = 0; }
        if (rangeMax <= 0) return estDur;
        if (estStartT == 0 || rangeCur < estLastCur - rangeMax * 0.02f) {
            estStartT = now;
            estStartCur = rangeCur;
        } else {
            double dt = (now - estStartT) / 1000.0, dc = rangeCur - estStartCur;
            if (dt >= 2 && dc > 0) {
                double d = rangeMax * dt / dc;
                if (d >= 2 && d <= 3600) estDur = d;
            }
        }
        estLastCur = rangeCur;
        if (rangeDbg != null && estDur > 0) rangeDbg += String.format(java.util.Locale.US, " → ~%.1f s", estDur);
        return estDur;
    }

    /** Pasek postępu filmu (SeekBar/ProgressBar) albo napis „0:05 / 0:31”. */
    private void readDuration(AccessibilityNodeInfo n) {
        AccessibilityNodeInfo.RangeInfo r = n.getRangeInfo();
        if (r != null && r.getMax() > 0 && tmp.width() > durWidth) {
            // „max” paska nie jest długością (bywa stałe, np. 10) — liczymy tempo przesuwania się
            durWidth = tmp.width();
            rangeMax = r.getMax() - r.getMin();
            rangeCur = r.getCurrent() - r.getMin();
            rangeDbg = n.getClassName() + " " + r.getCurrent() + "/" + r.getMax() + " szer=" + tmp.width();
        }
        for (CharSequence cs : new CharSequence[]{n.getText(), n.getContentDescription()}) {
            if (cs == null) continue;
            Matcher m = TIME_PAIR.matcher(cs);
            if (m.find()) {
                durSec = Integer.parseInt(m.group(3)) * 60 + Integer.parseInt(m.group(4));
                durWidth = Integer.MAX_VALUE;
                rangeMax = 0;
                rangeDbg = "napis: " + m.group();
            }
        }
    }

    private static boolean isTikTok(CharSequence pkg) {
        if (pkg == null) return false;
        for (String t : TIKTOK) if (t.contentEquals(pkg)) return true;
        return false;
    }

    private void scan(AccessibilityNodeInfo n, int depth) {
        if (n == null || depth > 60) return;
        nodeCount++;
        if (n.isVisibleToUser()) {
            // tylko elementy w całości na ekranie, w oknie TikToka —
            // sąsiednie (wczytane z wyprzedzeniem) filmy leżą poza nim
            n.getBoundsInScreen(tmp);
            boolean onScreen = tmp.width() > 0 && tmp.height() > 0
                    && win.contains(tmp.centerX(), tmp.centerY());
            consider(n.getText(), onScreen);
            consider(n.getContentDescription(), onScreen);
            if (onScreen) readDuration(n);
        }
        for (int i = 0; i < n.getChildCount(); i++) {
            AccessibilityNodeInfo c = n.getChild(i);
            if (c != null) scan(c, depth + 1);
        }
    }

    private void consider(CharSequence cs, boolean onScreen) {
        if (cs == null) return;
        String s = cs.toString().trim();
        if (s.isEmpty() || s.length() > 300) return;
        // opis filmu z hashtagami (pierwszy widoczny na ekranie)
        if (onScreen && hint == null && s.indexOf('#') >= 0 && s.length() < 250) hint = s;
        // napisy w dolnej części filmu (opis, nazwa autora) — często zawierają „Wykonawca – Tytuł”
        if (onScreen && captions.size() < 8 && s.length() >= 6 && s.length() < 250
                && tmp.centerY() > win.top + win.height() * 0.55
                && !UI_TEXT.matcher(s).find() && !s.matches("[\\d\\s.,]+(tys\\.|mln|k|m)?")
                && !captions.contains(s)) captions.add(s);
        if (onScreen && seen.size() < 60 && !seen.contains(s)) seen.add(s.length() > 120 ? s.substring(0, 120) + "…" : s);
        int score = 0;
        String val = s;
        Matcher m = LABEL.matcher(s);
        if (m.find()) { score = 3; val = m.group(1); }
        else if (startsWithNote(s)) { score = 2; }
        else if (ORIGINAL.matcher(s).find() && s.length() < 120) { score = 1; }
        if (score > 0) captions.remove(s);
        if (score == 0) return;
        if (cands.size() < 12) cands.add((onScreen ? "✓ " : "✗ poza ekranem ") + "[" + score + "] " + s
                + " @" + tmp.top + "-" + tmp.bottom);
        if (onScreen && score > bestScore) { bestScore = score; best = val; }
    }

    private static boolean startsWithNote(String s) {
        int cp = s.codePointAt(0);
        return NOTES.indexOf(new String(Character.toChars(cp))) >= 0;
    }

    /** Usuwa symbole nut i powtórzenia z przewijanego paska (marquee). */
    static String clean(String s) {
        s = s.replaceAll("^[♬♫♪♩🎵🎶\\s]+", "").trim();
        String[] parts = s.split("\\s{3,}");
        s = parts[0].trim();
        if (s.length() > 120) s = s.substring(0, 120);
        return s;
    }

    @Override
    public void onInterrupt() { }
}
