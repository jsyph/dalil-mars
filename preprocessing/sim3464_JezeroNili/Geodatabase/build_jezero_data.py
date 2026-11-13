#!/usr/bin/env python3
"""
build_jezero_data.py
Processes Nili.gdb and associated rasters to generate optimized GeoJSON and JSON datasets
for the Jezero Crater & Nili Planum Geological Atlas web visualization.
"""

import os
import json
import numpy as np
import geopandas as gpd
from shapely.geometry import Point, mapping

os.environ['PROJ_IGNORE_CELESTIAL_BODY'] = 'YES'

GDB_PATH = 'Nili.gdb'
OUTPUT_DIR = 'web_atlas/data'
os.makedirs(OUTPUT_DIR, exist_ok=True)

UNIT_INFO = {
    'NHjf1': {
        'name': 'Jezero fan 1 unit',
        'epoch': 'Late Noachian to Early Hesperian (~3.7–3.5 Ga)',
        'category': 'Fluvial / Deltaic',
        'color': '#00a884',
        'fillOpacity': 0.65,
        'lithology': 'Smectite-bearing mudstones, siltstones, and laminated fine sandstones',
        'description': 'Distal and bottomset delta deposits formed in a calm standing paleolake. Prime target for microbial biosignature preservation.',
        'perseverance_role': 'Core sampling target at delta front cliffs (Wildcat Ridge, Skinner Ridge).'
    },
    'NHjf2': {
        'name': 'Jezero fan 2 unit',
        'epoch': 'Late Noachian to Early Hesperian (~3.7–3.5 Ga)',
        'category': 'Fluvial / Deltaic',
        'color': '#38a800',
        'fillOpacity': 0.65,
        'lithology': 'Cross-bedded sandstones, conglomeratic channels, and boulder gravels',
        'description': 'Topset and foreset delta lobes deposited by high-energy river floods from Neretva Vallis breaching the western crater rim.',
        'perseverance_role': 'Explored along upper delta lobes and river channel ingress.'
    },
    'Hnpf': {
        'name': 'Nili Planum fan unit',
        'epoch': 'Early Hesperian',
        'category': 'Fluvial / Deltaic',
        'color': '#73b273',
        'fillOpacity': 0.65,
        'lithology': 'Alluvial and fluvial fan conglomerates and sandstones',
        'description': 'Alluvial fan deposits formed outside Jezero crater on the Nili Planum highland plains.',
        'perseverance_role': 'Regional analogue for Jezero fan hydrology.'
    },
    'Njf': {
        'name': 'Jezero floor unit',
        'epoch': 'Late Noachian to Early Hesperian',
        'category': 'Crater Floor / Igneous',
        'color': '#5c7333',
        'fillOpacity': 0.65,
        'lithology': 'Mafic igneous basaltic lava flows and olivine-pyroxene cumulate rocks',
        'description': 'Dark-toned volcanic floor rocks (Séítah and Máaz formations) that filled the crater basin after the lake epoch.',
        'perseverance_role': 'Touchdown site (Octavia E. Butler Landing); provided crucial igneous samples for isotopic dating.'
    },
    'Nle': {
        'name': 'Lower etched unit',
        'epoch': 'Early to Middle Noachian (>3.8 Ga)',
        'category': 'Altered Bedrock',
        'color': '#d48800',
        'fillOpacity': 0.65,
        'lithology': 'Olivine-rich layered bedrock altered to Mg-carbonates, talc, and serpentine',
        'description': 'Ancient regionally widespread bedrock altered by neutral-to-alkaline hydrothermal and groundwater systems.',
        'perseverance_role': 'Investigated along crater margin carbonate outcrops (Margin Unit).'
    },
    'Nue': {
        'name': 'Upper etched unit',
        'epoch': 'Middle Noachian (>3.8 Ga)',
        'category': 'Altered Bedrock',
        'color': '#e8be6b',
        'fillOpacity': 0.65,
        'lithology': 'Layered, fractured, and pitted sedimentary/volcaniclastic bedrock',
        'description': 'Capping etched bedrock displaying yardang-like flutes, resistant ridges, and pits. Overlies the Lower Etched unit.',
        'perseverance_role': 'Surrounding bedrock stratigraphy bounding the landing ellipse.'
    },
    'Nnp1': {
        'name': 'Nili Planum 1 unit',
        'epoch': 'Noachian',
        'category': 'Regional Highland',
        'color': '#a05a9c',
        'fillOpacity': 0.65,
        'lithology': 'Ancient fractured basaltic volcanic sheets and volcaniclastic bedrock',
        'description': 'Ancient regional highland plateau forming the bedrock foundation of the Nili Planum region.',
        'perseverance_role': 'Key regional bedrock context connecting Jezero to Nili Fossae.'
    },
    'Nnp2': {
        'name': 'Nili Planum 2 unit',
        'epoch': 'Late Noachian to Hesperian',
        'category': 'Regional Highland',
        'color': '#cfa6d6',
        'fillOpacity': 0.65,
        'lithology': 'Resistant capping strata with reticulate fracture patterns',
        'description': 'Younger resistant plateau capping plain of Nili Planum.',
        'perseverance_role': 'Plateau surface unit over Nili Planum.'
    },
    'Nrb': {
        'name': 'Rugged bright unit',
        'epoch': 'Pre-Noachian to Early Noachian (~3.9–4.1 Ga)',
        'category': 'Impact Megabreccia',
        'color': '#e04f9e',
        'fillOpacity': 0.70,
        'lithology': 'Impact megabreccia blocks (up to 100 m across) and shattered basement crust',
        'description': 'Deep crustal megabreccia uplifted and shattered by the colossal Isidis impact basin event (~1,500 km diameter).',
        'perseverance_role': 'Contains the oldest accessible crustal samples on Mars.'
    },
    'cr': {
        'name': 'Crater rim unit',
        'epoch': 'Middle to Late Noachian',
        'category': 'Impact Structure',
        'color': '#707070',
        'fillOpacity': 0.65,
        'lithology': 'Uplifted structural rim bedrock, polymict breccia, and impact melt',
        'description': 'High-standing structural rim walls and fault scarps excavated during the Jezero impact event.',
        'perseverance_role': 'Traversed during the crater rim climb campaign.'
    },
    'ce': {
        'name': 'Crater ejecta unit',
        'epoch': 'Noachian to Hesperian',
        'category': 'Impact Structure',
        'color': '#9aa5b1',
        'fillOpacity': 0.65,
        'lithology': 'Ballistic impact breccia and hummocky ejecta blankets',
        'description': 'Continuous and hummocky ballistic impact ejecta blankets radiating outward from craters.',
        'perseverance_role': 'Provides insights into impact excavation dynamics.'
    },
    'ci': {
        'name': 'Crater interior unit',
        'epoch': 'Noachian to Hesperian',
        'category': 'Impact Structure',
        'color': '#484f56',
        'fillOpacity': 0.65,
        'lithology': 'Slumped wall terraces, central peak materials, and ponded impact melt',
        'description': 'Internal structural terraces and slump blocks within crater floors.',
        'perseverance_role': 'Exposes uplifted subsurface stratigraphy.'
    },
    'su': {
        'name': 'Smooth unit, undivided',
        'epoch': 'Hesperian to Amazonian',
        'category': 'Sedimentary / Mantle',
        'color': '#b8a88a',
        'fillOpacity': 0.65,
        'lithology': 'Fine-grained dust, sedimentary infill, and smooth plains mantles',
        'description': 'Smooth depositional fill in topographic lows and depression basins.',
        'perseverance_role': 'Relatively hazard-free terrain traversing.'
    },
    'Aeb': {
        'name': 'Eolian bedform unit',
        'epoch': 'Amazonian (Modern to Active)',
        'category': 'Modern Eolian',
        'color': '#ffd43f',
        'fillOpacity': 0.70,
        'lithology': 'Unconsolidated basaltic sands and granule megaripples',
        'description': 'Active and semi-stabilized Transverse Aeolian Ridges (TARs) and dune fields migrating under Martian wind regimes.',
        'perseverance_role': 'Mobility obstacle and active atmospheric science laboratory.'
    }
}

