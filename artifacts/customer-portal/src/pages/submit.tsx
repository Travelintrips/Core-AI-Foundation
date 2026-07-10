import { Link, useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useSubmitCustomerProject } from "@/hooks/use-customer";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ArrowLeft } from "lucide-react";

const formSchema = z.object({
  clientName: z.string().min(2, "Name is required"),
  clientEmail: z.string().email("Valid email is required"),
  clientPhone: z.string().optional(),
  brandName: z.string().min(2, "Brand name is required"),
  businessType: z.string().min(2, "Business type is required"),
  productOrService: z.string().min(2, "Product/Service description is required"),
  targetMarket: z.string().min(2, "Target market is required"),
  stylePreference: z.string().optional(),
  colorPreference: z.string().optional(),
  referenceLinks: z.string().optional(),
  goal: z.string().min(10, "Please provide more details about your goal"),
  notes: z.string().optional(),
  deadline: z.string().optional()
});

type FormValues = z.infer<typeof formSchema>;

export default function SubmitPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const submitProject = useSubmitCustomerProject();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      clientName: "",
      clientEmail: "",
      clientPhone: "",
      brandName: "",
      businessType: "",
      productOrService: "",
      targetMarket: "",
      stylePreference: "",
      colorPreference: "",
      referenceLinks: "",
      goal: "",
      notes: "",
      deadline: ""
    }
  });

  const onSubmit = (values: FormValues) => {
    submitProject.mutate(
      { data: values },
      {
        onSuccess: (res) => {
          setLocation(`/success?review=${res.reviewToken}&dashboard=${res.dashboardToken}`);
        },
        onError: (err) => {
          toast({
            title: "Submission Failed",
            description: err instanceof Error ? err.message : "Something went wrong.",
            variant: "destructive"
          });
        }
      }
    );
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 md:px-8 py-12 max-w-3xl">
        <Link href="/" className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground mb-8">
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>
        
        <div className="mb-10">
          <h1 className="text-4xl md:text-5xl font-serif font-medium mb-4">Start a Project</h1>
          <p className="text-lg text-muted-foreground">Tell us about your brand and what you want to achieve. Our AI will handle the rest.</p>
        </div>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-12">
          
          {/* Section 1: Contact Info */}
          <div className="space-y-6 bg-card border border-card-border p-8 rounded-2xl shadow-sm">
            <h2 className="text-xl font-serif font-medium border-b border-border pb-4">1. Your Details</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-medium">Your Name *</label>
                <input {...form.register("clientName")} className="w-full px-4 py-3 rounded-xl border border-input bg-background focus:ring-2 focus:ring-primary focus:outline-none" placeholder="Jane Doe" />
                {form.formState.errors.clientName && <p className="text-sm text-destructive">{form.formState.errors.clientName.message}</p>}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Email Address *</label>
                <input {...form.register("clientEmail")} type="email" className="w-full px-4 py-3 rounded-xl border border-input bg-background focus:ring-2 focus:ring-primary focus:outline-none" placeholder="jane@example.com" />
                {form.formState.errors.clientEmail && <p className="text-sm text-destructive">{form.formState.errors.clientEmail.message}</p>}
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium">Phone Number</label>
                <input {...form.register("clientPhone")} className="w-full px-4 py-3 rounded-xl border border-input bg-background focus:ring-2 focus:ring-primary focus:outline-none" placeholder="+1 (555) 000-0000" />
              </div>
            </div>
          </div>

          {/* Section 2: Brand Context */}
          <div className="space-y-6 bg-card border border-card-border p-8 rounded-2xl shadow-sm">
            <h2 className="text-xl font-serif font-medium border-b border-border pb-4">2. Brand Context</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-medium">Brand/Company Name *</label>
                <input {...form.register("brandName")} className="w-full px-4 py-3 rounded-xl border border-input bg-background focus:ring-2 focus:ring-primary focus:outline-none" placeholder="Acme Co." />
                {form.formState.errors.brandName && <p className="text-sm text-destructive">{form.formState.errors.brandName.message}</p>}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Business Type *</label>
                <input {...form.register("businessType")} className="w-full px-4 py-3 rounded-xl border border-input bg-background focus:ring-2 focus:ring-primary focus:outline-none" placeholder="e.g. B2B SaaS, D2C Coffee" />
                {form.formState.errors.businessType && <p className="text-sm text-destructive">{form.formState.errors.businessType.message}</p>}
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium">Core Product or Service *</label>
                <input {...form.register("productOrService")} className="w-full px-4 py-3 rounded-xl border border-input bg-background focus:ring-2 focus:ring-primary focus:outline-none" placeholder="What exactly do you sell?" />
                {form.formState.errors.productOrService && <p className="text-sm text-destructive">{form.formState.errors.productOrService.message}</p>}
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium">Target Market *</label>
                <input {...form.register("targetMarket")} className="w-full px-4 py-3 rounded-xl border border-input bg-background focus:ring-2 focus:ring-primary focus:outline-none" placeholder="Who are your customers? Demographics, psychographics." />
                {form.formState.errors.targetMarket && <p className="text-sm text-destructive">{form.formState.errors.targetMarket.message}</p>}
              </div>
            </div>
          </div>

          {/* Section 3: The Project */}
          <div className="space-y-6 bg-card border border-card-border p-8 rounded-2xl shadow-sm">
            <h2 className="text-xl font-serif font-medium border-b border-border pb-4">3. Creative Brief</h2>
            
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-medium">Project Goal *</label>
                <textarea {...form.register("goal")} rows={4} className="w-full px-4 py-3 rounded-xl border border-input bg-background focus:ring-2 focus:ring-primary focus:outline-none resize-none" placeholder="What are we designing? A new landing page hero, an ad campaign, brand mascots?" />
                {form.formState.errors.goal && <p className="text-sm text-destructive">{form.formState.errors.goal.message}</p>}
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Style Preferences</label>
                  <input {...form.register("stylePreference")} className="w-full px-4 py-3 rounded-xl border border-input bg-background focus:ring-2 focus:ring-primary focus:outline-none" placeholder="e.g. Minimalist, playful, corporate" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Color Preferences</label>
                  <input {...form.register("colorPreference")} className="w-full px-4 py-3 rounded-xl border border-input bg-background focus:ring-2 focus:ring-primary focus:outline-none" placeholder="e.g. Neon green and black" />
                </div>
              </div>
              
              <div className="space-y-2">
                <label className="text-sm font-medium">Reference Links (Optional)</label>
                <input {...form.register("referenceLinks")} className="w-full px-4 py-3 rounded-xl border border-input bg-background focus:ring-2 focus:ring-primary focus:outline-none" placeholder="URLs to moodboards, competitors, or inspiration" />
              </div>
              
              <div className="space-y-2">
                <label className="text-sm font-medium">Additional Notes</label>
                <textarea {...form.register("notes")} rows={3} className="w-full px-4 py-3 rounded-xl border border-input bg-background focus:ring-2 focus:ring-primary focus:outline-none resize-none" placeholder="Anything else our AI should know?" />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Deadline (Optional)</label>
                <input {...form.register("deadline")} className="w-full px-4 py-3 rounded-xl border border-input bg-background focus:ring-2 focus:ring-primary focus:outline-none" placeholder="e.g. Next Tuesday, 2 weeks" />
              </div>

              <div className="flex items-start gap-3 p-4 bg-primary/5 rounded-xl border border-primary/20">
                <span className="bg-primary text-primary-foreground w-5 h-5 rounded-full inline-flex items-center justify-center text-xs shrink-0 mt-0.5">!</span>
                <p className="text-sm font-medium text-foreground">
                  We'll review your brief and send you a price quotation to approve. Production starts as soon as you confirm it.
                </p>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-border flex justify-end">
            <button 
              type="submit" 
              disabled={submitProject.isPending}
              className="w-full md:w-auto px-10 py-4 bg-primary text-primary-foreground rounded-full font-medium text-lg flex items-center justify-center gap-2 hover:bg-primary/90 transition-all disabled:opacity-70 shadow-md shadow-primary/20"
            >
              {submitProject.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
              Submit Brief
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
