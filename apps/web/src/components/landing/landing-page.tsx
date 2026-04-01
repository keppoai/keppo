import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Clock,
  Eye,
  Github,
  MessageSquare,
  Monitor,
  Moon,
  Shield,
  Sparkles,
  Sun,
  Zap,
} from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { KeppoWordmark } from "./keppo-logo";
import { PromptDemo } from "./prompt-demo";
import {
  TrustFlowIllustration,
  CreatorIllustration,
  PlainEnglishIllustration,
} from "./illustrations";

// ---------------------------------------------------------------------------
// Provider icons (inline SVGs — same as provider-icons.tsx but no auth import)
// ---------------------------------------------------------------------------

function SlackMini() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-8">
      <path
        d="M6.527 14.514a1.636 1.636 0 1 1-1.636-1.636h1.636v1.636Zm.818 0a1.636 1.636 0 1 1 3.273 0v4.09a1.636 1.636 0 1 1-3.273 0v-4.09Z"
        fill="#E01E5A"
      />
      <path
        d="M9.482 6.527a1.636 1.636 0 1 1 1.636-1.636v1.636H9.482Zm0 .818a1.636 1.636 0 0 1 0 3.273H5.39a1.636 1.636 0 1 1 0-3.273h4.091Z"
        fill="#36C5F0"
      />
      <path
        d="M17.468 9.482a1.636 1.636 0 1 1 1.636 1.636h-1.636V9.482Zm-.818 0a1.636 1.636 0 0 1-3.273 0V5.39a1.636 1.636 0 1 1 3.273 0v4.091Z"
        fill="#2EB67D"
      />
      <path
        d="M14.514 17.468a1.636 1.636 0 1 1-1.636 1.636v-1.636h1.636Zm0-.818a1.636 1.636 0 0 1 0-3.273h4.09a1.636 1.636 0 0 1 0 3.273h-4.09Z"
        fill="#ECB22E"
      />
    </svg>
  );
}

function StripeMini() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-8">
      <rect width="24" height="24" rx="4" fill="#635BFF" />
      <path
        d="M11.2 9.65c0-.68.56-.94 1.49-.94.97 0 2.2.3 3.17.82V6.66a8.5 8.5 0 0 0-3.17-.6c-2.6 0-4.32 1.35-4.32 3.62 0 3.53 4.86 2.97 4.86 4.49 0 .8-.7 1.06-1.67 1.06-1.44 0-2.84-.6-3.82-1.4v2.93a8.84 8.84 0 0 0 3.82.87c2.66 0 4.49-1.32 4.49-3.61-.01-3.81-4.85-3.13-4.85-4.47Z"
        fill="#fff"
      />
    </svg>
  );
}

function GitHubMini() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-8">
      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.341-3.369-1.341-.454-1.155-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10Z" />
    </svg>
  );
}

function GmailMini() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-8">
      <path
        d="M2 6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6Z"
        fill="#fff"
      />
      <path d="M2 6l10 7 10-7" stroke="#EA4335" strokeWidth="1.5" />
      <path d="M2 6v12a2 2 0 0 0 2 2h1V8.5L2 6Z" fill="#4285F4" />
      <path d="M22 6v12a2 2 0 0 1-2 2h-1V8.5L22 6Z" fill="#34A853" />
      <path d="M5 20h14V8.5L12 13 5 8.5V20Z" fill="#F9F9F9" />
      <path d="M2 6l3 2.5V4H4a2 2 0 0 0-2 2Z" fill="#C5221F" />
      <path d="M22 6l-3 2.5V4h1a2 2 0 0 1 2 2Z" fill="#FBBC04" />
    </svg>
  );
}

function NotionMini() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-8">
      <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L18.08 2.18c-.42-.326-.98-.7-2.055-.607L3.01 2.7c-.467.047-.56.28-.374.466l1.823 1.042Zm.793 3.358v13.886c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.166V6.63c0-.606-.234-.933-.748-.886l-15.177.886c-.56.047-.747.327-.747.933Zm14.337.42c.094.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.934l-4.577-7.186v6.952l1.449.327s0 .84-1.168.84l-3.222.187c-.093-.187 0-.654.327-.747l.84-.22V8.744l-1.168-.093c-.094-.42.14-1.026.793-1.073l3.456-.234 4.764 7.28v-6.44l-1.215-.14c-.093-.514.28-.886.747-.933l3.222-.187Z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Theme toggle
