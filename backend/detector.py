import os
import io
import base64
import numpy as np
import cv2
from PIL import Image

MODEL_PATH = os.environ.get("MODEL_PATH", "models/best.pt")

SEV_COLORS = {
    "Low":    (50,  205, 50),
    "Medium": (255, 165, 0),
    "High":   (220, 50,  50),
}

def compute_severity(img_bgr, x1, y1, x2, y2):
    H, W = img_bgr.shape[:2]
    rel_area = ((x2 - x1) * (y2 - y1)) / (W * H)

    gray  = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    patch = gray[max(0, y1):y2, max(0, x1):x2]

    if patch.size < 100:
        return 0, "Low"

    clahe_obj = cv2.createCLAHE(2.0, (8, 8))
    enh       = clahe_obj.apply(cv2.GaussianBlur(patch, (5, 5), 0))
    _, binary = cv2.threshold(enh, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    cnts, _   = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    if cnts:
        largest = max(cnts, key=cv2.contourArea)
        area_c  = cv2.contourArea(largest)
        peri_c  = cv2.arcLength(largest, True)
        circ    = (4 * np.pi * area_c / peri_c ** 2) if peri_c > 0 else 0.5
    else:
        circ = 0.5

    darkness = 1.0 - (patch.mean() / 255.0)

    score = (
        min(rel_area / 0.05, 1.0) * 40 +
        (1 - min(circ, 1.0))      * 30 +
        darkness                  * 30
    )

    if score < 30:
        severity = "Low"
    elif score < 60:
        severity = "Medium"
    else:
        severity = "High"

    return round(score, 1), severity


class RoadDamageDetector:

    def __init__(self):
        self.model = None
        self._load_model()

    def _load_model(self):
        try:
            from ultralytics import YOLO
            import torch
            from ultralytics.nn.tasks import DetectionModel
            from torch.nn.modules.container import Sequential
            from ultralytics.nn.modules.conv import Conv

            # 🔥 Allow required classes
            torch.serialization.add_safe_globals([
                DetectionModel,
                Sequential,
                Conv
            ])

            MODEL_PATH = "models/best.pt"

            if os.path.exists(MODEL_PATH):
                self.model = YOLO(MODEL_PATH)
                print(f"✅ Model loaded from {MODEL_PATH}")
            else:
                print("❌ Model file not found → Demo mode")
                self.model = None

        except Exception as e:
            print(f"❌ Model loading failed: {e}")
            self.model = None

    def detect(self, image: Image.Image) -> dict:
        img_bgr = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)

        if self.model is not None:
            return self._detect_yolo(img_bgr)

        return self._detect_demo(img_bgr)

    def _detect_yolo(self, img_bgr):
        results = self.model(img_bgr, conf=0.30, verbose=False)[0]
        detections = []

        for box in results.boxes:
            x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
            conf_val = float(box.conf[0])

            score, severity = compute_severity(img_bgr, x1, y1, x2, y2)

            detections.append({
                "class": "pothole",
                "confidence": round(conf_val, 3),
                "score": score,
                "severity": severity,
                "bbox": [x1, y1, x2, y2],
            })

        annotated = self._draw_boxes(img_bgr.copy(), detections)
        return self._build_response(detections, annotated, img_bgr.shape[1], img_bgr.shape[0])

    def _detect_demo(self, img_bgr):
        import random
        random.seed(42)
        H, W = img_bgr.shape[:2]
        detections = []

        for _ in range(random.randint(2, 4)):
            x1 = random.randint(0, W - 120)
            y1 = random.randint(0, H - 90)
            x2 = min(x1 + random.randint(60, 180), W)
            y2 = min(y1 + random.randint(50, 130), H)
            score, severity = compute_severity(img_bgr, x1, y1, x2, y2)
            detections.append({
                "class":      "pothole",
                "confidence": round(random.uniform(0.35, 0.92), 3),
                "score":      score,
                "severity":   severity,
                "bbox":       [x1, y1, x2, y2],
            })

        annotated = self._draw_boxes(img_bgr.copy(), detections)
        return self._build_response(detections, annotated, img_bgr.shape[1], img_bgr.shape[0])

    def _draw_boxes(self, img_bgr, detections):
        for det in detections:
            x1, y1, x2, y2 = det["bbox"]
            col   = SEV_COLORS[det["severity"]]
            label = f"{det['severity']}  {det['score']}/100  conf:{det['confidence']:.2f}"
            lw    = max(len(label) * 8, 10)
            cv2.rectangle(img_bgr, (x1, y1), (x2, y2), col, 3)
            cv2.rectangle(img_bgr, (x1, y1 - 22), (x1 + lw, y1), col, -1)
            cv2.putText(img_bgr, label, (x1 + 2, y1 - 6),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.44, (255, 255, 255), 1)
        return img_bgr

    def _build_response(self, detections, img_bgr, width, height):
        severity_counts = {"Low": 0, "Medium": 0, "High": 0}
        for d in detections:
            severity_counts[d["severity"]] += 1

        img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
        pil_img = Image.fromarray(img_rgb)
        buf     = io.BytesIO()
        pil_img.save(buf, format="PNG")
        img_b64 = base64.b64encode(buf.getvalue()).decode("utf-8")

        return {
            "total_count":        len(detections),
            "severity_breakdown": severity_counts,
            "detections":         detections,
            "image_size":         {"width": width, "height": height},
            "annotated_image":    f"data:image/png;base64,{img_b64}",
            "demo_mode":          self.model is None,
        }
