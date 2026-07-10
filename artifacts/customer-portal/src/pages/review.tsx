import { useState } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { StatusBadge } from "@/components/status-badge";
import { useGetPublicCreativeReview, useAddClientComment, useApproveCreativeReview, useRejectCreativeReview, useRequestRevisionCreativeReview } from "@/hooks/use-customer";
import { Loader2, MessageSquare, Image as ImageIcon, Send, CheckCircle2, XCircle, RefreshCcw, FileText, Receipt } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

export default function ReviewPage({ params }: { params: { token: string } }) {
  const { data: review, isLoading, error } = useGetPublicCreativeReview(params.token);
  const addComment = useAddClientComment();
  const approveReview = useApproveCreativeReview();
  const rejectReview = useRejectCreativeReview();
  const requestRevision = useRequestRevisionCreativeReview();
  const { toast } = useToast();

  const [commentText, setCommentText] = useState("");
  const [revisionNotes, setRevisionNotes] = useState("");
  const [showRevisionInput, setShowRevisionInput] = useState(false);

  if (isLoading) {
    return (
      <Layout>
        <div className="flex-1 flex flex-col items-center justify-center min-h-[60vh]">
          <Loader2 className="w-10 h-10 animate-spin text-primary mb-4" />
          <p className="text-lg font-serif animate-pulse">Loading review portal...</p>
        </div>
      </Layout>
    );
  }

  if (error || !review) {
    return (
      <Layout>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="max-w-md text-center">
            <h2 className="text-2xl font-serif mb-4">Review Not Found</h2>
            <p className="text-muted-foreground">This review link may be expired, invalid, or the project is not ready for review yet.</p>
          </div>
        </div>
      </Layout>
    );
  }

  const isTerminal = review.reviewStatus === 'approved' || review.reviewStatus === 'rejected';
  // A quotation that hasn't been approved yet means production hasn't actually started,
  // even though the project row is still sitting in "pending" — don't show a false "generating" spinner.
  const awaitingQuotation = review.status === 'pending' && !!review.quotationStatus && review.quotationStatus !== 'approved';
  const isGenerating = (review.status === 'pending' || review.status === 'running') && !awaitingQuotation;

  const handleApprove = () => {
    approveReview.mutate({ token: params.token, data: {} }, {
      onSuccess: () => {
        toast({ title: "Project Approved!", description: "We'll finalize the assets for you." });
      }
    });
  };

  const handleReject = () => {
    if (confirm("Are you sure you want to reject this project? This action cannot be undone.")) {
      rejectReview.mutate({ token: params.token, data: {} }, {
        onSuccess: () => {
          toast({ title: "Project Rejected", description: "The project has been closed." });
        }
      });
    }
  };

  const handleRequestRevision = () => {
    if (!revisionNotes.trim()) {
      toast({ title: "Missing notes", description: "Please provide notes for the revision.", variant: "destructive" });
      return;
    }
    requestRevision.mutate({ token: params.token, data: { notes: revisionNotes } }, {
      onSuccess: () => {
        toast({ title: "Revision Requested", description: "Our agents will update the assets based on your feedback." });
        setShowRevisionInput(false);
        setRevisionNotes("");
      }
    });
  };

  const submitComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    addComment.mutate({
      token: params.token,
      data: { comment: commentText, authorName: review.clientName }
    }, {
      onSuccess: () => setCommentText("")
    });
  };

  return (
    <Layout>
      {/* Header Bar */}
      <div className="bg-card border-b border-card-border sticky top-16 z-40 shadow-sm">
        <div className="container mx-auto px-4 md:px-8 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-serif font-semibold">{review.brandName} - Creative Review</h1>
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              For {review.clientName}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={review.status} type="project" />
            <StatusBadge status={review.reviewStatus} type="review" />
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 md:px-8 py-8 flex flex-col lg:flex-row gap-8 items-start">
        
        {/* Main Content Area */}
        <div className="flex-1 w-full space-y-10">
          
          {/* Assets section: spinner while generating, grid when done */}
          <section>
            <div className="flex items-center gap-2 mb-6">
              <ImageIcon className="w-5 h-5 text-primary" />
              <h2 className="text-2xl font-serif font-medium">Visual Assets</h2>
            </div>

            {awaitingQuotation ? (
              <div className="bg-primary/5 border border-primary/20 rounded-2xl p-12 text-center flex flex-col items-center justify-center min-h-[300px]">
                <Receipt className="w-12 h-12 text-primary mb-6" />
                <h2 className="text-xl font-serif mb-2">
                  {review.quotationStatus === 'sent' ? "Your price quotation is ready" : "Awaiting your quotation"}
                </h2>
                <p className="text-muted-foreground text-sm max-w-sm mx-auto mb-6">
                  {review.quotationStatus === 'sent'
                    ? "Please review and approve the offer before we begin production."
                    : review.quotationStatus === 'rejected'
                    ? "This quotation was declined and the project has been closed."
                    : "We're preparing a price quotation for this project. You'll receive a link to review it soon."}
                </p>
                {review.quotationStatus === 'sent' && (
                  <Link
                    href={`/quotation/${params.token}`}
                    className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-full font-medium hover:bg-primary/90 transition-all"
                  >
                    Review Quotation
                  </Link>
                )}
              </div>
            ) : isGenerating ? (
              <div className="bg-accent/20 border border-accent rounded-2xl p-12 text-center flex flex-col items-center justify-center min-h-[300px]">
                <div className="relative mb-6">
                  <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl animate-pulse"></div>
                  <Loader2 className="w-12 h-12 text-primary animate-spin relative z-10" />
                </div>
                <h2 className="text-xl font-serif mb-2">Generating your assets…</h2>
                <p className="text-muted-foreground text-sm max-w-sm mx-auto">
                  Our AI agents are working on your brief. This page refreshes automatically every few seconds.
                </p>
              </div>
            ) : review.assets && review.assets.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {review.assets.map((asset) => (
                  <div key={asset.id} className="group relative rounded-2xl overflow-hidden border border-border bg-card shadow-sm aspect-square">
                    <img 
                      src={asset.imageUrl} 
                      alt="Generated asset" 
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
                      <a href={asset.imageUrl} target="_blank" rel="noreferrer" className="px-4 py-2 bg-white/20 backdrop-blur-md text-white rounded-lg text-sm font-medium hover:bg-white/30 transition-colors">
                        View Full Size
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-card border border-border border-dashed rounded-2xl p-12 text-center text-muted-foreground">
                No visual assets generated for this project yet.
              </div>
            )}
          </section>

          {/* Copy & Creative Direction (only when completed) */}
          {!isGenerating && (review.copyOutput || review.creativeDirection) && (
            <section className="grid md:grid-cols-2 gap-8">
              {review.copyOutput && (
                <div className="bg-card border border-card-border rounded-2xl p-6 shadow-sm">
                  <div className="flex items-center gap-2 mb-4 border-b border-border pb-4">
                    <FileText className="w-5 h-5 text-secondary" />
                    <h2 className="text-lg font-serif font-medium">Generated Copy</h2>
                  </div>
                  <div className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground whitespace-pre-wrap">
                    {review.copyOutput}
                  </div>
                </div>
              )}
              {review.creativeDirection && (
                <div className="bg-card border border-card-border rounded-2xl p-6 shadow-sm">
                  <div className="flex items-center gap-2 mb-4 border-b border-border pb-4">
                    <MessageSquare className="w-5 h-5 text-orange-500" />
                    <h2 className="text-lg font-serif font-medium">Creative Direction</h2>
                  </div>
                  <div className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground whitespace-pre-wrap">
                    {review.creativeDirection}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Brief Summary — always visible */}
          <section className="bg-muted/30 rounded-2xl p-6 md:p-8">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-6">Original Brief</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Brand</p>
                <p className="font-medium text-sm">{review.brandName} ({review.businessType})</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Target Market</p>
                <p className="font-medium text-sm">{review.targetMarket}</p>
              </div>
              {review.stylePreference && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Style</p>
                  <p className="font-medium text-sm">{review.stylePreference}</p>
                </div>
              )}
              <div className="sm:col-span-2 lg:col-span-3">
                <p className="text-xs text-muted-foreground mb-1">Goal</p>
                <p className="text-sm">{review.goal}</p>
              </div>
            </div>
          </section>

        </div>

        {/* Sidebar: Actions & Comments — always visible */}
        <div className="w-full lg:w-96 shrink-0 space-y-6">
          
          {/* Action Card */}
          <div className="bg-card border border-card-border rounded-2xl p-6 shadow-sm sticky top-36">
            {isGenerating ? (
              <div className="text-center py-4">
                <div className="w-12 h-12 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto mb-3">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
                <h3 className="font-serif font-medium mb-1">In Production</h3>
                <p className="text-xs text-muted-foreground">Action buttons will appear once your assets are ready. You can leave comments below while you wait.</p>
              </div>
            ) : isTerminal ? (
              <div className="text-center py-6">
                {review.reviewStatus === 'approved' ? (
                  <>
                    <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
                      <CheckCircle2 className="w-8 h-8" />
                    </div>
                    <h3 className="font-serif text-xl font-medium mb-2">Approved</h3>
                    <p className="text-sm text-muted-foreground">Thank you for approving this project. We'll be in touch with final deliverables.</p>
                  </>
                ) : (
                  <>
                    <div className="w-16 h-16 bg-destructive/10 text-destructive rounded-full flex items-center justify-center mx-auto mb-4">
                      <XCircle className="w-8 h-8" />
                    </div>
                    <h3 className="font-serif text-xl font-medium mb-2">Rejected</h3>
                    <p className="text-sm text-muted-foreground">This project has been closed.</p>
                  </>
                )}
              </div>
            ) : review.reviewStatus === 'revision_requested' ? (
              <div className="text-center py-6">
                <div className="w-16 h-16 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center mx-auto mb-4">
                  <RefreshCcw className="w-8 h-8" />
                </div>
                <h3 className="font-serif text-xl font-medium mb-2">Revision in progress</h3>
                <p className="text-sm text-muted-foreground">Our AI is generating new assets based on your feedback. Please check back later.</p>
              </div>
            ) : (
              <>
                <h3 className="font-serif font-medium text-lg mb-4 text-center">Your Decision</h3>
                
                {showRevisionInput ? (
                  <div className="space-y-4 animate-in fade-in slide-in-from-top-4">
                    <textarea 
                      value={revisionNotes}
                      onChange={(e) => setRevisionNotes(e.target.value)}
                      className="w-full text-sm px-3 py-2 rounded-xl border border-input bg-background focus:ring-2 focus:ring-primary focus:outline-none resize-none"
                      rows={4}
                      placeholder="What should we change? Be specific..."
                    />
                    <div className="flex gap-2">
                      <button onClick={() => setShowRevisionInput(false)} className="flex-1 py-2 rounded-xl text-sm font-medium border border-border hover:bg-muted">
                        Cancel
                      </button>
                      <button 
                        onClick={handleRequestRevision}
                        disabled={requestRevision.isPending}
                        className="flex-1 py-2 rounded-xl text-sm font-medium bg-orange-500 text-white hover:bg-orange-600 flex items-center justify-center gap-2"
                      >
                        {requestRevision.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        Submit
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <button 
                      onClick={handleApprove}
                      disabled={approveReview.isPending}
                      className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
                    >
                      {approveReview.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                      <CheckCircle2 className="w-5 h-5" /> Approve All
                    </button>
                    
                    <button 
                      onClick={() => setShowRevisionInput(true)}
                      className="w-full py-3 bg-secondary/10 text-secondary-foreground rounded-xl font-medium hover:bg-secondary/20 transition-colors flex items-center justify-center gap-2"
                    >
                      <RefreshCcw className="w-5 h-5" /> Request Revision
                    </button>

                    <button 
                      onClick={handleReject}
                      disabled={rejectReview.isPending}
                      className="w-full py-2 text-muted-foreground text-sm font-medium hover:text-destructive transition-colors mt-2"
                    >
                      Reject completely
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Comments Section — always visible */}
          <div className="bg-card border border-card-border rounded-2xl p-6 shadow-sm flex flex-col h-[500px]">
            <div className="flex items-center gap-2 mb-4 border-b border-border pb-4 shrink-0">
              <MessageSquare className="w-5 h-5 text-muted-foreground" />
              <h3 className="font-serif font-medium text-lg">Discussion</h3>
            </div>
            
            <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2">
              {review.comments && review.comments.length > 0 ? (
                review.comments.map((comment) => (
                  <div key={comment.id} className={`flex flex-col ${comment.authorType === 'client' ? 'items-end' : 'items-start'}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium">{comment.authorName}</span>
                      <span className="text-[10px] text-muted-foreground">{format(new Date(comment.createdAt), 'h:mm a')}</span>
                    </div>
                    <div className={`px-4 py-2 rounded-2xl text-sm max-w-[85%] ${
                      comment.authorType === 'client' 
                        ? 'bg-primary text-primary-foreground rounded-br-sm' 
                        : 'bg-muted text-foreground rounded-bl-sm'
                    }`}>
                      {comment.comment}
                    </div>
                  </div>
                ))
              ) : (
                <div className="h-full flex items-center justify-center text-center text-muted-foreground text-sm">
                  No comments yet. Have a question or note? Add it here.
                </div>
              )}
            </div>

            <form onSubmit={submitComment} className="relative shrink-0 pt-2 border-t border-border">
              <input 
                type="text"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Leave a comment..."
                disabled={addComment.isPending}
                className="w-full pl-4 pr-12 py-3 bg-muted/50 border border-input rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-sm"
              />
              <button 
                type="submit" 
                disabled={!commentText.trim() || addComment.isPending}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-primary hover:bg-primary/10 rounded-lg disabled:opacity-50 transition-colors"
              >
                {addComment.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </form>
          </div>

        </div>
      </div>
    </Layout>
  );
}
