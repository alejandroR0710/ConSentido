/**
 * Exporta SOLO usuarios y el menú (categorías + productos de Migao) de la base
 * de datos local a un archivo SQL, para llevarlos a producción sin arrastrar
 * datos transaccionales (órdenes, ventas, movimientos de caja, etc).
 *
 * Uso:
 *   cd backend
 *   node scripts/exportar-usuarios-menu.js
 *
 * Genera database/produccion-usuarios-menu.sql. Para usarlo en producción,
 * primero aplica database/schema.sql y database/seed.sql (roles/permisos ya
 * están ahí) y DESPUÉS corre este archivo — los INSERT resuelven roles y
 * categorías por nombre (no por id), así que no importa que los ids difieran
 * entre tu base local y la de producción.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function sqlString(valor) {
  if (valor === null || valor === undefined) return "NULL";
  return `'${String(valor).replace(/'/g, "''")}'`;
}

async function main() {
  const partes = [];
  partes.push("-- Generado por scripts/exportar-usuarios-menu.js — NO editar a mano.");
  partes.push("-- Aplicar DESPUÉS de schema.sql + seed.sql en la base de destino.\n");

  // --- Usuarios (con su hash real, para no tener que reescribir contraseñas) ---
  const usuarios = await pool.query(
    `SELECT u.nombre, u.email, u.password_hash, r.nombre AS rol_nombre, u.activo
       FROM usuarios u JOIN roles r ON r.id = u.rol_id
      ORDER BY r.nombre, u.nombre`,
  );
  partes.push(`-- ${usuarios.rows.length} usuario(s)`);
  for (const u of usuarios.rows) {
    partes.push(
      `INSERT INTO usuarios (nombre, email, password_hash, rol_id, activo)
VALUES (${sqlString(u.nombre)}, ${sqlString(u.email)}, ${sqlString(u.password_hash)},
        (SELECT id FROM roles WHERE nombre = ${sqlString(u.rol_nombre)}), ${u.activo})
ON CONFLICT (email) DO UPDATE SET
  nombre = EXCLUDED.nombre, password_hash = EXCLUDED.password_hash,
  rol_id = EXCLUDED.rol_id, activo = EXCLUDED.activo;\n`,
    );
  }

  // --- Categorías del menú (Migao) ---
  const categorias = await pool.query(`SELECT nombre FROM categorias_producto ORDER BY nombre`);
  partes.push(`-- ${categorias.rows.length} categoría(s) de menú`);
  for (const c of categorias.rows) {
    partes.push(
      `INSERT INTO categorias_producto (nombre) VALUES (${sqlString(c.nombre)}) ON CONFLICT (nombre) DO NOTHING;`,
    );
  }
  partes.push("");

  // --- Productos del menú (solo módulo Migao) ---
  const productos = await pool.query(
    `SELECT p.nombre, p.precio, p.costo, p.unidad_medida, p.descripcion, p.imagen_url, p.activo,
            cp.nombre AS categoria_nombre
       FROM productos p
       JOIN modulos m ON m.id = p.modulo_id
       LEFT JOIN categorias_producto cp ON cp.id = p.categoria_id
      WHERE m.slug = 'migao'
      ORDER BY cp.nombre NULLS LAST, p.nombre`,
  );
  partes.push(`-- ${productos.rows.length} producto(s) del menú`);
  for (const p of productos.rows) {
    const categoriaSql = p.categoria_nombre
      ? `(SELECT id FROM categorias_producto WHERE nombre = ${sqlString(p.categoria_nombre)})`
      : "NULL";
    partes.push(
      `INSERT INTO productos (nombre, modulo_id, precio, costo, unidad_medida, descripcion, categoria_id, activo)
VALUES (${sqlString(p.nombre)}, (SELECT id FROM modulos WHERE slug = 'migao'), ${p.precio}, ${p.costo},
        ${sqlString(p.unidad_medida)}, ${sqlString(p.descripcion)}, ${categoriaSql}, ${p.activo});`,
    );
  }
  // Nota: las fotos (imagen_url) no se copian — apuntan a archivos en el disco
  // local (backend/uploads/), que no viajan con la base de datos. Hay que
  // volver a subir las fotos ya en producción desde el Menú del Administrador.

  const destino = path.join(__dirname, "..", "..", "database", "produccion-usuarios-menu.sql");
  fs.writeFileSync(destino, partes.join("\n"));
  console.log(`Listo: ${destino}`);
  console.log(`${usuarios.rows.length} usuarios, ${categorias.rows.length} categorías, ${productos.rows.length} productos.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
