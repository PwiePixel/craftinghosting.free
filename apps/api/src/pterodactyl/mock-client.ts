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
  type PteroAllocation,
  type PteroFile,
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
  /** Slots (Datenbanken, Ports, Backups) */
  featureLimits?: { databases: number; allocations: number; backups: number };
  /** Node, auf der der Server liegt (0 = automatisch über die Location platziert) */
  nodeId?: number;
  /** Im Test von Hand verschoben (wie im Panel): Die Adresse folgt dann der Node */
  movedManually?: boolean;
  /** Laufender Umzug: Ziel-Node, Port und Zeitpunkt, ab dem er als abgeschlossen gilt */
  transfer?: { nodeId: number; port: number; extraPorts?: number[]; doneAt: number };
  /** Zusätzliche Ports neben dem Hauptport */
  extraPorts?: number[];
  /** Dateien des Servers (nur, was der Mock braucht – z. B. /eula.txt) */
  files?: Record<string, string>;
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
      // Zum Testen des EULA-Ablaufs: Wie ein echter Minecraft-Server legt der Mock beim ersten Start
      // eula.txt mit eula=false an und geht wieder aus, bis die EULA akzeptiert ist.
      if (s.state === 'running' && process.env.PTERODACTYL_MOCK_EULA === '1' && !/^\s*eula\s*=\s*true\s*$/im.test(s.files?.['/eula.txt'] ?? '')) {
        s.files = { ...s.files, '/eula.txt': '#By changing the setting below to TRUE you are indicating your agreement to our EULA (https://aka.ms/MinecraftEULA).\neula=false\n' };
        s.state = 'offline';
      }
    }
  }

  private toServer(s: MockServer): PteroServer {
    const installing = Date.now() < s.installedAt;
    // Ein Umzug gilt nach kurzer Zeit als abgeschlossen: Node und Adresse wechseln dann
    const moved = s.transfer && Date.now() >= s.transfer.doneAt ? s.transfer : null;
    const nodeId = moved ? moved.nodeId : (s.nodeId ?? 0);
    const host = nodeId === 2 ? 'free-de-2' : nodeId === 3 ? 'bots-de-1' : 'free-de-1';
    const alias = s.transfer || s.movedManually ? `${host}.craftinghosting.free` : 'free-de-1.craftinghosting.free';
    const port = moved ? moved.port : s.port;
    const extra = moved ? (moved.extraPorts ?? []) : (s.extraPorts ?? []);
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
      allocation: { ip: '203.0.113.10', alias, port },
      nodeId,
      allocations: [port, ...extra].map((p): PteroAllocation => ({ id: nodeId * 100_000 + p, ip: '203.0.113.10', alias, port: p })),
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

  async updateUserEmail(id: number, email: string): Promise<void> {
    const state = this.load();
    if (state.users.some((u) => u.id !== id && u.email.toLowerCase() === email.toLowerCase())) {
      throw new PterodactylError('email has already been taken', 422, [{ detail: 'The email has already been taken.', meta: { source_field: 'email' } }]);
    }
    const user = state.users.find((u) => u.id === id);
    if (!user) throw new PterodactylError('user not found', 404);
    user.email = email;
    this.save(state);
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
      featureLimits: { ...spec.featureLimits },
      // Die „Allokations-ID“ des Mocks kodiert die Node (siehe freeAllocations)
      nodeId: spec.allocationId ? Math.floor(spec.allocationId / 100_000) : 0,
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

  async updateServerBuild(id: number, limits: { memory: number; disk: number; cpu: number; swap: number; io: number }, featureLimits: { databases: number; allocations: number; backups: number }) {
    this.mutate(id, (s) => {
      s.memoryMb = limits.memory;
      s.diskMb = limits.disk;
      s.cpu = limits.cpu;
      s.featureLimits = { ...featureLimits };
    });
  }

  async transferServer(id: number, nodeId: number, allocationId: number, additionalAllocationIds: number[] = []): Promise<'started' | 'unsupported'> {
    // PTERODACTYL_MOCK_TRANSFER=none stellt das klassische Pterodactyl nach (kein Umzug per Schnittstelle)
    if (process.env.PTERODACTYL_MOCK_TRANSFER === 'none') return 'unsupported';
    // Die „Allokations-ID“ des Mocks kodiert Node und Port
    const portOf = (allocation: number) => allocation % 100_000;
    this.mutate(id, (s) => {
      // Ein früherer, abgeschlossener Umzug wird zum neuen Ausgangszustand
      if (s.transfer && Date.now() >= s.transfer.doneAt) {
        s.nodeId = s.transfer.nodeId;
        s.port = s.transfer.port;
        s.extraPorts = s.transfer.extraPorts ?? [];
        s.movedManually = true;
      }
      s.transfer = { nodeId, port: portOf(allocationId), extraPorts: additionalAllocationIds.map(portOf), doneAt: Date.now() + 4_000 };
    });
    return 'started';
  }

  async listFreeAllocations(nodeId: number): Promise<PteroAllocation[]> {
    // Je Node die Ports 25565–25814; belegt ist, was ein Server auf dieser Node gerade nutzt
    const used = new Set<number>();
    for (const s of this.load().servers) {
      const p = this.toServer(s);
      if (p.nodeId === nodeId) for (const a of p.allocations) used.add(a.port);
      if (s.transfer?.nodeId === nodeId) for (const port of [s.transfer.port, ...(s.transfer.extraPorts ?? [])]) used.add(port);
    }
    const host = nodeId === 2 ? 'free-de-2' : nodeId === 3 ? 'bots-de-1' : 'free-de-1';
    const free: PteroAllocation[] = [];
    for (let port = 25_565; port < 25_815; port++) {
      if (!used.has(port)) free.push({ id: nodeId * 100_000 + port, ip: '203.0.113.10', alias: `${host}.craftinghosting.free`, port });
    }
    return free;
  }

  async cancelServerTransfer(id: number): Promise<boolean> {
    let cancelled = false;
    this.mutate(id, (s) => {
      if (s.transfer && Date.now() < s.transfer.doneAt) {
        delete s.transfer;
        cancelled = true;
      }
    });
    return cancelled;
  }

  async updateServerFeatureLimits(id: number, limits: { databases: number; allocations: number; backups: number }) {
    this.mutate(id, (s) => {
      s.featureLimits = { ...limits };
    });
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

  async readFile(identifier: string, path: string): Promise<string | null> {
    const state = this.load();
    const s = state.servers.find((x) => x.identifier === identifier);
    if (!s) throw new PterodactylError('server not found', 404);
    // Zustand fortschreiben, damit ein gerade gescheiterter Start seine eula.txt schon angelegt hat
    this.settle(s);
    this.save(state);
    return s.files?.[path] ?? null;
  }

  async writeFile(identifier: string, path: string, content: string): Promise<void> {
    const state = this.load();
    const s = state.servers.find((x) => x.identifier === identifier);
    if (!s) throw new PterodactylError('server not found', 404);
    s.files = { ...s.files, [path]: content };
    this.save(state);
  }

  /* ---- Dateien: Der Mock führt eine flache Liste „Pfad → Inhalt“ ---- */

  private withFiles<T>(identifier: string, fn: (files: Record<string, string>) => T): T {
    const state = this.load();
    const s = state.servers.find((x) => x.identifier === identifier);
    if (!s) throw new PterodactylError('server not found', 404);
    const files = { ...(s.files ?? {}) };
    const out = fn(files);
    s.files = files;
    this.save(state);
    return out;
  }

  async listFiles(identifier: string, directory: string): Promise<PteroFile[]> {
    const dir = directory.endsWith('/') ? directory : `${directory}/`;
    return this.withFiles(identifier, (files) => {
      const seen = new Map<string, PteroFile>();
      for (const [path, content] of Object.entries(files)) {
        if (!path.startsWith(dir)) continue;
        const rest = path.slice(dir.length);
        const name = rest.split('/')[0]!;
        if (!name || name === '.keep') continue;
        const isDir = rest.includes('/');
        if (!seen.has(name) || isDir) seen.set(name, { name, directory: isDir, size: isDir ? 0 : content.length, modifiedAt: new Date(0).toISOString() });
      }
      return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  async writeFileRaw(identifier: string, path: string, content: Buffer): Promise<void> {
    this.withFiles(identifier, (files) => void (files[path] = content.toString('utf8')));
  }

  async deleteFiles(identifier: string, root: string, names: string[]): Promise<void> {
    const base = root.endsWith('/') ? root : `${root}/`;
    this.withFiles(identifier, (files) => {
      for (const name of names) for (const path of Object.keys(files)) if (path === base + name || path.startsWith(`${base}${name}/`)) delete files[path];
    });
  }

  async createFolder(identifier: string, root: string, name: string): Promise<void> {
    this.withFiles(identifier, (files) => void (files[`${root.endsWith('/') ? root : `${root}/`}${name}/.keep`] = ''));
  }

  async fileUploadUrl(identifier: string): Promise<string> {
    return `https://node.mock.invalid/upload/file?token=mock-${identifier}`;
  }

  async fileDownloadUrl(identifier: string, path: string): Promise<string> {
    if (this.withFiles(identifier, (files) => files[path]) === undefined) throw new PterodactylError('file not found', 404);
    return `https://node.mock.invalid/download/file?token=mock-${identifier}&file=${encodeURIComponent(path)}`;
  }

  async decompressFile(identifier: string, root: string, file: string): Promise<void> {
    const base = root.endsWith('/') ? root : `${root}/`;
    this.withFiles(identifier, (files) => {
      if (files[base + file] === undefined) throw new PterodactylError('file not found', 404);
      files[`${base}${file.replace(/\.(zip|tar\.gz|tgz)$/i, '')}/level.dat`] = `entpackt aus ${file}`;
    });
  }

  async pullFile(identifier: string, url: string, directory: string, filename: string): Promise<void> {
    this.withFiles(identifier, (files) => void (files[`${directory.endsWith('/') ? directory : `${directory}/`}${filename}`] = `geladen von ${url}`));
  }

  async renameServer(id: number, name: string): Promise<void> {
    this.mutate(id, (s) => {
      s.name = name;
    });
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
