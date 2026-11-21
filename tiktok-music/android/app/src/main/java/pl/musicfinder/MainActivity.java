package pl.musicfinder;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.drawable.Icon;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Music Finder — działa samodzielnie na telefonie, bez serwera.
 *
 * - Interfejs: lokalny HTML (assets/index.html) w WebView.
 * - Dane z TikToka: ukryta przeglądarka (drugi WebView) otwiera stronę filmu,
 *   sama przechodzi zabezpieczenia TikToka, a my odczytujemy dane o dźwięku.
 * - Pobieranie: dźwięk z TikToka trafia do Pobrane/Music Finder.
 * - Szukanie pełnej wersji: katalog iTunes (bez klucza API).
 */
public class MainActivity extends Activity {
    static final String DESKTOP_UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

    /** Wyciąga z otwartej strony TikToka dane filmu i dźwięku. Zwraca JSON albo null (jeszcze nie gotowe). */
    static final String EXTRACT_JS = "(function(){try{"
            + "var it=null;"
            + "var el=document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');"
            + "if(el){var d=(JSON.parse(el.textContent)||{})['__DEFAULT_SCOPE__']||{};var vd=d['webapp.video-detail'];"
            + " if(vd){if(vd.itemInfo&&vd.itemInfo.itemStruct)it=vd.itemInfo.itemStruct;"
            + "  else return JSON.stringify({status:vd.statusCode||-2,msg:vd.statusMsg||''});}}"
            + "if(!it){var s=document.getElementById('SIGI_STATE')||document.getElementById('sigi-persisted-data');"
            + " if(s){var j=JSON.parse(s.textContent);var im=j.ItemModule||{};var k=Object.keys(im)[0];if(k)it=im[k];"
            + "  if(it&&typeof it.music==='string')it.music=(j.MusicModule||{})[it.music]||{};"
            + "  if(it&&typeof it.author==='string')it.author={uniqueId:it.author};}}"
            + "if(!it){if(location.pathname.indexOf('/login')===0)return JSON.stringify({status:-3});return null;}"
            + "var m=it.music||{},v=it.video||{};var pa=v.playAddr;if(Array.isArray(pa))pa=(pa[0]||{}).src;"
            + "return JSON.stringify({status:0,id:it.id,desc:it.desc,author:(it.author||{}).uniqueId,"
            + " cover:v.cover||v.originCover,videoUrl:pa||v.downloadAddr||'',page:location.href,"
            + " music:{title:m.title,author:m.authorName,album:m.album,original:!!m.original,playUrl:m.playUrl||'',"
            + "  cover:m.coverLarge||m.coverMedium||m.coverThumb,duration:m.duration}});"
            + "}catch(e){return null;}})()";

    static final String SHORTCUT_ID = "find_song";
    static final Pattern TT_LINK = Pattern.compile("https?://\\S*tiktok\\.com/\\S+", Pattern.CASE_INSENSITIVE);

    private WebView ui;
    private WebView scraper;
    private final Handler main = new Handler(Looper.getMainLooper());
    private boolean uiReady = false;
    private String pendingShare = null;
    private long lastShareAt = 0;

