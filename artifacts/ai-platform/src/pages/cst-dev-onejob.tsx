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
 requiresNewPassword:boolean;secondOwnerApprovalRequired:boolean;
 dispatchPermitted:false;operationalE2EVerified:false;
};
type Stage={
 jobId:number;jobCode:string;requestId:string;status:"waiting";
 expiresAt:string;dispatchPermitted:false;finalAckVerified:false;
};
const DEV_HOST="dev.cstlogistic.co.id";
export default function CstDevOneJobPage(){
 const {user}=useInternalAuth();
 const dev=typeof window!=="undefined"&&window.location.hostname===DEV_HOST;
 const owner=!!user&&user.role==="owner"&&user.status==="active"&&
   user.accountType==="internal"&&!user.mustChangePassword;
 const [submitted,setSubmitted]=useState(false);
 const [loading,setLoading]=useState(false);
 const [result,setResult]=useState<Stage|null>(null);
 const [error,setError]=useState<string|null>(null);
 const readiness=useQuery<Readiness>({
  queryKey:["cst-dev-onejob-owner-stage-readiness"],
  queryFn:()=>apiFetch<Readiness>("/api/ai/dev/onejob/owner-stage-readiness"),
  enabled:dev&&owner,
  retry:false,refetchOnWindowFocus:false,refetchInterval:false,staleTime:0,
 });
 if(!dev||!owner){
  return <div className="p-8 text-sm text-muted-foreground">
   Halaman persetujuan satu job ini hanya untuk Super Admin CST-DEV (role internal owner).
  </div>;
 }
 const ready=readiness.data?.readyForOneOwnerClick===true&&
   readiness.data?.project==="xssrfshdrtdfupgqwfdw"&&
   readiness.data?.companyId==="1"&&!readiness.isFetching&&
   !readiness.isError;
 async function approveOnce(){
  if(!ready||submitted||loading)return;
  // Never auto-retry. If the response is lost, PostgreSQL's one-active
  // constraint prevents a silent second pilot, and Owner must inspect logs.
  setSubmitted(true);setLoading(true);setError(null);
  try{
   const response=await apiFetch<Stage>("/api/ai/dev/onejob/owner-approve-and-stage",{
    method:"POST",
    body:JSON.stringify({intent:"APPROVE_ONE_NEW_CST_DEV_MODEL_JOB"})
   });
   setResult(response);
  }catch(e){
   setError(e instanceof Error?e.message:"Konfirmasi gagal. Periksa status sebelum mencoba kembali.");
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
      bukti QA bertanda tangan, koneksi database khusus, dan satu sesi Super Admin yang sah.
     </p>
     {readiness.isLoading&&<p className="text-sm">Memeriksa kesiapan…</p>}
     {readiness.isError&&<p className="text-sm text-destructive">Pemeriksaan belum dapat dibaca.</p>}
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
       disabled={!ready||submitted||loading} data-testid="approve-one-cst-dev-job">
       {loading?"Mencatat persetujuan…":"Setujui satu job DEV"}
      </Button>
     </div>
     {result&&<div className="text-sm">
      Persetujuan Super Admin telah dicatat. Job <strong>#{result.jobId}</strong>
      {" "}berstatus <strong>WAITING</strong>. Menunggu broker dan pengujian E2E,
      belum dinyatakan PASS.
     </div>}
     {error&&<div className="text-sm text-destructive">
      {error}. Jangan mengulangi klik sebelum status job diperiksa.
     </div>}
     <p className="text-xs text-muted-foreground">
      Persetujuan tidak berlaku untuk job lain. Pengujian E2E baru dinyatakan PASS
      setelah receipt subscriber, empat agen independen, Final ACK, dan relock terbukti.
     </p>
    </CardContent>
   </Card>
  </div>
 );
}
