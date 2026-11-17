/**
 * Live-Client für die Pterodactyl-API (v1.x, kompatibel mit AriX-Theme –
 * das Theme ändert nur das Panel-Frontend, nicht die API).
 */
import type { PowerAction, PowerState } from '@chfree/shared';
import {
  PterodactylError,
  type BackupScheduleSpec,
  type CreateServerSpec,
  type PteroAllocation,
  type PteroEgg,
  type PteroEggSummary,
  type PteroLocation,
  type PteroNode,
  type PteroResources,
  type PteroServer,
  type PteroUser,
  type PterodactylGateway,
} from './types';

interface Options {
  baseUrl: string;
  appKey: string;
  clientKey: string;
  timeoutMs: number;
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export class PterodactylHttpClient implements PterodactylGateway {
  readonly mode = 'live' as const;
  private readonly baseUrl: string;

  constructor(private readonly opts: Options) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
  }

  private async request<T = Json>(
    api: 'application' | 'client',
    method: string,
    path: string,
    body?: unknown,
    attempt = 0,
  ): Promise<T> {
    const key = api === 'application' ? this.opts.appKey : this.opts.clientKey;
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/${api}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${key}`,
          Accept: 'Application/vnd.pterodactyl.v1+json',
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.opts.timeoutMs),
      });
    } catch (err) {
      if (method === 'GET' && attempt < 2) {
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        return this.request(api, method, path, body, attempt + 1);
      }
      throw new PterodactylError(`Pterodactyl nicht erreichbar: ${(err as Error).message}`, 0);
    }

    if ((res.status === 429 || res.status >= 500) && method === 'GET' && attempt < 2) {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      return this.request(api, method, path, body, attempt + 1);
    }

    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let data: Json | undefined;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = undefined;
    }
    if (!res.ok) {
      const detail = data?.errors?.[0]?.detail ?? data?.errors?.[0]?.code ?? res.statusText;
      throw new PterodactylError(`Pterodactyl ${method} ${path} → ${res.status}: ${detail}`, res.status, data?.errors);
    }
    return data as T;
  }

  private mapUser(a: Json): PteroUser {
    return { id: a.id, externalId: a.external_id ?? null, email: a.email, username: a.username };
  }

  private mapServer(a: Json): PteroServer {
    const allocations: Json[] = a.relationships?.allocations?.data ?? [];
    const primary = allocations.find((x) => x.attributes?.id === a.allocation) ?? allocations[0];
    const toAllocation = (x: Json): PteroAllocation => ({ id: x.attributes.id, ip: x.attributes.ip, alias: x.attributes.alias ?? null, port: x.attributes.port });
    return {
      id: a.id,
      uuid: a.uuid,
      identifier: a.identifier,
      externalId: a.external_id ?? null,
      name: a.name,
      description: a.description ?? '',
      userId: a.user,
      suspended: !!a.suspended || a.status === 'suspended',
      status: a.status ?? null,
      allocation: primary
        ? { ip: primary.attributes.ip, alias: primary.attributes.alias ?? null, port: primary.attributes.port }
        : null,
      nodeId: typeof a.node === 'number' ? a.node : null,
      allocations: primary ? [toAllocation(primary), ...allocations.filter((x) => x !== primary).map(toAllocation)] : [],
    };
  }

  async findUserByExternalId(externalId: string) {
    try {
      const res = await this.request('application', 'GET', `/users/external/${encodeURIComponent(externalId)}`);
      return this.mapUser(res.attributes);
    } catch (err) {
      if (err instanceof PterodactylError && err.status === 404) return null;
      throw err;
    }
  }

  async findUserByEmail(email: string) {
    const res = await this.request('application', 'GET', `/users?filter[email]=${encodeURIComponent(email)}`);
    const hit = (res.data as Json[]).find((u) => String(u.attributes.email).toLowerCase() === email.toLowerCase());
    return hit ? this.mapUser(hit.attributes) : null;
  }

  async createUser(input: { externalId: string; email: string; username: string; firstName: string; lastName: string; password?: string }) {
    const res = await this.request('application', 'POST', '/users', {
      external_id: input.externalId,
      email: input.email,
      username: input.username,
      first_name: input.firstName,
      last_name: input.lastName,
      ...(input.password ? { password: input.password } : {}),
    });
    return this.mapUser(res.attributes);
  }

  async updateUserEmail(id: number, email: string): Promise<void> {
    // Das Panel verlangt beim Ändern den vollständigen Satz – deshalb zuerst den aktuellen Stand lesen
    const a = (await this.request('application', 'GET', `/users/${id}`)).attributes as Json;
    await this.request('application', 'PATCH', `/users/${id}`, { email, username: a.username, first_name: a.first_name, last_name: a.last_name, language: a.language ?? 'en' });
  }

  async findServerByExternalId(externalId: string) {
    try {
      const res = await this.request('application', 'GET', `/servers/external/${encodeURIComponent(externalId)}?include=allocations`);
      return this.mapServer(res.attributes);
    } catch (err) {
      if (err instanceof PterodactylError && err.status === 404) return null;
      throw err;
    }
  }

  async getServer(id: number) {
    try {
      const res = await this.request('application', 'GET', `/servers/${id}?include=allocations`);
      return this.mapServer(res.attributes);
    } catch (err) {
      if (err instanceof PterodactylError && err.status === 404) return null;
      throw err;
    }
  }

  async createServer(spec: CreateServerSpec) {
    const res = await this.request('application', 'POST', '/servers', {
      external_id: spec.externalId,
      name: spec.name,
      description: spec.description,
      user: spec.userId,
      egg: spec.eggId,
      docker_image: spec.dockerImage,
      startup: spec.startup,
      environment: spec.environment,
      limits: spec.limits,
      feature_limits: spec.featureLimits,
      // Feste Node (Allokation) oder automatische Platzierung über Locations
      ...(spec.allocationId
        ? { allocation: { default: spec.allocationId } }
        : { deploy: { locations: spec.locationIds, dedicated_ip: false, port_range: [] } }),
      start_on_completion: spec.startOnCompletion,
    });
    // Allokation nachladen (Create-Antwort enthält sie nicht immer)
    const full = await this.getServer(res.attributes.id);
    return full ?? this.mapServer(res.attributes);
  }

  async suspendServer(id: number) {
    await this.request('application', 'POST', `/servers/${id}/suspend`);
  }

  async unsuspendServer(id: number) {
    await this.request('application', 'POST', `/servers/${id}/unsuspend`);
  }

  async deleteServer(id: number) {
    try {
      await this.request('application', 'DELETE', `/servers/${id}`);
    } catch (err) {
      if (err instanceof PterodactylError && err.status === 404) return;
      throw err;
    }
  }

  async updateServerBuild(id: number, limits: { memory: number; disk: number; cpu: number; swap: number; io: number }, featureLimits: { databases: number; allocations: number; backups: number }) {
    const res = await this.request('application', 'GET', `/servers/${id}`);
    const a = res.attributes as Json;
    await this.request('application', 'PATCH', `/servers/${id}/build`, {
      allocation: a.allocation,
      memory: limits.memory,
      swap: limits.swap,
      disk: limits.disk,
      io: limits.io,
      cpu: limits.cpu,
      threads: a.limits.threads ?? null,
      ...(typeof a.limits.oom_disabled === 'boolean' ? { oom_disabled: a.limits.oom_disabled } : {}),
      feature_limits: { databases: featureLimits.databases, allocations: featureLimits.allocations, backups: featureLimits.backups },
    });
  }

  async transferServer(id: number, nodeId: number, allocationId: number, additionalAllocationIds: number[] = []): Promise<'started' | 'unsupported'> {
    try {
      await this.request('application', 'POST', `/servers/${id}/transfer`, { node_id: nodeId, allocation_id: allocationId, allocation_additional: additionalAllocationIds });
      return 'started';
    } catch (err) {
      // Das klassische Pterodactyl kennt diese Adresse nicht – der Umzug geht dort nur im Admin-Bereich des Panels
      if (err instanceof PterodactylError && (err.status === 404 || err.status === 405)) return 'unsupported';
      throw err;
    }
  }

  async cancelServerTransfer(id: number): Promise<boolean> {
    try {
      await this.request('application', 'POST', `/servers/${id}/transfer/cancel`, {});
      return true;
    } catch {
      return false;
    }
  }

  async updateServerFeatureLimits(id: number, limits: { databases: number; allocations: number; backups: number }) {
    // Das Panel verlangt beim Ändern immer den vollständigen Satz – deshalb zuerst den aktuellen Stand lesen
    const res = await this.request('application', 'GET', `/servers/${id}`);
    const a = res.attributes as Json;
    await this.request('application', 'PATCH', `/servers/${id}/build`, {
      allocation: a.allocation,
      memory: a.limits.memory,
      swap: a.limits.swap,
      disk: a.limits.disk,
      io: a.limits.io,
      cpu: a.limits.cpu,
      threads: a.limits.threads ?? null,
      ...(typeof a.limits.oom_disabled === 'boolean' ? { oom_disabled: a.limits.oom_disabled } : {}),
      feature_limits: { databases: limits.databases, allocations: limits.allocations, backups: limits.backups },
    });
  }

  async updateServerDescription(id: number, description: string) {
    const current = await this.getServer(id);
    if (!current) throw new PterodactylError('Server nicht gefunden', 404);
    await this.request('application', 'PATCH', `/servers/${id}/details`, {
      name: current.name,
      user: current.userId,
      external_id: current.externalId,
      description,
    });
  }

  async getEgg(nestId: number, eggId: number): Promise<PteroEgg> {
    const res = await this.request('application', 'GET', `/nests/${nestId}/eggs/${eggId}?include=variables`);
    const a = res.attributes;
    const images: string[] = a.docker_images ? Object.values(a.docker_images) : [];
    return {
      id: a.id,
      dockerImage: a.docker_image ?? images[0] ?? '',
      startup: a.startup,
      variables: ((a.relationships?.variables?.data ?? []) as Json[]).map((v) => ({
        envVariable: v.attributes.env_variable,
        defaultValue: v.attributes.default_value ?? '',
      })),
    };
  }

  async listNodes(): Promise<PteroNode[]> {
    const res = await this.request('application', 'GET', '/nodes?per_page=100');
    return (res.data as Json[]).map((n) => ({
      id: n.attributes.id,
      name: n.attributes.name,
      fqdn: n.attributes.fqdn ?? '',
      daemonUrl: n.attributes.fqdn ? `${n.attributes.scheme === 'http' ? 'http' : 'https'}://${n.attributes.fqdn}:${n.attributes.daemon_listen ?? 8080}` : null,
      maintenanceMode: !!n.attributes.maintenance_mode,
      locationId: n.attributes.location_id,
      memoryMb: n.attributes.memory ?? 0,
      diskMb: n.attributes.disk ?? 0,
      allocatedMemoryMb: typeof n.attributes.allocated_resources?.memory === 'number' ? n.attributes.allocated_resources.memory : undefined,
      allocatedDiskMb: typeof n.attributes.allocated_resources?.disk === 'number' ? n.attributes.allocated_resources.disk : undefined,
      memoryOverallocate: typeof n.attributes.memory_overallocate === 'number' ? n.attributes.memory_overallocate : undefined,
      diskOverallocate: typeof n.attributes.disk_overallocate === 'number' ? n.attributes.disk_overallocate : undefined,
    }));
  }

  async listLocations(): Promise<PteroLocation[]> {
    const res = await this.request('application', 'GET', '/locations?per_page=100');
    return (res.data as Json[]).map((l) => ({ id: l.attributes.id, short: l.attributes.short ?? '', long: l.attributes.long ?? '' }));
  }

  async listEggs(): Promise<PteroEggSummary[]> {
    const res = await this.request('application', 'GET', '/nests?include=eggs&per_page=100');
    const out: PteroEggSummary[] = [];
    for (const nest of res.data as Json[]) {
      for (const egg of (nest.attributes.relationships?.eggs?.data ?? []) as Json[]) {
        const a = egg.attributes;
        out.push({
          nestId: nest.attributes.id,
          nestName: nest.attributes.name ?? '',
          eggId: a.id,
          name: a.name ?? '',
          description: a.description ?? '',
          dockerImages: a.docker_images ? Object.keys(a.docker_images) : a.docker_image ? [a.docker_image] : [],
        });
      }
    }
    return out;
  }

  async freeAllocations(nodeId: number): Promise<{ count: number; firstId: number | null }> {
    let count = 0;
    let firstId: number | null = null;
    // Höchstens 20 Seiten à 500 Allokationen – reicht für 10 000 Ports je Node
    for (let page = 1; page <= 20; page++) {
      const res = await this.request('application', 'GET', `/nodes/${nodeId}/allocations?per_page=500&page=${page}`);
      for (const a of res.data as Json[]) {
        if (a.attributes.assigned) continue;
        count++;
        firstId ??= a.attributes.id as number;
      }
      const pagination = res.meta?.pagination;
      if (!pagination || pagination.current_page >= pagination.total_pages) break;
    }
    return { count, firstId };
  }

  async listFreeAllocations(nodeId: number): Promise<PteroAllocation[]> {
    const free: PteroAllocation[] = [];
    for (let page = 1; page <= 20; page++) {
      const res = await this.request('application', 'GET', `/nodes/${nodeId}/allocations?per_page=500&page=${page}`);
      for (const a of res.data as Json[]) {
        if (!a.attributes.assigned) free.push({ id: a.attributes.id, ip: a.attributes.ip, alias: a.attributes.alias ?? null, port: a.attributes.port });
      }
      const pagination = res.meta?.pagination;
      if (!pagination || pagination.current_page >= pagination.total_pages) break;
    }
    return free;
  }

  async pingClient(): Promise<void> {
    await this.request('client', 'GET', '/');
  }

  async getResources(identifier: string): Promise<PteroResources> {
    try {
      const res = await this.request('client', 'GET', `/servers/${identifier}/resources`);
      const a = res.attributes;
      return {
        state: (a.current_state as PowerState) ?? 'unknown',
        isSuspended: !!a.is_suspended,
        memoryBytes: a.resources?.memory_bytes ?? 0,
        cpuAbsolute: a.resources?.cpu_absolute ?? 0,
        diskBytes: a.resources?.disk_bytes ?? 0,
        networkRxBytes: a.resources?.network_rx_bytes ?? 0,
        networkTxBytes: a.resources?.network_tx_bytes ?? 0,
        uptimeMs: a.resources?.uptime ?? 0,
      };
    } catch (err) {
      // 409: Server installiert gerade oder ist suspendiert
      if (err instanceof PterodactylError && err.status === 409) {
        const msg = err.message.toLowerCase();
        const empty = { memoryBytes: 0, cpuAbsolute: 0, diskBytes: 0, networkRxBytes: 0, networkTxBytes: 0, uptimeMs: 0 };
        if (msg.includes('suspend')) return { state: 'offline', isSuspended: true, ...empty };
        return { state: 'installing', isSuspended: false, ...empty };
      }
      throw err;
    }
  }

  async sendPowerSignal(identifier: string, signal: PowerAction) {
    await this.request('client', 'POST', `/servers/${identifier}/power`, { signal });
  }

  async sendCommand(identifier: string, command: string) {
    try {
      await this.request('client', 'POST', `/servers/${identifier}/command`, { command });
    } catch (err) {
      // 502: Server ist offline – Hinweis ist dann ohnehin überflüssig
      if (err instanceof PterodactylError && (err.status === 502 || err.status === 409)) return;
      throw err;
    }
  }

  /** Dateien gehen als reiner Text über die Client-API (nicht als JSON) */
  private async fileRequest(method: 'GET' | 'POST', identifier: string, action: 'contents' | 'write', path: string, content?: string): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl}/api/client/servers/${identifier}/files/${action}?file=${encodeURIComponent(path)}`, {
        method,
        headers: { Authorization: `Bearer ${this.opts.clientKey}`, Accept: 'Application/vnd.pterodactyl.v1+json', ...(content !== undefined ? { 'Content-Type': 'text/plain' } : {}) },
        body: content,
        signal: AbortSignal.timeout(this.opts.timeoutMs),
      });
    } catch (err) {
      throw new PterodactylError(`Pterodactyl nicht erreichbar: ${(err as Error).message}`, 0);
    }
  }

  async readFile(identifier: string, path: string): Promise<string | null> {
    const res = await this.fileRequest('GET', identifier, 'contents', path);
    if (res.status === 404) return null;
    if (!res.ok) throw new PterodactylError(`Pterodactyl GET files/contents → ${res.status}`, res.status);
    return res.text();
  }

  async writeFile(identifier: string, path: string, content: string): Promise<void> {
    const res = await this.fileRequest('POST', identifier, 'write', path, content);
    if (!res.ok) throw new PterodactylError(`Pterodactyl POST files/write → ${res.status}`, res.status);
  }

  async createBackupSchedule(identifier: string, spec: BackupScheduleSpec): Promise<number> {
    const schedule = await this.request('client', 'POST', `/servers/${identifier}/schedules`, {
      name: spec.name,
      minute: spec.minute,
      hour: spec.hour,
      day_of_month: spec.dayOfMonth,
      month: spec.month,
      day_of_week: spec.dayOfWeek,
      is_active: true,
      only_when_online: spec.onlyWhenOnline,
    });
    const id = schedule.attributes.id as number;
    await this.request('client', 'POST', `/servers/${identifier}/schedules/${id}/tasks`, {
      action: 'backup',
      payload: '',
      time_offset: 0,
      continue_on_failure: false,
    });
    return id;
  }

  async ping(): Promise<number> {
    const started = performance.now();
    await this.request('application', 'GET', '/nodes?per_page=1');
    return Math.round(performance.now() - started);
  }
}
