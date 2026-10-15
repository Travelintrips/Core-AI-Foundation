package id.cst.openclawbridge;

import android.accessibilityservice.AccessibilityService;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public final class ChatSendService extends AccessibilityService {
    static final String PREFS = "chat_send_pending";
    static final String STATUS = "diagnostic_status";
    static final String REPLY_MARKER = "reply_marker";
    static final String REPLY_STARTED = "reply_started";
    static final String CAPTURED_REPLY = "captured_reply";
    static final String AUTO_SENT_AT = "auto_sent_at";
    static final String AUTO_CAPTURED_AT = "auto_captured_at";
    private static final long SEND_TIMEOUT_MS = 45000;
    private static final long REPLY_TIMEOUT_MS = 180000;
    private static final String TARGET = "com.openai.chatgpt";
    private static final String END_TOKEN = "END-OCB";
    private boolean handling;

    @Override protected void onServiceConnected() {
        super.onServiceConnected();
        status("Accessibility aktif dan siap.");
    }

    private void status(String message) {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(STATUS, message).apply();
    }

    @Override public void onAccessibilityEvent(AccessibilityEvent event) {
        if (handling || event == null || event.getPackageName() == null ||
                !TARGET.contentEquals(event.getPackageName())) return;
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        String pending = prefs.getString("text", "");
        String marker = prefs.getString(REPLY_MARKER, "");
        if (pending.isEmpty() && marker.isEmpty()) return;
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null || root.getPackageName() == null || !TARGET.contentEquals(root.getPackageName())) return;
        handling = true;
        try {
            if (!pending.isEmpty()) {
                attemptOneShotSend(root, prefs, pending);
            } else if (!marker.isEmpty()) {
                captureMarkedReply(root, prefs, marker);
            }
        } finally {
            handling = false;
        }
    }

    private void attemptOneShotSend(AccessibilityNodeInfo root, SharedPreferences prefs, String pending) {
        long at = prefs.getLong("at", 0);
        long age = System.currentTimeMillis() - at;
        if (age < 0 || age > SEND_TIMEOUT_MS) {
            prefs.edit().remove("text").remove("at").remove(REPLY_MARKER)
                    .putString(STATUS, "Auto Kirim kedaluwarsa; kirim manual.").apply();
            return;
        }
        List<AccessibilityNodeInfo> editors = new ArrayList<>();
        findEditors(root, editors);
        if (editors.size() != 1) {
            status("Composer ChatGPT tidak dikenali (jumlah: " + editors.size() + ").");
            return;
        }
        AccessibilityNodeInfo editor = editors.get(0);
        String current = editor.getText() == null ? "" : editor.getText().toString();
        if (!pending.equals(current)) {
            if (!current.isEmpty() || !editor.isEnabled() || !editor.isEditable()) {
                status("Ada draft lain; Auto Kirim dihentikan demi keamanan.");
                return;
            }
            Bundle args = new Bundle();
            args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, pending);
            boolean inserted = editor.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
            status(inserted ? "Prompt disiapkan; menunggu tombol Kirim." : "Gagal memasukkan prompt.");
            return;
        }
        List<AccessibilityNodeInfo> buttons = new ArrayList<>();
        findSendButtons(root, buttons);
        if (buttons.size() != 1) {
            status("Tombol Kirim tidak dikenali (jumlah: " + buttons.size() + ").");
            return;
        }
        prefs.edit().remove("text").remove("at")
                .putString(STATUS, "Menekan Kirim satu kali.").commit();
        boolean clicked = buttons.get(0).performAction(AccessibilityNodeInfo.ACTION_CLICK);
        if (clicked) {
            // ACTION_CLICK returned success; this is not proof the server received a message.
            prefs.edit().putLong(AUTO_SENT_AT, System.currentTimeMillis()).commit();
            if (!prefs.getString(REPLY_MARKER, "").isEmpty()) {
                prefs.edit().putLong(REPLY_STARTED, System.currentTimeMillis()).apply();
                status("Kirim dipicu; menunggu jawaban bertanda dari ChatGPT.");
            } else status("Kirim dipicu; tidak ada permintaan ambil jawaban.");
        } else {
            prefs.edit().remove(REPLY_MARKER).remove(REPLY_STARTED)
                    .putString(STATUS, "Klik Kirim gagal. Kirim manual.").apply();
        }
    }

    private void captureMarkedReply(AccessibilityNodeInfo root, SharedPreferences prefs, String marker) {
        long at = prefs.getLong(REPLY_STARTED, 0);
        long age = System.currentTimeMillis() - at;
        if (at == 0) return; // never capture before send was attempted
        if (age < 0 || age > REPLY_TIMEOUT_MS) {
            prefs.edit().remove(REPLY_MARKER).remove(REPLY_STARTED)
                    .putString(STATUS, "Batas waktu ambil jawaban habis; ambil secara manual.").apply();
            return;
        }
        // Inspect only visible plain text on the current ChatGPT screen, not notifications,
        // other apps, prior chats, or the user's editable composer.
        String prefix = "OCB:" + marker;
        List<String> candidates = new ArrayList<>();
        findMarkedTexts(root, prefix, candidates);
        if (candidates.size() != 1) {
            if (candidates.size() > 1) status("Jawaban bertanda ambigu; perlu verifikasi manual.");
            return;
        }
        String candidate = candidates.get(0);
        int begin = candidate.indexOf(prefix);
        int end = candidate.indexOf(END_TOKEN, begin + prefix.length());
        if (begin < 0 || end < 0) return; // incomplete streaming response
        String answer = candidate.substring(begin + prefix.length(), end).trim();
        if (answer.isEmpty() || answer.length() > 2000) {
            status("Jawaban kosong atau lebih dari 2000 karakter; salin manual.");
            prefs.edit().remove(REPLY_MARKER).remove(REPLY_STARTED).apply();
            return;
        }
        // A reply marker is consumed once. No automatic network upload or callback.
        prefs.edit().putString(CAPTURED_REPLY, answer)
                .putLong(AUTO_CAPTURED_AT, System.currentTimeMillis())
                .remove(REPLY_MARKER).remove(REPLY_STARTED)
                .putString(STATUS, "Jawaban ditemukan. Kembali ke Bridge untuk melihat hasil.")
                .commit();
    }

    private void findMarkedTexts(AccessibilityNodeInfo node, String prefix, List<String> results) {
        if (node == null || results.size() > 1) return;
        if (node.isVisibleToUser() && !node.isEditable()) {
            CharSequence raw = node.getText();
            if (raw != null) {
                String value = raw.toString();
                if (value.contains(prefix)) results.add(value);
            }
        }
        for (int i = 0; i < node.getChildCount(); i++) findMarkedTexts(node.getChild(i), prefix, results);
    }

    private void findEditors(AccessibilityNodeInfo node, List<AccessibilityNodeInfo> found) {
        if (node == null || found.size() > 1) return;
        if (node.isEditable() && node.isVisibleToUser()) found.add(node);
        for (int i = 0; i < node.getChildCount(); i++) findEditors(node.getChild(i), found);
    }
    private void findSendButtons(AccessibilityNodeInfo node, List<AccessibilityNodeInfo> found) {
        if (node == null || found.size() > 1) return;
        CharSequence name = node.getContentDescription();
        if (name == null || name.length() == 0) name = node.getText();
        String label = name == null ? "" : name.toString().trim().toLowerCase(Locale.ROOT);
        String resource = node.getViewIdResourceName();
        String id = resource == null ? "" : resource.toLowerCase(Locale.ROOT);
        boolean recognizedLabel = label.equals("send") || label.equals("send message") ||
                label.equals("kirim") || label.equals("kirim pesan") ||
                label.equals("send prompt") || label.equals("send button");
        boolean recognizedId = id.endsWith(":id/send_button") || id.endsWith(":id/button_send") ||
                id.endsWith(":id/send_message") || id.endsWith(":id/send");
        if ((recognizedLabel || recognizedId) && node.isVisibleToUser() && node.isEnabled()) {
            AccessibilityNodeInfo clickable = node;
            int hops = 0;
            while (!clickable.isClickable() && clickable.getParent() != null && hops++ < 2)
                clickable = clickable.getParent();
            if (clickable.isClickable() && clickable.isEnabled() && !found.contains(clickable)) found.add(clickable);
        }
        for (int i = 0; i < node.getChildCount(); i++) findSendButtons(node.getChild(i), found);
    }
    @Override public void onInterrupt() { status("Accessibility terganggu; periksa hasil manual."); }
}
