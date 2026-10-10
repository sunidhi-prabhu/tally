// Event handlers for TallyLedger. Read-only: they only write Envio entities.
//
// Guarantees relied on (see README): events arrive in chain order; on a reorg within
// max_reorg_depth Envio rolls back every entity written here. Handlers are additionally
// idempotent, keyed on the event's chain position, so a re-delivered event changes nothing.
import { indexer } from "envio";
import type {
  EvmOnEventContext,
  Group,
  GroupActivity,
  Membership,
} from "envio";
import {
  activityKey,
  checkExpense,
  checkSettlement,
  deltasFor,
  expenseKey,
  groupKey,
  membershipKey,
  settlementKey,
  settlementKindName,
  splitTypeFromEvent,
  toCoreExpense,
  toCoreSettlement,
} from "../ledger";

type Context = EvmOnEventContext;

interface EventPosition {
  readonly blockNumber: number;
  readonly blockTimestamp: number;
  readonly txHash: string;
  readonly logIndex: number;
}

function positionOf(event: {
  block: { number: number; timestamp: number };
  transaction: { hash: string };
  logIndex: number;
}): EventPosition {
  return {
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    txHash: event.transaction.hash,
    logIndex: event.logIndex,
  };
}

/** True if this exact event (same block and log index) was already indexed. */
async function alreadyIndexed(
  context: Context,
  position: EventPosition,
): Promise<boolean> {
  return (
    (await context.GroupActivity.get(
      activityKey(position.blockNumber, position.logIndex),
    )) !== undefined
  );
}

async function loadGroup(context: Context, groupId: bigint): Promise<Group> {
  return context.Group.getOrThrow(
    groupKey(groupId),
    `Group ${groupId} is not indexed. The indexer's start_block must be at or before the ` +
      `TallyLedger deployment block.`,
  );
}

async function loadMembership(
  context: Context,
  groupId: bigint,
  address: string,
): Promise<Membership> {
  return context.Membership.getOrThrow(
    membershipKey(groupId, address),
    `Membership ${address} in group ${groupId} is not indexed.`,
  );
}

/** Appends an activity row and returns the group with its counter advanced. */
function addActivity(
  context: Context,
  group: Group,
  position: EventPosition,
  activity: Omit<
    GroupActivity,
    | "id"
    | "group_id"
    | "sequence"
    | "blockNumber"
    | "blockTimestamp"
    | "txHash"
    | "logIndex"
  >,
): Group {
  const sequence = group.activityCount + 1;
  context.GroupActivity.set({
    id: activityKey(position.blockNumber, position.logIndex),
    group_id: group.id,
    sequence,
    ...position,
    ...activity,
  });
  return { ...group, activityCount: sequence };
}

indexer.onEvent(
  { contract: "TallyLedger", event: "GroupCreated" },
  async ({ event, context }) => {
    const position = positionOf(event);
    if (await alreadyIndexed(context, position)) return;
    const id = groupKey(event.params.groupId);
    if (await context.Group.get(id)) return;

    const group: Group = {
      id,
      groupId: event.params.groupId,
      name: event.params.name,
      admin: event.params.admin,
      memberCount: 0,
      expenseCount: 0,
      settlementCount: 0,
      activityCount: 0,
      totalExpenseAmount: 0n,
      totalTokenSettled: 0n,
      totalAcknowledged: 0n,
      createdAtBlock: position.blockNumber,
      createdAtTimestamp: position.blockTimestamp,
      createdTxHash: position.txHash,
    };
    context.Group.set(
      addActivity(context, group, position, {
        activityType: "GROUP_CREATED",
        actor: event.params.admin,
        member: undefined,
        expense_id: undefined,
        settlement_id: undefined,
        amount: undefined,
      }),
    );
  },
);

