import { FormEvent, useEffect, useMemo, useState } from "react";

import {
  addRepairPart,
  addRepairPayment,
  assignRepairTechnician,
  cancelRepair,
  collectRepair,
  createCustomer,
  createRepairBooking,
  currentTillSession,
  decideRepairQuote,
  getRepairInvoice,
  listAssignableRoles,
  listBranches,
  listCatalogProducts,
  listCustomers,
  listRepairs,
  listSerializedUnits,
  listStaffUsers,
  markRepairReady,
  recordRepairIntake,
  repairSummary,
  removeRepairPart,
  submitRepairDiagnosis,
  updateRepairStatus,
} from "../api/client";
import type {
  AssignableRole,
  Branch,
  CatalogProduct,
  Customer,
  RepairInvoice,
  RepairSummary,
  RepairTicket,
  SerializedUnit,
  StaffUser,
  TillSession,
} from "../api/types";
import { StatusPill } from "../components/StatusPill";
import {
  demoBranches,
  demoCustomers,
  demoDashboard,
  demoRepairs,
  demoRoles,
  demoStaffUsers,
} from "../data/demoManagement";
import { mockProducts } from "../data/mockProducts";
import { useAuth } from "../state/auth";
import { dateLabel, integer, money, titleize, toneForStatus } from "../utils/format";

const pipeline = [
  "received",
  "diagnosing",
  "quote_pending",
  "awaiting_parts",
  "repairing",
  "ready_for_pickup",
  "collected",
];

const repairStatuses = [
  "received",
  "diagnosing",
  "quote_pending",
  "customer_approved",
  "awaiting_parts",
  "repairing",
  "ready_for_pickup",
  "collected",
  "cancelled",
];

const emptyTicketForm = {
  customer_id: demoCustomers[0]?.id ?? "",
  device_type: "Phone",
  device_brand: "",
  device_model: "",
  serial_number: "",
  imei: "",
  reported_issue: "",
  intake_condition: "",
  accessories_received: "",
};

const emptyCustomerForm = {
  full_name: "",
  phone: "",
  email: "",
};

type VariantOption = {
  id: string;
  label: string;
  sku: string;
  trackingType: "bulk" | "serial" | "imei";
  price: number;
};

const emptyDiagnosisForm = {
  diagnosis: "",
  labor_estimate: "",
  parts_estimate: "",
};

const emptyPartForm = {
  variant_id: "",
  serialized_unit_id: "",
  quantity: "1",
};

const emptyPaymentForm = {
  method: "cash" as "cash" | "mpesa" | "card" | "bank_transfer" | "store_credit",
  amount: "",
  provider_reference: "",
  notes: "",
};

