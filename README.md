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

## Further Reading
- `frontend/README.md` – Component architecture, styling conventions, and advanced UI workflows
- `backend/README.md` – Endpoint reference, environment variables, and testing strategy
- `PRD.md` – Product scope and feature backlog

Contributions are welcome—keep documentation and type checks up to date when you make changes.
