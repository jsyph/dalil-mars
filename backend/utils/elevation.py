"""
elevation.py — Elevation extraction from GDB raster / DEM band.
Falls back to synthetic MOLA model if rasterio is not available.
"""
import os
import math
import numpy as np
from typing import List, Tuple, Optional
try:
    import rasterio
    import rasterio.warp
    from rasterio.crs import CRS
    latlon_crs = CRS.from_string('+proj=longlat +a=3396190 +b=3396190 +no_defs')
except ImportError:
    rasterio = None
    latlon_crs = None

GDB_PATH = os.getenv("GDB_PATH", "/Users/abdallah/.gemini/antigravity/scratch/jezero-planner/data/sim3464_JezeroNili_FINAL/Geodatabase/Nili.gdb")
HRSC_DTM_PATH = os.getenv("HRSC_DTM_PATH", "/Users/abdallah/.gemini/antigravity/scratch/jezero-planner/data/sim3464_JezeroNili_FINAL/Rasters/HRSC/nili_h0988_0000_da4_clip.tif")

_dtm_src = None
_dtm_arr = None
_dtm_transform = None
_dtm_crs = None
_dtm_nodata = -32768

def init_dtm():
    global _dtm_src, _dtm_arr, _dtm_transform, _dtm_crs, _dtm_nodata
    if rasterio is None:
        _dtm_arr = False
        return
    if _dtm_arr is None and os.path.exists(HRSC_DTM_PATH):
        try:
            _dtm_src = rasterio.open(HRSC_DTM_PATH)
            _dtm_arr = _dtm_src.read(1)
            _dtm_transform = _dtm_src.transform
            _dtm_crs = _dtm_src.crs
            _dtm_nodata = _dtm_src.nodata if _dtm_src.nodata is not None else -32768
        except Exception:
            _dtm_arr = False

init_dtm()

def _get_engine_safe():
    """Lazily retrieve the consolidated DalilMarsEngine instance if available."""
    try:
        from core.engine import get_engine
        eng = get_engine()
        if eng is not None and eng.elev_matrix is not None:
            return eng
    except Exception:
        pass
    return None


def _get_engine_safe():
    """Lazily retrieve the consolidated DalilMarsEngine instance if available."""
    try:
        from core.engine import get_engine
        eng = get_engine()
        if eng is not None and eng.elev_matrix is not None:
            return eng
    except Exception:
        pass
    return None


def get_elevation_at_point(lat: float, lon: float) -> dict:
    """Query elevation from the consolidated 20.2m DTM in DalilMarsEngine (primary) or HRSC fallback."""
    eng = _get_engine_safe()
    if eng is not None:
        r, c = eng.latlon_to_grid(lat, lon)
        H, W = eng.elev_matrix.shape
        if 0 <= r < H and 0 <= c < W:
            val = float(eng.elev_matrix[r, c])
            if math.isfinite(val):
                slope_val = float(eng.slope_matrix[r, c]) if eng.slope_matrix is not None else None
                return {
                    "lat": lat,
                    "lon": lon,
                    "elevation_m": round(val, 1),
                    "slope_deg": round(slope_val, 1) if slope_val is not None and math.isfinite(slope_val) else None,
                    "source": "consolidated_dtm_20m",
                }

    if _dtm_arr is not None and _dtm_arr is not False:
        try:
            xs, ys = rasterio.warp.transform(latlon_crs, _dtm_crs, [lon], [lat])
            # Direct affine transform invert: x, y -> col, row
            col, row = ~_dtm_transform * (xs[0], ys[0])
            col, row = int(col), int(row)
            if 0 <= row < _dtm_arr.shape[0] and 0 <= col < _dtm_arr.shape[1]:
                val = float(_dtm_arr[row, col])
                if val > -30000 and val != _dtm_nodata:
                    return {
                        "lat": lat, "lon": lon,
                        "elevation_m": round(val, 1),
                        "source": "hrsc_dtm_sim3464",
                    }
        except Exception:
            pass

    return {
        "lat": lat, "lon": lon,
        "elevation_m": synthetic_mola(lat, lon),
        "source": "mola_model",
    }



def get_elevation_profile(points: List[Tuple[float, float]]) -> List[dict]:
    """Return elevation for an array of [lat, lon] points."""
    return [get_elevation_at_point(lat, lon) for lat, lon in points]


