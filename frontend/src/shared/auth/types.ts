export interface UsuarioSesion {
  id: string;
  nombre: string;
  // Cada usuario tiene guardado uno u otro, nunca ambos (ver el CHECK en la
  // tabla usuarios) — cuál se usó para iniciar sesión depende de con qué se
  // creó la cuenta.
  email: string | null;
  numeroDocumento: string | null;
  rolId: number;
  rol: string; // nombre del rol: "Super Root", "Cajero", "Cocina", "Mesero"...
  modulos: string[]; // slugs de módulos permitidos: insumos, talleres, con_sentido, migao, pedidos, general
}

export interface AuthState {
  usuario: UsuarioSesion | null;
  accessToken: string | null;
  loading: boolean;
}
