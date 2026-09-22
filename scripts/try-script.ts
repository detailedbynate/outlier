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

// Wrapped, not top level: the runner emits CommonJS, where top-level await
// isn't allowed. Same shape as scripts/scraper.ts.
async function main(): Promise<void> {
  const { getServices } = await import("@/lib/services");
  const { runWithQuotaContext } = await import("@/lib/youtube");

  const result = await runWithQuotaContext({ lane: "background", operation: "cli:try-script" }, () =>
    getServices().scripts.write({
      topic: topic!,
      idea: idea!,
      angle: angle || undefined,
      targetSeconds: seconds ? (Number(seconds) as 15 | 30 | 45 | 60) : undefined,
    }),
  );

  const { script, words, model } = result;
  console.log(`
=== ${model} · ${words} words ===
`);
  console.log(script.script);
  console.log(`
TITLES: ${script.titles.join(" | ")}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
