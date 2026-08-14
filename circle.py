import socket
import json
import time
import math

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
for i in range(100):
    nx = 0.5 + 0.3 * math.cos(i * 0.1)
    ny = 0.5 + 0.3 * math.sin(i * 0.1)
    sock.sendto(json.dumps({'x': nx, 'y': ny, 'action': 'move'}).encode(), ('127.0.0.1', 5005))
    time.sleep(0.016)
