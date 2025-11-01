import json
import uuid
from datetime import datetime
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, HTMLResponse
from pydantic import BaseModel
import uvicorn
import httpx

from .models import (
    ParseRequest, ParseResponse, QueryRequest, FeatureCollection,
    ExportRequest, ErrorResponse, HealthResponse, ParcelState,
    SearchRequest, SearchResult,
    PropertyLayerInfo, PropertyReportRequest, PropertyReportResponse
)
from .parsers import parse_parcel_input
from .parsers.qld import parse_qld
from .arcgis import query_parcels_bulk, ArcGISClient, ArcGISError
from .merge import dissolve_features, simplify_features
from .exports.kml import export_kml
from .exports.kmz import export_kmz  
from .exports.tiff import export_geotiff
from .utils.logging import setup_logging, get_logger
from .property_report import generate_property_report, list_property_layers
from .property_report_export import export_property_report
from .smartmaps import generate_smartmap_zip, SmartMapDownloadError
from .landtype.router import router as landtype_router
from .grazing import router as grazing_router
from .settings import (
    LOG_LEVEL,
    FRONTEND_ORIGIN,
    CACHE_TTL,
    MAX_IDS_PER_CHUNK,
    ARCGIS_TIMEOUT,
    cache,
    rate_limiter,
    sanitize_export_filename,
    build_content_disposition,
)

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

app.include_router(landtype_router, prefix="/landtype", tags=["landtype"])
app.include_router(grazing_router, prefix="/api/grazing", tags=["grazing"])

# CORS configuration
origins = [origin.strip() for origin in FRONTEND_ORIGIN.split(",") if origin.strip()]
allow_origin_regex: Optional[str] = r"https?://.*"
allow_credentials = False
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=allow_credentials,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    allow_origin_regex=allow_origin_regex,
)

class SmartMapRequest(BaseModel):
    lotPlans: List[str]


class PropertyReportExportOptions(BaseModel):
    includeParcels: bool = True
    folderName: Optional[str] = None


class PropertyReportExportRequest(BaseModel):
    report: PropertyReportResponse
    visibleLayers: Optional[Dict[str, bool]] = None
    format: str = "kml"
    options: Optional[PropertyReportExportOptions] = None

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

@app.get("/api/property-report/layers", response_model=List[PropertyLayerInfo])
async def property_report_layers() -> List[PropertyLayerInfo]:
    """Return metadata for all available property-report datasets."""
    return [PropertyLayerInfo(**layer) for layer in list_property_layers()]


