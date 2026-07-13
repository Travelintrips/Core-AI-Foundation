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
export interface PriceBreakdownLineItem {
  key?: string | number;
  label: string;
  meta?: string;
  amount: number;
}

export interface PriceBreakdownProps {
  currency: string;
  lineItems: PriceBreakdownLineItem[];
  subtotal: number;
  discount?: number;
  taxLabel?: string;
  taxAmount?: number;
  total: number;
  formatMoney: (amount: number, currency: string) => string;
}

/**
 * Structured quotation / invoice price breakdown. Renders a table on desktop
 * and stacked cards on narrow screens so nothing overflows horizontally.
 * Display-only — never recomputes totals, just formats what the API returned.
 */
export function PriceBreakdown({
  currency,
  lineItems,
  subtotal,
  discount,
  taxLabel,
  taxAmount,
  total,
  formatMoney,
}: PriceBreakdownProps) {
  return (
    <div className="bg-card border border-card-border rounded-2xl overflow-hidden">
      {/* Desktop table */}
      <table className="w-full text-sm hidden md:table">
        <thead>
          <tr className="text-left text-muted-foreground border-b border-border/50">
            <th scope="col" className="px-6 pt-6 pb-2 font-medium">Item</th>
            <th scope="col" className="px-6 pt-6 pb-2 font-medium text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lineItems.map((item, i) => (
            <tr key={item.key ?? i} className="border-b border-border/30">
              <td className="px-6 py-3">
                <div>{item.label}</div>
                {item.meta && <div className="text-xs text-muted-foreground mt-0.5">{item.meta}</div>}
              </td>
              <td className="px-6 py-3 text-right font-medium tabular-nums">
                {formatMoney(item.amount, currency)}
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
      {/* Mobile cards */}
      <div className="md:hidden divide-y divide-border/30">
        {lineItems.map((item, i) => (
          <div key={item.key ?? i} className="px-4 py-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm">{item.label}</div>
              {item.meta && <div className="text-xs text-muted-foreground mt-0.5">{item.meta}</div>}
            </div>
            <div className="text-sm font-medium tabular-nums shrink-0">{formatMoney(item.amount, currency)}</div>
          </div>
        ))}
      </div>

      {/* Totals */}
      <div className="px-4 md:px-6 py-4 bg-muted/20 border-t border-border/50">
        <div className="space-y-1.5 text-sm ml-auto max-w-xs">
          <div className="flex justify-between text-muted-foreground">
            <span>Subtotal</span>
            <span className="tabular-nums">{formatMoney(subtotal, currency)}</span>
          </div>
          {!!discount && discount > 0 && (
            <div className="flex justify-between text-muted-foreground">
              <span>Discount</span>
              <span className="tabular-nums">-{formatMoney(discount, currency)}</span>
            </div>
          )}
          {!!taxAmount && taxAmount > 0 && (
            <div className="flex justify-between text-muted-foreground">
              <span>{taxLabel ?? "Tax"}</span>
              <span className="tabular-nums">{formatMoney(taxAmount, currency)}</span>
            </div>
          )}
          <div className="flex justify-between font-serif text-lg font-semibold pt-2 border-t border-border/50">
            <span>Total</span>
            <span className="tabular-nums">{formatMoney(total, currency)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
