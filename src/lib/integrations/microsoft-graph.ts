/**
 * Microsoft Graph application client.
 * Credentials are supplied by a server-only caller; this module never reads or
 * logs secrets. A failed live probe is never reported as verified connectivity.
 */

export interface MicrosoftGraphCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export interface MicrosoftGraphOptions {
  fetchImpl?: typeof fetch;
  loginBaseUrl?: string;
  graphBaseUrl?: string;
  timeoutMs?: number;
  now?: () => Date;
}

export class MicrosoftGraphError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status = 0, code: string | null = null) {
    super(message);
    this.name = "MicrosoftGraphError";
    this.status = status;
    this.code = code;
  }
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

function requireValue(value: string, field: string): string {
  if (!value.trim()) throw new MicrosoftGraphError(`${field} is required`);
  return value.trim();
}

export function createMicrosoftGraphClient(
  credentials: MicrosoftGraphCredentials,
  options: MicrosoftGraphOptions = {}
) {
  const tenantId = requireValue(credentials.tenantId, "Microsoft tenant ID");
  const clientId = requireValue(credentials.clientId, "Microsoft client ID");
  const clientSecret = requireValue(credentials.clientSecret, "Microsoft client secret");
  const fetchImpl = options.fetchImpl ?? fetch;
  const loginBaseUrl = options.loginBaseUrl ?? "https://login.microsoftonline.com";
  const graphBaseUrl = options.graphBaseUrl ?? "https://graph.microsoft.com/v1.0";
  const timeoutMs = options.timeoutMs ?? 20_000;
  const now = options.now ?? (() => new Date());
  let cachedToken: { value: string; expiresAt: number } | null = null;

  function signal(): AbortSignal {
    return AbortSignal.timeout(timeoutMs);
  }

  async function readJson<T>(response: Response): Promise<T> {
    const text = await response.text();
    if (!response.ok) {
      let code: string | null = null;
      let message = `Microsoft Graph request failed with status ${response.status}`;
      try {
        const parsed = JSON.parse(text) as { error?: { code?: string; message?: string } };
        code = parsed.error?.code ?? null;
        if (parsed.error?.message) message = parsed.error.message;
      } catch {
        // Do not echo a raw response body that could contain tenant data.
      }
      throw new MicrosoftGraphError(message, response.status, code);
    }
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  async function getAccessToken(): Promise<string> {
    if (cachedToken && cachedToken.expiresAt > now().getTime() + 60_000) return cachedToken.value;
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials"
    });
    const response = await fetchImpl(`${loginBaseUrl}/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: signal()
    });
    const parsed = await readJson<TokenResponse>(response);
    if (!parsed?.access_token) throw new MicrosoftGraphError("Microsoft token response did not include an access token", 502);
    cachedToken = {
      value: parsed.access_token,
      expiresAt: now().getTime() + Math.max(60, parsed.expires_in) * 1000
    };
    return parsed.access_token;
  }

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await getAccessToken();
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    const response = await fetchImpl(`${graphBaseUrl}${path}`, { ...init, headers, signal: signal() });
    return readJson<T>(response);
  }

  async function getOrganization() {
    return request<{ value: Array<{ id: string; displayName?: string }> }>("/organization?$select=id,displayName");
  }

  async function getMailboxSettings(userId: string) {
    return request<Record<string, unknown>>(`/users/${encodeURIComponent(userId)}/mailboxSettings`);
  }

  async function getConnectionHealth(input: { mailbox?: string } = {}) {
    const organization = await getOrganization();
    const first = organization.value?.[0];
    if (!first?.id) throw new MicrosoftGraphError("Microsoft Graph returned no organization");
    if (input.mailbox) await getMailboxSettings(input.mailbox);
    return {
      status: "verified" as const,
      lastCheckedAt: now().toISOString(),
      evidence: `Graph token and organization probe succeeded${input.mailbox ? `; mailbox ${input.mailbox} readable` : ""}`
    };
  }

  return Object.freeze({
    getAccessToken,
    getOrganization,
    getMailboxSettings,
    getConnectionHealth,

    async sendMail(input: {
      from: string;
      to: string[];
      subject: string;
      text: string;
      html?: string;
      saveToSentItems?: boolean;
    }) {
      if (input.to.length === 0) throw new MicrosoftGraphError("At least one recipient is required");
      await request(`/users/${encodeURIComponent(input.from)}/sendMail`, {
        method: "POST",
        body: JSON.stringify({
          message: {
            subject: input.subject,
            body: { contentType: input.html ? "HTML" : "Text", content: input.html ?? input.text },
            toRecipients: input.to.map((address) => ({ emailAddress: { address } }))
          },
          saveToSentItems: input.saveToSentItems ?? true
        })
      });
      return { accepted: true as const };
    },

    async getCalendarView(input: { userId: string; start: string; end: string }) {
      const query = new URLSearchParams({ startDateTime: input.start, endDateTime: input.end });
      return request<{ value: Array<Record<string, unknown>> }>(
        `/users/${encodeURIComponent(input.userId)}/calendarView?${query.toString()}`
      );
    },

    async listTeams() {
      return request<{ value: Array<{ id: string; displayName?: string }> }>("/teams");
    },

    async provisionEmployeeMailbox(input: {
      userPrincipalName: string;
      displayName: string;
      mailNickname: string;
      usageLocation: string;
      temporaryPassword: string;
      forceChangePasswordNextSignIn?: boolean;
    }) {
      if (!input.temporaryPassword.trim()) {
        throw new MicrosoftGraphError("A temporary password from the secret provider is required");
      }
      await request("/users", {
        method: "POST",
        body: JSON.stringify({
          accountEnabled: true,
          displayName: input.displayName,
          mailNickname: input.mailNickname,
          userPrincipalName: input.userPrincipalName,
          usageLocation: input.usageLocation,
          passwordProfile: {
            forceChangePasswordNextSignIn: input.forceChangePasswordNextSignIn ?? true,
            password: input.temporaryPassword
          }
        })
      });
      return { created: true as const, userPrincipalName: input.userPrincipalName };
    }
  });
}
