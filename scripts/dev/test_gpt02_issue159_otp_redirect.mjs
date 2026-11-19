import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(
  new URL("../../deploy/ai-coding-standalone-dev/admin_login.html", import.meta.url),
  "utf8",
);

const getSource = (fn) => {
  const match = html.match(new RegExp("^async function " + fn + "\\(\\)\\{[^\\n]+", "m"));
  assert.ok(match, fn + " must be present");
  return match[0];
};

assert.ok(html.includes("<title>AI Coding DEV | Admin</title>"));
assert.ok(html.includes("const API_PREFIX='/gpt02-approval-api';"));
assert.ok(html.includes("const BASE='https://xssrfshdrtdfupgqwfdw.supabase.co/auth/v1'"));
assert.ok(html.includes("type:'email'"));
assert.ok(!html.includes("grant_type=password"));
assert.ok(!html.includes("verify_mfa"));
assert.ok(!html.includes("bizportal."));
assert.ok(html.includes("Setujui task ini satu kali"));

const requested = [];
let showedOtp = false;
let focusedOtp = false;
const sendContext = {
  el(id) {
    switch (id) {
      case "email": return {
        value: "fixture-admin@example.invalid",
        checkValidity: () => true,
      };
      case "otpStep": return {classList: {remove: (v) => {
        assert.equal(v, "hidden");
        showedOtp = true;
      }}};
      case "otpCode": return {focus: () => {focusedOtp = true;}};
      default: throw Error("Unexpected element ID " + id);
    }
  },
  auth: async (path, data) => {requested.push({path,data}); return {};},
  status: () => {},
  encodeURIComponent,
  location: {origin: "https://dev.cstlogistic.co.id"},
  API_PREFIX: "/gpt02-approval-api",
};
await vm.runInNewContext(getSource("sendOtp") + "\nsendOtp()", sendContext);
assert.equal(requested.length, 1);
assert.equal(requested[0].path,
  "/otp?redirect_to=" +
  encodeURIComponent("https://dev.cstlogistic.co.id/gpt02-approval.html"));
assert.equal(requested[0].data.email, "fixture-admin@example.invalid");
assert.equal(requested[0].data.create_user, false);
assert.equal(showedOtp, true);
assert.equal(focusedOtp, true);

const issuedSession = [];
const cleanedUrl = [];
const authInvocations = [];
const sessionContext = {
  URLSearchParams,
  access: "",
  verified: false,
  location: {
    hash: "#access_token=synthetic-access&refresh_token=synthetic-refresh&token_type=bearer",
    pathname: "/gpt02-approval.html",
    search: "",
  },
  history: {replaceState(_state, _title, url) {cleanedUrl.push(url);}},
  sessionStorage: {
    getItem() {throw Error("Must not read refresh storage before link restore");},
    removeItem() {throw Error("Must not remove refresh storage on successful link");},
  },
  activateSession: async (data) => {issuedSession.push(data);},
  auth: async (...args) => {authInvocations.push(args);},
  status: () => {},
};
await vm.runInNewContext(getSource("restoreSession") + "\nrestoreSession()", sessionContext);
assert.equal(issuedSession.length, 1);
assert.equal(issuedSession[0].access_token, "synthetic-access");
assert.equal(issuedSession[0].refresh_token, "synthetic-refresh");
assert.deepEqual(cleanedUrl, ["/gpt02-approval.html"]);
assert.equal(authInvocations.length, 0);

const fallback = [];
const fallbackContext = {
  URLSearchParams,
  location: {hash: "",pathname: "/gpt02-approval.html",search:""},
  history: {replaceState: () => {throw Error("No fragment to strip");}},
  sessionStorage: {
    getItem(key) { assert.equal(key, "dev_refresh");return "synthetic-existing-refresh"; },
    removeItem() { throw Error("Existing valid session must not be removed"); },
  },
  auth: async (path,data) => {
    fallback.push({path,data});
    return {access_token:"existing-token",refresh_token:"refreshed-token"};
  },
  activateSession: async (data) => {fallback.push({session:data});},
  status: () => {},
  access: "",
  verified: false,
};
await vm.runInNewContext(getSource("restoreSession") + "\nrestoreSession()", fallbackContext);
assert.equal(fallback[0].path, "/token?grant_type=refresh_token");
assert.equal(fallback[0].data.refresh_token, "synthetic-existing-refresh");
assert.equal(fallback[1].session.access_token, "existing-token");

console.log("PASS: canonical GPT02 DEV OTP redirect, email-only login, one-click magic-link hash restore and refresh fallback");
