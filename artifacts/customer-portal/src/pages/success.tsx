import { Link, useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { CheckCircle2, ArrowRight, Copy, Check } from "lucide-react";
import { useState } from "react";

export default function SuccessPage() {
  const [location] = useLocation();
  const searchParams = new URLSearchParams(location.split('?')[1] || "");
  const reviewToken = searchParams.get('review') || "";
  const dashboardToken = searchParams.get('dashboard') || "";

  const [copiedReview, setCopiedReview] = useState(false);
  const [copiedDashboard, setCopiedDashboard] = useState(false);

  const copyToClipboard = (text: string, type: 'review' | 'dashboard') => {
    navigator.clipboard.writeText(text);
    if (type === 'review') {
      setCopiedReview(true);
      setTimeout(() => setCopiedReview(false), 2000);
    } else {
      setCopiedDashboard(true);
      setTimeout(() => setCopiedDashboard(false), 2000);
    }
  };

  const reviewUrl = `${window.location.origin}/studio/review/${reviewToken}`;
  const dashboardUrl = `${window.location.origin}/studio/dashboard/${dashboardToken}`;

  return (
    <Layout>
      <div className="flex-1 flex items-center justify-center p-4 py-12 md:py-24">
        <div className="w-full max-w-2xl bg-card border border-card-border p-8 md:p-12 rounded-[2rem] shadow-sm text-center">
          <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-8">
            <CheckCircle2 className="w-10 h-10" />
          </div>
          
          <h1 className="text-3xl md:text-4xl font-serif font-medium mb-4">Project Submitted!</h1>
          <p className="text-lg text-muted-foreground mb-10 max-w-lg mx-auto">
            Our AI agents are already reviewing your brief and getting to work. We'll generate concepts and assets shortly.
          </p>

          <div className="bg-accent/30 border border-accent rounded-2xl p-6 mb-8 text-left">
            <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
              <span className="bg-primary text-primary-foreground w-6 h-6 rounded-full inline-flex items-center justify-center text-xs">!</span>
              Save these important links
            </h3>
            
            <div className="space-y-6">
              <div>
                <label className="text-sm font-medium text-muted-foreground block mb-2">Your Dashboard (All Projects)</label>
                <div className="flex items-center gap-2">
                  <div className="bg-background border border-border px-4 py-3 rounded-xl text-sm font-mono text-foreground flex-1 truncate overflow-hidden">
                    {dashboardUrl}
                  </div>
                  <button 
                    onClick={() => copyToClipboard(dashboardUrl, 'dashboard')}
                    className="p-3 bg-secondary/10 hover:bg-secondary/20 text-secondary-foreground rounded-xl transition-colors shrink-0"
                    title="Copy to clipboard"
                  >
                    {copiedDashboard ? <Check className="w-5 h-5 text-green-600" /> : <Copy className="w-5 h-5" />}
                  </button>
                  <Link href={`/dashboard/${dashboardToken}`} className="px-4 py-3 bg-foreground text-background rounded-xl text-sm font-medium shrink-0 hover:bg-foreground/90 transition-colors">
                    Open
                  </Link>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-muted-foreground block mb-2">Direct Review Link (This Project)</label>
                <div className="flex items-center gap-2">
                  <div className="bg-background border border-border px-4 py-3 rounded-xl text-sm font-mono text-foreground flex-1 truncate overflow-hidden">
                    {reviewUrl}
                  </div>
                  <button 
                    onClick={() => copyToClipboard(reviewUrl, 'review')}
                    className="p-3 bg-secondary/10 hover:bg-secondary/20 text-secondary-foreground rounded-xl transition-colors shrink-0"
                    title="Copy to clipboard"
                  >
                    {copiedReview ? <Check className="w-5 h-5 text-green-600" /> : <Copy className="w-5 h-5" />}
                  </button>
                  <Link href={`/review/${reviewToken}`} className="px-4 py-3 bg-foreground text-background rounded-xl text-sm font-medium shrink-0 hover:bg-foreground/90 transition-colors">
                    Open
                  </Link>
                </div>
              </div>
            </div>
            
            <p className="text-xs text-muted-foreground mt-4 text-center">
              * Bookmark your dashboard link to check status anytime without logging in.
            </p>
          </div>

          <Link href={`/dashboard/${dashboardToken}`} className="inline-flex px-8 py-4 bg-primary text-primary-foreground rounded-full font-medium text-lg hover:bg-primary/90 transition-all items-center gap-2">
            Go to Dashboard <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </div>
    </Layout>
  );
}
