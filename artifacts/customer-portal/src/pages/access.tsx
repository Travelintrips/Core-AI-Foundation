import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { ArrowLeft, Loader2, KeyRound } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useRequestCustomerAccess } from "@/hooks/use-customer";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";

export default function AccessPage() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const requestAccess = useRequestCustomerAccess();

  const formSchema = z.object({
    email: z.string().email(t('access.validationError')),
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    requestAccess.mutate(
      { data: { email: values.email } },
      {
        onSuccess: (data) => {
          toast({
            title: t('access.success.title'),
            description: t('access.success.desc', { count: data.projectCount }),
          });
          setLocation(`/dashboard/${data.dashboardToken}`);
        },
        onError: (err) => {
          toast({
            title: t('access.error.title'),
            description: err instanceof Error ? err.message : t('access.error.desc'),
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <Layout>
      <div className="flex-1 flex items-center justify-center p-4 py-20">
        <div className="w-full max-w-md">
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-8">
            <ArrowLeft className="w-4 h-4" /> {t('access.backToHome')}
          </Link>

          <div className="bg-card border border-card-border p-8 rounded-2xl shadow-sm">
            <div className="w-12 h-12 bg-primary/10 text-primary rounded-xl flex items-center justify-center mb-6">
              <KeyRound className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-serif font-medium mb-2">{t('access.title')}</h1>
            <p className="text-muted-foreground mb-8">{t('access.desc')}</p>

            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium text-foreground">
                  {t('access.emailLabel')}
                </label>
                <input
                  {...form.register("email")}
                  id="email"
                  type="email"
                  placeholder={t('access.emailPlaceholder')}
                  className="w-full px-4 py-3 rounded-xl border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                />
                {form.formState.errors.email && (
                  <p className="text-sm text-destructive">{form.formState.errors.email.message}</p>
                )}
              </div>

              <button
                type="submit"
                disabled={requestAccess.isPending}
                className="w-full py-4 bg-foreground text-background rounded-xl font-medium flex items-center justify-center gap-2 hover:bg-foreground/90 transition-colors disabled:opacity-70"
              >
                {requestAccess.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                {t('access.submit')}
              </button>
            </form>
          </div>
        </div>
      </div>
    </Layout>
  );
}
