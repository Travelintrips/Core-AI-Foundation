import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../app/src/main/java/id/cst/openclawbridge/MainActivity.java',import.meta.url),'utf8');
const manifest=fs.readFileSync(new URL('../app/src/main/AndroidManifest.xml',import.meta.url),'utf8');
const start=source.indexOf('private boolean openDevUrlInChrome(');
const end=source.indexOf('private void rememberPhoneSiteAction(',start);
if(start<0||end<=start)throw Error('Missing DEV Chrome action router');
const launcher=source.slice(start,end);

test('Android DEV opens allowlisted URLs in explicit Chrome package, never generic browser chooser',()=>{
 assert.match(source,/DEV_CHROME_PACKAGE = "com\.android\.chrome"/);
 assert.match(launcher,/new Intent\(Intent\.ACTION_VIEW, destination\)/);
 assert.match(launcher,/browser\.setPackage\(DEV_CHROME_PACKAGE\)/);
 assert.match(launcher,/browser\.resolveActivity\(getPackageManager\(\)\) == null/);
 assert.match(launcher,/startActivity\(browser\)/);
 assert.match(launcher,/AndroidActionReceipt\.supportedUrl\(destination\.toString\(\)\)/);
 assert.match(source,/BUKTI TAMBAHAN MANUAL UNTUK JOB LAMA/);
 assert.match(source,/if \("OPEN_URL"\.equals\(taskKind\) && AndroidActionReceipt\.supportedUrl\(taskTarget\)\)/);
 assert.match(source,/queueAutoDispatchReceipt\(jobId,destination\.toString\(\)\)/);
 assert.match(source,/submitDispatchedSite\(id,event,paired,url\)/);
 assert.match(source,/autoPolling\.setChecked\(true\)/);
 assert.match(source,/if \(!fetchInFlight\) fetchJobForDevice\(false\)/);
 assert.match(source,/retryPendingAutoReceipt\(\)/);
 assert.doesNotMatch(launcher,/Intent\.createChooser/);
 assert.match(manifest,/<package android:name="com\.android\.chrome"\s*\/>/);
});
test('manual retry only re-opens an authorized pending job without new job creation or ACK',()=>{
 const retry=launcher.slice(launcher.indexOf('private void retrySiteInChrome()'));
 assert.match(retry,/getString\("pending_job"/);
 assert.match(retry,/getString\("last_action_job"/);
 assert.match(retry,/getString\("confirmed_job"/);
 assert.match(retry,/openDevUrlInChrome\(id, Uri\.parse\(url\)\)/);
 assert.match(retry,/getString\("pending_target",AndroidActionReceipt\.GITHUB\)/);
 assert.doesNotMatch(retry,/\/android-admin\//);
 assert.doesNotMatch(retry,/post\(/);
});

test('paired DEV app action launches installed WhatsApp or any visible launchable package with automatic receipt',()=>{
 assert.match(source,/AndroidActionReceipt\.supportedApp\(target\)/);
 assert.match(source,/getLaunchIntentForPackage\(taskTarget\)/);
 assert.match(source,/queueAutoDispatchReceipt\(id,taskTarget\)/);
 assert.match(source,/submitDispatchedApp\(id,event,paired,url\)/);
 assert.match(manifest,/<category android:name="android\.intent\.category\.LAUNCHER"\s*\/>/);
 // ChatGPT share flow legitimately uses a chooser; app launches do not.
 assert.doesNotMatch(source.slice(source.indexOf('if ("OPEN_APP".equals(taskKind))'),source.indexOf('new AlertDialog.Builder(this).setTitle("Konfirmasi perintah AI Task DEV")')),/Intent\.createChooser\(/);
});
