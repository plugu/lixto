"""The analysis prompt: Portuguese instructions plus the page-tagged material.

The prompt is the only place the model learns *where* a statement came from.
Every page is emitted under a `[DOC {sequence} | {título} | página {n}]` tag,
and citations are `{sequence, page}` pairs pointing back at those tags — which
`lixto.analyze.schema.clean_citations` then verifies against the real page
counts, so a hallucinated tag cannot become a citation.

Ordering matters twice: the edital goes first (it frames everything else) and
the remaining documents follow oldest-first, so the newest wording — a
retificação or errata — is the last thing the model reads and the amendment
rules below have something to compare against.
"""

from __future__ import annotations

from typing import Any

from lixto.analyze.schema import BASIC_FACT_KEYS, COMMERCIAL_FACT_KEYS

MAX_ITEMS = 60
ITEM_CHARS = 160
DESCRIPTION_CHARS = 2000
TITLE_CHARS = 60
DEFAULT_MAX_CHARS = 400_000

INSTRUCTIONS = f"""Você é um analista de licitações públicas brasileiras. \
Leia o material recebido (dados estruturados do PNCP e o texto paginado dos \
documentos) e produza um dossiê completo da licitação.

Esse dossiê é global e agnóstico de empresa: ele será reutilizado por todas as \
empresas, então nunca avalie o encaixe de uma empresa específica, nunca \
recomende participar ou não participar, e nunca invente informação que não \
esteja no material recebido.

Os nomes dos campos e os valores de enumeração são em inglês (use exatamente \
os valores listados); todo o conteúdo textual é em português.

## Regras gerais

- Nunca invente valores, números, prazos, datas ou preços. Se o material não \
informa, o campo vai para missing — nunca para um chute.
- Toda afirmação com statement_kind "fact" DEVE trazer citations, no formato \
{{"sequence": n, "page": p}}, retiradas das marcações \
[DOC n | título | página p] do texto. Uma afirmação sem citação não é um fato.
- Use statement_kind "inference" quando a conclusão for sua e não estiver \
escrita literalmente; nesse caso explique em description por que você inferiu.
- O que não estiver no material vai em missing, com field (o dado ausente) e \
note (onde você procurou ou por que faltou).
- Contradições entre documentos viram um item em risks com kind \
"contradiction", citando os dois trechos conflitantes e ambas as origens.
- Documentos mais recentes (data de publicação posterior, ou títulos como \
"retificação", "errata", "aditivo", "esclarecimento") prevalecem sobre os \
anteriores: registre um item em risks com kind "amendment" descrevendo o que \
valia originalmente e o que vale agora.
- Nunca afirme que algo é ilegal, irregular ou nulo. Quando uma cláusula \
parecer indevida, escreva que "pode merecer análise jurídica".
- Marca ou especificação restritiva, prazo de entrega curto demais, garantia \
desproporcional, exigência de habilitação incomum e penalidades fora do \
usual entram em risks com kind "red_flag".
- Se o material estiver truncado ou algum documento não tiver texto, registre \
os documentos não lidos em missing.

## Campos do dossiê

- executive_summary: 3 a 8 frases dizendo o que um fornecedor precisa saber \
antes de decidir (objeto, valor, prazo, exigências críticas, pontos de \
atenção).
- object: descrição do objeto contratado como consta no edital.
- overall_risk: low, medium, high ou critical — risco global de participar, \
considerando exigências, penalidades e alertas encontrados.
- facts: campos objetivos da licitação, cada um com group ("basic" ou \
"commercial"), key (identificador em minúsculas com underscore), label \
(rótulo em português), value (o valor como texto), statement_kind, \
confidence (high, medium ou low) e citations. Keys sugeridas em basic: \
{", ".join(BASIC_FACT_KEYS)}; em commercial: {", ".join(COMMERCIAL_FACT_KEYS)}. \
Não repita a mesma key.
- dates: prazos e datas, cada uma com kind (proposal_deadline, session, \
clarification_deadline, challenge_deadline, site_visit, contract_start, \
delivery, other), label, occurs_at (ISO-8601 com fuso, por exemplo \
"2026-10-14T09:00:00-03:00", ou null quando o texto não permitir datar), \
raw_text (o trecho literal do documento), confidence e citations.
- requirements: exigências que podem desclassificar um fornecedor, cada uma \
com category (participation, legal, fiscal_labor, economic_financial, \
technical, specification, guarantee, other), title curto, description \
detalhada, mandatory (true quando obrigatória), severity (low, medium, high, \
critical), statement_kind, confidence e citations.
- penalties: sanções e multas, cada uma com description, basis (a base de \
cálculo ou o limite, por exemplo "0,5% por dia, limitado a 10%", ou null), \
confidence e citations.
- risks: riscos e alertas, cada um com kind (risk, red_flag, contradiction, \
amendment), severity, title, description e recommendation (o que verificar \
antes de decidir, ou null) e citations.
- missing: informações que o material não traz, cada uma com field e note.

## Campos de indexação (reaproveitados na busca e no matching)

- summary: 1 a 3 frases descrevendo objetivamente o que está sendo comprado.
- categories: categorias amplas de compra (ex.: "material escolar", \
"servicos de limpeza", "equipamentos de informatica").
- concepts: os conceitos/objetos centrais da compra, mais específicos que as \
categories (ex.: "lapis", "caderno", "toner").
- keywords: termos de busca, incluindo sinônimos e variações que compradores \
e fornecedores realmente usam (ex.: "lapis", "lapis preto", "lapis grafite", \
"material escolar").
- cnae_candidates: subclasses CNAE do IBGE no formato 0000-0/00 que um \
fornecedor deste objeto provavelmente possui, cada uma com code e confidence \
de 0 a 1.
- requires_certification: true se o edital exige certificação/registro \
específico do produto ou do fornecedor.
- requires_technical_certificate: true se exige atestado de capacidade técnica.
- delivery: location (local de entrega/execução) e deadline_days (prazo em \
dias). Use location "" e deadline_days -1 quando o edital não informar.
- complexity: low, medium ou high, considerando exigências, volume e prazo.
- confidence: 0 a 1, refletindo quanto da resposta veio do texto dos \
documentos em vez de suposição a partir dos metadados.

Regras de normalização: categories, concepts e keywords devem ser \
substantivos em português, minúsculos, SEM acentos, no singular quando fizer \
sentido, sem pontuação e sem nomes de órgãos, cidades ou números de processo."""


