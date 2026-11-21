package pl.musicfinder;

import android.accessibilityservice.AccessibilityService;
import android.content.SharedPreferences;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Usługa ułatwień dostępu działająca TYLKO w aplikacji TikTok (patrz res/xml/tiktok_watcher.xml).
 * Odczytuje z ekranu nazwę dźwięku bieżącego filmu (pasek „♫ …”) i zapamiętuje ją lokalnie,
 * żeby Music Finder mógł ją pokazać po otwarciu. Nic nie jest nigdzie wysyłane.
 */
public class TikTokWatcher extends AccessibilityService {
    static final String PREFS = "mf";
    static final String KEY_TITLE = "np_title";
    static final String KEY_TIME = "np_time";

    private static final Pattern LABEL = Pattern.compile(
            "^(?:sound|dźwięk|music|muzyka|audio|utwór|song)\\s*[:：]\\s*(.+)$",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
    private static final Pattern ORIGINAL = Pattern.compile(
            "original sound|oryginalny dźwięk|dźwięk oryginalny|son original|sonido original",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);

    private long lastScan = 0;

    // najlepszy kandydat z bieżącego skanu: 3 = etykieta „Dźwięk: …”, 2 = „♫ …”, 1 = „original sound …”
    private String best;
    private int bestScore;

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        long now = System.currentTimeMillis();
        if (now - lastScan < 800) return;
        lastScan = now;
        AccessibilityNodeInfo root;
        try { root = getRootInActiveWindow(); } catch (Exception e) { return; }
        if (root == null) return;
        best = null;
        bestScore = 0;
        scan(root, 0);
        if (best == null) return;
        String title = clean(best);
        if (title.isEmpty()) return;
        SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (!title.equals(p.getString(KEY_TITLE, "")) || now - p.getLong(KEY_TIME, 0) > 30_000) {
            p.edit().putString(KEY_TITLE, title).putLong(KEY_TIME, now).apply();
        }
    }

    private void scan(AccessibilityNodeInfo n, int depth) {
        if (n == null || depth > 45 || bestScore == 3) return;
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
        if (s.isEmpty() || s.length() > 200) return;
        int score = 0;
        String val = s;
        Matcher m = LABEL.matcher(s);
        if (m.find()) { score = 3; val = m.group(1); }
        else if (s.startsWith("♫") || s.startsWith("♪") || s.startsWith("🎵")) { score = 2; }
        else if (ORIGINAL.matcher(s).find()) { score = 1; }
        if (score > bestScore) { bestScore = score; best = val; }
    }

    /** Usuwa symbole nut i powtórzenia z przewijanego paska (marquee). */
    static String clean(String s) {
        s = s.replaceAll("^[♫♪🎵\\s]+", "").trim();
        String[] parts = s.split("\\s{3,}");
        s = parts[0].trim();
        if (s.length() > 120) s = s.substring(0, 120);
        return s;
    }

    @Override
    public void onInterrupt() { }
}
