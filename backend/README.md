# KML Downloads Backend - Australian Cadastral Data API

A FastAPI service for querying Australian state parcel/cadastre data from ArcGIS services and exporting as KML/KMZ/GeoTIFF.

## Features

- **Multi-state Support**: NSW, QLD, SA cadastral data sources
- **Bulk Processing**: Handle large sets of parcel identifiers efficiently
- **Multiple Export Formats**: KML, KMZ, and GeoTIFF outputs
- **Production Ready**: Error handling, logging, caching, rate limiting

## Quick Start

### Local Development

```bash
# Install dependencies
pip install -r requirements.txt

# Run development server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Environment Variables

```bash
FRONTEND_ORIGIN=https://your-frontend.github.io  # CORS origins (comma-separated)
LOG_LEVEL=INFO                                   # Logging level
CACHE_TTL=900                                    # Cache TTL in seconds
MAX_IDS_PER_CHUNK=50                            # ArcGIS query chunk size
ARCGIS_TIMEOUT_S=20                             # ArcGIS request timeout
```

## API Endpoints

### Core Endpoints

- `POST /api/parse` - Parse and validate parcel identifiers
- `POST /api/query` - Query parcel data from ArcGIS services
- `POST /api/kml` - Export features as KML
- `POST /api/kmz` - Export features as KMZ (compressed)
- `POST /api/geotiff` - Export features as GeoTIFF raster
- `GET /healthz` - Health check endpoint

### Data Sources

- **NSW**: `https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Cadastre/MapServer/9`
- **QLD**: `https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer/4`
- **SA**: `https://lsa2.geohub.sa.gov.au/server/rest/services/ePlanning/DAP_Parcels/MapServer/1`

## Deployment

### Render.com

1. Connect your repository to Render
2. Use the provided `render.yaml` configuration
3. Set environment variables in Render dashboard
4. Deploy automatically on git push

### Docker

```bash
docker build -t kml-backend .
docker run -p 8000:8000 kml-backend
```

## Architecture

```
app/
├── main.py              # FastAPI app and routers
├── arcgis.py            # ArcGIS query helpers
├── parsers/             # State-specific parcel ID parsers
│   ├── nsw.py
│   ├── qld.py
│   └── sa.py
├── exports/             # Export format generators
│   ├── kml.py
│   ├── kmz.py
│   └── tiff.py
├── models.py            # Pydantic schemas
├── merge.py             # Geometry processing
└── utils/               # Common utilities
    ├── cache.py
    ├── retry.py
    └── logging.py
```

## Testing

```bash
# Run unit tests
pytest tests/unit/

# Run integration tests (requires network)
pytest tests/integration/

# Run all tests
pytest
```