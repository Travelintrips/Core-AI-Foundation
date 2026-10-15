package id.cst.openclawbridge;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.net.Uri;
import android.app.AlertDialog;
import android.os.Bundle;
import android.content.Context;
import android.provider.Settings;
import android.content.ComponentName;
import android.text.TextUtils;
import android.view.accessibility.AccessibilityManager;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.widget.CheckBox;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import android.text.InputType;
import java.net.URL;
import java.net.HttpURLConnection;
import java.io.OutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;
import java.util.UUID;

public class MainActivity extends Activity {
    private EditText prompt;
    private EditText result;
    private EditText taskId;
    private String eventId;
    private CheckBox autoSend;
    private CheckBox captureReply;
    private TextView autoSendStatus;
    private static final String DEV_INTAKE_URL = "https://dev-ai-task.cstlogistic.co.id/v1/android/result";
    private static final String DEV_TOKEN_URL = "https://dev-ai-task.cstlogistic.co.id/v1/android/token";
    private static final String DEV_PAIR_START_URL = "https://dev-ai-task.cstlogistic.co.id/v1/android/pair/start";
    private static final String DEV_PAIR_STATUS_URL = "https://dev-ai-task.cstlogistic.co.id/v1/android/pair/status";
    private static final String DEV_NEXT_JOB_URL = "https://dev-ai-task.cstlogistic.co.id/v1/android/jobs/next";
    private CheckBox autoSubmit;
    private boolean submissionInFlight = false;
    private boolean devOneTapLaunch = false;
    private volatile boolean pairingInFlight = false;
    private boolean foreground = false;
    private boolean fetchInFlight = false;
    private boolean foregroundAutoEnabled = false;
    private final android.os.Handler autoHandler = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable autoPoll = new Runnable() {
        @Override public void run() {
            if (!foreground || !foregroundAutoEnabled) return;
            if (!fetchInFlight) fetchJobForDevice(true);
            autoHandler.postDelayed(this, 20000);
        }
    };
    private EditText jobToken;
    private EditText deviceCredential;
    private TextView deliveryStatus;
    private TextView jobFetchStatus;
    private TextView actionReceiptStatus;
    private volatile boolean actionReceiptInFlight = false;
    private static final String ACTION_PREFS = "bridge-device-actions-dev";

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        eventId = state == null ? UUID.randomUUID().toString() : state.getString("eventId", UUID.randomUUID().toString());
        ScrollView scroll = new ScrollView(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (16 * getResources().getDisplayMetrics().density);
        root.setPadding(pad,pad,pad,pad);
        TextView heading = new TextView(this);
        heading.setText("OpenClaw Chat Bridge - DEV\nUser-confirmed ChatGPT handoff; no background scraping or callback credentials.");
        root.addView(heading);
        taskId = new EditText(this);
        taskId.setHint("AI Task job ID (UUID, opsional untuk prompt biasa)");
        taskId.setSingleLine(true);
        root.addView(taskId);
        Button fetchAssignedJob = new Button(this);
        fetchAssignedJob.setText("AMBIL JOB DEV OTOMATIS");
        fetchAssignedJob.setOnClickListener(v -> fetchJobForDevice(false));
        root.addView(fetchAssignedJob);
        jobFetchStatus = new TextView(this);
        jobFetchStatus.setText("Tekan tombol untuk mengambil job yang ditugaskan ke Z Fold4.");
        jobFetchStatus.setTextSize(16);
        root.addView(jobFetchStatus);
        Button confirmGithub = new Button(this);
        confirmGithub.setText("KONFIRMASI GITHUB SUDAH TERBUKA DI HP (DEV)");
        confirmGithub.setOnClickListener(v -> confirmGithubVisible());
        root.addView(confirmGithub);
        actionReceiptStatus = new TextView(this);
        actionReceiptStatus.setText("Setelah GitHub terlihat di browser HP, kembali ke Bridge dan konfirmasi. Ini bukti pengguna, bukan pemeriksaan layar otomatis.");
        root.addView(actionReceiptStatus);
        Button oneTapTest = new Button(this);
        oneTapTest.setText("UJI CHATGPT OTOMATIS DEV (SATU KETUKAN)");
        oneTapTest.setOnClickListener(v -> fetchJobForDevice(true));
        root.addView(oneTapTest);
        CheckBox autoPolling = new CheckBox(this);
        autoPolling.setText("AUTO JOB DEV saat Bridge terbuka (20 detik; boleh membuka ChatGPT)");
        autoPolling.setChecked(false);
        autoPolling.setOnCheckedChangeListener((button, checked) -> {
            foregroundAutoEnabled = checked;
            autoHandler.removeCallbacks(autoPoll);
            if (checked && foreground) autoHandler.post(autoPoll);
        });
        root.addView(autoPolling);
        prompt = new EditText(this);
        prompt.setHint("Prompt untuk ChatGPT");
        prompt.setMinLines(3);
        root.addView(prompt);
        autoSend = new CheckBox(this);
        autoSend.setText("Auto Kirim sekali (aktifkan Accessibility di Settings HP)");
        autoSend.setChecked(false);
        root.addView(autoSend);
        captureReply = new CheckBox(this);
        captureReply.setText("Ambil jawaban bertanda ke Bridge (eksperimen DEV)");
        captureReply.setChecked(false);
        root.addView(captureReply);
        autoSendStatus = new TextView(this);
        root.addView(autoSendStatus);
        Button diagnostic = new Button(this);
        diagnostic.setText("Periksa status Auto Kirim");
        diagnostic.setOnClickListener(v -> showAutoSendStatus());
        root.addView(diagnostic);
        Button launch = new Button(this);
        launch.setText("Buka ChatGPT / bagikan prompt");
        launch.setOnClickListener(v -> launchChatGPT());
        root.addView(launch);
        result = new EditText(this);
        result.setHint("Jawaban dari ChatGPT (Share atau tempel manual)");
        result.setMinLines(4);
        root.addView(result);
        TextView endpointInfo = new TextView(this);
        endpointInfo.setText("Endpoint DEV: " + DEV_INTAKE_URL);
        root.addView(endpointInfo);
        autoSubmit = new CheckBox(this);
        autoSubmit.setText("Setelah jawaban tertangkap, kirim hasil ke VPS DEV saat kembali ke Bridge");
        autoSubmit.setChecked(false);
        root.addView(autoSubmit);
        jobToken = new EditText(this);
        jobToken.setHint("Token singkat untuk job ini (dari admin)");
        jobToken.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        root.addView(jobToken);
        deviceCredential = new EditText(this);
        deviceCredential.setHint("Credential pairing perangkat (isi sekali, DEV)");
        deviceCredential.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        root.addView(deviceCredential);
        Button saveDevice = new Button(this);
        saveDevice.setText("Simpan pairing perangkat (DEV)");
        saveDevice.setOnClickListener(v -> {
            String value = deviceCredential.getText().toString().trim();
            if (value.length() < 32 || value.length() > 128) {
                deviceCredential.setError("Credential tidak valid"); return;
            }
            getSharedPreferences("bridge-pairing-dev", MODE_PRIVATE).edit().putString("credential",value).apply();
            deviceCredential.setText("");
            deliveryStatus.setText("Pairing tersimpan secara lokal. Token job akan diminta otomatis.");
        });
        root.addView(saveDevice);
        Button pairAutomatically = new Button(this);
        pairAutomatically.setText("Minta pairing satu ketukan (DEV)");
        pairAutomatically.setOnClickListener(v -> beginPairing());
        root.addView(pairAutomatically);
        Button deliver = new Button(this);
        deliver.setText("Kirim hasil ke intake DEV (belum ACK AI Core)");
        deliver.setOnClickListener(v -> deliverResult());
        root.addView(deliver);
        deliveryStatus = new TextView(this);
        deliveryStatus.setText("Belum ada hasil dikirim. Jangan isi token AI Core/OpenClaw utama.");
        root.addView(deliveryStatus);
        Button copy = new Button(this);
        copy.setText("Salin jawaban");
        copy.setOnClickListener(v -> copyResult());
        root.addView(copy);
        Button share = new Button(this);
        share.setText("Bagikan paket hasil job (manual)");
        share.setOnClickListener(v -> shareResult());
        root.addView(share);
        TextView warning = new TextView(this);
        warning.setText("Paket hasil bukan ACK dari AI Core. Pilih penerima tepercaya; jangan kirim data sensitif ke aplikasi lain.");
        root.addView(warning);
        scroll.addView(root);
        setContentView(scroll);
        consumeShare(getIntent());
        showAutoSendStatus();
    }

