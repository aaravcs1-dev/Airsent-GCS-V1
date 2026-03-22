import asyncio
import websockets
from pymavlink import mavutil
import json

# CHANGE THIS PORT (you already found it)
SERIAL_PORT = "/dev/tty.usbserial-0001"
BAUD = 57600

# connect to pixhawk
print("Connecting to Pixhawk...")
master = mavutil.mavlink_connection(SERIAL_PORT, baud=BAUD)

master.wait_heartbeat()
print("✅ Connected to drone")

clients = set()

async def handler(websocket):
    clients.add(websocket)
    try:
        while True:
            await asyncio.sleep(1)
    finally:
        clients.remove(websocket)

async def send_data():
    while True:
        msg = master.recv_match(blocking=True)

        if not msg:
            continue

        data = {}

        # ATTITUDE
        if msg.get_type() == "ATTITUDE":
            data["roll"] = msg.roll
            data["pitch"] = msg.pitch
            data["yaw"] = msg.yaw

        # GPS
        if msg.get_type() == "GPS_RAW_INT":
            data["lat"] = msg.lat / 1e7
            data["lon"] = msg.lon / 1e7
            data["sats"] = msg.satellites_visible

        # BATTERY
        if msg.get_type() == "SYS_STATUS":
            data["voltage"] = msg.voltage_battery / 1000.0
            data["current"] = msg.current_battery / 100.0
            data["battery"] = msg.battery_remaining

        if data:
            message = json.dumps(data)

            for client in clients:
                try:
                    await client.send(message)
                except:
                    pass

async def main():
    server = await websockets.serve(handler, "localhost", 8765)
    print("🌐 WebSocket running on ws://localhost:8765")

    await asyncio.gather(send_data(), server.wait_closed())

asyncio.run(main())