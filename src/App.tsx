/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { AgendaProvider, useAgenda } from "./context/AgendaContext";
import { SeccionNav, Clase, Tocata, Alumno } from "./types";
import { BottomNav, DesktopSidebar } from "./components/navigation/Nav";
import { AgendaView } from "./components/agenda/AgendaView";
import { CalendarView } from "./components/calendar/CalendarView";
import { AlumnosView } from "./components/alumnos/AlumnosView";
import { ClaseModal } from "./components/modals/ClaseModal";
import { TocataModal } from "./components/modals/TocataModal";
import { AlumnoFichaModal } from "./components/alumnos/AlumnoFichaModal";
import { AlumnoModal } from "./components/alumnos/AlumnoModal";
import { GlobalSearchBar } from "./components/search/GlobalSearchBar";
import { OfflineStatusIndicator } from "./components/common/OfflineStatusIndicator";
import { LoginScreen } from "./components/auth/LoginScreen";
import { MigrationModal } from "./components/modals/MigrationModal";
import { Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// Code splitting para vistas pesadas de configuración y exportación
const MasView = React.lazy(() =>
  import("./components/mas/MasView").then((m) => ({ default: m.MasView }))
);

function AgendaAppContent() {
  const { currentUser, loading } = useAuth();
  const {
    isMigrationModalOpen,
    localSummary,
    migrateLocalDataToFirestore,
    skipMigrationAndSeedDemo,
  } = useAgenda();

  const [activeTab, setActiveTab] = useState<SeccionNav>("agenda");

  // Modal states
  const [isClaseModalOpen, setIsClaseModalOpen] = useState(false);
  const [claseToEdit, setClaseToEdit] = useState<Clase | null>(null);
  const [defaultAlumnoIdForClase, setDefaultAlumnoIdForClase] = useState<
    string | undefined
  >(undefined);
  const [defaultFechaForClase, setDefaultFechaForClase] = useState<
    string | undefined
  >(undefined);

  const [isTocataModalOpen, setIsTocataModalOpen] = useState(false);
  const [tocataToEdit, setTocataToEdit] = useState<Tocata | null>(null);
  const [defaultFechaForTocata, setDefaultFechaForTocata] = useState<
    string | undefined
  >(undefined);

  // Search-driven Alumno modal states
  const [selectedAlumnoForFicha, setSelectedAlumnoForFicha] =
    useState<Alumno | null>(null);
  const [alumnoToEdit, setAlumnoToEdit] = useState<Alumno | null>(null);

  // Handlers for creating / editing classes
  const handleOpenNewClase = (fecha?: string, alumnoId?: string) => {
    setClaseToEdit(null);
    setDefaultFechaForClase(fecha);
    setDefaultAlumnoIdForClase(alumnoId);
    setIsClaseModalOpen(true);
  };

  const handleOpenClaseDetail = (clase: Clase) => {
    if (!clase) return;
    setClaseToEdit(clase);
    setDefaultFechaForClase(clase.fecha);
    setDefaultAlumnoIdForClase(clase.alumnoId);
    setIsClaseModalOpen(true);
  };

  // Handlers for creating / editing tocatas
  const handleOpenNewTocata = (fecha?: string) => {
    setTocataToEdit(null);
    setDefaultFechaForTocata(fecha);
    setIsTocataModalOpen(true);
  };

  const handleOpenTocataDetail = (tocata: Tocata) => {
    setTocataToEdit(tocata);
    setDefaultFechaForTocata(undefined);
    setIsTocataModalOpen(true);
  };

  const handleSelectAlumnoFromSearch = (alumno: Alumno) => {
    setSelectedAlumnoForFicha(alumno);
  };

  // Register PWA Service Worker on load for iPhone / mobile offline caching
  React.useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker
          .register("/sw.js")
          .catch((err) => console.log("SW registration notice:", err));
      });
    }
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex flex-col md:flex-row antialiased">
      {/* Desktop Sidebar Navigation */}
      <DesktopSidebar
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      />

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-4xl mx-auto px-4 py-5 sm:px-6 sm:py-8 pb-24 md:pb-12">
        {/* Network & Offline Status Indicator */}
        <OfflineStatusIndicator />

        {/* Global Search Bar across Alumnos, Clases & Tocatas */}
        <GlobalSearchBar
          onSelectAlumno={handleSelectAlumnoFromSearch}
          onSelectClase={handleOpenClaseDetail}
          onSelectTocata={handleOpenTocataDetail}
        />

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeTab}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeInOut" }}
            className="w-full"
          >
            {activeTab === "agenda" && (
              <AgendaView
                onOpenNewClase={() => handleOpenNewClase()}
                onOpenNewTocata={() => handleOpenNewTocata()}
                onOpenClaseDetail={handleOpenClaseDetail}
                onOpenTocataDetail={handleOpenTocataDetail}
              />
            )}

            {activeTab === "calendario" && (
              <CalendarView
                onOpenNewClaseWithDate={(fecha) => handleOpenNewClase(fecha)}
                onOpenNewTocataWithDate={(fecha) => handleOpenNewTocata(fecha)}
                onOpenClaseDetail={handleOpenClaseDetail}
                onOpenTocataDetail={handleOpenTocataDetail}
              />
            )}

            {activeTab === "alumnos" && (
              <AlumnosView
                onNewClaseForAlumno={(alumnoId) =>
                  handleOpenNewClase(undefined, alumnoId)
                }
                onOpenClaseDetail={handleOpenClaseDetail}
              />
            )}

            {activeTab === "mas" && (
              <React.Suspense
                fallback={
                  <div className="flex flex-col items-center justify-center py-20 gap-3">
                    <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                    <p className="text-xs text-slate-400">Cargando Más opciones...</p>
                  </div>
                }
              >
                <MasView />
              </React.Suspense>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Mobile Bottom Navigation Bar */}
      <BottomNav
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      />

      {/* Shared Modals */}
      <ClaseModal
        isOpen={isClaseModalOpen}
        onClose={() => {
          setIsClaseModalOpen(false);
          setClaseToEdit(null);
          setDefaultAlumnoIdForClase(undefined);
          setDefaultFechaForClase(undefined);
        }}
        claseToEdit={claseToEdit}
        defaultAlumnoId={defaultAlumnoIdForClase}
        defaultFecha={defaultFechaForClase}
      />

      <TocataModal
        isOpen={isTocataModalOpen}
        onClose={() => {
          setIsTocataModalOpen(false);
          setTocataToEdit(null);
          setDefaultFechaForTocata(undefined);
        }}
        tocataToEdit={tocataToEdit}
        defaultFecha={defaultFechaForTocata}
      />

      {/* Alumno Modals (Search and Shared) */}
      <AlumnoFichaModal
        isOpen={!!selectedAlumnoForFicha}
        onClose={() => setSelectedAlumnoForFicha(null)}
        alumno={selectedAlumnoForFicha}
        onEditAlumno={(alumno) => setAlumnoToEdit(alumno)}
        onNewClaseForAlumno={(alumnoId) => handleOpenNewClase(undefined, alumnoId)}
        onOpenClaseDetail={(clase) => handleOpenClaseDetail(clase)}
      />

      <AlumnoModal
        isOpen={!!alumnoToEdit}
        onClose={() => setAlumnoToEdit(null)}
        alumnoToEdit={alumnoToEdit}
      />

      {/* Cloud Migration Modal */}
      <MigrationModal
        isOpen={isMigrationModalOpen}
        onMigrate={migrateLocalDataToFirestore}
        onSkipAndSeedDefault={skipMigrationAndSeedDemo}
        localSummary={localSummary}
      />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AgendaProvider>
        <AgendaAppContent />
      </AgendaProvider>
    </AuthProvider>
  );
}