def _format_item(index: int, item: dict[str, Any]) -> str:
    description = (item.get("description") or "(sem descrição)").strip()[:ITEM_CHARS]
    parts = [f"{index}. {description}"]
    quantity = item.get("quantity")
    unit = (item.get("unit") or "").strip()
    if quantity is not None or unit:
        parts.append(f"{quantity if quantity is not None else '?'} {unit}".strip())
    price = item.get("estimated_unit_price")
    if price is not None:
        parts.append(f"R$ {price}")
    return " — ".join(parts)


def _benefit_line(me_epp: tuple[bool | None, bool | None]) -> str | None:
    """One prompt line summarizing the derived ME/EPP flags so the model can
    weigh them in `requirements`/`risks`; None when there's nothing derived
    (no items / no benefit data)."""
    exclusive, preference = me_epp
    if exclusive is None and preference is None:
        return None
    label = "exclusivo" if exclusive else ("cota reservada" if preference else "nenhum")
    return f"Benefício ME/EPP (PNCP): {label}"


def _doc_title(doc: dict[str, Any]) -> str:
    return (doc.get("title") or "").strip() or f"documento {doc.get('sequence')}"


def _doc_type_name(doc: dict[str, Any]) -> str:
    type_name = (doc.get("type_name") or "").strip()
    if type_name:
        return type_name
    type_id = doc.get("type_id")
    return f"id {type_id}" if type_id is not None else "não informado"


def _format_published_at(value: Any) -> str:
    strftime = getattr(value, "strftime", None)
    return strftime("%Y-%m-%d") if callable(strftime) else "sem data"


def _is_edital(doc: dict[str, Any]) -> bool:
    """PNCP document type 2 is "Edital"; órgãos that mistype it usually still
    say so in the title or type name."""
    if doc.get("type_id") == 2:
        return True
    haystack = f"{doc.get('title') or ''} {doc.get('type_name') or ''}".lower()
    return "edital" in haystack


def _published_sort_key(doc: dict[str, Any]) -> tuple[int, float]:
    """(has_date, epoch) so undated documents sort first and mixed
    aware/naive timestamps never blow up the comparison."""
    timestamp = getattr(doc.get("published_at"), "timestamp", None)
    if not callable(timestamp):
        return (0, 0.0)
    try:
        return (1, float(timestamp()))
    except (OSError, OverflowError, ValueError):
        return (0, 0.0)


