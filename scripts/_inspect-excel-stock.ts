import * as XLSX from "xlsx";
import path from "node:path";

const file = process.argv[2];
if (!file) { console.error("Uso: tsx _inspect-excel-stock.ts <ruta.xls>"); process.exit(2); }

const wb = XLSX.readFile(path.resolve(file));
console.log("Sheets:", wb.SheetNames);

for (const sn of wb.SheetNames) {
  const ws = wb.Sheets[sn];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  console.log(`\n── ${sn} (${rows.length} filas) ──`);
  if (rows.length === 0) continue;
  console.log("Columnas:", Object.keys(rows[0]));
  // Buscar productos del top
  const targets = ["CABLE DE BATERIA 25", "CINTA LED 12V ROJO SIN SILICONA", "ESTANO 1.5", "CINTA TELA", "BM 25", "BM25"];
  const matches = rows.filter((r) => {
    const s = Object.values(r).map(String).join(" ").toUpperCase();
    return targets.some((t) => s.includes(t));
  });
  console.log(`Matches con productos del top: ${matches.length}`);
  for (const m of matches.slice(0, 20)) console.log(JSON.stringify(m));
}
