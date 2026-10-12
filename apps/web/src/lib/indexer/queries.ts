// GraphQL documents for the Envio schema in packages/indexer/schema.graphql, plus parsers.
// Hasura returns BigInt columns as strings; they are converted with BigInt(), never Number().

export type SettlementKindName = "ACKNOWLEDGED" | "TOKEN_TRANSFER";
export type ActivityTypeName =
  | "GROUP_CREATED"
  | "MEMBER_ADDED"
  | "MEMBER_REMOVED"
  | "EXPENSE_RECORDED"
  | "EXPENSE_UNDONE"
  | "SETTLEMENT_ACKNOWLEDGED"
  | "SETTLEMENT_TOKEN_TRANSFER";

const big = (value: string | number | null | undefined): bigint =>
  value === null || value === undefined ? 0n : BigInt(value);

// ------------------------------------------------------------------ indexer progress

export const META = /* GraphQL */ `
  query Meta {
    _meta {
      chainId
      progressBlock
      sourceBlock
      isReady
    }
  }
`;

export interface IndexerMeta {
  chainId: number;
  progressBlock: number;
  sourceBlock: number;
  isReady: boolean;
}

export function parseMeta(data: unknown): IndexerMeta | undefined {
  const rows = (data as { _meta?: IndexerMeta[] })._meta ?? [];
  return rows[0];
}

// ------------------------------------------------------------------ dashboard

export const MY_MEMBERSHIPS = /* GraphQL */ `
  query MyMemberships($address: String!) {
    Membership(
      where: { address: { _eq: $address } }
      order_by: { group_id: asc }
    ) {
      active
      netBalance
      group {
        id
        name
        memberCount
        expenseCount
      }
    }
  }
`;

export interface MyMembership {
  groupId: string;
  groupName: string;
  memberCount: number;
  expenseCount: number;
  active: boolean;
  netBalance: bigint;
}

interface RawMembership {
  active: boolean;
  netBalance: string;
  group: {
    id: string;
    name: string;
    memberCount: number;
    expenseCount: number;
  };
}

export function parseMyMemberships(data: unknown): MyMembership[] {
  return ((data as { Membership: RawMembership[] }).Membership ?? []).map(
    (m) => ({
      groupId: m.group.id,
      groupName: m.group.name,
      memberCount: m.group.memberCount,
      expenseCount: m.group.expenseCount,
      active: m.active,
      netBalance: big(m.netBalance),
    }),
  );
}

export const RECENT_ACTIVITY = /* GraphQL */ `
  query RecentActivity($groupIds: [String!]!, $limit: Int!) {
    GroupActivity(
      where: { group_id: { _in: $groupIds } }
      order_by: [{ blockNumber: desc }, { logIndex: desc }]
      limit: $limit
    ) {
      id
      sequence
      activityType
      actor
      member
      amount
      blockTimestamp
      txHash
      group {
        id
        name
      }
      expense {
        description
      }
    }
  }
`;

export interface Activity {
  id: string;
  groupId: string;
  groupName: string;
  sequence: number;
  type: ActivityTypeName;
  actor: string;
  member: string | undefined;
  amount: bigint | undefined;
  description: string | undefined;
  timestamp: number;
  txHash: string;
}

interface RawActivity {
  id: string;
  sequence: number;
  activityType: ActivityTypeName;
  actor: string;
  member: string | null;
  amount: string | null;
  blockTimestamp: number;
  txHash: string;
  group: { id: string; name: string };
  expense: { description: string } | null;
}

export function parseActivity(data: unknown): Activity[] {
  return ((data as { GroupActivity: RawActivity[] }).GroupActivity ?? []).map(
    (a) => ({
      id: `${a.group.id}-${a.id}`,
      groupId: a.group.id,
      groupName: a.group.name,
      sequence: a.sequence,
      type: a.activityType,
      actor: a.actor,
      member: a.member ?? undefined,
      amount: a.amount === null ? undefined : big(a.amount),
      description: a.expense?.description,
      timestamp: a.blockTimestamp,
      txHash: a.txHash,
    }),
  );
}

// ------------------------------------------------------------------ group detail

/**
 * Active expenses' shares and all settlements of a group, to count the separate payments that
 * settling up would take without simplification (lib/balances pairwiseDebtCount).
 */
