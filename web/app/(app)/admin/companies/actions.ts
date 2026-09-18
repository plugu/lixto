"use server";

// Approve/reject actions behind the Empresas admin page. Both gate on
// `requireSuperadmin()` first (404 for anyone else, ADR 003 §D6) and never
// trust `companyId`/`reason` beyond what's parsed here — form fields are
// user input, even on a superadmin-only page.

import { revalidatePath } from "next/cache";
import { requireSuperadmin } from "@/lib/auth";
import { setApprovalStatus } from "@/lib/company-approval-queries";

/** Rejection reasons are shown to the applicant verbatim (email template);
 * cap them so a superadmin can't paste something unbounded into a mail. */
const REASON_MAX_LENGTH = 500;

function parseCompanyId(formData: FormData): number | null {
  const raw = Number(formData.get("companyId"));
  return Number.isInteger(raw) && raw > 0 ? raw : null;
}

/** Trims, caps at `REASON_MAX_LENGTH`, and maps an empty string to `null`
 * (no reason given) rather than storing/mailing `""`. Returns `undefined`
 * when the submitted reason is too long — the caller treats that as an
 * invalid submission and no-ops, same as an invalid `companyId`. */
function parseReason(formData: FormData): string | null | undefined {
  const raw = String(formData.get("reason") ?? "").trim();
  if (!raw) return null;
  if (raw.length > REASON_MAX_LENGTH) return undefined;
  return raw;
}

export async function approveCompanyAction(formData: FormData): Promise<void> {
  const session = await requireSuperadmin();

  const companyId = parseCompanyId(formData);
  if (companyId === null) return;
  const reason = parseReason(formData);
  if (reason === undefined) return;

  await setApprovalStatus(companyId, "approved", reason, session.user.id);
  revalidatePath("/admin/companies");
}

export async function rejectCompanyAction(formData: FormData): Promise<void> {
  const session = await requireSuperadmin();

  const companyId = parseCompanyId(formData);
  if (companyId === null) return;
  const reason = parseReason(formData);
  if (reason === undefined) return;

  await setApprovalStatus(companyId, "rejected", reason, session.user.id);
  revalidatePath("/admin/companies");
}
