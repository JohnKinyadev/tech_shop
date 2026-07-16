import type {
  ApprovalDecisionPayload,
  ApprovalRequest,
  AssignableRole,
  Brand,
  BrandCreatePayload,
  Branch,
  CatalogProduct,
  Category,
  CategoryCreatePayload,
  CurrentUser,
  Customer,
  CustomerCreatePayload,
  DashboardSummary,
  ExpenseSummary,
  GoodsReceipt,
  GoodsReceiptPayload,
  InventoryBalance,
  Page,
  Payment,
  Product,
  ProductCreatePayload,
  ProductImage,
  ProductImageCreatePayload,
  ProductUpdatePayload,
  PosSale,
  PosSaleCreatePayload,
  ProductVariant,
  ProductVariantCreatePayload,
  ProductVariantUpdatePayload,
  PurchaseOrder,
  Receipt,
  PurchaseOrderCreatePayload,
  RepairAssignmentPayload,
  RepairBookingPayload,
  RepairStatusPayload,
  SalePaymentPayload,
  SerializedUnit,
  RepairTicket,
  StaffUserCreatePayload,
  StaffUserUpdatePayload,
  StaffUser,
  StockAdjustmentPayload,
  StockCount,
  StockCountItemUpdatePayload,
  StockCountPayload,
  StockMovement,
  StockTransfer,
  StockTransferPayload,
  Supplier,
  SupplierCreatePayload,
  Till,
  TillSession,
  TillSessionClosePayload,
  TillSessionOpenPayload,
  TokenPair,
} from "./types";

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000/api/v1/staff";

