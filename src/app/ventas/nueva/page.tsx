"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import MontoInput from "@/components/ui/MontoInput";
import ProductPickerModal, { type ProductoPickerItem, type AgregarVentaPayload } from "@/components/inventario/ProductPickerModal";
import { saveVenta, type FaltanteStock } from "@/lib/ventas/storage";
import type { TipoIvaVenta, TipoVenta, MonedaVenta, LineaVenta, MetodoPago, TipoPrecioVenta } from "@/lib/ventas/types";
import type { Producto } from "@/lib/inventario/types";

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatGs(valor: number) {
  return `Gs. ${Math.round(valor).toLocaleString("es-PY")}`;
}

/**
 * IVA INFORMATIVO (Autorepuestos Felix Bogado): el precio NO incluye IVA y el
 * IVA tampoco se suma al total. `subtotal` es precio × cantidad y `total línea`
 * es igual al subtotal. Sólo se calcula el monto de IVA para mostrarlo a modo
 * informativo (subtotal × tasa).
 *   EXENTA → 0 · 5% → subtotal × 0.05 · 10% → subtotal × 0.10
 */
function calcIva(tipo: TipoIvaVenta, subtotal: number) {
  if (tipo === "EXENTA") return 0;
  if (tipo === "5%")     return subtotal * 0.05;
  return subtotal * 0.10;
}

/**
 * Precio unitario (Gs.) según el tipo elegido, con fallbacks:
 *  minorista → precio_venta;
 *  mayorista → precio_mayorista (>0) o fallback a precio_venta;
 *  costo     → costo_promedio.
 */
function precioPorTipo(p: Producto, tipo: TipoPrecioVenta): number {
  if (tipo === "mayorista") return p.precio_mayorista != null && p.precio_mayorista > 0 ? p.precio_mayorista : p.precio_venta;
  if (tipo === "distribuidor") return p.precio_distribuidor != null && p.precio_distribuidor > 0 ? p.precio_distribuidor : p.precio_venta;
  if (tipo === "costo") return p.costo_promedio ?? 0; // histórico: ya no se ofrece en la UI
  return p.precio_venta;
}

/** Tipos de precio ofrecidos en la UI (sin 'costo', que queda solo como histórico). */
const TIPOS_PRECIO_UI: TipoPrecioVenta[] = ["minorista", "mayorista", "distribuidor"];

const tipoPrecioLabel: Record<TipoPrecioVenta, string> = {
  minorista: "Minorista",
  mayorista: "Mayorista",
  distribuidor: "Distribuidor",
  costo: "Al costo",
};

// ── Estilos ────────────────────────────────────────────────────────────────────

const inputClass =
  "w-full border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:outline-none bg-white text-sm";
const labelClass = "block text-sm font-medium text-slate-700 mb-1.5";

// ── Sub-componentes ───────────────────────────────────────────────────────────