indexer.onEvent(
  { contract: "TallyLedger", event: "MemberAdded" },
  async ({ event, context }) => {
    const position = positionOf(event);
    if (await alreadyIndexed(context, position)) return;
    const { groupId, member, addedBy } = event.params;
    const group = await loadGroup(context, groupId);
    const existing = await context.Membership.get(
      membershipKey(groupId, member),
    );
    if (existing?.active) return;

    context.Account.set({ id: member });
    // A re-added member starts from their previous record; the contract only removes members
    // at a zero balance, so netBalance is 0 here.
    context.Membership.set({
      id: membershipKey(groupId, member),
      group_id: group.id,
      account_id: member,
      address: member,
      active: true,
      netBalance: existing?.netBalance ?? 0n,
      totalPaid: existing?.totalPaid ?? 0n,
      totalOwedShares: existing?.totalOwedShares ?? 0n,
      addedBy,
      joinedAtBlock: position.blockNumber,
      leftAtBlock: undefined,
    });
    context.Group.set(
      addActivity(
        context,
        { ...group, memberCount: group.memberCount + 1 },
        position,
        {
          activityType: "MEMBER_ADDED",
          actor: addedBy,
          member,
          expense_id: undefined,
          settlement_id: undefined,
          amount: undefined,
        },
      ),
    );
  },
);

indexer.onEvent(
  { contract: "TallyLedger", event: "MemberRemoved" },
  async ({ event, context }) => {
    const position = positionOf(event);
    if (await alreadyIndexed(context, position)) return;
    const { groupId, member, removedBy } = event.params;
    const group = await loadGroup(context, groupId);
    const membership = await loadMembership(context, groupId, member);
    if (!membership.active) return;
    if (membership.netBalance !== 0n) {
      context.log.error(
        `Member ${member} removed from group ${groupId} with indexed balance ${membership.netBalance}; ` +
          `the contract only allows zero. Indexed data may be inconsistent.`,
      );
    }

    context.Membership.set({
      ...membership,
      active: false,
      leftAtBlock: position.blockNumber,
    });
    context.Group.set(
      addActivity(
        context,
        { ...group, memberCount: group.memberCount - 1 },
        position,
        {
          activityType: "MEMBER_REMOVED",
          actor: removedBy,
          member,
          expense_id: undefined,
          settlement_id: undefined,
          amount: undefined,
        },
      ),
    );
  },
);

indexer.onEvent(
  { contract: "TallyLedger", event: "ExpenseRecorded" },
  async ({ event, context }) => {
    const position = positionOf(event);
    if (await alreadyIndexed(context, position)) return;
    const { params } = event;
    const id = expenseKey(params.groupId, params.expenseId);
    // Expense IDs are unique per group on-chain, so a second sighting is a re-delivery.
    if (await context.Expense.get(id)) return;

    const group = await loadGroup(context, params.groupId);
    const splitType = splitTypeFromEvent(params.splitType);
    const problem = checkExpense(params, splitType);
    if (problem) {
      context.log.error(`Expense ${id} disagrees with @tally/core: ${problem}`);
    }
    const expense = toCoreExpense(params);

    context.Expense.set({
      id,
      group_id: group.id,
      expenseId: params.expenseId,
      payer: expense.payer,
      amount: expense.amount,
      splitType,
      description: params.description,
      participantCount: expense.shares.length,
      ...position,
    });
    expense.shares.forEach((share, position_) => {
      context.ExpenseShare.set({
        id: `${id}-${share.member}`,
        expense_id: id,
        group_id: group.id,
        member: share.member,
        amount: share.amount,
        position: position_,
      });
    });

    // Load each affected membership once, then apply core's deltas and running totals.
    const affected = new Map<string, Membership>();
    for (const address of [
      expense.payer,
      ...expense.shares.map((s) => s.member),
    ]) {
      if (!affected.has(address)) {
        affected.set(
          address,
          await loadMembership(context, params.groupId, address),
        );
      }
    }
    const update = (address: string, change: Partial<Membership>) => {
      const current = affected.get(address);
      if (current) affected.set(address, { ...current, ...change });
    };
    for (const { member, delta } of deltasFor({ kind: "expense", expense })) {
      update(member, { netBalance: affected.get(member)!.netBalance + delta });
    }
    update(expense.payer, {
      totalPaid: affected.get(expense.payer)!.totalPaid + expense.amount,
    });
    for (const share of expense.shares) {
      update(share.member, {
        totalOwedShares:
          affected.get(share.member)!.totalOwedShares + share.amount,
      });
    }
    for (const membership of affected.values())
      context.Membership.set(membership);

    context.Group.set(
      addActivity(
        context,
        {
          ...group,
          expenseCount: group.expenseCount + 1,
          totalExpenseAmount: group.totalExpenseAmount + expense.amount,
        },
        position,
        {
          activityType: "EXPENSE_RECORDED",
          actor: expense.payer,
          member: undefined,
          expense_id: id,
          settlement_id: undefined,
          amount: expense.amount,
        },
      ),
    );
  },
);