def get_slope_at_point(lat: float, lon: float, delta_deg: float = 0.001) -> float:
    """
    Return slope in degrees from Stage 2 consolidated slope matrix when available,
    falling back to finite difference on elevation samples.
    """
    eng = _get_engine_safe()
    if eng is not None and eng.slope_matrix is not None:
        r, c = eng.latlon_to_grid(lat, lon)
        H, W = eng.slope_matrix.shape
        if 0 <= r < H and 0 <= c < W:
            s_val = float(eng.slope_matrix[r, c])
            if math.isfinite(s_val):
                return round(s_val, 2)

    e_n = get_elevation_at_point(lat + delta_deg, lon)["elevation_m"]
    e_s = get_elevation_at_point(lat - delta_deg, lon)["elevation_m"]
    e_e = get_elevation_at_point(lat, lon + delta_deg)["elevation_m"]
    e_w = get_elevation_at_point(lat, lon - delta_deg)["elevation_m"]

    dx = delta_deg * 111320  # metres per degree lat
    dy = delta_deg * 111320 * math.cos(math.radians(lat))

    dz_dx = (e_e - e_w) / (2 * dy)
    dz_dy = (e_n - e_s) / (2 * dx)

    slope_rad = math.atan(math.sqrt(dz_dx**2 + dz_dy**2))
    return round(math.degrees(slope_rad), 2)


def get_dem_array(bbox: list, resolution: int = 64) -> dict:
    """
    Return a 2D elevation grid for a bounding box.
    bbox = [minLon, minLat, maxLon, maxLat]
    Uses the Stage 1 consolidated 20.2m DTM in DalilMarsEngine when available.
    """
    min_lon, min_lat, max_lon, max_lat = bbox
    lats = np.linspace(max_lat, min_lat, resolution)
    lons = np.linspace(min_lon, max_lon, resolution)

    eng = _get_engine_safe()
    if eng is not None:
        H, W = eng.elev_matrix.shape
        grid = np.zeros((resolution, resolution), dtype=np.float32)
        for r_idx, lat in enumerate(lats):
            for c_idx, lon in enumerate(lons):
                er, ec = eng.latlon_to_grid(float(lat), float(lon))
                er = max(0, min(H - 1, er))
                ec = max(0, min(W - 1, ec))
                val = float(eng.elev_matrix[er, ec])
                grid[r_idx, c_idx] = val if math.isfinite(val) else -2500.0
        return {
            "grid": grid.tolist(),
            "lats": lats.tolist(),
            "lons": lons.tolist(),
            "source": "consolidated_dtm_20m",
        }

    try:
        import rasterio
        from pyproj import Transformer

        with rasterio.open(GDB_PATH) as src:
            transformer = Transformer.from_crs("EPSG:4326", src.crs, always_xy=True)
            grid = np.zeros((resolution, resolution), dtype=np.float32)
            for r, lat in enumerate(lats):
                for c, lon in enumerate(lons):
                    x, y = transformer.transform(lon, lat)
                    try:
                        row, col = src.index(x, y)
                        if 0 <= row < src.height and 0 <= col < src.width:
                            win = rasterio.windows.Window(col, row, 1, 1)
                            val = float(src.read(1, window=win)[0, 0])
                            grid[r, c] = val if val != src.nodata else synthetic_mola(lat, lon)
                        else:
                            grid[r, c] = synthetic_mola(lat, lon)
                    except Exception:
                        grid[r, c] = synthetic_mola(lat, lon)
            return {
                "grid": grid.tolist(),
                "lats": lats.tolist(),
                "lons": lons.tolist(),
                "source": "gdb_dem",
            }
    except Exception:
        # Synthetic fallback
        grid = [[synthetic_mola(lat, lon) for lon in lons] for lat in lats]
        return {
            "grid": grid,
            "lats": lats.tolist(),
            "lons": lons.tolist(),
            "source": "synthetic_mola",
        }


# ── Synthetic MOLA fallback ───────────────────────────────────────

def synthetic_mola(lat: float, lon: float) -> float:
    """
    Approximate MOLA elevation for Jezero/Nili region.
    Based on published topographic data (MOLA MEGDR, 2003).
    Replace with actual GDB raster queries once confirmed.
    """
    # Jezero crater bowl centred at 18.44°N, 77.45°E
    clat, clon = 18.44, 77.45
    dlat = (lat - clat) * 111320
    dlon = (lon - clon) * 111320 * math.cos(math.radians(clat))
    dist = math.sqrt(dlat**2 + dlon**2)

    crater_r = 24500   # metres
    rim_e    = -1500   # metres (MOLA)
    floor_e  = -2600
    ext_e    = -1200

    if dist > crater_r * 1.2:
        e = ext_e - (dist - crater_r * 1.2) * 0.005
    elif dist > crater_r * 0.85:
        t = (dist - crater_r * 0.85) / (crater_r * 0.35)
        e = floor_e + (rim_e - floor_e) * math.sin(t * math.pi)
    else:
        t = dist / (crater_r * 0.85)
        e = floor_e + (rim_e - floor_e) * 0.3 * t * t

    # Delta fan uplift (NW sector, 18.56°N 77.37°E)
    df_dist = math.sqrt(((lat-18.56)*111320)**2 + ((lon-77.37)*111320*math.cos(math.radians(18.56)))**2)
    if df_dist < 8000:
        e += 200 * (1 - df_dist / 8000)

    # Terrain roughness noise
    e += 30 * math.sin(lat * 123.4) * math.cos(lon * 98.7)
    e += 15 * math.cos(lat * 234.5 + lon * 67.8)

    return round(e, 1)
