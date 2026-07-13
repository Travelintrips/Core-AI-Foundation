import { Link } from 'wouter';
import { AlertCircle } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';

export default function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md mx-4 bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
        <div className="flex mb-4 gap-3 items-start">
          <AlertCircle className="h-8 w-8 text-red-500 shrink-0 mt-0.5" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('notFound.title')}</h1>
            <p className="mt-2 text-sm text-gray-600">{t('notFound.desc')}</p>
            <Link href="/" className="mt-4 inline-block text-sm font-medium text-blue-600 hover:underline">
              {t('common.backToHome')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
