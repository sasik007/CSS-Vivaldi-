package pl.musicfinder;

import android.accessibilityservice.AccessibilityService;
import android.content.SharedPreferences;
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
    private String best;
    private int bestScore;
    private int nodeCount;
    private final List<String> seen = new ArrayList<>();
    private final List<String> cands = new ArrayList<>();
    private String hint;
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
                + ",\"candidates\":" + cj + "}");
        e.putLong(KEY_DBG_TIME, now);
        if (best != null) {
            String title = clean(best);
            if (!title.isEmpty()) {
                e.putString(KEY_TITLE, title).putLong(KEY_TIME, now);
                e.putString(KEY_HINT, hint == null ? "" : hint);
            }
        }
        e.apply();
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
        if (onScreen && seen.size() < 60 && !seen.contains(s)) seen.add(s.length() > 120 ? s.substring(0, 120) + "…" : s);
        int score = 0;
        String val = s;
        Matcher m = LABEL.matcher(s);
        if (m.find()) { score = 3; val = m.group(1); }
        else if (startsWithNote(s)) { score = 2; }
        else if (ORIGINAL.matcher(s).find() && s.length() < 120) { score = 1; }
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
