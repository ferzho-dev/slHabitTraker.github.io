import type { AppConfig } from '../config/env.js';

export type NotionTokenResponse = {
  access_token: string; refresh_token: string | null; bot_id: string;
  workspace_id: string; workspace_name: string | null; workspace_icon: string | null;
  owner: unknown; duplicated_template_id: string | null;
};

export class NotionOAuthService {
  constructor(private readonly config: Pick<AppConfig, 'NOTION_CLIENT_ID'|'NOTION_CLIENT_SECRET'|'NOTION_REDIRECT_URI'|'NOTION_AUTH_URL'|'NOTION_VERSION'>,
    private readonly request: typeof fetch = fetch) {}

  authorizationUrl(state: string): string {
    const url = new URL(this.config.NOTION_AUTH_URL);
    url.searchParams.set('client_id', this.config.NOTION_CLIENT_ID);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('owner', 'user');
    url.searchParams.set('redirect_uri', this.config.NOTION_REDIRECT_URI);
    url.searchParams.set('state', state);
    return url.toString();
  }

  async exchangeCode(code: string): Promise<NotionTokenResponse> {
    return this.tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: this.config.NOTION_REDIRECT_URI });
  }
  async refresh(refreshToken: string): Promise<NotionTokenResponse> {
    return this.tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }
  async revoke(token: string): Promise<void> {
    const response = await this.request('https://api.notion.com/v1/oauth/revoke', {
      method: 'POST', headers: this.headers(), body: JSON.stringify({ token }),
    });
    if (!response.ok && response.status !== 404) throw new Error('notion_revoke_failed');
  }
  private headers() {
    const encoded = Buffer.from(`${this.config.NOTION_CLIENT_ID}:${this.config.NOTION_CLIENT_SECRET}`).toString('base64');
    return { Authorization: `Basic ${encoded}`, 'Content-Type': 'application/json', 'Notion-Version': this.config.NOTION_VERSION };
  }
  private async tokenRequest(body: Record<string, string>): Promise<NotionTokenResponse> {
    const response = await this.request('https://api.notion.com/v1/oauth/token', {
      method: 'POST', headers: this.headers(), body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`notion_oauth_http_${response.status}`);
    const payload = await response.json() as Partial<NotionTokenResponse>;
    if (!payload.access_token || !payload.bot_id || !payload.workspace_id || !payload.refresh_token) throw new Error('notion_oauth_invalid_response');
    return payload as NotionTokenResponse;
  }
}
