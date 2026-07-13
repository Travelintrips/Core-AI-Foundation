import { formatMoney } from "@/lib/commercial-format";

export type PriceBreakdownRow = {
  key: string;
  label: string;
  amount: number;
  /** "discount" renders green + parenthesised/negative; "muted" for secondary detail rows. */
  kind?: "line" | "discount" | "muted";
  hint?: string;
};

/**
 * Consistent, right-aligned price table used across pricing / quotation /
 * checkout. Zero-value rows are hidden by default (spec 4: "zero-value row
 * tidak perlu tampil kecuali penting") — pass `alwaysShow` on a row to force it.
 */
export function PriceBreakdown({
  rows,
  total,
  currency,
  totalLabel = "Total",
  note,
  meta,
}: {
  rows: (PriceBreakdownRow & { alwaysShow?: boolean })[];
  total: number;
  currency: string;
  totalLabel?: string;
  note?: string;
  /** Small key/value facts shown above the rows, e.g. quotation number, issue date. */
  meta?: { label: string; value: string }[];
}) {
  const visibleRows = rows.filter((r) => r.alwaysShow || r.amount !== 0);

  return (
    <div className="bg-card border border-border rounded-2xl p-6">
      {meta && meta.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 mb-5 pb-5 border-b border-border/60 text-sm">
          {meta.map((m) => (
            <div key={m.label} className="flex flex-col">
              <dt className="text-xs text-muted-foreground">{m.label}</dt>
              <dd className="font-medium">{m.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <table className="w-full text-sm">
        <tbody>
          {visibleRows.map((row) => (
            <tr key={row.key}>
              <td className="py-1.5 text-muted-foreground align-top">
                {row.label}
                {row.hint && <span className="block text-xs text-muted-foreground/70">{row.hint}</span>}
              </td>
              <td
                className={`py-1.5 text-right tabular-nums font-medium whitespace-nowrap ${
                  row.kind === "discount" ? "text-green-600 dark:text-green-400" : row.kind === "muted" ? "text-muted-foreground" : ""
                }`}
              >
                {row.kind === "discount" && row.amount !== 0 ? "−" : ""}
                {formatMoney(Math.abs(row.amount), currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="border-t border-border pt-3 mt-2 flex justify-between items-center">
        <span className="font-semibold">{totalLabel}</span>
        <span className="text-xl font-bold text-primary tabular-nums">{formatMoney(total, currency)}</span>
      </div>

      {note && <p className="mt-4 text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">{note}</p>}
    </div>
  );
}
