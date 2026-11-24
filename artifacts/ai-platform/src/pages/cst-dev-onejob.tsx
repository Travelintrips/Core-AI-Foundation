/**
 * One Super Admin decision for a single CST-DEV job. Core's privileged
 * internal role is called "owner" in the existing DB schema; ordinary
 * "admin"/"manager" are NOT Super Admin. No new login/OTP/second approver.
 * Backend is authoritative; independent technical QA remains mandatory.
 */
import {useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {ShieldAlert,ShieldCheck,RefreshCw} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Card,CardContent,CardHeader,CardTitle} from "@/components/ui/card";
import {apiFetch} from "@/lib/apiFetch";
import {useInternalAuth} from "@/hooks/use-internal-auth";

type Readiness={
 project:string;companyId:string;modelId:string;
 readyForOneOwnerClick:boolean;blockers:string[];
 operationsRootCandidateSha256:string;operationsRootTrusted:false;
 qaTechnicalPreflightAdvisory:boolean;signedQaAdmissionStillRequired:true;
 requiresNewPassword:boolean;secondOwnerApprovalRequired:boolean;
 dispatchPermitted:false;operationalE2EVerified:false;
};
type Stage={
 jobId:number;jobCode:string;requestId:string;status:"waiting";
 expiresAt:string;operationsRootCandidateSha256:string;
 operationsRootTrusted:false;independentQaAdmissionVerified:false;
 dispatchPermitted:false;finalAckVerified:false;
};
type Recovery={
 state:"WAITING_VERIFIED"|"EXPIRED"|"SOURCE_MISMATCH"|
  "JOB_NOT_VISIBLE"|"UNVERIFIED_ROW"|"NOT_VISIBLE"|"UNAVAILABLE";
 jobId:number|null;jobCode:string|null;expiresAt:string|null;
 approvalReadbackVerified:boolean;jobReadbackVerified:boolean;
 rootCandidateAuditMatched:boolean;operationsRootTrusted:false;
 signedReleaseAuthorized:false;
 automaticRetryAllowed:false;dispatchPermitted:false;
 releaseDecision:"NO_GO";
};
const DEV_HOST="dev.cstlogistic.co.id";
export default function CstDevOneJobPage(){
 const {user,logout,loading:authLoading}=useInternalAuth();
 const dev=typeof window!=="undefined"&&window.location.hostname===DEV_HOST;
 const owner=!!user&&user.role==="owner"&&user.status==="active"&&
   user.accountType==="internal"&&!user.mustChangePassword;
 const [submitted,setSubmitted]=useState(false);
 const [loading,setLoading]=useState(false);
 const [result,setResult]=useState<Stage|null>(null);
 const [error,setError]=useState<string|null>(null);
 const [statusLoading,setStatusLoading]=useState(false);
 const [recovered,setRecovered]=useState<Recovery|null>(null);
 const readiness=useQuery<Readiness>({
  queryKey:["cst-dev-onejob-owner-stage-readiness"],
  queryFn:()=>apiFetch<Readiness>("/api/ai/dev/onejob/owner-stage-readiness"),
  enabled:dev&&owner,
  retry:false,refetchOnWindowFocus:false,refetchInterval:false,staleTime:0,
 });
 if(!dev){
  return <div className="p-8 text-sm text-muted-foreground">
   Persetujuan Super Admin — CST-DEV hanya tersedia pada host DEV resmi.
  </div>;
 }
 if(!owner){
  return <div className="mx-auto max-w-xl space-y-4 p-8 text-sm">
   <h1 className="text-xl font-semibold">Persetujuan Super Admin — CST-DEV</h1>
   <p className="text-muted-foreground">
    Halaman persetujuan satu job ini hanya untuk Super Admin CST-DEV (role internal owner).
   </p>
   {authLoading?<p>Memeriksa sesi login…</p>:user?(
    <p>Sesi saat ini: <strong>{user.email}</strong> dengan role
     {" "}<strong>{user.role}</strong>. Akun ini tidak memiliki hak persetujuan satu job.
    </p>
   ):<p>Belum ada sesi internal yang aktif.</p>}
   <p className="text-muted-foreground">
    Gunakan akun internal <strong>owner</strong> melalui link login email yang sudah ada.
    Role admin dan manager tidak otomatis menjadi Super Admin.
   </p>
   {user?<Button variant="outline" disabled={loading}
    onClick={()=>void logout()
      .then(()=>window.location.assign("/login"))
      .catch(()=>setError("Gagal keluar. Silakan gunakan halaman login yang sudah tersedia."))}>
    Ganti akun melalui link login email
   </Button>:<a className="underline" href="/login">Masuk melalui link login email</a>}
   {error&&<p className="text-destructive">{error}</p>}
   <p className="text-muted-foreground">
    Preview masih baca-saja. Tidak ada job atau persetujuan yang dibuat otomatis.
   </p>
  </div>;
 }
 // A static read-only preview is the correct approval location, but never
 // evidence that the live staging POST can be used. Keep one-click disabled.
 const previewOnly=readiness.data?.blockers?.includes("READONLY_PREVIEW_ONLY")===true;
 const ready=readiness.data?.readyForOneOwnerClick===true&&
   readiness.data?.project==="xssrfshdrtdfupgqwfdw"&&
   readiness.data?.companyId==="1"&&!readiness.isFetching&&
   !readiness.isError;
 async function checkPreviousApproval(){
  if(!ready||statusLoading)return null;
  setStatusLoading(true);
  try{
   // Only GET. Never repeat the POST after an uncertain response.
   const r=await apiFetch<Recovery>("/api/ai/dev/onejob/owner-stage-status");
   setRecovered(r);
   if(r.state==="WAITING_VERIFIED"&&r.jobId){
    setSubmitted(true);
    setError(null);
   }
   return r;
  }catch{
   setError("Status persetujuan sebelumnya belum dapat dipastikan. Jangan mengulangi persetujuan.");
   return null;
  }finally{setStatusLoading(false);}
 }
 async function approveOnce(){
  if(!ready||submitted||loading)return;
  // Never auto-retry. If the response is lost, PostgreSQL's one-active
  // constraint prevents a silent second pilot, and Owner must inspect logs.
  setSubmitted(true);setLoading(true);setError(null);
  try{
   const response=await apiFetch<Stage>("/api/ai/dev/onejob/owner-approve-and-stage",{
    method:"POST",
    body:JSON.stringify({
     intent:"APPROVE_ONE_NEW_CST_DEV_MODEL_JOB",
     operationsRootFingerprint:readiness.data?.operationsRootCandidateSha256,
   })
   });
   setResult(response);
   setRecovered(null);
  }catch{
   // Lost HTTP response may mean the DB transaction committed. Read back
   // through the authenticated scoped GET, NEVER replay the POST.
   const recovery=await checkPreviousApproval();
   if(recovery?.state!=="WAITING_VERIFIED"){
    setError("Respons persetujuan tidak pasti. Status sudah diperiksa satu kali; jangan klik Setujui ulang.");
   }
  }finally{setLoading(false);}
 }
 return (
  <div className="mx-auto max-w-3xl space-y-5 p-6 md:p-8">
   <div>
    <h1 className="text-2xl font-bold">Persetujuan Super Admin — CST-DEV</h1>
    <p className="mt-2 text-sm text-muted-foreground">
     Cukup satu persetujuan Super Admin untuk satu job baru Company 1.
     Tidak memerlukan persetujuan manusia kedua dan tidak mengaktifkan PROD,
     signer atau dispatch secara otomatis.
    </p>
   </div>
   <Card>
    <CardHeader>
     <CardTitle className="flex items-center gap-2 text-base">
      {ready?<ShieldCheck className="size-5"/>:<ShieldAlert className="size-5"/>}
      {ready?"Persiapan teknis terverifikasi":"Belum siap meminta persetujuan"}
     </CardTitle>
    </CardHeader>
    <CardContent className="space-y-4">
     <p className="text-sm text-muted-foreground">
      Model: qwen2.5:3b · Company 1 · CST-DEV. Verifikasi kesiapan menggunakan
      koneksi database khusus dan satu sesi Super Admin yang sah.
     Bukti QA bertanda tangan tetap wajib sebelum job masuk antrean,
     bukan sebelum pembuatan job WAITING.
     </p>
     {readiness.data?.operationsRootCandidateSha256&&(
      <div className="rounded-md border p-3 text-xs">
       <p>Kunci Operations kandidat yang termasuk dalam satu persetujuan ini:</p>
       <p className="mt-1 break-all font-mono" data-testid="onejob-ops-candidate-fingerprint">
        {readiness.data.operationsRootCandidateSha256}
       </p>
       <p className="mt-2 text-muted-foreground">
        Kunci ini belum dipercaya untuk menandatangani izin. Persetujuan
        hanya mencatat pilihan kandidat bersama satu job WAITING.
       </p>
      </div>
     )}
     {readiness.isLoading&&<p className="text-sm">Memeriksa kesiapan…</p>}
     {readiness.isError&&<p className="text-sm text-destructive">Pemeriksaan belum dapat dibaca.</p>}
     {previewOnly&&(
      <div className="rounded-md border p-3 text-sm" role="status"
       data-testid="onejob-preview-only">
       <p className="font-semibold">Ini halaman persetujuan yang benar, tetapi masih baca-saja.</p>
       <p className="mt-2 text-muted-foreground">
        Tombol Setujui satu job DEV belum bisa digunakan karena layanan staging,
        kredensial watchdog, dan pengujian relock belum diaktifkan secara resmi.
        Tidak ada persetujuan atau job yang dibuat dari pratinjau ini.
        Setelah pemeriksaan teknis PASS, cukup satu persetujuan Super Admin.
       </p>
      </div>
     )}
     {Array.isArray(readiness.data?.blockers)&&readiness.data!.blockers.length>0&&(
      <div className="text-xs text-muted-foreground">
       <p>Persyaratan teknis yang belum terpenuhi:</p>
       <ul className="mt-2 list-inside list-disc space-y-1 font-mono">
        {readiness.data!.blockers.map(code=><li key={code}>{code}</li>)}
       </ul>
      </div>
     )}
     <div className="flex flex-wrap gap-3">
      <Button variant="outline" disabled={loading||submitted||readiness.isFetching}
       onClick={()=>void readiness.refetch()}>
       <RefreshCw className="mr-2 size-4"/> Periksa kesiapan
      </Button>
      <Button onClick={()=>void approveOnce()}
       disabled={!ready||submitted||loading||statusLoading} data-testid="approve-one-cst-dev-job">
       {loading?"Mencatat persetujuan…":"Setujui satu job DEV"}
      </Button>
      <Button variant="outline" disabled={!ready||loading||statusLoading}
       onClick={()=>void checkPreviousApproval()}
       data-testid="read-onejob-approval-status">
       {statusLoading?"Memeriksa status…":"Periksa status job sebelumnya"}
      </Button>
     </div>
     {result&&<div className="text-sm">
      Persetujuan Super Admin telah dicatat. Job <strong>#{result.jobId}</strong>
      {" "}berstatus <strong>WAITING</strong>. Menunggu broker dan pengujian E2E,
      belum dinyatakan PASS. Kunci Operations tetap belum aktif; bukti QA
      dan izin admission wajib diverifikasi sebelum job dijalankan.
     </div>}
     {recovered?.state==="WAITING_VERIFIED"&&(
      <div className="text-sm" data-testid="onejob-recovered-waiting">
       Hasil persetujuan sebelumnya sudah terverifikasi dalam database:
       job <strong>#{recovered.jobId}</strong> berstatus
       <strong> WAITING</strong>. Tidak ada persetujuan kedua dikirim.
       Bukti audit Operations
       <strong>{recovered.rootCandidateAuditMatched?" cocok":" belum terverifikasi"}</strong>.
       Kunci Operations masih belum dipercaya; signer, admission,
       dan dispatch tetap terkunci.
      </div>
     )}
     {recovered&&recovered.state!=="WAITING_VERIFIED"&&(
      <div className="text-sm text-muted-foreground">
       Pemeriksaan status: <strong>{recovered.state}</strong>.
       Pembaca terbatas belum dapat membuktikan job WAITING yang sah.
       Hasil ini bukan izin mengulangi persetujuan atau menjalankan job.
      </div>
     )}
     {error&&<div className="text-sm text-destructive">
      {error}
     </div>}
     <p className="text-xs text-muted-foreground">
      Jika respons jaringan hilang, gunakan Periksa status job sebelumnya;
      jangan kirim ulang persetujuan. Pengujian E2E baru dinyatakan PASS
      setelah receipt subscriber, empat agen independen, Final ACK, dan relock terbukti.
     </p>
    </CardContent>
   </Card>
  </div>
 );
}
