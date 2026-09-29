import { countWorkingDays, formatDate, isWeekend, leaveYearOf, toDateOnly } from './working-days';

/**
 * =============================================================================
 * THE ONE PLACE LEAVE DAYS ARE COUNTED
 *
 * Every number in this module traces back to `countWorkingDays`: what an
 * employee sees before submitting, what is stored on the request, what is
 * deducted from a balance. If it drifts, every one of those drifts silently
 * and nothing else notices.
 *
 * These are plain function tests — no database, no HTTP. They run in
 * milliseconds and are the first thing to break if someone changes the
 * weekend rule or adds a holiday calendar without thinking it through.
 * =============================================================================
 */

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('working-days', () => {
  describe('isWeekend', () => {
    it('treats Saturday and Sunday as non-working', () => {
      expect(isWeekend(d('2026-11-07'))).toBe(true); // Saturday
      expect(isWeekend(d('2026-11-08'))).toBe(true); // Sunday
    });

    it('treats Monday to Friday as working', () => {
      for (const day of ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']) {
        expect(isWeekend(d(day))).toBe(false);
      }
    });
  });

  describe('countWorkingDays', () => {
    it('counts a single weekday as one day', () => {
      expect(countWorkingDays(d('2026-11-09'), d('2026-11-09'))).toBe(1);
    });

    it('counts both ends of the range, inclusively', () => {
      // Mon 9th to Wed 11th is three days off work, not two.
      expect(countWorkingDays(d('2026-11-09'), d('2026-11-11'))).toBe(3);
    });

    it('excludes the weekend inside a range', () => {
      // Fri 6th to Mon 9th spans four calendar days but only two working ones.
      expect(countWorkingDays(d('2026-11-06'), d('2026-11-09'))).toBe(2);
    });

    it('returns 0 for a range that is entirely a weekend', () => {
      // The caller turns this into "that range has no working days in it"
      // rather than silently booking zero days of leave.
      expect(countWorkingDays(d('2026-11-07'), d('2026-11-08'))).toBe(0);
    });

    it('returns 0 when the range runs backwards', () => {
      expect(countWorkingDays(d('2026-11-11'), d('2026-11-09'))).toBe(0);
    });

    it('counts a full working fortnight as 10', () => {
      expect(countWorkingDays(d('2026-11-09'), d('2026-11-20'))).toBe(10);
    });

    it('handles a range crossing a month boundary', () => {
      // Mon 30 Nov to Fri 4 Dec.
      expect(countWorkingDays(d('2026-11-30'), d('2026-12-04'))).toBe(5);
    });

    it('handles 29 February in a leap year', () => {
      // 2028 is a leap year; 29 Feb 2028 is a Tuesday.
      expect(countWorkingDays(d('2028-02-28'), d('2028-03-01'))).toBe(3);
    });

    it('ignores the time of day on the inputs', () => {
      // Requests arrive as date strings, but a Date built from one carries a
      // time. Two calls that differ only in time must agree.
      const morning = new Date('2026-11-09T06:00:00.000Z');
      const evening = new Date('2026-11-11T23:30:00.000Z');
      expect(countWorkingDays(morning, evening)).toBe(3);
    });

    it('still counts public holidays as leave — no calendar exists yet', () => {
      // 25 December 2026 is a Friday. This test documents a KNOWN LIMITATION
      // rather than approving of it: when a PublicHoliday table lands, this
      // expectation should change to 0 and the test renamed. Leaving it
      // asserted means the behaviour cannot change by accident.
      expect(countWorkingDays(d('2026-12-25'), d('2026-12-25'))).toBe(1);
    });
  });

  describe('toDateOnly', () => {
    it('strips the time, in UTC, to match a Postgres date column', () => {
      expect(toDateOnly(new Date('2026-03-15T18:45:12.345Z')).toISOString()).toBe(
        '2026-03-15T00:00:00.000Z',
      );
    });
  });

  describe('formatDate', () => {
    it('renders the plain YYYY-MM-DD form used in messages', () => {
      expect(formatDate(new Date('2026-04-01T09:00:00.000Z'))).toBe('2026-04-01');
    });
  });

  describe('leaveYearOf', () => {
    it('uses the start date year', () => {
      expect(leaveYearOf(d('2026-05-04'))).toBe(2026);
    });

    it('attributes a request spanning New Year to the year it began in', () => {
      // A documented simplification: the whole request draws on 2026, not
      // split across two balances.
      expect(leaveYearOf(d('2026-12-30'))).toBe(2026);
    });
  });
});
