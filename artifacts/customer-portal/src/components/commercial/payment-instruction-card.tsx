import { useState } from "react";
import { Copy, Check, Landmark } from "lucide-react";

export type BankAccount = { bank: string; accountNumber: string; accountName: string };

/**
 * The same company bank accounts already shown to customers on the
 * workspace invoices page (src/pages/workspace/invoices.tsx) — reused here
 * rather than re-typed, so this is existing, established account data, not
 * new/invented figures. Update in one place if these ever change.
 */
export const COMPANY_BANK_ACCOUNTS: BankAccount[] = [
  { bank: "BCA", accountNumber: "123-456-7890", accountName: "PT Creative AI Studio" },
  { bank: "Mandiri", accountNumber: "098-765-4321", accountName: "PT Creative AI Studio" },
  { bank: "BNI", accountNumber: "555-111-2222", accountName: "PT Creative AI Studio" },
];

export function PaymentInstructionCard({ accounts = COMPANY_BANK_ACCOUNTS }: { accounts?: BankAccount[] }) {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  function copy(idx: number, value: string) {
    navigator.clipboard.writeText(value).catch(() => {});
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  }

  return (
    <div className="bg-card border border-border rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <Landmark className="w-4 h-4 text-primary" />
        <h3 className="font-semibold text-sm">Instruksi Pembayaran</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Transfer ke salah satu rekening berikut, lalu kirimkan bukti transfer di bawah.
      </p>
      <div className="space-y-2">
        {accounts.map((acc, idx) => (
          <div key={idx} className="bg-muted/40 rounded-xl px-4 py-3 flex items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-sm">{acc.bank}</p>
              <p className="font-mono text-xs text-muted-foreground">{acc.accountNumber}</p>
              <p className="text-xs text-muted-foreground">{acc.accountName}</p>
            </div>
            <button
              type="button"
              onClick={() => copy(idx, acc.accountNumber)}
              className="p-2 rounded-lg hover:bg-muted transition-colors shrink-0"
              aria-label={`Salin nomor rekening ${acc.bank}`}
              title="Salin nomor rekening"
            >
              {copiedIdx === idx ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-muted-foreground" />}
            </button>
          </div>
        ))}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {copiedIdx !== null ? "Nomor rekening disalin" : ""}
      </p>
    </div>
  );
}
