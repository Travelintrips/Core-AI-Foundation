import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mocks=vi.hoisted(()=>({
 getTask:vi.fn(),acceptTask:vi.fn(),completeTask:vi.fn(),reassignTask:vi.fn(),
 rejectTask:vi.fn(),assignTask:vi.fn(),listTasks:vi.fn(),getStats:vi.fn(),createTask:vi.fn(),
}));
vi.mock('../../services/humanTaskService.js',()=>mocks);
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
 it('legacy non-lifecycle Human Task remains on existing route without extra session guard',async()=>{
  mocks.getTask.mockResolvedValue({task:{...target,id:7,sourceModule:'generic'},history:[]});
  const r=await request(app).get('/ai/human-tasks/7');expect(r.status).toBe(200);
 });
});
