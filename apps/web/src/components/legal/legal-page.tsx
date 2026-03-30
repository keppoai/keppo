import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { KeppoWordmark } from "@/components/landing/keppo-logo";

interface LegalPageProps {
  title: string;
  lastUpdated: string;
  children: ReactNode;
}

export function LegalPage({ title, lastUpdated, children }: LegalPageProps) {
  return (
    <div className="min-h-svh bg-background">
      <header className="border-b border-border/40 py-4 px-5">
        <div className="mx-auto max-w-3xl flex items-center justify-between">
          <Link to="/">
            <KeppoWordmark />
          </Link>
          <nav className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link to="/terms" className="hover:text-foreground transition-colors duration-200">
              Terms
            </Link>
            <Link to="/privacy" className="hover:text-foreground transition-colors duration-200">
              Privacy
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-12">
        <h1 className="text-3xl font-bold tracking-tight mb-2">{title}</h1>
        <p className="text-sm text-muted-foreground mb-10">Last updated: {lastUpdated}</p>
        <div className="legal-content text-foreground/90 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:mt-10 [&_h2]:mb-4 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:tracking-tight [&_h3]:mt-6 [&_h3]:mb-3 [&_p]:leading-7 [&_p]:mb-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-4 [&_li]:leading-7 [&_li]:mb-2 [&_a]:text-primary [&_a]:underline-offset-4 hover:[&_a]:underline [&_strong]:font-semibold [&_strong]:text-foreground">
          {children}
        </div>
      </main>
    </div>
  );
}
