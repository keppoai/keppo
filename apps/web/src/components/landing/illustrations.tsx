/**
 * Hand-crafted SVG illustrations for the landing page.
 * These are bespoke, not stock — they match Keppo's sage green palette
 * and have an indie, hand-drawn quality.
 */

/** A person at a desk with floating automation icons — used in the hero area or bento */
export function AutomationBuilderIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 280 200" fill="none" className={className}>
      {/* Desk */}
      <rect x="60" y="140" width="160" height="8" rx="4" fill="currentColor" opacity="0.08" />

      {/* Laptop */}
      <rect x="95" y="100" width="90" height="56" rx="6" fill="currentColor" opacity="0.06" />
      <rect x="100" y="105" width="80" height="42" rx="3" fill="currentColor" opacity="0.04" />
      {/* Screen content lines */}
      <rect x="108" y="114" width="40" height="3" rx="1.5" fill="currentColor" opacity="0.12" />
      <rect x="108" y="121" width="56" height="3" rx="1.5" fill="currentColor" opacity="0.08" />
      <rect x="108" y="128" width="32" height="3" rx="1.5" fill="currentColor" opacity="0.1" />
      {/* Keyboard base */}
      <path d="M85 156h110l-5-12H90l-5 12z" fill="currentColor" opacity="0.06" />

      {/* Person — simple abstract figure */}
      {/* Head */}
      <circle cx="140" cy="72" r="14" fill="currentColor" opacity="0.1" />
      {/* Body */}
      <path d="M126 86c0 0 4 14 14 14s14-14 14-14" fill="currentColor" opacity="0.07" />

      {/* Floating icons — automation symbols */}
      {/* Email envelope — top left */}
      <g transform="translate(40, 50)">
        <rect width="28" height="22" rx="4" fill="currentColor" opacity="0.08" />
        <path
          d="M4 6l10 7 10-7"
          stroke="currentColor"
          opacity="0.15"
          strokeWidth="1.5"
          fill="none"
        />
      </g>

      {/* Lightning bolt — top right */}
      <g transform="translate(210, 45)">
        <circle cx="12" cy="12" r="12" fill="currentColor" opacity="0.06" />
        <path
          d="M14 6l-4 7h5l-4 7"
          stroke="currentColor"
          opacity="0.2"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>

      {/* Shield/check — right */}
      <g transform="translate(220, 100)">
        <circle cx="10" cy="10" r="10" fill="currentColor" opacity="0.06" />
        <path
          d="M7 10l2 2 4-4"
          stroke="currentColor"
          opacity="0.2"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>

      {/* Chat bubble — left */}
      <g transform="translate(30, 105)">
        <rect width="24" height="18" rx="4" fill="currentColor" opacity="0.06" />
        <path d="M8 20l4-4" stroke="currentColor" opacity="0.06" strokeWidth="2" />
        <rect x="6" y="6" width="12" height="2" rx="1" fill="currentColor" opacity="0.1" />
        <rect x="6" y="10" width="8" height="2" rx="1" fill="currentColor" opacity="0.08" />
      </g>

      {/* Connection lines — dashed arcs */}
      <path
        d="M68 62 Q 95 40 130 65"
        stroke="currentColor"
        opacity="0.06"
        strokeWidth="1"
        strokeDasharray="3 3"
        fill="none"
      />
      <path
        d="M210 58 Q 185 45 155 65"
        stroke="currentColor"
        opacity="0.06"
        strokeWidth="1"
        strokeDasharray="3 3"
        fill="none"
      />
      <path
        d="M54 118 Q 80 100 120 105"
        stroke="currentColor"
        opacity="0.06"
        strokeWidth="1"
        strokeDasharray="3 3"
        fill="none"
      />
      <path
        d="M220 112 Q 200 100 185 105"
        stroke="currentColor"
        opacity="0.06"
        strokeWidth="1"
        strokeDasharray="3 3"
        fill="none"
      />
    </svg>
  );
}

/** A trust/approval flow — shield with checkmarks flowing through gates */
export function TrustFlowIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 240 120" fill="none" className={className}>
      {/* Flow line */}
      <path
        d="M20 60 H220"
        stroke="currentColor"
        opacity="0.06"
        strokeWidth="2"
        strokeDasharray="4 4"
      />

      {/* Gate 1: Action */}
      <g transform="translate(30, 38)">
        <rect width="44" height="44" rx="10" fill="currentColor" opacity="0.05" />
        <path d="M16 54l6 6 10-12" stroke="currentColor" opacity="0" />
        <circle cx="22" cy="22" r="8" fill="currentColor" opacity="0.08" />
        <path
          d="M19 22l2 2 4-4"
          stroke="currentColor"
          opacity="0.2"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
        />
      </g>

      {/* Arrow */}
      <path
        d="M82 60 l8 0 -3 -3 M90 60 l-3 3"
        stroke="currentColor"
        opacity="0.12"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />

      {/* Gate 2: Rule check */}
      <g transform="translate(98, 38)">
        <rect width="44" height="44" rx="10" fill="currentColor" opacity="0.07" />
        <rect x="12" y="14" width="20" height="3" rx="1.5" fill="currentColor" opacity="0.12" />
        <rect x="12" y="20" width="14" height="3" rx="1.5" fill="currentColor" opacity="0.08" />
        <rect x="12" y="26" width="18" height="3" rx="1.5" fill="currentColor" opacity="0.1" />
      </g>

      {/* Arrow */}
      <path
        d="M150 60 l8 0 -3 -3 M158 60 l-3 3"
        stroke="currentColor"
        opacity="0.12"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />

      {/* Gate 3: Approved */}
      <g transform="translate(166, 38)">
        <rect width="44" height="44" rx="10" fill="currentColor" opacity="0.09" />
        <circle cx="22" cy="22" r="10" fill="currentColor" opacity="0.08" />
        <path
          d="M17 22l4 4 7-8"
          stroke="currentColor"
          opacity="0.25"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>

      {/* Labels */}
      <text
        x="52"
        y="98"
        textAnchor="middle"
        fill="currentColor"
        opacity="0.2"
        fontSize="8"
        fontWeight="500"
      >
        Action
      </text>
      <text
        x="120"
        y="98"
        textAnchor="middle"
        fill="currentColor"
        opacity="0.2"
        fontSize="8"
        fontWeight="500"
      >
        Rules
      </text>
      <text
        x="188"
        y="98"
        textAnchor="middle"
        fill="currentColor"
        opacity="0.2"
        fontSize="8"
        fontWeight="500"
      >
        Approved
      </text>
    </svg>
  );
}

