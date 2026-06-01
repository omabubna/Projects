"""
Safari Animal Detection - Python Backend Server
=================================================
Requirements:
    pip install fastapi uvicorn opencv-python onnxruntime numpy websockets aiohttp pillow

Run:
    python server.py

Then open: http://localhost:8000
"""

import asyncio
import json
import time
import threading
import urllib.request
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

# ===================== CONFIGURE THESE =====================
ESP32_CAM_IP   = "192.168.1.XXX"   # Replace with your ESP32-CAM IP from Serial Monitor
ONNX_MODEL_PATH = "yolov8n.onnx"   # Path to your ONNX model
CONF_THRESHOLD  = 0.45              # Detection confidence threshold
IOU_THRESHOLD   = 0.45             # NMS IOU threshold
INPUT_SIZE      = 640               # YOLOv8 input size
# ===========================================================

# COCO class names - YOLOv8 default (replace with your custom classes if fine-tuned)
CLASS_NAMES = [
    'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck',
    'boat', 'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench',
    'bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra',
    'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee',
    'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove',
    'skateboard', 'surfboard', 'tennis racket', 'bottle', 'wine glass', 'cup',
    'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple', 'sandwich', 'orange',
    'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch',
    'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse',
    'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink',
    'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier',
    'toothbrush'
]

# Wildlife-relevant classes for alerts
WILDLIFE_CLASSES = {'bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant',
                    'bear', 'zebra', 'giraffe'}

# Colors per class (BGR)
COLORS = np.random.uniform(50, 255, size=(len(CLASS_NAMES), 3))

app = FastAPI(title="Safari Detection Server")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ---- Global State ----
detection_state = {
    "detections": [],
    "fps": 0,
    "frame_count": 0,
    "last_frame_time": time.time(),
    "cam_ip": ESP32_CAM_IP,
    "status": "connecting",
    "alert_log": [],
}
connected_clients: list[WebSocket] = []
latest_annotated_frame: bytes = b""
frame_lock = threading.Lock()


# ---- ONNX Model Setup ----
class YOLOv8Detector:
    def __init__(self, model_path: str):
        print(f"Loading ONNX model: {model_path}")
        providers = ['CUDAExecutionProvider', 'CPUExecutionProvider']
        self.session = ort.InferenceSession(model_path, providers=providers)
        self.input_name = self.session.get_inputs()[0].name
        self.input_shape = self.session.get_inputs()[0].shape
        print(f"Model loaded. Input: {self.input_name} {self.input_shape}")
        print(f"Using provider: {self.session.get_providers()[0]}")

    def preprocess(self, frame):
        h, w = frame.shape[:2]
        # Letterbox resize
        scale = INPUT_SIZE / max(h, w)
        nh, nw = int(h * scale), int(w * scale)
        resized = cv2.resize(frame, (nw, nh))
        padded = np.full((INPUT_SIZE, INPUT_SIZE, 3), 114, dtype=np.uint8)
        pad_y = (INPUT_SIZE - nh) // 2
        pad_x = (INPUT_SIZE - nw) // 2
        padded[pad_y:pad_y+nh, pad_x:pad_x+nw] = resized
        img = padded.astype(np.float32) / 255.0
        img = img.transpose(2, 0, 1)[np.newaxis]
        return img, scale, pad_x, pad_y

    def postprocess(self, outputs, scale, pad_x, pad_y, orig_h, orig_w):
        preds = outputs[0][0].T  # (num_preds, 4+num_classes)
        boxes, scores, class_ids = [], [], []

        for row in preds:
            confs = row[4:]
            class_id = int(np.argmax(confs))
            conf = float(confs[class_id])
            if conf < CONF_THRESHOLD:
                continue
            cx, cy, bw, bh = row[:4]
            x1 = int((cx - bw/2 - pad_x) / scale)
            y1 = int((cy - bh/2 - pad_y) / scale)
            x2 = int((cx + bw/2 - pad_x) / scale)
            y2 = int((cy + bh/2 - pad_y) / scale)
            x1, y1 = max(0, x1), max(0, y1)
            x2, y2 = min(orig_w, x2), min(orig_h, y2)
            boxes.append([x1, y1, x2-x1, y2-y1])
            scores.append(conf)
            class_ids.append(class_id)

        indices = cv2.dnn.NMSBoxes(boxes, scores, CONF_THRESHOLD, IOU_THRESHOLD)
        results = []
        if len(indices) > 0:
            for i in indices.flatten():
                x, y, w, h = boxes[i]
                results.append({
                    "class_id": class_ids[i],
                    "class_name": CLASS_NAMES[class_ids[i]] if class_ids[i] < len(CLASS_NAMES) else f"class_{class_ids[i]}",
                    "confidence": round(scores[i], 3),
                    "bbox": [x, y, x+w, y+h],
                    "timestamp": datetime.now().isoformat(),
                })
        return results

    def detect(self, frame):
        orig_h, orig_w = frame.shape[:2]
        inp, scale, pad_x, pad_y = self.preprocess(frame)
        outputs = self.session.run(None, {self.input_name: inp})
        return self.postprocess(outputs, scale, pad_x, pad_y, orig_h, orig_w)


