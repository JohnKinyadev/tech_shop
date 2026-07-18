export type UUID = string;

export type CurrentUser = {
  id: UUID;
  full_name: string;
  username: string;
  email: string;
  branch_id: UUID | null;
  role_code: string;
  role_name: string;
  permissions: string[];
  must_change_password: boolean;
};

export type TokenPair = {
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
  expires_in: number;
};

export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  page_size: number;
};

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

export type ModelResponse = {
  id: UUID;
  created_at: string;
  updated_at: string;
  is_deleted: boolean;
};

export type CatalogVariant = {
  id: UUID;
  product_id: UUID;
  name: string;
  sku: string;
  barcode: string | null;
  tracking_type: "bulk" | "serial" | "imei";
  attributes: Record<string, string>;
  selling_price: string;
  is_active: boolean;
};

export type ProductVariant = CatalogVariant & {
  cost_price: string;
  minimum_selling_price: string | null;
};

export type ProductImage = {
  id: UUID;
  product_id?: UUID;
  url: string;
  alt_text: string | null;
  position: number;
};

export type CatalogProduct = ModelResponse & {
  id: UUID;
  name: string;
  slug: string;
  description: string | null;
  category_id: UUID | null;
  brand_id: UUID | null;
  warranty_months: number;
  is_active: boolean;
  is_published: boolean;
  variants: CatalogVariant[];
  images: ProductImage[];
};

export type Product = Omit<CatalogProduct, "variants"> & {
  variants: ProductVariant[];
};

export type Category = ModelResponse & {
  parent_id: UUID | null;
  name: string;
  slug: string;
  description: string | null;
  is_active: boolean;
};

export type Brand = ModelResponse & {
  name: string;
  description: string | null;
  is_active: boolean;
};

export type CategoryCreatePayload = {
  parent_id?: UUID | null;
  name: string;
  slug: string;
  description?: string | null;
};

export type BrandCreatePayload = {
  name: string;
  description?: string | null;
};

export type ProductVariantCreatePayload = {
  name: string;
  sku: string;
  barcode?: string | null;
  tracking_type: "bulk" | "serial" | "imei";
  attributes?: Record<string, string>;
  cost_price: string | number;
  selling_price: string | number;
  minimum_selling_price?: string | number | null;
};

export type ProductCreatePayload = {
  name: string;
  slug: string;
  description?: string | null;
  category_id?: UUID | null;
  brand_id?: UUID | null;
  warranty_months: number;
  variants: ProductVariantCreatePayload[];
};

export type ProductUpdatePayload = {
  name?: string;
  description?: string | null;
  category_id?: UUID | null;
  brand_id?: UUID | null;
  warranty_months?: number;
  is_active?: boolean;
};

export type ProductVariantUpdatePayload = {
  name?: string;
  barcode?: string | null;
  attributes?: Record<string, string>;
  cost_price?: string | number;
  selling_price?: string | number;
  minimum_selling_price?: string | number | null;
  is_active?: boolean;
};

export type ProductImageCreatePayload = {
  url: string;
  alt_text?: string | null;
  position?: number;
};

export type TillSession = {
  id: UUID;
  till_id: UUID;
  cashier_id: UUID;
  status: "open" | "closed";
  opened_at: string;
  closed_at: string | null;
  opening_float: string;
  expected_cash: string | null;
  closing_cash: string | null;
};

export type Till = ModelResponse & {
  branch_id: UUID;
  name: string;
  code: string;
  is_active: boolean;
};

export type TillCreatePayload = {
  branch_id: UUID;
  name: string;
  code: string;
};

export type TillUpdatePayload = {
  name?: string;
  is_active?: boolean;
};

export type TillSessionOpenPayload = {
  till_id: UUID;
  opening_float: string | number;
};

export type TillSessionClosePayload = {
  closing_cash: string | number;
};

export type SerializedUnit = {
  id: UUID;
  branch_id: UUID;
  product_id: UUID;
  product_name: string;
  variant_id: UUID;
  variant_name: string;
  sku: string;
  serial_number: string | null;
  imei: string | null;
  status: string;
  condition: string;
  received_at: string;
};

export type PosSaleItemCreatePayload = {
  variant_id: UUID;
  serialized_unit_id?: UUID | null;
  quantity: number;
  discount_amount?: string | number;
};

export type PosSaleCreatePayload = {
  branch_id: UUID;
  customer_id?: UUID | null;
  till_session_id: UUID;
  channel: "pos";
  notes?: string | null;
  items: PosSaleItemCreatePayload[];
};