export const GROUP_DEBT_GRAPH = /* GraphQL */ `
  query GroupDebtGraph($id: String!) {
    Expense(
      where: { group_id: { _eq: $id }, undone: { _eq: false } }
      limit: 1000
    ) {
      payer
      shares {
        member
        amount
      }
    }
    Settlement(where: { group_id: { _eq: $id } }, limit: 1000) {
      debtor
      creditor
      amount
    }
  }
`;

export interface DebtGraph {
  expenses: { payer: string; shares: { member: string; amount: bigint }[] }[];
  settlements: { debtor: string; creditor: string; amount: bigint }[];
}

export function parseDebtGraph(data: unknown): DebtGraph {
  const raw = data as {
    Expense?: { payer: string; shares: { member: string; amount: string }[] }[];
    Settlement?: { debtor: string; creditor: string; amount: string }[];
  };
  return {
    expenses: (raw.Expense ?? []).map((e) => ({
      payer: e.payer,
      shares: e.shares.map((s) => ({
        member: s.member,
        amount: big(s.amount),
      })),
    })),
    settlements: (raw.Settlement ?? []).map((s) => ({
      debtor: s.debtor,
      creditor: s.creditor,
      amount: big(s.amount),
    })),
  };
}

export const GROUP_DETAIL = /* GraphQL */ `
  query GroupDetail($id: String!) {
    Group(where: { id: { _eq: $id } }) {
      id
      name
      admin
      memberCount
      expenseCount
      settlementCount
      totalExpenseAmount
      totalTokenSettled
      totalAcknowledged
      createdAtTimestamp
      members(order_by: { joinedAtBlock: asc }) {
        address
        active
        netBalance
        totalPaid
        totalOwedShares
      }
    }
  }
`;

export interface GroupMember {
  address: string;
  active: boolean;
  netBalance: bigint;
  totalPaid: bigint;
  totalOwedShares: bigint;
}

export interface GroupDetail {
  id: string;
  name: string;
  admin: string;
  memberCount: number;
  expenseCount: number;
  settlementCount: number;
  totalExpenseAmount: bigint;
  totalTokenSettled: bigint;
  totalAcknowledged: bigint;
  createdAt: number;
  members: GroupMember[];
}

interface RawGroup {
  id: string;
  name: string;
  admin: string;
  memberCount: number;
  expenseCount: number;
  settlementCount: number;
  totalExpenseAmount: string;
  totalTokenSettled: string;
  totalAcknowledged: string;
  createdAtTimestamp: number;
  members: {
    address: string;
    active: boolean;
    netBalance: string;
    totalPaid: string;
    totalOwedShares: string;
  }[];
}

export function parseGroupDetail(data: unknown): GroupDetail | null {
  const raw = (data as { Group: RawGroup[] }).Group?.[0];
  if (!raw) return null;
  return {
    id: raw.id,
    name: raw.name,
    admin: raw.admin,
    memberCount: raw.memberCount,
    expenseCount: raw.expenseCount,
    settlementCount: raw.settlementCount,
    totalExpenseAmount: big(raw.totalExpenseAmount),
    totalTokenSettled: big(raw.totalTokenSettled),
    totalAcknowledged: big(raw.totalAcknowledged),
    createdAt: raw.createdAtTimestamp,
    members: raw.members.map((m) => ({
      address: m.address,
      active: m.active,
      netBalance: big(m.netBalance),
      totalPaid: big(m.totalPaid),
      totalOwedShares: big(m.totalOwedShares),
    })),
  };
}

const EXPENSE_FIELDS = /* GraphQL */ `
  fragment ExpenseFields on Expense {
    id
    expenseId
    description
    amount
    splitType
    payer
    txHash
    blockTimestamp
    undone
    undoneBy
    undoneTxHash
    shares(order_by: { position: asc }) {
      member
      amount
    }
  }
`;

export const GROUP_EXPENSES = /* GraphQL */ `
  query GroupExpenses($id: String!, $limit: Int!, $offset: Int!) {
    Expense(
      where: { group_id: { _eq: $id } }
      order_by: [{ blockNumber: desc }, { logIndex: desc }]
      limit: $limit
      offset: $offset
    ) {
      ...ExpenseFields
    }
  }
  ${EXPENSE_FIELDS}
`;

