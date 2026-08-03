import { Navigate, Route, Routes } from "react-router-dom";
import { CajaHistorialPage } from "./modules/caja/pages/CajaHistorialPage";
import { CajaPage } from "./modules/caja/pages/CajaPage";
import { ClientesPage } from "./modules/con_sentido/pages/ClientesPage";
import { ConSentidoPage } from "./modules/con_sentido/pages/ConSentidoPage";
import { InventarioConSentidoPage } from "./modules/con_sentido/pages/InventarioPage";
import { VentasPage } from "./modules/con_sentido/pages/VentasPage";
import { HomeRoute } from "./modules/general/pages/HomeRoute";
import { LoginPage } from "./modules/general/pages/LoginPage";
import { InsumosListPage } from "./modules/insumos/pages/InsumosListPage";
import { CocinaHistorialPage } from "./modules/migao/pages/CocinaHistorialPage";
import { CocinaPage } from "./modules/migao/pages/CocinaPage";
import { EditorMesasPage } from "./modules/migao/pages/EditorMesasPage";
import { HistorialAdministrativoPage } from "./modules/migao/pages/HistorialAdministrativoPage";
import { InventarioPage } from "./modules/migao/pages/InventarioPage";
import { MenuPage } from "./modules/migao/pages/MenuPage";
import { MeseroHistorialPage } from "./modules/migao/pages/MeseroHistorialPage";
import { MeseroPage } from "./modules/migao/pages/MeseroPage";
import { MigaoHistorialPage } from "./modules/migao/pages/MigaoHistorialPage";
import { MigaoPage } from "./modules/migao/pages/MigaoPage";
import { UsuariosPage } from "./modules/general/pages/UsuariosPage";
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
        <Route path="/con-sentido" element={<ConSentidoPage />} />
        <Route path="/con-sentido/ventas" element={<VentasPage />} />
        <Route path="/con-sentido/clientes" element={<ClientesPage />} />
        <Route path="/con-sentido/inventario" element={<InventarioConSentidoPage />} />
        <Route path="/insumos" element={<InsumosListPage />} />
        <Route path="/mesero" element={<MeseroPage />} />
        <Route path="/mesero/historial" element={<MeseroHistorialPage />} />
        <Route path="/migao" element={<MigaoPage />} />
        <Route path="/migao/historial" element={<MigaoHistorialPage />} />
        <Route path="/migao/historial-administrativo" element={<HistorialAdministrativoPage />} />
        <Route path="/migao/inventario" element={<InventarioPage />} />
        <Route path="/migao/editor-mesas" element={<EditorMesasPage />} />
        <Route path="/cocina" element={<CocinaPage />} />
        <Route path="/cocina/historial" element={<CocinaHistorialPage />} />
        <Route path="/menu" element={<MenuPage />} />
        <Route path="/usuarios" element={<UsuariosPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
