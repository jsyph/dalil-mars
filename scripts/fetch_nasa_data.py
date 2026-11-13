"""
NASA Jezero Crater Data Harvester
Fetches real Perseverance waypoints, MEDA weather, and raw surface images
from official NASA/JPL feeds and caches them locally for zero-latency offline reliability.
"""

import json
import os
import urllib.request

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "src", "data")
os.makedirs(DATA_DIR, exist_ok=True)

HEADERS = {"User-Agent": "Mozilla/5.0 (ARES-EVA Hackathon Tool)"}


def fetch_json(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def harvest_waypoints():
    print("Fetching NASA M20 Perseverance waypoints...")
    url = "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json"
    raw = fetch_json(url)
    features = raw.get("features", [])
    cleaned = []
    for f in features:
        p = f.get("properties", {})
        coords = f.get("geometry", {}).get("coordinates", [0, 0, 0])
        cleaned.append({
            "rmc": p.get("RMC"),
            "sol": p.get("sol"),
            "lat": round(p.get("lat", coords[1]), 6),
            "lon": round(p.get("lon", coords[0]), 6),
            "elev": round(p.get("elev_geoid", coords[2] if len(coords) > 2 else -2500), 2),
            "tilt": round(p.get("tilt", 0), 2),
            "dist_m": round(p.get("dist_m", 0), 2),
            "dist_total_m": round(p.get("dist_total_m", 0), 2),
        })
    out_path = os.path.join(DATA_DIR, "jezero_waypoints.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(cleaned, f, indent=2)
    print(f"Saved {len(cleaned)} waypoints to {out_path}")
    return cleaned


def harvest_weather():
    print("Fetching NASA M20 MEDA weather...")
    url = "https://mars.nasa.gov/rss/api/?feed=weather&category=mars2020&feedtype=json"
    raw = fetch_json(url)
    sols = raw.get("sols", [])
    out_path = os.path.join(DATA_DIR, "meda_weather.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(sols, f, indent=2)
    print(f"Saved {len(sols)} MEDA weather sols to {out_path}")
    return sols


def harvest_pov_images():
    print("Fetching NASA M20 Raw Images for key sols (landscape cameras)...")
    target_sols = [0, 100, 350, 500, 680, 900, 1200, 1500, 2000]
    preferred_cams = ("MCZ_LEFT", "MCZ_RIGHT", "NAVCAM_LEFT", "NAVCAM_RIGHT", "FRONT_HAZCAM_LEFT_A")
    collected = []
    for sol in target_sols:
        url = (
            f"https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020"
            f"&feedtype=json&sol={sol}&num=25&page=0"
        )
        try:
            data = fetch_json(url)
            imgs = data.get("images", [])
            chosen = None
            for cam in preferred_cams:
                for img in imgs:
                    if img.get("camera", {}).get("instrument") == cam:
                        chosen = img
                        break
                if chosen:
                    break
            if not chosen and imgs:
                chosen = imgs[0]
            if chosen:
                img_files = chosen.get("image_files", {})
                img_url = img_files.get("medium") or img_files.get("large") or img_files.get("full_res")
                if img_url:
                    collected.append({
                        "sol": sol,
                        "title": chosen.get("title", f"Sol {sol} Surface View"),
                        "camera": chosen.get("camera", {}).get("instrument", "NAVCAM"),
                        "caption": chosen.get("caption", ""),
                        "url": img_url,
                        "date_taken": chosen.get("date_taken_utc", ""),
                    })
        except Exception as e:
            print(f"Warning: failed sol {sol}: {e}")

    out_path = os.path.join(DATA_DIR, "pov_images.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(collected, f, indent=2)
    print(f"Saved {len(collected)} ground POV images to {out_path}")
    return collected


if __name__ == "__main__":
    harvest_waypoints()
    harvest_weather()
    harvest_pov_images()
    print("Done harvesting NASA Jezero Crater data!")
