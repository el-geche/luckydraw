import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { animate, motion, useMotionValue, useTransform } from 'framer-motion';
import { landingAngle } from '@luckydraw/shared';

// Calm, muted slice tones (navy / slate / steel) — winner turns gold.
const PALETTE = ['#1d2c4d', '#2a3d63', '#33496f', '#243656', '#3a4f78', '#1a2742', '#2e4469', '#22324f', '#384b6c', '#283a5c'];
const SIZE = 400;
const C = SIZE / 2;
const R = 182;

const pt = (deg, r = R) => {
  const a = (deg * Math.PI) / 180;
  return [C + r * Math.sin(a), C - r * Math.cos(a)];
};
function slicePath(a0, a1) {
  if (a1 - a0 >= 359.999) return null;
  const [x0, y0] = pt(a0);
  const [x1, y1] = pt(a1);
  return `M ${C} ${C} L ${x0} ${y0} A ${R} ${R} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1} Z`;
}

/**
 * SVG draw wheel. Slices are laid out clockwise from 12 o'clock exactly as the
 * draw engine lays out ticket ranges, so landing on ticket `t` means rotating by
 * landingAngle(t, W): the centre of ticket t sits precisely under the pointer.
 */
export const DrawWheel = forwardRef(function DrawWheel({ slices = [], totalWeight = 0, result = null, restOnResult = false, onLanded, highlightUserId, size = 420, spinDuration = 7.2 }, ref) {
  const rotation = useMotionValue(0);
  const sliceAngle = 360 / Math.max(slices.length, 1);
  // Pointer "clicks" gently as each slice boundary passes beneath it.
  const pointerTilt = useTransform(rotation, (r) => -Math.abs(Math.sin((r * Math.PI) / sliceAngle)) * 7);
  const [phase, setPhase] = useState(restOnResult && result ? 'landed' : 'idle');
  const anim = useRef(null);

  const userColor = useMemo(() => {
    const m = new Map();
    for (const s of slices) if (!m.has(s.userId)) m.set(s.userId, PALETTE[m.size % PALETTE.length]);
    return m;
  }, [slices]);

  const geo = useMemo(() => slices.map((s, i) => {
    const a0 = (s.start / totalWeight) * 360;
    const a1 = (s.end / totalWeight) * 360;
    return { ...s, i, a0, a1, mid: (a0 + a1) / 2, span: a1 - a0, d: slicePath(a0, a1) };
  }), [slices, totalWeight]);

  useEffect(() => {
    if (restOnResult && result && phase !== 'spinning') {
      rotation.set(landingAngle(result.ticket, result.totalWeight));
      setPhase('landed');
    }
  }, [restOnResult, result?.ticket]); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    spin() {
      if (!result || !slices.length) return;
      anim.current?.stop();
      rotation.set(rotation.get() % 360);
      const turns = 6 + Math.min(4, Math.floor(slices.length / 12));
      const target = turns * 360 + landingAngle(result.ticket, result.totalWeight);
      const from = rotation.get();
      setPhase('spinning');
      anim.current = animate(rotation, from > target ? target + 360 : target, {
        duration: spinDuration,
        ease: [0.1, 0.62, 0.08, 1], // long, decelerating ease-out: settles precisely, no bounce
        onComplete: () => { setPhase('landed'); onLanded?.(); },
      });
    },
    get phase() { return phase; },
  }));

  const winnerId = phase === 'landed' ? result?.winnerEntryId : null;
  const showLabels = geo.length <= 48;

  return (
    <div className={`wheel wheel-${phase}`} style={{ width: size, maxWidth: '100%' }}>
      <motion.svg className="wheel-pointer" viewBox="0 0 40 48" style={{ rotate: phase === 'spinning' ? pointerTilt : 0 }} aria-hidden>
        <defs><linearGradient id="pg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#f0d69a" /><stop offset="1" stopColor="#b8913d" /></linearGradient></defs>
        <path d="M20 46 L4 10 Q20 -2 36 10 Z" fill="url(#pg)" stroke="#0b1324" strokeWidth="2" />
        <circle cx="20" cy="14" r="4" fill="#0b1324" />
      </motion.svg>
      <div className="wheel-frame">
        <motion.div className="wheel-rotor" style={{ rotate: rotation }}>
          <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`Draw wheel with ${slices.length} entries`}>
            <defs>
              <radialGradient id="wg" cx="50%" cy="50%" r="50%"><stop offset="60%" stopColor="#000" stopOpacity="0" /><stop offset="100%" stopColor="#000" stopOpacity=".35" /></radialGradient>
              <linearGradient id="gold" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#e9cd8a" /><stop offset="1" stopColor="#b48a35" /></linearGradient>
            </defs>
            <circle cx={C} cy={C} r={R + 12} fill="#0d1628" stroke="url(#gold)" strokeWidth="2" />
            {geo.length === 0 && <circle cx={C} cy={C} r={R} fill="#1a2742" />}
            {geo.map((g) => {
              const isWinner = winnerId === g.entryId;
              const dim = winnerId != null && !isWinner;
              const mine = highlightUserId != null && g.userId === highlightUserId;
              const fill = isWinner ? 'url(#gold)' : userColor.get(g.userId);
              return g.d ? (
                <motion.path key={g.entryId} d={g.d} fill={fill} stroke="#0b1324" strokeWidth={geo.length > 30 ? 0.8 : 1.4}
                  initial={false} animate={{ opacity: dim ? 0.38 : 1 }} transition={{ duration: 0.6 }}
                  className={mine ? 'slice-mine' : undefined} />
              ) : (
                <circle key={g.entryId} cx={C} cy={C} r={R} fill={fill} />
              );
            })}
            {showLabels && geo.map((g) => g.span >= 6.5 && (
              <g key={`l${g.entryId}`} transform={`rotate(${g.mid} ${C} ${C})`}>
                <text x={C} y={C - R * 0.62} textAnchor="middle" dominantBaseline="middle"
                  transform={`rotate(-90 ${C} ${C - R * 0.62})`}
                  className="wheel-label" fill={winnerId === g.entryId ? '#0b1324' : '#d7deea'}
                  style={{ fontSize: Math.max(8, Math.min(13, g.span * 0.9)) }}>
                  {g.name.length > 11 ? `${g.name.slice(0, 10)}…` : g.name}
                </text>
              </g>
            ))}
            {geo.map((g) => { const [x, y] = pt(g.a0, R + 6); return <circle key={`t${g.entryId}`} cx={x} cy={y} r={geo.length > 40 ? 1.2 : 2} fill="#c9a24a" opacity=".85" />; })}
            <circle cx={C} cy={C} r={R} fill="url(#wg)" pointerEvents="none" />
          </svg>
        </motion.div>
        <div className="wheel-hub">
          <svg viewBox="0 0 64 64" width="44" height="44" aria-hidden>
            <circle cx="32" cy="32" r="18" fill="none" stroke="#c9a24a" strokeWidth="2.5" />
            <circle cx="32" cy="32" r="5" fill="#c9a24a" />
          </svg>
        </div>
      </div>
    </div>
  );
});