LINEAR_STYLES = {
    'channel (fluvial)': {
        'label': 'Ancient Fluvial River Channel',
        'color': '#00ffff',
        'weight': 4.0,
        'dashArray': None,
        'desc': 'Ancient river valleys carved by surface liquid water; includes Neretva Vallis breach through Jezero crater rim.'
    },
    'delta lobe front': {
        'label': 'Delta Lobe Front',
        'color': '#ffbb00',
        'weight': 3.5,
        'dashArray': None,
        'desc': 'Steep lobate front scarps marking the river delta advancing into the standing Jezero paleolake.'
    },
    'ridge crest (type 1), certain': {
        'label': 'Ridge Crest (Inverted River Channel / Fault)',
        'color': '#ff7700',
        'weight': 2.5,
        'dashArray': None,
        'desc': 'Resistant topographic ridges formed by mineralized inverted river channels or exhumed fault ridges.'
    },
    'crest of crater rim': {
        'label': 'Crater Rim Crest',
        'color': '#ffffff',
        'weight': 2.2,
        'dashArray': '5, 5',
        'desc': 'Topographic crest line marking the rim edge of Jezero crater and surrounding impact structures.'
    },
    'crest of buried crater': {
        'label': 'Buried Crater Crest (Ghost Crater)',
        'color': '#b0b0b0',
        'weight': 2.0,
        'dashArray': '2, 4',
        'desc': 'Subsurface circular rims of ancient impact craters partially or wholly buried beneath later materials.'
    },
    'lineament': {
        'label': 'Structural Lineament / Fault Trace',
        'color': '#ff3366',
        'weight': 2.0,
        'dashArray': None,
        'desc': 'Tectonic fractures, joints, and fault traces related to regional crustal extension around the Isidis impact basin.'
    }
}

