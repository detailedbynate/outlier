import "server-only";
import { spawn } from "node:child_process";
import { createLogger } from "@/lib/core/logger";
import type { IdeaLens } from "@/lib/niches/breakouts";
import type { DiscoverFormat } from "@/lib/niches/discover";
import type { NicheBoard } from "@/lib/services/niche-service";

/**
 * Works out the Niche Finder boards in a child process (scripts/niche-board.ts).
 * Mining 40K uploads is close to a minute of solid CPU; inside the web server
 * it froze every page until it finished, so it runs beside it instead and only
 * the result comes back. One at a time, so it never takes more than one core.
 */

const log = createLogger({ module: "niches.board-process" });
const TIMEOUT_MS = 5 * 60_000;
export const BOARD_CHILD_ENV = "OUTLIER_BOARD_CHILD";

/** Only the web server hands the boards off; scripts, tests and the child itself work them out in-process. */
export function shouldOffloadBoards(): boolean {
  return process.env.NEXT_RUNTIME === "nodejs" && !process.env[BOARD_CHILD_ENV];
}
let queue: Promise<unknown> = Promise.resolve();

export function runBoardProcess(format: DiscoverFormat, lens: IdeaLens): Promise<NicheBoard> {
  const run = queue.then(() => spawnBoard(format, lens));
  queue = run.catch(() => {});
  return run;
}

function spawnBoard(format: DiscoverFormat, lens: IdeaLens): Promise<NicheBoard> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    // Its logs go where the server's go; the result comes back on a pipe of its own (fd 3).
    const child = spawn(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/niche-board.ts", format, lens], {
      cwd: process.cwd(),
      // Marked, so the child works the boards out itself instead of starting another child.
      env: { ...process.env, [BOARD_CHILD_ENV]: "1" },
      stdio: ["ignore", "inherit", "inherit", "pipe"],
    });
    const chunks: Buffer[] = [];
    child.stdio[3]?.on("data", (chunk: Buffer) => chunks.push(chunk));
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`niche board process exited with ${signal ?? code}`));
      try {
        const board = JSON.parse(Buffer.concat(chunks).toString("utf8")) as NicheBoard;
        log.info("niche board worked out", { format, lens, ms: Date.now() - started, discovered: board.discover.length });
        resolve(board);
      } catch (error) {
        reject(error);
      }
    });
  });
}
