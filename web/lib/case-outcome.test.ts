import { describe, expect, it } from "vitest";

import {
  decideOutcome,
  RESULTS_DELAY_DAYS,
  type OutcomeEvidence,
} from "./case-outcome";

function evidence(over: Partial<OutcomeEvidence> = {}): OutcomeEvidence {
  return { won: false, unsyncedItems: 0, resultRows: 0, ...over };
}

describe("RESULTS_DELAY_DAYS", () => {
  it("is the documented mvp hardcode of 2 days", () => {
    expect(RESULTS_DELAY_DAYS).toBe(2);
  });
});

describe("decideOutcome", () => {
  it("declares won whenever the evidence says so, however many items are still unsynced", () => {
    expect(decideOutcome(evidence({ won: true }))).toBe("won");
    expect(
      decideOutcome(evidence({ won: true, unsyncedItems: 3, resultRows: 0 })),
    ).toBe("won");
  });

  it("declares lost once every item is synced and at least one result exists", () => {
    expect(
      decideOutcome(evidence({ won: false, unsyncedItems: 0, resultRows: 1 })),
    ).toBe("lost");
  });

  it("keeps waiting while any item is still unsynced, even with a result already in", () => {
    expect(
      decideOutcome(evidence({ won: false, unsyncedItems: 1, resultRows: 1 })),
    ).toBeNull();
  });

  it("keeps waiting once everything is synced but nothing was ever published", () => {
    expect(
      decideOutcome(evidence({ won: false, unsyncedItems: 0, resultRows: 0 })),
    ).toBeNull();
  });

  it("keeps waiting with no evidence at all", () => {
    expect(decideOutcome(evidence())).toBeNull();
  });
});
