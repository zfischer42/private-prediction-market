// Animated numbers - the one place this app spends a real animation budget,
// on purpose. "Numbers are the hero" (see /DESIGN.md) means a balance, an
// odds split or a payout should visibly move when it changes, not just
// silently repaint. Built on NumberFlow, which already respects
// prefers-reduced-motion on its own, so there is nothing extra to guard here.
import NumberFlow from '@number-flow/react';

const USD = { style: 'currency', currency: 'USD', maximumFractionDigits: 0 } as const;

export function Money({ value, className }: { value: number; className?: string }) {
  return <NumberFlow className={`num${className ? ` ${className}` : ''}`} value={value} format={USD} />;
}

// "+$50" / "-$20" / "$0" - exceptZero keeps a plain "$0" rather than "+$0".
export function SignedMoney({ value, className }: { value: number; className?: string }) {
  return (
    <NumberFlow
      className={`num${className ? ` ${className}` : ''}`}
      value={value}
      format={{ ...USD, signDisplay: 'exceptZero' }}
    />
  );
}

export function Percent({ value, className }: { value: number | null; className?: string }) {
  if (value === null) return <span className={className}>-</span>;
  return <NumberFlow className={`num${className ? ` ${className}` : ''}`} value={value} suffix="%" />;
}
