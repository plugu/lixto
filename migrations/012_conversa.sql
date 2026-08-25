-- Persisted chat conversations for the Lixto agent (cycle 16, ticket 68).
-- Tenant-scoped twice over: `empresa_id` decides what the tools may read and
-- `usuario_id` decides who may reopen the thread. Every read binds both.
CREATE TABLE IF NOT EXISTS conversa (
    id BIGSERIAL PRIMARY KEY,
    empresa_id BIGINT NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    usuario_id BIGINT NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
    titulo TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conversa_usuario ON conversa (usuario_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS mensagem (
    id BIGSERIAL PRIMARY KEY,
    conversa_id BIGINT NOT NULL REFERENCES conversa(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
    conteudo TEXT,
    tool_calls JSONB,      -- assistant: [{id, name, arguments}]
    tool_call_id TEXT,     -- tool rows
    refs JSONB,            -- assistant: LicitacaoRef[] shown as cards
    modelo TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mensagem_conversa ON mensagem (conversa_id, id);
