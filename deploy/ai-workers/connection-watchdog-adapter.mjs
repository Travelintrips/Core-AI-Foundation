// Fail-closed integration adapter: never resume without an atomic durable claim.
// store.claim(key, job) must be atomic across all replicas and persist before returning.
// runner.resume(job, {key}) must be an authenticated, idempotent runner API.
import { evaluate } from './connection-watchdog.mjs';
export async function tick({jobs, store, runner, now = Date.now(), audit = () => {}}) {
  if (!store || typeof store.claim !== 'function' || typeof store.finish !== 'function') throw new Error('durable claim store required');
  if (!runner || typeof runner.resume !== 'function') throw new Error('authenticated runner required');
  const outcomes = [];
  for (const job of jobs) {
    const decision = evaluate(job, now);
    if (decision.action !== 'RESUME_ELIGIBLE') { outcomes.push({jobId: job?.jobId, ...decision}); continue; }
    const key = decision.key;
    const claimed = await store.claim(key, job);
    if (!claimed) { outcomes.push({jobId:job.jobId, action:'NONE', reason:'claim already owned'}); continue; }
    try {
      const result = await runner.resume(job, {key});
      await store.finish(key, {status:'RESUMED', result});
      audit({jobId:job.jobId, key, status:'RESUMED'});
      outcomes.push({jobId:job.jobId, action:'RESUMED'});
    } catch (error) {
      // Do not release the claim automatically: retry requires a durable state transition.
      await store.finish(key, {status:'ERROR', error:String(error)});
      audit({jobId:job.jobId, key, status:'ERROR'});
      outcomes.push({jobId:job.jobId, action:'ERROR'});
    }
  }
  return outcomes;
}
