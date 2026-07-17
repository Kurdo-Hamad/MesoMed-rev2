import { expect, test } from "vitest";
test("deliberate failure — CI exit-code propagation proof (reverted before merge)", () => {
  expect(1).toBe(2);
});
