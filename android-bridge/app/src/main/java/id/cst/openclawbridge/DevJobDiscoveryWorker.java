package id.cst.openclawbridge;

import android.content.Context;
import android.content.Intent;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Notification;
import android.app.PendingIntent;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.OutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * DEV-only scheduled background job discovery. Never executes UI actions from
 * background, never acknowledges/claims a job, and never treats a grant as ACK.
 * Android WorkManager periodic jobs are inexact and may be delayed by Doze.
 */
public final class DevJobDiscoveryWorker extends Worker {
    public static final String UNIQUE = "openclaw-dev-background-discovery";
    private static final String ENDPOINT = "https://dev-ai-task.cstlogistic.co.id/v1/android/jobs/next";
    public DevJobDiscoveryWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }
    @NonNull @Override public Result doWork() {
        Context ctx = getApplicationContext();
        String credential = ctx.getSharedPreferences("bridge-pairing-dev", Context.MODE_PRIVATE)
                .getString("credential", "");
        if (credential.length() < 32) return Result.success();
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(ENDPOINT).openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(12000);
            conn.setInstanceFollowRedirects(false);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Authorization", "Bearer " + credential);
            try (OutputStream out = conn.getOutputStream()) {
                out.write("{}".getBytes(StandardCharsets.UTF_8));
            }
            int status = conn.getResponseCode();
            if (status == 204) return Result.success();
            if (status == 401 || status == 403) return Result.failure();
            if (status != 200) return Result.retry();
            String body;
            try (InputStream in = conn.getInputStream()) {
                body = new String(in.readNBytes(4096), StandardCharsets.UTF_8);
            }
            String id = new JSONObject(body).optString("jobId", "");
            if (!id.matches("[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}"))
                return Result.failure();
            String previous = ctx.getSharedPreferences("bridge-background-dev", Context.MODE_PRIVATE)
                    .getString("last_notified_job", "");
            if (id.equals(previous)) return Result.success();
            if (!ctx.getSharedPreferences("bridge-background-dev", Context.MODE_PRIVATE).edit()
                    .putString("last_notified_job", id).commit()) return Result.retry();
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            nm.createNotificationChannel(new NotificationChannel(
                    "dev_jobs", "OpenClaw DEV Jobs", NotificationManager.IMPORTANCE_DEFAULT));
            Intent launch = new Intent(ctx, MainActivity.class);
            launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pending = PendingIntent.getActivity(ctx, 0, launch,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Notification notice = new Notification.Builder(ctx, "dev_jobs")
                    .setSmallIcon(android.R.drawable.stat_notify_sync)
                    .setContentTitle("OpenClaw DEV: job tersedia")
                    .setContentText("Job " + id.substring(0, 8) + " siap diambil oleh Bridge")
                    .setContentIntent(pending).setAutoCancel(true).build();
            nm.notify(1026, notice);
            return Result.success();
        } catch (Exception e) {
            return Result.retry();
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