    @Override protected void onResume() {
        super.onResume();
        foreground = true;
        autoHandler.removeCallbacks(autoPoll);
        if (foregroundAutoEnabled) autoHandler.post(autoPoll);
        if (autoSendStatus != null) showAutoSendStatus();
        loadCapturedReply();
    }

    @Override protected void onPause() {
        foreground = false;
        autoHandler.removeCallbacks(autoPoll);
        super.onPause();
    }

    private void loadCapturedReply() {
        if (result == null) return;
        String captured = getSharedPreferences(ChatSendService.PREFS, MODE_PRIVATE)
                .getString(ChatSendService.CAPTURED_REPLY, "");
        if (!captured.isEmpty()) {
            result.setText(captured);
            getSharedPreferences(ChatSendService.PREFS, MODE_PRIVATE)
                .edit().remove(ChatSendService.CAPTURED_REPLY).apply();
            String delivery = getSharedPreferences(ChatSendService.PREFS, MODE_PRIVATE)
                    .getString(CapturedResultDelivery.STATUS, "");
            if (autoSubmit != null && autoSubmit.isChecked() && !delivery.startsWith("AUTO_DELIVERY_"))
                deliverResult();
        }
    }

    private void showAutoSendStatus() {
        if (autoSendStatus == null) return;
        boolean enabled = accessibilityEnabled();
        String message = getSharedPreferences(ChatSendService.PREFS, MODE_PRIVATE)
            .getString(ChatSendService.STATUS, "Belum ada uji Auto Kirim.");
        android.content.SharedPreferences statusPrefs = getSharedPreferences(ChatSendService.PREFS, MODE_PRIVATE);
        long sentAt = statusPrefs.getLong(ChatSendService.AUTO_SENT_AT, 0);
        long capturedAt = statusPrefs.getLong(ChatSendService.AUTO_CAPTURED_AT, 0);
        String evidence = "\nAUTO_SENT (klik Accessibility diterima): " + (sentAt > 0 ? new java.util.Date(sentAt).toString() : "BELUM") +
                "\nAUTO_CAPTURED (jawaban bertanda): " + (capturedAt > 0 ? new java.util.Date(capturedAt).toString() : "BELUM");
        String delivery = statusPrefs.getString(CapturedResultDelivery.STATUS, "");
        autoSendStatus.setText("Aksesibilitas: " + (enabled ? "AKTIF" : "TIDAK AKTIF") + "\n" + message + evidence +
                (delivery.isEmpty() ? "" : "\n" + delivery));
    }

