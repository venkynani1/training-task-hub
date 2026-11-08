"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Nav() {
  const path = usePathname();
  if (path === "/login") return null;
  const link = (href: string, label: string) => {
    const active = href === "/" ? path === "/" : path.startsWith(href);
    return <Link href={href} className={active ? "navlink active" : "navlink"}>{label}</Link>;
  };
  return (
    <header className="topbar">
      <div className="wrap topbar-inner">
        <span className="brand"><span className="brand-mark">T</span> Training Task Hub</span>
        <nav>
          {link("/", "Tasks")}
          {link("/trainings", "Training tracker")}
        </nav>
      </div>
    </header>
  );
}
