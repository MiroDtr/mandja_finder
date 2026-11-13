import { euro, type Product } from "./db";

export function ProductCard({ product }: { product: Product }) {
  return (
    <div className="product">
      <div className="product-top">
        <span className={`store store-${product.store.toLowerCase()}`}>{product.store}</span>
        {product.discount != null && <span className="discount">-{Math.round(Math.abs(product.discount))}%</span>}
      </div>
      <div className="product-name">{product.name}</div>
      {product.size && <div className="muted small">{product.size}</div>}
      <div className="product-price">
        <strong>{euro(product.price)}</strong>
        {product.oldPrice != null && <s>{euro(product.oldPrice)}</s>}
      </div>
      {product.unitPrice != null && product.unit && (
        <div className="muted small">
          {euro(product.unitPrice)} / {product.unit}
        </div>
      )}
    </div>
  );
}

export function ProductGrid({ products }: { products: Product[] }) {
  if (!products.length) return null;
  return (
    <div className="product-grid">
      {products.map((p) => (
        <ProductCard key={p.id} product={p} />
      ))}
    </div>
  );
}
