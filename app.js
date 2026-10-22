
const API_BASE = "https://creditcardfraudapi.duckdns.org";

let DATA = null;
let charts = {};
let selectedTransaction = null;

const fmt = n =>
  new Intl.NumberFormat("en-US").format(n ?? 0);

const money = n =>
  "$" + Number(n ?? 0).toLocaleString("en-US", {
    maximumFractionDigits: 2
  });

async function getJSON(path) {
  const response = await fetch(`${API_BASE}${path}`);

  if (!response.ok) {
    throw new Error(`API request failed: ${path} (${response.status})`);
  }

  return response.json();
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function chart(id, type, labels, values, label) {
  const canvas = document.getElementById(id);
  if (!canvas) return;

  if (charts[id]) charts[id].destroy();

  charts[id] = new Chart(canvas, {
    type,
    data: {
      labels,
      datasets: [{
        label,
        data: values,
        borderWidth: 2,
        tension: 0.3,
        fill: type === "line",
        backgroundColor: "rgba(16,24,40,.10)",
        borderColor: "#344054",
        pointRadius: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            maxTicksLimit: 8,
            font: { size: 9 }
          }
        },
        y: {
          grid: { color: "#f2f4f7" },
          ticks: { font: { size: 9 } }
        }
      }
    }
  });
}

// Load dashboard data from FastAPI
async function init() {
  setText("total", "Loading...");
  setText("fraud", "Loading...");
  setText("normal", "Loading...");
  setText("apiStatus", "Connecting to API...");

  try {
    const [
      summary,
      distributions,
      correlation,
      transactionData
    ] = await Promise.all([
      getJSON("/api/summary"),
      getJSON("/api/distributions"),
      getJSON("/api/correlation"),
      getJSON("/api/transactions?limit=150")
    ]);

    const correlations = Object.entries(
      correlation.feature_correlation_with_class || {}
    ).map(([feature, value]) => ({
      feature,
      value: Number(value)
    }));

    DATA = {
      rows: summary.total_transactions,
      fraud: summary.fraudulent_transactions,
      normal: summary.normal_transactions,
      fraudRate: summary.fraud_percentage,
      meanAmount: summary.amount_mean,

      timeHistogram: {
        labels: (distributions.time || []).map(
          b => `${Math.round(b.bin_start)}–${Math.round(b.bin_end)}`
        ),
        values: (distributions.time || []).map(b => b.count)
      },

      amountHistogram: {
        labels: (distributions.amount || []).map(
          b => `${Math.round(b.bin_start)}–${Math.round(b.bin_end)}`
        ),
        values: (distributions.amount || []).map(b => b.count)
      },

      topNegative: [...correlations]
        .sort((a, b) => a.value - b.value)
        .slice(0, 5),

      topPositive: [...correlations]
        .sort((a, b) => b.value - a.value)
        .slice(0, 5),

      // These are the transactions currently loaded from the API.
      sample: transactionData.transactions || []
    };

    setText("total", fmt(DATA.rows));
    setText("fraud", fmt(DATA.fraud));
    setText("normal", fmt(DATA.normal));
    setText(
      "fraudRate",
      Number(DATA.fraudRate).toFixed(3) + "% of all transactions"
    );
    setText("avgAmount", money(DATA.meanAmount));

    // Fraud vs normal doughnut chart
    const classCanvas = document.getElementById("classChart");

    if (classCanvas) {
      if (charts.classChart) charts.classChart.destroy();

      charts.classChart = new Chart(classCanvas, {
        type: "doughnut",
        data: {
          labels: ["Non-fraudulent", "Fraudulent"],
          datasets: [{
            data: [DATA.normal, DATA.fraud],
            backgroundColor: ["#d0d5dd", "#101828"],
            borderWidth: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: "72%",
          plugins: {
            legend: {
              position: "bottom",
              labels: {
                font: { size: 10 },
                boxWidth: 10
              }
            }
          }
        }
      });
    }

    // Time and amount distributions
    chart(
      "timeChart",
      "bar",
      DATA.timeHistogram.labels,
      DATA.timeHistogram.values,
      "Transactions"
    );

    chart(
      "amountChart",
      "bar",
      DATA.amountHistogram.labels,
      DATA.amountHistogram.values,
      "Transactions"
    );

    // Correlation charts
    chart(
      "negChart",
      "bar",
      DATA.topNegative.map(x => x.feature),
      DATA.topNegative.map(x => x.value),
      "Correlation"
    );

    chart(
      "posChart",
      "bar",
      DATA.topPositive.map(x => x.feature),
      DATA.topPositive.map(x => x.value),
      "Correlation"
    );

    // Initial transaction table
    render(DATA.sample);

    setText("apiStatus", "Connected to live API");

  } catch (error) {
    console.error("Dashboard loading failed:", error);

    setText(
      "apiStatus",
      "API connection failed — check browser console"
    );

    setText("total", "Unavailable");
    setText("fraud", "Unavailable");
    setText("normal", "Unavailable");
  }
}

// Render the transaction table and attach row-click handlers
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

  rows.forEach(r => {
    const tr = document.createElement("tr");

    tr.style.cursor = "pointer";
    tr.title = "Click to view transaction details";

    tr.innerHTML = `
      <td>${r.Time ?? ""}</td>
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

      // Highlight the selected row
      body.querySelectorAll("tr").forEach(row => {
        row.style.background = "";
      });

      tr.style.background = "#e0f2fe";

      showTransactionDetails(r);
    });

    body.appendChild(tr);
  });
}

// Display details for a selected transaction
function showTransactionDetails(r) {
  let panel = document.getElementById("transactionDetails");

  if (!panel) {
    panel = document.createElement("div");
    panel.id = "transactionDetails";

    panel.style.cssText = [
      "margin:16px 0",
      "padding:16px",
      "border:1px solid #d0d5dd",
      "border-radius:10px",
      "overflow-wrap:anywhere"
    ].join(";");

    const table = document.getElementById("txBody")?.closest("table");

    if (table) {
      table.insertAdjacentElement("beforebegin", panel);
    } else {
      document.getElementById("txBody")
        ?.parentElement
        ?.insertAdjacentElement("beforebegin", panel);
    }
  }

  const featureRows = Object.entries(r).map(([key, value]) => {
    const displayValue =
      typeof value === "number"
        ? value.toFixed(4)
        : String(value ?? "");

    return `
      <div style="padding:6px 0;border-bottom:1px solid #eaecf0">
        <strong>${key}:</strong> ${displayValue}
      </div>
    `;
  }).join("");

  panel.innerHTML = `
    <h3>Selected Transaction</h3>

    <p><strong>Time:</strong> ${r.Time ?? "N/A"}</p>
    <p><strong>Amount:</strong> ${money(r.Amount)}</p>
    <p><strong>Actual class:</strong>
      <span class="badge ${Number(r.Class) ? "fraud" : "normal"}">
        ${Number(r.Class) ? "Fraud" : "Normal"}
      </span>
    </p>

    <h4>Transaction Features</h4>
    ${featureRows}
  `;
}

// Search within the transactions already loaded
function setupSearch() {
  const searchInput = document.getElementById("search");
  if (!searchInput) return;

  searchInput.addEventListener("input", event => {
    if (!DATA) return;

    const query = event.target.value.trim().toLowerCase();

    const filtered = DATA.sample.filter(row =>
      Object.entries(row).some(([key, value]) =>
        `${key} ${value ?? ""}`.toLowerCase().includes(query)
      )
    );

    render(filtered.slice(0, 150));
  });
}

setupSearch();
init();

