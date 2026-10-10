import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubscriptionClient, type SocketState } from "./subscriptions";

class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(
    readonly url: string,
    readonly protocol: string,
  ) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(message: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
}

const factory = (url: string, protocol: string) =>
  new FakeSocket(url, protocol) as unknown as WebSocket;

describe("SubscriptionClient (graphql-transport-ws)", () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("handshakes, subscribes, delivers data and answers pings", () => {
    const client = new SubscriptionClient("ws://x/v1/graphql", factory);
    const states: SocketState[] = [];
    client.onStateChange((s) => states.push(s));
    const onData = vi.fn();
    client.subscribe("subscription { A { id } }", {}, onData, vi.fn());

    const socket = FakeSocket.instances[0]!;
    expect(socket.protocol).toBe("graphql-transport-ws");
    socket.open();
    expect(socket.sent[0]).toEqual({ type: "connection_init", payload: {} });
    socket.receive({ type: "connection_ack" });
    expect(socket.sent[1]).toMatchObject({ id: "1", type: "subscribe" });
    socket.receive({
      type: "next",
      id: "1",
      payload: { data: { A: [{ id: "1" }] } },
    });
    expect(onData).toHaveBeenCalledWith({ A: [{ id: "1" }] });
    socket.receive({ type: "ping" });
    expect(socket.sent.at(-1)).toEqual({ type: "pong" });
    expect(states).toEqual(["closed", "connecting", "open"]);
  });

  it("reconnects with backoff and re-subscribes after the socket drops", () => {
    const client = new SubscriptionClient("ws://x", factory);
    const states: SocketState[] = [];
    client.onStateChange((s) => states.push(s));
    client.subscribe(
      "subscription { A { id } }",
      { id: "1" },
      vi.fn(),
      vi.fn(),
    );
    FakeSocket.instances[0]!.open();
    FakeSocket.instances[0]!.receive({ type: "connection_ack" });

    FakeSocket.instances[0]!.drop();
    expect(states.at(-1)).toBe("reconnecting");
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1_000);
    expect(FakeSocket.instances).toHaveLength(2);

    const second = FakeSocket.instances[1]!;
    second.open();
    second.receive({ type: "connection_ack" });
    expect(second.sent.find((m) => m.type === "subscribe")).toMatchObject({
      payload: { variables: { id: "1" } },
    });
    expect(states.at(-1)).toBe("open");
  });

  it("reports GraphQL errors and stops when the last subscriber leaves", () => {
    const client = new SubscriptionClient("ws://x", factory);
    const onError = vi.fn();
    const unsubscribe = client.subscribe(
      "subscription { A { id } }",
      {},
      vi.fn(),
      onError,
    );
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.receive({ type: "connection_ack" });
    socket.receive({
      type: "error",
      id: "1",
      payload: [{ message: "field not found" }],
    });
    expect(onError).toHaveBeenCalledWith("field not found");
    unsubscribe();
    expect(socket.sent.at(-1)).toEqual({ id: "1", type: "complete" });
    expect(client.currentState).toBe("closed");
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });
});
