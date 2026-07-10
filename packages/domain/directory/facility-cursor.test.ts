import { describe, it, expect } from 'vitest';
import { encodeFacilityCursor, decodeFacilityCursor } from './facility-cursor';

const VALID = {
  r: 1,
  n: 'Erbil General Hospital',
  i: '00000000-0000-4000-9d00-000000000001',
};

describe('facility cursor codec', () => {
  it('round-trips a valid cursor', () => {
    expect(decodeFacilityCursor(encodeFacilityCursor(VALID))).toEqual(VALID);
  });

  it('round-trips Kurdish and Arabic names', () => {
    const ckb = { ...VALID, n: 'نەخۆشخانەی گشتیی هەولێر' };
    expect(decodeFacilityCursor(encodeFacilityCursor(ckb))).toEqual(ckb);
  });

  it('returns null (page one) for null/empty input', () => {
    expect(decodeFacilityCursor(null)).toBeNull();
    expect(decodeFacilityCursor(undefined)).toBeNull();
    expect(decodeFacilityCursor('')).toBeNull();
  });

  it('returns null for garbage that is not base64url JSON', () => {
    expect(decodeFacilityCursor('not-a-cursor')).toBeNull();
    expect(decodeFacilityCursor('%%%%')).toBeNull();
  });

  it('returns null for valid JSON with the wrong shape', () => {
    const raw = Buffer.from(JSON.stringify({ hello: 'world' })).toString('base64url');
    expect(decodeFacilityCursor(raw)).toBeNull();
  });

  it('returns null when the id is not a uuid (tamper defense)', () => {
    const raw = Buffer.from(
      JSON.stringify({ ...VALID, i: "1; DROP TABLE facilities;--" })
    ).toString('base64url');
    expect(decodeFacilityCursor(raw)).toBeNull();
  });

  it('returns null for out-of-range rank or oversized name', () => {
    const badRank = Buffer.from(JSON.stringify({ ...VALID, r: -1 })).toString('base64url');
    expect(decodeFacilityCursor(badRank)).toBeNull();
    const bigName = Buffer.from(
      JSON.stringify({ ...VALID, n: 'x'.repeat(501) })
    ).toString('base64url');
    expect(decodeFacilityCursor(bigName)).toBeNull();
  });
});
