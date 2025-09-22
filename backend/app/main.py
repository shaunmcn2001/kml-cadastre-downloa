import os
import uuid
from datetime import datetime
from typing import List, Dict, Any
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, HTMLResponse
import uvicorn

from .models import (
    ParseRequest, ParseResponse, QueryRequest, FeatureCollection,
    ExportRequest, ErrorResponse, HealthResponse, ParcelState,
    SearchRequest, SearchResult
)
from .parsers import parse_parcel_input
from .arcgis import query_parcels_bulk, ArcGISClient, ArcGISError
from .merge import dissolve_features, simplify_features
from .exports.kml import export_kml
from .exports.kmz import export_kmz  
from .exports.tiff import export_geotiff
from .utils.logging import setup_logging, get_logger
from .utils.cache import get_cache
from .utils.rate_limit import get_rate_limiter

# Environment configuration
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")
CACHE_TTL = int(os.getenv("CACHE_TTL", "900"))
MAX_IDS_PER_CHUNK = int(os.getenv("MAX_IDS_PER_CHUNK", "50"))
ARCGIS_TIMEOUT = int(os.getenv("ARCGIS_TIMEOUT_S", "20"))

# Setup logging
setup_logging(LOG_LEVEL)
logger = get_logger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="KML Downloads API",
    description="Australian Cadastral Data Export Service",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# CORS configuration
origins = [origin.strip() for origin in FRONTEND_ORIGIN.split(",")]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# Initialize services
cache = get_cache(ttl=CACHE_TTL)
rate_limiter = get_rate_limiter(max_requests=100, window_seconds=60)

@app.middleware("http")
async def request_logging_middleware(request: Request, call_next):
    """Log requests with timing and add request ID."""
    request_id = str(uuid.uuid4())[:8]
    start_time = datetime.utcnow()
    
    # Add request ID to request state
    request.state.request_id = request_id
    
    logger.info(
        f"Request started",
        extra={
            'request_id': request_id,
            'method': request.method,
            'url': str(request.url),
            'client_ip': request.client.host if request.client else None
        }
    )
    
    try:
        response = await call_next(request)
        duration = (datetime.utcnow() - start_time).total_seconds() * 1000
        
        logger.info(
            f"Request completed",
            extra={
                'request_id': request_id,
                'method': request.method,
                'url': str(request.url),
                'status_code': response.status_code,
                'duration_ms': round(duration, 2)
            }
        )
        
        # Add request ID to response headers
        response.headers["X-Request-ID"] = request_id
        return response
        
    except Exception as e:
        duration = (datetime.utcnow() - start_time).total_seconds() * 1000
        
        logger.error(
            f"Request failed",
            extra={
                'request_id': request_id,
                'method': request.method,
                'url': str(request.url),
                'duration_ms': round(duration, 2),
                'error': str(e)
            },
            exc_info=True
        )
        raise

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """Handle HTTP exceptions with structured error response."""
    request_id = getattr(request.state, 'request_id', 'unknown')
    
    return JSONResponse(
        status_code=exc.status_code,
        content=ErrorResponse(
            error=exc.detail,
            request_id=request_id
        ).dict()
    )

@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """Handle general exceptions with structured error response."""
    request_id = getattr(request.state, 'request_id', 'unknown')
    
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    
    return JSONResponse(
        status_code=500,
        content=ErrorResponse(
            error="Internal server error",
            detail=str(exc) if LOG_LEVEL == "DEBUG" else None,
            request_id=request_id
        ).dict()
    )

