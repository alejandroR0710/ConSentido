export interface UsuarioSesion {
  id: string;
  nombre: string;
  email: string;
  rolId: number;
  rol: string; // nombre del rol: "Super Root", "Cajero", "Cocina", "Mesero"...
  modulos: string[]; // slugs de módulos permitidos: insumos, talleres, con_sentido, migao, pedidos, general
}

export interface AuthState {
  usuario: UsuarioSesion | null;
  accessToken: string | null;
  loading: boolean;
}
