import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mocks=vi.hoisted(()=>({
 getTask:vi.fn(),acceptTask:vi.fn(),completeTask:vi.fn(),reassignTask:vi.fn(),
 rejectTask:vi.fn(),assignTask:vi.fn(),listTasks:vi.fn(),getStats:vi.fn(),createTask:vi.fn(),
}));
vi.mock('../../services/humanTaskService.js',()=>mocks);
const decisionMocks=vi.hoisted(()=>({recordHumanRecoveryRecommendation:vi.fn()}));
vi.mock('../../services/humanRecoveryDecisionService.js',()=>decisionMocks);
const prototypeMocks=vi.hoisted(()=>({recordGpt02PrototypeIntegrity:vi.fn()}));
vi.mock('../../services/gpt02PrototypeEvidenceAudit.js',()=>prototypeMocks);
const reservationMocks=vi.hoisted(()=>({reserveGpt02DevRecoveryAttempt:vi.fn()}));
vi.mock('../../services/gpt02DevRecoveryReservation.js',()=>reservationMocks);
const preflightMocks=vi.hoisted(()=>({getGpt02DevReservationPreflight:vi.fn()}));
vi.mock('../../services/gpt02DevReservationPreflight.js',()=>preflightMocks);
const timelineMocks=vi.hoisted(()=>({getGpt02Job135TimelineReadback:vi.fn()}));
vi.mock('../../services/gpt02Job135TimelineReadback.js',()=>timelineMocks);

