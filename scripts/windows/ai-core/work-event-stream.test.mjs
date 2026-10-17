import assert from 'node:assert/strict';
import test from 'node:test';
import { workEvents } from './work-event-stream.mjs';

test('keepalives do not create work; fragmented events target only their worker', async () => {
 const previous = globalThis.fetch;
 let cancelled = false;
 globalThis.fetch = async () => new Response(new ReadableStream({
  start(controller) {
   const encoder = new TextEncoder();
   for (const text of [': keepalive\n\nevent: re', 'ady\ndata: {"clientId":"pc"}\n\n',
    ': keepalive\n\nevent: work_available\ndata: {"clientId":"pc","commandId":"one"}\n\n'])
     controller.enqueue(encoder.encode(text));
  }, cancel() { cancelled = true; },
 }), {headers:{'content-type':'text/event-stream'}});
 try {
  const events = workEvents('https://dev.invalid/api','test','pc');
  assert.deepEqual((await events.next()).value,{clientId:'pc'});
  assert.deepEqual((await events.next()).value,{clientId:'pc',commandId:'one'});
  await events.return();
  assert.equal(cancelled,true);
 } finally {globalThis.fetch=previous;}
});

test('wrong-worker notifications and non-SSE responses fail closed', async () => {
 const previous = globalThis.fetch;
 try {
  globalThis.fetch = async () => new Response('event: ready\ndata: {"clientId":"other"}\n\n', {headers:{'content-type':'text/event-stream'}});
  await assert.rejects(workEvents('https://dev.invalid','test','pc').next(),/worker mismatch/);
  globalThis.fetch = async () => new Response('{}', {status:503});
  await assert.rejects(workEvents('https://dev.invalid','test','pc').next(),/HTTP 503/);
 } finally {globalThis.fetch=previous;}
});
