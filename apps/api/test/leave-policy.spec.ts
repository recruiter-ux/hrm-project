import { createHarness, type Agent, type Harness } from './app-harness';

/**
 * =============================================================================
 * LEAVE POLICY — configuration, effective dating, and history
 *
 * The central promise of this module is that leave policy is DATA, and that
 * changing it never destroys what came before. These tests are what hold that
 * promise to account:
 *
 *   - the quotas the company actually runs on are configuration, not code
 *   - asking "what was the rule on date D?" gives D's answer, not today's
 *   - a new version closes the old one; the old one keeps its numbers
 *   - overlapping periods are impossible, enforced by Postgres itself
 *   - there is no endpoint through which a historical quota can be edited
 * =============================================================================
 */
describe('Leave policy (integration)', () => {
  let h: Harness;
  let hr: Agent;

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    await h.reset();
    hr = await h.login(h.world.emails.sana);
  });

  // ---------------------------------------------------------------------------
  // The company's actual leave structure
  // ---------------------------------------------------------------------------
  describe('the configured leave structure', () => {
    it('gives Casual 8, Sick 6 and Annual 6 days, with Unpaid needing no balance', async () => {
      const { body } = await hr.get('/api/leave/types').expect(200);

      interface TypeRow {
        code: string;
        requiresBalance: boolean;
        currentPolicy: { quotaDays: number };
      }
      const byCode = Object.fromEntries(
        (body as TypeRow[]).map((type) => [type.code, type]),
      ) as Record<string, TypeRow>;

      expect(byCode.CASUAL.currentPolicy.quotaDays).toBe(8);
      expect(byCode.SICK.currentPolicy.quotaDays).toBe(6);
      expect(byCode.ANNUAL.currentPolicy.quotaDays).toBe(6);

      // "No paid entitlement" is two separate facts, and both matter.
      expect(byCode.UNPAID.currentPolicy.quotaDays).toBe(0);
      expect(byCode.UNPAID.requiresBalance).toBe(false);
    });

    it('turns a whole-year policy into exactly that many days of entitlement', async () => {
      const { body } = await hr
        .get(`/api/leave/types/${h.world.leaveTypes.casual}/entitlement?year=${h.world.year}`)
        .expect(200);

      expect(body.entitledDays).toBe(8);
    });

    it('lets HR create an entirely new leave type without a code change', async () => {
      // The requirement behind the whole module: nothing in application code
      // knows which leave types exist.
      const { body } = await hr
        .post('/api/leave/types')
        .send({
          code: 'STUDY',
          name: 'Study Leave',
          quotaDays: 4,
          minNoticeDays: 7,
          approvalRequired: true,
          effectiveFrom: `${h.world.year}-01-01`,
        })
        .expect(201);

      expect(body.currentPolicy.quotaDays).toBe(4);
      expect(body.currentPolicy.minNoticeDays).toBe(7);
    });
  });

  // ---------------------------------------------------------------------------
  // Effective dating
  // ---------------------------------------------------------------------------
  describe('effective-dated versions', () => {
    const annual = () => h.world.leaveTypes.annual;

    async function cutAnnualMidYear() {
      return hr
        .post(`/api/leave/types/${annual()}/policies`)
        .send({
          quotaDays: 4,
          approvalRequired: true,
          carryForwardEnabled: false,
          minNoticeDays: 2,
          effectiveFrom: `${h.world.year}-07-01`,
          notes: 'Board approved reduction for H2.',
        })
        .expect(201);
    }

    it('closes the previous version the day before the new one starts', async () => {
      await cutAnnualMidYear();

      const { body: versions } = await hr.get(`/api/leave/types/${annual()}/policies`).expect(200);

      expect(versions).toHaveLength(2);
      // Newest first.
      expect(versions[0]).toMatchObject({ quotaDays: 4, effectiveTo: null });
      expect(versions[1].quotaDays).toBe(6);
      expect(versions[1].effectiveTo.slice(0, 10)).toBe(`${h.world.year}-06-30`);
    });

    it('answers a historical lookup with the rule in force on that date', async () => {
      await cutAnnualMidYear();
      const year = h.world.year;

      const at = async (date: string) => {
        const { body } = await hr
          .get(`/api/leave/types/${annual()}/policy-on?date=${date}`)
          .expect(200);
        return body.policy.quotaDays as number;
      };

      expect(await at(`${year}-03-15`)).toBe(6);
      expect(await at(`${year}-06-30`)).toBe(6); // last day of the old rule
      expect(await at(`${year}-07-01`)).toBe(4); // first day of the new one
      expect(await at(`${year}-11-20`)).toBe(4);
    });

    it('leaves the historical version untouched by the change', async () => {
      const before = await hr
        .get(`/api/leave/types/${annual()}/policy-on?date=${h.world.year}-03-15`)
        .expect(200);

      await cutAnnualMidYear();

      const after = await hr
        .get(`/api/leave/types/${annual()}/policy-on?date=${h.world.year}-03-15`)
        .expect(200);

      // Same row, same id, same quota. THIS is the guarantee.
      expect(after.body.policy.id).toBe(before.body.policy.id);
      expect(after.body.policy.quotaDays).toBe(before.body.policy.quotaDays);
    });

    it('prorates the year across both periods', async () => {
      await cutAnnualMidYear();

      const { body } = await hr
        .get(`/api/leave/types/${annual()}/entitlement?year=${h.world.year}`)
        .expect(200);

      expect(body.breakdown).toHaveLength(2);
      const summed = Number(
        (body.breakdown as Array<{ contribution: number }>)
          .reduce((total, row) => total + row.contribution, 0)
          .toFixed(2),
      );
      expect(body.entitledDays).toBe(summed);
      // Between the two quotas, and equal to neither.
      expect(body.entitledDays).toBeGreaterThan(4);
      expect(body.entitledDays).toBeLessThan(6);
    });

    it('says plainly that no policy covers a date before the type existed', async () => {
      // Not an error, and not an empty body: a readable "there is no rule for
      // that date", which is what a caller has to be able to act on.
      const { body } = await hr
        .get(`/api/leave/types/${annual()}/policy-on?date=${h.world.year - 5}-03-15`)
        .expect(200);

      expect(body.policy).toBeNull();
      expect(body.date).toBe(`${h.world.year - 5}-03-15`);
    });
  });

  // ---------------------------------------------------------------------------
  // Overlap prevention
  // ---------------------------------------------------------------------------
  describe('overlap prevention', () => {
    it('refuses a new version that starts on or before the current one', async () => {
      const { body } = await hr
        .post(`/api/leave/types/${h.world.leaveTypes.sick}/policies`)
        .send({
          quotaDays: 9,
          approvalRequired: true,
          carryForwardEnabled: false,
          minNoticeDays: 0,
          effectiveFrom: `${h.world.year}-01-01`,
        })
        .expect(400);

      expect(body.message).toMatch(/must start after/i);
    });

    it('refuses a version back-dated into an already-closed period', async () => {
      await hr
        .post(`/api/leave/types/${h.world.leaveTypes.sick}/policies`)
        .send({
          quotaDays: 9,
          approvalRequired: true,
          carryForwardEnabled: false,
          minNoticeDays: 0,
          effectiveFrom: `${h.world.year}-07-01`,
        })
        .expect(201);

      // 1 April now sits inside the closed 1 Jan – 30 Jun period. The service
      // catches it on the "must start after the current version" rule, which
      // fires before the overlap rule and gives the more actionable message —
      // it names the date the new version has to beat.
      const { body } = await hr
        .post(`/api/leave/types/${h.world.leaveTypes.sick}/policies`)
        .send({
          quotaDays: 7,
          approvalRequired: true,
          carryForwardEnabled: false,
          minNoticeDays: 0,
          effectiveFrom: `${h.world.year}-04-01`,
        })
        .expect(400);

      expect(body.message).toContain(`${h.world.year}-07-01`);

      // The closed version is untouched by the attempt.
      const { body: versions } = await hr
        .get(`/api/leave/types/${h.world.leaveTypes.sick}/policies`)
        .expect(200);
      expect(versions).toHaveLength(2);
      expect(versions[1].quotaDays).toBe(6);
    });

    it('is enforced by the DATABASE, not only by the service', async () => {
      // ⚠️ THE ONE THAT MATTERS. Everything above goes through service checks
      // that a future edit could remove. This bypasses the service entirely
      // and writes straight to Postgres, so it proves the EXCLUDE constraint
      // in the migration is really there and really works.
      const casual = h.world.leaveTypes.casual;
      const year = h.world.year;

      // Adjacent periods are fine: Jan–Jun and Jul onwards sit flush.
      await expect(
        h.prisma.$executeRawUnsafe(
          `UPDATE leave_type_policies SET effective_to = DATE '${year}-06-30'
             WHERE leave_type_id = $1 AND effective_to IS NULL`,
          casual,
        ),
      ).resolves.toBeGreaterThan(0);

      await expect(
        h.prisma.$executeRawUnsafe(
          `INSERT INTO leave_type_policies
             (id, leave_type_id, quota_days, approval_required, carry_forward_enabled,
              min_notice_days, effective_from, effective_to, created_at, updated_at)
           VALUES ('ovl-ok', $1, 5, true, false, 0, DATE '${year}-07-01', NULL, NOW(), NOW())`,
          casual,
        ),
      ).resolves.toBe(1);

      // Overlapping is not. June already belongs to the first period.
      await expect(
        h.prisma.$executeRawUnsafe(
          `INSERT INTO leave_type_policies
             (id, leave_type_id, quota_days, approval_required, carry_forward_enabled,
              min_notice_days, effective_from, effective_to, created_at, updated_at)
           VALUES ('ovl-bad', $1, 3, true, false, 0, DATE '${year}-06-01', DATE '${year}-09-30', NOW(), NOW())`,
          casual,
        ),
      ).rejects.toThrow(/leave_type_policies_no_overlap|conflicting key|exclusion/i);
    });
  });

  // ---------------------------------------------------------------------------
  // History cannot be rewritten
  // ---------------------------------------------------------------------------
  describe('history cannot be rewritten through the wrong endpoint', () => {
    it('rejects a quota sent to the leave-type endpoint', async () => {
      // `forbidNonWhitelisted` on the global ValidationPipe is doing this, not
      // a hand-written check. The DTO simply has no quotaDays field, so the
      // shortcut is structurally unavailable.
      const { body } = await hr
        .patch(`/api/leave/types/${h.world.leaveTypes.annual}`)
        .send({ name: 'Annual Leave', quotaDays: 99 })
        .expect(400);

      expect(JSON.stringify(body.message)).toMatch(/quotaDays should not exist/i);
    });

    it('rejects a quota or a date sent to the policy-amend endpoint', async () => {
      const { body: versions } = await hr
        .get(`/api/leave/types/${h.world.leaveTypes.annual}/policies`)
        .expect(200);
      const policyId = versions[0].id as string;

      await hr.patch(`/api/leave/policies/${policyId}`).send({ quotaDays: 99 }).expect(400);
      await hr
        .patch(`/api/leave/policies/${policyId}`)
        .send({ effectiveFrom: `${h.world.year}-02-01` })
        .expect(400);

      // And the quota really is unchanged afterwards.
      const { body: after } = await hr
        .get(`/api/leave/types/${h.world.leaveTypes.annual}/policies`)
        .expect(200);
      expect(after[0].quotaDays).toBe(6);
    });

    it('allows a note to be corrected without touching the numbers', async () => {
      const { body: versions } = await hr
        .get(`/api/leave/types/${h.world.leaveTypes.annual}/policies`)
        .expect(200);

      const { body: amended } = await hr
        .patch(`/api/leave/policies/${versions[0].id}`)
        .send({ notes: 'Corrected: approved at the March board meeting.' })
        .expect(200);

      expect(amended.notes).toMatch(/March board meeting/);
      expect(amended.quotaDays).toBe(6);
    });
  });

  // ---------------------------------------------------------------------------
  // Archive and restore
  // ---------------------------------------------------------------------------
  describe('archive and restore', () => {
    it('hides an archived type and stops it being requested, then brings it back', async () => {
      const casual = h.world.leaveTypes.casual;

      await hr.post(`/api/leave/types/${casual}/archive`).expect(201);

      const { body: active } = await hr.get('/api/leave/types').expect(200);
      expect((active as Array<{ code: string }>).map((t) => t.code)).not.toContain('CASUAL');

      const zara = await h.login(h.world.emails.zara);
      const { body: refused } = await zara
        .post('/api/leave/requests')
        .send({
          leaveTypeId: casual,
          startDate: `${h.world.year + 1}-03-02`,
          endDate: `${h.world.year + 1}-03-03`,
          reason: 'Should not be possible',
        })
        .expect(400);
      expect(refused.message).toMatch(/archived/i);

      await hr.post(`/api/leave/types/${casual}/restore`).expect(201);
      const { body: restored } = await hr.get('/api/leave/types').expect(200);
      expect((restored as Array<{ code: string }>).map((t) => t.code)).toContain('CASUAL');
    });
  });

  // ---------------------------------------------------------------------------
  // Audit
  // ---------------------------------------------------------------------------
  describe('audit trail', () => {
    it('records who created a type, who renamed it, and who changed the policy', async () => {
      const { body: created } = await hr
        .post('/api/leave/types')
        .send({ code: 'SABBATICAL', name: 'Sabbatical', quotaDays: 20 })
        .expect(201);

      await hr
        .patch(`/api/leave/types/${created.id}`)
        .send({ name: 'Sabbatical Leave' })
        .expect(200);
      await hr
        .post(`/api/leave/types/${created.id}/policies`)
        .send({
          quotaDays: 25,
          approvalRequired: true,
          carryForwardEnabled: false,
          minNoticeDays: 30,
          effectiveFrom: `${h.world.year}-09-01`,
        })
        .expect(201);
      await hr.post(`/api/leave/types/${created.id}/archive`).expect(201);

      const { body: entries } = await hr.get(`/api/leave/types/${created.id}/audit`).expect(200);
      const actions = (entries as Array<{ action: string }>).map((e) => e.action);

      expect(actions).toEqual(
        expect.arrayContaining([
          'leave_type.created',
          'leave_type.updated',
          'leave_policy.version_created',
          'leave_type.archived',
        ]),
      );

      // Every entry names the person who did it, and reads as a sentence.
      const first = (entries as Array<{ actor: { firstName: string }; summary: string }>)[0];
      expect(first.actor.firstName).toBe('Sana');
      expect(first.summary.length).toBeGreaterThan(10);
    });
  });
});
