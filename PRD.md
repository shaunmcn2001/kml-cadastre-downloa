# KML Downloads App - Product Requirements Document

A professional, fast, and reliable two-part system for downloading cadastral data as KML/KMZ files from Australian state parcel systems (NSW, QLD, SA).

**Experience Qualities**: 
1. **Professional** - Clean, corporate interface that inspires confidence in data accuracy and reliability
2. **Efficient** - Streamlined workflow from input to download with clear progress indication and bulk processing capabilities
3. **Reliable** - Robust error handling, proper validation feedback, and consistent performance across large datasets

**Complexity Level**: Complex Application (advanced functionality with bulk processing, map visualization, backend coordination, and multiple export formats)
- Requires sophisticated state management, API coordination, real-time map updates, and handling of large geospatial datasets

## Essential Features

### Bulk Input Parser
- **Functionality**: Parse and normalize parcel identifiers for NSW (LOT//PLAN format), QLD (lotidstring), and SA (PARCEL//PLAN)
- **Purpose**: Handle complex input formats including ranges, sections, and various notation styles efficiently
- **Trigger**: User pastes or types parcel identifiers into textarea
- **Progression**: Raw input → Parse by state → Expand ranges → Validate format → Display parsed table + malformed list
- **Success criteria**: Correctly expands "1-3//DP131118" to individual entries, identifies malformed inputs, shows clear validation results

### Interactive Map Preview  
- **Functionality**: Display queried parcels on Leaflet map with state-based styling and hover/click popups
- **Purpose**: Visual confirmation of data accuracy before download
- **Trigger**: User clicks "Query Parcels" after input validation
- **Progression**: Send IDs to backend → Receive GeoJSON → Render on map → Enable layer toggles → Show popup details on interaction
- **Success criteria**: Map renders all queried parcels with correct boundaries, popups show parcel attributes, layers can be toggled

### Export Generation
- **Functionality**: Generate KML, KMZ, and optional GeoTIFF files from queried parcel data
- **Purpose**: Provide multiple format options for different use cases and software compatibility
- **Trigger**: User clicks export buttons after successful query
- **Progression**: Request export from backend → Process with progress indication → Generate download blob → Trigger browser download
- **Success criteria**: Files download correctly, open properly in Google Earth/GIS software, contain all queried parcels with attributes

### Debug Panel
- **Functionality**: Display backend request URLs, response times, and error details for troubleshooting
- **Purpose**: Enable debugging of API calls and performance monitoring
- **Trigger**: Toggle debug panel visibility in interface
- **Progression**: Capture API calls → Log timing data → Display in collapsible panel → Show request/response details
- **Success criteria**: All API calls logged with timestamps, errors clearly displayed, helps diagnose issues

## Edge Case Handling
- **Invalid Parcel IDs**: Display in malformed list with specific error reasons, allow continued processing of valid entries
- **Backend Timeout**: Show retry options with exponential backoff, graceful degradation of functionality
- **Large Dataset Limits**: Progress indicators for bulk operations, chunk processing for performance
- **Network Failures**: Offline state detection, cached data when possible, clear error messaging
- **Malformed API Responses**: Validate response structure, fallback to cached data, user-friendly error display

## Design Direction
The interface should feel professional and data-focused like enterprise GIS software - clean, efficient, and trustworthy with subtle refinements that enhance usability without distraction. Minimal interface serves the core purpose of data processing and visualization.

## Color Selection
Custom palette - Professional, data-focused scheme that maintains high contrast for accessibility while feeling modern and trustworthy.

- **Primary Color**: Deep Blue `oklch(0.4 0.15 240)` - Communicates trust, professionalism, and data reliability
- **Secondary Colors**: Neutral grays `oklch(0.9 0.02 240)` for backgrounds, `oklch(0.7 0.03 240)` for borders - Supporting structure without competing for attention  
- **Accent Color**: Emerald Green `oklch(0.6 0.18 140)` - Success states, confirmation actions, and map highlights
- **Foreground/Background Pairings**: 
  - Background (Light Gray #FAFAFA): Dark Blue text (#1A237E) - Ratio 12.1:1 ✓
  - Card (White #FFFFFF): Dark Blue text (#1A237E) - Ratio 13.2:1 ✓  
  - Primary (Deep Blue #1A237E): White text (#FFFFFF) - Ratio 13.2:1 ✓
  - Secondary (Light Gray #E8EAF6): Dark Blue text (#1A237E) - Ratio 10.8:1 ✓
  - Accent (Emerald Green #2E7D32): White text (#FFFFFF) - Ratio 6.2:1 ✓

## Font Selection
Clean, technical sans-serif that conveys precision and professionalism appropriate for geospatial data applications.

- **Typographic Hierarchy**:
  - H1 (App Title): Inter Bold/24px/tight letter spacing
  - H2 (Section Headers): Inter Semibold/18px/normal spacing  
  - H3 (Subsections): Inter Medium/16px/normal spacing
  - Body Text: Inter Regular/14px/relaxed line height (1.6)
  - Code/Data: JetBrains Mono Regular/13px/normal spacing
  - Captions: Inter Regular/12px/muted color

## Animations
Subtle, purposeful motion that enhances the professional workflow without feeling playful - focus on smooth state transitions and clear progress indication that builds confidence in data processing.

- **Purposeful Meaning**: Motion communicates system status (loading, processing, success) and guides attention to important changes in data state
- **Hierarchy of Movement**: Data loading gets priority animation focus, followed by user interaction feedback, with subtle hover states for secondary elements

## Component Selection
- **Components**: Card for input sections, Table for parsed data, Button with loading states, Alert for validation feedback, Dialog for export options, Progress for bulk operations, Tabs for state selection, Popover for map feature details
- **Customizations**: Map component integration (Leaflet), custom parcel ID input parser, specialized export buttons with progress indication
- **States**: Buttons show loading spinners during API calls, inputs highlight validation errors in red, success states use accent green, disabled states are clearly distinguished
- **Icon Selection**: Database icons for data operations, Map icons for geographic functions, Download icons for exports, Warning triangles for errors
- **Spacing**: Consistent 16px base spacing, 8px for tight groupings, 24px for section separation, 32px for major layout divisions
- **Mobile**: Single column layout, collapsible map view, simplified input methods, touch-friendly button sizing, progressive disclosure of advanced features