export type PosSaleItem = ModelResponse & {
  sale_id: UUID;
  variant_id: UUID;
  serialized_unit_id: UUID | null;
  description: string;
  quantity: number;
  unit_price: string;
  discount_amount: string;
  tax_amount: string;
  line_total: string;
};

export type PosSale = ModelResponse & {
  branch_id: UUID;
  customer_id: UUID | null;
  cashier_id: UUID | null;
  till_session_id: UUID | null;
  invoice_number: string;
  channel: "pos" | "online" | "repair";
  status: string;
  fulfillment_status: string;
  subtotal: string;
  tax_amount: string;
  discount_amount: string;
  total_amount: string;
  paid_amount: string;
  notes: string | null;
  completed_at: string | null;
  items: PosSaleItem[];
};

export type SalePaymentPayload = {
  method: "cash" | "mpesa" | "card" | "bank_transfer" | "store_credit";
  amount: string | number;
  provider_reference?: string | null;
  idempotency_key: string;
  notes?: string | null;
};

export type FailedPaymentAttemptPayload = {
  method: "mpesa" | "card" | "bank_transfer" | "store_credit";
  amount: string | number;
  status: "failed" | "cancelled";
  provider_reference?: string | null;
  idempotency_key: string;
  notes?: string | null;
};

export type PaymentAttemptOutcomePayload = {
  status: "failed" | "cancelled";
  notes?: string | null;
};

export type MpesaStkPushPayload = {
  phone_number: string;
  amount: string | number;
  idempotency_key: string;
  notes?: string | null;
};

export type MpesaManualConfirmPayload = {
  provider_reference: string;
  notes?: string | null;
};

export type Payment = ModelResponse & {
  branch_id: UUID;
  sale_id: UUID | null;
  till_session_id: UUID | null;
  repair_ticket_id: UUID | null;
  purchase_order_id: UUID | null;
  direction: string;
  method: string;
  status: string;
  amount: string;
  currency: string;
  provider_reference: string | null;
  paid_at: string | null;
  notes: string | null;
};

export type MpesaStkPushResponse = {
  payment: Payment;
  merchant_request_id: string;
  checkout_request_id: string;
  customer_message: string;
};

export type MpesaStkQueryResponse = {
  payment: Payment;
  checkout_request_id: string;
  result_code: number | null;
  result_description: string;
  customer_message: string;
};

export type Receipt = {
  invoice_number: string;
  sale_status: string;
  branch_name: string;
  branch_code: string;
  branch_address: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  cashier_name: string | null;
  items: PosSaleItem[];
  payments: Array<{
    method: string;
    amount: string;
    provider_reference: string | null;
    paid_at: string | null;
  }>;
  subtotal: string;
  tax_amount: string;
  discount_amount: string;
  total_amount: string;
  paid_amount: string;
  completed_at: string | null;
};

export type PosProduct = {
  id: UUID;
  variantId: UUID;
  name: string;
  variantName: string;
  sku: string;
  category: string;
  price: number;
  trackingType: "bulk" | "serial" | "imei";
  stockHint: string;
  accent: string;
};

export type SalesSummary = {
  sale_count: number;
  item_count: number;
  gross_sales: string;
  paid_amount: string;
  discount_amount: string;
  refund_amount: string;
  net_sales: string;
  average_sale: string;
  payments: Array<{
    method: string;
    transaction_count: number;
    amount: string;
  }>;
  top_items: Array<{
    sku: string;
    product_name: string;
    variant_name: string;
    quantity_sold: number;
    revenue: string;
    gross_profit: string;
  }>;
};

export type InventorySummary = {
  stock_balance_count: number;
  total_on_hand: number;
  total_reserved: number;
  total_available: number;
  stock_value: string;
  low_stock_count: number;
  low_stock_items: Array<{
    sku: string;
    product_name: string;
    variant_name: string;
    quantity_on_hand: number;
    reserved_quantity: number;
    available_quantity: number;
    reorder_level: number;
    stock_value: string;
  }>;
};

export type RepairSummary = {
  ticket_count: number;
  open_ticket_count: number;
  ready_ticket_count: number;
  collected_ticket_count: number;
  cancelled_ticket_count: number;
  labor_estimate_total: string;
  parts_revenue_total: string;
  payment_total: string;
  status_breakdown: Array<{
    status: string;
    ticket_count: number;
  }>;
};

export type ExpenseSummary = {
  approved_expense_count: number;
  pending_expense_count: number;
  rejected_expense_count: number;
  cancelled_expense_count: number;
  total_approved_expenses: string;
  by_category: Array<{
    category_name: string;
    expense_count: number;
    amount: string;
  }>;
};

