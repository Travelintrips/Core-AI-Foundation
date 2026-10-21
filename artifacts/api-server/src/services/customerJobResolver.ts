/**
 * Customer-scoped job resolution. Never use semantic similarity as an authorization boundary.
 * Caller MUST derive companyId/customerId from an authenticated session, never message text.
 */
export type CustomerJob = {
  id: string;
  companyId: string;
  customerId: string;
  title: string;
  description?: string | null;
  category?: string | null;
  status: string;
  updatedAt?: string | Date | null;
  progressPercent?: number | null;
  checkpoint?: string | null;
};
export type JobMatchResult =
  | { kind: "matched"; job: CustomerJob; reply: string }
  | { kind: "clarify"; candidates: CustomerJob[]; reply: string }
  | { kind: "not_found"; reply: string };

const concepts: Record<string, string[]> = {
  fashion: ["fashion", "busana", "baju", "pakaian", "kebaya", "gaun", "dress", "outfit", "jahit"],
  interior: ["interior", "ruangan", "ruang", "dekorasi", "furnitur", "furniture", "rumah"],
  logo: ["logo", "logotype", "identitas visual", "lambang", "branding"],
};
const normalize = (s: string) => s.toLocaleLowerCase("id-ID").normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const hasPhrase = (haystack: string, needle: string) => (" " + haystack + " ").includes(" " + needle + " ");
function detectedConcepts(text: string): string[] {
  const n = normalize(text);
  return Object.entries(concepts).filter(([, aliases]) => aliases.some((word) => hasPhrase(n, normalize(word)))).map(([key]) => key);
}
function jobConcepts(job: CustomerJob): string[] {
  return detectedConcepts([job.title, job.category ?? "", job.description ?? ""].join(" "));
}
function uniqueWords(s: string): string[] {
  const stop = new Set(["bagaimana", "gimana", "progress", "progres", "status", "saya", "aku", "kami", "tolong", "yang", "sudah", "sampai", "mana", "desain", "design", "pekerjaan", "job", "kapan", "selesai", "apa", "ini", "itu"]);
  return [...new Set(normalize(s).split(" ").filter((x) => x.length > 2 && !stop.has(x)))];
}
export function resolveCustomerJob(
  message: string,
  jobs: readonly CustomerJob[],
  scope: { companyId: string; customerId: string },
): JobMatchResult {
  if (!scope.companyId || !scope.customerId) throw new Error("Authenticated customer scope required");
  const visible = jobs.filter((j) => j.companyId === scope.companyId && j.customerId === scope.customerId);
  const queryConcepts = detectedConcepts(message);
  const tokens = uniqueWords(message).filter((w) => !Object.values(concepts).flat().includes(w));
  const candidates = visible.map((job) => {
    const tags = jobConcepts(job);
    const haystack = normalize([job.title, job.category ?? "", job.description ?? ""].join(" "));
    const conceptMatches = queryConcepts.filter((q) => tags.includes(q)).length;
    const otherConcepts = queryConcepts.length > 0 && conceptMatches === 0;
    const detailMatches = tokens.filter((t) => hasPhrase(haystack, t)).length;
    return { job, score: otherConcepts ? 0 : conceptMatches * 10 + detailMatches * 3 };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  if (candidates.length === 0) return { kind: "not_found", reply: "Pekerjaan yang dimaksud tidak ditemukan pada akun Anda. Sebutkan jenis atau nama pekerjaan." };
  const best = candidates[0].score;
  const tied = candidates.filter((x) => x.score === best).map((x) => x.job);
  if (tied.length !== 1) return { kind: "clarify", candidates: tied, reply: "Ada beberapa pekerjaan yang cocok: " + tied.map((j) => j.title).join(", ") + ". Pekerjaan yang mana?" };
  const job = tied[0];
  const pct = typeof job.progressPercent === "number" && Number.isFinite(job.progressPercent) && job.progressPercent >= 0 && job.progressPercent <= 100 ? " (" + job.progressPercent + "%)" : "";
  const checkpoint = job.checkpoint ? " Checkpoint terakhir: " + job.checkpoint : "";
  return { kind: "matched", job, reply: "Status " + job.title + ": " + job.status + pct + "." + checkpoint };
}
