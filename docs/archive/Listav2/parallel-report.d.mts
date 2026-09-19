/**
 * Tipos de `parallel-report.mjs`.
 *
 * El modulo es JavaScript a proposito -vive junto al tablero, que tampoco se compila-, pero la
 * prueba que impide que el bloque de reparto envejezca lo importa desde TypeScript, y sin esta
 * declaracion el typecheck del paquete `qa` falla con TS7016.
 */

/** Marcadores que delimitan el bloque generado dentro de `tasksv2.md`. */
export declare const startMarker: string;
export declare const endMarker: string;

/** Construye el bloque de reparto a partir del tablero ya cargado. */
export declare function renderParallelReport(): string;

/** Devuelve el ledger con el bloque sustituido por `report`. */
export declare function applyParallelReport(ledger: string, report: string): string;
