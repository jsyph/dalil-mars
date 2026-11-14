import urllib.request
import os
from PIL import Image

headers = {'User-Agent': 'DalilMarsApp/1.0 (contact@dalilmars.space)'}

downloads = [
    {
        'file': 'jezero_landing_site_360.jpg',
        'url': 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/17/Mastcam-Z%27s_First_360-Degree_Panorama.jpg/1920px-Mastcam-Z%27s_First_360-Degree_Panorama.jpg',
    },
    {
        'file': 'jezero_rim_horizon.jpg',
        'url': 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f6/Jezero_Crater_Rim_Panorama_NASA_Perseverance_rover.jpg/1920px-Jezero_Crater_Rim_Panorama_NASA_Perseverance_rover.jpg',
    },
    {
        'file': 'jezero_tracks_floor.jpg',
        'url': 'https://upload.wikimedia.org/wikipedia/commons/a/a1/PIA25171-MarsPerseveranceRover-Tracks-20220317.jpg',
    }
]

for d in downloads:
    filename = d['file']
    target_pub = os.path.join('public', 'panoramas', filename)
    target_dist = os.path.join('dist', 'panoramas', filename)
    print(f"Downloading {filename}...")
    req = urllib.request.Request(d['url'], headers=headers)
    with urllib.request.urlopen(req, timeout=30) as resp:
        content = resp.read()
    
    with open(target_pub, 'wb') as f:
        f.write(content)
    if os.path.exists('dist/panoramas'):
        with open(target_dist, 'wb') as f:
            f.write(content)
        
    img = Image.open(target_pub)
    print(f"  OK {filename}: {img.size}, format={img.format}, bytes={len(content)}")
