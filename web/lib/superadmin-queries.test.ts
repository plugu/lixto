import { describe, expect, it } from "vitest";
import { buildListSuperadminRecipients } from "./superadmin-queries";

describe("buildListSuperadminRecipients", () => {
  it("selects id, email, name filtered on is_superadmin, ordered by id", () => {
    const query = buildListSuperadminRecipients();
    expect(query.text).toMatch(/SELECT id, email, name FROM users/);
    expect(query.text).toMatch(/WHERE is_superadmin/);
    expect(query.text).toMatch(/ORDER BY id/);
    expect(query.values).toEqual([]);
  });
});
