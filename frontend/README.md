# KML Downloads - Frontend

A modern React application for downloading Australian cadastral data as KML/KMZ files.

## Features

- **Multi-State Support**: Parse and query parcels from NSW, QLD, SA, and VIC
- **Bulk Processing**: Handle large sets of parcel identifiers with validation
- **NSW Parcel Search**: Discover NSW parcels via live MapServer/9 search results
- **Interactive Map**: Preview queried parcels with Leaflet integration
- **Multiple Export Formats**: Download as KML, KMZ, or GeoTIFF
- **Real-time Validation**: Immediate feedback on parcel ID formats
- **Debug Tools**: Built-in API request monitoring and troubleshooting

## Technology Stack

- **Frontend**: React 19 + TypeScript + Vite
- **UI Components**: shadcn/ui v4 + Tailwind CSS v4
- **Maps**: Leaflet + React-Leaflet
- **Icons**: Phosphor Icons
- **State Management**: React hooks + useKV for persistence
- **HTTP Client**: Fetch API with retry logic

## Quick Start

### Development

```bash
# From the repository root
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

The application will be available at `http://localhost:5173`.

### Configuration

The application reads its backend URL from `public/config.json` at runtime:

```json
{
  "BACKEND_URL": "http://localhost:8000"
}
```

For production deployments, update this file with your backend URL.

### Building

```bash
# Build for production
npm run build

# Preview production build
npm run preview
```

## Usage

1. **Select State**: Choose NSW, QLD, or SA from the tabs
2. **Input Parcels**: Paste parcel identifiers (supports various formats and ranges)
3. **Validate**: The app automatically parses and validates your input
4. **Query**: Click "Query Parcels" to fetch data from the backend
5. **Preview**: View results on the interactive map
6. **Export**: Download as KML, KMZ, or GeoTIFF

### NSW Parcel Search

- Switch to the **NSW** tab and use the "Search NSW Parcels" box to look up parcels by address, lot, or plan.
- Results stream from the NSW Spatial Services MapServer/9 endpoint and can be clicked to add `LOT//PLAN` tokens to your parcel list automatically.
- Duplicate selections are ignored gracefully, and toast notifications confirm when parcels are appended to the NSW textarea.

### Supported Formats

#### NSW
- `LOT//PLAN`: `1//DP131118`
- `LOT/SECTION//PLAN`: `101/1//DP12345`
- Ranges: `1-3//DP131118` (expands to multiple parcels)
- Tokens: `LOT 13 DP1242624`

#### QLD
- Lotidstring: `1RP912949`, `13SP12345`, `245GTP4567`

#### SA
- `PARCEL//PLAN`: `101//D12345`
- `VOLUME/FOLIO//PLAN`: `1/234//CT5678`

#### VIC
- `LOT\PLAN`: `27\PS433970`
- Alternate inputs: `27 PS433970`, `27/PS433970`, `Lot 27 PS433970`

## Architecture

```
src/
├── components/          # React components
│   ├── ParcelInputPanel.tsx
│   ├── MapView.tsx
│   ├── ExportPanel.tsx
│   ├── DebugPanel.tsx
│   └── ui/             # shadcn components (pre-installed)
├── hooks/              # Custom React hooks
│   ├── useParcelInput.ts
│   └── useDebugPanel.ts
├── lib/                # Core utilities
│   ├── api.ts          # Backend API client
│   ├── parsers.ts      # Parcel ID parsing logic
│   ├── types.ts        # TypeScript definitions
│   └── config.ts       # Runtime configuration
├── App.tsx             # Main application component
└── index.css           # Global styles and theme
```

## Deployment

### GitHub Pages

1. Update `public/config.json` with your backend URL
2. Push to main branch
3. GitHub Actions will automatically build and deploy

The workflow file is at `.github/workflows/pages.yml`.

### Manual Deployment

```bash
# Build the application
npm run build

# Deploy the dist/ folder (relative to this directory) to your hosting service
```

## Development Guidelines

### State Management
- Use `useKV` for data that should persist between sessions
- Use `useState` for temporary UI state
- Never use localStorage directly

### API Integration
- All backend calls go through the `apiClient` singleton
- Requests include automatic retry logic and timeout handling
- Debug panel automatically captures all API interactions

### Styling
- Use Tailwind utility classes
- Follow the design system defined in `index.css`
- Components use shadcn/ui as the base layer

### Type Safety
- All API responses are strictly typed
- Use the types defined in `lib/types.ts`
- No `any` types in production code

## Environment Variables

The app uses runtime configuration instead of build-time environment variables:

- `BACKEND_URL`: Set in `/public/config.json`

This allows the same build to work across different environments.

## Contributing

1. Follow the existing code style and conventions
2. Add tests for new functionality
3. Update documentation as needed
4. Ensure all TypeScript checks pass

## License

MIT License - see LICENSE file for details.