print('1. Processing GeoUnits_v1...')
gdf_units = gpd.read_file(GDB_PATH, layer='GeoUnits_v1', engine='pyogrio', method='SKIP')

# Standardize symbol (handle typos like 'Crater riim unit')
gdf_units['symbol'] = gdf_units['symbol'].replace({'CR': 'cr'})
gdf_units.loc[gdf_units['name'] == 'Crater riim unit', 'name'] = 'Crater rim unit'

# Calculate area in projected meters (km^2)
gdf_units['area_km2'] = (gdf_units.geometry.area / 1e6).round(4)

# Simplify polygon geometry with 12m tolerance to ensure crisp borders and fast loading
gdf_units_simp = gdf_units.copy()
gdf_units_simp['geometry'] = gdf_units.geometry.simplify(tolerance=12.0, preserve_topology=True)
gdf_units_wgs = gdf_units_simp.to_crs(epsg=4326)

# Populate properties
features = []
for idx, row in gdf_units_wgs.iterrows():
    sym = row['symbol']
    u_info = UNIT_INFO.get(sym, {
        'name': row['name'],
        'epoch': 'Unknown',
        'category': 'Other',
        'color': '#888888',
        'fillOpacity': 0.5,
        'lithology': 'N/A',
        'description': '',
        'perseverance_role': ''
    })
    
    props = {
        'id': int(idx),
        'symbol': sym,
        'name': u_info['name'],
        'epoch': u_info['epoch'],
        'category': u_info['category'],
        'color': u_info['color'],
        'fillOpacity': u_info['fillOpacity'],
        'lithology': u_info['lithology'],
        'description': u_info['description'],
        'perseverance_role': u_info['perseverance_role'],
        'area_km2': float(row['area_km2'])
    }
    features.append({
        'type': 'Feature',
        'properties': props,
        'geometry': mapping(row['geometry'])
    })

geounits_geojson = {
    'type': 'FeatureCollection',
    'features': features
}

with open(os.path.join(OUTPUT_DIR, 'geounits.geojson'), 'w') as f:
    json.dump(geounits_geojson, f)
print(f'   Saved geounits.geojson ({len(features)} features)')

print('2. Processing LinearFeatures...')
gdf_lines = gpd.read_file(GDB_PATH, layer='LinearFeatures', engine='pyogrio', method='SKIP')
gdf_lines_simp = gdf_lines.copy()
gdf_lines_simp['geometry'] = gdf_lines.geometry.simplify(tolerance=10.0, preserve_topology=True)
gdf_lines_wgs = gdf_lines_simp.to_crs(epsg=4326)

line_features = []
for idx, row in gdf_lines_wgs.iterrows():
    ftype = row['TYPE']
    style = LINEAR_STYLES.get(ftype, {
        'label': ftype,
        'color': '#ffffff',
        'weight': 1.5,
        'dashArray': None,
        'desc': ''
    })
    props = {
        'id': int(idx),
        'type': ftype,
        'label': style['label'],
        'color': style['color'],
        'weight': style['weight'],
        'dashArray': style['dashArray'],
        'description': style['desc'],
        'length_m': round(float(row['SHAPE_Length']), 1)
    }
    line_features.append({
        'type': 'Feature',
        'properties': props,
        'geometry': mapping(row['geometry'])
    })

