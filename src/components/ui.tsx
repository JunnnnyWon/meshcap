import type { ReactNode } from 'react';

export function Panel({
  title,
  action,
  children,
  className = '',
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`border-b border-ink-800 ${className}`}>
      {title && (
        <header className="flex items-center justify-between px-4 pt-4 pb-2.5">
          <h2 className="label-caps">{title}</h2>
          {action}
        </header>
      )}
      <div className="px-4 pb-4">{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  unit,
  tone = 'default',
  hint,
}: {
  label: string;
  value: string | number;
  unit?: string;
  tone?: 'default' | 'good' | 'flaw' | 'muted';
  hint?: string;
}) {
  const toneClass =
    tone === 'good'
      ? 'text-good'
      : tone === 'flaw'
        ? 'text-flaw'
        : tone === 'muted'
          ? 'text-ink-400'
          : 'text-ink-100';

  return (
    <div className="flex items-baseline justify-between gap-3 py-[5px]" title={hint}>
      <span className="text-[12.5px] text-ink-400 shrink-0">{label}</span>
      <span className="flex-1 border-b border-dashed border-ink-800 translate-y-[-3px]" />
      <span className={`font-mono text-[13px] shrink-0 ${toneClass}`}>
        {typeof value === 'number' ? value.toLocaleString('ko-KR') : value}
        {unit && <span className="text-ink-400 ml-0.5 text-[11px]">{unit}</span>}
      </span>
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = 'ghost',
  disabled,
  className = '',
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'outline';
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  const variants = {
    primary: 'bg-amber-accent text-ink-950 hover:bg-[#ffb838]',
    ghost: 'text-ink-300 hover:text-ink-100 hover:bg-ink-800',
    outline: 'border border-ink-700 text-ink-300 hover:border-ink-600 hover:text-ink-100',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${base} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-ink-700 p-0.5 bg-ink-900/80 backdrop-blur">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={`px-3 py-1 rounded text-[12px] font-medium transition-colors ${
            value === option.id ? 'bg-ink-700 text-ink-100' : 'text-ink-400 hover:text-ink-300'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'flaw' | 'patch' | 'amber';
}) {
  const tones = {
    neutral: 'bg-ink-800 text-ink-300',
    good: 'bg-good/12 text-good',
    flaw: 'bg-flaw/12 text-flaw',
    patch: 'bg-patch/12 text-patch',
    amber: 'bg-amber-accent/12 text-amber-accent',
  };

  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] tracking-wide ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** 값이 개선되었는지 한눈에 보이도록 화살표와 함께 표시한다. */
export function Delta({ before, after, unit }: { before: number; after: number; unit?: string }) {
  const improved = after < before;
  const same = after === before;

  return (
    <span className="font-mono text-[12px]">
      <span className="text-ink-400">{before.toLocaleString('ko-KR')}</span>
      <span className="text-ink-600 mx-1.5">→</span>
      <span className={same ? 'text-ink-300' : improved ? 'text-good' : 'text-flaw'}>
        {after.toLocaleString('ko-KR')}
        {unit && <span className="text-ink-400 text-[10px] ml-0.5">{unit}</span>}
      </span>
    </span>
  );
}