// ---------------------------------------------------------------------------

function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [open, setOpen] = useState(false);

  const items = [
    { value: "light", icon: Sun, label: "Light" },
    { value: "dark", icon: Moon, label: "Dark" },
    { value: "system", icon: Monitor, label: "System" },
  ] as const;

  const CurrentIcon = resolvedTheme === "dark" ? Moon : Sun;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center justify-center size-8 rounded-lg text-muted-foreground hover:text-foreground transition-colors"
        title="Theme"
      >
        <CurrentIcon className="size-4" />
      </button>
      {open ? (
        <>
          {/* Backdrop to close */}
          <button
            type="button"
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-label="Close theme menu"
          />
          <div className="absolute right-0 top-10 z-50 flex flex-col gap-1 rounded-xl border bg-card p-1.5 shadow-lg ring-1 ring-foreground/[0.06]">
            {items.map(({ value, icon: Icon, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setTheme(value);
                  setOpen(false);
                }}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors",
                  theme === value
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                )}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Glow card wrapper
// ---------------------------------------------------------------------------

function GlowCard({
  children,
  className,
  glowColor = "from-primary/15 to-secondary/10",
}: {
  children: React.ReactNode;
  className?: string;
  glowColor?: string;
}) {
  return (
    <div className="relative group/card h-full">
      <div
        className={`absolute -inset-px rounded-[18px] bg-gradient-to-br ${glowColor} opacity-0 group-hover/card:opacity-100 blur-sm transition-opacity duration-300`}
      />
      <div
        className={`relative rounded-2xl border bg-card/70 backdrop-blur-sm shadow-sm ring-1 ring-foreground/[0.04] transition-all duration-300 group-hover/card:-translate-y-0.5 group-hover/card:shadow-md h-full ${className ?? ""}`}
      >
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FAQ item
// ---------------------------------------------------------------------------

function FAQItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  const prefersReducedMotion = useReducedMotion();

  return (
    <div className="border-b border-foreground/[0.06] last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between py-5 text-left text-[17px] font-medium text-foreground hover:text-foreground/80 transition-colors"
      >
        {question}
        <ChevronDown
          className={`size-4 text-muted-foreground/50 shrink-0 ml-4 transition-transform duration-300 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="content"
            {...(prefersReducedMotion
              ? {}
              : {
                  initial: { height: 0, opacity: 0 },
                  animate: { height: "auto", opacity: 1 },
                  exit: { height: 0, opacity: 0 },
                  transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] },
                })}
            className="overflow-hidden"
          >
            <p className="pb-5 text-[15px] text-muted-foreground leading-relaxed">{answer}</p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section with fade-in
// ---------------------------------------------------------------------------

function Section({
  children,
  className,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  const prefersReducedMotion = useReducedMotion();
  return (
    <motion.section
      id={id}
      className={className}
      {...(prefersReducedMotion
        ? {}
        : {
            initial: { opacity: 0, y: 24 },
            whileInView: { opacity: 1, y: 0 },
            viewport: { once: true, margin: "-60px" },
            transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] },
          })}
    >
      {children}
    </motion.section>
  );
}

// ---------------------------------------------------------------------------
// Main landing page
// ---------------------------------------------------------------------------

const NAV_SECTIONS = ["how-it-works", "integrations", "pricing", "open-source", "faq"] as const;

function useActiveSection() {
  const [active, setActive] = useState("");
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      { rootMargin: "-40% 0px -40% 0px", threshold: 0 },
    );
    for (const id of NAV_SECTIONS) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);
  return active;
}

function smoothScrollTo(id: string) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function LandingPage() {
  const activeSection = useActiveSection();
  const handlePromptSubmit = useCallback((prompt: string) => {
    const encoded = encodeURIComponent(prompt);
    window.location.href = `/login?prompt=${encoded}`;
  }, []);

  const navLink = (id: string, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => smoothScrollTo(id)}
      className={cn(
        "transition-colors duration-200",
        activeSection === id ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-svh bg-background text-foreground overflow-x-hidden scroll-smooth">
      {/* ── Nav ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-foreground/[0.06] bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
          <KeppoWordmark />

          <div className="hidden items-center gap-7 text-[13px] font-medium lg:flex">
            {navLink("how-it-works", "How it works")}
            {navLink("integrations", "Integrations")}
            {navLink("pricing", "Pricing")}
            {navLink("open-source", "Open source")}
            {navLink("faq", "FAQ")}
          </div>

          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Button variant="ghost" size="sm" render={<a href="/docs" />}>
              Docs
            </Button>
            <Button
              variant="ghost"
              size="sm"
              render={
                <a
                  href="https://github.com/keppoai/keppo"
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              <Github className="size-4" data-icon="inline-start" />
              GitHub
            </Button>
            <Button size="sm" render={<Link to="/login" />}>
              Get started
              <ArrowRight className="size-3.5" data-icon="inline-end" />
            </Button>
          </div>
        </div>
      </nav>

      {/* ── Hero — Bold sage green, split layout ── */}
      <section className="landing-hero-bg min-h-svh flex items-center pt-14">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:py-20 w-full">
          <div className="grid gap-10 lg:grid-cols-[1fr_auto] lg:items-center lg:gap-16">
            {/* Left: text + prompt */}
            <div className="min-w-0">
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-xs font-medium text-white/80 mb-6"
              >
                <Shield className="size-3" />
                Open-source AI automation platform
              </motion.div>

              <motion.h1
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.6,
                  delay: 0.2,
                  ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
                }}
                className="text-4xl font-extrabold tracking-[-0.03em] text-white sm:text-6xl lg:text-[4.5rem] lg:leading-[1.08]"
              >
                AI automations
                <br />
                you can trust
              </motion.h1>

              <motion.p
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.35 }}
                className="mt-4 text-base text-white/70 leading-relaxed max-w-md sm:text-lg"
              >
                Describe it in plain English. Approve what matters. Automate the rest.
              </motion.p>

              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.5 }}
                className="mt-8"
              >
                <PromptDemo onSubmit={handlePromptSubmit} />
              </motion.div>

              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.7 }}
                className="mt-4 text-[13px] text-white/50 font-medium"
              >
                No credit card required. Free to start. Open-source.
              </motion.p>
            </div>

            {/* Right: illustration */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.7, delay: 0.4 }}
              className="hidden lg:block"
            >
              <img
                src="/illustrations/hero-safety-net.png"
                alt="Safety net catching AI actions"
                className="w-[320px] xl:w-[380px] rounded-2xl"
                loading="eager"
              />
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── How It Works — Bento Grid (white) ── */}
      <Section id="how-it-works" className="py-20 sm:py-28">
        <div className="relative mx-auto max-w-6xl px-5">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
              Automate anything. <span className="text-primary">Approve everything.</span>
            </h2>
            <p className="mt-4 text-muted-foreground text-lg max-w-2xl mx-auto">
              Keppo lets AI handle the busywork while you keep control over the actions that matter.
            </p>
          </div>

          {/* Bento grid — items-stretch so all cards in a row match height */}
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-6 items-stretch">
            {/* Large card — spans 4 cols — with mini UI mockup */}
            <div className="sm:col-span-4">
              <GlowCard className="p-6 h-full overflow-hidden flex flex-col">
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary/15 to-primary/5 text-primary">
                    <Sparkles className="size-4" />
                  </div>
                  <span className="text-[10px] font-bold text-primary/40 font-mono tracking-wider">
                    01
                  </span>
                </div>
                <h3 className="text-xl font-semibold mb-1.5">Describe it in plain English</h3>
                <p className="text-muted-foreground leading-relaxed text-[15px] mb-4">
                  Tell Keppo what you want. It figures out the trigger, steps, and tools.
                </p>
                {/* Illustration fills remaining space */}
                <div className="flex-1 flex items-end mt-2">
                  <PlainEnglishIllustration className="w-full text-primary" />
                </div>
              </GlowCard>
            </div>

            {/* Small card — spans 2 cols — with mini logo grid */}
            <div className="sm:col-span-2">
              <GlowCard className="p-6 h-full" glowColor="from-secondary/15 to-primary/10">
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-gradient-to-br from-secondary/15 to-secondary/5 text-secondary">
                    <Zap className="size-4" />
                  </div>
                  <span className="text-[10px] font-bold text-secondary/40 font-mono tracking-wider">
                    02
                  </span>
                </div>
                <h3 className="text-lg font-semibold mb-1.5">Connect your tools</h3>
                <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                  Stripe, Slack, Gmail, GitHub, Notion — OAuth in 30 seconds.
                </p>
                <img
                  src="/illustrations/connect-tools.png"
                  alt="Services connected to a central laptop hub"
                  className="w-full max-w-[160px] rounded-lg"
                  loading="lazy"
                />
              </GlowCard>
            </div>

            {/* Medium card — spans 3 cols — with mini approval UI */}
            <div className="sm:col-span-3">
              <GlowCard className="p-6 h-full" glowColor="from-primary/10 to-secondary/15">
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary/15 to-primary/5 text-primary">
                    <Shield className="size-4" />
                  </div>
                  <span className="text-[10px] font-bold text-primary/40 font-mono tracking-wider">
                    03
                  </span>
                </div>
                <h3 className="text-lg font-semibold mb-1.5">Stay in control</h3>
                <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                  Every action needs your approval. Set rules for what's safe.
                </p>
                {/* Mini approval mockup */}
                <div className="rounded-lg border border-foreground/[0.06] bg-background/60 p-3 text-xs">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-foreground/70">Stripe refund — $450</span>
                    <span className="text-[10px] text-muted-foreground/50">Pending</span>
                  </div>
                  <div className="flex gap-1.5">
                    <span className="rounded-md bg-primary/10 text-primary px-2 py-0.5 font-medium">
                      Approve
                    </span>
                    <span className="rounded-md bg-muted text-muted-foreground px-2 py-0.5">
                      Deny
                    </span>
                  </div>
                </div>
              </GlowCard>
            </div>

            {/* Medium card — spans 3 cols — with mini audit trail */}
            <div className="sm:col-span-3">
              <GlowCard className="p-6 h-full" glowColor="from-secondary/10 to-primary/10">
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-gradient-to-br from-secondary/15 to-secondary/5 text-secondary">
                    <Eye className="size-4" />
                  </div>
                  <span className="text-[10px] font-bold text-secondary/40 font-mono tracking-wider">
                    04
                  </span>
                </div>
                <h3 className="text-lg font-semibold mb-1.5">See everything</h3>
                <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                  Full audit trail. What triggered it, which rules ran, who approved.
                </p>
                {/* Mini timeline mockup */}
                <div className="rounded-lg border border-foreground/[0.06] bg-background/60 p-3 text-xs space-y-1.5">
                  <div className="flex items-center gap-2">
                    <div className="size-1.5 rounded-full bg-secondary" />
                    <span className="text-foreground/60">Trigger fired</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="size-1.5 rounded-full bg-primary" />
                    <span className="text-foreground/60">Rule matched</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="size-1.5 rounded-full bg-primary" />
                    <span className="text-foreground/60">Auto-approved</span>
                  </div>
                </div>
              </GlowCard>
            </div>
          </div>

          {/* Mid-page CTA */}
          <div className="mt-10 text-center">
            <Button size="lg" render={<Link to="/login" />}>
              Start automating
              <ArrowRight className="size-4" data-icon="inline-end" />
            </Button>
            <p className="mt-3 text-xs text-muted-foreground/50">Free to start. No credit card.</p>
          </div>
        </div>
      </Section>

      {/* ── Action Timeline (bold green) ── */}
      <Section className="landing-green-bg py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-5">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
            <div>
              <div className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium text-white/80 mb-5">
                <Eye className="size-3" />
                Full transparency
              </div>
              <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                Know exactly what happened and why
              </h2>
              <p className="mt-4 text-white/70 text-lg leading-relaxed">
                Every action comes with a full decision chain. No black boxes. No "it just worked."
                You can see the entire reasoning — and share it.
              </p>
              <ul className="mt-6 space-y-3">
                {[
                  "Full audit trail for every action",
                  "See exactly which rule approved or blocked",
                  "Share with your team or your accountant",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-white/70">
                    <div className="flex size-5 items-center justify-center rounded-full bg-white/15 text-white mt-0.5 shrink-0">
                      <Check className="size-3" />
                    </div>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <TimelineMockup />
          </div>
        </div>
      </Section>

      {/* ── Rules (cream) ── */}
      <Section className="landing-cream-bg py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-5">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
            <div className="order-2 lg:order-1">
              <RuleMockup />
            </div>
            <div className="order-1 lg:order-2">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-foreground/[0.06] bg-card/50 px-3 py-1 text-xs font-medium text-secondary mb-5">
                <Sparkles className="size-3" />
                AI-powered rules
              </div>
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                Write rules in plain English.{" "}
                <span className="text-primary">They run like code.</span>
              </h2>
              <p className="mt-4 text-muted-foreground text-lg leading-relaxed">
                Tell Keppo what's safe to auto-approve. It creates rock-solid rules that run the
                same way every time.
              </p>
              <p className="mt-3 text-sm text-muted-foreground/60 leading-relaxed">
                The AI helps you{" "}
                <em className="text-foreground/70 not-italic font-medium">write</em> rules. But at
                runtime, it's pure logic — deterministic, auditable, no hallucinations. That's what
                "trust" means.
              </p>

              {/* Rule simulation illustration — below text, balanced */}
              <img
                src="/illustrations/rule-simulation.png"
                alt="Rule simulation: 12 approved, 3 blocked"
                className="mt-6 w-full max-w-[200px] rounded-lg"
                loading="lazy"
              />
            </div>
          </div>
        </div>
      </Section>

      {/* ── Integrations (white) ── */}
      <Section id="integrations" className="py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-5 text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
            Connects to the tools you already use
          </h2>
          <p className="mt-4 text-muted-foreground text-lg">
            Plus any MCP-compatible server you want to add.
          </p>

          <div className="mx-auto mt-12 grid grid-cols-3 gap-3 max-w-md sm:grid-cols-5 sm:max-w-2xl">
            {[
              { name: "Slack", icon: SlackMini, desc: "Messaging" },
              { name: "Stripe", icon: StripeMini, desc: "Payments" },
              { name: "GitHub", icon: GitHubMini, desc: "Code" },
              { name: "Gmail", icon: GmailMini, desc: "Email" },
              { name: "Notion", icon: NotionMini, desc: "Docs" },
            ].map(({ name, icon: Icon, desc }) => (
              <GlowCard key={name} className="py-5 px-3 flex flex-col items-center gap-2">
                <Icon />
                <div className="text-center">
                  <span className="text-sm font-medium text-foreground/80 block">{name}</span>
                  <span className="text-[11px] text-muted-foreground/50">{desc}</span>
                </div>
              </GlowCard>
            ))}
          </div>

          <p className="mt-8 text-sm text-muted-foreground/50">
            Reddit, X, and custom MCP servers also supported.{" "}
            <span className="text-foreground/60 font-medium">More coming soon.</span>
          </p>
        </div>
      </Section>

      {/* ── Pricing (bold green) ── */}
      <Section id="pricing" className="landing-green-bg py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-5">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
              Simple pricing. Start free.
            </h2>
            <p className="mt-4 text-white/70 text-lg">
              No credit card required. Upgrade when you're ready.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3 max-w-4xl mx-auto">
            {/* Free */}
            <GlowCard className="p-6">
              <div className="mb-5">
                <h3 className="text-lg font-semibold">Free</h3>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-3xl font-bold">$0</span>
                  <span className="text-sm text-muted-foreground">/month</span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">Everything you need to start.</p>
              </div>
              <ul className="space-y-2.5 text-sm mb-6">
                {[
                  "2 automations",
                  "150 runs / month",
                  "5 AI credits",
                  "All integrations",
                  "7-day log retention",
                  "Community support",
                ].map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <Check className="size-3.5 text-primary shrink-0" />
                    <span className="text-foreground/80">{f}</span>
                  </li>
                ))}
              </ul>
              <Button variant="outline" className="w-full" render={<Link to="/login" />}>
                Get started
              </Button>
            </GlowCard>

            {/* Starter — highlighted */}
            <div className="relative">
              <div className="absolute -inset-px rounded-[18px] bg-gradient-to-b from-primary/30 to-primary/10" />
              <div className="relative rounded-2xl border-0 bg-card p-6 ring-2 ring-primary/20 h-full flex flex-col">
                <div className="mb-5">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-lg font-semibold">Starter</h3>
                    <span className="rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                      Popular
                    </span>
                  </div>
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="text-3xl font-bold">$25</span>
                    <span className="text-sm text-muted-foreground">/month</span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    For teams that run on autopilot.
                  </p>
                </div>
                <ul className="space-y-2.5 text-sm mb-6 flex-1">
                  {[
                    "5 automations",
                    "1,500 runs / month",
                    "100 AI credits",
                    "AI-powered rule authoring",
                    "30-day log retention",
                    "Up to 2 team members",
                  ].map((f) => (
                    <li key={f} className="flex items-center gap-2">
                      <Check className="size-3.5 text-primary shrink-0" />
                      <span className="text-foreground/80">{f}</span>
                    </li>
                  ))}
                </ul>
                <Button className="w-full" render={<Link to="/login" />}>
                  Get started
                </Button>
              </div>
            </div>

            {/* Pro */}
            <GlowCard className="p-6">
              <div className="mb-5">
                <h3 className="text-lg font-semibold">Pro</h3>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-3xl font-bold">$75</span>
                  <span className="text-sm text-muted-foreground">/month</span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">For growing teams.</p>
              </div>
              <ul className="space-y-2.5 text-sm mb-6">
                {[
                  "25 automations",
                  "15,000 runs / month",
                  "300 AI credits",
                  "Unlimited team members",
                  "90-day log retention",
                  "Priority support",
                ].map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <Check className="size-3.5 text-primary shrink-0" />
                    <span className="text-foreground/80">{f}</span>
                  </li>
                ))}
              </ul>
              <Button variant="outline" className="w-full" render={<Link to="/login" />}>
                Get started
              </Button>
            </GlowCard>
          </div>
        </div>
      </Section>

      {/* ── Open Source (cream) ── */}
      <Section id="open-source" className="landing-cream-bg py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-5">
          <div className="mx-auto max-w-2xl text-center mb-14">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
              Open-source. <span className="text-primary">Self-hostable.</span>
            </h2>
            <p className="mt-4 text-muted-foreground text-lg">
              The safety layer that protects your business shouldn't be a black box.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {[
              {
                icon: Eye,
                title: "Transparent",
                description:
                  "Read every line of code that decides what gets approved. No hidden logic.",
                glow: "from-primary/15 to-primary/5",
              },
              {
                icon: Shield,
                title: "Self-hostable",
                description:
                  "Run Keppo on your own infrastructure with Docker. Your data never leaves.",
                glow: "from-secondary/10 to-primary/10",
              },
              {
                icon: MessageSquare,
                title: "Community-driven",
                description: "Built in the open. Feature requests, bug reports, and PRs welcome.",
                glow: "from-primary/10 to-secondary/15",
              },
            ].map((item) => (
              <GlowCard key={item.title} className="p-6" glowColor={item.glow}>
                <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary/12 to-primary/4 text-primary mb-4">
                  <item.icon className="size-5" />
                </div>
                <h3 className="text-base font-semibold mb-2">{item.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{item.description}</p>
              </GlowCard>
            ))}
          </div>

          <div className="mt-10 text-center">
            <Button
              variant="outline"
              size="lg"
              render={
                <a
                  href="https://github.com/keppoai/keppo"
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              <Github className="size-4" data-icon="inline-start" />
              View on GitHub
            </Button>
          </div>
        </div>
      </Section>

      {/* ── Creator Note ── */}
      <Section className="py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-5">
          <div className="mx-auto max-w-2xl">
            <GlowCard
              className="p-8 sm:p-10"
              glowColor="from-primary/10 via-secondary/8 to-primary/10"
            >
              <div className="flex items-center gap-4 mb-6">
                <div className="relative flex size-14 items-center justify-center rounded-full bg-gradient-to-br from-primary/15 to-primary/5 text-primary ring-2 ring-primary/10 overflow-hidden">
                  <CreatorIllustration className="absolute inset-0 w-full h-full" />
                  <span className="relative font-bold text-lg">WC</span>
                </div>
                <div>
                  <p className="font-semibold text-foreground">Will Chen</p>
                  <p className="text-sm text-muted-foreground/60">Creator of Keppo</p>
                </div>
              </div>
              <blockquote className="space-y-4 text-[15px] text-muted-foreground/80 leading-[1.7]">
                <p>
                  "I built Keppo because I kept running into the same problem: AI agents are
                  incredibly capable, but I couldn't let them{" "}
                  <em className="text-foreground font-medium not-italic">do</em> anything important
                  without babysitting every single action.
                </p>
                <p>
                  The existing automation tools weren't built for this. They assume a human set up
                  the workflow, so every step is predictable. But with AI, the agent decides what to
                  do based on context. That's powerful, but you need a different kind of safety net.
                </p>
                <p>
                  I made it open-source because{" "}
                  <em className="text-foreground font-medium not-italic">
                    trust has to be earned, not claimed
                  </em>
                  . If we're going to promise that your AI automations are safe, you should be able
                  to verify that yourself."
                </p>
              </blockquote>
            </GlowCard>
          </div>
        </div>
      </Section>

      {/* ── FAQ (cream) ── */}
      <Section id="faq" className="landing-cream-bg py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-5">
          <h2 className="text-3xl font-bold tracking-tight text-center mb-14 sm:text-4xl">
            Questions? <span className="text-muted-foreground/50">Answers.</span>
          </h2>

          <div className="mx-auto max-w-2xl">
            {FAQ_ITEMS.map((item) => (
              <FAQItem key={item.question} {...item} />
            ))}
          </div>
        </div>
      </Section>

      {/* ── Final CTA (bold green) ── */}
      <section className="landing-green-bg py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-5 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
            Start automating. Stay in control.
          </h2>
          <p className="mt-4 text-white/70 text-lg">
            Describe your first automation and Keppo will set it up.
          </p>

          <div className="mt-10">
            <PromptDemo onSubmit={handlePromptSubmit} />
          </div>

          <p className="mt-6 text-[13px] text-white/50 font-medium">
            Free to start. No credit card. Open-source.
          </p>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-foreground/[0.06] py-10">
        <div className="mx-auto max-w-6xl px-5">
          <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
            <div className="flex flex-col items-center gap-2 sm:items-start">
              <KeppoWordmark className="opacity-60" />
              <p className="text-xs text-muted-foreground/40">&copy; 2026 Dyad Tech, Inc.</p>
            </div>
            <div className="flex items-center gap-5 text-sm text-muted-foreground">
              <a
                href="https://github.com/keppoai/keppo"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground transition-colors duration-200"
              >
                GitHub
              </a>
              <a href="/terms" className="hover:text-foreground transition-colors duration-200">
                Terms
              </a>
              <a href="/privacy" className="hover:text-foreground transition-colors duration-200">
                Privacy
              </a>
              <Link to="/login" className="hover:text-foreground transition-colors duration-200">
                Sign in
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline mockup
// ---------------------------------------------------------------------------

function TimelineMockup() {
  const prefersReducedMotion = useReducedMotion();

  const steps = [
    {
      icon: Zap,
      color: "text-secondary",
      bg: "from-secondary/15 to-secondary/5",
      label: "Trigger fired",
      detail: null,
      time: "2:34 PM",
    },
    {
      icon: Shield,
      color: "text-primary",
      bg: "from-primary/12 to-primary/4",
      label: "Rule matched",
      detail: '"auto-approve refunds under $500"',
      time: "2:34 PM",
    },
    {
      icon: Check,
      color: "text-primary",
      bg: "from-primary/12 to-primary/4",
      label: "Auto-approved",
      detail: null,
      time: "2:34 PM",
    },
    {
      icon: ArrowRight,
      color: "text-primary",
      bg: "from-primary/12 to-primary/4",
      label: "Executed",
      detail: "Stripe refund re_abc123 created",
      time: "2:34 PM",
    },
  ];

  return (
    <GlowCard className="p-6">
      <div className="mb-5">
        <p className="font-semibold text-foreground">Stripe Refund — $450</p>
        <p className="text-sm text-muted-foreground/60">to sarah@example.com</p>
      </div>

      <div className="space-y-0">
        {steps.map((step, i) => (
          <motion.div
            key={step.label}
            className="flex items-start gap-3 relative"
            {...(prefersReducedMotion
              ? {}
              : {
                  initial: { opacity: 0, x: -8 },
                  whileInView: { opacity: 1, x: 0 },
                  viewport: { once: true },
                  transition: {
                    duration: 0.4,
                    delay: i * 0.1,
                    ease: [0.22, 1, 0.36, 1],
                  },
                })}
          >
            {i < steps.length - 1 ? (
              <div className="absolute left-[15px] top-[30px] w-px h-[calc(100%-14px)] bg-foreground/[0.06]" />
            ) : null}
            <div
              className={`flex size-[30px] shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${step.bg} ${step.color}`}
            >
              <step.icon className="size-3.5" />
            </div>
            <div className="flex-1 pb-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">{step.label}</span>
                <span className="text-[11px] text-muted-foreground/40 font-mono">{step.time}</span>
              </div>
              {step.detail ? (
                <p className="text-xs text-muted-foreground/60 mt-0.5">{step.detail}</p>
              ) : null}
            </div>
          </motion.div>
        ))}
      </div>
    </GlowCard>
  );
}

// ---------------------------------------------------------------------------
// Rule mockup
// ---------------------------------------------------------------------------

function RuleMockup() {
  return (
    <GlowCard className="p-6" glowColor="from-secondary/15 to-primary/10">
      <div className="mb-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground/50 mb-3">
          You say
        </p>
        <p className="text-sm text-foreground/90 font-medium leading-relaxed">
          "Auto-approve Slack messages to #general but block DMs"
        </p>
      </div>

      <div className="h-px bg-foreground/[0.06] my-5" />

      <div className="mb-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground/50 mb-3">
          Keppo generates a rule
        </p>
        {/* CEL code block — shows that rules are deterministic code, not English */}
        <div className="rounded-lg bg-foreground/[0.04] dark:bg-foreground/[0.08] p-3.5 font-mono text-xs leading-relaxed">
          <div className="text-muted-foreground/60">
            <span className="text-primary/70 font-semibold">rule</span>{" "}
            <span className="text-foreground/70">&quot;slack-general-auto-approve&quot;</span>{" "}
            <span className="text-muted-foreground/40">{"{"}</span>
          </div>
          <div className="ml-4 text-muted-foreground/60">
            <span className="text-primary/60">when</span>{" "}
            <span className="text-foreground/60">tool.name</span>{" "}
            <span className="text-muted-foreground/40">==</span>{" "}
            <span className="text-foreground/70">&quot;sendMessage&quot;</span>
          </div>
          <div className="ml-4 text-muted-foreground/60">
            <span className="text-primary/60">&amp;&amp;</span>{" "}
            <span className="text-foreground/60">args.channel</span>{" "}
            <span className="text-muted-foreground/40">==</span>{" "}
            <span className="text-foreground/70">&quot;#general&quot;</span>
          </div>
          <div className="ml-4 text-muted-foreground/60">
            <span className="text-primary/60">→</span>{" "}
            <span className="text-primary font-semibold">auto_approve</span>
          </div>
          <div className="text-muted-foreground/40">{"}"}</div>
        </div>
      </div>

      <div className="h-px bg-foreground/[0.06] my-5" />

      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground/50 mb-3">
          Simulated against last week
        </p>
        <div className="space-y-2.5">
          <div className="flex items-center gap-2.5 text-sm">
            <div className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-primary shrink-0">
              <Check className="size-3" />
            </div>
            <span className="text-muted-foreground">
              <span className="font-medium text-foreground/80">12 messages</span> to #general —
              auto-approved
            </span>
          </div>
          <div className="flex items-center gap-2.5 text-sm">
            <div className="flex size-5 items-center justify-center rounded-full bg-secondary/10 text-secondary shrink-0">
              <Shield className="size-3" />
            </div>
            <span className="text-muted-foreground">
              <span className="font-medium text-foreground/80">3 DMs</span>,{" "}
              <span className="font-medium text-foreground/80">2 to #engineering</span> — would
              still ask you
            </span>
          </div>
        </div>
      </div>
    </GlowCard>
  );
}

// ---------------------------------------------------------------------------
// FAQ data
// ---------------------------------------------------------------------------

const FAQ_ITEMS = [
  {
    question: "What does Keppo actually do?",
    answer:
      "Keppo runs AI-powered automations across your business tools — Slack, Stripe, Gmail, GitHub, Notion, and more. The difference from other automation tools: every action that changes something in the real world (sending an email, issuing a refund, posting a message) goes through an approval step first. You decide what's safe to auto-approve and what needs a human eye.",
  },
  {
    question: "Is it really free?",
    answer:
      "Keppo offers a Free trial with a one-time 20-credit grant that covers both prompt generation and automation runtime, plus all integrations and the full approval engine. You can also self-host the entire platform for free because it's open-source.",
  },
  {
    question: "How is this different from Zapier or Make?",
    answer:
      "Zapier and Make are workflow builders — you define every step manually. Keppo is AI-native: you describe what you want in plain English, and the AI figures out the steps. But unlike giving an AI agent free rein, Keppo puts a safety layer in between. You see every action before it happens, set rules for what's safe, and get a full audit trail of what happened and why.",
  },
  {
    question: 'What are "rules" and do I need to write code?',
    answer:
      'Rules are the guardrails you set for your automations — like "auto-approve refunds under $100" or "always ask me before sending emails to external addresses." You write them in plain English. Keppo turns them into deterministic logic that runs the same way every time. No code required.',
  },
  {
    question: "Can AI approve things without me knowing?",
    answer:
      "Only if you explicitly set a rule that says it can. By default, every action that writes, sends, or changes something requires your approval.",
  },
  {
    question: "Can I self-host Keppo?",
    answer:
      "Yes. Keppo is open-source. Run it with Docker on your own infrastructure. Your data, your servers, your rules.",
  },
];
