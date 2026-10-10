import { TallyError } from "./errors";
import type { Group, MemberId } from "./types";

const MEMBER_ID_PATTERN = /^\S{1,128}$/;

/**
 * Locale-independent ordering by UTF-16 code units. Used wherever output order must be
 * deterministic (remainder allocation, debt simplification tie-breaks).
 */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A member ID is 1–128 characters with no whitespace. */
export function isValidMemberId(id: unknown): id is MemberId {
  return typeof id === "string" && MEMBER_ID_PATTERN.test(id);
}

export function assertMemberId(id: unknown): asserts id is MemberId {
  if (!isValidMemberId(id)) {
    throw new TallyError("INVALID_MEMBER_ID", "Invalid member ID", { id });
  }
}

export function assertEntityId(
  id: unknown,
  label: string,
): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new TallyError(
      "INVALID_ID",
      `${label} ID must be a non-empty string`,
    );
  }
}

/**
 * Asserts a group has an ID and a non-empty list of unique, valid member IDs.
 *
 * @throws TallyError INVALID_ID | INVALID_MEMBER_ID | EMPTY_PARTICIPANTS | DUPLICATE_MEMBER
 */
export function assertValidGroup(group: Group): void {
  assertEntityId(group.id, "Group");
  if (group.members.length === 0) {
    throw new TallyError("EMPTY_PARTICIPANTS", "Group has no members");
  }
  const seen = new Set<MemberId>();
  for (const member of group.members) {
    assertMemberId(member);
    if (seen.has(member)) {
      throw new TallyError("DUPLICATE_MEMBER", "Group lists a member twice", {
        member,
      });
    }
    seen.add(member);
  }
}

/** @throws TallyError NOT_A_MEMBER */
export function assertMember(
  group: Group,
  member: MemberId,
  role: string,
): void {
  if (!group.members.includes(member)) {
    throw new TallyError(
      "NOT_A_MEMBER",
      `${role} is not a member of the group`,
      { member },
    );
  }
}

/**
 * Asserts a participant list is non-empty, with valid and unique IDs.
 *
 * @throws TallyError EMPTY_PARTICIPANTS | INVALID_MEMBER_ID | DUPLICATE_PARTICIPANT
 */
export function assertUniqueParticipants(
  participants: readonly MemberId[],
): void {
  if (participants.length === 0) {
    throw new TallyError(
      "EMPTY_PARTICIPANTS",
      "At least one participant is required",
    );
  }
  const seen = new Set<MemberId>();
  for (const member of participants) {
    assertMemberId(member);
    if (seen.has(member)) {
      throw new TallyError(
        "DUPLICATE_PARTICIPANT",
        "Participant listed more than once",
        {
          member,
        },
      );
    }
    seen.add(member);
  }
}
