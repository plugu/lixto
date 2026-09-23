-- Dev-only fixture (cycle 30). Idempotent. Never run against prod.
--
-- Turns the first procurement that has items into a live GO opportunity for
-- company 1 with a four-requirement dossier, and gives that company a valid
-- FGTS certificate — so `lixto cases run` produces exactly one case whose
-- verdict is FGTS `met`, CNDT `missing`, atestado `missing`, consórcio
-- `manual`.
\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE fx AS
  SELECT p.id AS procurement_id FROM procurements p
   WHERE EXISTS (SELECT 1 FROM procurement_items i WHERE i.procurement_id = p.id)
   ORDER BY p.id LIMIT 1;
UPDATE procurements SET proposal_opens_at = now() - interval '1 day', proposal_closes_at = now() + interval '7 days', updated_at = now()
 WHERE id = (SELECT procurement_id FROM fx);
INSERT INTO tender_analyses (procurement_id, status, schema_version, input_kind, data, executive_summary)
SELECT procurement_id, 'done', '2.0', 'text', '{}'::jsonb, 'Fixture do agente de casos' FROM fx
ON CONFLICT (procurement_id) DO UPDATE SET status = 'done', error = NULL, updated_at = now();
INSERT INTO tender_analysis_requirements (procurement_id, sequence, category, title, description, mandatory, severity, statement_kind, confidence, citations)
SELECT procurement_id, s.sequence, s.category, s.title, s.description, true, s.severity, 'fact', 'high', '[{"sequence":1,"page":12}]'::jsonb
  FROM fx, (VALUES
    (1, 'fiscal_labor', 'Regularidade com o FGTS', 'Certificado de Regularidade do FGTS (CRF) dentro da validade.', 'high'),
    (2, 'fiscal_labor', 'Certidão Negativa de Débitos Trabalhistas', 'CNDT emitida pelo TST, dentro da validade.', 'high'),
    (3, 'technical', 'Atestado de capacidade técnica', 'Atestado emitido por pessoa jurídica de direito público ou privado comprovando fornecimento compatível.', 'critical'),
    (4, 'participation', 'Vedação a consórcio', 'Não será admitida a participação de empresas em consórcio.', 'medium')
  ) AS s(sequence, category, title, description, severity)
ON CONFLICT (procurement_id, sequence) DO NOTHING;
INSERT INTO tender_analysis_dates (procurement_id, sequence, kind, label, occurs_at, raw_text, confidence, citations)
SELECT procurement_id, 1, 'session', 'Sessão pública', now() + interval '7 days', 'Sessão pública em 7 dias (fixture)', 'high', '[]'::jsonb FROM fx
ON CONFLICT (procurement_id, sequence) DO NOTHING;
INSERT INTO opportunities (company_id, procurement_id, state)
SELECT 1, procurement_id, 'recommended' FROM fx
ON CONFLICT (company_id, procurement_id) DO UPDATE SET state = 'recommended', updated_at = now();
INSERT INTO recommendations (opportunity_id, verdict, rationale, model, confidence)
SELECT o.id, 'go', 'Fixture: vale a pena participar.', 'fixture', 0.9
  FROM opportunities o JOIN fx ON fx.procurement_id = o.procurement_id
 WHERE o.company_id = 1
   AND NOT EXISTS (SELECT 1 FROM recommendations r WHERE r.opportunity_id = o.id AND r.model = 'fixture');
INSERT INTO company_documents (company_id, kind, file_name, storage_path, mime_type, size_bytes, valid_until, uploaded_by)
SELECT 1, 'fgts_clearance', 'crf-fgts.pdf', 'fixtures/crf-fgts.pdf', 'application/pdf', 17, current_date + 30, 1
 WHERE NOT EXISTS (SELECT 1 FROM company_documents d WHERE d.company_id = 1 AND d.storage_path = 'fixtures/crf-fgts.pdf');
COMMIT;
