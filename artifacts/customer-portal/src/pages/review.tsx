import { useState } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { FlowStepper } from "@/components/flow-stepper";
import { StatusBadge } from "@/components/status-badge";
import { useGetPublicCreativeReview, useAddClientComment, useApproveCreativeReview, useRejectCreativeReview, useRequestRevisionCreativeReview } from "@/hooks/use-customer";
import { Loader2, MessageSquare, Image as ImageIcon, Send, CheckCircle2, XCircle, RefreshCcw, FileText, Receipt, ArrowLeft } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";

export default function ReviewPage({ params }: { params: { token: string } }) {
  const { t } = useTranslation();
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
          <p className="text-lg font-serif animate-pulse">{t('review.loading')}</p>
        </div>
      </Layout>
    );
  }

  if (error || !review) {
    return (
      <Layout>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="max-w-md text-center">
            <h2 className="text-2xl font-serif mb-4">{t('review.notFound')}</h2>
            <p className="text-muted-foreground">{t('review.notFoundDesc')}</p>
          </div>
        </div>
      </Layout>
    );
  }

  const isTerminal = review.reviewStatus === 'approved' || review.reviewStatus === 'rejected';
  const assetsInProgress = (review.assets ?? []).some((a) => a.status === 'generating' || a.status === 'pending');
  const awaitingQuotation = review.status === 'pending' && !!review.quotationStatus && review.quotationStatus !== 'approved';
  const isGenerating = (review.status === 'pending' || review.status === 'running' || assetsInProgress) && !awaitingQuotation;

  const handleApprove = () => {
    approveReview.mutate({ token: params.token, data: {} }, {
      onSuccess: () => {
        toast({ title: t('review.actions.approveConfirm'), description: t('review.actions.approveConfirmDesc') });
      }
    });
  };

  const handleReject = () => {
    if (confirm(t('review.actions.rejectConfirm'))) {
      rejectReview.mutate({ token: params.token, data: {} }, {
        onSuccess: () => {
          toast({ title: t('review.actions.rejectConfirmTitle'), description: t('review.actions.rejectConfirmDesc') });
        }
      });
    }
  };

  const handleRequestRevision = () => {
    if (!revisionNotes.trim()) {
      toast({ title: t('review.actions.revision'), description: t('review.actions.revisionLabel'), variant: "destructive" });
      return;
    }
    requestRevision.mutate({ token: params.token, data: { notes: revisionNotes } }, {
      onSuccess: () => {
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

  const reviewStepperStep =
    review.reviewStatus === "approved" ? "selesai" :
    (review.reviewStatus === "shared" || review.reviewStatus === "viewed" || review.reviewStatus === "revision_requested") ? "review" :
    "produksi";

  return (
    <Layout>
      <div className="container mx-auto px-4 md:px-8 pt-6 max-w-5xl">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors group">
          <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
          Kembali
        </Link>
      </div>
      {/* Flow Stepper */}
      <div className="border-b border-border/40 bg-muted/20">
        <div className="container mx-auto px-4 md:px-8 max-w-5xl">
          <FlowStepper currentStep={reviewStepperStep} />
        </div>
      </div>

      {/* Header Bar */}
      <div className="bg-card border-b border-card-border sticky top-16 z-40 shadow-sm">
        <div className="container mx-auto px-4 md:px-8 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-serif font-semibold">{review.brandName} — {t('review.header.review')}</h1>
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              {t('review.header.for')} {review.clientName}
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
          
          {/* Assets section */}
          <section>
            <div className="flex items-center gap-2 mb-6">
              <ImageIcon className="w-5 h-5 text-primary" />
              <h2 className="text-2xl font-serif font-medium">{t('review.assets.title')}</h2>
            </div>

            {awaitingQuotation ? (
              <div className="bg-primary/5 border border-primary/20 rounded-2xl p-12 text-center flex flex-col items-center justify-center min-h-[300px]">
                <Receipt className="w-12 h-12 text-primary mb-6" />
                <h2 className="text-xl font-serif mb-2">
                  {review.quotationStatus === 'sent' ? t('review.assets.waitingTitle') : t('review.quotation.waiting')}
                </h2>
                <p className="text-muted-foreground text-sm max-w-sm mx-auto mb-6">
                  {review.quotationStatus === 'sent'
                    ? t('review.assets.waitingDesc')
                    : review.quotationStatus === 'rejected'
                    ? t('review.assets.quotationDeclined')
                    : t('review.assets.quotationPreparing')}
                </p>
                {review.quotationStatus === 'sent' && (
                  <Link
                    href={`/quotation/${params.token}`}
                    className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-full font-medium hover:bg-primary/90 transition-all"
                  >
                    {t('review.assets.waitingCta')}
                  </Link>
                )}
              </div>
            ) : isGenerating && (!review.assets || review.assets.length === 0) ? (
              <div className="bg-accent/20 border border-accent rounded-2xl p-12 text-center flex flex-col items-center justify-center min-h-[300px]">
                <div className="relative mb-6">
                  <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl animate-pulse"></div>
                  <Loader2 className="w-12 h-12 text-primary animate-spin relative z-10" />
                </div>
                <h2 className="text-xl font-serif mb-2">{t('review.assets.generating')}</h2>
                <p className="text-muted-foreground text-sm max-w-sm mx-auto">
                  {t('review.assets.generatingDesc')}
                </p>
              </div>
            ) : review.assets && review.assets.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {review.assets.map((asset) => (
                  <div key={asset.id} className="group relative rounded-2xl overflow-hidden border border-border bg-card shadow-sm aspect-square">
                    {asset.imageUrl ? (
                      <>
                        <img
                          src={asset.imageUrl}
                          alt="Generated asset"
                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
                          <a href={asset.imageUrl} target="_blank" rel="noreferrer" className="px-4 py-2 bg-white/20 backdrop-blur-md text-white rounded-lg text-sm font-medium hover:bg-white/30 transition-colors">
                            {t('common.view')}
                          </a>
                        </div>
                      </>
                    ) : asset.status === "pending" || asset.status === "generating" ? (
                      <div className="h-full flex flex-col items-center justify-center gap-3 bg-accent/10 text-center p-6">
                        <Loader2 className="w-9 h-9 text-primary animate-spin" />
                        <p className="text-sm font-medium">{t('review.assets.generating')}</p>
                        <p className="text-xs text-muted-foreground">Visual ini sedang diproses dan akan muncul otomatis.</p>
                      </div>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center gap-2 bg-destructive/5 text-center p-6">
                        <XCircle className="w-9 h-9 text-destructive/70" />
                        <p className="text-sm font-medium">Visual gagal dibuat</p>
                        <p className="text-xs text-muted-foreground">Tim kami dapat menjalankan ulang visual ini.</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-card border border-border border-dashed rounded-2xl p-12 text-center text-muted-foreground">
                <p className="font-medium mb-1">{t('review.assets.noAssets')}</p>
                <p className="text-sm">{t('review.assets.noAssetsDesc')}</p>
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
                  <div className="space-y-4 text-sm">
                    {review.copyOutput.tagline && (
                      <p className="text-base font-medium italic text-foreground">"{review.copyOutput.tagline}"</p>
                    )}
                    {review.copyOutput.headline?.primary && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Headline</p>
                        <p className="font-medium">{review.copyOutput.headline.primary}</p>
                      </div>
                    )}
                    {review.copyOutput.body_copy?.short && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Body Copy</p>
                        <p className="text-muted-foreground whitespace-pre-wrap">{review.copyOutput.body_copy.short}</p>
                      </div>
                    )}
                    {review.copyOutput.cta?.primary && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Call to Action</p>
                        <p className="font-medium">{review.copyOutput.cta.primary}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {review.creativeDirection && (
                <div className="bg-card border border-card-border rounded-2xl p-6 shadow-sm">
                  <div className="flex items-center gap-2 mb-4 border-b border-border pb-4">
                    <MessageSquare className="w-5 h-5 text-orange-500" />
                    <h2 className="text-lg font-serif font-medium">Creative Direction</h2>
                  </div>
                  <div className="space-y-4 text-sm">
                    {review.creativeDirection.creative_concept?.name && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Concept</p>
                        <p className="font-medium">{review.creativeDirection.creative_concept.name}</p>
                        {review.creativeDirection.creative_concept.description && (
                          <p className="text-muted-foreground mt-1">{review.creativeDirection.creative_concept.description}</p>
                        )}
                      </div>
                    )}
                    {review.creativeDirection.visual_style?.mood && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Visual Style</p>
                        <p className="text-muted-foreground">{review.creativeDirection.visual_style.mood}</p>
                      </div>
                    )}
                    {review.creativeDirection.color_direction && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Color Direction</p>
                        <div className="flex items-center gap-2">
                          {[
                            review.creativeDirection.color_direction.primary,
                            review.creativeDirection.color_direction.secondary,
                            review.creativeDirection.color_direction.accent,
                          ]
                            .filter(Boolean)
                            .map((c) => (
                              <span
                                key={c}
                                className="w-6 h-6 rounded-full border border-border inline-block"
                                style={{ backgroundColor: c }}
                                title={c}
                              />
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Brief Summary */}
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

        {/* Sidebar */}
        <div className="w-full lg:w-96 shrink-0 space-y-6">
          
          {/* Action Card */}
          <div className="bg-card border border-card-border rounded-2xl p-6 shadow-sm sticky top-36">
            {isGenerating ? (
              <div className="text-center py-4">
                <div className="w-12 h-12 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto mb-3">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
                <h3 className="font-serif font-medium mb-1">{t('review.production.title')}</h3>
                <p className="text-xs text-muted-foreground">{t('review.production.desc')}</p>
              </div>
            ) : isTerminal ? (
              <div className="text-center py-6">
                {review.reviewStatus === 'approved' ? (
                  <>
                    <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
                      <CheckCircle2 className="w-8 h-8" />
                    </div>
                    <h3 className="font-serif text-xl font-medium mb-2">{t('review.terminal.approved')}</h3>
                    <p className="text-sm text-muted-foreground">{t('review.actions.approveConfirmDesc')}</p>
                  </>
                ) : (
                  <>
                    <div className="w-16 h-16 bg-destructive/10 text-destructive rounded-full flex items-center justify-center mx-auto mb-4">
                      <XCircle className="w-8 h-8" />
                    </div>
                    <h3 className="font-serif text-xl font-medium mb-2">{t('review.terminal.rejected')}</h3>
                    <p className="text-sm text-muted-foreground">{t('review.actions.rejectConfirmDesc')}</p>
                  </>
                )}
              </div>
            ) : review.reviewStatus === 'revision_requested' ? (
              <div className="text-center py-6">
                <div className="w-16 h-16 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center mx-auto mb-4">
                  <RefreshCcw className="w-8 h-8" />
                </div>
                <h3 className="font-serif text-xl font-medium mb-2">{t('review.actions.revision')}</h3>
                <p className="text-sm text-muted-foreground">{t('review.assets.generatingDesc')}</p>
              </div>
            ) : (
              <>
                {showRevisionInput ? (
                  <div className="space-y-4 animate-in fade-in slide-in-from-top-4">
                    <p className="text-sm font-medium">{t('review.actions.revisionLabel')}</p>
                    <textarea 
                      value={revisionNotes}
                      onChange={(e) => setRevisionNotes(e.target.value)}
                      className="w-full text-sm px-3 py-2 rounded-xl border border-input bg-background focus:ring-2 focus:ring-primary focus:outline-none resize-none"
                      rows={4}
                      placeholder={t('review.actions.revisionPlaceholder')}
                    />
                    <div className="flex gap-2">
                      <button onClick={() => setShowRevisionInput(false)} className="flex-1 py-2 rounded-xl text-sm font-medium border border-border hover:bg-muted">
                        {t('review.actions.cancelRevision')}
                      </button>
                      <button 
                        onClick={handleRequestRevision}
                        disabled={requestRevision.isPending}
                        className="flex-1 py-2 rounded-xl text-sm font-medium bg-orange-500 text-white hover:bg-orange-600 flex items-center justify-center gap-2"
                      >
                        {requestRevision.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        {requestRevision.isPending ? t('review.actions.submittingRevision') : t('review.actions.submitRevision')}
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
                      <CheckCircle2 className="w-5 h-5" /> {t('review.actions.approve')}
                    </button>
                    
                    <button 
                      onClick={() => setShowRevisionInput(true)}
                      className="w-full py-3 bg-secondary/10 text-secondary-foreground rounded-xl font-medium hover:bg-secondary/20 transition-colors flex items-center justify-center gap-2"
                    >
                      <RefreshCcw className="w-5 h-5" /> {t('review.actions.revision')}
                    </button>

                    <button 
                      onClick={handleReject}
                      disabled={rejectReview.isPending}
                      className="w-full py-2 text-muted-foreground text-sm font-medium hover:text-destructive transition-colors mt-2"
                    >
                      {rejectReview.isPending ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : null}
                      {t('review.actions.reject')}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Comments Section */}
          <div className="bg-card border border-card-border rounded-2xl p-6 shadow-sm flex flex-col h-[500px]">
            <div className="flex items-center gap-2 mb-4 border-b border-border pb-4 shrink-0">
              <MessageSquare className="w-5 h-5 text-muted-foreground" />
              <h3 className="font-serif font-medium text-lg">{t('review.comment.title')}</h3>
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
                  {t('review.comment.placeholder')}
                </div>
              )}
            </div>

            <form onSubmit={submitComment} className="relative shrink-0 pt-2 border-t border-border">
              <input 
                type="text"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder={t('review.comment.placeholder')}
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
