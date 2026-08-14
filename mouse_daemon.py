import ctypes
import socket
import json
import time

user32 = ctypes.windll.user32
user32.SetProcessDPIAware() # Important for correct resolution scaling

screen_width = user32.GetSystemMetrics(0)
screen_height = user32.GetSystemMetrics(1)

MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_RIGHTDOWN = 0x0008
MOUSEEVENTF_RIGHTUP = 0x0010

def move_mouse(nx, ny):
    # Smooth coordinates using simple interpolation or raw jump
    x = int(nx * screen_width)
    y = int(ny * screen_height)
    user32.SetCursorPos(x, y)

def do_click():
    user32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
    user32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)

def do_right_click():
    user32.mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0)
    user32.mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0)

def do_drag_start():
    user32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)

def do_drag_end():
    user32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)

def main():
    UDP_IP = "127.0.0.1"
    UDP_PORT = 5005

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind((UDP_IP, UDP_PORT))
    
    print(f"Mouse Daemon listening on {UDP_IP}:{UDP_PORT} (Resolution: {screen_width}x{screen_height})", flush=True)
    
    while True:
        try:
            data, addr = sock.recvfrom(1024)
            msg = json.loads(data.decode("utf-8"))
            
            action = msg.get("action")
            nx = msg.get("x")
            ny = msg.get("y")
            
            if nx is not None and ny is not None:
                move_mouse(nx, ny)
                
            if action == "click":
                do_click()
            elif action == "right_click":
                do_right_click()
            elif action == "drag_start":
                do_drag_start()
            elif action == "drag_end":
                do_drag_end()
                
        except Exception as e:
            print(f"Error processing message: {e}", flush=True)

if __name__ == "__main__":
    main()