/** One expense by entity ID ("<groupId>-<expenseId>"), e.g. to prefill a corrected copy. */
export const EXPENSE_BY_ID = /* GraphQL */ `
  query ExpenseById($id: String!) {
    Expense(where: { id: { _eq: $id } }) {
      ...ExpenseFields
    }
  }
  ${EXPENSE_FIELDS}
`;

export interface ExpenseRow {
  id: string;
  /** The contract's bytes32 expense ID. */
  expenseId: `0x${string}`;
  description: string;
  amount: bigint;
  splitType: "EQUAL" | "CUSTOM";
  payer: string;
  txHash: string;
  timestamp: number;
  /** In the order the contract received them, which `undoExpense` requires. */
  shares: { member: string; amount: bigint }[];
  undone: boolean;
  undoneBy: string | undefined;
  undoneTxHash: string | undefined;
}

interface RawExpense {
  id: string;
  expenseId: `0x${string}`;
  description: string;
  amount: string;
  splitType: "EQUAL" | "CUSTOM";
  payer: string;
  txHash: string;
  blockTimestamp: number;
  shares: { member: string; amount: string }[];
  undone: boolean;
  undoneBy: string | null;
  undoneTxHash: string | null;
}

export function parseExpenses(data: unknown): ExpenseRow[] {
  return ((data as { Expense: RawExpense[] }).Expense ?? []).map((e) => ({
    id: e.id,
    expenseId: e.expenseId,
    description: e.description,
    amount: big(e.amount),
    splitType: e.splitType,
    payer: e.payer,
    txHash: e.txHash,
    timestamp: e.blockTimestamp,
    shares: e.shares.map((s) => ({ member: s.member, amount: big(s.amount) })),
    undone: e.undone,
    undoneBy: e.undoneBy ?? undefined,
    undoneTxHash: e.undoneTxHash ?? undefined,
  }));
}

export const parseExpense = (data: unknown): ExpenseRow | undefined =>
  parseExpenses(data)[0];

export const GROUP_SETTLEMENTS = /* GraphQL */ `
  query GroupSettlements($id: String!, $limit: Int!, $offset: Int!) {
    Settlement(
      where: { group_id: { _eq: $id } }
      order_by: [{ blockNumber: desc }, { logIndex: desc }]
      limit: $limit
      offset: $offset
    ) {
      id
      debtor
      creditor
      amount
      kind
      token
      tokenTransferConfirmed
      txHash
      blockTimestamp
    }
  }
`;

export interface SettlementRow {
  id: string;
  debtor: string;
  creditor: string;
  amount: bigint;
  kind: SettlementKindName;
  token: string | undefined;
  tokenTransferConfirmed: boolean;
  txHash: string;
  timestamp: number;
}

interface RawSettlement {
  id: string;
  debtor: string;
  creditor: string;
  amount: string;
  kind: SettlementKindName;
  token: string | null;
  tokenTransferConfirmed: boolean;
  txHash: string;
  blockTimestamp: number;
}

export function parseSettlements(data: unknown): SettlementRow[] {
  return ((data as { Settlement: RawSettlement[] }).Settlement ?? []).map(
    (s) => ({
      id: s.id,
      debtor: s.debtor,
      creditor: s.creditor,
      amount: big(s.amount),
      kind: s.kind,
      token: s.token ?? undefined,
      tokenTransferConfirmed: s.tokenTransferConfirmed,
      txHash: s.txHash,
      timestamp: s.blockTimestamp,
    }),
  );
}

/** True only when tokens verifiably moved on-chain (see packages/indexer README). */
export function isVerifiedTokenPayment(settlement: SettlementRow): boolean {
  return (
    settlement.kind === "TOKEN_TRANSFER" && settlement.tokenTransferConfirmed
  );
}

// ------------------------------------------------------------------ post-transaction checks

export const ENTITY_EXISTS = /* GraphQL */ `
  query EntityExists(
    $expenseId: String!
    $settlementId: String!
    $groupId: String!
  ) {
    Expense(where: { id: { _eq: $expenseId } }) {
      id
    }
    Settlement(where: { id: { _eq: $settlementId } }) {
      id
    }
    Group(where: { id: { _eq: $groupId } }) {
      id
    }
  }
`;