indexer.onEvent(
  { contract: "TallyLedger", event: "SettlementRecorded" },
  async ({ event, context }) => {
    const position = positionOf(event);
    if (await alreadyIndexed(context, position)) return;
    const { params } = event;
    const id = settlementKey(params.groupId, params.settlementId);
    // Settlement IDs are unique per group across both kinds, so this is a re-delivery.
    if (await context.Settlement.get(id)) return;

    const group = await loadGroup(context, params.groupId);
    const settlement = toCoreSettlement(params);
    const debtor = await loadMembership(
      context,
      params.groupId,
      settlement.from,
    );
    const creditor = await loadMembership(
      context,
      params.groupId,
      settlement.to,
    );
    const problem = checkSettlement(
      settlement,
      debtor.netBalance,
      creditor.netBalance,
    );
    if (problem) {
      context.log.error(
        `Settlement ${id} disagrees with @tally/core: ${problem}`,
      );
    }

    // The ONLY place a settlement changes balances, for both kinds. TokenSettled never does.
    const nets = new Map([
      [debtor.address, debtor.netBalance],
      [creditor.address, creditor.netBalance],
    ]);
    for (const { member, delta } of deltasFor({
      kind: "settlement",
      settlement,
    })) {
      nets.set(member, (nets.get(member) ?? 0n) + delta);
    }
    context.Membership.set({
      ...debtor,
      netBalance: nets.get(debtor.address)!,
    });
    context.Membership.set({
      ...creditor,
      netBalance: nets.get(creditor.address)!,
    });

    const kind = settlementKindName(settlement.kind);
    context.Settlement.set({
      id,
      group_id: group.id,
      settlementId: params.settlementId,
      debtor: settlement.from,
      creditor: settlement.to,
      amount: settlement.amount,
      kind,
      token: undefined,
      tokenTransferConfirmed: false,
      ...position,
    });
    context.Group.set(
      addActivity(
        context,
        {
          ...group,
          settlementCount: group.settlementCount + 1,
          totalAcknowledged:
            kind === "ACKNOWLEDGED"
              ? group.totalAcknowledged + settlement.amount
              : group.totalAcknowledged,
        },
        position,
        {
          activityType:
            kind === "TOKEN_TRANSFER"
              ? "SETTLEMENT_TOKEN_TRANSFER"
              : "SETTLEMENT_ACKNOWLEDGED",
          actor: kind === "TOKEN_TRANSFER" ? settlement.from : settlement.to,
          member: undefined,
          expense_id: undefined,
          settlement_id: id,
          amount: settlement.amount,
        },
      ),
    );
  },
);

// Emitted only when tokens actually moved, right after SettlementRecorded in the same
// transaction. Confirms the payment and records the token; balances were already updated.
indexer.onEvent(
  { contract: "TallyLedger", event: "TokenSettled" },
  async ({ event, context }) => {
    const { params } = event;
    const id = settlementKey(params.groupId, params.settlementId);
    const settlement = await context.Settlement.get(id);
    if (!settlement) {
      context.log.error(`TokenSettled for unknown settlement ${id}; ignored.`);
      return;
    }
    if (settlement.tokenTransferConfirmed) return; // re-delivery
    if (
      settlement.kind !== "TOKEN_TRANSFER" ||
      settlement.debtor !== params.from ||
      settlement.creditor !== params.to ||
      settlement.amount !== params.amount
    ) {
      context.log.error(
        `TokenSettled for ${id} does not match its SettlementRecorded; not confirmed.`,
      );
      return;
    }

    context.Settlement.set({
      ...settlement,
      token: params.token,
      tokenTransferConfirmed: true,
    });
    const group = await loadGroup(context, params.groupId);
    context.Group.set({
      ...group,
      totalTokenSettled: group.totalTokenSettled + params.amount,
    });
  },
);
