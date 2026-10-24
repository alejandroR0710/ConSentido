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

// # Título, ## Título, ### Título -> letra grande y en negrilla, tres
// tamaños (el más grande para un solo "#"). Sigue dentro del mismo flujo de
// texto con saltos de línea (whitespace-pre-wrap en quien lo use), no se
// convierte en un bloque <h1> aparte — más simple y consistente con cómo ya
// se ven las viñetas.
const TAMANO_TITULO: Record<number, string> = {
  1: "text-2xl",
  2: "text-xl",
  3: "text-lg",
};

/** Negrilla (**texto** o __texto__), cursiva (*texto* o _texto_), títulos
 *  (#/##/### al inicio de línea) y viñetas ("- " o "* " al inicio de línea)
 *  en texto libre — pensado para instrucciones/descripciones de receta,
 *  donde el cocinero escribe en un textarea simple sin barra de
 *  herramientas. El texto se escapa ANTES de aplicar el formato, así lo que
 *  el usuario escriba nunca se interpreta como HTML real (ver
 *  dangerouslySetInnerHTML en quien use esto). */
export function formatearTextoBasico(texto: string): string {
  return texto
    .split("\n")
    .map((linea) => {
      const escapada = escapeHtml(linea);
      const titulo = /^(#{1,3})\s+(.*)/.exec(escapada);
      if (titulo) {
        const nivel = titulo[1].length;
        return `<span class="${TAMANO_TITULO[nivel]} font-bold">${formatoEnLinea(titulo[2])}</span>`;
      }
      return formatoEnLinea(escapada.replace(/^(\s*)[-*]\s+/, "$1• "));
    })
    .join("\n");
}
