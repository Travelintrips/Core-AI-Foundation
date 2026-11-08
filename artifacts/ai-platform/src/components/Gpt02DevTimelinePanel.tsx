/**
 * On-demand, read-only DEV timeline. No polling and no execution controls.
 * Explicit errors avoid misleading green status for failed/missing readback.
 */
import {useState} from "react";
import {Button} from "@/components/ui/button";
import {RefreshCw} from "lucide-react";

export type Gpt02TimelineReadback = {
  ok:boolean; reviewOnly?:boolean; reason?:string;
  jobId?:number; accountableOwner?:string|null; assignedWorkerId?:string|null;
  status?:string; lastEventKind?:string|null; lastEventId?:string|null;
  lastEventAt?:string|null; observedEventCount?:number;
  blockerResponseId?:string|null; lastNativeAckVerified?:boolean;
  progressPercent?:number|null;
  reservationReadbackStatus?:string; reservationEvidenceVerified?:boolean;
  mayDispatchWorker?:boolean;
  mayCloseJob?:boolean; eligibleForCompletionReview?:boolean;
  crossLedger?:{valid:boolean;reason:string;parentEventCount?:number;
    explicitJobEventCount?:number;taggedChildCount?:number;
    reviewRecordCount?:number;legacyUntaggedAttemptsExcluded:false;
    mayCreateCommand:false;mayDispatchWorker:false;mayCloseJob:false};
};

export function describeGpt02ReservationReadback(status:string|undefined,verified:boolean|undefined){
  if(status==="CANDIDATE_ID_READ_ONLY" && verified===true)
    return "Identitas kandidat reservasi terbaca (belum izin eksekusi)";
  if(status==="NO_RESERVATION_FOR_REVIEW")
    return "Belum ada reservasi recovery untuk review ini";
  if(status==="CANDIDATE_READER_NOT_INSTALLED")
    return "Fungsi pembaca DEV belum dipasang";
  if(status==="CANDIDATE_READER_EXECUTE_DENIED")
    return "Hak EXECUTE pembaca DEV belum tersedia";
  if(status==="MIGRATION_MISSING")
    return "Tabel reservasi belum tersedia";
  return "Pembacaan reservasi belum dapat diverifikasi";
}