vi.mock('../../middleware/ssrfGuard.js',()=>({ssrfGuard:()=> (_req:unknown,_res:unknown,next:()=>void)=>next()}));
vi.mock('../../middleware/internalAuth.js',()=>({
 requireAuth:async(req:any,res:any,next:()=>void)=>{
  const session=req.headers['x-isolated-test-session'];
  if(!session){res.status(401).json({error:'No test session'});return;}
  req.internalUser={id:session==='admin'?2:99,email:session==='admin'?'admcst001@gmail.com':'other@example.test',role:session==='admin'||session==='other-admin'?'admin':'viewer',status:'active',accountType:'internal',mustChangePassword:false};
  next();
 },
 requireInternalRole:(...roles:string[])=>async(req:any,res:any,next:()=>void)=>{
  if(!roles.includes(req.internalUser?.role)){res.status(403).json({error:'Forbidden test role'});return;}next();
 },
 requirePasswordChanged:(req:any,res:any,next:()=>void)=>req.internalUser?.mustChangePassword?res.sendStatus(403):next(),
}));
import humanRouter from '../human-tasks.js';
const app=express();app.use(express.json());app.use(humanRouter);
const target={id:6,taskCode:'HT-RECOVERY-C6B087F2-6F6',sourceModule:'ai_core_lifecycle',assignedUser:'admcst001@gmail.com',status:'assigned'};
const url='/ai/human-tasks/6';
function act(session:string,origin='http://127.0.0.1:7777'){
 let req=request(app).patch(url+'/accept').set('Host','127.0.0.1:7777').set('x-isolated-test-session',session);
 if(origin)req=req.set('Origin',origin);
 return req.send({performedBy:'forged@example.test',notes:'isolated test only'});
}
describe('AI Core lifecycle Human Review authorization (isolated app, mocked identity and DB)',()=>{
 const oldNode=process.env.NODE_ENV;const oldApp=process.env.APP_ENV;
 beforeEach(()=>{
  process.env.NODE_ENV='development';delete process.env.APP_ENV;
  vi.clearAllMocks();mocks.getTask.mockResolvedValue({task:target,history:[]});
  mocks.acceptTask.mockImplementation(async(_id:number,p:any)=>({...target,status:'accepted',actor:p.performedBy}));
 });
 afterEach(()=>{process.env.NODE_ENV=oldNode; if(oldApp===undefined)delete process.env.APP_ENV;else process.env.APP_ENV=oldApp;});
 it('anonymous GET to lifecycle review denied (401)',async()=>{
  const r=await request(app).get(url);expect(r.status).toBe(401);
 });
 it('anonymous Accept denied and never reaches mutation',async()=>{
  const r=await request(app).patch(url+'/accept').set('Origin','http://127.0.0.1:7777').send({});expect(r.status).toBe(401);expect(mocks.acceptTask).not.toHaveBeenCalled();
 });
 it('unassigned viewer denied (403), no mutation',async()=>{
  const r=await act('viewer');expect(r.status).toBe(403);expect(mocks.acceptTask).not.toHaveBeenCalled();
 });
 it('active admin who is not assigned reviewer is rejected (403)',async()=>{
  const r=await act('other-admin');expect(r.status).toBe(403);expect(r.body.error).toBe('ASSIGNED_HUMAN_REVIEWER_REQUIRED');expect(mocks.acceptTask).not.toHaveBeenCalled();
 });
 it('valid assigned admin session may read review',async()=>{
  const r=await request(app).get(url).set('x-isolated-test-session','admin');expect(r.status).toBe(200);expect(r.body.task.id).toBe(6);
 });
 it('assigned admin Accept uses server identity, not performedBy from client',async()=>{
  const r=await act('admin');expect(r.status).toBe(200);expect(r.body.actor).toBe('admcst001@gmail.com');expect(mocks.acceptTask).toHaveBeenCalledWith(6,expect.objectContaining({performedBy:'admcst001@gmail.com'}));
 });
 it('assigned admin with missing Origin denied',async()=>{
  const r=await act('admin','');expect(r.status).toBe(403);expect(mocks.acceptTask).not.toHaveBeenCalled();
 });
 it('assigned admin with cross-site Origin denied',async()=>{
  const r=await act('admin','https://evil.example');expect(r.status).toBe(403);expect(mocks.acceptTask).not.toHaveBeenCalled();
 });
 it('production fails closed even for assigned admin',async()=>{
  process.env.APP_ENV='production';const r=await act('admin');expect(r.status).toBe(403);expect(mocks.acceptTask).not.toHaveBeenCalled();
 });
 it('generic Complete cannot mark GPT02 Human Review as completed',async()=>{
   mocks.getTask.mockResolvedValue({task:{...target,status:'accepted'},history:[]});
   const r=await request(app).patch(url+'/complete').set('Host','127.0.0.1:7777')
     .set('Origin','http://127.0.0.1:7777').set('x-isolated-test-session','admin')
     .send({notes:'All good'});
   expect(r.status).toBe(409);
   expect(r.body.error).toBe('LIFECYCLE_RECOVERY_CANNOT_COMPLETE_GENERICALLY');
   expect(mocks.completeTask).not.toHaveBeenCalled();
 });
 it('recovery recommendation denies anonymous and unassigned admins',async()=>{
   mocks.getTask.mockResolvedValue({task:{...target,status:'accepted'},history:[]});
   const payload={commandId:'83db99f5-cbda-4e60-be71-3090fb411bbb',jobId:135,
     decision:'recommend_new_attempt',notes:'Evidence verified. Recommend a fresh guarded DEV run.'};
   const anonymous=await request(app).post(url+'/recovery-recommendation').set('Origin','http://127.0.0.1:7777').send(payload);
   expect(anonymous.status).toBe(401);
   const other=await request(app).post(url+'/recovery-recommendation').set('Host','127.0.0.1:7777')
     .set('Origin','http://127.0.0.1:7777').set('x-isolated-test-session','other-admin').send(payload);
   expect(other.status).toBe(403);
   expect(decisionMocks.recordHumanRecoveryRecommendation).not.toHaveBeenCalled();
 });
 it('recovery recommendation assigned reviewer has controlled server-side actor, no dispatch',async()=>{
   mocks.getTask.mockResolvedValue({task:{...target,status:'accepted'},history:[]});
   decisionMocks.recordHumanRecoveryRecommendation.mockResolvedValueOnce({
     ok:true,historyId:19,decision:'recommend_new_attempt',dispatchAuthorized:false,resumeAllowed:false,
   });
   const r=await request(app).post(url+'/recovery-recommendation').set('Host','127.0.0.1:7777')
     .set('Origin','http://127.0.0.1:7777').set('x-isolated-test-session','admin')
     .send({commandId:'83db99f5-cbda-4e60-be71-3090fb411bbb',jobId:135,
       decision:'recommend_new_attempt',notes:'Verified original artifact and safety limits.',performedBy:'forged'});
   expect(r.status).toBe(400);
   expect(decisionMocks.recordHumanRecoveryRecommendation).not.toHaveBeenCalled();
   const valid=await request(app).post(url+'/recovery-recommendation').set('Host','127.0.0.1:7777')
     .set('Origin','http://127.0.0.1:7777').set('x-isolated-test-session','admin')
     .send({commandId:'83db99f5-cbda-4e60-be71-3090fb411bbb',jobId:135,
       decision:'recommend_new_attempt',notes:'Verified original artifact and safety limits.'});
   expect(valid.status).toBe(201);
   expect(valid.body).toMatchObject({dispatchAuthorized:false,resumeAllowed:false});
   expect(decisionMocks.recordHumanRecoveryRecommendation).toHaveBeenCalledWith(expect.objectContaining({
     actor:'admcst001@gmail.com',humanTaskId:6,jobId:135,
   }));
 });
 it('recovery recommendation is blocked cross-origin and in PROD',async()=>{
   mocks.getTask.mockResolvedValue({task:{...target,status:'accepted'},history:[]});
   const send=()=>({commandId:'83db99f5-cbda-4e60-be71-3090fb411bbb',jobId:135,
     decision:'deny_new_attempt',notes:'Unsafe to replay this command without proof.'});
   const cross=await request(app).post(url+'/recovery-recommendation').set('Host','127.0.0.1:7777')
     .set('Origin','https://other.example').set('x-isolated-test-session','admin').send(send());
   expect(cross.status).toBe(403);
   process.env.APP_ENV='production';
   const prod=await request(app).post(url+'/recovery-recommendation').set('Host','127.0.0.1:7777')
     .set('Origin','http://127.0.0.1:7777').set('x-isolated-test-session','admin').send(send());
   expect(prod.status).toBe(403);
   expect(decisionMocks.recordHumanRecoveryRecommendation).not.toHaveBeenCalled();
 });
 it('prototype upload enforces reviewer session, origin, strict body and DEV only',async()=>{
   mocks.getTask.mockResolvedValue({task:{...target,status:'accepted'},history:[]});
   const payload={jobId:135,commandId:'83db99f5-cbda-4e60-be71-3090fb411bbb',
     manifest:{jobId:135},artifactBase64:'YWJj'};
   const send=(session?:string,origin='http://127.0.0.1:7777')=>{
     let r=request(app).post(url+'/prototype-integrity')
       .set('Host','127.0.0.1:7777').set('Origin',origin);
     if(session)r=r.set('x-isolated-test-session',session);
     return r.send(payload);
   };
   expect((await send()).status).toBe(401);
   expect((await send('other-admin')).status).toBe(403);
   expect((await send('admin','https://evil.example')).status).toBe(403);
   const bad=await request(app).post(url+'/prototype-integrity')
     .set('Host','127.0.0.1:7777').set('Origin','http://127.0.0.1:7777')
     .set('x-isolated-test-session','admin').send({...payload,performedBy:'forged'});
   expect(bad.status).toBe(400);
   expect(prototypeMocks.recordGpt02PrototypeIntegrity).not.toHaveBeenCalled();
   process.env.APP_ENV='production';
   expect((await send('admin')).status).toBe(403);
   expect(prototypeMocks.recordGpt02PrototypeIntegrity).not.toHaveBeenCalled();
 });
 it('valid reviewer prototype upload can record digest without dispatch',async()=>{
   mocks.getTask.mockResolvedValue({task:{...target,status:'accepted'},history:[]});
   prototypeMocks.recordGpt02PrototypeIntegrity.mockResolvedValueOnce({
     ok:true,auditId:15,alreadyRecorded:false,sha256:'a'.repeat(64),bytes:123,
     operationalIntegrationVerified:false,mayCreateCommand:false,
     mayDispatchWorker:false,mayCloseJob:false,
   });
   const r=await request(app).post(url+'/prototype-integrity')
     .set('Host','127.0.0.1:7777').set('Origin','http://127.0.0.1:7777')
     .set('x-isolated-test-session','admin')
     .send({jobId:135,commandId:'83db99f5-cbda-4e60-be71-3090fb411bbb',
       manifest:{jobId:135},artifactBase64:'YWJj'});
   expect(r.status).toBe(201);
   expect(r.body).toMatchObject({mayCreateCommand:false,mayDispatchWorker:false,
     mayCloseJob:false});
   expect(prototypeMocks.recordGpt02PrototypeIntegrity).toHaveBeenCalledWith(
     expect.objectContaining({humanReviewId:6,actor:'admcst001@gmail.com',jobId:135}));
 });
 it('reservation endpoint defaults OFF, no service invocation',async()=>{
   mocks.getTask.mockResolvedValue({task:{...target,status:'accepted'},history:[]});
   delete process.env.AI_CORE_DEV_GPT02_RESERVATIONS_ENABLED;
   const r=await request(app).post(url+'/recovery-reservation')
     .set('Host','127.0.0.1:7777').set('Origin','http://127.0.0.1:7777')
     .set('x-isolated-test-session','admin').send({
       parentCommandId:'83db99f5-cbda-4e60-be71-3090fb411bbb',
       jobId:135,idempotencyKey:'2ba38abd-33bb-4459-9f3c-1fc280752a83'});
   expect(r.status).toBe(403);
   expect(r.body.error).toBe('RESERVATION_FEATURE_DISABLED');
   expect(reservationMocks.reserveGpt02DevRecoveryAttempt).not.toHaveBeenCalled();
 });
 it('reservation denies anonymous, other reviewer, cross-origin and production',async()=>{
   mocks.getTask.mockResolvedValue({task:{...target,status:'accepted'},history:[]});
   process.env.AI_CORE_DEV_GPT02_RESERVATIONS_ENABLED='true';
   const payload={parentCommandId:'83db99f5-cbda-4e60-be71-3090fb411bbb',
     jobId:135,idempotencyKey:'2ba38abd-33bb-4459-9f3c-1fc280752a83'};
   const send=(session?:string,origin='http://127.0.0.1:7777')=>{
     let r=request(app).post(url+'/recovery-reservation')
       .set('Host','127.0.0.1:7777').set('Origin',origin);
     if(session)r=r.set('x-isolated-test-session',session);
     return r.send(payload);
   };
   expect((await send()).status).toBe(401);
   expect((await send('other-admin')).status).toBe(403);
   expect((await send('admin','https://evil.example')).status).toBe(403);
   process.env.APP_ENV='production';
   expect((await send('admin')).status).toBe(403);
   expect(reservationMocks.reserveGpt02DevRecoveryAttempt).not.toHaveBeenCalled();
   delete process.env.AI_CORE_DEV_GPT02_RESERVATIONS_ENABLED;
 });
 it('reservation rejects forged actor, invalid body and non-DEV host',async()=>{
   mocks.getTask.mockResolvedValue({task:{...target,status:'accepted'},history:[]});
   process.env.AI_CORE_DEV_GPT02_RESERVATIONS_ENABLED='true';
   const payload={parentCommandId:'83db99f5-cbda-4e60-be71-3090fb411bbb',
     jobId:135,idempotencyKey:'2ba38abd-33bb-4459-9f3c-1fc280752a83'};
   const r=await request(app).post(url+'/recovery-reservation')
     .set('Host','127.0.0.1:7777').set('Origin','http://127.0.0.1:7777')
     .set('x-isolated-test-session','admin').send({...payload,actor:'forged'});
   expect(r.status).toBe(403); // host is not DEV; do not enter service
   expect(reservationMocks.reserveGpt02DevRecoveryAttempt).not.toHaveBeenCalled();
   delete process.env.AI_CORE_DEV_GPT02_RESERVATIONS_ENABLED;
 });
 it('valid DEV reviewer reservation uses server identity, remains non-executable',async()=>{
   mocks.getTask.mockResolvedValue({task:{...target,status:'accepted'},history:[]});
   process.env.AI_CORE_DEV_GPT02_RESERVATIONS_ENABLED='true';
   const payload={parentCommandId:'83db99f5-cbda-4e60-be71-3090fb411bbb',
     jobId:135,idempotencyKey:'2ba38abd-33bb-4459-9f3c-1fc280752a83'};
   const send=(body:unknown)=>request(app).post(url+'/recovery-reservation')
     .set('Host','dev.cstlogistic.co.id')
     .set('Origin','https://dev.cstlogistic.co.id')
     .set('x-isolated-test-session','admin').send(body);
   const bad=await send({...payload,actor:'spoofed@example.test'});
   expect(bad.status).toBe(400);
   expect(reservationMocks.reserveGpt02DevRecoveryAttempt).not.toHaveBeenCalled();
   reservationMocks.reserveGpt02DevRecoveryAttempt.mockResolvedValueOnce({
     ok:true,alreadyReserved:false,
     reservationId:'f29a546e-9ee9-4262-a25a-3bcf2b38d53f',
     candidateCommandId:'28a12988-1418-4b66-8be9-de3d66cac1ce',
     mayCreateCommand:false,mayDispatchWorker:false,mayCloseJob:false,
   });
   const valid=await send(payload);
   expect(valid.status).toBe(201);
   expect(valid.body).toMatchObject({
     mayCreateCommand:false,mayDispatchWorker:false,mayCloseJob:false,
   });
   expect(reservationMocks.reserveGpt02DevRecoveryAttempt).toHaveBeenCalledWith(
     expect.objectContaining({actor:'admcst001@gmail.com',humanReviewId:6,jobId:135}));
   expect(valid.headers['cache-control']).toBe('no-store');
   delete process.env.AI_CORE_DEV_GPT02_RESERVATIONS_ENABLED;
 });
 it('reservation preflight protects session, host, input and actor',async()=>{
   mocks.getTask.mockResolvedValue({task:{...target,status:'accepted'},history:[]});
   const path=url+'/recovery-reservation-preflight?parentCommandId=83db99f5-cbda-4e60-be71-3090fb411bbb&jobId=135';
   expect((await request(app).get(path).set('Host','dev.cstlogistic.co.id')).status).toBe(401);
   expect((await request(app).get(path).set('Host','other.example').set('x-isolated-test-session','admin')).status).toBe(403);
   expect((await request(app).get(path+'&actor=forged').set('Host','dev.cstlogistic.co.id').set('x-isolated-test-session','admin')).status).toBe(400);
   expect(preflightMocks.getGpt02DevReservationPreflight).not.toHaveBeenCalled();
 });
 it('valid reviewer receives read-only preflight without grant',async()=>{
   mocks.getTask.mockResolvedValue({task:{...target,status:'accepted'},history:[]});
   preflightMocks.getGpt02DevReservationPreflight.mockResolvedValueOnce({ok:true,reason:'SNAPSHOT_ONLY_NO_RESERVATION',prerequisiteSnapshotClear:true,reservationCreated:false,commandCreated:false,mayCreateCommand:false,mayDispatchWorker:false,mayCloseJob:false});
   const r=await request(app).get(url+'/recovery-reservation-preflight?parentCommandId=83db99f5-cbda-4e60-be71-3090fb411bbb&jobId=135').set('Host','dev.cstlogistic.co.id').set('x-isolated-test-session','admin');
   expect(r.status).toBe(200);
   expect(r.body).toMatchObject({reservationCreated:false,mayCreateCommand:false,mayDispatchWorker:false,mayCloseJob:false});
   expect(preflightMocks.getGpt02DevReservationPreflight).toHaveBeenCalledWith(expect.objectContaining({actor:'admcst001@gmail.com',humanReviewId:6,jobId:135}));
 });
 it('DEV GPT02 timeline readback is authenticated, role guarded and host restricted',async()=>{
   mocks.getTask.mockResolvedValue({task:{...target,status:'accepted'},history:[]});
   const path=url+'/gpt02-timeline?parentCommandId=83db99f5-cbda-4e60-be71-3090fb411bbb&jobId=135';
   expect((await request(app).get(path).set('Host','dev.cstlogistic.co.id')).status).toBe(401);
   expect((await request(app).get(path).set('Host','dev.cstlogistic.co.id')
     .set('x-isolated-test-session','viewer')).status).toBe(403);
   expect((await request(app).get(path).set('Host','other.example')
     .set('x-isolated-test-session','admin')).status).toBe(403);
   expect((await request(app).get(path+'&issuer=true').set('Host','dev.cstlogistic.co.id')
     .set('x-isolated-test-session','admin')).status).toBe(400);
   expect(timelineMocks.getGpt02Job135TimelineReadback).not.toHaveBeenCalled();
 });
 it('DEV GPT02 timeline uses server readback and never grants dispatch',async()=>{
   mocks.getTask.mockResolvedValue({task:{...target,status:'accepted'},history:[]});
   timelineMocks.getGpt02Job135TimelineReadback.mockResolvedValueOnce({
     ok:true,reviewOnly:true,jobId:135,progressPercent:null,
     mayDispatchWorker:false,mayCloseJob:false,
   });
   const path=url+'/gpt02-timeline?parentCommandId=83db99f5-cbda-4e60-be71-3090fb411bbb&jobId=135';
   const response=await request(app).get(path).set('Host','dev.cstlogistic.co.id')
     .set('x-isolated-test-session','admin');
   expect(response.status).toBe(200);
   expect(response.headers['cache-control']).toBe('no-store');
   expect(response.body).toMatchObject({progressPercent:null,mayDispatchWorker:false,
     mayCloseJob:false});
   expect(timelineMocks.getGpt02Job135TimelineReadback).toHaveBeenCalledWith({
     humanReviewId:6,jobId:135,parentCommandId:'83db99f5-cbda-4e60-be71-3090fb411bbb',
   });
 });
 it('legacy non-lifecycle Human Task remains on existing route without extra session guard',async()=>{
  mocks.getTask.mockResolvedValue({task:{...target,id:7,sourceModule:'generic'},history:[]});
  const r=await request(app).get('/ai/human-tasks/7');expect(r.status).toBe(200);
 });
});
