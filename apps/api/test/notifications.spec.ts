import { NotificationDeliveryStatus } from '@prisma/client';

import { createHarness, type Agent, type Harness } from './app-harness';
import { workingDayRange } from './fixtures';
import { EmailSendError, EmailService } from '../src/notifications/email/email.service';

/**
 * =============================================================================
 * NOTIFICATIONS — in-app and email, for every leave event
 *
 * Five things are checked here, and the last two are the ones that matter most
 * when this runs for real:
 *
 *   1. the right person is told about the right event
 *   2. the in-app notification and the email say the same thing
 *   3. the deep link opens the record the notification is about
 *   4. a retried event does NOT produce a second notification or a second email
 *   5. a broken mail server cannot undo an approved leave request
 *
 * Emails really are rendered and really are written out by the file transport,
 * so this exercises the same code path a production SMTP send would take, up
 * to the socket.
 * =============================================================================
 */
describe('Notifications (integration)', () => {
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

  const inboxOf = async (agent: Agent) => {
    const { body } = await agent.get('/api/notifications').expect(200);
    return body as {
      unreadCount: number;
      total: number;
      items: Array<{
        id: string;
        type: string;
        title: string;
        body: string;
        link: string | null;
        entityId: string | null;
        readAt: string | null;
      }>;
    };
  };

  const emailFor = (notificationId: string) =>
    h.prisma.notificationDelivery.findFirst({ where: { notificationId } });

  function submit(agent: Agent, leaveTypeId: string, reason = 'Time off', offset = 30, count = 2) {
    return agent
      .post('/api/leave/requests')
      .send({ leaveTypeId, ...workingDayRange(offset, count), reason });
  }

  // ---------------------------------------------------------------------------
  // A. Employee submits leave
  // ---------------------------------------------------------------------------
  describe('A — leave submitted', () => {
    it('notifies the current manager, with everything needed to decide', async () => {
      const { body: leaveRequest } = await submit(
        zara,
        h.world.leaveTypes.annual,
        'Family wedding',
      ).expect(201);

      const inbox = await inboxOf(omar);
      expect(inbox.unreadCount).toBe(1);

      const [notification] = inbox.items;
      expect(notification.type).toBe('leave.request.submitted');
      expect(notification.title).toContain('Zara Ahmed');
      expect(notification.title).toContain('Annual Leave');
      expect(notification.body).toMatch(/2 days/);
      expect(notification.body).toMatch(/waiting for your decision/i);

      // The DEEP LINK — it names the request, not just the screen.
      expect(notification.entityId).toBe(leaveRequest.id);
      expect(notification.link).toBe(`/leave/approvals?request=${leaveRequest.id}`);
    });

    it('queues an email to the manager saying the same thing', async () => {
      const { body: leaveRequest } = await submit(
        zara,
        h.world.leaveTypes.annual,
        'Family wedding',
      ).expect(201);

      const inbox = await inboxOf(omar);
      const delivery = await emailFor(inbox.items[0].id);

      expect(delivery).not.toBeNull();
      expect(delivery!.channel).toBe('EMAIL');
      expect(delivery!.toAddress).toBe(h.world.emails.omar);
      expect(delivery!.subject).toContain('Zara Ahmed');

      // Same event, same facts, and the reason the employee gave.
      expect(delivery!.bodyText).toContain('Annual Leave');
      expect(delivery!.bodyText).toContain('Family wedding');
      // An absolute link, because a relative one is useless in an inbox.
      expect(delivery!.bodyText).toContain(
        `http://localhost:3000/leave/approvals?request=${leaveRequest.id}`,
      );
    });

    it('tells nobody but the manager', async () => {
      await submit(zara, h.world.leaveTypes.annual).expect(201);

      expect((await inboxOf(zara)).total).toBe(0);
      expect((await inboxOf(hr)).total).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // B / C. The decision
  // ---------------------------------------------------------------------------
  describe('B — leave approved', () => {
    it('notifies the employee and emails them', async () => {
      const { body: leaveRequest } = await submit(zara, h.world.leaveTypes.annual).expect(201);
      await omar
        .post(`/api/leave/requests/${leaveRequest.id}/approve`)
        .send({ comment: 'Enjoy it.' })
        .expect(201);

      const inbox = await inboxOf(zara);
      const [notification] = inbox.items;

      expect(notification.type).toBe('leave.request.approved');
      expect(notification.title).toMatch(/approved/i);
      expect(notification.body).toContain('Omar Farooq');
      expect(notification.link).toBe(`/leave?request=${leaveRequest.id}`);

      const delivery = await emailFor(notification.id);
      expect(delivery!.toAddress).toBe(h.world.emails.zara);
      expect(delivery!.subject).toMatch(/^Approved:/);
      expect(delivery!.bodyText).toContain('Enjoy it.');
      expect(delivery!.bodyText).toContain('Status: Approved');
    });
  });

  describe('C — leave rejected', () => {
    it('notifies the employee WITH the manager’s reason', async () => {
      const { body: leaveRequest } = await submit(zara, h.world.leaveTypes.annual).expect(201);
      await omar
        .post(`/api/leave/requests/${leaveRequest.id}/reject`)
        .send({ comment: 'Two people are already off that week.' })
        .expect(201);

      const inbox = await inboxOf(zara);
      const [notification] = inbox.items;

      expect(notification.type).toBe('leave.request.rejected');
      expect(notification.body).toContain('Two people are already off that week.');

      const delivery = await emailFor(notification.id);
      expect(delivery!.subject).toMatch(/^Not approved:/);
      expect(delivery!.bodyText).toContain('Two people are already off that week.');
      // Reassurance that matters to the person reading it.
      expect(delivery!.bodyText).toMatch(/No days have been taken from your balance/i);
    });

    it('still notifies when the manager gave no reason', async () => {
      const { body: leaveRequest } = await submit(zara, h.world.leaveTypes.annual).expect(201);
      await omar.post(`/api/leave/requests/${leaveRequest.id}/reject`).send({}).expect(201);

      const [notification] = (await inboxOf(zara)).items;
      expect(notification.body).toMatch(/no reason was given/i);
    });
  });

  // ---------------------------------------------------------------------------
  // D. Cancellation
  // ---------------------------------------------------------------------------
  describe('D — leave cancelled', () => {
    it('tells the manager who would have decided it', async () => {
      const { body: leaveRequest } = await submit(zara, h.world.leaveTypes.annual).expect(201);
      await zara.post(`/api/leave/requests/${leaveRequest.id}/cancel`).expect(201);

      const inbox = await inboxOf(omar);
      const cancelled = inbox.items.find((n) => n.type === 'leave.request.cancelled');

      expect(cancelled).toBeDefined();
      expect(cancelled!.title).toContain('Zara Ahmed');
      expect(cancelled!.body).toMatch(/no longer waiting for your decision/i);

      const delivery = await emailFor(cancelled!.id);
      expect(delivery!.toAddress).toBe(h.world.emails.omar);
      expect(delivery!.subject).toMatch(/^Withdrawn:/);
    });

    it('says the days are back when the leave had already been approved', async () => {
      const { body: leaveRequest } = await submit(zara, h.world.leaveTypes.annual).expect(201);
      await omar.post(`/api/leave/requests/${leaveRequest.id}/approve`).send({}).expect(201);
      await zara.post(`/api/leave/requests/${leaveRequest.id}/cancel`).expect(201);

      const cancelled = (await inboxOf(omar)).items.find(
        (n) => n.type === 'leave.request.cancelled',
      );
      expect(cancelled!.body).toMatch(/back in their balance/i);
    });

    it('raises nothing for auto-approved leave, which no manager ever saw', async () => {
      const { body: leaveRequest } = await submit(
        zara,
        h.world.leaveTypes.unpaid,
        'Unpaid break',
      ).expect(201);
      await zara.post(`/api/leave/requests/${leaveRequest.id}/cancel`).expect(201);

      const cancelled = (await inboxOf(omar)).items.filter(
        (n) => n.type === 'leave.request.cancelled',
      );
      expect(cancelled).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // E. Auto-approval
  // ---------------------------------------------------------------------------
  describe('E — auto-approved leave', () => {
    it('tells the employee, and nobody else', async () => {
      await submit(zara, h.world.leaveTypes.unpaid, 'Unpaid break', 40, 3).expect(201);

      const inbox = await inboxOf(zara);
      const [notification] = inbox.items;

      expect(notification.type).toBe('leave.request.auto_approved');
      expect(notification.body).toMatch(/does not require approval/i);

      const delivery = await emailFor(notification.id);
      expect(delivery!.subject).toMatch(/^Approved automatically:/);
      expect(delivery!.bodyText).toMatch(/Nobody needs to review it/i);

      // ⚠️ NO MANAGER NOTIFICATION. There is no action for one to take.
      expect((await inboxOf(omar)).total).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // A'. Nobody can approve it
  // ---------------------------------------------------------------------------
  describe('when a request cannot be routed to anyone', () => {
    it('escalates to HR instead of approving itself', async () => {
      const nadia = await h.login(h.world.emails.nadia);
      const { body: leaveRequest } = await submit(
        nadia,
        h.world.leaveTypes.annual,
        'No manager on file',
      ).expect(201);

      expect(leaveRequest.status).toBe('PENDING');

      const inbox = await inboxOf(hr);
      const [notification] = inbox.items;

      expect(notification.type).toBe('leave.request.unrouted');
      expect(notification.title).toMatch(/no approver/i);
      expect(notification.body).toMatch(/needs an HR decision/i);
      expect(notification.entityId).toBe(leaveRequest.id);
    });

    it('puts it in HR’s approvals queue so the notification leads somewhere', async () => {
      const nadia = await h.login(h.world.emails.nadia);
      await submit(nadia, h.world.leaveTypes.annual, 'No manager on file').expect(201);

      const { body } = await hr
        .get('/api/leave/requests?awaitingMyDecision=true&pageSize=100')
        .expect(200);

      expect(body.total).toBe(1);
      expect(body.items[0].employee.id).toBe(h.world.employees.nadia);
    });
  });

  // ---------------------------------------------------------------------------
  // Idempotency
  // ---------------------------------------------------------------------------
  describe('duplicate prevention', () => {
    it('raises one notification and one email however many times the event repeats', async () => {
      const { body: leaveRequest } = await submit(zara, h.world.leaveTypes.annual).expect(201);

      const before = await inboxOf(omar);
      expect(before.total).toBe(1);

      // Replay the exact event — a retried request, a double-clicked button, a
      // job run twice. The unique dedupe key in Postgres is what stops it.
      const service = h.app.get(
        (await import('../src/notifications/notification.service')).NotificationService,
      );
      const payload = (await import('../src/leave/leave-notifications')).submittedToApprover(
        h.world.employees.omar,
        {
          requestId: leaveRequest.id,
          employeeName: 'Zara Ahmed',
          leaveTypeName: 'Annual Leave',
          startDate: new Date(leaveRequest.startDate),
          endDate: new Date(leaveRequest.endDate),
          days: 2,
          reason: 'Time off',
        },
      );

      const first = await service.notify(payload);
      const second = await service.notify(payload);

      expect(first.duplicate).toBe(true); // already raised by the submission
      expect(second.duplicate).toBe(true);

      const after = await inboxOf(omar);
      expect(after.total).toBe(1);

      const deliveries = await h.prisma.notificationDelivery.count();
      expect(deliveries).toBe(1);
    });

    it('is enforced by the database, not by a check that could race', async () => {
      const { body: leaveRequest } = await submit(zara, h.world.leaveTypes.annual).expect(201);
      const [notification] = (await inboxOf(omar)).items;

      const row = await h.prisma.notification.findUnique({ where: { id: notification.id } });
      expect(row!.dedupeKey).toBe(
        `leave_request:${leaveRequest.id}:submitted:${h.world.employees.omar}`,
      );

      // A raw insert with the same key is refused by the unique index.
      await expect(
        h.prisma.notification.create({
          data: {
            recipientId: h.world.employees.omar,
            type: 'leave.request.submitted',
            title: 'Duplicate',
            body: 'Duplicate',
            dedupeKey: row!.dedupeKey,
          },
        }),
      ).rejects.toThrow();
    });

    it('refuses a second email row for the same notification', async () => {
      await submit(zara, h.world.leaveTypes.annual).expect(201);
      const [notification] = (await inboxOf(omar)).items;

      await expect(
        h.prisma.notificationDelivery.create({
          data: { notificationId: notification.id, channel: 'EMAIL' },
        }),
      ).rejects.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // The notification centre
  // ---------------------------------------------------------------------------
  describe('the notification centre', () => {
    beforeEach(async () => {
      await submit(zara, h.world.leaveTypes.annual, 'First', 30, 2).expect(201);
      await submit(zara, h.world.leaveTypes.casual, 'Second', 50, 2).expect(201);
    });

    it('reports an unread count cheaply, for the bell', async () => {
      const { body } = await omar.get('/api/notifications/unread-count').expect(200);
      expect(body.unreadCount).toBe(2);
    });

    it('marks one as read and drops the count', async () => {
      const inbox = await inboxOf(omar);
      const { body } = await omar.post(`/api/notifications/${inbox.items[0].id}/read`).expect(201);

      expect(body.unreadCount).toBe(1);

      const after = await inboxOf(omar);
      expect(after.items.find((n) => n.id === inbox.items[0].id)!.readAt).not.toBeNull();
    });

    it('is not an error to mark the same one read twice', async () => {
      const inbox = await inboxOf(omar);
      await omar.post(`/api/notifications/${inbox.items[0].id}/read`).expect(201);
      await omar.post(`/api/notifications/${inbox.items[0].id}/read`).expect(201);
    });

    it('marks everything read at once', async () => {
      const { body } = await omar.post('/api/notifications/read-all').expect(201);

      expect(body.markedRead).toBe(2);
      expect(body.unreadCount).toBe(0);
      expect((await inboxOf(omar)).unreadCount).toBe(0);
    });

    it('can list unread only', async () => {
      const inbox = await inboxOf(omar);
      await omar.post(`/api/notifications/${inbox.items[0].id}/read`).expect(201);

      const { body } = await omar.get('/api/notifications?unreadOnly=true').expect(200);
      expect(body.items).toHaveLength(1);
    });

    it('does not treat unreadOnly=false as true', async () => {
      // The `Boolean('false') === true` trap that marked every document
      // confidential in Phase 1. Same pipe, same risk, different query param.
      const { body } = await omar.get('/api/notifications?unreadOnly=false').expect(200);
      expect(body.items).toHaveLength(2);
    });

    it('shows newest first', async () => {
      // The Casual request was submitted second, so it heads the list.
      const inbox = await inboxOf(omar);

      expect(inbox.items).toHaveLength(2);
      expect(inbox.items[0].title).toContain('Casual Leave');
      expect(inbox.items[1].title).toContain('Annual Leave');
    });
  });

  // ---------------------------------------------------------------------------
  // Delivery, retries, and failure isolation
  // ---------------------------------------------------------------------------
  describe('email delivery', () => {
    it('sends queued email when the dispatcher runs', async () => {
      await submit(zara, h.world.leaveTypes.annual).expect(201);

      const result = await h.dispatcher.drain();
      expect(result.sent).toBeGreaterThanOrEqual(1);

      const delivery = await h.prisma.notificationDelivery.findFirst();
      expect(delivery!.status).toBe(NotificationDeliveryStatus.SENT);
      expect(delivery!.sentAt).not.toBeNull();
      expect(delivery!.attempts).toBe(1);
    });

    it('sends each email exactly once, however often the dispatcher runs', async () => {
      await submit(zara, h.world.leaveTypes.annual).expect(201);

      await h.dispatcher.drain();
      const second = await h.dispatcher.drain();
      const third = await h.dispatcher.drain();

      expect(second.attempted).toBe(0);
      expect(third.attempted).toBe(0);

      const delivery = await h.prisma.notificationDelivery.findFirst();
      expect(delivery!.attempts).toBe(1);
    });

    it('records the delivery state where a person can read it', async () => {
      await submit(zara, h.world.leaveTypes.annual).expect(201);
      await h.dispatcher.drain();

      const [notification] = (await inboxOf(omar)).items;
      const { body } = await omar
        .get(`/api/notifications/${notification.id}/deliveries`)
        .expect(200);

      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({ channel: 'EMAIL', status: 'SENT', attempts: 1 });
    });

    it('does NOT roll back an approval when the mail server is broken', async () => {
      // ⚠️ THE MOST IMPORTANT TEST IN THIS FILE.
      //
      // Email is queued outside the business transaction precisely so that a
      // mail outage cannot un-approve somebody's leave. This breaks the
      // transport on purpose and checks the leave record survives intact.
      const { body: leaveRequest } = await submit(zara, h.world.leaveTypes.annual).expect(201);

      const email = h.app.get(EmailService);
      const send = jest
        .spyOn(email, 'send')
        .mockRejectedValue(new EmailSendError('Connection refused', true));

      try {
        const { body: approved } = await omar
          .post(`/api/leave/requests/${leaveRequest.id}/approve`)
          .send({ comment: 'Fine by me.' })
          .expect(201);

        // The business outcome is untouched.
        expect(approved.status).toBe('APPROVED');

        await h.dispatcher.drain();

        // The in-app notification still arrived — it never depended on email.
        const inbox = await inboxOf(zara);
        expect(inbox.items[0].type).toBe('leave.request.approved');

        // And the failure is a visible, traceable row rather than a lost email.
        const delivery = await emailFor(inbox.items[0].id);
        expect(delivery!.status).toBe(NotificationDeliveryStatus.PENDING);
        expect(delivery!.attempts).toBe(1);
        expect(delivery!.lastError).toContain('Connection refused');
        expect(delivery!.nextAttemptAt).not.toBeNull();

        // The leave request itself is still approved in the database.
        const stored = await h.prisma.leaveRequest.findUnique({ where: { id: leaveRequest.id } });
        expect(stored!.status).toBe('APPROVED');
      } finally {
        send.mockRestore();
      }
    });

    it('gives up after the configured number of attempts and marks it FAILED', async () => {
      await submit(zara, h.world.leaveTypes.annual).expect(201);

      const email = h.app.get(EmailService);
      const send = jest
        .spyOn(email, 'send')
        .mockRejectedValue(new EmailSendError('Mailbox does not exist', false));

      try {
        // A permanent failure is not retried at all — retrying a bad address
        // just burns attempts and delays the alert to a human.
        await h.dispatcher.drain();

        const delivery = await h.prisma.notificationDelivery.findFirst();
        expect(delivery!.status).toBe(NotificationDeliveryStatus.FAILED);
        expect(delivery!.lastError).toContain('Mailbox does not exist');
      } finally {
        send.mockRestore();
      }
    });

    it('records SKIPPED, never SENT, when no email provider is configured', async () => {
      // ⚠️ THE HONESTY TEST. With EMAIL_TRANSPORT=none there is no provider,
      // and the system must say so rather than quietly claim delivery.
      const email = h.app.get(EmailService);
      const configured = jest.spyOn(email, 'isConfigured', 'get').mockReturnValue(false);

      try {
        await submit(zara, h.world.leaveTypes.annual).expect(201);

        const delivery = await h.prisma.notificationDelivery.findFirst();
        expect(delivery!.status).toBe(NotificationDeliveryStatus.SKIPPED);
        expect(delivery!.lastError).toMatch(/no email provider configured/i);
        expect(delivery!.sentAt).toBeNull();

        // And the dispatcher leaves it alone — SKIPPED is not PENDING.
        const drained = await h.dispatcher.drain();
        expect(drained.attempted).toBe(0);

        // The in-app notification still arrived. Email being unavailable does
        // not mean the person was not told.
        expect((await inboxOf(omar)).items).toHaveLength(1);
      } finally {
        configured.mockRestore();
      }
    });

    it('never raises a notification for an archived employee', async () => {
      // Alerting someone who has left is worse than useless: it looks like the
      // message was delivered. NotificationService drops it and logs instead.
      await h.prisma.employee.update({
        where: { id: h.world.employees.omar },
        data: { deletedAt: new Date() },
      });

      // Zara's request now routes to the department head, or to nobody — but
      // under no circumstances to the archived manager.
      await submit(zara, h.world.leaveTypes.annual).expect(201);

      const forOmar = await h.prisma.notification.count({
        where: { recipientId: h.world.employees.omar },
      });
      expect(forOmar).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Audit
  // ---------------------------------------------------------------------------
  describe('audit trail for leave requests', () => {
    it('records creation, approval and cancellation with who did each', async () => {
      const { body: leaveRequest } = await submit(zara, h.world.leaveTypes.annual).expect(201);
      await omar
        .post(`/api/leave/requests/${leaveRequest.id}/approve`)
        .send({ comment: 'Fine.' })
        .expect(201);
      await zara.post(`/api/leave/requests/${leaveRequest.id}/cancel`).expect(201);

      const entries = await h.prisma.auditLog.findMany({
        where: { entityType: 'leave_request', entityId: leaveRequest.id },
        orderBy: { createdAt: 'asc' },
      });

      expect(entries.map((e) => e.action)).toEqual([
        'leave_request.created',
        'leave_request.approved',
        'leave_request.cancelled',
      ]);

      expect(entries[0].actorId).toBe(h.world.employees.zara);
      expect(entries[1].actorId).toBe(h.world.employees.omar);
      expect(entries[1].summary).toContain('Fine.');
      expect(entries[2].actorId).toBe(h.world.employees.zara);
    });

    it('marks auto-approved leave distinctly in the log', async () => {
      const { body: leaveRequest } = await submit(
        zara,
        h.world.leaveTypes.unpaid,
        'Unpaid break',
      ).expect(201);

      const [entry] = await h.prisma.auditLog.findMany({
        where: { entityId: leaveRequest.id },
      });

      expect(entry.action).toBe('leave_request.auto_approved');
      expect(entry.summary).toMatch(/no approval required/i);
    });
  });
});
