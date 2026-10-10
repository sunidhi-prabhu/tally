// Minimal graphql-transport-ws client (the protocol Hasura serves). One socket is shared by
// all subscriptions; it reconnects with exponential backoff and re-subscribes.

export type SocketState = "connecting" | "open" | "reconnecting" | "closed";

interface Subscriber {
  query: string;
  variables: Record<string, unknown>;
  onData: (data: unknown) => void;
  onError: (message: string) => void;
}

type Message =
  | { type: "connection_ack" }
  | { type: "ping" }
  | { type: "pong" }
  | {
      type: "next";
      id: string;
      payload: { data?: unknown; errors?: { message: string }[] };
    }
  | { type: "error"; id: string; payload: { message: string }[] }
  | { type: "complete"; id: string };

export interface SocketFactory {
  (url: string, protocol: string): WebSocket;
}

export class SubscriptionClient {
  private socket: WebSocket | undefined;
  private acknowledged = false;
  private nextId = 1;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly subscribers = new Map<string, Subscriber>();
  private readonly stateListeners = new Set<(state: SocketState) => void>();
  private state: SocketState = "closed";

  constructor(
    private readonly url: string,
    private readonly createSocket: SocketFactory = (u, p) =>
      new WebSocket(u, p),
    private readonly maxDelayMs = 15_000,
  ) {}

  get currentState(): SocketState {
    return this.state;
  }

  onStateChange(listener: (state: SocketState) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => this.stateListeners.delete(listener);
  }

  subscribe(
    query: string,
    variables: Record<string, unknown>,
    onData: (data: unknown) => void,
    onError: (message: string) => void,
  ): () => void {
    const id = String(this.nextId++);
    this.subscribers.set(id, { query, variables, onData, onError });
    if (!this.socket) this.connect();
    else if (this.acknowledged) this.send(id);
    return () => {
      this.subscribers.delete(id);
      if (this.acknowledged) this.raw({ id, type: "complete" });
      if (this.subscribers.size === 0) this.close();
    };
  }

  close(): void {
    clearTimeout(this.retryTimer);
    const socket = this.socket;
    this.socket = undefined;
    this.acknowledged = false;
    socket?.close(1000);
    this.setState("closed");
  }

  private setState(state: SocketState) {
    this.state = state;
    for (const listener of this.stateListeners) listener(state);
  }

  private connect() {
    this.setState(this.attempts === 0 ? "connecting" : "reconnecting");
    const socket = this.createSocket(this.url, "graphql-transport-ws");
    this.socket = socket;
    socket.onopen = () => this.raw({ type: "connection_init", payload: {} });
    socket.onmessage = (event) =>
      this.handle(JSON.parse(String(event.data)) as Message);
    socket.onclose = () => {
      if (this.socket !== socket) return; // closed on purpose
      this.socket = undefined;
      this.acknowledged = false;
      if (this.subscribers.size === 0) return this.setState("closed");
      this.attempts += 1;
      this.setState("reconnecting");
      const delay = Math.min(
        this.maxDelayMs,
        500 * 2 ** Math.min(this.attempts, 5),
      );
      this.retryTimer = setTimeout(() => this.connect(), delay);
    };
  }

  private handle(message: Message) {
    switch (message.type) {
      case "connection_ack":
        this.acknowledged = true;
        this.attempts = 0;
        this.setState("open");
        for (const id of this.subscribers.keys()) this.send(id);
        return;
      case "ping":
        return this.raw({ type: "pong" });
      case "next": {
        const subscriber = this.subscribers.get(message.id);
        if (!subscriber) return;
        if (message.payload.errors?.length) {
          subscriber.onError(
            message.payload.errors.map((e) => e.message).join("; "),
          );
        } else {
          subscriber.onData(message.payload.data);
        }
        return;
      }
      case "error":
        this.subscribers
          .get(message.id)
          ?.onError(message.payload.map((e) => e.message).join("; "));
        return;
      default:
        return;
    }
  }

  private send(id: string) {
    const subscriber = this.subscribers.get(id);
    if (!subscriber) return;
    this.raw({
      id,
      type: "subscribe",
      payload: { query: subscriber.query, variables: subscriber.variables },
    });
  }

  private raw(message: Record<string, unknown>) {
    if (this.socket?.readyState === 1)
      this.socket.send(JSON.stringify(message));
  }
}
