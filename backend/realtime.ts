import { EventEmitter } from 'node:events';

export interface CrmRealtimeEvent {
  type: 'delta' | 'announcement' | 'lock';
  action: string;
  at: string;
  actorId?: string;
}

const emitter = new EventEmitter();
emitter.setMaxListeners(200);

export function broadcastCrmEvent(event: CrmRealtimeEvent): void {
  try {
    emitter.emit('crm_event', event);
  } catch {
    // Non-fatal
  }
}

export function subscribeCrmEvents(listener: (event: CrmRealtimeEvent) => void): () => void {
  emitter.on('crm_event', listener);
  return () => {
    emitter.off('crm_event', listener);
  };
}
