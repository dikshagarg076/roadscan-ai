from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn
import base64
import io
from PIL import Image
from detector import RoadDamageDetector

app = FastAPI(title="Pothole Detection API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

detector = RoadDamageDetector()


@app.get("/")
def root():
    return {"message": "Pothole Detection API running"}


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": detector.model is not None}


@app.post("/detect")
async def detect(file: UploadFile = File(...)):
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image.")
    contents = await file.read()
    image    = Image.open(io.BytesIO(contents)).convert("RGB")
    result   = detector.detect(image)
    return JSONResponse(content=result)


@app.post("/detect-url")
async def detect_url(payload: dict):
    try:
        img_data = payload.get("image", "")
        if img_data.startswith("data:image"):
            img_data = img_data.split(",")[1]
        image_bytes = base64.b64decode(img_data)
        image       = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        result      = detector.detect(image)
        return JSONResponse(content=result)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
