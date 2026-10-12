import { isMeraError } from "@category-labs/mera";
import {
  BaseError,
  ContractFunctionRevertedError,
  UserRejectedRequestError,
} from "viem";
import { describePasskeyError } from "./passkey/errors";

/** Plain-language messages for TallyLedger and MockToken custom errors. */
const MESSAGES: Record<string, string> = {
  GroupNotFound: "That group does not exist.",
  NotGroupAdmin: "Only the group admin can do that.",
  NotMember: "That address is not a member of this group.",
  ExpenseNotActive: "That expense was already undone.",
  ExpenseDetailsMismatch:
    "The expense details don't match what was recorded. Refresh and try again.",
  NotAllowedToUndo: "Only the person who paid or the group admin can undo it.",
  AlreadyMember: "That address is already a member.",
  ZeroAddress: "Enter a valid address.",
  InvalidMember: "That address cannot be a member.",
  TooManyMembers: "This group is full (100 members).",
  AdminCannotBeRemoved: "The admin cannot leave or be removed.",
  OutstandingBalance:
    "Members can only leave once their balance is exactly zero.",
  InvalidName: "Group names must be 1–64 bytes.",
  DescriptionTooLong: "Descriptions are limited to 280 bytes.",
  ZeroAmount: "Amount must be greater than zero.",
  AmountTooLarge: "Amount is above the 1 trillion AUSD limit.",
  EmptyParticipants: "Choose at least one person to split with.",
  DuplicateParticipant: "Each person can only appear once.",
  ParticipantsNotSorted: "Internal error: participants were not sorted.",
  ShareTotalMismatch: "Shares must add up exactly to the amount.",
  DuplicateExpenseId: "This expense was already recorded.",
  DuplicateSettlementId: "This settlement was already recorded.",
  SelfSettlement: "You cannot settle with yourself.",
  SettlementExceedsDebt:
    "That is more than is currently owed. Balances may have changed.",
  TokenTransferFailed: "The token transfer failed.",
  TokenAmountMismatch: "The recipient did not receive the exact amount.",
  InsufficientAllowance:
    "The ledger is not approved to spend that much. Approve first.",
  InsufficientBalance: "Not enough tokens in this account.",
  InsufficientFundsError:
    "Not enough MON in this account to pay the network fee.",
  Reentrancy: "The transaction was blocked by the reentrancy guard.",
  InvitesDisabled: "This group's invite link was turned off by the admin.",
  InvalidInvite:
    "This invite link is no longer valid. Ask the admin for a new one.",
  // TallyAccount (gasless smart account)
  SignatureExpired: "The request took too long and expired. Try again.",
  InvalidNonce:
    "Another action from this wallet went through first. Try again.",
  InvalidSignature: "The wallet signature didn't match. Nothing was sent.",
  AccountUnauthorized: "This wallet didn't authorize that action.",
};

/** Plain-language text for a contract error name, e.g. from the gas sponsor. */
export function describeContractError(name: string): string {
  return MESSAGES[name] ?? `The contract rejected this: ${name}.`;
}

export function describeError(error: unknown): string {
  if (isMeraError(error)) return describePasskeyError(error).message;
  if (error instanceof BaseError) {
    const mera = error.walk((e) => isMeraError(e));
    if (mera) return describePasskeyError(mera).message;
    if (error.walk((e) => e instanceof UserRejectedRequestError)) {
      return "You rejected the request. Nothing was sent.";
    }
    const reverted = error.walk(
      (e) => e instanceof ContractFunctionRevertedError,
    );
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName;
      if (name && MESSAGES[name]) return MESSAGES[name];
      if (name) return `The contract rejected this: ${name}.`;
      return reverted.shortMessage;
    }
    if (/insufficient funds/i.test(error.shortMessage + error.details)) {
      return "Not enough MON in this account to pay the network fee. Mera wallets have no gas sponsorship.";
    }
    return error.shortMessage;
  }
  return error instanceof Error ? error.message : String(error);
}
