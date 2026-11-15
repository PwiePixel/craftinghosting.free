/**
 * Mock-Implementierung für Entwicklung & Tests (PTERODACTYL_MODE=mock).
 * Der Zustand liegt in einer kleinen JSON-Datei, damit API und Worker
 * denselben Stand sehen. Zustandswechsel (starting → running …) werden
 * zeitbasiert berechnet – ganz ohne Timer.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { PowerAction, PowerState } from '@chfree/shared';
import {
  PterodactylError,
  type BackupScheduleSpec,
  type CreateServerSpec,
  type PteroEgg,
  type PteroEggSummary,
  type PteroLocation,
  type PteroNode,
  type PteroResources,
  type PteroServer,
  type PteroUser,
  type PterodactylGateway,
} from './types';

interface MockServer {
  id: number;
  uuid: string;
  identifier: string;
  externalId: string;
  name: string;
  userId: number;
  suspended: boolean;
  installedAt: number;
  state: 'offline' | 'starting' | 'running' | 'stopping';
  since: number;
  target: 'running' | 'offline' | null;
  transitionAt: number | null;
  memoryMb: number;
  diskMb: number;
  cpu: number;
  port: number;
  schedules: number;
  description: string;
  console: string[];
}

interface MockState {
  nextUserId: number;
  nextServerId: number;
  users: (PteroUser & { externalId: string | null; hasPassword?: boolean })[];
  servers: MockServer[];
}

const INSTALL_MS = 8_000;
const START_MS = 5_000;
const STOP_MS = 3_000;

export class PterodactylMockClient implements PterodactylGateway {
  readonly mode = 'mock' as const;

  constructor(private readonly file: string) {}

  private load(): MockState {
    if (!existsSync(this.file)) return { nextUserId: 1, nextServerId: 1, users: [], servers: [] };
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as MockState;
    } catch {
      return { nextUserId: 1, nextServerId: 1, users: [], servers: [] };
    }
  }

  private save(state: MockState) {
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2));
    renameSync(tmp, this.file);
  }

  private settle(s: MockServer, now = Date.now()) {
    if (s.target && s.transitionAt && now >= s.transitionAt) {
      s.state = s.target;
      s.since = s.transitionAt;
      s.target = null;
      s.transitionAt = null;
    }
  }

  private toServer(s: MockServer): PteroServer {
    const installing = Date.now() < s.installedAt;
    return {
      id: s.id,
      uuid: s.uuid,
      identifier: s.identifier,
      externalId: s.externalId,
      name: s.name,
      description: s.description ?? '',
      userId: s.userId,
      suspended: s.suspended,
      status: s.suspended ? 'suspended' : installing ? 'installing' : null,
      allocation: { ip: '203.0.113.10', alias: 'free-de-1.craftinghosting.free', port: s.port },
    };
  }

  async findUserByExternalId(externalId: string) {
    return this.load().users.find((u) => u.externalId === externalId) ?? null;
  }

  async findUserByEmail(email: string) {
    return this.load().users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null;
  }

  async createUser(input: { externalId: string; email: string; username: string; firstName: string; lastName: string; password?: string }) {
    const state = this.load();
    if (state.users.some((u) => u.email === input.email)) {
      throw new PterodactylError('email has already been taken', 422, [{ detail: 'The email has already been taken.', meta: { source_field: 'email' } }]);
    }
    if (state.users.some((u) => u.username === input.username)) {
      throw new PterodactylError('username has already been taken', 422, [{ detail: 'The username has already been taken.', meta: { source_field: 'username' } }]);
    }
    const user = { id: state.nextUserId++, externalId: input.externalId, email: input.email, username: input.username, hasPassword: !!input.password };
    state.users.push(user);
    this.save(state);
    return user;
  }

  async findServerByExternalId(externalId: string) {
    const s = this.load().servers.find((x) => x.externalId === externalId);
    return s ? this.toServer(s) : null;
  }

  async getServer(id: number) {
    const s = this.load().servers.find((x) => x.id === id);
    return s ? this.toServer(s) : null;
  }

  async createServer(spec: CreateServerSpec) {
    const state = this.load();
    const id = state.nextServerId++;
    const uuid = randomUUID();
    const s: MockServer = {
      id,
      uuid,
      identifier: uuid.slice(0, 8),
      externalId: spec.externalId,
      name: spec.name,
      userId: spec.userId,
      suspended: false,
      installedAt: Date.now() + INSTALL_MS,
      state: 'offline',
      since: Date.now(),
      target: null,
      transitionAt: null,
      memoryMb: spec.limits.memory,
      diskMb: spec.limits.disk,
      cpu: spec.limits.cpu,
      port: 25565 + id,
      schedules: 0,
      description: spec.description,
      console: [],
    };
    state.servers.push(s);
    this.save(state);
    return this.toServer(s);
  }

  private mutate(id: number, fn: (s: MockServer) => void) {
    const state = this.load();
    const s = state.servers.find((x) => x.id === id);
    if (!s) throw new PterodactylError('server not found', 404);
    fn(s);
    this.save(state);
  }

  async suspendServer(id: number) {
    this.mutate(id, (s) => {
      this.settle(s);
      s.suspended = true;
      s.state = 'offline';
      s.target = null;
      s.transitionAt = null;
      s.since = Date.now();
    });
  }

  async unsuspendServer(id: number) {
    this.mutate(id, (s) => {
      s.suspended = false;
    });
  }

  async deleteServer(id: number) {
    const state = this.load();
    state.servers = state.servers.filter((s) => s.id !== id);
    this.save(state);
  }

  async updateServerDescription(id: number, description: string) {
    this.mutate(id, (s) => {
      s.description = description;
    });
  }

  async getEgg(_nestId: number, eggId: number): Promise<PteroEgg> {
    if (eggId === 20) {
      return {
        id: eggId,
        dockerImage: 'ghcr.io/parkervcp/yolks:python_3.13',
        startup: 'python /home/container/{{PY_FILE}}',
        variables: [
          { envVariable: 'PY_FILE', defaultValue: 'app.py' },
          { envVariable: 'REQUIREMENTS_FILE', defaultValue: 'requirements.txt' },
        ],
      };
    }
    if (eggId === 21) {
      return {
        id: eggId,
        dockerImage: 'ghcr.io/parkervcp/yolks:nodejs_22',
        startup: 'node /home/container/{{MAIN_FILE}}',
        variables: [{ envVariable: 'MAIN_FILE', defaultValue: 'index.js' }],
      };
    }
    return {
      id: eggId,
      dockerImage: 'ghcr.io/pterodactyl/yolks:java_21',
      startup: 'java -Xms128M -XX:MaxRAMPercentage=95.0 -jar {{SERVER_JARFILE}}',
      variables: [
        { envVariable: 'SERVER_JARFILE', defaultValue: 'server.jar' },
        { envVariable: 'MINECRAFT_VERSION', defaultValue: 'latest' },
        { envVariable: 'BUILD_NUMBER', defaultValue: 'latest' },
      ],
    };
  }

  async listNodes(): Promise<PteroNode[]> {
    return [
      { id: 1, name: 'free-de-1 (Xeon Gold 6230)', fqdn: 'free-de-1.craftinghosting.free', daemonUrl: null, maintenanceMode: false, locationId: 1, memoryMb: 262_144, diskMb: 1_048_576 },
      { id: 2, name: 'free-de-2 (Xeon Gold 6230)', fqdn: 'free-de-2.craftinghosting.free', daemonUrl: null, maintenanceMode: false, locationId: 1, memoryMb: 262_144, diskMb: 1_048_576 },
      { id: 3, name: 'bots-de-1 (Discord-Bots)', fqdn: 'bots-de-1.craftinghosting.free', daemonUrl: null, maintenanceMode: false, locationId: 1, memoryMb: 65_536, diskMb: 524_288 },
    ];
  }

  async listLocations(): Promise<PteroLocation[]> {
    return [{ id: 1, short: 'de', long: 'Deutschland' }];
  }

  async listEggs(): Promise<PteroEggSummary[]> {
    const mc = (eggId: number, name: string): PteroEggSummary => ({
      nestId: 1,
      nestName: 'Minecraft',
      eggId,
      name,
      description: `${name} (Mock)`,
      dockerImages: ['Java 21', 'Java 17'],
    });
    return [
      mc(2, 'Forge Minecraft'),
      mc(3, 'Paper'),
      mc(5, 'Vanilla Minecraft'),
      mc(16, 'Purpur'),
      mc(17, 'Fabric'),
      { nestId: 5, nestName: 'Discord Bots', eggId: 20, name: 'generic python', description: 'Python-Bots (Mock)', dockerImages: ['Python 3.13', 'Python 3.12'] },
      { nestId: 5, nestName: 'Discord Bots', eggId: 21, name: 'generic node.js', description: 'Node.js-Bots (Mock)', dockerImages: ['Nodejs 22', 'Nodejs 20'] },
    ];
  }

  async freeAllocations(nodeId: number): Promise<{ count: number; firstId: number | null }> {
    // Der Mock hat immer freie Ports – die „Allokations-ID“ kodiert die Node
    return { count: 250, firstId: nodeId * 100_000 + this.load().nextServerId };
  }

  async pingClient(): Promise<void> {}

  async getResources(identifier: string): Promise<PteroResources> {
    const state = this.load();
    const s = state.servers.find((x) => x.identifier === identifier);
    if (!s) throw new PterodactylError('server not found', 404);
    const now = Date.now();
    this.settle(s, now);
    const empty = { memoryBytes: 0, cpuAbsolute: 0, networkRxBytes: 0, networkTxBytes: 0, uptimeMs: 0 };
    const diskBytes = Math.round(1.3 * 1024 ** 3);
    if (s.suspended) return { state: 'offline', isSuspended: true, diskBytes, ...empty };
    if (now < s.installedAt) return { state: 'installing', isSuspended: false, diskBytes: 0, ...empty };
    const current: PowerState = s.target === 'running' ? 'starting' : s.target === 'offline' ? 'stopping' : s.state;
    if (current === 'offline') return { state: 'offline', isSuspended: false, diskBytes, ...empty };
    const wobble = (Math.sin(now / 17_000) + 1) / 2;
    const uptime = current === 'running' ? now - s.since : 0;
    return {
      state: current,
      isSuspended: false,
      memoryBytes: Math.round(s.memoryMb * 1024 * 1024 * (0.45 + wobble * 0.2)),
      cpuAbsolute: Math.round((current === 'starting' ? 85 : 12 + wobble * 30) * (s.cpu / 100) * 10) / 10,
      diskBytes,
      networkRxBytes: Math.round(uptime * 3.2),
      networkTxBytes: Math.round(uptime * 5.1),
      uptimeMs: uptime,
    };
  }

  async sendPowerSignal(identifier: string, signal: PowerAction) {
    const state = this.load();
    const s = state.servers.find((x) => x.identifier === identifier);
    if (!s) throw new PterodactylError('server not found', 404);
    if (s.suspended) throw new PterodactylError('server is suspended', 409);
    if (Date.now() < s.installedAt) throw new PterodactylError('server is installing', 409);
    const now = Date.now();
    this.settle(s, now);
    switch (signal) {
      case 'start':
        if (s.state === 'offline' && !s.target) {
          s.target = 'running';
          s.transitionAt = now + START_MS;
        }
        break;
      case 'stop':
        if ((s.state === 'running' || s.target === 'running') && s.target !== 'offline') {
          s.state = 'running';
          s.target = 'offline';
          s.transitionAt = now + STOP_MS;
        }
        break;
      case 'restart':
        s.state = 'offline';
        s.target = 'running';
        s.transitionAt = now + START_MS;
        break;
      case 'kill':
        s.state = 'offline';
        s.target = null;
        s.transitionAt = null;
        s.since = now;
        break;
    }
    this.save(state);
  }

  async sendCommand(identifier: string, command: string) {
    const state = this.load();
    const s = state.servers.find((x) => x.identifier === identifier);
    if (!s) throw new PterodactylError('server not found', 404);
    s.console = [...(s.console ?? []), `${new Date().toISOString()} ${command}`].slice(-50);
    this.save(state);
  }

  async createBackupSchedule(identifier: string, _spec: BackupScheduleSpec): Promise<number> {
    const state = this.load();
    const s = state.servers.find((x) => x.identifier === identifier);
    if (!s) throw new PterodactylError('server not found', 404);
    s.schedules += 1;
    this.save(state);
    return s.id * 100 + s.schedules;
  }

  async ping() {
    return 3;
  }
}
