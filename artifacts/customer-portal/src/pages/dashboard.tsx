import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { StatusBadge } from "@/components/status-badge";
import { useGetCustomerDashboard } from "@/hooks/use-customer";
import { Folder, Clock, CheckCircle, ArrowRight, ArrowLeft, Loader2, Calendar, FileText } from "lucide-react";
import { format } from "date-fns";

export default function DashboardPage({ params }: { params: { dashboardToken: string } }) {
  const { data, isLoading, error } = useGetCustomerDashboard(params.dashboardToken);

  if (isLoading) {
    return (
      <Layout>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4 text-muted-foreground">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p>Loading your dashboard...</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (error || !data) {
    return (
      <Layout>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="max-w-md text-center">
            <h2 className="text-2xl font-serif mb-4">Dashboard not found</h2>
            <p className="text-muted-foreground mb-8">
              We couldn't load your dashboard. The link may be expired or invalid.
            </p>
            <Link href="/access" className="inline-flex px-6 py-3 bg-foreground text-background rounded-full font-medium">
              Request New Link
            </Link>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 md:px-8 py-12 max-w-6xl">
        <div className="mb-12">
          <h1 className="text-3xl md:text-4xl font-serif font-medium mb-2">Welcome back, {data.clientName}</h1>
          <p className="text-muted-foreground text-lg">Here are your creative projects and their current status.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-12">
          <div className="bg-card border border-card-border rounded-2xl p-6 shadow-sm flex items-center gap-4">
            <div className="w-12 h-12 bg-primary/10 text-primary rounded-full flex items-center justify-center">
              <Folder className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Total Projects</p>
              <p className="text-2xl font-serif font-semibold">{data.totalProjects}</p>
            </div>
          </div>
          
          <div className="bg-card border border-card-border rounded-2xl p-6 shadow-sm flex items-center gap-4">
            <div className="w-12 h-12 bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 rounded-full flex items-center justify-center">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Action Required</p>
              <p className="text-2xl font-serif font-semibold">{data.pendingReview}</p>
            </div>
          </div>
          
          <div className="bg-card border border-card-border rounded-2xl p-6 shadow-sm flex items-center gap-4">
            <div className="w-12 h-12 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded-full flex items-center justify-center">
              <CheckCircle className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Approved</p>
              <p className="text-2xl font-serif font-semibold">{data.approved}</p>
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-serif font-medium">Your Projects</h2>
            <Link href="/submit" className="text-sm font-medium text-primary hover:underline">
              + New Project
            </Link>
          </div>
          
          {data.projects.length === 0 ? (
            <div className="bg-card border border-card-border rounded-2xl p-12 text-center">
              <Folder className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
              <h3 className="text-xl font-medium mb-2">No projects yet</h3>
              <p className="text-muted-foreground mb-6">You haven't submitted any creative briefs.</p>
              <Link href="/submit" className="inline-flex px-6 py-3 bg-primary text-primary-foreground rounded-full font-medium hover:bg-primary/90 transition-colors">
                Start a Project
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {data.projects.map((project) => {
                const hasReviewLink = !!project.reviewToken;
                const cardContent = (
                  <div className={`bg-card border border-card-border rounded-2xl p-6 shadow-sm transition-all h-full flex flex-col ${hasReviewLink ? 'group-hover:shadow-md group-hover:border-primary/30' : 'opacity-80'}`}>
                    <div className="flex justify-between items-start mb-4 gap-4">
                      <div>
                        <h3 className="text-lg font-serif font-medium line-clamp-1">{project.brandName}</h3>
                        <p className="text-sm text-muted-foreground">{project.productOrService}</p>
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <StatusBadge status={project.status} type="project" />
                        <StatusBadge status={project.reviewStatus} type="review" />
                      </div>
                    </div>
                    
                    <p className="text-sm text-foreground/80 line-clamp-2 mb-6 flex-1">
                      {project.goal}
                    </p>

                    {project.quotationStatus && (
                      <div className={`flex items-center justify-between mb-4 px-3 py-2 rounded-lg text-xs ${
                        project.quotationStatus === 'sent'
                          ? 'bg-primary/10 text-primary'
                          : project.quotationStatus === 'approved'
                          ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        <span className="flex items-center gap-1.5 font-medium">
                          <FileText className="w-3.5 h-3.5" />
                          {project.quotationStatus === 'sent' ? 'Quotation awaiting your approval' :
                            project.quotationStatus === 'approved' ? 'Quotation approved' :
                            project.quotationStatus === 'rejected' ? 'Quotation declined' : 'Quotation expired'}
                        </span>
                        {typeof project.quotationTotal === 'number' && (
                          <span className="font-semibold">{project.quotationCurrency} {project.quotationTotal.toLocaleString()}</span>
                        )}
                      </div>
                    )}
                    
                    <div className="flex items-center justify-between mt-auto pt-4 border-t border-border/50">
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5" />
                          {format(new Date(project.updatedAt), 'MMM d, yyyy')}
                        </span>
                        {project.assetCount > 0 && (
                          <span className="flex items-center gap-1">
                            <Folder className="w-3.5 h-3.5" />
                            {project.assetCount} asset{project.assetCount !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      {hasReviewLink ? (
                        <div className="text-primary flex items-center gap-1 text-sm font-medium group-hover:translate-x-1 transition-transform">
                          View <ArrowRight className="w-4 h-4" />
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">Use your saved review link</span>
                      )}
                    </div>
                  </div>
                );

                const linkHref = project.quotationStatus === 'sent'
                  ? `/quotation/${project.reviewToken}`
                  : `/review/${project.reviewToken}`;

                return hasReviewLink ? (
                  <Link key={project.projectId} href={linkHref} className="group block">
                    {cardContent}
                  </Link>
                ) : (
                  <div key={project.projectId} className="block cursor-default" title="This project was set up by your account manager. Use the review link you received to access it.">
                    {cardContent}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
