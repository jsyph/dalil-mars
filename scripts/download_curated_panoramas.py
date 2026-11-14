import urllib.request
import os
from PIL import Image

os.makedirs('public/panoramas', exist_ok=True)

curated = [
    {
        'id': 'octavia_butler_360',
        'title': 'Octavia E. Butler Landing 360° Panorama',
        'sol': 3,
        'location': 'Jezero Landing Site & Crater Floor',
        'type': '360_sphere',
        'desc': 'NASA Perseverance Mastcam-Z first full 360-degree cylindrical panorama stitched from 142 individual frames. Shows the distant northern rim of Jezero Crater (2-3 km away) and gravel ripples.',
        'camera': 'Mastcam-Z (Stereo Dual Imager)',
        'url': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/5/50/Mastcam-Z%27s_First_360-Degree_Panorama_-_extended_version.jpg/1920px-Mastcam-Z%27s_First_360-Degree_Panorama_-_extended_version.jpg',
        'local': 'public/panoramas/octavia_butler_360.jpg',
        'publicPath': '/panoramas/octavia_butler_360.jpg'
    },
    {
        'id': 'van_zyl_overlook_360',
        'title': 'Van Zyl Overlook 360° Panoramic Vista',
        'sol': 68,
        'location': 'Van Zyl Overlook / Ingenuity Airfield',
        'type': '360_sphere',
        'desc': 'Perseverance Mastcam-Z 360° view of Van Zyl Overlook overlooking Wright Brothers Field where Ingenuity Mars Helicopter conducted historic flights. Features layered sedimentary rocks.',
        'camera': 'Mastcam-Z 110mm telephoto',
        'url': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/17/Mastcam-Z%27s_First_360-Degree_Panorama.jpg/1920px-Mastcam-Z%27s_First_360-Degree_Panorama.jpg',
        'local': 'public/panoramas/van_zyl_overlook_360.jpg',
        'publicPath': '/panoramas/van_zyl_overlook_360.jpg'
    },
    {
        'id': 'belva_crater_panorama',
        'title': 'Belva Crater Rim & Ancient Delta Basin',
        'sol': 772,
        'location': 'Belva Crater Ridge / Echo Creek',
        'type': 'panorama_wide',
        'desc': 'Panoramic view of the 0.9-km wide Belva impact crater. Shows tilted dipping sedimentary layers created by ancient Martian raging rivers billions of years ago.',
        'camera': 'Mastcam-Z Multi-Spectral',
        'url': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c8/Perseverance_at_Belva_Crater_%28SVS31227_-_perseverance_belva_crater%29.tiff/lossy-page1-1920px-Perseverance_at_Belva_Crater_%28SVS31227_-_perseverance_belva_crater%29.tiff.jpg',
        'local': 'public/panoramas/belva_crater_panorama.jpg',
        'publicPath': '/panoramas/belva_crater_panorama.jpg'
    },
    {
        'id': 'kodiak_butte_delta',
        'title': 'Mount Kodiak Delta Scarp Remnant',
        'sol': 114,
        'location': 'Delta Front & Kodiak Mesa',
        'type': 'panorama_wide',
        'desc': 'High-resolution panorama of the iconic Kodiak Butte. Distinct horizontal and angled bottomset/foreset bedding proves Jezero Crater once held a deep, active lake system.',
        'camera': 'SuperCam RMI & Mastcam-Z',
        'url': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/3/3e/Mars_-_Kodiak_-_Nasa%E2%80%99s_Perseverance_SOL_114_%2851262638022%29.png/1920px-Mars_-_Kodiak_-_Nasa%E2%80%99s_Perseverance_SOL_114_%2851262638022%29.png',
        'local': 'public/panoramas/kodiak_butte_delta.jpg',
        'publicPath': '/panoramas/kodiak_butte_delta.jpg'
    },
    {
        'id': 'wildcat_ridge_delta',
        'title': 'Wildcat Ridge Mudstone Astrobiology Target',
        'sol': 518,
        'location': 'Wildcat Ridge / Jezero Delta Front',
        'type': 'panorama_wide',
        'desc': 'Fine-grained sedimentary mudstone where Perseverance abraded the surface to search for organic biosignatures. Shows sulfate-filled veins in ancient delta clays.',
        'camera': 'Mastcam-Z Micro-Imager & SHERLOC',
        'url': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e6/PIA24928-Mars-PerseveranceRover-WildcatRidge-Sampling-20220804.jpg/1920px-PIA24928-Mars-PerseveranceRover-WildcatRidge-Sampling-20220804.jpg',
        'local': 'public/panoramas/wildcat_ridge_delta.jpg',
        'publicPath': '/panoramas/wildcat_ridge_delta.jpg'
    },
    {
        'id': 'jezero_floor_tracks',
        'title': 'Jezero Crater Floor & Rover Navcam Vista',
        'sol': 548,
        'location': 'South Séítah Dune Corridor',
        'type': 'panorama_wide',
        'desc': 'Perseverance Navcam wide vista looking back over hundreds of meters of rover wheel tracks traversing basaltic sand dunes and polygonal fractured bedrock.',
        'camera': 'Navcam Stereo Panoramic',
        'url': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b9/Marsrover_Perseverance_Navcam_Sol_548_%2852869886673%29.jpg/1920px-Marsrover_Perseverance_Navcam_Sol_548_%2852869886673%29.jpg',
        'local': 'public/panoramas/jezero_floor_tracks.jpg',
        'publicPath': '/panoramas/jezero_floor_tracks.jpg'
    }
]

for item in curated:
    print(f"Downloading {item['id']}...")
    try:
        req = urllib.request.Request(item['url'], headers={'User-Agent': 'DalilMarsApp/1.0 (contact@dalilmars.space)'})
        with urllib.request.urlopen(req) as r, open(item['local'], 'wb') as f:
            data = r.read()
            f.write(data)
        im = Image.open(item['local'])
        print(f"  OK {item['id']}: {im.size}, {len(data)/(1024*1024):.2f} MB")
    except Exception as e:
        print(f"  Failed {item['id']}:", e)
