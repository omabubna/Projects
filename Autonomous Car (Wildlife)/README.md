# 🌿 SafariIQ — Wildlife Detection System

## Files
- `dashboard.html` — The web dashboard (served by server.py)
- `server.py` — Python backend: ONNX inference + MJPEG proxy + WebSocket
- `requirements.txt` — Python dependencies
- `ESP32_CAM_Stream/ESP32_CAM_Stream.ino` — Arduino sketch for ESP32-CAM

---

## Hardware Connections

### ESP32-CAM → ESP32-S3 (UART)
| ESP32-CAM | ESP32-S3 | Purpose |
|-----------|----------|---------|
| GND       | GND      | Common Ground |
| 5V        | 5V0      | Power |
| U0TXD (GPIO1) | GPIO44 (U0RXD) | UART |
| U0RXD (GPIO3) | GPIO43 (U0TXD) | UART |
| GPIO0     | GND *(flash only)* | Flash mode |

---

## Step-by-Step Setup

### Step 1: Flash ESP32-CAM
1. Install Arduino IDE 2.x
2. Add ESP32 board: File > Preferences > Boards Manager URL:
   `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
3. Install board: Tools > Board Manager > search "esp32" by Espressif
4. Select: Tools > Board > ESP32 Arduino > **AI Thinker ESP32-CAM**
5. Edit `ESP32_CAM_Stream.ino`: set your WiFi SSID and password
6. Wire GPIO0 → GND (flash mode), connect via FTDI programmer
7. Upload. Then **remove GPIO0 from GND** and press RST
8. Open Serial Monitor (115200 baud) → note the IP address shown

### Step 2: Set up Python server
```bash
# Install Python 3.9+
pip install -r requirements.txt

# Place your yolov8n.onnx in the same folder as server.py
# Edit server.py line 14: set ESP32_CAM_IP to the IP from Serial Monitor

python server.py
```

### Step 3: Open Dashboard
Open browser: `http://localhost:8000`

When prompted, enter: `http://localhost:8000` (already pre-filled)

---

## Notes
- The ONNX model runs on your **PC** (Python backend), not the ESP32
- ESP32-CAM streams raw MJPEG → Python pulls frames → runs YOLOv8 → serves annotated feed
- If you fine-tuned YOLOv8 on custom animal classes, edit `CLASS_NAMES` in `server.py`
- For GPU inference: install `onnxruntime-gpu` instead of `onnxruntime`
- Dashboard auto-reconnects WebSocket if connection drops

## Troubleshooting
- **Camera not connecting**: Check ESP32-CAM IP in Serial Monitor, update server.py
- **Model not found**: Ensure yolov8n.onnx is in same directory as server.py
- **Low FPS**: Reduce camera resolution to QVGA in the Arduino sketch
- **CORS errors**: The server has CORS enabled for all origins by default
