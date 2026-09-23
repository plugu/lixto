// The habilitação verdict, computed in code — no LLM (PRODUCT, cycle 30).
//
// Input: the dossier's requirements (`tender_analysis_requirements`, already
// extracted) and the company's own uploads (`company_documents`). Output: one
// check line per requirement × document kind, each `met` / `expiring` /
// `missing` / `manual`. Every rule here is deterministic and testable, which
// is the whole point: a case costs zero tokens.
//
// Pure module: only *types* are imported, so nothing at runtime reaches the
// database. Relative imports (not "@/lib/...") like the rest of lib/.

import type {
  AnalysisDate,
  AnalysisRequirement,
  Citation,
  Confidence,
  RequirementCategory,
  Severity,
} from "./analysis-queries";
import type { DocumentRow } from "./document-queries";
import type { DocumentKind } from "./types";

export type CheckStatus = "met" | "expiring" | "missing" | "manual";

/** Where `cases.session_at` came from — mirrors the CHECK on
 * `cases.session_source` (migrations/008_cases.sql). */
export type SessionSource =
  | "dossier_session"
  | "dossier_proposal_deadline"
  | "procurement_closes_at";

/** One line of the verdict table, before it is persisted as a `case_checks`
 * row. `document_kind` is null exactly when the line is `manual`. */
export type CaseCheck = {
  requirement_sequence: number;
  category: RequirementCategory;
  title: string;
  mandatory: boolean;
  severity: Severity;
  citations: Citation[];
  document_kind: DocumentKind | null;
  status: CheckStatus;
  document_id: number | null;
  document_file_name: string | null;
  document_valid_until: Date | null;
};

/** Requirement categories a document upload can possibly satisfy. Anything
 * else (participation gates, specification, guarantee, other) is for a human
 * to read — it becomes a `manual` line, never a false "falta". */
export const CHECKABLE_CATEGORIES = [
  "legal",
  "fiscal_labor",
  "economic_financial",
  "technical",
] as const;

/** Lowercase, accent-free, single-spaced — the shape every KIND_RULES pattern
 * is written against (so `\b` boundaries behave and "Sessão" == "sessao"). */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Requirement text → document kind. Order matters and is deliberate: the
 * narrow certidões (FGTS, trabalhista) come before the broad tax patterns, so
 * "Certidão de regularidade do FGTS" is not also read as a federal certidão.
 * A requirement that matches several rules (the very common "Fazenda Federal,
 * Estadual e Municipal" line) yields one check line per rule.
 */
export const KIND_RULES: { kind: DocumentKind; pattern: RegExp }[] = [
  { kind: "fgts_clearance", pattern: /\bfgts\b|\bcrf\b/ },
  { kind: "labor_clearance", pattern: /trabalhista|\bcndt\b/ },
  {
    kind: "state_tax_clearance",
    pattern: /\bestadual\b|\bestaduais\b|\bicms\b|\bdistrital\b/,
  },
  {
    kind: "municipal_tax_clearance",
    pattern: /\bmunicipal\b|\bmunicipais\b|\bissqn?\b/,
  },
  {
    kind: "federal_tax_clearance",
    pattern: /\bfederal\b|\bfederais\b|\buniao\b|divida ativa|\binss\b|previdenciari/,
  },
  {
    kind: "balance_sheet",
    pattern:
      /balanco patrimonial|demonstracoes contabeis|indices? de liquidez|patrimonio liquido|capital (social|minimo)/,
  },
  {
    kind: "articles_of_association",
    pattern:
      /contrato social|ato constitutivo|estatuto social|registro comercial|requerimento de empresario|ata de eleicao|documento de eleicao/,
  },
  {
    kind: "cnpj_card",
    pattern:
      /prova de inscricao (no|do) cadastro nacional|cartao (do )?cnpj|comprovante de inscricao|inscricao no cnpj/,
  },
  {
    kind: "technical_capacity_certificate",
    pattern: /atestado|capacidade tecnica|qualificacao tecnica|aptidao/,
  },
];

/** Every kind whose rule matches the requirement's title + description, in
 * rule order, deduped. Empty when nothing matches — the caller turns that
 * into a `manual` line. */
export function mapRequirementKinds(req: {
  title: string;
  description: string;
}): DocumentKind[] {
  const text = normalizeText(`${req.title} ${req.description}`);
  const kinds: DocumentKind[] = [];
  for (const rule of KIND_RULES) {
    if (rule.pattern.test(text) && !kinds.includes(rule.kind)) {
      kinds.push(rule.kind);
    }
  }
  return kinds;
}

const CONFIDENCE_RANK: Record<Confidence, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function pickDate(dates: AnalysisDate[], kind: AnalysisDate["kind"]): Date | null {
  const candidates = dates
    .filter((d) => d.kind === kind && d.occurs_at !== null)
    .sort(
      (a, b) =>
        CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence] ||
        a.sequence - b.sequence,
    );
  return candidates[0]?.occurs_at ?? null;
}

