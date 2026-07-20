import { FormEvent, useEffect, useMemo, useState } from "react";

import {
  createBrand,
  createCatalogProduct,
  createCategory,
  createProductImage,
  createProductVariant,
  listBrands,
  listCatalogProducts,
  listCategories,
  setProductPublication,
  updateCatalogProduct,
  updateProductVariant,
} from "../api/client";
import type { Brand, CatalogProduct, Category, CatalogVariant } from "../api/types";
import { StatusPill } from "../components/StatusPill";
import {
  demoBrands,
  demoCatalogProducts,
  demoCategories,
} from "../data/demoManagement";
import { useAuth } from "../state/auth";
import { integer, money, titleize, toneForStatus } from "../utils/format";

type TrackingType = "bulk" | "serial" | "imei";
type ItemKind = "phone" | "laptop" | "accessory" | "repair_part" | "general";

type ItemForm = {
  category_id: string;
  brand_id: string;
  item_name: string;
  model_type: string;
  ram: string;
  rom: string;
  processor: string;
  storage: string;
  color: string;
  capacity: string;
  warranty_months: string;
  description: string;
  option_name: string;
  sku: string;
  barcode: string;
  tracking_type: TrackingType;
  cost_price: string;
  selling_price: string;
  minimum_selling_price: string;
  imei_numbers: string;
  serial_numbers: string;
  image_url: string;
  image_alt_text: string;
};

type VariantForm = {
  name: string;
  sku: string;
  barcode: string;
  tracking_type: TrackingType;
  cost_price: string;
  selling_price: string;
  minimum_selling_price: string;
};

const emptyCategoryForm = {
  name: "",
  slug: "",
  description: "",
};

const emptyBrandForm = {
  name: "",
  description: "",
};

const emptyImageForm = {
  url: "",
  alt_text: "",
  position: "0",
};

const emptyPriceForm = {
  variant_id: "",
  name: "",
  barcode: "",
  selling_price: "",
  is_active: true,
};

const emptyProductEditForm = {
  name: "",
  category_id: "",
  brand_id: "",
  warranty_months: "0",
  description: "",
};

function baseItemForm(): ItemForm {
  return {
    category_id: demoCategories[0]?.id ?? "",
    brand_id: demoBrands[0]?.id ?? "",
    item_name: "",
    model_type: "",
    ram: "",
    rom: "",
    processor: "",
    storage: "",
    color: "",
    capacity: "",
    warranty_months: "0",
    description: "",
    option_name: "",
    sku: "",
    barcode: "",
    tracking_type: "bulk",
    cost_price: "0",
    selling_price: "0",
    minimum_selling_price: "",
    imei_numbers: "",
    serial_numbers: "",
    image_url: "",
    image_alt_text: "",
  };
}

