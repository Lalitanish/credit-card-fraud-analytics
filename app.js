
const API_BASE = "https://creditcardfraudapi.duckdns.org";

let DATA = null;
let charts = {};

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
          ticks: { maxTicksLimit: 8, font: { size: 9 } }
        },
        y: {
          grid: { color: "#f2f4f7" },
          ticks: { font: { size: 9 } }
        }
      }
    }
  });
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

async function init() {
  setText("total", "Loading...");
  setText("fraud", "Loading...");
  setText("normal", "Loading...");

  try {
    const [summary, distributions, correlation, transactionData] =
      await Promise.all([
        getJSON("/api/summary"),
        getJSON("/api/distributions"),
        getJSON("/api/correlation"),
        getJSON("/api/transactions?limit=150")
      ]);

    const correlations = Object.entries(
      correlation.feature_correlation_with_class || {}
    ).map(([feature, value]) => ({ feature, value }));

    DATA = {
      rows: summary.total_transactions,
      fraud: summary.fraudulent_transactions,
      normal: summary.normal_transactions,
      fraudRate: summary.fraud_percentage,
      meanAmount: summary.amount_mean,

      timeHistogram: {
        labels: distributions.time.map(
          b => `${Math.round(b.bin_start)}–${Math.round(b.bin_end)}`
        ),
        values: distributions.time.map(b => b.count)
      },

      amountHistogram: {
        labels: distributions.amount.map(
          b => `${Math.round(b.bin_start)}–${Math.round(b.bin_end)}`
        ),
        values: distributions.amount.map(b => b.count)
      },

      topNegative: [...correlations]
        .sort((a, b) => a.value - b.value)
        .slice(0, 5),

      topPositive: [...correlations]
        .sort((a, b) => b.value - a.value)
        .slice(0, 5),

      sample: transactionData.transactions || []
    };

    setText("total", fmt(DATA.rows));
    setText("fraud", fmt(DATA.fraud));
    setText("normal", fmt(DATA.normal));
    setText("fraudRate", DATA.fraudRate.toFixed(3) + "% of all transactions");
    setText("avgAmount", money(DATA.meanAmount));

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
              labels: { font: { size: 10 }, boxWidth: 10 }
            }
          }
        }
      });
    }

    chart(
      "timeChart", "bar",
      DATA.timeHistogram.labels,
      DATA.timeHistogram.values,
      "Transactions"
    );

    chart(
      "amountChart", "bar",
      DATA.amountHistogram.labels,
      DATA.amountHistogram.values,
      "Transactions"
    );

    chart(
      "negChart", "bar",
      DATA.topNegative.map(x => x.feature),
      DATA.topNegative.map(x => x.value),
      "Correlation"
    );

    chart(
      "posChart", "bar",
      DATA.topPositive.map(x => x.feature),
      DATA.topPositive.map(x => x.value),
      "Correlation"
    );

    render(DATA.sample);
    setText("apiStatus", "Connected to live API");

  } catch (error) {
    console.error("Dashboard loading failed:", error);
    setText("apiStatus", "API connection failed — check browser console");
    setText("total", "Unavailable");
    setText("fraud", "Unavailable");
    setText("normal", "Unavailable");
  }
}

function render(rows) {
  const body = document.getElementById("txBody");
  if (!body) return;

  body.innerHTML = rows.map(r => `
    <tr>
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
    </tr>
  `).join("");
}

const searchInput = document.getElementById("search");

if (searchInput) {
  searchInput.addEventListener("input", event => {
    if (!DATA) return;

    const query = event.target.value.toLowerCase();

    render(DATA.sample.filter(row =>
      Object.values(row).some(value =>
        String(value).toLowerCase().includes(query)
      )
    ).slice(0, 150));
  });
}

init();

