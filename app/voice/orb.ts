import type { CSSProperties } from "react";

/** A voice's colour, the same every time: two hues from its id, like a little planet. */
export function orbStyle(id: string): CSSProperties {
  let hash = 0;
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const a = hash % 360;
  const b = (a + 50 + ((hash >> 9) % 90)) % 360;
  return { "--orb-a": `hsl(${a} 85% 62%)`, "--orb-b": `hsl(${b} 90% 55%)` } as CSSProperties;
}
