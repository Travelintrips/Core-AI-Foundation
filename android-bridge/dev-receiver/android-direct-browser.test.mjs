import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../app/src/main/java/id/cst/openclawbridge/MainActivity.java',import.meta.url),'utf8');
const manifest=fs.readFileSync(new URL('../app/src/main/AndroidManifest.xml',import.meta.url),'utf8');
const start=source.indexOf('private boolean openDevUrlInChrome(');
const end=source.indexOf('private void rememberGithubAction(',start);
if(start<0||end<=start)throw Error('Missing DEV Chrome action router');
const launcher=source.slice(start,end);

test('Android DEV opens allowlisted URLs in explicit Chrome package, never generic browser chooser',()=>{
 assert.match(source,/DEV_CHROME_PACKAGE = "com\.android\.chrome"/);
 assert.match(launcher,/new Intent\(Intent\.ACTION_VIEW, destination\)/);
 assert.match(launcher,/browser\.setPackage\(DEV_CHROME_PACKAGE\)/);
 assert.match(launcher,/browser\.resolveActivity\(getPackageManager\(\)\) == null/);
 assert.match(launcher,/startActivity\(browser\)/);
 assert.doesNotMatch(launcher,/Intent\.createChooser/);
 assert.match(manifest,/<package android:name="com\.android\.chrome"\s*\/>/);
});
test('manual retry only re-opens an authorized pending job without new job creation or ACK',()=>{
 const retry=launcher.slice(launcher.indexOf('private void retryGithubInChrome()'));
 assert.match(retry,/getString\("pending_job"/);
 assert.match(retry,/getString\("last_action_job"/);
 assert.match(retry,/getString\("confirmed_job"/);
 assert.match(retry,/openDevUrlInChrome\(id, Uri\.parse\(AndroidActionReceipt\.GITHUB\)\)/);
 assert.doesNotMatch(retry,/\/android-admin\//);
 assert.doesNotMatch(retry,/post\(/);
});