const emptyVariantForm: VariantForm = {
  name: "",
  sku: "",
  barcode: "",
  tracking_type: "bulk",
  cost_price: "0",
  selling_price: "0",
  minimum_selling_price: "",
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function splitIdentifiers(value: string) {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function duplicateValues(values: string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  values.forEach((value) => {
    const normalized = value.toLowerCase();
    if (seen.has(normalized)) {
      duplicates.add(value);
      return;
    }
    seen.add(normalized);
  });
  return Array.from(duplicates);
}

function skuExists(products: CatalogProduct[], sku: string, exceptVariantId?: string) {
  const normalized = sku.trim().toUpperCase();
  if (!normalized) return false;
  return products.some((product) =>
    product.variants.some(
      (variant) =>
        variant.id !== exceptVariantId && variant.sku.trim().toUpperCase() === normalized,
    ),
  );
}

function isHttpUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return true;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function priceNumber(value: string) {
  return Number(value) || 0;
}

function priceMargin(cost: string, selling: string) {
  return priceNumber(selling) - priceNumber(cost);
}

function categoryKind(category?: Category): ItemKind {
  const text = `${category?.name ?? ""} ${category?.slug ?? ""}`.toLowerCase();
  if (text.includes("phone")) return "phone";
  if (text.includes("laptop") || text.includes("computer")) return "laptop";
  if (text.includes("repair") || text.includes("part") || text.includes("screen")) {
    return "repair_part";
  }
  if (
    text.includes("accessor") ||
    text.includes("charger") ||
    text.includes("cable") ||
    text.includes("power") ||
    text.includes("flash") ||
    text.includes("memory")
  ) {
    return "accessory";
  }
  return "general";
}

function defaultTracking(kind: ItemKind): TrackingType {
  if (kind === "phone") return "imei";
  if (kind === "laptop") return "serial";
  return "bulk";
}

function defaultWarranty(kind: ItemKind) {
  if (kind === "phone") return "12";
  if (kind === "laptop") return "6";
  if (kind === "accessory") return "3";
  return "0";
}

function kindLabel(kind: ItemKind) {
  if (kind === "repair_part") return "Repair part";
  return titleize(kind);
}

function productVariantCount(products: CatalogProduct[]) {
  return products.reduce((sum, product) => sum + product.variants.length, 0);
}

function variantAttributeEntries(variant?: CatalogVariant) {
  return Object.entries(variant?.attributes ?? {}).filter(
    ([, value]) => value !== null && value !== undefined && String(value).trim() !== "",
  );
}

function catalogReadiness(product?: CatalogProduct, variant?: CatalogVariant) {
  return [
    {
      label: "Catalog",
      ok: Boolean(product?.is_active && variant?.is_active),
      detail: "Item and selected SKU are active",
    },
    {
      label: "Pricing",
      ok: Number(variant?.selling_price ?? 0) > 0,
      detail: "Selling price is set",
    },
    {
      label: "Stock",
      ok: false,
      detail: "Receive stock before POS can sell this SKU",
    },
  ];
}

function buildItemName(form: ItemForm, brandName?: string) {
  if (form.item_name.trim()) return form.item_name.trim();
  const name = [brandName, form.model_type].filter(Boolean).join(" ").trim();
  return name || "New item";
}

function buildOptionName(form: ItemForm, kind: ItemKind) {
  if (form.option_name.trim()) return form.option_name.trim();
  if (kind === "phone") {
    return [form.ram, form.rom, form.color].filter(Boolean).join(" / ") || "Standard";
  }
  if (kind === "laptop") {
    return (
      [form.processor, form.ram, form.storage].filter(Boolean).join(" / ") ||
      "Standard"
    );
  }
  if (kind === "accessory") {
    return [form.capacity, form.color].filter(Boolean).join(" / ") || "Standard";
  }
  if (kind === "repair_part") {
    return [form.model_type, form.color].filter(Boolean).join(" / ") || "Standard";
  }
  return "Standard";
}

function buildSku(form: ItemForm, brandName?: string, kind?: ItemKind) {
  if (form.sku.trim()) return form.sku.trim().toUpperCase();
  const parts = [
    kind === "phone"
      ? "PHN"
      : kind === "laptop"
        ? "LAP"
        : kind === "repair_part"
          ? "PRT"
          : "SKU",
    brandName,
    form.model_type || form.item_name,
    form.rom || form.capacity || form.storage,
  ]
    .filter(Boolean)
    .join(" ");

  return slugify(parts).replace(/-/g, "-").toUpperCase();
}

function buildAttributes(form: ItemForm, kind: ItemKind) {
  const identifiers = {
    imei_numbers: splitIdentifiers(form.imei_numbers).join(", "),
    serial_numbers: splitIdentifiers(form.serial_numbers).join(", "),
  };

  return Object.fromEntries(
    Object.entries({
      item_type: kind,
      model_type: form.model_type,
      ram: form.ram,
      rom: form.rom,
      processor: form.processor,
      storage: form.storage,
      color: form.color,
      capacity: form.capacity,
      ...identifiers,
    }).filter(([, value]) => value),
  );
}

function emptyTableRow(colSpan: number, message: string) {
  return (
    <tr>
      <td className="empty-table-cell" colSpan={colSpan}>
        {message}
      </td>
    </tr>
  );
}

export function CatalogPage() {
  const { token, isPreview } = useAuth();
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<CatalogProduct[]>(demoCatalogProducts);
  const [categories, setCategories] = useState<Category[]>(demoCategories);
  const [brands, setBrands] = useState<Brand[]>(demoBrands);
  const [selectedProductId, setSelectedProductId] = useState(
    demoCatalogProducts[0]?.id ?? "",
  );
  const [selectedVariantId, setSelectedVariantId] = useState(
    demoCatalogProducts[0]?.variants[0]?.id ?? "",
  );
  const [categoryForm, setCategoryForm] = useState(emptyCategoryForm);
  const [brandForm, setBrandForm] = useState(emptyBrandForm);
  const [itemForm, setItemForm] = useState<ItemForm>(baseItemForm);
  const [productEditForm, setProductEditForm] = useState(emptyProductEditForm);
  const [variantForm, setVariantForm] = useState<VariantForm>(emptyVariantForm);
  const [imageForm, setImageForm] = useState(emptyImageForm);
  const [priceForm, setPriceForm] = useState(emptyPriceForm);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [brandFilter, setBrandFilter] = useState("all");
  const [trackingFilter, setTrackingFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [websiteFilter, setWebsiteFilter] = useState("all");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );
  const brandById = useMemo(
    () => new Map(brands.map((brand) => [brand.id, brand.name])),
    [brands],
  );

  const selectedCategory = useMemo(
    () => categories.find((category) => category.id === itemForm.category_id),
    [categories, itemForm.category_id],
  );
  const selectedKind = categoryKind(selectedCategory);
  const selectedBrandName = brandById.get(itemForm.brand_id);

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedProductId) ?? products[0],
    [products, selectedProductId],
  );

  const selectedVariant = useMemo(
    () =>
      selectedProduct?.variants.find((variant) => variant.id === selectedVariantId) ??
      selectedProduct?.variants[0],
    [selectedProduct, selectedVariantId],
  );

  const selectedVariantAttributes = useMemo(
    () => variantAttributeEntries(selectedVariant),
    [selectedVariant],
  );

  const selectedReadiness = useMemo(
    () => catalogReadiness(selectedProduct, selectedVariant),
    [selectedProduct, selectedVariant],
  );

  const filteredProducts = useMemo(
    () =>
      products.filter((product) => {
        const categoryMatches =
          categoryFilter === "all" || product.category_id === categoryFilter;
        const brandMatches = brandFilter === "all" || product.brand_id === brandFilter;
        const statusMatches =
          statusFilter === "all" ||
          (statusFilter === "active" ? product.is_active : !product.is_active);
        const websiteMatches =
          websiteFilter === "all" ||
          (websiteFilter === "published"
            ? product.is_published
            : !product.is_published);
        const trackingMatches =
          trackingFilter === "all" ||
          product.variants.some((variant) => variant.tracking_type === trackingFilter);

        return (
          categoryMatches &&
          brandMatches &&
          statusMatches &&
          websiteMatches &&
          trackingMatches
        );
      }),
    [brandFilter, categoryFilter, products, statusFilter, trackingFilter, websiteFilter],
  );

  const filteredVariantRows = useMemo(
    () =>
      filteredProducts.flatMap((product) =>
        product.variants
          .filter(
            (variant) =>
              trackingFilter === "all" || variant.tracking_type === trackingFilter,
          )
          .map((variant) => ({ product, variant })),
      ),
    [filteredProducts, trackingFilter],
  );

  const stats = useMemo(
    () => ({
      products: products.length,
      variants: productVariantCount(products),
      published: products.filter((product) => product.is_published).length,
      inactive: products.filter((product) => !product.is_active).length,
    }),
    [products],
  );
  const draftProductName = buildItemName(itemForm, selectedBrandName);
  const draftOptionName = buildOptionName(itemForm, selectedKind);
  const draftSku = buildSku(itemForm, selectedBrandName, selectedKind);
  const draftAttributes = buildAttributes(itemForm, selectedKind);
  const draftAttributeEntries = Object.entries(draftAttributes).filter(
    ([, value]) => value !== "",
  );
  const draftImeiNumbers = splitIdentifiers(itemForm.imei_numbers);
  const draftSerialNumbers = splitIdentifiers(itemForm.serial_numbers);
  const draftDuplicateImeis = duplicateValues(draftImeiNumbers);
  const draftDuplicateSerials = duplicateValues(draftSerialNumbers);
  const draftMargin = priceMargin(itemForm.cost_price, itemForm.selling_price);
  const draftSellingPrice = priceNumber(itemForm.selling_price);
  const draftMinimumPrice = priceNumber(itemForm.minimum_selling_price);
  const draftImageUrl = itemForm.image_url.trim();
  const draftImageIsValid = isHttpUrl(draftImageUrl);
  const draftSkuAlreadyExists = skuExists(products, draftSku);

  async function reloadProducts(preferredProductId?: string) {
    if (!token || isPreview) return;
    const result = await listCatalogProducts(token, query, {
      isActive: null,
      isPublished: null,
      pageSize: 100,
    });
    setProducts(result.items);
    setSelectedProductId(preferredProductId || result.items[0]?.id || "");
  }

  useEffect(() => {
    if (!token || isPreview) return;

    let active = true;
    Promise.allSettled([
      listCatalogProducts(token, query, {
        isActive: null,
        isPublished: null,
        pageSize: 100,
      }),
      listCategories(token),
      listBrands(token),
    ]).then(([productsResult, categoriesResult, brandsResult]) => {
      if (!active) return;
      let failed = false;

      if (productsResult.status === "fulfilled") {
        setProducts(productsResult.value.items);
        setSelectedProductId(
          (current) => current || productsResult.value.items[0]?.id || "",
        );
      } else {
        failed = true;
      }

      if (categoriesResult.status === "fulfilled") {
        setCategories(categoriesResult.value);
        setItemForm((current) => ({
          ...current,
          category_id: current.category_id || categoriesResult.value[0]?.id || "",
        }));
      } else {
        failed = true;
      }

      if (brandsResult.status === "fulfilled") {
        setBrands(brandsResult.value);
        setItemForm((current) => ({
          ...current,
          brand_id: current.brand_id || brandsResult.value[0]?.id || "",
        }));
      } else {
        failed = true;
      }

      setNotice(
        failed
          ? "Catalog API unavailable or not permitted. Sample data remains visible where needed."
          : null,
      );
    });

    return () => {
      active = false;
    };
  }, [isPreview, query, token]);

  useEffect(() => {
    const variant = selectedVariant;
    if (!variant) {
      setPriceForm(emptyPriceForm);
      return;
    }
    setSelectedVariantId(variant.id);
    setPriceForm({
      variant_id: variant.id,
      name: variant.name,
      barcode: variant.barcode ?? "",
      selling_price: variant.selling_price,
      is_active: variant.is_active,
    });
  }, [selectedVariant]);

  useEffect(() => {
    if (!selectedProduct) {
      setProductEditForm(emptyProductEditForm);
      return;
    }
    setProductEditForm({
      name: selectedProduct.name,
      category_id: selectedProduct.category_id ?? "",
      brand_id: selectedProduct.brand_id ?? "",
      warranty_months: String(selectedProduct.warranty_months),
      description: selectedProduct.description ?? "",
    });
  }, [selectedProduct]);

  function updateProduct(product: CatalogProduct) {
    setProducts((current) =>
      current.map((item) => (item.id === product.id ? product : item)),
    );
    setSelectedProductId(product.id);
  }

  function handleCategoryChange(categoryId: string) {
    const category = categories.find((item) => item.id === categoryId);
    const kind = categoryKind(category);
    setItemForm((current) => ({
      ...current,
      category_id: categoryId,
      tracking_type: defaultTracking(kind),
      warranty_months: defaultWarranty(kind),
    }));
  }

  async function handleCreateCategory(event: FormEvent) {
    event.preventDefault();
    if (!categoryForm.name.trim() || !categoryForm.slug.trim()) {
      setNotice("Category name and slug are required.");
      return;
    }

    setBusy(true);
    try {
      if (!token || isPreview) {
        const category: Category = {
          id: `preview-category-${Date.now()}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_deleted: false,
          parent_id: null,
          name: categoryForm.name.trim(),
          slug: categoryForm.slug.trim(),
          description: categoryForm.description || null,
          is_active: true,
        };
        setCategories((current) => [category, ...current]);
        setItemForm((current) => ({ ...current, category_id: category.id }));
        setCategoryForm(emptyCategoryForm);
        setNotice("Preview category created locally.");
        return;
      }

      const category = await createCategory(token, {
        name: categoryForm.name.trim(),
        slug: categoryForm.slug.trim(),
        description: categoryForm.description || null,
      });
      setCategories((current) => [category, ...current]);
      setItemForm((current) => ({ ...current, category_id: category.id }));
      setCategoryForm(emptyCategoryForm);
      setNotice(`Created category ${category.name}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not create category.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateBrand(event: FormEvent) {
    event.preventDefault();
    if (!brandForm.name.trim()) {
      setNotice("Brand name is required.");
      return;
    }

    setBusy(true);
    try {
      if (!token || isPreview) {
        const brand: Brand = {
          id: `preview-brand-${Date.now()}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_deleted: false,
          name: brandForm.name.trim(),
          description: brandForm.description || null,
          is_active: true,
        };
        setBrands((current) => [brand, ...current]);
        setItemForm((current) => ({ ...current, brand_id: brand.id }));
        setBrandForm(emptyBrandForm);
        setNotice("Preview brand created locally.");
        return;
      }

      const brand = await createBrand(token, {
        name: brandForm.name.trim(),
        description: brandForm.description || null,
      });
      setBrands((current) => [brand, ...current]);
      setItemForm((current) => ({ ...current, brand_id: brand.id }));
      setBrandForm(emptyBrandForm);
      setNotice(`Created brand ${brand.name}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not create brand.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateItem(event: FormEvent) {
    event.preventDefault();
    const productName = buildItemName(itemForm, selectedBrandName);
    const optionName = buildOptionName(itemForm, selectedKind);
    const sku = buildSku(itemForm, selectedBrandName, selectedKind);

    if (!itemForm.category_id) {
      setNotice("Select the item category first.");
      return;
    }
    if (!itemForm.brand_id) {
      setNotice("Select or create the item brand first.");
      return;
    }
    if (selectedKind === "phone" && !itemForm.model_type.trim()) {
      setNotice("Phone type/model is required. Example: A15.");
      return;
    }
    if (selectedKind === "phone" && itemForm.tracking_type !== "imei") {
      setNotice("Phones should use IMEI tracking so each device can be traced for warranty.");
      return;
    }
    if (selectedKind === "laptop" && !itemForm.model_type.trim()) {
      setNotice("Laptop model/type is required. Example: T480 or EliteBook 840 G5.");
      return;
    }
    if (selectedKind === "laptop" && itemForm.tracking_type === "bulk") {
      setNotice("Laptops should use serial number tracking so each unit can be traced.");
      return;
    }
    if (
      ["accessory", "repair_part", "general"].includes(selectedKind) &&
      !itemForm.item_name.trim() &&
      !itemForm.model_type.trim()
    ) {
      setNotice("Enter the item name or type/compatibility before adding it.");
      return;
    }
    if (!sku) {
      setNotice("SKU could not be generated. Enter one manually.");
      return;
    }
    if (skuExists(products, sku)) {
      setNotice(`SKU ${sku} already exists. Use a unique SKU for this item option.`);
      return;
    }
    if (Number(itemForm.selling_price) <= 0) {
      setNotice("Selling price must be greater than zero before the item can be sold.");
      return;
    }
    if (
      itemForm.minimum_selling_price.trim() &&
      Number(itemForm.minimum_selling_price) > Number(itemForm.selling_price)
    ) {
      setNotice("Minimum selling price cannot be higher than the selling price.");
      return;
    }
    if (!isHttpUrl(itemForm.image_url)) {
      setNotice("Image URL must start with http:// or https://.");
      return;
    }
    const duplicateImeis = duplicateValues(splitIdentifiers(itemForm.imei_numbers));
    if (duplicateImeis.length) {
      setNotice(`Duplicate IMEI entered: ${duplicateImeis[0]}.`);
      return;
    }
    const duplicateSerials = duplicateValues(splitIdentifiers(itemForm.serial_numbers));
    if (duplicateSerials.length) {
      setNotice(`Duplicate serial number entered: ${duplicateSerials[0]}.`);
      return;
    }

    setBusy(true);
    try {
      const productId = `preview-product-${Date.now()}`;
      const attributes = buildAttributes(itemForm, selectedKind);
      if (!token || isPreview) {
        const product: CatalogProduct = {
          id: productId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_deleted: false,
          name: productName,
          slug: slugify(productName),
          description: itemForm.description || null,
          category_id: itemForm.category_id || null,
          brand_id: itemForm.brand_id || null,
          warranty_months: Number(itemForm.warranty_months) || 0,
          is_active: true,
          is_published: false,
          variants: [
            {
              id: `preview-variant-${Date.now()}`,
              product_id: productId,
              name: optionName,
              sku,
              barcode: itemForm.barcode || null,
              tracking_type: itemForm.tracking_type,
              attributes,
              selling_price: itemForm.selling_price || "0",
              is_active: true,
            },
          ],
          images: itemForm.image_url.trim()
            ? [
                {
                  id: `preview-image-${Date.now()}`,
                  product_id: productId,
                  url: itemForm.image_url.trim(),
                  alt_text: itemForm.image_alt_text.trim() || productName,
                  position: 0,
                },
              ]
            : [],
        };
        setProducts((current) => [product, ...current]);
        setSelectedProductId(product.id);
        setItemForm((current) => ({
          ...baseItemForm(),
          category_id: current.category_id,
          brand_id: current.brand_id,
          tracking_type: defaultTracking(selectedKind),
          warranty_months: defaultWarranty(selectedKind),
        }));
        setNotice("Preview item created locally. Next step: receive stock before selling it in POS.");
        return;
      }

      const product = await createCatalogProduct(token, {
        name: productName,
        slug: slugify(productName),
        description: itemForm.description || null,
        category_id: itemForm.category_id || null,
        brand_id: itemForm.brand_id || null,
        warranty_months: Number(itemForm.warranty_months) || 0,
        variants: [
          {
            name: optionName,
            sku,
            barcode: itemForm.barcode || null,
            tracking_type: itemForm.tracking_type,
            attributes,
            cost_price: Number(itemForm.cost_price) || 0,
            selling_price: Number(itemForm.selling_price) || 0,
            minimum_selling_price: itemForm.minimum_selling_price || null,
          },
        ],
      });
      if (itemForm.image_url.trim()) {
        await createProductImage(token, product.id, {
          url: itemForm.image_url.trim(),
          alt_text: itemForm.image_alt_text.trim() || productName,
          position: 0,
        });
      }
      await reloadProducts(product.id);
      setItemForm((current) => ({
        ...baseItemForm(),
        category_id: current.category_id,
        brand_id: current.brand_id,
        tracking_type: defaultTracking(selectedKind),
        warranty_months: defaultWarranty(selectedKind),
      }));
      setNotice(`Created item ${product.name}. Next step: receive stock before selling it in POS.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not create item.");
    } finally {
      setBusy(false);
    }
  }

  async function handleTogglePublication() {
    if (!selectedProduct) return;
    setBusy(true);
    try {
      if (!token || isPreview) {
        updateProduct({
          ...selectedProduct,
          is_published: !selectedProduct.is_published,
          updated_at: new Date().toISOString(),
        });
        setNotice("Preview website visibility updated locally.");
        return;
      }

      const product = await setProductPublication(
        token,
        selectedProduct.id,
        !selectedProduct.is_published,
      );
      await reloadProducts(product.id);
      setNotice(`${product.name} website visibility updated.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update website visibility.");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleActive() {
    if (!selectedProduct) return;
    setBusy(true);
    try {
      if (!token || isPreview) {
        updateProduct({
          ...selectedProduct,
          is_active: !selectedProduct.is_active,
          updated_at: new Date().toISOString(),
        });
        setNotice("Preview item status updated locally.");
        return;
      }

      const product = await updateCatalogProduct(token, selectedProduct.id, {
        is_active: !selectedProduct.is_active,
      });
      await reloadProducts(product.id);
      setNotice(`${product.name} status updated.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update item.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdateProductDetails(event: FormEvent) {
    event.preventDefault();
    if (!selectedProduct) return;
    if (!productEditForm.name.trim()) {
      setNotice("Item name is required.");
      return;
    }

    setBusy(true);
    try {
      if (!token || isPreview) {
        updateProduct({
          ...selectedProduct,
          name: productEditForm.name.trim(),
          category_id: productEditForm.category_id || null,
          brand_id: productEditForm.brand_id || null,
          warranty_months: Number(productEditForm.warranty_months) || 0,
          description: productEditForm.description || null,
          updated_at: new Date().toISOString(),
        });
        setNotice("Preview item details updated locally.");
        return;
      }

      const product = await updateCatalogProduct(token, selectedProduct.id, {
        name: productEditForm.name.trim(),
        category_id: productEditForm.category_id || null,
        brand_id: productEditForm.brand_id || null,
        warranty_months: Number(productEditForm.warranty_months) || 0,
        description: productEditForm.description || null,
      });
      await reloadProducts(product.id);
      setNotice(`${product.name} details updated.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update item details.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateVariant(event: FormEvent) {
    event.preventDefault();
    if (!selectedProduct) {
      setNotice("Select an item before adding another option/SKU.");
      return;
    }
    if (!variantForm.name.trim() || !variantForm.sku.trim()) {
      setNotice("Option name and SKU are required.");
      return;
    }
    if (skuExists(products, variantForm.sku)) {
      setNotice(`SKU ${variantForm.sku.trim().toUpperCase()} already exists. Use a unique SKU.`);
      return;
    }
    if (Number(variantForm.selling_price) <= 0) {
      setNotice("Selling price must be greater than zero for the new option/SKU.");
      return;
    }
    if (
      variantForm.minimum_selling_price.trim() &&
      Number(variantForm.minimum_selling_price) > Number(variantForm.selling_price)
    ) {
      setNotice("Minimum selling price cannot be higher than the selling price.");
      return;
    }

    setBusy(true);
    try {
      if (!token || isPreview) {
        const variant: CatalogVariant = {
          id: `preview-variant-${Date.now()}`,
          product_id: selectedProduct.id,
          name: variantForm.name.trim(),
          sku: variantForm.sku.trim().toUpperCase(),
          barcode: variantForm.barcode || null,
          tracking_type: variantForm.tracking_type,
          attributes: {},
          selling_price: variantForm.selling_price || "0",
          is_active: true,
        };
        updateProduct({
          ...selectedProduct,
          variants: [...selectedProduct.variants, variant],
          updated_at: new Date().toISOString(),
        });
        setSelectedVariantId(variant.id);
        setVariantForm(emptyVariantForm);
        setNotice("Preview option/SKU added locally. Receive stock before selling it in POS.");
        return;
      }

      const variant = await createProductVariant(token, selectedProduct.id, {
        name: variantForm.name.trim(),
        sku: variantForm.sku.trim().toUpperCase(),
        barcode: variantForm.barcode || null,
        tracking_type: variantForm.tracking_type,
        attributes: {},
        cost_price: Number(variantForm.cost_price) || 0,
        selling_price: Number(variantForm.selling_price) || 0,
        minimum_selling_price: variantForm.minimum_selling_price || null,
      });
      await reloadProducts(selectedProduct.id);
      setSelectedVariantId(variant.id);
      setVariantForm(emptyVariantForm);
      setNotice(`Added option/SKU ${variant.sku}. Receive stock before selling it in POS.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not create option/SKU.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdateVariant(event: FormEvent) {
    event.preventDefault();
    if (!selectedProduct || !selectedVariant) {
      setNotice("Select an option/SKU before editing price.");
      return;
    }
    if (!priceForm.name.trim()) {
      setNotice("Option/SKU name is required.");
      return;
    }
    if (Number(priceForm.selling_price) <= 0) {
      setNotice("Selling price must be greater than zero.");
      return;
    }

    setBusy(true);
    try {
      if (!token || isPreview) {
        updateProduct({
          ...selectedProduct,
          updated_at: new Date().toISOString(),
          variants: selectedProduct.variants.map((variant) =>
            variant.id === selectedVariant.id
              ? {
                  ...variant,
                  name: priceForm.name,
                  barcode: priceForm.barcode || null,
                  selling_price: priceForm.selling_price || "0",
                  is_active: priceForm.is_active,
                }
              : variant,
          ),
        });
        setNotice("Preview option/SKU updated locally.");
        return;
      }

      const variant = await updateProductVariant(token, selectedVariant.id, {
        name: priceForm.name,
        barcode: priceForm.barcode || null,
        selling_price: Number(priceForm.selling_price) || 0,
        is_active: priceForm.is_active,
      });
      await reloadProducts(selectedProduct.id);
      setSelectedVariantId(variant.id);
      setNotice(`Updated option/SKU ${variant.sku}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update option/SKU.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateImage(event: FormEvent) {
    event.preventDefault();
    if (!selectedProduct) {
      setNotice("Select an item before adding an image.");
      return;
    }
    if (!imageForm.url.trim()) {
      setNotice("Image URL is required.");
      return;
    }
    if (!isHttpUrl(imageForm.url)) {
      setNotice("Image URL must start with http:// or https://.");
      return;
    }

    setBusy(true);
    try {
      if (!token || isPreview) {
        updateProduct({
          ...selectedProduct,
          updated_at: new Date().toISOString(),
          images: [
            ...selectedProduct.images,
            {
              id: `preview-image-${Date.now()}`,
              product_id: selectedProduct.id,
              url: imageForm.url.trim(),
              alt_text: imageForm.alt_text || null,
              position: Number(imageForm.position) || 0,
            },
          ],
        });
        setImageForm(emptyImageForm);
        setNotice("Preview image added locally.");
        return;
      }

      await createProductImage(token, selectedProduct.id, {
        url: imageForm.url.trim(),
        alt_text: imageForm.alt_text || null,
        position: Number(imageForm.position) || 0,
      });
      await reloadProducts(selectedProduct.id);
      setImageForm(emptyImageForm);
      setNotice("Item image added.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not add image.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="module-page module-page--compact">
      <div className="page-heading page-heading--compact">
        <div>
          <p className="eyebrow">Catalog</p>
          <h1>Item catalog</h1>
          <p>
            Add phones, laptops, accessories, and repair parts in shop language.
            The system still creates the correct product and SKU records behind
            the scenes.
          </p>
        </div>
        <label className="table-search">
          <span>Search</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Item, SKU, category"
          />
        </label>
      </div>

      {notice && <div className="notice notice--page">{notice}</div>}

      <div className="stats-grid stats-grid--compact">
        <article className="metric-card">
          <span>Items</span>
          <strong>{integer(stats.products)}</strong>
          <StatusPill tone="info">Catalog</StatusPill>
        </article>
        <article className="metric-card">
          <span>Options/SKUs</span>
          <strong>{integer(stats.variants)}</strong>
          <StatusPill tone="neutral">Sellable</StatusPill>
        </article>
        <article className="metric-card">
          <span>Website</span>
          <strong>{integer(stats.published)}</strong>
          <StatusPill tone="success">Visible</StatusPill>
        </article>
        <article className="metric-card">
          <span>Inactive</span>
          <strong>{integer(stats.inactive)}</strong>
          <StatusPill tone={stats.inactive ? "warning" : "success"}>
            Hidden
          </StatusPill>
        </article>
      </div>

      <section className="catalog-filter-panel">
        <label>
          Category
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
          >
            <option value="all">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Brand
          <select
            value={brandFilter}
            onChange={(event) => setBrandFilter(event.target.value)}
          >
            <option value="all">All brands</option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tracking
          <select
            value={trackingFilter}
            onChange={(event) => setTrackingFilter(event.target.value)}
          >
            <option value="all">All tracking</option>
            <option value="bulk">Quantity only</option>
            <option value="serial">Serial number</option>
            <option value="imei">IMEI</option>
          </select>
        </label>
        <label>
          Status
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="active">Available</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
        <label>
          Website
          <select
            value={websiteFilter}
            onChange={(event) => setWebsiteFilter(event.target.value)}
          >
            <option value="all">Website + internal</option>
            <option value="published">On website</option>
            <option value="internal">Internal only</option>
          </select>
        </label>
      </section>

      <div className="catalog-workspace m-t">
        <section className="panel-card">
          <header className="panel-card__header panel-card__header--compact">
            <div>
              <p className="eyebrow">Add item</p>
              <h2>{kindLabel(selectedKind)} details</h2>
            </div>
            <StatusPill tone="info">{kindLabel(selectedKind)}</StatusPill>
          </header>

          <form className="form-panel form-panel--compact" onSubmit={handleCreateItem}>
            <div className="form-grid form-grid--three">
              <label>
                What are you adding?
                <select
                  value={itemForm.category_id}
                  onChange={(event) => handleCategoryChange(event.target.value)}
                >
                  <option value="">Select category</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Brand
                <select
                  value={itemForm.brand_id}
                  onChange={(event) =>
                    setItemForm((current) => ({
                      ...current,
                      brand_id: event.target.value,
                    }))
                  }
                >
                  <option value="">Select brand</option>
                  {brands.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Stock tracking
                <select
                  value={itemForm.tracking_type}
                  onChange={(event) =>
                    setItemForm((current) => ({
                      ...current,
                      tracking_type: event.target.value as TrackingType,
                    }))
                  }
                >
                  <option value="bulk">Quantity only</option>
                  <option value="serial">Serial number</option>
                  <option value="imei">IMEI</option>
                </select>
              </label>
            </div>

            {selectedKind === "phone" && (
              <div className="catalog-form-section">
                <strong>Phone specs</strong>
                <div className="form-grid form-grid--three">
                  <label>
                    Type / model
                    <input
                      value={itemForm.model_type}
                      onChange={(event) =>
                        setItemForm((current) => ({
                          ...current,
                          model_type: event.target.value,
                        }))
                      }
                      placeholder="A15, Note 13, iPhone 12"
                    />
                  </label>
                  <label>
                    RAM
                    <input
                      value={itemForm.ram}
                      onChange={(event) =>
                        setItemForm((current) => ({
                          ...current,
                          ram: event.target.value,
                        }))
                      }
                      placeholder="4GB"
                    />
                  </label>
                  <label>
                    ROM / storage
                    <input
                      value={itemForm.rom}
                      onChange={(event) =>
                        setItemForm((current) => ({
                          ...current,
                          rom: event.target.value,
                        }))
                      }
                      placeholder="128GB"
                    />
                  </label>
                  <label>
                    Color
                    <input
                      value={itemForm.color}
                      onChange={(event) =>
                        setItemForm((current) => ({
                          ...current,
                          color: event.target.value,
                        }))
                      }
                      placeholder="Black"
                    />
                  </label>
                  <label>
                    Warranty months
                    <input
                      type="number"
                      min="0"
                      max="120"
                      value={itemForm.warranty_months}
                      onChange={(event) =>
                        setItemForm((current) => ({
                          ...current,
                          warranty_months: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Barcode
                    <input
                      value={itemForm.barcode}
                      onChange={(event) =>
                        setItemForm((current) => ({
                          ...current,
                          barcode: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
              </div>
            )}

            {selectedKind === "laptop" && (
              <div className="catalog-form-section">
                <strong>Laptop specs</strong>
                <div className="form-grid form-grid--three">
                  <label>
                    Model / type
                    <input
                      value={itemForm.model_type}
                      onChange={(event) =>
                        setItemForm((current) => ({
                          ...current,
                          model_type: event.target.value,
                        }))
                      }
                      placeholder="T480, EliteBook 840 G5"
                    />
                  </label>
                  <label>
                    Processor
                    <input
                      value={itemForm.processor}
                      onChange={(event) =>
                        setItemForm((current) => ({
                          ...current,
                          processor: event.target.value,
                        }))
                      }
                      placeholder="Core i5"
                    />
                  </label>
                  <label>
                    RAM
                    <input
                      value={itemForm.ram}
                      onChange={(event) =>
                        setItemForm((current) => ({
                          ...current,
                          ram: event.target.value,
                        }))
                      }
                      placeholder="8GB"
                    />
                  </label>
                  <label>
                    Storage
                    <input
                      value={itemForm.storage}
                      onChange={(event) =>
                        setItemForm((current) => ({
                          ...current,
                          storage: event.target.value,
                        }))
                      }
                      placeholder="256GB SSD"
                    />
                  </label>
                  <label>
                    Color / condition
                    <input
                      value={itemForm.color}
                      onChange={(event) =>
                        setItemForm((current) => ({
                          ...current,
                          color: event.target.value,
                        }))
                      }
                      placeholder="Black / Ex-UK"
                    />
                  </label>
                  <label>
                    Warranty months
                    <input
                      type="number"
                      min="0"
                      max="120"
                      value={itemForm.warranty_months}
                      onChange={(event) =>
                        setItemForm((current) => ({
                          ...current,
                          warranty_months: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
              </div>
            )}

            {(selectedKind === "accessory" ||
              selectedKind === "repair_part" ||
              selectedKind === "general") && (
              <div className="catalog-form-section">
                <strong>{kindLabel(selectedKind)} details</strong>
                <div className="form-grid form-grid--three">
                  <label>
                    Item name
                    <input
                      value={itemForm.item_name}
                      onChange={(event) =>
                        setItemForm((current) => ({
                          ...current,
                          item_name: event.target.value,
                        }))
                      }
                      placeholder="USB-C Charger, Galaxy A15 Screen"
                    />
                  </label>
                  <label>
                    Type / compatibility
                    <input
                      value={itemForm.model_type}
                      onChange={(event) =>
                        setItemForm((current) => ({
                          ...current,
                          model_type: event.target.value,
                        }))
                      }
                      placeholder="20W, A15, Type-C"
                    />
                  </label>
                  <label>
                    Capacity / size
                    <input
                      value={itemForm.capacity}
                      onChange={(event) =>
                        setItemForm((current) => ({
                          ...current,
                          capacity: event.target.value,
                        }))
                      }
                      placeholder="64GB, 10000mAh"
                    />
                  </label>
                  <label>
                    Color
                    <input
                      value={itemForm.color}
                      onChange={(event) =>
                        setItemForm((current) => ({
                          ...current,
                          color: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Warranty months
                    <input
                      type="number"
                      min="0"
                      max="120"
                      value={itemForm.warranty_months}
                      onChange={(event) =>
                        setItemForm((current) => ({
                          ...current,
                          warranty_months: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Barcode
                    <input
                      value={itemForm.barcode}
                      onChange={(event) =>
                        setItemForm((current) => ({
                          ...current,
                          barcode: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
              </div>
            )}

            <div className="catalog-form-section">
              <strong>Pricing and SKU</strong>
              <div className="form-grid form-grid--three">
                <label>
                  Option / SKU name
                  <input
                    value={itemForm.option_name}
                    onChange={(event) =>
                      setItemForm((current) => ({
                        ...current,
                        option_name: event.target.value,
                      }))
                    }
                    placeholder={buildOptionName(itemForm, selectedKind)}
                  />
                </label>
                <label>
                  SKU
                  <input
                    value={itemForm.sku}
                    onChange={(event) =>
                      setItemForm((current) => ({
                        ...current,
                        sku: event.target.value.toUpperCase(),
                      }))
                    }
                    placeholder={buildSku(itemForm, selectedBrandName, selectedKind)}
                  />
                </label>
                <label>
                  Cost price
                  <input
                    type="number"
                    min="0"
                    value={itemForm.cost_price}
                    onChange={(event) =>
                      setItemForm((current) => ({
                        ...current,
                        cost_price: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  Selling price
                  <input
                    type="number"
                    min="0"
                    value={itemForm.selling_price}
                    onChange={(event) =>
                      setItemForm((current) => ({
                        ...current,
                        selling_price: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  Minimum price
                  <input
                    type="number"
                    min="0"
                    value={itemForm.minimum_selling_price}
                    onChange={(event) =>
                      setItemForm((current) => ({
                        ...current,
                        minimum_selling_price: event.target.value,
                      }))
                    }
                    placeholder="Optional"
                  />
                </label>
                <label>
                  Description
                  <input
                    value={itemForm.description}
                    onChange={(event) =>
                      setItemForm((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                    placeholder="Optional notes"
                  />
                </label>
              </div>
            </div>

            <div className="catalog-form-section">
              <strong>Image</strong>
              <div className="form-grid form-grid--two">
                <label>
                  Image URL
                  <input
                    value={itemForm.image_url}
                    onChange={(event) =>
                      setItemForm((current) => ({
                        ...current,
                        image_url: event.target.value,
                      }))
                    }
                    placeholder="https://..."
                  />
                </label>
                <label>
                  Image alt text
                  <input
                    value={itemForm.image_alt_text}
                    onChange={(event) =>
                      setItemForm((current) => ({
                        ...current,
                        image_alt_text: event.target.value,
                      }))
                    }
                    placeholder={buildItemName(itemForm, selectedBrandName)}
                  />
                </label>
              </div>
            </div>

            <div className="catalog-draft-preview">
              <div className="catalog-draft-preview__header">
                <div>
                  <strong>Item preview</strong>
                  <span>This is what the system will create from the form.</span>
                </div>
                <StatusPill tone={draftSkuAlreadyExists ? "danger" : "success"}>
                  {draftSkuAlreadyExists ? "SKU exists" : "SKU ready"}
                </StatusPill>
              </div>

              <div className="catalog-draft-preview__grid">
                <div>
                  <span>Item name</span>
                  <strong>{draftProductName}</strong>
                </div>
                <div>
                  <span>Option/SKU name</span>
                  <strong>{draftOptionName}</strong>
                </div>
                <div>
                  <span>Generated SKU</span>
                  <strong>{draftSku || "Enter more details"}</strong>
                </div>
                <div>
                  <span>Tracking</span>
                  <strong>{titleize(itemForm.tracking_type)}</strong>
                </div>
                <div>
                  <span>Selling price</span>
                  <strong>{money(itemForm.selling_price || "0")}</strong>
                </div>
                <div>
                  <span>Approx. margin</span>
                  <strong>{money(draftMargin)}</strong>
                </div>
              </div>

              <div className="catalog-draft-preview__checks">
                <StatusPill tone={draftSellingPrice > 0 ? "success" : "danger"}>
                  {draftSellingPrice > 0 ? "Price set" : "Needs price"}
                </StatusPill>
                <StatusPill
                  tone={
                    !itemForm.minimum_selling_price.trim() ||
                    draftMinimumPrice <= draftSellingPrice
                      ? "success"
                      : "danger"
                  }
                >
                  Min price
                </StatusPill>
                <StatusPill tone={draftImageIsValid ? "info" : "danger"}>
                  {draftImageUrl ? "Image URL" : "No image yet"}
                </StatusPill>
                {(draftImeiNumbers.length > 0 || draftSerialNumbers.length > 0) && (
                  <StatusPill
                    tone={
                      draftDuplicateImeis.length || draftDuplicateSerials.length
                        ? "danger"
                        : "success"
                    }
                  >
                    Identifiers
                  </StatusPill>
                )}
              </div>

              <div className="catalog-draft-preview__media">
                {draftImageUrl && draftImageIsValid ? (
                  <img
                    src={draftImageUrl}
                    alt={itemForm.image_alt_text.trim() || draftProductName}
                  />
                ) : (
                  <span>
                    {draftImageUrl
                      ? "Image URL needs http:// or https://"
                      : "Add an image URL if this item should appear with a photo."}
                  </span>
                )}
              </div>

              {draftAttributeEntries.length > 0 && (
                <div className="catalog-draft-preview__attributes">
                  {draftAttributeEntries.slice(0, 8).map(([key, value]) => (
                    <span key={key}>
                      <b>{titleize(key)}</b>
                      {String(value)}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {(selectedKind === "phone" || selectedKind === "laptop") && (
              <div className="identifier-panel">
                <div>
                  <strong>Device identifiers</strong>
                  <span>
                    For true stock control, IMEI/serial numbers are also captured
                    when receiving stock. These fields help staff record what
                    they already have while adding an item.
                  </span>
                </div>
                <div className="form-grid form-grid--two">
                  <label>
                    IMEI number(s)
                    <textarea
                      value={itemForm.imei_numbers}
                      onChange={(event) =>
                        setItemForm((current) => ({
                          ...current,
                          imei_numbers: event.target.value,
                        }))
                      }
                      placeholder="One IMEI per line"
                    />
                  </label>
                  <label>
                    Serial number(s)
                    <textarea
                      value={itemForm.serial_numbers}
                      onChange={(event) =>
                        setItemForm((current) => ({
                          ...current,
                          serial_numbers: event.target.value,
                        }))
                      }
                      placeholder="One serial per line"
                    />
                  </label>
                </div>
              </div>
            )}

            <div className="form-footer">
              <button className="primary-button" disabled={busy}>
                Add Item
              </button>
            </div>
          </form>
        </section>

        <div className="catalog-lower-grid">
          <section className="panel-card">
            <header className="panel-card__header panel-card__header--compact">
              <div>
                <p className="eyebrow">Selected item</p>
                <h2>{selectedProduct?.name ?? "No item selected"}</h2>
              </div>
            </header>

            <div className="ticket-action-panel ticket-action-panel--compact">
              {selectedProduct ? (
                <>
                  <div className="selected-ticket-card">
                    <strong>{selectedProduct.name}</strong>
                    <span>
                      {categoryById.get(selectedProduct.category_id ?? "") ?? "No category"} |{" "}
                      {brandById.get(selectedProduct.brand_id ?? "") ?? "No brand"} |{" "}
                      {integer(selectedProduct.warranty_months)} warranty months
                    </span>
                    <div className="table-actions">
                      <StatusPill tone={toneForStatus(selectedProduct.is_active)}>
                        {selectedProduct.is_active ? "Available" : "Inactive"}
                      </StatusPill>
                      <StatusPill tone={toneForStatus(selectedProduct.is_published)}>
                        {selectedProduct.is_published ? "On website" : "Not on website"}
                      </StatusPill>
                    </div>
                  </div>

                  {selectedProduct.images[0] && (
                    <div className="catalog-image-preview">
                      <img
                        src={selectedProduct.images[0].url}
                        alt={selectedProduct.images[0].alt_text ?? selectedProduct.name}
                      />
                      <div>
                        <strong>Primary image</strong>
                        <span>{selectedProduct.images[0].alt_text ?? selectedProduct.name}</span>
                      </div>
                    </div>
                  )}

                  {selectedVariant && (
                    <div className="catalog-detail-grid">
                      <div>
                        <span>Selected SKU</span>
                        <strong>{selectedVariant.sku}</strong>
                      </div>
                      <div>
                        <span>Option</span>
                        <strong>{selectedVariant.name}</strong>
                      </div>
                      <div>
                        <span>Tracking</span>
                        <strong>{titleize(selectedVariant.tracking_type)}</strong>
                      </div>
                      <div>
                        <span>Selling price</span>
                        <strong>{money(selectedVariant.selling_price)}</strong>
                      </div>
                    </div>
                  )}

                  <div className="catalog-readiness-card">
                    <div>
                      <strong>POS readiness</strong>
                      <span>
                        Catalog setup defines the SKU. Stock still has to be received
                        through purchases/inventory before POS can sell it.
                      </span>
                    </div>
                    <div className="table-actions">
                      {selectedReadiness.map((check) => (
                        <StatusPill key={check.label} tone={check.ok ? "success" : "warning"}>
                          {check.label}
                        </StatusPill>
                      ))}
                    </div>
                  </div>

                  {selectedVariantAttributes.length > 0 && (
                    <div className="catalog-attributes-card">
                      <strong>Saved item details</strong>
                      <div>
                        {selectedVariantAttributes.map(([key, value]) => (
                          <span key={key}>
                            <b>{titleize(key)}</b>
                            {String(value)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <form className="action-form action-form--compact" onSubmit={handleUpdateProductDetails}>
                    <label>Edit main item details</label>
                    <div className="form-grid form-grid--two">
                      <label>
                        Item name
                        <input
                          value={productEditForm.name}
                          onChange={(event) =>
                            setProductEditForm((current) => ({
                              ...current,
                              name: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label>
                        Warranty months
                        <input
                          type="number"
                          min="0"
                          max="120"
                          value={productEditForm.warranty_months}
                          onChange={(event) =>
                            setProductEditForm((current) => ({
                              ...current,
                              warranty_months: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label>
                        Category
                        <select
                          value={productEditForm.category_id}
                          onChange={(event) =>
                            setProductEditForm((current) => ({
                              ...current,
                              category_id: event.target.value,
                            }))
                          }
                        >
                          <option value="">No category</option>
                          {categories.map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Brand
                        <select
                          value={productEditForm.brand_id}
                          onChange={(event) =>
                            setProductEditForm((current) => ({
                              ...current,
                              brand_id: event.target.value,
                            }))
                          }
                        >
                          <option value="">No brand</option>
                          {brands.map((brand) => (
                            <option key={brand.id} value={brand.id}>
                              {brand.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label>
                      Description
                      <textarea
                        value={productEditForm.description}
                        onChange={(event) =>
                          setProductEditForm((current) => ({
                            ...current,
                            description: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <button className="secondary-button" disabled={busy}>
                      Save Item Details
                    </button>
                  </form>

                  <div className="action-form action-form--compact">
                    <label>Item controls</label>
                    <div className="table-actions">
                      <button
                        className="secondary-button"
                        disabled={busy}
                        onClick={() => void handleTogglePublication()}
                        type="button"
                      >
                        {selectedProduct.is_published ? "Hide from Website" : "Show on Website"}
                      </button>
                      <button
                        className="secondary-button"
                        disabled={busy}
                        onClick={() => void handleToggleActive()}
                        type="button"
                      >
                        {selectedProduct.is_active ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  </div>

                  <form className="action-form action-form--compact" onSubmit={handleCreateVariant}>
                    <label>Add another option/SKU</label>
                    <div className="form-grid form-grid--two">
                      <label>
                        Option name
                        <input
                          value={variantForm.name}
                          onChange={(event) =>
                            setVariantForm((current) => ({
                              ...current,
                              name: event.target.value,
                            }))
                          }
                          placeholder="8GB / 256GB, Black"
                        />
                      </label>
                      <label>
                        SKU
                        <input
                          value={variantForm.sku}
                          onChange={(event) =>
                            setVariantForm((current) => ({
                              ...current,
                              sku: event.target.value.toUpperCase(),
                            }))
                          }
                        />
                      </label>
                      <label>
                        Tracking
                        <select
                          value={variantForm.tracking_type}
                          onChange={(event) =>
                            setVariantForm((current) => ({
                              ...current,
                              tracking_type: event.target.value as TrackingType,
                            }))
                          }
                        >
                          <option value="bulk">Quantity only</option>
                          <option value="serial">Serial number</option>
                          <option value="imei">IMEI</option>
                        </select>
                      </label>
                      <label>
                        Selling
                        <input
                          type="number"
                          min="0"
                          value={variantForm.selling_price}
                          onChange={(event) =>
                            setVariantForm((current) => ({
                              ...current,
                              selling_price: event.target.value,
                            }))
                          }
                        />
                      </label>
                    </div>
                    <button className="secondary-button" disabled={busy}>
                      Add Option
                    </button>
                  </form>

                  <form className="action-form action-form--compact" onSubmit={handleUpdateVariant}>
                    <label>
                      Edit selected option/SKU
                      <select
                        value={selectedVariantId}
                        onChange={(event) => setSelectedVariantId(event.target.value)}
                      >
                        {selectedProduct.variants.map((variant) => (
                          <option key={variant.id} value={variant.id}>
                            {variant.sku} / {variant.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="form-grid form-grid--two">
                      <label>
                        Name
                        <input
                          value={priceForm.name}
                          onChange={(event) =>
                            setPriceForm((current) => ({
                              ...current,
                              name: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label>
                        Selling price
                        <input
                          type="number"
                          min="0"
                          value={priceForm.selling_price}
                          onChange={(event) =>
                            setPriceForm((current) => ({
                              ...current,
                              selling_price: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label>
                        Barcode
                        <input
                          value={priceForm.barcode}
                          onChange={(event) =>
                            setPriceForm((current) => ({
                              ...current,
                              barcode: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label>
                        Status
                        <select
                          value={priceForm.is_active ? "true" : "false"}
                          onChange={(event) =>
                            setPriceForm((current) => ({
                              ...current,
                              is_active: event.target.value === "true",
                            }))
                          }
                        >
                          <option value="true">Available</option>
                          <option value="false">Inactive</option>
                        </select>
                      </label>
                    </div>
                    <button className="secondary-button" disabled={busy}>
                      Save Option
                    </button>
                  </form>

                  <form className="action-form action-form--compact" onSubmit={handleCreateImage}>
                    <label>Add item image URL</label>
                    <div className="form-grid form-grid--two">
                      <label>
                        URL
                        <input
                          value={imageForm.url}
                          onChange={(event) =>
                            setImageForm((current) => ({
                              ...current,
                              url: event.target.value,
                            }))
                          }
                          placeholder="https://..."
                        />
                      </label>
                      <label>
                        Alt text
                        <input
                          value={imageForm.alt_text}
                          onChange={(event) =>
                            setImageForm((current) => ({
                              ...current,
                              alt_text: event.target.value,
                            }))
                          }
                        />
                      </label>
                    </div>
                    <button className="secondary-button" disabled={busy}>
                      Add Image
                    </button>
                  </form>
                </>
              ) : (
                <p className="muted">Select an item from the catalog table.</p>
              )}
            </div>
          </section>

          <section className="panel-card">
            <header className="panel-card__header panel-card__header--compact">
              <div>
                <p className="eyebrow">Quick setup</p>
                <h2>Category / brand</h2>
              </div>
            </header>

            <form className="form-panel form-panel--compact" onSubmit={handleCreateCategory}>
              <strong>New category</strong>
              <div className="form-grid form-grid--two">
                <label>
                  Name
                  <input
                    value={categoryForm.name}
                    onChange={(event) =>
                      setCategoryForm((current) => ({
                        ...current,
                        name: event.target.value,
                        slug: current.slug || slugify(event.target.value),
                      }))
                    }
                  />
                </label>
                <label>
                  Slug
                  <input
                    value={categoryForm.slug}
                    onChange={(event) =>
                      setCategoryForm((current) => ({
                        ...current,
                        slug: slugify(event.target.value),
                      }))
                    }
                  />
                </label>
              </div>
              <div className="form-footer">
                <button className="secondary-button" disabled={busy}>
                  Add Category
                </button>
              </div>
            </form>

            <form className="form-panel form-panel--compact form-panel--bordered" onSubmit={handleCreateBrand}>
              <strong>New brand</strong>
              <div className="form-grid form-grid--two">
                <label>
                  Name
                  <input
                    value={brandForm.name}
                    onChange={(event) =>
                      setBrandForm((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  Description
                  <input
                    value={brandForm.description}
                    onChange={(event) =>
                      setBrandForm((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>
              <div className="form-footer">
                <button className="secondary-button" disabled={busy}>
                  Add Brand
                </button>
              </div>
            </form>
          </section>
        </div>
      </div>

      <div className="catalog-tables m-t">
        <section className="panel-card">
          <header className="panel-card__header panel-card__header--compact">
            <div>
              <p className="eyebrow">Items</p>
              <h2>Catalog records</h2>
            </div>
          </header>
          <table className="data-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Category</th>
                <th>Brand</th>
                <th>Options</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.length
                ? filteredProducts.map((product) => (
                    <tr
                      key={product.id}
                      className={selectedProduct?.id === product.id ? "is-selected" : ""}
                      onClick={() => {
                        setSelectedProductId(product.id);
                        setSelectedVariantId(product.variants[0]?.id ?? "");
                      }}
                    >
                      <td>{product.name}</td>
                      <td>{categoryById.get(product.category_id ?? "") ?? "-"}</td>
                      <td>{brandById.get(product.brand_id ?? "") ?? "-"}</td>
                      <td>{integer(product.variants.length)}</td>
                      <td>
                        <div className="table-actions">
                          <StatusPill tone={toneForStatus(product.is_active)}>
                            {product.is_active ? "Available" : "Inactive"}
                          </StatusPill>
                          <StatusPill tone={toneForStatus(product.is_published)}>
                            {product.is_published ? "Website" : "Internal"}
                          </StatusPill>
                        </div>
                      </td>
                    </tr>
                  ))
                : emptyTableRow(5, "No catalog items match the current filters.")}
            </tbody>
          </table>
        </section>

        <section className="panel-card">
          <header className="panel-card__header panel-card__header--compact">
            <div>
              <p className="eyebrow">Options/SKUs</p>
              <h2>Price list</h2>
            </div>
          </header>
          <table className="data-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Item</th>
                <th>Option</th>
                <th>Tracking</th>
                <th>Price</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredVariantRows.length
                ? filteredVariantRows.map(({ product, variant }) => (
                  <tr
                    key={variant.id}
                    className={selectedVariant?.id === variant.id ? "is-selected" : ""}
                    onClick={() => {
                      setSelectedProductId(product.id);
                      setSelectedVariantId(variant.id);
                    }}
                  >
                    <td>{variant.sku}</td>
                    <td>{product.name}</td>
                    <td>{variant.name}</td>
                    <td>{titleize(variant.tracking_type)}</td>
                    <td>{money(variant.selling_price)}</td>
                    <td>
                      <StatusPill tone={toneForStatus(variant.is_active)}>
                        {variant.is_active ? "Available" : "Inactive"}
                      </StatusPill>
                    </td>
                  </tr>
                ))
                : emptyTableRow(6, "No SKU/options match the current filters.")}
            </tbody>
          </table>
        </section>
      </div>
    </section>
  );
}
