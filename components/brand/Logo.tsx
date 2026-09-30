/** Claimix mark: a primary-tinted shield with a check, drawn with theme tokens. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 2.5 4.5 7v8.2c0 7 4.9 12.4 11.5 14.3 6.6-1.9 11.5-7.3 11.5-14.3V7L16 2.5Z" fill="var(--c-primary)" stroke="var(--c-text)" strokeWidth="1.6" />
      <path d="m10.5 16.2 3.8 3.8 7.4-8" fill="none" stroke="var(--c-text)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
