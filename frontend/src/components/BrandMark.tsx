type BrandMarkProps = {
  compact?: boolean;
};

const brandName = import.meta.env.VITE_BRAND_NAME ?? "Crystal-shop";

export function BrandMark({ compact = false }: BrandMarkProps) {
  return (
    <div className={`brand-mark ${compact ? "brand-mark--compact" : ""}`}>
      <div className="brand-mark__gem" aria-hidden="true">
        <span>C</span>
      </div>
      {!compact && (
        <div>
          <strong>{brandName}</strong>
          <small>Shop management system</small>
        </div>
      )}
    </div>
  );
}
