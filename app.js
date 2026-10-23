
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

function setupPrediction() {
  const select = document.getElementById("predictionTransaction");
  const button = document.getElementById("predictButton");
  const status = document.getElementById("predictionStatus");
  const result = document.getElementById("predictionResult");

  if (!select || !button || !status || !result) return;

 const rows = DATA?.sample || [];

if (rows.length === 0) {
  select.innerHTML = '<option value="">No transactions available</option>';
  button.disabled = true;
  status.textContent = "Transactions could not be loaded. Please refresh the dashboard.";
  return;
}

button.disabled = false;

  select.innerHTML = '<option value="">Choose a transaction...</option>';

  rows.forEach((row, index) => {
    const option = document.createElement("option");
    option.value = index;

    const amount = Number(row.Amount || 0).toFixed(2);
    const actualClass = Number(row.Class) === 1 ? "Fraud" : "Normal";

    option.textContent =
      `Transaction ${index + 1} — Amount: $${amount} — Actual: ${actualClass}`;

    select.appendChild(option);
  });

  button.addEventListener("click", async () => {
    const index = select.value;

    if (index === "") {
      status.textContent = "Please select a transaction first.";
      result.hidden = true;
      return;
    }

    const row = rows[Number(index)];
    const payload = {
      Time: Number(row.Time),
      Amount: Number(row.Amount)
    };

    for (let i = 1; i <= 28; i++) {
      const key = `V${i}`;

      if (row[key] === undefined || row[key] === null) {
        status.textContent = `Transaction is missing ${key}.`;
        result.hidden = true;
        return;
      }

      payload[key] = Number(row[key]);
    }

    button.disabled = true;
    status.textContent = "Analyzing transaction...";
    result.hidden = true;

    try {
      const response = await fetch(`${API_BASE}/api/predict`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Prediction request failed.");
      }

      const isFraud = Number(data.prediction) === 1;
      const probability = data.fraud_probability;

      result.replaceChildren();

      const heading = document.createElement("h3");
      heading.textContent = isFraud
        ? "Prediction: Fraudulent"
        : "Prediction: Non-Fraudulent";

      const modelText = document.createElement("p");
      modelText.textContent = `Model: ${data.model || "Default model"}`;

      result.append(heading, modelText);

      if (probability !== null && probability !== undefined) {
        const probabilityText = document.createElement("p");
        probabilityText.textContent =
          `Estimated fraud probability: ${(Number(probability) * 100).toFixed(2)}%`;
        result.appendChild(probabilityText);
      }

      const actualText = document.createElement("p");
      actualText.textContent =
        `Dataset label for comparison: ${
          Number(row.Class) === 1 ? "Fraudulent" : "Non-Fraudulent"
        }`;

      result.appendChild(actualText);
      result.hidden = false;
      status.textContent = "Prediction completed.";
    } catch (error) {
      status.textContent = `Prediction failed: ${error.message}`;
    } finally {
      button.disabled = false;
    }
  });
}


function setupNewPredictionForm() {
  const form = document.getElementById("newPredictionForm");
  const timeInput = document.getElementById("newTime");
  const amountInput = document.getElementById("newAmount");
  const fields1 = document.getElementById("newFeatureFields");
  const fields2 = document.getElementById("newFeatureFields2");
  const fillButton = document.getElementById("fillSampleButton");
  const button = document.getElementById("newPredictButton");
  const status = document.getElementById("newPredictionStatus");
  const result = document.getElementById("newPredictionResult");

  if (!form || !fields1 || !fields2 || !fillButton ||
      !button || !status || !result) return;

  // Create input fields V1 through V28.
  for (let i = 1; i <= 28; i++) {
    const key = `V${i}`;
    const wrapper = document.createElement("div");
    wrapper.className = "mb-2";

    const label = document.createElement("label");
    label.htmlFor = `new${key}`;
    label.textContent = key;

    const input = document.createElement("input");
    input.id = `new${key}`;
    input.name = key;
    input.type = "number";
    input.step = "any";
    input.required = true;
    input.className = "form-control";

    wrapper.append(label, input);
    (i <= 14 ? fields1 : fields2).appendChild(wrapper);
  }

  // Fill the form from a transaction selected in the dashboard table.
  fillButton.addEventListener("click", () => {
    const row =   (typeof selectedTransaction !== "undefined" && selectedTransaction)     ? selectedTransaction     : DATA?.sample?.[0];

    if (!row) {
      status.textContent = "No sample transaction is available.";
      return;
    }

    timeInput.value = row.Time ?? "";
    amountInput.value = row.Amount ?? "";

    for (let i = 1; i <= 28; i++) {
      const key = `V${i}`;
      const input = document.getElementById(`new${key}`);
      input.value = row[key] ?? "";
    }

    status.textContent = selectedTransaction
      ? "Filled using the transaction selected in the table."
      : "Filled using the first available sample transaction.";
    result.hidden = true;
  });

  // Send the entered values to the existing FastAPI endpoint.
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    result.hidden = true;

    const payload = {
      Time: Number(timeInput.value),
      Amount: Number(amountInput.value)
    };

    for (let i = 1; i <= 28; i++) {
      const key = `V${i}`;
      const value = document.getElementById(`new${key}`).value;

      if (value.trim() === "" || !Number.isFinite(Number(value))) {
        status.textContent = `Please enter a valid value for ${key}.`;
        return;
      }

      payload[key] = Number(value);
    }

    button.disabled = true;
    status.textContent = "Analyzing transaction...";

    try {
      const response = await fetch(`${API_BASE}/api/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Prediction request failed.");
      }

      result.replaceChildren();

      const heading = document.createElement("h3");
      heading.textContent = Number(data.prediction) === 1
        ? "Prediction: Fraudulent"
        : "Prediction: Non-Fraudulent";

      const model = document.createElement("p");
      model.textContent = `Model: ${data.model || "Default model"}`;
      result.append(heading, model);

      if (data.fraud_probability !== null &&
          data.fraud_probability !== undefined) {
        const probability = document.createElement("p");
        probability.textContent =
          `Estimated fraud probability: ${
            (Number(data.fraud_probability) * 100).toFixed(2)
          }%`;
        result.appendChild(probability);
      }

      result.hidden = false;
      status.textContent = "Prediction completed.";
    } catch (error) {
      status.textContent = `Prediction failed: ${error.message}`;
    } finally {
      button.disabled = false;
    }
  });
}

setupSearch();

init().then(() => {
  setupPrediction();
  setupNewPredictionForm();
});
