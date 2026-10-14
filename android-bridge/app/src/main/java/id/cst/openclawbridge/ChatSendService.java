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
    private static final long MAX_AGE_MS = 45000;
    private static final String TARGET = "com.openai.chatgpt";
    private boolean handling;

    @Override public void onAccessibilityEvent(AccessibilityEvent event) {
        if (handling || event == null || event.getPackageName() == null ||
                !TARGET.contentEquals(event.getPackageName())) return;
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        String pending = prefs.getString("text", "");
        long armedAt = prefs.getLong("at", 0);
        if (pending.isEmpty()) return;
        if (System.currentTimeMillis() - armedAt > MAX_AGE_MS || armedAt > System.currentTimeMillis()) {
            prefs.edit().clear().apply();
            return;
        }
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null || root.getPackageName() == null || !TARGET.contentEquals(root.getPackageName())) return;
        handling = true;
        try {
            List<AccessibilityNodeInfo> editors = new ArrayList<>();
            findEditors(root, editors);
            // Never send if another draft exists or no single composer can be identified.
            if (editors.size() != 1) return;
            AccessibilityNodeInfo editor = editors.get(0);
            String current = editor.getText() == null ? "" : editor.getText().toString();
            if (!pending.equals(current)) {
                if (!current.isEmpty() || !editor.isEnabled() || !editor.isEditable()) return;
                Bundle args = new Bundle();
                args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, pending);
                editor.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
                return; // wait for the composer to visibly contain the exact intended prompt
            }
            List<AccessibilityNodeInfo> buttons = new ArrayList<>();
            findSendButtons(root, buttons);
            if (buttons.size() != 1) return;
            AccessibilityNodeInfo button = buttons.get(0);
            // Clear before clicking: another accessibility event must never send twice.
            prefs.edit().clear().commit();
            if (!button.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                android.widget.Toast.makeText(this, "Auto Kirim tidak berhasil. Kirim manual.", android.widget.Toast.LENGTH_LONG).show();
            }
        } finally {
            handling = false;
        }
    }

    private void findEditors(AccessibilityNodeInfo n, List<AccessibilityNodeInfo> out) {
        if (n == null || out.size() > 1) return;
        if (n.isEditable() && n.isVisibleToUser()) out.add(n);
        for (int i = 0; i < n.getChildCount(); i++) findEditors(n.getChild(i), out);
    }
    private void findSendButtons(AccessibilityNodeInfo n, List<AccessibilityNodeInfo> out) {
        if (n == null || out.size() > 1) return;
        if (n.isClickable() && n.isEnabled() && n.isVisibleToUser()) {
            CharSequence label = n.getContentDescription();
            if (label == null) label = n.getText();
            if (label != null) {
                String s = label.toString().trim().toLowerCase(Locale.ROOT);
                if (s.equals("send") || s.equals("send message") ||
                    s.equals("kirim") || s.equals("kirim pesan")) out.add(n);
            }
        }
        for (int i = 0; i < n.getChildCount(); i++) findSendButtons(n.getChild(i), out);
    }
    @Override public void onInterrupt() {}
}
