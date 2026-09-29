import { createHarness, type Agent, type Harness } from './app-harness';
import { weekdayFromNow, workingDayRange } from './fixtures';

/**
 * =============================================================================
 * LEAVE REQUESTS — validation, balances, and the whole lifecycle
 *
 * The arithmetic here is derived, never stored: used, pending and remaining
 * are summed from the requests themselves on every read. That is what makes
 * cancelling free the days automatically, and it is exactly the kind of thing
 * that breaks silently when someone adds a status or an early return.
 *
 * Every date is relative to today, because validation depends on today —
 * minimum notice, and whether leave has already started. Hard-coded dates
 * would make this suite pass in September and fail in December.
 * =============================================================================
 */

const yearOf = (date: string) => Number(date.slice(0, 4));

describe('Leave requests (integration)', () => {
  let h: Harness;
  let zara: Agent;
  let omar: Agent;
  let hr: Agent;

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    await h.reset();
    [zara, omar, hr] = await Promise.all([
      h.login(h.world.emails.zara),
      h.login(h.world.emails.omar),
      h.login(h.world.emails.sana),
    ]);
  });

  /** One person's balance for one leave type, in the year that date falls in. */
  async function balance(agent: Agent, code: string, year: number) {
    const { body } = await agent.get(`/api/leave/balances?year=${year}`).expect(200);
    const found = (body.balances as Array<{ code: string }>).find((b) => b.code === code);
    if (!found) throw new Error(`No ${code} balance in the response`);
    return found as unknown as {
      entitledDays: number;
      usedDays: number;
      pendingDays: number;
      remainingDays: number;
      requiresBalance: boolean;
    };
  }

  function submit(
    agent: Agent,
    leaveTypeId: string,
    range: { startDate: string; endDate: string },
    reason = 'Time off',
  ) {
    return agent.post('/api/leave/requests').send({ leaveTypeId, ...range, reason });
  }

  // ---------------------------------------------------------------------------
  describe('validation', () => {
    it('rejects an end date before the start date', async () => {
      const { body } = await submit(zara, h.world.leaveTypes.annual, {
        startDate: weekdayFromNow(20),
        endDate: weekdayFromNow(10),
      }).expect(400);

      expect(body.message).toMatch(/end date cannot be before/i);
    });

    it('rejects a range that is entirely a weekend', async () => {
      // Find the next Saturday, and ask for Saturday to Sunday.
      const saturday = new Date();
      saturday.setUTCHours(0, 0, 0, 0);
      saturday.setUTCDate(saturday.getUTCDate() + 10);
      while (saturday.getUTCDay() !== 6) saturday.setUTCDate(saturday.getUTCDate() + 1);
      const sunday = new Date(saturday);
      sunday.setUTCDate(sunday.getUTCDate() + 1);

      const { body } = await submit(zara, h.world.leaveTypes.annual, {
        startDate: saturday.toISOString().slice(0, 10),
        endDate: sunday.toISOString().slice(0, 10),
      }).expect(400);

      expect(body.message).toMatch(/no working days/i);
    });

    it('enforces the minimum notice period from the policy', async () => {
      // Annual Leave requires 2 days' notice; tomorrow is too soon.
      const tomorrow = new Date();
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

      const { body } = await submit(zara, h.world.leaveTypes.annual, {
        startDate: tomorrow.toISOString().slice(0, 10),
        endDate: tomorrow.toISOString().slice(0, 10),
      }).expect(400);

      expect(body.message).toMatch(/2 days of notice/i);
    });

    it('allows a same-day request for a type with no notice period', async () => {
      // Sick Leave has minNoticeDays 0 — you cannot give notice of falling ill.
      const soon = weekdayFromNow(1);
      await submit(
        zara,
        h.world.leaveTypes.sick,
        { startDate: soon, endDate: soon },
        'Unwell',
      ).expect(201);
    });

    it('rejects a request larger than the remaining balance', async () => {
      // Annual Leave is 6 days; 10 working days cannot fit.
      const range = workingDayRange(30, 10);
      const { body } = await submit(zara, h.world.leaveTypes.annual, range).expect(400);

      expect(body.message).toMatch(/not enough annual leave/i);
    });

    it('rejects dates that overlap an existing request', async () => {
      const first = workingDayRange(30, 3);
      await submit(zara, h.world.leaveTypes.annual, first).expect(201);

      // Start on the second day of the approved block.
      const overlapStart = new Date(`${first.startDate}T00:00:00.000Z`);
      overlapStart.setUTCDate(overlapStart.getUTCDate() + 1);

      const { body } = await submit(zara, h.world.leaveTypes.sick, {
        startDate: overlapStart.toISOString().slice(0, 10),
        endDate: first.endDate,
      }).expect(409);

      expect(body.message).toMatch(/overlaps an existing pending request/i);
    });

    it('rejects a reason that is too short', async () => {
      await zara
        .post('/api/leave/requests')
        .send({ leaveTypeId: h.world.leaveTypes.annual, ...workingDayRange(30, 1), reason: 'x' })
        .expect(400);
    });
  });

  // ---------------------------------------------------------------------------
  describe('unpaid leave', () => {
    it('can be taken with no entitlement and is approved automatically', async () => {
      const range = workingDayRange(40, 5);
      const { body } = await submit(zara, h.world.leaveTypes.unpaid, range, 'Unpaid break').expect(
        201,
      );

      // requiresBalance is false, so the balance check is skipped entirely…
      expect(body.status).toBe('APPROVED');
      // …and approvalRequired is false, so nobody had to agree.
      expect(body.autoApproved).toBe(true);
      expect(body.decisionComment).toMatch(/does not require approval/i);
      // Distinct from "a person approved it": nobody decided this.
      expect(body.decidedById).toBeNull();
    });

    it('shows as needing no balance on the balances screen', async () => {
      const unpaid = await balance(zara, 'UNPAID', h.world.year);
      expect(unpaid.requiresBalance).toBe(false);
      expect(unpaid.entitledDays).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  describe('balance arithmetic across a request lifecycle', () => {
    it('reserves days while pending, spends them on approval, and frees them on cancel', async () => {
      const range = workingDayRange(30, 3);
      const year = yearOf(range.startDate);

      const start = await balance(zara, 'ANNUAL', year);
      expect(start).toMatchObject({
        entitledDays: 6,
        usedDays: 0,
        pendingDays: 0,
        remainingDays: 6,
      });

      // --- submitted: reserved, not yet spent --------------------------------
      const { body: request } = await submit(zara, h.world.leaveTypes.annual, range).expect(201);
      expect(request.days).toBe(3);
      expect(request.status).toBe('PENDING');

      const pending = await balance(zara, 'ANNUAL', year);
      expect(pending).toMatchObject({ usedDays: 0, pendingDays: 3, remainingDays: 3 });

      // --- approved: spent ----------------------------------------------------
      await omar
        .post(`/api/leave/requests/${request.id}/approve`)
        .send({ comment: 'Enjoy.' })
        .expect(201);

      const approved = await balance(zara, 'ANNUAL', year);
      expect(approved).toMatchObject({ usedDays: 3, pendingDays: 0, remainingDays: 3 });

      // --- cancelled: given back, with nothing to un-deduct -------------------
      await zara.post(`/api/leave/requests/${request.id}/cancel`).expect(201);

      const cancelled = await balance(zara, 'ANNUAL', year);
      expect(cancelled).toMatchObject({ usedDays: 0, pendingDays: 0, remainingDays: 6 });
    });

    it('does not consume balance when a request is rejected', async () => {
      const range = workingDayRange(30, 2);
      const year = yearOf(range.startDate);

      const { body: request } = await submit(zara, h.world.leaveTypes.annual, range).expect(201);
      expect((await balance(zara, 'ANNUAL', year)).remainingDays).toBe(4);

      await omar
        .post(`/api/leave/requests/${request.id}/reject`)
        .send({ comment: 'Two people are already off that week.' })
        .expect(201);

      const after = await balance(zara, 'ANNUAL', year);
      expect(after).toMatchObject({ usedDays: 0, pendingDays: 0, remainingDays: 6 });
    });

    it('counts several pending requests together when checking what is left', async () => {
      // Without this, ten requests for the same days would each pass on their own.
      const year = yearOf(workingDayRange(30, 1).startDate);

      await submit(zara, h.world.leaveTypes.annual, workingDayRange(30, 3)).expect(201);
      await submit(zara, h.world.leaveTypes.annual, workingDayRange(50, 2)).expect(201);
      expect((await balance(zara, 'ANNUAL', year)).remainingDays).toBe(1);

      const { body } = await submit(zara, h.world.leaveTypes.annual, workingDayRange(70, 2)).expect(
        400,
      );
      expect(body.message).toMatch(/only 1 remains/i);
    });

    it('applies an HR override instead of the policy figure', async () => {
      const year = h.world.year;
      await hr
        .post('/api/leave/balances')
        .send({
          employeeId: h.world.employees.zara,
          leaveTypeId: h.world.leaveTypes.annual,
          year,
          entitlementOverrideDays: 15,
          carriedForwardDays: 2,
          notes: 'Negotiated contract.',
        })
        .expect(201);

      const overridden = await balance(zara, 'ANNUAL', year);
      expect(overridden.entitledDays).toBe(15);
      expect(overridden.remainingDays).toBe(17); // 15 entitled + 2 carried forward
    });
  });

  // ---------------------------------------------------------------------------
  describe('approval', () => {
    it('routes to the employee’s current manager', async () => {
      const { body } = await submit(zara, h.world.leaveTypes.annual, workingDayRange(30, 2)).expect(
        201,
      );

      expect(body.approver.id).toBe(h.world.employees.omar);
      expect(body.routing).toMatchObject({ source: 'MANAGER' });
    });

    it('lets that manager approve, and records who decided', async () => {
      const { body: request } = await submit(
        zara,
        h.world.leaveTypes.annual,
        workingDayRange(30, 2),
      ).expect(201);

      const { body: approved } = await omar
        .post(`/api/leave/requests/${request.id}/approve`)
        .send({ comment: 'Approved.' })
        .expect(201);

      expect(approved.status).toBe('APPROVED');
      expect(approved.decidedBy.id).toBe(h.world.employees.omar);
      expect(approved.autoApproved).toBe(false);
      expect(approved.decisionComment).toBe('Approved.');
    });

    it('keeps the rejection comment on the record', async () => {
      const { body: request } = await submit(
        zara,
        h.world.leaveTypes.annual,
        workingDayRange(30, 2),
      ).expect(201);

      const { body: rejected } = await omar
        .post(`/api/leave/requests/${request.id}/reject`)
        .send({ comment: 'Please provide a medical note.' })
        .expect(201);

      expect(rejected.status).toBe('REJECTED');
      expect(rejected.decisionComment).toBe('Please provide a medical note.');
    });

    it('blocks a manager from approving their OWN request', async () => {
      // Not a permission problem: a manager holds approve at TEAM scope, and
      // TEAM includes themselves. Only an explicit check stops this.
      const { body: own } = await submit(
        omar,
        h.world.leaveTypes.annual,
        workingDayRange(30, 2),
      ).expect(201);

      const { body } = await omar
        .post(`/api/leave/requests/${own.id}/approve`)
        .send({})
        .expect(403);
      expect(body.message).toMatch(/cannot approve or reject your own/i);
    });

    it('blocks a manager from approving someone outside their team', async () => {
      const bilal = await h.login(h.world.emails.bilal);
      const { body: request } = await submit(
        zara,
        h.world.leaveTypes.annual,
        workingDayRange(30, 2),
      ).expect(201);

      // Bilal is a manager, but not Zara's, and TEAM scope does not reach her.
      const { body } = await bilal
        .post(`/api/leave/requests/${request.id}/approve`)
        .send({})
        .expect(403);
      expect(body.message).toMatch(/not routed to you/i);
    });

    it('lets HR decide a request that is not theirs, at GLOBAL scope', async () => {
      const { body: request } = await submit(
        zara,
        h.world.leaveTypes.annual,
        workingDayRange(30, 2),
      ).expect(201);

      await hr.post(`/api/leave/requests/${request.id}/approve`).send({}).expect(201);
    });

    it('refuses to decide a request twice', async () => {
      const { body: request } = await submit(
        zara,
        h.world.leaveTypes.annual,
        workingDayRange(30, 2),
      ).expect(201);

      await omar.post(`/api/leave/requests/${request.id}/approve`).send({}).expect(201);
      const { body } = await omar
        .post(`/api/leave/requests/${request.id}/reject`)
        .send({})
        .expect(409);
      expect(body.message).toMatch(/already been approved/i);
    });

    it('re-routes a pending request when the reporting line changes', async () => {
      const { body: request } = await submit(
        zara,
        h.world.leaveTypes.annual,
        workingDayRange(30, 2),
      ).expect(201);
      expect(request.approver.id).toBe(h.world.employees.omar);

      // Zara now reports to Bilal. The approver is read live from the open
      // assignment, so Bilal can act immediately and Omar can no longer.
      await h.prisma.employmentAssignment.updateMany({
        where: { employeeId: h.world.employees.zara, effectiveTo: null },
        data: { managerId: h.world.employees.bilal },
      });
      await h.prisma.employee.update({
        where: { id: h.world.employees.zara },
        data: { managerId: h.world.employees.bilal },
      });

      const bilal = await h.login(h.world.emails.bilal);
      await bilal.post(`/api/leave/requests/${request.id}/approve`).send({}).expect(201);
    });
  });

  // ---------------------------------------------------------------------------
  describe('manager edge cases', () => {
    it('leaves a request PENDING and explains itself when nobody can approve it', async () => {
      // Nadia has no manager, and her department has no head.
      const nadia = await h.login(h.world.emails.nadia);
      const { body } = await submit(
        nadia,
        h.world.leaveTypes.annual,
        workingDayRange(30, 2),
      ).expect(201);

      // ⚠️ NOT auto-approved. Nobody agreed to this.
      expect(body.status).toBe('PENDING');
      expect(body.approverId).toBeNull();
      expect(body.routing.source).toBe('NONE');
      expect(body.routing.note).toMatch(/no manager and no department head/i);
    });

    it('skips a manager who has left and falls back to the department head', async () => {
      // Make Omar the head of Mobile Engineering, then terminate Bilal — who
      // is Omar's manager. Omar's own request should route to… nobody sensible
      // above him, so use Zara instead: terminate Omar and make Bilal the head.
      await h.prisma.department.update({
        where: { id: h.world.departments.mobile },
        data: { headEmployeeId: h.world.employees.bilal },
      });
      await h.prisma.employee.update({
        where: { id: h.world.employees.omar },
        data: { status: 'TERMINATED' },
      });

      const { body } = await submit(zara, h.world.leaveTypes.annual, workingDayRange(30, 2)).expect(
        201,
      );

      expect(body.routing.source).toBe('DEPARTMENT_HEAD');
      expect(body.approver.id).toBe(h.world.employees.bilal);
    });

    it('skips a manager whose record has been archived', async () => {
      await h.prisma.department.update({
        where: { id: h.world.departments.mobile },
        data: { headEmployeeId: h.world.employees.bilal },
      });
      await h.prisma.employee.update({
        where: { id: h.world.employees.omar },
        data: { deletedAt: new Date() },
      });

      const { body } = await submit(zara, h.world.leaveTypes.annual, workingDayRange(30, 2)).expect(
        201,
      );

      expect(body.approver.id).toBe(h.world.employees.bilal);
    });
  });

  // ---------------------------------------------------------------------------
  describe('cancellation', () => {
    it('allows an employee to withdraw a pending request', async () => {
      const { body: request } = await submit(
        zara,
        h.world.leaveTypes.annual,
        workingDayRange(30, 2),
      ).expect(201);

      const { body } = await zara.post(`/api/leave/requests/${request.id}/cancel`).expect(201);
      expect(body.status).toBe('CANCELLED');
      expect(body.cancelledAt).not.toBeNull();
    });

    it('refuses to cancel a rejected request', async () => {
      const { body: request } = await submit(
        zara,
        h.world.leaveTypes.annual,
        workingDayRange(30, 2),
      ).expect(201);
      await omar.post(`/api/leave/requests/${request.id}/reject`).send({}).expect(201);

      const { body } = await zara.post(`/api/leave/requests/${request.id}/cancel`).expect(409);
      expect(body.message).toMatch(/rejected request cannot be cancelled/i);
    });

    it('refuses to cancel approved leave that has already started', async () => {
      // Written straight to the database: the API will not accept a start date
      // in the past, and that is the point — this is a state that can only
      // arise through the passage of time.
      const started = new Date();
      started.setUTCDate(started.getUTCDate() - 2);
      const ends = new Date();
      ends.setUTCDate(ends.getUTCDate() + 2);

      const request = await h.prisma.leaveRequest.create({
        data: {
          employeeId: h.world.employees.zara,
          leaveTypeId: h.world.leaveTypes.annual,
          startDate: new Date(started.toISOString().slice(0, 10)),
          endDate: new Date(ends.toISOString().slice(0, 10)),
          days: 2,
          reason: 'Already begun',
          status: 'APPROVED',
        },
      });

      const { body } = await zara.post(`/api/leave/requests/${request.id}/cancel`).expect(409);
      expect(body.message).toMatch(/already started/i);
    });

    it('refuses to cancel the same request twice', async () => {
      const { body: request } = await submit(
        zara,
        h.world.leaveTypes.annual,
        workingDayRange(30, 2),
      ).expect(201);

      await zara.post(`/api/leave/requests/${request.id}/cancel`).expect(201);
      await zara.post(`/api/leave/requests/${request.id}/cancel`).expect(409);
    });
  });

  // ---------------------------------------------------------------------------
  describe('the working-day count shown before submitting', () => {
    it('comes from the API, so the preview and the stored figure cannot disagree', async () => {
      const range = workingDayRange(30, 3);
      const { body: preview } = await zara
        .get(`/api/leave/working-days?startDate=${range.startDate}&endDate=${range.endDate}`)
        .expect(200);

      expect(preview.days).toBe(3);

      const { body: request } = await submit(zara, h.world.leaveTypes.annual, range).expect(201);
      expect(request.days).toBe(preview.days);
    });

    it('reports an impossible range rather than guessing', async () => {
      const { body } = await zara
        .get(
          `/api/leave/working-days?startDate=${weekdayFromNow(30)}&endDate=${weekdayFromNow(10)}`,
        )
        .expect(200);

      expect(body.valid).toBe(false);
      expect(body.days).toBe(0);
    });
  });
});
