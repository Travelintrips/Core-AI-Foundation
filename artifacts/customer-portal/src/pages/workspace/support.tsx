import { useState } from "react";
import { Link } from "wouter";
import { WorkspaceLayout } from "@/components/workspace-layout";
import { useSupportTickets, useCreateSupportTicket } from "@/hooks/use-workspace";
import { useToast } from "@/hooks/use-toast";
import { fmtDateTime } from "@/lib/workspace-format";
import { Loader2, LifeBuoy, Send, ArrowLeft } from "lucide-react";

const CATEGORIES = ["general", "billing", "technical", "creative"];

export default function WorkspaceSupportPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const { data, isLoading } = useSupportTickets(token);
  const create = useCreateSupportTicket(token);
  const { toast } = useToast();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState("general");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) return;
    try {
      await create.mutateAsync({ subject, message, category });
      setSubject("");
      setMessage("");
      toast({ title: "Ticket submitted", description: "Our team will get back to you soon." });
    } catch (e) {
      toast({ title: "Could not submit ticket", description: (e as Error).message, variant: "destructive" });
    }
  }

  return (
    <WorkspaceLayout token={token}>
      <Link href={`/workspace/${token}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6 group">
        <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
        Kembali ke Dashboard
      </Link>
      <div className="mb-6">
        <h1 className="text-3xl font-serif font-medium mb-1">Support Center</h1>
        <p className="text-muted-foreground">Have a question? Send us a message.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <form onSubmit={handleSubmit} className="bg-card border border-card-border rounded-2xl p-6 space-y-4 h-fit">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm"
              data-testid="select-ticket-category"
            >
              {CATEGORIES.map((c) => <option key={c} value={c} className="capitalize">{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Subject</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm"
              data-testid="input-ticket-subject"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              required
              className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm"
              data-testid="input-ticket-message"
            />
          </div>
          <button
            type="submit"
            disabled={create.isPending}
            className="inline-flex items-center gap-2 text-sm font-medium bg-foreground text-background px-5 py-2.5 rounded-full hover:bg-foreground/90 transition-colors disabled:opacity-50"
            data-testid="button-submit-ticket"
          >
            {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Submit ticket
          </button>
        </form>

        <div>
          <h2 className="text-lg font-serif font-medium mb-4">Your Tickets</h2>
          {isLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : !data || data.items.length === 0 ? (
            <div className="bg-card border border-card-border rounded-2xl p-8 text-center text-muted-foreground">
              <LifeBuoy className="w-8 h-8 mx-auto mb-3 text-muted-foreground/50" />
              No tickets yet.
            </div>
          ) : (
            <div className="space-y-3">
              {data.items.map((t) => (
                <div key={t.id} className="bg-card border border-card-border rounded-2xl p-4">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="font-medium truncate">{t.subject}</p>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-muted capitalize shrink-0">{t.status}</span>
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2 mb-2">{t.message}</p>
                  <p className="text-xs text-muted-foreground">{fmtDateTime(t.createdAt)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </WorkspaceLayout>
  );
}
