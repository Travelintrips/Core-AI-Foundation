package id.cst.openclawbridge;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/**
 * DEV only. Sends a user-confirmed Android OPEN_URL action through the existing
 * short-lived paired job token and results intake. Never contacts PROD and
 * never presents an Android intent as independently verified page rendering.
 */
public final class AndroidActionReceipt {
    private static final String TOKEN = "https://dev-ai-task.cstlogistic.co.id/v1/android/token";
    private static final String INTAKE = "https://dev-ai-task.cstlogistic.co.id/v1/android/result";
    public static final String GITHUB = "https://github.com/";
    public static final String HOSTINGER = "https://hpanel.hostinger.com/";
    public static final String HOSTINGER_VPS = "https://hpanel.hostinger.com/vps";
    public static final String GCP = "https://console.cloud.google.com/";
    public static final String GCP_COMPUTE = "https://console.cloud.google.com/compute/instances";
    public static boolean supportedUrl(String url) {
        return GITHUB.equals(url) || HOSTINGER.equals(url) ||
            HOSTINGER_VPS.equals(url) || GCP.equals(url) || GCP_COMPUTE.equals(url);
    }
    public static String labelForUrl(String url) {
        if (GITHUB.equals(url)) return "GitHub";
        if (HOSTINGER.equals(url)) return "Hostinger hPanel";
        if (HOSTINGER_VPS.equals(url)) return "Hostinger VPS";
        if (GCP.equals(url)) return "Google Cloud Console";
        if (GCP_COMPUTE.equals(url)) return "GCP VM instances";
        return "Situs tidak dikenal";
    }
    private AndroidActionReceipt() {}

    private static JSONObject post(String endpoint, JSONObject payload, String bearer) throws Exception {
        HttpURLConnection conn = (HttpURLConnection)new URL(endpoint).openConnection();
        try {
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(12000);
            conn.setInstanceFollowRedirects(false);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Authorization", "Bearer " + bearer);
            try (OutputStream out=conn.getOutputStream()) {
                out.write(payload.toString().getBytes(StandardCharsets.UTF_8));
            }
            int status=conn.getResponseCode();
            if (status != 200 && status != 202) {
                throw new IllegalStateException("HTTP "+status+" dari endpoint DEV");
            }
            try (InputStream in=conn.getInputStream()) {
                JSONObject data = new JSONObject(new String(in.readNBytes(4096),StandardCharsets.UTF_8));
                data.put("_status", status);
                return data;
            }
        } finally {conn.disconnect();}
    }

    private static String submitActionReceipt(String jobId,String uuidEvent,String pairingCredential,String siteUrl,boolean userConfirmed) throws Exception {
        if (!supportedUrl(siteUrl)) throw new SecurityException("Situs tidak termasuk daftar aksi DEV yang disetujui");
        if (!jobId.matches("[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}") ||
            !uuidEvent.matches("[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}") ||
            pairingCredential.length()<32) {
            throw new SecurityException("ID job, event, atau pairing DEV tidak valid");
        }
        JSONObject request = new JSONObject();
        request.put("jobId",jobId);
        JSONObject tokenResponse = post(TOKEN,request,pairingCredential);
        if (tokenResponse.getInt("_status") != 200) throw new SecurityException("Token DEV ditolak");
        String shortLivedToken=tokenResponse.getString("token");
        JSONObject action=new JSONObject();
        action.put("kind","OPEN_URL");
        action.put("target",siteUrl);
        JSONObject receipt=new JSONObject();
        receipt.put("protocol","openclaw-chat-bridge-dev-v1");
        receipt.put("jobId",jobId);
        receipt.put("eventId","android-result:"+uuidEvent);
        if (userConfirmed) {
            receipt.put("resultSummary","User confirmed an allowlisted site was visible on Z Fold4 after opening Chrome.");
            receipt.put("source","user-confirmed-device-action");
            receipt.put("userConfirmation","USER_CONFIRMED_VISIBLE");
        } else {
            receipt.put("resultSummary","Android started an explicit Chrome intent for an allowlisted website; rendering not independently verified.");
            receipt.put("source","device-intent-dispatched");
            receipt.put("deviceOutcome","ANDROID_INTENT_DISPATCHED");
        }
        receipt.put("deviceAction",action);
        JSONObject accepted=post(INTAKE,receipt,shortLivedToken);
        if (!accepted.optBoolean("accepted",false) ||
            !("RECEIVED_UNVERIFIED".equals(accepted.optString("status")))) {
            throw new IllegalStateException("Intake DEV belum menerima konfirmasi");
        }
        return accepted.getString("receiptId");
    }

    // An authenticated admin/MCP job is prior authorization to open exactly
    // the allowlisted site. An Android intent can be reported without an
    // additional dialog, but is NOT evidence that the page finished loading.
    public static String submitDispatchedSite(String jobId,String uuidEvent,String pairingCredential,String siteUrl) throws Exception {
        return submitActionReceipt(jobId,uuidEvent,pairingCredential,siteUrl,false);
    }
    public static String submitUserConfirmedSite(String jobId,String uuidEvent,String pairingCredential,String siteUrl) throws Exception {
        return submitActionReceipt(jobId,uuidEvent,pairingCredential,siteUrl,true);
    }
    // Backwards compatibility for a previously pending DEV GitHub job.
    public static String submitUserConfirmedGithub(String jobId,String uuidEvent,String pairingCredential) throws Exception {
        return submitUserConfirmedSite(jobId,uuidEvent,pairingCredential,GITHUB);
    }
}