/** Wide "plain English to automation" illustration for bento card 01 */
export function PlainEnglishIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 120" fill="none" className={className}>
      {/* ── Left side: Chat bubble (the prompt) ── */}
      <rect x="8" y="8" width="130" height="56" rx="12" fill="currentColor" opacity="0.15" />
      <path d="M30 64 L24 76 L42 64" fill="currentColor" opacity="0.15" />
      {/* Text lines inside bubble */}
      <rect x="20" y="20" width="90" height="5" rx="2.5" fill="currentColor" opacity="0.35" />
      <rect x="20" y="30" width="65" height="5" rx="2.5" fill="currentColor" opacity="0.25" />
      <rect x="20" y="40" width="78" height="5" rx="2.5" fill="currentColor" opacity="0.3" />

      {/* ── Arrow ── */}
      <line
        x1="150"
        y1="40"
        x2="188"
        y2="40"
        stroke="currentColor"
        opacity="0.45"
        strokeWidth="2"
        strokeDasharray="5 4"
      />
      <path
        d="M184 34 L194 40 L184 46"
        stroke="currentColor"
        opacity="0.45"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* ── Right side: Three stacked output cards ── */}
      {/* Card 1: Trigger */}
      <g transform="translate(206, 4)">
        <rect width="180" height="32" rx="8" fill="currentColor" opacity="0.12" />
        <circle cx="18" cy="16" r="8" fill="currentColor" opacity="0.2" />
        <path
          d="M15 14l-2 4h5l-2 4"
          stroke="currentColor"
          opacity="0.7"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <text x="32" y="14" fill="currentColor" opacity="0.7" fontSize="8" fontWeight="700">
          TRIGGER
        </text>
        <text x="32" y="24" fill="currentColor" opacity="0.45" fontSize="7.5">
          Stripe refund created
        </text>
      </g>

      {/* Card 2: Action */}
      <g transform="translate(206, 42)">
        <rect width="180" height="32" rx="8" fill="currentColor" opacity="0.12" />
        <circle cx="18" cy="16" r="8" fill="currentColor" opacity="0.2" />
        <rect x="12" y="12" width="12" height="2.5" rx="1" fill="currentColor" opacity="0.5" />
        <rect x="12" y="16" width="8" height="2.5" rx="1" fill="currentColor" opacity="0.35" />
        <text x="32" y="14" fill="currentColor" opacity="0.7" fontSize="8" fontWeight="700">
          ACTION
        </text>
        <text x="32" y="24" fill="currentColor" opacity="0.45" fontSize="7.5">
          Send Slack message
        </text>
      </g>

      {/* Card 3: Approve */}
      <g transform="translate(206, 80)">
        <rect width="180" height="32" rx="8" fill="currentColor" opacity="0.15" />
        <circle cx="18" cy="16" r="8" fill="currentColor" opacity="0.25" />
        <path
          d="M14 16l3 3 5-6"
          stroke="currentColor"
          opacity="0.8"
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <text x="32" y="14" fill="currentColor" opacity="0.7" fontSize="8" fontWeight="700">
          APPROVE
        </text>
        <text x="32" y="24" fill="currentColor" opacity="0.45" fontSize="7.5">
          Auto-approved by rule
        </text>
      </g>

      {/* Connector dots between cards */}
      <circle cx="296" cy="37" r="2" fill="currentColor" opacity="0.15" />
      <line
        x1="296"
        y1="37"
        x2="296"
        y2="42"
        stroke="currentColor"
        opacity="0.12"
        strokeWidth="1"
      />
      <circle cx="296" cy="75" r="2" fill="currentColor" opacity="0.15" />
      <line
        x1="296"
        y1="75"
        x2="296"
        y2="80"
        stroke="currentColor"
        opacity="0.12"
        strokeWidth="1"
      />
    </svg>
  );
}

/** A cozy workspace scene — for the creator note section */
export function CreatorIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" fill="none" className={className}>
      {/* Coffee mug */}
      <rect x="10" y="35" width="20" height="24" rx="4" fill="currentColor" opacity="0.08" />
      <path
        d="M30 42 Q38 42 38 50 Q38 58 30 58"
        stroke="currentColor"
        opacity="0.06"
        strokeWidth="2"
        fill="none"
      />
      {/* Steam */}
      <path
        d="M16 32 Q18 26 16 20"
        stroke="currentColor"
        opacity="0.06"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M22 30 Q24 24 22 18"
        stroke="currentColor"
        opacity="0.04"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />

      {/* Small plant */}
      <rect x="52" y="45" width="16" height="18" rx="3" fill="currentColor" opacity="0.06" />
      <path
        d="M60 45 Q56 35 50 32"
        stroke="currentColor"
        opacity="0.1"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M60 42 Q64 32 70 30"
        stroke="currentColor"
        opacity="0.08"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M60 38 Q58 30 60 24"
        stroke="currentColor"
        opacity="0.1"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
