// Uzimamo backend URL iz globalnog scope-a (definisanog u index.html)
const BACKEND_URL = window.BACKEND_URL;

const form = document.getElementById("url-form");
const urlInput = document.getElementById("url-input");
const loader = document.getElementById("loader");
const resultsDiv = document.getElementById("results");
const errorDiv = document.getElementById("error");

const metricsTableBody = document.querySelector("#metrics-table tbody");
const resultsUrl = document.getElementById("results-url");
const testRun = document.getElementById("test-run");
const device = document.getElementById("device");

const rumTableBody = document.querySelector("#rum-table tbody");

// Submitting the URL for synthetic analysis
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (!url) return;

  loader.style.display = "block";
  resultsDiv.style.display = "none";
  errorDiv.textContent = "";

  try {
    const res = await fetch(
      `${BACKEND_URL}/analyze?url=${encodeURIComponent(url)}`
    );
    const data = await res.json();

    if (data.error) {
      throw new Error(data.error + (data.details ? ": " + data.details : ""));
    }

    resultsUrl.textContent = `Results overview for ${data.url}`;
    testRun.textContent = `Test run: ${data.testRun}`;
    device.textContent = `Device simulated: ${data.device}`;

    metricsTableBody.innerHTML = "";
    data.metrics.forEach((metric) => {
      const row = document.createElement("tr");
      row.innerHTML = `<td>${metric.name}</td><td>${metric.value}</td><td>${metric.status}</td>`;
      metricsTableBody.appendChild(row);
    });

    loader.style.display = "none";
    resultsDiv.style.display = "block";
  } catch (err) {
    loader.style.display = "none";
    resultsDiv.style.display = "none";
    errorDiv.textContent = "Error analyzing the page: " + err.message;
    console.error(err);
  }
});

// Real-time RUM stream from Render backend
function initRUMStream() {
  const evtSource = new EventSource(`${BACKEND_URL}/rum-stream`);
  evtSource.onmessage = function (event) {
    const item = JSON.parse(event.data);

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${new Date(item.timestamp).toLocaleString()}</td>
      <td>${item.inp}</td>
      <td>${item.element}</td>
      <td>${item.device || "unknown"}</td>
      <td>${item.browser || "unknown"}</td>
      <td>${item.os || "unknown"}</td>
      <td>${item.connection || "unknown"}</td>
      <td>${item.pageUrl || ""}</td>
    `;
    rumTableBody.appendChild(row);

    // Opcionalno: scroll na dno tabele
    rumTableBody.parentElement.scrollTop =
      rumTableBody.parentElement.scrollHeight;
  };
}

// Učitaj postojeće RUM podatke sa backend-a
async function loadRUMData() {
  try {
    const res = await fetch(`${BACKEND_URL}/rum-data`);
    const data = await res.json();

    rumTableBody.innerHTML = "";

    data.forEach((item) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${new Date(item.timestamp).toLocaleString()}</td>
        <td>${item.inp}</td>
        <td>${item.element}</td>
        <td>${item.device || "unknown"}</td>
        <td>${item.browser || "unknown"}</td>
        <td>${item.os || "unknown"}</td>
        <td>${item.connection || "unknown"}</td>
        <td>${item.pageUrl || ""}</td>
      `;
      rumTableBody.appendChild(row);
    });
  } catch (err) {
    console.error("Error loading RUM data:", err);
  }
}

// Pokreni SSE stream i učitaj istorijske podatke
loadRUMData();
initRUMStream();
