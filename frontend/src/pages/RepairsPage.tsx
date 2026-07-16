import { FormEvent, useEffect, useMemo, useState } from "react";

import {
  assignRepairTechnician,
  createCustomer,
  createRepairBooking,
  listAssignableRoles,
  listBranches,
  listCustomers,
  listRepairs,
  listStaffUsers,
  repairSummary,
  updateRepairStatus,
} from "../api/client";
import type {
  AssignableRole,
  Branch,
  Customer,
  RepairSummary,
  RepairTicket,
  StaffUser,
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
};

const emptyCustomerForm = {
  full_name: "",
  phone: "",
  email: "",
};

export function RepairsPage() {
  const { token, isPreview, user } = useAuth();
  const [branches, setBranches] = useState<Branch[]>(demoBranches);
  const [customers, setCustomers] = useState<Customer[]>(demoCustomers);
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>(demoStaffUsers);
  const [roles, setRoles] = useState<AssignableRole[]>(demoRoles);
  const [tickets, setTickets] = useState<RepairTicket[]>(demoRepairs);
  const [summary, setSummary] = useState<RepairSummary>(demoDashboard.repairs);
  const [selectedBranchId, setSelectedBranchId] = useState(
    user?.branch_id ?? demoBranches[0]?.id ?? "",
  );
  const [selectedTicketId, setSelectedTicketId] = useState(demoRepairs[0]?.id ?? "");
  const [ticketForm, setTicketForm] = useState(emptyTicketForm);
  const [customerForm, setCustomerForm] = useState(emptyCustomerForm);
  const [selectedTechnicianId, setSelectedTechnicianId] = useState("");
  const [nextStatus, setNextStatus] = useState("diagnosing");
  const [statusNote, setStatusNote] = useState("");
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

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    summary.status_breakdown.forEach((item) => counts.set(item.status, item.ticket_count));
    return counts;
  }, [summary]);

  useEffect(() => {
    if (!selectedTicket) return;
    setSelectedTechnicianId(selectedTicket.technician_id ?? "");
    setNextStatus(recommendedNextStatus(selectedTicket.status));
  }, [selectedTicket?.id, selectedTicket?.status, selectedTicket?.technician_id]);

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

  function ticketEstimate(ticket: RepairTicket) {
    return Number(ticket.labor_estimate) + Number(ticket.parts_estimate);
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
    if (!ticketForm.device_brand || !ticketForm.device_model || !ticketForm.reported_issue) {
      setNotice("Device brand, model, and reported issue are required.");
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
          labor_estimate: "0",
          parts_estimate: "0",
          booked_for: null,
          received_at: new Date().toISOString(),
          ready_at: null,
          collected_at: null,
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

      const ticket = await createRepairBooking(token, {
        branch_id: selectedBranchId,
        customer_id: customerId,
        device_type: ticketForm.device_type,
        device_brand: ticketForm.device_brand,
        device_model: ticketForm.device_model,
        serial_number: ticketForm.serial_number || null,
        imei: ticketForm.imei || null,
        reported_issue: ticketForm.reported_issue,
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
