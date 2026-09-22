/**
 * One-off: write a Short script from the command line, to see what the real
 * thing produces.
 *
 *   npm run try-script -- "<niche>" "<idea>" ["<angle>"] [seconds]
 */
for (const file of [".env.local", ".env.production", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // Optional.
  }
}

const [topic, idea, angle, seconds] = process.argv.slice(2);
if (!topic || !idea) {
  console.error('usage: npm run try-script -- "<niche>" "<idea>" ["<angle>"] [seconds]');
  process.exit(1);
}

const { getServices } = await import("@/lib/services");
const { runWithQuotaContext } = await import("@/lib/youtube");

const result = await runWithQuotaContext({ lane: "background", operation: "cli:try-script" }, () =>
  getServices().scripts.write({
    topic,
    idea,
    angle: angle || undefined,
    targetSeconds: seconds ? (Number(seconds) as 15 | 30 | 45 | 60) : undefined,
  }),
);

const { script, sources, seconds: total, model } = result;
console.log(`\n=== ${model} · ${total}s planned · ${sources.length} sources (${sources.filter((s) => s.opening).length} with transcripts) ===\n`);
console.log(`HOOK: ${script.hook}`);
console.log(`  why: ${script.hookReason}\n`);
script.beats.forEach((beat, i) => {
  console.log(`${i + 1}. [${beat.seconds}s] ${beat.say}`);
  if (beat.onScreen) console.log(`   on screen: ${beat.onScreen}`);
  console.log(`   visual:    ${beat.visual}`);
});
console.log(`\nENDING: ${script.ending}`);
console.log(`TITLES: ${script.titles.join(" | ")}`);
if (script.caption) console.log(`CAPTION: ${script.caption}`);
console.log(`\nWHY IT WORKS: ${script.whyItWorks}`);
console.log(`\nSOURCES:`);
for (const source of sources) console.log(`  ${source.multiplier.toFixed(1)}x  ${source.title}${source.opening ? `\n        opens: "${source.opening}"` : ""}`);

export {};
