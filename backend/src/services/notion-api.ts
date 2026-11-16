export type NotionObject = Record<string, any>;
export class NotionApi {
  constructor(private readonly accessToken: string, private readonly version: string, private readonly request: typeof fetch = fetch) {}
  async get(path: string): Promise<NotionObject> { return this.call(path, 'GET'); }
  async post(path: string, body: unknown): Promise<NotionObject> { return this.call(path, 'POST', body); }
  async allPages(path: string, body: Record<string, unknown> = {}): Promise<NotionObject[]> {
    const results: NotionObject[] = [];
    let cursor: string | undefined;
    do {
      const payload = { ...body, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) };
      const response = Object.keys(body).length
        ? await this.post(path, payload)
        : await this.get(`${path}?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`);
      results.push(...(response.results ?? []));
      cursor = response.has_more ? response.next_cursor : undefined;
    } while (cursor);
    return results;
  }
  private async call(path: string, method: 'GET'|'POST', body?: unknown): Promise<NotionObject> {
    const response = await this.request(`https://api.notion.com/v1${path}`, {
      method, headers: { Authorization: `Bearer ${this.accessToken}`, 'Notion-Version': this.version,
        ...(body ? { 'Content-Type': 'application/json' } : {}) },
      signal: AbortSignal.timeout(15_000), ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(`notion_api_http_${response.status}`);
    return await response.json() as NotionObject;
  }
}
