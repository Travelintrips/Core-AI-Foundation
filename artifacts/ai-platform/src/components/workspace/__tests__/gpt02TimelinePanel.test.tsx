import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {render,screen,fireEvent,waitFor,cleanup} from "@testing-library/react";
import {Gpt02DevTimelinePanel,describeGpt02ReservationReadback} from "../../Gpt02DevTimelinePanel";
const parent="83db99f5-cbda-4e60-be71-3090fb411bbb";
const props={humanReviewId:6,jobId:135,parentCommandId:parent};
const success={
  ok:true,reviewOnly:true,jobId:135,status:"ISSUER_NOT_VERIFIED",
  accountableOwner:"admin@example.test",assignedWorkerId:null,
  observedEventCount:2,progressPercent:null,lastEventKind:"FAILED",
  blockerResponseId:"blocker-1",lastNativeAckVerified:false,
  reservationReadbackStatus:"CANDIDATE_READER_NOT_INSTALLED",
  reservationEvidenceVerified:false,
  mayDispatchWorker:false,mayCloseJob:false,
  crossLedger:{valid:true,reason:"LEGACY_UNTAGGED_HISTORY_NOT_EXCLUDED",
    parentEventCount:1,explicitJobEventCount:0,taggedChildCount:0,
    reviewRecordCount:2,legacyUntaggedAttemptsExcluded:false,
    mayCreateCommand:false,mayDispatchWorker:false,mayCloseJob:false},
};
const reply=(status:number,body:unknown,contentType="application/json")=>({
  ok:status>=200&&status<300,status,
  headers:{get:(key:string)=>key.toLowerCase()==="content-type"?contentType:null},
  json:async()=>body}) as Response;
