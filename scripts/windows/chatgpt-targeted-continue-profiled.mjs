import fs from "node:fs";
import http from "node:http";
import { createHash } from "node:crypto";

const [jobFile] = process.argv.slice(2);
if (!jobFile) throw new Error("Job file required");
const job = JSON.parse(fs.readFileSync(jobFile, "utf8"));

const profile = String(process.env.AI_CORE_CHATGPT_BROWSER_PROFILE || "").trim();
const cdpPort = Number(process.env.AI_CORE_CHATGPT_CDP_PORT || "");
const expectedConversationId = String(process.env.AI_CORE_CHATGPT_EXPECTED_CONVERSATION_ID || "").trim();

if (job.mode !== "chatgpt_continue") throw new Error("Unsupported job mode");
if (!/^[A-Za-z0-9_-]{8,90}$/.test(String(job.jobId || ""))) throw new Error("Invalid job id");
if (typeof job.message !== "string" || job.message.length < 8 || job.message.length > 3000) throw new Error("Invalid job message");
if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(profile)) throw new Error("Invalid profile");
if (!Number.isInteger(cdpPort) || cdpPort < 1024 || cdpPort > 65535) throw new Error("Invalid CDP port");
if (!/^[A-Za-z0-9-]{30,64}$/.test(expectedConversationId)) throw new Error("Invalid expected conversation");

const expectedUrl = "https://chatgpt.com/c/" + expectedConversationId;
if (job.conversationUrl !== expectedUrl) throw new Error("Conversation binding mismatch");

const marker = "ACK_" + job.jobId;
const payload =
  "[AI CORE VERIFIED JOB " + job.jobId + "]\n" +
  job.message +
  "\n\nSertakan kode " + marker + " dalam respons akhir.";

function getTabs() {
  return new Promise((resolve, reject) => {
    http.get("http://127.0.0.1:" + cdpPort + "/json", (r) => {
      let body = "";
      r.on("data", (d) => body += d);
      r.on("end", () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    }).on("error", reject);
  });
}

function cdp(tab, method, params = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error("CDP timeout: " + method));
    }, 30000);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method, params }));
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      if (message.error) reject(new Error(message.error.message || "CDP error"));
      else resolve(message.result);
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("CDP websocket error"));
    };
  });
}

async function evalValue(tab, expression) {
  const result = await cdp(tab, "Runtime.evaluate", { expression, returnByValue: true });
  return result?.result?.value;
}

const pages = (await getTabs()).filter(
  (tab) => tab.type === "page" &&
    tab.url?.startsWith("https://chatgpt.com") &&
    !tab.url.includes("/plugins/"),
);
let tab = pages.find((item) => item.url === expectedUrl) || pages[0];
if (!tab) throw new Error("Authenticated ChatGPT page unavailable");

if (tab.url !== expectedUrl) {
  await cdp(tab, "Page.navigate", { url: expectedUrl });
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const url = await evalValue(tab, "location.href");
    if (url === expectedUrl) break;
    if (i === 19) throw new Error("Exact conversation navigation failed");
  }
}

const markerJson = JSON.stringify(marker);
const bodyBefore = String(await evalValue(tab, "document.body.innerText||''") || "");
if (!bodyBefore.includes("[AI CORE VERIFIED JOB " + job.jobId + "]")) {
  const promptJson = JSON.stringify(payload);
  const prep = "(()=>{const el=document.querySelector('[contenteditable=\\\"true\\\"][role=\\\"textbox\\\"], [contenteditable=\\\"true\\\"][aria-label=\\\"Tanya ChatGPT\\\"], [contenteditable=\\\"true\\\"][aria-label=\\\"Ask ChatGPT\\\"]');if(!el)return false;el.focus();const sel=window.getSelection();const range=document.createRange();range.selectNodeContents(el);sel.removeAllRanges();sel.addRange(range);document.execCommand('insertText',false," + promptJson + ");el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:" + promptJson + "}));return (el.innerText||'').includes(" + markerJson + ");})()";
  if (!(await evalValue(tab, prep))) throw new Error("Failed to populate editor");
  const clicked = await evalValue(
    tab,
    "(()=>{const b=document.querySelector('button[data-testid=\\\"send-button\\\"]')||[...document.querySelectorAll('button')].find(x=>['Kirim','Send'].includes((x.getAttribute('aria-label')||x.innerText||'').trim()));if(!b||b.disabled)return false;b.click();return true;})()",
  );
  if (!clicked) {
    await cdp(tab, "Input.dispatchKeyEvent", {
      type: "keyDown", key: "Enter", code: "Enter",
      windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
    });
    await cdp(tab, "Input.dispatchKeyEvent", {
      type: "keyUp", key: "Enter", code: "Enter",
      windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
    });
  }
}

let evidence = null;
for (let i = 0; i < 120; i += 1) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    const state = await evalValue(
      tab,
      "(()=>{const t=document.body.innerText||'';const busy=!!document.querySelector('button[data-testid=\\\"stop-button\\\"]');const marker=" + markerJson + ";const job='[AI CORE VERIFIED JOB " + job.jobId + "]';const j=t.lastIndexOf(job);if(j<0)return {ok:false,url:location.href,assistantText:''};const ca=t.indexOf('ChatGPT berkata:',j);const cb=t.indexOf('ChatGPT said:',j);const chats=[ca,cb].filter(x=>x>=0);if(!chats.length)return {ok:false,url:location.href,assistantText:''};const chat=Math.min(...chats);const ua=t.indexOf('Anda berkata:',chat+1);const ub=t.indexOf('You said:',chat+1);const users=[ua,ub].filter(x=>x>=0);const end=users.length?Math.min(...users):t.length;let text=t.slice(chat,end);for(const f of ['ChatGPT bisa membuat kesalahan.','ChatGPT can make mistakes.']){const k=text.indexOf(f);if(k>=0)text=text.slice(0,k);}text=text.trim();return {ok:text.includes(marker)&&!busy,url:location.href,assistantText:text};})()",
    );
    if (state?.ok && state.url === expectedUrl) {
      evidence = state;
      break;
    }
  } catch {}
}

if (!evidence?.ok) throw new Error("No verified assistant completion in exact conversation");
const verifiedAt = new Date().toISOString();
const assistantText = String(evidence.assistantText || "").slice(0, 4000);
if (!assistantText.includes(marker)) throw new Error("Verified marker missing from assistant section");
const fingerprint = createHash("sha256")
  .update([job.jobId, expectedConversationId, job.message, assistantText, verifiedAt].join("|"))
  .digest("hex");

console.log(JSON.stringify({
  jobId: job.jobId,
  conversationUrl: expectedUrl,
  profile,
  cdpPort,
  fingerprint,
  verifiedAssistantReply: true,
  verifiedAt,
  marker,
  assistantText,
}));