with open(os.path.join(OUTPUT_DIR, 'linear_features.geojson'), 'w') as f:
    json.dump({'type': 'FeatureCollection', 'features': line_features}, f)
print(f'   Saved linear_features.geojson ({len(line_features)} features)')

print('3. Processing GeoContacts...')
gdf_contacts = gpd.read_file(GDB_PATH, layer='GeoContacts', engine='pyogrio', method='SKIP')
gdf_contacts_simp = gdf_contacts.copy()
gdf_contacts_simp['geometry'] = gdf_contacts.geometry.simplify(tolerance=15.0, preserve_topology=True)
gdf_contacts_wgs = gdf_contacts_simp.to_crs(epsg=4326)

contact_features = []
for idx, row in gdf_contacts_wgs.iterrows():
    ctype = row['TYPE']
    is_approx = 'approximate' in str(ctype).lower()
    contact_features.append({
        'type': 'Feature',
        'properties': {
            'id': int(idx),
            'type': ctype,
            'color': '#444444' if is_approx else '#222222',
            'dashArray': '4, 4' if is_approx else None,
            'weight': 0.9 if is_approx else 1.2
        },
        'geometry': mapping(row['geometry'])
    })

with open(os.path.join(OUTPUT_DIR, 'contacts.geojson'), 'w') as f:
    json.dump({'type': 'FeatureCollection', 'features': contact_features}, f)
print(f'   Saved contacts.geojson ({len(contact_features)} features)')

print('4. Processing LandingEllipse...')
gdf_ellipse = gpd.read_file(GDB_PATH, layer='LandingEllipse', engine='pyogrio', method='SKIP').to_crs(epsg=4326)
ell_geom = gdf_ellipse.geometry.iloc[0]
landing_geojson = {
    'type': 'FeatureCollection',
    'features': [
        {
            'type': 'Feature',
            'properties': {
                'name': 'NASA Mars 2020 Perseverance Landing Ellipse',
                'description': 'Target landing zone for Mars 2020 mission (7.7 x 6.6 km ellipse, ~53.3 km²).',
                'touchdown_site': 'Octavia E. Butler Landing (18.4447°N, 77.4508°E)',
                'touchdown_sol0': 'Feb 18, 2021',
                'area_km2': 53.26
            },
            'geometry': mapping(ell_geom)
        },
        {
            'type': 'Feature',
            'properties': {
                'name': 'Octavia E. Butler Landing Site',
                'type': 'Touchdown Coordinate',
                'lat': 18.4447,
                'lon': 77.4508,
                'elevation_m': -2570
            },
            'geometry': {
                'type': 'Point',
                'coordinates': [77.4508, 18.4447]
            }
        }
    ]
}
with open(os.path.join(OUTPUT_DIR, 'landing_ellipse.geojson'), 'w') as f:
    json.dump(landing_geojson, f)
print('   Saved landing_ellipse.geojson')

print('5. Processing Megabreccia & Location Features & Nomenclature...')
gdf_mb = gpd.read_file(GDB_PATH, layer='megabreccia_fig2', engine='pyogrio', method='SKIP').to_crs(epsg=4326)
gdf_craters = gpd.read_file(GDB_PATH, layer='LocationFeatures', engine='pyogrio', method='SKIP').to_crs(epsg=4326)
gdf_nom = gpd.read_file(GDB_PATH, layer='Nomenclature', engine='pyogrio', method='SKIP').to_crs(epsg=4326)

points_list = []
for idx, r in gdf_mb.iterrows():
    c = r.geometry
    points_list.append({
        'type': 'Feature',
        'properties': {
            'class': 'megabreccia',
            'title': 'Isidis Megabreccia Outcrop',
            'desc': 'Shattered basement bedrock block thrown and uplifted by the Isidis basin impact event.'
        },
        'geometry': mapping(c)
    })

for idx, r in gdf_craters.iterrows():
    c = r.geometry
    points_list.append({
        'type': 'Feature',
        'properties': {
            'class': 'small_crater',
            'title': 'Small Impact Crater',
            'desc': 'Secondary or small primary impact crater excavated into local terrain.'
        },
        'geometry': mapping(c)
    })

