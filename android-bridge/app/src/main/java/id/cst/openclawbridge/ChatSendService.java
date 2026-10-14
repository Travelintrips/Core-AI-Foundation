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
    private static final long MAX_AGE_MS = 45000;
    private static final String TARGET = "com.openai.chatgpt";
    private boolean handling;

    @Override protected void onServiceConnected() {
        super.onServiceConnected();
        status("Accessibility aktif; siap menerima Auto Kirim.");
    }

    private void status(String message) {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(STATUS, message).apply();
    }

    @Override public void onAccessibilityEvent(AccessibilityEvent event) {
        if (handling || event == null || event.getPackageName() == null ||
                !TARGET.contentEquals(event.getPackageName())) return;
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        String pending = prefs.getString("text", "");
        long armedAt = prefs.getLong("at", 0);
        if (pending.isEmpty()) return;
        long age = System.currentTimeMillis() - armedAt;
        if (age < 0 || age > MAX_AGE_MS) {
            prefs.edit().remove("text").remove("at").putString(STATUS, "Waktu Auto Kirim habis; silakan kirim manual.").apply();
            return;
        }
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null || root.getPackageName() == null || !TARGET.contentEquals(root.getPackageName())) {
            status("Menunggu layar utama ChatGPT.");
            return;
        }
        handling = true;
        try {
            List<AccessibilityNodeInfo> editors = new ArrayList<>();
            findEditors(root, editors);
            if (editors.size() != 1) {
                status("Composer ChatGPT tidak dikenali (jumlah field: " + editors.size() + ").");
                return;
            }
            AccessibilityNodeInfo editor = editors.get(0);
            String current = editor.getText() == null ? "" : editor.getText().toString();
            if (!pending.equals(current)) {
                if (!current.isEmpty() || !editor.isEnabled() || !editor.isEditable()) {
                    status("Terdapat draft lain; Auto Kirim tidak dijalankan demi keamanan.");
                    return;
                }
                Bundle args = new Bundle();
                args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, pending);
                boolean inserted = editor.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
                status(inserted ? "Prompt dimasukkan. Menunggu tombol Kirim." : "Gagal mengisi composer; kirim manual.");
                return;
            }
            List<AccessibilityNodeInfo> buttons = new ArrayList<>();
            findSendButtons(root, buttons);
            if (buttons.size() != 1) {
                status("Prompt cocok, tetapi tombol Kirim belum dikenali (jumlah: " + buttons.size() + ").");
                return;
            }
            AccessibilityNodeInfo button = buttons.get(0);
            // At-most-once attempt: remove request before click to avoid duplicate messages.
            prefs.edit().remove("text").remove("at").putString(STATUS, "Mencoba menekan tombol Kirim sekali.").commit();
            boolean clicked = button.performAction(AccessibilityNodeInfo.ACTION_CLICK);
            status(clicked ? "Tombol Kirim diklik; pastikan pesan tampil di ChatGPT." : "Klik Kirim gagal; silakan kirim manual.");
        } finally {
            handling = false;
        }
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
            while (!clickable.isClickable() && clickable.getParent() != null && hops++ < 2) {
                clickable = clickable.getParent();
            }
            if (clickable.isClickable() && clickable.isEnabled() && !found.contains(clickable)) found.add(clickable);
        }
        for (int i = 0; i < node.getChildCount(); i++) findSendButtons(node.getChild(i), found);
    }

    @Override public void onInterrupt() { status("Accessibility terganggu; Auto Kirim tidak dipastikan."); }
}
