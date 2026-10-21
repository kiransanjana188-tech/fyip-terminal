import { TerminalShell } from "@/components/terminal/TerminalShell";

export default function TerminalLayout({ children }: { children: React.ReactNode }) {
  return <TerminalShell>{children}</TerminalShell>;
}