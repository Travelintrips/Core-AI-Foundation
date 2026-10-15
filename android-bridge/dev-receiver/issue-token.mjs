// Run only on trusted DEV host with BRIDGE_DEVICE_HMAC_SECRET set; never embed this secret in Android.
import crypto from 'node:crypto';
const [jobId] = process.argv.slice(2);
if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(jobId || '')) throw Error('Pass valid job UUID');
const secret=process.env.BRIDGE_DEVICE_HMAC_SECRET || '';
if (Buffer.byteLength(secret)<32) throw Error('Missing strong secret');
const payload={scope:'android-result:submit',jobId,exp:Date.now()+5*60*1000,nonce:crypto.randomBytes(18).toString('hex')};
const body=Buffer.from(JSON.stringify(payload)).toString('base64url');
const sig=crypto.createHmac('sha256',secret).update(body).digest('base64url');
process.stdout.write(body+'.'+sig+'\n');
