package id.cst.openclawbridge;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.net.Uri;
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

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        androidx.work.PeriodicWorkRequest backgroundCheck = new androidx.work.PeriodicWorkRequest.Builder(DevJobDiscoveryWorker.class, 15, java.util.concurrent.TimeUnit.MINUTES).build();
        androidx.work.WorkManager.getInstance(getApplicationContext()).enqueueUniquePeriodicWork(DevJobDiscoveryWorker.UNIQUE, androidx.work.ExistingPeriodicWorkPolicy.KEEP, backgroundCheck);
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
        Button oneTapTest = new Button(this);
        oneTapTest.setText("UJI CHATGPT OTOMATIS DEV (SATU KETUKAN)");
        oneTapTest.setOnClickListener(v -> fetchJobForDevice(true));
        root.addView(oneTapTest);
        CheckBox autoPolling = new CheckBox(this);
        autoPolling.setText("AUTO JOB DEV saat Bridge terbuka (20 detik; boleh membuka ChatGPT)");
        autoPolling.setChecked(getSharedPreferences("bridge-autojob-dev", MODE_PRIVATE).getBoolean("auto_enabled", true));
        foregroundAutoEnabled = autoPolling.isChecked();
        autoPolling.setOnCheckedChangeListener((button, checked) -> {
            getSharedPreferences("bridge-autojob-dev", MODE_PRIVATE).edit().putBoolean("auto_enabled", checked).apply();
            foregroundAutoEnabled = checked;
            autoHandler.removeCallbacks(autoPoll);
            if (checked && foreground) autoHandler.post(autoPoll);
        });
        root.addView(autoPolling);
        TextView controlHeader=new TextView(this);
        controlHeader.setText("Kendali Browser DEV (sekali jalan, Chrome/Samsung Internet)");
        root.addView(controlHeader);
        EditText controlValue=new EditText(this);
        controlValue.setHint("Teks untuk diketik atau label tombol untuk tap");
        controlValue.setSingleLine(true);
        root.addView(controlValue);
        Button tapControl=new Button(this);
        tapControl.setText("ARM TAP LABEL DI BROWSER");
        tapControl.setOnClickListener(v -> armScreenControl("tap",controlValue.getText().toString()));
        root.addView(tapControl);
        Button typeControl=new Button(this);
        typeControl.setText("ARM KETIK PADA INPUT FOKUS");
        typeControl.setOnClickListener(v -> armScreenControl("type",controlValue.getText().toString()));
        root.addView(typeControl);
        Button scrollControl=new Button(this);
        scrollControl.setText("ARM SCROLL BROWSER");
        scrollControl.setOnClickListener(v -> armScreenControl("scroll",""));
        root.addView(scrollControl);
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
        com.google.firebase.messaging.FirebaseMessaging.getInstance().getToken()
            .addOnSuccessListener(fcm -> DevPushMessagingService.registerToken(getApplicationContext(), fcm))
            .addOnFailureListener(error -> android.util.Log.w("DevPushDEV", "FCM token unavailable: " + error.getClass().getSimpleName()));
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
        android.content.SharedPreferences fcmPrefs = getSharedPreferences("bridge-fcm-dev", MODE_PRIVATE);
        long fcmAttempt = fcmPrefs.getLong("lastAttemptAt", 0);
        int fcmHttp = fcmPrefs.getInt("lastHttpStatus", 0);
        String fcmError = fcmPrefs.getString("lastError", "");
        String fcmState = fcmAttempt == 0 ? "BELUM MENCOBA" :
                (fcmHttp == 200 ? "TERDAFTAR (HTTP 200)" :
                ("GAGAL (HTTP " + fcmHttp + (fcmError.isEmpty() ? "" : ", " + fcmError) + ")"));
        autoSendStatus.setText("FCM DEV: " + fcmState + "\nAksesibilitas: " + (enabled ? "AKTIF" : "TIDAK AKTIF") + "\n" + message + evidence +
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
                JSONObject assignment=new JSONObject(response);
                String id=assignment.getString("jobId");
                JSONObject assignedAction=assignment.optJSONObject("action");
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
                    if(startTest && assignedAction!=null){
                        String kind=assignedAction.optString("kind","");
                        String target=assignedAction.optString("target","");
                        if("SCREEN_TAP".equals(kind) || "SCREEN_TYPE".equals(kind) || "SCREEN_SCROLL".equals(kind)){
                            String command="SCREEN_TAP".equals(kind)?"tap":"SCREEN_TYPE".equals(kind)?"type":"scroll";
                            if(!accessibilityEnabled() || target.length()>250 ||
                                    (!"scroll".equals(command) && target.trim().isEmpty()) ||
                                    ("scroll".equals(command) && !target.isEmpty())){
                                jobFetchStatus.setText("Perintah layar DEV ditolak; periksa Accessibility atau parameter.");
                                return;
                            }
                            if(!getSharedPreferences("bridge-autojob-dev",MODE_PRIVATE).edit()
                                    .putString("last_launched_job",id).commit())return;
                            armScreenControl(command,target);
                            try{
                                Intent browser=getPackageManager().getLaunchIntentForPackage("com.android.chrome");
                                if(browser==null)throw new IllegalStateException("Chrome tidak tersedia");
                                startActivity(browser);
                                jobFetchStatus.setText("Kendali layar DEV dijadwalkan satu kali; hasil belum diverifikasi.");
                            }catch(Exception ex){
                                getSharedPreferences("screen_controls_dev",MODE_PRIVATE).edit().clear().apply();
                                jobFetchStatus.setText("Tidak dapat beralih ke Chrome untuk kendali DEV.");
                            }
                            return;
                        }
                        if(!"OPEN_URL".equals(kind) || target.length()>600 || !target.startsWith("https://")){
                            jobFetchStatus.setText("Aksi DEV tidak didukung.");
                            return;
                        }
                        Uri uri=Uri.parse(target);
                        if(!"https".equals(uri.getScheme()) || uri.getHost()==null ||
                                uri.getUserInfo()!=null || uri.getPort()!=-1 ||
                                uri.getHost().endsWith(".local") || uri.getHost().endsWith(".internal")){
                            jobFetchStatus.setText("URL DEV ditolak.");
                            return;
                        }
                        if (!getSharedPreferences("bridge-autojob-dev", MODE_PRIVATE).edit()
                                .putString("last_launched_job",id).commit()) return;
                        try {
                            Intent intent=new Intent(Intent.ACTION_VIEW,uri);
                            intent.addCategory(Intent.CATEGORY_BROWSABLE);
                            startActivity(intent);
                            jobFetchStatus.setText("Browser diluncurkan untuk "+id+"; halaman belum diverifikasi.");
                            reportDispatchedAction(id,kind,target);
                        } catch(Exception error) {
                            getSharedPreferences("bridge-autojob-dev", MODE_PRIVATE).edit()
                                    .remove("last_launched_job").apply();
                            jobFetchStatus.setText("Gagal membuka browser DEV.");
                        }
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

    private void armScreenControl(String kind,String value) {
        if(!accessibilityEnabled()){
            Toast.makeText(this,"Aktifkan Accessibility DEV dahulu",Toast.LENGTH_LONG).show();
            return;
        }
        if(!"scroll".equals(kind) && (value.trim().isEmpty() || value.length()>250)){
            Toast.makeText(this,"Isi teks/label maksimal 250 karakter",Toast.LENGTH_LONG).show();
            return;
        }
        boolean saved=getSharedPreferences("screen_controls_dev",MODE_PRIVATE).edit()
                .putString("kind",kind).putString("value",value)
                .putLong("at",System.currentTimeMillis()).commit();
        Toast.makeText(this,saved?"Perintah DEV siap 15 detik. Pindah ke browser.":"Gagal menyimpan perintah",Toast.LENGTH_LONG).show();
    }

    private void reportDispatchedAction(String id,String kind,String target) {
        new Thread(() -> {
            try {
                String paired=getSharedPreferences("bridge-pairing-dev",MODE_PRIVATE)
                        .getString("credential","");
                JSONObject request=new JSONObject();
                request.put("jobId",id);
                JSONObject auth=postAuthorized(DEV_TOKEN_URL,paired,request);
                JSONObject body=new JSONObject();
                body.put("protocol","openclaw-chat-bridge-dev-v1");
                body.put("jobId",id);
                body.put("eventId","android-result:"+id);
                body.put("resultSummary","Android dispatched browser intent; page rendering not verified.");
                body.put("source","device-intent-dispatched");
                body.put("verifiedByAiCore",false);
                body.put("deviceOutcome","ANDROID_INTENT_DISPATCHED");
                JSONObject action=new JSONObject();
                action.put("kind",kind);
                action.put("target",target);
                body.put("deviceAction",action);
                JSONObject receipt=postAuthorized(DEV_INTAKE_URL,auth.getString("token"),body);
                runOnUiThread(() -> jobFetchStatus.setText(receipt.optBoolean("accepted",false)
                        ? "Intent browser diterima intake DEV; tunggu callback dan ACK."
                        : "Intent dikirim, tetapi intake belum menerima laporan."));
            }catch(Exception error){
                runOnUiThread(() -> jobFetchStatus.setText(
                        "Intent browser dikirim, laporan DEV gagal. Jangan ulangi job."));
            }
        },"android-dev-browser-receipt").start();
    }

    private JSONObject postAuthorized(String endpoint,String bearer,JSONObject payload) throws Exception {
        HttpURLConnection conn=(HttpURLConnection)new URL(endpoint).openConnection();
        try {
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(12000);
            conn.setInstanceFollowRedirects(false);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type","application/json");
            conn.setRequestProperty("Authorization","Bearer "+bearer);
            try(OutputStream out=conn.getOutputStream()){
                out.write(payload.toString().getBytes(StandardCharsets.UTF_8));
            }
            int code=conn.getResponseCode();
            if(code!=200 && code!=202)throw new IllegalStateException("HTTP "+code);
            try(InputStream in=conn.getInputStream()){
                return new JSONObject(new String(in.readNBytes(4096),StandardCharsets.UTF_8));
            }
        }finally{conn.disconnect();}
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
                            com.google.firebase.messaging.FirebaseMessaging.getInstance().getToken()
                                .addOnSuccessListener(fcm -> DevPushMessagingService.registerToken(getApplicationContext(), fcm));
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
