import asyncio
import base64
import json
import logging
import os
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from google import genai
from google.genai import types

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("nototoki")

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(
    title="Future VJ // Lyria Camera & Shader Vibe Studio",
    description="Future VJ — PC Camera & Hand Gesture to Real-Time Music Web App",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


MAX_IMAGE_BYTES = 2 * 1024 * 1024  # 2 MB


class FrameAnalysisRequest(BaseModel):
    image_base64: str = Field(..., min_length=16, max_length=2_800_000)
    api_key: Optional[str] = Field(default=None, max_length=256)
    current_genre: Optional[str] = Field(
        default="keynote_techno", max_length=64, pattern=r"^[a-zA-Z0-9_-]+$"
    )
    motion_energy: Optional[float] = Field(default=0.5, ge=0.0, le=1.0)
    brightness: Optional[float] = Field(default=0.5, ge=0.0, le=1.0)
    dominant_hue: Optional[float] = Field(default=180.0, ge=0.0, le=360.0)
    hand_summary: Optional[str] = Field(default=None, max_length=200)


class WeightedPromptItem(BaseModel):
    text: str
    weight: float


class FrameAnalysisResponse(BaseModel):
    scene_description_ja: str
    scene_mood: str
    musical_direction_ja: str
    suggested_bpm: int
    suggested_scale: str
    root_note: str
    filter_cutoff_norm: float
    reverb_mix: float
    arp_density: float
    drum_intensity: float
    weighted_prompts: List[WeightedPromptItem]
    source: str


def _get_genai_client(api_key: Optional[str] = None) -> Optional[genai.Client]:
    key = (api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY") or "").strip()
    if key:
        return genai.Client(api_key=key)
    project = os.environ.get("GOOGLE_CLOUD_PROJECT") or os.environ.get("GEMINI_DEFAULT_PROJECT")
    if project:
        try:
            return genai.Client(vertexai=True, project=project, location="global")
        except Exception as exc:
            logger.warning("Failed to initialize Vertex AI client: %s", exc)
    return None


def _heuristic_scene_analysis(req: FrameAnalysisRequest) -> FrameAnalysisResponse:
    """Fallback deterministic analysis when Gemini API is unavailable or unconfigured."""
    hue = req.dominant_hue or 180.0
    brightness = req.brightness if req.brightness is not None else 0.5
    motion = req.motion_energy if req.motion_energy is not None else 0.3

    if hue < 45 or hue >= 315:
        color_desc = "ウォームな赤・マゼンタ系トーン"
        scale = "phrygian"
        root = "E"
        base_prompt = "Warm Analog Synthwave, Driving Bassline, Neon Arpeggio"
    elif hue < 105:
        color_desc = "鮮やかなアンバー・ゴールド系トーン"
        scale = "lydian"
        root = "F"
        base_prompt = "Euphoric Progressive House, Bright Pluck, Shimmering Pads"
    elif hue < 170:
        color_desc = "オーガニックなエメラルド・グリーン系トーン"
        scale = "dorian"
        root = "D"
        base_prompt = "Organic Modular Synth, Lush Ambient Textures, Percussive Groove"
    elif hue < 255:
        color_desc = "クールなサイバーブルー・シアン系トーン"
        scale = "minor"
        root = "C"
        base_prompt = "Futuristic Melodic Techno, Deep Sub Bass, Crystalline Arp"
    else:
        color_desc = "ディープなバイオレット・パープル系トーン"
        scale = "dorian"
        root = "A"
        base_prompt = "Cosmic Synth Odyssey, Atmospheric Choir Pad, Hypnotic Beat"

    if motion > 0.55:
        motion_desc = "ダイナミックな動き・高いエネルギー"
        mood = "Energetic & Driving"
        bpm = int(124 + min(motion, 1.0) * 18)
        drum_int = min(1.0, 0.65 + motion * 0.35)
        arp_dens = min(1.0, 0.6 + motion * 0.4)
    elif motion > 0.22:
        motion_desc = "心地よいグルーヴと適度なモーション"
        mood = "Groovy & Evolving"
        bpm = int(112 + motion * 22)
        drum_int = 0.55
        arp_dens = 0.55
    else:
        motion_desc = "穏やかで静謐なカメラシーン"
        mood = "Atmospheric & Lush"
        bpm = int(96 + brightness * 18)
        drum_int = 0.3
        arp_dens = 0.35

    hand_note = f" / ハンドジェスチャー: {req.hand_summary}" if req.hand_summary else ""
    scene_ja = f"{color_desc}・{motion_desc}（輝度 {int(brightness * 100)}%）{hand_note}"
    direction_ja = (
        f"キー {root} {scale.capitalize()} / {bpm} BPM — "
        f"カメラの色相と動きに合わせてフィルターとアルペジオをリアルタイム変調中"
    )

    prompts = [
        WeightedPromptItem(text=base_prompt, weight=1.0),
        WeightedPromptItem(
            text="High Energy Four-on-the-Floor Drums & Acid Bass"
            if motion > 0.45
            else "Deep Evolving Ambient Pad & Subtle Pulse",
            weight=round(0.4 + motion * 0.6, 2),
        ),
        WeightedPromptItem(
            text="Bright Shimmering Highs & Sparkling Leads"
            if brightness > 0.5
            else "Warm Low-Pass Filtered Dub Chords",
            weight=round(0.35 + brightness * 0.6, 2),
        ),
    ]

    return FrameAnalysisResponse(
        scene_description_ja=scene_ja,
        scene_mood=mood,
        musical_direction_ja=direction_ja,
        suggested_bpm=bpm,
        suggested_scale=scale,
        root_note=root,
        filter_cutoff_norm=round(min(1.0, max(0.15, brightness * 0.85 + motion * 0.25)), 2),
        reverb_mix=round(min(0.85, max(0.15, 0.75 - motion * 0.4)), 2),
        arp_density=round(arp_dens, 2),
        drum_intensity=round(drum_int, 2),
        weighted_prompts=prompts,
        source="vision_engine",
    )


@app.get("/api/status")
async def get_status():
    has_env_key = bool(os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"))
    has_vertex = bool(os.environ.get("GOOGLE_CLOUD_PROJECT") or os.environ.get("GEMINI_DEFAULT_PROJECT"))
    return {
        "status": "ok",
        "app": "Future VJ",
        "has_env_api_key": has_env_key,
        "has_vertex_project": has_vertex,
    }


@app.post("/api/analyze-frame", response_model=FrameAnalysisResponse)
async def analyze_frame(req: FrameAnalysisRequest):
    client = _get_genai_client(req.api_key)
    if client is None:
        return _heuristic_scene_analysis(req)

    try:
        raw_b64 = req.image_base64
        mime_type = "image/jpeg"
        if "," in raw_b64:
            header, raw_b64 = raw_b64.split(",", 1)
            if "image/png" in header:
                mime_type = "image/png"
        try:
            image_bytes = base64.b64decode(raw_b64, validate=True)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid base64 image payload.")
        if len(image_bytes) > MAX_IMAGE_BYTES:
            raise HTTPException(status_code=413, detail="Image payload exceeds 2MB limit.")
        if image_bytes.startswith(b"\x89PNG"):
            mime_type = "image/png"

        system_instruction = (
            "You are the AI Music Director for Future VJ, an interactive Camera-to-Music "
            "and Shader Vibe audio-visual performance studio. "
            "Analyze the user's webcam frame along with motion/hand telemetry and return a JSON object "
            "that translates the visual scene into real-time musical parameters and Lyria RealTime weighted prompts.\n"
            "Return strictly valid JSON with these keys:\n"
            "- scene_description_ja: concise Japanese description of what the camera sees (1 sentence)\n"
            "- scene_mood: short English mood label (e.g., 'Cybernetic Euphoria', 'Warm Sunset Groove')\n"
            "- musical_direction_ja: concise Japanese explanation of how the visuals are shaping the music\n"
            "- suggested_bpm: integer between 85 and 145\n"
            "- suggested_scale: one of ['minor', 'dorian', 'phrygian', 'lydian', 'major', 'pentatonic']\n"
            "- root_note: one of ['C', 'D', 'E', 'F', 'G', 'A', 'B']\n"
            "- filter_cutoff_norm: float between 0.15 and 1.0\n"
            "- reverb_mix: float between 0.1 and 0.85\n"
            "- arp_density: float between 0.1 and 1.0\n"
            "- drum_intensity: float between 0.1 and 1.0\n"
            "- weighted_prompts: array of 3 objects with {'text': English music style/instrument prompt for Lyria RealTime, 'weight': float 0.2 to 1.0}"
        )

        telemetry_text = (
            f"Current genre preset: {req.current_genre}. "
            f"Measured motion energy: {req.motion_energy:.2f}, brightness: {req.brightness:.2f}, "
            f"dominant hue: {req.dominant_hue:.0f} deg. "
            f"Hand tracking state: {req.hand_summary or 'No hands detected'}."
        )

        response = await asyncio.to_thread(
            client.models.generate_content,
            model="gemini-4-argon",
            contents=[
                types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                telemetry_text,
            ],
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                response_mime_type="application/json",
                temperature=0.6,
            ),
        )

        data = json.loads(response.text)
        prompts = [
            WeightedPromptItem(
                text=str(p.get("text", "Melodic Electronic Synth")),
                weight=float(p.get("weight", 0.8)),
            )
            for p in data.get("weighted_prompts", [])[:4]
        ]
        if not prompts:
            prompts = [WeightedPromptItem(text="Futuristic Melodic Techno, Lush Synth Pad", weight=1.0)]

        scale = str(data.get("suggested_scale", "dorian")).lower()
        if scale not in {"minor", "dorian", "phrygian", "lydian", "major", "pentatonic"}:
            scale = "dorian"

        root = str(data.get("root_note", "C")).upper()[:1]
        if root not in {"C", "D", "E", "F", "G", "A", "B"}:
            root = "C"

        return FrameAnalysisResponse(
            scene_description_ja=str(data.get("scene_description_ja", "カメラ映像を解析中")),
            scene_mood=str(data.get("scene_mood", "Dynamic AI Groove")),
            musical_direction_ja=str(data.get("musical_direction_ja", "映像の色彩と動きからシンセパラメータを生成")),
            suggested_bpm=max(80, min(150, int(data.get("suggested_bpm", 120)))),
            suggested_scale=scale,
            root_note=root,
            filter_cutoff_norm=max(0.1, min(1.0, float(data.get("filter_cutoff_norm", 0.65)))),
            reverb_mix=max(0.1, min(0.9, float(data.get("reverb_mix", 0.4)))),
            arp_density=max(0.1, min(1.0, float(data.get("arp_density", 0.6)))),
            drum_intensity=max(0.1, min(1.0, float(data.get("drum_intensity", 0.6)))),
            weighted_prompts=prompts,
            source="gemini-4-argon",
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Gemini frame analysis fallback triggered: %s", exc)
        return _heuristic_scene_analysis(req)


@app.websocket("/ws/lyria")
async def lyria_realtime_ws(websocket: WebSocket):
    """WebSocket proxy to Google AI Studio Lyria RealTime (models/lyria-realtime-exp)."""
    await websocket.accept()
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    buffered_first_msg = None

    try:
        raw_init = await asyncio.wait_for(websocket.receive_text(), timeout=5.0)
        init_msg = json.loads(raw_init)
        if init_msg.get("action") == "init":
            client_key = (init_msg.get("api_key") or "").strip()
            if client_key:
                api_key = client_key
        else:
            buffered_first_msg = init_msg
    except asyncio.TimeoutError:
        pass
    except WebSocketDisconnect:
        return
    except Exception as exc:
        logger.warning("Failed to parse initial WebSocket message: %s", exc)

    if not api_key:
        await websocket.send_json(
            {
                "type": "error",
                "message": "Lyria RealTimeストリーミングにはGoogle AI StudioのGEMINI_API_KEYが必要です（内蔵Web AudioシンセはAPIキーなしで動作します）。",
            }
        )
        await websocket.close()
        return

    client = genai.Client(api_key=api_key, http_options={"api_version": "v1alpha"})
    try:
        async with client.aio.live.music.connect(model="models/lyria-realtime-exp") as session:
            await websocket.send_json({"type": "connected", "model": "models/lyria-realtime-exp"})

            async def receive_from_lyria():
                try:
                    async for message in session.receive():
                        server_content = getattr(message, "server_content", None)
                        if server_content and getattr(server_content, "audio_chunks", None):
                            for chunk in server_content.audio_chunks:
                                if chunk.data:
                                    b64_audio = base64.b64encode(chunk.data).decode("ascii")
                                    await websocket.send_json(
                                        {
                                            "type": "audio",
                                            "data": b64_audio,
                                            "mime_type": getattr(chunk, "mime_type", "audio/pcm;rate=48000"),
                                        }
                                    )
                except Exception as exc:
                    logger.warning("Lyria receive loop ended: %s", exc)

            lyria_task = asyncio.create_task(receive_from_lyria())

            async def handle_client_msg(msg: dict):
                action = msg.get("action")
                if action == "set_prompts":
                    prompts = [
                        types.WeightedPrompt(text=p["text"], weight=float(p.get("weight", 1.0)))
                        for p in msg.get("prompts", [])
                        if p.get("text")
                    ]
                    if prompts:
                        await session.set_weighted_prompts(prompts=prompts)
                elif action == "set_config":
                    cfg = msg.get("config", {})
                    await session.set_music_generation_config(
                        config=types.LiveMusicGenerationConfig(
                            bpm=int(cfg.get("bpm", 120)),
                            density=float(cfg.get("density", 0.6)),
                            brightness=float(cfg.get("brightness", 0.6)),
                            guidance=float(cfg.get("guidance", 4.0)),
                        )
                    )
                elif action == "play":
                    await session.play()
                elif action == "pause":
                    await session.pause()
                elif action == "stop":
                    await session.stop()

            try:
                if buffered_first_msg:
                    await handle_client_msg(buffered_first_msg)
                while True:
                    raw = await websocket.receive_text()
                    msg = json.loads(raw)
                    await handle_client_msg(msg)
            except WebSocketDisconnect:
                pass
            finally:
                lyria_task.cancel()
    except Exception as exc:
        logger.warning("Lyria RealTime session error: %s", exc)
        try:
            await websocket.send_json({"type": "error", "message": f"Lyria RealTime接続エラー: {exc}"})
        except Exception:
            pass
        try:
            await websocket.close()
        except Exception:
            pass


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
async def index():
    return FileResponse(str(STATIC_DIR / "index.html"))
