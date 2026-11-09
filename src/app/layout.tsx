import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "PeopleOS — The Operating System for Your Workforce", description: "A phone-first, agent-driven workforce operating system." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
