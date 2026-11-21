package pl.musicfinder;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.text.InputType;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.Toast;

/**
 * Music Finder — aplikacja na Androida.
 * Wyświetla serwer Music Finder w WebView, przyjmuje linki udostępnione z TikToka,
 * obsługuje mikrofon (rozpoznawanie), wybór pliku i pobieranie MP3.
 */
public class MainActivity extends Activity {
    private static final String PREFS = "mf";
    private static final String KEY_SERVER = "server";
    private static final int REQ_MIC = 1;
    private static final int REQ_FILE = 2;

    private WebView web;
    private PermissionRequest pendingPermission;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        web.setBackgroundColor(0xFF0F0F14);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if ("app".equals(u.getScheme())) { askServer(null); return true; }
                String server = getServer();
                if (server != null && u.toString().startsWith(server)) return false;
                // linki do Spotify / YouTube / Apple Music → otwórz w ich aplikacji
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) {
                    view.loadData(offlinePage(), "text/html; charset=utf-8", "UTF-8");
                }
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(request.getResources());
                } else {
                    pendingPermission = request;
                    requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
                }
            }

            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });

        web.setDownloadListener((url, userAgent, contentDisposition, mimeType, length) -> {
            String name = URLUtil.guessFileName(url, contentDisposition, "audio/mpeg");
            if (contentDisposition != null && contentDisposition.contains("filename*=UTF-8''")) {
                name = Uri.decode(contentDisposition.substring(contentDisposition.indexOf("''") + 2).replace("\"", ""));
            }
            DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
            r.addRequestHeader("User-Agent", userAgent);
            String cookies = CookieManager.getInstance().getCookie(url);
            if (cookies != null) r.addRequestHeader("Cookie", cookies);
            r.setTitle(name);
            r.setDescription("Music Finder");
            r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(r);
            Toast.makeText(this, "Pobieram do folderu Pobrane… (może potrwać kilka sekund)", Toast.LENGTH_LONG).show();
        });

        if (getServer() == null) askServer(getIntent());
        else handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        String server = getServer();
        if (server == null) { askServer(intent); return; }
        if (intent != null && Intent.ACTION_SEND.equals(intent.getAction())) {
            String text = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (text == null) text = "";
            web.loadUrl(server + "/share?text=" + Uri.encode(text));
        } else if (web.getUrl() == null || web.getUrl().startsWith("data:")) {
            web.loadUrl(server + "/");
        }
    }

    private String getServer() {
        SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
        String s = p.getString(KEY_SERVER, null);
        if ((s == null || s.isEmpty()) && !BuildConfig.DEFAULT_SERVER.isEmpty()) s = BuildConfig.DEFAULT_SERVER;
        if (s == null || s.isEmpty()) return null;
        return s.replaceAll("/+$", "");
    }

    private void askServer(Intent after) {
        EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setHint("https://music-finder-xxxx.onrender.com");
        String cur = getServer();
        if (cur != null) input.setText(cur);
        int pad = (int) (20 * getResources().getDisplayMetrics().density);
        input.setPadding(pad, pad, pad, pad);

        new AlertDialog.Builder(this)
                .setTitle("Adres serwera")
                .setMessage("Wpisz adres swojego serwera Music Finder (z Render.com albo komputera w domu, np. http://192.168.1.10:5000).")
                .setView(input)
                .setCancelable(false)
                .setPositiveButton("Zapisz", (d, w) -> {
                    String v = input.getText().toString().trim();
                    if (!v.isEmpty() && !v.startsWith("http")) v = "https://" + v;
                    if (v.isEmpty()) { askServer(after); return; }
                    getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_SERVER, v).apply();
                    web.loadUrl("about:blank");
                    if (after != null && Intent.ACTION_SEND.equals(after.getAction())) handleIntent(after);
                    else web.loadUrl(getServer() + "/");
                })
                .show();
    }

    private String offlinePage() {
        return "<html><body style='background:#0f0f14;color:#eee;font-family:sans-serif;padding:24px'>"
                + "<h2>Brak połączenia z serwerem</h2>"
                + "<p>Serwer: " + getServer() + "</p>"
                + "<p>Darmowy serwer na Render.com „zasypia” — pierwsze uruchomienie może trwać do minuty. "
                + "Sprawdź internet i spróbuj ponownie.</p>"
                + "<p><a style='color:#f0506e' href='" + getServer() + "/'>↻ Spróbuj ponownie</a></p>"
                + "<p><a style='color:#a77bff' href='app://server'>⚙ Zmień adres serwera</a></p>"
                + "</body></html>";
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (code == REQ_MIC && pendingPermission != null) {
            if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
                pendingPermission.grant(pendingPermission.getResources());
            } else {
                pendingPermission.deny();
            }
            pendingPermission = null;
        }
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        if (code == REQ_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            fileCallback = null;
            return;
        }
        super.onActivityResult(code, result, data);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}
