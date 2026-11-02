export interface SemanaOpcion {
  value: string;
  label: string;
  grupo: "mes" | "iso";
  desde: string;
  hasta: string;
}

function parseFecha(fecha: string): Date {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  return new Date(anio, mes - 1, dia);
}

function fechaISO(fecha: Date): string {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}-${String(fecha.getDate()).padStart(2, "0")}`;
}

function sumarDias(fecha: Date, dias: number): Date {
  const resultado = new Date(fecha);
  resultado.setDate(resultado.getDate() + dias);
  return resultado;
}

function etiquetaRango(desde: Date, hasta: Date): string {
  const formato = (fecha: Date) =>
    `${String(fecha.getDate()).padStart(2, "0")}/${String(fecha.getMonth() + 1).padStart(2, "0")}`;
  return `${formato(desde)}–${formato(hasta)}`;
}

function numeroSemanaIso(fecha: Date): number {
  const jueves = sumarDias(fecha, 3 - ((fecha.getDay() + 6) % 7));
  const inicioAnio = new Date(jueves.getFullYear(), 0, 1);
  const diaDelAnio = Math.floor((jueves.getTime() - inicioAnio.getTime()) / 86_400_000) + 1;
  return Math.ceil(diaDelAnio / 7);
}

export function obtenerOpcionesSemana(desde: string, hasta: string, incluirSemanaIso: boolean): SemanaOpcion[] {
  if (desde.slice(0, 7) !== hasta.slice(0, 7) || desde > hasta) return [];

  const fechaDesde = parseFecha(desde);
  const fechaHasta = parseFecha(hasta);
  const anio = fechaDesde.getFullYear();
  const mes = fechaDesde.getMonth();
  const primerDia = new Date(anio, mes, 1);
  const ultimoDia = new Date(anio, mes + 1, 0);
  const opciones: SemanaOpcion[] = [];

  for (let dia = 1; dia <= ultimoDia.getDate(); dia += 7) {
    const semanaDesde = new Date(anio, mes, dia);
    const semanaHasta = new Date(anio, mes, Math.min(dia + 6, ultimoDia.getDate()));
    if (semanaHasta < fechaDesde || semanaDesde > fechaHasta) continue;
    const semana = Math.ceil(dia / 7);
    opciones.push({
      value: `mes:${anio}-${String(mes + 1).padStart(2, "0")}:${semana}`,
      label: `Semana ${semana} (${etiquetaRango(semanaDesde, semanaHasta)})`,
      grupo: "mes",
      desde: fechaISO(semanaDesde),
      hasta: fechaISO(semanaHasta),
    });
  }

  if (incluirSemanaIso) {
    const primerLunes = sumarDias(primerDia, -((primerDia.getDay() + 6) % 7));
    for (let semanaDesde = primerLunes; semanaDesde <= ultimoDia; semanaDesde = sumarDias(semanaDesde, 7)) {
      const semanaHasta = sumarDias(semanaDesde, 6);
      if (semanaHasta < fechaDesde || semanaDesde > fechaHasta) continue;
      opciones.push({
        value: `iso:${fechaISO(semanaDesde)}`,
        label: `Semana ISO ${numeroSemanaIso(semanaDesde)} (${etiquetaRango(semanaDesde, semanaHasta)})`,
        grupo: "iso",
        desde: fechaISO(semanaDesde),
        hasta: fechaISO(semanaHasta),
      });
    }
  }

  return opciones;
}

/** Ajusta el rango del reporte a la semana seleccionada, intersectándolo
 *  con el período activo para no consultar fuera de las fechas elegidas. */
export function resolverRangoSemana(
  desde: string,
  hasta: string,
  value: string,
): { desde: string; hasta: string } | undefined {
  const opcion = obtenerOpcionesSemana(desde, hasta, true).find((item) => item.value === value);
  if (!opcion) return undefined;
  const rangoDesde = opcion.desde > desde ? opcion.desde : desde;
  const rangoHasta = opcion.hasta < hasta ? opcion.hasta : hasta;
  return rangoDesde <= rangoHasta ? { desde: rangoDesde, hasta: rangoHasta } : undefined;
}