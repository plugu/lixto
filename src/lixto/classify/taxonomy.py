"""Closed segment taxonomy for procurement classification (cycle 32).

`code` is the facet value, `label` is the pt-BR text shown to users, and
`description` is both what gets embedded and what the LLM reads. The same
24 rows are seeded by `migrations/009_classification.sql`; a test keeps the
two in sync.
"""

from __future__ import annotations

from dataclasses import dataclass

NATURES = ("bens", "servicos", "obras")


@dataclass(frozen=True)
class Segment:
    code: str
    label: str
    description: str
    sort_order: int


_RAW: tuple[tuple[str, str, str], ...] = (
    (
        "informatica",
        "Informática e telecom",
        "Equipamentos de informática, software, licenças, serviços de TI, telefonia, redes, impressão/outsourcing de impressão.",
    ),
    (
        "saude",
        "Saúde e hospitalar",
        "Medicamentos, materiais médico-hospitalares, equipamentos médicos e odontológicos, serviços de saúde, exames.",
    ),
    (
        "alimentacao",
        "Alimentação",
        "Gêneros alimentícios, merenda escolar, refeições prontas, coffee break, água mineral, hortifrúti.",
    ),
    (
        "obras",
        "Obras e construção",
        "Execução de obras, reformas, pavimentação, construção civil, drenagem, edificações.",
    ),
    (
        "engenharia_servicos",
        "Serviços de engenharia e projetos",
        "Projetos de engenharia e arquitetura, fiscalização, laudos, topografia, consultoria técnica de obras.",
    ),
    (
        "materiais_construcao",
        "Materiais de construção",
        "Cimento, areia, brita, tintas, material elétrico e hidráulico, ferragens para obras.",
    ),
    (
        "limpeza",
        "Limpeza e higiene",
        "Serviços de limpeza e conservação, materiais de limpeza, higiene, descartáveis, coleta de resíduos.",
    ),
    (
        "veiculos_transporte",
        "Veículos e transporte",
        "Veículos, peças e pneus, manutenção de frota, locação de veículos, transporte de pessoas e cargas.",
    ),
    (
        "combustiveis",
        "Combustíveis e lubrificantes",
        "Gasolina, diesel, etanol, GLP, lubrificantes, gestão de abastecimento.",
    ),
    (
        "mobiliario",
        "Mobiliário e eletrodomésticos",
        "Móveis, cadeiras, armários, eletrodomésticos, eletroportáteis, utensílios.",
    ),
    (
        "papelaria",
        "Papelaria, gráfica e expediente",
        "Material de expediente, papel, toner, impressos gráficos, carimbos, encadernação.",
    ),
    (
        "vestuario_epi",
        "Vestuário e EPI",
        "Uniformes, fardamentos, calçados, equipamentos de proteção individual, enxoval.",
    ),
    (
        "seguranca",
        "Segurança e vigilância",
        "Vigilância armada/desarmada, monitoramento, CFTV, alarmes, controle de acesso, extintores, brigada.",
    ),
    (
        "educacao",
        "Educação e material didático",
        "Material didático e pedagógico, livros, brinquedos, mobiliário escolar, serviços educacionais.",
    ),
    (
        "eventos_comunicacao",
        "Eventos e comunicação",
        "Organização de eventos, locação de estruturas, som e iluminação, publicidade, comunicação visual, brindes.",
    ),
    (
        "terceirizacao_apoio",
        "Terceirização e apoio administrativo",
        "Mão de obra terceirizada, recepção, portaria, copeiragem, motoristas, apoio administrativo, estagiários.",
    ),
    (
        "manutencao_predial",
        "Manutenção predial e de equipamentos",
        "Manutenção de ar-condicionado, elevadores, geradores, instalações elétricas e hidráulicas, jardinagem, dedetização.",
    ),
    (
        "energia_agua_saneamento",
        "Energia, água e saneamento",
        "Energia elétrica, iluminação pública, painéis solares, abastecimento de água, esgoto, tratamento de resíduos.",
    ),
    (
        "agropecuaria",
        "Agropecuária e meio ambiente",
        "Insumos agrícolas, sementes, máquinas agrícolas, medicamentos veterinários, animais, reflorestamento, serviços ambientais.",
    ),
    (
        "laboratorio",
        "Laboratório e científico",
        "Reagentes, vidraria, equipamentos de laboratório, análises laboratoriais, insumos de pesquisa.",
    ),
    (
        "consultoria_servicos_profissionais",
        "Consultoria e serviços profissionais",
        "Consultoria, auditoria, assessoria jurídica e contábil, treinamento, capacitação, pesquisas, serviços especializados.",
    ),
    (
        "locacao_imoveis",
        "Locação de imóveis e espaços",
        "Locação de imóveis, salas, galpões, terrenos, espaços para eventos.",
    ),
    (
        "cultura_esporte",
        "Cultura, esporte e lazer",
        "Instrumentos musicais, equipamentos esportivos, materiais de educação física, shows artísticos, acervos culturais.",
    ),
    ("outros", "Outros", "Objetos que não se encaixam em nenhum dos segmentos anteriores."),
)

SEGMENTS: tuple[Segment, ...] = tuple(
    Segment(code, label, description, i) for i, (code, label, description) in enumerate(_RAW, 1)
)

SEGMENT_CODES: frozenset[str] = frozenset(s.code for s in SEGMENTS)

_BY_CODE = {s.code: s for s in SEGMENTS}


def segment_by_code(code: str) -> Segment | None:
    return _BY_CODE.get(code)
