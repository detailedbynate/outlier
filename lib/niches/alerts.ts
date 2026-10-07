import type { GameStat } from "./games";

/**
 * What's moved for a game someone saved: views warming up or cooling off,
 * small channels breaking out, or the game climbing Steam or Roblox before
 * YouTube has caught up. Shown on the saved list, freshest library data.
 */
export interface GameAlert {
  tone: "up" | "down" | "flat";
  text: string;
}

const pct = (n: number) => `${Math.round(Math.abs(n) * 100)}%`;

export function gameAlert(stat: GameStat | undefined, rising: boolean): GameAlert | null {
  const up: string[] = [];
  const down: string[] = [];
  if (rising) up.push(stat ? "climbing on Steam or Roblox" : "taking off on Steam or Roblox, little on YouTube yet");
  if (stat?.momentum != null && stat.momentum >= 0.25) up.push(`views up ${pct(stat.momentum)} in two weeks`);
  if (stat?.momentum != null && stat.momentum <= -0.25) down.push(`views down ${pct(stat.momentum)} in two weeks`);
  if (stat && stat.smallUploads >= 5 && stat.breakoutRate >= 0.3) up.push(`${pct(stat.breakoutRate)} of small-channel uploads breaking out`);
  const parts = [...up, ...down].slice(0, 2);
  if (parts.length) {
    const text = parts.join(" · ");
    return { tone: down.length && !up.length ? "down" : up.length && !down.length ? "up" : "flat", text: text[0]!.toUpperCase() + text.slice(1) };
  }
  if (!stat) return null;
  return { tone: "flat", text: `${stat.smallUploads} small-channel uploads in four weeks, ${pct(stat.breakoutRate)} broke out` };
}