function splitList(value: string) {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function catalogToVariantOptions(products: CatalogProduct[]): VariantOption[] {
  return products.flatMap((product) =>
    product.variants.map((variant) => ({
      id: variant.id,
      label: `${product.name} / ${variant.name}`,
      sku: variant.sku,
      trackingType: variant.tracking_type,
      price: Number(variant.selling_price),
    })),
  );
}

function repairParts(ticket?: RepairTicket) {
  return ticket?.parts ?? [];
}

export function RepairsPage() {
  const { token, isPreview, user } = useAuth();
  const [branches, setBranches] = useState<Branch[]>(demoBranches);
  const [customers, setCustomers] = useState<Customer[]>(demoCustomers);
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>(demoStaffUsers);
  const [roles, setRoles] = useState<AssignableRole[]>(demoRoles);
  const [tickets, setTickets] = useState<RepairTicket[]>(demoRepairs);
  const [summary, setSummary] = useState<RepairSummary>(demoDashboard.repairs);
  const [catalogProducts, setCatalogProducts] = useState<CatalogProduct[]>([]);
  const [serializedUnits, setSerializedUnits] = useState<SerializedUnit[]>([]);
  const [tillSession, setTillSession] = useState<TillSession | null>(null);
  const [invoice, setInvoice] = useState<RepairInvoice | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState(
    user?.branch_id ?? demoBranches[0]?.id ?? "",
  );
  const [selectedTicketId, setSelectedTicketId] = useState(demoRepairs[0]?.id ?? "");
  const [ticketForm, setTicketForm] = useState(emptyTicketForm);
  const [customerForm, setCustomerForm] = useState(emptyCustomerForm);
  const [selectedTechnicianId, setSelectedTechnicianId] = useState("");
  const [nextStatus, setNextStatus] = useState("diagnosing");
  const [statusNote, setStatusNote] = useState("");
  const [diagnosisForm, setDiagnosisForm] = useState(emptyDiagnosisForm);
  const [quoteNote, setQuoteNote] = useState("");
  const [partSearch, setPartSearch] = useState("");
  const [partForm, setPartForm] = useState(emptyPartForm);
  const [readyNote, setReadyNote] = useState("");
  const [paymentForm, setPaymentForm] = useState(emptyPaymentForm);
  const [ticketSearch, setTicketSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const roleNameById = useMemo(
    () => new Map(roles.map((role) => [role.id, role.name])),
    [roles],
  );

  const technicianOptions = useMemo(() => {
    const technicians = staffUsers.filter((staff) => {
      const roleName = roleNameById.get(staff.role_id)?.toLowerCase() ?? "";
      return roleName.includes("technician") || staff.username.includes("tech");
    });
    return technicians.length ? technicians : staffUsers;
  }, [roleNameById, staffUsers]);

  const selectedTicket = useMemo(
    () => tickets.find((ticket) => ticket.id === selectedTicketId) ?? tickets[0],
    [selectedTicketId, tickets],
  );

  const partVariantOptions = useMemo(() => {
    const variants =
      !token || isPreview
        ? mockProducts.map((product) => ({
            id: product.variantId,
            label: `${product.name} / ${product.variantName}`,
            sku: product.sku,
            trackingType: product.trackingType,
            price: product.price,
          }))
        : catalogToVariantOptions(catalogProducts);
    const needle = partSearch.trim().toLowerCase();
    return variants.filter((variant) =>
      needle
        ? [variant.label, variant.sku, variant.trackingType]
            .join(" ")
            .toLowerCase()
            .includes(needle)
        : true,
    );
  }, [catalogProducts, isPreview, partSearch, token]);

  const selectedPartVariant = useMemo(
    () => partVariantOptions.find((variant) => variant.id === partForm.variant_id),
    [partForm.variant_id, partVariantOptions],
  );

  const serializedPartOptions = useMemo(
    () =>
      serializedUnits.filter(
        (unit) =>
          unit.variant_id === partForm.variant_id && unit.status === "available",
      ),
    [partForm.variant_id, serializedUnits],
  );

  const selectedTicketParts = useMemo(
    () => repairParts(selectedTicket),
    [selectedTicket],
  );

  const derivedInvoice = useMemo(() => {
    if (!selectedTicket) return null;
    if (!invoiceEligible(selectedTicket.status)) return null;
    const labor = Number(selectedTicket.labor_estimate);
    const parts = selectedTicketParts.reduce(
      (sum, part) => sum + Number(part.unit_price) * part.quantity,
      0,
    );
    const estimateParts = Number(selectedTicket.parts_estimate);
    const partsAmount = parts || estimateParts;
    const total = labor + partsAmount;
    return {
      labor,
      parts: partsAmount,
      total,
      paid: invoice ? Number(invoice.paid_amount) : 0,
      due: invoice ? Number(invoice.balance_due) : total,
      status: invoice?.payment_status ?? (total > 0 ? "unpaid" : "not_ready"),
    };
  }, [invoice, selectedTicket, selectedTicketParts]);

  const visibleTickets = useMemo(() => {
    const needle = ticketSearch.trim().toLowerCase();
    return tickets.filter((ticket) => {
      const matchesStatus =
        statusFilter === "all" ? true : ticket.status === statusFilter;
      const matchesSearch = needle
        ? [
            ticket.ticket_number,
            ticket.device_type,
            ticket.device_brand,
            ticket.device_model,
            ticket.reported_issue,
            ticket.serial_number,
            ticket.imei,
            customerLabel(ticket.customer_id),
            technicianLabel(ticket.technician_id),
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(needle)
        : true;
      return matchesStatus && matchesSearch;
    });
  }, [statusFilter, ticketSearch, tickets, customers, staffUsers]);

  const benchStats = useMemo(
    () => ({
      unassigned: tickets.filter((ticket) => !ticket.technician_id).length,
      awaitingParts: tickets.filter((ticket) => ticket.status === "awaiting_parts")
        .length,
      ready: tickets.filter((ticket) => ticket.status === "ready_for_pickup").length,
      withoutEstimate: tickets.filter(
        (ticket) => ticketEstimate(ticket) <= 0 && ticket.status !== "cancelled",
      ).length,
    }),
    [tickets],
  );

  useEffect(() => {
    if (!token || isPreview) return;

    let active = true;
    Promise.allSettled([
      listBranches(token),
      listCustomers(token),
      listStaffUsers(token),
      listAssignableRoles(token),
    ]).then(([branchesResult, customersResult, usersResult, rolesResult]) => {
      if (!active) return;
      let failed = false;

      if (branchesResult.status === "fulfilled" && branchesResult.value.length) {
        setBranches(branchesResult.value);
        setSelectedBranchId((current) => {
          if (current && branchesResult.value.some((branch) => branch.id === current)) {
            return current;
          }
          return user?.branch_id ?? branchesResult.value[0].id;
        });
      } else {
        failed = true;
      }

      if (customersResult.status === "fulfilled") {
        setCustomers(customersResult.value);
        setTicketForm((current) => ({
          ...current,
          customer_id: current.customer_id || customersResult.value[0]?.id || "__new__",
        }));
      } else {
        failed = true;
      }

      if (usersResult.status === "fulfilled") {
        setStaffUsers(usersResult.value);
      } else {
        failed = true;
      }

      if (rolesResult.status === "fulfilled") {
        setRoles(rolesResult.value);
      } else {
        failed = true;
      }

        setNotice(failed ? "Some repair reference data is unavailable. Sample data remains visible where needed." : null);
    });

    return () => {
      active = false;
    };
  }, [isPreview, token, user?.branch_id]);

  useEffect(() => {
    if (!token || isPreview || !selectedBranchId) return;

    let active = true;
    Promise.allSettled([
      listRepairs(token, selectedBranchId),
      repairSummary(token),
    ]).then(([ticketsResult, summaryResult]) => {
      if (!active) return;
      let failed = false;

      if (ticketsResult.status === "fulfilled") {
        setTickets(ticketsResult.value.items);
        setSelectedTicketId((current) => current || ticketsResult.value.items[0]?.id || "");
      } else {
        failed = true;
      }

      if (summaryResult.status === "fulfilled") {
        setSummary(summaryResult.value);
      } else {
        failed = true;
      }

      setNotice(failed ? "Repairs API unavailable or not permitted. Showing sample data where needed." : null);
    });

    return () => {
      active = false;
    };
  }, [isPreview, selectedBranchId, token]);

  useEffect(() => {
    if (!token || isPreview || !selectedBranchId) return;

    let active = true;
    Promise.allSettled([
      listCatalogProducts(token, partSearch),
      listSerializedUnits(token, selectedBranchId, "", {
        status: "available",
        pageSize: 100,
      }),
      currentTillSession(token),
    ]).then(([catalogResult, serializedResult, tillResult]) => {
      if (!active) return;

      if (catalogResult.status === "fulfilled") {
        setCatalogProducts(catalogResult.value.items);
      }

      if (serializedResult.status === "fulfilled") {
        setSerializedUnits(serializedResult.value.items);
      }

      setTillSession(tillResult.status === "fulfilled" ? tillResult.value : null);
    });

    return () => {
      active = false;
    };
  }, [isPreview, partSearch, selectedBranchId, token]);

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    tickets.forEach((ticket) => {
      counts.set(ticket.status, (counts.get(ticket.status) ?? 0) + 1);
    });
    return counts;
  }, [tickets]);

  useEffect(() => {
    if (!selectedTicket) return;
    setSelectedTechnicianId(selectedTicket.technician_id ?? "");
    setNextStatus(recommendedNextStatus(selectedTicket.status));
    setDiagnosisForm({
      diagnosis: selectedTicket.diagnosis ?? "",
      labor_estimate:
        Number(selectedTicket.labor_estimate) > 0
          ? selectedTicket.labor_estimate
          : "",
      parts_estimate:
        Number(selectedTicket.parts_estimate) > 0 ? selectedTicket.parts_estimate : "",
    });
    setQuoteNote("");
    setReadyNote("");
    setPartForm(emptyPartForm);
    setInvoice(null);
  }, [selectedTicket?.id, selectedTicket?.status, selectedTicket?.technician_id]);

  useEffect(() => {
    if (!selectedTicket || !token || isPreview) return;
    if (!invoiceEligible(selectedTicket.status)) return;

    let active = true;
    getRepairInvoice(token, selectedTicket.id)
      .then((result) => {
        if (!active) return;
        setInvoice(result);
        setPaymentForm((current) => ({
          ...current,
          amount:
            current.amount || Number(result.balance_due) <= 0
              ? current.amount
              : result.balance_due,
        }));
      })
      .catch(() => {
        if (!active) return;
        setInvoice(null);
      });

    return () => {
      active = false;
    };
  }, [isPreview, selectedTicket?.id, selectedTicket?.status, token]);

  useEffect(() => {
    if (!partVariantOptions.length) return;
    setPartForm((current) => {
      if (current.variant_id && partVariantOptions.some((item) => item.id === current.variant_id)) {
        return current;
      }
      return { ...current, variant_id: partVariantOptions[0].id, serialized_unit_id: "" };
    });
  }, [partVariantOptions]);

  function customerLabel(customerId: string) {
    const customer = customers.find((item) => item.id === customerId);
    return customer ? `${customer.full_name} / ${customer.phone}` : customerId;
  }

  function customerPhone(customerId: string) {
    return customers.find((item) => item.id === customerId)?.phone ?? "No phone";
  }

  function technicianLabel(technicianId: string | null) {
    if (!technicianId) return "Unassigned";
    const technician = staffUsers.find((staff) => staff.id === technicianId);
    return technician ? technician.full_name : technicianId;
  }

  function repairPartLabel(variantId: string) {
    const variant = partVariantOptions.find((item) => item.id === variantId);
    return variant ? `${variant.label} / ${variant.sku}` : variantId;
  }

  function ticketEstimate(ticket: RepairTicket) {
    const loggedParts = repairParts(ticket).reduce(
      (sum, part) => sum + Number(part.unit_price) * part.quantity,
      0,
    );
    return Number(ticket.labor_estimate) + (loggedParts || Number(ticket.parts_estimate));
  }

  function invoiceEligible(status: string) {
    return [
      "customer_approved",
      "awaiting_parts",
      "repairing",
      "ready_for_pickup",
      "collected",
    ].includes(status);
  }

  function canLogParts(ticket: RepairTicket) {
    return ["customer_approved", "awaiting_parts", "repairing"].includes(
      ticket.status,
    );
  }

  function canSubmitDiagnosis(ticket: RepairTicket) {
    return Boolean(ticket.technician_id) && ["received", "diagnosing"].includes(ticket.status);
  }

  function canCollectSelectedTicket() {
    return (
      selectedTicket?.status === "ready_for_pickup" &&
      derivedInvoice !== null &&
      derivedInvoice.due <= 0
    );
  }

  function paymentIdempotencyKey() {
    return `repair-${selectedTicket?.id ?? "ticket"}-${Date.now()}`;
  }

  function ticketAgeLabel(ticket: RepairTicket) {
    const start = ticket.received_at ?? ticket.created_at;
    const receivedAt = new Date(start);
    if (Number.isNaN(receivedAt.getTime())) return "Age unknown";
    const diffDays = Math.max(
      0,
      Math.floor((Date.now() - receivedAt.getTime()) / 86_400_000),
    );
    if (diffDays === 0) return "Received today";
    if (diffDays === 1) return "1 day on bench";
    return `${integer(diffDays)} days on bench`;
  }

  function recommendedNextStatus(status: string) {
    const order = [
      "received",
      "diagnosing",
      "quote_pending",
      "customer_approved",
      "awaiting_parts",
      "repairing",
      "ready_for_pickup",
      "collected",
    ];
    const index = order.indexOf(status);
    if (index === -1 || index === order.length - 1) return status;
    return order[index + 1];
  }

  function ticketNextAction(ticket: RepairTicket) {
    if (!ticket.technician_id) return "Assign a technician before work starts.";
    if (ticket.status === "received") return "Move to diagnosis after intake checks.";
    if (ticket.status === "diagnosing") return "Record diagnosis and prepare quote.";
    if (ticket.status === "quote_pending") return "Call customer for approval.";
    if (ticket.status === "customer_approved") return "Confirm parts availability.";
    if (ticket.status === "awaiting_parts") return "Reserve or purchase required parts.";
    if (ticket.status === "repairing") return "Complete repair, test device, then mark ready.";
    if (ticket.status === "ready_for_pickup") return "Generate invoice and notify customer.";
    if (ticket.status === "collected") return "Ticket complete.";
    if (ticket.status === "cancelled") return "No further action.";
    return "Review ticket and choose the next status.";
  }

  function identityHint(ticket: RepairTicket) {
    if (ticket.device_type.toLowerCase().includes("phone")) {
      return ticket.imei
        ? `IMEI ${ticket.imei}`
        : "IMEI missing — capture before handover.";
    }
    if (ticket.serial_number) return `Serial ${ticket.serial_number}`;
    return "Serial number not recorded.";
  }

  function previewStatusUpdate(ticket: RepairTicket, status: string): RepairTicket {
    const now = new Date().toISOString();
    return {
      ...ticket,
      status,
      updated_at: now,
      ready_at: status === "ready_for_pickup" ? now : ticket.ready_at,
      collected_at: status === "collected" ? now : ticket.collected_at,
    };
  }

  function updateTicket(ticket: RepairTicket) {
    setTickets((current) =>
      current.map((item) => (item.id === ticket.id ? ticket : item)),
    );
    setSelectedTicketId(ticket.id);
  }

  async function handleCreateTicket(event: FormEvent) {
    event.preventDefault();
    if (!selectedBranchId) {
      setNotice("Select a branch before creating a repair ticket.");
      return;
    }
    if (
      !ticketForm.device_brand ||
      !ticketForm.device_model ||
      !ticketForm.reported_issue ||
      !ticketForm.intake_condition
    ) {
      setNotice("Device brand, model, issue, and intake condition are required.");
      return;
    }
    if (
      ticketForm.device_type.toLowerCase() === "phone" &&
      ticketForm.imei &&
      !/^\d{15}$/.test(ticketForm.imei)
    ) {
      setNotice("Phone IMEI must be exactly 15 digits when provided.");
      return;
    }
    if (ticketForm.customer_id === "__new__" && (!customerForm.full_name || !customerForm.phone)) {
      setNotice("New customer name and phone are required.");
      return;
    }

    setBusy(true);
    try {
      if (!token || isPreview) {
        const previewCustomerId =
          ticketForm.customer_id === "__new__"
            ? `preview-customer-${Date.now()}`
            : ticketForm.customer_id;
        if (ticketForm.customer_id === "__new__") {
          setCustomers((current) => [
            {
              id: previewCustomerId,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              is_deleted: false,
              full_name: customerForm.full_name,
              phone: customerForm.phone,
              email: customerForm.email || null,
              address: null,
              loyalty_points: 0,
              credit_limit: "0",
              home_branch_id: selectedBranchId,
              is_active: true,
            },
            ...current,
          ]);
        }
        const ticket: RepairTicket = {
          id: `preview-repair-${Date.now()}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_deleted: false,
          ticket_number: `REP-PREVIEW-${tickets.length + 1}`,
          branch_id: selectedBranchId,
          customer_id: previewCustomerId,
          technician_id: null,
          status: "received",
          device_type: ticketForm.device_type,
          device_brand: ticketForm.device_brand,
          device_model: ticketForm.device_model,
          serial_number: ticketForm.serial_number || null,
          imei: ticketForm.imei || null,
          reported_issue: ticketForm.reported_issue,
          diagnosis: null,
          intake_condition: ticketForm.intake_condition,
          intake_images: [],
          accessories_received: splitList(ticketForm.accessories_received),
          labor_estimate: "0",
          parts_estimate: "0",
          approved_at: null,
          booked_for: null,
          received_at: new Date().toISOString(),
          ready_at: null,
          collected_at: null,
          parts: [],
          status_history: [],
        };
        setTickets((current) => [ticket, ...current]);
        setSelectedTicketId(ticket.id);
        setTicketForm({ ...emptyTicketForm, customer_id: previewCustomerId });
        setCustomerForm(emptyCustomerForm);
        setNotice("Preview repair ticket added locally.");
        return;
      }

      let customerId = ticketForm.customer_id;
      if (customerId === "__new__") {
        if (!customerForm.full_name || !customerForm.phone) {
          setNotice("New customer name and phone are required.");
          return;
        }
        const customer = await createCustomer(token, {
          full_name: customerForm.full_name,
          phone: customerForm.phone,
          email: customerForm.email || null,
          home_branch_id: selectedBranchId,
        });
        setCustomers((current) => [customer, ...current]);
        customerId = customer.id;
      }

      const booking = await createRepairBooking(token, {
        branch_id: selectedBranchId,
        customer_id: customerId,
        device_type: ticketForm.device_type,
        device_brand: ticketForm.device_brand,
        device_model: ticketForm.device_model,
        serial_number: ticketForm.serial_number || null,
        imei: ticketForm.imei || null,
        reported_issue: ticketForm.reported_issue,
      });
      const ticket = await recordRepairIntake(token, booking.id, {
        intake_condition: ticketForm.intake_condition,
        accessories_received: splitList(ticketForm.accessories_received),
        intake_images: [],
      });
      setTickets((current) => [ticket, ...current]);
      setSelectedTicketId(ticket.id);
      setTicketForm({ ...emptyTicketForm, customer_id: customerId });
      setCustomerForm(emptyCustomerForm);
      setNotice(`Created repair ticket ${ticket.ticket_number}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not create repair ticket.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAssign(event: FormEvent) {
    event.preventDefault();
    if (!selectedTicket || !selectedTechnicianId) {
      setNotice("Select a repair ticket and technician first.");
      return;
    }

    setBusy(true);
    try {
      if (!token || isPreview) {
        updateTicket({
          ...selectedTicket,
          technician_id: selectedTechnicianId,
          updated_at: new Date().toISOString(),
        });
        setNotice("Preview technician assignment updated locally.");
        return;
      }
      const ticket = await assignRepairTechnician(token, selectedTicket.id, {
        technician_id: selectedTechnicianId,
      });
      updateTicket(ticket);
      setNotice(`Assigned technician to ${ticket.ticket_number}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not assign technician.");
    } finally {
      setBusy(false);
    }
  }

  async function handleStatusUpdate(event: FormEvent) {
    event.preventDefault();
    if (!selectedTicket) {
      setNotice("Select a repair ticket first.");
      return;
    }

    setBusy(true);
    try {
      if (!token || isPreview) {
        updateTicket(previewStatusUpdate(selectedTicket, nextStatus));
        setStatusNote("");
        setNotice("Preview repair status updated locally.");
        return;
      }
      const ticket = await updateRepairStatus(token, selectedTicket.id, {
        status: nextStatus,
        note: statusNote || null,
      });
      updateTicket(ticket);
      setStatusNote("");
      setNotice(`Updated ${ticket.ticket_number} to ${titleize(ticket.status)}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update repair status.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmitDiagnosis(event: FormEvent) {
    event.preventDefault();
    if (!selectedTicket) {
      setNotice("Select a repair ticket first.");
      return;
    }
    if (!canSubmitDiagnosis(selectedTicket)) {
      setNotice("Assign the ticket and keep it in received/diagnosing before diagnosis.");
      return;
    }
    if (!diagnosisForm.diagnosis.trim()) {
      setNotice("Diagnosis notes are required before preparing a quote.");
      return;
    }

    setBusy(true);
    try {
      if (!token || isPreview) {
        updateTicket({
          ...selectedTicket,
          diagnosis: diagnosisForm.diagnosis.trim(),
          labor_estimate: String(Number(diagnosisForm.labor_estimate) || 0),
          parts_estimate: String(Number(diagnosisForm.parts_estimate) || 0),
          status: "quote_pending",
          updated_at: new Date().toISOString(),
        });
        setNotice("Preview diagnosis submitted and quote prepared.");
        return;
      }

      const ticket = await submitRepairDiagnosis(token, selectedTicket.id, {
        diagnosis: diagnosisForm.diagnosis.trim(),
        labor_estimate: Number(diagnosisForm.labor_estimate) || 0,
        parts_estimate: Number(diagnosisForm.parts_estimate) || 0,
      });
      updateTicket(ticket);
      setNotice(`Diagnosis submitted for ${ticket.ticket_number}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not submit diagnosis.");
    } finally {
      setBusy(false);
    }
  }

  async function handleQuoteDecision(approved: boolean) {
    if (!selectedTicket) {
      setNotice("Select a repair ticket first.");
      return;
    }
    if (selectedTicket.status !== "quote_pending") {
      setNotice("Quote approval is only available while the ticket is quote pending.");
      return;
    }

    setBusy(true);
    try {
      if (!token || isPreview) {
        updateTicket({
          ...selectedTicket,
          status: approved ? "customer_approved" : "cancelled",
          approved_at: approved ? new Date().toISOString() : selectedTicket.approved_at,
          updated_at: new Date().toISOString(),
        });
        setQuoteNote("");
        setNotice(approved ? "Preview quote approved." : "Preview quote declined.");
        return;
      }

      const ticket = await decideRepairQuote(token, selectedTicket.id, {
        approved,
        note: quoteNote || null,
      });
      updateTicket(ticket);
      setQuoteNote("");
      setNotice(
        approved
          ? `${ticket.ticket_number} quote approved.`
          : `${ticket.ticket_number} quote declined and cancelled.`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update quote decision.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAddPart(event: FormEvent) {
    event.preventDefault();
    if (!selectedTicket) {
      setNotice("Select a repair ticket first.");
      return;
    }
    if (!canLogParts(selectedTicket)) {
      setNotice("Parts can only be logged after the customer approves the quote.");
      return;
    }
    if (!selectedPartVariant) {
      setNotice("Select a repair part from the catalog.");
      return;
    }
    const quantity = Number(partForm.quantity);
    if (!quantity || quantity <= 0) {
      setNotice("Part quantity must be at least 1.");
      return;
    }
    if (
      selectedPartVariant.trackingType !== "bulk" &&
      !partForm.serialized_unit_id
    ) {
      setNotice("Serialized/IMEI repair parts need a specific available unit.");
      return;
    }

    setBusy(true);
    try {
      if (!token || isPreview) {
        const part = {
          id: `preview-repair-part-${Date.now()}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_deleted: false,
          repair_ticket_id: selectedTicket.id,
          variant_id: selectedPartVariant.id,
          serialized_unit_id: partForm.serialized_unit_id || null,
          quantity,
          unit_price: String(selectedPartVariant.price),
        };
        updateTicket({
          ...selectedTicket,
          parts: [part, ...repairParts(selectedTicket)],
          updated_at: new Date().toISOString(),
        });
        setPartForm((current) => ({
          ...current,
          serialized_unit_id: "",
          quantity: "1",
        }));
        setNotice("Preview repair part logged locally.");
        return;
      }

      const ticket = await addRepairPart(token, selectedTicket.id, {
        variant_id: selectedPartVariant.id,
        serialized_unit_id: partForm.serialized_unit_id || null,
        quantity,
      });
      updateTicket(ticket);
      setPartForm((current) => ({
        ...current,
        serialized_unit_id: "",
        quantity: "1",
      }));
      setNotice(`Logged ${selectedPartVariant.label} on ${ticket.ticket_number}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not log repair part.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemovePart(partId: string) {
    if (!selectedTicket) return;

    setBusy(true);
    try {
      if (!token || isPreview) {
        updateTicket({
          ...selectedTicket,
          parts: repairParts(selectedTicket).filter((part) => part.id !== partId),
          updated_at: new Date().toISOString(),
        });
        setNotice("Preview repair part removed locally.");
        return;
      }

      const ticket = await removeRepairPart(token, selectedTicket.id, partId);
      updateTicket(ticket);
      setNotice(`Removed part from ${ticket.ticket_number}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not remove repair part.");
    } finally {
      setBusy(false);
    }
  }

  async function handleMarkReady() {
    if (!selectedTicket) {
      setNotice("Select a repair ticket first.");
      return;
    }
    if (selectedTicket.status !== "repairing") {
      setNotice("Only repairs currently in progress can be marked ready.");
      return;
    }

    setBusy(true);
    try {
      if (!token || isPreview) {
        updateTicket(previewStatusUpdate(selectedTicket, "ready_for_pickup"));
        setReadyNote("");
        setNotice("Preview repair marked ready for pickup.");
        return;
      }

      const ticket = await markRepairReady(token, selectedTicket.id, {
        note: readyNote || null,
      });
      updateTicket(ticket);
      setReadyNote("");
      setNotice(`${ticket.ticket_number} is ready for pickup.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not mark repair ready.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelRepair() {
    if (!selectedTicket) {
      setNotice("Select a repair ticket first.");
      return;
    }

    setBusy(true);
    try {
      if (!token || isPreview) {
        updateTicket(previewStatusUpdate(selectedTicket, "cancelled"));
        setNotice("Preview repair cancelled locally.");
        return;
      }
      const ticket = await cancelRepair(token, selectedTicket.id, {
        note: statusNote || "Repair cancelled from repair desk",
      });
      updateTicket(ticket);
      setNotice(`${ticket.ticket_number} cancelled.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not cancel repair.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRepairPayment(event: FormEvent) {
    event.preventDefault();
    if (!selectedTicket || !derivedInvoice) {
      setNotice("Select an invoice-ready repair first.");
      return;
    }
    const amount = Number(paymentForm.amount);
    if (!amount || amount <= 0) {
      setNotice("Payment amount must be greater than zero.");
      return;
    }
    if (!tillSession && token && !isPreview) {
      setNotice("Open a till session before receiving repair payments.");
      return;
    }

    setBusy(true);
    try {
      if (!token || isPreview) {
        const paid = derivedInvoice.paid + amount;
        const total = derivedInvoice.total;
        setInvoice({
          ticket_id: selectedTicket.id,
          ticket_number: selectedTicket.ticket_number,
          branch_id: selectedTicket.branch_id,
          customer_id: selectedTicket.customer_id,
          customer_name: customerLabel(selectedTicket.customer_id).split(" / ")[0],
          customer_phone: customerPhone(selectedTicket.customer_id),
          device_description: `${selectedTicket.device_brand} ${selectedTicket.device_model}`,
          labor_amount: String(derivedInvoice.labor),
          parts_amount: String(derivedInvoice.parts),
          total_amount: String(total),
          paid_amount: String(paid),
          balance_due: String(Math.max(0, total - paid)),
          payment_status:
            total - paid <= 0 ? "paid" : paid > 0 ? "partially_paid" : "unpaid",
          payments: [
            {
              method: paymentForm.method,
              amount: String(amount),
              provider_reference: paymentForm.provider_reference || null,
              paid_at: new Date().toISOString(),
            },
            ...(invoice?.payments ?? []),
          ],
        });
        setPaymentForm(emptyPaymentForm);
        setNotice("Preview repair payment recorded locally.");
        return;
      }

      await addRepairPayment(token, selectedTicket.id, {
        till_session_id: tillSession!.id,
        method: paymentForm.method,
        amount,
        provider_reference: paymentForm.provider_reference || null,
        idempotency_key: paymentIdempotencyKey(),
        notes: paymentForm.notes || null,
      });
      const updatedInvoice = await getRepairInvoice(token, selectedTicket.id);
      setInvoice(updatedInvoice);
      setPaymentForm(emptyPaymentForm);
      setNotice(`Payment recorded for ${selectedTicket.ticket_number}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not record repair payment.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCollectRepair() {
    if (!selectedTicket) {
      setNotice("Select a repair ticket first.");
      return;
    }
    if (!canCollectSelectedTicket()) {
      setNotice("Repair can only be collected once it is ready and fully paid.");
      return;
    }

    setBusy(true);
    try {
      if (!token || isPreview) {
        updateTicket(previewStatusUpdate(selectedTicket, "collected"));
        setNotice("Preview repair collected locally.");
        return;
      }
      const collection = await collectRepair(token, selectedTicket.id);
      updateTicket({
        ...selectedTicket,
        status: collection.status,
        collected_at: collection.collected_at,
        updated_at: collection.collected_at,
      });
      setNotice(`${collection.ticket_number} collected.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not collect repair.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="module-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Repair bench</p>
          <h1>Repairs</h1>
          <p>
            Manage device intake, technician workflow, parts usage, readiness,
            and pickup from one operational queue.
          </p>
        </div>
        <label className="branch-selector">
          <span>Branch</span>
          <select
            value={selectedBranchId}
            onChange={(event) => setSelectedBranchId(event.target.value)}
          >
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {notice && <div className="notice notice--page">{notice}</div>}

      <div className="stats-grid">
        <article className="metric-card">
          <span>Open tickets</span>
          <strong>{integer(summary.open_ticket_count)}</strong>
          <StatusPill tone="warning">In progress</StatusPill>
        </article>
        <article className="metric-card">
          <span>Ready</span>
          <strong>{integer(summary.ready_ticket_count)}</strong>
          <StatusPill tone="info">Pickup</StatusPill>
        </article>
        <article className="metric-card">
          <span>Collected</span>
          <strong>{integer(summary.collected_ticket_count)}</strong>
          <StatusPill tone="success">Done</StatusPill>
        </article>
        <article className="metric-card">
          <span>Payments</span>
          <strong>{money(summary.payment_total)}</strong>
          <StatusPill tone="success">Received</StatusPill>
        </article>
      </div>

      <div className="repair-desk m-t">
        <section className="panel-card repair-focus-card">
          <header className="panel-card__header panel-card__header--compact">
            <div>
              <p className="eyebrow">Selected repair</p>
              <h2>{selectedTicket?.ticket_number ?? "No ticket selected"}</h2>
            </div>
            {selectedTicket && (
              <StatusPill tone={toneForStatus(selectedTicket.status)}>
                {titleize(selectedTicket.status)}
              </StatusPill>
            )}
          </header>
          {selectedTicket ? (
            <div className="repair-focus-card__body">
              <div className="repair-device-title">
                <strong>
                  {selectedTicket.device_brand} {selectedTicket.device_model}
                </strong>
                <span>
                  {selectedTicket.device_type} · {identityHint(selectedTicket)}
                </span>
              </div>
              <p>{selectedTicket.reported_issue}</p>
              {(selectedTicket.intake_condition ||
                selectedTicket.accessories_received?.length) && (
                <div className="repair-intake-summary">
                  {selectedTicket.intake_condition && (
                    <span>Condition: {selectedTicket.intake_condition}</span>
                  )}
                  {selectedTicket.accessories_received?.length ? (
                    <span>
                      Accessories:{" "}
                      {selectedTicket.accessories_received.join(", ")}
                    </span>
                  ) : null}
                </div>
              )}
              {selectedTicket.diagnosis && (
                <div className="repair-diagnosis-note">
                  <span>Diagnosis</span>
                  <strong>{selectedTicket.diagnosis}</strong>
                </div>
              )}
              <div className="repair-mini-stats">
                <span>
                  <b>{ticketAgeLabel(selectedTicket)}</b>
                  Time in shop
                </span>
                <span>
                  <b>{technicianLabel(selectedTicket.technician_id)}</b>
                  Technician
                </span>
                <span>
                  <b>{money(ticketEstimate(selectedTicket))}</b>
                  Estimate
                </span>
              </div>
              <div className="repair-next-action">
                <span>Next action</span>
                <strong>{ticketNextAction(selectedTicket)}</strong>
              </div>
            </div>
          ) : (
            <p className="empty-panel-message">
              Select a ticket from the work queue to manage the repair.
            </p>
          )}
        </section>

        <section className="panel-card">
          <header className="panel-card__header panel-card__header--compact">
            <div>
              <p className="eyebrow">Customer</p>
              <h2>Contact & handover</h2>
            </div>
          </header>
          {selectedTicket ? (
            <div className="repair-customer-card">
              <strong>{customerLabel(selectedTicket.customer_id)}</strong>
              <span>{customerPhone(selectedTicket.customer_id)}</span>
              <div>
                <span>Received</span>
                <b>{dateLabel(selectedTicket.received_at)}</b>
              </div>
              <div>
                <span>Ready</span>
                <b>{dateLabel(selectedTicket.ready_at)}</b>
              </div>
            </div>
          ) : (
            <p className="empty-panel-message">No customer selected.</p>
          )}
        </section>

        <section className="panel-card">
          <header className="panel-card__header panel-card__header--compact">
            <div>
              <p className="eyebrow">Bench attention</p>
              <h2>What needs eyes</h2>
            </div>
          </header>
          <div className="repair-alert-list">
            <button type="button" onClick={() => setStatusFilter("all")}>
              <strong>{integer(benchStats.unassigned)} unassigned</strong>
              <span>Assign technicians before work begins</span>
            </button>
            <button type="button" onClick={() => setStatusFilter("awaiting_parts")}>
              <strong>{integer(benchStats.awaitingParts)} awaiting parts</strong>
              <span>Check inventory or purchasing</span>
            </button>
            <button type="button" onClick={() => setStatusFilter("ready_for_pickup")}>
              <strong>{integer(benchStats.ready)} ready for pickup</strong>
              <span>Invoice and notify customers</span>
            </button>
            <button type="button" onClick={() => setStatusFilter("all")}>
              <strong>{integer(benchStats.withoutEstimate)} without estimate</strong>
              <span>Diagnosis should lead to a quote</span>
            </button>
          </div>
        </section>
      </div>

      <section className="panel-card">
        <header className="panel-card__header">
          <div>
            <p className="eyebrow">Pipeline</p>
            <h2>Repair stages</h2>
          </div>
        </header>
        <div className="pipeline-board">
          {pipeline.map((status) => (
            <button
              className={`pipeline-column ${
                statusFilter === status ? "is-active" : ""
              }`}
              key={status}
              onClick={() =>
                setStatusFilter((current) => (current === status ? "all" : status))
              }
              type="button"
            >
              <strong>{titleize(status)}</strong>
              <span>{integer(statusCounts.get(status) ?? 0)}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="repair-workspace m-t">
        <section className="panel-card">
          <header className="panel-card__header">
            <div>
              <p className="eyebrow">New ticket</p>
              <h2>Device intake</h2>
            </div>
          </header>
          <form className="form-panel" onSubmit={handleCreateTicket}>
            <div className="form-grid form-grid--two">
              <label>
                Customer
                <select
                  value={ticketForm.customer_id}
                  onChange={(event) =>
                    setTicketForm((current) => ({
                      ...current,
                      customer_id: event.target.value,
                    }))
                  }
                >
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.full_name} / {customer.phone}
                    </option>
                  ))}
                  <option value="__new__">Create new customer...</option>
                </select>
              </label>
              <label>
                Device type
                <select
                  value={ticketForm.device_type}
                  onChange={(event) =>
                    setTicketForm((current) => ({
                      ...current,
                      device_type: event.target.value,
                    }))
                  }
                >
                  <option>Phone</option>
                  <option>Laptop</option>
                  <option>Tablet</option>
                  <option>Accessory</option>
                  <option>Other</option>
                </select>
              </label>
            </div>

            {ticketForm.customer_id === "__new__" && (
              <div className="embedded-form">
                <strong>Quick customer</strong>
                <div className="form-grid form-grid--three">
                  <label>
                    Full name
                    <input
                      value={customerForm.full_name}
                      onChange={(event) =>
                        setCustomerForm((current) => ({
                          ...current,
                          full_name: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Phone
                    <input
                      value={customerForm.phone}
                      onChange={(event) =>
                        setCustomerForm((current) => ({
                          ...current,
                          phone: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Email
                    <input
                      value={customerForm.email}
                      onChange={(event) =>
                        setCustomerForm((current) => ({
                          ...current,
                          email: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
              </div>
            )}

            <div className="repair-intake-helper">
              <strong>
                {ticketForm.device_type === "Phone"
                  ? "IMEI is the strongest phone identifier."
                  : "Serial number helps warranty and pickup checks."}
              </strong>
              <span>
                Capture what the device physically shows now; this helps avoid
                handover disputes when the repair is collected.
              </span>
            </div>

            <div className="form-grid form-grid--two">
              <label>
                Brand
                <input
                  value={ticketForm.device_brand}
                  onChange={(event) =>
                    setTicketForm((current) => ({
                      ...current,
                      device_brand: event.target.value,
                    }))
                  }
                  placeholder="Samsung, HP, Lenovo"
                />
              </label>
              <label>
                Model
                <input
                  value={ticketForm.device_model}
                  onChange={(event) =>
                    setTicketForm((current) => ({
                      ...current,
                      device_model: event.target.value,
                    }))
                  }
                  placeholder="Galaxy A15, EliteBook 840"
                />
              </label>
              <label>
                Serial number
                <input
                  value={ticketForm.serial_number}
                  onChange={(event) =>
                    setTicketForm((current) => ({
                      ...current,
                      serial_number: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                IMEI
                <input
                  value={ticketForm.imei}
                  onChange={(event) =>
                    setTicketForm((current) => ({
                      ...current,
                      imei: event.target.value,
                    }))
                  }
                />
              </label>
            </div>

            <label>
              Reported issue
              <textarea
                value={ticketForm.reported_issue}
                onChange={(event) =>
                  setTicketForm((current) => ({
                    ...current,
                    reported_issue: event.target.value,
                  }))
                }
                placeholder="Describe the fault, symptoms, and customer notes"
              />
            </label>

            <div className="form-grid form-grid--two">
              <label>
                Intake condition
                <textarea
                  value={ticketForm.intake_condition}
                  onChange={(event) =>
                    setTicketForm((current) => ({
                      ...current,
                      intake_condition: event.target.value,
                    }))
                  }
                  placeholder="Cracked screen, missing screws, powers on, liquid signs..."
                />
              </label>
              <label>
                Accessories received
                <textarea
                  value={ticketForm.accessories_received}
                  onChange={(event) =>
                    setTicketForm((current) => ({
                      ...current,
                      accessories_received: event.target.value,
                    }))
                  }
                  placeholder="Charger, bag, SIM tray, case — comma or one per line"
                />
              </label>
            </div>

            <div className="form-footer">
              <button className="primary-button" disabled={busy}>
                Create Repair Ticket
              </button>
            </div>
          </form>
        </section>

        <section className="panel-card">
          <header className="panel-card__header">
            <div>
              <p className="eyebrow">Selected ticket</p>
              <h2>{selectedTicket?.ticket_number ?? "No ticket selected"}</h2>
            </div>
          </header>

          <div className="ticket-action-panel">
            {selectedTicket ? (
              <>
                <div className="selected-ticket-card">
                  <strong>
                    {selectedTicket.device_brand} {selectedTicket.device_model}
                  </strong>
                  <span>{selectedTicket.reported_issue}</span>
                  <div className="repair-selected-meta">
                    <small>{customerLabel(selectedTicket.customer_id)}</small>
                    <small>{technicianLabel(selectedTicket.technician_id)}</small>
                    <small>{money(ticketEstimate(selectedTicket))}</small>
                  </div>
                  <StatusPill tone={toneForStatus(selectedTicket.status)}>
                    {titleize(selectedTicket.status)}
                  </StatusPill>
                </div>

                <form onSubmit={handleAssign} className="action-form">
                  <div className="repair-form-hint">
                    <span>Current owner</span>
                    <strong>{technicianLabel(selectedTicket.technician_id)}</strong>
                  </div>
                  <label>
                    Assign technician
                    <select
                      value={selectedTechnicianId}
                      onChange={(event) => setSelectedTechnicianId(event.target.value)}
                    >
                      <option value="">Select technician</option>
                      {technicianOptions.map((staff) => (
                        <option key={staff.id} value={staff.id}>
                          {staff.full_name} / {roleNameById.get(staff.role_id) ?? "Staff"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="secondary-button" disabled={busy}>
                    Assign
                  </button>
                </form>

                <form onSubmit={handleSubmitDiagnosis} className="action-form">
                  <div className="repair-form-hint">
                    <span>Diagnosis & quote</span>
                    <strong>
                      {selectedTicket.diagnosis
                        ? "Diagnosis captured"
                        : "Awaiting technician diagnosis"}
                    </strong>
                  </div>
                  <label>
                    Diagnosis
                    <textarea
                      value={diagnosisForm.diagnosis}
                      onChange={(event) =>
                        setDiagnosisForm((current) => ({
                          ...current,
                          diagnosis: event.target.value,
                        }))
                      }
                      placeholder="Fault found, recommended fix, customer-facing quote notes"
                    />
                  </label>
                  <div className="form-grid form-grid--two">
                    <label>
                      Labor estimate
                      <input
                        type="number"
                        min="0"
                        value={diagnosisForm.labor_estimate}
                        onChange={(event) =>
                          setDiagnosisForm((current) => ({
                            ...current,
                            labor_estimate: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      Parts estimate
                      <input
                        type="number"
                        min="0"
                        value={diagnosisForm.parts_estimate}
                        onChange={(event) =>
                          setDiagnosisForm((current) => ({
                            ...current,
                            parts_estimate: event.target.value,
                          }))
                        }
                      />
                    </label>
                  </div>
                  <button
                    className="secondary-button"
                    disabled={busy || !canSubmitDiagnosis(selectedTicket)}
                  >
                    Submit Diagnosis
                  </button>
                </form>

                <div className="action-form">
                  <div className="repair-form-hint">
                    <span>Customer quote decision</span>
                    <strong>
                      {selectedTicket.status === "quote_pending"
                        ? "Waiting for customer"
                        : titleize(selectedTicket.status)}
                    </strong>
                  </div>
                  <label>
                    Quote note
                    <textarea
                      value={quoteNote}
                      onChange={(event) => setQuoteNote(event.target.value)}
                      placeholder="Customer approved by phone, declined due to cost..."
                    />
                  </label>
                  <div className="table-actions">
                    <button
                      className="secondary-button"
                      disabled={busy || selectedTicket.status !== "quote_pending"}
                      onClick={() => void handleQuoteDecision(true)}
                      type="button"
                    >
                      Approve Quote
                    </button>
                    <button
                      className="ghost-button"
                      disabled={busy || selectedTicket.status !== "quote_pending"}
                      onClick={() => void handleQuoteDecision(false)}
                      type="button"
                    >
                      Decline
                    </button>
                  </div>
                </div>

                <form onSubmit={handleStatusUpdate} className="action-form">
                  <div className="repair-form-hint">
                    <span>Suggested next step</span>
                    <strong>{titleize(recommendedNextStatus(selectedTicket.status))}</strong>
                  </div>
                  <label>
                    Update status
                    <select
                      value={nextStatus}
                      onChange={(event) => setNextStatus(event.target.value)}
                    >
                      {repairStatuses.map((status) => (
                        <option key={status} value={status}>
                          {titleize(status)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Note
                    <textarea
                      value={statusNote}
                      onChange={(event) => setStatusNote(event.target.value)}
                      placeholder="Optional update note"
                    />
                  </label>
                  <button className="secondary-button" disabled={busy}>
                    Update Status
                  </button>
                </form>

                <form onSubmit={handleAddPart} className="action-form">
                  <div className="repair-form-hint">
                    <span>Parts used</span>
                    <strong>{integer(selectedTicketParts.length)} line(s)</strong>
                  </div>
                  <div className="form-grid form-grid--two">
                    <label>
                      Find part
                      <input
                        value={partSearch}
                        onChange={(event) => setPartSearch(event.target.value)}
                        placeholder="Search catalog part, SKU, screen, battery..."
                      />
                    </label>
                    <label>
                      Part
                      <select
                        value={partForm.variant_id}
                        onChange={(event) =>
                          setPartForm((current) => ({
                            ...current,
                            variant_id: event.target.value,
                            serialized_unit_id: "",
                          }))
                        }
                      >
                        <option value="">Select part</option>
                        {partVariantOptions.map((variant) => (
                          <option key={variant.id} value={variant.id}>
                            {variant.label} / {variant.sku} /{" "}
                            {titleize(variant.trackingType)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="form-grid form-grid--two">
                    <label>
                      Quantity
                      <input
                        type="number"
                        min="1"
                        value={partForm.quantity}
                        onChange={(event) =>
                          setPartForm((current) => ({
                            ...current,
                            quantity: event.target.value,
                          }))
                        }
                      />
                    </label>
                    {selectedPartVariant?.trackingType !== "bulk" ? (
                      <label>
                        Serial / IMEI unit
                        <select
                          value={partForm.serialized_unit_id}
                          onChange={(event) =>
                            setPartForm((current) => ({
                              ...current,
                              serialized_unit_id: event.target.value,
                            }))
                          }
                        >
                          <option value="">Select available unit</option>
                          {serializedPartOptions.map((unit) => (
                            <option key={unit.id} value={unit.id}>
                              {unit.serial_number ?? unit.imei ?? unit.sku}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <div className="repair-form-hint repair-form-hint--inline">
                        <span>Tracking</span>
                        <strong>Bulk quantity part</strong>
                      </div>
                    )}
                  </div>
                  <button
                    className="secondary-button"
                    disabled={busy || !canLogParts(selectedTicket)}
                  >
                    Log Part Used
                  </button>

                  {selectedTicketParts.length ? (
                    <div className="repair-parts-list">
                      {selectedTicketParts.map((part) => (
                        <article key={part.id}>
                          <div>
                            <strong>{repairPartLabel(part.variant_id)}</strong>
                            <span>
                              Qty {integer(part.quantity)} · Unit price{" "}
                              {money(part.unit_price)}
                            </span>
                          </div>
                          <button
                            className="ghost-button"
                            disabled={busy}
                            onClick={() => void handleRemovePart(part.id)}
                            type="button"
                          >
                            Remove
                          </button>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">
                      No parts logged yet. Parts can be added after customer
                      approval.
                    </p>
                  )}
                </form>

                <div className="action-form">
                  <div className="repair-form-hint">
                    <span>Invoice</span>
                    <strong>
                      {derivedInvoice
                        ? `${money(derivedInvoice.due)} due`
                        : "Not invoice-ready"}
                    </strong>
                  </div>
                  {derivedInvoice ? (
                    <div className="repair-invoice-card">
                      <div>
                        <span>Labor</span>
                        <strong>{money(derivedInvoice.labor)}</strong>
                      </div>
                      <div>
                        <span>Parts</span>
                        <strong>{money(derivedInvoice.parts)}</strong>
                      </div>
                      <div>
                        <span>Total</span>
                        <strong>{money(derivedInvoice.total)}</strong>
                      </div>
                      <div>
                        <span>Paid</span>
                        <strong>{money(derivedInvoice.paid)}</strong>
                      </div>
                    </div>
                  ) : (
                    <p className="muted">
                      Invoice appears after the quote is approved.
                    </p>
                  )}

                  <label>
                    Ready note
                    <textarea
                      value={readyNote}
                      onChange={(event) => setReadyNote(event.target.value)}
                      placeholder="Testing complete, customer notified..."
                    />
                  </label>
                  <button
                    className="secondary-button"
                    disabled={busy || selectedTicket.status !== "repairing"}
                    onClick={() => void handleMarkReady()}
                    type="button"
                  >
                    Mark Ready for Pickup
                  </button>
                </div>

                <form onSubmit={handleRepairPayment} className="action-form">
                  <div className="repair-form-hint">
                    <span>Repair payment</span>
                    <strong>
                      {tillSession
                        ? "Till session open"
                        : "No open till detected"}
                    </strong>
                  </div>
                  <div className="form-grid form-grid--two">
                    <label>
                      Method
                      <select
                        value={paymentForm.method}
                        onChange={(event) =>
                          setPaymentForm((current) => ({
                            ...current,
                            method: event.target.value as typeof paymentForm.method,
                          }))
                        }
                      >
                        <option value="cash">Cash</option>
                        <option value="mpesa">M-Pesa</option>
                        <option value="card">Card</option>
                        <option value="bank_transfer">Bank transfer</option>
                        <option value="store_credit">Store credit</option>
                      </select>
                    </label>
                    <label>
                      Amount
                      <input
                        type="number"
                        min="1"
                        value={paymentForm.amount}
                        onChange={(event) =>
                          setPaymentForm((current) => ({
                            ...current,
                            amount: event.target.value,
                          }))
                        }
                      />
                    </label>
                  </div>
                  <label>
                    Reference / notes
                    <input
                      value={paymentForm.provider_reference}
                      onChange={(event) =>
                        setPaymentForm((current) => ({
                          ...current,
                          provider_reference: event.target.value,
                        }))
                      }
                      placeholder="M-Pesa code, card auth, cash note"
                    />
                  </label>
                  <button
                    className="primary-button"
                    disabled={busy || !derivedInvoice || derivedInvoice.due <= 0}
                  >
                    Record Repair Payment
                  </button>
                </form>

                <div className="action-form">
                  <button
                    className="primary-button"
                    disabled={busy || !canCollectSelectedTicket()}
                    onClick={() => void handleCollectRepair()}
                    type="button"
                  >
                    Collect Device
                  </button>
                  <button
                    className="ghost-button"
                    disabled={
                      busy ||
                      ["ready_for_pickup", "collected", "cancelled"].includes(
                        selectedTicket.status,
                      )
                    }
                    onClick={() => void handleCancelRepair()}
                    type="button"
                  >
                    Cancel Repair
                  </button>
                </div>
              </>
            ) : (
              <p className="muted">Select a repair ticket from the queue.</p>
            )}
          </div>
        </section>
      </div>

      <section className="panel-card m-t">
        <header className="panel-card__header">
          <div>
            <p className="eyebrow">Tickets</p>
            <h2>Repair work queue</h2>
          </div>
          <div className="repair-queue-tools">
            <label className="table-search">
              <span>Search</span>
              <input
                value={ticketSearch}
                onChange={(event) => setTicketSearch(event.target.value)}
                placeholder="Ticket, device, customer"
              />
            </label>
            <label className="table-search">
              <span>Status</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                <option value="all">All</option>
                {repairStatuses.map((status) => (
                  <option key={status} value={status}>
                    {titleize(status)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>
        <table className="data-table repair-queue-table">
          <thead>
            <tr>
              <th>Ticket</th>
              <th>Device</th>
              <th>Customer</th>
              <th>Technician</th>
              <th>Issue</th>
              <th>Status</th>
              <th>Estimate</th>
              <th>Received</th>
            </tr>
          </thead>
          <tbody>
            {visibleTickets.length ? (
              visibleTickets.map((ticket) => (
                <tr
                  key={ticket.id}
                  className={selectedTicket?.id === ticket.id ? "is-selected" : ""}
                  onClick={() => setSelectedTicketId(ticket.id)}
                >
                  <td>
                    <strong>{ticket.ticket_number}</strong>
                    <span>{ticketAgeLabel(ticket)}</span>
                  </td>
                  <td>
                    {ticket.device_brand} {ticket.device_model}
                    <span>{identityHint(ticket)}</span>
                  </td>
                  <td>{customerLabel(ticket.customer_id)}</td>
                  <td>{technicianLabel(ticket.technician_id)}</td>
                  <td>{ticket.reported_issue}</td>
                  <td>
                    <StatusPill tone={toneForStatus(ticket.status)}>
                      {titleize(ticket.status)}
                    </StatusPill>
                  </td>
                  <td>{money(ticketEstimate(ticket))}</td>
                  <td>{dateLabel(ticket.received_at)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="empty-table-cell">
                  No repair tickets match the current search or status filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </section>
  );
}
