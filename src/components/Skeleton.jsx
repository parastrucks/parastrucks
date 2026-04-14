/**
 * Shimmer placeholder shown while data loads.
 *
 * Variants:
 *   <Skeleton variant="text" />     — single text line (14px)
 *   <Skeleton variant="title" />    — heading (22px)
 *   <Skeleton variant="row" />      — table row (48px)
 *   <Skeleton variant="card" />     — card block (120px)
 *   <Skeleton variant="circle" />   — avatar (40px)
 *
 * Props:
 *   count   — repeat N times (useful for row placeholders)
 *   width   — override width (CSS value)
 *   height  — override height (CSS value)
 *   style   — extra inline styles
 */
export default function Skeleton({ variant = 'text', count = 1, width, height, style, className = '' }) {
  const els = []
  for (let i = 0; i < count; i++) {
    els.push(
      <div
        key={i}
        className={`skeleton skeleton--${variant} ${className}`}
        style={{ ...style, ...(width ? { width } : {}), ...(height ? { height } : {}) }}
      />
    )
  }
  return els.length === 1 ? els[0] : <>{els}</>
}
