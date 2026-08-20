import ctypes
import socket
import json
import time
import threading
import io
import pyautogui
from PIL import ImageGrab
from http.server import BaseHTTPRequestHandler, HTTPServer
import io

# Optional: keep scaling awareness if on windows
try:
    user32 = ctypes.windll.user32
    user32.SetProcessDPIAware()
except Exception:
    pass

# Configure pyautogui
pyautogui.FAILSAFE = False # The agent might move it to the corner, but let's keep it false for agent. (User can kill app to stop)
pyautogui.PAUSE = 0.0 # Remove the 50ms pause to process 60 FPS movements instantly

screen_width, screen_height = pyautogui.size()

class ScreenshotHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        print(f"Got GET request for {self.path}", flush=True)
        if self.path == '/screenshot':
            try:
                print("Grabbing screen...", flush=True)
                img = ImageGrab.grab()
                
                print("Saving to JPEG in memory...", flush=True)
                img_byte_arr = io.BytesIO()
                img.save(img_byte_arr, format='JPEG', quality=60)
                img_bytes = img_byte_arr.getvalue()
                print("Sending response...", flush=True)
                
                self.send_response(200)
                self.send_header('Content-type', 'image/jpeg')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(img_bytes)
                print("Response sent.", flush=True)
            except Exception as e:
                print(f"Error in do_GET: {e}", flush=True)
                self.send_response(500)
                self.end_headers()
                self.wfile.write(str(e).encode())
        else:
            self.send_response(404)
            self.end_headers()
            
    # Suppress logging to keep console clean
    def log_message(self, format, *args):
        pass

def start_screenshot_server():
    server = HTTPServer(('127.0.0.1', 5006), ScreenshotHandler)
    print("Screenshot server listening on 127.0.0.1:5006", flush=True)
    server.serve_forever()

def move_mouse(nx, ny):
    x = int(nx * screen_width)
    y = int(ny * screen_height)
    pyautogui.moveTo(x, y)

def udp_server():
    UDP_IP = "127.0.0.1"
    UDP_PORT = 5005
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind((UDP_IP, UDP_PORT))
    
    print(f"Mouse/Keyboard Daemon listening on {UDP_IP}:{UDP_PORT} (Resolution: {screen_width}x{screen_height})", flush=True)
    
    while True:
        try:
            data, addr = sock.recvfrom(4096)
            msg = json.loads(data.decode("utf-8"))
            
            action = msg.get("action")
            nx = msg.get("x")
            ny = msg.get("y")
            
            # Mouse movement
            if nx is not None and ny is not None:
                move_mouse(nx, ny)
                
            # Actions
            if action == "click":
                pyautogui.click()
            elif action == "right_click":
                pyautogui.rightClick()
            elif action == "double_click":
                pyautogui.doubleClick()
            elif action == "drag_start":
                pyautogui.mouseDown()
            elif action == "drag_end":
                pyautogui.mouseUp()
            elif action == "type":
                text = msg.get("text", "")
                if text:
                    pyautogui.write(text, interval=0.01)
            elif action == "key":
                key = msg.get("key", "")
                if key:
                    pyautogui.press(key)
                
        except Exception as e:
            print(f"Error processing message: {e}", flush=True)

def start_wake_word_listener():
    try:
        import speech_recognition as sr
        import keyboard
        
        recognizer = sr.Recognizer()
        mic = sr.Microphone()
        
        def callback(recognizer, audio):
            try:
                text = recognizer.recognize_google(audio).lower()
                print(f"Heard background audio: {text}", flush=True)
                if "ultron" in text or "altron" in text or "haltron" in text:
                    print("WAKE WORD DETECTED! Triggering UI...", flush=True)
                    keyboard.send('ctrl+shift+space')
            except sr.UnknownValueError:
                pass
            except Exception as e:
                print(f"Wake word error: {e}", flush=True)
                
        print("Initializing wake word listener...", flush=True)
        with mic as source:
            recognizer.adjust_for_ambient_noise(source, duration=1)
            
        recognizer.listen_in_background(mic, callback, phrase_time_limit=3)
        print("Wake word listener running in background.", flush=True)
    except Exception as e:
        print(f"Failed to start wake word listener: {e}", flush=True)

def main():
    # Start UDP server in a background thread
    threading.Thread(target=udp_server, daemon=True).start()
    
    # Start Wake Word listener (it spawns its own daemon thread)
    start_wake_word_listener()
    
    # Start screenshot server on the main thread to prevent ImageGrab hangs on Windows
    start_screenshot_server()

if __name__ == "__main__":
    main()
