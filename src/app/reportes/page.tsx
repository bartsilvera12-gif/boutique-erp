"use client";

import PageHeader from "@/components/ui/PageHeader";
import { ReportCard } from "@/components/reportes/ReportCard";
import { Wallet, Truck, Package, ShoppingCart, ArrowLeftRight, Archive, Repeat } from "lucide-react";

/** Hub de reportería operativa (Fase 1: Estado de cuenta + Proveedores). */
export default function ReportesPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Zentra · Análisis"
        title="Reportes"
        description="Panel de análisis y reportería operativa"
      />

      <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3">
        <li>
          <ReportCard
            title="Estado de cuenta"
            subtitle="Saldos, movimientos y situación financiera"
            icon={Wallet}
            description="Resumen de ventas, compras, gastos y resultado del período, con sus movimientos."
            href="/reportes/estado-cuenta"
          />
        </li>
        <li>
          <ReportCard
            title="Ventas"
            subtitle="Facturación y operaciones"
            icon={ShoppingCart}
            description="Ventas del mes, desglose por tipo de precio (minorista/mayorista/al costo) y por producto."
            href="/reportes/ventas"
          />
        </li>
        <li>
          <ReportCard
            title="Compras"
            subtitle="Adquisiciones y costos"
            icon={Package}
            description="Compras del mes (agrupadas por N° de control), por proveedor y por producto."
            href="/reportes/compras"
          />
        </li>
        <li>
          <ReportCard
            title="Proveedores"
            subtitle="Abastecimiento y relación comercial"
            icon={Truck}
            description="Resumen de proveedores, compras por proveedor y actividad del mes."
            href="/reportes/proveedores"
          />
        </li>
        <li>
          <ReportCard
            title="Conciliación bancaria"
            subtitle="Cobros por método y entidad"
            icon={ArrowLeftRight}
            description="Detalle de cobro por venta (efectivo/transferencia/tarjeta), por método y por entidad."
            href="/reportes/conciliacion"
          />
        </li>
        <li>
          <ReportCard
            title="Productos sin movimiento"
            subtitle="Stock muerto · capital inmovilizado"
            icon={Archive}
            description="Productos con stock > 0 que no tuvieron salidas en el período. Muestra valor inmovilizado y días sin venta."
            href="/reportes/sin-movimiento"
          />
        </li>
        <li>
          <ReportCard
            title="Rotación de inventario"
            subtitle="Velocidad de venta por producto"
            icon={Repeat}
            description="Cuántas veces se vendió el stock de cada producto en el período. Identifica productos de alta/media/baja/nula rotación."
            href="/reportes/rotacion"
          />
        </li>
      </ul>
    </div>
  );
}
