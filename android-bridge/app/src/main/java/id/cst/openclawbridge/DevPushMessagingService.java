package id.cst.openclawbridge;

import android.content.Context;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;
import android.util.Log;
import androidx.work.ExistingWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

/**
 * DEV-only wakeup signal. Never execute arbitrary commands from push payloads.
 * Device pairing and job authorization remain on the authenticated DEV endpoint.
 */
public final class DevPushMessagingService extends FirebaseMessagingService {
    private static final String TAG = "DevPushDEV";

    @Override public void onMessageReceived(RemoteMessage message) {
        if (!"android-bridge-dev".equals(message.getData().get("scope"))) return;
        if (!"job_available".equals(message.getData().get("event"))) return;
        // One-off work instead of perpetual polling. The worker currently only
        // discovers and notifies; it does not claim success or launch UI in background.
        OneTimeWorkRequest wakeup = new OneTimeWorkRequest.Builder(DevJobDiscoveryWorker.class).build();
        WorkManager.getInstance(getApplicationContext())
                .enqueueUniqueWork("openclaw-dev-fcm-wakeup", ExistingWorkPolicy.KEEP, wakeup);
        Log.i(TAG, "Authenticated DEV job discovery scheduled from push");
    }

    @Override public void onNewToken(String token) {
        super.onNewToken(token);
        // Registration must be bound to the paired device using an authenticated
        // DEV endpoint before enabling server-side FCM delivery. Never log tokens.
        registerToken(getApplicationContext(), token);
    }

    public static void registerToken(Context context, String token) {
        new Thread(() -> {
            String credential = context.getSharedPreferences("bridge-pairing-dev", Context.MODE_PRIVATE)
                    .getString("credential", "");
            if (credential.length() < 32 || token == null || token.length() < 32) return;
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(
                    "https://dev-ai-task.cstlogistic.co.id/v1/android/fcm/register").openConnection();
                conn.setRequestMethod("POST");
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(12000);
                conn.setDoOutput(true);
                conn.setInstanceFollowRedirects(false);
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setRequestProperty("Authorization", "Bearer " + credential);
                byte[] payload = new JSONObject().put("fcmToken", token).toString()
                    .getBytes(StandardCharsets.UTF_8);
                try (OutputStream out = conn.getOutputStream()) { out.write(payload); }
                if (conn.getResponseCode() != 200)
                    Log.w(TAG, "DEV FCM registration pending: HTTP " + conn.getResponseCode());
            } catch (Exception ex) {
                Log.w(TAG, "DEV FCM registration pending: network error");
            } finally {
                if (conn != null) conn.disconnect();
            }
        }, "dev-fcm-register").start();
    }
}
