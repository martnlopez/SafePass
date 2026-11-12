// Marcas de "resultado atípico" que calcula el servidor (supabase/migrations, D9). Solo las lee
// el supervisor: sirven para decidir si revisar el caso, no bloquean al trabajador.

export const FLAG_TEXT: Record<string, string> = {
  muy_rapido: "Terminó la batería en menos de 2 minutos (lo normal es cerca de 4).",
  puntajes_identicos: "Las 5 pruebas tienen exactamente el mismo puntaje.",
  perfecto_y_rapido: "Puntaje casi perfecto en las 5 pruebas y en menos de 3 minutos.",
  detalle_no_estandar: "El detalle de alguna prueba no tiene el formato que genera la app.",
  gonogo_incoherente: "El puntaje de Go/No-Go no cuadra con sus aciertos y falsos positivos.",
  memoria_incoherente: "El puntaje de Memoria no cuadra con los niveles superados.",
}

/** Texto legible de una marca (las desconocidas se muestran tal cual, por si el servidor agrega nuevas) */
export function flagText(code: string): string {
  return FLAG_TEXT[code] ?? code
}
