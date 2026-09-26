/* eslint-disable */
// ============================================================================
// Arma el paquete para subir al hosting (cPanel → "Setup Node.js App").
//
// Uso (desde backend/):   npm run hosting:paquete
//
// Resultado: hosting/sistemapos-hosting.zip (en la raíz del repo) con:
//   dist/          backend compilado (archivo de inicio: dist/server.js)
//   public/        frontend compilado (lo sirve el mismo backend)
//   package.json + package-lock.json   (en cPanel: "Run NPM Install")
//   .env.example   referencia de variables
//
// El frontend se compila con VITE_API_URL=/api/v1: API y página quedan en el
// mismo dominio, sin CORS. VITE_EXTERNAL_LEAD_API_KEY se toma de
// frontend/.env como siempre.
// ============================================================================

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const RAIZ = path.resolve(__dirname, "..", "..");
const BACKEND = path.join(RAIZ, "backend");
const FRONTEND = path.join(RAIZ, "frontend");
const SALIDA = path.join(RAIZ, "hosting");
const CARPETA = path.join(SALIDA, "sistemapos");
const ZIP = path.join(SALIDA, "sistemapos-hosting.zip");

function correr(comando, cwd, env = {}) {
  console.log(`\n> ${comando}   (${path.relative(RAIZ, cwd) || "."})`);
  execSync(comando, { cwd, stdio: "inherit", env: { ...process.env, ...env } });
}

function copiar(origen, destino) {
  fs.cpSync(origen, destino, { recursive: true });
}

fs.rmSync(SALIDA, { recursive: true, force: true });
fs.mkdirSync(CARPETA, { recursive: true });

// Las variables que ya existen en el entorno tienen prioridad sobre frontend/.env en Vite.
correr("npm run build", FRONTEND, { VITE_API_URL: "/api/v1" });
correr("npm run build", BACKEND);

copiar(path.join(BACKEND, "dist"), path.join(CARPETA, "dist"));
copiar(path.join(FRONTEND, "dist"), path.join(CARPETA, "public"));
for (const archivo of ["package.json", "package-lock.json", ".env.example"]) {
  copiar(path.join(BACKEND, archivo), path.join(CARPETA, archivo));
}
fs.mkdirSync(path.join(CARPETA, "uploads"), { recursive: true });
fs.writeFileSync(path.join(CARPETA, "uploads", ".gitkeep"), "");
// Passenger (el que corre Node en cPanel) reinicia la app cuando cambia
// este archivo: cada paquete lleva uno nuevo, así subirlo basta para reiniciar.
fs.mkdirSync(path.join(CARPETA, "tmp"), { recursive: true });
fs.writeFileSync(path.join(CARPETA, "tmp", "restart.txt"), new Date().toISOString());

// En GitHub Actions se sube la carpeta por FTP directamente, sin zip.
if (process.env.SIN_ZIP) {
  console.log(`\n✔ Carpeta lista: ${path.relative(RAIZ, CARPETA)}`);
  process.exit(0);
}

// bsdtar viene con Windows 10+ y macOS; -a elige zip por la extensión. En
// Windows se llama por ruta completa: el `tar` de Git Bash (GNU) no hace zip
// y confunde "C:" con un host remoto.
const tar = process.platform === "win32" ? `"${path.join(process.env.SystemRoot, "System32", "tar.exe")}"` : "bsdtar";
correr(`${tar} -a -c -f "${ZIP}" -C "${CARPETA}" .`, RAIZ);

const mb = (fs.statSync(ZIP).size / 1024 / 1024).toFixed(1);
console.log(`\n✔ Paquete listo: ${path.relative(RAIZ, ZIP)} (${mb} MB)`);
console.log("  Súbelo a la carpeta de la app en cPanel, descomprímelo y sigue HOSTING.md.");
