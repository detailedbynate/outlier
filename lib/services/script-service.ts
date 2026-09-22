import { AppError, ValidationError } from "@/lib/core/errors";
import { createLogger, type Logger } from "@/lib/core/logger";
import type { TextProvider } from "@/lib/ai/types";
import type { SavedScriptRepository } from "@/lib/database/repositories/saved-scripts";
import type { StyleSampleRepository } from "@/lib/database/repositories/style-samples";
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
  /** Every script is kept; there's no save button to forget. */
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

    const { object, model } = await this.deps.ai.generateObject({
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
    });

    const words = object.script.split(/\s+/).filter(Boolean).length;
    this.log.info("script written", { topic, words, model, styleSamples: samples.length });

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
}
