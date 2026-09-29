import request from 'supertest';
import type { App } from 'supertest/types';

import { createHarness, type Agent, type Harness } from './app-harness';
import { workingDayRange } from './fixtures';

/**
 * =============================================================================
 * PERMISSION SCOPES
 *
 * `PermissionScope` is the single most important design decision in this
 * codebase: "can read leave requests" is not one permission, it is four. HR
 * reads everyone, a manager reads their reports, an employee reads themselves.
 *
 * These tests run against the SHIPPED grants — prisma/seed-data.ts, imported by
 * the fixture — so widening a scope by accident breaks a test here rather than
 * leaking somebody's data in production.
 * =============================================================================
 */
describe('Leave permissions (integration)', () => {
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

  // ---------------------------------------------------------------------------
  describe('authentication', () => {
    it('refuses every leave endpoint without a session', async () => {
      const anonymous = request(h.app.getHttpServer() as App);

      await anonymous.get('/api/leave/types').expect(401);
      await anonymous.get('/api/leave/balances').expect(401);
      await anonymous.get('/api/leave/requests').expect(401);
      await anonymous.get('/api/notifications').expect(401);
    });
  });

  // ---------------------------------------------------------------------------
  describe('who can see which leave requests', () => {
    beforeEach(async () => {
      // One request each from Zara and Hassan — both report to Omar.
      const hassan = await h.login(h.world.emails.hassan);
      await zara
        .post('/api/leave/requests')
        .send({
          leaveTypeId: h.world.leaveTypes.annual,
          ...workingDayRange(30, 2),
          reason: 'Zara time off',
        })
        .expect(201);
      await hassan
        .post('/api/leave/requests')
        .send({
          leaveTypeId: h.world.leaveTypes.annual,
          ...workingDayRange(30, 2),
          reason: 'Hassan time off',
        })
        .expect(201);
    });

    it('shows an employee only their own', async () => {
      const { body } = await zara.get('/api/leave/requests?pageSize=100').expect(200);

      expect(body.scope).toBe('SELF');
      expect(body.total).toBe(1);
      expect(body.items[0].employee.id).toBe(h.world.employees.zara);
    });

    it('shows a manager their direct reports, and themselves', async () => {
      const { body } = await omar.get('/api/leave/requests?pageSize=100').expect(200);

      expect(body.scope).toBe('TEAM');
      const seen = new Set(
        (body.items as Array<{ employee: { id: string } }>).map((i) => i.employee.id),
      );
      expect(seen).toContain(h.world.employees.zara);
      expect(seen).toContain(h.world.employees.hassan);
    });

    it('shows HR everybody', async () => {
      const { body } = await hr.get('/api/leave/requests?pageSize=100').expect(200);

      expect(body.scope).toBe('GLOBAL');
      expect(body.total).toBe(2);
    });

    it('404s rather than 403s when an employee probes someone else’s request', async () => {
      // 404, not 403, on purpose: a 403 would confirm the id exists and let
      // somebody enumerate records they cannot read.
      const { body: all } = await hr.get('/api/leave/requests?pageSize=100').expect(200);
      const hassansRequest = (all.items as Array<{ id: string; employee: { id: string } }>).find(
        (item) => item.employee.id === h.world.employees.hassan,
      );

      await zara.get(`/api/leave/requests/${hassansRequest!.id}`).expect(404);
    });

    it('does not widen a manager’s view through a crafted query string', async () => {
      // The scope filter is ANDed with whatever the caller asks for, so naming
      // someone outside your scope returns nothing rather than their data.
      const { body } = await omar
        .get(`/api/leave/requests?employeeId=${h.world.employees.sana}&pageSize=100`)
        .expect(200);

      expect(body.total).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  describe('who can see which balances', () => {
    it('lets an employee see their own without naming themselves', async () => {
      const { body } = await zara.get('/api/leave/balances').expect(200);
      expect(body.employeeId).toBe(h.world.employees.zara);
    });

    it('stops an employee reading a colleague’s balance', async () => {
      await zara.get(`/api/leave/balances?employeeId=${h.world.employees.hassan}`).expect(404);
    });

    it('lets a manager read a direct report’s balance', async () => {
      await omar.get(`/api/leave/balances?employeeId=${h.world.employees.zara}`).expect(200);
    });

    it('stops a manager reading someone outside their team', async () => {
      await omar.get(`/api/leave/balances?employeeId=${h.world.employees.sana}`).expect(404);
    });
  });

  // ---------------------------------------------------------------------------
  describe('policy administration is HR-only', () => {
    it('refuses an employee even READING policy history', async () => {
      await zara.get(`/api/leave/types/${h.world.leaveTypes.annual}/policies`).expect(403);
      await zara
        .get(`/api/leave/types/${h.world.leaveTypes.annual}/policy-on?date=${h.world.year}-03-15`)
        .expect(403);
    });

    it('refuses a MANAGER too — this is not a seniority thing', async () => {
      // A manager holds leave_request:approve at TEAM scope but no
      // leave_policy permission at any scope. Deciding your team's leave and
      // changing company policy are different powers.
      await omar.get(`/api/leave/types/${h.world.leaveTypes.annual}/policies`).expect(403);

      await omar
        .post(`/api/leave/types/${h.world.leaveTypes.annual}/policies`)
        .send({
          quotaDays: 99,
          approvalRequired: false,
          carryForwardEnabled: false,
          minNoticeDays: 0,
          effectiveFrom: `${h.world.year}-11-01`,
        })
        .expect(403);

      await omar
        .post('/api/leave/types')
        .send({ code: 'SNEAKY', name: 'Sneaky', quotaDays: 50 })
        .expect(403);
      await omar
        .patch(`/api/leave/types/${h.world.leaveTypes.annual}`)
        .send({ name: 'Nope' })
        .expect(403);
      await omar.post(`/api/leave/types/${h.world.leaveTypes.annual}/archive`).expect(403);
    });

    it('refuses an employee setting their own entitlement', async () => {
      await zara
        .post('/api/leave/balances')
        .send({
          employeeId: h.world.employees.zara,
          leaveTypeId: h.world.leaveTypes.annual,
          year: h.world.year,
          entitlementOverrideDays: 99,
        })
        .expect(403);
    });

    it('lets HR do all of it', async () => {
      await hr.get(`/api/leave/types/${h.world.leaveTypes.annual}/policies`).expect(200);
      await hr
        .post('/api/leave/types')
        .send({ code: 'FINE', name: 'Fine', quotaDays: 3 })
        .expect(201);
    });
  });

  // ---------------------------------------------------------------------------
  describe('requesting on behalf of someone else', () => {
    it('is refused for an ordinary employee', async () => {
      const { body } = await zara
        .post('/api/leave/requests')
        .send({
          employeeId: h.world.employees.hassan,
          leaveTypeId: h.world.leaveTypes.annual,
          ...workingDayRange(30, 1),
          reason: 'Not mine to take',
        })
        .expect(403);

      expect(body.message).toMatch(/only request leave for yourself/i);
    });

    it('is refused for a manager, which is what stops self-approval by proxy', async () => {
      // A manager's leave_request:create is SELF even though their read and
      // approve are TEAM. Raising a request for a report and then approving it
      // would be one person doing both halves.
      await omar
        .post('/api/leave/requests')
        .send({
          employeeId: h.world.employees.zara,
          leaveTypeId: h.world.leaveTypes.annual,
          ...workingDayRange(30, 1),
          reason: 'On her behalf',
        })
        .expect(403);
    });

    it('is allowed for HR at GLOBAL scope', async () => {
      await hr
        .post('/api/leave/requests')
        .send({
          employeeId: h.world.employees.zara,
          leaveTypeId: h.world.leaveTypes.annual,
          ...workingDayRange(30, 1),
          reason: 'Recorded by HR',
        })
        .expect(201);
    });
  });

  // ---------------------------------------------------------------------------
  describe('notifications are visible only to their recipient', () => {
    it('never shows one person another person’s notifications', async () => {
      await zara
        .post('/api/leave/requests')
        .send({
          leaveTypeId: h.world.leaveTypes.annual,
          ...workingDayRange(30, 2),
          reason: 'Time off',
        })
        .expect(201);

      // Omar was notified, because he is the approver.
      const { body: omarsInbox } = await omar.get('/api/notifications').expect(200);
      expect(omarsInbox.items.length).toBe(1);

      // Zara was not — she raised it.
      const { body: zarasInbox } = await zara.get('/api/notifications').expect(200);
      expect(zarasInbox.items.length).toBe(0);

      // And she cannot mark his as read, even knowing its id.
      await zara.post(`/api/notifications/${omarsInbox.items[0].id}/read`).expect(404);
      await zara.get(`/api/notifications/${omarsInbox.items[0].id}/deliveries`).expect(404);

      // Which really did leave it unread for him.
      const { body: stillUnread } = await omar.get('/api/notifications').expect(200);
      expect(stillUnread.unreadCount).toBe(1);
    });
  });
});
