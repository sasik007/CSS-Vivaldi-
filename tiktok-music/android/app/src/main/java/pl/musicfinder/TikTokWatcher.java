package pl.musicfinder;

import android.accessibilityservice.AccessibilityService;
import android.content.SharedPreferences;
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

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        long now = System.currentTimeMillis();
        if (now - lastScan < 700) return;
        lastScan = now;

        best = null;
        bestScore = 0;
        nodeCount = 0;
        seen.clear();
        int windows = 0;

        // 1) wszystkie okna (okienko, podzielony ekran) — szukamy tych należących do TikToka
        try {
            for (AccessibilityWindowInfo w : getWindows()) {
                AccessibilityNodeInfo r = w.getRoot();
                if (r != null && isTikTok(r.getPackageName())) { windows++; scan(r, 0); }
            }
        } catch (Exception ignored) { }
        // 2) awaryjnie: aktywne okno
        if (windows == 0) {
            try {
                AccessibilityNodeInfo r = getRootInActiveWindow();
                if (r != null && isTikTok(r.getPackageName())) { windows++; scan(r, 0); }
            } catch (Exception ignored) { }
        }
        if (windows == 0) return;

        SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
        SharedPreferences.Editor e = p.edit();
        // diagnostyka: co widać na ekranie TikToka
        JSONArray dbg = new JSONArray();
        for (String s : seen) dbg.put(s);
        e.putString(KEY_DBG, "{\"windows\":" + windows + ",\"nodes\":" + nodeCount + ",\"texts\":" + dbg + "}");
        e.putLong(KEY_DBG_TIME, now);
        if (best != null) {
            String title = clean(best);
            if (!title.isEmpty()) e.putString(KEY_TITLE, title).putLong(KEY_TIME, now);
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
            consider(n.getText());
            consider(n.getContentDescription());
        }
        for (int i = 0; i < n.getChildCount(); i++) {
            AccessibilityNodeInfo c = n.getChild(i);
            if (c != null) scan(c, depth + 1);
        }
    }

    private void consider(CharSequence cs) {
        if (cs == null) return;
        String s = cs.toString().trim();
        if (s.isEmpty() || s.length() > 300) return;
        if (seen.size() < 60 && !seen.contains(s)) seen.add(s.length() > 120 ? s.substring(0, 120) + "…" : s);
        int score = 0;
        String val = s;
        Matcher m = LABEL.matcher(s);
        if (m.find()) { score = 3; val = m.group(1); }
        else if (startsWithNote(s)) { score = 2; }
        else if (ORIGINAL.matcher(s).find() && s.length() < 120) { score = 1; }
        if (score > bestScore) { bestScore = score; best = val; }
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
