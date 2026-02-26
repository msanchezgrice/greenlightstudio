import Link from "next/link";

type StudioTab = "board" | "projects" | "inbox" | "chat" | "tasks" | "settings";

const tabs: Array<{ id: StudioTab; label: string; href: string }> = [
  { id: "board", label: "Board", href: "/board" },
  { id: "projects", label: "Projects", href: "/projects" },
  { id: "inbox", label: "Inbox", href: "/inbox" },
  { id: "chat", label: "Chat", href: "/chat" },
  { id: "tasks", label: "Tasks", href: "/tasks" },
  { id: "settings", label: "Settings", href: "/settings" },
];

export function StudioNav({ active, pendingCount }: { active: StudioTab; pendingCount: number }) {
  return (
    <nav className="nav">
      <div className="nav-left">
        <Link href="/board" className="logo">
          ▲ <span>Greenlight</span>
        </Link>
        <div className="nav-tabs">
          {tabs.map((tab) => (
            <Link key={tab.id} href={tab.href} className={`nav-tab ${active === tab.id ? "active" : ""}`}>
              {tab.label}
            </Link>
          ))}
        </div>
      </div>
      <div className="nav-right">
        <div className="meta-line">{pendingCount} pending</div>
      </div>
    </nav>
  );
}
