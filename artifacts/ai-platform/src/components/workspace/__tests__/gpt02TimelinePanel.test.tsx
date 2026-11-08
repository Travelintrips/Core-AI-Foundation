import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {render,screen,fireEvent,waitFor,cleanup} from "@testing-library/react";
import {Gpt02DevTimelinePanel} from "../../Gpt02DevTimelinePanel";
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
};
const reply=(status:number,body:unknown)=>({ok:status>=200&&status<300,status,
  json:async()=>body}) as Response;
describe("GPT02 DEV manual timeline UI",()=>{
  const originalFetch=globalThis.fetch;
  beforeEach(()=>{vi.stubGlobal("fetch",vi.fn());});
  afterEach(()=>{cleanup();vi.unstubAllGlobals();globalThis.fetch=originalFetch;});
  it("does not poll or fetch automatically",()=>{
    render(<Gpt02DevTimelinePanel {...props}/>);
    expect(screen.getByRole("button",{name:/Periksa timeline/})).toBeTruthy();
    expect(globalThis.fetch).not.toHaveBeenCalled();
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
    expect(screen.getAllByText("Belum terverifikasi").length).toBeGreaterThan(0);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const [url,options]=vi.mocked(globalThis.fetch).mock.calls[0]!;
    expect(String(url)).toContain("/api/ai/human-tasks/6/gpt02-timeline?");
    expect(String(url)).toContain("jobId=135");
    expect(options).toMatchObject({method:"GET",credentials:"include",cache:"no-store"});
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
