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
  const { currentUser, signIn } = useAuth();
  const [isLoggingIn, setIsLoggingIn] = React.useState(false);

  const handleSignIn = async () => {
    setIsLoggingIn(true);
    try {
      await signIn();
    } catch (err) {
      console.warn("Sign in error:", err);
    } finally {
      setIsLoggingIn(false);
    }
  };

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
        {!currentUser && (
          <button
            type="button"
            id="btn-sidebar-login-google"
            onClick={handleSignIn}
            disabled={isLoggingIn}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 bg-white hover:bg-slate-100 active:scale-[0.98] text-slate-900 font-semibold rounded-xl text-xs transition-all shadow-sm cursor-pointer disabled:opacity-50"
          >
            <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 48 48">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
            </svg>
            <span>{isLoggingIn ? "Iniciando..." : "Iniciar con Google"}</span>
          </button>
        )}
        <p className="text-[11px] text-slate-500 leading-tight">
          Profesor Agenda v1.0
        </p>
        <SyncStatusDot variant="detailed" />
      </div>
    </aside>
  );
};