type RequestOptions = {
  token?: string | null;
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

function buildUrl(path: string, query?: RequestOptions["query"]) {
  const url = new URL(`${API_BASE_URL}${path}`);
  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  return url;
}

export async function apiRequest<T>(
  path: string,
  { token, method = "GET", body, query }: RequestOptions = {},
): Promise<T> {
  const response = await fetch(buildUrl(path, query), {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const detail = payload?.detail;
    const message =
      typeof detail === "string"
        ? detail
        : `Request failed with HTTP ${response.status}`;
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export function login(username: string, password: string) {
  return apiRequest<TokenPair>("/auth/login", {
    method: "POST",
    body: { username, password },
  });
}

export function currentUser(token: string) {
  return apiRequest<CurrentUser>("/auth/me", { token });
}

type CatalogProductOptions = {
  isActive?: boolean | null;
  isPublished?: boolean | null;
  pageSize?: number;
};

export function listCatalogProducts(
  token: string,
  query: string,
  options: CatalogProductOptions = {},
) {
  return apiRequest<Page<CatalogProduct>>("/catalog/products", {
    token,
    query: {
      q: query,
      page: 1,
      page_size: options.pageSize ?? 48,
      is_active: options.isActive === undefined ? true : options.isActive,
      is_published:
        options.isPublished === undefined ? true : options.isPublished,
    },
  });
}

export function listCategories(token: string) {
  return apiRequest<Category[]>("/catalog/categories", { token });
}

export function createCategory(token: string, body: CategoryCreatePayload) {
  return apiRequest<Category>("/catalog/categories", {
    token,
    method: "POST",
    body,
  });
}

export function listBrands(token: string) {
  return apiRequest<Brand[]>("/catalog/brands", { token });
}

export function createBrand(token: string, body: BrandCreatePayload) {
  return apiRequest<Brand>("/catalog/brands", {
    token,
    method: "POST",
    body,
  });
}

export function createCatalogProduct(token: string, body: ProductCreatePayload) {
  return apiRequest<Product>("/catalog/products", {
    token,
    method: "POST",
    body,
  });
}

export function updateCatalogProduct(
  token: string,
  productId: string,
  body: ProductUpdatePayload,
) {
  return apiRequest<Product>(`/catalog/products/${productId}`, {
    token,
    method: "PATCH",
    body,
  });
}

export function setProductPublication(
  token: string,
  productId: string,
  isPublished: boolean,
) {
  return apiRequest<Product>(`/catalog/products/${productId}/publication`, {
    token,
    method: "PATCH",
    body: { is_published: isPublished },
  });
}

export function createProductVariant(
  token: string,
  productId: string,
  body: ProductVariantCreatePayload,
) {
  return apiRequest<ProductVariant>(`/catalog/products/${productId}/variants`, {
    token,
    method: "POST",
    body,
  });
}

export function updateProductVariant(
  token: string,
  variantId: string,
  body: ProductVariantUpdatePayload,
) {
  return apiRequest<ProductVariant>(`/catalog/variants/${variantId}`, {
    token,
    method: "PATCH",
    body,
  });
}

export function createProductImage(
  token: string,
  productId: string,
  body: ProductImageCreatePayload,
) {
  return apiRequest<ProductImage>(`/catalog/products/${productId}/images`, {
    token,
    method: "POST",
    body,
  });
}

export function currentTillSession(token: string) {
  return apiRequest<TillSession>("/pos/till-sessions/current", { token });
}

export function listTills(token: string, branchId: string) {
  return apiRequest<Till[]>("/pos/tills", {
    token,
    query: { branch_id: branchId },
  });
}

export function openTillSession(token: string, body: TillSessionOpenPayload) {
  return apiRequest<TillSession>("/pos/till-sessions/open", {
    token,
    method: "POST",
    body,
  });
}

export function closeTillSession(
  token: string,
  sessionId: string,
  body: TillSessionClosePayload,
) {
  return apiRequest<TillSession>(`/pos/till-sessions/${sessionId}/close`, {
    token,
    method: "POST",
    body,
  });
}

export function createPosSale(token: string, body: PosSaleCreatePayload) {
  return apiRequest<PosSale>("/pos/sales", {
    token,
    method: "POST",
    body,
  });
}

export function addSalePayment(
  token: string,
  saleId: string,
  body: SalePaymentPayload,
) {
  return apiRequest<Payment>(`/pos/sales/${saleId}/payments`, {
    token,
    method: "POST",
    body,
  });
}

export function getSaleReceipt(token: string, saleId: string) {
  return apiRequest<Receipt>(`/pos/sales/${saleId}/receipt`, { token });
}

export function listPosSales(token: string, branchId: string) {
  return apiRequest<Page<PosSale>>("/pos/sales", {
    token,
    query: { branch_id: branchId, page: 1, page_size: 12 },
  });
}

export function listBranches(token: string) {
  return apiRequest<Branch[]>("/branches", { token });
}

export function listCustomers(token: string, query = "") {
  return apiRequest<Customer[]>("/pos/customers", {
    token,
    query: { query: query || undefined, limit: 100 },
  });
}

export function createCustomer(token: string, body: CustomerCreatePayload) {
  return apiRequest<Customer>("/pos/customers", {
    token,
    method: "POST",
    body,
  });
}

export function dashboardSummary(token: string) {
  return apiRequest<DashboardSummary>("/reports/dashboard", { token });
}

type ReportQueryOptions = {
  branchId?: string;
  startAt?: string | null;
  endAt?: string | null;
  topLimit?: number;
};

function reportQuery(options: ReportQueryOptions = {}) {
  return {
    branch_id: options.branchId,
    start_at: options.startAt,
    end_at: options.endAt,
    top_limit: options.topLimit,
  };
}

export function inventorySummary(token: string, options: ReportQueryOptions = {}) {
  return apiRequest<DashboardSummary["inventory"]>("/reports/inventory", {
    token,
    query: { branch_id: options.branchId },
  });
}

export function repairSummary(token: string, options: ReportQueryOptions = {}) {
  return apiRequest<DashboardSummary["repairs"]>("/reports/repairs", {
    token,
    query: reportQuery(options),
  });
}

export function salesSummary(token: string, options: ReportQueryOptions = {}) {
  return apiRequest<DashboardSummary["sales"]>("/reports/sales", {
    token,
    query: reportQuery(options),
  });
}

export function expenseSummary(token: string, options: ReportQueryOptions = {}) {
  return apiRequest<ExpenseSummary>("/reports/expenses", {
    token,
    query: reportQuery(options),
  });
}

export function listInventoryBalances(
  token: string,
  branchId: string,
  query = "",
) {
  return apiRequest<Page<InventoryBalance>>("/inventory/balances", {
    token,
    query: { branch_id: branchId, query: query || undefined, page: 1, page_size: 50 },
  });
}

export function listSerializedUnits(
  token: string,
  branchId: string,
  query = "",
) {
  return apiRequest<Page<SerializedUnit>>("/inventory/serialized-units", {
    token,
    query: {
      branch_id: branchId,
      query: query || undefined,
      status: "available",
      page: 1,
      page_size: 100,
    },
  });
}

export function listStockMovements(token: string, branchId: string) {
  return apiRequest<Page<StockMovement>>("/inventory/movements", {
    token,
    query: { branch_id: branchId, page: 1, page_size: 12 },
  });
}

export function listAdjustmentRequests(token: string, branchId: string) {
  return apiRequest<ApprovalRequest[]>("/inventory/adjustment-requests", {
    token,
    query: { branch_id: branchId },
  });
}

export function requestStockAdjustment(
  token: string,
  body: StockAdjustmentPayload,
) {
  return apiRequest<ApprovalRequest>("/inventory/adjustment-requests", {
    token,
    method: "POST",
    body,
  });
}

export function decideAdjustmentRequest(
  token: string,
  requestId: string,
  body: ApprovalDecisionPayload,
) {
  return apiRequest<ApprovalRequest>(
    `/inventory/adjustment-requests/${requestId}/decision`,
    {
      token,
      method: "POST",
      body,
    },
  );
}

export function listStockTransfers(token: string, branchId: string) {
  return apiRequest<StockTransfer[]>("/inventory/transfers", {
    token,
    query: { branch_id: branchId },
  });
}

export function createStockTransfer(token: string, body: StockTransferPayload) {
  return apiRequest<StockTransfer>("/inventory/transfers", {
    token,
    method: "POST",
    body,
  });
}

export function approveStockTransfer(token: string, transferId: string) {
  return apiRequest<StockTransfer>(`/inventory/transfers/${transferId}/approve`, {
    token,
    method: "POST",
  });
}

export function dispatchStockTransfer(token: string, transferId: string) {
  return apiRequest<StockTransfer>(`/inventory/transfers/${transferId}/dispatch`, {
    token,
    method: "POST",
  });
}

export function receiveStockTransfer(token: string, transferId: string) {
  return apiRequest<StockTransfer>(`/inventory/transfers/${transferId}/receive`, {
    token,
    method: "POST",
  });
}

export function cancelStockTransfer(token: string, transferId: string) {
  return apiRequest<StockTransfer>(`/inventory/transfers/${transferId}/cancel`, {
    token,
    method: "POST",
  });
}

export function listStockCounts(token: string, branchId: string) {
  return apiRequest<StockCount[]>("/inventory/stock-counts", {
    token,
    query: { branch_id: branchId },
  });
}

export function createStockCount(token: string, body: StockCountPayload) {
  return apiRequest<StockCount>("/inventory/stock-counts", {
    token,
    method: "POST",
    body,
  });
}

export function updateStockCountItem(
  token: string,
  countId: string,
  itemId: string,
  body: StockCountItemUpdatePayload,
) {
  return apiRequest<StockCount>(
    `/inventory/stock-counts/${countId}/items/${itemId}`,
    {
      token,
      method: "PATCH",
      body,
    },
  );
}

export function submitStockCount(token: string, countId: string) {
  return apiRequest<StockCount>(`/inventory/stock-counts/${countId}/submit`, {
    token,
    method: "POST",
  });
}

export function approveStockCount(token: string, countId: string) {
  return apiRequest<StockCount>(`/inventory/stock-counts/${countId}/approve`, {
    token,
    method: "POST",
  });
}

export function cancelStockCount(token: string, countId: string) {
  return apiRequest<StockCount>(`/inventory/stock-counts/${countId}/cancel`, {
    token,
    method: "POST",
  });
}

export function listRepairs(token: string, branchId: string) {
  return apiRequest<Page<RepairTicket>>("/repairs", {
    token,
    query: { branch_id: branchId, page: 1, page_size: 50 },
  });
}

export function createRepairBooking(token: string, body: RepairBookingPayload) {
  return apiRequest<RepairTicket>("/repairs", {
    token,
    method: "POST",
    body,
  });
}

export function assignRepairTechnician(
  token: string,
  ticketId: string,
  body: RepairAssignmentPayload,
) {
  return apiRequest<RepairTicket>(`/repairs/${ticketId}/assignment`, {
    token,
    method: "PATCH",
    body,
  });
}

export function updateRepairStatus(
  token: string,
  ticketId: string,
  body: RepairStatusPayload,
) {
  return apiRequest<RepairTicket>(`/repairs/${ticketId}/status`, {
    token,
    method: "POST",
    body,
  });
}

export function listPurchaseOrders(token: string) {
  return apiRequest<Page<PurchaseOrder>>("/purchases", {
    token,
    query: { page: 1, page_size: 50 },
  });
}

export function listSuppliers(token: string) {
  return apiRequest<Supplier[]>("/suppliers", { token });
}

export function createSupplier(token: string, body: SupplierCreatePayload) {
  return apiRequest<Supplier>("/suppliers", {
    token,
    method: "POST",
    body,
  });
}

export function createPurchaseOrder(
  token: string,
  body: PurchaseOrderCreatePayload,
) {
  return apiRequest<PurchaseOrder>("/purchases", {
    token,
    method: "POST",
    body,
  });
}

export function submitPurchaseOrder(token: string, orderId: string) {
  return apiRequest<PurchaseOrder>(`/purchases/${orderId}/submit`, {
    token,
    method: "POST",
  });
}

export function approvePurchaseOrder(token: string, orderId: string) {
  return apiRequest<PurchaseOrder>(`/purchases/${orderId}/approve`, {
    token,
    method: "POST",
  });
}

export function receivePurchaseOrder(
  token: string,
  orderId: string,
  body: GoodsReceiptPayload,
) {
  return apiRequest<GoodsReceipt>(`/purchases/${orderId}/receipts`, {
    token,
    method: "POST",
    body,
  });
}

export function listStaffUsers(token: string) {
  return apiRequest<StaffUser[]>("/users", { token });
}

export function createStaffUser(token: string, body: StaffUserCreatePayload) {
  return apiRequest<StaffUser>("/users", {
    token,
    method: "POST",
    body,
  });
}

export function updateStaffUser(
  token: string,
  userId: string,
  body: StaffUserUpdatePayload,
) {
  return apiRequest<StaffUser>(`/users/${userId}`, {
    token,
    method: "PATCH",
    body,
  });
}

export function listAssignableRoles(token: string) {
  return apiRequest<AssignableRole[]>("/roles", { token });
}