export function Gpt02DevTimelinePanel({humanReviewId,jobId,parentCommandId}:{
  humanReviewId:number;jobId:number;parentCommandId:string;
}){
  const [loading,setLoading]=useState(false);
  const [result,setResult]=useState<Gpt02TimelineReadback|null>(null);
  const [error,setError]=useState<string|null>(null);
  const valid=Number.isSafeInteger(humanReviewId)&&humanReviewId>0&&
    Number.isSafeInteger(jobId)&&jobId>0&&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parentCommandId);

  async function refresh(){
    if(!valid)return;
    setLoading(true);setError(null);setResult(null);
    try{
      const search=new URLSearchParams({jobId:String(jobId),parentCommandId});
      const response=await fetch(`/api/ai/human-tasks/${humanReviewId}/gpt02-timeline?${search}`,{
        method:"GET",credentials:"include",cache:"no-store",
      });
      const contentType=response.headers.get("content-type")?.toLowerCase()??"";
      if(!contentType.includes("application/json"))
        throw new Error("GPT02_TIMELINE_API_NOT_JSON_CHECK_DEV_ROUTE");
      const raw:unknown=await response.json();
      const body=raw&&typeof raw==="object"&&!Array.isArray(raw)
        ? raw as Gpt02TimelineReadback : null;
      if(!response.ok||!body?.ok)
        throw new Error(body?.reason??"TIMELINE_READBACK_UNAVAILABLE");
      if(body.reviewOnly!==true||body.mayDispatchWorker!==false||body.mayCloseJob!==false)
        throw new Error("UNEXPECTED_TIMELINE_AUTHORITY");
      setResult(body);
    }catch(e){
      setError(e instanceof Error?e.message:"TIMELINE_READBACK_UNAVAILABLE");
    }finally{setLoading(false);}
  }
  return <section className="rounded-lg border border-border p-4 space-y-3" aria-label="GPT02 DEV timeline">
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Timeline aktivitas GPT02 — DEV</h3>
        <p className="text-xs text-muted-foreground">Pembacaan manual dari server. Tidak menjalankan worker atau menutup job.</p>
      </div>
      <Button type="button" size="sm" variant="secondary"
        className="flex w-full min-h-10 items-center justify-center whitespace-normal sm:w-auto"
        disabled={!valid||loading} aria-label="Periksa timeline GPT02 DEV"
        onClick={()=>void refresh()}>
        <RefreshCw className="size-4 shrink-0" aria-hidden="true"/>
        {loading?"Membaca timeline...":"Periksa timeline"}
      </Button>
    </div>
    {!valid&&<p className="text-xs text-amber-400" role="status">Job ID atau command belum valid. Pembacaan dinonaktifkan.</p>}
    {error&&<p className="text-xs text-red-400 break-all" role="alert">Gagal membaca timeline: {error}. Tidak ada status PASS yang diasumsikan.</p>}
    {result&&<div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs" role="status">
      <p>Job: <strong>{result.jobId??jobId}</strong></p>
      <p>Status: <strong>{result.status??"BELUM TERVERIFIKASI"}</strong></p>
      <p>Penanggung jawab: <strong>{result.accountableOwner??"Belum terbukti"}</strong></p>
      <p>Worker: <strong>{result.assignedWorkerId??"Belum terverifikasi"}</strong></p>
      <p>Peristiwa tersimpan: <strong>{result.observedEventCount??"Tidak tersedia"}</strong></p>
      <p>Progres: <strong>{result.progressPercent===null||result.progressPercent===undefined?"Belum dapat dihitung":`${result.progressPercent}%`}</strong></p>
      <p>Aktivitas terakhir: <strong>{result.lastEventKind??"Belum ada"}</strong></p>
      <p>Native ACK: <strong>{result.lastNativeAckVerified?"Bukti checkpoint terverifikasi":"Belum terverifikasi"}</strong></p>
      <p className="sm:col-span-2">Reservasi recovery: <strong>{describeGpt02ReservationReadback(result.reservationReadbackStatus,result.reservationEvidenceVerified)}</strong></p>
      <p className="sm:col-span-2 break-all">Event BLOCKER eksplisit: <strong>{result.blockerResponseId??"Tidak ada event BLOCKER terpisah"}</strong></p>
      {result.lastEventKind==="FAILED"&&
        <p className="sm:col-span-2 text-red-400">Respons terakhir FAILED. Job belum berhasil; tidak ada izin retry otomatis.</p>}
      <div className="sm:col-span-2 border-t border-border pt-2 space-y-1">
        <p className="font-semibold">Audit lintas-ledger (bukti eksplisit)</p>
        {result.crossLedger?.valid===false&&
          <p className="text-red-400" role="alert">Audit lintas-ledger tidak tersedia: {result.crossLedger.reason}. Angka nol tidak dapat diasumsikan.</p>}
        <p>Event terkait parent: {result.crossLedger?.valid?result.crossLedger.parentEventCount:"Belum terbaca"}</p>
        <p>Event bertag Job: {result.crossLedger?.valid?result.crossLedger.explicitJobEventCount:"Belum terbaca"}</p>
        <p>Child command bertag: {result.crossLedger?.valid?result.crossLedger.taggedChildCount:"Belum terbaca"}</p>
        <p className="text-amber-400">Riwayat command legacy tanpa tag belum dapat dikesampingkan. Tidak ada izin retry atau dispatch.</p>
      </div>
      <p className="sm:col-span-2 text-muted-foreground">Finalisasi: tetap memerlukan persetujuan serta bukti hasil independen. Tampilan ini bukan otorisasi.</p>
    </div>}
    {!result&&!error&&<p className="text-xs text-muted-foreground">Klik Periksa timeline untuk mengambil data terbaru. Tidak ada polling otomatis.</p>}
  </section>;
}