describe("GPT02 DEV manual timeline UI",()=>{
  const originalFetch=globalThis.fetch;
  beforeEach(()=>{vi.stubGlobal("fetch",vi.fn());});
  afterEach(()=>{cleanup();vi.unstubAllGlobals();globalThis.fetch=originalFetch;});
  it("distinguishes a verified empty reservation read from readback failure",()=>{
    expect(describeGpt02ReservationReadback("NO_RESERVATION_FOR_REVIEW",false))
      .toBe("Belum ada reservasi recovery untuk review ini");
    expect(describeGpt02ReservationReadback("CANDIDATE_READER_EXECUTE_DENIED",false))
      .toContain("belum tersedia");
    expect(describeGpt02ReservationReadback("CANDIDATE_ID_READ_ONLY",true))
      .toContain("belum izin eksekusi");
    expect(describeGpt02ReservationReadback("RESERVATION_SCHEMA_READBACK_UNAVAILABLE",false))
      .toBe("Pembacaan reservasi belum dapat diverifikasi");
    expect(describeGpt02ReservationReadback(undefined,true))
      .toBe("Pembacaan reservasi belum dapat diverifikasi");
  });
  it("does not poll or fetch automatically",()=>{
    render(<Gpt02DevTimelinePanel {...props}/>);
    expect(screen.getByRole("button",{name:/Periksa timeline/})).toBeTruthy();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it("renders a full-width, named action below the heading for narrow dialogs",()=>{
    render(<Gpt02DevTimelinePanel {...props}/>);
    const section=screen.getByRole("region",{name:"GPT02 DEV timeline"});
    const title=screen.getByText("Timeline aktivitas GPT02 — DEV");
    const button=screen.getByRole("button",{name:"Periksa timeline GPT02 DEV"});
    expect(section.contains(button)).toBe(true);
    expect(section.contains(title)).toBe(true);
    expect(button.className).toContain("w-full");
    expect(button.className).toContain("min-h-10");
    expect(title.compareDocumentPosition(button)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it("invalid parent disables read and never queries",()=>{
    render(<Gpt02DevTimelinePanel {...props} parentCommandId="invalid"/>);
    expect((screen.getByRole("button",{name:/Periksa timeline/}) as HTMLButtonElement).disabled).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it("explicit click reads server without credentials leakage or auto-dispatch",async()=>{
    vi.mocked(globalThis.fetch).mockResolvedValue(reply(200,success));
    render(<Gpt02DevTimelinePanel {...props}/>);
    fireEvent.click(screen.getByRole("button",{name:/Periksa timeline/}));
    await waitFor(()=>expect(screen.getByText("Fungsi pembaca DEV belum dipasang")).toBeTruthy());
    expect(screen.getByText("Belum dapat dihitung")).toBeTruthy();
    expect(screen.getByText(/Riwayat command legacy tanpa tag belum dapat dikesampingkan/)).toBeTruthy();
    expect(screen.getAllByText("Belum terverifikasi").length).toBeGreaterThan(0);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const [url,options]=vi.mocked(globalThis.fetch).mock.calls[0]!;
    expect(String(url)).toContain("/api/ai/human-tasks/6/gpt02-timeline?");
    expect(String(url)).toContain("jobId=135");
    expect(options).toMatchObject({method:"GET",credentials:"include",cache:"no-store"});
  });
  it("renders the verified empty recovery result and distinguishes failed response from BLOCKER event",async()=>{
    vi.mocked(globalThis.fetch).mockResolvedValue(reply(200,{
      ...success,reservationReadbackStatus:"NO_RESERVATION_FOR_REVIEW",blockerResponseId:null,
    }));
    render(<Gpt02DevTimelinePanel {...props}/>);
    fireEvent.click(screen.getByRole("button",{name:/Periksa timeline/}));
    await waitFor(()=>expect(screen.getByText("Belum ada reservasi recovery untuk review ini")).toBeTruthy());
    expect(screen.getByText(/Respons terakhir FAILED/)).toBeTruthy();
    expect(screen.getByText(/Tidak ada event BLOCKER terpisah/)).toBeTruthy();
  });
  it("shows schema readiness without implying issuer or native ACK",async()=>{
    vi.mocked(globalThis.fetch).mockResolvedValue(reply(200,{
      ...success,infrastructure:{
        reservationTablePresent:true,commandLinksTablePresent:true,
        leasesTablePresent:true,releaseReceiptsTablePresent:true,
        reservationMutationsEnabled:false,leaseMutationsEnabled:false,
        issuerVerified:false,legacyExternalAttemptsExcluded:false,
        nativeAckVerified:false,mayCreateCommand:false,
        mayDispatchWorker:false,mayCloseJob:false,
      },
    }));
    render(<Gpt02DevTimelinePanel {...props}/>);
    fireEvent.click(screen.getByRole("button",{name:/Periksa timeline/}));
    await waitFor(()=>expect(screen.getByText(/Kesiapan infrastruktur recovery/)).toBeTruthy());
    expect(screen.getByText(/Issuer, riwayat eksternal, dan native ACK belum terverifikasi/)).toBeTruthy();
    expect(screen.getAllByText(/Tabel tersedia/).length).toBe(2);
  });
  it("optional cross-ledger failure never displays fabricated zero counts",async()=>{
    vi.mocked(globalThis.fetch).mockResolvedValue(reply(200,{
      ...success,crossLedger:{valid:false,reason:"CROSS_LEDGER_READBACK_UNAVAILABLE",
        legacyUntaggedAttemptsExcluded:false,
        mayCreateCommand:false,mayDispatchWorker:false,mayCloseJob:false},
    }));
    render(<Gpt02DevTimelinePanel {...props}/>);
    fireEvent.click(screen.getByRole("button",{name:/Periksa timeline/}));
    await waitFor(()=>expect(screen.getByRole("alert").textContent)
      .toContain("CROSS_LEDGER_READBACK_UNAVAILABLE"));
    expect(screen.getByText(/Event terkait parent:/).textContent).toContain("Belum terbaca");
  });
  it("rejects HTML SPA fallback returned as HTTP 200 instead of timeline JSON",async()=>{
    vi.mocked(globalThis.fetch).mockResolvedValue(reply(200,"<!DOCTYPE html>","text/html; charset=utf-8"));
    render(<Gpt02DevTimelinePanel {...props}/>);
    fireEvent.click(screen.getByRole("button",{name:/Periksa timeline/}));
    await waitFor(()=>expect(screen.getByRole("alert").textContent)
      .toContain("GPT02_TIMELINE_API_NOT_JSON_CHECK_DEV_ROUTE"));
    expect(screen.queryByText("ISSUER_NOT_VERIFIED")).toBeNull();
  });
  it("permission failure is explicit and never paints success",async()=>{
    vi.mocked(globalThis.fetch).mockResolvedValue(reply(403,{reason:"DEV_ONLY"}));
    render(<Gpt02DevTimelinePanel {...props}/>);
    fireEvent.click(screen.getByRole("button",{name:/Periksa timeline/}));
    await waitFor(()=>expect(screen.getByRole("alert").textContent).toContain("DEV_ONLY"));
    expect(screen.queryByText("ISSUER_NOT_VERIFIED")).toBeNull();
  });
  it("rejects response claiming dispatch or close authority",async()=>{
    vi.mocked(globalThis.fetch).mockResolvedValue(reply(200,{...success,mayDispatchWorker:true}));
    render(<Gpt02DevTimelinePanel {...props}/>);
    fireEvent.click(screen.getByRole("button",{name:/Periksa timeline/}));
    await waitFor(()=>expect(screen.getByRole("alert").textContent)
      .toContain("UNEXPECTED_TIMELINE_AUTHORITY"));
  });
});
