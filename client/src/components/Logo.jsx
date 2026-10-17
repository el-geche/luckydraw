export function Logo({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <circle cx="32" cy="34" r="22" fill="none" stroke="var(--gold)" strokeWidth="3" />
      <path d="M32 12v44M10 34h44M16.4 18.4l31.2 31.2M47.6 18.4L16.4 49.6" stroke="var(--gold)" strokeWidth="1.4" opacity=".45" />
      <circle cx="32" cy="34" r="5.5" fill="var(--gold)" />
      <path d="M32 4l6 9H26z" fill="var(--gold-2)" />
    </svg>
  );
}
