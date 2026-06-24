"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import MontoInput from "@/components/ui/MontoInput";
import SelectFromList from "@/components/inventario/SelectFromList";
import { productoExiste, saveProducto } from "@/lib/inventario/storage";
import type { MetodoValuacion } from "@/lib/inventario/types";
import { ShoppingBag, Boxes, ClipboardList, type LucideIcon } from "lucide-react";
import QuickNuevoProveedorModal from "@/components/proveedores/QuickNuevoProveedorModal";

// Opciones estándar de unidad de medida para gastro
const UNIDADES_OPCIONES = [
  "UNIDAD","KG","G","LT","ML","CAJA","BOLSA","PAQUETE","DOCENA","LATA","BOTELLA","PORCION","COMBO",
] as const;

const TIPO_SUMMARY: Record<"reventa" | "menu" | "materia", { titulo: string; descripcion: string; Icon: LucideIcon; acento: string }> = {
  reventa: { titulo: "Producto de reventa", descripcion: "Se compra y se vende tal cual. Controla stock y descuenta al vender.", Icon: ShoppingBag, acento: "text-sky-600" },
  menu:    { titulo: "Producto del menú",   descripcion: "Se vende en Ventas y genera pedido. No descuenta stock directo.",     Icon: ClipboardList, acento: "text-amber-600" },
  materia: { titulo: "Materia prima / insumo", descripcion: "Se usa para recetas y costeo. No aparece como producto de venta.", Icon: Boxes, acento: "text-emerald-600" },
};

interface CatRow { id: string; nombre: string }
interface UbiRow { id: string; nombre: string; tipo: string }
interface ProvRow { id: string; nombre: string }

