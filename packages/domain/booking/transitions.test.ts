/**
 * Appointments module — transition & slot-conflict unit tests
 * Module Owner: Appointments Team
 */

import { describe, it, expect } from 'vitest';
import {
  canTransition,
  assertTransition,
  IllegalTransitionError,
  intervalsOverlap,
  subtractBusyIntervals,
  findSlotByStart,
  ACTIVE_APPOINTMENT_STATUSES,
  type AppointmentStatus,
} from './transitions';

describe('status transitions', () => {
  it('allows the happy path chain', () => {
    const chain: AppointmentStatus[] = [
      'booked',
      'confirmed',
      'checked_in',
      'in_progress',
      'completed',
    ];
    for (let i = 0; i < chain.length - 1; i++) {
      expect(canTransition(chain[i], chain[i + 1])).toBe(true);
    }
  });

  it('allows cancellation only from booked and confirmed', () => {
    expect(canTransition('booked', 'cancelled')).toBe(true);
    expect(canTransition('confirmed', 'cancelled')).toBe(true);
    expect(canTransition('checked_in', 'cancelled')).toBe(false);
    expect(canTransition('in_progress', 'cancelled')).toBe(false);
    expect(canTransition('completed', 'cancelled')).toBe(false);
  });

  it('allows no_show only from confirmed and checked_in', () => {
    expect(canTransition('confirmed', 'no_show')).toBe(true);
    expect(canTransition('checked_in', 'no_show')).toBe(true);
    expect(canTransition('booked', 'no_show')).toBe(false);
    expect(canTransition('in_progress', 'no_show')).toBe(false);
  });

  it('rejects skipping steps and leaving terminal states', () => {
    expect(canTransition('booked', 'completed')).toBe(false);
    expect(canTransition('booked', 'in_progress')).toBe(false);
    expect(canTransition('completed', 'booked')).toBe(false);
    expect(canTransition('cancelled', 'confirmed')).toBe(false);
    expect(canTransition('no_show', 'checked_in')).toBe(false);
  });

  it('assertTransition throws a typed error with from/to attached', () => {
    expect(() => assertTransition('booked', 'confirmed')).not.toThrow();
    try {
      assertTransition('booked', 'completed');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(IllegalTransitionError);
      const err = e as IllegalTransitionError;
      expect(err.from).toBe('booked');
      expect(err.to).toBe('completed');
    }
  });

  it('active statuses are exactly the slot-occupying ones', () => {
    expect(ACTIVE_APPOINTMENT_STATUSES).toEqual([
      'booked',
      'confirmed',
      'checked_in',
      'in_progress',
    ]);
  });
});

const at = (h: number, m = 0) => new Date(Date.UTC(2026, 6, 6, h, m));
const interval = (sh: number, sm: number, eh: number, em: number) => ({
  startsAt: at(sh, sm),
  endsAt: at(eh, em),
});

describe('slot-conflict logic', () => {
  it('detects partial, exact, and containment overlaps (half-open)', () => {
    const slot = interval(9, 0, 9, 30);
    expect(intervalsOverlap(slot, interval(9, 0, 9, 30))).toBe(true); // exact
    expect(intervalsOverlap(slot, interval(9, 15, 9, 45))).toBe(true); // partial
    expect(intervalsOverlap(slot, interval(8, 0, 12, 0))).toBe(true); // contains
    expect(intervalsOverlap(slot, interval(9, 10, 9, 20))).toBe(true); // contained
  });

  it('treats adjacent intervals as non-overlapping', () => {
    const slot = interval(9, 0, 9, 30);
    expect(intervalsOverlap(slot, interval(8, 30, 9, 0))).toBe(false);
    expect(intervalsOverlap(slot, interval(9, 30, 10, 0))).toBe(false);
  });

  it('subtracts busy intervals from slots', () => {
    const slots = [
      interval(9, 0, 9, 30),
      interval(9, 30, 10, 0),
      interval(10, 0, 10, 30),
    ];
    const busy = [interval(9, 30, 10, 0)];
    const free = subtractBusyIntervals(slots, busy);
    expect(free).toHaveLength(2);
    expect(free[0].startsAt).toEqual(at(9, 0));
    expect(free[1].startsAt).toEqual(at(10, 0));
  });

  it('returns all slots when nothing is busy', () => {
    const slots = [interval(9, 0, 9, 30)];
    expect(subtractBusyIntervals(slots, [])).toEqual(slots);
  });

  it('finds a slot by exact start instant', () => {
    const slots = [interval(9, 0, 9, 30), interval(9, 30, 10, 0)];
    expect(findSlotByStart(slots, at(9, 30))).toEqual(interval(9, 30, 10, 0));
    expect(findSlotByStart(slots, at(9, 15))).toBeNull();
  });
});