def order_documents(docs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Edital-like documents first, then the rest oldest-first by publication
    date (undated before dated), sequence as the tiebreaker."""
    return sorted(
        docs,
        key=lambda doc: (
            0 if _is_edital(doc) else 1,
            _published_sort_key(doc),
            doc.get("sequence") or 0,
        ),
    )


def build_prompt(
    row: dict[str, Any],
    items: list[dict[str, Any]],
    docs: list[dict[str, Any]],
    *,
    me_epp: tuple[bool | None, bool | None] = (None, None),
    max_chars: int = DEFAULT_MAX_CHARS,
) -> tuple[str, int, bool]:
    """Builds the analysis prompt and returns `(prompt, input_chars,
    truncated)`.

    The document text is emitted page by page under `[DOC n | título |
    página p]` tags and stops as soon as the next page would push the text
    section past `max_chars`; the omitted count is then stated in the prompt
    so the model can report the unread documents in `missing`.
    """
    lines = ["## Dados estruturados (PNCP)", ""]
    lines.append(f"Objeto: {(row.get('description') or '(sem objeto)')[:DESCRIPTION_CHARS]}")
    if row.get("additional_info"):
        lines.append(f"Informação complementar: {row['additional_info'][:DESCRIPTION_CHARS]}")
    if row.get("modality_name"):
        lines.append(f"Modalidade: {row['modality_name']}")
    if row.get("agency_name"):
        lines.append(f"Órgão: {row['agency_name']}")
    location = " / ".join(str(x) for x in (row.get("state"), row.get("city_name")) if x)
    if location:
        lines.append(f"Local: {location}")
    if row.get("estimated_value") is not None:
        lines.append(f"Valor total estimado: {row['estimated_value']}")
    if row.get("is_price_registry") is not None:
        lines.append(f"SRP (registro de preços): {'sim' if row['is_price_registry'] else 'não'}")
    if row.get("published_at"):
        lines.append(f"Publicação: {row['published_at']}")
    if row.get("proposal_opens_at"):
        lines.append(f"Abertura das propostas: {row['proposal_opens_at']}")
    if row.get("proposal_closes_at"):
        lines.append(f"Encerramento das propostas: {row['proposal_closes_at']}")
    if row.get("source_id"):
        lines.append(f"Identificador PNCP: {row['source_id']}")
    benefit_line = _benefit_line(me_epp)
    if benefit_line:
        lines.append(benefit_line)

    if items:
        lines.append("")
        lines.append("## Itens (PNCP)")
        for i, item in enumerate(items[:MAX_ITEMS], start=1):
            lines.append(_format_item(i, item))

    ordered = order_documents(docs)

    if ordered:
        lines.append("")
        lines.append("## Documentos")
        for doc in ordered:
            has_text = bool(doc.get("page_texts"))
            lines.append(
                f'[DOC {doc.get("sequence")}] "{_doc_title(doc)}" '
                f"(tipo: {_doc_type_name(doc)}; "
                f"publicado: {_format_published_at(doc.get('published_at'))}; "
                f"{doc.get('pages') or 0} páginas; "
                f"texto: {'sim' if has_text else 'não'})"
            )

    blocks: list[str] = []
    used = 0
    total_pages = 0
    included_pages = 0
    stopped = False
    for doc in ordered:
        page_texts = doc.get("page_texts") or []
        total_pages += len(page_texts)
        if stopped:
            continue
        title = _doc_title(doc)[:TITLE_CHARS]
        for page, text in enumerate(page_texts, start=1):
            block = f"[DOC {doc.get('sequence')} | {title} | página {page}]\n{text}\n"
            if used + len(block) > max_chars:
                stopped = True
                break
            blocks.append(block)
            used += len(block)
            included_pages += 1

    omitted = total_pages - included_pages
    truncated = omitted > 0
    if blocks or truncated:
        lines.append("")
        lines.append("## Texto dos documentos")
        lines.extend(blocks)
        if truncated:
            lines.append(
                f"[TRUNCADO: {omitted} de {total_pages} páginas omitidas — "
                "registre os documentos não lidos em missing]"
            )

    prompt = "\n".join(lines)
    return prompt, len(prompt), truncated
