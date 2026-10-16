package id.cst.openclawbridge;

import android.content.Context;
import android.content.SharedPreferences;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/**
 * DEV background discovery only. Never claims a job or launches ChatGPT from
 * background: Android forbids unconsented background activity launches.
 * The paired device may inspect pending work through the read-only peek API.
 */
public final class DevJobDiscoveryWorker extends Worker {
    public static final String UNIQUE = "openclaw-dev-background-discovery";
    private static final String PEEK_URL =
            "https://dev-ai-task.cstlogistic.co.id/v1/android/jobs/peek";

    public DevJobDiscoveryWorker(@NonNull Context context,
                                 @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull @Override public Result doWork() {
        Context app = getApplicationContext();
        String credential = app.getSharedPreferences("bridge-pairing-dev", Context.MODE_PRIVATE)
                .getString("credential", "");
        if (credential.length() < 32) return Result.success();
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(PEEK_URL).openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(12000);
            conn.setDoOutput(true);
            conn.setInstanceFollowRedirects(false);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Authorization", "Bearer " + credential);
            try (OutputStream out = conn.getOutputStream()) {
                out.write("{}".getBytes(StandardCharsets.UTF_8));
            }
            int status = conn.getResponseCode();
            SharedPreferences.Editor state = app.getSharedPreferences(
                    "bridge-background-dev", Context.MODE_PRIVATE).edit()
                    .putLong("lastCheckAt", System.currentTimeMillis())
                    .putInt("lastHttpStatus", status);
            if (status == 200) {
                JSONObject response = new JSONObject(new String(
                        conn.getInputStream().readAllBytes(), StandardCharsets.UTF_8));
                String jobId = response.optString("jobId", "");
                if (jobId.matches("[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}"))
                    state.putString("pendingJobId", jobId);
            } else if (status == 204) {
                state.remove("pendingJobId");
            }
            state.apply();
            return status == 429 || status >= 500 ? Result.retry() : Result.success();
        } catch (Exception ex) {
            return Result.retry();
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
