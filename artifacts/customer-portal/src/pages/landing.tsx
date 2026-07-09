import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { ArrowRight, CheckCircle2, Sparkles, Zap, Palette, Clock } from "lucide-react";

export default function LandingPage() {
  return (
    <Layout>
      <div className="w-full">
        {/* Hero Section */}
        <section className="py-24 md:py-32 lg:py-40 px-4 md:px-8 max-w-5xl mx-auto text-center space-y-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
            <Sparkles className="w-4 h-4" />
            <span>AI-Powered Design Agency</span>
          </div>
          <h1 className="text-5xl md:text-7xl font-serif tracking-tight text-foreground text-balance">
            Bring your brand's vision to life, instantly.
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Submit your creative brief and our autonomous AI agents will generate production-ready assets, copy, and creative direction in minutes.
          </p>
          <div className="pt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/submit" className="w-full sm:w-auto px-8 py-4 bg-primary text-primary-foreground rounded-full font-medium text-lg hover:bg-primary/90 transition-all flex items-center justify-center gap-2 shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 hover:-translate-y-0.5">
              Start Your Project <ArrowRight className="w-5 h-5" />
            </Link>
            <Link href="/access" className="w-full sm:w-auto px-8 py-4 bg-secondary/10 text-foreground rounded-full font-medium text-lg hover:bg-secondary/20 transition-all flex items-center justify-center">
              Check Project Status
            </Link>
          </div>
        </section>

        {/* How it works */}
        <section className="py-24 bg-muted/30 border-y border-border/40">
          <div className="container mx-auto px-4 md:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-serif font-medium mb-4">How it works</h2>
              <p className="text-muted-foreground max-w-xl mx-auto">From concept to final assets without the endless back-and-forth.</p>
            </div>
            
            <div className="grid md:grid-cols-3 gap-8 md:gap-12 max-w-5xl mx-auto">
              <div className="bg-background p-8 rounded-2xl border border-border shadow-sm">
                <div className="w-12 h-12 bg-primary/10 text-primary rounded-xl flex items-center justify-center mb-6">
                  <Palette className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-serif font-medium mb-3">1. Share your vision</h3>
                <p className="text-muted-foreground leading-relaxed">Tell us about your brand, goals, and style preferences through our simple guided brief.</p>
              </div>
              
              <div className="bg-background p-8 rounded-2xl border border-border shadow-sm">
                <div className="w-12 h-12 bg-secondary/10 text-secondary-foreground rounded-xl flex items-center justify-center mb-6">
                  <Zap className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-serif font-medium mb-3">2. AI Generation</h3>
                <p className="text-muted-foreground leading-relaxed">Our autonomous agents analyze your brief and generate bespoke copy, visuals, and concepts.</p>
              </div>
              
              <div className="bg-background p-8 rounded-2xl border border-border shadow-sm">
                <div className="w-12 h-12 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded-xl flex items-center justify-center mb-6">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-serif font-medium mb-3">3. Review & Approve</h3>
                <p className="text-muted-foreground leading-relaxed">Review the output in your private portal, leave feedback for revisions, or approve to download.</p>
              </div>
            </div>
          </div>
        </section>
        
        {/* CTA */}
        <section className="py-24 px-4 text-center">
          <div className="max-w-3xl mx-auto bg-primary text-primary-foreground p-12 md:p-16 rounded-[2.5rem] relative overflow-hidden">
            <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-white to-transparent"></div>
            <div className="relative z-10">
              <h2 className="text-3xl md:text-5xl font-serif font-medium mb-6">Ready to create something beautiful?</h2>
              <p className="text-primary-foreground/80 mb-8 text-lg max-w-xl mx-auto">
                No credit card required. Submit a brief and see what our AI studio can generate for your brand today.
              </p>
              <Link href="/submit" className="inline-flex px-8 py-4 bg-background text-primary rounded-full font-medium text-lg hover:bg-background/90 transition-all items-center gap-2">
                Start a Project <ArrowRight className="w-5 h-5" />
              </Link>
            </div>
          </div>
        </section>
      </div>
    </Layout>
  );
}
