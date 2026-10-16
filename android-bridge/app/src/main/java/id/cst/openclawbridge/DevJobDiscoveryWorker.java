package id.cst.openclawbridge;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

/**
 * DEV background safety guard.
 * /v1/android/jobs/next may atomically claim a job. A background discovery
 * worker must not call that endpoint until a non-claiming peek API exists.
 * FCM delivery is a wakeup signal only, not proof of job execution.
 */
public final class DevJobDiscoveryWorker extends Worker {
    public static final String UNIQUE = "openclaw-dev-background-discovery";

    public DevJobDiscoveryWorker(@NonNull Context context,
                                 @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull @Override public Result doWork() {
        // No claim, no callback, no ACK, and no unauthorized background UI launch.
        return Result.success();
    }
}
