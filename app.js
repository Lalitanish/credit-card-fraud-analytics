
let selectedTransaction = null;

function render(rows) {
  const body = document.getElementById("txBody");
  if (!body) return;

  body.innerHTML = "";

  if (!rows || rows.length === 0) {
    body.innerHTML = `
      <tr>
        <td colspan="8">No matching transactions found.</td>
      </tr>
    `;
    return;
  }

  rows.forEach((r, index) => {
    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";
    tr.title = "Click to view transaction details";

    tr.innerHTML = `
      <td>${r.Time}</td>
      <td>${money(r.Amount)}</td>
      <td>
        <span class="badge ${Number(r.Class) ? "fraud" : "normal"}">
          ${Number(r.Class) ? "Fraud" : "Normal"}
        </span>
      </td>
      ${["V1", "V2", "V3", "V4", "V5"].map(k =>
        `<td>${Number(r[k] ?? 0).toFixed(3)}</td>`
      ).join("")}
    `;

    tr.addEventListener("click", () => {
      selectedTransaction = r;

      document.querySelectorAll("#txBody tr").forEach(row => {
        row.style.background = "";
      });
      tr.style.background = "#e0f2fe";

      showTransactionDetails(r);
    });

    body.appendChild(tr);
  });
}

function showTransactionDetails(r) {
  let panel = document.getElementById("transactionDetails");

  if (!panel) {
    panel = document.createElement("div");
    panel.id = "transactionDetails";
    panel.style.cssText =
      "margin:16px 0;padding:16px;border:1px solid #d0d5dd;" +
      "border-radius:10px;overflow-wrap:anywhere;";

    const table = document.getElementById("txBody")?.closest("table");
    if (table) {
      table.insertAdjacentElement("beforebegin", panel);
    } else {
      document.getElementById("txBody")?.parentElement
        ?.insertAdjacentElement("beforebegin", panel);
    }
  }

  panel.innerHTML = `
    <h3>Selected Transaction</h3>
    <p><strong>Time:</strong> ${r.Time}</p>
    <p><strong>Amount:</strong> ${money(r.Amount)}</p>
    <p><strong>Actual class:</strong>
      ${Number(r.Class) ? "Fraud" : "Normal"}
    </p>
    <h4>Transaction Features</h4>
    <div>
      ${Object.entries(r).map(([key, value]) =>
        `<p><strong>${key}:</strong> ${
          typeof value === "number" ? value.toFixed(4) : value
        }</p>`
      ).join("")}
    </div>
  `;
}

