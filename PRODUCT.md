---
mode: mvp
routing_profile: cloud
parallel_default: sequential
---

# Redesign da página de detalhes de licitação

## What / why

A página `/licitacao/[numeroControle]` apresenta hoje todas as seções (header, itens, documentos, análise) soltas sobre o fundo da página, sem hierarquia visual clara. A tabela de itens tem largura que aparenta ser pré-definida em vez de fluir com o container. O redesign agrupa cada bloco em cards de fundo branco sobre fundo neutro, dando separação e escaneabilidade — o padrão que já funciona bem em interfaces densas de dados.

## Primary user story

Como licitante avaliando uma oportunidade, eu abro a página de detalhes e distingo de relance os blocos de informação (resumo, itens, documentos, análise) para decidir rápido se a licitação vale proposta.

## Escopo

Somente a página de detalhes (`web/app/licitacao/[numeroControle]/page.tsx` e componentes que ela renderiza: `ItensTable`, `DocumentosList`, `AnalisePanel`, `Section`).

- **Header/resumo** vira card branco: título, meta, badges, facts (valor, abertura, encerramento, nº controle), links externos.
- **Itens** e **Documentos** viram cards brancos.
- **Análise** vira card com tratamento visual próprio/destacado — diferenciada dos demais cards, continua na sidebar sticky em desktop.
- **Tabela de itens** fluida: ocupa a largura do card, scroll horizontal interno apenas quando necessário; nunca estoura o layout da página.
- Fundo da página neutro (off-white/cinza claro) para os cards brancos lerem como camada.
- Direção visual final (sombras, bordas, espaçamento) fica a critério do design — coerente com o design system existente (botões de canto quadrado-arredondado já adotados).

## Out of scope

- Página `/licitacoes` (lista) e `licitacao-card`.
- Padrão de Card reutilizável aplicado ao app inteiro.
- Mudanças de dados, queries ou lógica de status/análise.
- Novas funcionalidades na página (filtros, ações, edição).

## Success demo

Done when abro a página de detalhes de uma licitação e vejo header, itens, documentos e análise em cards brancos sobre fundo neutro — análise com destaque próprio — com a tabela de itens fluida dentro do card, verificado por screenshot em 1440px e 375px sem overflow horizontal da página.