function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`flex border border-slate-200 rounded-lg overflow-hidden ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(opt.value)}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            value === opt.value
              ? "bg-[#0EA5E9] text-white"
              : "bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
      {children}
    </p>
  );
}

const ivaLabel: Record<TipoIvaVenta, string> = {
  EXENTA: "Exenta",
  "5%":   "5%",
  "10%":  "10%",
};

// ── Componente principal ───────────────────────────────────────────────────────

export default function NuevaVentaPage() {
  const router = useRouter();

  // ── Estado global ──────────────────────────────────────────────────────────
  const [productos, setProductos]   = useState<Producto[]>([]);
  const [items, setItems]           = useState<LineaVenta[]>([]);
  const [errorLinea, setErrorLinea] = useState<string | null>(null);
  const [errorVenta, setErrorVenta] = useState<string | null>(null);
  // Venta sin stock: faltantes devueltos por el backend + modal de confirmación.
  const [faltantes, setFaltantes] = useState<FaltanteStock[]>([]);
  const [confirmSinStockOpen, setConfirmSinStockOpen] = useState(false);
  // Guard anti doble-submit: estado para UI (botón/spinner) + ref para bloqueo síncrono
  // inmediato (React puede tardar en aplicar el estado; el ref corta el segundo disparo ya).
  const [guardando, setGuardando] = useState(false);
  const isSubmittingRef = useRef(false);

  // Facturación de un pedido enviado a Caja (?pedido_id=...). Precarga items + cliente.
  const [pedidoId, setPedidoId] = useState<string | null>(null);
  const [pedidoNumero, setPedidoNumero] = useState<string | null>(null);

  // ── Condiciones de la venta ───────────────────────────────────────────────
  // Instancia dedicada: siempre Guaraníes.
  const moneda: MonedaVenta = "GS";

  // Contado / Crédito (campos ya existentes en `ventas`: tipo_venta + plazo_dias).
  const [tipoVenta, setTipoVenta] = useState<TipoVenta>("CONTADO");
  const [plazoDias, setPlazoDias] = useState("");

  // Cliente (opcional). Si se selecciona, se envía cliente_id al crear la venta.
  type ClienteLite = { id: string; label: string; ruc: string | null; usa_nota_remision: boolean };
  const [clientes, setClientes] = useState<ClienteLite[]>([]);
  const [clienteId, setClienteId] = useState("");
  const [clienteQuery, setClienteQuery] = useState("");
  const [clienteOpen, setClienteOpen] = useState(false);
  const clienteContainerRef = useRef<HTMLDivElement>(null);
  // Nota de remisión: activada si el cliente la usa; toggle manual solo con cliente.
  const [generaNotaRemision, setGeneraNotaRemision] = useState(false);

  // ── Cobro (split payment: N métodos por venta) ────────────────────────────
  const [entidades, setEntidades] = useState<{ id: string; codigo: string | null; nombre: string; tipo: string | null }[]>([]);

  type PagoRow = {
    id: string;
    metodo: MetodoPago;
    monto: string;
    entidad_id: string;
    referencia: string;
    titular: string;
  };
  function nuevoPagoRow(): PagoRow {
    return { id: crypto.randomUUID(), metodo: "efectivo", monto: "", entidad_id: "", referencia: "", titular: "" };
  }
  const [pagos, setPagos] = useState<PagoRow[]>([nuevoPagoRow()]);

  // ── Línea en construcción ─────────────────────────────────────────────────
  const [lineaProdId, setLineaProdId] = useState("");
  const [lineaCant,   setLineaCant]   = useState("");
  const [lineaPrecio, setLineaPrecio] = useState("");
  const [lineaIva,    setLineaIva]    = useState<TipoIvaVenta>("EXENTA");
  const [lineaTipoPrecio, setLineaTipoPrecio] = useState<TipoPrecioVenta>("minorista");

  // ── Combobox de producto ───────────────────────────────────────────────────
  const [comboQuery,     setComboQuery]     = useState("");
  const [comboOpen,      setComboOpen]      = useState(false);
  const [comboHighlight, setComboHighlight] = useState(-1);
  const comboInputRef    = useRef<HTMLInputElement>(null);
  const comboContainerRef = useRef<HTMLDivElement>(null);

  // ── Modal buscador (F3) ────────────────────────────────────────────────────
  const [pickerOpen, setPickerOpen] = useState(false);

  function pickerToProducto(p: ProductoPickerItem): Producto {
    return {
      id: p.id,
      nombre: p.nombre,
      sku: p.sku,
      precio_venta: p.precio_venta,
      precio_mayorista: p.precio_mayorista ?? null,
      precio_distribuidor: p.precio_distribuidor ?? null,
      stock_actual: p.stock_actual,
      unidad_medida: p.unidad_medida,
      costo_promedio: p.costo_promedio ?? 0,
      stock_minimo: 0,
      metodo_valuacion: "CPP",
      codigo_barras: p.codigo_barras,
      codigo_barras_interno: p.codigo_barras_interno,
      imagen_path: null,
      imagen_url: p.imagen_url,
    };
  }

  function handleSelectFromPicker(p: ProductoPickerItem) {
    const prod = pickerToProducto(p);
    setProductos((prev) => (prev.find((x) => x.id === prod.id) ? prev : [...prev, prod]));
    seleccionarProducto(prod);
    setPickerOpen(false);
  }

  /**
   * Agregado directo desde el modal: arma la LineaVenta usando la misma
   * logica que handleAgregarLinea pero con datos del modal, sin pasar
   * por el form inline. Mantiene el modal abierto si todo OK.
   */
  function handleAgregarDesdePicker(payload: AgregarVentaPayload): boolean {
    const { producto: p, cantidad, precio_input, iva, tipo_precio } = payload;
    const precioPyg = precio_input;
    // Verificar stock vs lo ya cargado SOLO si el producto controla stock.
    // Venta sin stock (Fase 5): NO se bloquea por falta de stock al agregar; la
    // confirmación se pide al registrar la venta. El Menú (controla_stock=false) tampoco valida.
    // IVA informativo: el subtotal es precio × cantidad y el total de la línea
    // es igual al subtotal. El monto de IVA se calcula sólo para mostrarse en
    // ticket/recibo, no se suma al total.
    const subtotal = cantidad * precioPyg;
    const montoIva = calcIva(iva, subtotal);
    const totalLinea = subtotal;

    // Asegurar que el producto este en el array local (para que stock_actual
    // se conozca en validaciones posteriores del form inline).
    const prodLocal = pickerToProducto(p);
    setProductos((prev) => (prev.find((x) => x.id === prodLocal.id) ? prev : [...prev, prodLocal]));

    setItems((prev) => [
      ...prev,
      {
        producto_id: p.id,
        producto_nombre: p.nombre,
        sku: p.sku,
        cantidad,
        precio_venta_original: precio_input,
        precio_venta: precioPyg,
        tipo_iva: iva,
        tipo_precio,
        subtotal,
        monto_iva: montoIva,
        total_linea: totalLinea,
      },
    ]);
    setErrorVenta(null);
    return true;
  }

  // Precarga de catálogo completo desactivada: con >500 productos el endpoint
  // /api/productos es pesado y bajo carga alta el backend puede timeouar
  // (502 en Cloudflare). Para agregar productos usar SIEMPRE el buscador F3
  // (ProductPickerModal) — que usa /api/productos/search paginado y liviano.
  // El combobox interno queda inactivo (sin data) hasta que refactoricemos
  // para hacerlo lazy con debounce contra el mismo endpoint search.
  useEffect(() => {
    // no-op — ver comentario arriba
  }, []);

  // Precarga al facturar un pedido (Caja): lee ?pedido_id=, trae el pedido y carga sus
  // items + cliente en el carrito. NO crea nada acá; la venta se genera al confirmar.
  useEffect(() => {
    let cancelled = false;
    let pid: string | null = null;
    try {
      pid = new URLSearchParams(window.location.search).get("pedido_id");
    } catch { pid = null; }
    if (!pid) return;
    setPedidoId(pid);
    (async () => {
      try {
        const res = await fetch(`/api/pedidos-caja/${pid}`, { credentials: "include", cache: "no-store" });
        const j = await res.json();
        if (cancelled || !j?.success || !j.data?.pedido) return;
        const p = j.data.pedido as {
          titulo?: string;
          cliente_id?: string | null;
          items?: Array<{ producto_id: string; producto_nombre: string; sku: string | null; cantidad: number; precio_venta: number; tipo_precio: "minorista" | "mayorista" }>;
        };
        setPedidoNumero(p.titulo ?? null);
        const lineas: LineaVenta[] = (p.items ?? [])
          .filter((it) => it.producto_id && (Number(it.cantidad) || 0) > 0)
          .map((it) => {
            const cantidad = Number(it.cantidad) || 0;
            const precio = Number(it.precio_venta) || 0;
            const iva: TipoIvaVenta = "EXENTA";
            // IVA informativo: subtotal = precio × cantidad; total línea = subtotal.
            const subtotal = cantidad * precio;
            const montoIva = calcIva(iva, subtotal);
            const totalLinea = subtotal;
            return {
              producto_id: String(it.producto_id),
              producto_nombre: it.producto_nombre ?? "",
              sku: it.sku ?? "",
              cantidad,
              precio_venta_original: precio,
              precio_venta: precio,
              tipo_iva: iva,
              tipo_precio: (it.tipo_precio === "mayorista" ? "mayorista" : "minorista") as TipoPrecioVenta,
              subtotal,
              monto_iva: montoIva,
              total_linea: totalLinea,
            };
          });
        if (!cancelled && lineas.length) setItems(lineas);
        if (!cancelled && p.cliente_id) setClienteId(String(p.cliente_id));
      } catch { /* el aviso seguirá visible; el cajero puede cargar manualmente */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Cargar entidades bancarias (caja/banco/tarjeta/billetera) para el detalle de cobro.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/entidades-bancarias", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!cancelled && j?.success) setEntidades(j.data?.entidades ?? []); })
      .catch(() => { /* no bloquea la venta si falla */ });
    return () => { cancelled = true; };
  }, []);

  // Cargar clientes (buscador opcional de cliente en la venta).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/clientes", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled || !j?.success || !Array.isArray(j.data)) return;
        const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
        const lite: ClienteLite[] = (j.data as Record<string, unknown>[]).map((r) => ({
          id: String(r.id),
          label: s(r.empresa) || s(r.nombre_contacto) || s(r.nombre) || "Cliente",
          ruc: s(r.ruc) || null,
          usa_nota_remision: r.usa_nota_remision === true,
        }));
        setClientes(lite);
      })
      .catch(() => { /* el buscador de cliente es opcional, no bloquea la venta */ });
    return () => { cancelled = true; };
  }, []);

  // Auto-abrir el picker al entrar (carrito vacío). El picker NO hace
  // ninguna búsqueda automática al abrir; recién dispara el fetch cuando
  // el usuario tipea ≥2 letras. Excepción: si se está facturando un
  // pedido (?pedido_id=...) el carrito viene precargado y no se auto-abre.
  useEffect(() => {
    let tienePedido = false;
    try {
      tienePedido = !!new URLSearchParams(window.location.search).get("pedido_id");
    } catch { tienePedido = false; }
    if (!tienePedido) setPickerOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cerrar dropdown al hacer clic fuera
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (comboContainerRef.current && !comboContainerRef.current.contains(e.target as Node)) {
        setComboOpen(false);
      }
      if (clienteContainerRef.current && !clienteContainerRef.current.contains(e.target as Node)) {
        setClienteOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Scroll a la opción destacada en el dropdown
  useEffect(() => {
    if (comboHighlight >= 0) {
      document.getElementById(`combo-opt-${comboHighlight}`)?.scrollIntoView({ block: "nearest" });
    }
  }, [comboHighlight]);

  // ── Cálculos ───────────────────────────────────────────────────────────────
  const tipoCambioNum = 1;

  const prodSel     = productos.find((p) => p.id === lineaProdId);
  // parseFloat para soportar decimales en unidades continuas (metros, kg, lt).
  // Para UNIDAD/CAJA/DOCENA el front usa step=1 desde el input → siempre entero.
  const cantNum     = parseFloat(lineaCant) || 0;
  const precioInput = parseFloat(lineaPrecio) || 0;
  const precioGs    = precioInput;

  const enCarrito = items
    .filter((i) => i.producto_id === lineaProdId)
    .reduce((s, i) => s + i.cantidad, 0);
  const prodSelControlaStock = prodSel ? prodSel.controla_stock !== false : true;
  const stockDisp = (prodSel?.stock_actual ?? 0) - enCarrito;

  // IVA informativo: subtotal = precio × cantidad; total línea = subtotal
  // (no se suma IVA). El monto IVA queda visible para ticket/recibo.
  const lineaSubtotal   = cantNum > 0 && precioGs > 0 ? cantNum * precioGs : 0;
  const lineaMontoIva   = calcIva(lineaIva, lineaSubtotal);
  const lineaTotalLinea = lineaSubtotal;

  // Aviso de stock (no bloquea): si falta stock se permite agregar igual y se pide
  // confirmación al confirmar la venta (venta sin stock con confirmación, Fase 5).
  // Productos del Menú (controla_stock=false) no controlan stock.
  const stockInsuf  = prodSel !== undefined && prodSelControlaStock && cantNum > 0 && cantNum > stockDisp;
  const lineaValida =
    !!prodSel && cantNum > 0 && precioGs > 0;

  const totalSubtotal = items.reduce((s, i) => s + i.subtotal, 0);
  const totalIva      = items.reduce((s, i) => s + i.monto_iva, 0);
  const totalGeneral  = items.reduce((s, i) => s + i.total_linea, 0);
  // Condición de venta: si es Crédito, exigir plazo de al menos 1 día.
  const plazoDiasNum = parseInt(plazoDias) || 0;
  // Crédito exige cliente seleccionado Y plazo/vencimiento (≥1 día). Genera cuenta por cobrar.
  const creditoValido = tipoVenta === "CONTADO" || (plazoDiasNum >= 1 && !!clienteId);
  // Split payment: si es CONTADO, Σ pagos debe cubrir el total (permitimos
  // pequeño excedente solo si hay efectivo, para vuelto).
  const pagosValidos = (() => {
    if (tipoVenta !== "CONTADO") return true;
    const suma = pagos.reduce((a, p) => a + (Number(p.monto) || 0), 0);
    if (suma + 0.5 < items.reduce((s, i) => s + i.total_linea, 0)) return false;
    const excede = suma - items.reduce((s, i) => s + i.total_linea, 0);
    const hayEfe = pagos.some((p) => p.metodo === "efectivo");
    if (excede > 0.5 && !hayEfe) return false;
    return true;
  })();
  const ventaValida   = items.length > 0 && creditoValido && pagosValidos;

  // Cliente (opcional) — selección + filtrado del buscador.
  const clienteSel = clientes.find((c) => c.id === clienteId) ?? null;
  const clientesFiltrados = (clienteQuery.trim() === ""
    ? clientes
    : clientes.filter((c) => {
        const q = clienteQuery.toLowerCase();
        return c.label.toLowerCase().includes(q) || (c.ruc ?? "").toLowerCase().includes(q);
      })
  ).slice(0, 50);

  // Cobro: entidad seleccionada + filtrado por código/nombre.
  // Sugerencia de entidad por método (default cuando el usuario elige método).
  function defaultEntidadIdPara(metodo: MetodoPago): string {
    if (metodo === "efectivo") return entidades.find((e) => e.tipo === "caja")?.id ?? "";
    if (metodo === "tarjeta") return entidades.find((e) => e.tipo === "tarjeta")?.id ?? "";
    return entidades.find((e) => e.tipo === "banco")?.id ?? "";
  }

  // Autocompletar el monto del PRIMER pago con el total mientras no lo hayan
  // tocado y no haya más de un pago. Cuando el usuario agrega un segundo pago
  // dejamos de autocompletar para no pisar lo que ingresó.
  useEffect(() => {
    setPagos((prev) => {
      if (prev.length !== 1) return prev;
      const p = prev[0];
      // Solo autocompletar si está vacío o coincidía con un total anterior.
      if (p.monto === "" || Number(p.monto) === 0) {
        return [{ ...p, monto: String(Math.round(totalGeneral)) }];
      }
      return prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Math.round(totalGeneral)]);

  const sumaPagos = pagos.reduce((a, p) => a + (Number(p.monto) || 0), 0);
  const restante  = totalGeneral - sumaPagos; // >0 falta cobrar, <0 vuelto
  const hayEfectivo = pagos.some((p) => p.metodo === "efectivo");

  function agregarPago() {
    setPagos((prev) => {
      const falta = totalGeneral - prev.reduce((a, p) => a + (Number(p.monto) || 0), 0);
      const nuevo = nuevoPagoRow();
      // Sugerir tarjeta si ya hay efectivo, o efectivo si no.
      nuevo.metodo = prev.some((p) => p.metodo === "efectivo") ? "tarjeta" : "efectivo";
      nuevo.entidad_id = defaultEntidadIdPara(nuevo.metodo);
      if (falta > 0) nuevo.monto = String(Math.round(falta));
      return [...prev, nuevo];
    });
  }
  function quitarPago(id: string) {
    setPagos((prev) => (prev.length <= 1 ? prev : prev.filter((p) => p.id !== id)));
  }
  function updatePago(id: string, patch: Partial<PagoRow>) {
    setPagos((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }
  function cambiarMetodoPago(id: string, metodo: MetodoPago) {
    setPagos((prev) =>
      prev.map((p) =>
        p.id === id
          ? { ...p, metodo, entidad_id: defaultEntidadIdPara(metodo), titular: metodo === "transferencia" ? p.titular : "" }
          : p
      )
    );
  }

  // ── Productos filtrados para el combobox ──────────────────────────────────
  // Solo vendibles (Reventa + Menú). Excluye materia prima / insumos.
  const productosVendibles = productos.filter((p) => p.es_vendible !== false);
  const comboFiltrados = comboQuery.trim() === ""
    ? productosVendibles
    : productosVendibles.filter((p) => {
        const q = comboQuery.toLowerCase();
        return p.nombre.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
      });

  // ── Selección de un producto desde el combobox ────────────────────────────
  function seleccionarProducto(p: Producto) {
    setLineaProdId(String(p.id));
    setLineaTipoPrecio("minorista");
    setLineaPrecio(String(precioPorTipo(p, "minorista")));
    setLineaCant("1");
    setLineaIva("EXENTA");
    setComboQuery(`${p.nombre} — ${p.sku}`);
    setComboOpen(false);
    setComboHighlight(-1);
    setErrorLinea(null);
  }

  /** Cambia el tipo de precio de la línea en construcción y ajusta el precio unitario. */
  function handleLineaTipoPrecio(tipo: TipoPrecioVenta) {
    setLineaTipoPrecio(tipo);
    if (prodSel) setLineaPrecio(String(precioPorTipo(prodSel, tipo)));
    setErrorLinea(null);
  }

  // ── Handlers del combobox ─────────────────────────────────────────────────
  function handleComboInput(e: React.ChangeEvent<HTMLInputElement>) {
    setComboQuery(e.target.value);
    setComboOpen(true);
    setComboHighlight(-1);
    // Si el usuario borra el texto, limpiar la selección
    if (e.target.value === "") {
      setLineaProdId("");
      setLineaPrecio("");
      setLineaCant("");
    }
    setErrorLinea(null);
  }

  function handleComboKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setComboOpen(true);
      setComboHighlight((h) => Math.min(h + 1, comboFiltrados.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setComboHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (comboOpen && comboHighlight >= 0 && comboFiltrados[comboHighlight]) {
        // Seleccionar el ítem destacado del dropdown
        seleccionarProducto(comboFiltrados[comboHighlight]);
      } else if (!comboOpen && lineaValida) {
        // Dropdown cerrado + producto válido → agregar al carrito
        handleAgregarLinea();
      }
    } else if (e.key === "Escape") {
      setComboOpen(false);
      setComboHighlight(-1);
    }
  }

  // ── Agregar línea al carrito ──────────────────────────────────────────────
  function handleAgregarLinea() {
    setErrorLinea(null);
    if (!prodSel)          return setErrorLinea("Seleccioná un producto.");
    if (cantNum <= 0)      return setErrorLinea("La cantidad debe ser mayor a 0.");
    if (precioGs <= 0)     return setErrorLinea("El precio de venta debe ser mayor a 0.");
    // Nota: si falta stock NO se bloquea; se confirma al registrar la venta.

    setItems((prev) => [
      ...prev,
      {
        producto_id:           prodSel.id,
        producto_nombre:       prodSel.nombre,
        sku:                   prodSel.sku,
        cantidad:              cantNum,
        precio_venta_original: precioInput,
        precio_venta:          precioGs,
        tipo_iva:              lineaIva,
        tipo_precio:           lineaTipoPrecio,
        subtotal:              lineaSubtotal,
        monto_iva:             lineaMontoIva,
        total_linea:           lineaTotalLinea,
      },
    ]);

    // Limpiar línea y devolver foco al buscador de producto
    setLineaProdId("");
    setLineaCant("");
    setLineaPrecio("");
    setLineaIva("EXENTA");
    setLineaTipoPrecio("minorista");
    setComboQuery("");
    setComboOpen(false);
    setTimeout(() => comboInputRef.current?.focus(), 0);
  }

  function handleEliminarLinea(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  /** Envía la venta. Con `permitirSinStock=true` autoriza vender aunque falte stock. */
  async function enviarVenta(permitirSinStock: boolean) {
    // Guard duro contra doble submit: si ya hay una confirmación en vuelo, cortar
    // inmediatamente. El ref se evalúa de forma síncrona (no espera al re-render de React),
    // así que un segundo click/Enter casi simultáneo no puede disparar otra venta.
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setGuardando(true);
    try {
      // Split payment: mandar la lista de pagos. El método de cabecera lo
      // deriva el backend (pago más grande) por compatibilidad con reportes.
      const pagosPayload =
        tipoVenta === "CONTADO"
          ? pagos
              .filter((p) => Number(p.monto) > 0)
              .map((p) => ({
                metodo_pago: p.metodo,
                monto: Math.min(Number(p.monto), totalGeneral) === Number(p.monto) || p.metodo !== "efectivo"
                  ? Number(p.monto)
                  : totalGeneral, // efectivo excedente → guardo solo el total (el resto es vuelto)
                entidad_bancaria_id: p.entidad_id || null,
                entidad_nombre_snapshot: entidades.find((e) => e.id === p.entidad_id)?.nombre ?? null,
                referencia: p.referencia.trim() || null,
                titular: p.metodo === "transferencia" ? p.titular.trim() || null : null,
              }))
          : [];
      const metodoCabecera: MetodoPago =
        pagosPayload.length > 0
          ? pagosPayload.reduce((a, b) => (b.monto > a.monto ? b : a)).metodo_pago
          : "efectivo";
      const resultado = await saveVenta(
        {
          items,
          moneda,
          tipo_cambio:  tipoCambioNum,
          subtotal:     totalSubtotal,
          monto_iva:    totalIva,
          total:        totalGeneral,
          tipo_venta:   tipoVenta,
          plazo_dias:   tipoVenta === "CREDITO" ? plazoDiasNum : undefined,
          metodo_pago:  metodoCabecera,
          cliente_id:   clienteId || null,
          genera_nota_remision: !!clienteId && generaNotaRemision,
        },
        undefined,
        null,
        { permitirSinStock, pedidoId, pagos: pagosPayload }
      );

      if (!resultado.success) {
        // Falta stock sin autorizar → abrir modal de confirmación con el detalle.
        // (El guard se libera en el finally para permitir confirmar sin stock.)
        if (resultado.faltantes && resultado.faltantes.length > 0) {
          setFaltantes(resultado.faltantes);
          setConfirmSinStockOpen(true);
          return;
        }
        setErrorVenta(resultado.error);
        return;
      }
      // Documentos de la venta. La nota de remisión se abre además del ticket
      // SOLO si la venta la genera (cliente con usa_nota_remision o toggle activo).
      const v = resultado.venta;
      const generaNota = v.genera_nota_remision === true || !!v.nota_remision_numero;
      const ticketUrl = `/api/ventas/${v.id}/ticket?mode=comandas&auto=1`;
      const remisionUrl = `/api/ventas/${v.id}/ticket?tipo=remision&auto=1`;
      // Intento de apertura automática (el ticket sale por el gesto de click; la
      // segunda pestaña puede ser bloqueada por el navegador → fallback con botones).
      try { window.open(ticketUrl, "_blank", "noopener"); } catch {}
      if (generaNota) { try { window.open(remisionUrl, "_blank", "noopener"); } catch {} }
      // Pedido del cliente: al guardar, redirigir directo a /ventas sin
      // pasar por el modal de confirmación. El ticket se abre solo por el
      // window.open de arriba (gesto del click). Si el navegador bloquea
      // popups, se pierde — el usuario lo puede reimprimir desde el listado.
      router.push("/ventas");
    } finally {
      // Liberar el guard SIEMPRE: éxito, error o flujo de "confirmar sin stock".
      isSubmittingRef.current = false;
      setGuardando(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorVenta(null);
    if (!ventaValida) return;
    await enviarVenta(false);
  }

  async function confirmarVentaSinStock() {
    setConfirmSinStockOpen(false);
    setErrorVenta(null);
    await enviarVenta(true);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8">

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">Nueva venta</h1>
          <p className="text-gray-600">
            Agregá productos de reventa o del catálogo. Al confirmar se registra la venta.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-[#0EA5E9] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#0284C7] active:scale-95"
        >
          + Agregar producto
        </button>
      </div>

      {pedidoId && (
        <div className="rounded-lg border border-[#4FAEB2]/40 bg-[#4FAEB2]/[0.08] px-4 py-3 text-sm text-slate-700">
          <span className="font-semibold text-[#3F8E91]">Estás facturando un pedido{pedidoNumero ? ` (${pedidoNumero})` : ""}.</span>{" "}
          La venta se generará al confirmar y el pedido quedará marcado como facturado. Podés ajustar items, precios y método de pago.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6 max-w-7xl">

        {/* ── SECCIÓN 0: Datos de la venta (cliente opcional + condición) ────── */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 sm:p-6">
          <SectionTitle>Datos de la venta</SectionTitle>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

            {/* Cliente (opcional) */}
            <div ref={clienteContainerRef} className="relative">
              <label className={labelClass}>
                Cliente <span className="text-xs font-normal text-gray-400">(opcional)</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={clienteSel ? clienteSel.label : clienteQuery}
                  onChange={(e) => { setClienteId(""); setClienteQuery(e.target.value); setClienteOpen(true); }}
                  onFocus={() => setClienteOpen(true)}
                  placeholder="Buscar por nombre o RUC…"
                  className={`${inputClass} ${clienteSel ? "font-medium" : ""}`}
                />
                {clienteSel && (
                  <button
                    type="button"
                    onClick={() => { setClienteId(""); setClienteQuery(""); setGeneraNotaRemision(false); }}
                    className="shrink-0 rounded-lg border border-slate-200 px-3 text-xs text-slate-500 hover:bg-slate-50"
                  >
                    Quitar
                  </button>
                )}
              </div>
              {clienteOpen && !clienteSel && (
                <div className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                  {clientesFiltrados.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-gray-400">Sin clientes que coincidan.</p>
                  ) : (
                    clientesFiltrados.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => { setClienteId(c.id); setClienteQuery(""); setClienteOpen(false); setGeneraNotaRemision(c.usa_nota_remision); }}
                        className="block w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
                      >
                        <span className="font-medium text-gray-800">{c.label}</span>
                        {c.ruc && <span className="ml-2 text-xs text-gray-400">RUC {c.ruc}</span>}
                        {c.usa_nota_remision && <span className="ml-2 text-[10px] rounded-full bg-sky-100 text-sky-700 px-1.5 py-0.5 font-semibold">Nota remisión</span>}
                      </button>
                    ))
                  )}
                </div>
              )}
              <p className="mt-1 text-[11px] text-gray-400">
                Si no seleccionás cliente, la venta se registra sin cliente.
              </p>

              {/* Nota de remisión: solo con cliente. Si el cliente la usa, viene activada. */}
              {clienteSel && (
                <div className="mt-2 rounded-lg border border-sky-100 bg-sky-50/60 px-3 py-2">
                  {clienteSel.usa_nota_remision && (
                    <p className="mb-1.5 text-[11px] text-sky-700">
                      Este cliente usa nota de remisión. Se generará junto al ticket.
                    </p>
                  )}
                  <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={generaNotaRemision}
                      onChange={(e) => setGeneraNotaRemision(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-[#0EA5E9] focus:ring-[#0EA5E9]"
                    />
                    Generar nota de remisión
                  </label>
                </div>
              )}
            </div>

            {/* Condición: Contado / Crédito */}
            <div>
              <label className={labelClass}>Condición</label>
              <SegmentedControl<TipoVenta>
                value={tipoVenta}
                options={[
                  { value: "CONTADO", label: "Contado" },
                  { value: "CREDITO", label: "Crédito" },
                ]}
                onChange={(v) => { setTipoVenta(v); if (v === "CONTADO") setPlazoDias(""); }}
              />
              {tipoVenta === "CREDITO" && (
                <div className="mt-3">
                  <label className={labelClass}>Plazo de crédito (días)</label>
                  <input
                    type="number"
                    min={1}
                    value={plazoDias}
                    onChange={(e) => setPlazoDias(e.target.value)}
                    placeholder="Ej: 30"
                    className={`${inputClass} ${plazoDiasNum < 1 ? "border-red-300 bg-red-50" : ""}`}
                  />
                  {plazoDiasNum < 1 && (
                    <p className="mt-1 text-[11px] text-red-600">Ingresá un plazo de al menos 1 día.</p>
                  )}
                  {!clienteId && (
                    <p className="mt-1 text-[11px] text-red-600">La venta a crédito requiere un cliente seleccionado.</p>
                  )}
                  <p className="mt-1 text-[11px] text-slate-500">Al confirmar se genera una cuenta por cobrar por el total.</p>
                </div>
              )}
            </div>

          </div>
        </div>

        {/* ── SECCIÓN 3: Carrito + totales + confirmar ─────────────────────── */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 sm:p-6">
          <SectionTitle>Productos en esta venta</SectionTitle>

          {items.length === 0 ? (
            <div className="py-10 text-center text-gray-400 text-sm border-2 border-dashed border-gray-200 rounded-lg">
              Todavía no agregaste productos a esta venta.
            </div>
          ) : (
            <>
              {/* min-w fuerza scroll horizontal en mobile (9 columnas).
                  Columnas secundarias (SKU, Subtotal, IVA Gs) se ocultan
                  progresivamente: en mobile solo Producto/Cant/Precio/Total/eliminar. */}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] sm:min-w-0 text-sm text-left">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600 text-sm font-semibold">
                      <th className="py-2.5 pr-3 font-medium">Producto</th>
                      <th className="hidden py-2.5 pr-3 font-medium lg:table-cell">SKU</th>
                      <th className="py-2.5 pr-3 font-medium text-right">Cant.</th>
                      <th className="py-2.5 pr-3 font-medium text-right">Precio unit.</th>
                      <th className="hidden py-2.5 pr-3 text-center font-medium lg:table-cell">IVA</th>
                      <th className="py-2.5 pr-3 font-medium text-right hidden lg:table-cell">Subtotal</th>
                      <th className="py-2.5 pr-3 font-medium text-right hidden lg:table-cell">IVA Gs.</th>
                      <th className="py-2.5 pr-3 font-medium text-right">Total</th>
                      <th className="py-2.5 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, idx) => (
                      <tr key={idx} className="border-b border-slate-200 last:border-0 hover:bg-slate-50 transition-colors">
                        <td className="py-3 pr-3 font-medium text-gray-800">
                          <span>{item.producto_nombre}</span>
                          <span className={`ml-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold align-middle ${
                            item.tipo_precio === "mayorista" ? "bg-indigo-100 text-indigo-700"
                            : item.tipo_precio === "distribuidor" ? "bg-emerald-100 text-emerald-700"
                            : item.tipo_precio === "costo" ? "bg-amber-100 text-amber-700"
                            : "bg-slate-100 text-slate-600"
                          }`}>
                            {tipoPrecioLabel[item.tipo_precio ?? "minorista"]}
                          </span>
                        </td>
                        <td className="hidden py-3 pr-3 font-mono text-xs text-gray-500 lg:table-cell">
                          {item.sku}
                        </td>
                        <td className="py-3 pr-3 text-right tabular-nums">
                          {item.cantidad}
                        </td>
                        <td className="py-3 pr-3 text-right tabular-nums text-gray-600 text-xs">
                          {formatGs(item.precio_venta)}
                        </td>
                        <td className="hidden py-3 pr-3 text-center lg:table-cell">
                          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">
                            {ivaLabel[item.tipo_iva]}
                          </span>
                        </td>
                        <td className="py-3 pr-3 text-right tabular-nums text-gray-600 text-xs hidden lg:table-cell">
                          {formatGs(item.subtotal)}
                        </td>
                        <td className="py-3 pr-3 text-right tabular-nums text-gray-500 text-xs hidden lg:table-cell">
                          {item.monto_iva > 0 ? formatGs(item.monto_iva) : "—"}
                        </td>
                        <td className="py-3 pr-3 text-right tabular-nums font-semibold text-gray-800">
                          {formatGs(item.total_linea)}
                        </td>
                        <td className="py-3 text-center">
                          <button
                            type="button"
                            onClick={() => handleEliminarLinea(idx)}
                            className="inline-flex items-center justify-center min-w-[40px] min-h-[40px] text-red-400 hover:text-red-700 transition-colors rounded hover:bg-red-50"
                            title="Eliminar producto"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                              <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clipRule="evenodd" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totales + Cobro (vuelto) */}
              <div className="mt-5 flex justify-end">
                <div className="w-full space-y-3 lg:w-80">
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Subtotal</span>
                      <span className="tabular-nums font-medium">{formatGs(totalSubtotal)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>IVA</span>
                      <span className="tabular-nums font-medium">
                        {totalIva > 0 ? formatGs(totalIva) : "—"}
                      </span>
                    </div>
                    <div className="flex justify-between text-base font-bold text-gray-900 pt-2 border-t border-gray-200">
                      <span>TOTAL</span>
                      <span className="tabular-nums">{formatGs(totalGeneral)}</span>
                    </div>
                  </div>

                  {tipoVenta === "CONTADO" && (
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Cobro</p>
                        <button
                          type="button"
                          onClick={agregarPago}
                          className="text-[11px] font-medium text-sky-600 hover:underline"
                        >
                          + Agregar método
                        </button>
                      </div>

                      {pagos.map((p, idx) => {
                        const entidadesDelTipo = entidades.filter((e) => {
                          if (p.metodo === "efectivo") return e.tipo === "caja";
                          if (p.metodo === "tarjeta") return e.tipo === "tarjeta" || e.tipo === "banco";
                          return e.tipo === "banco" || e.tipo === "billetera";
                        });
                        return (
                          <div key={p.id} className="rounded-md border border-slate-200 bg-white p-2.5 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-semibold text-slate-500">Pago {idx + 1}</span>
                              {pagos.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => quitarPago(p.id)}
                                  className="text-[11px] text-red-500 hover:underline"
                                >
                                  Quitar
                                </button>
                              )}
                            </div>
                            <div className="grid grid-cols-3 gap-1.5">
                              {([
                                { v: "efectivo", label: "Efectivo" },
                                { v: "transferencia", label: "Transf." },
                                { v: "tarjeta", label: "Tarjeta" },
                              ] as { v: MetodoPago; label: string }[]).map((m) => (
                                <button
                                  key={m.v}
                                  type="button"
                                  onClick={() => cambiarMetodoPago(p.id, m.v)}
                                  className={`text-xs py-1.5 rounded-md border transition-colors ${
                                    p.metodo === m.v
                                      ? "border-[#0EA5E9] bg-[#0EA5E9]/10 text-[#0EA5E9] font-medium"
                                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                                  }`}
                                >
                                  {m.label}
                                </button>
                              ))}
                            </div>
                            <MontoInput
                              value={p.monto}
                              onChange={(n) => updatePago(p.id, { monto: String(n) })}
                              placeholder="Monto (Gs.)"
                              className={inputClass}
                              decimals={false}
                            />
                            {p.metodo !== "efectivo" && (
                              <>
                                <select
                                  value={p.entidad_id}
                                  onChange={(e) => updatePago(p.id, { entidad_id: e.target.value })}
                                  className={inputClass}
                                >
                                  <option value="">— entidad / banco —</option>
                                  {(entidadesDelTipo.length > 0 ? entidadesDelTipo : entidades).map((en) => (
                                    <option key={en.id} value={en.id}>
                                      {en.codigo ? `${en.codigo} · ` : ""}{en.nombre}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  type="text"
                                  value={p.referencia}
                                  onChange={(e) => updatePago(p.id, { referencia: e.target.value })}
                                  placeholder="N° de comprobante / referencia"
                                  className={inputClass}
                                />
                                {p.metodo === "transferencia" && (
                                  <input
                                    type="text"
                                    value={p.titular}
                                    onChange={(e) => updatePago(p.id, { titular: e.target.value })}
                                    placeholder="Titular que transfirió"
                                    className={inputClass}
                                  />
                                )}
                              </>
                            )}
                          </div>
                        );
                      })}

                      <div className="border-t border-slate-200 pt-2 space-y-1 text-xs">
                        <div className="flex justify-between text-slate-600">
                          <span>Total a cobrar</span>
                          <span className="tabular-nums font-medium">{formatGs(totalGeneral)}</span>
                        </div>
                        <div className="flex justify-between text-slate-600">
                          <span>Pagado</span>
                          <span className="tabular-nums font-medium">{formatGs(sumaPagos)}</span>
                        </div>
                        {restante > 0.5 ? (
                          <div className="flex justify-between font-bold text-red-600">
                            <span>Falta</span>
                            <span className="tabular-nums">{formatGs(restante)}</span>
                          </div>
                        ) : restante < -0.5 ? (
                          <div className="flex justify-between font-bold text-emerald-600">
                            <span>{hayEfectivo ? "Vuelto" : "Excedente (sin efectivo)"}</span>
                            <span className="tabular-nums">{formatGs(-restante)}</span>
                          </div>
                        ) : (
                          <div className="flex justify-between font-bold text-emerald-600">
                            <span>Justo</span>
                            <span className="tabular-nums">✓</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Error confirmar */}
          {errorVenta && (
            <div className="mt-4 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-xs text-red-700">
              <span className="text-base leading-none mt-0.5">⚠</span>
              <span className="font-medium">{errorVenta}</span>
            </div>
          )}

          {/* Acciones — stack vertical full-width en mobile (mas facil de tappear),
              fila en sm+. Confirmar en orden visual primero (primary). */}
          <div className="mt-6 flex flex-col-reverse sm:flex-row gap-3">
            <button
              type="button"
              onClick={() => router.push("/ventas")}
              className="border border-slate-200 px-6 py-3 rounded-lg text-sm hover:bg-slate-50 transition-colors min-h-[48px] w-full sm:w-auto"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!ventaValida || guardando}
              aria-busy={guardando}
              className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white px-6 py-3 rounded-lg text-sm font-medium transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 min-h-[48px] w-full sm:w-auto"
            >
              {guardando ? "Guardando…" : "Confirmar venta"}
            </button>
          </div>

        </div>

      </form>

      <ProductPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onAgregar={handleAgregarDesdePicker}
        excludeIds={items.map((i) => i.producto_id)}
        moneda={moneda}
        tipoCambio={tipoCambioNum}
        ivaDefault={lineaIva}
      />

      {/* Modal de confirmación: venta sin stock suficiente */}
      {confirmSinStockOpen && faltantes.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setConfirmSinStockOpen(false)}>
          <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-2">
              <span className="text-amber-500 text-xl leading-none">⚠</span>
              <div>
                <h3 className="text-sm font-semibold text-slate-800">Hay productos/insumos sin stock suficiente</h3>
                <p className="text-xs text-slate-500 mt-0.5">Revisá el detalle. Podés vender igual: el stock quedará negativo y se registrará el movimiento de salida.</p>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-slate-50 text-slate-600 text-xs">
                    <th className="py-2 px-3 font-medium">Producto / Insumo</th>
                    <th className="py-2 px-3 font-medium text-right">Stock actual</th>
                    <th className="py-2 px-3 font-medium text-right">Solicitado</th>
                    <th className="py-2 px-3 font-medium text-right">Faltante</th>
                  </tr>
                </thead>
                <tbody>
                  {faltantes.map((f) => (
                    <tr key={f.producto_id} className="border-t border-slate-100">
                      <td className="py-2 px-3">
                        <span className="font-medium text-slate-800">{f.nombre}</span>
                        <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${f.tipo === "insumo" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
                          {f.tipo === "insumo" ? "Insumo" : "Producto"}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums">{f.stock_actual}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{f.solicitado}</td>
                      <td className="py-2 px-3 text-right tabular-nums font-semibold text-red-600">{f.faltante}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
              <button type="button" onClick={() => setConfirmSinStockOpen(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm hover:bg-slate-50">
                Cancelar
              </button>
              <button type="button" disabled={guardando} aria-busy={guardando} onClick={() => void confirmarVentaSinStock()} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed">
                {guardando ? "Guardando…" : "Confirmar venta de todos modos"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
