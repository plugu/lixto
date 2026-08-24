---
mode: mvp
routing_profile: cloud
parallel_default: sequential
---

# CNAE matching de licitações

## What / why

Hoje a plataforma sabe quais CNAEs cada empresa tem (`empresa_cnae`), mas não sabe quais CNAEs uma licitação demanda — então não consegue responder "minha empresa pode participar disto?". A rotina classifica cada licitação nova (abertas/futuras) contra a taxonomia CNAE do IBGE (~1359 subclasses) e grava as tags na licitação. O match empresa↔licitação vira um join SQL barato, reutilizado por todos os tenants: **1 classificação por licitação, nunca por empresa**.

Classificação em nível de **licitação** (não por item): o prompt usa `objeto_compra` + descrições dos itens como evidência, mas grava um conjunto único de CNAEs por licitação. Item-level fica para depois se a precisão exigir.

Custo: motor local (Ollama na plugu-local-m4, acessado do VPS via Tailscale) → custo marginal zero. O prompt nunca recebe as 1359 subclasses de uma vez — narrowing hierárquico (seção → divisão → subclasse) mantém prompts pequenos e viáveis para modelo 12B.

## Primary user story

Como licitante, eu abro o dashboard e filtro por "compatível com minha empresa" para ver só as licitações cujos CNAEs demandados batem com os CNAEs cadastrados da minha empresa, sem ler edital por edital.

## Scope

- Tabela de referência CNAE (seed IBGE: código, descrição, hierarquia).
- Tabela `licitacao_cnae` (numero_controle_pncp, codigo, confidence).
- Rotina de classificação plugada no ciclo de sync: pega abertas/futuras sem tags, classifica via Ollama, grava. Status `pending` + retry no próximo run quando o MacBook estiver offline — indisponibilidade nunca é erro fatal.
- Endpoint Ollama e modelo configuráveis (`OLLAMA_HOST=http://plugu-local-m4:11434`, modelo string — avaliar gemma3:12b vs gpt-oss:20b em ~20 licitações rotuladas à mão antes de fixar).
- Dashboard: filtro/badge "compatível" via join `licitacao_cnae × empresa_cnae` (match em subclasse exata; match por classe/grupo é refinamento posterior).

## Out of scope

- Classificação por item individual.
- Backfill de licitações históricas/encerradas (rotina cobre só o fluxo novo; backfill é um comando à parte, depois).
- Score de compatibilidade ponderado (valor, porte, região) — match é binário por CNAE nesta fase.
- Re-classificação quando licitação é atualizada.
- Motor cloud (Haiku etc.) — fica como fallback documentado, não implementado.
- UI de correção manual das tags.

## Success demo

Done when uma licitação nova sincroniza, recebe CNAEs automaticamente via Ollama remoto, e o dashboard logado mostra o filtro "compatível com minha empresa" retornando essa licitação para uma empresa cujo `empresa_cnae` bate — e não retornando para uma empresa sem match.
