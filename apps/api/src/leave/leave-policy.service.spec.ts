import { ProrationMethod } from '@prisma/client';

import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';
import { LeavePolicyService } from './leave-policy.service';

/**
 * =============================================================================
 * THE PRORATION ARITHMETIC
 *
 * This is the calculation most likely to be quietly wrong, and the one nobody
 * would notice for months: when HR changes a quota mid-year, each policy
 * period contributes in proportion to how much of the year it covers.
 *
 *   contribution = quotaDays × (days the policy covers in the year ÷ days in year)
 *
 * The maths only needs two reads from the database, so it is tested here
 * against a hand-written stub rather than a real Postgres — instant, and
 * every awkward date arrangement is one object literal away. The lookups
 * themselves are covered by the integration tests.
 * =============================================================================
 */

interface StubPolicy {
  id: string;
  quotaDays: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

function serviceWith(
  policies: StubPolicy[],
  method: ProrationMethod = ProrationMethod.PRORATED_BY_DAYS,
) {
  const prisma = {
    leaveType: {
      findUnique: jest.fn().mockResolvedValue({ id: 'type-1', prorationMethod: method }),
    },
    leaveTypePolicy: {
      // calculateEntitlement asks for policies overlapping the year; the
      // caller's own filtering is what the integration tests check, so the
      // stub just returns what the test set up, ordered as Prisma would.
      findMany: jest
        .fn()
        .mockResolvedValue(
          [...policies].sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime()),
        ),
    },
  } as unknown as PrismaService;

  const audit = { record: jest.fn() } as unknown as AuditService;
  return new LeavePolicyService(prisma, audit);
}

const jan = (year: number) => new Date(Date.UTC(year, 0, 1));
const dec = (year: number) => new Date(Date.UTC(year, 11, 31));
const on = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('LeavePolicyService.calculateEntitlement', () => {
  it('gives the full quota when one policy covers the whole year', () => {
    // The ordinary case, and the one the required structure produces:
    // Annual Leave 6 days, effective 1 January, never changed.
    return serviceWith([{ id: 'p1', quotaDays: 6, effectiveFrom: jan(2026), effectiveTo: null }])
      .calculateEntitlement('type-1', 2026)
      .then((result) => {
        expect(result.entitledDays).toBe(6);
        expect(result.breakdown).toHaveLength(1);
        expect(result.breakdown[0].daysInPeriod).toBe(365);
      });
  });

  it('prorates a mid-year quota change by the days each policy covers', async () => {
    // The worked example from PROJECT_NOTES §10: 8 days until 30 June, 6 days
    // from 1 July.
    //   8 × 181/365 = 3.97
    //   6 × 184/365 = 3.02
    //                 ----
    //                 6.99
    const result = await serviceWith([
      { id: 'p1', quotaDays: 8, effectiveFrom: jan(2026), effectiveTo: on('2026-06-30') },
      { id: 'p2', quotaDays: 6, effectiveFrom: on('2026-07-01'), effectiveTo: null },
    ]).calculateEntitlement('type-1', 2026);

    expect(result.breakdown[0]).toMatchObject({ daysInPeriod: 181, contribution: 3.97 });
    expect(result.breakdown[1]).toMatchObject({ daysInPeriod: 184, contribution: 3.02 });
    expect(result.entitledDays).toBe(6.99);
  });

  it('clips a policy that started before the year to 1 January', async () => {
    // A policy running since 2024 contributes a full 2026, not 700-odd days.
    const result = await serviceWith([
      { id: 'p1', quotaDays: 6, effectiveFrom: jan(2024), effectiveTo: null },
    ]).calculateEntitlement('type-1', 2026);

    expect(result.breakdown[0].from).toBe('2026-01-01');
    expect(result.breakdown[0].daysInPeriod).toBe(365);
    expect(result.entitledDays).toBe(6);
  });

  it('clips an open-ended policy to 31 December', async () => {
    const result = await serviceWith([
      { id: 'p1', quotaDays: 6, effectiveFrom: on('2026-07-01'), effectiveTo: null },
    ]).calculateEntitlement('type-1', 2026);

    expect(result.breakdown[0].to).toBe('2026-12-31');
    expect(result.breakdown[0].daysInPeriod).toBe(184);
  });

  it('divides by 366 in a leap year', async () => {
    // 2028 is a leap year. A whole-year policy still gives exactly the quota;
    // getting the divisor wrong would show up as 6.02.
    const result = await serviceWith([
      { id: 'p1', quotaDays: 6, effectiveFrom: jan(2028), effectiveTo: dec(2028) },
    ]).calculateEntitlement('type-1', 2028);

    expect(result.breakdown[0].daysInPeriod).toBe(366);
    expect(result.entitledDays).toBe(6);
  });

  it('handles three periods in one year', async () => {
    const result = await serviceWith([
      { id: 'p1', quotaDays: 12, effectiveFrom: jan(2026), effectiveTo: on('2026-04-30') },
      { id: 'p2', quotaDays: 6, effectiveFrom: on('2026-05-01'), effectiveTo: on('2026-08-31') },
      { id: 'p3', quotaDays: 9, effectiveFrom: on('2026-09-01'), effectiveTo: null },
    ]).calculateEntitlement('type-1', 2026);

    expect(result.breakdown).toHaveLength(3);
    const summed = result.breakdown.reduce((total, row) => total + row.contribution, 0);
    expect(result.entitledDays).toBeCloseTo(summed, 2);
  });

  it('applies the latest quota to the whole year under LATEST_POLICY_IN_YEAR', async () => {
    // The alternative method: a mid-year cut reduces the year retroactively.
    // Some companies do work this way, which is why it is configurable per
    // leave type rather than hardcoded.
    const result = await serviceWith(
      [
        { id: 'p1', quotaDays: 8, effectiveFrom: jan(2026), effectiveTo: on('2026-06-30') },
        { id: 'p2', quotaDays: 6, effectiveFrom: on('2026-07-01'), effectiveTo: null },
      ],
      ProrationMethod.LATEST_POLICY_IN_YEAR,
    ).calculateEntitlement('type-1', 2026);

    expect(result.entitledDays).toBe(6);
    expect(result.method).toBe(ProrationMethod.LATEST_POLICY_IN_YEAR);
  });

  it('returns 0 with an empty breakdown when no policy covers the year', async () => {
    // A leave type created this year has no policy for last year. Callers must
    // see zero rather than a crash or an invented default.
    const result = await serviceWith([]).calculateEntitlement('type-1', 2020);

    expect(result.entitledDays).toBe(0);
    expect(result.breakdown).toEqual([]);
  });

  it('gives an unpaid type with a zero quota an entitlement of zero', async () => {
    const result = await serviceWith([
      { id: 'p1', quotaDays: 0, effectiveFrom: jan(2026), effectiveTo: null },
    ]).calculateEntitlement('type-1', 2026);

    expect(result.entitledDays).toBe(0);
  });
});
