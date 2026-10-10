// Transaction lifecycle. A payment is only "confirmed" once a receipt with status "success"
// exists; "indexed" additionally means the indexer has caught up.

export type TxState =
  | { status: "idle" }
  | { status: "preparing"; label: string }
  | { status: "awaiting-signature"; label: string }
  | { status: "pending"; label: string; hash: `0x${string}` }
  | {
      status: "confirmed";
      label: string;
      hash: `0x${string}`;
      blockNumber: bigint;
    }
  | { status: "reverted"; label: string; hash: `0x${string}`; message: string }
  | { status: "failed"; label: string; message: string };

export type TxEvent =
  | { type: "prepare"; label: string }
  | { type: "request-signature" }
  | { type: "submitted"; hash: `0x${string}` }
  | { type: "receipt"; success: boolean; blockNumber: bigint; message?: string }
  | { type: "error"; message: string }
  | { type: "reset" };

const labelOf = (state: TxState) =>
  "label" in state ? state.label : "Transaction";

export function txReducer(state: TxState, event: TxEvent): TxState {
  switch (event.type) {
    case "reset":
      return { status: "idle" };
    case "prepare":
      return isBusy(state)
        ? state
        : { status: "preparing", label: event.label };
    case "request-signature":
      return state.status === "preparing"
        ? { status: "awaiting-signature", label: state.label }
        : state;
    case "submitted":
      return state.status === "awaiting-signature" ||
        state.status === "preparing"
        ? { status: "pending", label: state.label, hash: event.hash }
        : state;
    case "receipt":
      if (state.status !== "pending") return state;
      return event.success
        ? {
            status: "confirmed",
            label: state.label,
            hash: state.hash,
            blockNumber: event.blockNumber,
          }
        : {
            status: "reverted",
            label: state.label,
            hash: state.hash,
            message:
              event.message ?? "The transaction reverted. Nothing changed.",
          };
    case "error":
      if (state.status === "pending") {
        // Broadcast but we lost track of it: never claim success or failure on-chain.
        return {
          status: "failed",
          label: state.label,
          message: `${event.message} The transaction ${state.hash} may still confirm; check it before retrying.`,
        };
      }
      return {
        status: "failed",
        label: labelOf(state),
        message: event.message,
      };
  }
}

export function isBusy(state: TxState): boolean {
  return (
    state.status === "preparing" ||
    state.status === "awaiting-signature" ||
    state.status === "pending"
  );
}

/** The only state in which the UI may say the action happened. */
export function isConfirmed(
  state: TxState,
): state is Extract<TxState, { status: "confirmed" }> {
  return state.status === "confirmed";
}
