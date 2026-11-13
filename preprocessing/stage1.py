import numpy as np
import matplotlib.pyplot as plt

tif_path = "./output/stage_1_consolidated/consolidated_dtm_mosaic.tif"

print(f"Reading {tif_path}...")
try:
    import rasterio
    with rasterio.open(tif_path) as src:
        z = src.read(1)
except ImportError:
    from osgeo import gdal
    ds = gdal.Open(tif_path)
    if ds is None:
        raise FileNotFoundError(f"Could not open GeoTIFF at {tif_path}")
    z = ds.GetRasterBand(1).ReadAsArray()

    # Mask out the NaNs so they don't skew the colormap
    z_masked = np.ma.masked_invalid(z)

    # Check the actual values in the matrix
    print(f"Data Min: {z_masked.min():.2f}m")
    print(f"Data Max: {z_masked.max():.2f}m")

    if z_masked.min() == 0.0 and z_masked.max() == 0.0:
        print("WARNING: The data is still genuinely 0.0. The merge failed to capture the terrain.")
    else:
        print("Rendering preview image...")
        plt.figure(figsize=(12, 8))

        # 'terrain' colormap is great for topological data
        im = plt.imshow(z_masked, cmap="terrain")
        plt.colorbar(im, label="Elevation (meters)")

        plt.title("Jezero Crater - Consolidated Stage 1 DTM")
        plt.axis("off")

        plt.savefig("consolidated_preview.png", dpi=300, bbox_inches="tight")
        print("Saved successfully to consolidated_preview.png! Open this file to see your map.")
