"use server";

// Approve/reject actions behind the Empresas admin page. Both gate on
// `requireSuperadmin()` first (404 for anyone else, ADR 003 §D2/§D3) and
// never trust `companyId`/`reason` beyond what's parsed here — form fields
// are user input, even on a superadmin-only page.

import { revalidatePath } from "next/cache";
import { requireSuperadmin } from "@/lib/auth";
import { setApprovalStatus } from "@/lib/company-approval-queries";

/** Rejection reasons are shown to the applicant verbatim (email template);
 * cap them so a superadmin can't paste something unbounded into a mail. */
const REASON_MAX_LENGTH = 500;

/** Throws rather than no-opping (F8/F14): a malformed `companyId` on a
 * superadmin-only page is either a bug or someone bypassing the form, and a
 * silent no-op would look like a successful approve/reject to the caller. */
function parseCompanyId(formData: FormData): number {
  const raw = Number(formData.get("companyId"));
  if (!Number.isInteger(raw) || raw <= 0) {
    throw new Error("Empresa inválida.");
  }
  return raw;
}

/** Trims and maps an empty string to `null` (no reason given) rather than
 * storing/mailing `""`. Throws when the submitted reason is over
 * `REASON_MAX_LENGTH` (F8/F14) instead of silently no-opping — the
 * textarea's `maxLength` is a UI nicety, not the guarantee. */
function parseReason(formData: FormData): string | null {
  const raw = String(formData.get("reason") ?? "").trim();
  if (!raw) return null;
  if (raw.length > REASON_MAX_LENGTH) {
    throw new Error(
      `Motivo muito longo (máx. ${REASON_MAX_LENGTH} caracteres).`,
    );
  }
  return raw;
}

export async function approveCompanyAction(formData: FormData): Promise<void> {
  const session = await requireSuperadmin();

  const companyId = parseCompanyId(formData);
  const reason = parseReason(formData);

  await setApprovalStatus(companyId, "approved", reason, session.user.id);
  revalidatePath("/admin/companies");
}

export async function rejectCompanyAction(formData: FormData): Promise<void> {
  const session = await requireSuperadmin();

  const companyId = parseCompanyId(formData);
  const reason = parseReason(formData);

  await setApprovalStatus(companyId, "rejected", reason, session.user.id);
  revalidatePath("/admin/companies");
}
