/**
 * Works out one format's Niche Finder boards and writes them as JSON to fd 3.
 * Started by the web server (lib/niches/board-process.ts), so the minute of
 * CPU it takes doesn't freeze the site. Usage: niche-board.ts <shorts|long_form> <gaming|paying>
 */
import { createWriteStream } from "node:fs";
import { getServices } from "@/lib/services";

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // The server passes its environment; these files are for running it locally.
  }
}

async function main(): Promise<void> {
  const [format, lens] = process.argv.slice(2);
  if ((format !== "shorts" && format !== "long_form") || (lens !== "gaming" && lens !== "paying")) {
    throw new Error("usage: niche-board.ts <shorts|long_form> <gaming|paying>");
  }
  const board = await getServices().niches.computeBoard(format, lens);
  const out = createWriteStream("", { fd: 3 });
  out.end(JSON.stringify(board), () => process.exit(0));
}

main().catch((error: unknown) => {
  console.error("niche board failed", error);
  process.exit(1);
});
