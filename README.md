# KML Cadastre Downloads

Full-stack toolkit for searching Australian cadastral parcels and exporting geospatial data.  
This repository now separates the web application and API into dedicated packages to make local
development, deployment, and maintenance clearer.

## Project Layout
- `frontend/` – React 19 + Vite interface for parcel lookup and exports
- `backend/` – FastAPI service that queries state ArcGIS endpoints and generates exports
- `PRD.md` – Product requirements reference
- `SECURITY.md` – Disclosure guidelines

## Quick Start

### Backend API
```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # On Windows use .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend Application
```bash
cd frontend
npm install
npm run dev
```
The Vite dev server defaults to `http://localhost:5173`.

### Connecting the Two
- Edit `frontend/public/config.json` and point `BACKEND_URL` at your running FastAPI instance  
  (e.g. `http://localhost:8000` in development).
- The backend expects `FRONTEND_ORIGIN` in its environment when CORS should be restricted.

## Deployment Notes
- **Backend**: Ready for Render.com via `backend/render.yaml`, or deploy with Docker/uvicorn.
- **Frontend**: Build with `npm run build` inside `frontend/` and publish `frontend/dist/`
  to static hosting such as GitHub Pages.

## LandType Workflow
- **Backend**: FastAPI mounts LandType under `/landtype`. Use:
  - `GET /landtype/health` for uptime checks.
  - `GET /landtype/geojson?lotplans=...` or `?bbox=...` to preview clipped polygons.
  - `POST /landtype/export` with `format` (`kml`/`kmz`/`geojson`/`tiff`) to download styled files.
- **Frontend**: When the config flag `features.landtypeEnabled` is true the cadastre map shows a LandType toggle.
  - Enable the overlay, choose **Lotplans** (auto-uses loaded QLD parcels) or **Map Extent**, then refresh.
  - Export options live in the right-hand panel with format, colour mode, alpha, and filename controls.
- **Troubleshooting**:
  - No polygons: ensure QLD parcels are loaded or switch to Map Extent and refresh.
  - Colour by property: supply a valid attribute name present in LandType features.
  - Backend limits requests per IP; repeated 429s generally mean rapid refreshes—pause and retry.

## Further Reading
- `frontend/README.md` – Component architecture, styling conventions, and advanced UI workflows
- `backend/README.md` – Endpoint reference, environment variables, and testing strategy
- `PRD.md` – Product scope and feature backlog

Contributions are welcome—keep documentation and type checks up to date when you make changes.
