import { Photon } from '@photon-ai/api';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { config } from './config.js';

const STATE_FILE = new URL('../.photon-state.json', import.meta.url).pathname;

interface Space {
  spaceId: string;
  senderId: string;
}

/**
 * photon 2.0 beta imessage channel.
 * - inbound: polls received messages from the owner's number.
 * - outbound: replies, and alerts into the last known conversation.
 * a shared line cannot start a chat, so the owner must text the agent once.
 */
export class PhotonChannel {
  private client?: Photon;
  private space: Space | null = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : null;
  private since = new Date(Date.now() - 5_000).toISOString();
  private seen = new Set<string>();
  private timer?: NodeJS.Timeout;

  get ready() {
    return Boolean(config.photon.key && config.photon.projectId);
  }

  private api() {
    return (this.client ??= new Photon({ headers: { Authorization: `Bearer ${config.photon.key}` } }));
  }

  /** calls onText for every new text from the owner. onText returns the reply. */
  start(onText: (text: string) => Promise<string>) {
    if (!this.ready) {
      console.log('[photon] off: set PHOTON_API_KEY and PHOTON_PROJECT_ID');
      return;
    }
    const tick = async () => {
      try {
        const page: any = await this.api().projects.listMessages({
          path: { id: config.photon.projectId! },
          query: { createdSince: this.since, direction: 'received', order: 'asc', pageSize: 50, platform: 'imessage' },
        });
        for (const m of page.items ?? []) {
          if (this.seen.has(m.id)) continue;
          this.seen.add(m.id);
          this.since = m.createdAt ?? this.since;
          if (m.sentBy?.kind !== 'human' || m.sentBy?.handle !== config.photon.userHandle) continue;
          if (m.content?.type !== 'text') continue;
          this.remember({ spaceId: m.space.id, senderId: m.receivedBy.id });
          const reply = await onText(String(m.content.text).trim());
          await this.send(reply, m.id);
        }
      } catch (e) {
        console.log('[photon] poll error:', (e as Error).message);
      }
    };
    this.timer = setInterval(tick, 2500);
    console.log('[photon] listening for texts from', config.photon.userHandle);
  }

  stop() {
    clearInterval(this.timer);
  }

  private remember(space: Space) {
    this.space = space;
    writeFileSync(STATE_FILE, JSON.stringify(space));
  }

  async send(text: string, parentMessageId?: string) {
    if (!this.ready) return false;
    if (!this.space) {
      console.log('[photon] cannot send yet: text the agent number once first');
      return false;
    }
    await this.api().projects.sendMessage({
      path: { id: config.photon.projectId! },
      headers: { 'idempotency-key': `bb:${Date.now()}:${Math.random().toString(36).slice(2, 8)}` },
      body: {
        spaceId: this.space.spaceId,
        senderId: this.space.senderId,
        ...(parentMessageId ? { parentMessageId } : {}),
        content: { type: 'text', format: 'plain', text },
      },
    } as any);
    return true;
  }
}
