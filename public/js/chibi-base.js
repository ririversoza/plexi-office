// Shared chibi constants and primitives (used by chibi.js and chibi-deluxe.js).
export const OUT = 'rgba(74,52,56,0.9)';
export const HY = -43; // head centre (feet at y = 0)
export const HR = 16;

/** An outlined, round-capped limb, optionally bent at an elbow. */
export function limb(ctx, x0, y0, x1, y1, color, width = 5.2, elbow = null) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  if (elbow) ctx.lineTo(elbow[0], elbow[1]);
  ctx.lineTo(x1, y1);
  ctx.strokeStyle = OUT;
  ctx.lineWidth = width + 2.4;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}
