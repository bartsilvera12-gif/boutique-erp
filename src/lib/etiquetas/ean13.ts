/**
 * Generador de código de barras EAN-13 como SVG. Sin dependencias externas.
 * El código debe llegar ya con 13 dígitos (incluye verificador) — usualmente
 * viene de /api/productos/codigo-barras.
 */

const L = ["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"];
const G = ["0100111","0110011","0011011","0100001","0011101","0111001","0000101","0010001","0001001","0010111"];
const R = ["1110010","1100110","1101100","1000010","1011100","1001110","1010000","1000100","1001000","1110100"];
const PARITY: Record<string, string> = {
  "0":"LLLLLL","1":"LLGLGG","2":"LLGGLG","3":"LLGGGL","4":"LGLLGG",
  "5":"LGGLLG","6":"LGGGLL","7":"LGLGLG","8":"LGLGGL","9":"LGGLGL",
};

/** Devuelve una cadena de 95 bits ("0"/"1") con la codificación EAN-13. */
export function ean13Bits(code: string): string {
  if (!/^\d{13}$/.test(code)) throw new Error("EAN-13 requiere 13 dígitos");
  const first = code[0];
  const parity = PARITY[first];
  let bits = "101";
  const left = code.slice(1, 7);
  for (let i = 0; i < 6; i++) {
    const d = Number(left[i]);
    bits += parity[i] === "L" ? L[d] : G[d];
  }
  bits += "01010";
  const right = code.slice(7, 13);
  for (let i = 0; i < 6; i++) bits += R[Number(right[i])];
  bits += "101";
  return bits;
}

export interface Ean13SvgOptions {
  /** Ancho total del SVG en unidades (default 190 = ~50mm a 3.8/mm). */
  width?: number;
  /** Alto de las barras. */
  barHeight?: number;
  /** Tamaño del texto (dígitos legibles debajo). */
  fontSize?: number;
}

/**
 * Devuelve un string SVG con el barcode EAN-13. Las guardas (start/center/end)
 * se extienden un poco más abajo, imitando el estándar. Debajo de las barras
 * van los dígitos legibles: el primero a la izquierda, los 6 del bloque izq.
 * centrados bajo el bloque izquierdo y los 6 del bloque der. bajo el derecho.
 */
export function ean13Svg(code: string, opts: Ean13SvgOptions = {}): string {
  const bits = ean13Bits(code);
  const totalModules = 95;
  const width = opts.width ?? 190;
  const moduleW = width / totalModules;
  const barHeight = opts.barHeight ?? 60;
  const fontSize = opts.fontSize ?? 11;
  const guardExtra = 5;
  const textY = barHeight + fontSize + 1;
  const totalHeight = barHeight + guardExtra + fontSize + 2;

  // Posiciones de las guardas (índices en la cadena de 95 bits).
  const guardModules = new Set<number>();
  for (let i = 0; i < 3; i++) guardModules.add(i); // start
  for (let i = 3 + 42; i < 3 + 42 + 5; i++) guardModules.add(i); // center
  for (let i = totalModules - 3; i < totalModules; i++) guardModules.add(i); // end

  // Colapso barras consecutivas para menos <rect>.
  let rects = "";
  let i = 0;
  while (i < totalModules) {
    if (bits[i] === "1") {
      let j = i;
      const isGuard = guardModules.has(i);
      while (j < totalModules && bits[j] === "1" && guardModules.has(j) === isGuard) j++;
      const x = i * moduleW;
      const w = (j - i) * moduleW;
      const h = barHeight + (isGuard ? guardExtra : 0);
      rects += `<rect x="${x.toFixed(3)}" y="0" width="${w.toFixed(3)}" height="${h.toFixed(3)}" fill="#000"/>`;
      i = j;
    } else {
      i++;
    }
  }

  const first = code[0];
  const leftDigits = code.slice(1, 7);
  const rightDigits = code.slice(7, 13);
  const leftCenter = (3 + 21) * moduleW;
  const rightCenter = (3 + 42 + 5 + 21) * moduleW;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${totalHeight}" width="100%" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges">
    ${rects}
    <g font-family="Helvetica, Arial, sans-serif" font-size="${fontSize}" fill="#000" shape-rendering="auto">
      <text x="0" y="${textY}">${first}</text>
      <text x="${leftCenter.toFixed(2)}" y="${textY}" text-anchor="middle" letter-spacing="1">${leftDigits}</text>
      <text x="${rightCenter.toFixed(2)}" y="${textY}" text-anchor="middle" letter-spacing="1">${rightDigits}</text>
    </g>
  </svg>`;
}
