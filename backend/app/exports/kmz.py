import zipfile
import io
from typing import List
from .kml import export_kml
from ..models import Feature, StyleOptions
from ..utils.logging import get_logger

logger = get_logger(__name__)

def export_kmz(features: List[Feature], style_options: StyleOptions = None) -> bytes:
    """Export features to KMZ (compressed KML) format."""
    if not features:
        raise ValueError("No features to export")
    
    logger.info(f"Exporting {len(features)} features to KMZ")
    
    # Generate KML content
    kml_content = export_kml(features, style_options)
    
    # Create KMZ (ZIP) file in memory
    kmz_buffer = io.BytesIO()
    
    with zipfile.ZipFile(kmz_buffer, 'w', zipfile.ZIP_DEFLATED) as kmz:
        # Add KML file to KMZ
        kmz.writestr('doc.kml', kml_content.encode('utf-8'))
        
        # Could add additional files here like:
        # - icons/symbols
        # - ground overlays
        # - additional documentation
        
        # Add metadata file
        metadata = f"""<?xml version="1.0" encoding="UTF-8"?>
<metadata>
    <title>Cadastral Parcels Export</title>
    <description>Australian cadastral parcels exported from KML Downloads service</description>
    <feature_count>{len(features)}</feature_count>
    <export_date>{__import__('datetime').datetime.utcnow().isoformat()}Z</export_date>
    <states>{','.join(set(f.properties.state for f in features))}</states>
</metadata>"""
        kmz.writestr('metadata.xml', metadata.encode('utf-8'))
    
    kmz_buffer.seek(0)
    logger.info("KMZ export completed successfully")
    return kmz_buffer.read()