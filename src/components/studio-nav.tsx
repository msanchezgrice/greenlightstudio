import Link from "next/link";
import { UserButton } from "@clerk/nextjs";

type StudioTab = "dashboard" | "board" | "projects" | "inbox" | "chat" | "tasks" | "settings";

const tabs: Array<{ id: StudioTab; label: string; href: string }> = [
  { id: "dashboard", label: "Exec Dash", href: "/dashboard" },
  { id: "board", label: "Studio Overview", href: "/board" },
  { id: "inbox", label: "Approvals", href: "/inbox" },
  { id: "chat", label: "Chat", href: "/chat" },
  { id: "tasks", label: "Activity Log", href: "/tasks" },
  { id: "settings", label: "Settings", href: "/settings" },
];

type NavProps = {
  active: StudioTab;
  pendingCount: number;
  runningCount?: number;
  urgentCount?: number;
};

function TabBadge({ tab, pendingCount, urgentCount, runningCount }: {
  tab: StudioTab;
  pendingCount: number;
  urgentCount?: number;
  runningCount?: number;
}) {
  if (tab === "inbox" && (urgentCount ?? 0) > 0) {
    return <span className="tab-badge red">{urgentCount}</span>;
  }
  if (tab === "inbox" && pendingCount > 0) {
    return <span className="tab-badge red">{pendingCount}</span>;
  }
  if (tab === "tasks" && (runningCount ?? 0) > 0) {
    return <span className="tab-badge yellow">{runningCount}</span>;
  }
  return null;
}

export function StudioNav({ active, pendingCount, runningCount = 0, urgentCount = 0 }: NavProps) {
  const isAlive = runningCount > 0;

  return (
    <nav className="nav" style={{ position: "relative" }}>
      <div className="nav-left">
        <Link href="/dashboard" className={`logo ${isAlive ? "logo-breathing" : ""}`}>
          ▲ <span className="logo-text">Startup Machine</span>
        </Link>
        <div className="nav-tabs">
          {tabs.map((tab) => (
            <Link key={tab.id} href={tab.href} className={`nav-tab ${active === tab.id ? "active" : ""}`}>
              {tab.label}
              <TabBadge
                tab={tab.id}
                pendingCount={pendingCount}
                urgentCount={urgentCount}
                runningCount={runningCount}
              />
            </Link>
          ))}
        </div>
      </div>
      <div className="nav-right">
        <div className={`agent-ticker ${isAlive ? "" : "idle"}`}>
          <span className="ticker-dot" />
          <span>
            {isAlive
              ? `${runningCount} agent${runningCount > 1 ? "s" : ""} active`
              : "All quiet"}
          </span>
        </div>
        <UserButton
          afterSignOutUrl="/"
          appearance={{
            elements: {
              avatarBox: { width: 30, height: 30 },
            },
          }}
        />
      </div>
    </nav>
  );
}