@app.post("/api/property-report/query", response_model=PropertyReportResponse)
async def property_report_query(request: PropertyReportRequest, req: Request):
    """Generate property report datasets for a set of QLD lotplans."""
    client_ip = req.client.host if req.client else "unknown"
    if not rate_limiter.is_allowed(client_ip):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")

    try:
        result = await generate_property_report(
            request.lotPlans,
            request.layers or [],
            timeout=ARCGIS_TIMEOUT,
            max_ids_per_chunk=MAX_IDS_PER_CHUNK,
        )
        return PropertyReportResponse(**result)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except ArcGISError as exc:
        logger.error("Property report ArcGIS failure: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc))
    except httpx.HTTPError as exc:  # type: ignore[name-defined]
        logger.error("HTTP error querying property datasets: %s", exc)
        raise HTTPException(status_code=502, detail="Failed to query property datasets")
    except Exception as exc:
        logger.error("Property report generation failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate property report")


@app.post("/api/property-report/export")
async def property_report_export_endpoint(request: PropertyReportExportRequest, req: Request):
    client_ip = req.client.host if req.client else "unknown"
    if not rate_limiter.is_allowed(client_ip):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")

    if request.report is None:
        raise HTTPException(status_code=400, detail="Property report payload is required")

    options = request.options or PropertyReportExportOptions()
    visible_layers = request.visibleLayers or {}
    include_parcels = options.includeParcels

    default_label = ", ".join(request.report.lotPlans or []) or "Property Report"
    folder_label = options.folderName.strip() if options.folderName else f"Property Report – {default_label}"

    try:
        export_data = export_property_report(
            request.report,
            visible_layers=visible_layers,
            include_parcels=include_parcels,
            folder_name=folder_label,
            format=request.format,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        logger.error("Property report export failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to export property report")

    normalized_format = (request.format or "kml").strip().lower()
    extension_map = {"kml": ".kml", "kmz": ".kmz", "geojson": ".geojson"}
    extension = extension_map.get(normalized_format, ".kml")

    sanitized_base = sanitize_export_filename(folder_label, "") or "property-report"
    filename = sanitize_export_filename(sanitized_base, extension) or f"property-report{extension}"

    content = export_data["content"]
    media_type = export_data["media_type"]

    headers = {"Content-Disposition": build_content_disposition(filename)}

    if normalized_format == "geojson":
        body = json.dumps(content)
    else:
        body = content

    return Response(content=body, media_type=media_type, headers=headers)


@app.post("/api/smartmaps/download")
async def smartmaps_download(request: SmartMapRequest, req: Request):
    client_ip = req.client.host if req.client else "unknown"
    if not rate_limiter.is_allowed(client_ip):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")

    if not request.lotPlans:
        raise HTTPException(status_code=400, detail="At least one lot/plan must be provided")

    joined_input = "\n".join(request.lotPlans)
    valid, malformed = parse_qld(joined_input)

    if not valid:
        detail = malformed[0].error if malformed else "No valid QLD lotplans supplied"
        raise HTTPException(status_code=400, detail=detail)

    try:
        zip_bytes, failures = await generate_smartmap_zip(valid)
    except SmartMapDownloadError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        logger.error("SmartMap generation failed: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to generate SmartMaps")

    timestamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    filename = f"smartmaps-qld-{timestamp}.zip"
    headers = {"Content-Disposition": build_content_disposition(filename)}
    if failures:
        headers["X-SmartMap-Failures"] = json.dumps(failures)

    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers=headers,
    )


@app.get("/ui", response_class=HTMLResponse)
async def ui_page():
    """Serve a minimal HTML user interface for testing the API."""
    return """
<!DOCTYPE html>
<html lang='en'>
  <head>
    <meta charset='utf-8' />
    <meta name='viewport' content='width=device-width, initial-scale=1' />
    <title>KML Backend Smoke Test</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      *, *::before, *::after {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        background: #f8fafc;
        color: #0f172a;
        font-family: inherit;
        line-height: 1.5;
      }
      .layout {
        max-width: 760px;
        margin: 0 auto;
        padding: 2rem 1.5rem 3rem;
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
      }
      .panel {
        background: #ffffff;
        border-radius: 0.75rem;
        padding: 1.5rem;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
      }
      .header h1 {
        margin: 0 0 0.25rem 0;
        font-size: 1.75rem;
      }
      .header p {
        margin: 0;
        color: #475569;
      }
      label {
        font-weight: 600;
        display: block;
        margin-bottom: 0.5rem;
      }
      select,
      textarea,
      input[type='text'],
      input[type='color'] {
        width: 100%;
        padding: 0.65rem 0.75rem;
        border-radius: 0.65rem;
        border: 1px solid #d1d5db;
        font-size: 1rem;
        background: #ffffff;
        color: inherit;
      }
      textarea {
        min-height: 140px;
        resize: vertical;
        font-family: ui-monospace, SFMono-Regular, 'Segoe UI Mono', Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
      }
      input[type='color'] {
        padding: 0.2rem;
        height: 2.5rem;
      }
      select:focus,
      textarea:focus,
      input[type='text']:focus,
      input[type='color']:focus {
        outline: none;
        border-color: #2563eb;
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.25);
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 1rem;
      }
      .help-text {
        margin-top: 0.35rem;
        font-size: 0.9rem;
        color: #64748b;
      }
      .color-field {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }
      .color-field span {
        font-size: 0.9rem;
        color: #475569;
      }
      button {
        border: none;
        border-radius: 0.65rem;
        background: #2563eb;
        color: #ffffff;
        padding: 0.75rem 1.25rem;
        font-weight: 600;
        font-size: 1rem;
        cursor: pointer;
        transition: background 0.2s ease, transform 0.2s ease;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
      }
      button:hover:not([disabled]) {
        background: #1d4ed8;
        transform: translateY(-1px);
      }
      button[disabled] {
        cursor: not-allowed;
        opacity: 0.65;
        transform: none;
      }
      button[data-loading='true']::after {
        content: "";
        width: 1rem;
        height: 1rem;
        border: 2px solid rgba(255, 255, 255, 0.65);
        border-top-color: transparent;
        border-radius: 9999px;
        animation: spin 0.8s linear infinite;
      }
      .status-panel h2 {
        margin-top: 0;
        margin-bottom: 0.75rem;
        font-size: 1.1rem;
      }
      .status {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem 1rem;
        border-radius: 0.65rem;
        margin-bottom: 0.75rem;
        background: #f1f5f9;
        color: #1f2937;
      }
      .status:last-of-type {
        margin-bottom: 0;
      }
      .status .label {
        font-weight: 600;
        width: 4.5rem;
        flex-shrink: 0;
      }
      .status .message {
        flex: 1 1 auto;
      }
      .status .spinner {
        width: 0.9rem;
        height: 0.9rem;
        border: 2px solid currentColor;
        border-top-color: transparent;
        border-radius: 9999px;
        animation: spin 0.8s linear infinite;
      }
      .status .spinner[hidden] {
        display: none;
      }
      .status.muted {
        background: #f8fafc;
        color: #475569;
      }
      .status.info {
        background: #dbeafe;
        color: #1e3a8a;
      }
      .status.success {
        background: #dcfce7;
        color: #065f46;
      }
      .status.warning {
        background: #fef3c7;
        color: #92400e;
      }
      .status.error {
        background: #fee2e2;
        color: #991b1b;
      }
      .summary-block {
        margin-top: 1rem;
        padding: 1rem;
        border-radius: 0.65rem;
        background: #f8fafc;
      }
      .summary-block.hidden {
        display: none !important;
      }
      .summary-title {
        margin: 0 0 0.5rem 0;
        font-size: 1rem;
      }
      .summary-list {
        margin: 0;
        padding-left: 1.2rem;
        font-size: 0.95rem;
      }
      .summary-list li {
        margin-bottom: 0.35rem;
      }
      .muted-text {
        color: #64748b;
        margin: 0.35rem 0 0 0;
        font-size: 0.9rem;
      }
      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
      @media (prefers-color-scheme: dark) {
        body {
          background: #0f172a;
          color: #e2e8f0;
        }
        .panel {
          background: #111827;
          box-shadow: none;
        }
        select,
        textarea,
        input[type='text'],
        input[type='color'] {
          background: #0f172a;
          border-color: #334155;
          color: inherit;
        }
        .help-text,
        .color-field span {
          color: #94a3b8;
        }
        .status.muted {
          background: #1e293b;
          color: #cbd5f5;
        }
        .status.info {
          background: rgba(37, 99, 235, 0.18);
          color: #c7d2fe;
        }
        .status.success {
          background: rgba(16, 185, 129, 0.18);
          color: #bbf7d0;
        }
        .status.warning {
          background: rgba(251, 191, 36, 0.2);
          color: #fde68a;
        }
        .status.error {
          background: rgba(248, 113, 113, 0.2);
          color: #fecaca;
        }
        .summary-block {
          background: #1e293b;
        }
        .muted-text {
          color: #94a3b8;
        }
        button[data-loading='true']::after {
          border-color: rgba(255, 255, 255, 0.5);
          border-top-color: transparent;
        }
      }
    </style>
  </head>
  <body>
    <main class='layout'>
      <header class='header'>
        <h1>Backend KML smoke test</h1>
        <p>Use this minimal form to run the parse → query → export workflow against the backend.</p>
      </header>
      <form id='parcel-form' class='panel' autocomplete='off'>
        <div class='grid'>
          <div class='field'>
            <label for='state'>State</label>
            <select id='state' name='state'>
              <option value='NSW' selected>New South Wales (NSW)</option>
              <option value='QLD'>Queensland (QLD)</option>
            </select>
          </div>
          <div class='field'>
            <label for='filename'>KML filename</label>
            <input id='filename' type='text' inputmode='text' placeholder='parcels.kml' value='parcels.kml' />
            <p class='help-text'>Illegal filename characters will be replaced automatically and a .kml extension will be enforced.</p>
          </div>
        </div>
        <div class='grid' style='margin-top: 1rem;'>
          <div class='field'>
            <label for='folder'>Folder name (optional)</label>
            <input id='folder' type='text' placeholder='Custom folder name' />
          </div>
        </div>
        <div class='field' style='margin-top: 1rem;'>
          <label for='identifiers'>Lot / plan identifiers</label>
          <textarea id='identifiers' name='identifiers' placeholder='e.g. 1/DP123456
2/DP654321' spellcheck='false'></textarea>
          <p class='help-text'>Enter one identifier per line. Mixed casing and whitespace are handled automatically.</p>
        </div>
        <div class='grid' style='margin-top: 1rem;'>
          <div class='field'>
            <label for='fill-color'>Fill colour</label>
            <div class='color-field'>
              <input id='fill-color' type='color' value='#0ea5e9' />
              <span>40% opacity will be applied automatically.</span>
            </div>
          </div>
          <div class='field'>
            <label for='stroke-color'>Boundary colour</label>
            <div class='color-field'>
              <input id='stroke-color' type='color' value='#0f172a' />
              <span>3 px boundary with full opacity.</span>
            </div>
          </div>
        </div>
        <button id='download-button' type='submit'>Download KML</button>
      </form>
      <section class='panel status-panel'>
        <h2>Status</h2>
        <div class='status muted' data-status='parse' role='status' aria-live='polite'>
          <span class='label'>Parse</span>
          <span class='message'>Waiting for parcel identifiers.</span>
          <span class='spinner' hidden></span>
        </div>
        <div class='status muted' data-status='query' role='status' aria-live='polite'>
          <span class='label'>Query</span>
          <span class='message'>Query runs after parsing succeeds.</span>
          <span class='spinner' hidden></span>
        </div>
        <div class='status muted' data-status='export' role='status' aria-live='polite'>
          <span class='label'>Export</span>
          <span class='message'>Download becomes available once parcels load.</span>
          <span class='spinner' hidden></span>
        </div>
        <div id='parsed-summary' class='summary-block'>
          <p class='muted-text'>No parcels parsed yet.</p>
        </div>
        <div id='malformed-container' class='summary-block hidden'></div>
      </section>
    </main>
    <script>
      (function () {
        'use strict';

        const form = document.getElementById('parcel-form');
        const stateSelect = document.getElementById('state');
        const identifiersField = document.getElementById('identifiers');
        const folderField = document.getElementById('folder');
        const filenameField = document.getElementById('filename');
        const fillColorField = document.getElementById('fill-color');
        const strokeColorField = document.getElementById('stroke-color');
        const downloadButton = document.getElementById('download-button');

        const statusNodes = {
        };
        const parsedSummary = document.getElementById('parsed-summary');
        const malformedContainer = document.getElementById('malformed-container');

        const statusNodes = {
          parse: document.querySelector("[data-status='parse']"),
          query: document.querySelector("[data-status='query']"),
          export: document.querySelector("[data-status='export']")
        };
        const INITIAL_STATUSES = {
          parse: 'Waiting for parcel identifiers.',
          query: 'Query runs after parsing succeeds.',
          export: 'Download becomes available once parcels load.'
        };

        let parsedParcels = [];
        let featureCollection = null;
        let readyToDownload = false;
        let isBusy = false;

        init();
        stateSelect.addEventListener('change', markDirty);
        identifiersField.addEventListener('input', markDirty);

        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          if (isBusy) {
            return;
          }

          if (readyToDownload && featureCollection && Array.isArray(featureCollection.features) && featureCollection.features.length) {
            await exportKML();
          } else {
            await runParseAndQuery();
          }
        });

        async function runParseAndQuery() {
          const rawText = identifiersField.value.trim();
          if (!rawText) {
            updateStatus('parse', 'Please enter at least one lot/plan identifier.', 'error', false);
            identifiersField.focus();
            return;
          }

          readyToDownload = false;
          featureCollection = null;

          isBusy = true;
          setButtonState(true, true);
          resetSummaries();
          updateStatus('parse', 'Parsing identifiers...', 'info', true);
          updateStatus('query', 'Waiting for parsing to finish...', 'muted', false);
          updateStatus('export', INITIAL_STATUSES.export, 'muted', false);

          try {
            const parseResponse = await fetch('/api/parse', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ state: stateSelect.value, rawText })
            });
            if (!parseResponse.ok) {
              await handleResponseError('parse', parseResponse);
              return;
            }

            const parseData = await parseResponse.json();
            parsedParcels = Array.isArray(parseData.valid) ? parseData.valid : [];
            renderParseSummary(parseData);

            if (!parsedParcels.length) {
              updateStatus('parse', 'No valid parcel identifiers were found. Check the validation messages below.', 'error', false);
              return;
            }

            const malformedCount = Array.isArray(parseData.malformed) ? parseData.malformed.length : 0;
            const parseTone = malformedCount > 0 ? 'warning' : 'success';
            updateStatus('parse', `Parsed ${parsedParcels.length} parcel${parsedParcels.length === 1 ? '' : 's'}.`, parseTone, false);

            updateStatus('query', 'Fetching parcel geometries...', 'info', true);

            const states = Array.from(new Set(parsedParcels.map((parcel) => parcel.state || stateSelect.value)));
            const ids = parsedParcels.map((parcel) => parcel.id);
            const queryResponse = await fetch('/api/query', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ states, ids })
            });
            if (!queryResponse.ok) {
              await handleResponseError('query', queryResponse);
              return;
            }

            const queryData = await queryResponse.json();
            const features = Array.isArray(queryData.features) ? queryData.features : [];
            featureCollection = Object.assign({ type: queryData.type || 'FeatureCollection' }, queryData, { features });

            if (!features.length) {
              updateStatus('query', 'Query completed but no parcel features were returned.', 'warning', false);
              updateStatus('export', 'No parcel features available to export.', 'error', false);
              readyToDownload = false;
              return;
            }

            updateStatus('query', `Loaded ${features.length} parcel feature${features.length === 1 ? '' : 's'}.`, 'success', false);
            updateStatus('export', 'Parcels ready. Click "Download KML" to export.', 'success', false);
            readyToDownload = true;
          } catch (error) {
            console.error('Parse/query workflow failed:', error);
            if (!error || !error.handled) {
              updateStatus('export', error && error.message ? error.message : 'Unexpected error during parse/query.', 'error', false);
            }
          } finally {
            isBusy = false;
            setButtonState(false, false);
          }
        }
        async function exportKML() {
          if (!featureCollection || !Array.isArray(featureCollection.features) || !featureCollection.features.length) {
            updateStatus('export', 'No parcel features to export. Run parse and query first.', 'error', false);
            readyToDownload = false;
            return;
          }

          isBusy = true;
          setButtonState(true, true);
          updateStatus('export', 'Requesting KML export...', 'info', true);

          try {
            const desiredFilename = sanitizeFilename(filenameField.value);
            const folderName = folderField.value.trim();
            const payload = {
              features: featureCollection.features,
              fileName: desiredFilename,
              styleOptions: {
                fillOpacity: 0.4,
                strokeWidth: 3,
                strokeOpacity: 1,
                colorByState: false,
                fillColor: fillColorField.value,
                strokeColor: strokeColorField.value,
                folderName: folderName || undefined
              }
            };
            const exportResponse = await fetch('/api/kml', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });

            if (!exportResponse.ok) {
              await handleResponseError('export', exportResponse);
              return;
            }

            const blob = await exportResponse.blob();
            const filename = extractFilename(exportResponse.headers.get('content-disposition')) || desiredFilename;
            triggerDownload(blob, filename);
            updateStatus('export', `KML download started: ${filename}`, 'success', false);
          } catch (error) {
            console.error('KML export failed:', error);
            if (!error || !error.handled) {
              updateStatus('export', error && error.message ? error.message : 'Unexpected error during export.', 'error', false);
            }
          } finally {
            isBusy = false;
            setButtonState(false, false);
          }
        }
        function init() {
          resetSummaries();
          updateStatus('parse', INITIAL_STATUSES.parse, 'muted', false);
          updateStatus('query', INITIAL_STATUSES.query, 'muted', false);
          updateStatus('export', INITIAL_STATUSES.export, 'muted', false);
        }

        function markDirty() {
          readyToDownload = false;
          featureCollection = null;
          if (parsedParcels.length) {
            updateStatus('parse', 'Input updated. Submit again to refresh parsed parcels.', 'info', false);
          } else {
            updateStatus('parse', INITIAL_STATUSES.parse, 'muted', false);
          }
          updateStatus('query', INITIAL_STATUSES.query, 'muted', false);
          updateStatus('export', INITIAL_STATUSES.export, 'muted', false);
          resetSummaries();
        }

        function resetSummaries() {
          parsedParcels = [];
          parsedSummary.innerHTML = "<p class='muted-text'>No parcels parsed yet.</p>";
          malformedContainer.innerHTML = '';
          malformedContainer.classList.add('hidden');
        }

        function renderParseSummary(data) {
          parsedSummary.innerHTML = '';
          const valid = Array.isArray(data && data.valid) ? data.valid : [];
          const malformed = Array.isArray(data && data.malformed) ? data.malformed : [];

          if (valid.length) {
            const heading = document.createElement('h3');
            heading.className = 'summary-title';
            heading.textContent = `Parsed IDs (${valid.length})`;
            parsedSummary.appendChild(heading);
            const list = document.createElement('ol');
            list.className = 'summary-list';
            valid.slice(0, 10).forEach((parcel) => {
              const item = document.createElement('li');
              item.textContent = parcel.id;
              list.appendChild(item);
            });
            parsedSummary.appendChild(list);

            if (valid.length > 10) {
              const note = document.createElement('p');
              note.className = 'muted-text';
              note.textContent = `+${valid.length - 10} more parcel${valid.length - 10 === 1 ? '' : 's'} not shown.`;
              parsedSummary.appendChild(note);
            }
          } else {
            const empty = document.createElement('p');
            empty.className = 'muted-text';
            empty.textContent = 'No valid parcel identifiers parsed.';
            parsedSummary.appendChild(empty);
          }

          malformedContainer.innerHTML = '';
          if (malformed.length) {
            malformedContainer.classList.remove('hidden');
            const heading = document.createElement('h3');
            heading.className = 'summary-title';
            heading.textContent = `Malformed entries (${malformed.length})`;
            malformedContainer.appendChild(heading);
            const list = document.createElement('ul');
            list.className = 'summary-list';
            malformed.slice(0, 8).forEach((entry) => {
              const item = document.createElement('li');
              const raw = entry && entry.raw ? entry.raw : '(empty line)';
              const detail = entry && entry.error ? entry.error : 'Unknown error';
              item.innerHTML = `<strong>${escapeHtml(raw)}</strong><br /><span class='muted-text'>${escapeHtml(detail)}</span>`;
              list.appendChild(item);
            });
            malformedContainer.appendChild(list);

            if (malformed.length > 8) {
              const note = document.createElement('p');
              note.className = 'muted-text';
              note.textContent = `+${malformed.length - 8} additional issue${malformed.length - 8 === 1 ? '' : 's'} not shown.`;
              malformedContainer.appendChild(note);
            }
          } else {
            malformedContainer.classList.add('hidden');
          }
        }

        function escapeHtml(value) {
          return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        }

        async function handleResponseError(stage, response) {
          let message = response.statusText || 'Request failed';
          try {
            const data = await response.json();
            if (data && (data.detail || data.error)) {
              message = data.detail || data.error;
            }
          } catch (error) {
            // ignore JSON parse errors
          }
          const err = new Error(message);
          err.handled = true;
          updateStatus(stage, `Error (${response.status}): ${message}`, 'error', false);
          throw err;
        }

        function setButtonState(disabled, loading) {
          downloadButton.disabled = disabled;
          downloadButton.setAttribute('aria-busy', loading ? 'true' : 'false');
          if (loading) {
            downloadButton.setAttribute('data-loading', 'true');
          } else {
            downloadButton.removeAttribute('data-loading');
          }
        }

        function sanitizeFilename(value) {
          const fallback = 'parcels.kml';
          const trimmed = (value || '').trim();
          if (!trimmed) {
            return fallback;
          }
          const cleaned = trimmed.replace(/[\\/:*?"<>|]+/g, '-');
          const normalised = cleaned.replace(/\s+/g, '-').replace(/-+/g, '-');
          if (!normalised) {
            return fallback;
          }
          return /\.kml$/i.test(normalised) ? normalised : `${normalised}.kml`;
        }

        function extractFilename(disposition) {
          if (!disposition) {
            return '';
          }
          const utf8 = disposition.match(/filename\*=UTF-8''([^;]+)/i);
          if (utf8 && utf8[1]) {
            try {
              return decodeURIComponent(utf8[1]);
            } catch (error) {
              return utf8[1];
            }
          }
          const ascii = disposition.match(/filename="?([^";]+)"?/i);
          return ascii ? ascii[1] : '';
        }
        function triggerDownload(blob, filename) {
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = filename || 'download.kml';
          document.body.appendChild(link);
          link.click();
          requestAnimationFrame(() => {
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
          });
        }
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
        filename = sanitize_export_filename(request.fileName, ".kml")
        if not filename:
            filename = f"parcels-{datetime.now().strftime('%Y%m%d')}.kml"

        return Response(
            content=kml_content,
            media_type="application/vnd.google-earth.kml+xml",
            headers={
                "Content-Disposition": build_content_disposition(filename)
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
        filename = sanitize_export_filename(request.fileName, ".kmz")
        if not filename:
            filename = f"parcels-{datetime.now().strftime('%Y%m%d')}.kmz"

        return Response(
            content=kmz_content,
            media_type="application/vnd.google-earth.kmz",
            headers={
                "Content-Disposition": build_content_disposition(filename)
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
