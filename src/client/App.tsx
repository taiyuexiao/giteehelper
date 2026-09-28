import { lazy, Suspense, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import {
  Activity, Boxes, FolderGit2, Grid2X2, History, LogOut, Network,
  Plug, Settings, ShieldAlert, UserRound, Wrench, GitMerge
} from "lucide-react";
import { api, clearToken, getToken } from "./api";
import { Loading } from "./components";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import GraphPage from "./pages/GraphPage";
import ModulesPage from "./pages/ModulesPage";
import RulesPage from "./pages/RulesPage";
import UsersPage from "./pages/UsersPage";
import AuditPage from "./pages/AuditPage";
import RunsPage from "./pages/RunsPage";
import IntegrationsPage from "./pages/IntegrationsPage";
import RepairsPage from "./pages/RepairsPage";
import type { Role, User } from "../shared/types";

type NavItem = { to: string; label: string; icon: typeof Grid2X2; roles?: Role[] };

// three.js 与 3d-force-graph 体积较大，只在进入仓库全景时按需加载
const RepoGraphPage = lazy(() => import("./pages/RepoGraphPage"));

const nav: NavItem[] = [
  { to: "/", label: "待处理", icon: Grid2X2 },
  { to: "/repo", label: "仓库全景", icon: FolderGit2 },
  { to: "/graph", label: "关系图", icon: Network },
  { to: "/modules", label: "模块与契约", icon: Boxes },
  { to: "/runs", label: "联调运行", icon: Activity },
  { to: "/repairs", label: "修复包", icon: Wrench },
  { to: "/rules", label: "规则", icon: Settings, roles: ["admin", "maintainer"] },
  { to: "/users", label: "用户", icon: UserRound, roles: ["admin"] },
  { to: "/audit", label: "审计", icon: History, roles: ["admin"] },
  { to: "/integrations", label: "接入设置", icon: Plug, roles: ["admin"] }
];

function visibleFor(items: NavItem[], role: Role | undefined) {
  return items.filter((item) => !item.roles || (role ? item.roles.includes(role) : false));
}

function Forbidden() {
  return (
    <section className="panel">
      <div className="panel-header"><div><h2>无访问权限</h2><p>当前角色的权限不足以查看该页面。</p></div></div>
      <div className="empty-state">
        <ShieldAlert size={26} />
        <strong>请联系管理员调整角色</strong>
        <span>可访问范围由「用户」页面中的角色决定。</span>
      </div>
    </section>
  );
}

function Guard({ user, roles, children }: { user: User; roles: Role[]; children: React.ReactNode }) {
  return roles.includes(user.role) ? <>{children}</> : <Forbidden />;
}

export default function App() {
  const [ready, setReady] = useState(Boolean(getToken()));
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const unauthorized = () => { setReady(false); setUser(null); };
    window.addEventListener("giteehelper:unauthorized", unauthorized);
    return () => window.removeEventListener("giteehelper:unauthorized", unauthorized);
  }, []);

  useEffect(() => {
    if (!ready) return;
    api<User>("/me").then(setUser).catch(() => setReady(false));
  }, [ready]);

  if (!ready) return <LoginPage onLogin={() => setReady(true)} />;
  if (!user) return <div className="main-content"><Loading /></div>;

  const items = visibleFor(nav, user.role);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark"><GitMerge size={21} /></div>
          <div><strong>GiteeHelper</strong><span>Change impact control</span></div>
        </div>
        <nav>
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => isActive ? "active" : ""}>
              <Icon size={18} /><span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-user">
          <div className="avatar">{user.displayName?.slice(0, 1) ?? "U"}</div>
          <div><strong>{user.displayName}</strong><span>{user.role}</span></div>
          <button className="icon-button" title="退出登录" aria-label="退出登录" onClick={() => { clearToken(); setUser(null); setReady(false); }}><LogOut size={17} /></button>
        </div>
      </aside>
      <main className="main-content">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/repo" element={<Suspense fallback={<Loading />}><RepoGraphPage user={user} /></Suspense>} />
          <Route path="/graph" element={<GraphPage />} />
          <Route path="/modules" element={<ModulesPage user={user} />} />
          <Route path="/rules" element={<Guard user={user} roles={["admin", "maintainer"]}><RulesPage /></Guard>} />
          <Route path="/users" element={<Guard user={user} roles={["admin"]}><UsersPage /></Guard>} />
          <Route path="/audit" element={<Guard user={user} roles={["admin"]}><AuditPage /></Guard>} />
          <Route path="/runs" element={<RunsPage user={user} />} />
          <Route path="/repairs" element={<RepairsPage user={user} />} />
          <Route path="/integrations" element={<Guard user={user} roles={["admin"]}><IntegrationsPage /></Guard>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
