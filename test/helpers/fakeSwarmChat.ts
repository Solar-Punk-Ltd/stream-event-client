import type { ChatParts, ChatSettings, MessageData } from '@solarpunkltd/swarm-chat-js';
import { vi } from 'vitest';

type Listener = (data: unknown) => void;

class FakeEmitter {
  private listeners = new Map<string, Listener[]>();

  on = (event: string, listener: Listener) => {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  };

  off = (event: string, listener: Listener) => {
    this.listeners.set(
      event,
      (this.listeners.get(event) ?? []).filter((candidate) => candidate !== listener),
    );
  };

  emit = (event: string, data: unknown) => {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      listener(data);
    }
  };

  cleanAll = () => {
    this.listeners.clear();
  };

  listenerCount(): number {
    return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.length, 0);
  }
}

/**
 * Stands in for the chat library's SwarmChat: nothing reaches the network, and a test drives the chat by
 * emitting the library's own events on the instance it created.
 */
export class FakeSwarmChat {
  static instances: FakeSwarmChat[] = [];

  /** What the next chat created answers start() with, so a test can hold a start open. */
  static nextStart: (() => Promise<void>) | null = null;

  static reset() {
    FakeSwarmChat.instances = [];
    FakeSwarmChat.nextStart = null;
  }

  static latest(): FakeSwarmChat {
    const chat = FakeSwarmChat.instances.at(-1);
    if (!chat) {
      throw new Error('no chat was created');
    }
    return chat;
  }

  readonly emitter = new FakeEmitter();
  previousMessages = false;

  start = vi.fn(async () => {});
  /** Library 7.0 keeps the listeners through a stop, so a later start reports to them again. */
  stop = vi.fn(async () => {});
  sendMessage = vi.fn(async () => {});
  retrySendMessage = vi.fn(async () => {});
  fetchPreviousMessages = vi.fn(async () => {});
  hasPreviousMessages = vi.fn(() => this.previousMessages);

  constructor(
    readonly settings: ChatSettings,
    /** The reads and the write the page handed the library in place of its own Bee client. */
    readonly parts?: Partial<ChatParts>,
  ) {
    FakeSwarmChat.instances.push(this);
    const nextStart = FakeSwarmChat.nextStart;
    if (nextStart) {
      FakeSwarmChat.nextStart = null;
      this.start.mockImplementation(nextStart);
    }
  }

  getEmitter() {
    return this.emitter;
  }

  orderMessages(messages: MessageData[]) {
    return [...messages].sort((a, b) => a.timestamp - b.timestamp);
  }
}
