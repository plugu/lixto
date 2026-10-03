-- Cycle 32 (ticket 182): closed-taxonomy classification.
--
-- `classification_segments` is the 24-row closed segment list (same text as
-- src/lixto/classify/taxonomy.py; a test keeps them in sync), with an
-- embedding per segment. `cnae_code_embeddings` holds one vector per CNAE
-- subclass. `procurement_classifications` is the per-tender result. The
-- ingest-time classifier also writes `procurement_cnaes`, hence the widened
-- origin check (same move as 002 and 008).

ALTER TABLE procurement_cnaes DROP CONSTRAINT IF EXISTS procurement_cnaes_origin_check;
ALTER TABLE procurement_cnaes ADD CONSTRAINT procurement_cnaes_origin_check
    CHECK (origin IN ('enrichment','ingest'));

CREATE TABLE classification_segments (
    code            TEXT PRIMARY KEY,
    label           TEXT NOT NULL,
    description     TEXT NOT NULL,
    sort_order      INTEGER NOT NULL UNIQUE,
    embedding       vector(1536),
    embedding_model TEXT,
    embedded_at     TIMESTAMPTZ
);

INSERT INTO classification_segments (code, label, description, sort_order) VALUES
('informatica', 'Informática e telecom', 'Equipamentos de informática, software, licenças, serviços de TI, telefonia, redes, impressão/outsourcing de impressão.', 1),
('saude', 'Saúde e hospitalar', 'Medicamentos, materiais médico-hospitalares, equipamentos médicos e odontológicos, serviços de saúde, exames.', 2),
('alimentacao', 'Alimentação', 'Gêneros alimentícios, merenda escolar, refeições prontas, coffee break, água mineral, hortifrúti.', 3),
('obras', 'Obras e construção', 'Execução de obras, reformas, pavimentação, construção civil, drenagem, edificações.', 4),
('engenharia_servicos', 'Serviços de engenharia e projetos', 'Projetos de engenharia e arquitetura, fiscalização, laudos, topografia, consultoria técnica de obras.', 5),
('materiais_construcao', 'Materiais de construção', 'Cimento, areia, brita, tintas, material elétrico e hidráulico, ferragens para obras.', 6),
('limpeza', 'Limpeza e higiene', 'Serviços de limpeza e conservação, materiais de limpeza, higiene, descartáveis, coleta de resíduos.', 7),
('veiculos_transporte', 'Veículos e transporte', 'Veículos, peças e pneus, manutenção de frota, locação de veículos, transporte de pessoas e cargas.', 8),
('combustiveis', 'Combustíveis e lubrificantes', 'Gasolina, diesel, etanol, GLP, lubrificantes, gestão de abastecimento.', 9),
('mobiliario', 'Mobiliário e eletrodomésticos', 'Móveis, cadeiras, armários, eletrodomésticos, eletroportáteis, utensílios.', 10),
('papelaria', 'Papelaria, gráfica e expediente', 'Material de expediente, papel, toner, impressos gráficos, carimbos, encadernação.', 11),
('vestuario_epi', 'Vestuário e EPI', 'Uniformes, fardamentos, calçados, equipamentos de proteção individual, enxoval.', 12),
('seguranca', 'Segurança e vigilância', 'Vigilância armada/desarmada, monitoramento, CFTV, alarmes, controle de acesso, extintores, brigada.', 13),
('educacao', 'Educação e material didático', 'Material didático e pedagógico, livros, brinquedos, mobiliário escolar, serviços educacionais.', 14),
('eventos_comunicacao', 'Eventos e comunicação', 'Organização de eventos, locação de estruturas, som e iluminação, publicidade, comunicação visual, brindes.', 15),
('terceirizacao_apoio', 'Terceirização e apoio administrativo', 'Mão de obra terceirizada, recepção, portaria, copeiragem, motoristas, apoio administrativo, estagiários.', 16),
('manutencao_predial', 'Manutenção predial e de equipamentos', 'Manutenção de ar-condicionado, elevadores, geradores, instalações elétricas e hidráulicas, jardinagem, dedetização.', 17),
('energia_agua_saneamento', 'Energia, água e saneamento', 'Energia elétrica, iluminação pública, painéis solares, abastecimento de água, esgoto, tratamento de resíduos.', 18),
('agropecuaria', 'Agropecuária e meio ambiente', 'Insumos agrícolas, sementes, máquinas agrícolas, medicamentos veterinários, animais, reflorestamento, serviços ambientais.', 19),
('laboratorio', 'Laboratório e científico', 'Reagentes, vidraria, equipamentos de laboratório, análises laboratoriais, insumos de pesquisa.', 20),
('consultoria_servicos_profissionais', 'Consultoria e serviços profissionais', 'Consultoria, auditoria, assessoria jurídica e contábil, treinamento, capacitação, pesquisas, serviços especializados.', 21),
('locacao_imoveis', 'Locação de imóveis e espaços', 'Locação de imóveis, salas, galpões, terrenos, espaços para eventos.', 22),
('cultura_esporte', 'Cultura, esporte e lazer', 'Instrumentos musicais, equipamentos esportivos, materiais de educação física, shows artísticos, acervos culturais.', 23),
('outros', 'Outros', 'Objetos que não se encaixam em nenhum dos segmentos anteriores.', 24);

CREATE TABLE cnae_code_embeddings (
    cnae_code   CHAR(7) PRIMARY KEY REFERENCES cnae_codes (code) ON DELETE CASCADE,
    model       TEXT NOT NULL,
    embedding   vector(1536) NOT NULL,
    embedded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE procurement_classifications (
    procurement_id     BIGINT PRIMARY KEY REFERENCES procurements (id) ON DELETE CASCADE,
    schema_version     TEXT NOT NULL,
    model              TEXT,
    status             TEXT NOT NULL CHECK (status IN ('done','error')),
    error              TEXT,
    segment            TEXT REFERENCES classification_segments (code),
    segment_confidence REAL,
    segment_source     TEXT CHECK (segment_source IN ('llm','cosine')),
    nature             TEXT CHECK (nature IN ('bens','servicos','obras')),
    keywords           TEXT[] NOT NULL DEFAULT '{}',
    data               JSONB NOT NULL DEFAULT '{}',
    classified_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_procurement_classifications_segment ON procurement_classifications (segment);
CREATE INDEX idx_procurement_classifications_status ON procurement_classifications (status);
CREATE INDEX idx_procurement_classifications_keywords ON procurement_classifications USING gin (keywords);
CREATE INDEX idx_procurement_classifications_classified_at ON procurement_classifications (classified_at DESC);
