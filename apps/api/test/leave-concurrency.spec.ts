import { createHarness, type Harness } from './app-harness';
import { workingDayRange } from './fixtures';

/**
 * =============================================================================
 * CONCURRENT SUBMISSIONS
 *
 * The scenario: someone with 2 days left submits two 2-day requests at the
 * same instant — a double-clicked button, two browser tabs, a retried request.
 *
 * Read-then-write is never safe on its own. Both submissions read "2 days
 * remaining", both pass validation, both are written, and 4 days come out of a
 * 2-day balance. The fix is a `SELECT … FOR UPDATE` on the employee's own row
 * inside the submission transaction, so the second one waits and then sees the
 * first.
 *
 * ⚠️ THIS TEST IS THE ONLY THING THAT PROVES THE LOCK IS THERE. Nothing about
 * the code reads as wrong without it; the bug only appears under simultaneous
 * load, which is exactly when nobody is watching.
 * =============================================================================
 */
describe('Concurrent leave submissions (integration)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    await h.reset();
  });

  /** Leaves Zara with exactly `days` of Annual Leave. */
  async function setRemaining(days: number) {
    await h.prisma.leaveBalance.create({
      data: {
        employeeId: h.world.employees.zara,
        leaveTypeId: h.world.leaveTypes.annual,
        year: h.world.year,
        entitlementOverrideDays: days,
      },
    });
  }

  it('does not let two simultaneous requests spend the same days', async () => {
    await setRemaining(2);

    // Two sessions, as two tabs would be. Non-overlapping DATES, so the only
    // thing that can stop the second one is the balance check.
    const [tabA, tabB] = await Promise.all([
      h.login(h.world.emails.zara),
      h.login(h.world.emails.zara),
    ]);

    const [first, second] = await Promise.all([
      tabA.post('/api/leave/requests').send({
        leaveTypeId: h.world.leaveTypes.annual,
        ...workingDayRange(30, 2),
        reason: 'Tab one',
      }),
      tabB.post('/api/leave/requests').send({
        leaveTypeId: h.world.leaveTypes.annual,
        ...workingDayRange(60, 2),
        reason: 'Tab two',
      }),
    ]);

    const statuses = [first.status, second.status].sort();
    // Exactly one succeeds. Which one is a race; that both cannot is not.
    expect(statuses).toEqual([201, 400]);

    const refused = first.status === 400 ? first : second;
    expect(refused.body.message).toMatch(/not enough annual leave/i);

    // The database agrees: two days spent, not four.
    const stored = await h.prisma.leaveRequest.findMany({
      where: { employeeId: h.world.employees.zara, status: { in: ['PENDING', 'APPROVED'] } },
    });
    expect(stored).toHaveLength(1);

    const { body } = await tabA.get(`/api/leave/balances?year=${h.world.year}`).expect(200);
    const annual = (body.balances as Array<{ code: string; remainingDays: number }>).find(
      (b) => b.code === 'ANNUAL',
    );
    expect(annual!.remainingDays).toBe(0);
  });

  it('holds under a burst of five simultaneous submissions', async () => {
    // Four days of entitlement, five two-day requests. Two must get through;
    // three must not.
    await setRemaining(4);

    const agents = await Promise.all(Array.from({ length: 5 }, () => h.login(h.world.emails.zara)));

    const responses = await Promise.all(
      agents.map((agent, index) =>
        agent.post('/api/leave/requests').send({
          leaveTypeId: h.world.leaveTypes.annual,
          // Spread the dates well apart so overlap never does the rejecting
          // for us — the balance check has to be what holds.
          ...workingDayRange(20 + index * 15, 2),
          reason: `Burst ${index}`,
        }),
      ),
    );

    const accepted = responses.filter((r) => r.status === 201);
    expect(accepted).toHaveLength(2);

    const stored = await h.prisma.leaveRequest.aggregate({
      where: { employeeId: h.world.employees.zara, status: { in: ['PENDING', 'APPROVED'] } },
      _sum: { days: true },
    });
    // Never more than the entitlement, whatever the interleaving.
    expect(Number(stored._sum.days)).toBe(4);
  });

  it('still rejects an exact duplicate submitted twice at once', async () => {
    // Same dates, sent twice. Here the overlap check is what must hold, and it
    // is inside the same lock as the balance check.
    const [tabA, tabB] = await Promise.all([
      h.login(h.world.emails.zara),
      h.login(h.world.emails.zara),
    ]);
    const range = workingDayRange(30, 2);

    const responses = await Promise.all([
      tabA
        .post('/api/leave/requests')
        .send({ leaveTypeId: h.world.leaveTypes.annual, ...range, reason: 'Double click' }),
      tabB
        .post('/api/leave/requests')
        .send({ leaveTypeId: h.world.leaveTypes.annual, ...range, reason: 'Double click' }),
    ]);

    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(1);

    const stored = await h.prisma.leaveRequest.count({
      where: { employeeId: h.world.employees.zara },
    });
    expect(stored).toBe(1);
  });

  it('does not make one person’s submissions block another’s', async () => {
    // The lock is per employee, so Zara and Hassan never queue behind each
    // other. If this ever fails, someone has widened the lock to a table.
    const [zara, hassan] = await Promise.all([
      h.login(h.world.emails.zara),
      h.login(h.world.emails.hassan),
    ]);

    const responses = await Promise.all([
      zara.post('/api/leave/requests').send({
        leaveTypeId: h.world.leaveTypes.annual,
        ...workingDayRange(30, 2),
        reason: 'Zara',
      }),
      hassan.post('/api/leave/requests').send({
        leaveTypeId: h.world.leaveTypes.annual,
        ...workingDayRange(30, 2),
        reason: 'Hassan',
      }),
    ]);

    expect(responses.map((r) => r.status)).toEqual([201, 201]);
  });
});
