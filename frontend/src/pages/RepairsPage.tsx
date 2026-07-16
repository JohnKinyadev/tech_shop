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

    setBusy(true);
    try {
      if (!token || isPreview) {
        const ticket: RepairTicket = {
          id: `preview-repair-${Date.now()}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_deleted: false,
          ticket_number: `REP-PREVIEW-${tickets.length + 1}`,
          branch_id: selectedBranchId,
          customer_id:
            ticketForm.customer_id === "__new__"
              ? "preview-customer"
              : ticketForm.customer_id,
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
        setTicketForm(emptyTicketForm);
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
        updateTicket({ ...selectedTicket, technician_id: selectedTechnicianId });
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
        updateTicket({ ...selectedTicket, status: nextStatus });
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

      <section className="panel-card">
        <header className="panel-card__header">
          <div>
            <p className="eyebrow">Pipeline</p>
            <h2>Repair stages</h2>
          </div>
        </header>
        <div className="pipeline-board">
          {pipeline.map((status) => (
            <div className="pipeline-column" key={status}>
              <strong>{titleize(status)}</strong>
              <span>{integer(statusCounts.get(status) ?? 0)}</span>
            </div>
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
                  <StatusPill tone={toneForStatus(selectedTicket.status)}>
                    {titleize(selectedTicket.status)}
                  </StatusPill>
                </div>

                <form onSubmit={handleAssign} className="action-form">
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
        </header>
        <table className="data-table">
          <thead>
            <tr>
              <th>Ticket</th>
              <th>Device</th>
              <th>Issue</th>
              <th>Status</th>
              <th>Estimate</th>
              <th>Received</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((ticket) => (
              <tr
                key={ticket.id}
                className={selectedTicket?.id === ticket.id ? "is-selected" : ""}
                onClick={() => setSelectedTicketId(ticket.id)}
              >
                <td>{ticket.ticket_number}</td>
                <td>
                  {ticket.device_brand} {ticket.device_model}
                </td>
                <td>{ticket.reported_issue}</td>
                <td>
                  <StatusPill tone={toneForStatus(ticket.status)}>
                    {titleize(ticket.status)}
                  </StatusPill>
                </td>
                <td>
                  {money(Number(ticket.labor_estimate) + Number(ticket.parts_estimate))}
                </td>
                <td>{dateLabel(ticket.received_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </section>
  );
}
