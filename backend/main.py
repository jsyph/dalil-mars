"""
Jezero Crater Mission Planner — FastAPI Backend
Entry point: uvicorn main:app --reload --port 8000
"""
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from dotenv import load_dotenv

from core.engine import get_engine
from routers import engine_api, tiles

try:
    from routers import layers, elevation, hazards
    _HAS_LEGACY_GIS = True
except ImportError:
    _HAS_LEGACY_GIS = False

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Warm-load Dalil-Mars Tactical Pathfinding Engine once at startup
    get_engine()
    yield


app = FastAPI(
    title="Jezero Mission Planner API",
    description="Backend for the Nili/Jezero Crater Mars mission planning web app.",
    version="2.0.0",
    lifespan=lifespan,
)

# ── CORS ──────────────────────────────────────────────────────────
origins = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:3000,http://localhost:8000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── API Routers ───────────────────────────────────────────────────
app.include_router(engine_api.router, prefix="/api", tags=["Dalil-Mars Engine"])
app.include_router(tiles.router, prefix="/tiles", tags=["Tiles"])

if _HAS_LEGACY_GIS:
    app.include_router(layers.router,    prefix="/api/layers",    tags=["Layers"])
    app.include_router(elevation.router, prefix="/api/elevation", tags=["Elevation"])
    app.include_router(hazards.router,   prefix="/api/hazards",   tags=["Hazards"])

# ── Ensure directories exist ──────────────────────────────────────
os.makedirs("data/cache", exist_ok=True)
static_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../ground-control"))
if not os.path.exists(static_dir):
    static_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../frontend"))

if os.path.exists(static_dir):
    frontend_data_dir = os.path.join(static_dir, "data")
    if os.path.exists(frontend_data_dir):
        app.mount("/data", StaticFiles(directory=frontend_data_dir), name="data")
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

@app.get("/")
async def root():
    index_path = os.path.join(static_dir, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {
        "status": "online",
        "app": "Jezero Mission Planner",
        "docs": "/docs",
    }

@app.get("/api/health", tags=["Health"])
async def health():
    gdb_path = os.getenv("GDB_PATH", "../data/Nili.gdb")
    return {
        "status": "ok",
        "gdb_found": os.path.exists(gdb_path),
        "gdb_path": gdb_path,
    }

