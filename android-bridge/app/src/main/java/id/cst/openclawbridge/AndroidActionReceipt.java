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

    public static String submitUserConfirmedGithub(String jobId,String uuidEvent,String pairingCredential) throws Exception {
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
        action.put("target",GITHUB);
        JSONObject receipt=new JSONObject();
        receipt.put("protocol","openclaw-chat-bridge-dev-v1");
        receipt.put("jobId",jobId);
        receipt.put("eventId","android-result:"+uuidEvent);
        receipt.put("resultSummary","User explicitly confirmed GitHub was visible on Z Fold4 after opening the browser.");
        receipt.put("source","user-confirmed-device-action");
        receipt.put("userConfirmation","USER_CONFIRMED_VISIBLE");
        receipt.put("deviceAction",action);
        JSONObject accepted=post(INTAKE,receipt,shortLivedToken);
        if (!accepted.optBoolean("accepted",false) ||
            !("RECEIVED_UNVERIFIED".equals(accepted.optString("status")))) {
            throw new IllegalStateException("Intake DEV belum menerima konfirmasi");
        }
        return accepted.getString("receiptId");
    }
}
