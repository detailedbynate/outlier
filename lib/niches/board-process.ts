import "server-only";
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createLogger } from "@/lib/core/logger";
import type { IdeaLens } from "@/lib/niches/breakouts";
import type { DiscoverFormat } from "@/lib/niches/discover";
import type { NicheBoard } from "@/lib/services/niche-service";

/**
 * Works out the Niche Finder boards in a child process (scripts/niche-board.ts).
 * Mining the library is a few minutes of solid CPU; inside the web server it
 * froze every page until it finished, so it runs beside it instead and only
 * the result comes back. One at a time, so it never takes more than one core.
 *
 * Every finished board is also written to disk. After a restart (every deploy)
 * the last one is served at once while a fresh one is worked out behind it;
 * before this, the first visitor after a deploy waited the full few minutes.
 */

const log = createLogger({ module: "niches.board-process" });
const TIMEOUT_MS = 8 * 60_000;
/** A saved board younger than this is served as it is; older, it's served while a new one is worked out. */
const FRESH_MS = 60 * 60_000;
/** Too old to show at all: wait for a new one instead. */
const USABLE_MS = 3 * 24 * 3_600_000;
export const BOARD_CHILD_ENV = "OUTLIER_BOARD_CHILD";

/** Only the web server hands the boards off; scripts, tests and the child itself work them out in-process. */
export function shouldOffloadBoards(): boolean {
  return process.env.NEXT_RUNTIME === "nodejs" && !process.env[BOARD_CHILD_ENV];
}

/**
 * Next loads this module once per route bundle, so module-level state would
 * give the cron route and the page a queue each, and two children mining the
 * same board side by side. The process-wide global is shared by all of them.
 */
interface Shared {
  queue: Promise<unknown>;
  running: Map<string, Promise<NicheBoard>>;
}
const SHARED_KEY = Symbol.for("outlier.niche-board-process");
const shared: Shared = ((globalThis as Record<symbol, unknown>)[SHARED_KEY] as Shared | undefined) ??
  ((globalThis as Record<symbol, unknown>)[SHARED_KEY] = { queue: Promise.resolve(), running: new Map() } satisfies Shared);

const cacheFile = (format: DiscoverFormat, lens: IdeaLens) => path.join(process.cwd(), ".next", "cache", "niche-board", `${format}-${lens}.json`);

export async function runBoardProcess(format: DiscoverFormat, lens: IdeaLens): Promise<NicheBoard> {
  const saved = await readSaved(format, lens);
  if (saved) {
    const age = Date.now() - saved.at;
    if (age < FRESH_MS) return saved.board;
    if (age < USABLE_MS) {
      // Show the last one now; the next look after the service's cache expires gets the new one.
      refresh(format, lens).catch((error: unknown) => log.warn("niche board refresh failed", { format, lens, error }));
      return saved.board;
    }
  }
  return refresh(format, lens);
}

/** One run per board at a time across the whole server, queued behind any other board. */
function refresh(format: DiscoverFormat, lens: IdeaLens): Promise<NicheBoard> {
  const key = `${format}:${lens}`;
  const running = shared.running.get(key);
  if (running) return running;
  const run = shared.queue.then(() => spawnBoard(format, lens));
  shared.queue = run.catch(() => {});
  const tracked = run
    .then(async (board) => {
      await save(format, lens, board);
      return board;
    })
    .finally(() => shared.running.delete(key));
  shared.running.set(key, tracked);
  return tracked;
}

async function readSaved(format: DiscoverFormat, lens: IdeaLens): Promise<{ at: number; board: NicheBoard } | null> {
  try {
    const parsed = JSON.parse(await readFile(cacheFile(format, lens), "utf8")) as { at?: unknown; board?: unknown };
    if (typeof parsed.at !== "number" || !parsed.board || typeof parsed.board !== "object") return null;
    const board = parsed.board as NicheBoard;
    return Array.isArray(board.discover) && board.ideas ? { at: parsed.at, board } : null;
  } catch {
    // Missing or half-written: work it out instead.
    return null;
  }
}

async function save(format: DiscoverFormat, lens: IdeaLens, board: NicheBoard): Promise<void> {
  const file = cacheFile(format, lens);
  try {
    await mkdir(path.dirname(file), { recursive: true });
    // Written beside it and renamed into place, so a reader never sees half a file.
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify({ at: Date.now(), board }));
    await rename(temp, file);
  } catch (error) {
    log.warn("couldn't keep the niche board on disk", { format, lens, error });
  }
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
