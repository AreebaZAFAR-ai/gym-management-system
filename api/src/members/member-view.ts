import { membershipStatus, type Gender, type Goal, type MemberListItem, type ScanMember } from '@gym/shared';
import { and, eq, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Executor } from '../whatsapp/whatsapp';
import { members, plans, users } from '../db/schema';

const trainer = alias(users, 'trainer');

/** Columns for one member with their account, plan and trainer. */
export const memberColumns = {
  memberId: members.userId,
  code: members.code,
  name: users.name,
  phone: users.phone,
  active: users.active,
  planId: plans.id,
  planName: plans.name,
  planTiming: plans.timing,
  feePkr: plans.feePkr,
  planMonths: plans.months,
  dueOn: members.dueOn,
  frozenUntil: members.frozenUntil,
  joinedOn: members.joinedOn,
  trainerId: members.trainerId,
  trainerName: trainer.name,
  goal: members.goal,
  gender: members.gender,
  emergencyContact: members.emergencyContact,
  fingerprintId: members.fingerprintId,
  notes: members.notes,
};

export interface MemberRow {
  memberId: string;
  code: string;
  name: string;
  phone: string;
  active: boolean;
  planId: string;
  planName: string;
  planTiming: string | null;
  feePkr: number;
  planMonths: number;
  dueOn: string;
  frozenUntil: string | null;
  joinedOn: string;
  trainerId: string | null;
  trainerName: string | null;
  goal: Goal | null;
  gender: Gender | null;
  emergencyContact: string | null;
  fingerprintId: string | null;
  notes: string | null;
}

/** Members of one gym (every query is scoped to the gym, §11). */
export async function selectMembers(db: Executor, gymId: string, where?: SQL): Promise<MemberRow[]> {
  const rows = await db
    .select(memberColumns)
    .from(members)
    .innerJoin(users, and(eq(users.gymId, members.gymId), eq(users.id, members.userId)))
    .innerJoin(plans, and(eq(plans.gymId, members.gymId), eq(plans.id, members.planId)))
    .leftJoin(trainer, and(eq(trainer.gymId, members.gymId), eq(trainer.id, members.trainerId)))
    .where(where ? and(eq(members.gymId, gymId), where) : eq(members.gymId, gymId));
  return rows as MemberRow[];
}

export function toListItem(m: MemberRow, today: string): MemberListItem {
  return {
    memberId: m.memberId,
    code: m.code,
    name: m.name,
    phone: m.phone,
    planId: m.planId,
    planName: m.planName,
    planTiming: m.planTiming,
    feePkr: m.feePkr,
    dueOn: m.dueOn,
    frozenUntil: m.frozenUntil,
    status: membershipStatus(m.dueOn, m.frozenUntil, today),
    active: m.active,
    trainerId: m.trainerId,
    trainerName: m.trainerName,
  };
}

export function toScanMember(m: MemberRow, today: string): ScanMember {
  return {
    memberId: m.memberId,
    code: m.code,
    name: m.name,
    phone: m.phone,
    planName: m.planTiming ? `${m.planName} · ${m.planTiming}` : m.planName,
    planId: m.planId,
    feePkr: m.feePkr,
    dueOn: m.dueOn,
    frozenUntil: m.frozenUntil,
    status: membershipStatus(m.dueOn, m.frozenUntil, today),
  };
}
