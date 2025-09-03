import os
import uuid
from datetime import datetime
from typing import List, Dict, Any
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn

from .models import (
    ParseRequest, ParseResponse, QueryRequest, FeatureCollection, 
    ExportRequest, ErrorResponse, HealthResponse, ParcelState
)
from .parsers import parse_parcel_input
from .arcgis import query_parcels_bulk
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