import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import {
  Activity, Boxes, ClipboardList, GitMerge, Grid2X2, History, LogOut,
  Network, Plug, Settings, ShieldCheck, UserRound, Wrench
} from "lucide-react";
import { api, clearToken, getToken } from "./api";
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
import type { User } from "../shared/types";

const nav = [
  { to: "/", label: "待处理", icon: Grid2X2 },
  { to: "/graph", label: "关系图", icon: Network },
  { to: "/modules", label: "模块与契约", icon: Boxes },
  { to: "/runs", label: "联调运行", icon: Activity },
  { to: "/repairs", label: "修复包", icon: Wrench },
  { to: "/rules", label: "规则", icon: Settings },
  { to: "/users", label: "用户", icon: UserRound },
  { to: "/audit", label: "审计", icon: History },
  { to: "/integrations", label: "接入设置", icon: Plug }
];

export default function App() {
  const [ready, setReady] = useState(Boolean(getToken()));
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const unauthorized = () => setReady(false);
    window.addEventListener("giteehelper:unauthorized", unauthorized);
    return () => window.removeEventListener("giteehelper:unauthorized", unauthorized);
  }, []);

  useEffect(() => {
    if (!ready) return;
    api<User>("/me").then(setUser).catch(() => setReady(false));
  }, [ready]);

  if (!ready) return <LoginPage onLogin={() => setReady(true)} />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark"><GitMerge size={21} /></div>
          <div><strong>GiteeHelper</strong><span>Change impact control</span></div>
        </div>
        <nav>
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => isActive ? "active" : ""}>
              <Icon size={18} /><span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-user">
          <div className="avatar">{user?.displayName?.slice(0, 1) ?? "U"}</div>
          <div><strong>{user?.displayName ?? "用户"}</strong><span>{user?.role ?? ""}</span></div>
          <button className="icon-button" title="退出登录" onClick={() => { clearToken(); setReady(false); }}><LogOut size={17} /></button>
        </div>
      </aside>
      <main className="main-content">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/graph" element={<GraphPage />} />
          <Route path="/modules" element={<ModulesPage />} />
          <Route path="/rules" element={<RulesPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/runs" element={<RunsPage />} />
          <Route path="/repairs" element={<RepairsPage />} />
          <Route path="/integrations" element={<IntegrationsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
