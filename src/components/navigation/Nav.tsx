import React from "react";
import { SeccionNav } from "../../types";
import { useAuth } from "../../context/AuthContext";
import { SyncStatusDot } from "../common/SyncStatusDot";
import {
  CalendarDays,
  Calendar,
  Users,
  Sliders,
  Disc,
} from "lucide-react";

interface NavProps {
  activeTab: SeccionNav;
  onTabChange: (tab: SeccionNav) => void;
}

interface NavItem {
  id: SeccionNav;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { id: "agenda", label: "Agenda", icon: CalendarDays },
  { id: "calendario", label: "Calendario", icon: Calendar },
  { id: "alumnos", label: "Alumnos", icon: Users },
  { id: "mas", label: "Más", icon: Sliders },
];

export const BottomNav: React.FC<NavProps> = ({ activeTab, onTabChange }) => {
  return (
    <nav
      id="mobile-bottom-nav"
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-slate-950/95 backdrop-blur-md border-t border-slate-800/90 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-1 px-2 shadow-2xl"
    >
      <div className="grid grid-cols-4 max-w-md mx-auto">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              id={`nav-item-${item.id}`}
              onClick={() => onTabChange(item.id)}
              className={`flex flex-col items-center justify-center py-2 px-1 min-h-[50px] rounded-xl transition-all duration-150 active:scale-95 ${
                isActive
                  ? "text-blue-400 font-semibold"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? "stroke-[2.5]" : "stroke-[1.75]"}`} />
              <span className="text-[11px] mt-1 tracking-tight leading-none">
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export const DesktopSidebar: React.FC<NavProps> = ({
  activeTab,
  onTabChange,
}) => {
  const { currentUser } = useAuth();

  return (
    <aside
      id="desktop-sidebar"
      className="hidden md:flex flex-col w-56 bg-slate-900/90 border-r border-slate-800 p-4 shrink-0 min-h-screen sticky top-0"
    >
      {/* Brand Header */}
      <div className="flex items-center gap-3 px-2 py-3 mb-6">
        <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
          <Disc className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-slate-50 tracking-tight leading-tight">
            Profesor Agenda
          </h2>
          <p className="text-[11px] text-slate-400">Música & DJ</p>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="space-y-1.5 flex-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              id={`sidebar-item-${item.id}`}
              onClick={() => onTabChange(item.id)}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 text-left ${
                isActive
                  ? "bg-blue-600 text-white shadow-sm font-semibold"
                  : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/60"
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Footer Info */}
      <div className="pt-4 border-t border-slate-800/80 px-2 space-y-2">
        <p className="text-[11px] text-slate-500 leading-tight">
          Profesor Agenda v1.0
        </p>
        <SyncStatusDot variant="detailed" />
      </div>
    </aside>
  );
};