export type ExpenseCategory = ModelResponse & {
  name: string;
  description: string | null;
};

export type ExpenseCategoryCreatePayload = {
  name: string;
  description?: string | null;
};

export type ExpenseCategoryUpdatePayload = {
  name?: string;
  description?: string | null;
};

export type Expense = ModelResponse & {
  branch_id: UUID;
  category_id: UUID;
  submitted_by_id: UUID;
  approved_by_id: UUID | null;
  description: string;
  amount: string;
  payment_method: "cash" | "mpesa" | "card" | "bank_transfer" | "store_credit";
  status: string;
  reference_number: string | null;
  notes: string | null;
};

export type ExpenseCreatePayload = {
  branch_id: UUID;
  category_id: UUID;
  description: string;
  amount: string | number;
  payment_method?: "cash" | "mpesa" | "card" | "bank_transfer" | "store_credit";
  reference_number?: string | null;
  notes?: string | null;
};

export type ExpenseUpdatePayload = {
  category_id?: UUID;
  description?: string;
  amount?: string | number;
  payment_method?: "cash" | "mpesa" | "card" | "bank_transfer" | "store_credit";
  reference_number?: string | null;
  notes?: string | null;
};

export type ExpenseDecisionPayload = {
  notes?: string | null;
};

export type DashboardSummary = {
  sales: SalesSummary;
  inventory: InventorySummary;
  repairs: RepairSummary;
  expenses: ExpenseSummary;
};

export type InventoryBalance = {
  stock_balance_id: UUID;
  branch_id: UUID;
  product_id: UUID;
  product_name: string;
  variant_id: UUID;
  variant_name: string;
  sku: string;
  quantity_on_hand: number;
  reserved_quantity: number;
  available_quantity: number;
  reorder_level: number;
  is_low_stock: boolean;
};

export type StockMovement = ModelResponse & {
  branch_id: UUID;
  variant_id: UUID;
  serialized_unit_id: UUID | null;
  movement_type: string;
  quantity_delta: number;
  unit_cost: string | null;
  reference_type: string;
  reference_id: UUID;
  performed_by_id: UUID;
  note: string | null;
};

export type ApprovalRequest = ModelResponse & {
  branch_id: UUID;
  action: string;
  resource_type: string;
  resource_id: UUID;
  requested_by_id: UUID;
  reviewed_by_id: UUID | null;
  status: string;
  reason: string;
  decision_note: string | null;
  requested_changes: Record<string, unknown> | null;
};

export type StockAdjustmentPayload = {
  branch_id: UUID;
  variant_id: UUID;
  serialized_unit_id?: UUID | null;
  quantity_delta: number;
  reason: string;
};

export type ApprovalDecisionPayload = {
  approved: boolean;
  decision_note?: string | null;
};

export type StockTransfer = ModelResponse & {
  transfer_number: string;
  source_branch_id: UUID;
  destination_branch_id: UUID;
  status: string;
  requested_by_id: UUID;
  approved_by_id: UUID | null;
  dispatched_at: string | null;
  received_at: string | null;
  notes: string | null;
  items: Array<
    ModelResponse & {
      transfer_id: UUID;
      variant_id: UUID;
      serialized_unit_id: UUID | null;
      quantity: number;
    }
  >;
};

export type StockTransferPayload = {
  source_branch_id: UUID;
  destination_branch_id: UUID;
  notes?: string | null;
  items: Array<{
    variant_id: UUID;
    serialized_unit_id?: UUID | null;
    quantity: number;
  }>;
};

export type StockCount = ModelResponse & {
  branch_id: UUID;
  count_number: string;
  status: string;
  created_by_id: UUID;
  approved_by_id: UUID | null;
  submitted_at: string | null;
  approved_at: string | null;
  notes: string | null;
  items: Array<
    ModelResponse & {
      stock_count_id: UUID;
      variant_id: UUID;
      expected_quantity: number;
      counted_quantity: number | null;
      variance: number | null;
      notes: string | null;
    }
  >;
};

export type StockCountPayload = {
  branch_id: UUID;
  variant_ids?: UUID[] | null;
  notes?: string | null;
};

export type StockCountItemUpdatePayload = {
  counted_quantity: number;
  notes?: string | null;
};