@app.get("/healthz", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    return HealthResponse(
        status="ok",
        timestamp=datetime.utcnow().isoformat(),
        version="1.0.0"
    )


@app.get("/ui", response_class=HTMLResponse)
async def ui_page():
    """Serve a minimal HTML user interface for testing the API."""
    return """
    <!DOCTYPE html>
    <html lang=\"en\">
        <head>
            <meta charset=\"utf-8\" />
            <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
            <title>KML Downloads UI</title>
            <style>
                :root {
                    color-scheme: light dark;
                }
                * { box-sizing: border-box; }
                body {
                    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                    margin: 0;
                    background: #f9fafb;
                    color: #111827;
                }
                main {
                    max-width: 1100px;
                    margin: 0 auto;
                    padding: 2rem 1.5rem 3rem;
                }
                h1 {
                    margin-bottom: 0.5rem;
                    color: #0f172a;
                }
                h2 {
                    color: #1f2937;
                    margin-bottom: 0.75rem;
                }
                section {
                    background: #ffffff;
                    border-radius: 0.75rem;
                    padding: 1.5rem;
                    margin-bottom: 1.5rem;
                    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
                }
                label {
                    display: block;
                    font-weight: 600;
                    margin-bottom: 0.35rem;
                }
                select, input[type="text"] {
                    width: 100%;
                    padding: 0.6rem 0.75rem;
                    border-radius: 0.5rem;
                    border: 1px solid #d1d5db;
                    font-size: 1rem;
                }
                select:focus, input[type="text"]:focus {
                    outline: none;
                    border-color: #2563eb;
                    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.2);
                }
                button {
                    border: none;
                    border-radius: 0.5rem;
                    background: #2563eb;
                    color: white;
                    padding: 0.55rem 1rem;
                    font-weight: 600;
                    cursor: pointer;
                    transition: background 0.2s ease;
                }
                button[disabled] {
                    opacity: 0.6;
                    cursor: not-allowed;
                }
                button.secondary {
                    background: #64748b;
                }
                button:hover:not([disabled]) {
                    background: #1d4ed8;
                }
                .form-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
                    gap: 1rem;
                    margin-bottom: 1rem;
                }
                .form-actions {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 0.75rem;
                    margin-top: 0.75rem;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-top: 0.5rem;
                }
                th, td {
                    text-align: left;
                    padding: 0.75rem;
                    border-bottom: 1px solid #e5e7eb;
                }
                th {
                    background: #f1f5f9;
                    font-size: 0.9rem;
                    text-transform: uppercase;
                    letter-spacing: 0.04em;
                }
                tbody tr:hover {
                    background: #f8fafc;
                }
                .status {
                    margin-top: 0.75rem;
                    font-size: 0.95rem;
                    color: #334155;
                }
                .status.error {
                    color: #b91c1c;
                }
                .status.success {
                    color: #047857;
                }
                .selection {
                    display: flex;
                    flex-direction: column;
                    gap: 0.75rem;
                }
                .selection-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    flex-wrap: wrap;
                    gap: 0.5rem;
                }
                .selection-list {
                    list-style: none;
                    padding: 0;
                    margin: 0;
                    border: 1px solid #e5e7eb;
                    border-radius: 0.5rem;
                    max-height: 200px;
                    overflow-y: auto;
                    background: #f8fafc;
                }
                .selection-list li {
                    padding: 0.6rem 0.75rem;
                    border-bottom: 1px solid #e2e8f0;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    gap: 0.5rem;
                }
                .selection-list li:last-child {
                    border-bottom: none;
                }
                .selection-list li.empty {
                    justify-content: center;
                    color: #64748b;
                }
                .selection-list button {
                    background: #ef4444;
                }
                .summary-list {
                    margin: 0.5rem 0 0;
                    padding-left: 1.2rem;
                }
                pre {
                    background: #0f172a;
                    color: #f8fafc;
                    padding: 1rem;
                    border-radius: 0.5rem;
                    overflow-x: auto;
                    font-size: 0.85rem;
                }
                .links a {
                    display: inline-block;
                    margin-right: 1rem;
                    font-weight: 600;
                    color: #1d4ed8;
                }
                @media (prefers-color-scheme: dark) {
                    body { background: #0f172a; color: #e2e8f0; }
                    section { background: #111827; box-shadow: none; }
                    th { background: #1e293b; }
                    tbody tr:hover { background: #1e293b; }
                    select, input[type="text"] {
                        background: #1f2937;
                        border-color: #374151;
                        color: inherit;
                    }
                    .selection-list { background: #1e293b; border-color: #334155; }
                    pre { background: #0b1120; }
                }
            </style>
        </head>
        <body>
            <main>
                <header>
                    <h1>KML Downloads UI</h1>
                    <p>Use this interface to smoke-test the parcel search, query, and export APIs.</p>
                </header>

                <section aria-labelledby=\"search-heading\">
                    <h2 id=\"search-heading\">Search parcels</h2>
                    <p>Enter a state and search term (lot/plan, address, etc.) then run a search.</p>
                    <form id=\"search-form\">
                        <div class=\"form-grid\">
                            <label>
                                Parcel state
                                <select id=\"search-state\" name=\"state\">
                                    <option value=\"NSW\" selected>New South Wales (NSW)</option>
                                    <option value=\"QLD\">Queensland (QLD)</option>
                                    <option value=\"SA\">South Australia (SA)</option>
                                </select>
                            </label>
                            <label>
                                Search term
                                <input id=\"search-term\" name=\"term\" type=\"text\" placeholder=\"e.g. 1/12345 or street name\" required />
                            </label>
                        </div>
                        <div class=\"form-actions\">
                            <button type=\"submit\" id=\"run-search\">Search</button>
                            <button type=\"button\" id=\"reset-all\" class=\"secondary\">Reset</button>
                        </div>
                    </form>
                    <div id=\"search-status\" class=\"status\">Ready to search.</div>
                    <div class=\"table-wrapper\">
                        <table aria-describedby=\"search-status\">
                            <thead>
                                <tr>
                                    <th scope=\"col\">Action</th>
                                    <th scope=\"col\">Parcel ID</th>
                                    <th scope=\"col\">Label</th>
                                    <th scope=\"col\">Address / Locality</th>
                                </tr>
                            </thead>
                            <tbody id=\"results-body\">
                                <tr>
                                    <td colspan=\"4\">No results yet. Run a search to see parcels.</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </section>

                <section aria-labelledby=\"selection-heading\">
                    <h2 id=\"selection-heading\">Selected parcels</h2>
                    <div class=\"selection\">
                        <div class=\"selection-header\">
                            <p><strong id=\"selected-count\">0</strong> parcel(s) selected.</p>
                            <div class=\"form-actions\">
                                <button type=\"button\" id=\"clear-selection\" class=\"secondary\" disabled>Clear selection</button>
                                <button type=\"button\" id=\"query-button\" disabled>Query selected parcels</button>
                            </div>
                        </div>
                        <ul id=\"selected-list\" class=\"selection-list\">
                            <li class=\"empty\">Nothing selected yet.</li>
                        </ul>
                        <div id=\"query-status\" class=\"status\"></div>
                    </div>
                </section>

                <section id=\"query-results\" aria-labelledby=\"results-heading\" hidden>
                    <h2 id=\"results-heading\">Query summary &amp; exports</h2>
                    <div id=\"query-summary\"></div>
                    <div class=\"form-actions\" style=\"margin-top: 1rem;\">
                        <button type=\"button\" id=\"export-kml\" disabled>Download KML</button>
                        <button type=\"button\" id=\"export-kmz\" disabled>Download KMZ</button>
                    </div>
                    <h3 style=\"margin-top: 1.5rem;\">Sample feature properties</h3>
                    <pre id=\"query-metadata\">Run a query to inspect feature metadata here.</pre>
                </section>

                <section class=\"links\">
                    <h2>Documentation</h2>
                    <a href=\"/docs\" target=\"_blank\">Interactive API docs</a>
                    <a href=\"/redoc\" target=\"_blank\">OpenAPI schema</a>
                </section>
            </main>

            <script>
                (function () {
                    const searchForm = document.getElementById('search-form');
                    const runSearchButton = document.getElementById('run-search');
                    const resetAllButton = document.getElementById('reset-all');
                    const stateField = document.getElementById('search-state');
                    const termField = document.getElementById('search-term');
                    const resultsBody = document.getElementById('results-body');
                    const searchStatus = document.getElementById('search-status');
                    const selectedList = document.getElementById('selected-list');
                    const selectedCount = document.getElementById('selected-count');
                    const clearSelectionButton = document.getElementById('clear-selection');
                    const queryButton = document.getElementById('query-button');
                    const queryStatus = document.getElementById('query-status');
                    const querySection = document.getElementById('query-results');
                    const querySummary = document.getElementById('query-summary');
                    const metadataOutput = document.getElementById('query-metadata');
                    const exportKmlButton = document.getElementById('export-kml');
                    const exportKmzButton = document.getElementById('export-kmz');

                    let searchResults = [];
                    const selectedParcels = new Map();
                    let lastFeatureCollection = null;

                    function setStatus(element, message, type = '') {
                        element.textContent = message;
                        element.className = type ? `status ${type}` : 'status';
                    }

                    function renderSearchResults(results) {
                        resultsBody.innerHTML = '';
                        if (!results.length) {
                            const row = document.createElement('tr');
                            const cell = document.createElement('td');
                            cell.colSpan = 4;
                            cell.textContent = 'No parcels found for the last query.';
                            row.appendChild(cell);
                            resultsBody.appendChild(row);
                            return;
                        }

                        results.forEach((result) => {
                            const row = document.createElement('tr');

                            const actionCell = document.createElement('td');
                            const toggleButton = document.createElement('button');
                            toggleButton.type = 'button';
                            toggleButton.className = 'secondary';
                            toggleButton.textContent = selectedParcels.has(result.id) ? 'Remove' : 'Select';
                            toggleButton.addEventListener('click', () => {
                                toggleSelection(result);
                            });
                            actionCell.appendChild(toggleButton);

                            const idCell = document.createElement('td');
                            idCell.textContent = result.id;

                            const labelCell = document.createElement('td');
                            labelCell.textContent = result.label || '—';

                            const infoCell = document.createElement('td');
                            infoCell.textContent = result.address || result.locality || '';

                            row.appendChild(actionCell);
                            row.appendChild(idCell);
                            row.appendChild(labelCell);
                            row.appendChild(infoCell);

                            resultsBody.appendChild(row);
                        });
                    }

                    function renderSelection() {
                        selectedList.innerHTML = '';
                        const ids = Array.from(selectedParcels.keys());
                        if (!ids.length) {
                            const empty = document.createElement('li');
                            empty.className = 'empty';
                            empty.textContent = 'Nothing selected yet.';
                            selectedList.appendChild(empty);
                        } else {
                            ids.forEach((id) => {
                                const result = selectedParcels.get(id);
                                const item = document.createElement('li');
                                const text = document.createElement('span');
                                text.textContent = `${result.id} • ${result.label ?? ''}`.trim();
                                const removeButton = document.createElement('button');
                                removeButton.type = 'button';
                                removeButton.textContent = 'Remove';
                                removeButton.addEventListener('click', () => {
                                    selectedParcels.delete(id);
                                    renderSelection();
                                    renderSearchResults(searchResults);
                                    updateQueryButtonState();
                                });
                                item.appendChild(text);
                                item.appendChild(removeButton);
                                selectedList.appendChild(item);
                            });
                        }

                        selectedCount.textContent = ids.length.toString();
                        clearSelectionButton.disabled = ids.length === 0;
                    }

                    function toggleSelection(result) {
                        if (selectedParcels.has(result.id)) {
                            selectedParcels.delete(result.id);
                        } else {
                            selectedParcels.set(result.id, result);
                        }
                        renderSelection();
                        renderSearchResults(searchResults);
                        updateQueryButtonState();
                    }

                    function updateQueryButtonState() {
                        queryButton.disabled = selectedParcels.size === 0;
                        if (!queryButton.dataset.defaultText) {
                            queryButton.dataset.defaultText = queryButton.textContent;
                        }
                        queryButton.textContent = queryButton.dataset.defaultText;
                    }

                    function getSelectedStates() {
                        const fallbackState = stateField.value.trim().toUpperCase();
                        if (selectedParcels.size === 0) {
                            return [fallbackState];
                        }

                        const states = new Set();
                        selectedParcels.forEach((item) => {
                            const candidate =
                                typeof item.state === 'string' && item.state.trim()
                                    ? item.state.trim().toUpperCase()
                                    : fallbackState;
                            states.add(candidate);
                        });

                        if (!states.size) {
                            states.add(fallbackState);
                        }

                        return Array.from(states);
                    }

                    async function runSearch() {
                        const state = stateField.value.trim().toUpperCase();
                        const term = termField.value.trim();
                        if (!term) {
                            setStatus(searchStatus, 'Enter a search term to continue.', 'error');
                            return;
                        }

                        setStatus(searchStatus, 'Searching parcels…');
                        runSearchButton.disabled = true;
                        renderSearchResults([]);

                        try {
                            const response = await fetch('/api/search', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ state, term, page: 1, pageSize: 10 })
                            });

                            if (!response.ok) {
                                const message = await response.text();
                                throw new Error(message || `Search failed with status ${response.status}`);
                            }

                            const data = await response.json();
                            searchResults = Array.isArray(data) ? data : [];
                            renderSearchResults(searchResults);
                            if (searchResults.length) {
                                setStatus(searchStatus, `Found ${searchResults.length} result(s). Select parcels to query.`, 'success');
                            } else {
                                setStatus(searchStatus, 'No parcels matched that search.', 'error');
                            }
                        } catch (error) {
                            console.error(error);
                            renderSearchResults([]);
                            setStatus(searchStatus, `Search failed: ${error.message}`, 'error');
                        } finally {
                            runSearchButton.disabled = false;
                        }
                    }

                    function summariseFeatureCollection(collection) {
                        const features = Array.isArray(collection?.features) ? collection.features : [];
                        const total = features.length;
                        const byState = new Map();
                        let areaCount = 0;
                        let areaSum = 0;

                        features.forEach((feature) => {
                            const state = feature?.properties?.state || 'Unknown';
                            byState.set(state, (byState.get(state) || 0) + 1);
                            const area = feature?.properties?.area_ha;
                            if (typeof area === 'number') {
                                areaCount += 1;
                                areaSum += area;
                            }
                        });

                        let summaryHtml = `<p><strong>${total}</strong> feature(s) loaded.</p>`;
                        if (byState.size) {
                            summaryHtml += '<p>Distribution by state:</p><ul class="summary-list">';
                            byState.forEach((count, state) => {
                                summaryHtml += `<li>${state}: ${count}</li>`;
                            });
                            summaryHtml += '</ul>';
                        }
                        if (areaCount) {
                            summaryHtml += `<p>Total mapped area: ${areaSum.toFixed(2)} ha across ${areaCount} feature(s).</p>`;
                        }
                        if (!total) {
                            summaryHtml += '<p>No features were returned for the selected parcels.</p>';
                        }

                        querySummary.innerHTML = summaryHtml;
                        if (total) {
                            const sample = features.slice(0, 3).map((feature) => feature.properties);
                            metadataOutput.textContent = JSON.stringify(sample, null, 2);
                        } else {
                            metadataOutput.textContent = 'Run a query to inspect feature metadata here.';
                        }
                    }

                    async function runQuery() {
                        if (selectedParcels.size === 0) {
                            return;
                        }

                        queryButton.disabled = true;
                        if (!queryButton.dataset.defaultText) {
                            queryButton.dataset.defaultText = queryButton.textContent;
                        }
                        queryButton.textContent = 'Loading…';
                        setStatus(queryStatus, 'Querying selected parcels…');
                        exportKmlButton.disabled = true;
                        exportKmzButton.disabled = true;

                        const ids = Array.from(selectedParcels.keys());
                        const states = getSelectedStates();
                        const payload = { states, ids };

                        try {
                            const response = await fetch('/api/query', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(payload)
                            });

                            if (!response.ok) {
                                const message = await response.text();
                                throw new Error(message || `Query failed with status ${response.status}`);
                            }

                            const data = await response.json();
                            lastFeatureCollection = data;
                            summariseFeatureCollection(data);
                            querySection.hidden = false;
                            setStatus(queryStatus, `Query returned ${data.features?.length ?? 0} feature(s).`, 'success');
                            exportKmlButton.disabled = false;
                            exportKmzButton.disabled = false;
                        } catch (error) {
                            console.error(error);
                            setStatus(queryStatus, `Query failed: ${error.message}`, 'error');
                            lastFeatureCollection = null;
                        } finally {
                            updateQueryButtonState();
                        }
                    }

                    async function exportFeatures(format) {
                        if (!lastFeatureCollection || !Array.isArray(lastFeatureCollection.features)) {
                            setStatus(queryStatus, 'Nothing to export yet. Run a query first.', 'error');
                            return;
                        }

                        const button = format === 'kml' ? exportKmlButton : exportKmzButton;
                        const defaultText = button.dataset.defaultText || button.textContent;
                        button.dataset.defaultText = defaultText;
                        button.textContent = 'Preparing download…';
                        button.disabled = true;

                        try {
                            const response = await fetch(`/api/${format}`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ features: lastFeatureCollection.features })
                            });

                            if (!response.ok) {
                                const message = await response.text();
                                throw new Error(message || `Export failed with status ${response.status}`);
                            }

                            const blob = await response.blob();
                            const extension = format === 'kml' ? 'kml' : 'kmz';
                            const url = URL.createObjectURL(blob);
                            const anchor = document.createElement('a');
                            anchor.href = url;
                            anchor.download = `parcels-${new Date().toISOString().slice(0, 10)}.${extension}`;
                            document.body.appendChild(anchor);
                            anchor.click();
                            anchor.remove();
                            URL.revokeObjectURL(url);
                            setStatus(queryStatus, `Download ready: ${extension.toUpperCase()} file generated.`, 'success');
                        } catch (error) {
                            console.error(error);
                            setStatus(queryStatus, `Export failed: ${error.message}`, 'error');
                        } finally {
                            button.textContent = button.dataset.defaultText;
                            button.disabled = false;
                        }
                    }

                    function resetUi() {
                        searchResults = [];
                        selectedParcels.clear();
                        termField.value = '';
                        renderSearchResults([]);
                        renderSelection();
                        updateQueryButtonState();
                        querySection.hidden = true;
                        lastFeatureCollection = null;
                        metadataOutput.textContent = 'Run a query to inspect feature metadata here.';
                        querySummary.innerHTML = '';
                        setStatus(searchStatus, 'Ready to search.');
                        setStatus(queryStatus, '');
                        exportKmlButton.disabled = true;
                        exportKmzButton.disabled = true;
                    }

                    searchForm.addEventListener('submit', (event) => {
                        event.preventDefault();
                        runSearch();
                    });

                    resetAllButton.addEventListener('click', () => {
                        resetUi();
                    });

                    clearSelectionButton.addEventListener('click', () => {
                        selectedParcels.clear();
                        renderSelection();
                        renderSearchResults(searchResults);
                        updateQueryButtonState();
                        setStatus(queryStatus, 'Selection cleared.');
                    });

                    queryButton.addEventListener('click', () => {
                        runQuery();
                    });

                    exportKmlButton.addEventListener('click', () => {
                        exportFeatures('kml');
                    });

                    exportKmzButton.addEventListener('click', () => {
                        exportFeatures('kmz');
                    });

                    renderSearchResults([]);
                    renderSelection();
                    setStatus(queryStatus, '');
                })();
            </script>
        </body>
    </html>
    """

@app.post("/api/parse", response_model=ParseResponse)
async def parse_input(request: ParseRequest, req: Request):
    """Parse and validate parcel identifiers."""
    # Rate limiting
    client_ip = req.client.host if req.client else "unknown"
    if not rate_limiter.is_allowed(client_ip):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")
    
    try:
        logger.info(f"Parsing {request.state} input: {len(request.rawText)} characters")
        
        valid, malformed = parse_parcel_input(request.state, request.rawText)
        
        logger.info(f"Parse result: {len(valid)} valid, {len(malformed)} malformed")
        
        return ParseResponse(valid=valid, malformed=malformed)
        
    except Exception as e:
        logger.error(f"Parse failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/search", response_model=List[SearchResult])
async def search_parcels_endpoint(request: SearchRequest, req: Request):
    """Search for parcels using ArcGIS services."""

    client_ip = req.client.host if req.client else "unknown"
    if not rate_limiter.is_allowed(client_ip):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")

    if request.state != ParcelState.NSW:
        raise HTTPException(status_code=400, detail="Search is currently supported only for NSW")

    cache_key = {
        'state': request.state.value,
        'term': request.term.upper(),
        'page': request.page,
        'pageSize': request.pageSize
    }

    cached_result = cache.get(cache_key)
    if cached_result is not None:
        logger.info("Returning cached search result")
        return cached_result

    try:
        async with ArcGISClient(timeout=ARCGIS_TIMEOUT, max_ids_per_chunk=MAX_IDS_PER_CHUNK) as client:
            results = await client.search_parcels(
                request.state,
                request.term,
                page=request.page,
                page_size=request.pageSize
            )

        cache.set(cache_key, results)
        logger.info(f"Search completed: {len(results)} results returned")
        return results

    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except ArcGISError as exc:
        logger.error(f"ArcGIS search failed: {exc}")
        raise HTTPException(status_code=502, detail=str(exc))
    except Exception as exc:
        logger.error(f"Search failed: {exc}")
        raise HTTPException(status_code=500, detail="Failed to search parcels")


@app.post("/api/query", response_model=FeatureCollection)
async def query_parcels(request: QueryRequest, req: Request):
    """Query parcel data from ArcGIS services."""
    # Rate limiting
    client_ip = req.client.host if req.client else "unknown"
    if not rate_limiter.is_allowed(client_ip):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")
    
    if not request.ids:
        raise HTTPException(status_code=400, detail="No parcel IDs provided")
    
    if len(request.ids) > 1000:
        raise HTTPException(status_code=400, detail="Too many parcel IDs (max 1000)")
    
    try:
        # Check cache
        cache_key = {
            'states': [s.value for s in request.states],
            'ids': sorted(request.ids),
            'aoi': request.aoi,
            'options': request.options.dict() if request.options else None
        }
        
        cached_result = cache.get(cache_key)
        if cached_result:
            logger.info("Returning cached query result")
            return cached_result
        
        logger.info(f"Querying {len(request.ids)} parcels from states: {request.states}")
        
        # Group IDs by state (assuming IDs are prefixed or can be determined)
        # For now, query all states for all IDs
        parcel_ids_by_state = {state: request.ids for state in request.states}
        
        # Query ArcGIS services
        features = await query_parcels_bulk(
            parcel_ids_by_state,
            bbox=request.aoi,
            timeout=ARCGIS_TIMEOUT,
            max_ids_per_chunk=MAX_IDS_PER_CHUNK
        )
        
        # Process features
        if request.options and request.options.simplifyTol:
            features = simplify_features(features, request.options.simplifyTol)
        
        result = FeatureCollection(features=features)
        
        # Cache result
        cache.set(cache_key, result)
        
        logger.info(f"Query completed: {len(features)} features returned")
        return result
        
    except Exception as e:
        logger.error(f"Query failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/kml")
async def export_kml_endpoint(request: ExportRequest, req: Request):
    """Export features as KML."""
    # Rate limiting
    client_ip = req.client.host if req.client else "unknown"
    if not rate_limiter.is_allowed(client_ip):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")
    
    if not request.features:
        raise HTTPException(status_code=400, detail="No features to export")
    
    try:
        kml_content = export_kml(request.features, request.styleOptions)
        
        return Response(
            content=kml_content,
            media_type="application/vnd.google-earth.kml+xml",
            headers={
                "Content-Disposition": f"attachment; filename=parcels-{datetime.now().strftime('%Y%m%d')}.kml"
            }
        )
    except Exception as e:
        logger.error(f"KML export failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/kmz")
async def export_kmz_endpoint(request: ExportRequest, req: Request):
    """Export features as KMZ."""
    # Rate limiting
    client_ip = req.client.host if req.client else "unknown"
    if not rate_limiter.is_allowed(client_ip):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")
    
    if not request.features:
        raise HTTPException(status_code=400, detail="No features to export")
    
    try:
        kmz_content = export_kmz(request.features, request.styleOptions)
        
        return Response(
            content=kmz_content,
            media_type="application/vnd.google-earth.kmz",
            headers={
                "Content-Disposition": f"attachment; filename=parcels-{datetime.now().strftime('%Y%m%d')}.kmz"
            }
        )
    except Exception as e:
        logger.error(f"KMZ export failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/geotiff")
async def export_geotiff_endpoint(request: ExportRequest, req: Request):
    """Export features as GeoTIFF."""
    # Rate limiting  
    client_ip = req.client.host if req.client else "unknown"
    if not rate_limiter.is_allowed(client_ip):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")
    
    if not request.features:
        raise HTTPException(status_code=400, detail="No features to export")
    
    try:
        tiff_content = export_geotiff(request.features, request.styleOptions)
        
        return Response(
            content=tiff_content,
            media_type="image/tiff",
            headers={
                "Content-Disposition": f"attachment; filename=parcels-{datetime.now().strftime('%Y%m%d')}.tif"
            }
        )
    except Exception as e:
        logger.error(f"GeoTIFF export failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)