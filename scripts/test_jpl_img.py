import urllib.request
import re

url = 'https://www.jpl.nasa.gov/images/mastcam-zs-first-360-degree-panorama'
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
try:
    with urllib.request.urlopen(req) as resp:
        html = resp.read().decode('utf-8', errors='ignore')
        jpgs = set(re.findall(r'https://[^\s"\'<>]+\.jpg', html, re.I))
        for j in sorted(jpgs):
            print(j)
except Exception as e:
    print('Error:', e)
