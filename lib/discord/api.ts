/**
 * The few Discord REST calls Outlier makes, with no library. Roles and posts go
 * out as plain HTTPS calls with the bot token; slash commands arrive over the
 * bot's gateway connection (gateway.ts) and are answered here.
 */

const API = "https://discord.com/api/v10";

export class DiscordApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: number | null,
    message: string,
  ) {
    super(message);
    this.name = "DiscordApiError";
  }
}

export interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
}

export interface DiscordMessage {
  content?: string;
  embeds?: Record<string, unknown>[];
  components?: Record<string, unknown>[];
  allowed_mentions?: { parse: string[] };
  flags?: number;
}

type Fetch = typeof fetch;

export class DiscordApi {
  constructor(
    private readonly botToken: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  /** One call, retried once after the wait Discord asks for when rate-limited. */
  private async call<T>(method: string, path: string, body?: unknown, auth = `Bot ${this.botToken}`): Promise<T | null> {
    for (let attempt = 0; ; attempt++) {
      const response = await this.fetchImpl(`${API}${path}`, {
        method,
        headers: { Authorization: auth, ...(body === undefined ? {} : { "Content-Type": "application/json" }), "User-Agent": "DiscordBot (https://www.useoutlier.online, 1)" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status === 429 && attempt === 0) {
        const wait = Number((await response.json().catch(() => ({})) as { retry_after?: number }).retry_after ?? 1);
        await new Promise((resolve) => setTimeout(resolve, Math.min(10, Math.max(0.2, wait)) * 1000));
        continue;
      }
      if (response.status === 204) return null;
      const data = (await response.json().catch(() => null)) as (T & { code?: number; message?: string }) | null;
      if (!response.ok) throw new DiscordApiError(response.status, data?.code ?? null, `Discord ${method} ${path.replace(/\d{15,}/g, ":id")}: ${response.status} ${data?.message ?? ""}`.trim());
      return data;
    }
  }

  /** Add someone to the server with the access token from their Discord sign-in. Does nothing if they're already in. */
  addMember(guildId: string, userId: string, accessToken: string, roles: string[]): Promise<unknown> {
    return this.call("PUT", `/guilds/${guildId}/members/${userId}`, { access_token: accessToken, roles });
  }

  /** Their roles in the server, or null when they aren't in it. */
  async memberRoles(guildId: string, userId: string): Promise<string[] | null> {
    try {
      return (await this.call<{ roles: string[] }>("GET", `/guilds/${guildId}/members/${userId}`))?.roles ?? [];
    } catch (error) {
      // 10007 Unknown Member, 10013 Unknown User: not in the server.
      if (error instanceof DiscordApiError && (error.code === 10007 || error.code === 10013 || error.status === 404)) return null;
      throw error;
    }
  }

  addRole(guildId: string, userId: string, roleId: string): Promise<unknown> {
    return this.call("PUT", `/guilds/${guildId}/members/${userId}/roles/${roleId}`);
  }

  removeRole(guildId: string, userId: string, roleId: string): Promise<unknown> {
    return this.call("DELETE", `/guilds/${guildId}/members/${userId}/roles/${roleId}`);
  }

  sendMessage(channelId: string, message: DiscordMessage): Promise<unknown> {
    return this.call("POST", `/channels/${channelId}/messages`, message);
  }

  /** The server's text and announcement channels, in the order Discord shows them. */
  async textChannels(guildId: string): Promise<{ id: string; name: string; parent: string | null }[]> {
    const all = (await this.call<{ id: string; name: string; type: number; position: number; parent_id: string | null }[]>("GET", `/guilds/${guildId}/channels`)) ?? [];
    const categories = new Map(all.filter((c) => c.type === 4).map((c) => [c.id, c]));
    const order = (c: { position: number; parent_id: string | null }) => (c.parent_id ? (categories.get(c.parent_id)?.position ?? 0) + 1 : 0) * 10_000 + c.position;
    return all
      .filter((c) => c.type === 0 || c.type === 5)
      .sort((a, b) => order(a) - order(b))
      .map((c) => ({ id: c.id, name: c.name, parent: c.parent_id ? (categories.get(c.parent_id)?.name ?? null) : null }));
  }

  /** Answer a slash command or button press (within 3 seconds of it arriving). */
  respond(interactionId: string, interactionToken: string, response: { type: number; data?: DiscordMessage }): Promise<unknown> {
    return this.call("POST", `/interactions/${interactionId}/${interactionToken}/callback`, response);
  }

  /** Replace the server's slash commands with these (they show up straight away, unlike global ones). */
  registerCommands(applicationId: string, guildId: string, commands: readonly unknown[]): Promise<unknown> {
    return this.call("PUT", `/applications/${applicationId}/guilds/${guildId}/commands`, commands);
  }

  /** Swap the code from Discord sign-in for an access token. */
  static async exchangeCode(input: { clientId: string; clientSecret: string; code: string; redirectUri: string }, fetchImpl: Fetch = fetch): Promise<string> {
    const response = await fetchImpl(`${API}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: input.code, redirect_uri: input.redirectUri, client_id: input.clientId, client_secret: input.clientSecret }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await response.json().catch(() => null)) as { access_token?: string; error?: string } | null;
    if (!response.ok || !data?.access_token) throw new DiscordApiError(response.status, null, `Discord token exchange failed: ${data?.error ?? response.status}`);
    return data.access_token;
  }

  /** Who signed in, from their access token. */
  static async me(accessToken: string, fetchImpl: Fetch = fetch): Promise<DiscordUser> {
    const user = await new DiscordApi("", fetchImpl).call<DiscordUser>("GET", "/users/@me", undefined, `Bearer ${accessToken}`);
    if (!user?.id) throw new DiscordApiError(500, null, "Discord returned no user");
    return user;
  }
}
