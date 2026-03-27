import React from "react";
import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { Providers } from "@/components/providers";
import { getAuthOptions, hasAuthConfiguration } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Izzy",
  description: "Create higher-signal GitHub issues for keppoai/keppo.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = hasAuthConfiguration() ? await getServerSession(getAuthOptions()) : null;

  return (
    <html lang="en">
      <body>
        <Providers session={session}>{children}</Providers>
      </body>
    </html>
  );
}