/**
 * The date the verdict is measured against: the dossier's session, else its
 * proposal deadline, else the procurement's own `proposal_closes_at`. A date
 * the extractor could not parse (`occurs_at` null) is skipped rather than
 * trusted, and the chosen `source` is stored so the UI can say where the date
 * came from instead of pretending they are equivalent.
 */
export function resolveSessionAt(
  dates: AnalysisDate[],
  proposalClosesAt: Date | null,
): { at: Date | null; source: SessionSource | null } {
  const session = pickDate(dates, "session");
  if (session) return { at: session, source: "dossier_session" };

  const deadline = pickDate(dates, "proposal_deadline");
  if (deadline) return { at: deadline, source: "dossier_proposal_deadline" };

  if (proposalClosesAt) {
    return { at: proposalClosesAt, source: "procurement_closes_at" };
  }
  return { at: null, source: null };
}

/** IANA zone of every Brazilian public session this product cares about. */
const SESSION_TIME_ZONE = "America/Sao_Paulo";

const ZONED_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: SESSION_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * `YYYY-MM-DD`, comparable with `<`/`>=` as plain strings.
 *
 * `zoned = true` for instants (`session_at`, "today"): a session at 23:00
 * UTC-3 must not be read as the next day just because the server runs in UTC.
 * `zoned = false` for `company_documents.valid_until`, which `pg` parses from
 * a DATE into a Date at *local* midnight — shifting that into São Paulo would
 * move the validade a day.
 */
export function dateKey(d: Date, zoned: boolean): string {
  if (zoned) return ZONED_FORMATTER.format(d);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * Status of one requirement × document kind against what the company has
 * uploaded. An undated document (no validade) counts as valid, but a dated
 * valid one wins the slot: the operator would rather see the CRF that is
 * provably good until 12/10 than the one with no date at all.
 */
export function checkStatus(
  kind: DocumentKind,
  documents: DocumentRow[],
  sessionAt: Date | null,
  today: Date,
): { status: CheckStatus; document: DocumentRow | null } {
  const candidates = documents.filter((doc) => doc.kind === kind);
  if (candidates.length === 0) return { status: "missing", document: null };

  const cutoff = dateKey(sessionAt ?? today, true);
  const valid = candidates.filter(
    (doc) => doc.valid_until === null || dateKey(doc.valid_until, false) >= cutoff,
  );

  if (valid.length > 0) {
    const dated = valid
      .filter((doc) => doc.valid_until !== null)
      .sort(
        (a, b) =>
          dateKey(b.valid_until as Date, false).localeCompare(
            dateKey(a.valid_until as Date, false),
          ),
      );
    return { status: "met", document: dated[0] ?? valid[0] };
  }

  // Every candidate is dated (an undated one would be valid above) and all of
  // them expire before the session: the operator has to renew.
  const expiring = [...candidates].sort((a, b) =>
    dateKey(b.valid_until as Date, false).localeCompare(
      dateKey(a.valid_until as Date, false),
    ),
  );
  return { status: "expiring", document: expiring[0] };
}

/**
 * The whole verdict table for one case. A requirement outside
 * `CHECKABLE_CATEGORIES`, or one no rule recognises, yields a single `manual`
 * line: the agent says "verificar" instead of inventing a missing document.
 */
export function computeChecks(
  requirements: AnalysisRequirement[],
  documents: DocumentRow[],
  sessionAt: Date | null,
  today: Date,
): CaseCheck[] {
  const checks: CaseCheck[] = [];
  const ordered = [...requirements].sort((a, b) => a.sequence - b.sequence);

  for (const req of ordered) {
    const checkable = (CHECKABLE_CATEGORIES as readonly string[]).includes(
      req.category,
    );
    const kinds = checkable ? mapRequirementKinds(req) : [];

    if (kinds.length === 0) {
      checks.push({
        requirement_sequence: req.sequence,
        category: req.category,
        title: req.title,
        mandatory: req.mandatory,
        severity: req.severity,
        citations: req.citations,
        document_kind: null,
        status: "manual",
        document_id: null,
        document_file_name: null,
        document_valid_until: null,
      });
      continue;
    }

    for (const kind of kinds) {
      const { status, document } = checkStatus(
        kind,
        documents,
        sessionAt,
        today,
      );
      checks.push({
        requirement_sequence: req.sequence,
        category: req.category,
        title: req.title,
        mandatory: req.mandatory,
        severity: req.severity,
        citations: req.citations,
        document_kind: kind,
        status,
        document_id: document?.id ?? null,
        document_file_name: document?.file_name ?? null,
        document_valid_until: document?.valid_until ?? null,
      });
    }
  }

  return checks;
}

export function summarizeChecks(checks: CaseCheck[]): {
  met: number;
  expiring: number;
  missing: number;
  manual: number;
} {
  const summary = { met: 0, expiring: 0, missing: 0, manual: 0 };
  for (const check of checks) summary[check.status] += 1;
  return summary;
}
