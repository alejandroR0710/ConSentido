function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatoEnLinea(s: string): string {
  // **negrilla** o __negrilla__ primero: así no quedan asteriscos/guiones
  // bajos sueltos que la cursiva de abajo interprete por error.
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__(.+?)__/g, "<strong>$1</strong>");
  s = s.replace(/\*(.+?)\*/g, "<em>$1</em>");
  s = s.replace(/_(.+?)_/g, "<em>$1</em>");
  return s;
}

/** Negrilla (**texto** o __texto__), cursiva (*texto* o _texto_) y viñetas
 *  ("- " o "* " al inicio de línea) en texto libre — pensado para
 *  instrucciones/descripciones de receta, donde el cocinero escribe en un
 *  textarea simple sin barra de herramientas. El texto se escapa ANTES de
 *  aplicar el formato, así lo que el usuario escriba nunca se interpreta
 *  como HTML real (ver dangerouslySetInnerHTML en quien use esto). */
export function formatearTextoBasico(texto: string): string {
  return texto
    .split("\n")
    .map((linea) => formatoEnLinea(escapeHtml(linea).replace(/^(\s*)[-*]\s+/, "$1• ")))
    .join("\n");
}
