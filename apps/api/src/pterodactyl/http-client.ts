/**
 * Live-Client für die Pterodactyl-API (v1.x, kompatibel mit AriX-Theme –
 * das Theme ändert nur das Panel-Frontend, nicht die API).
 */
import type { PowerAction, PowerState } from '@chfree/shared';
import {
  PterodactylError,
  type BackupScheduleSpec,
  type CreateServerSpec,
  type PteroEgg,
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
      deploy: { locations: spec.locationIds, dedicated_ip: false, port_range: [] },
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
      maintenanceMode: !!n.attributes.maintenance_mode,
      locationId: n.attributes.location_id,
    }));
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
