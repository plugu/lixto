// Abstract diagram of the funnel the agent runs: everything the PNCP publishes
// (dot field) -> leitura/análise (the sweeping lens) -> the few that fit (cards).
// Pure inline SVG, deterministic (no randomness, safe for SSR).

const COLS = 8;
const ROWS = 11;

// Dots that "survive" the funnel, picked by hand so the curves stay readable.
const PICKED = new Set([18, 41, 67]);

function dotPosition(index: number) {
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  return { x: 10 + col * 25, y: 26 + row * 29 };
}

export function HeroVisual() {
  const dots = Array.from({ length: COLS * ROWS }, (_, i) => i);
  const picked = [...PICKED];

  return (
    <svg
      viewBox="0 0 540 380"
      role="img"
      aria-label="Diagrama: o agente varre tudo o que o PNCP publica, lê os editais e entrega só as licitações que encaixam com a sua empresa."
      className="h-auto w-full max-w-[540px]"
    >
      <defs>
        <linearGradient id="lens" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5eead4" stopOpacity="0" />
          <stop offset="35%" stopColor="#5eead4" stopOpacity="0.55" />
          <stop offset="65%" stopColor="#5eead4" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#5eead4" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="thread" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#5eead4" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#5eead4" stopOpacity="0.7" />
        </linearGradient>
      </defs>

      {/* Field: everything published, undifferentiated. */}
      <g>
        {dots.map((i) => {
          const { x, y } = dotPosition(i);
          const on = PICKED.has(i);
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={on ? 8 : 6}
              height={on ? 8 : 6}
              rx="2"
              fill={on ? "#5eead4" : "#e2e8f0"}
              opacity={on ? 1 : 0.16 + ((i * 7) % 5) * 0.05}
            />
          );
        })}
        {picked.map((i) => {
          const { x, y } = dotPosition(i);
          return (
            <circle
              key={`halo-${i}`}
              cx={x + 4}
              cy={y + 4}
              r="10"
              fill="none"
              stroke="#5eead4"
              strokeWidth="1"
              opacity="0.35"
            />
          );
        })}
      </g>
      <text
        x="10"
        y="368"
        fill="#94a3b8"
        fontSize="11"
        letterSpacing="1.6"
        opacity="0.75"
      >
        TUDO QUE O PNCP PUBLICA
      </text>

      {/* Lens: the reading pass. */}
      <g>
        <rect
          x="246"
          y="20"
          width="2"
          height="330"
          fill="url(#lens)"
        />
        <g className="mkt-sweep">
          <rect x="214" y="20" width="66" height="2" rx="1" fill="#5eead4" />
          <circle cx="247" cy="21" r="4" fill="#5eead4" />
        </g>
        <text
          x="247"
          y="10"
          fill="#5eead4"
          fontSize="11"
          letterSpacing="1.6"
          textAnchor="middle"
          opacity="0.85"
        >
          LEITURA + FIT
        </text>
      </g>

      {/* Threads from the picked editais into the recommendations. */}
      <g fill="none" stroke="url(#thread)" strokeWidth="1.5">
        {picked.map((i, n) => {
          const { x, y } = dotPosition(i);
          const target = 92 + n * 96;
          return (
            <path
              key={i}
              d={`M${x + 10} ${y + 4} C 150 ${y + 4}, 190 ${target}, 330 ${target}`}
            />
          );
        })}
      </g>

      {/* The handful worth disputing. */}
      <g>
        {[0, 1, 2].map((n) => {
          const y = 92 + n * 96 - 33;
          return (
            <g key={n}>
              <rect
                x="330"
                y={y}
                width="200"
                height="66"
                rx="12"
                fill="#0c2320"
                stroke="#17403a"
              />
              <rect
                x="348"
                y={y + 21}
                width={104 - n * 16}
                height="7"
                rx="3.5"
                fill="#e2e8f0"
                opacity="0.55"
              />
              <rect
                x="348"
                y={y + 36}
                width={68 - n * 10}
                height="6"
                rx="3"
                fill="#e2e8f0"
                opacity="0.22"
              />
              <circle
                cx="494"
                cy={y + 33}
                r="15"
                fill="none"
                stroke="#17403a"
                strokeWidth="3"
              />
              <circle
                cx="494"
                cy={y + 33}
                r="15"
                fill="none"
                stroke="#5eead4"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={`${86 - n * 16} 200`}
                transform={`rotate(-90 494 ${y + 33})`}
              />
            </g>
          );
        })}
      </g>
      <text
        x="530"
        y="368"
        fill="#5eead4"
        fontSize="11"
        letterSpacing="1.6"
        textAnchor="end"
        opacity="0.85"
      >
        O QUE VALE DISPUTAR
      </text>
    </svg>
  );
}
