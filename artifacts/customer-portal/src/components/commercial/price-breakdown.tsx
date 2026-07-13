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