export type RepairTicket = ModelResponse & {
  ticket_number: string;
  branch_id: UUID;
  customer_id: UUID;
  technician_id: UUID | null;
  status: string;
  device_type: string;
  device_brand: string;
  device_model: string;
  serial_number: string | null;
  imei: string | null;
  reported_issue: string;
  diagnosis: string | null;
  labor_estimate: string;
  parts_estimate: string;
  booked_for: string | null;
  received_at: string | null;
  ready_at: string | null;
  collected_at: string | null;
};

export type PurchaseOrder = ModelResponse & {
  branch_id: UUID;
  supplier_id: UUID;
  order_number: string;
  supplier_reference: string | null;
  status: string;
  ordered_at: string | null;
  expected_at: string | null;
  subtotal: string;
  tax_amount: string;
  discount_amount: string;
  total_amount: string;
  notes: string | null;
  items: Array<{
    id: UUID;
    variant_id: UUID;
    ordered_quantity: number;
    received_quantity: number;
    unit_cost: string;
    tax_rate: string;
    line_total: string;
  }>;
};

export type Supplier = ModelResponse & {
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  payment_terms_days: number;
  is_active: boolean;
};

export type SupplierCreatePayload = {
  name: string;
  contact_person?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  tax_number?: string | null;
  payment_terms_days?: number;
};

export type PurchaseOrderCreatePayload = {
  branch_id: UUID;
  supplier_id: UUID;
  supplier_reference?: string | null;
  expected_at?: string | null;
  notes?: string | null;
  items: Array<{
    variant_id: UUID;
    ordered_quantity: number;
    unit_cost: string | number;
    tax_rate?: string | number;
  }>;
};

export type GoodsReceiptPayload = {
  supplier_delivery_note?: string | null;
  notes?: string | null;
  items: Array<{
    purchase_order_item_id: UUID;
    quantity: number;
    serial_numbers: string[];
    imeis: string[];
  }>;
};

export type GoodsReceipt = ModelResponse & {
  purchase_order_id: UUID;
  receipt_number: string;
  received_by_id: UUID;
  received_at: string;
  supplier_delivery_note: string | null;
  notes: string | null;
  items: Array<{
    id: UUID;
    receipt_id: UUID;
    purchase_order_item_id: UUID;
    quantity: number;
    unit_cost: string;
  }>;
};

export type StaffUser = ModelResponse & {
  full_name: string;
  username: string;
  email: string;
  phone: string | null;
  branch_id: UUID | null;
  role_id: UUID;
  is_active: boolean;
  is_verified: boolean;
  must_change_password: boolean;
};

export type StaffUserCreatePayload = {
  full_name: string;
  username: string;
  email: string;
  phone?: string | null;
  password: string;
  role_id: UUID;
  branch_id?: UUID | null;
};

export type StaffUserUpdatePayload = {
  full_name?: string;
  email?: string;
  phone?: string | null;
  role_id?: UUID;
  branch_id?: UUID | null;
  is_active?: boolean;
  is_verified?: boolean;
};

export type Permission = ModelResponse & {
  code: string;
  resource: string;
  action: string;
  description: string | null;
};

export type Role = ModelResponse & {
  code: string;
  name: string;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  permissions: Permission[];
};

export type RoleCreatePayload = {
  code: string;
  name: string;
  description?: string | null;
  permission_ids: UUID[];
};

export type RoleUpdatePayload = {
  name?: string;
  description?: string | null;
  permission_ids?: UUID[];
  is_active?: boolean;
};

export type AssignableRole = {
  id: UUID;
  code: string;
  name: string;
  description: string | null;
};

export type Branch = ModelResponse & {
  name: string;
  code: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  country: string;
  is_headquarters: boolean;
  status: string;
};

export type BranchCreatePayload = {
  name: string;
  code: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string;
  is_headquarters?: boolean;
};

export type BranchUpdatePayload = {
  name?: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string;
  status?: string;
};

export type Customer = ModelResponse & {
  full_name: string;
  phone: string;
  email: string | null;
  address: string | null;
  loyalty_points: number;
  credit_limit: string;
  home_branch_id: UUID | null;
  is_active: boolean;
};

export type CustomerCreatePayload = {
  full_name: string;
  phone: string;
  email?: string | null;
  address?: string | null;
  home_branch_id?: UUID | null;
};

export type RepairBookingPayload = {
  branch_id: UUID;
  customer_id: UUID;
  device_type: string;
  device_brand: string;
  device_model: string;
  serial_number?: string | null;
  imei?: string | null;
  reported_issue: string;
  booked_for?: string | null;
};

export type RepairAssignmentPayload = {
  technician_id: UUID;
};

export type RepairStatusPayload = {
  status: string;
  note?: string | null;
};