    // stan bieżącego odczytu TikToka
    private int scrapeId = 0;
    private long scrapeDeadline = 0;
    private Runnable scrapePoll = null;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF0F0F14);

        CookieManager.getInstance().setAcceptCookie(true);

        // Ukryta przeglądarka do TikToka (1x1 px, przezroczysta, pod interfejsem)
        scraper = new WebView(this);
        WebSettings ss = scraper.getSettings();
        ss.setJavaScriptEnabled(true);
        ss.setDomStorageEnabled(true);
        ss.setUserAgentString(DESKTOP_UA);
        ss.setBlockNetworkImage(true);
        ss.setMediaPlaybackRequiresUserGesture(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(scraper, true);
        scraper.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                String s = r.getUrl().getScheme();
                return !("http".equals(s) || "https".equals(s)); // blokuj przekierowania do aplikacji TikTok
            }
        });
        scraper.setAlpha(0f);
        root.addView(scraper, new FrameLayout.LayoutParams(1, 1));

        // Interfejs aplikacji
        ui = new WebView(this);
        ui.setBackgroundColor(0xFF0F0F14);
        WebSettings us = ui.getSettings();
        us.setJavaScriptEnabled(true);
        us.setDomStorageEnabled(true);
        ui.addJavascriptInterface(new Bridge(), "Android");
        ui.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                if ("file".equals(r.getUrl().getScheme())) return false;
                openExternal(r.getUrl().toString());
                return true;
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                uiReady = true;
                if (pendingShare != null) { deliverShare(pendingShare); pendingShare = null; }
            }
        });
        root.addView(ui, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        ui.loadUrl("file:///android_asset/index.html");
        publishShareShortcut();
        handleIntent(getIntent());

        if (Build.VERSION.SDK_INT < 29
                && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, 1);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    /** TikTok → Udostępnij → Music Finder */
    private void handleIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (text == null) return;
        rememberLink(text);
        lastShareAt = System.currentTimeMillis();
        if (Build.VERSION.SDK_INT >= 25) {
            // każde użycie podnosi Music Finder wyżej w oknie „Udostępnij”
            try { getSystemService(ShortcutManager.class).reportShortcutUsed(SHORTCUT_ID); } catch (Exception ignored) { }
        }
        if (uiReady) deliverShare(text); else pendingShare = text;
    }

    /** Skrót „Znajdź piosenkę” w górnym rzędzie systemowego okna udostępniania. */
    private void publishShareShortcut() {
        if (Build.VERSION.SDK_INT < 30) return;
        try {
            ShortcutManager sm = getSystemService(ShortcutManager.class);
            Intent i = new Intent(Intent.ACTION_MAIN, null, this, MainActivity.class);
            ShortcutInfo si = new ShortcutInfo.Builder(this, SHORTCUT_ID)
                    .setShortLabel("Znajdź piosenkę")
                    .setLongLabel("Music Finder — znajdź piosenkę")
                    .setIcon(Icon.createWithResource(this, R.mipmap.ic_launcher))
                    .setCategories(Collections.singleton("pl.musicfinder.category.SHARE_TARGET"))
                    .setIntent(i)
                    .setLongLived(true)
                    .setRank(0)
                    .build();
            sm.pushDynamicShortcut(si);
        } catch (Exception ignored) { }
    }

    // ------------------------------------------------------------------ automatyczny link ze schowka

    private static String extractLink(String text) {
        if (text == null) return null;
        Matcher m = TT_LINK.matcher(text);
        return m.find() ? m.group() : null;
    }

    private void rememberLink(String text) {
        String link = extractLink(text);
        if (link != null) getSharedPreferences("mf", MODE_PRIVATE).edit().putString("last", link).apply();
    }

    /** TikTok → „Kopiuj link” → otwierasz Music Finder → szuka sam. */
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (!hasFocus || System.currentTimeMillis() - lastShareAt < 5000) return;
        main.postDelayed(() -> {
            try {
                ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                ClipData clip = cm == null ? null : cm.getPrimaryClip();
                if (clip == null || clip.getItemCount() == 0) return;
                CharSequence t = clip.getItemAt(0).coerceToText(this);
                String link = extractLink(t == null ? null : t.toString());
                if (link == null) return;
                String last = getSharedPreferences("mf", MODE_PRIVATE).getString("last", "");
                if (link.equals(last)) return;  // ten link już był
                rememberLink(link);
                if (uiReady) deliverShare(link); else pendingShare = link;
            } catch (Exception ignored) { }
        }, 300);
    }

    private void deliverShare(String text) {
        ui.evaluateJavascript("window.handleShared(" + JSONObject.quote(text) + ")", null);
    }

    private void reply(int id, boolean ok, String text) {
        main.post(() -> ui.evaluateJavascript(
                "window.__cb(" + id + "," + ok + "," + JSONObject.quote(text == null ? "" : text) + ")", null));
    }

    private void openExternal(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (Exception ignored) { }
    }

    // ------------------------------------------------------------------ TikTok

    private void startScrape(int id, String url) {
        if (scrapePoll != null) {  // anuluj poprzedni odczyt
            main.removeCallbacks(scrapePoll);
            reply(scrapeId, false, "Anulowano");
        }
        scrapeId = id;
        scrapeDeadline = System.currentTimeMillis() + 30_000;
        scraper.stopLoading();
        scraper.loadUrl(url);
        scrapePoll = new Runnable() {
            @Override
            public void run() {
                scraper.evaluateJavascript(EXTRACT_JS, res -> {
                    if (scrapePoll != this) return;
                    String json = decodeJsResult(res);
                    if (json != null) {
                        finishScrape();
                        try {
                            JSONObject o = new JSONObject(json);
                            int st = o.optInt("status", -1);
                            if (st == 0) reply(id, true, json);
                            else if (st == -3) reply(id, false, "TikTok wymaga zalogowania, żeby zobaczyć ten film.");
                            else reply(id, false, "Film niedostępny (prywatny, usunięty lub z ograniczeniem wieku). Kod: " + st);
                        } catch (Exception e) {
                            reply(id, false, "Nie udało się odczytać danych filmu.");
                        }
                    } else if (System.currentTimeMillis() > scrapeDeadline) {
                        finishScrape();
                        reply(id, false, "TikTok nie odpowiedział. Sprawdź internet i spróbuj ponownie.");
                    } else {
                        main.postDelayed(this, 700);
                    }
                });
            }
        };
        main.postDelayed(scrapePoll, 1500);
    }

    private void finishScrape() {
        if (scrapePoll != null) main.removeCallbacks(scrapePoll);
        scrapePoll = null;
        scraper.stopLoading();
        scraper.loadUrl("about:blank");
        CookieManager.getInstance().flush();
    }

    /** evaluateJavascript zwraca wynik zakodowany jako JSON (np. "\"{...}\"" albo "null"). */
    private static String decodeJsResult(String res) {
        if (res == null || res.equals("null")) return null;
        try {
            Object v = new JSONTokener(res).nextValue();
            return v instanceof String ? (String) v : null;
        } catch (Exception e) {
            return null;
        }
    }

    // ------------------------------------------------------------------ HTTP

    private static HttpURLConnection open(String url, String referer) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(15_000);
        c.setReadTimeout(30_000);
        c.setInstanceFollowRedirects(true);
        c.setRequestProperty("User-Agent", DESKTOP_UA);
        if (referer != null) c.setRequestProperty("Referer", referer);
        String cookies = CookieManager.getInstance().getCookie(url);
        if (cookies != null && !cookies.isEmpty()) c.setRequestProperty("Cookie", cookies);
        return c;
    }

    private static String readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toString(StandardCharsets.UTF_8.name());
    }

    /** Pobiera plik do cache. Zwraca {plik, content-type}. */
    private File fetchToFile(String url, String name) throws IOException {
        HttpURLConnection c = open(url, "https://www.tiktok.com/");
        int code = c.getResponseCode();
        if (code >= 400) throw new IOException("HTTP " + code);
        File f = new File(getCacheDir(), name);
        try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(f)) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        } finally {
            c.disconnect();
        }
        if (f.length() < 1024) throw new IOException("Pusty plik");
        return f;
    }

    // ------------------------------------------------------------------ pobieranie

    private String doDownload(String audioUrl, String videoUrl, String baseName) throws Exception {
        File out = null;
        String ext = "m4a", mime = "audio/mp4";

        // 1) gotowy plik dźwięku TikToka (zwykle MP3)
        if (audioUrl != null && !audioUrl.isEmpty()) {
            try {
                File f = fetchToFile(audioUrl, "sound.bin");
                if (isMp3(f)) { ext = "mp3"; mime = "audio/mpeg"; }
                else { File m4a = new File(getCacheDir(), "sound.m4a"); extractAudio(f, m4a); f.delete(); f = m4a; }
                out = f;
            } catch (Exception e) {
                out = null;
            }
        }
        // 2) wideo → wycięcie ścieżki dźwiękowej (bez ponownego kodowania)
        if (out == null && videoUrl != null && !videoUrl.isEmpty()) {
            File video = fetchToFile(videoUrl, "video.mp4");
            File m4a = new File(getCacheDir(), "sound.m4a");
            extractAudio(video, m4a);
            video.delete();
            out = m4a;
            ext = "m4a"; mime = "audio/mp4";
        }
        if (out == null) throw new IOException("Brak pliku dźwięku do pobrania");

        String fileName = baseName + "." + ext;
        JSONObject info = mediaInfo(out, ext);
        saveToDownloads(out, fileName, mime);
        out.delete();
        info.put("path", "Pobrane/Music Finder/" + fileName);
        return info.toString();
    }

    /** Odczytuje parametry pliku audio: format, kodek, bitrate, częstotliwość, kanały, długość, rozmiar. */
    private static JSONObject mediaInfo(File f, String ext) {
        JSONObject o = new JSONObject();
        try {
            o.put("format", ext.toUpperCase());
            o.put("size", f.length());
            MediaExtractor ex = new MediaExtractor();
            try {
                ex.setDataSource(f.getAbsolutePath());
                for (int i = 0; i < ex.getTrackCount(); i++) {
                    MediaFormat mf = ex.getTrackFormat(i);
                    String mime = mf.getString(MediaFormat.KEY_MIME);
                    if (mime == null || !mime.startsWith("audio/")) continue;
                    o.put("codec", codecName(mime));
                    if (mf.containsKey(MediaFormat.KEY_SAMPLE_RATE)) o.put("sampleRate", mf.getInteger(MediaFormat.KEY_SAMPLE_RATE));
                    if (mf.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) o.put("channels", mf.getInteger(MediaFormat.KEY_CHANNEL_COUNT));
                    long durUs = mf.containsKey(MediaFormat.KEY_DURATION) ? mf.getLong(MediaFormat.KEY_DURATION) : 0;
                    if (durUs > 0) o.put("duration", durUs / 1_000_000.0);
                    int br = mf.containsKey(MediaFormat.KEY_BIT_RATE) ? mf.getInteger(MediaFormat.KEY_BIT_RATE) : 0;
                    if (br <= 0 && durUs > 0) br = (int) (f.length() * 8 * 1_000_000L / durUs);  // średni bitrate
                    if (br > 0) o.put("kbps", Math.round(br / 1000.0));
                    break;
                }
            } finally {
                ex.release();
            }
        } catch (Exception ignored) { }
        return o;
    }

    private static String codecName(String mime) {
        switch (mime) {
            case "audio/mpeg": return "MP3";
            case "audio/mp4a-latm": return "AAC";
            case "audio/opus": return "Opus";
            case "audio/vorbis": return "Vorbis";
            case "audio/flac": return "FLAC";
            default: return mime.replace("audio/", "").toUpperCase();
        }
    }

    private static boolean isMp3(File f) throws IOException {
        byte[] h = new byte[3];
        try (InputStream in = new FileInputStream(f)) {
            if (in.read(h) < 3) return false;
        }
        return (h[0] == 'I' && h[1] == 'D' && h[2] == '3') || ((h[0] & 0xFF) == 0xFF && (h[1] & 0xE0) == 0xE0);
    }

    /** Kopiuje ścieżkę audio z pliku MP4 do osobnego pliku M4A. */
    private static void extractAudio(File src, File dst) throws IOException {
        MediaExtractor ex = new MediaExtractor();
        MediaMuxer mux = null;
        try {
            ex.setDataSource(src.getAbsolutePath());
            int track = -1;
            for (int i = 0; i < ex.getTrackCount(); i++) {
                String mime = ex.getTrackFormat(i).getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("audio/")) { track = i; break; }
            }
            if (track < 0) throw new IOException("Film nie ma ścieżki dźwiękowej");
            ex.selectTrack(track);
            MediaFormat fmt = ex.getTrackFormat(track);
            mux = new MediaMuxer(dst.getAbsolutePath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
            int t = mux.addTrack(fmt);
            mux.start();
            ByteBuffer buf = ByteBuffer.allocate(1 << 20);
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            while (true) {
                int n = ex.readSampleData(buf, 0);
                if (n < 0) break;
                info.offset = 0;
                info.size = n;
                info.presentationTimeUs = ex.getSampleTime();
                info.flags = (ex.getSampleFlags() & MediaExtractor.SAMPLE_FLAG_SYNC) != 0 ? MediaCodec.BUFFER_FLAG_KEY_FRAME : 0;
                mux.writeSampleData(t, buf, info);
                ex.advance();
            }
            mux.stop();
        } finally {
            if (mux != null) try { mux.release(); } catch (Exception ignored) { }
            ex.release();
        }
    }

    private void saveToDownloads(File src, String name, String mime) throws IOException {
        if (Build.VERSION.SDK_INT >= 29) {
            ContentResolver cr = getContentResolver();
            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Music Finder");
            Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            if (uri == null) throw new IOException("Nie można utworzyć pliku");
            try (InputStream in = new FileInputStream(src); OutputStream out = cr.openOutputStream(uri)) {
                copy(in, out);
            }
        } else {
            File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Music Finder");
            if (!dir.exists() && !dir.mkdirs()) throw new IOException("Brak dostępu do folderu Pobrane");
            File dst = new File(dir, name);
            try (InputStream in = new FileInputStream(src); OutputStream out = new FileOutputStream(dst)) {
                copy(in, out);
            }
            MediaScannerConnection.scanFile(this, new String[]{dst.getAbsolutePath()}, new String[]{mime}, null);
        }
    }

    private static void copy(InputStream in, OutputStream out) throws IOException {
        if (out == null) throw new IOException("Brak dostępu do pliku");
        byte[] buf = new byte[65536];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
    }

    // ------------------------------------------------------------------ most JS ↔ Java

    class Bridge {
        @JavascriptInterface
        public void tiktok(int id, String url) {
            main.post(() -> startScrape(id, url));
        }

        @JavascriptInterface
        public void httpGet(int id, String url) {
            new Thread(() -> {
                try {
                    HttpURLConnection c = open(url, null);
                    int code = c.getResponseCode();
                    if (code >= 400) throw new IOException("HTTP " + code);
                    String body;
                    try (InputStream in = c.getInputStream()) { body = readAll(in); }
                    reply(id, true, body);
                } catch (Exception e) {
                    reply(id, false, "Brak połączenia z internetem (" + e.getMessage() + ")");
                }
            }).start();
        }

        @JavascriptInterface
        public void download(int id, String audioUrl, String videoUrl, String baseName) {
            new Thread(() -> {
                try {
                    reply(id, true, doDownload(audioUrl, videoUrl, baseName));
                } catch (Exception e) {
                    reply(id, false, "Pobieranie nie powiodło się: " + e.getMessage());
                }
            }).start();
        }

        @JavascriptInterface
        public String clipboard() {
            ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
            ClipData clip = cm == null ? null : cm.getPrimaryClip();
            if (clip == null || clip.getItemCount() == 0) return "";
            CharSequence t = clip.getItemAt(0).coerceToText(MainActivity.this);
            return t == null ? "" : t.toString();
        }

        @JavascriptInterface
        public void openUrl(String url) {
            main.post(() -> openExternal(url));
        }

        @JavascriptInterface
        public void recognize() {
            main.post(() -> {
                Intent shazam = getPackageManager().getLaunchIntentForPackage("com.shazam.android");
                Intent[] tries = {
                        shazam,
                        new Intent("com.google.android.googlequicksearchbox.MUSIC_SEARCH"),
                        new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=com.shazam.android")),
                        new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=com.shazam.android")),
                };
                for (Intent i : tries) {
                    if (i == null) continue;
                    try { startActivity(i); return; } catch (Exception ignored) { }
                }
            });
        }
    }

    @Override
    public void onBackPressed() {
        if (ui.canGoBack()) ui.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (scrapePoll != null) main.removeCallbacks(scrapePoll);
        scraper.destroy();
        ui.destroy();
        super.onDestroy();
    }
}
