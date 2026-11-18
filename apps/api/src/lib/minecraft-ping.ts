/**
 * Fragt einen Minecraft-Server (Java Edition) nach seinem Status – so wie es die Serverliste im Spiel tut
 * („Server List Ping“). Liefert die Zahl der Spieler; null, wenn der Server nicht antwortet.
 */
import net from 'node:net';

function varint(value: number): Buffer {
  const bytes: number[] = [];
  let v = value >>> 0;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v !== 0) b |= 0x80;
    bytes.push(b);
  } while (v !== 0);
  return Buffer.from(bytes);
}

/** Liest eine VarInt ab `offset`. null = noch nicht vollständig */
function readVarint(buf: Buffer, offset: number): { value: number; size: number } | null {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    if (offset + i >= buf.length) return null;
    const b = buf[offset + i]!;
    value |= (b & 0x7f) << (7 * i);
    if ((b & 0x80) === 0) return { value, size: i + 1 };
  }
  return null;
}

const packet = (id: number, ...parts: Buffer[]) => {
  const body = Buffer.concat([varint(id), ...parts]);
  return Buffer.concat([varint(body.length), body]);
};

export interface MinecraftStatus {
  online: number;
  max: number;
  version: string | null;
}

export function minecraftStatus(host: string, port: number, timeoutMs = 2500): Promise<MinecraftStatus | null> {
  return new Promise((resolve) => {
    let done = false;
    let data = Buffer.alloc(0);
    const socket = net.createConnection({ host, port });
    const finish = (result: MinecraftStatus | null) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs, () => finish(null));
    socket.on('error', () => finish(null));
    socket.on('close', () => finish(null));
    socket.on('connect', () => {
      const name = Buffer.from(host, 'utf8');
      const portBytes = Buffer.alloc(2);
      portBytes.writeUInt16BE(port);
      // Handshake (Protokollversion egal für die Statusabfrage, nächster Zustand 1 = Status), danach die Anfrage selbst
      socket.write(Buffer.concat([packet(0x00, varint(0), varint(name.length), name, portBytes, varint(1)), packet(0x00)]));
    });
    socket.on('data', (chunk) => {
      data = Buffer.concat([data, chunk]);
      if (data.length > 256 * 1024) return finish(null);
      const length = readVarint(data, 0);
      if (!length || data.length < length.size + length.value) return;
      const id = readVarint(data, length.size);
      if (!id) return finish(null);
      const text = readVarint(data, length.size + id.size);
      if (!text) return finish(null);
      const start = length.size + id.size + text.size;
      try {
        const json = JSON.parse(data.subarray(start, start + text.value).toString('utf8')) as { players?: { online?: number; max?: number }; version?: { name?: string } };
        finish({ online: Number(json.players?.online ?? 0), max: Number(json.players?.max ?? 0), version: json.version?.name ?? null });
      } catch {
        finish(null);
      }
    });
  });
}
