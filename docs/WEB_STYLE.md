# Dashboard style guide (cycle 2)

Reference: Amie (amie.so) hero — clean, flat, light, calm. Desktop-first.

## Layout

- Left sidebar 240px, `bg-gray-50`, right border `border-gray-200`; app name top, nav below ("Licitações" is the only real item this cycle).
- Main content on white, max-width ~1200px, `px-8 py-6`.
- No shadows heavier than `shadow-sm`; separation via 1px `gray-200` borders and whitespace.

## Type & color

- System font stack or Inter; base `text-sm` (14px), titles `text-lg font-semibold`, muted text `text-gray-500`.
- Background white; text `gray-900`; accent `blue-600` (links, active filter, primary button).
- Status badges (rounded-full, `text-xs font-medium`, soft backgrounds):
  - Aberta → `bg-green-100 text-green-800`
  - Vai abrir → `bg-amber-100 text-amber-800`
  - Fechada → `bg-gray-100 text-gray-600`

## Components

- List rows: full-width, `py-3`, bottom border, hover `bg-gray-50`, whole row clickable.
- Filters: compact selects/inputs in one toolbar row above the list, `rounded-lg border-gray-200 bg-white`; active filters visibly distinct.
- Tables (itens): header `text-xs uppercase text-gray-500`, row borders only, no zebra.
- Empty state: centered, muted icon-free text ("Nenhuma licitação encontrada").
- Detail page: title = objeto (clamped), metadata as label/value grid (`text-gray-500` labels), sections separated by headings, not cards.

## pt-BR conventions

- All UI strings pt-BR. Dates `dd/mm/aaaa` (with hour `dd/mm/aaaa HH:mm`); currency `R$ 1.234,56` (`Intl.NumberFormat('pt-BR', {style:'currency', currency:'BRL'})`).
- Labels: Palavra-chave, Portal, Modalidade, Status, Órgão, Município/UF, Valor estimado, Encerramento, Abertura, Objeto, Itens, Edital, Anexos, Publicação.
- Status values: "Aberta", "Vai abrir", "Fechada".