    @Override protected void onSaveInstanceState(Bundle outState) {
        outState.putString("eventId", eventId);
        super.onSaveInstanceState(outState);
    }
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        consumeShare(intent);
    }
    private void consumeShare(Intent intent) {
        if (Intent.ACTION_SEND.equals(intent.getAction()) && "text/plain".equals(intent.getType())) {
            String text = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (text != null) result.setText(text);
        }
    }
    private void launchChatGPT() {
        String text = prompt.getText().toString().trim();
        if (text.isEmpty()) { Toast.makeText(this,"Masukkan prompt",Toast.LENGTH_SHORT).show(); return; }
        boolean armed = autoSend.isChecked();
        boolean capture = captureReply.isChecked();
        if (capture && !armed) {
            Toast.makeText(this, "Aktifkan Auto Kirim untuk mengambil jawaban bertanda.", Toast.LENGTH_LONG).show();
            return;
        }
        boolean directDelivery = devOneTapLaunch && armed && capture && autoSubmit.isChecked() &&
                taskId.getText().toString().trim().matches("[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}");
        devOneTapLaunch = false;
        eventId = UUID.randomUUID().toString(); // New logical request must never reuse result event identity.
        String nonce = capture ? UUID.randomUUID().toString().replace("-", "") : "";
        String transmitText = capture
                ? text + "\n\nBalas dalam satu paragraf teks biasa (maksimal 1800 karakter). " +
                    "Awali jawaban dengan awalan OCB: tepat disambung tanpa spasi " +
                    "dengan identitas " + nonce + ". " +
                    "Akhiri jawaban dengan penanda END-OCB. " +
                    "Jangan pakai Markdown atau code block." : text;
        if (armed && !accessibilityEnabled()) {
            Toast.makeText(this, "Aktifkan OpenClaw Chat Bridge di Accessibility, lalu tekan Buka ChatGPT lagi.", Toast.LENGTH_LONG).show();
            startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
            return;
        }
        getSharedPreferences(ChatSendService.PREFS, MODE_PRIVATE)
            .edit().remove("text").remove("at")
            .remove(ChatSendService.REPLY_MARKER).remove(ChatSendService.REPLY_STARTED)
            .remove(ChatSendService.CAPTURED_REPLY)
            .remove(ChatSendService.AUTO_SENT_AT).remove(ChatSendService.AUTO_CAPTURED_AT)
            .putBoolean(CapturedResultDelivery.ARMED, false)
            .remove(CapturedResultDelivery.STATUS).commit();
        if (directDelivery) {
            getSharedPreferences(ChatSendService.PREFS, MODE_PRIVATE).edit()
                .putString(CapturedResultDelivery.JOB_ID, taskId.getText().toString().trim())
                .putString(CapturedResultDelivery.EVENT_ID, eventId)
                .putBoolean(CapturedResultDelivery.ARMED, true).commit();
        }
        if (armed) {
            getSharedPreferences(ChatSendService.PREFS, MODE_PRIVATE)
                .edit().putString("text", transmitText).putLong("at", System.currentTimeMillis())
                .putString(ChatSendService.REPLY_MARKER, nonce)
                .putString(ChatSendService.STATUS, "Auto Kirim disiapkan; menunggu ChatGPT.").commit();
        }
        Intent share = new Intent(Intent.ACTION_SEND);
        share.setType("text/plain");
        share.putExtra(Intent.EXTRA_TEXT,transmitText);
        share.setPackage("com.openai.chatgpt");
        try { startActivity(share); }
        catch (Exception ex) {
            Intent open = getPackageManager().getLaunchIntentForPackage("com.openai.chatgpt");
            if (open != null) {
                ((ClipboardManager)getSystemService(Context.CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("OpenClaw prompt",transmitText));
                startActivity(open);
                Toast.makeText(this,"Prompt disalin; tempel dan kirim di ChatGPT",Toast.LENGTH_LONG).show();
            } else Toast.makeText(this,"Aplikasi ChatGPT tidak ditemukan",Toast.LENGTH_LONG).show();
        }
    }
    private boolean accessibilityEnabled() {
        AccessibilityManager mgr = (AccessibilityManager)getSystemService(Context.ACCESSIBILITY_SERVICE);
        if (mgr == null) return false;
        for (AccessibilityServiceInfo info : mgr.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)) {
            if (info.getResolveInfo() != null
                && getPackageName().equals(info.getResolveInfo().serviceInfo.packageName)
                && ChatSendService.class.getName().equals(info.getResolveInfo().serviceInfo.name)) return true;
        }
        return false;
    }
    private void copyResult() {
        String text = result.getText().toString();
        if (text.isEmpty()) return;
        ((ClipboardManager)getSystemService(Context.CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("ChatGPT result",text));
        Toast.makeText(this,"Jawaban disalin",Toast.LENGTH_SHORT).show();
    }
    private String resultEnvelope() {
        String id = taskId.getText().toString().trim();
        String answer = result.getText().toString().trim();
        if (!id.matches("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")) {
            taskId.setError("Masukkan UUID job yang sah");
            return null;
        }
        if (answer.isEmpty()) {
            result.setError("Hasil masih kosong");
            return null;
        }
        if (answer.length() > 2000) {
            result.setError("Ringkas hasil maksimal 2000 karakter");
            return null;
        }
        try {
            JSONObject object = new JSONObject();
            object.put("protocol", "openclaw-chat-bridge-dev-v1");
            object.put("jobId", id);
            object.put("eventId", "android-result:" + eventId);
            object.put("resultSummary", answer);
            object.put("source", "user-confirmed-chatgpt-android");
            object.put("verifiedByAiCore", false);
            return object.toString();
        } catch (Exception ex) { return null; }
    }
    private void deliverResult() {
        String envelope = resultEnvelope();
        if (envelope == null) return;
        if (submissionInFlight) return;
        String endpoint = DEV_INTAKE_URL;
        String token = jobToken.getText().toString().trim();
        String paired = getSharedPreferences("bridge-pairing-dev", MODE_PRIVATE).getString("credential", "");
        if ((token.length() < 40 || token.length() > 1500) && paired.length() < 32) {
            deliveryStatus.setText("Isi token sementara atau lakukan pairing perangkat satu kali.");
            return;
        }
        submissionInFlight = true;
        deliveryStatus.setText("Mengirim... (belum ACK AI Core)");
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                String activeToken = token;
                if (activeToken.length() < 40 || activeToken.length() > 1500) {
                    HttpURLConnection auth = (HttpURLConnection)new URL(DEV_TOKEN_URL).openConnection();
                    try {
                        auth.setRequestMethod("POST");
                        auth.setConnectTimeout(10000);
                        auth.setReadTimeout(12000);
                        auth.setInstanceFollowRedirects(false);
                        auth.setDoOutput(true);
                        auth.setRequestProperty("Content-Type","application/json");
                        auth.setRequestProperty("Authorization","Bearer "+paired);
                        JSONObject job = new JSONObject();
                        job.put("jobId", taskId.getText().toString().trim());
                        try(OutputStream out=auth.getOutputStream()) {
                            out.write(job.toString().getBytes(StandardCharsets.UTF_8));
                        }
                        if (auth.getResponseCode()!=200) throw new SecurityException("Token job tidak diizinkan: HTTP "+auth.getResponseCode());
                        try(InputStream in=auth.getInputStream()) {
                            activeToken = new JSONObject(new String(in.readNBytes(4096),StandardCharsets.UTF_8)).getString("token");
                        }
                    } finally { auth.disconnect(); }
                }
                conn = (HttpURLConnection)new URL(endpoint).openConnection();
                conn.setRequestMethod("POST");
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(12000);
                conn.setInstanceFollowRedirects(false);
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setRequestProperty("Authorization", "Bearer " + activeToken);
                byte[] bytes = envelope.getBytes(StandardCharsets.UTF_8);
                try (OutputStream output = conn.getOutputStream()) { output.write(bytes); }
                int status = conn.getResponseCode();
                String response;
                try (InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream()) {
                    response = in == null ? "" : new String(in.readNBytes(4096),StandardCharsets.UTF_8);
                }
                JSONObject value = response.isEmpty() ? new JSONObject() : new JSONObject(response);
                boolean accepted = status == 202 || status == 200;
                boolean confirmed = accepted && value.optBoolean("accepted", false);
                String receipt = value.optString("receiptId", "");
                String display = confirmed ? "Intake DEV menerima hasil. Receipt: " + receipt +
                    ". Status: RECEIVED_UNVERIFIED (bukan callback/ACK AI Core)." :
                    "Gagal mengirim ke intake DEV (HTTP " + status + ").";
                runOnUiThread(() -> { submissionInFlight = false; deliveryStatus.setText(display); });
            } catch (Exception ex) {
                runOnUiThread(() -> { submissionInFlight = false; deliveryStatus.setText("Koneksi gagal. Periksa token dan jaringan DEV."); });
            } finally { if (conn != null) conn.disconnect(); }
        }).start();
    }

    private JSONObject callPairApi(String endpoint, JSONObject input) throws Exception {
        HttpURLConnection http=(HttpURLConnection)new URL(endpoint).openConnection();
        try {
            http.setRequestMethod("POST");
            http.setConnectTimeout(10000);
            http.setReadTimeout(12000);
            http.setInstanceFollowRedirects(false);
            http.setDoOutput(true);
            http.setRequestProperty("Content-Type","application/json");
            try(OutputStream out=http.getOutputStream()) {
                out.write(input.toString().getBytes(StandardCharsets.UTF_8));
            }
            int status=http.getResponseCode();
            try(InputStream in=status>=400?http.getErrorStream():http.getInputStream()){
                String body=in==null?"":new String(in.readNBytes(4096),StandardCharsets.UTF_8);
                if(status!=200 && status!=201 && status!=202)throw new IllegalStateException("HTTP "+status);
                return new JSONObject(body);
            }
        }finally{http.disconnect();}
    }

    private void fetchJobForDevice(boolean startTest) {
        if (fetchInFlight) return;
        if (startTest && !accessibilityEnabled()) {
            jobFetchStatus.setText("Aktifkan Accessibility OpenClaw Auto Kirim (DEV) terlebih dahulu.");
            startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
            return;
        }
        String credential=getSharedPreferences("bridge-pairing-dev",MODE_PRIVATE).getString("credential","");
        if(credential.length()<32){jobFetchStatus.setText("Pairing perangkat tidak ditemukan di aplikasi. Periksa pairing DEV.");return;}
        fetchInFlight = true;
        jobFetchStatus.setText("Memeriksa job DEV untuk perangkat ini...");
        new Thread(()->{
            HttpURLConnection conn=null;
            try{
                conn=(HttpURLConnection)new URL(DEV_NEXT_JOB_URL).openConnection();
                conn.setRequestMethod("POST");
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(12000);
                conn.setInstanceFollowRedirects(false);
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type","application/json");
                conn.setRequestProperty("Authorization","Bearer "+credential);
                try(OutputStream out=conn.getOutputStream()){out.write("{}".getBytes(StandardCharsets.UTF_8));}
                int status=conn.getResponseCode();
                if(status==204){
                    runOnUiThread(()->jobFetchStatus.setText("Belum ada job DEV untuk perangkat ini."));
                    return;
                }
                if(status!=200)throw new IllegalStateException("HTTP "+status);
                String response;
                try(InputStream in=conn.getInputStream()){
                    response=new String(in.readNBytes(4096),StandardCharsets.UTF_8);
                }
                JSONObject payload = new JSONObject(response);
                String id=payload.getString("jobId");
                JSONObject action=payload.optJSONObject("action");
                if(!id.matches("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"))
                    throw new IllegalStateException("Invalid job");
                runOnUiThread(()->{
                    if (startTest && id.equals(getSharedPreferences("bridge-autojob-dev", MODE_PRIVATE)
                            .getString("last_launched_job", ""))) {
                        jobFetchStatus.setText("Job sama sudah dipicu; menunggu hasil, tanpa pengiriman ulang.");
                        return;
                    }
                    taskId.setText(id);
                    jobFetchStatus.setText("Job DEV diterima: "+id+". Jalankan prompt untuk job ini.");
                    if (action != null) {
                        if (getSharedPreferences(ACTION_PREFS, MODE_PRIVATE).getString("last_action_job", "").equals(id)) {
                            // APK upgrades preserve pairing and one-shot history. For a
                            // previously launched GitHub job, let the person attest
                            // that it was actually visible, without opening it twice.
                            if ("OPEN_URL".equals(action.optString("kind")) &&
                                AndroidActionReceipt.GITHUB.equals(action.optString("target"))) {
                                rememberGithubAction(id);
                            }
                            jobFetchStatus.setText("Aksi job ini telah ditawarkan sekali; tidak dibuka ulang.");
                            return;
                        }
                        presentDeviceAction(id, action);
                        return;
                    }
                    if(startTest){
                        if (!getSharedPreferences("bridge-autojob-dev", MODE_PRIVATE).edit()
                                .putString("last_launched_job", id).commit()) return;
                        prompt.setText("Jawab singkat: Pengujian otomatis ChatGPT DEV berhasil.");
                        autoSend.setChecked(true);
                        captureReply.setChecked(true);
                        autoSubmit.setChecked(true);
                        devOneTapLaunch = true;
                        launchChatGPT(); // Explicit one-tap DEV run; marked result can upload without UI return.
                    }
                });
            }catch(Exception ex){
                runOnUiThread(()->jobFetchStatus.setText("Gagal mengambil job DEV ("+(ex instanceof IllegalStateException?ex.getMessage():"koneksi")+"). Periksa pairing dan jaringan."));
            }finally{
                if(conn!=null)conn.disconnect();
                runOnUiThread(() -> fetchInFlight = false);
            }
        }).start();
    }


    // DEV action dispatcher: user confirmation is mandatory and no UI launch is reported as E2E PASS.
    private void presentDeviceAction(String id, JSONObject action) {
        String kind = action.optString("kind", "");
        String target = action.optString("target", "");
        Uri uri = null;
        String description;
        if ("OPEN_URL".equals(kind)) {
            try {
                uri = Uri.parse(target);
                String host = uri.getHost();
                if (!"https".equals(uri.getScheme()) || uri.getUserInfo() != null || uri.getPort() != -1 ||
                    !( "github.com".equals(host) || "www.github.com".equals(host) ||
                       "dev-ai-task.cstlogistic.co.id".equals(host))) throw new IllegalArgumentException("URL ditolak");
            } catch (Exception ex) { jobFetchStatus.setText("OPEN_URL ditolak oleh kebijakan DEV."); return; }
            description = "Buka alamat berikut di browser HP?\\n" + target;
        } else if ("OPEN_APP".equals(kind)) {
            if (!("com.github.android".equals(target) || "com.openai.chatgpt".equals(target) ||
                  "com.android.chrome".equals(target))) {
                jobFetchStatus.setText("OPEN_APP ditolak oleh kebijakan DEV."); return;
            }
            description = "Buka aplikasi " + target + " di HP?";
        } else if ("DEVICE_STATUS".equals(kind) && target.isEmpty()) {
            description = "Periksa status aplikasi Bridge dan koneksi jaringan tanpa mengambil data pribadi?";
        } else { jobFetchStatus.setText("Jenis aksi DEV tidak dikenal."); return; }
        // Record the one-shot offer before user interaction, preventing replay after rotation/restart.
        if (!getSharedPreferences("bridge-device-actions-dev", MODE_PRIVATE).edit()
                .putString("last_action_job", id).commit()) {
            jobFetchStatus.setText("Tidak dapat menyimpan status aksi."); return;
        }
        final Uri destination = uri;
        final String taskKind = kind;
        final String taskTarget = target;
        new AlertDialog.Builder(this).setTitle("Konfirmasi perintah AI Task DEV")
          .setMessage(description).setCancelable(false)
          .setNegativeButton("Tolak", (dialog, which) -> jobFetchStatus.setText("Job "+id+": aksi ditolak pengguna; belum COMPLETED."))
          .setPositiveButton("Jalankan", (dialog, which) -> {
              try {
                  if ("DEVICE_STATUS".equals(taskKind)) {
                      android.net.ConnectivityManager manager =
                          (android.net.ConnectivityManager)getSystemService(Context.CONNECTIVITY_SERVICE);
                      android.net.Network network = manager == null ? null : manager.getActiveNetwork();
                      jobFetchStatus.setText("Job "+id+": Bridge DEV aktif, jaringan "+
                          (network == null ? "tidak tersedia" : "tersedia") +
                          ". Pemeriksaan lokal saja, belum ACK.");
                      return;
                  }
                  Intent launch;
                  if ("OPEN_URL".equals(taskKind)) {
                      launch = new Intent(Intent.ACTION_VIEW, destination);
                      launch.addCategory(Intent.CATEGORY_BROWSABLE);
                  } else {
                      launch = getPackageManager().getLaunchIntentForPackage(taskTarget);
                      if (launch == null) {jobFetchStatus.setText("Aplikasi tidak terpasang: "+taskTarget); return;}
                  }
                  startActivity(launch);
                  if ("OPEN_URL".equals(taskKind) && AndroidActionReceipt.GITHUB.equals(taskTarget)) {
                      rememberGithubAction(id);
                  }
                  jobFetchStatus.setText("Job "+id+": intent membuka "+taskKind+
                     " dikirim. Kembali ke Bridge dan konfirmasi hanya setelah GitHub terlihat di HP.");
              } catch (Exception ex) {
                  jobFetchStatus.setText("Job "+id+": Android gagal membuka target (belum ACK).");
              }
          }).show();
    }

    private void rememberGithubAction(String id) {
        android.content.SharedPreferences prefs=getSharedPreferences(ACTION_PREFS, MODE_PRIVATE);
        if (id.equals(prefs.getString("confirmed_job",""))) {
            actionReceiptStatus.setText("Konfirmasi untuk job "+id+" sudah diterima intake DEV. Menunggu verifikasi callback/ACK.");
            return;
        }
        if (!id.equals(prefs.getString("pending_job",""))) {
            boolean saved=prefs.edit().putString("pending_job",id)
                .putString("pending_event",UUID.randomUUID().toString()).commit();
            if (!saved) {
                actionReceiptStatus.setText("Gagal menyimpan pending job pada perangkat.");
                return;
            }
        }
        actionReceiptStatus.setText("Job "+id+": Jika GitHub SUDAH terlihat pada Z Fold4, tekan KONFIRMASI GITHUB di atas.");
    }

    private void confirmGithubVisible() {
        android.content.SharedPreferences prefs=getSharedPreferences(ACTION_PREFS, MODE_PRIVATE);
        String id=prefs.getString("pending_job","");
        String event=prefs.getString("pending_event","");
        if (id.isEmpty() || event.isEmpty()) {
            actionReceiptStatus.setText("Tidak ada job GitHub yang menunggu konfirmasi. Ambil job DEV dahulu.");
            return;
        }
        if (actionReceiptInFlight) return;
        new AlertDialog.Builder(this)
          .setTitle("Konfirmasi GitHub pada HP")
          .setMessage("Apakah halaman GitHub benar-benar SUDAH terlihat pada Z Fold4? Jawab Ya hanya setelah melihatnya di browser HP. Tidak boleh mengaku berhasil jika baru muncul pemilih browser.")
          .setNegativeButton("Belum", (dialog,which) ->
              actionReceiptStatus.setText("Belum dikonfirmasi. Buka GitHub dahulu, lalu kembali ke Bridge."))
          .setPositiveButton("Ya, GitHub terlihat", (dialog,which) ->
              submitGithubConfirmation(id,event))
          .show();
    }

    private void submitGithubConfirmation(String id,String event) {
        if (actionReceiptInFlight) return;
        String credential=getSharedPreferences("bridge-pairing-dev",MODE_PRIVATE).getString("credential","");
        if (credential.length()<32) {
            actionReceiptStatus.setText("Pairing DEV hilang; tidak dapat mengirim konfirmasi.");
            return;
        }
        actionReceiptInFlight=true;
        actionReceiptStatus.setText("Mengirim konfirmasi pengguna ke intake DEV; bukan ACK akhir...");
        new Thread(()->{
            try {
                String receipt=AndroidActionReceipt.submitUserConfirmedGithub(id,event,credential);
                boolean saved=getSharedPreferences(ACTION_PREFS,MODE_PRIVATE).edit()
                    .putString("confirmed_job",id).remove("pending_job").remove("pending_event").commit();
                runOnUiThread(()->actionReceiptStatus.setText(
                    saved ? "Intake DEV menerima konfirmasi pengguna. Receipt: "+receipt+
                      ". Status RECEIVED_UNVERIFIED; menunggu server memverifikasi callback/ACK." :
                      "Intake menerima hasil, tetapi status lokal belum tersimpan; jangan buat job baru."));
            } catch (Exception ex) {
                final String cause=ex instanceof IllegalStateException ?
                  ex.getMessage() : ex instanceof SecurityException ? "otorisasi" : "koneksi";
                runOnUiThread(()->actionReceiptStatus.setText(
                    "Gagal mengirim konfirmasi DEV ("+cause+"). Coba lagi dengan event yang sama; jangan membuat job baru."));
            } finally {
                runOnUiThread(()->actionReceiptInFlight=false);
            }
        },"android-dev-action-receipt").start();
    }

    private void beginPairing() {
        if (pairingInFlight) {
            deliveryStatus.setText("Pairing sedang berjalan. Tunggu proses sebelumnya.");
            return;
        }
        pairingInFlight = true;
        deliveryStatus.setText("Meminta pairing DEV...");
        new Thread(() -> {
            int consecutiveNetworkErrors = 0;
            try {
                JSONObject start = callPairApi(DEV_PAIR_START_URL, new JSONObject());
                String id = start.getString("requestId");
                String proof = start.getString("proof");
                String code = start.getString("code");
                long expiresAt = start.getLong("expiresAt");
                runOnUiThread(() -> deliveryStatus.setText(
                    "Kode pairing: " + code + ". Minta persetujuan admin (berlaku 5 menit)."));
                while (System.currentTimeMillis() < expiresAt) {
                    Thread.sleep(4500);
                    JSONObject body = new JSONObject();
                    body.put("requestId", id);
                    body.put("proof", proof);
                    try {
                        JSONObject state = callPairApi(DEV_PAIR_STATUS_URL, body);
                        consecutiveNetworkErrors = 0;
                        if ("paired".equals(state.optString("status"))) {
                            String credential = state.getString("credential");
                            if (!getSharedPreferences("bridge-pairing-dev", MODE_PRIVATE)
                                    .edit().putString("credential", credential).commit()) {
                                throw new IllegalStateException("Credential tidak tersimpan");
                            }
                            runOnUiThread(() -> deliveryStatus.setText(
                                "PAIRING DEV BERHASIL. Credential tersimpan di HP."));
                            return;
                        }
                        if (!"pending".equals(state.optString("status"))) {
                            runOnUiThread(() -> deliveryStatus.setText(
                                "Status pairing tak dikenal. Periksa VPS DEV."));
                            return;
                        }
                    } catch (Exception error) {
                        consecutiveNetworkErrors++;
                        final String category = error instanceof IllegalStateException
                            ? error.getMessage() : error.getClass().getSimpleName();
                        final int count = consecutiveNetworkErrors;
                        runOnUiThread(() -> deliveryStatus.setText(
                            "Kode " + code + ": polling gagal (" + category +
                            "), percobaan ulang " + count + "/5."));
                        if (count >= 5) {
                            runOnUiThread(() -> deliveryStatus.setText(
                                "Pairing terhenti setelah 5 kegagalan koneksi (" +
                                category + "). Minta kode baru setelah jaringan pulih."));
                            return;
                        }
                    }
                }
                runOnUiThread(() -> deliveryStatus.setText(
                    "Kode pairing kedaluwarsa (5 menit). Minta kode baru."));
            } catch (Exception error) {
                final String category = error instanceof IllegalStateException
                    ? error.getMessage() : error.getClass().getSimpleName();
                runOnUiThread(() -> deliveryStatus.setText(
                    "Tidak bisa memulai pairing DEV (" + category + ")."));
            } finally {
                pairingInFlight = false;
            }
        }, "android-dev-pairing").start();
    }

        private void shareResult() {
        String envelope = resultEnvelope();
        if (envelope == null) return;
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_TEXT, envelope);
        startActivity(Intent.createChooser(send, "Bagikan hasil job ke penerima tepercaya"));
    }
}
