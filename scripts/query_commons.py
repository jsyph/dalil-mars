import urllib.request
import json
import urllib.parse

queries = [
    "Mastcam-Z's First 360-Degree Panorama",
    "Perseverance Belva Crater",
    "Perseverance Van Zyl Overlook",
    "Perseverance Kodiak",
    "Perseverance Wildcat Ridge",
    "Perseverance Delta Front"
]

all_titles = []
for q in queries:
    url = f"https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch={urllib.parse.quote(q)}&srnamespace=6&format=json"
    req = urllib.request.Request(url, headers={'User-Agent': 'DalilMarsApp/1.0 (test@dalilmars.nasa)'})
    try:
        with urllib.request.urlopen(req) as r:
            data = json.loads(r.read())
            for item in data.get('query', {}).get('search', [])[:3]:
                all_titles.append(item['title'])
    except Exception as e:
        print(f"Error for {q}:", e)

# Deduplicate
all_titles = list(dict.fromkeys(all_titles))
print(f"Total unique file titles: {len(all_titles)}")

# Now query image info (urls, thumbnails)
for title in all_titles:
    t_url = f"https://commons.wikimedia.org/w/api.php?action=query&titles={urllib.parse.quote(title)}&prop=imageinfo&iiprop=url|size|mime&iiurlwidth=1920&format=json"
    req = urllib.request.Request(t_url, headers={'User-Agent': 'DalilMarsApp/1.0 (test@dalilmars.nasa)'})
    try:
        with urllib.request.urlopen(req) as r:
            pdata = json.loads(r.read())
            pages = pdata.get('query', {}).get('pages', {})
            for pid, p in pages.items():
                ii = p.get('imageinfo', [{}])[0]
                thumb = ii.get('thumburl')
                orig = ii.get('url')
                w = ii.get('width')
                h = ii.get('height')
                print(f"--- {title} ---")
                print(f"  Dimensions: {w}x{h}")
                print(f"  Original: {orig}")
                print(f"  Web 1920px: {thumb}")
    except Exception as e:
        print(f"Error fetching info for {title}:", e)
