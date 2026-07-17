import { Navigate, Route, Routes } from "react-router-dom";
import { CajaHistorialPage } from "./modules/caja/pages/CajaHistorialPage";
import { CajaPage } from "./modules/caja/pages/CajaPage";
import { HomeRoute } from "./modules/general/pages/HomeRoute";
import { LoginPage } from "./modules/general/pages/LoginPage";
import { InsumosListPage } from "./modules/insumos/pages/InsumosListPage";
import { CocinaHistorialPage } from "./modules/migao/pages/CocinaHistorialPage";
import { CocinaPage } from "./modules/migao/pages/CocinaPage";
import { MenuPage } from "./modules/migao/pages/MenuPage";
import { MeseroHistorialPage } from "./modules/migao/pages/MeseroHistorialPage";
import { MeseroPage } from "./modules/migao/pages/MeseroPage";
import { MigaoHistorialPage } from "./modules/migao/pages/MigaoHistorialPage";
import { MigaoPage } from "./modules/migao/pages/MigaoPage";
import { RequireAuth } from "./shared/auth/RequireAuth";
import { AppShell } from "./shared/layout/AppShell";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<HomeRoute />} />
        <Route path="/caja" element={<CajaPage />} />
        <Route path="/caja/historial" element={<CajaHistorialPage />} />
        <Route path="/insumos" element={<InsumosListPage />} />
        <Route path="/mesero" element={<MeseroPage />} />
        <Route path="/mesero/historial" element={<MeseroHistorialPage />} />
        <Route path="/migao" element={<MigaoPage />} />
        <Route path="/migao/historial" element={<MigaoHistorialPage />} />
        <Route path="/cocina" element={<CocinaPage />} />
        <Route path="/cocina/historial" element={<CocinaHistorialPage />} />
        <Route path="/menu" element={<MenuPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
