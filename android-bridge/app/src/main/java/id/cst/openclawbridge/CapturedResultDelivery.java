package id.cst.openclawbridge;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONObject;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/** DEV-only, explicit user-armed one-shot delivery. No background polling or PROD access. */
final class CapturedResultDelivery {
    static final String JOB_ID = "delivery_job_id";
    static final String EVENT_ID = "delivery_event_id";
    static final String ARMED = "delivery_armed";
    static final String STATUS = "delivery_status";
    private static final String TOKEN_URL = "https://dev-ai-task.cstlogistic.co.id/v1/android/token";
    private static final String RESULT_URL = "https://dev-ai-task.cstlogistic.co.id/v1/android/result";
    private CapturedResultDelivery() {}

    static void onCapture(Context context, SharedPreferences prefs, String answer) {
        if (!prefs.getBoolean(ARMED, false)) return;
        String jobId = prefs.getString(JOB_ID, "");
        String eventId = prefs.getString(EVENT_ID, "");
        String paired = context.getSharedPreferences("bridge-pairing-dev", Context.MODE_PRIVATE)
                .getString("credential", "");
        // Commit disarm before starting network work. Retry must use the same eventId.
        if (!jobId.matches("(?i)[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}")
                || !eventId.matches("[0-9a-f-]{36}") || paired.length() < 32) {
            prefs.edit().putString(STATUS, "AUTO_DELIVERY_BLOCKED: invalid job or pairing")
                    .putBoolean(ARMED, false).commit();
            return;
        }
        if (!prefs.edit().putBoolean(ARMED, false)
                .putString(STATUS, "AUTO_DELIVERY_SENDING").commit()) return;
        final String text = answer;
        new Thread(() -> {
            try {
                JSONObject request = new JSONObject();
                request.put("jobId", jobId);
                JSONObject tokenResponse = request(TOKEN_URL, paired, request);
                String token = tokenResponse.getString("token");
                JSONObject envelope = new JSONObject();
                envelope.put("protocol", "openclaw-chat-bridge-dev-v1");
                envelope.put("jobId", jobId);
                envelope.put("eventId", "android-result:" + eventId);
                envelope.put("resultSummary", text);
                envelope.put("source", "user-confirmed-chatgpt-android");
                envelope.put("verifiedByAiCore", false);
                JSONObject receipt = request(RESULT_URL, token, envelope);
                if (!receipt.optBoolean("accepted", false))
                    throw new IllegalStateException("Not accepted");
                prefs.edit().putString(STATUS, "AUTO_DELIVERY_RECEIVED: " +
                        receipt.optString("receiptId", "")).apply();
            } catch (Exception error) {
                prefs.edit().putString(STATUS, "AUTO_DELIVERY_FAILED: return to Bridge and retry manually").apply();
            }
        }, "android-dev-capture-delivery").start();
    }

    private static JSONObject request(String endpoint, String bearer, JSONObject data) throws Exception {
        HttpURLConnection c = (HttpURLConnection)new URL(endpoint).openConnection();
        try {
            c.setRequestMethod("POST");
            c.setConnectTimeout(10000);
            c.setReadTimeout(12000);
            c.setInstanceFollowRedirects(false);
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            c.setRequestProperty("Authorization", "Bearer " + bearer);
            try (OutputStream out = c.getOutputStream()) {
                out.write(data.toString().getBytes(StandardCharsets.UTF_8));
            }
            int code = c.getResponseCode();
            if (code != 200 && code != 202) throw new IllegalStateException("HTTP " + code);
            try (InputStream in = c.getInputStream()) {
                return new JSONObject(new String(in.readNBytes(4096), StandardCharsets.UTF_8));
            }
        } finally { c.disconnect(); }
    }
}
