import { euro, type Product } from "./db";

export function ProductCard({ product, liked, disliked }: { product: Product; liked?: boolean; disliked?: boolean }) {
  return (
    <div className={disliked ? "product disliked" : "product"}>
      <div className="product-top">
        <span className={`store store-${product.store.toLowerCase()}`}>{product.store}</span>
        {product.discount != null && <span className="discount">-{Math.round(Math.abs(product.discount))}%</span>}
      </div>
      <div className="product-name">
        {liked && <span title="Харесваш го">⭐ </span>}
        {product.name}
      </div>
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

export function ProductGrid({
  products,
  liked,
  disliked,
}: {
  products: Product[];
  liked?: Set<number>;
  disliked?: Set<number>;
}) {
  if (!products.length) return null;
  return (
    <div className="product-grid">
      {products.map((p) => (
        <ProductCard key={p.id} product={p} liked={liked?.has(p.id)} disliked={disliked?.has(p.id)} />
      ))}
    </div>
  );
}
