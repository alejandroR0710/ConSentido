import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ApiError, resolveImageUrl } from "../../../shared/api/client";
import { ImagenConZoom } from "../../../shared/components/ImagenConZoom";
import { formatearTextoBasico } from "../../../shared/format/texto";
import { recetarioApi, type Receta } from "../api";
import { urlEmbedVideo } from "../video";

export function RecetaDetallePage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const emplatadoResaltado = searchParams.get("emplatado");
  const [receta, setReceta] = useState<Receta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    recetarioApi
      .obtener(id)
      .then(setReceta)
      .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudo cargar la receta"))
      .finally(() => setLoading(false));
  }, [id]);

  // Llegar desde Cocina con ?emplatado=<id> lleva directo a esa presentación
  // en vez de dejar que el cocinero la busque entre varias.
  useEffect(() => {
    if (!receta || !emplatadoResaltado) return;
    document.getElementById(`emplatado-${emplatadoResaltado}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [receta, emplatadoResaltado]);

  if (loading) return <p className="text-center text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!receta) return null;

  const embedVideo = receta.video_url ? urlEmbedVideo(receta.video_url) : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <Link
        to="/recetario/ver"
        className="self-start text-sm font-medium text-brand-green-700 hover:underline dark:text-brand-vanilla"
      >
        ← Volver a recetas
      </Link>

      <h1 className="text-3xl font-bold text-brand-green-700 dark:text-brand-vanilla">{receta.titulo}</h1>
      {receta.categoria_nombre && (
        <span className="self-start rounded-full bg-brand-green-50 px-3 py-1 text-sm font-medium text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
          {receta.categoria_nombre}
        </span>
      )}

      {receta.imagen_principal_url && (
        <ImagenConZoom
          src={resolveImageUrl(receta.imagen_principal_url)!}
          alt={receta.titulo}
          className="w-full rounded-xl object-cover"
        />
      )}

      {receta.video_url &&
        (embedVideo ? (
          <div className="aspect-video w-full overflow-hidden rounded-xl">
            <iframe src={embedVideo} allowFullScreen className="h-full w-full" title={receta.titulo} />
          </div>
        ) : (
          <a
            href={receta.video_url}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-brand-green-700 px-4 py-3 text-center text-brand-green-700 hover:bg-brand-green-50 dark:border-brand-vanilla dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
          >
            ▶ Ver video
          </a>
        ))}

      <p
        className="whitespace-pre-wrap text-xl leading-relaxed text-brand-ink dark:text-brand-vanilla"
        dangerouslySetInnerHTML={{ __html: formatearTextoBasico(receta.instrucciones) }}
      />

      {receta.emplatados.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-brand-green-700 dark:text-brand-vanilla">
            {receta.emplatados.length > 1 ? "Presentaciones de emplatado" : "Ejemplo de emplatado"}
          </h2>
          {receta.emplatados.map((e) => (
            <div
              key={e.id}
              id={`emplatado-${e.id}`}
              className={`flex flex-col gap-3 rounded-xl border p-4 transition-colors ${
                emplatadoResaltado === e.id
                  ? "border-brand-green-600 bg-brand-green-50 dark:bg-brand-green-700/30"
                  : "border-brand-vanilla-dark dark:border-brand-green-700"
              }`}
            >
              {receta.emplatados.length > 1 && (
                <span className="text-sm font-semibold text-brand-ink dark:text-brand-vanilla">{e.nombre}</span>
              )}
              {e.imagen_url && (
                <ImagenConZoom src={resolveImageUrl(e.imagen_url)!} alt={e.nombre} className="w-full rounded-lg object-cover" />
              )}
              {e.guia && (
                <p
                  className="whitespace-pre-wrap text-base text-brand-ink/80 dark:text-brand-vanilla/80"
                  dangerouslySetInnerHTML={{ __html: formatearTextoBasico(e.guia) }}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
