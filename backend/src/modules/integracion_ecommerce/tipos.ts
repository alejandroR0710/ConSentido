// Contrato de los avisos con el e-commerce — espejo de
// apps/api/src/modules/pos-sync/pos-sync.types.ts en el repo del e-commerce.
//
// Un ítem vendible se identifica por (productId, variantId) del e-commerce:
// producto sin variantes = un ítem (variantId null); con variantes = un ítem
// por variante. En la tabla `productos` eso es `ecommerce_item_key`
// ("productId:variantId", variantId vacío si no tiene).

export interface ItemEcommerce {
  productId: string;
  variantId: string | null;
  sku: string;
  name: string;
  price: number; // precio "de físico", ya sin la comisión de Wompi
  salePrice: number | null;
  stock: number;
}

export interface SnapshotProducto {
  productId: string;
  name: string;
  category: string | null;
  imageUrl: string | null;
  published: boolean;
  deleted: boolean;
  items: ItemEcommerce[];
  // true = carga inicial / resincronización: el stock del e-commerce
  // reemplaza el del POS. false = el stock solo se toca al crear un ítem nuevo.
  setStock: boolean;
  emittedAt: string;
}

export interface DeltaStockEcommerce {
  productId: string;
  variantId: string | null;
  sku: string;
  delta: number; // con signo
  newStock: number;
  movementType: string;
  reason: string | null;
  occurredAt: string;
}

export type EventoEntrante =
  | { eventId: string; type: "PRODUCT_SNAPSHOT"; payload: SnapshotProducto; createdAt?: string }
  | { eventId: string; type: "STOCK_DELTA"; payload: DeltaStockEcommerce; createdAt?: string };

// Lo que el POS le manda al e-commerce.
export interface DeltaStockPos {
  productId: string | null;
  variantId: string | null;
  sku: string;
  delta: number; // con signo: una venta de 2 = -2
  kind: "SALE" | "ADJUSTMENT" | "RETURN";
  reason?: string;
}

export function claveItem(productId: string, variantId: string | null): string {
  return `${productId}:${variantId ?? ""}`;
}
