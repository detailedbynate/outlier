import { AppError, ValidationError } from "@/lib/core/errors";
import { createLogger, type Logger } from "@/lib/core/logger";
import type { TextProvider } from "@/lib/ai/types";
import type { SavedScriptRepository } from "@/lib/database/repositories/saved-scripts";
import type { StyleSampleRepository } from "@/lib/database/repositories/style-samples";
import { IDEAS, IDEA_COUNT, ideaSystemPrompt, ideaUserPrompt, type IdeaResult } from "@/lib/scripts/ideas";
import { scriptSystemPrompt, scriptUserPrompt } from "@/lib/scripts/prompt";
import { SCRIPT, type ScriptRequest, type ScriptResult } from "@/lib/scripts/schema";

/**
 * Writes a Short script.
 *
 * It used to gather the niche's outlier videos first and write from their
 * titles. That cost a database round trip and up to four transcript reads per
 * request — a minute or two of waiting — and made the scripts worse, not
 * better: a title tells a model what a video was called, not what is true about
 * the subject, so it filled the gap by inventing. Now the only inputs are what
 * the creator typed and what the model knows, which is both faster and honest
 * about where the writing is coming from.
 */

export const SCRIPT_EVENT = "script.write";

export interface ScriptDeps {
  ai: TextProvider | null;
  /** Every script is kept; there's no save button to forget. Also what ideas avoid repeating. */
  saved: Pick<SavedScriptRepository, "save" | "listForUser" | "delete">;
  /** Their own scripts, which the writer copies the voice of. */
  styles: Pick<StyleSampleRepository, "listForUser">;
  logger?: Logger;
}

export class ScriptService {
  private readonly log: Logger;

  constructor(private readonly deps: ScriptDeps) {
    this.log = deps.logger ?? createLogger({ module: "services.scripts" });
  }

  async write(request: ScriptRequest, userId?: string): Promise<ScriptResult> {
    const topic = request.topic.trim();
    const idea = request.idea.trim();
    if (!topic) throw new ValidationError("Pick a niche to write for.");
    if (!idea) throw new ValidationError("Say what the Short should be about.");
    if (!this.deps.ai) throw new AppError("CONFIG_ERROR", "Script writing isn't available right now.", { expose: true });

    // Their own scripts are the examples, when they've given us any.
    let samples: string[] = [];
    if (userId) {
      try {
        samples = (await this.deps.styles.listForUser(userId)).map((row) => row.body);
      } catch (error) {
        // Without them it writes from the built-in examples, which is the old behaviour.
        this.log.warn("style samples unavailable", { error });
      }
    }

    const { object, model, usage } = await this.deps.ai.generateObject({
      system: scriptSystemPrompt(samples),
      messages: [{ role: "user", content: scriptUserPrompt({ ...request, topic, idea }) }],
      schema: SCRIPT,
      schemaName: "short_script",
      // Room to be surprising; the layout is held by the prompt, not by luck.
      temperature: 0.8,
      // The free models reason against the output budget and a half-written
      // script is worth nothing, so the budget goes to the words.
      effort: "low",
      maxOutputTokens: 4_000,
      // One person, one script: the cache would expire before anyone read it back.
      cacheSystem: false,
    });

    const words = object.script.split(/\s+/).filter(Boolean).length;
    this.log.info("script written", { topic, words, model, styleSamples: samples.length, inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens });

    let id: string | null = null;
    if (userId) {
      try {
        const row = await this.deps.saved.save({
          user_id: userId,
          topic,
          idea,
          angle: request.angle?.trim() || null,
          seconds: request.targetSeconds ?? 30,
          tone: request.tone ?? "energetic",
          script: object.script,
          titles: object.titles,
          words,
          model,
        });
        id = row?.id ?? null;
      } catch (error) {
        // They paid for this one; handing it over matters more than filing it.
        this.log.warn("script not saved", { topic, error });
      }
    }
    return { id, script: object, words, model };
  }
  /**
   * Ideas for a niche.
   *
   * Cheaper than a script and deliberately so: this is the step people take
   * several times before writing anything. What it has over pasting a niche
   * into a chatbot is memory — it can see every script they've made and is told
   * not to suggest any of them again.
   */
  async ideas(topic: string, userId?: string): Promise<IdeaResult> {
    const niche = topic.trim();
    if (!niche) throw new ValidationError("Pick a niche to find ideas for.");
    if (!this.deps.ai) throw new AppError("CONFIG_ERROR", "Idea finding isn't available right now.", { expose: true });

    let alreadyMade: string[] = [];
    let samples: string[] = [];
    if (userId) {
      try {
        const [made, styles] = await Promise.all([this.deps.saved.listForUser(userId), this.deps.styles.listForUser(userId)]);
        // Titles rather than whole scripts: enough to recognise a repeat, cheap to send.
        alreadyMade = made.flatMap((row) => [row.idea, ...row.titles]);
        samples = styles.map((row) => row.body);
      } catch (error) {
        // Ideas without the history are still ideas; they just might repeat one.
        this.log.warn("idea history unavailable", { error });
      }
    }

    const { object, model, usage } = await this.deps.ai.generateObject({
      system: ideaSystemPrompt(),
      messages: [{ role: "user", content: ideaUserPrompt({ topic: niche, alreadyMade, samples, count: IDEA_COUNT }) }],
      schema: IDEAS,
      schemaName: "short_ideas",
      temperature: 0.9,
      effort: "low",
      maxOutputTokens: 2_000,
      cacheSystem: false,
    });

    this.log.info("ideas found", { topic: niche, ideas: object.ideas.length, knownTitles: alreadyMade.length, model, inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens });
    return { ideas: object.ideas, model };
  }

}
