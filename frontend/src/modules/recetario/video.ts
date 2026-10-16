/** Convierte un link de YouTube/Vimeo en una URL de embed para un <iframe>.
 *  Cualquier otro formato (Drive, etc.) no se puede incrustar de forma
 *  genérica — devuelve null, y el detalle cae a mostrar un link simple en
 *  vez de intentar un embed que no funcionaría. */
export function urlEmbedVideo(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.hostname.includes("youtube.com")) {
    const id = u.searchParams.get("v");
    return id ? `https://www.youtube.com/embed/${id}` : null;
  }
  if (u.hostname === "youtu.be") {
    const id = u.pathname.slice(1);
    return id ? `https://www.youtube.com/embed/${id}` : null;
  }
  if (u.hostname.includes("vimeo.com")) {
    const id = u.pathname.split("/").filter(Boolean).pop();
    return id ? `https://player.vimeo.com/video/${id}` : null;
  }
  return null;
}
