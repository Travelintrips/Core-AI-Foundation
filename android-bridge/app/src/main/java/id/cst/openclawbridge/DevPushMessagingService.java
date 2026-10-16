package id.cst.openclawbridge;

import android.content.Intent;
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
        Log.i(TAG, "FCM token refreshed; secure DEV registration required");
    }
}