nom_landmarks = []
for idx, r in gdf_nom.iterrows():
    c = r.geometry.centroid
    nom_landmarks.append({
        'type': 'Feature',
        'properties': {
            'name': r['TextString'].strip(),
            'fontSize': float(r['FontSize']),
            'lat': round(c.y, 4),
            'lon': round(c.x, 4)
        },
        'geometry': mapping(c)
    })

with open(os.path.join(OUTPUT_DIR, 'megabreccia_points.geojson'), 'w') as f:
    json.dump({'type': 'FeatureCollection', 'features': points_list}, f)

with open(os.path.join(OUTPUT_DIR, 'landmarks.json'), 'w') as f:
    json.dump(nom_landmarks, f, indent=2)
print(f'   Saved megabreccia_points.geojson ({len(points_list)} points) and landmarks.json ({len(nom_landmarks)} landmarks)')

print('6. Processing Cross-Sections and Elevation Profiles...')
gdf_cs = gpd.read_file(GDB_PATH, layer='CrossSections', engine='pyogrio', method='SKIP')
gdf_cs_wgs = gdf_cs.to_crs(epsg=4326)

cs_geojson_features = []
for idx, r in gdf_cs_wgs.iterrows():
    cs_geojson_features.append({
        'type': 'Feature',
        'properties': {
            'profile': r['profile'],
            'title': f'Cross-Section {r["profile"]}–{r["profile"]}\'',
            'length_km': round(float(r['SHAPE_Length']) / 1000.0, 2)
        },
        'geometry': mapping(r.geometry)
    })

with open(os.path.join(OUTPUT_DIR, 'cross_sections.geojson'), 'w') as f:
    json.dump({'type': 'FeatureCollection', 'features': cs_geojson_features}, f)

# Sample DEM along profiles
with open('dem_grid.asc') as f:
    hdr = {line.split()[0]: float(line.split()[1]) for line in [f.readline() for _ in range(7)]}
    grid = np.loadtxt(f)

nrows, ncols = int(hdr['nrows']), int(hdr['ncols'])
xll, yll = hdr['xllcorner'], hdr['yllcorner']
dx, dy = hdr['dx'], hdr['dy']
nodata = hdr['NODATA_value']

profiles_data = {}
for idx, row in gdf_cs.iterrows():
    p = row['profile']
    line = list(row.geometry.geoms)[0]
    coords = np.array(line.coords)
    n_pts = 120
    t = np.linspace(0, 1, n_pts)
    xs = coords[0, 0] + t * (coords[-1, 0] - coords[0, 0])
    ys = coords[0, 1] + t * (coords[-1, 1] - coords[0, 1])
    dists = (t * row.geometry.length / 1000.0).round(2).tolist()

    col_idx = np.clip(((xs - xll) / dx).astype(int), 0, ncols - 1)
    row_idx = np.clip((nrows - 1 - ((ys - yll) / dy)).astype(int), 0, nrows - 1)
    elevs = grid[row_idx, col_idx]

    pts = [Point(x, y) for x, y in zip(xs, ys)]
    pts_gdf = gpd.GeoDataFrame(geometry=pts, crs=gdf_cs.crs)
    joined = gpd.sjoin(pts_gdf, gdf_units[['symbol', 'name', 'geometry']], how='left', predicate='intersects')
    joined = joined[~joined.index.duplicated(keep='first')]

    syms = joined['symbol'].fillna('su').tolist()
    names = [UNIT_INFO.get(s, {}).get('name', 'Unknown') for s in syms]
    colors = [UNIT_INFO.get(s, {}).get('color', '#888888') for s in syms]

    valid_elevs = [float(e) if e != nodata else -2200.0 for e in elevs]

    profiles_data[p] = {
        'profile': p,
        'title': f'Cross-Section {p}–{p}\'',
        'length_km': round(row.geometry.length / 1000.0, 2),
        'distances': dists,
        'elevations': valid_elevs,
        'units': syms,
        'unit_names': names,
        'unit_colors': colors
    }

with open(os.path.join(OUTPUT_DIR, 'profiles_elevation.json'), 'w') as f:
    json.dump(profiles_data, f)
print('   Saved profiles_elevation.json')

