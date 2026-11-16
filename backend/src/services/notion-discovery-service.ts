import { DATA_BASES, REQUIRED_RELATIONS, REQUIRED_TYPES, type LogicalDatabase } from './notion-schema-contract.js';
import type { NotionApi, NotionObject } from './notion-api.js';

type DatabaseSource = { logicalName: LogicalDatabase; databaseId: string; dataSourceId: string; metadata: Record<string, unknown> };
const norm = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('en');
function richTitle(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map((part: any) => part?.plain_text ?? part?.text?.content ?? '').join('').trim();
}
function pageTitle(obj: NotionObject): string {
  if (typeof obj.title === 'string' || Array.isArray(obj.title)) return richTitle(obj.title);
  for (const prop of Object.values(obj.properties ?? {}) as NotionObject[]) {
    if (prop?.type === 'title') return richTitle(prop.title);
  }
  return '';
}

export class NotionDiscoveryService {
  constructor(private readonly notion: NotionApi) {}

  async findRoots(): Promise<Array<{ id: string; title: string }>> {
    const pages = await this.notion.allPages('/search', { query: 'HUNTER SYSTEM — Datos', filter: { property: 'object', value: 'page' } });
    return pages.map((page) => ({ id: page.id as string, title: pageTitle(page) }))
      .filter((page) => page.id && norm(page.title) === norm('HUNTER SYSTEM — Datos'));
  }

  async discover(rootPageId?: string): Promise<{ rootPageId: string; sources: DatabaseSource[]; errors: string[] }> {
    const pages = rootPageId ? [await this.notion.get(`/pages/${rootPageId}`)] : await this.notion.allPages('/search', {
      query: 'HUNTER SYSTEM — Datos', filter: { property: 'object', value: 'page' },
    });
    let root = pages.find((page) => page.id && norm(pageTitle(page)) === norm('HUNTER SYSTEM — Datos'));
    if (!root && !rootPageId) {
      const alternate = await this.notion.allPages('/search', { query: 'HUNTER SYSTEM - Datos', filter: { property: 'object', value: 'page' } });
      root = alternate.find((page) => norm(pageTitle(page)) === norm('HUNTER SYSTEM — Datos'));
    }
    if (!root?.id) return { rootPageId: '', sources: [], errors: ['missing_root_page:HUNTER SYSTEM — Datos'] };

    const databaseIds = new Set<string>();
    const idsByTitle = new Map<string, string>();
    const visited = new Set<string>();
    const queue = [root.id as string];
    while (queue.length) {
      const pageId = queue.shift()!;
      if (visited.has(pageId)) continue;
      visited.add(pageId);
      const blocks = await this.notion.allPages(`/blocks/${pageId}/children`);
      for (const block of blocks) {
        const childDatabaseId = block.type === 'child_database' ? block.id : null;
        if (childDatabaseId) {
          databaseIds.add(childDatabaseId);
          if (block.child_database?.title) idsByTitle.set(norm(block.child_database.title), childDatabaseId);
        }
        const childPageId = block.type === 'child_page' ? block.id : null;
        if (childPageId) queue.push(childPageId);
      }
    }

    // Search is used only as an index; a candidate must also be a descendant of the selected root.
    const candidateIds = new Map<string, string>();
    for (const logicalName of DATA_BASES) {
      const nestedId = idsByTitle.get(norm(logicalName));
      if (nestedId) { candidateIds.set(logicalName, nestedId); continue; }
      const results = await this.notion.allPages('/search', { query: logicalName });
      const candidate = results.find((item) => {
        const name = item.object === 'database' ? richTitle(item.title) : pageTitle(item);
        return norm(name) === norm(logicalName) && databaseIds.has(item.id);
      });
      if (candidate) candidateIds.set(logicalName, candidate.id);
    }

    const sources: DatabaseSource[] = [];
    const descriptions = new Map<LogicalDatabase, { database: NotionObject; detail: NotionObject }>();
    const errors: string[] = [];
    for (const logicalName of DATA_BASES) {
      const databaseId = candidateIds.get(logicalName);
      if (!databaseId) { errors.push(`missing_or_outside_root:${logicalName}`); continue; }
      try {
        const database = await this.notion.get(`/databases/${databaseId}`);
        if (!Array.isArray(database.data_sources) || database.data_sources.length !== 1) {
          errors.push(`expected_one_data_source:${logicalName}`); continue;
        }
        const dataSource = database.data_sources[0];
        if (!dataSource?.id) { errors.push(`missing_data_source:${logicalName}`); continue; }
        const detail = await this.notion.get(`/data_sources/${dataSource.id}`);
        descriptions.set(logicalName, { database, detail });
        sources.push({ logicalName, databaseId, dataSourceId: dataSource.id, metadata: {} });
      } catch (error) {
        errors.push(`inaccessible_or_unreadable:${logicalName}:${error instanceof Error ? error.message : 'unknown'}`);
      }
    }
    const idsByLogicalName = new Map(sources.map((source) => [source.logicalName, source.dataSourceId]));
    const allOwnedIds = new Set([...sources.flatMap((source) => [source.databaseId, source.dataSourceId])]);
    const validated: DatabaseSource[] = [];
    for (const source of sources) {
      const logicalName = source.logicalName;
      try {
        const { detail } = descriptions.get(logicalName)!;
        const properties = detail.properties ?? {};
        const types = Object.values(properties).map((property: any) => property.type as string);
        for (const type of REQUIRED_TYPES[logicalName]) {
          if (!types.includes(type)) errors.push(`missing_property_type:${logicalName}:${type}`);
        }
        const relationTargets = new Set<string>();
        for (const property of Object.values(properties) as NotionObject[]) {
          if (property.type === 'relation') {
            const relation = property.relation ?? {};
            if (relation.data_source_id) relationTargets.add(relation.data_source_id);
            if (relation.database_id) relationTargets.add(relation.database_id);
          }
        }
        const targets = REQUIRED_RELATIONS[logicalName] ?? [];
        for (const target of targets) {
          const targetId = candidateIds.get(target);
          if (!targetId) continue;
          const targetSourceId = idsByLogicalName.get(target);
          if (targetId && !relationTargets.has(targetId) && (!targetSourceId || !relationTargets.has(targetSourceId))) {
            errors.push(`missing_relation:${logicalName}->${target}`);
          }
        }
        const outsideRelation = [...relationTargets].some((id) => !allOwnedIds.has(id));
        if (outsideRelation) errors.push(`relation_target_not_in_selected_template:${logicalName}`);
        validated.push({ ...source, metadata: {
          propertyTypes: Object.fromEntries(Object.entries(properties).map(([name, property]: [string, any]) => [name, property.type])),
          relationTargets: [...relationTargets],
        } });
      } catch (error) {
        errors.push(`inaccessible_or_unreadable:${logicalName}:${error instanceof Error ? error.message : 'unknown'}`);
      }
    }
    return { rootPageId: root.id, sources: validated, errors };
  }
}
