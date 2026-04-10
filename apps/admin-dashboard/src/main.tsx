/**
 * Admin Dashboard — stub.
 *
 * Planned features:
 *   - RBAC user management
 *   - Global bot controls (start/stop all users)
 *   - System health overview
 *   - Circuit breaker monitoring per user
 *   - Revenue / subscription analytics
 */

import React from "react";
import ReactDOM from "react-dom/client";

function AdminApp() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0B0E11",
        color: "#E8E8E8",
        fontFamily: "monospace",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
      }}
    >
      <div style={{ fontSize: 11, color: "#848E9C", letterSpacing: 4, textTransform: "uppercase" }}>
        ALGO TERMINAL
      </div>
      <h1 style={{ fontSize: 28, fontWeight: 700, color: "#FCD535", margin: 0 }}>Admin Dashboard</h1>
      <p style={{ color: "#848E9C", fontSize: 14, margin: 0 }}>Coming soon — RBAC, user management, system health</p>
      <div
        style={{
          marginTop: 24,
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 12,
          width: 480,
        }}
      >
        {[
          { label: "Users", value: "—" },
          { label: "Active Bots", value: "—" },
          { label: "System Health", value: "OK" },
        ].map((card) => (
          <div
            key={card.label}
            style={{
              background: "#161A1E",
              border: "1px solid #2B3139",
              borderRadius: 8,
              padding: "16px 12px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 11, color: "#848E9C", marginBottom: 4 }}>{card.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#FCD535" }}>{card.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AdminApp />
  </React.StrictMode>
);