print('7. Processing 3D Elevation Grid...')
# Export downsampled 3D elevation mesh for Three.js
# Replace nodata with neighboring mean or min
grid_clean = grid.copy()
grid_clean[grid_clean == nodata] = np.nan
valid_mean = np.nanmean(grid_clean)
# Fill NaNs with valid_mean
inds = np.where(np.isnan(grid_clean))
grid_clean[inds] = valid_mean

# Downsample grid_clean to 80x84 for smooth 3D performance
from PIL import Image
dem_img = Image.fromarray(grid_clean)
dem_small = dem_img.resize((80, 84), resample=Image.Resampling.BILINEAR)
dem_small_arr = np.array(dem_small)

terrain_3d = {
    'width': 80,
    'height': 84,
    'bounds': {'lon_min': 76.8, 'lon_max': 77.8, 'lat_min': 17.7, 'lat_max': 18.7},
    'elev_min': float(dem_small_arr.min()),
    'elev_max': float(dem_small_arr.max()),
    'grid': dem_small_arr.round(1).tolist()
}

with open(os.path.join(OUTPUT_DIR, 'terrain_3d.json'), 'w') as f:
    json.dump(terrain_3d, f)
print('   Saved terrain_3d.json')

print('8. Generating Statistics and Analytical Summary...')
stats_units = []
total_area = float(gdf_units['area_km2'].sum())
for sym, group in gdf_units.groupby('symbol'):
    u_info = UNIT_INFO.get(sym, {})
    area_km2 = float(group['area_km2'].sum())
    stats_units.append({
        'symbol': sym,
        'name': u_info.get('name', sym),
        'epoch': u_info.get('epoch', 'N/A'),
        'category': u_info.get('category', 'Other'),
        'color': u_info.get('color', '#888888'),
        'count': int(len(group)),
        'area_km2': round(area_km2, 2),
        'area_pct': round((area_km2 / total_area) * 100, 2),
        'description': u_info.get('description', ''),
        'perseverance_role': u_info.get('perseverance_role', '')
    })

stats_units.sort(key=lambda x: x['area_km2'], reverse=True)

linear_stats = []
for ftype, group in gdf_lines.groupby('TYPE'):
    s = LINEAR_STYLES.get(ftype, {})
    total_len_km = float(group['SHAPE_Length'].sum()) / 1000.0
    linear_stats.append({
        'type': ftype,
        'label': s.get('label', ftype),
        'color': s.get('color', '#ffffff'),
        'count': int(len(group)),
        'total_length_km': round(total_len_km, 2)
    })
linear_stats.sort(key=lambda x: x['count'], reverse=True)

atlas_summary = {
    'title': 'Jezero Crater & Nili Planum Geological Atlas',
    'source': 'USGS Scientific Investigations Map 3464 (Sun & Stack, 2020) & NASA Mars 2020 Mission',
    'map_extent': {
        'lon_min': 76.8,
        'lon_max': 77.8,
        'lat_min': 17.7,
        'lat_max': 18.7,
        'dimensions_km': '60 x 60 km',
        'total_mapped_area_km2': round(total_area, 2)
    },
    'units': stats_units,
    'linear_features': linear_stats,
    'total_polygons': len(gdf_units),
    'total_contacts': len(gdf_contacts),
    'total_megabreccia_points': len(gdf_mb),
    'total_small_craters': len(gdf_craters),
    'landing_site': {
        'name': 'Octavia E. Butler Landing',
        'lat': 18.4447,
        'lon': 77.4508,
        'ellipse_area_km2': 53.26,
        'primary_units': [
            {'symbol': 'Njf', 'name': 'Jezero floor unit', 'pct': 49.2},
            {'symbol': 'NHjf2', 'name': 'Jezero fan 2 unit', 'pct': 32.0},
            {'symbol': 'Nle', 'name': 'Lower etched unit', 'pct': 9.3},
            {'symbol': 'Aeb', 'name': 'Eolian bedform unit', 'pct': 5.7},
            {'symbol': 'Nue', 'name': 'Upper etched unit', 'pct': 2.8},
            {'symbol': 'cr', 'name': 'Crater rim unit', 'pct': 1.0}
        ]
    }
}

with open(os.path.join(OUTPUT_DIR, 'summary_stats.json'), 'w') as f:
    json.dump(atlas_summary, f, indent=2)
print('   Saved summary_stats.json')

print('\nALL DATA PROCESSING COMPLETED SUCCESSFULLY!')
