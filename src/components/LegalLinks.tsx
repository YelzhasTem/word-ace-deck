import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export function LegalLinks({ className }: { className?: string }) {
  const linkClass = "hover:text-foreground transition-colors";
  return (
    <nav
      aria-label="Legal"
      className={cn("flex flex-wrap items-center gap-x-5 gap-y-2 text-sm", className)}
    >
      <Link to="/privacy" className={linkClass}>
        Privacy Policy
      </Link>
      <Link to="/terms" className={linkClass}>
        Terms of Use
      </Link>
      <Link to="/support" className={linkClass}>
        Support
      </Link>
    </nav>
  );
}