def draw_detections(frame, detections):
    for det in detections:
        x1, y1, x2, y2 = det["bbox"]
        cid = det["class_id"]
        color = tuple(COLORS[cid % len(COLORS)].tolist())
        label = f"{det['class_name']} {det['confidence']:.0%}"
        is_wildlife = det["class_name"] in WILDLIFE_CLASSES
        thickness = 3 if is_wildlife else 2

        cv2.rectangle(frame, (x1, y1), (x2, y2), color, thickness)
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
        cv2.rectangle(frame, (x1, y1-th-8), (x1+tw+4, y1), color, -1)
        cv2.putText(frame, label, (x1+2, y1-4),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0,0,0), 2)
    return frame


# ---- Initialize detector ----
detector = None
if Path(ONNX_MODEL_PATH).exists():
    try:
        detector = YOLOv8Detector(ONNX_MODEL_PATH)
        detection_state["status"] = "model_loaded"
    except Exception as e:
        print(f"Failed to load model: {e}")
        detection_state["status"] = "model_error"
else:
    print(f"WARNING: Model file not found at {ONNX_MODEL_PATH}")
    detection_state["status"] = "no_model"


# ---- Frame Capture + Inference Thread ----
def capture_and_detect():
    global latest_annotated_frame
    stream_url = f"http://{ESP32_CAM_IP}/stream"
    print(f"Connecting to camera stream: {stream_url}")

    while True:
        try:
            cap = cv2.VideoCapture(stream_url)
            if not cap.isOpened():
                print("Could not open stream, retrying in 3s...")
                detection_state["status"] = "disconnected"
                time.sleep(3)
                continue

            detection_state["status"] = "streaming"
            frame_times = []

            while True:
                ret, frame = cap.read()
                if not ret:
                    print("Stream lost, reconnecting...")
                    detection_state["status"] = "reconnecting"
                    break

                t0 = time.time()
                detections = []
                if detector:
                    try:
                        detections = detector.detect(frame)
                    except Exception as e:
                        print(f"Detection error: {e}")

                annotated = draw_detections(frame.copy(), detections)

                # FPS calc
                frame_times.append(time.time())
                frame_times = [ft for ft in frame_times if time.time() - ft < 1.0]

                detection_state["detections"] = detections
                detection_state["fps"] = len(frame_times)
                detection_state["frame_count"] += 1

                # Log wildlife alerts
                for det in detections:
                    if det["class_name"] in WILDLIFE_CLASSES:
                        alert = {
                            "time": datetime.now().strftime("%H:%M:%S"),
                            "animal": det["class_name"],
                            "confidence": det["confidence"],
                        }
                        detection_state["alert_log"] = [alert] + detection_state["alert_log"][:49]

                # Encode frame for MJPEG serving
                _, buf = cv2.imencode('.jpg', annotated, [cv2.IMWRITE_JPEG_QUALITY, 80])
                with frame_lock:
                    latest_annotated_frame = buf.tobytes()

                # Broadcast detections to WebSocket clients
                if connected_clients:
                    msg = json.dumps({
                        "type": "detection",
                        "detections": detections,
                        "fps": detection_state["fps"],
                        "status": detection_state["status"],
                        "alert_log": detection_state["alert_log"][:10],
                        "frame_count": detection_state["frame_count"],
                    })
                    asyncio.run(broadcast(msg))

            cap.release()
        except Exception as e:
            print(f"Capture error: {e}")
            detection_state["status"] = "error"
            time.sleep(3)


async def broadcast(message: str):
    dead = []
    for ws in connected_clients:
        try:
            await ws.send_text(message)
        except:
            dead.append(ws)
    for ws in dead:
        connected_clients.remove(ws)


# ---- API Routes ----
@app.get("/", response_class=HTMLResponse)
async def index():
    return FileResponse("dashboard.html")

@app.get("/video_feed")
async def video_feed():
    def generate():
        while True:
            with frame_lock:
                frame = latest_annotated_frame
            if frame:
                yield (b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + frame + b"\r\n")
            time.sleep(0.033)
    return StreamingResponse(generate(),
                             media_type="multipart/x-mixed-replace;boundary=frame")

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    connected_clients.append(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        connected_clients.remove(ws)

@app.get("/api/status")
async def status():
    return {
        "status": detection_state["status"],
        "fps": detection_state["fps"],
        "frame_count": detection_state["frame_count"],
        "cam_ip": detection_state["cam_ip"],
        "detections": detection_state["detections"],
        "alert_log": detection_state["alert_log"][:20],
    }

@app.get("/api/alerts")
async def alerts():
    return detection_state["alert_log"]


# ---- Start background thread ----
@app.on_event("startup")
async def startup():
    t = threading.Thread(target=capture_and_detect, daemon=True)
    t.start()
    print("Detection thread started")
    print("Dashboard: http://localhost:8000")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=False)
