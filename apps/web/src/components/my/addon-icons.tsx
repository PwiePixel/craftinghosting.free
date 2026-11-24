import type { ReactNode } from 'react';
import { Archive, Clock, Cpu, HardDrive, MemoryStick, Network, Plus, Star } from 'lucide-react';
import type { AddonIcon } from '@chfree/shared';

/** Symbole der Extras – für die Verwaltung (Client) und die öffentliche Seite (Server) */
export const addonIcons: Record<AddonIcon, ReactNode> = {
  clock: <Clock className="size-5" aria-hidden />,
  ip: <Network className="size-5" aria-hidden />,
  cpu: <Cpu className="size-5" aria-hidden />,
  memory: <MemoryStick className="size-5" aria-hidden />,
  disk: <HardDrive className="size-5" aria-hidden />,
  backup: <Archive className="size-5" aria-hidden />,
  star: <Star className="size-5" aria-hidden />,
  plus: <Plus className="size-5" aria-hidden />,
};