export default function NuevoProductoPage() {
  const router = useRouter();
  const [errorDuplicado, setErrorDuplicado] = useState<string | null>(null);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);

  const [form, setForm] = useState({
    nombre: "",
    descripcion: "",
    sku: "",
    codigo_barras: "",
    costo_promedio: "",
    markup: "",
    precio_venta: "",
    precio_mayorista: "",
    precio_distribuidor: "",
    cantidad_minima_mayorista: "",
    stock_actual: "",
    stock_minimo: "",
    unidad_medida: "UNIDAD",
    metodo_valuacion: "CPP" as MetodoValuacion,
    // Autopartes (Fase 2)
    codigo_oem: "",
    codigo_alternativo: "",
    marca_repuesto: "",
    garantia_meses: "",
    distribuidor_nombre: "",
    distribuidor_comision_pct: "",
    departamento: "",
    pasillo: "",
    estante: "",
    caja: "",
  });
  const [permitirVentaSinStock, setPermitirVentaSinStock] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [generandoCodigo, setGenerandoCodigo] = useState(false);
  const [generandoSku, setGenerandoSku] = useState(false);
  const [skuPatrones, setSkuPatrones] = useState<{ prefix: string; siguiente: string }[]>([]);

  // Relaciones opcionales
  const [categoriaId, setCategoriaId] = useState<string | null>(null);
  const [ubicacionId, setUbicacionId] = useState<string | null>(null);
  const [proveedorId, setProveedorId] = useState<string | null>(null);

  // Clasificación gastronómica
  const [esVendible, setEsVendible] = useState(true);
  const [esInsumo, setEsInsumo] = useState(false);

  // Selector inicial de tipo gastronómico — aplica presets a los flags.
  // En esta instancia (Autorepuestos Felix Bogado) sólo se cargan productos
  // de reventa, así que arrancamos directo en ese tipo y omitimos el picker.
  type TipoGastro = "reventa" | "menu" | "materia" | null;
  const [tipoGastro, setTipoGastro] = useState<TipoGastro>("reventa");
  function aplicarTipoGastro(tipo: Exclude<TipoGastro, null>) {
    setTipoGastro(tipo);
    if (tipo === "reventa") {
      setEsVendible(true);
      setEsInsumo(false);
      setControlaStock(true);
      setForm((prev) => ({ ...prev, unidad_medida: prev.unidad_medida || "UNIDAD" }));
    } else if (tipo === "menu") {
      setEsVendible(true);
      setEsInsumo(false);
      setControlaStock(false);
      setForm((prev) => ({ ...prev, unidad_medida: prev.unidad_medida || "UNIDAD" }));
    } else {
      setEsVendible(false);
      setEsInsumo(true);
      setControlaStock(false);
      setForm((prev) => ({ ...prev, unidad_medida: prev.unidad_medida || "G" }));
    }
  }

  // Configuración gastronómica
  const [controlaStock, setControlaStock] = useState(true);
  const [valorizado, setValorizado] = useState(true);
  const [unidadCompra, setUnidadCompra] = useState("");
  const [unidadReceta, setUnidadReceta] = useState("");
  const [factorCompraReceta, setFactorCompraReceta] = useState("1");
  const [tiempoPrepMinutos, setTiempoPrepMinutos] = useState("0");
  const [categorias, setCategorias] = useState<CatRow[]>([]);
  const [ubicaciones, setUbicaciones] = useState<UbiRow[]>([]);
  const [proveedores, setProveedores] = useState<ProvRow[]>([]);
  const [nuevoProveedorOpen, setNuevoProveedorOpen] = useState(false);

  useEffect(() => {
    let cancel = false;
    async function load(url: string) {
      try {
        const r = await fetch(url, { credentials: "include" });
        const j = await r.json();
        return r.ok && j?.success ? j.data : null;
      } catch { return null; }
    }
    (async () => {
      const [cats, ubis, provs] = await Promise.all([
        load("/api/inventario/categorias"),
        load("/api/inventario/ubicaciones"),
        load("/api/proveedores"),
      ]);
      if (cancel) return;
      if (cats?.categorias) setCategorias(cats.categorias as CatRow[]);
      if (ubis?.ubicaciones) setUbicaciones(ubis.ubicaciones as UbiRow[]);
      if (provs?.proveedores) setProveedores(provs.proveedores as ProvRow[]);
    })();
    return () => { cancel = true; };
  }, []);

  // Imagen pendiente de subir (se sube luego de crear el producto, con su ID).
  const [imagenFile, setImagenFile] = useState<File | null>(null);
  const [imagenPreview, setImagenPreview] = useState<string | null>(null);
  const [imagenError, setImagenError] = useState<string | null>(null);

  const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];
  const MAX_IMG_BYTES = 5 * 1024 * 1024;

  function handleImagenChange(e: React.ChangeEvent<HTMLInputElement>) {
    setImagenError(null);
    const f = e.target.files?.[0] ?? null;
    if (!f) {
      setImagenFile(null);
      setImagenPreview(null);
      return;
    }
    if (!ALLOWED_MIME.includes(f.type)) {
      setImagenError("Formato no permitido. Usá JPG, PNG o WebP.");
      e.target.value = "";
      return;
    }
    if (f.size > MAX_IMG_BYTES) {
      setImagenError("Imagen demasiado grande (máx. 5 MB).");
      e.target.value = "";
      return;
    }
    setImagenFile(f);
    setImagenPreview(URL.createObjectURL(f));
  }

  function quitarImagen() {
    setImagenFile(null);
    setImagenPreview(null);
    setImagenError(null);
  }

  // Patrones de SKU según el tipo elegido (para "Generar SKU" y el dropdown).
  useEffect(() => {
    if (!tipoGastro) return;
    let cancel = false;
    fetch(`/api/productos/sku-sugerencias?tipo=${tipoGastro}`, { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!cancel && j?.success) setSkuPatrones(j.data?.patrones ?? []); })
      .catch(() => {});
    return () => { cancel = true; };
  }, [tipoGastro]);

  async function handleGenerarSku() {
    if (generandoSku) return;
    setGenerandoSku(true);
    setErrorDuplicado(null);
    try {
      const res = await fetch(`/api/productos/sku-sugerencias?tipo=${tipoGastro ?? "reventa"}`, {
        credentials: "include",
        cache: "no-store",
      });
      const json = await res.json();
      if (res.ok && json?.success && json.data?.sugerido) {
        setForm((prev) => ({ ...prev, sku: json.data.sugerido as string }));
        setSkuPatrones(json.data.patrones ?? []);
      }
    } catch { /* no bloquea */ } finally {
      setGenerandoSku(false);
    }
  }

  function handleSelectPatron(e: React.ChangeEvent<HTMLSelectElement>) {
    const sig = e.target.value;
    if (sig) setForm((prev) => ({ ...prev, sku: sig }));
    e.target.value = ""; // volver al placeholder del dropdown
  }

  /** Genera un código de barras REAL (EAN-13) escaneable. */
  async function handleGenerarCodigoBarras() {
    if (generandoCodigo) return;
    setGenerandoCodigo(true);
    setErrorDuplicado(null);
    setErrorGeneral(null);
    try {
      const res = await fetch("/api/productos/codigo-barras", { method: "POST", credentials: "include" });
      const json = await res.json();
      if (res.ok && json?.success && json.data?.codigo) {
        setForm((prev) => ({ ...prev, codigo_barras: json.data.codigo as string }));
      } else {
        setErrorGeneral(json?.error ?? "No se pudo generar el código de barras.");
      }
    } catch (err) {
      setErrorGeneral(err instanceof Error ? err.message : "Error de red");
    } finally {
      setGenerandoCodigo(false);
    }
  }

  // Campos sin lógica reactiva
  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) {
    setErrorDuplicado(null);
    setErrorGeneral(null);
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  /**
   * Al cambiar costo: NO movemos el precio (es lo que el cliente paga).
   * Recalculamos markup a partir del gap precio-costo cuando ambos son válidos.
   */
  function handleCostoChange(costo: number) {
    setErrorDuplicado(null);
    const precio = parseFloat(form.precio_venta);

    if (!isNaN(costo) && costo > 0 && !isNaN(precio) && precio > 0) {
      const nuevoMarkup = ((precio - costo) / costo) * 100;
      setForm((prev) => ({
        ...prev,
        costo_promedio: String(costo),
        markup: nuevoMarkup.toFixed(2),
      }));
    } else {
      setForm((prev) => ({ ...prev, costo_promedio: String(costo) }));
    }
  }

  /**
   * Al cambiar markup → recalcula precio_venta (permite markup negativo = venta a pérdida)
   */
  function handleMarkupChange(e: React.ChangeEvent<HTMLInputElement>) {
    setErrorDuplicado(null);
    const markup = parseFloat(e.target.value);
    const costo = parseFloat(form.costo_promedio);

    if (!isNaN(markup) && !isNaN(costo) && costo > 0) {
      const nuevoPrecio = costo * (1 + markup / 100);
      setForm((prev) => ({
        ...prev,
        markup: e.target.value,
        precio_venta: nuevoPrecio.toFixed(0),
      }));
    } else {
      setForm((prev) => ({ ...prev, markup: e.target.value }));
    }
  }

  /**
   * Al cambiar precio → recalcula markup (puede resultar negativo si precio < costo)
   */
  function handlePrecioChange(precio: number) {
    setErrorDuplicado(null);
    const costo = parseFloat(form.costo_promedio);

    if (!isNaN(precio) && !isNaN(costo) && costo > 0) {
      const nuevoMarkup = ((precio - costo) / costo) * 100;
      setForm((prev) => ({
        ...prev,
        precio_venta: String(precio),
        markup: nuevoMarkup.toFixed(2),
      }));
    } else {
      setForm((prev) => ({ ...prev, precio_venta: String(precio) }));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    console.log("[inventario/nuevo] handleSubmit start", { tipoGastro });
    if (submitting) return;
    setErrorDuplicado(null);
    setErrorGeneral(null);
    setSubmitting(true);

    const showErr = (msg: string) => {
      setErrorGeneral(msg);
      try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch {}
    };

    try {
      // Validaciones básicas en JS (HTML5 desactivado con noValidate).
      const nombreT = form.nombre.trim();
      if (!nombreT) { showErr("El nombre es obligatorio."); return; }
      if (tipoGastro === "reventa" && !form.sku.trim()) { showErr("El SKU es obligatorio para productos de reventa."); return; }

      // Código de barras: se guarda tal cual (escaneable). Vacío → null (sin barcode).
      const codigoEnInput = form.codigo_barras.trim();

      // Pre-chequeo duplicado tolerante a fallos de red.
      try {
        const duplicado = await productoExiste(form.sku, form.nombre);
        if (duplicado) {
          setErrorDuplicado(`Ya existe "${duplicado.nombre}" con SKU ${duplicado.sku}.`);
          try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch {}
          return;
        }
      } catch (err) {
        console.warn("[inventario/nuevo] productoExiste failed, ignorando:", err);
      }
      const codigo: string | null = codigoEnInput || null;
      const interno = false; // ya no se autogeneran códigos internos; el barcode es real

      let guardado;
      try {
        guardado = await saveProducto({
          nombre: form.nombre.trim().toUpperCase(),
          descripcion: form.descripcion.trim() || null,
          sku: form.sku.trim().toUpperCase(),
          costo_promedio: parseFloat(form.costo_promedio) || 0,
          precio_venta: parseFloat(form.precio_venta) || 0,
          precio_mayorista: form.precio_mayorista.trim() !== "" ? parseFloat(form.precio_mayorista) || null : null,
          precio_distribuidor: form.precio_distribuidor.trim() !== "" ? parseFloat(form.precio_distribuidor) || null : null,
          cantidad_minima_mayorista: form.cantidad_minima_mayorista.trim() !== "" ? parseFloat(form.cantidad_minima_mayorista) || null : null,
          stock_actual: parseInt(form.stock_actual) || 0,
          stock_minimo: parseInt(form.stock_minimo) || 0,
          unidad_medida: form.unidad_medida.trim().toUpperCase(),
          metodo_valuacion: form.metodo_valuacion,
          codigo_barras: codigo,
          codigo_barras_interno: interno,
          categoria_principal_id: categoriaId,
          ubicacion_principal_id: ubicacionId,
          proveedor_principal_id: proveedorId,
          es_vendible: esVendible,
          es_insumo: esInsumo,
          controla_stock: controlaStock,
          valorizado: valorizado,
          unidad_compra: unidadCompra.trim() || null,
          unidad_receta: unidadReceta.trim() || null,
          factor_compra_receta: Math.max(parseFloat(factorCompraReceta) || 1, 0.0001),
          tiempo_prep_minutos: Math.max(parseInt(tiempoPrepMinutos) || 0, 0),
          // Autopartes — opcionales (trim a null si vacíos)
          codigo_oem: form.codigo_oem.trim() || null,
          codigo_alternativo: form.codigo_alternativo.trim() || null,
          marca_repuesto: form.marca_repuesto.trim() || null,
          garantia_meses: form.garantia_meses.trim() === "" ? null : Math.max(parseInt(form.garantia_meses) || 0, 0),
          permitir_venta_sin_stock: permitirVentaSinStock,
          distribuidor_nombre: form.distribuidor_nombre.trim() || null,
          distribuidor_comision_pct: form.distribuidor_comision_pct.trim() === "" ? null : Math.min(Math.max(parseFloat(form.distribuidor_comision_pct) || 0, 0), 100),
          // Departamento → se mapea a ubicacion_deposito (columna existente en DB).
          ubicacion_deposito: form.departamento.trim() || null,
          ubicacion_pasillo: form.pasillo.trim() || null,
          ubicacion_estante: form.estante.trim() || null,
          ubicacion_caja: form.caja.trim() || null,
        });
      } catch (err) {
        console.error("[inventario/nuevo] saveProducto error:", err);
        showErr(err instanceof Error ? err.message : "No se pudo guardar el producto.");
        return;
      }

      if (!guardado) {
        showErr("No se pudo guardar el producto. Revisá los datos e intentá nuevamente.");
        return;
      }

      // Subir imagen (post-creacion, con producto_id real)
      if (imagenFile) {
        try {
          const fd = new FormData();
          fd.append("file", imagenFile);
          const up = await fetch(`/api/productos/${guardado.id}/imagen`, {
            method: "POST",
            body: fd,
            credentials: "include",
          });
          const upJson = await up.json();
          if (!up.ok || !upJson?.success) {
            // Producto creado, imagen falló. No perder el producto: ir a editar con aviso.
            const msg = upJson?.error ?? "No se pudo subir la imagen.";
            alert(`Producto creado correctamente, pero la imagen no pudo subirse: ${msg}\n\nPodés intentar subirla nuevamente desde la edición del producto.`);
            router.push(`/inventario/${guardado.id}/editar`);
            return;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Error de red";
          alert(`Producto creado correctamente, pero la imagen no pudo subirse: ${msg}\n\nPodés intentar subirla nuevamente desde la edición del producto.`);
          router.push(`/inventario/${guardado.id}/editar`);
          return;
        }
      }

      router.push("/inventario");
    } catch (err) {
      console.error("[inventario/nuevo] handleSubmit error:", err);
      showErr(err instanceof Error ? err.message : "No se pudo guardar el producto.");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Cálculos en tiempo real ──────────────────────────────────────────────────
  const costo = parseFloat(form.costo_promedio);
  const precio = parseFloat(form.precio_venta);
  const tieneAmbos = !isNaN(costo) && !isNaN(precio) && costo > 0 && precio > 0;
  const markupCalc = tieneAmbos ? ((precio - costo) / costo) * 100 : null;
  const margenVentaCalc = tieneAmbos ? ((precio - costo) / precio) * 100 : null;
  const esPerdida = markupCalc !== null && markupCalc < 0;

  const inputClass =
    "w-full border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:outline-none bg-white text-sm";
  const labelClass = "block text-sm font-medium text-slate-700 mb-2";

  // Paso 0: selector inicial de tipo de producto
  if (tipoGastro === null) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Nuevo producto</h1>
          <p className="text-gray-600">¿Qué tipo de producto vas a cargar?</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-5xl">
          {([
            {
              tipo: "reventa" as const,
              titulo: "Producto de reventa",
              Icon: ShoppingBag,
              iconColor: "text-sky-600",
              ejemplo: "Gaseosas, agua, jugos, postres comprados",
              descripcion: "Se compra y se vende tal cual. Controla stock y descuenta al vender.",
              acento: "border-sky-300 bg-sky-50/40 hover:border-sky-500",
            },
            {
              tipo: "menu" as const,
              titulo: "Producto del menú",
              Icon: ClipboardList,
              iconColor: "text-amber-600",
              ejemplo: "Pizzas, lomitos, hamburguesas, combos",
              descripcion: "Producto preparado por el local. No descuenta stock directo (usá receta para costeo).",
              acento: "border-amber-300 bg-amber-50/40 hover:border-amber-500",
            },
            {
              tipo: "materia" as const,
              titulo: "Materia prima / insumo",
              Icon: Boxes,
              iconColor: "text-emerald-600",
              ejemplo: "Harina, queso, salsa, carne, envases",
              descripcion: "Insumo para recetas. Sólo se usa para costear productos del menú.",
              acento: "border-emerald-300 bg-emerald-50/40 hover:border-emerald-500",
            },
          ]).map((opt) => (
            <button
              key={opt.tipo}
              type="button"
              onClick={() => aplicarTipoGastro(opt.tipo)}
              className={`text-left rounded-xl border-2 ${opt.acento} p-5 transition-all hover:shadow-md`}
            >
              <opt.Icon className={`w-7 h-7 mb-2 ${opt.iconColor}`} />
              <div className="text-base font-semibold text-slate-900">{opt.titulo}</div>
              <div className="mt-1 text-xs italic text-slate-500">Ej: {opt.ejemplo}</div>
              <div className="mt-3 text-sm text-slate-700">{opt.descripcion}</div>
            </button>
          ))}
        </div>
        <div>
          <button
            type="button"
            onClick={() => router.push("/inventario")}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← Cancelar
          </button>
        </div>
      </div>
    );
  }

  const summary = TIPO_SUMMARY[tipoGastro];
  const showStock = tipoGastro === "reventa";
  const showPrecioVenta = tipoGastro !== "materia";

  return (
    <div className="space-y-8">

      <div>
        <h1 className="text-3xl font-bold text-gray-800">Nuevo producto</h1>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 max-w-5xl">
        <div className="flex items-start gap-4">
          <summary.Icon className={`w-7 h-7 shrink-0 ${summary.acento}`} />
          <div className="flex-1 min-w-0">
            <div className="text-base font-semibold text-slate-900">{summary.titulo}</div>
            <div className="text-sm text-slate-600 mt-0.5">{summary.descripcion}</div>
          </div>
          {/* Botón "Cambiar tipo" oculto: en esta instancia sólo hay reventa. */}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow p-6 max-w-5xl">
        <form className="space-y-6" onSubmit={handleSubmit} noValidate>

          {/* Error general (validacion de codigo, duplicado de codigo barras, etc.) */}
          {errorGeneral && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-700">{errorGeneral}</p>
            </div>
          )}

          {/* Error de duplicado (mismo SKU o mismo nombre) */}
          {errorDuplicado && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-1">
              <p className="text-sm font-semibold text-red-700">
                Este producto ya existe en el inventario.
              </p>
              <p className="text-xs text-red-600">{errorDuplicado}</p>
              <p className="text-xs text-red-500">
                Para modificar su stock debés registrar un movimiento de inventario.
              </p>
              <Link
                href="/inventario/movimientos"
                className="inline-block mt-2 text-xs text-red-700 underline hover:text-red-900"
              >
                Ir a Movimientos →
              </Link>
            </div>
          )}

          {/* Nombre */}
          <div>
            <label className={labelClass}>Nombre del producto</label>
            <input
              type="text"
              name="nombre"
              value={form.nombre}
              onChange={handleChange}
              placeholder="Ej: HAMBURGUESA CASERA"
              className={`${inputClass} uppercase`}
              required
            />
          </div>

          {/* Descripción */}
          <div>
            <label className={labelClass}>
              Descripción
              {tipoGastro === "menu" && <span className="text-xs font-normal text-amber-700 ml-2">(visible al cliente)</span>}
            </label>
            <textarea
              name="descripcion"
              value={form.descripcion}
              onChange={handleChange}
              placeholder={
                tipoGastro === "menu"
                  ? "Ej: Pan, carne, huevo, doble queso, lechuga, tomate, mayonesa."
                  : "Descripción opcional del producto"
              }
              rows={tipoGastro === "menu" ? 3 : 2}
              className={inputClass}
            />
          </div>

          {/* SKU + Unidad de medida */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <label className={labelClass}>
                SKU interno{tipoGastro === "reventa" ? "" : <span className="text-xs font-normal text-gray-400 ml-1">(opcional)</span>}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  name="sku"
                  value={form.sku}
                  onChange={handleChange}
                  placeholder="Ej: REV-0001"
                  className={`${inputClass} uppercase flex-1`}
                  required={tipoGastro === "reventa"}
                />
                <button
                  type="button"
                  onClick={handleGenerarSku}
                  disabled={generandoSku}
                  className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-[#3F8E91] hover:bg-[#4FAEB2]/5 disabled:opacity-50"
                >
                  {generandoSku ? "…" : "Generar SKU"}
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <select
                  onChange={handleSelectPatron}
                  defaultValue=""
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600 outline-none focus:ring-2 focus:ring-[#0EA5E9]"
                >
                  <option value="">Usar patrón existente…</option>
                  {skuPatrones.map((p) => (
                    <option key={p.prefix} value={p.siguiente}>{p.prefix} → {p.siguiente}</option>
                  ))}
                </select>
                <span className="text-[11px] text-gray-400">Código interno editable. Podés ajustar el número final.</span>
              </div>
            </div>

            <div className={tipoGastro === "menu" ? "hidden" : ""}>
              <label className={labelClass}>Unidad de medida</label>
              <select
                name="unidad_medida"
                value={form.unidad_medida}
                onChange={handleChange}
                className={`${inputClass} uppercase`}
                required={tipoGastro !== "menu"}
              >
                {UNIDADES_OPCIONES.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Código de barras (escaneable, separado del SKU) */}
          <div className="border-t border-slate-100 pt-5">
            <label className={labelClass}>Código de barras</label>
            <div className="flex gap-2">
              <input
                type="text"
                name="codigo_barras"
                value={form.codigo_barras}
                onChange={handleChange}
                placeholder="Escaneá, escribí o generá (EAN-13)"
                className={`${inputClass} flex-1`}
                autoComplete="off"
                inputMode="numeric"
              />
              <button
                type="button"
                onClick={handleGenerarCodigoBarras}
                disabled={generandoCodigo}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-white px-3 py-2 text-xs font-medium text-sky-700 hover:bg-sky-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {generandoCodigo ? "Generando…" : "Generar código de barras"}
              </button>
            </div>
            <p className="mt-1.5 text-xs text-gray-400">
              Código escaneable para lector o etiqueta (EAN-13). Debe ser único. <span className="italic">(opcional)</span>
            </p>
          </div>

          {/* Imagen del producto */}
          <div>
            <label className={labelClass}>Imagen del producto</label>
            <div className="flex items-start gap-4">
              <div className="w-28 h-28 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
                {imagenPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imagenPreview} alt="Vista previa" className="w-full h-full object-cover" />
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-8 h-8 text-slate-300">
                    <path fillRule="evenodd" d="M1 5.25A2.25 2.25 0 0 1 3.25 3h13.5A2.25 2.25 0 0 1 19 5.25v9.5A2.25 2.25 0 0 1 16.75 17H3.25A2.25 2.25 0 0 1 1 14.75v-9.5Zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 0 0 .75-.75v-2.69l-2.22-2.219a.75.75 0 0 0-1.06 0l-1.91 1.909.47.47a.75.75 0 1 1-1.06 1.06L6.53 8.091a.75.75 0 0 0-1.06 0L2.5 11.06ZM12 6.5a1 1 0 1 1 2 0 1 1 0 0 1-2 0Z" clipRule="evenodd" />
                  </svg>
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white text-sm px-4 py-2 rounded-lg cursor-pointer transition-colors">
                    {imagenFile ? "Cambiar imagen" : "Seleccionar imagen"}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={handleImagenChange}
                    />
                  </label>
                  {imagenFile && (
                    <button
                      type="button"
                      onClick={quitarImagen}
                      className="text-sm text-red-600 hover:text-red-800 px-3 py-2 rounded-lg border border-slate-200 hover:bg-red-50"
                    >
                      Quitar
                    </button>
                  )}
                </div>
                <p className="mt-1.5 text-xs text-slate-400">
                  JPG, PNG o WebP — máx. 5 MB. Se asociará al producto al guardarlo.
                </p>
                {imagenError && (
                  <p className="mt-1.5 text-xs text-red-600">{imagenError}</p>
                )}
              </div>
            </div>
          </div>

          {/* Costo (+ Markup + Precio en productos comerciales) — bloque reactivo */}
          <div>
            <p className="text-xs text-gray-400 mb-3 uppercase tracking-wide font-semibold">
              {showPrecioVenta ? "Precios — los tres campos son reactivos entre sí" : "Costo de adquisición"}
            </p>
            <div className={`grid grid-cols-1 gap-6 ${showPrecioVenta ? "sm:grid-cols-3" : ""}`}>

              <div>
                <label className={labelClass}>{showPrecioVenta ? "Costo promedio (Gs.)" : "Costo promedio / adquisición (Gs.)"}</label>
                <MontoInput
                  value={form.costo_promedio}
                  onChange={handleCostoChange}
                  placeholder="Ej: 52000"
                  className={inputClass}
                  decimals={false}
                  required
                />
              </div>

              {showPrecioVenta && (
              <div>
                <label className={labelClass}>Markup s/costo (%)</label>
                <div className="relative">
                  <input
                    type="number"
                    name="markup"
                    value={form.markup}
                    onChange={handleMarkupChange}
                    placeholder="Ej: 50.00"
                    className={`${inputClass} pr-8`}
                    step="0.01"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">
                    %
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-gray-400">(precio − costo) / costo</p>
              </div>
              )}

              <div className={showPrecioVenta ? "" : "hidden"}>
                <label className={labelClass}>Precio de venta (Gs.)</label>
                <MontoInput
                  value={form.precio_venta}
                  onChange={handlePrecioChange}
                  placeholder="Ej: 78000"
                  className={inputClass}
                  decimals={false}
                  required={showPrecioVenta}
                />
              </div>

            </div>

            {showPrecioVenta && (
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Precio mayorista (Gs.) <span className="text-gray-400 font-normal">(opcional)</span></label>
                  <MontoInput
                    value={form.precio_mayorista}
                    onChange={(n) => setForm((prev) => ({ ...prev, precio_mayorista: String(n) }))}
                    placeholder="Ej: 22000"
                    className={inputClass}
                    decimals={false}
                  />
                </div>
                <div>
                  <label className={labelClass}>Cantidad mínima mayorista <span className="text-gray-400 font-normal">(opcional)</span></label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={form.cantidad_minima_mayorista}
                    onChange={(e) => setForm((prev) => ({ ...prev, cantidad_minima_mayorista: e.target.value }))}
                    placeholder="Ej: 10"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Precio distribuidor (Gs.) <span className="text-gray-400 font-normal">(opcional)</span></label>
                  <MontoInput
                    value={form.precio_distribuidor}
                    onChange={(n) => setForm((prev) => ({ ...prev, precio_distribuidor: String(n) }))}
                    placeholder="Ej: 18000"
                    className={inputClass}
                    decimals={false}
                  />
                </div>
                <p className="sm:col-span-2 text-xs text-gray-400">
                  Precios por canal: en Ventas el cajero elige Minorista, Mayorista o Distribuidor. El precio distribuidor es comercial (no es el costo).
                </p>
              </div>
            )}

            {/* Indicadores de rentabilidad en tiempo real (no aplican a materia prima) */}
            {showPrecioVenta && tieneAmbos && markupCalc !== null && margenVentaCalc !== null && (
              <div className="mt-4 space-y-3">

                {/* Advertencia de pérdida */}
                {esPerdida && (
                  <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-xs text-red-600">
                    <span className="mt-0.5 text-base leading-none">⚠</span>
                    <span>
                      El precio de venta es <strong>menor al costo</strong>. Cada unidad vendida generará una pérdida neta.
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {/* Markup */}
                  <div className={`border rounded-lg px-4 py-3 ${esPerdida ? "bg-red-50 border-red-200" : "bg-blue-50 border-blue-100"}`}>
                    <p className={`text-xs font-medium mb-1 ${esPerdida ? "text-red-500" : "text-blue-500"}`}>
                      Markup sobre costo
                    </p>
                    <p className={`text-lg font-bold tabular-nums ${esPerdida ? "text-red-700" : "text-blue-700"}`}>
                      {markupCalc.toFixed(2)}%
                    </p>
                    <p className={`text-xs mt-0.5 ${esPerdida ? "text-red-400" : "text-blue-400"}`}>
                      {esPerdida
                        ? `Se vende ${Math.abs(markupCalc).toFixed(0)}% por debajo del costo`
                        : `Se agrega ${markupCalc.toFixed(0)}% encima del costo`}
                    </p>
                  </div>

                  {/* Margen sobre venta */}
                  <div className={`border rounded-lg px-4 py-3 ${esPerdida ? "bg-red-50 border-red-200" : "bg-green-50 border-green-100"}`}>
                    <p className={`text-xs font-medium mb-1 ${esPerdida ? "text-red-500" : "text-green-500"}`}>
                      Margen sobre venta
                    </p>
                    <p className={`text-lg font-bold tabular-nums ${esPerdida ? "text-red-700" : "text-green-700"}`}>
                      {margenVentaCalc.toFixed(2)}%
                    </p>
                    <p className={`text-xs mt-0.5 ${esPerdida ? "text-red-400" : "text-green-400"}`}>
                      {esPerdida
                        ? "Este precio genera pérdida neta en cada venta"
                        : `De cada Gs. vendido, ${margenVentaCalc.toFixed(0)}% es ganancia`}
                    </p>
                  </div>
                </div>

              </div>
            )}
          </div>

          {/* Clasificación, Proveedor, Ubicación */}
          <div className="border-t border-slate-100 pt-6">
            <div className="flex items-baseline justify-between mb-3">
              <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold">
                Clasificación y ubicación
              </p>
              <span className="text-xs text-gray-400">Opcional</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
              {/* Categoría — 4 cols */}
              <div className="md:col-span-4 min-w-0">
                <label className={labelClass}>Categoría principal</label>
                <SelectFromList
                  value={categoriaId}
                  onChange={setCategoriaId}
                  options={categorias.map((c) => ({ id: c.id, label: c.nombre }))}
                  emptyShort="Sin categorías"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-400 truncate">
                    {categorias.length === 0 ? "Todavía no cargaste categorías." : `${categorias.length} disponibles`}
                  </span>
                  <Link
                    href="/inventario/categorias"
                    className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:text-sky-900 border border-sky-200 hover:bg-sky-50 px-2.5 py-1 rounded-md transition-colors"
                  >
                    + Crear
                  </Link>
                </div>
              </div>

              {/* Proveedor — 4 cols. Oculto para Menú (productos preparados no tienen proveedor). */}
              <div className={`md:col-span-4 min-w-0 ${tipoGastro === "menu" ? "hidden" : ""}`}>
                <label className={labelClass}>Proveedor principal</label>
                <SelectFromList
                  value={proveedorId}
                  onChange={setProveedorId}
                  options={proveedores.map((p) => ({ id: p.id, label: p.nombre }))}
                  emptyShort="Sin proveedores"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-400 truncate">
                    {proveedores.length === 0 ? "Todavía no cargaste proveedores." : `${proveedores.length} disponibles`}
                  </span>
                  <button
                    type="button"
                    onClick={() => setNuevoProveedorOpen(true)}
                    className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:text-sky-900 border border-sky-200 hover:bg-sky-50 px-2.5 py-1 rounded-md transition-colors"
                  >
                    + Crear
                  </button>
                </div>
              </div>

              {/* Ubicación principal — oculta en instancia En lo de Mari (no aplica para gastronomía).
                  Lógica/state preservados; submit envía ubicacionId que queda en null por defecto. */}
              <div className="hidden md:col-span-4 min-w-0">
                <label className={labelClass}>Ubicación principal</label>
                <SelectFromList
                  value={ubicacionId}
                  onChange={setUbicacionId}
                  options={ubicaciones.map((u) => ({ id: u.id, label: u.nombre, sublabel: u.tipo }))}
                  emptyShort="Sin ubicaciones"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-400 truncate">
                    {ubicaciones.length === 0 ? "Todavía no cargaste ubicaciones." : `${ubicaciones.length} disponibles`}
                  </span>
                  <Link
                    href="/inventario/ubicaciones"
                    className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:text-sky-900 border border-sky-200 hover:bg-sky-50 px-2.5 py-1 rounded-md transition-colors"
                  >
                    + Crear
                  </Link>
                </div>
              </div>
            </div>

            {/* Clasificación gastronómica — oculta (presets aplicados por el tipo seleccionado) */}
            <div className="hidden mt-5 pt-4 border-t border-gray-100">
              <label className={labelClass}>Clasificación</label>
              <div className="flex flex-wrap gap-4 mt-1">
                <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={esVendible}
                    onChange={(e) => setEsVendible(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                  />
                  Vendible (se vende al cliente final)
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={esInsumo}
                    onChange={(e) => setEsInsumo(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                  />
                  Insumo (se usa en recetas)
                </label>
              </div>
              <p className="mt-1 text-xs text-gray-400">
                Puede ser ambos (producto mixto). Por defecto: vendible.
              </p>
            </div>

            {/* Configuración gastronómica — oculta (campos técnicos no necesarios en UX gastro simplificada) */}
            <div className="hidden mt-5 pt-4 border-t border-gray-100">
              <p className="text-xs uppercase tracking-wide font-semibold text-gray-500 mb-3">
                Configuración gastronómica
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={controlaStock}
                    onChange={(e) => setControlaStock(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                  />
                  Controlar stock
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={valorizado}
                    onChange={(e) => setValorizado(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                  />
                  Valorizado
                </label>
                <div>
                  <label className={labelClass}>Unidad de compra</label>
                  <input
                    type="text"
                    value={unidadCompra}
                    onChange={(e) => setUnidadCompra(e.target.value)}
                    placeholder='Ej: "Bolsa 25kg"'
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Unidad de receta</label>
                  <input
                    type="text"
                    value={unidadReceta}
                    onChange={(e) => setUnidadReceta(e.target.value)}
                    placeholder='Ej: "g"'
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Factor compra → receta</label>
                  <input
                    type="number"
                    step="0.0001"
                    min="0.0001"
                    value={factorCompraReceta}
                    onChange={(e) => setFactorCompraReceta(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Tiempo preparación (min)</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={tiempoPrepMinutos}
                    onChange={(e) => setTiempoPrepMinutos(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>
              <p className="mt-2 text-xs text-gray-400">
                Ejemplo: Harina se compra por bolsa de 25kg, pero se usa en recetas por gramos. En ese caso unidad compra = bolsa 25kg, unidad receta = g, factor = 25000.
              </p>
            </div>
          </div>

          {/* Stock actual + Stock mínimo — solo para Reventa (Menú/Materia no controlan stock en UX simple) */}
          <div className={showStock ? "" : "hidden"}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <label className={labelClass}>Stock actual</label>
                <input
                  type="number"
                  name="stock_actual"
                  value={form.stock_actual}
                  onChange={handleChange}
                  placeholder="Ej: 50"
                  className={inputClass}
                  min={0}
                  required={showStock}
                />
              </div>

              <div>
                <label className={labelClass}>Stock mínimo</label>
                <input
                  type="number"
                  name="stock_minimo"
                  value={form.stock_minimo}
                  onChange={handleChange}
                  placeholder="Ej: 10"
                  className={inputClass}
                  min={0}
                  required={showStock}
                />
              </div>
            </div>
            {parseInt(form.stock_actual) > 0 && (
              <p className="mt-2 text-xs text-gray-400">
                Se generará automáticamente un movimiento de inventario inicial con {form.stock_actual} unidades al guardar.
              </p>
            )}
          </div>

          {/* Método de valuación — oculto en instancia En lo de Mari.
              Se mantiene siempre 'CPP' (default del state form.metodo_valuacion) y se envía al backend tal cual. */}
          <div className="hidden">
            <label className={labelClass}>Método de valuación</label>
            <select
              name="metodo_valuacion"
              value={form.metodo_valuacion}
              onChange={handleChange}
              className={inputClass}
            >
              <option value="CPP">CPP — Costo Promedio Ponderado</option>
              <option value="FIFO">FIFO — Primero en entrar, primero en salir</option>
              <option value="LIFO">LIFO — Último en entrar, primero en salir</option>
            </select>
          </div>

          {/* Datos de autopartes (Fase 2 — todos opcionales) */}
          <details className="rounded-lg border border-slate-200 bg-white p-4 open:shadow-sm">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700 hover:text-slate-900">
              Datos de autopartes (opcional)
            </summary>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Código OEM (original)</label>
                <input
                  type="text"
                  name="codigo_oem"
                  value={form.codigo_oem}
                  onChange={handleChange}
                  placeholder="ej. 90915-YZZE1"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Código alternativo</label>
                <input
                  type="text"
                  name="codigo_alternativo"
                  value={form.codigo_alternativo}
                  onChange={handleChange}
                  placeholder="ej. WIX-57045"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Marca del repuesto</label>
                <input
                  type="text"
                  name="marca_repuesto"
                  value={form.marca_repuesto}
                  onChange={handleChange}
                  placeholder="ej. Bosch, NGK, Mahle"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Garantía (meses)</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  name="garantia_meses"
                  value={form.garantia_meses}
                  onChange={handleChange}
                  placeholder="0"
                  className={inputClass}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={permitirVentaSinStock}
                    onChange={(e) => setPermitirVentaSinStock(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-[#0EA5E9] focus:ring-[#0EA5E9]"
                  />
                  Permitir vender aún sin stock disponible
                </label>
              </div>
              <div className="sm:col-span-2 pt-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ubicación física</p>
              </div>
              <div>
                <label className={labelClass}>Departamento</label>
                <input
                  type="text"
                  name="departamento"
                  value={form.departamento}
                  onChange={handleChange}
                  placeholder="ej. PLAZA Q5"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Pasillo</label>
                <input
                  type="text"
                  name="pasillo"
                  value={form.pasillo}
                  onChange={handleChange}
                  placeholder="ej. A"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Estante</label>
                <input
                  type="text"
                  name="estante"
                  value={form.estante}
                  onChange={handleChange}
                  placeholder="ej. 3"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Caja</label>
                <input
                  type="text"
                  name="caja"
                  value={form.caja}
                  onChange={handleChange}
                  placeholder="ej. 12"
                  className={inputClass}
                />
              </div>
              <div className="sm:col-span-2 pt-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Proveedor</p>
              </div>
              <div>
                <label className={labelClass}>Nombre del proveedor</label>
                <input
                  type="text"
                  name="distribuidor_nombre"
                  value={form.distribuidor_nombre}
                  onChange={handleChange}
                  placeholder="ej. BOSCH ARGENTINA"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>% comisión al proveedor</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  name="distribuidor_comision_pct"
                  value={form.distribuidor_comision_pct}
                  onChange={handleChange}
                  placeholder="0"
                  className={inputClass}
                />
              </div>
            </div>
          </details>

          {/* Acciones */}
          <div className="flex gap-4 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white px-5 py-3 rounded-lg text-sm font-medium transition-colors shadow-sm active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Guardando..." : "Guardar producto"}
            </button>

            <button
              type="button"
              onClick={() => router.push("/inventario")}
              className="border border-slate-200 px-5 py-3 rounded-lg text-sm hover:bg-slate-50 transition-colors"
            >
              Cancelar
            </button>
          </div>

        </form>
      </div>

      {/* Modal: crear proveedor sin perder el form actual. */}
      <QuickNuevoProveedorModal
        open={nuevoProveedorOpen}
        onClose={() => setNuevoProveedorOpen(false)}
        onCreated={(p) => {
          setProveedores((prev) => {
            // dedup por id (defensivo) y mantenemos orden alfabético por nombre
            const map = new Map(prev.map((r) => [r.id, r]));
            map.set(p.id, { id: p.id, nombre: p.nombre });
            return Array.from(map.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));
          });
          setProveedorId(p.id);
        }}
      />
    </div>
  );
}
