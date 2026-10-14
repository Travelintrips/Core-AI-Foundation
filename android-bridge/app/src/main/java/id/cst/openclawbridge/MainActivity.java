package id.cst.openclawbridge;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
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
    private CheckBox autoSubmit;
    private boolean submissionInFlight = false;
    private EditText jobToken;
    private TextView deliveryStatus;

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
        if (autoSendStatus != null) showAutoSendStatus();
        loadCapturedReply();
    }

    private void loadCapturedReply() {
        if (result == null) return;
        String captured = getSharedPreferences(ChatSendService.PREFS, MODE_PRIVATE)
                .getString(ChatSendService.CAPTURED_REPLY, "");
        if (!captured.isEmpty()) {
            result.setText(captured);
            getSharedPreferences(ChatSendService.PREFS, MODE_PRIVATE)
                .edit().remove(ChatSendService.CAPTURED_REPLY).apply();
            if (autoSubmit != null && autoSubmit.isChecked()) deliverResult();
        }
    }

    private void showAutoSendStatus() {
        if (autoSendStatus == null) return;
        boolean enabled = accessibilityEnabled();
        String message = getSharedPreferences(ChatSendService.PREFS, MODE_PRIVATE)
            .getString(ChatSendService.STATUS, "Belum ada uji Auto Kirim.");
        autoSendStatus.setText("Aksesibilitas: " + (enabled ? "AKTIF" : "TIDAK AKTIF") + "\n" + message);
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
        String nonce = capture ? UUID.randomUUID().toString().replace("-", "") : "";
        String transmitText = capture
                ? text + "\\n\\nBalas dalam satu paragraf teks biasa (maksimal 1800 karakter). " +
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
            .remove(ChatSendService.CAPTURED_REPLY).commit();
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
        if (token.length() < 40 || token.length() > 1500) {
            deliveryStatus.setText("Isi token job sementara yang valid.");
            return;
        }
        submissionInFlight = true;
        deliveryStatus.setText("Mengirim... (belum ACK AI Core)");
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection)new URL(endpoint).openConnection();
                conn.setRequestMethod("POST");
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(12000);
                conn.setInstanceFollowRedirects(false);
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setRequestProperty("Authorization", "Bearer " + token);
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
    private void shareResult() {
        String envelope = resultEnvelope();
        if (envelope == null) return;
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_TEXT, envelope);
        startActivity(Intent.createChooser(send, "Bagikan hasil job ke penerima tepercaya"));
    }
}
